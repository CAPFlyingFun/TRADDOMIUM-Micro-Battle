/**
 * SARAH v2's BODY-SHAPE FIELDS (Joshua, 2026-10-15: "add independent body-shape controls...
 * Belly Shape: height, width, depth, upper fullness, lower fullness... Breast Shape: width,
 * height, depth, vertical position, natural downward tilt, upper and lower fullness").
 * Added to `sarah-v2-arms.glb` after `scripts/sarahV2Refine.mjs`.
 *
 * Each control is one field: the displacement of every vertex for ONE UNIT of the control
 * (`SHAPE_UNITS`), written as a morph target named `shape:<control>`. The Lab does not
 * blend these on the GPU (23 shapes already fill an ~85 MB morph texture on a phone): it
 * lifts them out of the mesh at load and adds Σ value × field to the rest shape on the CPU,
 * only when a control moves (`src/view/bodyShapeView.ts`). A body of all defaults adds
 * nothing, so the approved Sarah is exactly as she was.
 *
 * THE BELLY'S FIELDS are made of the bump itself (the 100% body against the flat `belly`
 * key), so they are nothing wherever the bump is nothing: they cannot reach her breasts,
 * her back or her legs, and they join her skin wherever the bump already does.
 *   bellyDepth   the bump's forward part, 10% more;
 *   bellyWidth   the bump pushed out sideways in proportion to how far it sits from her
 *                middle, 10% more, faded in with the bump's own depth;
 *   bellyUpper   the bump above the navel, 10% more (the two meet across ±8 cm of it);
 *   bellyLower   the bump below the navel, 10% more;
 *   bellyHeight  six fields: the bump about 2 cm higher and 2 cm lower up her front, for
 *                each of the 100, 150 and 200% bumps (each point of her flat front takes
 *                the bump from below or above it, the whole way across its middle and
 *                none at the edges where it joins her, read from the bump smoothed so the
 *                navel's own small shape keeps its place).
 * Written at 100%; each size takes them by its own bump against 100%'s (stamped here:
 * `bellyShapeScale` overall, `bellyLowerScale` below the navel; the upper one is
 * `bellyUpperScale` from the refinement).
 *
 * THE BREASTS' FIELDS are made on her own 0% breast, about the same middle and chest wall
 * `breastGrow` scales about, with its weight (whole on the breast, nothing at the chest,
 * the bump or the arm): width, height and depth 10% each, position 1 cm up, droop 5° (the
 * breast turned down about its top), upper and lower fullness 10% (the upper or lower pole
 * brought forward). The Lab scales them by how big the bust is at the time.
 *
 * Every field is smoothed along her welded skin and carries normal changes. The script
 * prints how far each belly field reaches into the breasts and each breast field into the
 * bump (both should be ~0). Stamps the file; refuses a second run.
 *
 *   node scripts/sarahV2Shape.mjs public/models/sarah-v2-arms.glb [out.glb]
 *   node scripts/packSarah.mjs <out>
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { BREAST_DEPTH_M, BREAST_REACH_M, BREAST_HOLD_FROM, BREAST_HOLD_TO, BREAST_MIDLINE_M } from './sarahV2Refine.mjs';

/** One unit of each control, as the field writes it. */
export const SHAPE_UNITS = Object.freeze({
  bellyHeightUp: '2 cm up at 100%', bellyHeightDown: '2 cm down at 100%', bellyHeightUp150: '2 cm up at 150%', bellyHeightDown150: '2 cm down at 150%', bellyHeightUp200: '2 cm up at 200%', bellyHeightDown200: '2 cm down at 200%',
  bellyWidth: '10%', bellyDepth: '10%', bellyUpper: '10%', bellyLower: '10%',
  breastGrowMore: 'one breastGrow unit past 1.55x, kept off the midline', breastSpacingOut: '1 cm apart round her chest', breastSpacingIn: '1 cm closer, held off the midline', breastWidth: '10%', breastHeight: '10%', breastDepth: '10%', breastPosition: '1 cm', breastDroop: '5°', breastUpper: '10%', breastLower: '10%',
});
export const STAMP = '2026-10-15 body-shape fields';
/** Passes of averaging along her skin each field is smoothed with. */
const SMOOTH_PASSES = 12;
/** Upper and lower fullness meet across this band either side of the navel, metres. */
const FULL_BLEND_M = 0.08;
/** Passes the bump is smoothed with before height reads it, so the navel's own shape stays put. */
const HEIGHT_SMOOTH_PASSES = 40;
/**
 * How far the middle of the bump is carried at the slider's ends (±2 cm), metres. Its edges
 * hold where they join her (`HEIGHT_EDGE_M`, `HEIGHT_EDGE_LOW_M`), so the bump as a whole
 * moves less than its middle: this carries its centre about 1.6-2.4 cm (logged per size).
 */
