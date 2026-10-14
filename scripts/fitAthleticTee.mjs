/**
 * THE ATHLETIC-FIT TEE (Joshua, 2026-10-14): "a soft, stretchy spandex-blend shirt…
 * follow the natural rounded shape of the bust more closely, curve gently inward
 * beneath the bust, without creating sharp creases… follow the belly's rounded profile
 * rather than bridging straight across… remain a separate garment with a small,
 * consistent clearance above the skin… preserve a smooth, visible hem that overlaps
 * the leggings, with a little freedom at the bottom." And: keep the grown tee as the
 * RELAXED fit; this is the ATHLETIC fit, beside it.
 *
 * The shipped tee (`shirt`) is never edited: it is the Relaxed Fit. This adds a second
 * primitive, `shirtAthletic`, cut exactly as a grown tee is cut (its seams, UVs, sewn
 * bands and painted texture) and re-fitted to her, region by region:
 *
 *   WHERE ON HER. Every grown garment vertex records the skin it was grown from
 *   (`_SKIN_AT`, written by `growClothes.mjs`). The fit reads that, never a
 *   nearest-point search: under the bust the grown tee spans the crease and folds, and a
 *   search sent that cloth to the bottom of the crease all at once, which is the sharp
 *   line Joshua saw. Because the cloth keeps the skin's own layout, it cannot fold.
 *
 *   THE SURFACE IT FOLLOWS. Her skin with its creases softened: eased outward
 *   (`SOFT_PASSES`; a rounded part may sink at most `SINK_M` before the clearance
 *   check lifts it back). The bust and the bump keep their shape; under the bust the
 *   cloth curves in, softly, instead of cutting into the crease or tenting across.
 *
 *   HOW CLOSELY. `REACH` of the way from the grown tee onto that surface, `GAP_M` off
 *   it (more where the leggings' maternity panel lies under it). Less near the
 *   neckline (`NECK_M`) so its sewn edge keeps its cut; less at the bottom hem
 *   (`HEM_FREE`) so the hem stands a little free over the leggings; none on the
 *   sleeves and armpits (`ARM_SHARE`), which stay as cut. A sewn band's two layers
 *   keep the distance between them.
 *
 *   CLEARANCE. Then every fitted point is held `CLEAR_M` off her real skin and
 *   `OVER_LEGGINGS_M` over the leggings, with light relaxing between, so a push never
 *   leaves a ridge.
 *
 *   BENDING. Weights and every shape (belly sizes, breasts, bounce, the seated
 *   corrective) are taken from the skin it lies on, as far as it was fitted, so it
 *   moves exactly as she does.
 *
 * The body, the Relaxed tee and every other garment are untouched.
 *
 *   node scripts/fitAthleticTee.mjs <shipped.glb> [<grown.glb>]
 *
 * `grown.glb` is a fresh `bake:sarah-clothes` output carrying `_SKIN_AT`; the shipped
 * file's body, which is approved and never rebaked, is the skin it is fitted to.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

export const ATHLETIC = 'shirtAthletic';
/** How much of the way from the grown tee onto her softened skin, on the trunk. */
export const REACH = 0.95;
/** The cloth's inner face this far off the softened skin. */
export const GAP_M = 0.004;
/** And never nearer her real skin than this, or the leggings than OVER_LEGGINGS_M. */
export const CLEAR_M = 0.0025;
export const OVER_LEGGINGS_M = 0.0025;
/** Passes easing her skin outward to make the surface the cloth follows. */
export const SOFT_PASSES = 120;
/** The easing may sink this far under a rounded part (the clearance check lifts it back). */
export const SINK_M = 0.003;
/** The neckline keeps its cut: the fit fades in over this distance from it. */
export const NECK_M = [0.006, 0.035];
/** The bottom hem stands this free at its edge (a share of REACH), back to full by HEM_FREE_M up. */
export const HEM_FREE = 0.45;
export const HEM_FREE_M = 0.07;
/** The sleeves and armpits stay as cut: the fit fades out as the skin's share of her arm bones rises through this. */
export const ARM_SHARE = [0.5, 0.8];
/** Extra standing-off at the armpit, metres, where the skin's arm share rises through the first pair and falls through the second. */
export const ARMPIT_M = 0.006;
export const ARMPIT_SHARE = [0.1, 0.3, 0.6, 0.85];
/** The neckline is the cut edge above this height (metres) within 20 cm of her middle; its scoop dips to about 1.2 m. */
export const NECK_FROM_Y = 1.15;
/** At a grown size the cloth keeps this many times its standing-off, turned with her skin (a little more than once: the skin stretches thinner over a bigger bump). */
export const SHAPE_CLEAR = 1.6;
/** Softening passes for the belly and bust sizes' moves (the base takes SOFT_PASSES). */
export const SHAPE_SOFT_PASSES = 400;
/** How much of a point's stand-off turns with her skin's normal under a shape. */
export const TURN_M = 0.004;
/** Passes easing each belly size's move across the fitted cloth. */
export const SHAPE_EASE = 150;
/** Passes spreading each grown-size clearance push into the cloth around it. */
export const LIFT_SPREAD = 30;
/** How much of the grown tee's span the cloth keeps over the hollow between the shoulder blades. */
export const BACK_BRIDGE = 0.75;
/** Leggings within UNDER_TOP_M of the tee and UNDER_TOP_HEM_M or more from its hem are hidden under it. */
export const UNDER_TOP_M = 0.03;
export const UNDER_TOP_HEM_M = 0.02;
/** Passes easing the skin weights across the cloth. */
export const WEIGHT_EASE = 10;
/** Passes smoothing the bottom hem's edge along itself. */
export const HEM_EASE = 120;
/** Passes smoothing the neckline's edge along itself. */
export const NECK_EASE = 250;
/** Passes relaxing the fitted cloth between clearance checks. */
export const RELAX_PASSES = 6;

