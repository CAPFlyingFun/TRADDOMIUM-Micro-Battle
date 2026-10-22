/**
 * THE SLIM BODY (Joshua, 2026-10-21: "how can we save memory and download size for the outfits... go ahead").
 *
 * `assets-archive/models/sarah-v2-body.glb` is the approved body and stays byte for byte as it is. Beside her it carries
 * garments the room no longer draws from it: both rises of leggings and their trims (each replaced by its own fitted
 * file, `sarah-v2-leggings*.glb`) and the grown tee and its trims (the v2 body wears the recovered shirts instead).
 * Every visit downloaded them, about 157,000 vertices with 43 morph targets each, whatever she had on.
 *
 * This writes `public/models/sarah-v2-body-slim.glb`: the same file without those parts. Nothing that is kept changes:
 * her body, the bikini (all of it, cups and design protected), the skeleton, every morph target, every vertex in its
 * order (paint masks and the traced leotard line are per vertex). The script proves it by decoding both files and
 * comparing every kept array, and refuses to write if one differs.
 *
 * One kind of array is stored smaller rather than identically (Joshua, 2026-10-22, after Replit's measurement: the
 * morph NORMALS were 7.4 MB of the file, 43 of them still full floats). A morph normal is a change of direction, so
 * each float one whose every value lies within [-1, 1] is stored as a 16-bit normalized integer, the form the file's
 * other morph normals already take (KHR_mesh_quantization). The check holds those to half a step (1/65534) of the
 * original and every other array to exact equality. One with a value outside [-1, 1] is left as it is.
 *
 *   node scripts/sarahV2Recovery/body-slim.mjs
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { statSync } from 'node:fs';

const SOURCE = 'assets-archive/models/sarah-v2-body.glb';
const TARGET = 'public/models/sarah-v2-body-slim.glb';
/** The parts no outfit on the v2 body draws from this file. */
/** The grid a float morph normal past [-1, 1] is rounded to: 1/1024 (under a tenth of a degree of light direction), far below what light on her can show. */
const GRID = 1024;
const DROP = new Set(['leggings', 'leggingsTrim', 'leggingsLow', 'leggingsLowTrim', 'shirt', 'shirtTrim']);

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/** Every array of every kept primitive, decoded, in order: what must come out unchanged. */
function arrays(doc) {
  const out = [];
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const name = p.getMaterial()?.getName() ?? '';
    if (DROP.has(name)) continue;
    const list = [['index', p.getIndices()?.getArray()]];
    for (const s of p.listSemantics()) list.push([s, p.getAttribute(s).getArray()]);
    p.listTargets().forEach((t, k) => { for (const s of t.listSemantics()) list.push([`target${k}.${s}`, t.getAttribute(s).getArray()]); });
    out.push({ name, list });
  }
  return out;
}

const original = await io.read(SOURCE);
const before = arrays(original);

const doc = await io.read(SOURCE);
let dropped = 0, droppedVerts = 0;
for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
  if (!DROP.has(p.getMaterial()?.getName() ?? '')) continue;
  droppedVerts += p.getAttribute('POSITION').getCount();
  mesh.removePrimitive(p); p.dispose(); dropped += 1;
}
// what only the dropped parts used (their materials, knit textures, accessors) goes with them; nothing else is touched
await doc.transform(prune({ keepAttributes: true, keepIndices: true, keepLeaves: true, keepSolidTextures: true }));

// morph normals stored as 16-bit normalized integers where they fit (see the header)
let quantized = 0, skipped = 0;
const seen = new Set();
for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) for (const t of p.listTargets()) {
  const a = t.getAttribute('NORMAL');
  if (!a || seen.has(a)) continue;
  seen.add(a);
  const x = a.getArray();
  if (!(x instanceof Float32Array)) continue;
  let max = 0;
  for (let n = 0; n < x.length; n++) max = Math.max(max, Math.abs(x[n]));
  // past [-1, 1] (a direction can change by up to 2): still a float, rounded to a fine grid so it compresses like one
  if (max > 1) { for (let n = 0; n < x.length; n++) x[n] = Math.round(x[n] * GRID) / GRID; a.setArray(x); skipped += 1; continue; }
  const q = new Int16Array(x.length);
  for (let n = 0; n < x.length; n++) q[n] = Math.round(x[n] * 32767);
  a.setArray(q).setNormalized(true);
  quantized += 1;
}

// the check: decode what will be written and compare every kept array with the approved file's
const bytes = await io.writeBinary(doc);
const after = arrays(await io.readBinary(bytes));
if (after.length !== before.length) throw new Error(`kept ${after.length} primitives, expected ${before.length}`);
before.forEach((b, i) => {
  const a = after[i];
  if (a.name !== b.name || a.list.length !== b.list.length) throw new Error(`primitive ${i} (${b.name}) changed shape`);
  b.list.forEach(([key, x], j) => {
    const [k2, y] = a.list[j];
    if (k2 !== key || x?.length !== y?.length) throw new Error(`${b.name} ${key} changed length`);
    // a morph normal stored as 16-bit: within half a step of the original
    if (/^target\d+\.NORMAL$/.test(key) && x instanceof Float32Array && y instanceof Int16Array) {
      for (let n = 0; n < x.length; n++) if (Math.abs(y[n] / 32767 - x[n]) > 0.5 / 32767 + 1e-7) throw new Error(`${b.name} ${key}[${n}] moved: ${x[n]} vs ${y[n] / 32767}`);
      return;
    }
    // ...or kept a float on the fine grid: within half a step of it
    if (/^target\d+\.NORMAL$/.test(key) && x instanceof Float32Array && y instanceof Float32Array) {
      for (let n = 0; n < x.length; n++) if (Math.abs(y[n] - x[n]) > 0.5 / GRID + 1e-7) throw new Error(`${b.name} ${key}[${n}] moved: ${x[n]} vs ${y[n]}`);
      return;
    }
    if (x?.constructor !== y?.constructor) throw new Error(`${b.name} ${key} changed type`);
    for (let n = 0; n < (x?.length ?? 0); n++) if (x[n] !== y[n]) throw new Error(`${b.name} ${key}[${n}] differs: ${x[n]} vs ${y[n]}`);
  });
});

await io.write(TARGET, doc);
const mb = (f) => (statSync(f).size / 1048576).toFixed(1);
console.log(`dropped ${dropped} primitives (${droppedVerts} vertices); kept ${before.length}, every array identical`
  + `${quantized ? ` but ${quantized} float morph normals now 16-bit (within half a step)` : ''}${skipped ? `; ${skipped} float morph normals rounded to 1/${GRID} (values past 1)` : ''}`);
console.log(`${SOURCE} ${mb(SOURCE)} MB -> ${TARGET} ${mb(TARGET)} MB`);
