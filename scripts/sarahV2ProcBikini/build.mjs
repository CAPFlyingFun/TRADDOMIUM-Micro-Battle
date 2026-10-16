// SARAH V2'S PROCEDURAL BIKINI TOP (approved by Joshua, 2026-10-16). Her bikini top is generated rather
// than fitted: each cup is a rounded triangle on three anchors found on her own breast (the underside
// fold found by the skin's concavity, then the top and the outer corner), its edge a flat 2 x 0.5 mm
// ribbon with rounded edges laid on her skin by smoothed splines, and its fabric her own skin
// triangles copied inside that edge and painted. The bridge, the back strap and the halter cords are
// the same ribbon, each snapped centre-on-centre to a cup anchor; the halter rests round the base of
// her neck where the game's lanyard lies (collar.mjs ports HumanBadge's measurement) and ends in a
// procedural bow. Every piece is bound to the skin under it (bones and every body shape) and moves
// as one piece along its length (bind.mjs smoothAlong). v1's bikini bottom is kept as it was.
//
//   node scripts/sarahV2ProcBikini/build.mjs <src.glb> <tags.glb> <out.glb>
//   node scripts/packSarah.mjs <out.glb>
//
// <src.glb>: sarah-v2-body.glb wearing v1's fitted bikini, finished by sarahV2BikiniFinish (keepCupShape);
// <tags.glb>: the same fit written with its part tags (_TAG). Every number is an env setting with the
// approved value as its default (HEM_W, SIDE_W, THICK, CLEAR, HEM_RAISE, CUP_BOW, BACK_*, BOW_*, ...);
// DEBUG=1 adds coloured anchor beads, NO_PAINT=1 the trim alone.
import { loadSkin, landmarks, grooveCurve, apply } from './skin.mjs';
import { spline, resample, layOnSurface, sweepRibbon, V } from './ribbon.mjs';
import { binder, addPiece, smoothAlong, ringMotion } from './bind.mjs';
import { measureCollar } from './collar.mjs';
import { vertexNormals } from '../fitMeshyBikini.mjs';
import { NodeIO } from '@gltf-transform/core';
const { sub, add, scl, len, nrm, dot } = V;
const E = (k, d) => Number(process.env[k] ?? d);
const HEM_W = E('HEM_W', 0.003), SIDE_W = E('SIDE_W', 0.002), THICK = E('THICK', 0.0005), CLEAR = E('CLEAR', 0.0006);
const here = (f) => new URL(f, import.meta.url).pathname;
const SRC = process.argv[2], TAGS = process.argv[3], OUT = process.argv[4], DEBUG = !!process.env.DEBUG;
const skin = await loadSkin(SRC);
const kini = skin.mesh.listPrimitives().find((p) => p.getMaterial()?.getName() === 'bikini'), mat = kini.getMaterial();
// 1. the V1 cups come off; the bridge string, halter straps, knot, ties and bottom stay
{ const io = new NodeIO(); const tagDoc = await skin.io.read(TAGS); const tp = tagDoc.getRoot().listMeshes()[0].listPrimitives().find((p) => p.getAttribute('_TAG')); const tag = tp.getAttribute('_TAG').getArray(), kn = tag.length;
  const pos = kini.getAttribute('POSITION'), v = []; const xm = (i) => { pos.getElement(i, v); return Math.abs(skin.Ti ? ( (skin.T[0] * v[0] + skin.T[4] * v[1] + skin.T[8] * v[2] + skin.T[12])) : v[0]); };
  const I = kini.getIndices().getArray(), keep = []; let cut = 0;
  // also off: the short connector band an earlier pass added between the old cup and the neck string
  // (vertices past the tagged range) and anything still touching the old cup: the neck strap is
  // rebuilt below from each new cup's top corner. Its route over her chest is kept as a guide.
  globalThis.__guide = []; { const v3 = []; for (let i = kn; i < pos.getCount(); i += 1) { pos.getElement(i, v3); globalThis.__guide.push(apply(skin.T, v3, 1)); } }
  globalThis.__string = []; { const v3 = []; for (let i = 0; i < kn; i += 1) if (tag[i] === 4) { pos.getElement(i, v3); globalThis.__string.push(apply(skin.T, v3, 1)); } }
  const HALTER_REBUILD = process.env.HALTER_REBUILD !== '0';
  // the neck string's two CORDS (up each side of her neck) go too; its BOW at the back of her neck
  // stays. Told apart by their angle round her neck, seen from above (the bow lies past NECK_CORD_ANG)
  const NECK_ZC = -0.135, NECK_CORD_ANG = E('NECK_CORD_ANG', 97); globalThis.__neck = { zc: NECK_ZC, ang: NECK_CORD_ANG };
  const neckAng = (i) => { const v3 = []; pos.getElement(i, v3); const w = apply(skin.T, v3, 1); return Math.atan2(w[0], w[2] - NECK_ZC) * 180 / Math.PI; };
  for (let t = 0; t < I.length; t += 3) { const tri = [I[t], I[t + 1], I[t + 2]]; const cupTri = tri.every((i) => i < kn && tag[i] === 2) || (HALTER_REBUILD && (tri.some((i) => i >= kn || tag[i] === 2) || tri.some((i) => i < kn && (tag[i] === 4 || tag[i] === 3)))); if (cupTri) { cut += 1; continue; } keep.push(...tri); }
  kini.setIndices(skin.doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(keep)).setBuffer(skin.doc.getRoot().listBuffers()[0]));
  console.log(`V1 cups and bridge removed (${cut} triangles); halter straps, knot, ties and bottom kept`); }
