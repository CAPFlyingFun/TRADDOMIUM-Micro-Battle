/**
 * THE CREASE UNDER THE BUMP, re-weighted so a stride folds it instead of tearing it.
 *
 * Joshua, 2026-10-08, walking the base Sarah at 200%: "walking looks a little weird
 * between the hips, pubic area, and under the belly". Under a big bump the skin runs
 * from belly (the pelvis, after `protectBumpWeights`) to thigh in a centimetre or two,
 * so each step pulled the underside of the belly into a ragged, dark lip as the thigh
 * swung forward.
 *
 * The cure is the hands' (`smoothHandWeights.mjs`): in a band round the groin, in
 * front of the hip line, the bone weights are eased toward their neighbours' along
 * the SKIN, so the change from belly to thigh is spread over several centimetres. Along
 * the skin, never through space: the two thighs and the belly's underside sit a few
 * centimetres apart and must not pull on each other. The band's edge fades back to
 * the weights as they were.
 *
 * Measured from the skeleton, never by name: the pelvis is the first joint with three
 * or more children, its two lowest children are the hips.
 *
 * A module, not a command; imported by `bakeHumans.mjs` for bodies with `smoothCrease`.
 */

/** Metres on the master (1.700 m). GAME TUNING, chosen against renders of the walk at 200%. */
export const BELOW_HIP = 0.16;
export const ABOVE_HIP = 0.05;
export const FRONT_FROM = -0.02;
export const FADE = 0.04;
export const ITERATIONS = 24;
export const EASE = 0.5;

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function jointPositions(skin) {
  const m = skin.getInverseBindMatrices().getArray();
  const out = [];
  for (let o = 0; o < m.length; o += 16) {
    const t = [m[o + 12], m[o + 13], m[o + 14]];
    const s2 = m[o] * m[o] + m[o + 1] * m[o + 1] + m[o + 2] * m[o + 2];
    out.push([-(m[o] * t[0] + m[o + 1] * t[1] + m[o + 2] * t[2]) / s2, -(m[o + 4] * t[0] + m[o + 5] * t[1] + m[o + 6] * t[2]) / s2, -(m[o + 8] * t[0] + m[o + 9] * t[1] + m[o + 10] * t[2]) / s2]);
  }
  return out;
}

export function smoothCreaseWeights(doc, { log = () => {} } = {}) {
  const skin = doc.getRoot().listSkins()[0];
  if (!skin) return;
  const at = jointPositions(skin);
  const joints = skin.listJoints();
  const kids = joints.map((j) => j.listChildren().map((c) => joints.indexOf(c)).filter((k) => k >= 0));
  const pelvis = kids.findIndex((c) => c.length >= 3);
  if (pelvis < 0) { log('crease: no pelvis found; weights left as they were'); return; }
  const hips = kids[pelvis].filter((c) => at[c][1] < at[pelvis][1]).sort((a, b) => at[a][1] - at[b][1]).slice(0, 2);
  if (hips.length < 2) { log('crease: no two hips found; weights left as they were'); return; }
  const hipY = (at[hips[0]][1] + at[hips[1]][1]) / 2, hipZ = (at[hips[0]][2] + at[hips[1]][2]) / 2;
  const y0 = hipY - BELOW_HIP, y1 = hipY + ABOVE_HIP;

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0'), I = prim.getIndices();
      if (!P || !J || !W || !I) continue;
      const n = P.getCount();
      const p = [0, 0, 0], j = [0, 0, 0, 0], w = [0, 0, 0, 0];
      const pos = new Float32Array(n * 3);
      const map = new Map(), rep = new Int32Array(n), weights = new Array(n);
      for (let v = 0; v < n; v += 1) {
        P.getElement(v, p); pos.set(p, v * 3);
        const k = `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)},${Math.round(p[2] * 1e5)}`;
        if (!map.has(k)) map.set(k, v);
        rep[v] = map.get(k);
        J.getElement(v, j); W.getElement(v, w);
        const m = new Map();
        for (let a = 0; a < 4; a += 1) if (w[a] > 0) m.set(j[a], (m.get(j[a]) ?? 0) + w[a]);
        weights[v] = m;
      }
      const nb = new Map();
      const link = (a, b) => { if (a === b) return; if (!nb.has(a)) nb.set(a, new Set()); nb.get(a).add(b); };
      const ix = I.getArray();
      for (let f = 0; f < ix.length; f += 3) { const a = rep[ix[f]], b = rep[ix[f + 1]], c = rep[ix[f + 2]]; link(a, b); link(a, c); link(b, a); link(b, c); link(c, a); link(c, b); }
      // how far inside the band each welded vertex is (0 outside)
      const inside = new Map();
      for (let v = 0; v < n; v += 1) {
        if (rep[v] !== v) continue;
        const y = pos[v * 3 + 1], z = pos[v * 3 + 2];
        const k = smoothstep(y0, y0 + FADE, y) * smoothstep(y1, y1 - FADE, y) * smoothstep(hipZ + FRONT_FROM, hipZ + FRONT_FROM + FADE, z);
        if (k > 0) inside.set(v, k);
      }
      if (inside.size === 0) continue;
      const list = [...inside.keys()];
      let cur = new Map(list.map((v) => [v, weights[v]]));
      const get = (v) => cur.get(v) ?? weights[v];
      for (let it = 0; it < ITERATIONS; it += 1) {
        const next = new Map();
        for (const v of list) {
          const ns = nb.get(v);
          if (!ns || ns.size === 0) { next.set(v, get(v)); continue; }
          const e = EASE * inside.get(v);
          const acc = new Map();
          for (const [b, x] of get(v)) acc.set(b, x * (1 - e));
          const share = e / ns.size;
          for (const u of ns) for (const [b, x] of get(u)) acc.set(b, (acc.get(b) ?? 0) + x * share);
          next.set(v, acc);
        }
        cur = next;
      }
      let changed = 0;
      for (let v = 0; v < n; v += 1) {
        const m = cur.get(rep[v]);
        if (!m) continue;
        const top = [...m].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const sum = top.reduce((s, e) => s + e[1], 0) || 1;
        J.setElement(v, [0, 1, 2, 3].map((k) => (top[k] ? top[k][0] : 0)));
        W.setElement(v, [0, 1, 2, 3].map((k) => (top[k] ? top[k][1] / sum : 0)));
        changed += 1;
      }
      log(`crease: bone weights eased along the skin under the bump (${ITERATIONS} passes, band ${y0.toFixed(2)}..${y1.toFixed(2)} m): ${changed.toLocaleString()} vertices`);
    }
  }
}
