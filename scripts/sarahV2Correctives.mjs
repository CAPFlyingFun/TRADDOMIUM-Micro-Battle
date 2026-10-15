/**
 * SARAH v2's CORRECTIVES, ADDED TO THE SHIPPED FILE AND NOTHING ELSE MOVED (Joshua,
 * 2026-10-14). The approved 100% body is untouched; so is the source master. Run after
 * any `bake:humans` that rewrites `public/models/sarah-v2.glb`, then `packSarah.mjs`.
 *
 * 1. THE GROIN HOLDS STILL. Every belly size used to move her pubis, groin and upper
 *    thighs as well (up to 34 mm at 0%), so the front of her hip changed as the slider
 *    moved. Each belly shape is now faded to nothing below her groin crease — a line
 *    from the pubis up to the front of each hip — over a short smooth band, so the
 *    bump ends where a bump ends and her legs are the same legs at every size.
 *
 * 2. THE OUTIE ARRIVES AT 75%. Her outie is modelled into the 100% master, so every
 *    smaller size carried it. `navelFlat` settles it into an ordinary navel (the ring
 *    around it, carried across, with a shallow dimple); the Lab holds it fully on to
 *    75% and lets it go by 100% (`navelFlatWeight`).
 *
 * 3. THE KNEES BEND WITHOUT CRUMPLING: thigh-to-shin weights eased across each knee.
 * 4. SEATED, THE BUMP RIDES OVER HER THIGHS: `bellySeatV2`, on only while she sits.
 *
 * Idempotent: the file is stamped, and a second run refuses.
 *
 *   node scripts/sarahV2Correctives.mjs public/models/sarah-v2.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

/** The groin crease, metres: height at the centre line and how fast it climbs outward. */
export const CREASE_Y0 = 0.82;
export const CREASE_SLOPE = 1.0;
/** The fade's band below and above that line. */
export const CREASE_BELOW_M = 0.02;
export const CREASE_ABOVE_M = 0.02;
/** How much longer the fade grows per metre out from the centre line. */
export const CREASE_WIDEN = 0.8;
/** Belly shapes the groin is held against. */
export const BELLY_SHAPES = /^belly(\d+)?$|^bellyRefine$/;
/** Her navel (the bake's `navel`), the radius the outie is settled within, the ring read for the surface, and the dimple left. */
export const NAVEL = [0, 1.012];
export const NAVEL_FLAT_R = 0.022;
export const NAVEL_RING = [0.024, 0.036];
export const NAVEL_DIMPLE_M = 0.003;
/** The band each side of a knee its weights are eased over, and how many passes. */
export const KNEE_BAND_M = 0.15;
export const KNEE_PASSES = 100;
/**
 * The seated corrective, metres on her 100% body: the bump's lower half (full below
 * LOW[0], nothing by LOW[1], her navel), in front (FRONT), within her flanks (FLANK),
 * moved UP and FORWARD at weight 1. GAME TUNING against seated renders.
 */
export const SEAT_V2 = Object.freeze({ LOW: [0.84, 1.06], FRONT: [0.0, 0.08], FLANK: [0.1, 0.2], UP: 0.012, FORWARD: 0.014 });

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

/** How much of a belly shape a point at (x, y) in metres keeps: 0 under the groin crease, 1 above it. */
export function groinKeep(x, y) {
  const yc = CREASE_Y0 + CREASE_SLOPE * Math.max(0, Math.abs(x) - 0.035);
  // toward the hip the waist above still slims, so the fade is longer there (a short one left a ledge)
  return smooth(yc - CREASE_BELOW_M, yc + CREASE_ABOVE_M + CREASE_WIDEN * Math.max(0, Math.abs(x) - 0.06), y);
}

