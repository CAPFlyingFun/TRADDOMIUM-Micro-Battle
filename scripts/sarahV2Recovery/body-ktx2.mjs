/**
 * THE SLIM BODY WITH GPU-COMPRESSED SKIN (a pilot; Joshua, 2026-10-22: "go ahead and work on all 3", after Replit's
 * recommendation to pilot KTX2/Basis on her two 2048 skin maps).
 *
 * `sarah-v2-body-slim.glb` (body-slim.mjs) carries her skin as two 2048 PNGs. A PNG is small to download but is
 * unpacked on the phone to plain pixels: about 21 MB of graphics memory each with mipmaps. This writes
 * `public/models/sarah-v2-body-slim-ktx2.glb`, the same file with those two maps as KTX2 (KHR_texture_basisu), which the
 * phone keeps compressed on the graphics card (ASTC or ETC2 on an iPhone):
 *   - her colour as ETC1S (small; perceptual): 3.0 MB of PNG to 0.5 MB, and about 21 MB of graphics memory to 5;
 *   - her normal map stays PNG for now. Encoded as UASTC (the format normal maps need) it rendered in dark blotches on
 *     her arms in the headless test renderer (2026-10-22), which may be that renderer's and not the file's; it waits
 *     for a check on a real phone (`KTX2_MAPS=both`) before it is used.
 * Everything else in the file is unchanged (the script checks every geometry array). The room uses it only when the
 * address says `?skin=ktx2`, so it can be compared with the PNG skin on the phone before anything switches.
 *
 *   node scripts/sarahV2Recovery/body-ktx2.mjs
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { decode } from 'fast-png';
import { encodeToKTX2 } from 'ktx2-encoder';
import { statSync } from 'node:fs';

const SOURCE = 'public/models/sarah-v2-body-slim.glb';
const TARGET = 'public/models/sarah-v2-body-slim-ktx2.glb';

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/** A PNG as RGBA pixels, for the encoder. */
async function rgba(buffer) {
  const png = decode(buffer);
  const n = png.width * png.height, out = new Uint8Array(n * 4), ch = png.channels, src = png.data, scale = png.depth === 16 ? 1 / 257 : 1;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(src[i * ch + Math.min(c, ch - 1)] * scale);
    out[i * 4 + 3] = ch === 4 || ch === 2 ? Math.round(src[i * ch + ch - 1] * scale) : 255;
  }
  return { data: out, width: png.width, height: png.height };
}

function geometry(doc) {
  const out = [];
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    out.push(p.getIndices()?.getArray());
    for (const s of p.listSemantics()) out.push(p.getAttribute(s).getArray());
    for (const t of p.listTargets()) for (const s of t.listSemantics()) out.push(t.getAttribute(s).getArray());
  }
  return out;
}

const doc = await io.read(SOURCE);
const before = geometry(doc);
doc.createExtension(KHRTextureBasisu).setRequired(true);
const materials = doc.getRoot().listMaterials();
let changed = 0;
for (const texture of doc.getRoot().listTextures()) {
  if (texture.getMimeType() !== 'image/png') continue;
  const normal = materials.some((m) => m.getNormalTexture() === texture);
  const colour = materials.some((m) => m.getBaseColorTexture() === texture);
  if (!normal && !colour) continue;
  // KTX2_MAPS: colour (the default), normal, or both
  const maps = process.env.KTX2_MAPS ?? 'colour';
  if (maps !== 'both' && maps !== (normal ? 'normal' : 'colour')) continue;
  const pixels = await rgba(texture.getImage());
  const ktx = await encodeToKTX2(texture.getImage(), {
    isUASTC: normal, generateMipmap: true, needSupercompression: true, isPerceptual: !normal, isNormalMap: false,
    qualityLevel: 192, compressionLevel: 2, enableRDO: normal, rdoQualityLevel: 1.0, isKTX2File: true,
    imageDecoder: async () => pixels,
  });
  console.log(`${texture.getName() || 'texture'} (${normal ? 'normal map, UASTC' : 'colour, ETC1S'}): ${texture.getImage().byteLength} -> ${ktx.byteLength} bytes`);
  texture.setImage(new Uint8Array(ktx)).setMimeType('image/ktx2');
  changed += 1;
}
if (!changed) throw new Error('no PNG skin map found');

const bytes = await io.writeBinary(doc);
const after = geometry(await io.readBinary(bytes));
if (after.length !== before.length) throw new Error('the geometry changed');
before.forEach((x, i) => { const y = after[i]; if (x?.length !== y?.length) throw new Error(`array ${i} changed length`); for (let n = 0; n < (x?.length ?? 0); n++) if (x[n] !== y[n]) throw new Error(`array ${i}[${n}] changed`); });
await io.write(TARGET, doc);
const mb = (f) => (statSync(f).size / 1048576).toFixed(1);
console.log(`${changed} maps to KTX2, geometry identical: ${SOURCE} ${mb(SOURCE)} MB -> ${TARGET} ${mb(TARGET)} MB`);
