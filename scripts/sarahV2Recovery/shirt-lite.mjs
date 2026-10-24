/**
 * THE LIGHT SPANDEX TEE (Joshua, 2026-10-23: "is there a way to use that shirt ChatGPT used, but then basically
 * compress it/make it a lot less vertices and try and optimize it for speed, size, and quality?").
 *
 * `assets-archive/models/sarah-v2-spandex-high.gltf` is the modelled spandex tee fitted at five belly sizes: 166,332
 * vertices, 79 shapes, 81 MB. Its neckline is the round scoop and its hem the curve of his reference picture. This
 * writes `public/models/sarah-v2-spandex-lite.glb`, the same tee with a fraction of the vertices:
 *
 * - SIMPLIFIED ONCE, FOR EVERY SIZE. meshoptimizer collapses edges while measuring the error not only on the tee as
 *   stored (her 100%) but on the tee at 0%, 50%, 150% and 200% and at two of the navel's in-between fits, so
 *   triangles stay small where any size needs them (her bump at 200%, the navel) and grow where the cloth is flat at
 *   every size. Edges are collapsed only along the neckline, the sleeves and the hem, never across them.
 * - HER NAVEL'S CLOTH IS KEPT WHOLE: within NAVEL_KEEP of where her navel is at every fine-fit size, nothing collapses,
 *   so the fine fit's one small bump over her outie is the original's (tests/sarahV2FittedShirtNavel.test.ts holds the
 *   light tee to the same 0.2 mm as the originals).
 * - EVERY KEPT VERTEX IS AN ORIGINAL ONE. Its position, UV, bone weights and every one of its belly shapes are copied,
 *   not recomputed, so each fit is the approved fit at that point.
 * - THE BUST IS LAID AGAIN for every breast shape (shirt-bust.mjs), so the SIZE and shape sliders no longer crease it,
 *   and each belly-size fit takes back what that changed at its own size: with SIZE untouched, every fit is as it was.
 * - STORED SMALL. Shape offsets as 16-bit normalized integers (a step of 0.03 mm), the textures at 1024 px, and
 *   everything meshopt-compressed: the room's loader already decodes all of it.
 *
 * The script measures what it gave up: for a sample of the original vertices, how far each lies from the light tee's
 * surface at 0%, 100% and 200%, and refuses to write if that is ever more than MAX_ERROR_MM.
 *
 *   node scripts/sarahV2Recovery/shirt-lite.mjs [--triangles 32000] [--out public/models/sarah-v2-spandex-lite.glb]
 *        [--bust off] (the stored breast shapes, for comparison)   [--navel-keep 0.008]
 */
import { statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { compose, layBust } from './shirt-bust.mjs';

const option = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const SOURCE = option('source', 'assets-archive/models/sarah-v2-spandex-high.gltf');
const TARGET = option('out', 'public/models/sarah-v2-spandex-lite.glb');
const TRIANGLES = Number(option('triangles', 32000));
const TEXTURE_PX = Number(option('texture', 1024));
/** The furthest an original vertex may lie from the light tee, at any of the measured sizes. */
const MAX_ERROR_MM = Number(option('max-error', 1.5));
/** Base positions and UVs rounded to a power-of-two grid (a float32 with zero low bits compresses far better). */
const POSITION_GRID = 2 ** 17, UV_GRID = 2 ** 16, NORMAL_GRID = 2 ** 12;

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/** Lay the breast shapes again (shirt-bust.mjs); `--bust off` keeps the stored ones, for comparison. */
const BUST = option('bust', 'on') !== 'off';
const BODY = option('body', 'public/models/sarah-v2-body-slim.glb');
/** The most `shape:breastGrowMore` is ever weighted: SIZE +100% (breastGrowUnits 1.652, less the 1 Grow holds). */
const BREAST_GROW_MORE_MAX = 0.652;
/** How near her navel, at any fine-fit size, the cloth is kept whole (local units, about 7 mm). */
const NAVEL_KEEP = Number(option('navel-keep', 0.008));
const BODY_DOC = await io.read(BODY);

const doc = await io.read(SOURCE);
const mesh = doc.getRoot().listMeshes()[0], prim = mesh.listPrimitives()[0];
const extras = mesh.getExtras(), names = extras.targetNames, meta = extras.recoveredShirt;
const targets = prim.listTargets();
const P = prim.getAttribute('POSITION').getArray(), N = prim.getAttribute('NORMAL').getArray(), UV = prim.getAttribute('TEXCOORD_0').getArray();
const sourceIndex = Uint32Array.from(prim.getIndices().getArray());
const count = P.length / 3, delta = (name) => targets[names.indexOf(name)].getAttribute('POSITION').getArray();

/**
 * The tee at a belly size, as the room draws it: the native shapes at that size's weights less the stored size's
 * (baselineMode reference100), plus that size's own fit fields. Between two fits each is blended, as the room does.
 */
function weightsAt(bump) {
  const keys = meta.fitBumps, bw = meta.baselineWeightsByBump;
  const hi = keys.findIndex((k) => k >= bump), b = keys[Math.max(0, hi)], a = keys[Math.max(0, hi - 1)];
  const t = b === a ? 1 : (bump - a) / (b - a);
  const w = new Map();
  const add = (name, v) => { if (v && names.includes(name)) w.set(name, (w.get(name) ?? 0) + v); };
  for (const name of new Set([...Object.keys(bw[a]), ...Object.keys(bw[b]), ...Object.keys(bw[100])])) add(name, (1 - t) * (bw[a][name] ?? 0) + t * (bw[b][name] ?? 0) - (bw[100][name] ?? 0));
  add(`shape:fitBelly${a}`, 1 - t); add(`shape:fitBelly${b}`, t);
  const fine = meta.fineFitKeys ?? [];
  const fhi = fine.findIndex((k) => k >= bump), fb = fine[Math.max(0, fhi)], fa = fine[Math.max(0, fhi - 1)];
  const ft = fb === fa ? 1 : (bump - fa) / (fb - fa);
  add(`shape:fineFit${fa}`, 1 - ft); add(`shape:fineFit${fb}`, ft);
  return w;
}
function shapeAt(bump, kept = null) {
  const out = Float32Array.from(P);
  for (const [name, w] of weightsAt(bump)) { const d = delta(name); for (let i = 0; i < out.length; i++) out[i] += w * d[i]; }
  return kept ? pick(out, kept, 3) : out;
}
const pick = (array, kept, size) => { const out = new array.constructor(kept.length * size); kept.forEach((v, i) => { for (let k = 0; k < size; k++) out[i * size + k] = array[v * size + k]; }); return out; };
const floats = (accessor) => {
  const a = accessor.getArray();
  if (!accessor.getNormalized()) return Float32Array.from(a);
  const scale = a instanceof Int16Array ? 32767 : a instanceof Int8Array ? 127 : a instanceof Uint16Array ? 65535 : 255;
  return Float32Array.from(a, (x) => Math.max(-1, x / scale));
};

/**
 * Her skin at the tee's reference (the approved body at 100%, the weights the tee was stored at), every shape's offset
 * on it, and the breast shapes laid again over it. Grow is laid at the most the slider adds over the reference (to
 * 1), GrowMore on top of that at its most (+100% SIZE), every other shape at 1.
 */
function layBustOn(liteP, liteIndex, offsets) {
  const bodyDoc = BODY_DOC, bodyMesh = bodyDoc.getRoot().listMeshes()[0], skinPrim = bodyMesh.listPrimitives()[0];
  const bodyNames = bodyMesh.getExtras().targetNames, bodyTargets = skinPrim.listTargets();
  const skinOffsets = new Map(bodyNames.map((name, k) => [name, floats(bodyTargets[k].getAttribute('POSITION'))]));
  const reference = new Map(Object.entries(meta.baselineWeightsByBump[100]).filter(([, w]) => Math.abs(w) > 1e-4));
  const skinP = compose(floats(skinPrim.getAttribute('POSITION')), skinOffsets, reference);
  const skinIndex = Uint32Array.from(skinPrim.getIndices().getArray());
  let lo = Infinity, hi = -Infinity; for (let i = 1; i < liteP.length; i += 3) { lo = Math.min(lo, liteP[i]); hi = Math.max(hi, liteP[i]); }
  const keep = (t) => { const y = (skinP[skinIndex[t] * 3 + 1] + skinP[skinIndex[t + 1] * 3 + 1] + skinP[skinIndex[t + 2] * 3 + 1]) / 3; return y > lo - 0.05 && y < hi + 0.05; };
  const growTo1 = 1 - (meta.baselineWeightsByBump[100].breastGrow ?? 0);
  const plan = [
    { name: 'breastGrow', weight: growTo1, context: new Map() },
    { name: 'shape:breastGrowMore', weight: BREAST_GROW_MORE_MAX, context: new Map([['breastGrow', growTo1]]) },
    ...['breast100', 'breastBob', 'shape:breastSpacingIn', 'shape:breastSpacingOut', 'shape:breastWidth', 'shape:breastHeight', 'shape:breastDepth', 'shape:breastPosition', 'shape:breastDroop', 'shape:breastUpper', 'shape:breastLower'].map((name) => ({ name, weight: 1, context: new Map() })),
  ].filter((p) => offsets.has(p.name) && skinOffsets.has(p.name));
  const result = layBust({ P: liteP, index: liteIndex, offsets }, { P: skinP, index: skinIndex, offsets: skinOffsets, keep }, plan);
  for (const [name, { report: r }] of result) console.log(`  bust ${name}: ${r.free} points free; into her skin before ${r.intoBefore.n} (deepest ${(r.intoBefore.most * 1000).toFixed(1)} mm), after ${r.intoAfter.n} (${(r.intoAfter.most * 1000).toFixed(1)} mm)`);
  return result;
}

/**
 * HER NAVEL KEEPS EVERY POINT OF ITS CLOTH. The tee's navel is one small bump the fine fit carries down her belly with
 * hers (shirt-fine-fit.mjs), a few tenths of a millimetre over her outie; collapsed with the cloth round it, her outie
 * came within 0.2 mm of the surface at 120%. So the cloth within NAVEL_KEEP of where her navel is, at every fine-fit
 * size, is locked against collapsing: there the light tee is the original triangle for triangle.
 */
async function navelLockAsync() {
  const bodyMesh = BODY_DOC.getRoot().listMeshes()[0], skinPrim = bodyMesh.listPrimitives()[0];
  const bodyNames = bodyMesh.getExtras().targetNames, bodyTargets = skinPrim.listTargets(), B0 = floats(skinPrim.getAttribute('POSITION'));
  const D = bodyTargets.map((t) => floats(t.getAttribute('POSITION'))), flat = D[bodyNames.indexOf('navelFlat')];
  let navel = 0, most = 0; for (let i = 0; i < flat.length / 3; i++) { const m = Math.hypot(flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]); if (m > most) { most = m; navel = i; } }
  const lock = new Uint8Array(count);
  for (const b of meta.fineFitKeys ?? []) {
    // her own weights at that size, as the tee recorded them at its fits, blended between
    const keys = meta.fitBumps, bw = meta.baselineWeightsByBump, hi = Math.max(1, keys.findIndex((k) => k >= b)), k0 = keys[hi - 1], k1 = keys[hi], t = (b - k0) / (k1 - k0);
    const w = Object.fromEntries([...new Set([...Object.keys(bw[k0]), ...Object.keys(bw[k1])])].map((n) => [n, (1 - t) * (bw[k0][n] ?? 0) + t * (bw[k1][n] ?? 0)]));
    const at = [0, 1, 2].map((k) => B0[navel * 3 + k] + bodyNames.reduce((sum, name, t) => sum + (w[name] ?? 0) * D[t][navel * 3 + k], 0));
    const S = shapeAt(b);
    for (let v = 0; v < count; v++) if (Math.hypot(S[v * 3] - at[0], S[v * 3 + 1] - at[1], S[v * 3 + 2] - at[2]) < NAVEL_KEEP) lock[v] = 1;
  }
  return lock;
}
const NAVEL_LOCK = await navelLockAsync();
function navelLock() { let n = 0; for (const x of NAVEL_LOCK) n += x; console.log(`  her navel's cloth kept whole: ${n} points`); return NAVEL_LOCK; }

