/**
 * SARAH v2's BIKINI, FINISHED (Joshua, 2026-10-15, on the renders: "long green fabric/strap
 * pieces extending outward beside Sarah's belly and hips... pointed or smeared-looking
 * geometry extending backward from the outer edges of the breast cups... the neck and
 * shoulder straps look slightly angular or detached... consider a smooth spline or
 * curve-based strap system").
 *
 * Runs on the file `sarahV2Bikini.mjs` fits (with its part tags kept), and changes only the
 * bikini primitive. What was wrong, measured on the fitted bind body:
 *
 *  1. THE SIDE TIES: the fitter bound each piece of fabric to the nearest skin, and a
 *     hanging arm passes a few centimetres from her hip: 1,467 bikini vertices, a side tie's
 *     front string among them, rode her FOREARM, so every stride swung them out beside her
 *     bump like rods. Nothing of the bikini is bound to skin that is mostly arm now; those
 *     vertices are bound again to her body under them. Each tie's bow is also laid against
 *     her hip (its height off the skin eased to at most `TIE_REACH_M`), so the knot keeps
 *     its relief without standing off her.
 *  2. THE CUPS' OUTER CORNERS: the modelled triangle reaches past her breast onto the side
 *     of her ribs, where nothing grows with the breast; when the breast grew, droop tipped
 *     it or spacing moved it, that corner stayed behind and stretched into a sliver toward
 *     her armpit. Each cup vertex on her outer side whose skin is not breast (by how much
 *     `breastGrow` moves it) is drawn in toward the tip until it is, and laid back on her
 *     at its own clearance; the bridge between the cups is not touched.
 *  3. THE HALTER STRAPS are rebuilt: each is a taut string from the cup's apex to the
 *     knot at her nape, solved over her skin (`STRAP_ITERS` rounds of easing toward a
 *     straight line, then held `STRAP_CLEAR_M` off any skin it crosses), so it follows her
 *     shoulder and collarbone with a strap's tension instead of the scan's every wobble,
 *     then swept as a flat band `STRAP_W_M` wide and `STRAP_T_M` thick. Every ring of it is
 *     bound to the skin under it, like all the fabric, so it follows breast size, position,
 *     spacing, droop and every pose.
 *
 * Whatever moved is bound again: the skin's bone weights and every shape at the point under
 * it, the clearance carried along the skin normal's turn in each shape. The body is not
 * touched.
 *
 *   node scripts/sarahV2BikiniFinish.mjs <fitted.glb> [out.glb]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { closestBary, vertexNormals } from './fitMeshyBikini.mjs';

export const TIE_REACH_M = 0.011;
export const CUP_ON_BREAST = 0.65;
export const STRAP_W_M = 0.0065;
export const STRAP_T_M = 0.0018;
export const STRAP_CLEAR_M = 0.0035;
export const STRAP_STEP_M = 0.004;
export const STRAP_ITERS = 400, STRAP_KEEP_BEHIND_M = 0.03, STRAP_CUP_BLEND_M = 0.05;

const mul = (x, y) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) o[c * 4 + r] += x[k * 4 + r] * y[c * 4 + k]; return o; };
const invert = (m) => {
  const [a, b, c, , d, e, f, , g, h, i] = m, det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const r = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, 0, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, 0, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det, 0, 0, 0, 0, 1];
  r[12] = -(r[0] * m[12] + r[4] * m[13] + r[8] * m[14]); r[13] = -(r[1] * m[12] + r[5] * m[13] + r[9] * m[14]); r[14] = -(r[2] * m[12] + r[6] * m[13] + r[10] * m[14]);
  return r;
};
const apply = (m, v, w) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + w * m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + w * m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + w * m[14]];
const read = (A) => { const n = A.getCount(), s = A.getElementSize(), out = new Float32Array(n * s), v = []; for (let i = 0; i < n; i += 1) { A.getElement(i, v); for (let c = 0; c < s; c += 1) out[i * s + c] = v[c]; } return out; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]), nrmz = (a) => { const l = len(a) || 1; return scl(a, 1 / l); }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export async function sarahV2BikiniFinish(src, dst = src, { log = console.log } = {}) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(src), skin = doc.getRoot().listSkins()[0], joints = skin.listJoints();
  const T = mul(Array.from(joints[0].getWorldMatrix()), Array.from(skin.getInverseBindMatrices().getArray().slice(0, 16))), Ti = invert(T), tS = Math.hypot(T[0], T[1], T[2]);
  const mesh = doc.getRoot().listMeshes()[0], names = mesh.getExtras().targetNames;
  const body = mesh.listPrimitives()[0], kini = mesh.listPrimitives().find((p) => p.getMaterial()?.getName() === 'bikini' && p.getAttribute('_TAG'));
  if (!kini) throw new Error('no tagged bikini (fit it with keepTags)');

  // ── her skin in metres ──
  const bRaw = read(body.getAttribute('POSITION')), bn = bRaw.length / 3, bPos = new Float32Array(bRaw.length);
  for (let i = 0; i < bn; i += 1) bPos.set(apply(T, [bRaw[i * 3], bRaw[i * 3 + 1], bRaw[i * 3 + 2]], 1), i * 3);
  const bIdx = body.getIndices().getArray(), bNrm = vertexNormals(bPos, bIdx);
  const bJ = read(body.getAttribute('JOINTS_0')), bW = read(body.getAttribute('WEIGHTS_0'));
  const bT = body.listTargets().map((t) => { const d = read(t.getAttribute('POSITION')); for (let i = 0; i < bn; i += 1) d.set(apply(T, [d[i * 3], d[i * 3 + 1], d[i * 3 + 2]], 0), i * 3); return d; });
  const bTN = body.listTargets().map((t) => { const A = t.getAttribute('NORMAL'); if (!A) return null; const d = read(A); for (let i = 0; i < bn; i += 1) d.set(apply(T, [d[i * 3], d[i * 3 + 1], d[i * 3 + 2]], 0).map((v) => v / tS), i * 3); return d; });
  const grow = bT[names.indexOf('breastGrow')], growMax = (() => { let m = 0; for (let i = 0; i < bn; i += 1) m = Math.max(m, Math.hypot(grow[i * 3], grow[i * 3 + 1], grow[i * 3 + 2])); return m; })();
  const CELL = 0.02, triCells = new Map();
  for (let t = 0; t < bIdx.length; t += 3) {
    const a = bIdx[t] * 3, b = bIdx[t + 1] * 3, c = bIdx[t + 2] * 3;
    const lo = [0, 1, 2].map((k) => Math.min(bPos[a + k], bPos[b + k], bPos[c + k])), hi = [0, 1, 2].map((k) => Math.max(bPos[a + k], bPos[b + k], bPos[c + k]));
    for (let x = Math.floor(lo[0] / CELL); x <= Math.floor(hi[0] / CELL); x += 1) for (let y = Math.floor(lo[1] / CELL); y <= Math.floor(hi[1] / CELL); y += 1) for (let z = Math.floor(lo[2] / CELL); z <= Math.floor(hi[2] / CELL); z += 1) { const k = `${x},${y},${z}`; if (!triCells.has(k)) triCells.set(k, []); triCells.get(k).push(t); }
  }
  const BP = (i) => [bPos[i * 3], bPos[i * 3 + 1], bPos[i * 3 + 2]];
  // HER ARMS ARE NOT UNDER THE BIKINI: a hanging arm passes a few centimetres from her hip
  // and the side of her breast, and fabric bound to it swung out with every stride (the
  // "rods" by her hips in the walk were a side tie riding her forearm). No bikini point is
  // bound to skin that is mostly arm.
  const jw = joints.map((j) => j.getWorldTranslation());
  const armJ = new Set(joints.map((_, k) => k).filter((k) => Math.abs(jw[k][0]) > 0.13 && jw[k][1] > 0.6));
  const armShare = (i) => { let a = 0; for (let c = 0; c < 4; c += 1) if (armJ.has(bJ[i * 4 + c])) a += bW[i * 4 + c]; return a; };
  const armTri = new Uint8Array(bIdx.length / 3); for (let t = 0; t < bIdx.length; t += 3) armTri[t / 3] = armShare(bIdx[t]) + armShare(bIdx[t + 1]) + armShare(bIdx[t + 2]) > 1.5 ? 1 : 0;
  const nearest = (p) => {
    let best = null;
    for (let r = 0; r <= 8; r += 1) {
      if (best && Math.sqrt(best.d2) <= r * CELL) break;
      const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL), cz = Math.floor(p[2] / CELL);
      for (let i = -r; i <= r; i += 1) for (let j = -r; j <= r; j += 1) for (let k = -r; k <= r; k += 1) {
        if (Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) !== r) continue;
        for (const t of triCells.get(`${cx + i},${cy + j},${cz + k}`) ?? []) {
          const ia = bIdx[t], ib = bIdx[t + 1], ic = bIdx[t + 2];
          if (armTri[t / 3]) continue;
          const bc = closestBary(p, BP(ia), BP(ib), BP(ic)), q = [0, 1, 2].map((d) => bc[0] * bPos[ia * 3 + d] + bc[1] * bPos[ib * 3 + d] + bc[2] * bPos[ic * 3 + d]);
          const d2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
          if (!best || d2 < best.d2) best = { d2, tri: [ia, ib, ic], bc, q };
        }
      }
    }
    if (!best) return null;
    const n = nrmz([0, 1, 2].map((d) => best.bc[0] * bNrm[best.tri[0] * 3 + d] + best.bc[1] * bNrm[best.tri[1] * 3 + d] + best.bc[2] * bNrm[best.tri[2] * 3 + d]));
    const s = dot(sub(p, best.q), n);
    return { ...best, n, dist: Math.sign(s || 1) * Math.sqrt(best.d2) };
  };
  const breastness = (b) => b.bc.reduce((a, w, k) => a + w * Math.hypot(grow[b.tri[k] * 3], grow[b.tri[k] * 3 + 1], grow[b.tri[k] * 3 + 2]), 0) / growMax;
  // ── the bikini, in metres ──
  const kRaw = read(kini.getAttribute('POSITION')), kn = kRaw.length / 3, kPos = new Float32Array(kRaw.length);
  for (let i = 0; i < kn; i += 1) kPos.set(apply(T, [kRaw[i * 3], kRaw[i * 3 + 1], kRaw[i * 3 + 2]], 1), i * 3);
  const tag = read(kini.getAttribute('_TAG')), kJ = read(kini.getAttribute('JOINTS_0')), kW = read(kini.getAttribute('WEIGHTS_0'));
  const kT = kini.listTargets().map((t) => read(t.getAttribute('POSITION')));
  let kIdx = Array.from(kini.getIndices().getArray());
  const KP = (i) => [kPos[i * 3], kPos[i * 3 + 1], kPos[i * 3 + 2]];
  const rebind = new Map(); // vertex -> its new skin point (bound again at the end)

  let offArm = 0;
  for (let i = 0; i < kn; i += 1) { let a = 0; for (let c = 0; c < 4; c += 1) if (armJ.has(kJ[i * 4 + c])) a += kW[i * 4 + c]; if (a > 0.02) { rebind.set(i, { tie: tag[i] === 1 }); offArm += 1; } }
  log(`finish: arm joints ${[...armJ].length}; ${offArm} bikini vertices were bound to an arm and are bound again to her body`);

  // 1. the ties, against her hip
  let laid = 0;
  for (let i = 0; i < kn; i += 1) {
    if (tag[i] !== 1) continue;
    const q = nearest(KP(i)); if (!q) continue;
    const d = Math.max(0, q.dist), d1 = TIE_REACH_M * (1 - Math.exp(-d / TIE_REACH_M));
    if (d - d1 > 0.0005) { kPos.set(add(q.q, scl(q.n, d1)), i * 3); laid += 1; }
    rebind.set(i, { tie: true });
  }
  log(`finish: ${laid} side-tie vertices laid against her hip (at most ${TIE_REACH_M * 1000} mm off her)`);

  // 2. the cups' outer corners, onto her breast
  const tips = [1, -1].map((sg) => { let t = null; for (let i = 0; i < bn; i += 1) { const x = sg * bPos[i * 3], y = bPos[i * 3 + 1], z = bPos[i * 3 + 2]; if (x > 0.06 && x < 0.15 && y > 1.21 && y < 1.36 && (!t || z > t[2])) t = BP(i); } return t; });
  let drawn = 0;
  for (let i = 0; i < kn; i += 1) {
    if (tag[i] !== 2) continue;
    const p = KP(i), tip = tips[p[0] >= 0 ? 0 : 1];
    if (Math.abs(p[0]) < Math.abs(tip[0])) continue; // her inner side and the bridge: untouched
    let q = nearest(p); if (!q || breastness(q) >= CUP_ON_BREAST) continue;
    const off = Math.max(0.002, q.dist);
    let cur = p;
    for (let s = 0; s < 40 && breastness(q) < CUP_ON_BREAST; s += 1) {
      const toward = sub(tip, cur); const l = len(toward); if (l < 0.004) break; // in 3D: round her side and forward onto the breast
      cur = add(cur, scl(toward, 0.003 / l)); q = nearest(cur); if (!q) break;
      cur = add(q.q, scl(q.n, off));
    }
    kPos.set(cur, i * 3); rebind.set(i, {}); drawn += 1;
  }
  log(`finish: ${drawn} cup vertices off her breast drawn back onto it`);
  if (process.env.FINISH_DEBUG) { let longT = 0; const vs = new Set(); for (let t = 0; t < kIdx.length; t += 3) { const a = kIdx[t], b = kIdx[t + 1], c = kIdx[t + 2]; if (tag[a] !== 2) continue; const e = Math.max(len(sub(KP(a), KP(b))), len(sub(KP(b), KP(c))), len(sub(KP(c), KP(a)))); if (e > 0.012) { longT += 1; vs.add(a); vs.add(b); vs.add(c); } } log(`debug: ${longT} cup triangles with an edge over 12 mm`); const ex = [...vs].slice(0, 12).map((i) => { const q = nearest(KP(i)); return KP(i).map((v) => v.toFixed(3)).join(',') + ' b' + breastness(q).toFixed(2) + ' d' + (q.dist * 1000).toFixed(0); }); log(ex.join(' | ')); }
  if (process.env.FINISH_DEBUG) { const h = new Map(); for (let i = 0; i < kn; i += 1) { if (tag[i] !== 2 || Math.abs(kPos[i * 3]) < 0.11) continue; const q = nearest(KP(i)); const b = Math.round(breastness(q) * 10) / 10; const k = `${b}`; const e = h.get(k) ?? [0, 9, -9]; e[0] += 1; e[1] = Math.min(e[1], kPos[i * 3 + 2]); e[2] = Math.max(e[2], kPos[i * 3 + 2]); h.set(k, e); } log([...h].sort().map(([k, e]) => `b${k}: ${e[0]} z ${e[1].toFixed(3)}..${e[2].toFixed(3)}`).join(' | ')); }

  // 3. the halter straps, rebuilt as taut bands
  const strapTris = new Set(), straps = [];
  const knot = (() => { const a = [0, 0, 0]; let k = 0; for (let i = 0; i < kn; i += 1) if (tag[i] === 4) { for (let d = 0; d < 3; d += 1) a[d] += kPos[i * 3 + d]; k += 1; } return scl(a, 1 / k); })();
  // Only the run from the cup over her shoulder is rebuilt. Behind her neck the scan's strap
  // becomes the bow's loops and tails, which hang from the knot and are kept exactly as modelled;
  // the new band ends where the kept strap begins.
  const zCut = knot[2] + STRAP_KEEP_BEHIND_M, rebuilt = (i) => tag[i] === 3 && kPos[i * 3 + 2] >= zCut;
  for (let t = 0; t < kIdx.length; t += 3) if (rebuilt(kIdx[t]) || rebuilt(kIdx[t + 1]) || rebuilt(kIdx[t + 2])) strapTris.add(t);
  log(`finish: the halter's knot at ${knot.map((v) => v.toFixed(3)).join(', ')}; strap behind z ${zCut.toFixed(3)} kept as modelled`);
  for (const sg of [1, -1]) {
    const vs = []; for (let i = 0; i < kn; i += 1) if (rebuilt(i) && Math.sign(kPos[i * 3] || 1) === sg) vs.push(i);
    if (!vs.length) continue;
    // its two ends: where it leaves the cup (lowest) and where it reaches the knot (farthest from that)
    let lo = vs[0]; for (const i of vs) if (kPos[i * 3 + 1] < kPos[lo * 3 + 1]) lo = i;
    // ...and where it hands over to the kept strap behind her neck: its rearmost vertex
    let far = vs[0]; for (const i of vs) if (kPos[i * 3 + 2] < kPos[far * 3 + 2]) far = i;
    const mean = (c) => { const a = [0, 0, 0]; let k = 0; for (const i of vs) if (len(sub(KP(i), KP(c))) < 0.008) { for (let d = 0; d < 3; d += 1) a[d] += kPos[i * 3 + d]; k += 1; } return scl(a, 1 / k); };
    // the band runs on into the kept string where the scan's strap handed over to it, so the two
    // overlap and no seam opens: its end is the middle of the kept string within 12 mm of that point
    const kept = []; for (let i = 0; i < kn; i += 1) if ((tag[i] === 3 || tag[i] === 4) && !rebuilt(i) && len(sub(KP(i), KP(far))) < 0.012) kept.push(i);
    log(`finish: ${kept.length} kept strap vertices to overlap`);
    const E = kept.length ? scl(kept.reduce((a, i) => add(a, KP(i)), [0, 0, 0]), 1 / kept.length) : mean(far);
    // it starts AT the cup's tip, the cup vertex nearest the scan's strap end, and rides with it
    let tipV = -1; { const s0 = mean(lo); for (let i = 0; i < kn; i += 1) if (tag[i] === 2 && Math.sign(kPos[i * 3] || 1) === sg && (tipV < 0 || len(sub(KP(i), s0)) < len(sub(KP(tipV), s0)))) tipV = i; }
    const S = KP(tipV), chord = sub(E, S), L = len(chord), u = scl(chord, 1 / L);
    // the scan's own path, as a start: its vertices averaged in bins along the chord
    const BINS = 24, acc = Array.from({ length: BINS }, () => [0, 0, 0, 0]);
    for (const i of vs) { const t = dot(sub(KP(i), S), u) / L; if (t < 0 || t > 1) continue; const b = Math.min(BINS - 1, Math.floor(t * BINS)); for (let d = 0; d < 3; d += 1) acc[b][d] += kPos[i * 3 + d]; acc[b][3] += 1; }
    const guide = [S, ...acc.filter((a) => a[3]).map((a) => scl(a, 1 / a[3])), E];
    // resampled at an even step
    const resample = (pts, step) => { const out = [pts[0]]; let carry = 0; for (let k = 1; k < pts.length; k += 1) { const a = pts[k - 1], b = pts[k], seg = len(sub(b, a)); let t = step - carry; while (t <= seg) { out.push(add(a, scl(sub(b, a), t / seg))); t += step; } carry = seg - (t - step); } out.push(pts[pts.length - 1]); return out; };
    let path = resample(guide, STRAP_STEP_M);
    const clear = STRAP_CLEAR_M + STRAP_T_M / 2;
    for (let it = 0; it < STRAP_ITERS; it += 1) {
      const nx = path.map((p) => p.slice());
      for (let k = 1; k < path.length - 1; k += 1) nx[k] = add(scl(path[k], 0.5), scl(add(path[k - 1], path[k + 1]), 0.25));
      // the far end too (the kept string can sit close on her neck); the cup end stays on the cup
      for (let k = 1; k < nx.length; k += 1) { const q = nearest(nx[k]); if (q && q.dist < clear) nx[k] = add(q.q, scl(q.n, clear)); }
      path = nx;
      if (it % 50 === 49) path = resample(path, STRAP_STEP_M);
    }
    straps.push({ sg, path, S, E, lo: tipV });
    log(`finish: ${sg > 0 ? 'left' : 'right'} strap ${(L * 100).toFixed(1)} cm chord, ${path.length} rings, ${(path.reduce((a, p, k) => a + (k ? len(sub(p, path[k - 1])) : 0), 0) * 100).toFixed(1)} cm along her`);
  }
  // the old straps go
  kIdx = kIdx.filter((_, j) => !strapTris.has(j - (j % 3)));

  // the new bands: an elliptical section, its flat side on her
  const SEG = 8, newPos = [], newRing = [];
  for (const st of straps) {
    const { path } = st; const base = kn + newPos.length; st.base = base;
    path.forEach((p, k) => {
      const t = nrmz(sub(path[Math.min(path.length - 1, k + 1)], path[Math.max(0, k - 1)])), q = nearest(p), n0 = q ? q.n : [0, 0, 1];
      const b = nrmz(cross(t, n0)), n = nrmz(cross(b, t));
      const toEnd = (path.length - 1 - k) * STRAP_STEP_M, fromCup = k * STRAP_STEP_M, w = STRAP_W_M * Math.min(toEnd >= 0.02 ? 1 : 0.6 + 0.4 * (toEnd / 0.02), fromCup >= 0.015 ? 1 : 0.7 + 0.3 * (fromCup / 0.015));
      for (let s = 0; s < SEG; s += 1) { const a = (s / SEG) * Math.PI * 2; newPos.push(add(p, add(scl(b, Math.cos(a) * w / 2), scl(n, Math.sin(a) * STRAP_T_M / 2)))); newRing.push(p); }
    });
    for (let k = 0; k < path.length - 1; k += 1) for (let s = 0; s < SEG; s += 1) {
      const a = base + k * SEG + s, b = base + k * SEG + ((s + 1) % SEG), c = a + SEG, d = b + SEG;
      kIdx.push(a, c, b, b, c, d);
    }
  }
  const N = kn + newPos.length, pos = new Float32Array(N * 3); pos.set(kPos); newPos.forEach((p, j) => pos.set(p, (kn + j) * 3));
  const J = new Uint16Array(N * 4), Wt = new Float32Array(N * 4); J.set(kJ); Wt.set(kW);
  const D = kT.map((d) => { const o = new Float32Array(N * 3); o.set(d); return o; });

  // bound again: everything moved, and the new bands (each ring at the skin under its centre)
  const bindAt = (v, p, ring) => {
    const q = nearest(ring ?? p); if (!q) return;
    const accW = new Map();
    for (let k = 0; k < 3; k += 1) for (let c = 0; c < 4; c += 1) { const j = bJ[q.tri[k] * 4 + c]; const w = bW[q.tri[k] * 4 + c] * q.bc[k]; if (!(w > 0)) continue; accW.set(j, (accW.get(j) || 0) + w); }
    const top = [...accW].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((a, [, w]) => a + w, 0);
    for (let c = 0; c < 4; c += 1) { J[v * 4 + c] = top[c] ? top[c][0] : 0; Wt[v * 4 + c] = top[c] ? top[c][1] / sum : 0; }
    const off = Math.max(0, dot(sub(p, q.q), q.n));
    D.forEach((d, t) => {
      const dt = bT[t], dn = bTN[t]; const o = [0, 0, 0];
      for (let k = 0; k < 3; k += 1) for (let e = 0; e < 3; e += 1) o[e] += q.bc[k] * (dt[q.tri[k] * 3 + e] + (dn ? off * dn[q.tri[k] * 3 + e] : 0));
      d.set(apply(Ti, o, 0), v * 3);
    });
  };
  for (const v of rebind.keys()) bindAt(v, KP(v), null);
  newPos.forEach((p, j) => bindAt(kn + j, p, newRing[j]));
  // Where it leaves the cup, a band rides with the cup, not with the chest under it: the cup is
  // carried forward and down as her breast grows, and a band bound only to her chest would stay
  // behind and open a gap. Over its first STRAP_CUP_BLEND_M its morphs ease from the cup's own
  // (the scan's strap vertex where it met the cup) to her skin's.
  let blended = 0;
  for (const { path, base, lo } of straps) for (let k = 0; k < path.length; k += 1) {
    const along = k * STRAP_STEP_M; if (along >= STRAP_CUP_BLEND_M) break;
    const x = along / STRAP_CUP_BLEND_M, w = 1 - x * x * (3 - 2 * x);
    for (let s2 = 0; s2 < SEG; s2 += 1) {
      const v = base + k * SEG + s2, m = new Map();
      for (let c = 0; c < 4; c += 1) { m.set(kJ[lo * 4 + c], (m.get(kJ[lo * 4 + c]) || 0) + w * kW[lo * 4 + c]); m.set(J[v * 4 + c], (m.get(J[v * 4 + c]) || 0) + (1 - w) * Wt[v * 4 + c]); }
      const top = [...m].filter(([, x]) => x > 0).sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((a, [, x]) => a + x, 0);
      for (let c = 0; c < 4; c += 1) { J[v * 4 + c] = top[c] ? top[c][0] : 0; Wt[v * 4 + c] = top[c] ? top[c][1] / sum : 0; }
    }
    for (let s2 = 0; s2 < SEG; s2 += 1) { const v = base + k * SEG + s2; D.forEach((d, t) => { for (let e = 0; e < 3; e += 1) d[v * 3 + e] += w * (kT[t][lo * 3 + e] - d[v * 3 + e]); }); blended += 1; }
  }
  log(`finish: ${blended} strap vertices near the cups ride with the cups`);

  // written back in her skin space
  const local = new Float32Array(N * 3); for (let i = 0; i < N; i += 1) local.set(apply(Ti, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], 1), i * 3);
  const nrm = vertexNormals(local, kIdx);
  const buf = doc.getRoot().listBuffers()[0], acc = (type, a) => doc.createAccessor().setType(type).setArray(a).setBuffer(buf);
  kini.setAttribute('POSITION', acc('VEC3', local)).setAttribute('NORMAL', acc('VEC3', nrm)).setAttribute('JOINTS_0', acc('VEC4', J)).setAttribute('WEIGHTS_0', acc('VEC4', Wt)).setAttribute('_TAG', null);
  kini.setIndices(acc('SCALAR', Uint32Array.from(kIdx)));
  const targets = kini.listTargets();
  targets.forEach((t, k) => {
    const moved = new Float32Array(N * 3); for (let i = 0; i < N * 3; i += 1) moved[i] = local[i] + D[k][i];
    const mn = vertexNormals(moved, kIdx), dn = new Float32Array(N * 3); for (let i = 0; i < N * 3; i += 1) dn[i] = mn[i] - nrm[i];
    t.setAttribute('POSITION', acc('VEC3', D[k])).setAttribute('NORMAL', acc('VEC3', dn));
  });
  if (process.env.FINISH_DEBUG) { const C = [[1, 1, 1], [1, 0, 0], [0, 0.4, 1], [1, 1, 0], [1, 0, 1]], col = new Float32Array(N * 3); for (let i = 0; i < N; i += 1) col.set(C[i < kn ? tag[i] : 3], i * 3); kini.setAttribute('COLOR_0', acc('VEC3', col)); kini.getMaterial().setBaseColorFactor([1, 1, 1, 1]); }
  kini.setExtras({ ...(kini.getExtras() ?? {}), finished: 'scripts/sarahV2BikiniFinish.mjs' });
  log(`finish: bikini ${N.toLocaleString('en-US')} vertices (${newPos.length} in the new straps), ${(kIdx.length / 3).toLocaleString('en-US')} triangles`);
  await io.write(dst, doc);
}

if (process.argv[1]?.endsWith('sarahV2BikiniFinish.mjs')) await sarahV2BikiniFinish(process.argv[2], process.argv[3] ?? process.argv[2]);
