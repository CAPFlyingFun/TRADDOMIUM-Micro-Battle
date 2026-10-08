/**
 * THE ARMPITS, re-weighted so the skin folds when the arms come down instead of
 * tearing.
 *
 * Joshua, 2026-10-08, on the Sarah Lab's front view: "by her underarms (arm/shoulder,
 * body) it's a little jagged and not smooth". Rendered next to each other, the
 * untouched master and the bake both showed it, and only with the arms DOWN: in the
 * T-pose the master ships in, the armpit is smooth. Meshy's weights there change from
 * the chest to the upper arm in a step, a few millimetres wide, so when the arm swings
 * down 75° two neighbouring vertices follow different bones and the skin between them
 * shears into a ragged edge.
 *
 * The cure is `smoothSeatWeights.mjs`'s, moved up: every vertex within `REGION` of
 * a shoulder takes the distance-weighted average of the bone weights of everything
 * within `RADIUS` of it, so the change from chest to arm is spread over centimetres
 * rather than millimetres; the region's edge fades back to the master's own weights,
 * so nothing outside it changes. Two passes, so the spread is smooth and not a ramp.
 *
 * The shoulders are found from the skeleton, never from names: the chest is the first
 * joint above the pelvis with three or more children (neck and two collars), and each
 * collar's child is the upper arm.
 *
 * A module, not a command; imported by `bakeHumans.mjs` for the bodies whose entry
 * asks for it (`smoothArmpits`).
 */

/** Fractions of the skeleton's own height (lowest to highest joint). GAME TUNING,
 * chosen against renders of the base Sarah with her arms down. */
export const REGION = 0.085;
export const RADIUS = 0.03;
export const FADE = 0.035;
export const PASSES = 2;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function jointPositions(skin) {
  const m = skin.getInverseBindMatrices().getArray();
  const out = [];
  for (let o = 0; o < m.length; o += 16) {
    const t = [m[o + 12], m[o + 13], m[o + 14]];
    const s2 = m[o] * m[o] + m[o + 1] * m[o + 1] + m[o + 2] * m[o + 2];
    out.push([
      -(m[o] * t[0] + m[o + 1] * t[1] + m[o + 2] * t[2]) / s2,
      -(m[o + 4] * t[0] + m[o + 5] * t[1] + m[o + 6] * t[2]) / s2,
      -(m[o + 8] * t[0] + m[o + 9] * t[1] + m[o + 10] * t[2]) / s2,
    ]);
  }
  return out;
}

/** The two upper-arm joints: the children of the chest's two sideways children. */
export function shoulders(skin, at) {
  const joints = skin.listJoints();
  const kids = joints.map((j) => j.listChildren().map((c) => joints.indexOf(c)).filter((k) => k >= 0));
  const pelvis = kids.findIndex((c) => c.length >= 3);
  if (pelvis < 0) return [];
  let chest = -1;
  for (let i = 0; i < joints.length; i += 1) {
    if (i === pelvis || kids[i].length < 3 || at[i][1] <= at[pelvis][1]) continue;
    if (chest < 0 || at[i][1] < at[chest][1]) chest = i;
  }
  if (chest < 0) return [];
  // the two children furthest to either side are the collars; each one's child is the upper arm
  const sideways = [...kids[chest]].sort((a, b) => Math.abs(at[b][0] - at[chest][0]) - Math.abs(at[a][0] - at[chest][0])).slice(0, 2);
  return sideways.map((c) => (kids[c].length ? kids[c][0] : c));
}