// --- simplify, measuring every size --------------------------------------------------------------------------------
const SIZES = [0, 50, 150, 200, 125, 175];
const shapes = SIZES.map((b) => shapeAt(b));
const scale = MeshoptSimplifier.getScale(P, 3);
const STRIDE = SIZES.length * 3 + 3 + 2;
const attributes = new Float32Array(count * STRIDE);
for (let v = 0; v < count; v++) {
  let o = v * STRIDE;
  for (const s of shapes) for (let k = 0; k < 3; k++) attributes[o++] = s[v * 3 + k] / scale;
  for (let k = 0; k < 3; k++) attributes[o++] = N[v * 3 + k];
  for (let k = 0; k < 2; k++) attributes[o++] = UV[v * 2 + k];
}
const weights = [...SIZES.flatMap(() => [1, 1, 1]), 0.4, 0.4, 0.4, 0.5, 0.5];
const lock = navelLock();
const [simplified, error] = MeshoptSimplifier.simplifyWithAttributes(sourceIndex, P, 3, attributes, STRIDE, weights, lock, Math.floor(TRIANGLES) * 3, 1, ['Regularize']);
// vertex order and triangle order for the GPU cache and for compression
const [remap, unique] = MeshoptEncoder.reorderMesh(simplified, true, true);
const kept = new Uint32Array(unique);
for (let v = 0; v < remap.length; v++) if (remap[v] !== 0xffffffff) kept[remap[v]] = v;
const index = simplified; // reorderMesh rewrote it in place to the new vertex numbers
console.log(`simplified ${sourceIndex.length / 3} -> ${index.length / 3} triangles, ${count} -> ${unique} vertices (error ${(error * scale * 1000).toFixed(2)} mm)`);

