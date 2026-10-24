/**
 * The light tee's own navel, found once, for the room to follow (Joshua, 2026-10-24: the regular tee "still ignores the
 * two detail sliders").
 *
 * The fitted light tee (`public/models/sarah-v2-spandex-lite.glb`) carries her navel modelled into it -- a broad dome
 * over her outie at 100% -- and nothing at her nipples (it bridges her bust some 8-10 mm off them). To take its navel
 * back at a low NAVEL DETAIL the room has to know how far the tee itself stands out there, every frame, at whatever
 * belly. So this names points of the tee's OUTER layer (its normals face away from her) round her navel's axis, at her
 * approved body's reference (the tee's own 100% baseline):
 *   - `centre`: the outer-layer points within 2.5 mm of the axis, up to eight, nearest first;
 *   - `fit`: one point in each of 16 sectors round the axis in a ring 30-40 mm out, and in one 40-50 mm out, nearest
 *     each ring's middle, past where the tee's navel has died away.
 * The room poses them (`skinPose.ts`), lays them against her navel's axis as her body is posed, and fits the tee's
 * smooth surface through the `fit` points -- a quadric, tilted and curved differently up and across, since her belly
 * is (a round paraboloid left 4 mm of error at 20-30 mm; this leaves 1) -- which `clothDetail.ts` SETTLES the tee's
 * own navel onto at a low NAVEL DETAIL (`detailSpots.ts`'s `TeeNavel`).
 *
 * Usage: node scripts/sarahV2Recovery/tee-detail.mjs
 * Prints the points as the TypeScript constant `detailSpots.ts` holds, then at the reference: the tee's navel over its
 * smooth surface, and how far the settled tee stays off her body with her own navel settled under it (NAVEL DETAIL 0).
 * Deterministic; a second or two. `tests/sarahLiteTeeNavel.test.ts` checks the constant against the files.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const TEE = 'public/models/sarah-v2-spandex-lite.glb', BODY = 'public/models/sarah-v2-body-slim.glb', CLOTH = 'public/models/sarah-v2-spandex-cloth.glb';
/** Metres: the centre's reach, the two rings, and how far off her smooth surface a point may stand (not the back). */
const CENTRE = 0.0025, CENTRE_MAX = 8, RINGS = [[0.03, 0.04], [0.04, 0.05]], SECTORS = 16, REACH = 0.03;

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const floats = (accessor) => {
  const a = accessor.getArray();
  if (!accessor.getNormalized()) return Float64Array.from(a);
  const s = a instanceof Int16Array ? 32767 : a instanceof Int8Array ? 127 : a instanceof Uint16Array ? 65535 : 255;
  return Float64Array.from(a, (x) => Math.max(-1, x / s));
};
const targetsOf = (mesh, prim) => new Map(mesh.getExtras().targetNames.map((name, k) => [name, floats(prim.listTargets()[k].getAttribute('POSITION'))]));
const compose = (base, offsets, weights) => {
  const out = Float64Array.from(base);
  for (const [name, w] of Object.entries(weights)) { const d = offsets.get(name); if (d && w) for (let i = 0; i < out.length; i++) out[i] += w * d[i]; }
  return out;
};

const bodyDoc = await io.read(BODY), teeDoc = await io.read(TEE), clothDoc = await io.read(CLOTH);
const bm = bodyDoc.getRoot().listMeshes()[0], bp = bm.listPrimitives()[0], bodyOffsets = targetsOf(bm, bp);
const tm = teeDoc.getRoot().listMeshes()[0], tp = tm.listPrimitives()[0], teeOffsets = targetsOf(tm, tp);
const byBump = tm.getExtras().recoveredShirt.baselineWeightsByBump;
const detail = clothDoc.getRoot().listMeshes()[0].getExtras().cloth.detail;
const skin = bodyDoc.getRoot().listSkins()[0];
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const T = mul(Array.from(skin.listJoints()[0].getWorldMatrix()), Array.from(skin.getInverseBindMatrices().getArray().slice(0, 16)));
const scale = Math.hypot(T[0], T[1], T[2]); // metres a local unit
const bodyBase = floats(bp.getAttribute('POSITION')), teeBase = floats(tp.getAttribute('POSITION')), teeNormal = floats(tp.getAttribute('NORMAL'));