export function smoothArmpitWeights(doc, { log = () => {} } = {}) {
  const skin = doc.getRoot().listSkins()[0];
  if (!skin) return;
  const at = jointPositions(skin);
  const arms = shoulders(skin, at);
  if (arms.length !== 2) { log('armpits: no two shoulders found; weights left as the master has them'); return; }
  let lo = Infinity, hi = -Infinity;
  for (const p of at) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
  const span = hi - lo;
  const R = RADIUS * span, region = REGION * span, fade = FADE * span;
  // the region's centre: the shoulder joint, a little down and in, where the armpit is
  const centres = arms.map((a) => [at[a][0] * 0.9, at[a][1] - 0.03 * span, at[a][2]]);

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION');
      const J = prim.getAttribute('JOINTS_0');
      const W = prim.getAttribute('WEIGHTS_0');
      if (!P || !J || !W) continue;
      const n = P.getCount();
      const pos = new Float32Array(n * 3);
      let jw = new Uint16Array(n * 4);
      let ww = new Float32Array(n * 4);
      const p = [0, 0, 0], j = [0, 0, 0, 0], w = [0, 0, 0, 0];
      const inside = new Float32Array(n);
      const cells = new Map();
      const key = (x, y, z) => `${Math.floor(x / R)},${Math.floor(y / R)},${Math.floor(z / R)}`;
      for (let v = 0; v < n; v += 1) {
        P.getElement(v, p); J.getElement(v, j); W.getElement(v, w);
        pos.set(p, v * 3); jw.set(j, v * 4); ww.set(w, v * 4);
        let near = Infinity;
        for (const c of centres) near = Math.min(near, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
        if (near > region + R) continue;
        inside[v] = smoothstep(region, region - fade, near);
        const k = key(p[0], p[1], p[2]);
        let list = cells.get(k);
        if (!list) cells.set(k, (list = []));
        list.push(v);
      }
      let changed = 0;
      for (let pass = 0; pass < PASSES; pass += 1) {
        const nj = new Uint16Array(jw), nw = new Float32Array(ww);
        const acc = new Map();
        for (let v = 0; v < n; v += 1) {
          if (!(inside[v] > 0)) continue;
          const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
          acc.clear();
          let total = 0;
          const cx = Math.floor(x / R), cy = Math.floor(y / R), cz = Math.floor(z / R);
          for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
            const list = cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
            if (!list) continue;
            for (const u of list) {
              const d = Math.hypot(pos[u * 3] - x, pos[u * 3 + 1] - y, pos[u * 3 + 2] - z);
              if (d > R) continue;
              const f = 1 - d / R;
              for (let k = 0; k < 4; k += 1) {
                const wt = ww[u * 4 + k];
                if (!(wt > 0)) continue;
                const b = jw[u * 4 + k];
                acc.set(b, (acc.get(b) ?? 0) + wt * f);
              }
              total += f;
            }
          }
          if (total <= 0) continue;
          const mix = new Map();
          for (const [b, s] of acc) mix.set(b, (s / total) * inside[v]);
          for (let k = 0; k < 4; k += 1) {
            const wt = ww[v * 4 + k];
            if (wt > 0) mix.set(jw[v * 4 + k], (mix.get(jw[v * 4 + k]) ?? 0) + wt * (1 - inside[v]));
          }
          const top = [...mix].sort((a, b) => b[1] - a[1]).slice(0, 4);
          const sum = top.reduce((s, e) => s + e[1], 0) || 1;
          for (let k = 0; k < 4; k += 1) { nj[v * 4 + k] = top[k] ? top[k][0] : 0; nw[v * 4 + k] = top[k] ? top[k][1] / sum : 0; }
          if (pass === 0) changed += 1;
        }
        jw = nj; ww = nw;
      }
      for (let v = 0; v < n; v += 1) {
        if (!(inside[v] > 0)) continue;
        J.setElement(v, Array.from(jw.subarray(v * 4, v * 4 + 4)));
        W.setElement(v, Array.from(ww.subarray(v * 4, v * 4 + 4)));
      }
      log(`armpits: bone weights smoothed in space round both shoulders (radius ${(R * 1000).toFixed(0)} bind mm, region ${(region * 1000).toFixed(0)} mm, ${PASSES} passes): ${changed.toLocaleString()} vertices`);
    }
  }
}