const surface = { nearest: (p) => skin.nearest(p) };
const toSkin = (x, y, z0) => { let p = [x, y, z0]; for (let k = 0; k < 200; k += 1) { const q = skin.nearest(p); if (q && q.dist < 0.002) return q.q; p = [x, y, p[2] - 0.001]; } return skin.nearest(p)?.q ?? p; };
const bind = binder(skin), dbg = [], paints = [];
// THE PAINTED FABRIC: her own skin triangles inside the trim, copied (positions, normals, bone weights,
// every body shape) and lifted PAINT_LIFT off her, cut exactly along a line PAINT_TUCK outside the
// trim's centre so it runs on under the ribbon. Being her own skin, it matches her at any size or pose.
const PAINT_LIFT = E('PAINT_LIFT', 0.0004), PAINT_TUCK = E('PAINT_TUCK', 0.0007);
function paintInside(path, normals, tip) {
  const { P, I, n } = skin;
  // THE TRIM ITSELF is the boundary. Every point gets a signed distance to the trim's centre line,
  // positive on the cup's side: the side is read from the trim's own frame there (its normal and its
  // direction give "inward" in her skin), blended between neighbouring points so a corner has one
  // inward direction. No projection from a viewpoint, so a narrow corner is painted like the rest.
  const m = path.length, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const cen = scl(path.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / m);
  let inw = path.map((p, k) => { const t = nrm(sub(path[(k + 1) % m], path[(k - 1 + m) % m])); return nrm(cross(normals[k], t)); });
  const vote = inw.reduce((a, v, k) => a + Math.sign(dot(v, sub(cen, path[k]))), 0); if (vote < 0) inw = inw.map((v) => scl(v, -1));
  const signed = (p) => { let b = Infinity, bk = 0, bt = 0; for (let k = 0; k < m; k += 1) { const a = path[k], c = path[(k + 1) % m], ab = sub(c, a); const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1))); const d = len(sub(p, add(a, scl(ab, t)))); if (d < b) { b = d; bk = k; bt = t; } }
    const a = path[bk], c = path[(bk + 1) % m], q = add(a, scl(sub(c, a), bt)); const iv = add(scl(inw[bk], 1 - bt), scl(inw[(bk + 1) % m], bt)); return dot(sub(p, q), iv) >= 0 ? b : -b; };
  if (!skin.nb) { skin.nb = Array.from({ length: n }, () => new Set()); for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e += 1) { skin.nb[I[t + e]].add(I[t + (e + 1) % 3]); skin.nb[I[t + (e + 1) % 3]].add(I[t + e]); } }
  // her mesh is split along its texture seams: points at the same place are one point for the fill
  if (!skin.twin) { const h = new Map(); skin.twin = Array.from({ length: n }, () => []); for (let i = 0; i < n; i += 1) { const k = `${Math.round(P[i * 3] * 1e5)},${Math.round(P[i * 3 + 1] * 1e5)},${Math.round(P[i * 3 + 2] * 1e5)}`; const l = h.get(k); if (l) { for (const j of l) { skin.twin[i].push(j); skin.twin[j].push(i); } l.push(i); } else h.set(k, [i]); } }
  const V3 = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], sv = new Map(), S = (i) => { if (!sv.has(i)) sv.set(i, signed(V3(i))); return sv.get(i); };
  // fill her skin from under the tip while on the cup's side of the trim, then take two more rings of
  // her vertices beyond it, so every triangle the trim crosses is in hand to be cut
  let seed = -1, bd = Infinity; for (let i = 0; i < n; i += 1) { const d = (P[i * 3] - tip[0]) ** 2 + (P[i * 3 + 1] - tip[1]) ** 2 + (P[i * 3 + 2] - tip[2]) ** 2; if (d < bd) { bd = d; seed = i; } }
  const reach = new Uint8Array(n), st = [seed]; reach[seed] = 1;
  while (st.length) { const v = st.pop(); for (const w of [...skin.nb[v], ...skin.twin[v]]) if (!reach[w] && S(w) > 0) { reach[w] = 1; st.push(w); } }
  let ring = new Set(); for (let i = 0; i < n; i += 1) if (reach[i]) ring.add(i);
  for (let r = 0; r < 2; r += 1) { const add2 = []; for (const i of ring) for (const w of [...skin.nb[i], ...skin.twin[i]]) if (!ring.has(w)) add2.push(w); for (const w of add2) ring.add(w); }
  const g = new Map(); for (const i of ring) g.set(i, S(i) + PAINT_TUCK);
  const tris = []; for (let t = 0; t < I.length; t += 3) { const v = [I[t], I[t + 1], I[t + 2]]; if (!v.every((i) => g.has(i))) continue; if (v.every((i) => g.get(i) <= -0.006)) continue; tris.push(v); }
  const gAt = (p) => signed(p) + PAINT_TUCK;
  return { tris, g, gAt };
}
const APEX = { 1: [0.096, 1.343], [-1]: [-0.095, 1.340] }, OUTER = { 1: [0.137, 1.258], [-1]: [-0.137, 1.261] };
for (const sg of [1, -1]) {
  const L = landmarks(skin, sg, { xs: [] }), tip = L.tip;
  let G = grooveCurve(skin, sg, tip); const cmax = Math.max(...G.map((g) => g.conc)); G = G.filter((g) => g.conc >= 0.5 * cmax);
  // keep the fold continuous: drop points that jump in height from their neighbours
  G = G.filter((g, k) => { const a = G[k - 1], b = G[k + 1]; const ref = a && b ? (a.p[1] + b.p[1]) / 2 : (a ?? b)?.p[1]; return ref === undefined || Math.abs(g.p[1] - ref) < 0.012; });
  // lift the fold points a little up onto the underside of the breast, out of the crease itself
  // and replace the detected points' small zig-zags with ONE smooth curve: height and depth fitted
  // as cubics across the breast (least squares), so the hem is the fold's overall line, not its noise
  const fitCubic = (xs, vs) => { const A = Array.from({ length: 4 }, () => new Array(5).fill(0)); xs.forEach((x, k) => { const r = [1, x, x * x, x * x * x]; for (let i = 0; i < 4; i += 1) { for (let j = 0; j < 4; j += 1) A[i][j] += r[i] * r[j]; A[i][4] += r[i] * vs[k]; } });
    for (let i = 0; i < 4; i += 1) { let m = i; for (let k = i + 1; k < 4; k += 1) if (Math.abs(A[k][i]) > Math.abs(A[m][i])) m = k; [A[i], A[m]] = [A[m], A[i]]; for (let k = 0; k < 4; k += 1) if (k !== i) { const f = A[k][i] / A[i][i]; for (let j = i; j < 5; j += 1) A[k][j] -= f * A[i][j]; } }
    const c = A.map((r, i) => r[4] / r[i]); return (x) => c[0] + c[1] * x + c[2] * x * x + c[3] * x * x * x; };
  const smoothFold = () => { if (!E('HEM_FIT', 1) || G.length < 5) return; const xs = G.map((g) => g.p[0]); const fy = fitCubic(xs, G.map((g) => g.p[1])), fz = fitCubic(xs, G.map((g) => g.p[2]));
    G = G.map((g) => ({ ...g, p: skin.nearest([g.p[0], fy(g.p[0]), fz(g.p[0])])?.q ?? g.p })); };
  smoothFold();
  // then walk each point UP her breast by HEM_RAISE along the skin itself (1 mm steps, each re-laid
  // on her), so the hem moves onto the underside of the breast by a true surface distance
  const HEM_RAISE = E('HEM_RAISE', 0.01);   // Joshua, 2026-10-16: the hem 1 cm up the breast from the fold
  const walkUp = (p) => { let q = p; for (let d = 0; d < HEM_RAISE - 1e-9; d += 0.001) { const s = skin.nearest(q); if (!s) break; const n = s.n; let u = sub([0, 1, 0], scl(n, n[1])); const L = len(u); if (L < 1e-6) break; u = scl(u, Math.min(0.001, HEM_RAISE - d) / L); q = skin.nearest(add(s.q, u))?.q ?? q; } return q; };
  G = G.map((g) => ({ ...g, p: walkUp(g.p) }));
  smoothFold();
  const W = G[0].p, lastS = G[G.length - 1].p;
  const N = toSkin(...APEX[sg], tip[2] + 0.06), Eo = toSkin(...OUTER[sg], tip[2] + 0.06);
  // NE / NW: the sides' middles, bowed outward a little in the front view, laid on her
  const mid = (a, b, bow) => { const m = scl(add(a, b), 0.5), d = nrm([b[0] - a[0], b[1] - a[1], 0]), o = [-d[1], d[0], 0], c = [tip[0], tip[1]]; const s = Math.sign((m[0] - c[0]) * o[0] + (m[1] - c[1]) * o[1]) || 1; return toSkin(m[0] + o[0] * bow * s, m[1] + o[1] * bow * s, tip[2] + 0.06); };
  // a ROUNDED triangle: each side bows gently outward by a fixed share of its own length, so the
  // bulge scales with the cup as her breasts change and stays the same shape on both sides
  const BOW_FRAC = E('CUP_BOW', 0.06), L2 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const NE = mid(Eo, N, BOW_FRAC * L2(Eo, N)), NW = mid(N, W, BOW_FRAC * L2(N, W));
  // SE: between the fold's last good point and the outer corner, on her side
  const SE = toSkin((lastS[0] + Eo[0]) / 2 + sg * 0.004, (lastS[1] + Eo[1]) / 2 - 0.006, tip[2] + 0.06);
  let ctrl = [W, ...G.slice(1).map((g) => g.p), Eo, NE, N, NW];
  let kinds = ['W', ...G.slice(1).map(() => 'S'), 'E', 'NE', 'N', 'NW'];
  // the HEM: through the fold in 3D (those points are on her skin already), W -> SE -> E
  const hem = resample(spline([W, ...G.slice(1).map((g) => g.p), Eo], { step: 0.0008 }), 0.0015);
  // the SIDES: smooth curves drawn in the FRONT VIEW (a gentle bow through NE / NW), each point
  // then dropped straight back onto her skin, so the line seen from the front is clean by construction
  const side = (a, c, b) => { const pts = []; const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(8, Math.ceil(L / 0.0015));
    for (let k = 1; k < n; k += 1) { const t = k / n, u = 1 - t, x = u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], y = u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]; pts.push(toSkin(x, y, tip[2] + 0.04)); } return pts; };
  // the bow's control point: twice the bowed middle minus the chord's middle (quadratic through NE/NW)
  const ctl = (a, m, b) => [2 * m[0] - (a[0] + b[0]) / 2, 2 * m[1] - (a[1] + b[1]) / 2];
  let path;
  const OUTER_SMOOTH = process.env.OUTER_SMOOTH !== '0';
  if (OUTER_SMOOTH) {
    // the OUTER SIDE as one smooth curve, drawn in the SIDE view from the fold's outer end up to the
    // top, bowed back toward her chest, and found on her skin by looking in from the side (a front
    // ray grazes there, which is where the bite came from). Hem and outer side are one spline.
    const BOW = E('OUTER_BOW', 0.012);
    // a true ray from the side: march in until the point is inside her skin (by the nearest normal),
    // then bisect to the crossing; the point returned is ON the ray, so the side view stays exact
    const sgnAt = (x, y, z) => { const q = skin.nearest([x, y, z]); return q ? dot(sub([x, y, z], q.q), q.n) : 1; };
    const toSide = (y, z) => { let a = sg * 0.25, b = null; for (let k = 0; k < 250; k += 1) { const x = a - sg * 0.001; if (sgnAt(x, y, z) < 0) { b = x; break; } a = x; }
      if (b === null) return skin.nearest([a, y, z])?.q ?? [a, y, z]; for (let k = 0; k < 14; k += 1) { const m = (a + b) / 2; if (sgnAt(m, y, z) < 0) b = m; else a = m; } return [(a + b) / 2, y, z]; };
    // controls in the side view (height, depth): the outer corner Eo, then straight up the side at
    // about Eo's depth, curving forward only near the top where it meets the strap
    const MZ = E('OUTER_MZ', 0.016), M2Z = E('OUTER_M2Z', 0.006);
    const Es = [Eo, toSide(1.288, MZ), toSide(1.315, M2Z)];
    console.log('outer controls', Es.map((e) => e.map((v) => v.toFixed(3)).join(',')).join(' | '), 'N', N.map((v) => v.toFixed(3)).join(','), 'lastS', lastS.map((v) => v.toFixed(3)).join(','), 'Eo', Eo.map((v) => v.toFixed(3)).join(','));
    // drawn in the SIDE view (height, depth) as one smooth curve, each sample found on her by looking in
    // from the side, so the edge seen from the side is clean by construction; near the top the lateral
    // hit eases into the strap's top point N
    const cr = (p0, p1, p2, p3, t) => p1.map((_, d) => 0.5 * ((2 * p1[d]) + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t * t + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t * t * t));
    const K = [lastS, ...Es, N].map((p) => [p[1], p[2]]);
    const sideCurve = [];
    for (let s = 1; s < K.length - 1; s += 1) { const p0 = K[s - 1], p1 = K[s], p2 = K[s + 1], p3 = K[Math.min(K.length - 1, s + 2)];
      const n = Math.max(6, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.001));
      for (let k = (s === 1 ? 0 : 1); k <= n; k += 1) { const t = k / n, [y, z] = cr(p0, p1, p2, p3, t); let q = toSide(y, z);
        if (s === K.length - 2) { const w = t * t * (3 - 2 * t); const lin = add(scl(Es[Es.length - 1], 1 - t), scl(N, t)); q = add(scl(q, 1 - w), scl(lin, w)); }
        sideCurve.push(q); } }
    const hemPart = resample(spline([W, ...G.slice(1).map((g) => g.p), Eo], { step: 0.0008 }), 0.0015);
    let outer = resample([...hemPart.slice(0, -1), ...sideCurve], 0.0015);
    // round the corner where the hem hands over to the side: a Hermite span across the hand-over,
    // matched in direction and pace to the line on both sides, then laid back onto her below
    { let j = 0, m = Infinity; outer.forEach((p, k) => { const d = len(sub(p, Eo)); if (d < m) { m = d; j = k; } });
      const H = E('CORNER_SPAN', 10), a = j - H, b = j + H;
      if (a > 1 && b < outer.length - 2) { const A = outer[a], B = outer[b], span = b - a;
        const tA = scl(sub(outer[a + 1], outer[a - 1]), span / 2), tB = scl(sub(outer[b + 1], outer[b - 1]), span / 2);
        const mid = []; for (let k = 1; k < span; k += 1) { const t = k / span, t2 = t * t, t3 = t2 * t;
          mid.push(add(add(scl(A, 2 * t3 - 3 * t2 + 1), scl(tA, t3 - 2 * t2 + t)), add(scl(B, -2 * t3 + 3 * t2), scl(tB, t3 - t2)))); }
        outer = [...outer.slice(0, a + 1), ...mid.map((p) => skin.nearest(p)?.q ?? p), ...outer.slice(b)]; } }
    path = [...outer, ...side(N, ctl(N, NW, W), W)];
    globalThis.__Es = Es;
  } else path = [...hem, ...side(Eo, ctl(Eo, NE, N), N), N, ...side(N, ctl(N, NW, W), W)];
  path = resample(path, 0.0015, true);
  // soften the top and lower-inner corners: a short Hermite span across each, matched in direction to
  // the sides it joins (CORNER_R of trim either side), so a corner reads as sewn, not as a point
  { const CR = Math.round(E('CORNER_R', 0.004) / 0.0015), nP = path.length;
    for (const C0 of [N, W]) { let j = 0, md = Infinity; path.forEach((p, k) => { const d = len(sub(p, C0)); if (d < md) { md = d; j = k; } });
      const at = (k) => path[(k + nP) % nP], A = at(j - CR), B = at(j + CR), span = 2 * CR;
      const tA = scl(sub(at(j - CR + 1), at(j - CR - 1)), span / 2), tB = scl(sub(at(j + CR + 1), at(j + CR - 1)), span / 2);
      for (let k = 1; k < span; k += 1) { const t = k / span, t2 = t * t, t3 = t2 * t; const p = add(add(scl(A, 2 * t3 - 3 * t2 + 1), scl(tA, t3 - 2 * t2 + t)), add(scl(B, -2 * t3 + 3 * t2), scl(tB, t3 - t2))); path[(j - CR + k + nP) % nP] = skin.nearest(p)?.q ?? p; } } }
  const near = (p, a, r) => Math.max(0, 1 - len(sub(p, a)) / r);
  const pinOf = path.map((p) => Math.max(near(p, W, 0.005), near(p, N, 0.005), OUTER_SMOOTH ? 0 : near(p, Eo, 0.005)));
  // the HEM bridges her skin's small creases the way fabric does: smoothed hard, then only pushed OUT
  // to clearance where it would touch, never pulled down into a dip. The sides keep hugging.
  let hm = path.map((p) => (p[1] < Math.min(W[1], Eo[1]) + 0.004 ? 1 : 0));
  for (let r = 0; r < 8; r += 1) hm = hm.map((v, i) => (v + hm[(i - 1 + hm.length) % hm.length] + hm[(i + 1) % hm.length]) / 3);
  { const nP = path.length; const HEM_SMOOTH = E('HEM_SMOOTH', 150);
    for (let r = 0; r < HEM_SMOOTH; r += 1) for (const lam of [0.5, -0.53]) path = path.map((v, i) => { const w = hm[i] * (1 - pinOf[i]); if (!w) return v; const m = scl(add(path[(i - 1 + nP) % nP], path[(i + 1) % nP]), 0.5); return add(v, scl(sub(m, v), lam * w)); }); }
  const laid = layOnSurface(path, surface, { clear: CLEAR + THICK / 2, rounds: E('ROUNDS', 25), closed: true, pin: (i) => pinOf[i], hug: (i) => 0.6 * (1 - hm[i]) });
  path = laid.path;
  { const g = path.map((p, i) => (hm[i] > 0.5 ? skin.nearest(p)?.dist ?? 0 : null)).filter((v) => v !== null); console.log(`side ${sg}: hem clearance ${(Math.min(...g) * 1000).toFixed(2)}..${(Math.max(...g) * 1000).toFixed(2)} mm (target ${((CLEAR + THICK / 2) * 1000).toFixed(2)})`); }
  // width: the hem (between W and E along the bottom) wider than the sides
  const hemIdx = path.map((p) => (p[1] < Math.min(W[1], Eo[1]) + 0.004 ? 1 : 0));
  let hw = hemIdx.map(Number); for (let r = 0; r < 12; r += 1) hw = hw.map((v, i) => (v + hw[(i - 1 + hw.length) % hw.length] + hw[(i + 1) % hw.length]) / 3);
  const rib = sweepRibbon(path, laid.normals, { width: (i) => SIDE_W + (HEM_W - SIDE_W) * Math.min(1, hw[i] * 1.5), thickness: THICK, closed: true, seg: 12 });
  const bound = smoothAlong(bind(rib.positions, { at: rib.centres }), { ringSize: rib.ringSize, rings: path.length, closed: true, rounds: E('TRIM_BIND_SMOOTH', 20) });
  addPiece(skin, bound, rib.indices, mat, vertexNormals(bound.pos, rib.indices));
  console.log(`side ${sg}: fold ${G.length} points (y ${Math.min(...G.map((g) => g.p[1])).toFixed(3)}..${Math.max(...G.map((g) => g.p[1])).toFixed(3)}), trim ${(path.reduce((a, p, k) => a + len(sub(p, path[(k + 1) % path.length])), 0) * 100).toFixed(1)} cm, ${rib.positions.length} ribbon vertices`);
  if (OUTER_SMOOTH) { ctrl = [W, ...G.slice(1).map((g) => g.p), ...globalThis.__Es, N, NW]; kinds = ['W', ...G.slice(1).map(() => 'S'), 'E', 'E', 'E', 'N', 'NW']; }
  // the cup's three SNAP points, on the trim's own centre line: every strap ends with its centre here
  const onPath = (a) => { let b = 0, m = Infinity; path.forEach((p, k) => { const q = len(sub(p, a)); if (q < m) { m = q; b = k; } }); return b; };
  const snap = { top: onPath(N), inner: onPath(W) };
  dbg.push({ ctrl, kinds, raw: G.map((g) => g.p), path, tip, Eo, sg, bound, ringSize: rib.ringSize, snap });
  if (!process.env.NO_PAINT) paints.push(paintInside(path, laid.normals, tip));
}
// THE BRIDGE between the cups: the same ribbon, from one cup's inner corner to the other's, across her
// sternum (dropped straight onto her from the front, then held BRIDGE_CLEAR off her: a string spans
// the valley rather than lying in it)
{ const onTrim = (d) => d.path[d.snap.inner];   // the cups' LOWER-INNER snap points
  const [a0, b0] = [onTrim(dbg[0]), onTrim(dbg[1])];
  // a taut string: the straight chord between the two corners, run 2 mm on into each cup's trim so
  // there is no gap, then only pushed OUT to clearance: it lies on her sternum where that bulges and
  // spans the valley where it dips. Its ends ride up onto the trim, one ribbon's thickness higher.
  const a = a0, b = b0;
  let path = resample(Array.from({ length: 81 }, (_, k) => add(a, scl(sub(b, a), k / 80))), 0.0015);
  const nB = path.length;
  // across the valley it is held BRIDGE_CLEAR off her (her skin there is ridged, and a string spans
  // ridges), easing down to the trim's own height over BRIDGE_EASE at each end, so it meets the corner
  // at the trim's level with no step; heavily smoothed so the ease is one curve
  const BC = E('BRIDGE_CLEAR', 0.0016), EASE = E('BRIDGE_EASE', 0.008), base = CLEAR + THICK / 2;
  const ssB = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
  const clrB = (i) => base + (BC - base) * ssB(Math.min(i, nB - 1 - i) * 0.0015 / EASE);
  const laid = layOnSurface(path, surface, { clear: clrB, rounds: 80, hug: 0 });
  // the string's FACE turns as one smooth twist from one corner to the other: the skin under the
  // valley faces left then right, and a ribbon framed by it flips edge-on there and reads as broken
  { const N0 = laid.normals[0], N1 = laid.normals[nB - 1], F = [0, 0, 1];
    laid.normals = laid.normals.map((_, i) => { const t = i / (nB - 1), w = Math.sin(Math.PI * t); return nrm(add(add(scl(N0, (1 - t) * (1 - w)), scl(N1, t * (1 - w))), scl(F, w))); }); }
  const rib = sweepRibbon(laid.path, laid.normals, { width: E('BRIDGE_W', 0.0018), thickness: THICK * 1.4, seg: 12 });
  const bd = smoothAlong(bind(rib.positions, { at: rib.centres }), { ringSize: rib.ringSize, rings: laid.path.length, rounds: E('BRIDGE_BIND_SMOOTH', 600), centres: rib.centres, ends: [laid.path[0], laid.path[laid.path.length - 1]] }); addPiece(skin, bd, rib.indices, mat, vertexNormals(bd.pos, rib.indices));
  console.log(`bridge: ${(laid.path.reduce((s2, p, k) => s2 + (k ? len(sub(p, laid.path[k - 1])) : 0), 0) * 100).toFixed(1)} cm`); }
