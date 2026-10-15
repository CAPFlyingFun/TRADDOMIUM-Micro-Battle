/**
 * SARAH v2's REFINEMENT SHAPES (Joshua, 2026-10-15), added to `sarah-v2-arms.glb` after
 * `scripts/sarahV2ArmWeights.mjs`. Two shapes, each its own target, so the approved body is
 * untouched and each can be compared on and off:
 *
 *   bellyUpper — "increase the top portion of the belly slightly, specifically from around
 *     the belly button upward, by about 5% more height/fullness... keep this subtle". The
 *     bump's own displacement (the 100% body against the flat `belly` key) is made UPPER_FULL
 *     fuller above the navel and its profile UPPER_TALL taller, both fading in from just
 *     below the navel, so the lower belly holds still. Nothing is added where the bump is
 *     nothing, so it joins the bust, the sides and the groin wherever the bump already does.
 *     Written at 100%; the Lab weighs it by each size's own upper bump (the ratios measured
 *     here are stamped in the mesh's extras as `bellyUpperScale`).
 *
 *   breastGrow — "make the breasts look more rounded from the front... do the breasts similar
 *     to the belly and how it gets bigger and smaller". The old growth (`breast100`) stretched
 *     the bust mostly forward with its width held to +10% and pushed the chest round it out,
 *     which spread each breast into a sideways oval. This is her own 0% breast scaled evenly
 *     in every direction about its middle and its chest wall, faded where it joins the chest,
 *     to BREAST_MAX_VOLUME. The Lab uses it in place of breast100, at the same nominal volume
 *     targets, so every size is her round 0% shape (`breastGrowWeight`).
 *
 * Both carry normal changes, so the light follows them. Stamps the file; refuses a second run.
 *
 *   node scripts/sarahV2Refine.mjs public/models/sarah-v2-arms.glb [out.glb]
 *   node scripts/packSarah.mjs <out>
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

/** How much fuller the bump is above the navel (a share of its own displacement). */
export const UPPER_FULL = 0.05;
/** How much taller the bump's profile is above the navel (a share of the height over the navel). */
export const UPPER_TALL = 0.05;
/** The taller profile fades in with the bump's own depth (none where it is under TALL_FROM_M deep) and moves no point more than TALL_CAP of that depth. */
export const TALL_FROM_M = 0.015;
export const TALL_TO_M = 0.05;
export const TALL_CAP = 0.1;
/** Passes of averaging along her skin that the shapes are smoothed with. */
export const SMOOTH_PASSES = 12;
/** The fade-in, metres about the navel: nothing this far below it, all of it this far above. */
export const UPPER_FROM_M = -0.03;
export const UPPER_TO_M = 0.04;
/** The bust's largest nominal volume (the Lab's 200%), as the old growth's: 1.55 times her own. */
export const BREAST_MAX_VOLUME = 1.55;
/** A breast's reach from its tip to the chest wall, metres (as the bake's BREAST_DEPTH_M). */
export const BREAST_DEPTH_M = 0.1;
/** The breast is scaled whole within BREAST_HOLD_FROM of BREAST_REACH_M from its middle (front view), and not at all past BREAST_HOLD_TO of it. */
export const BREAST_REACH_M = 0.09;
export const BREAST_HOLD_FROM = 0.65;
export const BREAST_HOLD_TO = 1.35;
/** No breast skin grows sideways toward her middle closer than this to the centre line (eased in from a quarter of it). */
export const BREAST_MIDLINE_M = 0.016;
export const STAMP = '2026-10-15 upper belly + rounder bust';

const mul = (x, y) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) o[c * 4 + r] += x[k * 4 + r] * y[c * 4 + k]; return o; };
const invert = (m) => {
  const [a, b, c, , d, e, f, , g, h, i] = m, det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const r = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, 0, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, 0, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det, 0, 0, 0, 0, 1];
  r[12] = -(r[0] * m[12] + r[4] * m[13] + r[8] * m[14]); r[13] = -(r[1] * m[12] + r[5] * m[13] + r[9] * m[14]); r[14] = -(r[2] * m[12] + r[6] * m[13] + r[10] * m[14]);
  return r;
};
const apply = (m, v, w) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + w * m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + w * m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + w * m[14]];
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const read = (A) => { const n = A.getCount(), s = A.getElementSize(), out = new Float32Array(n * s), v = []; for (let i = 0; i < n; i += 1) { A.getElement(i, v); for (let c = 0; c < s; c += 1) out[i * s + c] = v[c]; } return out; };

