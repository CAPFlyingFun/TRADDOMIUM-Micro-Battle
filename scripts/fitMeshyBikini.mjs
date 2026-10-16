/**
 * A MODELLED BIKINI, FITTED TO HER AND WORN (Joshua, 2026-10-14: "I had MeshyAI create
 * the top and bottom as a GLB model which should help a lot... apply it similar to how
 * you did the badge as a soft-body so it can bend with a slight elastic with the
 * body's movements").
 *
 * The grown bikini was a field drawn on her skin, so its outline was only ever as good
 * as the formula and it stretched wherever her skin did. This takes a real garment
 * model instead (two parts: a halter triangle top and a tie-side brief) and puts it on
 * the shipped body without touching the body:
 *
 *   1. SIMPLIFY each part to a phone's budget (the scan is ~180k triangles a part).
 *   2. PLACE it: one uniform scale and a translation per part, chosen so the part's
 *      own landmarks land on hers (`PLACE`, GAME TUNING against renders).
 *   3. WRAP it: every vertex near her skin is carried along her surface normal until
 *      the garment's INNER face sits `GAP_M` off the skin. The push is decided per
 *      neighbourhood (the least distance within `SHELL_M`), so the inner and outer
 *      faces of the fabric move together and its thickness survives; then the push is
 *      eased across the garment so no skin triangle prints through it.
 *   4. BIND it: each touching vertex takes the skin weights and every shape (belly
 *      sizes, breasts, the bob and sway springs) of the point of skin under it, by
 *      barycentric interpolation. What hangs free (the tie bows) takes the binding of
 *      the nearest touching vertex, so it rides with the knot it hangs from.
 *
 * The SOFT BODY is the body's own springs: `breastBob`, `bellyBob` and `bellySway` are
 * already driven every frame by the Lab's spring (as the badge's pendulum is), and the
 * garment carries those shapes, so it bounces and settles with her rather than being
 * printed rigidly on a pose.
 *
 *   node scripts/fitMeshyBikini.mjs <meshy.glb> <sarah.glb>     (writes sarah.glb)
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

/** GAME TUNING: where each part goes, in metres on her bind (100%) body. */
export const PLACE = Object.freeze({
  // the brief: its side corners on the tops of her hips, its centre over hers
  bottom: { part: 0, scale: 0.43, topY: 0.915, contactM: 0.035, triangles: 20000, ease: 12, easeM: 0.009 },
  // the top: its cups centred on her breasts
  top: { part: 1, scale: 0.33, contactM: 0.05, triangles: 40000, ease: 3, easeM: 0.005 },
});
/** In the scan's frame, the brief's fabric ends and its side ties begin this far out. */
export const TIE_FROM = 0.44;
/** Extra lift off the skin, metres, per part (brief, side tie, cup, halter strap, knot). */
export const STRING_CLEAR = [0, 0.0045, 0, 0.0035, 0.001];
/** The fabric's inner face this far off her skin. */
export const GAP_M = 0.003;
/** The neighbourhood whose nearest point decides a vertex's push: wider than the fabric is thick. */
export const SHELL_M = 0.008;
/** A printed cup's fabric, inner face to outer. */
export const FABRIC_M = 0.002;
/** How far along a strap the move of its printed cup is carried (followNormals fits only). */
export const STRAP_FOLLOW_M = 0.06;
/** (v2) Rounds of smoothing the print's MOVE over the cup's own surface (each spreads it about one edge). */
export const PRINT_SMOOTH_ROUNDS = 80, IRON_ROUNDS = 10;
/** (v2) The most of the fabric's height carried along the skin normal's turn in a shape, and the most that turn may shift it. */
export const NORMAL_CARRY_M = 0.006, NORMAL_SHIFT_M = 0.004;
/** (v2) A printed cup triangle whose facing turned past this cosine (over: flipped), or whose area fell below this share of the scan's, is a fold. */
export const PRINT_FOLD_TURN = -0.2, PRINT_FOLD_AREA = 0.25;

const mul = (x, y) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) o[c * 4 + r] += x[k * 4 + r] * y[c * 4 + k]; return o; };
const invert = (m) => {
  const [a, b, c, , d, e, f, , g, h, i] = m, det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const r = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, 0, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, 0, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det, 0, 0, 0, 0, 1];
  r[12] = -(r[0] * m[12] + r[4] * m[13] + r[8] * m[14]); r[13] = -(r[1] * m[12] + r[5] * m[13] + r[9] * m[14]); r[14] = -(r[2] * m[12] + r[6] * m[13] + r[10] * m[14]);
  return r;
};
const toMetres = (doc) => { const skin = doc.getRoot().listSkins()[0]; return mul(skin.listJoints()[0].getWorldMatrix(), Array.from(skin.getInverseBindMatrices().getArray().slice(0, 16))); };
const apply = (m, v, w) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + w * m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + w * m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + w * m[14]];
const readAttr = (A) => { const n = A.getCount(), s = A.getElementSize(), out = new Float32Array(n * s), v = []; for (let i = 0; i < n; i += 1) { A.getElement(i, v); for (let c = 0; c < s; c += 1) out[i * s + c] = v[c]; } return out; };

/** Closest point on triangle abc to p (Ericson), as barycentrics. */
export function closestBary(p, a, b, c) {
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

export function vertexNormals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

/** A uniform grid over points for radius queries. */
function grid(pts, cell) {
  const map = new Map(), key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < pts.length / 3; i += 1) { const k = key(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]); if (!map.has(k)) map.set(k, []); map.get(k).push(i); }
  return {
    near(x, y, z, r, fn) {
      const reach = Math.ceil(r / cell), cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      for (let i = -reach; i <= reach; i += 1) for (let j = -reach; j <= reach; j += 1) for (let k = -reach; k <= reach; k += 1) {
        const l = map.get(`${cx + i},${cy + j},${cz + k}`); if (l) for (const q of l) fn(q);
      }
    },
  };
}

/**
 * Turn the halter's bow to hang behind its knot. In the scan's frame (y up, the cups'
 * fronts +z) the knot is the top of the part; the bow is everything high up and inside
 * the two straps, and whatever of it lies forward of the knot is reflected through the
 * knot's plane.
 */
export function flipKnot(pos) {
  const n = pos.length / 3; let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i += 1) { y0 = Math.min(y0, pos[i * 3 + 1]); y1 = Math.max(y1, pos[i * 3 + 1]); }
  const h = y1 - y0, from = y0 + 0.62 * h, bins = 40, strapX = new Float32Array(bins);
  for (let i = 0; i < n; i += 1) { const y = pos[i * 3 + 1]; if (y < from) continue; const b = Math.min(bins - 1, Math.floor(((y - from) / (y1 - from)) * bins)); strapX[b] = Math.max(strapX[b], Math.abs(pos[i * 3])); }
  let zk = 0, c = 0; for (let i = 0; i < n; i += 1) if (pos[i * 3 + 1] > y1 - 0.03 * h) { zk += pos[i * 3 + 2]; c += 1; }
  zk /= c;
  let moved = 0;
  for (let i = 0; i < n; i += 1) {
    const y = pos[i * 3 + 1]; if (y < from) continue;
    const b = Math.min(bins - 1, Math.floor(((y - from) / (y1 - from)) * bins));
    if (Math.abs(pos[i * 3]) > strapX[b] - 0.05 * h || pos[i * 3 + 2] <= zk) continue;
    pos[i * 3 + 2] = 2 * zk - pos[i * 3 + 2]; moved += 1;
  }
  return moved;
}

