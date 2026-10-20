/** THE FITTED SHIRT LIES SMOOTH ON HER AT EVERY SIZE, WITH ONE SMALL NAVEL BUMP (Joshua, 2026-10-20: "Everything looks
 * good except for the areas I circled which appears like to have 3 bellybuttons, lol, shirt defects on the side, and
 * bellybutton on one screenshot still poking through").
 *
 * The fitted (spandex) shirt is frozen Meshy fits at 0/50/100/150/200%, blended between. Over her belly those fits carry
 * folds a few tenths of a millimetre to a couple of millimetres deep -- a diagonal one down each side at 100%, an arch of
 * sharp ones round her navel at 150% -- and each fit presses its own navel impression where her navel is AT that size,
 * so between fits two half impressions sat above and below her navel and her navel came through between them.
 *
 * Two steps, on a shirt that does not have them yet:
 *  1. THE FITS ARE SMOOTHED over her belly, each in its own `shape:fitBelly<key>` target (as shirt-hem-fit.mjs eases
 *     the hem), so between fits the shirt is the blend of smoothed fits as it was the blend of fits. Each point of the
 *     outer layer moves along its normal onto the area-weighted plane of the cloth round it (SMOOTH_SIGMA wide,
 *     SMOOTH_ROUNDS times), from the hem band up to her bust and round to her sides (REGION). In the hem band the plane
 *     is fitted only ALONG the hem, so the band's stitched edge and the turned edge under it keep their shape while a
 *     fold crossing the band is taken out. The fits' stored normals carry the folds as well (5-15 degrees off the surface
 *     along them), so over the same region they are smoothed the same way.
 *  2. THE CLOTH IS LIFTED OFF HER every 10% to 100% and every 5% past it, as `shape:fineFit<key>` fields (FINE_KEYS)
 *     blended like fit keys (the Lab: `fitWeights(bump, 'shape:fineFit', SHIRT_FINE_FIT_KEYS)`). Between the fits the
 *     two fits' navels are first taken out of the blend and one, the approved one, put in where hers is (see HER NAVEL
 *     below). Wherever the outer layer
 *     is closer than FLOOR to her skin -- or, with --leggings, to the leggings the Lab still draws under its hem band --
 *     the shortfall is spread as a smooth swell LIFT_SIGMA wide; the blended result is then checked half way between
 *     every two keys, and any shortfall there lifts the keys around it (never a fit itself), until nothing is short.
 *     Her skin round her navel is kept under the cloth as well, so her outie's tip cannot come up between cloth points.
 *     The fields are zero away from her navel, and at the fits all but that (a fraction of a millimetre at most).
 * The shirt is a closed shell 0.8 mm thick; its inner layer is carried with the outer one, each inner point keeping its
 * place under the outer layer and its depth below it. Normals get the geometric turn of each move, as raw sums like
 * the shirt's own targets.
 *
 *   node scripts/sarahV2Recovery/shirt-fine-fit.mjs --shirt S.(glb|gltf) --body public/models/sarah-v2-body.glb --out OUT.glb
 *        [--leggings public/models/sarah-v2-leggings.glb]   (the spandex-high shirt, worn over the high leggings)
 *   then: node scripts/sarahV2Recovery/shirt-package.mjs --input OUT.glb --out public/models/sarah-v2-spandex-*.gltf
 *   (--smooth-only stops after step 1, for looking at the folds alone; such a shirt has no lifts and is not for use)
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune, unpartition } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { loadSkin, apply, read } from '../sarahV2ProcBikini/skin.mjs';
import { labWeights, defaults, evaluate } from './bikini/morphs.mjs';
import { SkinCollider } from './bikini/collider.mjs';

const FIT_KEYS = [0, 50, 100, 150, 200];
// every 10% to 100%, every 5% past it, where her outie is fully out and moves down her belly fastest: blended between two
// keys, two navel bumps half a step apart still showed a dip over her navel at 10%
export const FINE_KEYS = [...Array.from({ length: 10 }, (_, i) => i * 10), ...Array.from({ length: 21 }, (_, i) => 100 + i * 5)];
// (a look at a few sizes only, while working: FINE_ONLY=110,120 fits just those keys and checks nothing between; not for use)
if (process.env.FINE_ONLY) FINE_KEYS.splice(0, FINE_KEYS.length, ...process.env.FINE_ONLY.split(',').map(Number));
// the blended shirt is checked half way between every two keys
const CHECK_SIZES = FINE_KEYS.slice(1).map((k, i) => (FINE_KEYS[i] + k) / 2);
// GAME TUNING, centimetres: how wide the cloth is smoothed and how often; how far the outer layer is kept off her (the
// inner layer sits about 0.08 under it); a lift is flat for LIFT_TOP_R round each point that needs it (so the cloth
// spans her navel's dimple rather than dipping into it) and falls off over LIFT_SIGMA; what still counts as short
const SMOOTH_SIGMA = 0.8, SMOOTH_ROUNDS = 4, NORMAL_ROUNDS = 2, FLOOR = 0.08, LIFT_TOP_R = 0.4, LIFT_SIGMA = 0.6, LIFT_BLUR = 0.3, LIFT_DIR_SIGMA = 0.8, LIFT_ROUNDS = 10, SHORT = 0.003, CHECK_ROUNDS = 5, MAX_LIFT = 1.2;
// a vertex whose move (cm) and normal turn are both below these is left out of a field; and every target this writes
// keeps the shirts' storage lattice (shirt-bind.mjs quantizeShirtAsset: positions 2^-20, normals 2^-17 local units),
// so the cloth is unchanged to the eye and the file stays small
const TINY_MOVE = 0.0002, TINY_TURN = 0.0002, POSITION_STEP = 2 ** -20, NORMAL_STEP = 2 ** -17;
// only outer points this close to her (cm, on the smoothed shirt at a key) can come short at all: the lift moves out
const NEAR_SKIN = 1.0;
// GAME TUNING: where the shirt is smoothed, measured on its 100% fit. Distances (cm) from the fold-backs where the outer
// layer turns into the inner (hem, neckline, armholes): nothing within `turn`, and inside `band` (the hem band, whose
// stitched edge is 1.0-2.3 cm up) only along the hem. Height y (cm): to `top`. Off her skin (cm): to `gap` (her bust's
// bridge stays as it is). Angle round her from the front (deg): to `around`. Each pair is a smooth ramp.
const REGION = { turn: [0.2, 0.4], band: 2.75, bandTol: 0.15, top: [118, 124], gap: [1.2, 2.2], around: [115, 135] };
// GAME TUNING: the lift is measured on the outer layer below this height (cm) at each size: her belly, not her bust
const LIFT_TOP = 122;

const args = process.argv.slice(2), opt = (n) => { const i = args.indexOf(`--${n}`); return i < 0 ? null : args[i + 1]; };
const keyWeights = (bump, prefix, keys) => { const b = Math.min(keys.at(-1), Math.max(keys[0], bump)); let lo = 0; while (lo < keys.length - 2 && b > keys[lo + 1]) lo++; const a = keys[lo], z = keys[lo + 1], t = (b - a) / (z - a), r = {}; if (t < 1) r[`${prefix}${a}`] = 1 - t; if (t > 0) r[`${prefix}${z}`] = t; return r; };
const ramp = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const log = (...a) => console.log(...a);
const onLattice = (array, step) => { for (let i = 0; i < array.length; i++) { const q = Math.round(array[i] / step) * step; array[i] = q === 0 ? 0 : q; } return array; };

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const lab = await labWeights(), body = await loadSkin(opt('body')), shirt = await loadSkin(opt('shirt')), legs = opt('leggings') ? await loadSkin(opt('leggings')) : null;
const meta = shirt.mesh.getExtras().recoveredShirt, prim = shirt.mesh.listPrimitives()[0], I = prim.getIndices().getArray(), nV = prim.getAttribute('POSITION').getCount();
if (shirt.mesh.listPrimitives().length !== 1) throw Error('Expected the fitted shirt as one primitive');
if (shirt.names.some((x) => x.startsWith('shape:fineFit') || x.startsWith('shape:navelFit'))) throw Error('This shirt already has fine-fit (or navel) fields; start from the shirt without them');
const baseWeights = (bump) => { const W = { ...defaults(lab, bump) }, base = meta.baselineMode === 'reference100' ? { 100: 1 } : keyWeights(bump, '', FIT_KEYS); for (const [k, w] of Object.entries(base)) for (const [nm, v] of Object.entries(meta.baselineWeightsByBump[k])) W[nm] = (W[nm] ?? 0) - w * v; return { ...W, ...keyWeights(bump, 'shape:fitBelly', FIT_KEYS) }; };

// ---- the shell, welded: duplicates at UV seams are one point of cloth ----
const rest = evaluate(shirt, prim, {}), node = new Int32Array(nV), rep = [], weld = new Map();
for (let i = 0; i < nV; i++) { const k = `${Math.round(rest[i*3] * 1000)},${Math.round(rest[i*3+1] * 1000)},${Math.round(rest[i*3+2] * 1000)}`; let j = weld.get(k); if (j === undefined) { j = rep.length; weld.set(k, j); rep.push(i); } node[i] = j; }
const N = rep.length, T = Int32Array.from(I, (v) => node[v]), nT = T.length / 3;
const nbStart = new Int32Array(N + 1), nbList = (() => { const sets = Array.from({ length: N }, () => new Set()); for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) { const a = T[t+e], b = T[t+(e+1)%3]; sets[a].add(b); sets[b].add(a); } let c = 0; for (let j = 0; j < N; j++) { nbStart[j] = c; c += sets[j].size; } nbStart[N] = c; const out = new Int32Array(c); for (let j = 0; j < N; j++) out.set([...sets[j]], nbStart[j]); return out; })();
const nodesOf = (S) => { const X = new Float64Array(N * 3); for (let j = 0; j < N; j++) { const i = rep[j]; X[j*3] = S[i*3]; X[j*3+1] = S[i*3+1]; X[j*3+2] = S[i*3+2]; } return X; };
const normalsOf = (X, tris = T) => { const Nn = new Float64Array(N * 3); for (let t = 0; t < tris.length; t += 3) { const a = tris[t]*3, b = tris[t+1]*3, c = tris[t+2]*3, ux = X[b]-X[a], uy = X[b+1]-X[a+1], uz = X[b+2]-X[a+2], vx = X[c]-X[a], vy = X[c+1]-X[a+1], vz = X[c+2]-X[a+2], nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx; for (const j of [a, b, c]) { Nn[j] += nx; Nn[j+1] += ny; Nn[j+2] += nz; } } for (let j = 0; j < N; j++) { const l = Math.hypot(Nn[j*3], Nn[j*3+1], Nn[j*3+2]) || 1; Nn[j*3] /= l; Nn[j*3+1] /= l; Nn[j*3+2] /= l; } return Nn; };
const areasOf = (X) => { const A = new Float64Array(N); for (let t = 0; t < T.length; t += 3) { const a = T[t]*3, b = T[t+1]*3, c = T[t+2]*3, ux = X[b]-X[a], uy = X[b+1]-X[a+1], uz = X[b+2]-X[a+2], vx = X[c]-X[a], vy = X[c+1]-X[a+1], vz = X[c+2]-X[a+2], ar = Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx) / 6; A[T[t]] += ar; A[T[t+1]] += ar; A[T[t+2]] += ar; } return A; };
log(`${nV} vertices, ${N} points of cloth, ${nT} triangles`);

// ---- her skin (torso; never her arms, which hang close to the shirt's sides) ----
const skinAt = (b) => { const B = evaluate(body, body.body, defaults(lab, b)), idx = []; for (let t = 0; t < body.I.length; t += 3) { if (body.armTri[t / 3]) continue; if ([0, 1, 2].some((e) => { const y = B[body.I[t+e]*3+1]; return y > 70 && y < 130; })) idx.push(body.I[t], body.I[t+1], body.I[t+2]); } return new SkinCollider(B, idx); };

// ---- the two layers, told apart on the shirt as authored, and how far each point is from a fold-back ----
const S100 = evaluate(shirt, prim, baseWeights(100)), X100 = nodesOf(S100), N100 = normalsOf(X100);
const outer = new Uint8Array(N);
{ const zc = new Map(); for (let j = 0; j < N; j++) { const y = Math.round(X100[j*3+1]), e = zc.get(y) ?? [0, 0]; e[0] += X100[j*3+2]; e[1]++; zc.set(y, e); }
  for (let j = 0; j < N; j++) { const e = zc.get(Math.round(X100[j*3+1])), rx = X100[j*3], rz = X100[j*3+2] - e[0] / e[1]; outer[j] = N100[j*3] * rx + N100[j*3+2] * rz > 0 ? 1 : 0; }
  // stray points in a fold vote with their neighbours, until nothing changes
  for (let round = 0; round < 200; round++) { let changed = 0; for (let j = 0; j < N; j++) { let o = 0; const deg = nbStart[j+1] - nbStart[j]; for (let k = nbStart[j]; k < nbStart[j+1]; k++) o += outer[nbList[k]]; const v = 2 * o > deg ? 1 : 2 * o < deg ? 0 : outer[j]; if (v !== outer[j]) { outer[j] = v; changed++; } } if (!changed) break; } }
const fold = new Float64Array(N).fill(Infinity);
{ const heap = [], push = (d, j) => { heap.push([d, j]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } }, pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (let j = 0; j < N; j++) { if (!outer[j]) continue; for (let k = nbStart[j]; k < nbStart[j+1]; k++) if (!outer[nbList[k]]) { fold[j] = 0; push(0, j); break; } }
  while (heap.length) { const [d, j] = pop(); if (d > fold[j] || d > 8.5) continue; for (let k = nbStart[j]; k < nbStart[j+1]; k++) { const u = nbList[k]; if (!outer[u]) continue; const nd = d + Math.hypot(X100[u*3]-X100[j*3], X100[u*3+1]-X100[j*3+1], X100[u*3+2]-X100[j*3+2]); if (nd < fold[u]) { fold[u] = nd; push(nd, u); } } } }
let nOuter = 0; for (let j = 0; j < N; j++) nOuter += outer[j];
log(`outer layer ${nOuter} points, inner ${N - nOuter}; fold-backs at ${[...fold].filter((d) => d === 0).length} points`);

// ---- where it is smoothed (a weight 0..1 on each outer point), on the 100% fit ----
const weight = new Float64Array(N);
{ const skin100 = skinAt(100); let n = 0;
  for (let j = 0; j < N; j++) { if (!outer[j] || !(fold[j] >= REGION.turn[0])) continue; const x = X100[j*3], y = X100[j*3+1], z = X100[j*3+2], th = Math.abs(Math.atan2(x, z + 2)) * 180 / Math.PI;
    let w = ramp(fold[j], ...REGION.turn) * (1 - ramp(y, ...REGION.top)) * (1 - ramp(th, ...REGION.around)); if (w <= 0) continue;
    const h = skin100.closest([x, y, z]); w *= 1 - ramp(h ? h.signedDistance : 9, ...REGION.gap); if (w > 0) { weight[j] = w; n++; } }
  log(`smoothed: ${n} outer points`); }
const active = []; for (let j = 0; j < N; j++) if (weight[j] > 0) active.push(j);
// how closely a neighbour's distance from the fold-back must match, so the hem band is smoothed only along the hem
const FAR = 8, foldOf = (j) => Math.min(fold[j], FAR), foldTol = (d) => REGION.bandTol + Math.max(0, d - REGION.band) * 3;

// ---- a spatial hash over points ----
const CELL_OFF = 1024, CELL_MUL = 2048;
const cellKey = (x, y, z, c) => ((Math.floor(x / c) + CELL_OFF) * CELL_MUL + (Math.floor(y / c) + CELL_OFF)) * CELL_MUL + (Math.floor(z / c) + CELL_OFF);
const gridOf = (X, ids, c) => { const g = new Map(); for (const j of ids) { const k = cellKey(X[j*3], X[j*3+1], X[j*3+2], c); let a = g.get(k); if (!a) g.set(k, a = []); a.push(j); } return g; };
const nearBuf = new Int32Array(1 << 16);
const near = (g, X, j, c) => { const cx = Math.floor(X[j*3] / c), cy = Math.floor(X[j*3+1] / c), cz = Math.floor(X[j*3+2] / c); let n = 0; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) { const a = g.get(((cx + dx + CELL_OFF) * CELL_MUL + (cy + dy + CELL_OFF)) * CELL_MUL + (cz + dz + CELL_OFF)); if (a) for (const u of a) nearBuf[n++] = u; } return n; };
const outerIds = []; for (let j = 0; j < N; j++) if (outer[j]) outerIds.push(j);

// ---- 1. smoothing ----
// the constant term of a 6x6 symmetric positive system (lower triangle of M filled), by Cholesky; NaN if it fails
const quadM = new Float64Array(36), quadR = new Float64Array(6), phi = new Float64Array(6), cholL = new Float64Array(36), cholY = new Float64Array(6);
function solve6(M, r) {
  for (let i = 0; i < 6; i++) for (let j = 0; j <= i; j++) { let s = M[i*6+j]; for (let k = 0; k < j; k++) s -= cholL[i*6+k] * cholL[j*6+k]; if (i === j) { if (!(s > 1e-18)) return NaN; cholL[i*6+i] = Math.sqrt(s); } else cholL[i*6+j] = s / cholL[j*6+j]; }
  for (let i = 0; i < 6; i++) { let s = r[i]; for (let k = 0; k < i; k++) s -= cholL[i*6+k] * cholY[k]; cholY[i] = s / cholL[i*6+i]; }
  const x = new Float64Array(6); for (let i = 5; i >= 0; i--) { let s = cholY[i]; for (let k = i + 1; k < 6; k++) s -= cholL[k*6+i] * x[k]; x[i] = s / cholL[i*6+i]; }
  return x[0];
}
function smooth(X0, wt = weight) {
  let X = Float64Array.from(X0); const R = 3 * SMOOTH_SIGMA, s2 = 2 * SMOOTH_SIGMA * SMOOTH_SIGMA;
  for (let round = 0; round < SMOOTH_ROUNDS; round++) {
    const Nn = normalsOf(X), A = areasOf(X), g = gridOf(X, outerIds, R), next = Float64Array.from(X);
    for (const j of active) {
      const n = near(g, X, j, R), px = X[j*3], py = X[j*3+1], pz = X[j*3+2], fj = foldOf(j), tj = foldTol(fj); let sw = 0, cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
      for (let k = 0; k < n; k++) { const u = nearBuf[k], dx = X[u*3]-px, dy = X[u*3+1]-py, dz = X[u*3+2]-pz, d2 = dx*dx + dy*dy + dz*dz; if (d2 > R * R) continue;
        const fu = foldOf(u), tol = Math.min(tj, foldTol(fu)), df = fu - fj, f = Math.exp(-df * df / (2 * tol * tol));
        const gw = A[u] * Math.exp(-d2 / s2) * f; if (gw < 1e-12) continue; sw += gw; cx += gw * X[u*3]; cy += gw * X[u*3+1]; cz += gw * X[u*3+2]; nx += gw * Nn[u*3]; ny += gw * Nn[u*3+1]; nz += gw * Nn[u*3+2]; }
      if (!sw) continue; cx /= sw; cy /= sw; cz /= sw; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      // the cloth round the point as a height field over its tangent plane: a weighted quadric, so her belly's own
      // curve is kept and only the folds go (a plane alone would flatten the curve a little every round)
      let ax = -ny, ay = nx, az = 0; if (Math.abs(nz) > 0.9) { ax = 0; ay = -nz; az = ny; } let al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;
      const bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax, M = quadM.fill(0), r = quadR.fill(0);
      for (let k = 0; k < n; k++) { const u = nearBuf[k], dx = X[u*3]-px, dy = X[u*3+1]-py, dz = X[u*3+2]-pz, d2 = dx*dx + dy*dy + dz*dz; if (d2 > R * R) continue;
        const fu = foldOf(u), tol = Math.min(tj, foldTol(fu)), df = fu - fj, gw = A[u] * Math.exp(-d2 / s2) * Math.exp(-df * df / (2 * tol * tol)); if (gw < 1e-12) continue;
        const x = dx*ax + dy*ay + dz*az, y = dx*bx + dy*by + dz*bz, z = dx*nx + dy*ny + dz*nz; phi[0] = 1; phi[1] = x; phi[2] = y; phi[3] = x*x; phi[4] = x*y; phi[5] = y*y;
        for (let a = 0; a < 6; a++) { r[a] += gw * phi[a] * z; for (let b = 0; b <= a; b++) M[a*6+b] += gw * phi[a] * phi[b]; } }
      // a little ridge keeps terms the neighbours cannot tell (in the hem band they lie along a line) at zero
      for (let a = 1; a < 6; a++) M[a*6+a] += 1e-3 * sw;
      const h0 = solve6(M, r);
      const h = Number.isFinite(h0) ? -h0 : (px - cx) * nx + (py - cy) * ny + (pz - cz) * nz, m = wt[j] * h; next[j*3] = px - m * nx; next[j*3+1] = py - m * ny; next[j*3+2] = pz - m * nz;
    }
    X = next;
  }
  return X;
}

// ---- 2. the lift: shortfalls below FLOOR anywhere on her belly, spread as swells ----
const liftDomain = (X) => outerIds.filter((j) => X[j*3+1] < LIFT_TOP && X[j*3+1] > 75);
// how much closer than FLOOR each listed outer point is to her skin
// THE LEGGINGS UNDER THE SHIRT (--leggings, with the high leggings under the spandex shirt): the Lab still draws them up
// to LEG_BAND cm above the shirt's hem (LEGGINGS_UNDER_SHIRT_CM); there, over her belly (within LEG_AROUND degrees of
// her front, where her navel comes down to the hem), they must stay LEG_GAP under its outer layer. A drawn point more
// than LEG_OUT outside the cloth is not under the shirt at all (the hem band's baked distance is coarse at her back),
// and is left alone rather than chased.
const LEGGINGS_FIT_KEYS = [0, 25, 30, 50, 60, 75, 100, 150, 200], LEG_BAND = 1.5, LEG_FROM = 0.3, LEG_GAP = 0.08, LEG_NEAR_FOLD = 5, LEG_AROUND = 100, LEG_OUT = 0.5;
function legsAt(b) {
  if (!legs) return null; const W = { ...defaults(lab, b), ...keyWeights(b, 'shape:recoveryLeggings', LEGGINGS_FIT_KEYS) }, pts = [];
  for (const p of legs.mesh.listPrimitives()) {
    const L = evaluate(legs, p, W), n = L.length / 3, hem = new Float64Array(n);
    for (const [k, w] of Object.entries(keyWeights(b, '', FIT_KEYS))) { const a = p.getAttribute(`_HEM_SPANDEX_${k}`); if (!a) throw Error('The leggings have no spandex hem fields'); const h = read(a); for (let i = 0; i < n; i++) hem[i] += w * h[i]; }
    for (let i = 0; i < n; i++) if (hem[i] > LEG_FROM && hem[i] < LEG_BAND && Math.abs(Math.atan2(L[i*3], L[i*3+2] + 2)) * 180 / Math.PI < LEG_AROUND) pts.push(L[i*3], L[i*3+1], L[i*3+2]);
  }
  return Float64Array.from(pts);
}
// where drawn leggings come within LEG_GAP of the shirt's outer layer, or through it, the corners of the cloth there
function legShortfalls(X, P, out) {
  if (!P?.length) return out; const oc = new SkinCollider(X, hemTris), q = [0, 0, 0];
  for (let i = 0; i < P.length; i += 3) { q[0] = P[i]; q[1] = P[i+1]; q[2] = P[i+2]; const h = oc.closest(q); if (!h || h.distance > 2 || h.signedDistance > LEG_OUT) continue; const s = h.signedDistance + LEG_GAP; if (s <= SHORT) continue;
    const t = h.triangle * 3; for (const j of [hemTris[t], hemTris[t+1], hemTris[t+2]]) out.set(j, Math.max(out.get(j) ?? 0, s)); }
  return out;
}
function shortfalls(X, skin, ids) {
  const out = new Map(), q = [0, 0, 0];
  for (const j of ids) { q[0] = X[j*3]; q[1] = X[j*3+1]; q[2] = X[j*3+2]; const h = skin.closest(q); if (!h || h.distance > 4) continue; const s = FLOOR - h.signedDistance; if (s > SHORT) out.set(j, s); }
  return out;
}
function nearSkin(X, skin, ids) { const out = [], q = [0, 0, 0]; for (const j of ids) { q[0] = X[j*3]; q[1] = X[j*3+1]; q[2] = X[j*3+2]; const h = skin.closest(q); if (h && h.signedDistance < FLOOR + NEAR_SKIN) out.push(j); } return out; }
function lifted(Xs, sources, Nn) {
  const X = Float64Array.from(Xs); if (!sources.size) return X; const R = LIFT_TOP_R + 3 * LIFT_SIGMA, s2 = 2 * LIFT_SIGMA * LIFT_SIGMA, L = new Map(), ids = [...sources.keys()], g = gridOf(Xs, outerIds, R);
  for (const u of ids) { const a = sources.get(u), n = near(g, Xs, u, R); for (let k = 0; k < n; k++) { const v = nearBuf[k], dx = Xs[v*3]-Xs[u*3], dy = Xs[v*3+1]-Xs[u*3+1], dz = Xs[v*3+2]-Xs[u*3+2], d = Math.sqrt(dx*dx + dy*dy + dz*dz); if (d > R) continue; const e = Math.max(0, d - LIFT_TOP_R), m = a * Math.exp(-e * e / s2); if (m > (L.get(v) ?? 0)) L.set(v, m); } }
  // the largest of the swells has a crease wherever two of them meet; a short blur takes it out (whatever that leaves
  // short is lifted again next round)
  const Rb = 3 * LIFT_BLUR, b2 = 2 * LIFT_BLUR * LIFT_BLUR, gb = gridOf(Xs, outerIds, Rb), A = areasOf(Xs), blurred = new Map(), reach = new Set();
  for (const v of L.keys()) { const n = near(gb, Xs, v, Rb); for (let k = 0; k < n; k++) reach.add(nearBuf[k]); }
  for (const v of reach) { const n = near(gb, Xs, v, Rb); let sw = 0, sm = 0; for (let k = 0; k < n; k++) { const u = nearBuf[k], d2 = (Xs[u*3]-Xs[v*3]) ** 2 + (Xs[u*3+1]-Xs[v*3+1]) ** 2 + (Xs[u*3+2]-Xs[v*3+2]) ** 2; if (d2 > Rb * Rb) continue; const w = A[u] * Math.exp(-d2 / b2); sw += w; sm += w * (L.get(u) ?? 0); } if (sw > 0 && sm > 0) blurred.set(v, sm / sw); }
  for (const [v, m] of blurred) for (let e = 0; e < 3; e++) X[v*3+e] += m * Nn[v*3+e];
  return X;
}

// ---- 3. the inner layer follows the outer, keeping its place under it and its depth ----
const outerTris = []; for (let t = 0; t < T.length; t += 3) if (outer[T[t]] && outer[T[t+1]] && outer[T[t+2]]) outerTris.push(T[t], T[t+1], T[t+2]);
const hemTris = []; for (let t = 0; t < outerTris.length; t += 3) if ([0, 1, 2].every((e) => foldOf(outerTris[t+e]) < LEG_NEAR_FOLD)) hemTris.push(outerTris[t], outerTris[t+1], outerTris[t+2]);
const innerIds = []; for (let j = 0; j < N; j++) if (!outer[j]) innerIds.push(j);
// THE INNER LAYER NEVER SHOWS THROUGH: in places the fits had it out through the outer layer (slivers of it lit on her
// side near the hem); over the smoothed region, away from the fold-backs, it is kept at least INNER_DEPTH under it
const INNER_DEPTH = 0.04;
function carryInner(X0, X1) {
  const X = Float64Array.from(X1), moved = new Uint8Array(N); for (const j of outerIds) if (X0[j*3] !== X1[j*3] || X0[j*3+1] !== X1[j*3+1] || X0[j*3+2] !== X1[j*3+2]) moved[j] = 1;
  const oc = new SkinCollider(X0, outerTris), q = [0, 0, 0]; let carried = 0;
  const fn = (P, a, b, c) => { const ux = P[b*3]-P[a*3], uy = P[b*3+1]-P[a*3+1], uz = P[b*3+2]-P[a*3+2], vx = P[c*3]-P[a*3], vy = P[c*3+1]-P[a*3+1], vz = P[c*3+2]-P[a*3+2], nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx, l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l]; };
  for (const j of innerIds) { q[0] = X0[j*3]; q[1] = X0[j*3+1]; q[2] = X0[j*3+2]; const h = oc.closest(q); if (!h || h.distance > 1) continue; const t = h.triangle * 3, a = outerTris[t], b = outerTris[t+1], c = outerTris[t+2];
    const inRegion = weight[a] > 0 && weight[b] > 0 && weight[c] > 0 && foldOf(a) > REGION.turn[1] && foldOf(b) > REGION.turn[1] && foldOf(c) > REGION.turn[1];
    if (!moved[a] && !moved[b] && !moved[c] && !(inRegion && h.signedDistance > -INNER_DEPTH)) continue;
    // barycentrics of the closest point, then the same point and depth on the moved triangle
    const e0 = [X0[b*3]-X0[a*3], X0[b*3+1]-X0[a*3+1], X0[b*3+2]-X0[a*3+2]], e1 = [X0[c*3]-X0[a*3], X0[c*3+1]-X0[a*3+1], X0[c*3+2]-X0[a*3+2]], r = [h.point[0]-X0[a*3], h.point[1]-X0[a*3+1], h.point[2]-X0[a*3+2]];
    const d00 = e0[0]*e0[0]+e0[1]*e0[1]+e0[2]*e0[2], d01 = e0[0]*e1[0]+e0[1]*e1[1]+e0[2]*e1[2], d11 = e1[0]*e1[0]+e1[1]*e1[1]+e1[2]*e1[2], d20 = r[0]*e0[0]+r[1]*e0[1]+r[2]*e0[2], d21 = r[0]*e1[0]+r[1]*e1[1]+r[2]*e1[2], den = d00 * d11 - d01 * d01 || 1;
    const bv = (d11 * d20 - d01 * d21) / den, bw = (d00 * d21 - d01 * d20) / den, ba = 1 - bv - bw, n0 = fn(X0, a, b, c), n1 = fn(X1, a, b, c);
    const raw = (q[0]-h.point[0]) * n0[0] + (q[1]-h.point[1]) * n0[1] + (q[2]-h.point[2]) * n0[2], side = [q[0]-h.point[0]-raw*n0[0], q[1]-h.point[1]-raw*n0[1], q[2]-h.point[2]-raw*n0[2]], depth = inRegion ? Math.min(raw, -INNER_DEPTH) : raw;
    for (let e = 0; e < 3; e++) X[j*3+e] = ba * X1[a*3+e] + bv * X1[b*3+e] + bw * X1[c*3+e] + depth * n1[e] + side[e];
    carried++; }
  return { X, carried };
}

// ---- the shirt's own summed normal at a size: the shader normalises a raw sum of it and its targets' normal offsets,
// so a turn added to a target is scaled by that sum's length there ----
const rawNormals = (b) => { const W = baseWeights(b), RN = Float64Array.from(read(prim.getAttribute('NORMAL'))); prim.listTargets().forEach((tg, k) => { const w = W[shirt.names[k]] ?? 0, a = tg.getAttribute('NORMAL'); if (!w || !a) return; const d = read(a); for (let i = 0; i < RN.length; i++) RN[i] += w * d[i]; }); return RN; };
// a move of the cloth points (world cm) as a target's position offsets and normal turns, vertex by vertex
function asTarget(X0, X1, RN) {
  const pos = new Float32Array(nV * 3), nrm = new Float32Array(nV * 3), n0 = normalsOf(X0), n1 = normalsOf(X1), turned = new Uint8Array(N);
  for (let j = 0; j < N; j++) if (X1[j*3] !== X0[j*3] || X1[j*3+1] !== X0[j*3+1] || X1[j*3+2] !== X0[j*3+2]) { turned[j] = 1; for (let q = nbStart[j]; q < nbStart[j+1]; q++) turned[nbList[q]] = 1; }
  for (let i = 0; i < nV; i++) { const j = node[i]; if (!turned[j]) continue;
    const d = [X1[j*3] - X0[j*3], X1[j*3+1] - X0[j*3+1], X1[j*3+2] - X0[j*3+2]], len = Math.hypot(RN[i*3], RN[i*3+1], RN[i*3+2]) || 1, t = [n1[j*3] - n0[j*3], n1[j*3+1] - n0[j*3+1], n1[j*3+2] - n0[j*3+2]];
    if (Math.hypot(...d) < TINY_MOVE && Math.hypot(...t) < TINY_TURN) continue;
    pos.set(apply(shirt.Ti, d.map((x) => x / 100), 0), i * 3); nrm.set(apply(shirt.Ti, t.map((x) => x * len), 0).map((x) => x * shirt.tS), i * 3); }
  return { pos, nrm };
}
const buffer = shirt.doc.getRoot().listBuffers()[0], accessor = (array) => shirt.doc.createAccessor().setType('VEC3').setArray(array).setBuffer(buffer);
const moveStats = (X0, X1) => { let moved = 0, worst = 0; for (const j of outerIds) { const d = Math.hypot(X1[j*3]-X0[j*3], X1[j*3+1]-X0[j*3+1], X1[j*3+2]-X0[j*3+2]); if (d > 0.005) moved++; worst = Math.max(worst, d); } return `${moved} outer points moved over 0.05 mm, most ${(worst*10).toFixed(2)} mm`; };

// THE SHADING IS SMOOTHED TOO: the fits' own stored normals carry the same folds as their surface (5-15 degrees off it
// along the folds), so the turn of the move alone leaves the lines in the light. Over the smoothed region each outer
// point's normal (stored, plus the turn) is replaced by the area-weighted average of the normals round it, the same
// SMOOTH_SIGMA wide and only along the hem in the hem band, NORMAL_ROUNDS times, eased in by the region's weight. RN is
// the raw summed normal at the key (local); `turn` (local, per vertex) is updated in place to the whole change.
function smoothNormals(X, RN, turn, wt = weight) {
  const R = 3 * SMOOTH_SIGMA, s2 = 2 * SMOOTH_SIGMA * SMOOTH_SIGMA, A = areasOf(X), g = gridOf(X, outerIds, R), len = new Float64Array(nV);
  let D = new Float64Array(N * 3);
  for (let i = 0; i < nV; i++) { const v = [RN[i*3] + turn[i*3], RN[i*3+1] + turn[i*3+1], RN[i*3+2] + turn[i*3+2]]; len[i] = Math.hypot(...v) || 1; if (rep[node[i]] !== i) continue; const w = apply(shirt.T, v, 0), l = Math.hypot(...w) || 1, j = node[i]; D[j*3] = w[0] / l; D[j*3+1] = w[1] / l; D[j*3+2] = w[2] / l; }
  for (let round = 0; round < NORMAL_ROUNDS; round++) {
    const next = Float64Array.from(D);
    for (const j of active) {
      const n = near(g, X, j, R), fj = foldOf(j), tj = foldTol(fj); let sx = 0, sy = 0, sz = 0;
      for (let k = 0; k < n; k++) { const u = nearBuf[k], dx = X[u*3]-X[j*3], dy = X[u*3+1]-X[j*3+1], dz = X[u*3+2]-X[j*3+2], d2 = dx*dx + dy*dy + dz*dz; if (d2 > R * R) continue;
        const fu = foldOf(u), tol = Math.min(tj, foldTol(fu)), df = fu - fj, gw = A[u] * Math.exp(-d2 / s2) * Math.exp(-df * df / (2 * tol * tol)); sx += gw * D[u*3]; sy += gw * D[u*3+1]; sz += gw * D[u*3+2]; }
      const l = Math.hypot(sx, sy, sz); if (!(l > 1e-12)) continue; const w = wt[j];
      let ox = (1 - w) * D[j*3] + w * sx / l, oy = (1 - w) * D[j*3+1] + w * sy / l, oz = (1 - w) * D[j*3+2] + w * sz / l; const ol = Math.hypot(ox, oy, oz) || 1; next[j*3] = ox / ol; next[j*3+1] = oy / ol; next[j*3+2] = oz / ol;
    }
    D = next;
  }
  const isActive = new Uint8Array(N); for (const j of active) isActive[j] = 1;
  for (let i = 0; i < nV; i++) { const j = node[i]; if (!isActive[j]) continue; const v = apply(shirt.Ti, [D[j*3], D[j*3+1], D[j*3+2]], 0).map((x) => x * shirt.tS * len[i]); for (let e = 0; e < 3; e++) turn[i*3+e] = v[e] - RN[i*3+e]; }
}

// ---- HER NAVEL. Joshua approved the spandex shirt's navel at its fit sizes after a long round of trials (the "closer
// fit": scripts/sarahV2Outfit/README.md, "Joshua's approved navel baseline"); it lives in each fit's own core round her
// navel, so the smoothing leaves NAVEL_CORE alone at every fit (full inside the first radius, fading to the second).
// Between two fits the shirt is their blend, and the blend holds each fit's navel at part strength where her navel was
// AT that fit -- 4 to 5 cm apart past 100% -- and none where her navel is. So each fit's navel is measured as a RELIEF:
// the cloth over her navel less the THIN PLATE under it, the smoothest surface that meets the cloth and its slope all
// round NAVEL_DISK (and along the hem's turned edge where that crosses it). A thin plate is any quadric or cubic belly
// exactly, so a relief is her navel and nothing of her belly, and it comes to nothing, flat, at its edge. Between fits,
// (1) both reliefs come out of the blend exactly as the blend put them in, at the cloth points that carry them and by
// the blend's own weights, which leaves the smooth cloth; and (2) ONE navel goes in where hers is: her outie as it
// stands at that size (her skin less its own thin plate) and, over it, the cloth's stand-off as the two fits held it
// (likewise a relief), blended by how far between them she is. Nothing starts or stops sharply, and the cloth round her
// navel is the blend's own. Past 150% her navel comes down to the hem and is under it by 200%: the hem band rides over
// her outie. One navel, the approved one, at every size. (A first try measured reliefs against a quadric through a
// ring and faded them out: the fade itself drew a ring round her navel.) ----
const NAVEL_CORE = [2.5, 3.5], NAVEL_FIELD = { half: 7, cell: 0.05 };
// the thin plate: its disk (cm, outside the fits' core), solved on a coarser grid (the plate is smooth), held to the
// surface on two rings of cells round the disk and along the hem's turned edge for NAVEL_HEM_HOLD
const NAVEL_DISK = 3.75, NAVEL_PLATE_CELL = 0.2, NAVEL_HEM_HOLD = 0.5;
// (her outie is modelled into the body; `navelFlat` settles it below 100%, so the point it moves most is the outie's tip)
const navelVert = (() => { const t = body.names.indexOf('navelFlat'); if (t < 0) throw Error('The body has no navelFlat shape'); const d = body.tgtLocal[t]; let best = -1, bm = 0; for (let i = 0; i < body.n; i++) { const m = Math.hypot(d[i*3], d[i*3+1], d[i*3+2]); if (m > bm) { bm = m; best = i; } } if (best < 0) throw Error('navelFlat moves nothing'); return best; })();
const navelTris = (() => { const B = evaluate(body, body.body, defaults(lab, 100)), c = [B[navelVert*3], B[navelVert*3+1], B[navelVert*3+2]], out = []; for (let t = 0; t < body.I.length; t += 3) { if (body.armTri[t / 3]) continue; if ([0, 1, 2].some((e) => Math.hypot(B[body.I[t+e]*3]-c[0], B[body.I[t+e]*3+1]-c[1], B[body.I[t+e]*3+2]-c[2]) < 12)) out.push(body.I[t], body.I[t+1], body.I[t+2]); } return out; })();
// her navel at a size: where it is, her belly's normal round it (2-4 cm out), across (u) and up (v) her belly
function navelFrame(b) {
  const B = evaluate(body, body.body, defaults(lab, b)), c = [B[navelVert*3], B[navelVert*3+1], B[navelVert*3+2]], nn = [0, 0, 0];
  for (let t = 0; t < navelTris.length; t += 3) { const [a, q, d] = [navelTris[t]*3, navelTris[t+1]*3, navelTris[t+2]*3], m = [(B[a]+B[q]+B[d])/3, (B[a+1]+B[q+1]+B[d+1])/3, (B[a+2]+B[q+2]+B[d+2])/3], r = Math.hypot(m[0]-c[0], m[1]-c[1], m[2]-c[2]); if (r < 2 || r > 4) continue;
    const ux = B[q]-B[a], uy = B[q+1]-B[a+1], uz = B[q+2]-B[a+2], vx = B[d]-B[a], vy = B[d+1]-B[a+1], vz = B[d+2]-B[a+2]; nn[0] += uy*vz-uz*vy; nn[1] += uz*vx-ux*vz; nn[2] += ux*vy-uy*vx; }
  const nl = Math.hypot(...nn); if (!(nl > 0)) throw Error(`No belly found round her navel at ${b}%`); const n = nn.map((x) => x / nl), u0 = [n[2], 0, -n[0]], ul = Math.hypot(...u0), u = u0.map((x) => x / ul), v = [n[1]*u[2]-n[2]*u[1], n[2]*u[0]-n[0]*u[2], n[0]*u[1]-n[1]*u[0]];
  return { B, c, n, u, v };
}
const toFrame = (F, x, y, z) => { const dx = x - F.c[0], dy = y - F.c[1], dz = z - F.c[2]; return [dx*F.u[0]+dy*F.u[1]+dz*F.u[2], dx*F.v[0]+dy*F.v[1]+dz*F.v[2], dx*F.n[0]+dy*F.n[1]+dz*F.n[2]]; };
// the outermost surface of some triangles as heights over the frame's plane (NaN where there is none)
function heightField(F, P, tris) {
  const G = NAVEL_FIELD, side = Math.round(2 * G.half / G.cell), H = new Float64Array(side * side).fill(NaN);
  for (let t = 0; t < tris.length; t += 3) {
    const a = toFrame(F, P[tris[t]*3], P[tris[t]*3+1], P[tris[t]*3+2]), b = toFrame(F, P[tris[t+1]*3], P[tris[t+1]*3+1], P[tris[t+1]*3+2]), d = toFrame(F, P[tris[t+2]*3], P[tris[t+2]*3+1], P[tris[t+2]*3+2]);
    if (Math.max(a[0], b[0], d[0]) < -G.half || Math.min(a[0], b[0], d[0]) > G.half || Math.max(a[1], b[1], d[1]) < -G.half || Math.min(a[1], b[1], d[1]) > G.half || Math.min(a[2], b[2], d[2]) > 4 || Math.max(a[2], b[2], d[2]) < -4) continue;
    const det = (b[0]-a[0]) * (d[1]-a[1]) - (d[0]-a[0]) * (b[1]-a[1]); if (Math.abs(det) < 1e-12) continue;
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], d[0]) + G.half) / G.cell)), i1 = Math.min(side - 1, Math.floor((Math.max(a[0], b[0], d[0]) + G.half) / G.cell));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1], d[1]) + G.half) / G.cell)), j1 = Math.min(side - 1, Math.floor((Math.max(a[1], b[1], d[1]) + G.half) / G.cell));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const px = -G.half + (i + 0.5) * G.cell, py = -G.half + (j + 0.5) * G.cell, l1 = ((px-a[0]) * (d[1]-a[1]) - (d[0]-a[0]) * (py-a[1])) / det, l2 = ((b[0]-a[0]) * (py-a[1]) - (px-a[0]) * (b[1]-a[1])) / det, l0 = 1 - l1 - l2;
      if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue; const z = l0 * a[2] + l1 * b[2] + l2 * d[2], k = i * side + j; if (!(H[k] >= z)) H[k] = z; }
  }
  return H;
}
// small holes in a field (cells no triangle covered) are filled from round them; the cloth's own edge is not grown
const fillHoles = (H, rounds = 8) => { const side = Math.round(2 * NAVEL_FIELD.half / NAVEL_FIELD.cell); for (let r = 0; r < rounds; r++) { const next = Float64Array.from(H); let filled = 0; for (let i = 1; i < side - 1; i++) for (let j = 1; j < side - 1; j++) { const k = i * side + j; if (Number.isFinite(H[k])) continue; let s = 0, n = 0; for (const q of [k - 1, k + 1, k - side, k + side, k - side - 1, k - side + 1, k + side - 1, k + side + 1]) if (Number.isFinite(H[q])) { s += H[q]; n++; } if (n >= 4) { next[k] = s / n; filled++; } } H.set(next); if (!filled) break; } return H; };
const fieldAt = (H, x, y) => { const G = NAVEL_FIELD, side = Math.round(2 * G.half / G.cell), fx = (x + G.half) / G.cell - 0.5, fy = (y + G.half) / G.cell - 0.5, i = Math.floor(fx), j = Math.floor(fy); if (i < 0 || j < 0 || i >= side - 1 || j >= side - 1) return NaN; const tx = fx - i, ty = fy - j, h00 = H[i*side+j], h10 = H[(i+1)*side+j], h01 = H[i*side+j+1], h11 = H[(i+1)*side+j+1]; return (1-tx) * (1-ty) * h00 + tx * (1-ty) * h10 + (1-tx) * ty * h01 + tx * ty * h11; };
// the same, but 0 where the field has nothing (a relief is 0 at and past the edge it fades out to)
const fieldAt0 = (H, x, y) => { const h = fieldAt(H, x, y); return Number.isFinite(h) ? h : 0; };
const FIELD_SIDE = Math.round(2 * NAVEL_FIELD.half / NAVEL_FIELD.cell), cellU = (i) => -NAVEL_FIELD.half + (i + 0.5) * NAVEL_FIELD.cell;
// how far each cell is from the nearest empty one (cm; Infinity if none is), so a relief can fade out at the hem's edge
function edgeDistance(H) {
  const s = FIELD_SIDE, c = NAVEL_FIELD.cell, c2 = c * Math.SQRT2, D = Float64Array.from(H, (h) => Number.isFinite(h) ? Infinity : 0);
  for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) { const k = i * s + j; let m = D[k]; if (i > 0) { m = Math.min(m, D[k-s] + c); if (j > 0) m = Math.min(m, D[k-s-1] + c2); if (j < s - 1) m = Math.min(m, D[k-s+1] + c2); } if (j > 0) m = Math.min(m, D[k-1] + c); D[k] = m; }
  for (let i = s - 1; i >= 0; i--) for (let j = s - 1; j >= 0; j--) { const k = i * s + j; let m = D[k]; if (i < s - 1) { m = Math.min(m, D[k+s] + c); if (j > 0) m = Math.min(m, D[k+s-1] + c2); if (j < s - 1) m = Math.min(m, D[k+s+1] + c2); } if (j < s - 1) m = Math.min(m, D[k+1] + c); D[k] = m; }
  return D;
}
// THE THIN PLATE under a field round her navel (E, for cloth, its distance from its own edge): on a grid
// NAVEL_PLATE_CELL apart the cells inside NAVEL_DISK and clear of the edge are free, and the cells round them -- two
// rings outside the disk, and those within NAVEL_HEM_HOLD of the cloth's edge -- hold the field's own height. The free
// cells take the discrete biharmonic between them (the 13-point stencil), by conjugate gradients from the field itself.
// A function of (u, v), NaN where the grid has nothing; null if the disk has no free cells (her navel under the hem).
const PLATE_STENCIL = [[0, 0, 20], [1, 0, -8], [-1, 0, -8], [0, 1, -8], [0, -1, -8], [1, 1, 2], [1, -1, 2], [-1, 1, 2], [-1, -1, 2], [2, 0, 1], [-2, 0, 1], [0, 2, 1], [0, -2, 1]];
let plateWorst = 0;
function thinPlate(H, E) {
  const c = NAVEL_PLATE_CELL, n = Math.ceil(NAVEL_DISK / c) + 3, s = 2 * n + 1, val = new Float64Array(s * s).fill(NaN), free = new Uint8Array(s * s);
  for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) { const u = (i - n) * c, v = (j - n) * c, h = fieldAt(H, u, v); if (!Number.isFinite(h)) continue; val[i*s+j] = h;
    if (Math.hypot(u, v) < NAVEL_DISK && !(E && !(fieldAt(E, u, v) >= NAVEL_HEM_HOLD))) free[i*s+j] = 1; }
  // a free cell needs its whole stencil on the field; one without it holds its own height
  for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) if (free[i*s+j] && PLATE_STENCIL.some(([a, b]) => !Number.isFinite(val[(i+a)*s+(j+b)]))) free[i*s+j] = 0;
  const ids = []; for (let k = 0; k < s * s; k++) if (free[k]) ids.push(k);
  if (ids.length < 12) return null;
  const at = new Int32Array(s * s).fill(-1); ids.forEach((k, q) => { at[k] = q; });
  const m = ids.length, x = new Float64Array(m), b = new Float64Array(m), r = new Float64Array(m), p = new Float64Array(m), Ap = new Float64Array(m);
  const apply = (v, out) => { for (let q = 0; q < m; q++) { const k = ids[q]; let sum = 0; for (const [di, dj, w] of PLATE_STENCIL) { const kk = k + di * s + dj; if (free[kk]) sum += w * v[at[kk]]; } out[q] = sum; } };
  for (let q = 0; q < m; q++) { const k = ids[q]; let sum = 0; for (const [di, dj, w] of PLATE_STENCIL) { const kk = k + di * s + dj; if (!free[kk]) sum -= w * val[kk]; } b[q] = sum; x[q] = val[k]; }
  apply(x, Ap); let rr = 0, bb = 0; for (let q = 0; q < m; q++) { r[q] = b[q] - Ap[q]; p[q] = r[q]; rr += r[q] * r[q]; bb += b[q] * b[q]; }
  let it = 0; for (; it < 20000 && rr > 1e-26 * bb; it++) { apply(p, Ap); let pAp = 0; for (let q = 0; q < m; q++) pAp += p[q] * Ap[q]; const al = rr / pAp; let r2 = 0; for (let q = 0; q < m; q++) { x[q] += al * p[q]; r[q] -= al * Ap[q]; r2 += r[q] * r[q]; } const be = r2 / rr; rr = r2; for (let q = 0; q < m; q++) p[q] = r[q] + be * p[q]; }
  if (rr > 1e-20 * bb) throw Error(`The thin plate did not settle (${it} steps)`); plateWorst = Math.max(plateWorst, it);
  for (let q = 0; q < m; q++) val[ids[q]] = x[q];
  return (u, v) => { const fx = u / c + n, fy = v / c + n, i = Math.floor(fx), j = Math.floor(fy); if (i < 0 || j < 0 || i >= s - 1 || j >= s - 1) return NaN; const tx = fx - i, ty = fy - j; return (1-tx) * (1-ty) * val[i*s+j] + tx * (1-ty) * val[(i+1)*s+j] + (1-tx) * ty * val[i*s+j+1] + tx * ty * val[(i+1)*s+j+1]; };
}
// a field less its thin plate, inside the disk (and, eased out, over the rings that hold it); 0 elsewhere
const RELIEF_R = NAVEL_DISK + 2 * NAVEL_PLATE_CELL;
function relief(H, plate) {
  const s = FIELD_SIDE, out = new Float64Array(s * s); if (!plate) return out;
  for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) { const k = i * s + j, h = H[k], u = cellU(i), v = cellU(j), d = Math.hypot(u, v); if (!Number.isFinite(h) || d >= RELIEF_R) continue; const q = plate(u, v); if (Number.isFinite(q)) out[k] = (h - q) * (1 - ramp(d, NAVEL_DISK, RELIEF_R)); }
  return out;
}
// her outie at a size, as a relief over the thin plate of her skin round it
const outieAt = (F) => { const S = fillHoles(heightField(F, F.B, navelTris)), plate = thinPlate(S, null); if (!plate) throw Error('No skin round her navel'); return { S, R: relief(S, plate) }; };
// the smoothing's weight at a fit, with her navel's core left alone
const coreWeight = (X, F) => Float64Array.from(weight, (w, j) => { if (!w) return 0; const r = Math.hypot(X[j*3]-F.c[0], X[j*3+1]-F.c[1], X[j*3+2]-F.c[2]); return w * ramp(r, ...NAVEL_CORE); });

// ---- 1. THE FITS ARE SMOOTHED: each fit's correction is added to its own `shape:fitBelly<key>` target, so between fits
// the shirt is the blend of smoothed fits, as it was the blend of fits ----
{ const fits = FIT_KEYS.map((k) => { const at = shirt.names.indexOf(`shape:fitBelly${k}`); if (at < 0) throw Error(`The shirt has no shape:fitBelly${k}`); return { k, target: prim.listTargets()[at], RN: rawNormals(k), X0: nodesOf(evaluate(shirt, prim, baseWeights(k))) }; });
  for (const f of fits) { f.F = navelFrame(f.k); f.wt = coreWeight(f.X0, f.F); const Xs = smooth(f.X0, f.wt), r = carryInner(f.X0, Xs); f.X1 = r.X; log(`fitBelly${f.k} smoothed: ${moveStats(f.X0, f.X1)}; ${r.carried} inner points carried; her navel at y ${f.F.c[1].toFixed(1)} z ${f.F.c[2].toFixed(1)} kept`); }
  for (const f of fits) { const { pos, nrm } = asTarget(f.X0, f.X1, f.RN), P = read(f.target.getAttribute('POSITION')), Nm = read(f.target.getAttribute('NORMAL'));
    smoothNormals(f.X1, f.RN, nrm, f.wt);
    for (let i = 0; i < P.length; i++) { P[i] += pos[i]; Nm[i] += nrm[i]; }
    f.target.setAttribute('POSITION', accessor(onLattice(P, POSITION_STEP))); f.target.setAttribute('NORMAL', accessor(onLattice(Nm, NORMAL_STEP))); } }

if (args.includes('--smooth-only')) { const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder }); await shirt.doc.transform(prune({ keepLeaves: true }), unpartition()); shirt.doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE }); await io.write(opt('out'), shirt.doc); log('written (smoothed fits only)', opt('out')); process.exit(0); }

// ---- 2. THE LIFT, every 10% on the smoothed shirt (sources persist so checks between keys can add to them) ----
const keys = new Map(), candidates = new Set();
// the lift goes along the outer layer's normal; within LIFT_EDGE cm of a fold-back, where the cloth turns under, along
// the normal of the band a little further in, so a hem riding over her navel is pushed out rather than down
const LIFT_EDGE = 0.8;
// and is itself smooth (an average over LIFT_DIR_SIGMA): lifted centimetres along each point's own normal, the
// coarse cloth below her navel crumpled
function liftNormals(X0) {
  const Ns = normalsOf(X0, outerTris), edge = outerIds.filter((j) => foldOf(j) < LIFT_EDGE);
  if (edge.length) { const R = 1.5, g = gridOf(X0, outerIds.filter((j) => foldOf(j) >= LIFT_EDGE && foldOf(j) < LIFT_EDGE + 1.5), R), out = Float64Array.from(Ns);
    for (const j of edge) { const n = near(g, X0, j, R); let sx = 0, sy = 0, sz = 0; for (let k = 0; k < n; k++) { const u = nearBuf[k], d2 = (X0[u*3]-X0[j*3]) ** 2 + (X0[u*3+1]-X0[j*3+1]) ** 2 + (X0[u*3+2]-X0[j*3+2]) ** 2; if (d2 > R * R) continue; const w = Math.exp(-d2 / 0.5); sx += w * Ns[u*3]; sy += w * Ns[u*3+1]; sz += w * Ns[u*3+2]; } const l = Math.hypot(sx, sy, sz); if (l > 1e-9) { out[j*3] = sx / l; out[j*3+1] = sy / l; out[j*3+2] = sz / l; } }
    Ns.set(out); }
  const R = 3 * LIFT_DIR_SIGMA, s2 = 2 * LIFT_DIR_SIGMA * LIFT_DIR_SIGMA, A = areasOf(X0), ids = liftDomain(X0), g = gridOf(X0, outerIds, R), out = Float64Array.from(Ns);
  for (const j of ids) { const n = near(g, X0, j, R); let sx = 0, sy = 0, sz = 0; for (let k = 0; k < n; k++) { const u = nearBuf[k], d2 = (X0[u*3]-X0[j*3]) ** 2 + (X0[u*3+1]-X0[j*3+1]) ** 2 + (X0[u*3+2]-X0[j*3+2]) ** 2; if (d2 > R * R) continue; const w = A[u] * Math.exp(-d2 / s2); sx += w * Ns[u*3]; sy += w * Ns[u*3+1]; sz += w * Ns[u*3+2]; } const l = Math.hypot(sx, sy, sz); if (l > 1e-9) { out[j*3] = sx / l; out[j*3+1] = sy / l; out[j*3+2] = sz / l; } }
  return out;
}
// the approved navel at each fit (after the smoothing round it, which leaves the core alone), as reliefs: the cloth's
// (`remove`, at each cloth point that carries it, along the fit's frame normal) and the cloth's stand-off over her
// outie (`standOff`, a field lined up on her navel)
const fitNavel = new Map(FIT_KEYS.map((k) => {
  const F = navelFrame(k), X = nodesOf(evaluate(shirt, prim, baseWeights(k))), H = fillHoles(heightField(F, X, outerTris), 2), E = edgeDistance(H), plate = thinPlate(H, E), skin = outieAt(F), remove = new Map();
  if (!plate) { log(`fitBelly${k}: her navel is under the hem; no navel relief to carry`); return [k, { F, remove, standOff: new Float64Array(FIELD_SIDE * FIELD_SIDE) }]; }
  const D = relief(H, plate), G = Float64Array.from(H, (h, i) => h - skin.S[i]), standOff = relief(G, thinPlate(G, E));
  let most = 0; for (const j of outerIds) { const p = toFrame(F, X[j*3], X[j*3+1], X[j*3+2]); if (Math.hypot(p[0], p[1]) >= RELIEF_R || Math.abs(p[2]) > 3) continue; const h = fieldAt(H, p[0], p[1]); if (!(p[2] > h - 0.3)) continue; const d = fieldAt0(D, p[0], p[1]); if (Math.abs(d) > 1e-6) { remove.set(j, d); most = Math.max(most, Math.abs(d)); } }
  log(`fitBelly${k}: her navel's relief on ${remove.size} outer points, most ${(most * 10).toFixed(2)} mm`);
  return [k, { F, remove, standOff }];
}));
function carryNavel(X0, k) {
  if (FIT_KEYS.includes(k)) return { X: X0, W: new Float64Array(N), moved: 0, most: 0 };
  let lo = 0; while (lo < FIT_KEYS.length - 2 && k > FIT_KEYS[lo + 1]) lo++; const a = FIT_KEYS[lo], b = FIT_KEYS[lo + 1], t = (k - a) / (b - a), A = fitNavel.get(a), B = fitNavel.get(b);
  // 1. the fits' two navels come out of the blend, as the blend put them in
  const X = Float64Array.from(X0); for (const [f, w] of [[A, 1 - t], [B, t]]) for (const [j, d] of f.remove) for (let e = 0; e < 3; e++) X[j*3+e] -= w * d * f.F.n[e];
  // 2. one goes in where her navel is: her outie at this size, the stand-off over it as the fits either side held it
  const F = navelFrame(k), { R } = outieAt(F), Xs = Float64Array.from(X);
  for (const j of outerIds) { const p = toFrame(F, Xs[j*3], Xs[j*3+1], Xs[j*3+2]); if (Math.hypot(p[0], p[1]) >= RELIEF_R || Math.abs(p[2]) > 3) continue;
    const d = fieldAt0(R, p[0], p[1]) + (1 - t) * fieldAt0(A.standOff, p[0], p[1]) + t * fieldAt0(B.standOff, p[0], p[1]); for (let e = 0; e < 3; e++) X[j*3+e] += d * F.n[e]; }
  // (the light follows the moved cloth: see settleNormals)
  const W = new Float64Array(N); let moved = 0, most = 0;
  for (const j of outerIds) { const m = Math.hypot(X[j*3]-X0[j*3], X[j*3+1]-X0[j*3+1], X[j*3+2]-X0[j*3+2]); if (!(m > 0)) continue; W[j] = Math.min(1, m / 0.02); if (m > 0.005) moved++; most = Math.max(most, m); }
  return { X, W, moved, most };
}
// HER OUTIE'S TIP BETWEEN CLOTH POINTS: the lift keeps the cloth's points FLOOR off her, but a sharp point of skin can
// come up between them (a speck of her outie showed through at 165%, and two at the 150% fit itself, a tenth of a
// millimetre through). So her skin round her navel is kept NAVEL_FLOOR under the outer layer too, wherever the cloth is
// over it, at every key, the fits included: each point of it that is not lifts the corners of the cloth there. At a fit
// that is the smallest lift that covers her outie; the approved navel is otherwise as it was.
const NAVEL_SKIN_R = 3, NAVEL_FLOOR = 0.03;
const navelSkinIds = (() => { const B = evaluate(body, body.body, defaults(lab, 100)), c = [B[navelVert*3], B[navelVert*3+1], B[navelVert*3+2]], ids = new Set(); for (const i of navelTris) if (Math.hypot(B[i*3]-c[0], B[i*3+1]-c[1], B[i*3+2]-c[2]) < NAVEL_SKIN_R) ids.add(i); return [...ids]; })();
// her skin round her navel at a size, with its normals
const navelSkinAt = (b) => {
  const B = evaluate(body, body.body, defaults(lab, b)), Nn = new Float64Array(B.length), P = new Float64Array(navelSkinIds.length * 3), Q = new Float64Array(navelSkinIds.length * 3);
  for (let t = 0; t < navelTris.length; t += 3) { const [a, c, d] = [navelTris[t]*3, navelTris[t+1]*3, navelTris[t+2]*3], ux = B[c]-B[a], uy = B[c+1]-B[a+1], uz = B[c+2]-B[a+2], vx = B[d]-B[a], vy = B[d+1]-B[a+1], vz = B[d+2]-B[a+2], nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx; for (const j of [a, c, d]) { Nn[j] += nx; Nn[j+1] += ny; Nn[j+2] += nz; } }
  navelSkinIds.forEach((i, q) => { const l = Math.hypot(Nn[i*3], Nn[i*3+1], Nn[i*3+2]) || 1; for (let e = 0; e < 3; e++) { P[q*3+e] = B[i*3+e]; Q[q*3+e] = Nn[i*3+e] / l; } });
  return { P, Q, c: [B[navelVert*3], B[navelVert*3+1], B[navelVert*3+2]] };
};
function navelShortfalls(X, at, out) {
  const tris = []; for (let t = 0; t < outerTris.length; t += 3) { const a = outerTris[t]; if (Math.hypot(X[a*3]-at.c[0], X[a*3+1]-at.c[1], X[a*3+2]-at.c[2]) < NAVEL_SKIN_R + 3) tris.push(outerTris[t], outerTris[t+1], outerTris[t+2]); }
  if (!tris.length) return out; const oc = new SkinCollider(X, tris), q = [0, 0, 0];
  for (let i = 0; i < at.P.length; i += 3) { q[0] = at.P[i]; q[1] = at.P[i+1]; q[2] = at.P[i+2]; const h = oc.closest(q); if (!h || h.distance > 2) continue;
    // the cloth is over her here only if its nearest point is not the hem's turned edge (her navel below the hem), its
    // face looks the way her skin does (not the underside of the turned edge), and it is straight out from her
    const t = h.triangle * 3, v = [tris[t], tris[t+1], tris[t+2]];
    if (h.normal[0] * at.Q[i] + h.normal[1] * at.Q[i+1] + h.normal[2] * at.Q[i+2] < 0.5) continue;
    { const A = v.map((j) => [X[j*3], X[j*3+1], X[j*3+2]]), e0 = [0, 1, 2].map((e) => A[1][e] - A[0][e]), e1 = [0, 1, 2].map((e) => A[2][e] - A[0][e]), rp = [0, 1, 2].map((e) => h.point[e] - A[0][e]);
      const d00 = e0[0]*e0[0]+e0[1]*e0[1]+e0[2]*e0[2], d01 = e0[0]*e1[0]+e0[1]*e1[1]+e0[2]*e1[2], d11 = e1[0]*e1[0]+e1[1]*e1[1]+e1[2]*e1[2], d20 = rp[0]*e0[0]+rp[1]*e0[1]+rp[2]*e0[2], d21 = rp[0]*e1[0]+rp[1]*e1[1]+rp[2]*e1[2], den = d00 * d11 - d01 * d01 || 1;
      const bv = (d11 * d20 - d01 * d21) / den, bw = (d00 * d21 - d01 * d20) / den, bary = [1 - bv - bw, bv, bw], on = v.filter((j, e) => bary[e] > 1e-5);
      if (on.length < 3 && on.every((j) => fold[j] === 0)) continue; }
    const up = -h.planeDistance, side = Math.hypot(h.point[0] - q[0] - up * h.normal[0], h.point[1] - q[1] - up * h.normal[1], h.point[2] - q[2] - up * h.normal[2]); if (side > 0.02 + 0.2 * h.distance) continue;
    const s = NAVEL_FLOOR - up; if (s <= SHORT) continue; for (const j of v) out.set(j, Math.max(out.get(j) ?? 0, s)); }
  return out;
}
for (const k of FINE_KEYS) {
  const X0 = nodesOf(evaluate(shirt, prim, baseWeights(k))), c = carryNavel(X0, k), Xb = c.X, Ns = liftNormals(Xb), cand = nearSkin(Xb, skinAt(k), liftDomain(Xb));
  for (const j of cand) candidates.add(j);
  const navel = navelSkinAt(k), under = navelShortfalls(Xb, navel, new Map()); let worst = 0; for (const s of under.values()) worst = Math.max(worst, s);
  if (c.moved) log(`fineFit${k}: her navel carried from the fits either side: ${c.moved} outer points, most ${(c.most * 10).toFixed(2)} mm`);
  if (under.size) log(`fineFit${k}: her skin round her navel comes within ${(NAVEL_FLOOR * 10).toFixed(1)} mm of the cloth under ${under.size} cloth points, by up to ${(worst * 10).toFixed(2)} mm`);
  keys.set(k, { X0, Xb, Wc: c.W, Ns, cand, navel, legs: legsAt(k), sources: new Map(), X1: Xb });
}
log(`${candidates.size} outer points close enough to her to be lifted at some size; the thin plates under her navel settled in at most ${plateWorst} steps`);
const addSource = (K, j, s) => K.sources.set(j, Math.min(MAX_LIFT, (K.sources.get(j) ?? 0) + s));
function liftKey(k) {
  const K = keys.get(k), skin = skinAt(k);
  for (let round = 0; round < LIFT_ROUNDS; round++) {
    const X = lifted(K.Xb, K.sources, K.Ns), short = navelShortfalls(X, K.navel, legShortfalls(X, K.legs, shortfalls(X, skin, K.cand)));
    if (!short.size) { K.X1 = X; return round; }
    for (const [j, s] of short) addSource(K, j, s);
  }
  K.X1 = lifted(K.Xb, K.sources, K.Ns); return LIFT_ROUNDS;
}
const liftStats = (k) => { const K = keys.get(k); let lift = 0, at = null; for (const [j, v] of K.sources) if (v > lift) { lift = v; at = j; } return `${moveStats(K.X0, K.X1)}; lifted from ${K.sources.size} points, most ${(lift*10).toFixed(2)} mm${at === null ? '' : ` at y ${K.X0[at*3+1].toFixed(1)} z ${K.X0[at*3+2].toFixed(1)} x ${K.X0[at*3].toFixed(1)}, ${foldOf(at).toFixed(1)} cm from a fold-back`}`; };
for (const k of FINE_KEYS) { const r = liftKey(k); log(`fineFit${k}: ${liftStats(k)} (${r} lift rounds)`); }

// ---- the blended result, every CHECK_STEP: anything short between keys lifts the keys around it ----
const blendAt = (b) => { const w = Object.entries(keyWeights(b, '', FINE_KEYS)).map(([k, v]) => [Number(k), v]), X = nodesOf(evaluate(shirt, prim, baseWeights(b))); for (const [k, v] of w) { const K = keys.get(k); for (let i = 0; i < X.length; i++) X[i] += v * (K.X1[i] - K.X0[i]); } return { X, w }; };
const checkIds = [...candidates];
for (let round = 0; round < (process.env.FINE_ONLY ? 0 : CHECK_ROUNDS); round++) {
  const touched = new Set(), report = [];
  for (const b of CHECK_SIZES) {
    const { X, w } = blendAt(b), short = navelShortfalls(X, navelSkinAt(b), legShortfalls(X, legsAt(b), shortfalls(X, skinAt(b), checkIds)));
    if (!short.size) continue; let worst = 0; for (const s of short.values()) worst = Math.max(worst, s); report.push(`${b}%:${short.size}pts/${(worst*10).toFixed(2)}mm`);
    // a fit's own approved shape is never lifted here: the key on the other side takes all of it
    const fit = w.find(([k]) => FIT_KEYS.includes(k)), other = fit && w.find(([k]) => !FIT_KEYS.includes(k));
    if (other) { const K = keys.get(other[0]); for (const [j, s] of short) addSource(K, j, s / other[1]); touched.add(other[0]); }
    else for (const [k, v] of w) { const K = keys.get(k), share = v / (v * v + (1 - v) * (1 - v)); for (const [j, s] of short) addSource(K, j, s * share); touched.add(k); }
  }
  log(`check ${round}: ${report.length ? report.join(' ') : 'nothing short between keys'}`);
  if (!touched.size) break;
  for (const k of touched) liftKey(k);
}

// ---- 3. the inner layer follows each lift; the lifts are written as `shape:fineFit<key>`. Where her navel was carried
// or the cloth lifted, the light follows the moved cloth itself: its normals, averaged over SETTLE_SIGMA, replace the
// fits' stored ones (blended between two fits, those still held each fit's navel shading in its own place) ----
// The average is over the cloth's FACES, each by its own area, so it is the cloth's mean direction round the point
// whatever the triangles are like: at her navel's tip the cloth is a few long slivers, and an average of the points'
// own normals there left a bright fleck at 150% and 155%. A fit keeps its approved normals (its lift is only the
// smallest shift that covers her outie's tip), with the turn of that shift added.
const SETTLE_SIGMA = 0.4;
function settleNormals(X, RN, turn, wN) {
  const R = 3 * SETTLE_SIGMA, s2 = 2 * SETTLE_SIGMA * SETTLE_SIGMA, nF = outerTris.length / 3, C = new Float64Array(nF * 3), Fn = new Float64Array(nF * 3), faces = new Array(nF), out = new Map();
  for (let f = 0; f < nF; f++) { const a = outerTris[f*3]*3, b = outerTris[f*3+1]*3, c = outerTris[f*3+2]*3, ux = X[b]-X[a], uy = X[b+1]-X[a+1], uz = X[b+2]-X[a+2], vx = X[c]-X[a], vy = X[c+1]-X[a+1], vz = X[c+2]-X[a+2];
    for (let e = 0; e < 3; e++) C[f*3+e] = (X[a+e] + X[b+e] + X[c+e]) / 3; Fn[f*3] = uy*vz-uz*vy; Fn[f*3+1] = uz*vx-ux*vz; Fn[f*3+2] = ux*vy-uy*vx; faces[f] = f; }
  const g = gridOf(C, faces, R);
  for (const j of outerIds) { if (!(wN[j] > 0)) continue; const n = near(g, X, j, R); let sx = 0, sy = 0, sz = 0; for (let k = 0; k < n; k++) { const f = nearBuf[k], d2 = (C[f*3]-X[j*3]) ** 2 + (C[f*3+1]-X[j*3+1]) ** 2 + (C[f*3+2]-X[j*3+2]) ** 2; if (d2 > R * R) continue; const w = Math.exp(-d2 / s2); sx += w * Fn[f*3]; sy += w * Fn[f*3+1]; sz += w * Fn[f*3+2]; } const l = Math.hypot(sx, sy, sz); if (l > 1e-12) out.set(j, [sx / l, sy / l, sz / l]); }
  for (let i = 0; i < nV; i++) { const j = node[i], gN = out.get(j); if (!gN) continue; const v = [RN[i*3] + turn[i*3], RN[i*3+1] + turn[i*3+1], RN[i*3+2] + turn[i*3+2]], len = Math.hypot(...v) || 1, d = apply(shirt.T, v, 0), dl = Math.hypot(...d) || 1, w = wN[j];
    let o = [0, 1, 2].map((e) => (1 - w) * d[e] / dl + w * gN[e]); const ol = Math.hypot(...o) || 1; o = o.map((x) => x / ol); const nv = apply(shirt.Ti, o, 0).map((x) => x * shirt.tS * len); for (let e = 0; e < 3; e++) turn[i*3+e] = nv[e] - RN[i*3+e]; }
}
for (const k of FINE_KEYS) {
  const K = keys.get(k), r = carryInner(K.X0, K.X1), RN = rawNormals(k), { pos, nrm } = asTarget(K.X0, r.X, RN), wN = Float64Array.from(K.Wc);
  for (const j of outerIds) { const d = Math.hypot(K.X1[j*3]-K.Xb[j*3], K.X1[j*3+1]-K.Xb[j*3+1], K.X1[j*3+2]-K.Xb[j*3+2]); if (d > 0) wN[j] = Math.max(wN[j], Math.min(1, d / 0.05)); }
  if (!FIT_KEYS.includes(k)) settleNormals(r.X, RN, nrm, wN);
  log(`fineFit${k}: ${liftStats(k)}; ${r.carried} inner points carried`);
  onLattice(pos, POSITION_STEP); onLattice(nrm, NORMAL_STEP);
  const name = `shape:fineFit${k}`, t = shirt.doc.createPrimitiveTarget(name);
  t.setAttribute('POSITION', accessor(pos)); t.setAttribute('NORMAL', accessor(nrm)); prim.addTarget(t);
}
shirt.names.push(...FINE_KEYS.map((k) => `shape:fineFit${k}`));
shirt.mesh.setWeights([...shirt.mesh.getWeights(), ...FINE_KEYS.map(() => 0)]);
shirt.mesh.setExtras({ ...shirt.mesh.getExtras(), targetNames: shirt.names, recoveredShirt: { ...meta, fineFitKeys: FINE_KEYS, fineFit: { script: 'scripts/sarahV2Recovery/shirt-fine-fit.mjs', fitsSmoothed: FIT_KEYS, smoothSigmaCm: SMOOTH_SIGMA, smoothRounds: SMOOTH_ROUNDS, floorCm: FLOOR, liftSigmaCm: LIFT_SIGMA, region: REGION } } });
const doc = shirt.doc; await doc.transform(prune({ keepLeaves: true }), unpartition());
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
await io.write(opt('out'), doc); log('written', opt('out'));
