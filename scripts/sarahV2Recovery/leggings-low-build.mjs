/** THE LOW LEGGINGS GET THE HIGH ONES' TREATMENT (Joshua, 2026-10-20: "the spandex low over 100% around 140-200%
 * start digging into the underside of the belly... make sure spandex low is also applying the same techniques as
 * spandex high around the groin, belly, hip areas").
 *
 * The low (under-belly) leggings were still the native garment inside the approved body file, with no fit correction
 * of their own; since her body is never hidden, her belly came through their waistband from about 140%. This copies the
 * native `leggingsLow` + `leggingsLowTrim` primitives out of the approved body, byte for byte (skin, attributes, all 43
 * native targets), into their own file with nine EMPTY `shape:recoveryLeggings<key>` corrections; leggings-fit.mjs then
 * fills them. The approved body file is only read.
 *   node scripts/sarahV2Recovery/leggings-low-build.mjs [body.glb] [out.glb]
 *   node scripts/sarahV2Recovery/leggings-fit.mjs out.glb assets-archive/models/sarah-v2-body.glb assets-archive/models/sarah-v2-leggings-low.glb
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

export const LOW_MATERIALS = ['leggingsLow', 'leggingsLowTrim'];
const KEYS = [0, 25, 30, 50, 60, 75, 100, 150, 200];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function buildLowLeggings({ source = 'assets-archive/models/sarah-v2-body.glb', output = 'assets-archive/models/sarah-v2-leggings-low.glb' } = {}) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const sourceBytes = readFileSync(source), document = await io.readBinary(sourceBytes);
  const root = document.getRoot(), mesh = root.listMeshes()[0], originals = mesh.listPrimitives();
  if (originals.some((p) => p.listTargets().length !== 43) || root.listSkins()[0].listJoints().length !== 68) throw Error('Unexpected native Sarah v2 source layout');
  const selected = originals.filter((p) => LOW_MATERIALS.includes(p.getMaterial()?.getName()));
  if (selected.length !== 4 || selected[0].getMaterial().getName() !== 'leggingsLow') throw Error('Expected the low leggings and three native trim primitives');
  const buffer = root.listBuffers()[0];
  for (const primitive of selected) {
    const n = primitive.getAttribute('POSITION').getCount();
    for (const key of KEYS) {
      const target = document.createPrimitiveTarget(`shape:recoveryLeggings${key}`);
      for (const semantic of ['POSITION', 'NORMAL']) target.setAttribute(semantic, document.createAccessor(`low-${key}-${semantic}`).setType('VEC3').setArray(new Float32Array(n * 3)).setBuffer(buffer));
      primitive.addTarget(target);
    }
  }
  for (const primitive of originals) if (!selected.includes(primitive)) mesh.removePrimitive(primitive);
  mesh.setWeights([...mesh.getWeights(), ...KEYS.map(() => 0)]);
  mesh.setExtras({ ...mesh.getExtras(), targetNames: selected[0].listTargets().map((t) => t.getName()), recoveryLeggings: { sourceSHA256: sha256(sourceBytes), originalTargets: 43, rise: 'low', fitKeys: KEYS, method: 'native low leggings copied byte for byte; additive bind-local corrections from leggings-fit.mjs' } });
  await document.transform(prune({ keepAttributes: true }));
  document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(output, document);
  if (sha256(readFileSync(source)) !== sha256(sourceBytes)) throw Error('Source model changed while copying the low leggings');
  return { output, bytes: statSync(output).size, primitives: selected.length, targets: 43 + KEYS.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(await buildLowLeggings({ source: process.argv[2], output: process.argv[3] })));