const mul = (x, y) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) o[c * 4 + r] += x[k * 4 + r] * y[c * 4 + k]; return o; };
const invert = (m) => {
  const [a, b, c, , d, e, f, , g, h, i] = m, det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const r = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, 0, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, 0, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det, 0, 0, 0, 0, 1];
  r[12] = -(r[0] * m[12] + r[4] * m[13] + r[8] * m[14]); r[13] = -(r[1] * m[12] + r[5] * m[13] + r[9] * m[14]); r[14] = -(r[2] * m[12] + r[6] * m[13] + r[10] * m[14]);
  return r;
};
const apply = (m, v, w) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + w * m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + w * m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + w * m[14]];
const read = (A) => { const n = A.getCount(), s = A.getElementSize(), out = new Float32Array(n * s), v = []; for (let i = 0; i < n; i += 1) { A.getElement(i, v); for (let c = 0; c < s; c += 1) out[i * s + c] = v[c]; } return out; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const toMetres = (doc) => { const skin = doc.getRoot().listSkins()[0]; return mul(skin.listJoints()[0].getWorldMatrix(), Array.from(skin.getInverseBindMatrices().getArray().slice(0, 16))); };

function closestBary(p, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return [1, 0, 0];
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]], d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return [0, 1, 0];
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [1 - v, v, 0]; }
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return [0, 0, 1];
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [1 - w, 0, w]; }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [0, 1 - w, w]; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return [1 - v - w, v, w];
}
/** Closest point on a triangle surface (positions in metres), optionally only some triangles. */
function surface(pos, idx, keep = () => true, CELL = 0.02) {
  const cells = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    if (!keep(t)) continue;
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const lo = [0, 1, 2].map((k) => Math.min(pos[a + k], pos[b + k], pos[c + k])), hi = [0, 1, 2].map((k) => Math.max(pos[a + k], pos[b + k], pos[c + k]));
    for (let x = Math.floor(lo[0] / CELL); x <= Math.floor(hi[0] / CELL); x += 1) for (let y = Math.floor(lo[1] / CELL); y <= Math.floor(hi[1] / CELL); y += 1) for (let z = Math.floor(lo[2] / CELL); z <= Math.floor(hi[2] / CELL); z += 1) {
      const k = `${x},${y},${z}`; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(t);
    }
  }
  const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  return (p, maxR = 2) => {
    let best = null;
    for (let r = 0; r <= maxR; r += 1) {
      if (best && Math.sqrt(best.d2) <= r * CELL) break;
      const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL), cz = Math.floor(p[2] / CELL);
      for (let i = -r; i <= r; i += 1) for (let j = -r; j <= r; j += 1) for (let k = -r; k <= r; k += 1) {
        if (Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) !== r) continue;
        const l = cells.get(`${cx + i},${cy + j},${cz + k}`); if (!l) continue;
        for (const t of l) {
          const ia = idx[t], ib = idx[t + 1], ic = idx[t + 2], bc = closestBary(p, P(ia), P(ib), P(ic));
          const q = [0, 1, 2].map((d) => bc[0] * pos[ia * 3 + d] + bc[1] * pos[ib * 3 + d] + bc[2] * pos[ic * 3 + d]);
          const d2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
          if (!best || d2 < best.d2) best = { d2, tri: [ia, ib, ic], bc, q };
        }
      }
    }
    return best;
  };
}
/** A mix of vertices (indices and weights) applied to a per-vertex VEC3 array. */
const mixOf = (mix, arr) => { const o = [0, 0, 0]; for (let c = 0; c < mix.tri.length; c += 1) for (let d = 0; d < 3; d += 1) o[d] += mix.bc[c] * arr[mix.tri[c] * 3 + d]; return o; };