/**
 * Options for a body other than v1's (`scripts/sarahV2Bikini.mjs`): `create` adds the
 * bikini as a new primitive and material when the file has none (v2 is one primitive);
 * `followNormals` carries the fabric's offset off the skin along the skin's TURNED normal
 * in every shape, not only its moved position, so a cup keeps its clearance when a shape
 * tips or swells the breast under it; `place` overrides `PLACE`; `tipBox` is where to look for her breast's tip ([x0, x1, y0, y1], metres; v2's 100% bump reaches higher than v1's); `out` writes elsewhere; `keepTags` keeps each vertex's part as `_TAG` (0 brief, 1 side tie, 2 cup, 3 halter strap, 4 knot) for a later step.
 * With none of them, v1's fit is exactly what it was.
 */
/**
 * THE BRIEF'S REAR PANEL, RESHAPED ON ITS OWN (Joshua, 2026-10-15: "the bikini bottom
 * looks like it's about to fall off her butt from the rear view... raise the rear fabric
 * panel and improve its coverage... preserve the front panel and side-tie design").
 *
 * In the scan's own frame (y up, the front +z), column by column across her: the back
 * panel's top edge is raised to `top` across the middle, easing back to the scan's own
 * edge before the side ties; its leg edge is let down by `legLower` of the way toward the
 * gusset (and `legDrop` further, round under each cheek, as a brief's leg line follows
 * the crease under the seat), for a fuller seat. Each column is stretched between its two edges, so the
 * fabric stays one continuous sheet: the gusset under her (which sits at the column's
 * bottom) does not move, and the front, where the weight is nothing, is exactly the
 * scan. The weight fades from the back to the sides of the brief over `zFade`, so the
 * hips carry the change round smoothly into the ties.
 */
export function reshapeBack(pos, { top, legLower = 0, legDrop = 0, zFade = [-0.02, -0.12], keepFrom = 0.22, keepTo = 0.4 }, log = () => {}) {
  const n = pos.length / 3, smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const BIN = 0.02, NB = Math.ceil(TIE_FROM / BIN) + 1, hi = new Float32Array(NB).fill(-Infinity), lo = new Float32Array(NB).fill(Infinity);
  let crotch = Infinity;
  for (let i = 0; i < n; i += 1) {
    const ax = Math.abs(pos[i * 3]), y = pos[i * 3 + 1], z = pos[i * 3 + 2]; crotch = Math.min(crotch, y);
    if (ax > TIE_FROM || z > zFade[0]) continue;
    const b = Math.min(NB - 1, Math.floor(ax / BIN)); hi[b] = Math.max(hi[b], y); lo[b] = Math.min(lo[b], y);
  }
  for (let b = 1; b < NB; b += 1) if (!Number.isFinite(hi[b])) { hi[b] = hi[b - 1]; lo[b] = lo[b - 1]; }
  // smoothed across columns, so neither edge carries a step from one bin to the next
  const sm = (a) => { const o = Float32Array.from(a); for (let p = 0; p < 3; p += 1) for (let b = 1; b < NB - 1; b += 1) o[b] = (o[b - 1] + 2 * o[b] + o[b + 1]) / 4; return o; };
  const H = sm(hi), L = sm(lo);
  const at = (A, ax) => { const f = Math.min(NB - 1.001, ax / BIN), b = Math.floor(f), t = f - b; return A[b] * (1 - t) + A[b + 1] * t; };
  let moved = 0, most = 0;
  for (let i = 0; i < n; i += 1) {
    const ax = Math.abs(pos[i * 3]), y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (ax > TIE_FROM) continue;
    const w = smooth(zFade[0], zFade[1], z) * (1 - smooth(keepFrom, keepTo, ax)); if (!(w > 0)) continue;
    const t0 = at(H, ax), b0 = at(L, ax), t1 = Math.max(t0, top), b1 = b0 - legLower * (b0 - crotch) - legDrop * smooth(0, 0.07, ax) * (1 - smooth(0.14, 0.26, ax));
    if (!(t0 - b0 > 1e-4)) continue;
    const u = (y - b0) / (t0 - b0), y1 = b1 + u * (t1 - b1), ny = y + (y1 - y) * w;
    most = Math.max(most, Math.abs(ny - y)); pos[i * 3 + 1] = ny; moved += 1;
  }
  log(`fit: rear panel reshaped (${moved} scan vertices; its top edge to ${top} in the scan, at most ${(most * 100).toFixed(1)} scan-cm moved)`);
}