// --- what it gave up, measured on the original vertices at three sizes ----------------------------------------------
/** Squared distance from p to triangle abc (Ericson's closest point), with no allocation. */
function triangleD2(px, py, pz, X, a, b, c) {
  const ax = X[a], ay = X[a + 1], az = X[a + 2];
  const abx = X[b] - ax, aby = X[b + 1] - ay, abz = X[b + 2] - az, acx = X[c] - ax, acy = X[c + 1] - ay, acz = X[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let u = 1, v = 0, w = 0;
  if (d1 <= 0 && d2 <= 0) { u = 1; } else {
    const bpx = px - X[b], bpy = py - X[b + 1], bpz = pz - X[b + 2], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = px - X[c], cpy = py - X[c + 1], cpz = pz - X[c + 2], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; }
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) { v = d1 / (d1 - d3); u = 1 - v; }
    else if (d6 >= 0 && d5 <= d6) { u = 0; w = 1; }
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) { w = d2 / (d2 - d6); u = 1 - w; }
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 0; v = 1 - w; }
    else { const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; u = 1 - v - w; }
  }
  const qx = ax + abx * v + acx * w - px, qy = ay + aby * v + acy * w - py, qz = az + abz * v + acz * w - pz;
  return qx * qx + qy * qy + qz * qz;
}
/** How far the original's vertices lie from the light tee's surface, at a size. */
function measure(bump) {
  const full = bump === 100 ? P : shapeAt(bump), lite = pick(full, kept, 3), CELL = 0.01;
  const cells = new Map(), cellKey = (x, y, z) => (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);
  for (let t = 0; t < index.length; t += 3) {
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(lite[index[t] * 3 + k], lite[index[t + 1] * 3 + k], lite[index[t + 2] * 3 + k]) / CELL));
    const hi = [0, 1, 2].map((k) => Math.floor(Math.max(lite[index[t] * 3 + k], lite[index[t + 1] * 3 + k], lite[index[t + 2] * 3 + k]) / CELL));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const k = cellKey(x, y, z); let list = cells.get(k); if (!list) cells.set(k, (list = [])); list.push(t);
    }
  }
  const d = [];
  for (let v = 0; v < count; v += 5) {
    const px = full[v * 3], py = full[v * 3 + 1], pz = full[v * 3 + 2], cx = Math.floor(px / CELL), cy = Math.floor(py / CELL), cz = Math.floor(pz / CELL);
    let best = Infinity;
    for (let r = 1; r <= 4 && best > ((r - 1) * CELL) ** 2; r++) for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
      for (const t of cells.get(cellKey(cx + x, cy + y, cz + z)) ?? []) best = Math.min(best, triangleD2(px, py, pz, lite, index[t] * 3, index[t + 1] * 3, index[t + 2] * 3));
    }
    d.push(Math.sqrt(best) * 1000);
  }
  d.sort((x, y) => x - y);
  return { bump, p50: d[d.length >> 1], p99: d[Math.floor(d.length * 0.99)], max: d[d.length - 1] };
}
const errors = [0, 100, 200].map(measure);
for (const e of errors) console.log(`  at ${e.bump}%: half the cloth within ${e.p50.toFixed(2)} mm, 99% within ${e.p99.toFixed(2)} mm, worst ${e.max.toFixed(2)} mm`);
const worst = Math.max(...errors.map((e) => e.max));
if (worst > MAX_ERROR_MM) throw new Error(`the light tee strays ${worst.toFixed(2)} mm from the original (limit ${MAX_ERROR_MM} mm): raise --triangles`);

