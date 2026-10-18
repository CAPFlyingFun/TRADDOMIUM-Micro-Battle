/** Lossless external-glTF packaging for upload APIs with a 4 MiB blob limit.
 * Copies complete referenced bufferView ranges; never decodes/re-encodes geometry.
 * Virtual EXT_meshopt_compression fallback buffers stay virtual. Content-addressed
 * parts share a directory across outfit variants and remain safely cacheable.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

export const MAX_PART_BYTES = 4 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const virtual = buffer => buffer.extensions?.EXT_meshopt_compression?.fallback === true;
const align4 = value => Math.ceil(value / 4) * 4;

function readGlb(bytes) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || data.getUint32(0, true) !== 0x46546c67 || data.getUint32(4, true) !== 2 || data.getUint32(8, true) !== bytes.byteLength) throw new Error('Invalid GLB 2 header');
  let json = null, binary = null;
  for (let offset = 12; offset < bytes.byteLength;) {
    if (offset + 8 > bytes.byteLength) throw new Error('Truncated GLB chunk');
    const length = data.getUint32(offset, true), type = data.getUint32(offset + 4, true), end = offset + 8 + length;
    if (end > bytes.byteLength) throw new Error('Truncated GLB payload');
    const chunk = bytes.subarray(offset + 8, end);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    if (type === 0x004e4942) binary = chunk;
    offset = end;
  }
  if (!json || !binary) throw new Error('Expected JSON and BIN chunks');
  return { json, binary };
}

/** Pure byte-range packaging, with no mutation of the supplied GLB. */
export function packageGlbBytes(bytes, { maxChunkBytes = MAX_PART_BYTES, partUriPrefix = 'sarah-v2-cloth-parts/' } = {}) {
  if (!Number.isInteger(maxChunkBytes) || maxChunkBytes < 4) throw new Error('Chunk limit must be an integer of at least 4 bytes');
  const { json, binary } = readGlb(bytes), originalBuffers = json.buffers ?? [];
  const buffers = [], fallbackMap = new Map();
  originalBuffers.forEach((buffer, index) => {
    if (virtual(buffer)) { fallbackMap.set(index, buffers.length); buffers.push(buffer); }
    else if (index !== 0 || buffer.uri) throw new Error('Expected a single embedded real BIN buffer');
  });
  const ranges = new Map(), references = [];
  const physical = (reference, label) => {
    const bufferIndex = reference.buffer ?? 0;
    if (fallbackMap.has(bufferIndex)) { reference.buffer = fallbackMap.get(bufferIndex); return; }
    if (bufferIndex !== 0) throw new Error(`Unsupported real buffer in ${label}`);
    const offset = reference.byteOffset ?? 0, length = reference.byteLength;
    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > binary.byteLength) throw new Error(`Invalid byte range in ${label}`);
    if (length > maxChunkBytes) throw new Error(`${label} range ${length} exceeds chunk limit ${maxChunkBytes}; a bufferView cannot be split`);
    const id = `${offset}:${length}`;
    if (!ranges.has(id)) ranges.set(id, { bytes: binary.subarray(offset, offset + length) });
    references.push({ reference, range: ranges.get(id) });
  };
  for (let i = 0; i < (json.bufferViews?.length ?? 0); i += 1) {
    const view = json.bufferViews[i];
    physical(view, `bufferView ${i}`);
    const compressed = view.extensions?.EXT_meshopt_compression;
    if (compressed) physical(compressed, `meshopt bufferView ${i}`);
  }
  const groups = [];
  let group = null;
  for (const range of ranges.values()) {
    if (!group || align4(group.length) + range.bytes.length > maxChunkBytes) { group = { length: 0, ranges: [] }; groups.push(group); }
    range.group = group; range.offset = align4(group.length); group.ranges.push(range); group.length = range.offset + range.bytes.length;
  }
  const parts = [], hashes = new Map();
  for (const current of groups) {
    const partBytes = new Uint8Array(current.length);
    for (const range of current.ranges) partBytes.set(range.bytes, range.offset);
    const digest = sha256(partBytes), name = `${digest}.bin`;
    if (!hashes.has(digest)) {
      const bufferIndex = buffers.length;
      buffers.push({ byteLength: partBytes.length, uri: `${partUriPrefix}${name}` });
      hashes.set(digest, bufferIndex); parts.push({ name, sha256: digest, bytes: partBytes });
    }
    current.bufferIndex = hashes.get(digest);
  }
  for (const { reference, range } of references) { reference.buffer = range.group.bufferIndex; reference.byteOffset = range.offset; }
  json.buffers = buffers;
  return { json, parts, sourceSha256: sha256(bytes), ranges: ranges.size };
}

