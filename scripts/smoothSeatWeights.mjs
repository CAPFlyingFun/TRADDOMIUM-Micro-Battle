/**
 * THE SEAT, re-weighted so a shirt's hem moves with the trousers under it.
 *
 * Joshua, 2026-10-07, on the toon masters: "Make sure Jack and Sarah when
 * sitting that their legs and body looks good. Might need to adjust the
 * weight or something if it's being distorted a little." It was. Seated,
 * both toon bodies showed a ragged stair-step all round the hem at the back:
 * the shirt's hem and the cloth just under it are two layers a few
 * millimetres apart, rigged by Meshy to DIFFERENT bones — the hem almost
 * wholly to the pelvis, the seat of the trousers or leggings half to the
 * thigh — so when the thigh swings forward 90° the lower layer rises
 * through the upper one and the two z-fight along the whole hem.
 *
 * A seam between layers cannot be fixed one vertex at a time, because the
 * fault is that two vertices in nearly the same place disagree. So the
 * weights are SMOOTHED IN SPACE, not along the mesh: every vertex in the
 * band round the hips takes the distance-weighted average of the bone
 * weights of everything within `RADIUS` of it, whichever layer that
 * belongs to. Two layers that touch end up with the same weights and fold
 * together; the band's two edges fade back to the master's own weights so
 * nothing outside it changes.
 *
 * The band is measured from the skeleton, never from a body's name: from
 * `BELOW_HIP` under the hip joints up to `ABOVE_PELVIS` over the pelvis,
 * in fractions of the joint span, with `FADE` of it given to the
 * transition at each edge.
 *
 * A module, not a command; imported by `bakeHumans.mjs` for the bodies
 * whose entry asks for it (`smoothSeat`).
 */

/** Fractions of the skeleton's own height (lowest to highest joint). GAME TUNING,
 * chosen against renders of both toon bodies seated and walking. */
export const RADIUS = 0.022;
export const BELOW_HIP = 0.10;
export const ABOVE_PELVIS = 0.07;
export const FADE = 0.03;

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

/** The pelvis: the first joint (walking from the root) with three or more children. */
function pelvisAndHips(skin, at) {
  const joints = skin.listJoints();
  const kids = joints.map((j) => j.listChildren().map((c) => joints.indexOf(c)).filter((k) => k >= 0));
  const pelvis = kids.findIndex((c) => c.length >= 3);
  if (pelvis < 0) return null;
  // The two children that reach downward are the hips.
  const hips = kids[pelvis].filter((c) => at[c][1] < at[pelvis][1]).sort((a, b) => at[a][1] - at[b][1]).slice(0, 2);
  return hips.length === 2 ? { pelvis, hips } : null;
}

export function smoothSeatWeights(doc, { log = () => {} } = {}) {
  const skin = doc.getRoot().listSkins()[0];
  if (!skin) return;
  const at = jointPositions(skin);
  const found = pelvisAndHips(skin, at);
  if (!found) { log('seat: no pelvis with two hips found; weights left as the master has them'); return; }
  let lo = Infinity, hi = -Infinity;
  for (const p of at) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
  const span = hi - lo;
  const R = RADIUS * span;
  const hipY = Math.min(at[found.hips[0]][1], at[found.hips[1]][1]);
  const y0 = hipY - BELOW_HIP * span;
  const y1 = at[found.pelvis][1] + ABOVE_PELVIS * span;
  const fade = FADE * span;

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION');
      const J = prim.getAttribute('JOINTS_0');
      const W = prim.getAttribute('WEIGHTS_0');
      if (!P || !J || !W) continue;
      const n = P.getCount();
      const pos = new Float32Array(n * 3);
      const jw = new Uint16Array(n * 4);
      const ww = new Float32Array(n * 4);
      const p = [0, 0, 0], j = [0, 0, 0, 0], w = [0, 0, 0, 0];
      // Grid over the band (plus one radius), cell = R.
      const cells = new Map();
      const key = (x, y, z) => `${Math.floor(x / R)},${Math.floor(y / R)},${Math.floor(z / R)}`;
      for (let v = 0; v < n; v += 1) {
        P.getElement(v, p); J.getElement(v, j); W.getElement(v, w);
        pos.set(p, v * 3); jw.set(j, v * 4); ww.set(w, v * 4);
        if (p[1] < y0 - R || p[1] > y1 + R) continue;
        const k = key(p[0], p[1], p[2]);
        let list = cells.get(k);
        if (!list) cells.set(k, (list = []));
        list.push(v);
      }
      let changed = 0;
      const acc = new Map();
      for (let v = 0; v < n; v += 1) {
        const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
        if (y < y0 || y > y1) continue;
        const inside = Math.min(smoothstep(y0, y0 + fade, y), smoothstep(y1, y1 - fade, y));
        if (inside <= 0) continue;
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
        // Blend the averaged set with the master's own by how far inside the band.
        const mix = new Map();
        for (const [b, s] of acc) mix.set(b, (s / total) * inside);
        for (let k = 0; k < 4; k += 1) {
          const wt = ww[v * 4 + k];
          if (wt > 0) mix.set(jw[v * 4 + k], (mix.get(jw[v * 4 + k]) ?? 0) + wt * (1 - inside));
        }
        const top = [...mix].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const sum = top.reduce((s, e) => s + e[1], 0) || 1;
        J.setElement(v, [0, 1, 2, 3].map((k) => (top[k] ? top[k][0] : 0)));
        W.setElement(v, [0, 1, 2, 3].map((k) => (top[k] ? top[k][1] / sum : 0)));
        changed += 1;
      }
      log(`seat: bone weights smoothed in space across the hips (radius ${(R * 1000).toFixed(0)} bind mm, band ${(y0).toFixed(3)}..${(y1).toFixed(3)}): ${changed.toLocaleString()} vertices`);
    }
  }
}
