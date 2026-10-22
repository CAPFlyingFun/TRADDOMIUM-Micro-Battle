/**
 * THE SLIM BODY (Joshua, 2026-10-21: "how can we save memory and download size for the outfits... go ahead").
 *
 * `public/models/sarah-v2-body.glb` is the approved body and stays byte for byte as it is. Beside her it carries
 * garments the room no longer draws from it: both rises of leggings and their trims (each replaced by its own fitted
 * file, `sarah-v2-leggings*.glb`) and the grown tee and its trims (the v2 body wears the recovered shirts instead).
 * Every visit downloaded them, about 157,000 vertices with 43 morph targets each, whatever she had on.
 *
 * This writes `public/models/sarah-v2-body-slim.glb`: the same file without those parts. Nothing that is kept changes:
 * her body, the bikini (all of it, cups and design protected), the skeleton, every morph target, every vertex in its
 * order (paint masks and the traced leotard line are per vertex). The script proves it by decoding both files and
 * comparing every kept array, and refuses to write if one differs.
 *
 *   node scripts/sarahV2Recovery/body-slim.mjs
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { statSync } from 'node:fs';

const SOURCE = 'public/models/sarah-v2-body.glb';
const TARGET = 'public/models/sarah-v2-body-slim.glb';
/** The parts no outfit on the v2 body draws from this file. */
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

// the check: decode what will be written and compare every kept array with the approved file's
const bytes = await io.writeBinary(doc);
const after = arrays(await io.readBinary(bytes));
if (after.length !== before.length) throw new Error(`kept ${after.length} primitives, expected ${before.length}`);
before.forEach((b, i) => {
  const a = after[i];
  if (a.name !== b.name || a.list.length !== b.list.length) throw new Error(`primitive ${i} (${b.name}) changed shape`);
  b.list.forEach(([key, x], j) => {
    const [k2, y] = a.list[j];
    if (k2 !== key || x?.length !== y?.length || x?.constructor !== y?.constructor) throw new Error(`${b.name} ${key} changed type or length`);
    for (let n = 0; n < (x?.length ?? 0); n++) if (x[n] !== y[n]) throw new Error(`${b.name} ${key}[${n}] differs: ${x[n]} vs ${y[n]}`);
  });
});

await io.write(TARGET, doc);
const mb = (f) => (statSync(f).size / 1048576).toFixed(1);
console.log(`dropped ${dropped} primitives (${droppedVerts} vertices); kept ${before.length}, every array identical`);
console.log(`${SOURCE} ${mb(SOURCE)} MB -> ${TARGET} ${mb(TARGET)} MB`);