const at = (A, v) => [A[v * 3], A[v * 3 + 1], A[v * 3 + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** A ring's centroid, mean radius and (for the outer ring) its winding's unit normal: `detailSpots.ts`'s measure. */
function ring(A, ids) {
  const P = ids.map((v) => at(A, v)), m = [0, 1, 2].map((k) => P.reduce((s, p) => s + p[k], 0) / P.length);
  const n = [0, 0, 0]; let r = 0;
  P.forEach((p, j) => { const a = sub(p, m), b = sub(P[(j + 1) % P.length], m); n[0] += a[1] * b[2] - a[2] * b[1]; n[1] += a[2] * b[0] - a[0] * b[2]; n[2] += a[0] * b[1] - a[1] * b[0]; r += Math.hypot(...a); });
  const l = Math.hypot(...n);
  return { m, n: n.map((x) => x / l), r: r / P.length };
}
/** Her navel's axis on a body: the outer ring's centre and normal, and her detail's height over her smooth surface. */
function axis(B) {
  const A = ring(B, detail.navelRings[0]), O = ring(B, detail.navelRings[detail.navelRings.length - 1]);
  const curve = dot(sub(A.m, O.m), O.n) / (O.r ** 2 - A.r ** 2);
  return { base: O.m, n: O.n, h: dot(sub(at(B, detail.navel), O.m), O.n) - curve * O.r ** 2 };
}
/** A point's height along the axis and its tangential offset from it. */
const place = (p, ax) => { const d = sub(p, ax.base), along = dot(d, ax.n); return { along, t: sub(d, ax.n.map((x) => x * along)) }; };
/** A tangent frame round the axis: her local x made square to it, and the third. */
function frame(ax) {
  const across = sub([1, 0, 0], ax.n.map((x) => x * ax.n[0])), al = Math.hypot(...across), u = across.map((x) => x / al);
  return { u, w: [ax.n[1] * u[2] - ax.n[2] * u[1], ax.n[2] * u[0] - ax.n[0] * u[2], ax.n[0] * u[1] - ax.n[1] * u[0]] };
}
/** Least squares on six unknowns (normal equations, Gauss-Jordan with pivoting). */
function solve6(M, y) {
  const A = M.map((r, i) => [...r, y[i]]), n = y.length;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map((r, i) => r[n] / r[i]);
}
/** The tee's smooth surface round the axis from the `fit` points: along = h + a·u + b·w + c·u² + d·u·w + e·w². */
function smoothOf(P, ax, ids) {
  const { u, w } = frame(ax), M = Array.from({ length: 6 }, () => new Array(6).fill(0)), y = new Array(6).fill(0);
  for (const v of ids) {
    const { along, t } = place(at(P, v), ax), x = dot(t, u), z = dot(t, w), f = [1, x, z, x * x, x * z, z * z];
    for (let i = 0; i < 6; i++) { y[i] += f[i] * along; for (let j = 0; j < 6; j++) M[i][j] += f[i] * f[j]; }
  }
  const c = solve6(M, y);
  return (p) => { const { t } = place(p, ax), x = dot(t, u), z = dot(t, w); return c[0] + c[1] * x + c[2] * z + c[3] * x * x + c[4] * x * z + c[5] * z * z; };
}
/** The tee's navel over its smooth surface: the mean of the `centre` points' heights above it. */
function relief(P, ax, pts) {
  const smooth = smoothOf(P, ax, pts.fit);
  return pts.centre.reduce((s, v) => s + place(at(P, v), ax).along - smooth(at(P, v)), 0) / pts.centre.length;
}

// ---- the points, at the tee's reference -------------------------------------------------------------------------
const reference = byBump[100];
const B = compose(bodyBase, bodyOffsets, reference), ax = axis(B);
if (ax.h <= 0) throw new Error('her navel is not proud at the reference: the axis is wound inward');
const outer = [];
for (let v = 0; v < teeBase.length / 3; v++) {
  if (dot(at(teeNormal, v), ax.n) < 0.5) continue; // the inner layer faces her
  const { along, t } = place(at(teeBase, v), ax);
  if (Math.abs(along) > REACH / scale) continue; // the back of the tee, a body's depth behind
  outer.push({ v, r: Math.hypot(...t) * scale, t });
}
const centre = outer.filter((o) => o.r < CENTRE).sort((a, b) => a.r - b.r || a.v - b.v).slice(0, CENTRE_MAX).map((o) => o.v);
// sectors measured from a fixed direction across her: her local x, made tangent to the axis
const across = sub([1, 0, 0], ax.n.map((x) => x * ax.n[0])), al = Math.hypot(...across), u = across.map((x) => x / al);
const w = [ax.n[1] * u[2] - ax.n[2] * u[1], ax.n[2] * u[0] - ax.n[0] * u[2], ax.n[0] * u[1] - ax.n[1] * u[0]];
const fit = RINGS.map(([lo, hi]) => {
  const best = new Array(SECTORS).fill(null), mid = (lo + hi) / 2;
  for (const o of outer) {
    if (o.r < lo || o.r > hi) continue;
    const s = Math.floor(((Math.atan2(dot(o.t, w), dot(o.t, u)) / (2 * Math.PI)) + 1) * SECTORS) % SECTORS;
    if (!best[s] || Math.abs(o.r - mid) < Math.abs(best[s].r - mid) || (Math.abs(o.r - mid) === Math.abs(best[s].r - mid) && o.v < best[s].v)) best[s] = o;
  }
  const got = best.filter(Boolean).map((o) => o.v);
  if (got.length < SECTORS * 0.75) throw new Error(`a ring ${lo}-${hi} m round her navel found only ${got.length} of ${SECTORS} sectors`);
  return got;
}).flat();
if (centre.length < 2) throw new Error(`only ${centre.length} of the tee's points lie on her navel's axis`);
const pts = { centre, fit };

const wrap = (ids) => ids.join(', ').replace(/(.{1,112})(, |$)/g, '\n    $1,').replace(/,,$/, ',');
console.log(`export const SARAH_V2_LITE_TEE_NAVEL: TeeNavelPoints = Object.freeze({\n  centre: [${centre.join(', ')}],\n  fit: [${wrap(fit)}\n  ],\n});`);

// ---- what it reads at the reference: her navel, the tee's, and the settled tee's clearance over her (mm) ------------
// Only here: at other sizes the room also writes its fitting shapes onto the tee on the CPU (`shape:fitBelly…`), which
// this does not; `?probe=cloth`'s `fitted()` reads them in the room.
{
  const flatAt = (p) => { const t = Math.min(1, Math.max(0, (p - 75) / 25)); return 1 - t * t * (3 - 2 * t); };
  const b = compose(bodyBase, bodyOffsets, { ...reference, navelFlat: flatAt(100) }), a = axis(b);
  const smooth = smoothOf(teeBase, a, pts.fit), flatBody = compose(bodyBase, bodyOffsets, { ...reference, navelFlat: 1 });
  let clear = Infinity;
  for (let v = 0; v < flatBody.length / 3; v++) {
    const p = at(flatBody, v), { along, t } = place(p, a);
    if (Math.hypot(...t) * scale > 0.03 || Math.abs(along) * scale > 0.03) continue;
    clear = Math.min(clear, smooth(p) - along);
  }
  const mm = (x) => (x * scale * 1000).toFixed(1);
  console.log(`\nat 100%: her navel ${mm(a.h)} mm over her smooth surface; the tee's ${mm(relief(teeBase, a, pts))} mm over its own;`);
  console.log(`settled (NAVEL DETAIL 0), the tee stays ${mm(clear)} mm off her with her navel settled under it`);
}
