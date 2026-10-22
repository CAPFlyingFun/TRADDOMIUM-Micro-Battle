/** THE SHIRT HEMS OVER THE HIGH LEGGINGS (Joshua, 2026-10-20: "Inspect spandex-high at 100% and 200%. The shirt hem
 * appears to overlap or clip around the belly and leggings transition"; "Check the relaxed shirt's rear hem. It flares
 * outward noticeably behind the hips... reduce while preserving a natural relaxed fit").
 *
 *   node scripts/sarahV2Recovery/shirt-hem-fit.mjs --shirt assets-archive/models/sarah-v2-spandex-high.gltf --mode spandex \
 *        --leggings assets-archive/models/sarah-v2-leggings.glb --body assets-archive/models/sarah-v2-body.glb --out .scratch/spandex-high.glb
 *   then package: node scripts/sarahV2Recovery/shirt-package.mjs --input .scratch/spandex-high.glb --out assets-archive/models/sarah-v2-spandex-high.gltf
 *
 * Only the shirt's own `shape:fitBelly<key>` corrections change (positions and normal offsets); its native targets,
 * skin, UVs and baseline metadata do not. Measured on the default body at each fit key, posed world centimetres:
 *  - spandex: the spandex shirt hugs her belly 1.5-3 mm off her skin, the high leggings 3.6 mm, so where the leggings
 *    run on under the hem (LEGGINGS_UNDER_SHIRT_CM) they showed through it. The lowest HEM_LIFT_TO cm of the shirt are
 *    eased out to at least GAP outside the leggings, the most any point of a cell needs (both cloth layers move alike).
 *  - relaxed: the back hem stood 3.1 cm (up to 4.0) off her where the same back stood 2.3 cm 6-12 cm higher, a ~1 cm
 *    flare over the hips. The back's lowest FLARE_TO cm are eased in toward the stand-off it has higher up (+ALLOW).
 * Moves are tabled per 2-degree angle and 0.5 cm height cell, smoothed, then applied along her skin normal, so the
 * double-layer cloth keeps its thickness. Writes `<out>` and `<out>.hem-delta.json` (the change in the conservative hem
 * profile per fit key, for leggings-fit.mjs --hem-delta).
 */
import { writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune, unpartition } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { loadSkin, apply, read } from '../sarahV2ProcBikini/skin.mjs';
import { labWeights, defaults, evaluate } from './bikini/morphs.mjs';
import { SkinCollider } from './bikini/collider.mjs';
import { buildRecoveredHemProfile } from './leggings-hem.mjs';

const FIT_KEYS = [0, 50, 100, 150, 200], LEGGINGS_FIT_KEYS = [0, 25, 30, 50, 60, 75, 100, 150, 200];
// GAME TUNING, centimetres
const GAP = 0.15, HEM_LIFT_FULL = 2.5, HEM_LIFT_TO = 5, FLARE_FULL = 4, FLARE_TO = 9, FLARE_REF = [7, 11], ALLOW = 0.15, BACK_FROM = [70, 115]; // degrees from her front: the back and back-sides
const BINS = 180, BAND = 0.5, CENTER_Z = -6;
const args = process.argv.slice(2), opt = (n) => { const i = args.indexOf(`--${n}`); return i < 0 ? null : args[i + 1]; };
const mode = opt('mode'), out = opt('out');
if (!['spandex', 'relaxed'].includes(mode) || !out) throw Error('usage: --shirt S.gltf --mode spandex|relaxed --leggings L.glb --body B.glb --out OUT.glb');
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const keyWeights = (bump, prefix, keys) => { let lo = 0; while (lo < keys.length - 2 && bump > keys[lo + 1]) lo++; const a = keys[lo], z = keys[lo + 1], t = (bump - a) / (z - a), r = {}; if (t < 1) r[`${prefix}${a}`] = 1 - t; if (t > 0) r[`${prefix}${z}`] = t; return r; };

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const lab = await labWeights(), body = await loadSkin(opt('body')), shirt = await loadSkin(opt('shirt')), legs = mode === 'spandex' ? await loadSkin(opt('leggings')) : null;
const meta = shirt.mesh.getExtras().recoveredShirt, prim = shirt.mesh.listPrimitives()[0], I = prim.getIndices().getArray();
const shirtWeights = (bump) => { const W = { ...defaults(lab, bump) }, base = meta.baselineMode === 'reference100' ? { 100: 1 } : keyWeights(bump, '', FIT_KEYS); for (const [k, w] of Object.entries(base)) for (const [n, v] of Object.entries(meta.baselineWeightsByBump[k])) W[n] = (W[n] ?? 0) - w * v; return { ...W, ...keyWeights(bump, 'shape:fitBelly', FIT_KEYS) }; };
const angle = (p) => Math.atan2(p[0], p[2] - CENTER_Z), binOf = (p) => Math.floor(((angle(p) / (2 * Math.PI)) * BINS + BINS) % BINS);
const smoothTable = (M, rounds, keepMax) => { for (let r = 0; r < rounds; r++) { const N = M.map((row) => row.slice()); for (let b = 0; b < BINS; b++) for (let h = 0; h < M[b].length; h++) { const nb = [M[(b + BINS - 1) % BINS][h], M[(b + 1) % BINS][h], M[b][Math.max(0, h - 1)], M[b][Math.min(M[b].length - 1, h + 1)]]; const avg = 0.5 * M[b][h] + 0.125 * nb.reduce((s, x) => s + x, 0); N[b][h] = keepMax ? Math.max(avg, 0.5 * M[b][h] + 0.5 * avg) : avg; } M = N; } return M; };
const hemDelta = {};