function accessorProof(doc) {
  const hash = createHash('sha256'); let byteLength = 0;
  for (const accessor of doc.getRoot().listAccessors()) {
    const array = accessor.getArray();
    if (!array) throw new Error('Decoded accessor has no data');
    hash.update(JSON.stringify([accessor.getName(), accessor.getType(), accessor.getComponentType(), accessor.getNormalized(), accessor.getCount(), array.byteLength]));
    hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));byteLength += array.byteLength;
  }
  return { count: doc.getRoot().listAccessors().length, byteLength, sha256: hash.digest('hex') };
}
function textureProof(doc) {
  const hash = createHash('sha256');let byteLength = 0;
  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage();if (!image) throw new Error('Texture image is missing');
    hash.update(JSON.stringify([texture.getName(), texture.getMimeType(), image.byteLength]));hash.update(image);byteLength += image.byteLength;
  }
  return { count: doc.getRoot().listTextures().length, byteLength, sha256: hash.digest('hex') };
}

/** NodeIO decodes both representations, proving every accessor and image byte. */
export async function verifyShirtPackage(inputPath, outPath) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const source = await io.read(inputPath), packaged = await io.read(outPath);
  const a = accessorProof(source), b = accessorProof(packaged), ta = textureProof(source), tb = textureProof(packaged);
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Decoded accessor bytes differ after packaging');
  if (JSON.stringify(ta) !== JSON.stringify(tb)) throw new Error('Decoded texture bytes differ after packaging');
  return { verified: true, accessors: { count: a.count, byteLength: a.byteLength, sourceSha256: a.sha256, packagedSha256: b.sha256 }, textures: { count: ta.count, byteLength: ta.byteLength, sourceSha256: ta.sha256, packagedSha256: tb.sha256 } };
}

export async function packageShirtGlb({ inputPath, outPath, partsDirectory = path.join(path.dirname(outPath), 'sarah-v2-cloth-parts'), maxChunkBytes = MAX_PART_BYTES, verify = true }) {
  if (path.resolve(inputPath) === path.resolve(outPath)) throw new Error('Package output must differ from its source GLB');
  const prefix = `${path.relative(path.dirname(outPath), partsDirectory).split(path.sep).join('/')}/`;
  const packed = packageGlbBytes(await readFile(inputPath), { maxChunkBytes, partUriPrefix: prefix });
  await mkdir(partsDirectory, { recursive: true });await mkdir(path.dirname(outPath), { recursive: true });
  for (const part of packed.parts) {
    const target = path.join(partsDirectory, part.name);
    try { await writeFile(target, part.bytes, { flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (sha256(await readFile(target)) !== part.sha256) throw new Error(`Existing content-addressed part is corrupt: ${part.name}`);
    }
  }
  await writeFile(outPath, `${JSON.stringify(packed.json)}\n`);
  const verification = verify ? await verifyShirtPackage(inputPath, outPath) : { verified: false };
  const jsonBytes = (await stat(outPath)).size;
  if (jsonBytes > maxChunkBytes) throw new Error(`glTF JSON exceeds upload limit: ${jsonBytes}`);
  return { inputPath, outPath, sourceSha256: packed.sourceSha256, jsonBytes, parts: packed.parts.length, partBytes: packed.parts.reduce((sum, part) => sum + part.bytes.length, 0), maxPartBytes: Math.max(0, ...packed.parts.map(part => part.bytes.length)), partFiles: packed.parts.map(part => path.join(partsDirectory, part.name)), ...verification };
}

async function main() {
  const args = process.argv.slice(2), option = name => { const index = args.indexOf(`--${name}`);return index < 0 ? null : args[index + 1]; };
  const inputPath = option('input'), outPath = option('out');
  if (!inputPath || !outPath) throw new Error('Usage: node scripts/sarahV2Recovery/shirt-package.mjs --input SHIRT.glb --out SHIRT.gltf [--parts-dir DIR] [--max-bytes 4194304]');
  console.log(JSON.stringify(await packageShirtGlb({ inputPath, outPath, ...(option('parts-dir') ? { partsDirectory: option('parts-dir') } : {}), ...(option('max-bytes') ? { maxChunkBytes: Number(option('max-bytes')) } : {}) })));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
