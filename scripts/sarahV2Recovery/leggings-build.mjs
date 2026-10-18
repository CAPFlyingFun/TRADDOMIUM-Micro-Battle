/** Recover only the approved native high leggings correction; retain the native rig and shapes.
 * node scripts/sarahV2Recovery/leggings-build.mjs [snapshot-directory] [output.glb]
 * Snapshots come from the frozen preview's exportFit(), after smoothHighLeggings().
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

export const LEGGINGS_STEPS = [0, 50, 100, 150, 200];
export const LEGGINGS_TARGETS = LEGGINGS_STEPS.map(step => `shape:recoveryLeggings${step}`);
const materials = new Set(['leggings', 'leggingsTrim']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Match original primitive IDs, then check topology rather than trusting material order. */
export function matchNativePart(snapshot, primitive, sourceIndex) {
  const name = primitive.getMaterial()?.getName();
  const candidates = snapshot.native?.filter(part => part.material === name && part.positions.length === primitive.getAttribute('POSITION').getCount() * 3) ?? [];
  const part = candidates.find(part => part.name === `Mesh_0_${sourceIndex}`) ?? (candidates.length === 1 ? candidates[0] : null);
  if (!part) throw Error(`Missing/unambiguous native snapshot primitive ${sourceIndex} (${name}); re-export native high leggings`);
  const original = primitive.getIndices().getArray();
  // Preview visibility masks can remove faces from exported indices; retain the full
  // source topology and accept only complete, unchanged source triangles.
  const triangles = new Set();
  for (let i = 0; i < original.length; i += 3) for (let r = 0; r < 3; r++) triangles.add(`${original[i + r]},${original[i + (r + 1) % 3]},${original[i + (r + 2) % 3]}`);
  if (part.indices.length % 3 || part.indices.some((_, i) => i % 3 === 0 && !triangles.has(`${part.indices[i]},${part.indices[i + 1]},${part.indices[i + 2]}`))) throw Error(`Native primitive ${sourceIndex} topology changed`);
  if (part.normals.length !== part.positions.length) throw Error(`Native primitive ${sourceIndex} normals missing`);
  return part;
}

export function correctionArray(accessor, values) {
  const delta = new Float32Array(values.length), element = [];
  for (let i = 0; i < accessor.getCount(); i++) {
    accessor.getElement(i, element);
    for (let d = 0; d < 3; d++) {
      const value = values[i * 3 + d];
      if (!Number.isFinite(value)) throw Error('Nonfinite recovered native coordinate');
      // Frozen CPU shape geometry is Float32; unchanged vertices must remain exact zeros.
      delta[i * 3 + d] = value - Math.fround(element[d]);
    }
  }
  return delta;
}

export async function buildRecoveredLeggings({ source = 'public/models/sarah-v2-body.glb', snapshots = '.scratch/recovered-fits', output = 'public/models/sarah-v2-leggings.glb' } = {}) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const sourceBytes = readFileSync(source), document = await io.readBinary(sourceBytes);
  const root = document.getRoot(), mesh = root.listMeshes()[0], originals = mesh.listPrimitives();
  if (originals.some(primitive => primitive.listTargets().length !== 43) || root.listSkins()[0].listJoints().length !== 68) throw Error('Unexpected native Sarah v2 source layout');
  const selected = originals.map((primitive, index) => ({ primitive, index })).filter(({ primitive }) => materials.has(primitive.getMaterial()?.getName()));
  if (selected.length !== 4) throw Error('Expected high leggings and three native trim primitives');
  const frames = LEGGINGS_STEPS.map(step => {
    const bytes = readFileSync(resolve(snapshots, `spandex-high-${step}.json`)), snapshot = JSON.parse(bytes);
    if (snapshot.bump !== step || snapshot.leggings !== 'high' || snapshot.fitStyle !== 'spandex') throw Error(`Wrong recovered fit for ${step}`);
    for (const { primitive, index } of selected) matchNativePart(snapshot, primitive, index);
    return { step, snapshot, sha256: sha256(bytes) };
  });
  const buffer = root.listBuffers()[0];
  for (const { primitive, index } of selected) {
    for (const { step, snapshot } of frames) {
      const part = matchNativePart(snapshot, primitive, index);
      const target = document.createPrimitiveTarget(`shape:recoveryLeggings${step}`);
      for (const [semantic, values] of [['POSITION', part.positions], ['NORMAL', part.normals]]) target.setAttribute(semantic,
        document.createAccessor(`recovered-${index}-${step}-${semantic}`).setType('VEC3').setArray(correctionArray(primitive.getAttribute(semantic), values)).setBuffer(buffer));
      primitive.addTarget(target);
    }
  }
  for (const primitive of originals) if (!materials.has(primitive.getMaterial()?.getName())) mesh.removePrimitive(primitive);
  mesh.setWeights([...mesh.getWeights(), ...LEGGINGS_STEPS.map(() => 0)]);
  mesh.setExtras({ ...mesh.getExtras(), targetNames: selected[0].primitive.listTargets().map(target => target.getName()), recoveryLeggings: {
    sourceSHA256: sha256(sourceBytes), originalTargets: 43, steps: LEGGINGS_STEPS, method: 'Additive bind-local delta from frozen smoothHighLeggings; native base/targets/rig unchanged',
    snapshots: frames.map(({ step, snapshot, sha256 }) => ({ step, sha256, bodyMatrix: snapshot.bodyMatrix, bindMatrix: snapshot.bindMatrix, bindMatrixInverse: snapshot.bindMatrixInverse, boneMatrices: snapshot.boneMatrices.slice(0, 68 * 16), dict: snapshot.dict, weights: snapshot.weights })),
  }});
  // packSarah's preliminary quantization changes float accessors. Only prune and the
  // lossless buffer-view encoder are appropriate when native data must stay exact.
  await document.transform(prune({ keepAttributes: true }));
  document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(output, document);
  if (sha256(readFileSync(source)) !== sha256(sourceBytes)) throw Error('Source model changed while recovering leggings');
  return { output, bytes: statSync(output).size, primitives: selected.length, joints: 68, targets: 48, sourceSHA256: sha256(sourceBytes), steps: LEGGINGS_STEPS };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(await buildRecoveredLeggings({ snapshots: process.argv[2], output: process.argv[3] }), null, 2));
