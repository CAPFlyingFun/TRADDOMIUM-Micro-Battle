// Write each texture of a GLB to disk named by the slot it fills.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { mkdirSync, writeFileSync } from 'node:fs';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const [file, tag] = process.argv.slice(2);
const doc = await io.read(file);
mkdirSync(`${process.env.TOUCHUP_WORK ?? '.scratch/baseTouchup'}/tex`, { recursive: true });
for (const m of doc.getRoot().listMaterials()) {
  for (const [slot, tex] of [['base', m.getBaseColorTexture()], ['normal', m.getNormalTexture()], ['mr', m.getMetallicRoughnessTexture()], ['occ', m.getOcclusionTexture()], ['emis', m.getEmissiveTexture()]]) {
    if (!tex) continue;
    const ext = tex.getMimeType() === 'image/png' ? 'png' : tex.getMimeType() === 'image/ktx2' ? 'ktx2' : 'jpg';
    const out = `${process.env.TOUCHUP_WORK ?? '.scratch/baseTouchup'}/tex/${tag}-${m.getName()}-${slot}.${ext}`;
    writeFileSync(out, tex.getImage()); console.log(out, tex.getSize(), tex.getImage().byteLength);
  }
}