const HEIGHT_M = 0.036;
/** The height shift fades to nothing over this much of the bump's top and bottom edge, metres. */
const HEIGHT_EDGE_M = 0.1;
/** ...and over this much at the bottom, where the bump hangs over her groin and thighs. */
const HEIGHT_EDGE_LOW_M = 0.17;
/** Fields that carry the whole breast spread past its edge by this many rings of her skin. */
const WIDE_PASSES = Object.freeze({ breastPosition: 30, breastDroop: 20, breastSpacingOut: 30, breastSpacingIn: 30, breastHeight: 20, breastWidth: 20 });
/** The upright axis the breasts are turned about for spacing, this far behind the chest wall, metres. */
const SPACING_AXIS_DEPTH_M = 0.1;
/** Passes each field's normal change is smoothed with. */
const NORMAL_SMOOTH_PASSES = 20;

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

export async function sarahV2Shape(src, dst = src, { log = console.log } = {}) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(src), skin = doc.getRoot().listSkins()[0], joints = skin.listJoints(), wt = joints.map((j) => j.getWorldTranslation());
  const mesh = doc.getRoot().listMeshes()[0], names = mesh.getExtras()?.targetNames ?? [];
  if (mesh.getExtras()?.v2Shape) throw new Error(`already has its shape fields (${mesh.getExtras().v2Shape}); start from the file before them`);
  for (const need of ['belly', 'breast100', 'navelFlat', 'breastGrow']) if (!names.includes(need)) throw new Error(`no ${need} target (run sarahV2Refine first)`);
  const T = mul(joints[0].getWorldMatrix(), Array.from(skin.getInverseBindMatrices().getArray().slice(0, 16))), Ti = invert(T);
  const child = (k) => joints[k].listChildren().find((c) => joints.includes(c));
  const ups = joints.map((_, k) => k).filter((k) => { const t = wt[k], c = child(k); if (!c) return false; const e = c.getWorldTranslation(); return Math.abs(t[0]) > 0.1 && Math.abs(t[0]) < 0.3 && t[1] > 1.2 && t[1] < 1.55 && Math.hypot(e[0] - t[0], e[1] - t[1], e[2] - t[2]) > 0.18; });
  const under = (k, root) => { for (let n = joints[k]; n; n = n.getParentNode?.()) { if (n === joints[root]) return true; if (!joints.includes(n)) return false; } return false; };
  const armJoints = new Set(joints.map((_, k) => (ups.some((up) => under(k, up)) ? k : -1)).filter((k) => k >= 0));
  const fieldNames = [];
  let scaleAll = [], scaleLower = [];
  for (const prim of mesh.listPrimitives()) {
    const P = read(prim.getAttribute('POSITION')), n = P.length / 3; for (let i = 0; i < n; i += 1) P.set(apply(T, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], 1), i * 3);
    const tgt = (name) => { const D = read(prim.listTargets()[names.indexOf(name)].getAttribute('POSITION')); for (let i = 0; i < n; i += 1) D.set(apply(T, [D[i * 3], D[i * 3 + 1], D[i * 3 + 2]], 0), i * 3); return D; };
    const J = read(prim.getAttribute('JOINTS_0')), W = read(prim.getAttribute('WEIGHTS_0')), idx = prim.getIndices().getArray(), N0 = read(prim.getAttribute('NORMAL'));
    const armShare = (i) => { let a = 0; for (let c = 0; c < 4; c += 1) if (armJoints.has(J[i * 4 + c])) a += W[i * 4 + c]; return a; };
    const nrmW = (i) => { const v = apply(T, [N0[i * 3], N0[i * 3 + 1], N0[i * 3 + 2]], 0), l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
    const flat = tgt('belly'), breast = tgt('breast100'), navel = tgt('navelFlat');
    let nw = 0; const nc = [0, 0, 0];
    for (let i = 0; i < n; i += 1) { const l = Math.hypot(navel[i * 3], navel[i * 3 + 1], navel[i * 3 + 2]); if (l > 1e-3) { nw += l; for (let m = 0; m < 3; m += 1) nc[m] += l * P[i * 3 + m]; } }
    for (let m = 0; m < 3; m += 1) nc[m] /= nw;
    const D = new Float32Array(n * 3); for (let i = 0; i < n * 3; i += 1) D[i] = -flat[i];
    const dl = (i) => Math.hypot(D[i * 3], D[i * 3 + 1], D[i * 3 + 2]);

    // her skin welded across its seams
    const key = new Map(), id = new Int32Array(n); for (let i = 0; i < n; i += 1) { const k = `${P[i * 3].toFixed(6)},${P[i * 3 + 1].toFixed(6)},${P[i * 3 + 2].toFixed(6)}`; if (!key.has(k)) key.set(k, key.size); id[i] = key.get(k); }
    const U = key.size, rep = new Int32Array(U), nb = Array.from({ length: U }, () => new Set()); for (let i = 0; i < n; i += 1) rep[id[i]] = i;
    for (let t = 0; t < idx.length; t += 3) for (const [p, q] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) { if (id[p] !== id[q]) { nb[id[p]].add(id[q]); nb[id[q]].add(id[p]); } }
    const relax = (F, mask, passes) => {
      const live = []; for (let u = 0; u < U; u += 1) if (mask[u]) { live.push(u); for (const v of nb[u]) if (!mask[v]) { mask[v] = 2; live.push(v); } }
      const next = new Float32Array(U * 3);
      for (let p = 0; p < passes; p += 1) {
        for (const u of live) { const s2 = [0, 0, 0]; for (const v of nb[u]) for (let m = 0; m < 3; m += 1) s2[m] += F[v * 3 + m]; const k = nb[u].size || 1; for (let m = 0; m < 3; m += 1) next[u * 3 + m] = 0.5 * F[u * 3 + m] + 0.5 * s2[m] / k; }
        for (const u of live) for (let m = 0; m < 3; m += 1) F[u * 3 + m] = next[u * 3 + m];
      }
    };
    /** A per-vertex field welded, smoothed, and written back to every copy of each point. */
    const finish = (perVertex, wide = 0) => {
      const F = new Float32Array(U * 3), mask = new Uint8Array(U);
      for (let i = 0; i < n; i += 1) { const u = id[i]; if (perVertex[i * 3] || perVertex[i * 3 + 1] || perVertex[i * 3 + 2]) { F.set([perVertex[i * 3], perVertex[i * 3 + 1], perVertex[i * 3 + 2]], u * 3); mask[u] = 1; } }
      // a field that carries the whole breast (position, droop) is also let out past its edge,
      // a ring a pass, so the chest above and the fold below take up the move gradually: held
      // to the breast's own edge, 2 cm of lift made a step along its top and pinched the fold
      for (let p = 0; p < wide; p += 1) { const grow = []; for (let u = 0; u < U; u += 1) if (mask[u]) for (const v of nb[u]) if (!mask[v]) grow.push(v); for (const v of grow) mask[v] = 1; relax(F, mask, 1); }
      relax(F, mask, SMOOTH_PASSES);
      const out = new Float32Array(n * 3); for (let i = 0; i < n; i += 1) { const u = id[i]; out.set([F[u * 3], F[u * 3 + 1], F[u * 3 + 2]], i * 3); }
      return out;
    };

    // ---- the belly's fields, at 100%
    // upper and lower meet across a wide band about the navel (±FULL_BLEND_M): a narrow one
    // left a ridge across the bump at ±20%
    const up = (y) => smooth(-FULL_BLEND_M, FULL_BLEND_M, y - nc[1]);
    const depth = new Float32Array(n * 3), width = new Float32Array(n * 3), upper = new Float32Array(n * 3), lower = new Float32Array(n * 3);
    // every scale is of the bump SMOOTHED (`HEIGHT_SMOOTH_PASSES`): the navel's own small
    // shape is part of the bump, and scaling it with the rest puckered the navel at +20%
    // upper or -20% lower fullness on the 200% body
    const Dsm = new Float32Array(n * 3);
    {
      const F = new Float32Array(U * 3), live = new Uint8Array(U);
      for (let i = 0; i < n; i += 1) { F.set([D[i * 3], D[i * 3 + 1], D[i * 3 + 2]], id[i] * 3); if (dl(i) > 1e-4) live[id[i]] = 1; }
      relax(F, live, HEIGHT_SMOOTH_PASSES);
      for (let i = 0; i < n; i += 1) if (dl(i) > 1e-4) Dsm.set([F[id[i] * 3], F[id[i] * 3 + 1], F[id[i] * 3 + 2]], i * 3);
    }
    for (let i = 0; i < n; i += 1) {
      const l = dl(i); if (l < 1e-4) continue;
      const y = P[i * 3 + 1], u = up(y), g = smooth(0.0, 0.05, Math.hypot(Dsm[i * 3], Dsm[i * 3 + 1], Dsm[i * 3 + 2]));
      depth.set([0, 0, 0.1 * Dsm[i * 3 + 2]], i * 3);
      // sideways fades in over the bump's first 5 cm: a quicker fade left a crease down her flank at -15%
      width.set([0.1 * P[i * 3] * g, 0, 0], i * 3);
      upper.set([0, 1, 2].map((m) => 0.1 * u * Dsm[i * 3 + m]), i * 3);
      lower.set([0, 1, 2].map((m) => 0.1 * (1 - u) * Dsm[i * 3 + m]), i * 3);
    }
    // height: the bump itself carried up or down her front (Joshua: "vertical position
    // without changing the character's overall height"). The bump is a displacement of her
    // flat body, and her flat front is one sheet over (x, y), so the bump `HEIGHT_M` higher
    // is each point of that sheet taking the displacement of the point `HEIGHT_M` below it.
    // Written EXACTLY at the slider's ends, up and down, and for each size key's own bump
    // (100, 150, 200%), because a shift is not linear: one written small and scaled up
    // turned pointed and ridged at 200%. The Lab crossfades from nothing to the end, and
    // between the keys. Read from the bump smoothed (`HEIGHT_SMOOTH_PASSES`), so the navel's
    // own small shape keeps its place instead of being dragged along as a second dimple.
    // (Earlier versions scaled the bump's forward push, which made it pointed, or read a
    // slope off her skin, which smeared the navel.)
    const heightFields = {};
    {
      const N0f = new Float32Array(n * 3); for (let i = 0; i < n; i += 1) N0f.set(nrmW(i), i * 3);
      const front = (i) => N0f[i * 3 + 2] > 0.15 && P[i * 3 + 2] + flat[i * 3 + 2] > -0.02;
      const X0 = -0.3, Y0 = 0.5, CELL = 0.004, GX = 150, GY = 230;
      const shifted = (Dk, h) => {
        const Ds = new Float32Array(U * 3), live = new Uint8Array(U);
        for (let i = 0; i < n; i += 1) { Ds.set([Dk[i * 3], Dk[i * 3 + 1], Dk[i * 3 + 2]], id[i] * 3); if (Math.hypot(Dk[i * 3], Dk[i * 3 + 1], Dk[i * 3 + 2]) > 1e-4) live[id[i]] = 1; }
        relax(Ds, live, HEIGHT_SMOOTH_PASSES);
        const sum = new Float32Array(GX * GY * 3), cnt = new Float32Array(GX * GY);
        for (let i = 0; i < n; i += 1) {
          if (!front(i)) continue;
          const gx = Math.round((P[i * 3] + flat[i * 3] - X0) / CELL), gy = Math.round((P[i * 3 + 1] + flat[i * 3 + 1] - Y0) / CELL);
          if (gx < 0 || gy < 0 || gx >= GX || gy >= GY) continue;
          const c = gy * GX + gx, u = id[i]; for (let m = 0; m < 3; m += 1) sum[c * 3 + m] += Ds[u * 3 + m]; cnt[c] += 1;
        }
        const G = new Float32Array(GX * GY * 3), have = new Uint8Array(GX * GY);
        for (let c = 0; c < GX * GY; c += 1) if (cnt[c]) { for (let m = 0; m < 3; m += 1) G[c * 3 + m] = sum[c * 3 + m] / cnt[c]; have[c] = 1; }
        for (let pass = 0; pass < 6; pass += 1) { const add = []; for (let gy = 1; gy < GY - 1; gy += 1) for (let gx = 1; gx < GX - 1; gx += 1) { const c = gy * GX + gx; if (have[c]) continue; let k = 0; const a = [0, 0, 0]; for (const d of [-1, 1, -GX, GX]) if (have[c + d]) { k += 1; for (let m = 0; m < 3; m += 1) a[m] += G[(c + d) * 3 + m]; } if (k >= 2) add.push([c, a.map((v) => v / k)]); } for (const [c, a] of add) { G.set(a, c * 3); have[c] = 1; } }
        const at = (x, y) => { const fx = (x - X0) / CELL, fy = (y - Y0) / CELL, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, out = [0, 0, 0]; let w = 0; for (const [dx, dy, ww] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) { const gx = x0 + dx, gy = y0 + dy; if (gx < 0 || gy < 0 || gx >= GX || gy >= GY) continue; const c = gy * GX + gx; if (!have[c]) continue; w += ww; for (let m = 0; m < 3; m += 1) out[m] += ww * G[c * 3 + m]; } return w > 0.5 ? out.map((v) => v / w) : null; };
        const out = new Float32Array(n * 3);
        for (let i = 0; i < n; i += 1) {
          if (!front(i)) continue;
          const fx = P[i * 3] + flat[i * 3], fy = P[i * 3 + 1] + flat[i * 3 + 1], here = at(fx, fy), from = at(fx, fy - h * hold(fx, fy));
          if (!here || !from) continue;
          out.set([0, 1, 2].map((m) => from[m] - here[m]), i * 3);
        }
        return out;
      };
      // the bump's edges stay where they join her: the shift is whole across its middle and
      // fades to nothing over `HEIGHT_EDGE_M` at its top and bottom, column by column (the
      // bump's lower edge is a U, low at the pubis and high at the hips). A plain shift moved
      // the edges too: at -2 cm on the 200% bump it stretched a web of skin from the underside
      // to the inner thigh, and at +2 cm it cut a groove there.
      const COLS = 61, colX = (x) => Math.min(COLS - 1, Math.max(0, Math.round((x + 0.3) / 0.01)));
      const yb = new Float32Array(COLS).fill(9), yt = new Float32Array(COLS).fill(-9);
      for (let i = 0; i < n; i += 1) { if (dl(i) < 0.003) continue; const fx = P[i * 3] + flat[i * 3], fy = P[i * 3 + 1] + flat[i * 3 + 1], c = colX(fx); yb[c] = Math.min(yb[c], fy); yt[c] = Math.max(yt[c], fy); }
      // columns the bump does not reach take their neighbours', then the edges are smoothed across
      for (let pass = 0; pass < COLS; pass += 1) for (let c = 0; c < COLS; c += 1) if (yb[c] > 8) { const nb2 = [c - 1, c + 1].filter((k) => k >= 0 && k < COLS && yb[k] < 8); if (nb2.length) { yb[c] = Math.max(...nb2.map((k) => yb[k])); yt[c] = Math.min(...nb2.map((k) => yt[k])); } }
      for (let pass = 0; pass < 4; pass += 1) { const b2 = Float32Array.from(yb), t2 = Float32Array.from(yt); for (let c = 1; c < COLS - 1; c += 1) { yb[c] = (b2[c - 1] + 2 * b2[c] + b2[c + 1]) / 4; yt[c] = (t2[c - 1] + 2 * t2[c] + t2[c + 1]) / 4; } }
      const hold = (x, y) => { const f = (x + 0.3) / 0.01, c0 = Math.min(COLS - 2, Math.max(0, Math.floor(f))), t = Math.min(1, Math.max(0, f - c0)); const b = yb[c0] * (1 - t) + yb[c0 + 1] * t, tp = yt[c0] * (1 - t) + yt[c0 + 1] * t; return smooth(b, b + HEIGHT_EDGE_LOW_M, y) * (1 - smooth(tp - HEIGHT_EDGE_M, tp, y)); };
      log(`height: the bump joins her front from y ${yb[30].toFixed(3)} to ${yt[30].toFixed(3)} at her middle, ${yb[20].toFixed(3)} to ${yt[20].toFixed(3)} 10 cm out; its edges hold`);
      const centreY = (Dk, F) => { let w = 0, y = 0; for (let i = 0; i < n; i += 1) { const m = Math.hypot(...[0, 1, 2].map((c) => Dk[i * 3 + c] + (F ? F[i * 3 + c] : 0))); if (m < 1e-4) continue; w += m; y += m * (P[i * 3 + 1] + flat[i * 3 + 1]); } return y / w; };
      for (const [suffix, key] of [['', null], ['150', 'belly150'], ['200', 'belly200']]) {
        if (key && !names.includes(key)) throw new Error(`no ${key} target`);
        const K = key ? tgt(key) : null, Dk = new Float32Array(n * 3); for (let i = 0; i < n * 3; i += 1) Dk[i] = D[i] + (K ? K[i] : 0);
        for (const [dir, h] of [['Up', HEIGHT_M], ['Down', -HEIGHT_M]]) {
          const F = shifted(Dk, h); heightFields[`bellyHeight${dir}${suffix}`] = F;
          log(`height ${dir.toLowerCase()} at ${suffix || '100'}%: the bump's centre moves ${((centreY(Dk, F) - centreY(Dk, null)) * 1000).toFixed(1)} mm`);
        }
      }
    }

    // ---- the breasts' fields, on her own 0% breast
    const bsp = new Float32Array(n * 3), bw = new Float32Array(n * 3), bh = new Float32Array(n * 3), bd = new Float32Array(n * 3), bp = new Float32Array(n * 3), bdr = new Float32Array(n * 3), bu = new Float32Array(n * 3), blo = new Float32Array(n * 3);
    const wgtAll = new Float32Array(n);
    for (const sg of [1, -1]) {
      let tip = -1;
      for (let i = 0; i < n; i += 1) { const x = sg * P[i * 3], y = P[i * 3 + 1]; if (x < 0.03 || x > 0.2 || y < 1.2 || y > 1.42 || armShare(i) > 0.05 || dl(i) > 0.002) continue; if (tip < 0 || P[i * 3 + 2] > P[tip * 3 + 2]) tip = i; }
      let w = 0; const c = [0, 0];
      for (let i = 0; i < n; i += 1) { if (Math.sign(P[i * 3]) !== sg) continue; const l = Math.hypot(breast[i * 3], breast[i * 3 + 1], breast[i * 3 + 2]); if (l < 0.002) continue; w += l; c[0] += l * P[i * 3]; c[1] += l * P[i * 3 + 1]; }
      c[0] /= w; c[1] /= w;
      const bz = P[tip * 3 + 2] - BREAST_DEPTH_M, pivot = [c[1] + 0.03, bz], droop = (5 * Math.PI) / 180;
      for (let i = 0; i < n; i += 1) {
        if (Math.sign(P[i * 3]) !== sg) continue;
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        const r = Math.hypot(x - c[0], y - c[1]) / BREAST_REACH_M;
        const wgt = (1 - smooth(BREAST_HOLD_FROM, BREAST_HOLD_TO, r)) * smooth(bz, bz + 0.04, z) * (1 - smooth(0.002, 0.012, dl(i))) * (1 - smooth(0.02, 0.15, armShare(i)));
        if (!(wgt > 0)) continue;
        wgtAll[i] = wgt;
        // the inner side does not grow toward her midline past a few centimetres from it: at
        // +25% on a 2.0x bust the two pressed flat against each other with the narrower guard
        const inward = (x - c[0]) * sg < 0 ? smooth(BREAST_MIDLINE_M * 0.5, 0.06, Math.abs(x)) : 1;
        bw.set([0.1 * (x - c[0]) * wgt * inward, 0, 0], i * 3);
        bh.set([0, 0.1 * (y - c[1]) * wgt, 0], i * 3);
        bd.set([0, 0, 0.1 * (z - bz) * wgt], i * 3);
        bp.set([0, 0.01 * wgt, 0], i * 3);
        // spacing: the breast carried 1 cm round her chest, away from her middle. Turned about
        // an upright axis inside her ribcage (`SPACING_AXIS_DEPTH_M` behind the chest wall),
        // so it follows the chest's curve back toward her side instead of sliding off it in a
        // straight line; anything that would move toward her midline near it is held, so at
        // a negative spacing the two meet in the cleavage instead of passing through.
        {
          const az = bz - SPACING_AXIS_DEPTH_M, R = Math.hypot(c[0], bz + BREAST_DEPTH_M / 2 - az), th = (sg * 0.01) / R; // 1 cm at the middle of the breast
          const rx = x * Math.cos(th) + (z - az) * Math.sin(th) - x, rz = -x * Math.sin(th) + (z - az) * Math.cos(th) - (z - az);
          bsp.set([rx * wgt, 0, rz * wgt], i * 3);
        }
        // turned down about its top: the front drops, the top holds
        const dy = y - pivot[0], dz = z - pivot[1], cs = Math.cos(droop), sn = Math.sin(droop);
        bdr.set([0, (dy * cs - dz * sn - dy) * wgt, (dy * sn + dz * cs - dz) * wgt], i * 3);
        const upperPole = smooth(c[1] - 0.01, c[1] + 0.03, y);
        bu.set([0, 0, 0.1 * (z - bz) * wgt * upperPole], i * 3);
        blo.set([0, 0, 0.1 * (z - bz) * wgt * (1 - upperPole)], i * 3);
      }
      log(`breast ${sg > 0 ? 'left' : 'right'}: middle ${c.map((v) => v.toFixed(3)).join(', ')}, chest wall at z ${bz.toFixed(3)}`);
    }

    // normals: the turn each field gives her surface
    const normalsOf = (X) => { const out = new Float32Array(U * 3); for (let t = 0; t < idx.length; t += 3) { const [a, b, c2] = [idx[t], idx[t + 1], idx[t + 2]]; const e1 = [0, 1, 2].map((m) => X[b * 3 + m] - X[a * 3 + m]), e2 = [0, 1, 2].map((m) => X[c2 * 3 + m] - X[a * 3 + m]), f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; for (const q of [a, b, c2]) for (let m = 0; m < 3; m += 1) out[id[q] * 3 + m] += f[m]; } for (let u = 0; u < U; u += 1) { const l = Math.hypot(out[u * 3], out[u * 3 + 1], out[u * 3 + 2]) || 1; for (let m = 0; m < 3; m += 1) out[u * 3 + m] /= l; } return out; };
    const n0 = normalsOf(P);
    const normalDelta = (delta) => {
      const X1 = new Float32Array(n * 3); for (let i = 0; i < n * 3; i += 1) X1[i] = P[i] + delta[i];
      const n1 = normalsOf(X1), out = new Float32Array(n * 3);
      // the turn itself smoothed along her skin: area-weighted face normals of an irregular
      // mesh change unevenly under even a smooth move, and those small differences showed
      // as lumps under the light at +20% upper fullness on the 200% body (geometry was smooth)
      const dn = new Float32Array(U * 3), live = new Uint8Array(U);
      for (let u = 0; u < U; u += 1) { let any = false; for (let m = 0; m < 3; m += 1) { dn[u * 3 + m] = n1[u * 3 + m] - n0[u * 3 + m]; if (Math.abs(dn[u * 3 + m]) > 1e-6) any = true; } if (any) live[u] = 1; }
      relax(dn, live, NORMAL_SMOOTH_PASSES);
      for (let i = 0; i < n; i += 1) {
        const u = id[i], dv = [0, 1, 2].map((m) => dn[u * 3 + m]); if (Math.hypot(...dv) < 1e-5) continue;
        const a = [N0[i * 3], N0[i * 3 + 1], N0[i * 3 + 2]], aw = apply(T, a, 0), al = Math.hypot(...aw) || 1;
        const t = apply(Ti, aw.map((v, m) => v / al + dv[m]), 0), tl = Math.hypot(...t) || 1;
        for (let m = 0; m < 3; m += 1) out[i * 3 + m] = t[m] / tl - a[m];
      }
      return out;
    };
    const toLocal = (d) => { const out = new Float32Array(n * 3); for (let i = 0; i < n; i += 1) out.set(apply(Ti, [d[i * 3], d[i * 3 + 1], d[i * 3 + 2]], 0), i * 3); return out; };
    // past the slider's 1.55x (manual SIZE, up to 2.0x): the same even growth as
    // `breastGrow`, one unit more, except that nothing moves toward her midline once it is
    // close to it, so the two breasts meet in the cleavage instead of passing through each
    // other (extrapolating breastGrow itself crossed them at 2.0x)
    const more = new Float32Array(n * 3);
    if (names.includes('breastGrow')) {
      const G = tgt('breastGrow');
      for (let i = 0; i < n; i += 1) {
        const x = P[i * 3], dx = G[i * 3];
        const inward = dx * Math.sign(x) < 0 ? smooth(BREAST_MIDLINE_M * 0.5, 0.06, Math.abs(x)) : 1;
        more.set([dx * inward, G[i * 3 + 1], G[i * 3 + 2]], i * 3);
      }
    }
    // spacing closer: the same turn the other way, except that nothing is carried toward her
    // midline once it is near it, so the breasts meet in the cleavage rather than cross
    const bspIn = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const x = P[i * 3], dx = -bsp[i * 3];
      bspIn.set([dx * (dx * Math.sign(x) < 0 ? smooth(BREAST_MIDLINE_M * 0.5, 0.06, Math.abs(x)) : 1), -bsp[i * 3 + 1], -bsp[i * 3 + 2]], i * 3);
    }
    const fields = { ...heightFields, breastGrowMore: more, breastSpacingIn: bspIn, bellyWidth: width, bellyDepth: depth, bellyUpper: upper, bellyLower: lower, breastSpacingOut: bsp, breastWidth: bw, breastHeight: bh, breastDepth: bd, breastPosition: bp, breastDroop: bdr, breastUpper: bu, breastLower: blo };
    for (const [name, raw] of Object.entries(fields)) {
      const f = finish(raw, WIDE_PASSES[name] ?? 0);
      // the arm never moves with the chest
      if (WIDE_PASSES[name]) for (let i = 0; i < n; i += 1) { const a = 1 - smooth(0.02, 0.15, armShare(i)); if (a < 1) for (let m = 0; m < 3; m += 1) f[i * 3 + m] *= a; }
      // smoothing carries a field a little across the fold where the bump meets the
      // breasts; each is held off the other's ground after it (both masks are smooth)
      for (let i = 0; i < n; i += 1) {
        const keep = name.startsWith('belly') ? 1 - smooth(0.02, 0.25, wgtAll[i]) : 1 - smooth(0.004, 0.02, dl(i));
        if (keep < 1) for (let m = 0; m < 3; m += 1) f[i * 3 + m] *= keep;
      }
      // how far it reaches where it must not: a belly field into the breasts, a breast field into the bump
      let most = 0, stray = 0, edge = 0;
      for (let i = 0; i < n; i += 1) {
        const l = Math.hypot(f[i * 3], f[i * 3 + 1], f[i * 3 + 2]); most = Math.max(most, l);
        const belly = name.startsWith('belly');
        if (belly ? wgtAll[i] > 0.5 : dl(i) > 0.03) stray = Math.max(stray, l);
        else if (belly ? wgtAll[i] > 0.05 : dl(i) > 0.01) edge = Math.max(edge, l);
      }
      log(`shape:${name} (${SHAPE_UNITS[name]}): largest move ${(most * 1000).toFixed(1)} mm; into the ${name.startsWith('belly') ? 'breasts proper' : 'bump proper'} ${(stray * 1000).toFixed(2)} mm, at the fold between ${(edge * 1000).toFixed(2)} mm`);
      prim.addTarget(doc.createPrimitiveTarget(`shape:${name}`).setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(toLocal(f))).setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(normalDelta(f))));
      if (!fieldNames.includes(`shape:${name}`)) fieldNames.push(`shape:${name}`);
    }

    // each size's bump against 100%'s: all of it, and below the navel
    const mean = (K, below) => { let s = 0, k = 0; for (let i = 0; i < n; i += 1) { if (Math.hypot(flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]) < 0.002) continue; if (below && P[i * 3 + 1] > nc[1]) continue; s += Math.hypot(...[0, 1, 2].map((m) => (K ? K[i * 3 + m] : 0) - flat[i * 3 + m])); k += 1; } return s / k; };
    const all0 = mean(null, false), low0 = mean(null, true);
    scaleAll = []; scaleLower = [];
    for (const [s, name] of [[2, 'belly200'], [1.5, 'belly150'], [1, null], [0.75, 'belly75'], [0.6, 'belly60'], [0.5, 'belly50'], [0.3, 'belly30'], [0.25, 'belly25'], [0, 'belly']]) {
      if (name && !names.includes(name)) continue; const K = name ? tgt(name) : null;
      scaleAll.push([s, +(mean(K, false) / all0).toFixed(3)]); scaleLower.push([s, +(mean(K, true) / low0).toFixed(3)]);
    }
  }
  log(`bellyShapeScale ${scaleAll.map(([s, r]) => `${s * 100}%:${r}`).join(' ')}`);
  log(`bellyLowerScale ${scaleLower.map(([s, r]) => `${s * 100}%:${r}`).join(' ')}`);
  const was = mesh.getWeights() ?? [];
  mesh.setExtras({ ...(mesh.getExtras() ?? {}), targetNames: [...names, ...fieldNames], v2Shape: STAMP, bellyShapeScale: scaleAll, bellyLowerScale: scaleLower });
  mesh.setWeights([...(was.length === names.length ? was : new Array(names.length).fill(0)), ...fieldNames.map(() => 0)]);
  await io.write(dst, doc);
}

if (process.argv[1]?.endsWith('sarahV2Shape.mjs')) await sarahV2Shape(process.argv[2], process.argv[3] ?? process.argv[2]);