// THE NECK STRAPS: a ribbon from each cup's TOP CORNER (the trim's own top point, so the two meet)
// up her chest to the neck string, along the route the old connector took, and 8 mm on into the
// string so the hand-over cannot open. Laid like the rest: smoothed, held CLEAR off her where it
// touches, free where it rises off her toward the neck.
if (process.env.HALTER_REBUILD !== '0') {
  const HW = E('HALTER_W', SIDE_W);
  { const J = skin.doc.getRoot().listSkins()[0].listJoints().find((n) => n.getName() === (process.env.NECK_BONE || 'Bone_017')); const m = J.getWorldMatrix();
    globalThis.__collar = measureCollar(skin.P, [m[12], m[13], m[14]], { clear: CLEAR + THICK / 2 });
    globalThis.__knot = globalThis.__collar.collar.find((c) => c.deg === 180).p; }
  for (const d of dbg) {
    const sg = d.sg, top = d.ctrl.find((_, k) => d.kinds[k] === 'N');
    const N0 = d.path[d.snap.top];   // the cup's TOP snap point
    // the string's lower end on this side, and its direction there (centroids of 2 mm height bins)
    const bin = (pts, y0, y1) => { const b = pts.filter((p) => p[1] >= y0 && p[1] < y1); return b.length ? scl(b.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / b.length) : null; };
    // route: the old connector up her chest, then the old cord round her neck (followed as a chain
    // of local centroids in 2.5 degree steps, so the bow's loops beside it are never mistaken for
    // it), ending 10 degrees on inside the bow so the hand-over is buried in it
    const guide = globalThis.__guide.filter((p) => sg * p[0] > 0.02); const G = [];
    const gTop = Math.max(...guide.map((p) => p[1]));
    for (let y = N0[1] + E('HALTER_LEAVE', 0.02); y < gTop - 0.002; y += 0.004) { const c = bin(guide, y, y + 0.004); if (c) G.push(c); }
    const { zc, ang: A0 } = globalThis.__neck, angOf = (p) => sg * Math.atan2(p[0], p[2] - zc) * 180 / Math.PI;
    // round the BASE of her neck, where the game's lanyard lies (collar.mjs is its measurement): the
    // chest route stops below the lanyard's front point, then the collar's points round to the back
    const C = globalThis.__collar, mir = (p) => (sg > 0 ? p : [2 * C.neck.x - p[0], p[1], p[2]]);
    // the collar's control points held no further from her neck's axis than COLLAR_R_MAX: the lanyard's
    // point behind the shoulder sits out on the trapezius (about 10 cm off the axis, where its neighbours
    // are 8), and reaching for it bowed the cord sideways, seen from the front
    const RMAX = E('COLLAR_R_MAX', 0.085), capR = (p) => { const dx = p[0] - C.neck.x, dz = p[2] - C.neck.z, r = Math.hypot(dx, dz); const f = r > RMAX ? RMAX / r : 1; return [C.neck.x + dx * f, p[1], C.neck.z + dz * f]; };
    const cp = C.collar.filter((c) => c.deg > E('COLLAR_FROM', 60) && c.deg < 180).map((c) => mir(capR(c.p)));   // a halter comes up from the side, so the lanyard's front point is skipped
    G.length = 0;   // straight up her chest from the cup to the collar, like a lanyard from its clip
    G.push(...cp, add(globalThis.__knot, [sg * E('KNOT_HALF', 0.004), 0, 0]));
    if (process.env.NECK_DEBUG) console.log('neck', sg, G.length, 'points, last', G[G.length - 1].map((x) => x.toFixed(3)).join(','), 'guide top angle', angOf(G[0]).toFixed(0));
    // start 2.5 mm on inside the corner, so the strap lies over the trim's join and it cannot open
    // leave the corner IN LINE with the cup's tip: the direction out of the corner (from the middle
    // of the trim 2 cm down each side, through the snap point), held for the strap's first centimetre
    const m = d.path.length, kA = (d.snap.top + Math.round(0.02 / 0.0015)) % m, kB = (d.snap.top - Math.round(0.02 / 0.0015) + m) % m;
    const axis = nrm(sub(N0, scl(add(d.path[kA], d.path[kB]), 0.5)));
    const lead = [0.004, 0.008].map((t) => { const p = add(N0, scl(axis, t)); const q = skin.nearest(p); return q && q.dist < CLEAR + THICK / 2 ? add(q.q, scl(q.n, CLEAR + THICK / 2)) : p; });
    const G2 = G.filter((p) => len(sub(p, N0)) > 0.014);
    let path = resample(spline([N0, ...lead, ...G2], { step: 0.001 }), 0.0015);
    const nH = path.length;
    for (let r = 0; r < 60; r += 1) for (const lam of [0.5, -0.53]) path = path.map((v, i) => (i < 2 || i > nH - 4 ? v : add(v, scl(sub(scl(add(path[i - 1], path[i + 1]), 0.5), v), lam))));
    const laid = layOnSurface(path, surface, { clear: CLEAR + THICK / 2, rounds: E('HALTER_ROUNDS', 80), pin: (i) => (i < 2 || i > nH - 4 ? 1 : 0), hug: 0 });
    // its lower end rides up onto the trim, one ribbon's thickness higher, easing down over 5 mm
    const endW = (i) => Math.max(0, 1 - (i * 0.0015) / 0.005);
    // snapped centre-on-centre to the corner, so no lift: it meets the trim at the trim's own height
    const lifted = laid.path.map((p, i) => add(p, scl(laid.normals[i], E('HALTER_END_LIFT', 0) * endW(i))));
    const rib = sweepRibbon(lifted, laid.normals, { width: HW, thickness: THICK, seg: 12 });
    // the strap's first rings move exactly as the trim does at the corner it starts from
    const startM = ringMotion(d.bound, d.ringSize, d.snap.top);
    const bd = smoothAlong(bind(rib.positions, { at: rib.centres }), { ringSize: rib.ringSize, rings: lifted.length, rounds: 120, centres: rib.centres, ends: [lifted[0], lifted[lifted.length - 1]], start: startM });
    addPiece(skin, bd, rib.indices, process.env.NECK_RED ? skin.doc.createMaterial('dbg-neck').setBaseColorFactor([1, 0, 0, 1]) : mat, vertexNormals(bd.pos, rib.indices));
    const gap = len(sub(lifted[0], N0)), Ls = lifted.reduce((a, p, k) => a + (k ? len(sub(p, lifted[k - 1])) : 0), 0);
    console.log(`neck strap ${sg}: ${(Ls * 100).toFixed(1)} cm from the cup's top corner (${(gap * 1000).toFixed(2)} mm off it) round the base of her neck to the bow, ${G.length} route points`);
  }
  // THE BOW, procedural, at the back of the base of her neck where the two cords meet: a short knot
  // band across them, two loops and two tails, all the same 2 mm ribbon, laid on her upper back.
  // Sizes are parameters (BOW_LOOP_W/H, BOW_TAIL), so the Creator can resize it later.
  const K = globalThis.__knot, qK = skin.nearest(K), nK = qK.n;
  let up = sub([0, 1, 0], scl(nK, nK[1])); up = nrm(up); const side = nrm([up[1] * nK[2] - up[2] * nK[1], up[2] * nK[0] - up[0] * nK[2], up[0] * nK[1] - up[1] * nK[0]]);
  const sx = Math.sign(side[0]) || 1, SIDE = scl(side, sx);   // SIDE points to +x
  const LW = E('BOW_LOOP_W', 0.024), LH = E('BOW_LOOP_H', 0.011), TL = E('BOW_TAIL', 0.055);
  const piece = (pts, { width = HW, thick = THICK, closed = false, hug = 0.5, rounds = 30, label }) => {
    let path = resample(closed ? [...pts, pts[0]] : pts, 0.0012, closed); if (closed) path.pop();
    const laid = layOnSurface(path, surface, { clear: CLEAR + thick / 2, rounds, closed, hug });
    const rib = sweepRibbon(laid.path, laid.normals, { width, thickness: thick, closed, seg: 12 });
    const bd = smoothAlong(bind(rib.positions, { at: rib.centres }), { ringSize: rib.ringSize, rings: laid.path.length, closed, rounds: 30, centres: rib.centres, ends: [laid.path[0], laid.path[laid.path.length - 1]] });
    addPiece(skin, bd, rib.indices, mat, vertexNormals(bd.pos, rib.indices));
    console.log(`bow ${label}: ${(laid.path.reduce((a, p, k) => a + (k ? len(sub(p, laid.path[k - 1])) : 0), 0) * 100).toFixed(1)} cm`); };
  for (const s2 of [1, -1]) {
    // a loop: a teardrop out to the side, starting and ending in the knot, drooping a little
    const loop = []; for (let k = 0; k <= 48; k += 1) { const t = (k / 48) * 2 * Math.PI; const x = (LW / 2) * (1 - Math.cos(t)), y = (LH / 2) * Math.sin(t) - 0.15 * x;
      loop.push(add(K, add(scl(SIDE, s2 * x), scl(up, y)))); }
    piece(loop, { closed: true, label: `loop ${s2}` });
    // a tail: down and a little out from the knot, a gentle S, lying on her back
    const tail = []; for (let k = 0; k <= 30; k += 1) { const t = k / 30; tail.push(add(K, add(scl(up, -TL * t), scl(SIDE, s2 * (0.003 + 0.009 * t + 0.002 * Math.sin(Math.PI * 2 * t)))))); }
    piece(tail, { hug: 0.6, label: `tail ${s2}` });
  }
  // the knot: a short band wrapped across the cords, thicker than the ribbon
  piece([add(K, scl(up, 0.0045)), K, add(K, scl(up, -0.0045))], { width: E('KNOT_W', 0.006), thick: THICK * 2.6, hug: 0.3, rounds: 10, label: 'knot' });
}
// THE BACK STRAP: one ribbon from one cup's outer corner, round her back, to the other's. Found by
// looking in at her from outside all the way round her torso at the corners' height (her arms are not
// her torso, so a ray passes through them), then laid on her the same way as the trim: smoothed,
// held CLEAR off her, and allowed to bridge her spine's groove rather than sink into it. Its ends sit
// on top of the cup trim so the two read as one sewn join. Width and height are parameters, so the
// Creator can move and size it later.
if (process.env.NO_BACK !== '1') {
  const BACK_W = E('BACK_W', HEM_W), BACK_RISE = E('BACK_RISE', 0), BACK_DROP = E('BACK_DROP', 0);
  const [dA, dB] = dbg; // sg = 1, then sg = -1
  // the band leaves each cup at its LOWER OUTER corner: the lowest point of the trim's outer part,
  // BACK_UP higher along it so the join sits on the side of the cup and not under it
  const BACK_UP = E('BACK_UP', 0.004);
  const startOf = (d) => { const outer = d.path.filter((p) => d.sg * p[0] > 0.105); const yMin = Math.min(...outer.map((p) => p[1]));
    let best = outer[0], m = Infinity; for (const p of outer) { const q = Math.abs(p[1] - (yMin + BACK_UP)) + (d.sg * p[0] < 0.115 ? 1 : 0) - d.sg * p[0] * 0.01; if (q < m) { m = q; best = p; } } return best; };
  const A = startOf(dA), B = startOf(dB), yMid = (A[1] + B[1]) / 2;
  // her torso's middle at that height: halfway between her spine and her sternum
  let zb = Infinity, zf = -Infinity; for (let i = 0; i < skin.n; i += 1) { const x = skin.P[i * 3], y = skin.P[i * 3 + 1], z = skin.P[i * 3 + 2]; if (Math.abs(y - yMid) > 0.006 || Math.abs(x) > 0.02) continue; zb = Math.min(zb, z); zf = Math.max(zf, z); }
  const zc = (zb + zf) / 2;
  const sgnAt = (p) => { const q = skin.nearest(p); return q ? dot(sub(p, q.q), q.n) : 1; };
  const rayIn = (phi, y) => { const d = [Math.sin(phi), 0, Math.cos(phi)]; let a = 0.4, b = null; for (let k = 0; k < 400; k += 1) { const r = a - 0.001; if (sgnAt([d[0] * r, y, zc + d[2] * r]) < 0) { b = r; break; } a = r; }
    if (b === null) return null; for (let k = 0; k < 14; k += 1) { const m = (a + b) / 2; if (sgnAt([d[0] * m, y, zc + d[2] * m]) < 0) b = m; else a = m; } const r = (a + b) / 2; return [d[0] * r, y, zc + d[2] * r]; };
  const phA = Math.atan2(A[0], A[2] - zc); let phB = Math.atan2(B[0], B[2] - zc); if (phB < phA) phB += Math.PI * 2;
  const pts = [A]; const STEPS = 240;
  for (let k = 1; k < STEPS; k += 1) { const t = k / STEPS, phi = phA + (phB - phA) * t; const y = A[1] + (B[1] - A[1]) * t + BACK_RISE * Math.sin(Math.PI * t) - BACK_DROP; const p = rayIn(phi, y); if (p) pts.push(p); }
  pts.push(B);
  // a band does not hug her ribs at the side: from each cup corner to MID-SIDE (the widest point of
  // her torso at that height) it stands off her by BACK_GAP, opening just past the cup and closing
  // smoothly into her side; from mid-side round her back to the other mid-side it lies on her.
  const BACK_GAP = E('BACK_GAP', 0.002);
  let path = resample(spline(pts, { step: 0.001 }), 0.0015);
  let nQ = path.length, mA = 0, mB = nQ - 1;
  for (let k = 0; k < nQ / 2; k += 1) if (path[k][0] > path[mA][0]) mA = k;      // sg = 1 side: largest x
  for (let k = nQ - 1; k > nQ / 2; k -= 1) if (path[k][0] < path[mB][0]) mB = k; // sg = -1 side: smallest x
  // each side span starts as the STRAIGHT line from the cup corner to mid-side (a taut band), and is
  // only pushed out where her side would bulge into it, never drawn in to her
  { const line = (P, Q) => { const L = len(sub(Q, P)), n = Math.max(2, Math.round(L / 0.0015)); return Array.from({ length: n }, (_, k) => add(P, scl(sub(Q, P), k / n))); };
    const sA = line(A, path[mA]), sB = line(path[mB], B).slice(1);
    path = [...sA, ...path.slice(mA, mB + 1), ...sB, B]; mA = sA.length; mB = sA.length + (mB - mA); nQ = path.length; }
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const gapAt = (i) => { const prof = (t) => BACK_GAP * ss(0, 0.2, t) * (1 - ss(0.55, 1, t)); if (i <= mA) return prof(i / mA); if (i >= mB) return prof((nQ - 1 - i) / (nQ - 1 - mB)); return 0; };
  const freeA = path.slice(0, mA).reduce((a, p, k) => a + len(sub(path[k + 1], p)), 0), freeB = path.slice(mB, -1).reduce((a, p, k) => a + len(sub(path[mB + k + 1], p)), 0);
  console.log(`back strap: cup to mid-side ${(freeA * 100).toFixed(1)} / ${(freeB * 100).toFixed(1)} cm standing off her (up to ${(BACK_GAP * 1000).toFixed(1)} mm), then on her round the back`);
  const nP = path.length, endR = 0.006, endW = (i) => { const sA = i * 0.0015, sB = (nP - 1 - i) * 0.0015; return Math.max(0, 1 - Math.min(sA, sB) / endR); };
  // smoothed hard and only pushed out, like the hem: a band spans the small dips of her side and spine
  for (let r = 0; r < E('BACK_SMOOTH', 300); r += 1) for (const lam of [0.5, -0.53]) path = path.map((v, i) => (i < 2 || i > nP - 3 ? v : add(v, scl(sub(scl(add(path[i - 1], path[i + 1]), 0.5), v), lam))));
  const laid = layOnSurface(path, surface, { clear: (i) => CLEAR + THICK / 2 + gapAt(i), rounds: 40, pin: (i) => (i < 2 || i > nP - 3 ? 1 : 0), hug: 0 });
  // the ends ride up onto the trim (one ribbon's thickness higher), easing back down over 6 mm
  const lifted = laid.path.map((p, i) => add(p, scl(laid.normals[i], THICK * 1.1 * endW(i))));
  if (process.env.BACK_DUMP) { const fs = await import('node:fs'); const yS = yMid; const sk = []; for (let i = 0; i < skin.n; i += 1) if (Math.abs(skin.P[i * 3 + 1] - yS) < 0.002) sk.push([skin.P[i * 3], skin.P[i * 3 + 2]]); fs.writeFileSync(process.env.BACK_DUMP, JSON.stringify({ skin: sk, strap: lifted.map((p) => [p[0], p[2], p[1]]), mA, mB })); }
  const rib = sweepRibbon(lifted, laid.normals, { width: BACK_W, thickness: THICK, seg: 12 });
  const bd = smoothAlong(bind(rib.positions, { at: rib.centres }), { ringSize: rib.ringSize, rings: lifted.length, rounds: E('BACK_BIND_SMOOTH', 200), centres: rib.centres, ends: [lifted[0], lifted[lifted.length - 1]] }); addPiece(skin, bd, rib.indices, mat, vertexNormals(bd.pos, rib.indices));
  let lenM = 0; for (let k = 1; k < lifted.length; k += 1) lenM += len(sub(lifted[k], lifted[k - 1]));
  const gaps = laid.path.map((p) => skin.nearest(p)?.dist ?? 0); const sideG = gaps.filter((_, i) => gapAt(i) > BACK_GAP * 0.9); if (sideG.length) console.log(`back strap: side spans ${(Math.min(...sideG) * 1000).toFixed(2)}..${(Math.max(...sideG) * 1000).toFixed(2)} mm off her`);
  console.log(`back strap: ${(lenM * 100).toFixed(1)} cm, ${pts.length} ray hits, torso centre z ${zc.toFixed(3)}, clearance ${(Math.min(...gaps) * 1000).toFixed(2)}..${(Math.max(...gaps) * 1000).toFixed(2)} mm`);
}
// diagnostics: anchors as coloured beads, the raw fold as small dots, all bound to her skin
if (DEBUG) {
  const COL = { W: [0.1, 0.4, 1], E: [1, 0.5, 0], N: [1, 0, 0.6], NE: [1, 0.8, 0], NW: [0.2, 0.9, 0.9], SE: [0.6, 0.2, 1], S: [0.1, 0.85, 0.2], raw: [1, 1, 1], tip: [1, 0, 0] };
  const mats = {}; const m = (k) => mats[k] ?? (mats[k] = skin.doc.createMaterial('dbg-' + k).setBaseColorFactor([...COL[k], 1]).setRoughnessFactor(0.6));
  const sphere = (c, r) => { const pos = [], idx = []; const S = 10; for (let a = 0; a <= S; a += 1) for (let b = 0; b <= S; b += 1) { const th = (a / S) * Math.PI, ph = (b / S) * 2 * Math.PI; pos.push(add(c, [r * Math.sin(th) * Math.cos(ph), r * Math.cos(th), r * Math.sin(th) * Math.sin(ph)])); } for (let a = 0; a < S; a += 1) for (let b = 0; b < S; b += 1) { const i = a * (S + 1) + b; idx.push(i, i + S + 1, i + 1, i + 1, i + S + 1, i + S + 2); } return { pos, idx }; };
  for (const d of dbg) {
    const put = (k, c, r) => { const s = sphere(c, r); const bd = bind(s.pos, { at: s.pos.map(() => c) }); addPiece(skin, bd, s.idx, m(k), vertexNormals(bd.pos, s.idx)); };
    d.ctrl.forEach((c, k) => { const q = skin.nearest(c); put(d.kinds[k], q ? add(q.q, scl(q.n, 0.003)) : c, d.kinds[k] === 'S' ? 0.0025 : 0.0035); }); { const q = skin.nearest(d.tip); put('tip', add(q.q, scl(q.n, 0.003)), 0.0025); }
  }
}
if (paints.length) {
  // copies of her skin, in her own local space, cut along g = 0
  const raw = skin.body.getAttribute('POSITION'), rawN = skin.body.getAttribute('NORMAL'), ntg = skin.tgtLocal.length, v = [];
  const LP = (i) => { raw.getElement(i, v); return v.slice(0, 3); }, LN = (i) => { rawN.getElement(i, v); return v.slice(0, 3); };
  const pos = [], nor = [], J = [], W = [], T = Array.from({ length: ntg }, () => []), idx = [], map = new Map(), lift = PAINT_LIFT / skin.tS;
  // every paint vertex is a point on one of her triangles (a, b, c) at barycentric w: its position,
  // normal and shapes are interpolated there, its bone weights taken from the nearest corner
  const vert = (tri, w) => { const key = tri.join(',') + ':' + w.map((x) => x.toFixed(5)).join(','); if (map.has(key)) return map.get(key);
    const ps = tri.map(LP), ns = tri.map(LN); let p = [0, 0, 0], nn = [0, 0, 0]; for (let k = 0; k < 3; k += 1) for (let e = 0; e < 3; e += 1) { p[e] += ps[k][e] * w[k]; nn[e] += ns[k][e] * w[k]; }
    const l = Math.hypot(...nn) || 1; nn = nn.map((x) => x / l); pos.push(...p.map((x, k) => x + nn[k] * lift)); nor.push(...nn);
    const src = tri[w.indexOf(Math.max(...w))]; for (let c = 0; c < 4; c += 1) { J.push(skin.BJ[src * 4 + c]); W.push(skin.BW[src * 4 + c]); }
    for (let k = 0; k < ntg; k += 1) { const d = skin.tgtLocal[k]; for (let e = 0; e < 3; e += 1) T[k].push(w[0] * d[tri[0] * 3 + e] + w[1] * d[tri[1] * 3 + e] + w[2] * d[tri[2] * 3 + e]); }
    const id = pos.length / 3 - 1; map.set(key, id); return id; };
  const M = (i) => [skin.P[i * 3], skin.P[i * 3 + 1], skin.P[i * 3 + 2]];
  for (const { tris, g, gAt } of paints) for (const tri of tris) {
    const near = tri.some((i) => g.get(i) < 0.004) && !tri.every((i) => g.get(i) > 0.004), S = near ? 6 : 1;   // near the trim: 36 sub-triangles
    const pm = tri.map(M), at = (w) => [0, 1, 2].map((e) => w[0] * pm[0][e] + w[1] * pm[1][e] + w[2] * pm[2][e]);
    const gw = new Map(), G = (w) => { const k = w.join(','); if (!gw.has(k)) gw.set(k, S === 1 ? w[0] * g.get(tri[0]) + w[1] * g.get(tri[1]) + w[2] * g.get(tri[2]) : gAt(at(w))); return gw.get(k); };
    const sub3 = []; for (let i = 0; i < S; i += 1) for (let j = 0; j < S - i; j += 1) { const A = [i, j], B = [i + 1, j], Cc = [i, j + 1], D = [i + 1, j + 1]; const bw = ([u, v]) => [1 - (u + v) / S, u / S, v / S].map((x) => Math.round(x * 1e6) / 1e6); sub3.push([bw(A), bw(B), bw(Cc)]); if (i + j < S - 1) sub3.push([bw(B), bw(D), bw(Cc)]); }
    for (const sw of sub3) { const gv = sw.map(G), sgn = gv.map((x) => x > 0), cnt = sgn.filter(Boolean).length; if (!cnt) continue;
      if (cnt === 3) { idx.push(...sw.map((w) => vert(tri, w))); continue; }
      const mid = (wa, wb, ga, gb) => { const t = ga / (ga - gb); return wa.map((x, e) => x + (wb[e] - x) * t); };
      for (let k = 0; k < 3; k += 1) { const a = sw[k], b = sw[(k + 1) % 3], c = sw[(k + 2) % 3], ga = gv[k], gb = gv[(k + 1) % 3], gc = gv[(k + 2) % 3];
        if (cnt === 1 && sgn[k]) { idx.push(vert(tri, a), vert(tri, mid(a, b, ga, gb)), vert(tri, mid(a, c, ga, gc))); break; }
        if (cnt === 2 && !sgn[k]) { const ab = vert(tri, mid(b, a, gb, ga)), ac = vert(tri, mid(c, a, gc, ga)); idx.push(ab, vert(tri, b), vert(tri, c), ab, vert(tri, c), ac); break; } } } }
  const buf = skin.doc.getRoot().listBuffers()[0], acc = (type, a) => skin.doc.createAccessor().setType(type).setArray(a).setBuffer(buf);
  const pmat = mat.clone().setName('bikini');
  const prim = skin.doc.createPrimitive().setMaterial(pmat).setIndices(acc('SCALAR', Uint32Array.from(idx))).setAttribute('POSITION', acc('VEC3', Float32Array.from(pos))).setAttribute('NORMAL', acc('VEC3', Float32Array.from(nor))).setAttribute('JOINTS_0', acc('VEC4', Uint16Array.from(J))).setAttribute('WEIGHTS_0', acc('VEC4', Float32Array.from(W)));
  for (const t of T) prim.addTarget(skin.doc.createPrimitiveTarget().setAttribute('POSITION', acc('VEC3', Float32Array.from(t))));
  skin.mesh.addPrimitive(prim);
  console.log(`paint: ${pos.length / 3} vertices, ${idx.length / 3} triangles of her own skin`);
}
await skin.io.write(OUT, skin.doc);
console.log('written', OUT);