export async function fitMeshyBikini(meshyFile, sarahFile, { log = console.log, create = false, followNormals = false, place: placeOverride = null, out = sarahFile, tipBox = [0.05, 0.16, 1.17, 1.36], keepTags = false } = {}) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(sarahFile), meshy = await io.read(meshyFile);
  const T = toMetres(doc), Ti = invert(T);
  const mesh = doc.getRoot().listMeshes()[0], names = mesh.getExtras().targetNames;
  const body = mesh.listPrimitives()[0];

  // ── her skin, in metres ──
  const bRaw = readAttr(body.getAttribute('POSITION')), bn = bRaw.length / 3, bPos = new Float32Array(bRaw.length);
  for (let i = 0; i < bn; i += 1) bPos.set(apply(T, [bRaw[i * 3], bRaw[i * 3 + 1], bRaw[i * 3 + 2]], 1), i * 3);
  const bIdx = body.getIndices().getArray(), bNrm = vertexNormals(bPos, bIdx);
  const bJ = readAttr(body.getAttribute('JOINTS_0')), bW = readAttr(body.getAttribute('WEIGHTS_0'));
  const bTargets = body.listTargets().map((t) => { const d = readAttr(t.getAttribute('POSITION')); for (let i = 0; i < bn; i += 1) d.set(apply(T, [d[i * 3], d[i * 3 + 1], d[i * 3 + 2]], 0), i * 3); return d; });
  // a normal's change is a direction: turned into her frame without the frame's scale
  const tScale = Math.hypot(T[0], T[1], T[2]);
  const bTargetNrm = followNormals ? body.listTargets().map((t) => { const A = t.getAttribute('NORMAL'); if (!A) return null; const d = readAttr(A); for (let i = 0; i < bn; i += 1) d.set(apply(T, [d[i * 3], d[i * 3 + 1], d[i * 3 + 2]], 0).map((v) => v / tScale), i * 3); return d; }) : null;
  // her triangles by cell, for closest-point queries; only the trunk, not the arms
  const CELL = 0.02, triCells = new Map();
  const tkey = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  for (let t = 0; t < bIdx.length; t += 3) {
    const a = bIdx[t] * 3, b = bIdx[t + 1] * 3, c = bIdx[t + 2] * 3;
    const cx = (bPos[a] + bPos[b] + bPos[c]) / 3; if (Math.abs(cx) > 0.3) continue;
    const lo = [0, 1, 2].map((k) => Math.min(bPos[a + k], bPos[b + k], bPos[c + k])), hi = [0, 1, 2].map((k) => Math.max(bPos[a + k], bPos[b + k], bPos[c + k]));
    for (let x = Math.floor(lo[0] / CELL); x <= Math.floor(hi[0] / CELL); x += 1) for (let y = Math.floor(lo[1] / CELL); y <= Math.floor(hi[1] / CELL); y += 1) for (let z = Math.floor(lo[2] / CELL); z <= Math.floor(hi[2] / CELL); z += 1) {
      const k = `${x},${y},${z}`; if (!triCells.has(k)) triCells.set(k, []); triCells.get(k).push(t);
    }
  }
  const P = (i) => [bPos[i * 3], bPos[i * 3 + 1], bPos[i * 3 + 2]];
  /** The nearest point of her skin: its triangle, barycentrics, signed distance and normal. */
  const nearest = (p) => {
    let best = null;
    for (let r = 0; r <= 8; r += 1) {
      if (best && Math.sqrt(best.d2) <= r * CELL) break; // nothing in a further ring can be nearer
      const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL), cz = Math.floor(p[2] / CELL);
      for (let i = -r; i <= r; i += 1) for (let j = -r; j <= r; j += 1) for (let k = -r; k <= r; k += 1) {
        if (Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) !== r) continue;
        const l = triCells.get(`${cx + i},${cy + j},${cz + k}`); if (!l) continue;
        for (const t of l) {
          const ia = bIdx[t], ib = bIdx[t + 1], ic = bIdx[t + 2], bc = closestBary(p, P(ia), P(ib), P(ic));
          const q = [0, 1, 2].map((d) => bc[0] * bPos[ia * 3 + d] + bc[1] * bPos[ib * 3 + d] + bc[2] * bPos[ic * 3 + d]);
          const d2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
          if (!best || d2 < best.d2) best = { d2, tri: [ia, ib, ic], bc, q };
        }
      }
    }
    if (!best) return null;
    const { tri, bc, q } = best, n = [0, 1, 2].map((d) => bc[0] * bNrm[tri[0] * 3 + d] + bc[1] * bNrm[tri[1] * 3 + d] + bc[2] * bNrm[tri[2] * 3 + d]);
    const l = Math.hypot(...n) || 1; for (let d = 0; d < 3; d += 1) n[d] /= l;
    const s = (p[0] - q[0]) * n[0] + (p[1] - q[1]) * n[1] + (p[2] - q[2]) * n[2];
    return { tri, bc, q, n, dist: Math.sign(s || 1) * Math.sqrt(best.d2) };
  };
  // her trunk's centre and width at a height, for placing a part
  const slice = (y, h = 0.01) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (let i = 0; i < bn; i += 1) { if (Math.abs(bPos[i * 3 + 1] - y) > h || Math.abs(bPos[i * 3]) > 0.3) continue; x0 = Math.min(x0, bPos[i * 3]); x1 = Math.max(x1, bPos[i * 3]); z0 = Math.min(z0, bPos[i * 3 + 2]); z1 = Math.max(z1, bPos[i * 3 + 2]); } return { x0, x1, z0, z1 }; };

  const parts = meshy.getRoot().listMeshes().map((m) => m.listPrimitives()[0]);
  let tipX = 0;
  const pieces = [];
  const PLACES = placeOverride ? { ...PLACE, ...placeOverride } : PLACE;
  for (const [label, place] of Object.entries(PLACES)) {
    const prim = parts[place.part];
    let pos = readAttr(prim.getAttribute('POSITION'));
    const col = prim.getAttribute('COLOR_0') ? readAttr(prim.getAttribute('COLOR_0')) : null;
    let idx = Uint32Array.from(prim.getIndices().getArray());
    // THE HALTER'S KNOT (Joshua, 2026-10-14: "the strings at the top bikini part got
    // rendered inwards at the model not outwards"): the scan tied it with the bow's
    // loops and ends hanging FORWARD of the knot, which on her is into her neck. They
    // are turned about the knot to hang back, down her nape.
    if (label === 'top') flipKnot(pos);
    if (label === 'bottom' && place.back) reshapeBack(pos, place.back, log);
    // THE BRIEF TIPPED FORWARD (Joshua, 2026-10-15: "angle the whole bikini bottom forward
    // maybe 10° down so the front is lower and the back is higher naturally"): turned about
    // its own middle, in the scan's frame, the front down and the back up, before placing
    if (label === 'bottom' && place.pitchDeg) {
      // about the side ties' middle, so the ties and their knots stay where they were
      let yc = 0, zc = 0, k = 0; const m = pos.length / 3; for (let i = 0; i < m; i += 1) { if (Math.abs(pos[i * 3]) < TIE_FROM) continue; yc += pos[i * 3 + 1]; zc += pos[i * 3 + 2]; k += 1; } yc /= k; zc /= k;
      const a = (place.pitchDeg * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
      for (let i = 0; i < m; i += 1) { const y = pos[i * 3 + 1] - yc, z = pos[i * 3 + 2] - zc; pos[i * 3 + 1] = yc + y * c - z * sn; pos[i * 3 + 2] = zc + y * sn + z * c; }
      log(`fit: brief tipped ${place.pitchDeg}° forward about its middle`);
    }
    // 1. simplify
    const target = place.triangles * 3;
    const [simp] = MeshoptSimplifier.simplify(idx, pos, 3, target, 0.01, ['LockBorder']);
    const remap = new Int32Array(pos.length / 3).fill(-1); let m = 0;
    for (const v of simp) if (remap[v] < 0) remap[v] = m++;
    const np = new Float32Array(m * 3); for (let i = 0; i < remap.length; i += 1) if (remap[i] >= 0) np.set(pos.subarray(i * 3, i * 3 + 3), remap[i] * 3);
    pos = np; idx = Uint32Array.from(simp, (v) => remap[v]);
    const n = pos.length / 3;
    // which vertices are cup or the string between the cups, and which face of the
    // fabric each is on (its scan normal toward the front or toward her)
    const scanNrm = vertexNormals(pos, idx), printed = new Uint8Array(n), layer = new Float32Array(n);
    // what each vertex is, read in the scan's own frame: 0 brief, 1 a side tie, 2 cup,
    // 3 halter strap, 4 the halter's knot and bow
    const part = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      const ax = Math.abs(pos[i * 3]), y = pos[i * 3 + 1];
      part[i] = label === 'bottom' ? (ax > TIE_FROM ? 1 : 0) : y < 0.45 ? 2 : y < 0.8 ? 3 : 4; // the knot and bow: the top of the halter
    }
    if (label === 'top') for (let i = 0; i < n; i += 1) if (pos[i * 3 + 1] < 0.45) { printed[i] = 1; layer[i] = (scanNrm[i * 3 + 2] + 1) / 2; }
    // 2. place
    let y0 = Infinity, y1 = -Infinity, zc = 0; for (let i = 0; i < n; i += 1) { y0 = Math.min(y0, pos[i * 3 + 1]); y1 = Math.max(y1, pos[i * 3 + 1]); }
    const s = place.scale, tip = {};
    let dy, dz;
    if (label === 'bottom') {
      // tipped, the brief is placed by its ties' tops, not by its highest point (now its back)
      let ref = y1; if (place.pitchDeg) { ref = -Infinity; for (let i = 0; i < n; i += 1) if (Math.abs(pos[i * 3]) > TIE_FROM) ref = Math.max(ref, pos[i * 3 + 1]); }
      dy = place.topY - ref * s;
      // the brief's ring centred front-to-back on her at its own middle height
      const midY = ((y0 + y1) / 2) * s + dy, her = slice(midY); let z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < n; i += 1) if (Math.abs(pos[i * 3 + 1] * s + dy - midY) < 0.01 && Math.abs(pos[i * 3]) < 0.15 / s) { z0 = Math.min(z0, pos[i * 3 + 2]); z1 = Math.max(z1, pos[i * 3 + 2]); }
      dz = her.z0 + 0.004 - z0 * s; // its back on her seat; the wrap brings the front onto her
      log(`fit: brief ring ${((z1 - z0) * s * 100).toFixed(1)} cm deep at ${midY.toFixed(3)} m, her ${((her.z1 - her.z0) * 100).toFixed(1)} cm, width hers ${((her.x1 - her.x0) * 100).toFixed(1)} cm`);
    } else {
      // EACH CUP ON HER BREAST (Joshua, 2026-10-14: "make sure the bikini top's shape
      // matches her breast size and shape... it goes just a little too long and flat"):
      // a cup is scaled about its own middle and that middle put on her breast's tip,
      // its lower edge in the crease under it; the string between the cups stretches to
      // meet them, and the straps follow their cups up to the knot
      Object.assign(tip, { x: 0, y: 0, z: -Infinity });
      for (let i = 0; i < bn; i += 1) { const x = bPos[i * 3], y = bPos[i * 3 + 1], z = bPos[i * 3 + 2]; if (x > tipBox[0] && x < tipBox[1] && y > tipBox[2] && y < tipBox[3] && z > tip.z) Object.assign(tip, { x, y, z }); }
      // the crease: under the tip, the height where her front comes furthest back
      const front = new Float32Array(24).fill(-Infinity);
      for (let i = 0; i < bn; i += 1) { const x = bPos[i * 3], y = bPos[i * 3 + 1], z = bPos[i * 3 + 2], b = Math.floor((tip.y - y) / 0.005); if (Math.abs(x - tip.x) < 0.012 && b >= 0 && b < 24) front[b] = Math.max(front[b], z); }
      let fb = 0; for (let b = 1; b < 24; b += 1) if (front[b] < front[fb]) fb = b;
      const foldY = tip.y - (fb + 0.5) * 0.005;
      let cupLo = Infinity, xi = Infinity, cx = 0, cc = 0, cupZ = -Infinity;
      for (let i = 0; i < n; i += 1) {
        const ax = Math.abs(pos[i * 3]), y = pos[i * 3 + 1];
        if (y > 0.45) continue;
        cupLo = Math.min(cupLo, y); cupZ = Math.max(cupZ, pos[i * 3 + 2]);
        if (y > 0.06) { xi = Math.min(xi, ax); cx += ax; cc += 1; }
      }
      cx /= cc;
      const inner = tip.x + (xi - cx) * s;
      // the halter above the cups may be scaled on its own (`strapScale`), so a smaller cup
      // does not shorten the straps and bring the knot round to the front of her neck;
      // the scale eases from the cup's to the strap's over the strap's first stretch
      const sS = place.strapScale ?? s, sy = (y) => { const t = Math.min(1, Math.max(0, (y - 0.45) / 0.17)); return s + (sS - s) * t * t * (3 - 2 * t); };
      // the height a scan height lands at: the integral of the varying scale from the cup's foot
      const Y = (y) => { if (y <= 0.45 || sS === s) return (y - cupLo) * s + foldY; let acc = (0.45 - cupLo) * s; const steps = 24, dy = (y - 0.45) / steps; for (let k = 0; k < steps; k += 1) acc += sy(0.45 + (k + 0.5) * dy) * dy; return acc + foldY; };
      for (let i = 0; i < n; i += 1) {
        const x = pos[i * 3], ax = Math.abs(x), y = pos[i * 3 + 1], se = sy(y), X = ax >= xi ? tip.x + (ax - cx) * se : (ax / xi) * inner;
        pos[i * 3] = Math.sign(x) * X;
        pos[i * 3 + 1] = Y(y);
        pos[i * 3 + 2] = (pos[i * 3 + 2] - cupZ) * se + tip.z + GAP_M;
      }
      tipX = tip.x;
      log(`fit: her breast tip at x ${tip.x.toFixed(3)} y ${tip.y.toFixed(3)}, crease at y ${foldY.toFixed(3)}; cups ${(((0.42 - xi) * s) * 100).toFixed(1)} cm wide`);
    }
    if (label === 'bottom') for (let i = 0; i < n; i += 1) { pos[i * 3] *= s; pos[i * 3 + 1] = pos[i * 3 + 1] * s + dy; pos[i * 3 + 2] = pos[i * 3 + 2] * s + dz; }
    // THE CUPS ARE PRINTED ON HER (Joshua: "almost have it match the body's mesh
    // exactly"): seen from the front, each cup's outline stays where it was placed, and
    // it is laid on the skin under that outline, the fabric's inner face GAP_M off her
    // and its outer face FABRIC_M further, so a cup is her breast's own shape
    if (label === 'top') {
      const R = 0.0015, X0 = -0.26, Y0 = 0.95, W = Math.ceil(0.52 / R), H = Math.ceil(0.55 / R);
      const zb = new Float32Array(W * H).fill(-Infinity), nb = new Float32Array(W * H * 3);
      for (let t = 0; t < bIdx.length; t += 3) {
        const ia = bIdx[t], ib = bIdx[t + 1], ic = bIdx[t + 2];
        const ax = bPos[ia * 3], ay = bPos[ia * 3 + 1], bx = bPos[ib * 3], by = bPos[ib * 3 + 1], cx2 = bPos[ic * 3], cy2 = bPos[ic * 3 + 1];
        if (Math.max(ax, bx, cx2) < X0 || Math.min(ax, bx, cx2) > X0 + W * R || Math.max(ay, by, cy2) < Y0 || Math.min(ay, by, cy2) > Y0 + H * R) continue;
        const den = (by - cy2) * (ax - cx2) + (cx2 - bx) * (ay - cy2); if (Math.abs(den) < 1e-12) continue;
        const u0 = Math.max(0, Math.floor((Math.min(ax, bx, cx2) - X0) / R)), u1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx, cx2) - X0) / R));
        const v0 = Math.max(0, Math.floor((Math.min(ay, by, cy2) - Y0) / R)), v1 = Math.min(H - 1, Math.ceil((Math.max(ay, by, cy2) - Y0) / R));
        for (let v = v0; v <= v1; v += 1) for (let u = u0; u <= u1; u += 1) {
          const px = X0 + (u + 0.5) * R, py = Y0 + (v + 0.5) * R;
          const l1 = ((by - cy2) * (px - cx2) + (cx2 - bx) * (py - cy2)) / den, l2 = ((cy2 - ay) * (px - cx2) + (ax - cx2) * (py - cy2)) / den, l3 = 1 - l1 - l2;
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
          const z = l1 * bPos[ia * 3 + 2] + l2 * bPos[ib * 3 + 2] + l3 * bPos[ic * 3 + 2], k = v * W + u;
          if (z <= zb[k]) continue;
          zb[k] = z; for (let d = 0; d < 3; d += 1) nb[k * 3 + d] = l1 * bNrm[ia * 3 + d] + l2 * bNrm[ib * 3 + d] + l3 * bNrm[ic * 3 + d];
        }
      }
      const at = (x, y) => { // bilinear over the front surface
        const fu = (x - X0) / R - 0.5, fv = (y - Y0) / R - 0.5, u = Math.max(0, Math.min(W - 2, Math.floor(fu))), v = Math.max(0, Math.min(H - 2, Math.floor(fv))), tu = fu - u, tv = fv - v;
        let z = 0, nn = [0, 0, 0], ws = 0;
        for (const [du, dv, w] of [[0, 0, (1 - tu) * (1 - tv)], [1, 0, tu * (1 - tv)], [0, 1, (1 - tu) * tv], [1, 1, tu * tv]]) { const k = (v + dv) * W + u + du; if (!Number.isFinite(zb[k]) || w <= 0) continue; z += zb[k] * w; for (let d = 0; d < 3; d += 1) nn[d] += nb[k * 3 + d] * w; ws += w; }
        if (!ws) return null; const l = Math.hypot(...nn) || 1; return { z: z / ws, n: nn.map((c) => c / l) };
      };
      // the crease under each breast, column by column: the height, below the tip, where
      // her front comes furthest back. Under it the front is her bump, which a cup never
      // reaches, so the cup's lower edge is gathered into the crease instead of being
      // laid on the belly
      const tipV = Math.round((tip.y - Y0) / R), reach = Math.round(0.12 / R), crease = new Float32Array(W).fill(NaN);
      for (let u = 0; u < W; u += 1) {
        const ax = Math.abs(X0 + (u + 0.5) * R); if (ax < tip.x - 0.03 || ax > 0.25) continue;
        let best = Infinity, bv = -1; for (let v = tipV; v > tipV - reach; v -= 1) { const z = zb[v * W + u]; if (Number.isFinite(z) && z < best) { best = z; bv = v; } }
        if (bv >= 0) crease[u] = Y0 + (bv + 0.5) * R;
      }
      const creaseAt = (x) => { const ax = Math.min(0.25, Math.max(tip.x - 0.03, Math.abs(x))), u = Math.round((Math.sign(x || 1) * ax - X0) / R - 0.5); let c = 0, k = 0; for (let d = -8; d <= 8; d += 1) if (Number.isFinite(crease[u + d])) { c += crease[u + d]; k += 1; } return k ? c / k : -Infinity; };
      const BAND = 0.015, LIFT = 0.01; // the edge stops just above the fold, never in it
      if (!followNormals) {
        for (let i = 0; i < n; i += 1) {
          if (!printed[i]) continue; const c = creaseAt(pos[i * 3]) + LIFT, d = pos[i * 3 + 1] - c;
          if (d < BAND) pos[i * 3 + 1] = c + BAND * Math.exp((d - BAND) / BAND);
        }
      } else {
        // (v2) THE CUP'S LOWER HALF IS SHORTENED, NOT CRUSHED (Joshua, 2026-10-15: "fix the
        // edges to look the same as v1"). v1 squeezed every cup vertex that came within
        // BAND of the crease into that band, which on v1 touched only the hem; v2's breast
        // sits lower against the cup, so the band took whole centimetres of fabric and folded
        // them into pleats, a crumpled hem and fins at its corners. Here each column of the
        // cup below the tip is scaled evenly toward the tip so its lowest point lands where
        // v1's band put it: the same edge height, with nothing folded.
        const BIN = 0.002, low = new Map();
        for (let i = 0; i < n; i += 1) { if (!printed[i] || pos[i * 3 + 1] >= tip.y) continue; const b = Math.round(pos[i * 3] / BIN); low.set(b, Math.min(low.get(b) ?? Infinity, pos[i * 3 + 1])); }
        const lowAt = (x) => { const b = Math.round(x / BIN); let m = 0, k = 0; for (let d = -6; d <= 6; d += 1) { const v = low.get(b + d); if (v !== undefined) { m += v; k += 1; } } return k ? m / k : tip.y; };
        let shortened = 0;
        for (let i = 0; i < n; i += 1) {
          if (!printed[i] || pos[i * 3 + 1] >= tip.y) continue;
          const x = pos[i * 3], target = creaseAt(x) + LIFT, lo = lowAt(x);
          if (!(lo < target) || tip.y - lo < 0.01 || !(target < tip.y)) continue;
          const k = (tip.y - target) / (tip.y - lo);
          pos[i * 3 + 1] = Math.max(target, tip.y - (tip.y - pos[i * 3 + 1]) * k); shortened += 1;
        }
        log(`fit: ${shortened} cup vertices below the tip shortened evenly to clear the crease`);
      }
      const placed = followNormals ? Float32Array.from(pos) : null; // before printing, for the straps below
      for (let i = 0; i < n; i += 1) {
        if (!printed[i]) continue; const off = GAP_M + layer[i] * FABRIC_M, f = at(pos[i * 3], pos[i * 3 + 1]);
        if (!f) {
          // past the front of her (a cup's outer tip, round her side): v1 left it where it
          // was placed, which on v2 stood out sideways as a spike; laid on her skin instead
          // (its OUTER side only: on the inner side, where the cups' corners meet the bridge
          // string, laying vertices one by one on the nearest skin crumpled the corners into
          // lumps; there they drape with the wrap, as on v1)
          const q = followNormals && Math.abs(pos[i * 3]) > tip.x ? nearest([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]) : null;
          if (!q) { printed[i] = 0; continue; }
          pos.set([0, 1, 2].map((d) => q.q[d] + q.n[d] * off), i * 3); continue;
        }
        // where her skin turns away from the front (the side of the breast, under its
        // outer corner) a straight-on print would stretch the cup into a ledge; there it
        // is laid on the nearest skin instead, and the two blend between
        const p0 = [pos[i * 3], pos[i * 3 + 1], f.z], pf = [0, 1, 2].map((d) => p0[d] + f.n[d] * off);
        const w = 1 - Math.min(1, Math.max(0, (f.n[2] - 0.35) / 0.3));
        if (w > 0) {
          const q = nearest([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
          if (q) for (let d = 0; d < 3; d += 1) pf[d] = pf[d] * (1 - w) + (q.q[d] + q.n[d] * off) * w;
        }
        pos.set(pf, i * 3);
      }
      // (v2) THE CUP BENDS ONTO HER AS ONE PIECE (Joshua, 2026-10-15: "the bikini bra is
      // modeled smoothly, but I think how it's being shaped to the body that is the issue").
      // The print above moves each vertex on its own, and where her skin turns sharply (the
      // crease under the breast, the valley between them, the side round to her ribs)
      // neighbours were moved by very different amounts, so the scan's smooth cup folded into
      // flaps, fins and a crumpled hem. Here the MOVE is smoothed over the cup's own surface,
      // not the shape: millimetre-scale differences between neighbours go, the centimetre-
      // scale bend that follows her breast stays, so the cup keeps the scan's smooth fabric
      // and only bends. Then nothing is left under her skin: a vertex closer than the gap is
      // lifted to its own face's height off her.
      if (placed) {
        const mv = new Float32Array(n * 3); for (let i = 0; i < n * 3; i += 1) mv[i] = pos[i] - placed[i];
        const adj = Array.from({ length: n }, () => []);
        for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e += 1) { const a = idx[t + e], b = idx[t + (e + 1) % 3]; if (printed[a] && printed[b]) { adj[a].push(b); adj[b].push(a); } }
        for (let r = 0; r < PRINT_SMOOTH_ROUNDS; r += 1) {
          const nx = Float32Array.from(mv);
          for (let i = 0; i < n; i += 1) { if (!printed[i] || !adj[i].length) continue; const m = [0, 0, 0]; for (const j of adj[i]) for (let d = 0; d < 3; d += 1) m[d] += mv[j * 3 + d]; for (let d = 0; d < 3; d += 1) nx[i * 3 + d] = 0.5 * mv[i * 3 + d] + 0.5 * m[d] / adj[i].length; }
          mv.set(nx);
        }
        // The print is kept exactly wherever it did not fold the fabric (her breast's own smooth
        // shape, as on v1). A FOLD is a triangle the print turned over or crushed against the
        // scan's own: its facing turned by more than PRINT_FOLD_TURN, or its area cut below
        // PRINT_FOLD_AREA. Only there, and a few rings round it, does the smoothed bend take
        // over, blended out so no seam shows.
        const w = new Float32Array(n).fill(1);
        const tn = (P, a, b, c) => { const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]], e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]]; return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; };
        let folds = 0;
        for (let t = 0; t < idx.length; t += 3) {
          const a = idx[t], b = idx[t + 1], c = idx[t + 2]; if (!printed[a] || !printed[b] || !printed[c]) continue;
          const n0 = tn(placed, a, b, c), n1 = tn(pos, a, b, c), l0 = Math.hypot(...n0), l1 = Math.hypot(...n1); if (!(l0 > 0)) continue;
          const turn = (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) / (l0 * (l1 || 1));
          if (turn < PRINT_FOLD_TURN || l1 / l0 < PRINT_FOLD_AREA) { w[a] = w[b] = w[c] = 0; folds += 1; }
        }
        for (let r = 0; r < 4; r += 1) { const nx = Float32Array.from(w); for (let i = 0; i < n; i += 1) { if (!printed[i]) continue; for (const j of adj[i]) nx[i] = Math.min(nx[i], w[j]); } w.set(nx); }
        for (let r = 0; r < 8; r += 1) { const nx = Float32Array.from(w); for (let i = 0; i < n; i += 1) { if (!printed[i] || !adj[i].length) continue; let m = 0; for (const j of adj[i]) m += w[j]; nx[i] = 0.5 * w[i] + 0.5 * m / adj[i].length; } w.set(nx); }
        let kept = 0;
        for (let i = 0; i < n; i += 1) if (printed[i]) { for (let d = 0; d < 3; d += 1) pos[i * 3 + d] = w[i] * pos[i * 3 + d] + (1 - w[i]) * (placed[i * 3 + d] + mv[i * 3 + d]); if (w[i] > 0.5) kept += 1; }
        log(`fit: ${folds} folded triangles; ${kept} cup vertices keep the print, the rest take its smoothed bend`);
        // the lift is smoothed the same way: lifted one by one, the vertices that the smoothed
        // bend had carried into the valley between her breasts crumpled the cups' inner corners
        // again. Each round the lift each vertex needs is spread over its neighbours (never below
        // its own), so a dip comes out of her as one piece.
        let lifted = 0;
        for (let round = 0; round < 4; round += 1) {
          let L = new Float32Array(n * 3), any = 0;
          for (let i = 0; i < n; i += 1) { if (!printed[i]) continue; const off = GAP_M + layer[i] * FABRIC_M, q = nearest([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]); if (q && q.dist < off) { for (let d = 0; d < 3; d += 1) L[i * 3 + d] = q.n[d] * (off - q.dist); any += 1; } }
          if (!any) break; if (!round) lifted = any;
          const need = Float32Array.from(L);
          for (let r = 0; r < 24; r += 1) {
            const nx = Float32Array.from(L);
            for (let i = 0; i < n; i += 1) {
              if (!printed[i] || !adj[i].length) continue; const m = [0, 0, 0]; for (const j of adj[i]) for (let d = 0; d < 3; d += 1) m[d] += L[j * 3 + d];
              for (let d = 0; d < 3; d += 1) nx[i * 3 + d] = 0.5 * L[i * 3 + d] + 0.5 * m[d] / adj[i].length;
              const a = Math.hypot(nx[i * 3], nx[i * 3 + 1], nx[i * 3 + 2]), b = Math.hypot(need[i * 3], need[i * 3 + 1], need[i * 3 + 2]); if (a < b) for (let d = 0; d < 3; d += 1) nx[i * 3 + d] = need[i * 3 + d];
            }
            L = nx;
          }
          for (let i = 0; i < n * 3; i += 1) pos[i] += L[i];
        }
        // and the fabric's surface ironed (Taubin, so the cup keeps its size), each round held
        // clear of her: the scan's small crumples, squeezed by the shortening, go; the shape stays
        for (let r = 0; r < IRON_ROUNDS; r += 1) for (const lam of [0.5, -0.53]) {
          const nx = Float32Array.from(pos);
          for (let i = 0; i < n; i += 1) { if (!printed[i] || !adj[i].length) continue; const m = [0, 0, 0]; for (const j of adj[i]) for (let d = 0; d < 3; d += 1) m[d] += pos[j * 3 + d]; for (let d = 0; d < 3; d += 1) nx[i * 3 + d] = pos[i * 3 + d] + lam * (m[d] / adj[i].length - pos[i * 3 + d]); }
          pos.set(nx);
          if (lam < 0) for (let i = 0; i < n; i += 1) { if (!printed[i]) continue; const off = GAP_M + layer[i] * FABRIC_M, q = nearest([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]); if (q && q.dist < off) for (let d = 0; d < 3; d += 1) pos[i * 3 + d] += q.n[d] * (off - q.dist); }
        }
        log(`fit: the cups' print smoothed over their own surface (${PRINT_SMOOTH_ROUNDS} rounds), ${lifted} vertices lifted clear of her`);
      }
            // THE STRAPS LEAVE THE CUPS WHERE THE CUPS ARE (v2): printing moves each cup onto her
      // breast, and a strap that started at the cup's placed top was left behind, a step
      // where the two met. Each strap vertex near a cup takes the move of the nearest
      // printed cup vertex, fading out over `STRAP_FOLLOW_M` along the strap.
      if (placed) {
        const pr = []; for (let i = 0; i < n; i += 1) if (printed[i]) pr.push(i);
        const pg = grid(Float32Array.from(pr.flatMap((i) => [placed[i * 3], placed[i * 3 + 1], placed[i * 3 + 2]])), 0.01);
        let carried = 0;
        for (let i = 0; i < n; i += 1) {
          if (printed[i] || part[i] !== 3) continue;
          let best = -1, bd = Infinity;
          pg.near(placed[i * 3], placed[i * 3 + 1], placed[i * 3 + 2], STRAP_FOLLOW_M, (k) => { const q = pr[k], d = Math.hypot(placed[q * 3] - placed[i * 3], placed[q * 3 + 1] - placed[i * 3 + 1], placed[q * 3 + 2] - placed[i * 3 + 2]); if (d < bd) { bd = d; best = q; } });
          if (best < 0 || bd > STRAP_FOLLOW_M) continue;
          const t = 1 - bd / STRAP_FOLLOW_M, w = t * t * (3 - 2 * t);
          for (let d = 0; d < 3; d += 1) pos[i * 3 + d] += (pos[best * 3 + d] - placed[best * 3 + d]) * w;
          carried += 1;
        }
        log(`fit: ${carried} strap vertices follow their cups' print`);
      }
    }
    // 3. wrap
    const near = new Array(n);
    for (let i = 0; i < n; i += 1) near[i] = nearest([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
    const g = grid(pos, SHELL_M);
    const push = new Float32Array(n * 3), touching = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      const me = near[i]; if (!me) continue;
      let dmin = Infinity;
      g.near(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], SHELL_M, (q) => { if (near[q] && Math.hypot(pos[q * 3] - pos[i * 3], pos[q * 3 + 1] - pos[i * 3 + 1], pos[q * 3 + 2] - pos[i * 3 + 2]) <= SHELL_M) dmin = Math.min(dmin, near[q].dist); });
      if (printed[i]) { touching[i] = 1; continue; } // already on her
      if (dmin > place.contactM) continue;
      touching[i] = 1;
      const k = GAP_M - dmin; for (let d = 0; d < 3; d += 1) push[i * 3 + d] = me.n[d] * k;
    }
    // ease the push over touching neighbours so it reads as cloth, not as her triangles
    // (the top eases least: a cup has to follow her breast and the crease under it)
    const EASE_M = place.easeM, eg = grid(pos, EASE_M);
    for (let pass = 0; pass < place.ease; pass += 1) {
      const next = new Float32Array(push);
      for (let i = 0; i < n; i += 1) {
        if (!touching[i] || printed[i]) continue; const acc = [0, 0, 0]; let c = 0;
        eg.near(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], EASE_M, (q) => { if (!touching[q]) return; for (let d = 0; d < 3; d += 1) acc[d] += push[q * 3 + d]; c += 1; });
        for (let d = 0; d < 3; d += 1) next[i * 3 + d] = acc[d] / c;
      }
      push.set(next);
    }
    // the easing may have pulled a vertex back under her skin: hold every touching one
    // at least the gap off it
    for (let i = 0; i < n; i += 1) {
      if (!touching[i]) continue;
      const p = [pos[i * 3] + push[i * 3], pos[i * 3 + 1] + push[i * 3 + 1], pos[i * 3 + 2] + push[i * 3 + 2]], q = nearest(p);
      if (q && q.dist < GAP_M * 0.8) for (let d = 0; d < 3; d += 1) push[i * 3 + d] += q.n[d] * (GAP_M - q.dist);
    }
    // what hangs free is moved and bound with the nearest touching vertex
    const touchList = []; for (let i = 0; i < n; i += 1) if (touching[i]) touchList.push(i);
    const tg = grid(Float32Array.from(touchList.flatMap((i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]])), 0.01);
    const anchor = new Int32Array(n);
    for (let i = 0; i < n; i += 1) {
      if (touching[i]) { anchor[i] = i; continue; }
      let best = -1, bd = Infinity;
      for (let r = 0.01; best < 0 && r < 0.4; r *= 2) tg.near(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], r, (k) => { const q = touchList[k], d = Math.hypot(pos[q * 3] - pos[i * 3], pos[q * 3 + 1] - pos[i * 3 + 1], pos[q * 3 + 2] - pos[i * 3 + 2]); if (d < bd) { bd = d; best = q; } });
      anchor[i] = best; for (let d = 0; d < 3; d += 1) push[i * 3 + d] = push[best * 3 + d];
    }
    for (let i = 0; i < pos.length; i += 1) pos[i] += push[i];
    // (v2) nothing of a cup stands off her: a scrap of its edge that the print missed and the
    // wrap left out in the air is laid back on the skin under it
    if (followNormals && label === 'top') {
      let laid = 0;
      for (let i = 0; i < n; i += 1) {
        if (part[i] !== 2 || Math.abs(pos[i * 3]) < tipX + 0.035) continue; const q = nearest([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]); // its outer side only: over the nipple a cup stands off her by right
        if (!q || q.dist < GAP_M + FABRIC_M + 0.004) continue;
        pos.set([0, 1, 2].map((d) => q.q[d] + q.n[d] * (GAP_M + FABRIC_M)), i * 3); laid += 1;
      }
      log(`fit: ${laid} loose cup vertices laid back on her`);
    }
    if (process.env.FIT_DEBUG) { let under = 0, lo = Infinity; for (let i = 0; i < n; i += 1) { const q = nearest([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]); if (q) { lo = Math.min(lo, q.dist); if (q.dist < 0.001) under += 1; } } log(`debug: ${label} ${under} vertices under 1 mm, least ${(lo * 1000).toFixed(1)} mm`); }
    // THE STRINGS KEEP THEIR OWN CLEARANCE (Joshua, 2026-10-14: "the side ties, knots,
    // and loose ends must stay above the deformed skin… fix their local clearance
    // independently rather than moving the entire bikini outward"). Measured on the
    // posed, skinned body through the sit (scratch checker): the halter straps went
    // 2.3 mm under her shoulders mid-sit and the side ties 0.1 mm under her hips seated
    // at 200%. Each string is lifted by its own `STRING_CLEAR` off the skin under it, and
    // a side tie is bound to the skin directly under it rather than to the knot it hangs
    // from, so it rides that skin when the hip bends instead of being swallowed by it.
    // The brief and cups do not move.
    for (let i = 0; i < n; i += 1) {
      const lift = STRING_CLEAR[part[i]]; if (!lift) continue;
      const q = nearest([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]); if (!q) continue;
      for (let d = 0; d < 3; d += 1) pos[i * 3 + d] += q.n[d] * lift;
      if (part[i] === 1 && q.dist < 0.06) { anchor[i] = i; if (!touching[i]) { touching[i] = 1; touchList.push(i); } }
    }
    // 4. bind: the skin point under each touching vertex, after the wrap
    const bind = new Array(n);
    for (const i of touchList) bind[i] = nearest([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
    const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4), deltas = bTargets.map(() => new Float32Array(n * 3));
    for (let i = 0; i < n; i += 1) {
      const b = bind[anchor[i]], acc = new Map();
      for (let v = 0; v < 3; v += 1) for (let c = 0; c < 4; c += 1) { const w = bW[b.tri[v] * 4 + c] * b.bc[v]; if (w > 0) acc.set(bJ[b.tri[v] * 4 + c], (acc.get(bJ[b.tri[v] * 4 + c]) || 0) + w); }
      const top = [...acc].sort((p, q) => q[1] - p[1]).slice(0, 4), sum = top.reduce((a, [, w]) => a + w, 0);
      top.forEach(([j, w], c) => { joints[i * 4 + c] = j; weights[i * 4 + c] = w / sum; });
      // the fabric's own offset off the skin, carried by the skin normal's turn in each shape (followNormals)
      const off = followNormals && anchor[i] === i ? Math.max(0, b.dist) : 0;
      // (v2) BOUNDED: in the valley between her breasts a few shapes turn the skin's normal
      // nearly round, and the fabric's height carried along that turn flung the cups' inner
      // corners out as flaps. The height carried is at most NORMAL_CARRY_M and the shift it
      // makes in any one shape at most NORMAL_SHIFT_M; on her breast's smooth front neither binds.
      bTargets.forEach((d, t) => {
        const dn = off && bTargetNrm[t], sh = [0, 0, 0];
        if (dn) { const h = Math.min(off, NORMAL_CARRY_M); for (let k = 0; k < 3; k += 1) sh[k] = h * (b.bc[0] * dn[b.tri[0] * 3 + k] + b.bc[1] * dn[b.tri[1] * 3 + k] + b.bc[2] * dn[b.tri[2] * 3 + k]); const l = Math.hypot(...sh); if (l > NORMAL_SHIFT_M) for (let k = 0; k < 3; k += 1) sh[k] *= NORMAL_SHIFT_M / l; }
        for (let k = 0; k < 3; k += 1) deltas[t][i * 3 + k] = b.bc[0] * d[b.tri[0] * 3 + k] + b.bc[1] * d[b.tri[1] * 3 + k] + b.bc[2] * d[b.tri[2] * 3 + k] + sh[k];
      });
    }
    log(`fit: ${label} ${n.toLocaleString('en-US')} vertices, ${(idx.length / 3).toLocaleString('en-US')} triangles, ${touchList.length.toLocaleString('en-US')} on her skin`);
    pieces.push({ pos, idx, joints, weights, deltas, col, part });
  }

  // ── one primitive, both parts, in her skin space ──
  const N = pieces.reduce((a, p) => a + p.pos.length / 3, 0);
  const pos = new Float32Array(N * 3), joints = new Uint16Array(N * 4), weights = new Float32Array(N * 4), idx = [], deltas = bTargets.map(() => new Float32Array(N * 3));
  let o = 0;
  for (const p of pieces) { const n = p.pos.length / 3; pos.set(p.pos, o * 3); joints.set(p.joints, o * 4); weights.set(p.weights, o * 4); for (const v of p.idx) idx.push(v + o); deltas.forEach((d, t) => d.set(p.deltas[t], o * 3)); o += n; }
  const nrm = vertexNormals(pos, idx);
  const tNrm = deltas.map((d) => { const moved = pos.map((v, i) => v + d[i]), m = vertexNormals(moved, idx); return m.map((v, i) => v - nrm[i]); });
  const local = (arr, w) => { const out = new Float32Array(arr.length); for (let i = 0; i < arr.length / 3; i += 1) out.set(apply(Ti, [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]], w), i * 3); return out; };
  const nlocal = (arr) => { const out = local(arr, 0); return out; };
  const buffer = doc.getRoot().listBuffers()[0], acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  let dp = mesh.listPrimitives().find((p) => p.getMaterial()?.getName() === 'bikini');
  if (!dp && create) { dp = doc.createPrimitive().setMaterial(doc.createMaterial('bikini')); mesh.addPrimitive(dp); log('fit: the file had no bikini; added one as its own primitive and material'); }
  if (!dp) throw new Error('no bikini primitive in the file (pass create)');
  for (const sem of dp.listSemantics()) dp.setAttribute(sem, null);
  dp.setAttribute('POSITION', acc('VEC3', local(pos, 1)));
  const ln = nlocal(nrm); for (let i = 0; i < N; i += 1) { const l = Math.hypot(ln[i * 3], ln[i * 3 + 1], ln[i * 3 + 2]) || 1; ln[i * 3] /= l; ln[i * 3 + 1] /= l; ln[i * 3 + 2] /= l; }
  dp.setAttribute('NORMAL', acc('VEC3', ln));
  dp.setAttribute('JOINTS_0', acc('VEC4', joints));
  dp.setAttribute('WEIGHTS_0', acc('VEC4', weights));
  dp.setIndices(acc('SCALAR', Uint32Array.from(idx)));
  for (const t of [...dp.listTargets()]) { dp.removeTarget(t); t.dispose(); }
  names.forEach((name, k) => {
    const t = doc.createPrimitiveTarget(name);
    t.setAttribute('POSITION', acc('VEC3', local(deltas[k], 0)));
    t.setAttribute('NORMAL', acc('VEC3', nlocal(tNrm[k])));
    dp.addTarget(t);
  });
  if (process.env.FIT_DEBUG || keepTags) { const tag = new Uint8Array(N); let k = 0; for (const p of pieces) { tag.set(p.part, k); k += p.part.length; } dp.setAttribute('_TAG', acc('SCALAR', tag)); }
  dp.setExtras({ source: 'meshy', fitted: 'scripts/fitMeshyBikini.mjs' });
  // plain fabric until it has a texture of its own
  const mat = dp.getMaterial();
  for (const slot of ['BaseColor', 'Normal', 'MetallicRoughness', 'Occlusion', 'Emissive']) mat[`set${slot}Texture`](null);
  mat.setBaseColorFactor([0.13, 0.26, 0.12, 1]).setRoughnessFactor(0.75).setMetallicFactor(0).setDoubleSided(true);
  for (const tex of doc.getRoot().listTextures()) if (!tex.listParents().some((p) => p.propertyType !== 'Root')) tex.dispose();
  await io.write(out, doc);
  log(`fit: bikini replaced (${N.toLocaleString('en-US')} vertices, ${names.length} shapes); every other primitive untouched`);
}

if (process.argv[1]?.endsWith('fitMeshyBikini.mjs')) {
  const [meshy, sarah] = process.argv.slice(2);
  await fitMeshyBikini(meshy, sarah);
}