for (const key of FIT_KEYS) {
  const W = shirtWeights(key), S = evaluate(shirt, prim, W), n = S.length / 3;
  const Wb = defaults(lab, key), B = evaluate(body, body.body, Wb), idx = [];
  for (let i = 0; i < body.I.length; i += 3) if ([0, 1, 2].some((e) => B[body.I[i+e]*3+1] > 60 && B[body.I[i+e]*3+1] < 160)) idx.push(body.I[i], body.I[i+1], body.I[i+2]);
  const col = new SkinCollider(B, idx);
  const P = (i) => [S[i*3], S[i*3+1], S[i*3+2]];
  const hem = new Float64Array(BINS).fill(Infinity); for (let i = 0; i < n; i++) { const b = binOf(P(i)); hem[b] = Math.min(hem[b], S[i*3+1]); }
  const H = Math.ceil(Math.max(HEM_LIFT_TO, FLARE_REF[1]) / BAND) + 1;
  const info = new Array(n); for (let i = 0; i < n; i++) { const p = P(i), b = binOf(p), h = p[1] - hem[b]; if (h > H * BAND) continue; const c = col.closest(p); if (c) info[i] = { b, h, s: c.signedDistance, q: c.point, nrm: c.normal }; }
  let M = Array.from({ length: BINS }, () => new Array(H).fill(0)), report = '';
  if (mode === 'spandex') {
    // the leggings at this size, as the Lab blends their nine corrections
    const lp = legs.mesh.listPrimitives()[0], L = evaluate(legs, lp, { ...Wb, ...keyWeights(key, 'shape:recoveryLeggings', LEGGINGS_FIT_KEYS) }), li = Array.from(lp.getIndices().getArray()), lf = []; for (let t = 0; t < li.length; t += 3) lf.push(li[t], li[t+2], li[t+1]);
    const lc = [new SkinCollider(L, li), new SkinCollider(L, lf)], along = (q, d) => Math.min(...lc.map((c) => c.rayExit(q, d, { maxDistanceCm: 4 })?.distance ?? 99));
    let worst = 0;
    for (let i = 0; i < n; i++) { const f = info[i]; if (!f || f.h > HEM_LIFT_TO) continue; const dl = along(f.q, f.nrm); if (dl > 50) continue; const need = dl + GAP - f.s; if (need > 0) { const hb = Math.min(H - 1, Math.floor(f.h / BAND)); M[f.b][hb] = Math.max(M[f.b][hb], need); worst = Math.max(worst, need); } }
    M = smoothTable(M, 6, true);
    report = `leggings showed through up to ${(worst*10).toFixed(1)} mm`;
  } else {
    // the back hangs as it does higher up
    const ref = new Float64Array(BINS).fill(NaN); { const acc = Array.from({ length: BINS }, () => []); for (const f of info) if (f && f.h >= FLARE_REF[0] && f.h <= FLARE_REF[1]) acc[f.b].push(f.s); acc.forEach((a, b) => { if (a.length) { a.sort((x, y) => x - y); ref[b] = a[a.length >> 1]; } }); }
    const cells = Array.from({ length: BINS }, () => Array.from({ length: H }, () => [])); for (const f of info) if (f && f.h < FLARE_TO) cells[f.b][Math.min(H - 1, Math.floor(f.h / BAND))].push(f.s);
    let worst = 0;
    for (let b = 0; b < BINS; b++) { const th = Math.abs((b + 0.5) / BINS * 360 - (b >= BINS / 2 ? 360 : 0)), back = ss(BACK_FROM[0], BACK_FROM[1], th); if (!back || !Number.isFinite(ref[b])) continue; for (let h = 0; h < H; h++) { const a = cells[b][h]; if (!a.length) continue; a.sort((x, y) => x - y); const med = a[a.length >> 1], w = back * (1 - ss(FLARE_FULL, FLARE_TO, (h + 0.5) * BAND)); const m = w * Math.max(0, med - (ref[b] + ALLOW)); M[b][h] = -m; worst = Math.max(worst, m); } }
    M = smoothTable(M, 6, false);
    report = `back flare reduced by up to ${(worst*10).toFixed(1)} mm`;
  }
  // apply along her skin normal, by cell (interpolated in height), so both cloth layers move together
  const total = new Float64Array(n * 3); let moved = 0, most = 0;
  for (let i = 0; i < n; i++) { const f = info[i]; if (!f) continue; const hf = Math.min(H - 1.001, f.h / BAND), h0 = Math.floor(hf), t = hf - h0, m = M[f.b][h0] * (1 - t) + M[f.b][Math.min(H - 1, h0 + 1)] * t; if (Math.abs(m) < 1e-4) continue; for (let e = 0; e < 3; e++) total[i*3+e] = f.nrm[e] * m; moved++; most = Math.max(most, Math.abs(m)); }
  // clearance after the move: the shirt stays off her
  let inside = 0; for (let i = 0; i < n; i += 3) { if (!info[i]) continue; const p = [0, 1, 2].map((e) => S[i*3+e] + total[i*3+e]); const c = col.closest(p); if (c && c.signedDistance < 0.05) inside++; }
  // write: position offsets added to this key's fit correction, normal offsets = the geometric turn, scaled to the raw sum
  const T = prim.listTargets()[shirt.names.indexOf(`shape:fitBelly${key}`)], TP = T.getAttribute('POSITION'), TN = T.getAttribute('NORMAL');
  const pos = read(TP); for (let i = 0; i < n; i++) { if (!total[i*3] && !total[i*3+1] && !total[i*3+2]) continue; const d = apply(shirt.Ti, [total[i*3] / 100, total[i*3+1] / 100, total[i*3+2] / 100], 0); for (let e = 0; e < 3; e++) pos[i*3+e] += d[e]; }
  TP.setArray(pos);
  if (TN) {
    const kf = (i, arr) => `${Math.round(arr(i, 0)*1e3)},${Math.round(arr(i, 1)*1e3)},${Math.round(arr(i, 2)*1e3)}`, rm = new Map(), rep = new Int32Array(n); for (let i = 0; i < n; i++) { const k = kf(i, (j, e) => S[j*3+e]); if (!rm.has(k)) rm.set(k, i); rep[i] = rm.get(k); }
    const vn = (pf) => { const N = new Float64Array(n * 3); for (let t = 0; t < I.length; t += 3) { const [a, b, c] = [I[t], I[t+1], I[t+2]]; const u = [0, 1, 2].map((e) => pf(b, e) - pf(a, e)), v = [0, 1, 2].map((e) => pf(c, e) - pf(a, e)); const x = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]; for (const j of [a, b, c]) for (let e = 0; e < 3; e++) N[rep[j]*3+e] += x[e]; } return (i) => { const r = rep[i], l = Math.hypot(N[r*3], N[r*3+1], N[r*3+2]) || 1; return [N[r*3] / l, N[r*3+1] / l, N[r*3+2] / l]; }; };
    const n0 = vn((i, e) => S[i*3+e]), n1 = vn((i, e) => S[i*3+e] + total[i*3+e]);
    const RN = read(prim.getAttribute('NORMAL')); prim.listTargets().forEach((tg, k) => { const w = W[shirt.names[k]] ?? 0, a2 = tg.getAttribute('NORMAL'); if (!w || !a2) return; const d = read(a2); for (let i = 0; i < RN.length; i++) RN[i] += d[i] * w; });
    const nrm = read(TN); for (let i = 0; i < n; i++) { if (!total[i*3] && !total[i*3+1] && !total[i*3+2]) continue; const a = n0(i), b = n1(i), len = Math.hypot(...apply(shirt.T, [RN[i*3], RN[i*3+1], RN[i*3+2]], 0)) / shirt.tS; const d = apply(shirt.Ti, [0, 1, 2].map((e) => (b[e] - a[e]) * len), 0).map((x) => x * shirt.tS); for (let e = 0; e < 3; e++) nrm[i*3+e] += d[e]; }
    TN.setArray(nrm);
  }
  // the conservative hem profile before and after, so the leggings cutoff can follow
  const S2 = Float64Array.from(S, (v, i) => v + total[i]), before = buildRecoveredHemProfile([{ positions: S, indices: I }]), after = buildRecoveredHemProfile([{ positions: S2, indices: I }]);
  const dh = Array.from(after.cellLowerHem, (y, i) => y - before.cellLowerHem[i]); hemDelta[key] = dh;
  console.log(`${mode} ${key}%: ${report}; ${moved} points moved, at most ${(most*10).toFixed(1)} mm; ${inside} sampled points within 0.5 mm of her after; hem profile moved at most ${(Math.max(...dh.map(Math.abs))*10).toFixed(2)} mm`);
}

const doc = shirt.doc; await doc.transform(prune({ keepLeaves: true }), unpartition());
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
await io.write(out, doc); writeFileSync(`${out}.hem-delta.json`, JSON.stringify({ [mode]: hemDelta }));
console.log('written', out);
