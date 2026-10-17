import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { growClothes } from '../../scripts/growClothes.mjs';
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const [src, out, ...which] = process.argv.slice(2);
const doc = await io.read(src); const t0 = Date.now();
const body = doc.getRoot().listMeshes()[0].listPrimitives()[0];
// growClothes writes the cover bits afresh; keep what an earlier run marked (the low leggings)
const before = body.getAttribute('_CLOTH_COVER')?.getArray().slice() ?? null;
console.log('body verts', body.getAttribute('POSITION').getCount(), 'targets', body.listTargets().length);
await growClothes(doc, { log: (l) => console.log(l), which, paint: false, specs: { shirt: { cut: 'tank', colour: [1, 1, 1], roughness: 0.9, sheet: null }, leggings: { rise: process.env.RISE || 'waist', colour: [1, 1, 1], roughness: 0.9 } } });
if (process.env.RENAME) { const [a, b] = process.env.RENAME.split(':'); doc.getRoot().listMaterials().filter((m) => m.getName() === a).forEach((m) => m.setName(b)); }
{ const A = body.getAttribute('_CLOTH_COVER'); const now = A.getArray(); const renamed = process.env.RENAME === 'leggings:leggingsLow';
  // the low leggings take bit 5 (GARMENTS order in src/sarahlab/sarahLabTool.ts: shirt, leggings, bikini, swimsuit, shirtAthletic, leggingsLow)
  const merged = Uint8Array.from(now, (v, i) => (before ? before[i] : 0) | (renamed ? ((v >> 1) & 1) << 5 : v));
  A.setArray(merged); console.log('cover bits: leggings', merged.filter((v) => v & 2).length, 'leggingsLow', merged.filter((v) => v & 32).length, 'shirt', merged.filter((v) => v & 1).length); }
await io.write(out, doc); console.log('written', out, ((Date.now() - t0) / 1000).toFixed(0), 's');
