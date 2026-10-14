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
  bottom: { part: 0, scale: 0.43, topY: 0.915, contactM: 0.035, triangles: 20000 },
  // the top: its cups centred on her breasts
  top: { part: 1, scale: 0.36, cupY: 1.235, contactM: 0.05, triangles: 40000 },
});
/** The fabric's inner face this far off her skin. */
export const GAP_M = 0.003;
/** The neighbourhood whose nearest point decides a vertex's push: wider than the fabric is thick. */
export const SHELL_M = 0.008;
/** Passes of easing over the push. */
export const PUSH_EASE = 12;

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

function vertexNormals(pos, idx) {
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

export async function fitMeshyBikini(meshyFile, sarahFile, { log = console.log } = {}) {
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
  const pieces = [];
  for (const [label, place] of Object.entries(PLACE)) {
    const prim = parts[place.part];
    let pos = readAttr(prim.getAttribute('POSITION'));
    const col = prim.getAttribute('COLOR_0') ? readAttr(prim.getAttribute('COLOR_0')) : null;
    let idx = Uint32Array.from(prim.getIndices().getArray());
    // THE HALTER'S KNOT (Joshua, 2026-10-14: "the strings at the top bikini part got
    // rendered inwards at the model not outwards"): the scan tied it with the bow's
    // loops and ends hanging FORWARD of the knot, which on her is into her neck. They
    // are turned about the knot to hang back, down her nape.
    if (label === 'top') flipKnot(pos);
    // 1. simplify
    const target = place.triangles * 3;
    const [simp] = MeshoptSimplifier.simplify(idx, pos, 3, target, 0.01, ['LockBorder']);
    const remap = new Int32Array(pos.length / 3).fill(-1); let m = 0;
    for (const v of simp) if (remap[v] < 0) remap[v] = m++;
    const np = new Float32Array(m * 3); for (let i = 0; i < remap.length; i += 1) if (remap[i] >= 0) np.set(pos.subarray(i * 3, i * 3 + 3), remap[i] * 3);
    pos = np; idx = Uint32Array.from(simp, (v) => remap[v]);
    const n = pos.length / 3;
    // 2. place
    let y0 = Infinity, y1 = -Infinity, zc = 0; for (let i = 0; i < n; i += 1) { y0 = Math.min(y0, pos[i * 3 + 1]); y1 = Math.max(y1, pos[i * 3 + 1]); }
    const s = place.scale;
    let dy, dz;
    if (label === 'bottom') {
      dy = place.topY - y1 * s;
      // the brief's ring centred front-to-back on her at its own middle height
      const midY = ((y0 + y1) / 2) * s + dy, her = slice(midY); let z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < n; i += 1) if (Math.abs(pos[i * 3 + 1] * s + dy - midY) < 0.01 && Math.abs(pos[i * 3]) < 0.15 / s) { z0 = Math.min(z0, pos[i * 3 + 2]); z1 = Math.max(z1, pos[i * 3 + 2]); }
      dz = her.z0 + 0.004 - z0 * s; // its back on her seat; the wrap brings the front onto her
      log(`fit: brief ring ${((z1 - z0) * s * 100).toFixed(1)} cm deep at ${midY.toFixed(3)} m, her ${((her.z1 - her.z0) * 100).toFixed(1)} cm, width hers ${((her.x1 - her.x0) * 100).toFixed(1)} cm`);
    } else {
      // the cups' lowest edge (the scan's y=0) at her cup line; their back face on her chest
      let cupLo = Infinity; for (let i = 0; i < n; i += 1) if (pos[i * 3 + 1] < y0 + 0.5 * (y1 - y0)) cupLo = Math.min(cupLo, pos[i * 3 + 1]);
      dy = place.cupY - 0.25 * s - cupLo * s; // cup centre (a quarter of the cup's height up) at cupY
      const her = slice(place.cupY, 0.01); let zf = -Infinity; for (let i = 0; i < n; i += 1) if (pos[i * 3 + 1] < 0.4) zf = Math.max(zf, pos[i * 3 + 2]);
      dz = her.z1 + 0.004 - zf * s;
    }
    for (let i = 0; i < n; i += 1) { pos[i * 3] *= s; pos[i * 3 + 1] = pos[i * 3 + 1] * s + dy; pos[i * 3 + 2] = pos[i * 3 + 2] * s + dz; }
    // 3. wrap
    const near = new Array(n);
    for (let i = 0; i < n; i += 1) near[i] = nearest([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
    const g = grid(pos, SHELL_M);
    const push = new Float32Array(n * 3), touching = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      const me = near[i]; if (!me) continue;
      let dmin = Infinity;
      g.near(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], SHELL_M, (q) => { if (near[q] && Math.hypot(pos[q * 3] - pos[i * 3], pos[q * 3 + 1] - pos[i * 3 + 1], pos[q * 3 + 2] - pos[i * 3 + 2]) <= SHELL_M) dmin = Math.min(dmin, near[q].dist); });
      if (dmin > place.contactM) continue;
      touching[i] = 1;
      const k = GAP_M - dmin; for (let d = 0; d < 3; d += 1) push[i * 3 + d] = me.n[d] * k;
    }
    // ease the push over touching neighbours so it reads as cloth, not as her triangles
    const EASE_M = 0.009, eg = grid(pos, EASE_M);
    for (let pass = 0; pass < PUSH_EASE; pass += 1) {
      const next = new Float32Array(push);
      for (let i = 0; i < n; i += 1) {
        if (!touching[i]) continue; const acc = [0, 0, 0]; let c = 0;
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
    if (process.env.FIT_DEBUG) { let under = 0, lo = Infinity; for (let i = 0; i < n; i += 1) { const q = nearest([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]); if (q) { lo = Math.min(lo, q.dist); if (q.dist < 0.001) under += 1; } } log(`debug: ${label} ${under} vertices under 1 mm, least ${(lo * 1000).toFixed(1)} mm`); }
    // 4. bind: the skin point under each touching vertex, after the wrap
    const bind = new Array(n);
    for (const i of touchList) bind[i] = nearest([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
    const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4), deltas = bTargets.map(() => new Float32Array(n * 3));
    for (let i = 0; i < n; i += 1) {
      const b = bind[anchor[i]], acc = new Map();
      for (let v = 0; v < 3; v += 1) for (let c = 0; c < 4; c += 1) { const w = bW[b.tri[v] * 4 + c] * b.bc[v]; if (w > 0) acc.set(bJ[b.tri[v] * 4 + c], (acc.get(bJ[b.tri[v] * 4 + c]) || 0) + w); }
      const top = [...acc].sort((p, q) => q[1] - p[1]).slice(0, 4), sum = top.reduce((a, [, w]) => a + w, 0);
      top.forEach(([j, w], c) => { joints[i * 4 + c] = j; weights[i * 4 + c] = w / sum; });
      bTargets.forEach((d, t) => { for (let k = 0; k < 3; k += 1) deltas[t][i * 3 + k] = b.bc[0] * d[b.tri[0] * 3 + k] + b.bc[1] * d[b.tri[1] * 3 + k] + b.bc[2] * d[b.tri[2] * 3 + k]; });
    }
    log(`fit: ${label} ${n.toLocaleString('en-US')} vertices, ${(idx.length / 3).toLocaleString('en-US')} triangles, ${touchList.length.toLocaleString('en-US')} on her skin`);
    pieces.push({ pos, idx, joints, weights, deltas, col });
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
  const dp = mesh.listPrimitives().find((p) => p.getMaterial()?.getName() === 'bikini');
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
  dp.setExtras({ source: 'meshy', fitted: 'scripts/fitMeshyBikini.mjs' });
  // plain fabric until it has a texture of its own
  const mat = dp.getMaterial();
  for (const slot of ['BaseColor', 'Normal', 'MetallicRoughness', 'Occlusion', 'Emissive']) mat[`set${slot}Texture`](null);
  mat.setBaseColorFactor([0.13, 0.26, 0.12, 1]).setRoughnessFactor(0.75).setMetallicFactor(0).setDoubleSided(true);
  for (const tex of doc.getRoot().listTextures()) if (!tex.listParents().some((p) => p.propertyType !== 'Root')) tex.dispose();
  await io.write(sarahFile, doc);
  log(`fit: bikini replaced (${N.toLocaleString('en-US')} vertices, ${names.length} shapes); every other primitive untouched`);
}

if (process.argv[1]?.endsWith('fitMeshyBikini.mjs')) {
  const [meshy, sarah] = process.argv.slice(2);
  await fitMeshyBikini(meshy, sarah);
}