export async function sarahV2Refine(src, dst = src, { log = console.log } = {}) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(src), skin = doc.getRoot().listSkins()[0], joints = skin.listJoints(), wt = joints.map((j) => j.getWorldTranslation());
  const mesh = doc.getRoot().listMeshes()[0], names = mesh.getExtras()?.targetNames ?? [];
  if (mesh.getExtras()?.v2Refine) throw new Error(`already refined (${mesh.getExtras().v2Refine}); start from the unrefined file`);
  for (const need of ['belly', 'breast100', 'navelFlat']) if (!names.includes(need)) throw new Error(`no ${need} target`);
  const T = mul(joints[0].getWorldMatrix(), Array.from(skin.getInverseBindMatrices().getArray().slice(0, 16))), Ti = invert(T);
  // the upper arms and everything below them: the rounding never moves the arm
  const child = (k) => joints[k].listChildren().find((c) => joints.includes(c));
  const ups = joints.map((_, k) => k).filter((k) => { const t = wt[k], c = child(k); if (!c) return false; const e = c.getWorldTranslation(); return Math.abs(t[0]) > 0.1 && Math.abs(t[0]) < 0.3 && t[1] > 1.2 && t[1] < 1.55 && Math.hypot(e[0] - t[0], e[1] - t[1], e[2] - t[2]) > 0.18; });
  const under = (k, root) => { for (let n = joints[k]; n; n = n.getParentNode?.()) { if (n === joints[root]) return true; if (!joints.includes(n)) return false; } return false; };
  const armJoints = new Set(joints.map((_, k) => (ups.some((up) => under(k, up)) ? k : -1)).filter((k) => k >= 0));
  const scales = [];
  for (const prim of mesh.listPrimitives()) {
    const P = read(prim.getAttribute('POSITION')), n = P.length / 3; for (let i = 0; i < n; i += 1) P.set(apply(T, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], 1), i * 3);
    const tgt = (name) => { const D = read(prim.listTargets()[names.indexOf(name)].getAttribute('POSITION')); for (let i = 0; i < n; i += 1) D.set(apply(T, [D[i * 3], D[i * 3 + 1], D[i * 3 + 2]], 0), i * 3); return D; };
    const J = read(prim.getAttribute('JOINTS_0')), W = read(prim.getAttribute('WEIGHTS_0')), idx = prim.getIndices().getArray(), N0 = read(prim.getAttribute('NORMAL'));
    const armShare = (i) => { let a = 0; for (let c = 0; c < 4; c += 1) if (armJoints.has(J[i * 4 + c])) a += W[i * 4 + c]; return a; };
    const flat = tgt('belly'), breast = tgt('breast100'), navel = tgt('navelFlat');
    // the navel: the centre of what navelFlat moves
    let nw = 0; const nc = [0, 0, 0];
    for (let i = 0; i < n; i += 1) { const l = Math.hypot(navel[i * 3], navel[i * 3 + 1], navel[i * 3 + 2]); if (l > 1e-3) { nw += l; for (let m = 0; m < 3; m += 1) nc[m] += l * P[i * 3 + m]; } }
    for (let m = 0; m < 3; m += 1) nc[m] /= nw;
    log(`navel at ${nc.map((x) => x.toFixed(3)).join(', ')}`);

    // ---- bellyUpper
    // the bump: the 100% body against the flat key
    const D = new Float32Array(n * 3); for (let i = 0; i < n * 3; i += 1) D[i] = -flat[i];
    // her skin welded across its seams, and each point's neighbours two rings out
    const key = new Map(), id = new Int32Array(n); for (let i = 0; i < n; i += 1) { const k = `${P[i * 3].toFixed(6)},${P[i * 3 + 1].toFixed(6)},${P[i * 3 + 2].toFixed(6)}`; if (!key.has(k)) key.set(k, key.size); id[i] = key.get(k); }
    const U = key.size, rep = new Int32Array(U), nb = Array.from({ length: U }, () => new Set()); for (let i = 0; i < n; i += 1) rep[id[i]] = i;
    for (let t = 0; t < idx.length; t += 3) for (const [p, q] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) { if (id[p] !== id[q]) { nb[id[p]].add(id[q]); nb[id[q]].add(id[p]); } }
    const facing = (i) => { const nw = apply(T, [N0[i * 3], N0[i * 3 + 1], N0[i * 3 + 2]], 0); return nw[2] / (Math.hypot(...nw) || 1); };
    // how the bump changes going UP her front: a plane fitted to it over each point's two rings
    const riseOf = (u) => {
      const ring = new Set([u]); for (const v of nb[u]) { ring.add(v); for (const w2 of nb[v]) ring.add(w2); }
      const i0 = rep[u], A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bsum = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (const v of ring) { const i = rep[v], row = [1, P[i * 3] - P[i0 * 3], P[i * 3 + 1] - P[i0 * 3 + 1]]; for (let r = 0; r < 3; r += 1) { for (let c = 0; c < 3; c += 1) A[r][c] += row[r] * row[c]; for (let m = 0; m < 3; m += 1) bsum[m][r] += row[r] * D[i * 3 + m]; } }
      const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]); if (Math.abs(det) < 1e-18) return null;
      // the y coefficient (Cramer's rule, third column) for each component of the bump
      return [0, 1, 2].map((m) => { const bb = bsum[m]; return (A[0][0] * (A[1][1] * bb[2] - bb[1] * A[2][1]) - A[0][1] * (A[1][0] * bb[2] - bb[1] * A[2][0]) + bb[0] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])) / det; });
    };
    const field = new Float32Array(U * 3), moved = new Uint8Array(U);
    for (let u = 0; u < U; u += 1) {
      const i = rep[u], l = Math.hypot(D[i * 3], D[i * 3 + 1], D[i * 3 + 2]); if (l < 1e-4) continue;
      const y = P[i * 3 + 1], up = smooth(UPPER_FROM_M, UPPER_TO_M, y - nc[1]); if (up <= 0) continue;
      const d = [0, 1, 2].map((m) => UPPER_FULL * up * D[i * 3 + m]);
      // taller: the profile read from a little further down (nothing at the navel, more toward
      // the top), on her front only; faded out where the bump itself fades (its top edge under
      // the bust stays where it is: lifted there, the bump's rim pinched into a ledge against
      // the breasts' underside), and never more than a small share of the bump's own depth
      const front = smooth(0.35, 0.6, facing(i)), lift = UPPER_TALL * Math.max(0, y - nc[1]) * up, deep = smooth(TALL_FROM_M, TALL_TO_M, l);
      if (front > 0 && lift > 0 && deep > 0) {
        const g = riseOf(u);
        if (g) { const st = g.map((v) => -lift * v * front * deep), sl = Math.hypot(...st), cap = TALL_CAP * l; for (let m = 0; m < 3; m += 1) d[m] += sl > cap ? st[m] * cap / sl : st[m]; }
      }
      field.set(d, u * 3); moved[u] = 1;
    }
    // smoothed along her skin, so no unevenness from the fit shows on the bump's sheen
    const relax = (F, mask, passes) => {
      const live = []; for (let u = 0; u < U; u += 1) if (mask[u]) { live.push(u); for (const v of nb[u]) if (!mask[v]) { mask[v] = 2; live.push(v); } }
      const next = new Float32Array(U * 3);
      for (let p = 0; p < passes; p += 1) {
        for (const u of live) { const s2 = [0, 0, 0]; for (const v of nb[u]) for (let m = 0; m < 3; m += 1) s2[m] += F[v * 3 + m]; const k = nb[u].size || 1; for (let m = 0; m < 3; m += 1) next[u * 3 + m] = 0.5 * F[u * 3 + m] + 0.5 * s2[m] / k; }
        for (const u of live) for (let m = 0; m < 3; m += 1) F[u * 3 + m] = next[u * 3 + m];
      }
    };
    relax(field, moved, SMOOTH_PASSES);
    const upper = new Float32Array(n * 3); let upMoved = 0, upMost = 0;
    for (let i = 0; i < n; i += 1) { const u = id[i], d = [field[u * 3], field[u * 3 + 1], field[u * 3 + 2]], l = Math.hypot(...d); if (l < 1e-6) continue; upper.set(d, i * 3); upMoved += 1; upMost = Math.max(upMost, l); }
    log(`bellyUpper: ${upMoved} points, the largest move ${(upMost * 1000).toFixed(1)} mm (at 100%)`);
    // the upper bump of each size, against 100%'s, for the Lab's weight
    let base = 0; const upperMean = (K) => { let s = 0, k = 0; for (let i = 0; i < n; i += 1) { if (Math.hypot(flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]) < 0.002 || P[i * 3 + 1] <= nc[1]) continue; s += Math.hypot(...[0, 1, 2].map((m) => (K ? K[i * 3 + m] : 0) - flat[i * 3 + m])); k += 1; } return s / k; };
    base = upperMean(null);
    for (const [s, name] of [[2, 'belly200'], [1.5, 'belly150'], [1, null], [0.75, 'belly75'], [0.6, 'belly60'], [0.5, 'belly50'], [0.3, 'belly30'], [0.25, 'belly25'], [0, 'belly']]) {
      if (name && !names.includes(name)) continue; scales.push([s, +(upperMean(name ? tgt(name) : null) / base).toFixed(3)]);
    }

    // ---- breastGrow: the bust grows the way the belly does (Joshua, 2026-10-15: "do the
    // breasts similar to the belly and how it gets bigger and smaller"). The belly's sizes are
    // the same belly scaled; the bust's were a forward stretch with the width held to +10%,
    // and the chest round it pushed out with them, which spread each breast into a sideways
    // oval. Here each breast is her own 0% breast scaled evenly in every direction (front,
    // side and depth alike) about its own middle and its chest wall, faded out where it joins
    // the chest, so it stays her round 0% shape at every size. Written at the largest volume
    // (BREAST_MAX_VOLUME); a blend of one even scaling is an even scaling, so the Lab's weight
    // lands each size exactly.
    const round = new Float32Array(n * 3); let brMoved = 0, brMost = 0;
    const s = Math.cbrt(BREAST_MAX_VOLUME) - 1;
    for (const sg of [1, -1]) {
      // the tip: her most forward point on this breast, above the bump
      let tip = -1;
      for (let i = 0; i < n; i += 1) {
        const x = sg * P[i * 3], y = P[i * 3 + 1]; if (x < 0.03 || x > 0.2 || y < 1.2 || y > 1.42 || armShare(i) > 0.05) continue;
        if (Math.hypot(D[i * 3], D[i * 3 + 1], D[i * 3 + 2]) > 0.002) continue;
        if (tip < 0 || P[i * 3 + 2] > P[tip * 3 + 2]) tip = i;
      }
      // the middle in the front view: where the old growth centred itself (the mound's own middle)
      let w = 0; const c = [0, 0];
      for (let i = 0; i < n; i += 1) { if (Math.sign(P[i * 3]) !== sg) continue; const l = Math.hypot(breast[i * 3], breast[i * 3 + 1], breast[i * 3 + 2]); if (l < 0.002) continue; w += l; c[0] += l * P[i * 3]; c[1] += l * P[i * 3 + 1]; }
      c[0] /= w; c[1] /= w;
      const tx = P[tip * 3], ty = P[tip * 3 + 1], tz = P[tip * 3 + 2], bz = tz - BREAST_DEPTH_M;
      log(`breast ${sg > 0 ? 'left' : 'right'}: tip ${[tx, ty, tz].map((v) => v.toFixed(3)).join(', ')}, scaled about ${c[0].toFixed(3)}, ${c[1].toFixed(3)}, depth ${bz.toFixed(3)}`);
      for (let i = 0; i < n; i += 1) {
        if (Math.sign(P[i * 3]) !== sg) continue;
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        // the breast: within its own reach of the middle, in front of the chest wall, not the
        // bump and not the arm; faded so it joins her chest without a step
        const r = Math.hypot(x - c[0], y - c[1]) / BREAST_REACH_M;
        const wgt = (1 - smooth(BREAST_HOLD_FROM, BREAST_HOLD_TO, r)) * smooth(bz, bz + 0.04, z)
          * (1 - smooth(0.002, 0.012, Math.hypot(D[i * 3], D[i * 3 + 1], D[i * 3 + 2]))) * (1 - smooth(0.02, 0.15, armShare(i)));
        if (!(wgt > 0)) continue;
        // toward her middle the sideways growth eases off before the centre line, so the two
        // breasts meet at the cleavage and never pass into each other
        const inward = (x - c[0]) * sg < 0 ? smooth(BREAST_MIDLINE_M * 0.25, BREAST_MIDLINE_M, Math.abs(x)) : 1;
        const d = [s * (x - c[0]) * wgt * inward, s * (y - c[1]) * wgt, s * (z - bz) * wgt];
        round.set(d, i * 3); brMoved += 1;
      }
    }
    { // smoothed along her skin the same way
      const F = new Float32Array(U * 3), mask = new Uint8Array(U);
      for (let i = 0; i < n; i += 1) { const u = id[i]; if (round[i * 3] || round[i * 3 + 1] || round[i * 3 + 2]) { F.set([round[i * 3], round[i * 3 + 1], round[i * 3 + 2]], u * 3); mask[u] = 1; } }
      relax(F, mask, SMOOTH_PASSES);
      brMost = 0; for (let i = 0; i < n; i += 1) { const u = id[i]; round.set([F[u * 3], F[u * 3 + 1], F[u * 3 + 2]], i * 3); brMost = Math.max(brMost, Math.hypot(F[u * 3], F[u * 3 + 1], F[u * 3 + 2])); }
    }
    log(`breastGrow: ${brMoved} points, the largest move ${(brMost * 1000).toFixed(1)} mm (at ${BREAST_MAX_VOLUME}x volume)`);

    // normals: the turn each shape gives the surface, on her welded skin
    const normalsOf = (X) => { const out = new Float32Array(U * 3); for (let t = 0; t < idx.length; t += 3) { const [a, b, c2] = [idx[t], idx[t + 1], idx[t + 2]]; const e1 = [0, 1, 2].map((m) => X[b * 3 + m] - X[a * 3 + m]), e2 = [0, 1, 2].map((m) => X[c2 * 3 + m] - X[a * 3 + m]), f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; for (const q of [a, b, c2]) for (let m = 0; m < 3; m += 1) out[id[q] * 3 + m] += f[m]; } for (let u = 0; u < U; u += 1) { const l = Math.hypot(out[u * 3], out[u * 3 + 1], out[u * 3 + 2]) || 1; for (let m = 0; m < 3; m += 1) out[u * 3 + m] /= l; } return out; };
    const normalDelta = (baseShape, delta) => {
      const X0 = new Float32Array(n * 3), X1 = new Float32Array(n * 3); for (let i = 0; i < n * 3; i += 1) { X0[i] = P[i] + baseShape[i]; X1[i] = X0[i] + delta[i]; }
      const n0 = normalsOf(X0), n1 = normalsOf(X1), out = new Float32Array(n * 3);
      for (let i = 0; i < n; i += 1) {
        const u = id[i], dv = [0, 1, 2].map((m) => n1[u * 3 + m] - n0[u * 3 + m]); if (Math.hypot(...dv) < 1e-5) continue;
        const a = [N0[i * 3], N0[i * 3 + 1], N0[i * 3 + 2]], aw = apply(T, a, 0), al = Math.hypot(...aw) || 1;
        const t = apply(Ti, aw.map((v, m) => v / al + dv[m]), 0), tl = Math.hypot(...t) || 1;
        for (let m = 0; m < 3; m += 1) out[i * 3 + m] = t[m] / tl - a[m];
      }
      return out;
    };
    const zero = new Float32Array(n * 3);
    const toLocal = (d) => { const out = new Float32Array(n * 3); for (let i = 0; i < n; i += 1) out.set(apply(Ti, [d[i * 3], d[i * 3 + 1], d[i * 3 + 2]], 0), i * 3); return out; };
    const add = (name, d, dn) => prim.addTarget(doc.createPrimitiveTarget(name).setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(toLocal(d))).setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(dn)));
    add('bellyUpper', upper, normalDelta(zero, upper));
    add('breastGrow', round, normalDelta(zero, round));
  }
  log(`bellyUpper's weight by size (upper bump against 100%): ${scales.map(([s, r]) => `${s * 100}%:${r}`).join(' ')}`);
  const was = mesh.getWeights() ?? [];
  mesh.setExtras({ ...(mesh.getExtras() ?? {}), targetNames: [...names, 'bellyUpper', 'breastGrow'], v2Refine: STAMP, bellyUpperScale: scales });
  mesh.setWeights([...(was.length === names.length ? was : new Array(names.length).fill(0)), 0, 0]);
  await io.write(dst, doc);
}

if (process.argv[1]?.endsWith('sarahV2Refine.mjs')) await sarahV2Refine(process.argv[2], process.argv[3] ?? process.argv[2]);
