/**
 * THE HANDS, re-weighted so the skin bends at a knuckle instead of breaking.
 *
 * Joshua, 2026-10-08, curling the base Sarah's fingers in the Sarah Lab: "it's mainly
 * the skin when bending looks broken and not smooth looking". Meshy weights each
 * finger segment almost wholly to its own bone and changes bone in a step at the
 * knuckle, so a bend shears the two rings of skin either side apart: a torn, faceted
 * knuckle on every finger.
 *
 * The cure is the belly's (`bellyMorph.mjs` relaxes its pushes over the skin): the
 * bone weights of every vertex on the fingers and the palm are eased toward their
 * neighbours' along the SKIN, `ITERATIONS` times, so each knuckle's change of bone is
 * spread over a few millimetres either side of it. Along the skin, never through
 * space: two fingers lie a centimetre and a half apart, and a radius in space would
 * have one finger tug the next. The region is every vertex any finger bone holds,
 * and `RING` rings of skin round it; past it the master's weights are untouched.
 *
 * The hands are found from the skeleton, never from names: a joint with four or
 * more children well out from the body's middle is a hand, and its children's
 * chains are the fingers.
 *
 * A module, not a command; imported by `bakeHumans.mjs` for the bodies whose entry
 * asks for it (`smoothHands`).
 */

/** GAME TUNING, chosen against renders of the base Sarah's fist. */
export const ITERATIONS = 14;
export const RING = 2;
/** How much of its neighbours' weights a vertex takes each pass. */
export const EASE = 0.5;

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

/** Every finger joint: the descendants of each hand (a joint with 4+ children out past a third of the arm span). */
export function fingerJoints(skin, at) {
  const joints = skin.listJoints();
  const kids = joints.map((j) => j.listChildren().map((c) => joints.indexOf(c)).filter((k) => k >= 0));
  let reach = 0;
  for (const p of at) reach = Math.max(reach, Math.abs(p[0]));
  const out = new Set();
  for (let h = 0; h < joints.length; h += 1) {
    if (kids[h].length < 4 || Math.abs(at[h][0]) < reach * 0.6) continue;
    const stack = [...kids[h]];
    while (stack.length) { const j = stack.pop(); out.add(j); stack.push(...kids[j]); }
  }
  return out;
}

export function smoothHandWeights(doc, { log = () => {} } = {}) {
  const skin = doc.getRoot().listSkins()[0];
  if (!skin) return;
  const fingers = fingerJoints(skin, jointPositions(skin));
  if (fingers.size === 0) { log('hands: no fingers found; weights left as the master has them'); return; }

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
      const I = prim.getIndices();
      if (!P || !J || !W || !I) continue;
      const n = P.getCount();
      const p = [0, 0, 0], j = [0, 0, 0, 0], w = [0, 0, 0, 0];
      // weld: the same point split across UV seams is one vertex of skin
      const map = new Map(), rep = new Int32Array(n);
      const weights = new Array(n);
      for (let v = 0; v < n; v += 1) {
        P.getElement(v, p);
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
      for (let f = 0; f < ix.length; f += 3) {
        const a = rep[ix[f]], b = rep[ix[f + 1]], c = rep[ix[f + 2]];
        link(a, b); link(a, c); link(b, a); link(b, c); link(c, a); link(c, b);
      }
      // the region: every welded vertex a finger bone holds, and RING rings round it
      const region = new Set();
      for (let v = 0; v < n; v += 1) {
        if (rep[v] !== v) continue;
        for (const b of weights[v].keys()) if (fingers.has(b)) { region.add(v); break; }
      }
      if (region.size === 0) continue;
      for (let r = 0; r < RING; r += 1) for (const v of [...region]) for (const u of nb.get(v) || []) region.add(u);
      const list = [...region];
      let cur = new Map(list.map((v) => [v, weights[v]]));
      const get = (v) => cur.get(v) ?? weights[v];
      for (let it = 0; it < ITERATIONS; it += 1) {
        const next = new Map();
        for (const v of list) {
          const ns = nb.get(v);
          if (!ns || ns.size === 0) { next.set(v, get(v)); continue; }
          const acc = new Map();
          for (const [b, x] of get(v)) acc.set(b, x * (1 - EASE));
          const share = EASE / ns.size;
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
      log(`hands: bone weights eased along the skin of both hands (${ITERATIONS} passes, ${fingers.size} finger joints): ${changed.toLocaleString()} vertices`);
    }
  }
}
