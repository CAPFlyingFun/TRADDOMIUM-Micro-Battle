/** Rebuild Sarah Lab's generated shapes and clothes from its shipped body.
 * npm run bake:sarah-clothes
 * Keeps the original body, UVs, skeleton and Claude's repaired bone weights.
 * Decode the corrective bind transform before using metre measurements.
 * Does not read or change any original master; repeatable on its own output.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, dedup, weld, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';
import { pathToFileURL } from 'node:url';
import { rename, rm } from 'node:fs/promises';
import { bellyMorph } from './bellyMorph.mjs';
import { growClothes } from './growClothes.mjs';

export async function recoverSarahBody(doc) {
  const root = doc.getRoot(), mesh = root.listMeshes()[0], skin = root.listSkins()[0];
  if (!mesh || !skin) throw new Error('Sarah needs a mesh and a skin');
  const body = mesh.listPrimitives().find((p) => p.getMaterial()?.getName() === 'Material_0');
  if (!body) throw new Error('Sarah base body Material_0 is missing');
  const ibms = skin.getInverseBindMatrices(), ibm = [];
  ibms.getElement(0, ibm);
  const correction = new Matrix4().fromArray(skin.listJoints()[0].getWorldMatrix())
    .multiply(new Matrix4().fromArray(ibm));
  for (let i = 0; i < skin.listJoints().length; i += 1) {
    ibms.getElement(i, ibm);
    const q = new Matrix4().fromArray(skin.listJoints()[i].getWorldMatrix()).multiply(new Matrix4().fromArray(ibm));
    if (q.elements.some((v, k) => Math.abs(v - correction.elements[k]) > 0.0002)) {
      throw new Error('Bind matrices disagree; refusing an animated or incompatible body');
    }
  }
  await doc.transform(dequantize());
  for (const p of [...mesh.listPrimitives()]) if (p !== body) p.dispose();
  for (const t of [...body.listTargets()]) t.dispose();
  mesh.setWeights([]).setExtras({ ...mesh.getExtras(), targetNames: [] });
  for (const node of root.listNodes()) if (node.getMesh() === mesh) node.setWeights([]);
  const positions = body.getAttribute('POSITION'), point = new Vector3(), v = [];
  for (let i = 0; i < positions.getCount(); i += 1) {
    positions.getElement(i, v); point.fromArray(v).applyMatrix4(correction);
    positions.setElement(i, point.toArray());
  }
  const normals = body.getAttribute('NORMAL');
  for (let i = 0; i < normals.getCount(); i += 1) {
    normals.getElement(i, v); point.fromArray(v).transformDirection(correction);
    normals.setElement(i, point.toArray());
  }
  const undo = correction.clone().invert();
  for (let i = 0; i < ibms.getCount(); i += 1) {
    ibms.getElement(i, ibm);
    ibms.setElement(i, new Matrix4().fromArray(ibm).multiply(undo).elements);
  }
  return body;
}

async function main() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const file = 'public/models/sarah-base.glb', temp = 'public/models/sarah-base.rebake.glb';
  const doc = await io.read(file);
  await recoverSarahBody(doc);
  const log = (s) => console.log(`[bake:sarah-clothes] ${s}`);
  bellyMorph(doc, { log });
  await growClothes(doc, { log });
  await doc.transform(dedup(), weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }), prune());
  try { await io.write(temp, doc); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
  log('rebuilt Sarah Lab; body and final repaired weights retained');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
