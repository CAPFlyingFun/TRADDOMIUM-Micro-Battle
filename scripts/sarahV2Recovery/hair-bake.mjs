/**
 * SARAH v2'S HAIR (Joshua, 2026-10-24: "Start with one face and one hairstyle for Sarah v2. Use our existing Sarah
 * references and assets where they help... Check that the hair follows her head cleanly, avoids obvious clipping
 * through her shoulders or shirt, and performs well on my iPhone").
 *
 * Her reference is TMB-Story's character sheet (`assets/source/sarah-sheet.png`): copper-auburn wavy hair, parted in the
 * middle with curtain bangs that frame her face down past her jaw, pulled back into a ponytail tied with a black elastic
 * at the back of her head about level with her eyes, falling in loose waves to between her shoulder blades.
 *
 * This writes `public/models/sarah-v2-hair.glb`: one skinned mesh on her own skeleton (the body file's joints, in their
 * order, so the room binds it to her as it binds every recovered garment), one material, one texture made here.
 *
 *   - THE CAP: a shell over her scalp, built on rays from the middle of her head. Its rows run from the hairline to the
 *     tie, so the strand texture runs the way pulled-back hair runs: every strand toward the elastic. It is a few
 *     millimetres thick at the hairline, fuller over the crown and gathered into a bunch at the tie.
 *   - THE PONYTAIL: an opaque core and clumps of strand cards around it, waving as they fall. The path keeps clear of
 *     her head, her neck and her back (and the tee over it) at every point.
 *   - THE CURTAIN: strands from her middle parting sweep over each temple and fall in front of her ears to below her
 *     jaw, held off her skin.
 *   - THE ELASTIC: a small torus, dark through its vertex colour.
 *
 * Skinning: the cap, the curtain and the elastic take the weights of the scalp under them, so they ride her head as her
 * skin does. The ponytail starts on her head and gives way to her neck and upper back down its length, so a turned or
 * lowered head never drives it into her back.
 *
 * Cards are alpha-tested (no sorting, no blending), double-sided, and lit by the volume's normal rather than their
 * own, so a clump shades as a lock of hair and not as a flat strip.
 *
 * Deterministic: one seed, no clock.
 *
 *   node scripts/sarahV2Recovery/hair-bake.mjs [--out public/models/sarah-v2-hair.glb] [--texture 1024]
 */
import { statSync, writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const option = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const BODY = option('body', 'public/models/sarah-v2-body-slim.glb');
const TARGET = option('out', 'public/models/sarah-v2-hair.glb');
const TEX = Number(option('texture', 1024));
const DUMP = option('dump', '');

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

// --------------------------------------------------------------------------------------------------------------------
// numbers and vectors

/** Her geometry units to her rest metres: bone 0's world matrix times its inverse bind (faceRig.ts measures the same). */
const REST_SCALE = 0.89974678, REST_OFFSET = [0, 0.8002533, -0.0340415];
function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
/** Catmull-Rom through points, at u in [0, 1] over the whole run. */
function catmull(points, u) {
  const n = points.length - 1, f = clamp(u, 0, 1) * n, i = Math.min(n - 1, Math.floor(f)), t = f - i;
  const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(n, i + 2)];
  const t2 = t * t, t3 = t2 * t;
  return [0, 1, 2].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}

// --------------------------------------------------------------------------------------------------------------------
// her body, at rest

const doc = await io.read(BODY);
const bodyMesh = doc.getRoot().listMeshes()[0], bodyPrim = bodyMesh.listPrimitives()[0];
const floats = (a) => { const x = a.getArray(); if (!a.getNormalized()) return Float32Array.from(x); const s = x instanceof Int16Array ? 32767 : x instanceof Int8Array ? 127 : x instanceof Uint16Array ? 65535 : 255; return Float32Array.from(x, (v) => Math.max(-1, v / s)); };
const GP = floats(bodyPrim.getAttribute('POSITION')), GN = floats(bodyPrim.getAttribute('NORMAL'));
const BJ = bodyPrim.getAttribute('JOINTS_0').getArray(), BW = floats(bodyPrim.getAttribute('WEIGHTS_0'));
const BI = bodyPrim.getIndices().getArray();
const nv = GP.length / 3;
const RP = new Float64Array(nv * 3), RN = new Float64Array(nv * 3);
for (let v = 0; v < nv; v++) {
  for (let k = 0; k < 3; k++) RP[v * 3 + k] = GP[v * 3 + k] * REST_SCALE + REST_OFFSET[k];
  const n = unit([GN[v * 3], GN[v * 3 + 1], GN[v * 3 + 2]]); RN.set(n, v * 3);
}
const restOf = (v) => [RP[v * 3], RP[v * 3 + 1], RP[v * 3 + 2]];
const skin = doc.getRoot().listSkins()[0], joints = skin.listJoints();
const jointIndex = (name) => joints.findIndex((j) => j.getName() === name);
const HEAD = jointIndex('Bone_016'), NECK = jointIndex('Bone_017'), CHEST = jointIndex('Bone_002');
if (HEAD < 0 || NECK < 0 || CHEST < 0) throw new Error('hair-bake: her head, neck or chest bone is missing');