/** Vertices joined by position, their neighbours, and which lie on a cut edge. */
function welded(pos, idx) {
  const n = pos.length / 3, map = new Map(), id = new Int32Array(n);
  for (let i = 0; i < n; i += 1) { const k = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`; if (!map.has(k)) map.set(k, map.size); id[i] = map.get(k); }
  const W = map.size, nb = Array.from({ length: W }, () => new Set()), uses = new Map();
  for (let t = 0; t < idx.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
    const u = id[idx[t + a]], v = id[idx[t + b]]; if (u === v) continue;
    nb[u].add(v); nb[v].add(u); const k = u < v ? `${u},${v}` : `${v},${u}`; uses.set(k, (uses.get(k) || 0) + 1);
  }
  const edge = new Uint8Array(W); for (const [k, c] of uses) if (c === 1) for (const x of k.split(',')) edge[+x] = 1;
  return { id, W, nb, edge };
}
function normalsOf(pos, idx, wl) {
  const g = new Float32Array(wl.W * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2], vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const f = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const v of [a, b, c]) for (let d = 0; d < 3; d += 1) g[wl.id[v] * 3 + d] += f[d];
  }
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length / 3; i += 1) out.set(norm([g[wl.id[i] * 3], g[wl.id[i] * 3 + 1], g[wl.id[i] * 3 + 2]]), i * 3);
  return out;
}

export async function fitAthleticTee(file, grownFile = file, { log = console.log } = {}) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(file), src = await io.read(grownFile);
  const T = toMetres(doc), Ti = invert(T), Ts = toMetres(src);
  const mesh = doc.getRoot().listMeshes()[0], body = mesh.listPrimitives()[0], names = mesh.getExtras().targetNames;
  const byName = (m, name) => m.listPrimitives().find((p) => p.getMaterial()?.getName() === name);
  const leggings = byName(mesh, 'leggings');
  const sMesh = src.getRoot().listMeshes()[0], grown = byName(sMesh, 'shirt'), sNames = sMesh.getExtras().targetNames;
  if (!grown.getAttribute('_SKIN_AT')) throw new Error(`${grownFile}: its tee has no _SKIN_AT (rebake with the current growClothes.mjs)`);
  const inMetres = (prim, sem, w, M = T) => { const a = read(prim.getAttribute(sem)); for (let i = 0; i < a.length / 3; i += 1) a.set(apply(M, [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]], w), i * 3); return a; };
  const shapesOf = (prim, sem, M, order, want) => want.map((name) => { const t = prim.listTargets()[order.indexOf(name)], A = t?.getAttribute(sem); if (!A) return null; const d = read(A); for (let i = 0; i < d.length / 3; i += 1) d.set(apply(M, [d[i * 3], d[i * 3 + 1], d[i * 3 + 2]], 0), i * 3); return d; });

  // ── her skin (the shipped, approved body) ──
  const bPos = inMetres(body, 'POSITION', 1), bn = bPos.length / 3, bIdx = body.getIndices().getArray();
  if (sMesh.listPrimitives()[0].getAttribute('POSITION').getCount() !== bn) throw new Error('the grown file\'s body is not the shipped body (vertex counts differ)');
  const bWl = welded(bPos, bIdx), bNrm = normalsOf(bPos, bIdx, bWl);
  const bJ = read(body.getAttribute('JOINTS_0')), bW = read(body.getAttribute('WEIGHTS_0'));
  const bShapes = shapesOf(body, 'POSITION', T, names, names), bShapeN = shapesOf(body, 'NORMAL', T, names, names);
  const joints = doc.getRoot().listSkins()[0].listJoints(), jat = joints.map((j) => j.getWorldTranslation());
  const arm = new Set(), down = (k) => { arm.add(k); joints[k].listChildren().forEach((c) => { const m = joints.indexOf(c); if (m >= 0) down(m); }); };
  // her arms from the upper-arm bone out: the parent of each elbow (the joint a third of
  // a metre or more out to the side)
  joints.forEach((j, k) => { if (Math.abs(jat[k][0]) > 0.3 && Math.abs(jat[k][0]) < 0.5 && jat[k][1] > 1.2) { const up = joints.indexOf(j.getParentNode()); down(up >= 0 ? up : k); } });
  const bArm = new Float32Array(bn); for (let i = 0; i < bn; i += 1) for (let c = 0; c < 4; c += 1) if (arm.has(bJ[i * 4 + c])) bArm[i] += bW[i * 4 + c];
  // all of her skin, arms included: in her bind pose the arms are out, and the armpit's
  // own skin is what a partly fitted underarm would otherwise sink into
  const skinNear = surface(bPos, bIdx), skinAll = skinNear;
  // the surface the cloth follows: her skin with its creases softened (outward only, a
  // rounded part sinking at most SINK_M), for any shape of her
  const soften = (P, passes = SOFT_PASSES) => {
    const N = normalsOf(P, bIdx, bWl);
    let sm = new Float32Array(bWl.W * 3); const wn = new Float32Array(bWl.W * 3);
    for (let i = 0; i < bn; i += 1) for (let d = 0; d < 3; d += 1) { sm[bWl.id[i] * 3 + d] = P[i * 3 + d]; wn[bWl.id[i] * 3 + d] = N[i * 3 + d]; }
    const sm0 = new Float32Array(sm);
    for (let pass = 0; pass < passes; pass += 1) {
      const next = new Float32Array(sm);
      for (let u = 0; u < bWl.W; u += 1) {
        if (!bWl.nb[u].size) continue; const a = [0, 0, 0]; for (const v of bWl.nb[u]) for (let d = 0; d < 3; d += 1) a[d] += sm[v * 3 + d];
        let along = 0; for (let d = 0; d < 3; d += 1) along += (0.5 * sm[u * 3 + d] + 0.5 * a[d] / bWl.nb[u].size - sm0[u * 3 + d]) * wn[u * 3 + d];
        for (let d = 0; d < 3; d += 1) next[u * 3 + d] = sm0[u * 3 + d] + wn[u * 3 + d] * Math.max(-SINK_M, along);
      }
      sm = next;
    }
    const out = new Float32Array(bn * 3); for (let i = 0; i < bn; i += 1) out.set(sm.subarray(bWl.id[i] * 3, bWl.id[i] * 3 + 3), i * 3);
    return out;
  };
  const softPos = soften(bPos);
  const softNrm = normalsOf(softPos, bIdx, bWl);
  const lPos = inMetres(leggings, 'POSITION', 1), lIdx = leggings.getIndices().getArray(), lWl = welded(lPos, lIdx), lNrm = normalsOf(lPos, lIdx, lWl), overLeggings = surface(lPos, lIdx);
  const lShapes = shapesOf(leggings, 'POSITION', T, names, names);

  // ── the grown tee: its cut, and where on her each vertex was grown from ──
  const orig = inMetres(grown, 'POSITION', 1, Ts), n = orig.length / 3, tIdx = grown.getIndices().getArray();
  const tWl = welded(orig, tIdx), tNrm0 = inMetres(grown, 'NORMAL', 0, Ts);
  const tJ = read(grown.getAttribute('JOINTS_0')), tW = read(grown.getAttribute('WEIGHTS_0'));
  const tShapes = shapesOf(grown, 'POSITION', Ts, sNames, names), tShapeN = shapesOf(grown, 'NORMAL', Ts, sNames, names);
  // where on her each vertex was grown from: `_SKIN_AT`, a point of her skin, written
  // before the bake quantized the file. It is in the unquantized space, so it is carried
  // into metres by the affine map that best maps it onto the tee as
  // stored (the tee lies a few millimetres off those points, which is all the error
  // this carries), and then each is found on the shipped skin
  const AT = read(grown.getAttribute('_SKIN_AT'));
  // the sewn bands' extra layers are added after the record is taken and carry none:
  // they are found by their own position, as their layer's twin is
  const known = (i) => AT[i * 3] !== 0 || AT[i * 3 + 1] !== 0 || AT[i * 3 + 2] !== 0;
  // carried into metres by an affine map: first the one that best lays the points on the
  // tee as stored (it lies a few millimetres off them), then refined a few times by the
  // one that best lays them on the shipped skin itself (ICP), so they land on her
  const affine = (target) => {
    const A = Array.from({ length: 4 }, () => new Float64Array(4)), B = Array.from({ length: 4 }, () => new Float64Array(3));
    for (let i = 0; i < n; i += 1) { if (!known(i) || !target(i)) continue; const y = target(i), x = [AT[i * 3], AT[i * 3 + 1], AT[i * 3 + 2], 1]; for (let r = 0; r < 4; r += 1) { for (let c = 0; c < 4; c += 1) A[r][c] += x[r] * x[c]; for (let d = 0; d < 3; d += 1) B[r][d] += x[r] * y[d]; } }
    for (let c = 0; c < 4; c += 1) { let p = c; for (let r = c + 1; r < 4; r += 1) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; [B[c], B[p]] = [B[p], B[c]]; for (let r = 0; r < 4; r += 1) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = 0; k < 4; k += 1) A[r][k] -= f * A[c][k]; for (let d = 0; d < 3; d += 1) B[r][d] -= f * B[c][d]; } }
    const M = B.map((row, r) => row.map((v) => v / A[r][r])), out = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) for (let d = 0; d < 3; d += 1) out[i * 3 + d] = AT[i * 3] * M[0][d] + AT[i * 3 + 1] * M[1][d] + AT[i * 3 + 2] * M[2][d] + M[3][d];
    return out;
  };
  let atM = affine((i) => [orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]]);
  for (let round = 0; round < 4; round += 1) {
    const near = new Array(n);
    for (let i = 0; i < n; i += 1) if (known(i)) { const h = skinAll([atM[i * 3], atM[i * 3 + 1], atM[i * 3 + 2]], 3); if (h && h.d2 < 0.03 ** 2) near[i] = h.q; }
    atM = affine((i) => near[i]);
  }
  const atD = new Float32Array(n);
  const mix = Array.from({ length: n }, (_, i) => { const h = known(i) ? skinAll([atM[i * 3], atM[i * 3 + 1], atM[i * 3 + 2]], 3) : skinAll([orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]], 3); atD[i] = h ? Math.sqrt(h.d2) : 1; return h && h.d2 < (known(i) ? 0.02 : 0.08) ** 2 ? { tri: h.tri, bc: h.bc } : { tri: [], bc: [] }; });
  // a copy with no record (a UV seam's twin, a band's extra layer) takes its twin's
  { const twin = new Map(); for (let i = 0; i < n; i += 1) if (known(i) && mix[i].tri.length) twin.set(tWl.id[i], mix[i]); for (let i = 0; i < n; i += 1) if (!known(i) && twin.has(tWl.id[i])) mix[i] = twin.get(tWl.id[i]); }
  if (process.env.AT_DEBUG) { const q = [...atD].sort((a, b) => a - b); log(`skin-at distance mm: median ${(q[n >> 1] * 1000).toFixed(2)} p90 ${(q[Math.floor(n * 0.9)] * 1000).toFixed(2)} max ${(q[n - 1] * 1000).toFixed(1)}`); }
  // its cut edges: the neckline (high, near her middle) and the bottom hem (low)
  const neckPts = [], hemPts = [];
  for (let i = 0; i < n; i += 1) { if (!tWl.edge[tWl.id[i]]) continue; const p = [orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]]; if (Math.abs(p[0]) < 0.2 && p[1] > NECK_FROM_Y) neckPts.push(p); else if (p[1] < 1.1) hemPts.push(p); }
  const distTo = (pts) => { const E = 0.02, g = new Map(); for (const p of pts) { const k = `${Math.floor(p[0] / E)},${Math.floor(p[1] / E)},${Math.floor(p[2] / E)}`; if (!g.has(k)) g.set(k, []); g.get(k).push(p); } return (p, reach) => { let best = Infinity; const R = Math.ceil(reach / E); const cx = Math.floor(p[0] / E), cy = Math.floor(p[1] / E), cz = Math.floor(p[2] / E); for (let a = -R; a <= R; a += 1) for (let b = -R; b <= R; b += 1) for (let c = -R; c <= R; c += 1) { const l = g.get(`${cx + a},${cy + b},${cz + c}`); if (l) for (const q of l) best = Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])); } return best; }; };
  const dNeck = distTo(neckPts), dHem = distTo(hemPts);

  // ── fit ──
  const share = new Float32Array(n), pos = new Float32Array(orig), lift = new Float32Array(n), off = new Float32Array(n).fill(GAP_M);
  for (let i = 0; i < n; i += 1) {
    const p = [orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]], m = mix[i]; if (!m.tri.length) continue;
    let armS = 0; for (let c = 0; c < m.tri.length; c += 1) armS += bArm[m.tri[c]] * m.bc[c];
    // THE UPPER BACK (Joshua: "between the shoulder blades, the shirt should gently bridge
    // the hollow under fabric tension… fabric stretched between the shoulders"): there the
    // cloth keeps more of the grown tee, which spans the hollow, and less of her skin
    const sn0 = norm(mixOf(m, bNrm)), back = smooth(-0.2, -0.6, sn0[2]) * smooth(1.1, 1.18, p[1]) * (1 - smooth(0.13, 0.2, Math.abs(p[0])));
    share[i] = REACH * (1 - BACK_BRIDGE * back) * (1 - smooth(ARM_SHARE[0], ARM_SHARE[1], armS)) * smooth(NECK_M[0], NECK_M[1], dNeck(p, NECK_M[1])) * (HEM_FREE + (1 - HEM_FREE) * smooth(0, HEM_FREE_M, dHem(p, HEM_FREE_M)));
    const r = mixOf(m, bPos), rn = norm(mixOf(m, bNrm));
    lift[i] = (p[0] - r[0]) * rn[0] + (p[1] - r[1]) * rn[1] + (p[2] - r[2]) * rn[2];
    // over the leggings' panel the cloth lies on the panel, not on her
    const q = mixOf(m, softPos), qn = norm(mixOf(m, softNrm));
    const L = overLeggings([q[0] + qn[0] * 0.006, q[1] + qn[1] * 0.006, q[2] + qn[2] * 0.006], 1);
    if (L && L.d2 < 0.012 ** 2) { const h = (L.q[0] - q[0]) * qn[0] + (L.q[1] - q[1]) * qn[1] + (L.q[2] - q[2]) * qn[2]; if (h > -0.005) off[i] = Math.max(GAP_M, h + OVER_LEGGINGS_M + 0.0015); }
  }
  // the offset eased over the cloth, so the panel's top edge is a soft rise
  {
    let wo = new Float32Array(tWl.W); const wc = new Float32Array(tWl.W);
    for (let i = 0; i < n; i += 1) { wo[tWl.id[i]] += off[i]; wc[tWl.id[i]] += 1; }
    for (let u = 0; u < tWl.W; u += 1) wo[u] /= wc[u] || 1;
    for (let pass = 0; pass < 30; pass += 1) { const next = new Float32Array(wo); for (let u = 0; u < tWl.W; u += 1) { if (!tWl.nb[u].size) continue; let a = 0; for (const v of tWl.nb[u]) a += wo[v]; next[u] = Math.max(0.5 * wo[u] + 0.5 * a / tWl.nb[u].size, GAP_M); } wo = next; }
    for (let i = 0; i < n; i += 1) off[i] = wo[tWl.id[i]];
  }
  // a sewn band is two layers: each keeps its height over the lowest layer near it
  const LAYER = 0.006, lg = new Map(), lk = (x, y, z) => `${Math.floor(x / LAYER)},${Math.floor(y / LAYER)},${Math.floor(z / LAYER)}`;
  for (let i = 0; i < n; i += 1) { const k = lk(orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]); if (!lg.has(k)) lg.set(k, []); lg.get(k).push(i); }
  for (let i = 0; i < n; i += 1) {
    const m = mix[i]; if (!m.tri.length || !share[i]) continue;
    const p = [orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]];
    let low = lift[i]; const cx = Math.floor(p[0] / LAYER), cy = Math.floor(p[1] / LAYER), cz = Math.floor(p[2] / LAYER);
    for (let a = -1; a <= 1; a += 1) for (let b = -1; b <= 1; b += 1) for (let c = -1; c <= 1; c += 1) { const l = lg.get(`${cx + a},${cy + b},${cz + c}`); if (l) for (const j of l) if (Math.hypot(orig[j * 3] - p[0], orig[j * 3 + 1] - p[1], orig[j * 3 + 2] - p[2]) <= LAYER) low = Math.min(low, lift[j]); }
    const layer = Math.min(0.004, Math.max(0, lift[i] - low));
    const q = mixOf(m, softPos), qn = norm(mixOf(m, softNrm)), k = share[i];
    for (let d = 0; d < 3; d += 1) pos[i * 3 + d] = p[d] + (q[d] + qn[d] * (off[i] + layer) - p[d]) * k;
  }
  // relax and hold clear, a few times over
  const ws = new Float32Array(tWl.W);
  for (let i = 0; i < n; i += 1) ws[tWl.id[i]] = Math.max(ws[tWl.id[i]], share[i] / REACH);
  for (let i = 0; i < n; i += 1) if (tWl.edge[tWl.id[i]]) ws[tWl.id[i]] = 0;
  const relax = (passes) => {
    let wp = new Float32Array(tWl.W * 3);
    for (let i = 0; i < n; i += 1) for (let d = 0; d < 3; d += 1) wp[tWl.id[i] * 3 + d] = pos[i * 3 + d];
    for (let pass = 0; pass < passes; pass += 1) {
      const next = new Float32Array(wp);
      for (let u = 0; u < tWl.W; u += 1) { if (!tWl.nb[u].size || !ws[u]) continue; const a = [0, 0, 0]; for (const v of tWl.nb[u]) for (let d = 0; d < 3; d += 1) a[d] += wp[v * 3 + d]; const f = 0.5 * ws[u]; for (let d = 0; d < 3; d += 1) next[u * 3 + d] = (1 - f) * wp[u * 3 + d] + f * a[d] / tWl.nb[u].size; }
      wp = next;
    }
    for (let i = 0; i < n; i += 1) for (let d = 0; d < 3; d += 1) pos[i * 3 + d] = wp[tWl.id[i] * 3 + d];
  };
  let offSkin = 0, offLeggings = 0;
  const clear = () => {
    offSkin = 0; offLeggings = 0;
    for (let i = 0; i < n; i += 1) {
      if (!share[i]) continue;
      const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], q = skinNear(p);
      if (q && q.d2 < 0.03 ** 2) { const nn = norm(mixOf(q, bNrm)), sd = (p[0] - q.q[0]) * nn[0] + (p[1] - q.q[1]) * nn[1] + (p[2] - q.q[2]) * nn[2]; if (sd < CLEAR_M) { for (let d = 0; d < 3; d += 1) pos[i * 3 + d] += nn[d] * (CLEAR_M - sd); offSkin += 1; } }
      const r = overLeggings([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], 1);
      if (r && r.d2 < 0.02 ** 2) { const nn = norm(mixOf(r, lNrm)), sd = (pos[i * 3] - r.q[0]) * nn[0] + (pos[i * 3 + 1] - r.q[1]) * nn[1] + (pos[i * 3 + 2] - r.q[2]) * nn[2], side = Math.sqrt(Math.max(0, r.d2 - sd * sd)); if (sd < OVER_LEGGINGS_M && sd > -0.015 && side < 0.002) { for (let d = 0; d < 3; d += 1) pos[i * 3 + d] += nn[d] * (OVER_LEGGINGS_M - sd); offLeggings += 1; } }
    }
  };
  relax(RELAX_PASSES); clear(); relax(RELAX_PASSES / 2); clear(); relax(2); clear();
  // THE ARMPIT: where her skin passes from her side onto her arm it folds deeply when the
  // arms come down, and cloth a few millimetres off it is folded into it with the skin
  // (measured: the back of each armpit, standing). There the cloth stands further off,
  // easing in and out with how much of the skin under it belongs to her arm
  for (let i = 0; i < n; i += 1) {
    const m = mix[i]; if (!m.tri.length) continue;
    let armS = 0; for (let c = 0; c < m.tri.length; c += 1) armS += bArm[m.tri[c]] * m.bc[c];
    const k = smooth(ARMPIT_SHARE[0], ARMPIT_SHARE[1], armS) * (1 - smooth(ARMPIT_SHARE[2], ARMPIT_SHARE[3], armS));
    if (k <= 0) continue;
    const rn = norm(mixOf(m, bNrm)); for (let d = 0; d < 3; d += 1) pos[i * 3 + d] += rn[d] * ARMPIT_M * k;
  }
  // THE NECKLINE'S EDGE (Joshua: "the neckline edge looks slightly uneven in the front.
  // Please smooth it while preserving the rounded, lower neckline"): the cut follows a
  // field across her skin's triangles, so its edge wanders by a millimetre or two. Each
  // point of the edge is eased toward its two neighbours along the edge (and the band
  // inside it moves with it), so the curve stays where it is, only smoother
  const smoothEdge = (isEdgeAt, passes) => {
    const isNeck = new Uint8Array(tWl.W), rep = new Int32Array(tWl.W).fill(-1);
    for (let i = 0; i < n; i += 1) { const u = tWl.id[i]; if (rep[u] < 0) rep[u] = i; if (tWl.edge[u] && isEdgeAt(i)) isNeck[u] = 1; }
    let wp = new Float32Array(tWl.W * 3); for (let u = 0; u < tWl.W; u += 1) wp.set(pos.subarray(rep[u] * 3, rep[u] * 3 + 3), u * 3);
    const start = new Float32Array(wp);
    for (let pass = 0; pass < passes; pass += 1) {
      const next = new Float32Array(wp);
      for (let u = 0; u < tWl.W; u += 1) {
        if (!isNeck[u]) continue; const along = [...tWl.nb[u]].filter((v) => isNeck[v]).sort((a, b) => Math.hypot(wp[a * 3] - wp[u * 3], wp[a * 3 + 1] - wp[u * 3 + 1], wp[a * 3 + 2] - wp[u * 3 + 2]) - Math.hypot(wp[b * 3] - wp[u * 3], wp[b * 3 + 1] - wp[u * 3 + 1], wp[b * 3 + 2] - wp[u * 3 + 2])); if (along.length < 2) continue;
        for (let d = 0; d < 3; d += 1) next[u * 3 + d] = 0.5 * wp[u * 3 + d] + 0.25 * (wp[along[0] * 3 + d] + wp[along[1] * 3 + d]);
      }
      wp = next;
    }
    // the edge's move, carried a little way into the cloth so the sewn band follows it
    let moveW = new Float32Array(tWl.W * 3), have = new Uint8Array(tWl.W);
    for (let u = 0; u < tWl.W; u += 1) if (isNeck[u]) { for (let d = 0; d < 3; d += 1) moveW[u * 3 + d] = wp[u * 3 + d] - start[u * 3 + d]; have[u] = 1; }
    for (let ring = 0; ring < 8; ring += 1) { const next = new Float32Array(moveW), got = new Uint8Array(have); for (let u = 0; u < tWl.W; u += 1) { if (have[u]) continue; const l = [...tWl.nb[u]].filter((v) => have[v]); if (!l.length) continue; for (let d = 0; d < 3; d += 1) next[u * 3 + d] = 0.75 * l.reduce((a, v) => a + moveW[v * 3 + d], 0) / l.length; got[u] = 1; } moveW = next; have = got; }
    for (let i = 0; i < n; i += 1) for (let d = 0; d < 3; d += 1) pos[i * 3 + d] += moveW[tWl.id[i] * 3 + d];
  };
  smoothEdge((i) => Math.abs(orig[i * 3]) < 0.2 && orig[i * 3 + 1] > NECK_FROM_Y, NECK_EASE);
  // THE BOTTOM HEM (Joshua, 2026-10-14: "smooth the shirt hem, especially around the front
  // and back hips. Remove jagged edges, gaps, and unnatural waviness"): the same, along it
  smoothEdge((i) => orig[i * 3 + 1] < 1.1, HEM_EASE);
  // T-JUNCTIONS: the grown tee was refined only near its cut edges, so some vertices sit
  // on the middle of a neighbouring triangle's edge. They were straight there; moved on
  // their own, each opens a hairline crack (a line of light dashes across the belly).
  // Each is put back on its edge, at the same share of the way along it
  let tj = 0, tJunctions = [];
  {
    const E = 0.01, eg = new Map(), ek = (x, y, z) => `${Math.floor(x / E)},${Math.floor(y / E)},${Math.floor(z / E)}`;
    const edges = new Map();
    for (let t = 0; t < tIdx.length; t += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) { const u = tWl.id[tIdx[t + a]], v = tWl.id[tIdx[t + b]], k = u < v ? `${u},${v}` : `${v},${u}`; if (!edges.has(k)) edges.set(k, [tIdx[t + a], tIdx[t + b]]); }
    for (const [k, [a, b]] of edges) { const m = [(orig[a * 3] + orig[b * 3]) / 2, (orig[a * 3 + 1] + orig[b * 3 + 1]) / 2, (orig[a * 3 + 2] + orig[b * 3 + 2]) / 2], c = ek(...m); if (!eg.has(c)) eg.set(c, []); eg.get(c).push([a, b]); }
    const rep = new Int32Array(tWl.W).fill(-1); for (let i = 0; i < n; i += 1) if (rep[tWl.id[i]] < 0) rep[tWl.id[i]] = i;
    const on = [];
    for (let u = 0; u < tWl.W; u += 1) {
      const v = rep[u], p = [orig[v * 3], orig[v * 3 + 1], orig[v * 3 + 2]], cx = Math.floor(p[0] / E), cy = Math.floor(p[1] / E), cz = Math.floor(p[2] / E);
      search: for (let a = -1; a <= 1; a += 1) for (let b = -1; b <= 1; b += 1) for (let c = -1; c <= 1; c += 1) {
        const l = eg.get(`${cx + a},${cy + b},${cz + c}`); if (!l) continue;
        for (const [e0, e1] of l) {
          if (tWl.id[e0] === u || tWl.id[e1] === u) continue;
          const d = [orig[e1 * 3] - orig[e0 * 3], orig[e1 * 3 + 1] - orig[e0 * 3 + 1], orig[e1 * 3 + 2] - orig[e0 * 3 + 2]], L2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2; if (!L2) continue;
          const t = ((p[0] - orig[e0 * 3]) * d[0] + (p[1] - orig[e0 * 3 + 1]) * d[1] + (p[2] - orig[e0 * 3 + 2]) * d[2]) / L2;
          if (t < 0.02 || t > 0.98) continue;
          const off2 = (p[0] - orig[e0 * 3] - d[0] * t) ** 2 + (p[1] - orig[e0 * 3 + 1] - d[1] * t) ** 2 + (p[2] - orig[e0 * 3 + 2] - d[2] * t) ** 2;
          if (off2 < 0.0001 ** 2) { on.push([u, e0, e1, t]); break search; }
        }
      }
    }
    for (let pass = 0; pass < 4; pass += 1) for (const [u, e0, e1, t] of on) {
      const q = [0, 1, 2].map((d) => pos[e0 * 3 + d] * (1 - t) + pos[e1 * 3 + d] * t);
      for (let i = 0; i < n; i += 1) if (tWl.id[i] === u) pos.set(q, i * 3);
    }
    tj = on.length; tJunctions = on;
  }
  // SEAMS: copies of one point (a UV seam: the tee's upper and lower texture charts meet
  // across the belly) may record their skin slightly differently, and each moved on its
  // own opened a hairline crack along the seam. Every copy takes the copies' average
  const weld = (arr) => { const acc = new Float32Array(tWl.W * 3), cnt = new Float32Array(tWl.W); for (let i = 0; i < n; i += 1) { for (let d = 0; d < 3; d += 1) acc[tWl.id[i] * 3 + d] += arr[i * 3 + d]; cnt[tWl.id[i]] += 1; } for (let i = 0; i < n; i += 1) for (let d = 0; d < 3; d += 1) arr[i * 3 + d] = acc[tWl.id[i] * 3 + d] / cnt[tWl.id[i]]; };
  weld(pos);
  // folded triangles left (should be none): reported, so a regression shows
  let folded = 0;
  for (let t = 0; t < tIdx.length; t += 3) {
    const [a, b, c] = [tIdx[t], tIdx[t + 1], tIdx[t + 2]]; if (!share[a] && !share[b] && !share[c]) continue;
    const u = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]], v = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]];
    const g = norm([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
    const sn = norm(mixOf({ tri: [...mix[a].tri, ...mix[b].tri, ...mix[c].tri], bc: [...mix[a].bc, ...mix[b].bc, ...mix[c].bc] }, bNrm));
    if (g[0] * sn[0] + g[1] * sn[1] + g[2] * sn[2] < 0) folded += 1;
  }
  // normals: the fitted surface's own; the cut's elsewhere, turned with it
  const g0 = normalsOf(orig, tIdx, tWl), g1 = normalsOf(pos, tIdx, tWl), nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) { const f = Math.min(1, share[i] / REACH); nrm.set(norm([0, 1, 2].map((d) => (tNrm0[i * 3 + d] + g1[i * 3 + d] - g0[i * 3 + d]) * (1 - f) + g1[i * 3 + d] * f)), i * 3); }
  // copies of a point share one normal, so a UV seam does not show as a line of shading
  {
    const groups = new Map(); for (let i = 0; i < n; i += 1) { if (!groups.has(tWl.id[i])) groups.set(tWl.id[i], []); groups.get(tWl.id[i]).push(i); }
    for (const l of groups.values()) {
      if (l.length < 2) continue;
      for (const i of l) { const a = [0, 0, 0]; for (const j of l) { const dot = nrm[i * 3] * nrm[j * 3] + nrm[i * 3 + 1] * nrm[j * 3 + 1] + nrm[i * 3 + 2] * nrm[j * 3 + 2]; if (dot > 0.5) for (let d = 0; d < 3; d += 1) a[d] += nrm[j * 3 + d]; } nrm.set(norm(a), i * 3); }
    }
  }
  // shapes and weights: wherever the cloth is fitted it takes her skin's own move in full
  // (5% of the grown tee's move left in let her skin pass through it at 150-200%)
  // how far each fitted point stands off her skin, along her skin's normal: a shape that
  // turns the skin turns that offset with it, so the clearance holds at every size
  const standOff = new Float32Array(n), skinN0 = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) { if (!mix[i].tri.length) continue; const r = mixOf(mix[i], bPos), nn = norm(mixOf(mix[i], bNrm)); skinN0.set(nn, i * 3); standOff[i] = Math.max(0, (pos[i * 3] - r[0]) * nn[0] + (pos[i * 3 + 1] - r[1]) * nn[1] + (pos[i * 3 + 2] - r[2]) * nn[2]); }
  // AT EVERY BELLY AND BUST SIZE the cloth follows that size's softened skin, not its
  // raw skin: at 0-50% her breasts sit over a deeper fold, and the raw move drew the
  // cloth into it as an outline under each breast
  // and the offset turns with the SOFTENED skin's normal, and only its first TURN_M:
  // where the cloth bridges the fold under a breast it stands far off her skin, whose
  // underside normal swings hard as the belly shrinks, and turning all of that offset
  // dropped the cloth 10 mm in a step along the fold (a bridge does not turn with the
  // skin it spans; the clearance pass below still holds every size off her)
  // (the move is taken between two equally deep softenings, deeper than the base's, so
  // a fold a smaller size opens is bridged and nothing a size leaves alone moves)
  const deepBase = soften(bPos, SHAPE_SOFT_PASSES), deepNrm = normalsOf(deepBase, bIdx, bWl);
  const softShape = names.map((name, t) => {
    if (!bShapes[t] || !/^belly(\d+)?$|^breast(0|100)$/.test(name)) return null;
    const P = new Float32Array(bPos); for (let k = 0; k < P.length; k += 1) P[k] += bShapes[t][k];
    const S = soften(P, SHAPE_SOFT_PASSES), N = normalsOf(S, bIdx, bWl);
    for (let k = 0; k < S.length; k += 1) { S[k] -= deepBase[k]; N[k] -= deepNrm[k]; }
    return { S, N };
  });
  const outShapes = names.map((_, t) => { const d = tShapes[t] ?? new Float32Array(n * 3), o = new Float32Array(d); for (let i = 0; i < n; i += 1) { if (!share[i] || !bShapes[t]) continue; const s = mixOf(mix[i], softShape[t]?.S ?? bShapes[t]); const f = Math.min(1, share[i] / REACH), soft = softShape[t], n0 = soft ? norm(mixOf(mix[i], deepNrm)) : [skinN0[i * 3], skinN0[i * 3 + 1], skinN0[i * 3 + 2]], tn = soft ? mixOf(mix[i], soft.N) : bShapeN[t] ? mixOf(mix[i], bShapeN[t]) : [0, 0, 0], n1 = norm([n0[0] + tn[0], n0[1] + tn[1], n0[2] + tn[2]]); for (let c = 0; c < 3; c += 1) o[i * 3 + c] = d[i * 3 + c] * (1 - f) + (s[c] + (n1[c] - n0[c]) * Math.min(standOff[i], TURN_M) * SHAPE_CLEAR) * f; } return o; });
  const outShapeN = names.map((_, t) => { const d = tShapeN[t] ?? new Float32Array(n * 3), o = new Float32Array(d); for (let i = 0; i < n; i += 1) { if (!share[i] || !bShapeN[t]) continue; const s = mixOf(mix[i], softShape[t]?.N ?? bShapeN[t]); const f = Math.min(1, share[i] / REACH); for (let c = 0; c < 3; c += 1) o[i * 3 + c] = d[i * 3 + c] * (1 - f) + s[c] * f; } return o; });
  // and at every grown size the cloth is held clear of her skin as that size shapes it,
  // as it is at 100% (the shapes are linear between sizes, so each size checked is enough)
  // and each belly size's move is eased across the cloth itself, each point as fast as it
  // is fitted (the band over the hem partly, the free hem not at all, so they meet smoothly): her belly
  // shapes move her ribs and not the underside of her breasts, so even her softened skin
  // steps 3 mm across the fold, and cloth stretched over a fold does not step (the
  // clearance pass below then holds every size off her)
  outShapes.forEach((o, t) => {
    if (!softShape[t] || !/^belly/.test(names[t])) return; // the bust's own sizes keep their shape
    let w = new Float32Array(tWl.W * 3); const cnt = new Float32Array(tWl.W), fit = new Float32Array(tWl.W);
    for (let i = 0; i < n; i += 1) { const u = tWl.id[i]; for (let d = 0; d < 3; d += 1) w[u * 3 + d] += o[i * 3 + d]; cnt[u] += 1; fit[u] = Math.max(fit[u], Math.min(1, share[i] / REACH)); }
    for (let u = 0; u < tWl.W; u += 1) if (cnt[u]) for (let d = 0; d < 3; d += 1) w[u * 3 + d] /= cnt[u];
    for (let pass = 0; pass < SHAPE_EASE; pass += 1) {
      const next = new Float32Array(w);
      for (let u = 0; u < tWl.W; u += 1) { if (!fit[u] || !tWl.nb[u].size) continue; const a = [0, 0, 0]; for (const v of tWl.nb[u]) for (let d = 0; d < 3; d += 1) a[d] += w[v * 3 + d]; const k = 0.5 * fit[u]; for (let d = 0; d < 3; d += 1) next[u * 3 + d] = (1 - k) * w[u * 3 + d] + k * a[d] / tWl.nb[u].size; }
      w = next;
    }
    for (let i = 0; i < n; i += 1) if (fit[tWl.id[i]]) o.set(w.subarray(tWl.id[i] * 3, tWl.id[i] * 3 + 3), i * 3);
  });
  let shapeClear = 0;
  names.forEach((name, t) => {
    if (!/^belly\d|^belly$|^bellySeat$/.test(name) || !bShapes[t]) return;
    const sp = new Float32Array(bPos); for (let k = 0; k < sp.length; k += 1) sp[k] += bShapes[t][k];
    const near = surface(sp, bIdx), sn = normalsOf(sp, bIdx, bWl), o = outShapes[t];
    // each push is spread into the cloth around it, tapering, so a row lifted off her
    // reads as cloth lifted and not as a ridge (one pushed row drew a hairline under each
    // breast at small sizes)
    let lift = new Float32Array(tWl.W); const dir = new Float32Array(tWl.W * 3), has = new Uint8Array(tWl.W);
    for (let i = 0; i < n; i += 1) {
      if (!share[i]) continue;
      const p = [pos[i * 3] + o[i * 3], pos[i * 3 + 1] + o[i * 3 + 1], pos[i * 3 + 2] + o[i * 3 + 2]], q = near(p);
      if (!q || q.d2 > 0.03 ** 2) continue;
      const nn = norm(mixOf(q, sn)), sd = (p[0] - q.q[0]) * nn[0] + (p[1] - q.q[1]) * nn[1] + (p[2] - q.q[2]) * nn[2], u = tWl.id[i];
      if (!has[u]) { dir.set(nn, u * 3); has[u] = 1; }
      if (sd < CLEAR_M) { lift[u] = Math.max(lift[u], CLEAR_M - sd); shapeClear += 1; }
    }
    const need = new Float32Array(lift);
    for (let pass = 0; pass < LIFT_SPREAD; pass += 1) { const next = new Float32Array(lift); for (let u = 0; u < tWl.W; u += 1) { if (!has[u] || !tWl.nb[u].size) continue; let a = 0; for (const v of tWl.nb[u]) a += lift[v]; next[u] = Math.max(need[u], 0.5 * lift[u] + 0.5 * a / tWl.nb[u].size); } lift = next; }
    for (let i = 0; i < n; i += 1) { const u = tWl.id[i]; if (!share[i] || !has[u] || !lift[u]) continue; for (let d = 0; d < 3; d += 1) o[i * 3 + d] += dir[u * 3 + d] * lift[u]; }
    // and over the leggings' panel as that size shapes it
    const ls = lShapes[t]; if (!ls) return;
    const lp = new Float32Array(lPos); for (let k = 0; k < lp.length; k += 1) lp[k] += ls[k];
    const lNear = surface(lp, lIdx), ln = normalsOf(lp, lIdx, lWl);
    for (let i = 0; i < n; i += 1) {
      if (!share[i]) continue;
      const p = [pos[i * 3] + o[i * 3], pos[i * 3 + 1] + o[i * 3 + 1], pos[i * 3 + 2] + o[i * 3 + 2]], r = lNear(p, 1);
      if (!r || r.d2 > 0.02 ** 2) continue;
      const nn = norm(mixOf(r, ln)), sd = (p[0] - r.q[0]) * nn[0] + (p[1] - r.q[1]) * nn[1] + (p[2] - r.q[2]) * nn[2], side = Math.sqrt(Math.max(0, r.d2 - sd * sd));
      if (sd < OVER_LEGGINGS_M && sd > -0.015 && side < 0.002) { for (let d = 0; d < 3; d += 1) o[i * 3 + d] += nn[d] * (OVER_LEGGINGS_M - sd); shapeClear += 1; }
    }
  });
  outShapes.forEach(weld);
  // the T-junctions stay closed at every size too: a shape moves the vertex on the edge
  // by exactly the share of its edge's two ends (an open one tore across the belly at 150%)
  for (const sh of outShapes) for (const [u, e0, e1, t] of tJunctions) {
    const q = [0, 1, 2].map((d) => sh[e0 * 3 + d] * (1 - t) + sh[e1 * 3 + d] * t);
    for (let i = 0; i < n; i += 1) if (tWl.id[i] === u) sh.set(q, i * 3);
  }
  // an eased belly size's shading is the cloth's own at that size, as its rest shading is:
  // her skin's normals still carry the fold the cloth was eased over, and drew it as a line
  outShapes.forEach((o, t) => {
    if (!softShape[t] || !/^belly/.test(names[t])) return;
    const P = new Float32Array(pos); for (let k = 0; k < P.length; k += 1) P[k] += o[k];
    const g = normalsOf(P, tIdx, tWl), on = outShapeN[t];
    for (let i = 0; i < n; i += 1) { const f = Math.min(1, share[i] / REACH); for (let d = 0; d < 3; d += 1) on[i * 3 + d] = on[i * 3 + d] * (1 - f) + (g[i * 3 + d] - g1[i * 3 + d]) * f; }
  });
  const J = new Uint16Array(n * 4), Wt = new Float32Array(n * 4);
  const sJoints = src.getRoot().listSkins()[0].listJoints().map((j) => j.getName()), dJoints = joints.map((j) => j.getName()), accs = new Array(n);
  for (let i = 0; i < n; i += 1) {
    // the cloth bends exactly as the skin it was grown from, fitted or not: the cut's own
    // weights let the back of the armpit sink in when the arms came down, and held the
    // hem to the pelvis while the leggings under it swung with the thighs, so seated the
    // leggings came out over the back of the hem
    const f = mix[i].tri.length ? 1 : 0, acc = new Map();
    for (let c = 0; c < 4; c += 1) if (tW[i * 4 + c] > 0) { const j = dJoints.indexOf(sJoints[tJ[i * 4 + c]]); acc.set(j, (acc.get(j) || 0) + tW[i * 4 + c] * (1 - f)); }
    if (f > 0) for (let c = 0; c < mix[i].tri.length; c += 1) for (let q = 0; q < 4; q += 1) { const v = mix[i].tri[c], w = bW[v * 4 + q] * mix[i].bc[c] * f; if (w > 0) acc.set(bJ[v * 4 + q], (acc.get(bJ[v * 4 + q]) || 0) + w); }
    accs[i] = acc;
  }
  // copies of a point bend as one: their weights are pooled (otherwise a UV seam opens
  // a hairline crack the moment she moves)
  {
    const groups = new Map(); for (let i = 0; i < n; i += 1) { if (!groups.has(tWl.id[i])) groups.set(tWl.id[i], []); groups.get(tWl.id[i]).push(i); }
    // and the weights are eased across the cloth (WEIGHT_EASE passes): her skin's own
    // weights change sharply in places (the small of her back), which seated folded her
    // skin into slivers; cloth spreads that bend over its own width instead
    let wmap = new Array(tWl.W);
    for (const [u, l] of groups) { const pool = new Map(); for (const i of l) for (const [j, w] of accs[i]) pool.set(j, (pool.get(j) || 0) + w / l.length); wmap[u] = pool; }
    for (let pass = 0; pass < WEIGHT_EASE; pass += 1) {
      const next = new Array(tWl.W);
      for (let u = 0; u < tWl.W; u += 1) {
        const own = wmap[u]; if (!own || !tWl.nb[u].size) { next[u] = own; continue; }
        const m = new Map(); for (const [j, w] of own) m.set(j, 0.5 * w);
        const k = 0.5 / tWl.nb[u].size; for (const v of tWl.nb[u]) if (wmap[v]) for (const [j, w] of wmap[v]) m.set(j, (m.get(j) || 0) + k * w);
        next[u] = m;
      }
      wmap = next;
    }
    for (const [u, l] of groups) {
      const pool = wmap[u];
      const top = [...pool].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((a, [, w]) => a + w, 0) || 1;
      for (const i of l) top.forEach(([j, w], c) => { J[i * 4 + c] = j; Wt[i * 4 + c] = w / sum; });
    }
  }

  // ── write: a new primitive beside the Relaxed tee, its own material and painted texture ──
  const buffer = doc.getRoot().listBuffers()[0], acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const local = (arr, w) => { const o = new Float32Array(arr.length); for (let i = 0; i < arr.length / 3; i += 1) o.set(apply(Ti, [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]], w), i * 3); return o; };
  // stored as the Relaxed tee is (KHR_mesh_quantization: normalized 16-bit positions,
  // shapes and normals, 8-bit weights), so the shipped file stays its size
  const i16 = (arr) => { const o = new Int16Array(arr.length); for (let i = 0; i < arr.length; i += 1) o[i] = Math.max(-32767, Math.min(32767, Math.round(arr[i] * 32767))); return o; };
  const q16 = (type, arr) => acc(type, i16(arr)).setNormalized(true);
  const old = byName(mesh, ATHLETIC); if (old) { mesh.removePrimitive(old); old.dispose(); }
  const prim = doc.createPrimitive().setIndices(acc('SCALAR', n > 65535 ? Uint32Array.from(tIdx) : Uint16Array.from(tIdx)));
  for (const sem of grown.listSemantics()) {
    if (sem.startsWith('_SKIN_')) continue;
    if (sem === 'POSITION') prim.setAttribute(sem, q16('VEC3', local(pos, 1)));
    else if (sem === 'NORMAL') { const l = local(nrm, 0); for (let i = 0; i < n; i += 1) l.set(norm([l[i * 3], l[i * 3 + 1], l[i * 3 + 2]]), i * 3); prim.setAttribute(sem, q16('VEC3', l)); }
    else if (sem === 'JOINTS_0') prim.setAttribute(sem, acc('VEC4', Uint8Array.from(J)));
    else if (sem === 'WEIGHTS_0') prim.setAttribute(sem, acc('VEC4', Wt)); // packSarah stores it as 8-bit, keeping all four
    else { const A = grown.getAttribute(sem); prim.setAttribute(sem, doc.createAccessor().setType(A.getType()).setArray(A.getArray().slice()).setNormalized(A.getNormalized()).setBuffer(buffer)); }
  }
  names.forEach((name, k) => { const t = doc.createPrimitiveTarget(name); t.setAttribute('POSITION', q16('VEC3', local(outShapes[k], 0))); t.setAttribute('NORMAL', q16('VEC3', local(outShapeN[k], 0))); prim.addTarget(t); });
  const relaxed = byName(mesh, 'shirt'), mat = relaxed.getMaterial().clone().setName(ATHLETIC), gm = grown.getMaterial();
  for (const slot of ['BaseColor', 'Normal', 'MetallicRoughness', 'Occlusion', 'Emissive']) {
    const st = gm[`get${slot}Texture`](); if (!st) continue;
    mat[`set${slot}Texture`](doc.createTexture(`${ATHLETIC}-${slot}`).setImage(st.getImage()).setMimeType(st.getMimeType()));
  }
  prim.setMaterial(mat).setExtras({ ...grown.getExtras(), fit: 'athletic', fittedBy: 'scripts/fitAthleticTee.mjs' });
  relaxed.setExtras({ ...relaxed.getExtras(), fit: 'relaxed' });
  mesh.addPrimitive(prim);
  // THE LEGGINGS UNDER IT (Joshua, 2026-10-14, seated: the leggings showed through the
  // tee at her hips): where the tee lies over them, well above its hem, they are marked
  // (`_UNDER_TOP` on the leggings), and the Lab does not draw them while the tee is worn —
  // the same masking that hides skin under clothes. Near the hem they stay, so the hem
  // always has leggings under it
  {
    const shirtNear = surface(pos, tIdx), hemD = new Float32Array(n);
    for (let i = 0; i < n; i += 1) hemD[i] = dHem([orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]], UNDER_TOP_HEM_M);
    const under = new Uint8Array(lPos.length / 3); let count = 0;
    for (let v = 0; v < under.length; v += 1) {
      const q = [lPos[v * 3], lPos[v * 3 + 1], lPos[v * 3 + 2]], h = shirtNear(q, 1);
      if (!h || h.d2 > UNDER_TOP_M ** 2) continue;
      if (Math.min(...h.tri.map((t) => hemD[t])) < UNDER_TOP_HEM_M) continue;
      under[v] = 1; count += 1;
    }
    leggings.setAttribute('_UNDER_TOP', doc.createAccessor().setType('SCALAR').setArray(under).setBuffer(buffer));
    log(`athletic tee: ${count.toLocaleString('en-US')} leggings vertices lie under it, away from its hem`);
  }
  // the body's coverage: the athletic tee covers what the tee covers
  const cover = body.getAttribute('_CLOTH_COVER');
  if (cover) {
    const order = ['shirt', 'leggings', 'bikini', 'swimsuit', ATHLETIC], arr = cover.getArray().slice();
    for (let i = 0; i < arr.length; i += 1) if (arr[i] & (1 << order.indexOf('shirt'))) arr[i] |= 1 << order.indexOf(ATHLETIC);
    body.setAttribute('_CLOTH_COVER', doc.createAccessor().setType('SCALAR').setArray(arr).setBuffer(buffer));
  }
  await io.write(file, doc);
  const fitted = share.reduce((a, s) => a + (s > 0.01 ? 1 : 0), 0);
  log(`athletic tee: ${fitted.toLocaleString('en-US')} of ${n.toLocaleString('en-US')} vertices fitted (up to ${Math.round(REACH * 100)}%), ${offSkin} held off her skin, ${offLeggings} over the leggings, ${folded} folded triangles, ${tj} T-junctions closed, ${shapeClear} held clear at grown sizes; the Relaxed tee and her body untouched`);
}

if (process.argv[1]?.endsWith('fitAthleticTee.mjs')) await fitAthleticTee(process.argv[2], process.argv[3] ?? process.argv[2]);