/** z = a + bx + cy + dx² + exy + fy², least squares. */
function fitQuadric(pts) {
  const A = Array.from({ length: 6 }, () => new Array(7).fill(0));
  for (const [x, y, z] of pts) { const r = [1, x, y, x * x, x * y, y * y]; for (let i = 0; i < 6; i += 1) { for (let j = 0; j < 6; j += 1) A[i][j] += r[i] * r[j]; A[i][6] += r[i] * z; } }
  for (let i = 0; i < 6; i += 1) { let p = i; for (let k = i + 1; k < 6; k += 1) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k; [A[i], A[p]] = [A[p], A[i]]; for (let k = 0; k < 6; k += 1) if (k !== i) { const f = A[k][i] / A[i][i]; for (let j = i; j < 7; j += 1) A[k][j] -= f * A[i][j]; } }
  const c = A.map((row, i) => row[6] / row[i]);
  return (x, y) => c[0] + c[1] * x + c[2] * y + c[3] * x * x + c[4] * x * y + c[5] * y * y;
}

export async function sarahV2Correctives(file, { log = console.log } = {}) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(file);
  const mesh = doc.getRoot().listMeshes()[0], extras = mesh.getExtras() ?? {}, names = [...(extras.targetNames ?? [])];
  if (extras.v2Correctives) throw new Error(`${file} already carries the v2 correctives (${extras.v2Correctives}); rebake it first`);
  const skin = doc.getRoot().listSkins()[0], T = mul(skin.listJoints()[0].getWorldMatrix(), Array.from(skin.getInverseBindMatrices().getArray().slice(0, 16))), Ti = invert(T);
  let held = 0, worst = 0;
  for (const prim of mesh.listPrimitives()) {
    const P = read(prim.getAttribute('POSITION')), n = P.length / 3;
    for (let i = 0; i < n; i += 1) P.set(apply(T, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], 1), i * 3);
    const keep = new Float32Array(n); for (let i = 0; i < n; i += 1) keep[i] = groinKeep(P[i * 3], P[i * 3 + 1]);
    // 1. every belly shape faded under the groin crease (positions and normals alike)
    names.forEach((name, t) => {
      if (!BELLY_SHAPES.test(name)) return;
      const target = prim.listTargets()[t];
      for (const sem of target.listSemantics()) {
        const A = target.getAttribute(sem), d = read(A);
        for (let i = 0; i < n; i += 1) {
          if (keep[i] >= 1) continue;
          if (sem === 'POSITION') { const m = Math.hypot(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]); const s = apply(T, [d[i * 3], d[i * 3 + 1], d[i * 3 + 2]], 0); worst = Math.max(worst, Math.hypot(...s) * (1 - keep[i])); if (m) held += 1; }
          for (let c = 0; c < 3; c += 1) d[i * 3 + c] *= keep[i];
        }
        A.setArray(d).setNormalized(false);
      }
    });
    // 2. navelFlat: the outie settled onto the surface its ring describes
    const ring = [];
    for (let i = 0; i < n; i += 1) { const r = Math.hypot(P[i * 3] - NAVEL[0], P[i * 3 + 1] - NAVEL[1]); if (r >= NAVEL_RING[0] && r <= NAVEL_RING[1] && P[i * 3 + 2] > 0.1) ring.push([P[i * 3] - NAVEL[0], P[i * 3 + 1] - NAVEL[1], P[i * 3 + 2]]); }
    const surf = fitQuadric(ring), flat = new Float32Array(n * 3), flatN = new Float32Array(n * 3);
    let moved = 0, deepest = 0;
    for (let i = 0; i < n; i += 1) {
      const x = P[i * 3] - NAVEL[0], y = P[i * 3 + 1] - NAVEL[1], r = Math.hypot(x, y);
      if (r >= NAVEL_RING[0] || P[i * 3 + 2] < 0.1) continue;
      const want = surf(x, y) - NAVEL_DIMPLE_M * (1 - smooth(0, NAVEL_FLAT_R, r)) ** 2, f = 1 - smooth(NAVEL_FLAT_R * 0.7, NAVEL_RING[0], r), dz = (want - P[i * 3 + 2]) * f;
      if (!dz) continue;
      const local = apply(Ti, [0, 0, dz], 0); flat.set(local, i * 3); moved += 1; deepest = Math.min(deepest, dz);
    }
    // its shading: the normals of the settled surface less the outie's, in the file's own space
    {
      const L = read(prim.getAttribute('POSITION')), idx = prim.getIndices().getArray(), key = new Map(), id = new Int32Array(n);
      for (let i = 0; i < n; i += 1) { const k = `${L[i * 3].toFixed(6)},${L[i * 3 + 1].toFixed(6)},${L[i * 3 + 2].toFixed(6)}`; if (!key.has(k)) key.set(k, key.size); id[i] = key.get(k); }
      const normals = (Q) => { const acc = new Float32Array(key.size * 3); for (let t = 0; t < idx.length; t += 3) { const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]], u = [0, 1, 2].map((d) => Q[b * 3 + d] - Q[a * 3 + d]), v = [0, 1, 2].map((d) => Q[c * 3 + d] - Q[a * 3 + d]), f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; for (const w of [a, b, c]) for (let d = 0; d < 3; d += 1) acc[id[w] * 3 + d] += f[d]; } return acc; };
      const Q = new Float32Array(L); for (let k = 0; k < Q.length; k += 1) Q[k] += flat[k];
      const n0 = normals(L), n1 = normals(Q), N0 = read(prim.getAttribute('NORMAL'));
      const unit = (a, u) => { const l = Math.hypot(a[u * 3], a[u * 3 + 1], a[u * 3 + 2]) || 1; return [a[u * 3] / l, a[u * 3 + 1] / l, a[u * 3 + 2] / l]; };
      for (let i = 0; i < n; i += 1) {
        const r = Math.hypot(P[i * 3] - NAVEL[0], P[i * 3 + 1] - NAVEL[1]); if (r > NAVEL_RING[1] || P[i * 3 + 2] < 0.1) continue;
        const a = unit(n0, id[i]), b = unit(n1, id[i]), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        // the stored normal turned by the same change, so smoothing groups the artist set are kept
        const m = [N0[i * 3] + d[0], N0[i * 3 + 1] + d[1], N0[i * 3 + 2] + d[2]], l = Math.hypot(...m) || 1;
        for (let c = 0; c < 3; c += 1) flatN[i * 3 + c] = m[c] / l - N0[i * 3 + c];
      }
    }
    const tPos = doc.createAccessor().setType('VEC3').setArray(flat), tN = doc.createAccessor().setType('VEC3').setArray(flatN);
    prim.addTarget(doc.createPrimitiveTarget('navelFlat').setAttribute('POSITION', tPos).setAttribute('NORMAL', tN));
    log(`navelFlat: ${moved} vertices settled, the outie lowered up to ${(-deepest * 1000).toFixed(1)} mm onto the surface its ring describes`);
  }
  // 3. the knees bend without crumpling: the weights handing her thigh to her shin are
  // eased across a band each side of the knee, so a deep bend spreads instead of folding
  {
    const joints = skin.listJoints(), knees = joints.map((j, k) => [k, j.getWorldTranslation()]).filter(([, t]) => t[1] > 0.4 && t[1] < 0.65 && Math.abs(t[0]) > 0.05 && Math.abs(t[0]) < 0.2);
    for (const prim of mesh.listPrimitives()) {
      const P = read(prim.getAttribute('POSITION')), n = P.length / 3; for (let i = 0; i < n; i += 1) P.set(apply(T, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], 1), i * 3);
      const J = read(prim.getAttribute('JOINTS_0')), W = read(prim.getAttribute('WEIGHTS_0')), idx = prim.getIndices().getArray();
      const key = new Map(), id = new Int32Array(n); for (let i = 0; i < n; i += 1) { const k = `${P[i * 3].toFixed(6)},${P[i * 3 + 1].toFixed(6)},${P[i * 3 + 2].toFixed(6)}`; if (!key.has(k)) key.set(k, key.size); id[i] = key.get(k); }
      const U = key.size, nb = Array.from({ length: U }, () => new Set()), rep = new Int32Array(U); for (let i = 0; i < n; i += 1) rep[id[i]] = i;
      for (let t = 0; t < idx.length; t += 3) for (const [a, b] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) { nb[id[a]].add(id[b]); nb[id[b]].add(id[a]); }
      // how much each point eases: 1 at the knee's height, nothing a band away, legs only
      const rate = new Float32Array(U);
      for (let u = 0; u < U; u += 1) { const i = rep[u]; for (const [, t] of knees) { if (Math.sign(P[i * 3]) !== Math.sign(t[0]) || Math.abs(P[i * 3] - t[0]) > 0.12) continue; rate[u] = Math.max(rate[u], 1 - smooth(KNEE_BAND_M * 0.5, KNEE_BAND_M, Math.abs(P[i * 3 + 1] - t[1]))); } }
      let w = Array.from({ length: U }, (_, u) => { const m = new Map(), i = rep[u]; for (let c = 0; c < 4; c += 1) if (W[i * 4 + c] > 0) m.set(J[i * 4 + c], (m.get(J[i * 4 + c]) || 0) + W[i * 4 + c]); return m; });
      let eased = 0;
      for (let pass = 0; pass < KNEE_PASSES; pass += 1) {
        w = w.map((m, u) => {
          if (!rate[u] || !nb[u].size) return m;
          const avg = new Map(); for (const v of nb[u]) for (const [k, x] of w[v]) avg.set(k, (avg.get(k) || 0) + x / nb[u].size);
          const f = 0.5 * rate[u], out = new Map(); for (const k of new Set([...m.keys(), ...avg.keys()])) out.set(k, (m.get(k) || 0) * (1 - f) + (avg.get(k) || 0) * f);
          return out;
        });
      }
      const Jn = new Uint16Array(n * 4), Wn = new Float32Array(n * 4);
      for (let i = 0; i < n; i += 1) {
        const u = id[i]; if (rate[u]) eased += 1;
        const top = [...w[u]].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((s, [, x]) => s + x, 0) || 1;
        top.forEach(([k, x], c) => { Jn[i * 4 + c] = k; Wn[i * 4 + c] = x / sum; });
      }
      prim.getAttribute('JOINTS_0').setArray(Uint8Array.from(Jn)).setNormalized(false);
      prim.getAttribute('WEIGHTS_0').setArray(Wn).setNormalized(false);
      log(`knees: weights eased across ${KNEE_BAND_M * 100} cm each side of ${knees.length} knees (${eased} vertices)`);
    }
  }
  // 4. seated, the lower bump rides up over her thighs instead of dropping between them:
  // the lower half of the bump eased up and a little forward, fully at its bottom and
  // nothing by the navel, nothing below the groin crease or past her flanks. The Lab
  // turns it on only while she sits, more for a bigger bump (`seatCorrectiveV2Weight`)
  for (const prim of mesh.listPrimitives()) {
    const P = read(prim.getAttribute('POSITION')), n = P.length / 3, d = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) P.set(apply(T, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], 1), i * 3);
    let moved = 0;
    for (let i = 0; i < n; i += 1) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const k = (1 - smooth(SEAT_V2.LOW[0], SEAT_V2.LOW[1], y)) * smooth(SEAT_V2.FRONT[0], SEAT_V2.FRONT[1], z) * (1 - smooth(SEAT_V2.FLANK[0], SEAT_V2.FLANK[1], Math.abs(x))) * groinKeep(x, y);
      if (k <= 0) continue;
      d.set(apply(Ti, [0, SEAT_V2.UP * k, SEAT_V2.FORWARD * k], 0), i * 3); moved += 1;
    }
    prim.addTarget(doc.createPrimitiveTarget('bellySeatV2').setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(d)).setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(n * 3))));
    log(`bellySeatV2: ${moved} vertices of the lower bump ride up to ${SEAT_V2.UP * 1000} mm up and ${SEAT_V2.FORWARD * 1000} mm forward at weight 1`);
  }
  names.push('navelFlat');
  names.push('bellySeatV2');
  mesh.setExtras({ ...extras, targetNames: names, v2Correctives: '2026-10-14 groin+navel+knees+seat' });
  // every primitive's weights for the new target, so the dictionary lines up
  const was = mesh.getWeights() ?? [];
  mesh.setWeights([...(was.length === names.length - 2 ? was : new Array(names.length - 2).fill(0)), 0, 0]);
  log(`groin: ${held} belly-shape points faded under the crease (largest move removed ${(worst * 1000).toFixed(1)} mm)`);
  await io.write(file, doc);
}

if (process.argv[1]?.endsWith('sarahV2Correctives.mjs')) await sarahV2Correctives(process.argv[2]);