// --- the light tee: every kept vertex's own values ------------------------------------------------------------------
const round = (array, grid) => array.map((x) => Math.round(x * grid) / grid);
const normalized16 = (array) => { const q = new Int16Array(array.length); for (let i = 0; i < array.length; i++) q[i] = Math.round(Math.max(-1, Math.min(1, array[i])) * 32767); return q; };
for (const semantic of prim.listSemantics()) {
  const a = prim.getAttribute(semantic);
  if (semantic === '_BODY_TRI' || semantic === '_BODY_BARY') { prim.setAttribute(semantic, null); continue; }
  const size = a.getElementSize();
  let array = pick(a.getArray(), kept, size);
  if (semantic === 'POSITION') array = round(array, POSITION_GRID);
  if (semantic === 'NORMAL') array = round(array, NORMAL_GRID);
  if (semantic === 'TEXCOORD_0') array = round(array, UV_GRID);
  a.setArray(array);
}
// --- the bust, laid again for every breast shape (shirt-bust.mjs) ----------------------------------------------------
const liteOffsets = new Map(names.map((name, k) => [name, pick(targets[k].getAttribute('POSITION').getArray(), kept, 3)]));
const laid = BUST ? layBustOn(pick(P, kept, 3), index, liteOffsets) : new Map();
const redoneAll = new Map([...laid].map(([name, r]) => [name, { offsets: r.offsets, normals: r.normals }]));
// THE FITS STAY THE FITS. Each belly-size fit was made with her breast shapes at that size's weights, so a breast shape
// laid again changes the tee at that size by (its weight there − at 100%) × (new − old); the fit's own field takes the
// difference back, and at every fitted size, with SIZE untouched, the tee is exactly the approved fit again
const liteNormals = (name) => pick(targets[names.indexOf(name)].getAttribute('NORMAL').getArray(), kept, 3);
for (const b of meta.fitBumps) {
  const fit = `shape:fitBelly${b}`, bw = meta.baselineWeightsByBump;
  if (!names.includes(fit)) continue;
  const offsets = Float32Array.from(liteOffsets.get(fit)), normals = liteNormals(fit);
  let moved = false;
  for (const [name, r] of laid) {
    const w = (bw[b][name] ?? 0) - (bw[100][name] ?? 0);
    if (Math.abs(w) < 1e-4) continue;
    const was = liteOffsets.get(name), wasN = liteNormals(name);
    for (let i = 0; i < offsets.length; i++) { offsets[i] += w * (was[i] - r.offsets[i]); normals[i] += w * (wasN[i] - r.normals[i]); }
    moved = true;
  }
  if (moved) redoneAll.set(fit, { offsets, normals });
}

let morphNormalsAsFloats = 0;
for (const [k, t] of targets.entries()) for (const semantic of t.listSemantics()) {
  const a = t.getAttribute(semantic), redone = redoneAll.get(names[k]);
  const array = redone ? (semantic === 'POSITION' ? redone.offsets : redone.normals) : pick(a.getArray(), kept, 3);
  let max = 0; for (const x of array) max = Math.max(max, Math.abs(x));
  // an offset or a change of direction within [-1, 1] as a 16-bit normalized integer; past it, a float on a fine grid
  if (max <= 1) a.setArray(normalized16(array)).setNormalized(true);
  else { a.setArray(round(array, NORMAL_GRID)); morphNormalsAsFloats++; }
}
prim.setIndices(prim.getIndices().setArray(unique <= 65535 ? Uint16Array.from(index) : index));
mesh.setExtras({ ...extras, recoveredShirt: { ...meta, lite: { source: SOURCE.split('/').pop(), sourceVertices: count, sourceTriangles: sourceIndex.length / 3, vertices: unique, triangles: index.length / 3, errorMm: Object.fromEntries(errors.map((e) => [e.bump, { p50: +e.p50.toFixed(3), p99: +e.p99.toFixed(3), max: +e.max.toFixed(3) }])) } } });

// --- textures at TEXTURE_PX ------------------------------------------------------------------------------------------
for (const texture of doc.getRoot().listTextures()) {
  const image = texture.getImage();
  if (!image) continue;
  const resized = await sharp(Buffer.from(image)).resize(TEXTURE_PX, TEXTURE_PX, { fit: 'fill' }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  texture.setImage(new Uint8Array(resized)).setMimeType('image/jpeg');
}

await doc.transform(prune({ keepAttributes: false, keepLeaves: true }));
for (const buffer of doc.getRoot().listBuffers().slice(1)) { for (const parent of buffer.listParents()) if (parent !== doc.getRoot()) parent.setBuffer(doc.getRoot().listBuffers()[0]); buffer.dispose(); }
doc.getRoot().listBuffers()[0].setURI('');
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(TARGET, doc);
const mb = (f) => (statSync(f).size / 1048576).toFixed(2);
console.log(`${TARGET}: ${mb(TARGET)} MB (${unique} vertices, ${index.length / 3} triangles, ${targets.length} shapes${morphNormalsAsFloats ? `, ${morphNormalsAsFloats} shape normals past 1 kept as floats` : ''})`);