/** Her surface above the waist, as triangles in a grid of 1 cm cells: for rays and for the nearest point. */
const tris = [];
for (let t = 0; t < BI.length; t += 3) {
  const a = BI[t], b = BI[t + 1], c = BI[t + 2];
  if (Math.max(RP[a * 3 + 1], RP[b * 3 + 1], RP[c * 3 + 1]) > 1.12) tris.push(a, b, c);
}
const CELL = 0.01, grid = new Map();
const cellKey = (x, y, z) => `${x},${y},${z}`;
for (let t = 0; t < tris.length; t += 3) {
  const ps = [restOf(tris[t]), restOf(tris[t + 1]), restOf(tris[t + 2])];
  const lo = [0, 1, 2].map((k) => Math.floor(Math.min(ps[0][k], ps[1][k], ps[2][k]) / CELL)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(ps[0][k], ps[1][k], ps[2][k]) / CELL));
  for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
    const key = cellKey(x, y, z); let list = grid.get(key); if (!list) grid.set(key, (list = [])); list.push(t);
  }
}
function triAt(t) { return [restOf(tris[t]), restOf(tris[t + 1]), restOf(tris[t + 2])]; }
/** The nearest point of her surface to p within r (metres), with the surface's normal there; null if none. */
function nearest(p, r = 0.05) {
  const lo = p.map((x) => Math.floor((x - r) / CELL)), hi = p.map((x) => Math.floor((x + r) / CELL));
  let best = null, bestD = r, seen = new Set();
  for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
    for (const t of grid.get(cellKey(x, y, z)) ?? []) {
      if (seen.has(t)) continue; seen.add(t);
      const [a, b, c] = triAt(t), q = closestOnTriangle(p, a, b, c), d = len(sub(p, q));
      if (d < bestD) { bestD = d; best = { q, d, n: triNormal(t) }; }
    }
  }
  return best;
}
function triNormal(t) {
  // the smooth normal: her vertices' own, averaged (the face's would flip on a sliver)
  const n = [0, 0, 0];
  for (let k = 0; k < 3; k++) { const v = tris[t + k]; n[0] += RN[v * 3]; n[1] += RN[v * 3 + 1]; n[2] += RN[v * 3 + 2]; }
  return unit(n);
}
function closestOnTriangle(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, mul(ab, d1 / (d1 - d3)));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, mul(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, mul(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  const denom = 1 / (va + vb + vc); return add(a, add(mul(ab, vb * denom), mul(ac, vc * denom)));
}
/** Is p inside her (the nearest surface's normal points away from p)? */
const inside = (p, near) => near && dot(sub(p, near.q), near.n) < 0;
/** Push p out of her until it stands `clear` metres off her surface (measured to the nearest point within reach). */
function keepOff(p, clear, reach = 0.06) {
  let q = p;
  for (let k = 0; k < 6; k++) {
    const near = nearest(q, reach);
    if (!near) return q;
    const signed = inside(q, near) ? -near.d : near.d;
    if (signed >= clear - 1e-5) return q;
    q = add(q, mul(near.n, clear - signed));
  }
  return q;
}
/** The first hit of a ray on her head (brute force over the head's triangles: a few thousand rays). */
const headTris = []; for (let t = 0; t < tris.length; t += 3) { const [a, b, c] = triAt(t); if (Math.min(a[1], b[1], c[1]) > 1.44) headTris.push(t); }
function raycast(o, d) {
  let best = Infinity;
  for (const t of headTris) {
    const [a, b, c] = triAt(t), e1 = sub(b, a), e2 = sub(c, a), pv = cross(d, e2), det = dot(e1, pv);
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det, tv = sub(o, a), u = dot(tv, pv) * inv; if (u < 0 || u > 1) continue;
    const qv = cross(tv, e1), v = dot(d, qv) * inv; if (v < 0 || u + v > 1) continue;
    const dist = dot(e2, qv) * inv; if (dist > 1e-4 && dist < best) best = dist;
  }
  return best;
}
/** The weights of her vertex nearest p (her skin's own, so whatever lies on her moves as her skin does). */
const vgrid = new Map();
for (let v = 0; v < nv; v++) { if (RP[v * 3 + 1] < 1.12) continue; const k = cellKey(...restOf(v).map((x) => Math.floor(x / CELL))); let l = vgrid.get(k); if (!l) vgrid.set(k, (l = [])); l.push(v); }
function weightsNear(p) {
  let best = -1, bd = Infinity;
  for (let r = 1; best < 0 && r < 8; r++) {
    const c = p.map((x) => Math.floor(x / CELL));
    for (let x = c[0] - r; x <= c[0] + r; x++) for (let y = c[1] - r; y <= c[1] + r; y++) for (let z = c[2] - r; z <= c[2] + r; z++) for (const v of vgrid.get(cellKey(x, y, z)) ?? []) { const d = len(sub(restOf(v), p)); if (d < bd) { bd = d; best = v; } }
  }
  const m = new Map();
  for (let k = 0; k < 4; k++) { const w = BW[best * 4 + k]; if (w > 0) m.set(BJ[best * 4 + k], (m.get(BJ[best * 4 + k]) ?? 0) + w); }
  return m;
}
function blendWeights(a, b, t) {
  const m = new Map();
  for (const [j, w] of a) m.set(j, (m.get(j) ?? 0) + w * (1 - t));
  for (const [j, w] of b) m.set(j, (m.get(j) ?? 0) + w * t);
  return m;
}

// --------------------------------------------------------------------------------------------------------------------
// the mesh being built

const out = { pos: [], nrm: [], uv: [], col: [], joints: [], weights: [], index: [] };
const parts = {};
function vertex(p, n, u, v, c, w) {
  const top = [...w].sort((x, y) => y[1] - x[1]).slice(0, 4), sum = top.reduce((s, [, x]) => s + x, 0) || 1;
  out.pos.push(...p); out.nrm.push(...unit(n)); out.uv.push(u, v); out.col.push(c[0], c[1], c[2], c[3] ?? 1);
  for (let k = 0; k < 4; k++) { out.joints.push(top[k]?.[0] ?? 0); out.weights.push(top[k] ? top[k][1] / sum : 0); }
  return out.pos.length / 3 - 1;
}
function begin(name) { parts[name] = { from: out.index.length / 3, verts: out.pos.length / 3 }; }
function end(name) { parts[name] = { triangles: out.index.length / 3 - parts[name].from, vertices: out.pos.length / 3 - parts[name].verts }; }

// THE TEXTURE'S LAYOUT (v down the image, glTF), in thirds: the cap's opaque strands, tiling across; the shells' loose
// strands with alpha, tiling across; four card variants side by side, strands with alpha, root at the top, tips below
const CAP_V = [0.003, 0.330], SHELL_V = [0.337, 0.663], CARD_V = [0.670, 0.997];
const cardU = (variant, u) => (variant + 0.04 + 0.92 * clamp(u, 0, 1)) / 4;

// --------------------------------------------------------------------------------------------------------------------
// HER HEAD'S FRAME. C is the middle of her cranium; the tie sits on the back of her head where it stands furthest back,
// about level with her eyes (the sheet's side view): a direction from C, and the rays round it find her scalp

const C = [0.0, 1.600, -0.078];
const tieOnScalp = (() => { const d = unit([0, 0.018, -1]); return add(C, mul(d, raycast(C, d))); })();
const TIE = unit(sub(tieOnScalp, C));
const B = unit(sub([0, 1, 0], mul(TIE, TIE[1])));      // "up" across the tie's axis
const X = cross(B, TIE);                                // her side, round the axis
const dirOf = (theta, phi) => unit(add(mul(TIE, Math.cos(phi)), mul(add(mul(B, Math.cos(theta)), mul(X, Math.sin(theta))), Math.sin(phi))));
const angles = (d) => { const a = Math.acos(clamp(dot(d, TIE), -1, 1)); const th = Math.atan2(dot(d, X), dot(d, B)); return [th < 0 ? th + 2 * Math.PI : th, a]; };

// THE HAIRLINE, as points near her scalp going round her head from her forehead to her nape (her right side mirrored).
// Round the tie's axis the line above her ear would run almost straight along it, so it is held instead as an
// elevation for each azimuth round her head's upright axis through C, which it always is a function of: for any
// direction round her head, the hair comes down to one height. Between the points a periodic spline.
const HAIRLINE = [
  [0.000, 1.656, 0.000], [0.024, 1.658, -0.003], [0.048, 1.641, -0.012], [0.062, 1.616, -0.036], [0.070, 1.603, -0.062],
  [0.074, 1.603, -0.090], [0.071, 1.590, -0.112], [0.064, 1.552, -0.121], [0.044, 1.511, -0.131], [0.000, 1.500, -0.137],
];
const azEl = (p) => { const q = sub(p, C); return [Math.atan2(q[0], q[2]), Math.asin(clamp(q[1] / len(q), -1, 1))]; };
const hairAz = [];
for (const p of HAIRLINE) { hairAz.push(azEl(p)); if (p[0] !== 0) hairAz.push(azEl([-p[0], p[1], p[2]])); }
hairAz.sort((a, b) => a[0] - b[0]);
// the back of her head (azimuth ±180) is one point: keep one copy and close the loop through it
const loop = hairAz.filter((p, i, all) => i === 0 || Math.abs(p[0] - all[i - 1][0]) > 1e-6);
function hairlineEl(az) {
  const n = loop.length, a = ((az + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  let i = loop.findIndex((p) => p[0] > a); if (i < 0) i = n;
  const at = (k) => { const m = ((k % n) + n) % n, wraps = Math.floor(k / n); return [loop[m][0] + wraps * 2 * Math.PI, loop[m][1]]; };
  const p0 = at(i - 2), p1 = at(i - 1), p2 = at(i), p3 = at(i + 1);
  const t = clamp((a - p1[0]) / (p2[0] - p1[0] || 1), 0, 1), t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
}
/** How far inside the hairline a point of her scalp is, metres along her scalp (negative outside). */
const hairMask = (p) => { const [az, el] = azEl(p); return (el - hairlineEl(az)) * len(sub(p, C)); };

// --------------------------------------------------------------------------------------------------------------------
// THE CAP: a grid round the tie, from the gathered end out past the hairline everywhere; what lies outside the hairline
// fades out through the vertex alpha, so the alpha test cuts the hairline along a smooth curve through the triangles
// rather than along their edges, and triangles wholly outside it are left out

const NT = Number(option('cap-around', 120)), NS = Number(option('cap-along', 52));
const PHI0 = 0.21, PHI_MAX = 2.72;     // radians from the tie's axis: the gathered end, and well past her forehead's hairline
const CROWN = unit([0, 1, 0.15]);      // where pulled-back hair stands fullest
const scalp = [];
for (let i = 0; i < NT; i++) {
  const theta = (i / NT) * 2 * Math.PI, col = [];
  for (let j = 0; j <= NS; j++) {
    const t = j / NS, phi = PHI0 + (PHI_MAX - PHI0) * t, d = dirOf(theta, phi), r = raycast(C, d);
    col.push({ d, r: Number.isFinite(r) ? r : null, t, theta });
  }
  scalp.push(col);
}
// a ray that missed takes its neighbours'; one that caught an ear's rim (much further than its neighbours) too
for (let pass = 0; pass < 2; pass++) for (let i = 0; i < NT; i++) for (let j = 0; j <= NS; j++) {
  const near = [scalp[(i + NT - 1) % NT][j], scalp[(i + 1) % NT][j], scalp[i][Math.max(0, j - 1)], scalp[i][Math.min(NS, j + 1)]].map((c) => c.r).filter((r) => r !== null).sort((a, b) => a - b);
  const median = near.length ? near[Math.floor(near.length / 2)] : 0.09;
  if (scalp[i][j].r === null || scalp[i][j].r > median + 0.006) scalp[i][j].r = median;
}
for (const col of scalp) for (const c of col) { c.s = add(C, mul(c.d, c.r)); c.m = hairMask(c.s); }
function capThickness(c) {
  const crown = Math.exp(-Math.pow(Math.acos(clamp(dot(c.d, CROWN), -1, 1)) / 0.6, 2));
  const sides = Math.exp(-Math.pow((Math.abs(c.d[0]) - 0.85) / 0.25, 2)) * smoothstep(-0.25, 0.15, c.d[1]);
  const gather = 1 - smoothstep(0, 0.16, c.t);
  const taper = smoothstep(-0.002, 0.016, c.m);
  return (0.0070 + 0.0095 * crown + 0.0095 * sides + 0.011 * gather) * taper + 0.0013;
}
const capAlpha = (m) => (m >= 0 ? clamp(0.42 + 0.58 * m / 0.0022, 0, 1) : clamp(0.42 + 0.42 * m / 0.003, 0, 1));
begin('cap');
const capIdx = [];
const capVertex = (c, u) => {
  const p = add(C, mul(c.d, c.r + capThickness(c)));
  // the roots darker in the gather and at the hairline, as hair is where less light reaches
  const shade = (0.8 + 0.2 * smoothstep(0, 0.2, c.t)) * (1 - 0.25 * (1 - smoothstep(0, 0.012, c.m)));
  return vertex(p, c.d, u, CAP_V[0] + (CAP_V[1] - CAP_V[0]) * c.t, [shade, shade, shade, capAlpha(c.m)], weightsNear(c.s));
};
for (let i = 0; i <= NT; i++) capIdx.push(scalp[i % NT].map((c) => capVertex(c, (i / NT) * 6)));
for (let i = 0; i < NT; i++) for (let j = 0; j < NS; j++) {
  const quad = [scalp[i][j], scalp[(i + 1) % NT][j], scalp[i][j + 1], scalp[(i + 1) % NT][j + 1]];
  if (Math.max(...quad.map((c) => c.m)) < -0.004) continue;
  const a = capIdx[i], b = capIdx[i + 1];
  out.index.push(a[j], b[j], a[j + 1], b[j], b[j + 1], a[j + 1]);
}
// THE SHELLS: two more layers over the cap, of loose strands with alpha, a few millimetres out, so the surface of her
// hair has depth and the light catches strands rather than a smooth shell (the way fur is drawn, at two layers)
const SHELLS = [0.0026, 0.0052];
for (const [k, lift] of SHELLS.entries()) {
  const rows = [];
  for (let i = 0; i <= NT; i++) rows.push(scalp[i % NT].map((c) => {
    const p = add(C, mul(c.d, c.r + capThickness(c) + lift * smoothstep(-0.002, 0.01, c.m)));
    const shade = (0.86 + 0.14 * smoothstep(0, 0.2, c.t)) * (1.0 + 0.06 * k);
    return vertex(p, c.d, (i / NT) * 6 + 0.37 * k, SHELL_V[0] + (SHELL_V[1] - SHELL_V[0]) * c.t, [shade, shade, shade, capAlpha(c.m - 0.0015)], weightsNear(c.s));
  }));
  for (let i = 0; i < NT; i++) for (let j = 0; j < NS; j++) {
    const quad = [scalp[i][j], scalp[(i + 1) % NT][j], scalp[i][j + 1], scalp[(i + 1) % NT][j + 1]];
    if (Math.max(...quad.map((c) => c.m)) < -0.002 || j < 2) continue;
    out.index.push(rows[i][j], rows[i + 1][j], rows[i][j + 1], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]);
  }
}
// the gathered end closes over the tie
{
  const ring = capIdx.slice(0, NT).map((r) => r[0]);
  const hub = vertex(add(C, mul(TIE, scalp[0][0].r + 0.02)), TIE, 0.5, CAP_V[0], [0.7, 0.7, 0.7, 1], weightsNear(tieOnScalp));
  for (let i = 0; i < NT; i++) out.index.push(hub, ring[(i + 1) % NT], ring[i]);
}
end('cap');
if (process.argv.includes('--debug-hairline')) {
  console.log('hairline (azimuth:elevation deg):', loop.map(([a, e]) => `${(a * 180 / Math.PI).toFixed(0)}:${(e * 180 / Math.PI).toFixed(0)}`).join(' '));
  for (let a = -180; a <= 180; a += 15) { const el = hairlineEl(a * Math.PI / 180); console.log(`az ${a} hairline el ${(el * 180 / Math.PI).toFixed(1)} y ${(C[1] + 0.09 * Math.sin(el)).toFixed(3)}`); }
}

// --------------------------------------------------------------------------------------------------------------------
// THE PONYTAIL

const rnd = mulberry32(20261024);
const TIE_OUT = add(tieOnScalp, mul(TIE, 0.019));
// the path: out of the elastic a little back and down, over her nape, onto her upper back between her shoulder blades;
// every point held off her (and the tee) by its own radius and a margin
const RAW_PATH = [TIE_OUT, add(TIE_OUT, [0, -0.022, -0.034]), [0, 1.530, -0.236], [0, 1.450, -0.238], [0, 1.380, -0.233], [0, 1.305, -0.224]];
const LENGTH_SAMPLES = 40;
const radiusAt = (s) => (s < 0.2 ? 0.0145 + (0.036 - 0.0145) * smoothstep(0, 0.2, s) : s < 0.6 ? 0.036 - 0.003 * smoothstep(0.2, 0.6, s) : 0.033 * (1 - 0.8 * smoothstep(0.6, 1.0, s)));
const axis = [];
for (let k = 0; k <= LENGTH_SAMPLES; k++) {
  const s = k / LENGTH_SAMPLES; let p = catmull(RAW_PATH, s);
  // a lazy sway, as a fall of hair has
  p = add(p, [0.005 * Math.sin(2 * Math.PI * (1.15 * s + 0.1)) * smoothstep(0.1, 0.5, s), 0, 0]);
  if (s > 0.08) p = keepOff(p, radiusAt(s) + 0.009, 0.08);
  axis.push(p);
}
// smooth what keepOff pushed, twice
for (let pass = 0; pass < 2; pass++) for (let k = 1; k < axis.length - 1; k++) axis[k] = lerp3(axis[k], lerp3(axis[k - 1], axis[k + 1], 0.5), 0.5);
const tangentAt = (k) => unit(sub(axis[Math.min(LENGTH_SAMPLES, k + 1)], axis[Math.max(0, k - 1)]));
// a frame along it that does not twist: the side stays her side
const frames = axis.map((_, k) => { const t = tangentAt(k), side = unit(sub([1, 0, 0], mul(t, t[0]))), back = cross(t, side); return { t, side, back }; });
const tailWeights = (s) => blendWeights(weightsNear(tieOnScalp), new Map([[CHEST, 0.55], [NECK, 0.45]]), smoothstep(0.1, 0.62, s));

begin('ponytail-core');
{
  const RADIAL = 12, rows = [];
  for (let k = 0; k <= LENGTH_SAMPLES; k++) {
    const s = k / LENGTH_SAMPLES, f = frames[k], r = radiusAt(s) * 0.66, row = [];
    for (let a = 0; a <= RADIAL; a++) {
      const ang = (a / RADIAL) * 2 * Math.PI, n = add(mul(f.side, Math.cos(ang)), mul(f.back, Math.sin(ang)));
      const shade = 0.72 + 0.28 * smoothstep(0, 0.15, s);
      row.push(vertex(add(axis[k], mul(n, r)), n, (a / RADIAL) * 2, CAP_V[0] + (CAP_V[1] - CAP_V[0]) * (0.1 + 0.9 * s), [shade, shade, shade], tailWeights(s)));
    }
    rows.push(row);
  }
  for (let k = 0; k < LENGTH_SAMPLES; k++) for (let a = 0; a < RADIAL; a++) out.index.push(rows[k][a], rows[k][a + 1], rows[k + 1][a], rows[k][a + 1], rows[k + 1][a + 1], rows[k + 1][a]);
  // the tip closed
  const tip = vertex(add(axis[LENGTH_SAMPLES], mul(frames[LENGTH_SAMPLES].t, 0.004)), frames[LENGTH_SAMPLES].t, 0.5, CAP_V[1], [1, 1, 1], tailWeights(1));
  for (let a = 0; a < RADIAL; a++) out.index.push(rows[LENGTH_SAMPLES][a], rows[LENGTH_SAMPLES][a + 1], tip);
}
end('ponytail-core');

/** A card along a path: `points` the centre line, `across` the direction it spreads, `normals` how it is lit; u across, v along. */
function card(points, across, widths, normals, variant, shade, weightsAt, vFrom = 0, vTo = 1) {
  const n = points.length - 1, left = [], right = [];
  for (let k = 0; k <= n; k++) {
    const s = k / n, v = CARD_V[0] + (CARD_V[1] - CARD_V[0]) * (vFrom + (vTo - vFrom) * s), w = widths[k] / 2, c = shade(s), wt = weightsAt(s);
    left.push(vertex(add(points[k], mul(across[k], -w)), normals[k], cardU(variant, 0), v, [c, c, c], wt));
    right.push(vertex(add(points[k], mul(across[k], w)), normals[k], cardU(variant, 1), v, [c, c, c], wt));
  }
  for (let k = 0; k < n; k++) out.index.push(left[k], right[k], left[k + 1], right[k], right[k + 1], left[k + 1]);
}

begin('ponytail-clumps');
const CLUMPS = Number(option('clumps', 44));
for (let c = 0; c < CLUMPS; c++) {
  const ang0 = (c / CLUMPS) * 2 * Math.PI + rnd() * 0.4, out01 = 0.55 + 0.5 * rnd(), width = 0.016 + 0.014 * rnd();
  const s0 = 0.02 + 0.06 * rnd(), s1 = 0.84 + 0.16 * rnd(), phase = rnd(), wave = 0.009 + 0.009 * rnd(), twist = (rnd() - 0.5) * 0.9, variant = c % 4;
  const pts = [], across = [], nrm = [], widths = [];
  const SEG = 26;
  for (let k = 0; k <= SEG; k++) {
    const s = s0 + (s1 - s0) * (k / SEG), fk = s * LENGTH_SAMPLES, k0 = Math.min(LENGTH_SAMPLES - 1, Math.floor(fk)), ft = fk - k0;
    const centre = lerp3(axis[k0], axis[k0 + 1], ft), f = frames[Math.round(fk)];
    const ang = ang0 + twist * s, radial = add(mul(f.side, Math.cos(ang)), mul(f.back, Math.sin(ang)));
    const tangentialDir = cross(f.t, radial);
    // the loose S of her waves: each clump swings across its own side, more toward the ends
    const swing = wave * Math.sin(2 * Math.PI * (1.45 * s + phase)) * smoothstep(0.12, 0.55, s);
    // the ends flare a little, as loose waves do
    let p = add(centre, add(mul(radial, radiusAt(s) * out01 * (1 + 0.35 * smoothstep(0.6, 1, s))), mul(tangentialDir, swing)));
    pts.push(p); across.push(unit(tangentialDir)); nrm.push(radial);
    widths.push(width * (s > 0.75 ? 1 - 0.55 * smoothstep(0.75, 1, s) : 1) * (0.75 + 0.25 * smoothstep(0, 0.12, s)));
  }
  // a clump lying against her back is held off her too
  for (let k = 0; k < pts.length; k++) pts[k] = keepOff(pts[k], 0.008, 0.04);
  card(pts, across, widths, nrm, variant, (s) => 0.8 + 0.2 * smoothstep(0, 0.2, s), tailWeights);
}
end('ponytail-clumps');

// --------------------------------------------------------------------------------------------------------------------
// THE ELASTIC: a small dark torus round the gathered hair at the tie

begin('elastic');
{
  const t0 = unit(sub(axis[2], axis[0])), side = unit(sub([1, 0, 0], mul(t0, t0[0]))), back = cross(t0, side);
  const centre = add(axis[0], mul(t0, 0.004)), R = 0.0135, r = 0.0038, U = 18, V = 8, rows = [];
  for (let a = 0; a <= U; a++) {
    const A = (a / U) * 2 * Math.PI, ring = add(mul(side, Math.cos(A)), mul(back, Math.sin(A))), row = [];
    for (let b = 0; b <= V; b++) {
      const Bv = (b / V) * 2 * Math.PI, n = add(mul(ring, Math.cos(Bv)), mul(t0, Math.sin(Bv)));
      row.push(vertex(add(centre, add(mul(ring, R), mul(n, r))), n, 0.5, CAP_V[0] + 0.3 * (CAP_V[1] - CAP_V[0]), [0.07, 0.07, 0.075], weightsNear(tieOnScalp)));
    }
    rows.push(row);
  }
  for (let a = 0; a < U; a++) for (let b = 0; b < V; b++) out.index.push(rows[a][b], rows[a + 1][b], rows[a][b + 1], rows[a + 1][b], rows[a + 1][b + 1], rows[a][b + 1]);
}
end('elastic');

// --------------------------------------------------------------------------------------------------------------------
// THE CURTAIN: from the middle parting over each temple, in front of her ears, to below her jaw

begin('curtain');
const capPoint = (p) => { const d = unit(sub(p, C)), r = raycast(C, d); return Number.isFinite(r) ? add(C, mul(d, r)) : p; };
/** A point laid on her hair where the cap is (just over its surface) and held off her skin below the hairline. */
function overHair(p, lift, offSkin) {
  const d = unit(sub(p, C)), r = raycast(C, d);
  if (Number.isFinite(r)) {
    const s0 = add(C, mul(d, r)), m = hairMask(s0);
    if (m > -0.004) {
      const t = clamp((Math.acos(clamp(dot(d, TIE), -1, 1)) - PHI0) / (PHI_MAX - PHI0), 0, 1);
      return add(C, mul(d, r + capThickness({ d, t, m }) + lift));
    }
  }
  return keepOff(p, offSkin, 0.06);
}
for (const side of [-1, 1]) {
  // two layers: long strands from the parting over each temple and down past her jaw, and shorter ones under them from
  // her temple's hairline to her cheekbone, so no skin shows between them
  const layers = [
    { count: 7, lift: 0.0085, roots: (q) => [0.006, 1.676 + 0.016 * q, 0.004 - 0.040 * q], guide: (q) => [
      [0.036 + 0.006 * q, 1.668 - 0.002 * q, 0.006 - 0.030 * q], [0.058 + 0.006 * q, 1.632 - 0.004 * q, -0.008 - 0.024 * q],
      [0.069 + 0.004 * q, 1.585 - 0.006 * q, -0.020 - 0.022 * q], [0.066 + 0.005 * q, 1.525 - 0.010 * q, -0.030 - 0.016 * q],
      [0.060 + 0.008 * q, 1.478 - 0.012 * q, -0.040 - 0.010 * q], [0.058 + 0.010 * q, 1.446 - 0.016 * q, -0.046 - 0.008 * q]] },
    { count: 4, lift: 0.0068, roots: (q) => [0.040 + 0.016 * q, 1.648 - 0.022 * q, -0.004 - 0.026 * q], guide: (q) => [
      [0.060 + 0.004 * q, 1.615 - 0.008 * q, -0.016 - 0.020 * q], [0.066 + 0.003 * q, 1.565 - 0.010 * q, -0.028 - 0.016 * q],
      [0.064 + 0.004 * q, 1.520 - 0.010 * q, -0.036 - 0.010 * q]] },
  ];
  for (const [li, layer] of layers.entries()) for (let c = 0; c < layer.count; c++) {
    const q = c / (layer.count - 1), j = () => (rnd() - 0.5);
    const lines = [layer.roots(q), ...layer.guide(q)].map((p) => [side * (p[0] + 0.002 * j()), p[1] + 0.002 * j(), p[2] + 0.002 * j()]);
    const SEG = li === 0 ? 34 : 20, pts = [], across = [], nrm = [], widths = [];
    for (let k = 0; k <= SEG; k++) {
      const s = k / SEG, raw = catmull(lines, s);
      const p = overHair(raw, 0.0012 + (layer.lift + 0.0012 * c) * smoothstep(0, 0.3, s), 0.006 + 0.010 * smoothstep(0.15, 0.45, s) * (1 - 0.4 * smoothstep(0.7, 1, s)) + 0.003 * q + (li === 0 ? 0.003 : 0));
      const near = nearest(p, 0.06);
      pts.push(p); nrm.push(near ? near.n : unit(sub(p, C)));
    }
    // smooth what the lift and the stand-off bent
    for (let pass = 0; pass < 2; pass++) for (let k = 1; k < SEG; k++) pts[k] = lerp3(pts[k], lerp3(pts[k - 1], pts[k + 1], 0.5), 0.4);
    for (let k = 0; k <= SEG; k++) {
      const t = unit(sub(pts[Math.min(SEG, k + 1)], pts[Math.max(0, k - 1)]));
      across.push(unit(cross(nrm[k], t)));
      const s = k / SEG; widths.push((li === 0 ? 0.030 : 0.024) * (0.85 + 0.3 * rnd()) * (1 - 0.65 * smoothstep(0.65, 1, s)) * (0.55 + 0.45 * smoothstep(0, 0.12, s)));
    }
    const wts = (s) => weightsNear(capPoint(pts[Math.round(s * SEG)]));
    card(pts, across, widths, nrm, (c + li + (side > 0 ? 1 : 3)) % 4, (s) => 1.02 + 0.08 * smoothstep(0, 0.25, s), wts);
    // and a second card across the first, facing out from her, so a lock has width from the front as well as the side:
    // a strand falling past her cheek is a band of hair, not a sheet seen edge on. It starts below the parting (on her
    // head the first card lies flat on the cap, and a card standing up there would be a fin)
    const k0 = Math.round(SEG * (li === 0 ? 0.22 : 0.05)), k1 = Math.round(SEG * 0.86), sub2 = (a) => a.slice(k0, k1 + 1);
    const outward = across.map((a, k) => { const t = unit(sub(pts[Math.min(SEG, k + 1)], pts[Math.max(0, k - 1)])); return unit(cross(t, a)); });
    card(sub2(pts), sub2(outward), sub2(widths).map((w, k) => w * 0.62 * smoothstep(0, 4, k)), sub2(nrm), (c + li + 2) % 4, (s) => 1.04 + 0.06 * s, (s) => wts((k0 + s * (k1 - k0)) / SEG), k0 / SEG, k1 / SEG);
  }
}
end('curtain');

// --------------------------------------------------------------------------------------------------------------------
// THE TEXTURE: strands made here, deterministic

const W = TEX, H = TEX, img = new Uint8ClampedArray(W * H * 4);
const trnd = mulberry32(7);
const PAL = { dark: [0.24, 0.10, 0.05], mid: [0.45, 0.20, 0.10], light: [0.63, 0.31, 0.16], glint: [0.80, 0.50, 0.30] };
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function strandColour(k) {
  const t = k;
  return t < 0.35 ? mixc(PAL.dark, PAL.mid, t / 0.35) : t < 0.8 ? mixc(PAL.mid, PAL.light, (t - 0.35) / 0.45) : mixc(PAL.light, PAL.glint, (t - 0.8) / 0.2);
}
// the cap: opaque, tiling across; columns of strands of their own brightness, each wandering a little
{
  const top = Math.round(CAP_V[0] * H) - 2, bottom = Math.round(CAP_V[1] * H) + 2, cols = new Float32Array(W);
  // a 1D noise across: a few octaves of random values, wrapped so it tiles
  for (const [period, amp] of [[256, 0.32], [64, 0.24], [16, 0.22], [4, 0.14], [2, 0.08]]) {
    const n = W / period, vals = Array.from({ length: n }, () => trnd());
    for (let x = 0; x < W; x++) { const f = x / period, i = Math.floor(f) % n, t = f - Math.floor(f), s = t * t * (3 - 2 * t); cols[x] += amp * (vals[i] + (vals[(i + 1) % n] - vals[i]) * s); }
  }
  for (let y = Math.max(0, top); y < Math.min(H, bottom); y++) {
    const along = (y - top) / (bottom - top);
    for (let x = 0; x < W; x++) {
      const wob = Math.round(2 * Math.sin(y / 37 + cols[(x * 7) % W] * 9));
      const k = clamp(cols[(x + wob + W) % W] * 0.95 + 0.05 * Math.sin(along * 40 + x), 0, 1);
      const c = strandColour(clamp(0.15 + 0.85 * k, 0, 1));
      const o = (y * W + x) * 4; img[o] = c[0] * 255; img[o + 1] = c[1] * 255; img[o + 2] = c[2] * 255; img[o + 3] = 255;
    }
  }
}
// the shells: loose strands with alpha, tiling across (they wrap at the image's edge) and running the full length, in
// pieces of their own lengths, so the alpha test leaves a scatter of strands and no stripes
{
  const top = Math.round(SHELL_V[0] * H) - 2, bottom = Math.round(SHELL_V[1] * H) + 2, hgt = bottom - top;
  const alpha = new Float32Array(W * hgt), colour = new Float32Array(W * hgt * 3);
  for (let s = 0; s < 2600; s++) {
    const xs = trnd() * W, y0 = trnd() * hgt, length = hgt * (0.12 + 0.4 * trnd()), widthPx = 0.9 + 1.2 * trnd(), bright = trnd(), phase = trnd() * 6.28, amp = 0.5 + 2 * trnd();
    for (let yy = 0; yy < length; yy++) {
      const y = Math.floor(y0 + yy) % hgt, t = yy / length, x = xs + amp * Math.sin(t * 4 + phase);
      const ends = smoothstep(0, 0.15, t) * (1 - smoothstep(0.8, 1, t));
      for (let xx = Math.floor(x - widthPx - 1); xx <= Math.ceil(x + widthPx + 1); xx++) {
        const cover = clamp(widthPx + 0.5 - Math.abs(xx + 0.5 - x), 0, 1) * ends;
        if (cover <= 0) continue;
        const xw = ((xx % W) + W) % W, i = y * W + xw, a = alpha[i], na = a + cover * (1 - a);
        const c = strandColour(clamp(0.25 + 0.75 * bright, 0, 1));
        for (let k = 0; k < 3; k++) colour[i * 3 + k] = (colour[i * 3 + k] * a + c[k] * cover * (1 - a)) / Math.max(na, 1e-6);
        alpha[i] = na;
      }
    }
  }
  for (let y = 0; y < hgt; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = ((top + y) * W + x) * 4, a = alpha[i], c = a > 0.01 ? [colour[i * 3], colour[i * 3 + 1], colour[i * 3 + 2]] : PAL.mid;
    if (top + y < 0 || top + y >= H) continue;
    img[o] = c[0] * 255; img[o + 1] = c[1] * 255; img[o + 2] = c[2] * 255; img[o + 3] = clamp(a * 1.15, 0, 1) * 255;
  }
}
// the cards: strands with alpha, root at the top of each card's cell, tips tapering toward the bottom
{
  const top = Math.round(CARD_V[0] * H), bottom = Math.round(CARD_V[1] * H), cellW = W / 4;
  const alpha = new Float32Array(W * H), colour = new Float32Array(W * H * 3);
  for (let v = 0; v < 4; v++) {
    const x0 = v * cellW, x1 = x0 + cellW, STRANDS = 150 + 30 * v;
    for (let s = 0; s < STRANDS; s++) {
      // denser in the middle of the card, sparser at its edges
      const r = trnd(), xr = 0.5 + (r - 0.5) * (0.35 + 0.65 * trnd()), xs = x0 + 4 + xr * (cellW - 8);
      const length = 0.62 + 0.38 * trnd(), widthPx = 1.1 + 1.6 * trnd(), bright = trnd(), phase = trnd() * 6.28, amp = 1 + 3 * trnd();
      const ys = top + 2, ye = top + (bottom - top - 4) * length;
      for (let y = Math.floor(ys); y < ye; y++) {
        const t = (y - ys) / (ye - ys), x = xs + amp * Math.sin(t * 5 + phase) + (xr - 0.5) * 6 * t;
        const tipFade = 1 - smoothstep(0.7, 1, t), w = widthPx * (1 - 0.6 * t);
        for (let xx = Math.floor(x - w - 1); xx <= Math.ceil(x + w + 1); xx++) {
          if (xx < x0 || xx >= x1) continue;
          const cover = clamp(w + 0.5 - Math.abs(xx + 0.5 - x), 0, 1) * tipFade;
          if (cover <= 0) continue;
          const i = y * W + xx, a = alpha[i], na = a + cover * (1 - a);
          const c = strandColour(clamp(0.32 + 0.66 * bright + 0.08 * Math.sin(t * 9 + phase), 0, 1));
          for (let k = 0; k < 3; k++) colour[i * 3 + k] = (colour[i * 3 + k] * a + c[k] * cover * (1 - a)) / Math.max(na, 1e-6);
          alpha[i] = na;
        }
      }
    }
  }
  for (let y = top; y < bottom; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = i * 4, a = alpha[i];
    // under a strand's alpha the colour is the strand's; elsewhere the cell's average, so mipmaps never fringe dark
    const c = a > 0.01 ? [colour[i * 3], colour[i * 3 + 1], colour[i * 3 + 2]] : PAL.mid;
    img[o] = c[0] * 255; img[o + 1] = c[1] * 255; img[o + 2] = c[2] * 255; img[o + 3] = clamp(a * 1.25, 0, 1) * 255;
  }
}
const png = await sharp(Buffer.from(img.buffer), { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9, palette: false }).toBuffer();
// stored as WebP (EXT_texture_webp: three reads it, every phone the game runs on decodes it), alpha kept exact enough for
// the alpha test: a quarter of the PNG's bytes
const webp = await sharp(Buffer.from(img.buffer), { raw: { width: W, height: H, channels: 4 } }).webp({ quality: 88, alphaQuality: 100, effort: 6 }).toBuffer();

// --------------------------------------------------------------------------------------------------------------------
// THE FILE: her skeleton (the body file's own joints, in their order), the hair mesh in her geometry units

// only the vertices a triangle uses (the cap's grid runs past her hairline, and those past it are left out)
{
  const used = new Int32Array(out.pos.length / 3).fill(-1); let n = 0;
  for (const v of out.index) if (used[v] < 0) used[v] = n++;
  const pick = (arr, size) => { const r = new Array(n * size); for (let v = 0; v < used.length; v++) if (used[v] >= 0) for (let k = 0; k < size; k++) r[used[v] * size + k] = arr[v * size + k]; return r; };
  out.pos = pick(out.pos, 3); out.nrm = pick(out.nrm, 3); out.uv = pick(out.uv, 2); out.col = pick(out.col, 4); out.joints = pick(out.joints, 4); out.weights = pick(out.weights, 4);
  out.index = out.index.map((v) => used[v]);
}
const geomPos = new Float32Array(out.pos.length);
for (let i = 0; i < out.pos.length; i += 3) for (let k = 0; k < 3; k++) geomPos[i + k] = (out.pos[i + k] - REST_OFFSET[k]) / REST_SCALE;
for (const m of doc.getRoot().listMeshes()) m.dispose();
for (const t of doc.getRoot().listTextures()) t.dispose();
for (const m of doc.getRoot().listMaterials()) m.dispose();
const buffer = doc.getRoot().listBuffers()[0];
const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
const texture = doc.createTexture('sarah-hair').setImage(new Uint8Array(webp)).setMimeType('image/webp');
doc.createExtension(EXTTextureWebP).setRequired(true);
const material = doc.createMaterial('sarahHair').setBaseColorTexture(texture).setRoughnessFactor(0.62).setMetallicFactor(0)
  .setAlphaMode('MASK').setAlphaCutoff(0.42).setDoubleSided(true);
const prim = doc.createPrimitive()
  .setAttribute('POSITION', acc('VEC3', geomPos))
  .setAttribute('NORMAL', acc('VEC3', Float32Array.from(out.nrm)))
  .setAttribute('TEXCOORD_0', acc('VEC2', Float32Array.from(out.uv)))
  .setAttribute('COLOR_0', acc('VEC4', Float32Array.from(out.col)))
  .setAttribute('JOINTS_0', acc('VEC4', Uint16Array.from(out.joints)))
  .setAttribute('WEIGHTS_0', acc('VEC4', Float32Array.from(out.weights)))
  .setIndices(acc('SCALAR', out.pos.length / 3 <= 65535 ? Uint16Array.from(out.index) : Uint32Array.from(out.index)))
  .setMaterial(material);
const hairMesh = doc.createMesh('sarahHair').addPrimitive(prim);
hairMesh.setExtras({ sarahHair: { version: 1, parts, vertices: out.pos.length / 3, triangles: out.index.length / 3, texture: TEX } });
const node = doc.getRoot().listNodes().find((n) => n.getSkin());
node.setMesh(hairMesh).setName('sarahHair');
await doc.transform(prune({ keepAttributes: false, keepLeaves: true }));
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(TARGET, doc);
if (DUMP) writeFileSync(DUMP, png);
const kb = (statSync(TARGET).size / 1024).toFixed(0);
console.log(`${TARGET}: ${kb} KB · ${out.pos.length / 3} vertices · ${out.index.length / 3} triangles · texture ${TEX}² (WebP ${(webp.length / 1024).toFixed(0)} KB; PNG would be ${(png.length / 1024).toFixed(0)} KB)`);
for (const [name, p] of Object.entries(parts)) console.log(`  ${name}: ${p.vertices} vertices, ${p.triangles} triangles`);
console.log(`  tie on her scalp at ${tieOnScalp.map((x) => x.toFixed(3)).join(', ')}; ponytail ends at ${axis[LENGTH_SAMPLES].map((x) => x.toFixed(3)).join(', ')}`);
