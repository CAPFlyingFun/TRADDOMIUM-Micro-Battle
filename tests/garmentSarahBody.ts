/**
 * Sarah's body as the garment generator reads it, for the garment tests that need her real shape (not a test file).
 *
 * `public/models/sarah-v2-body-slim.glb` is parsed with three's GLTFLoader under node with its images, textures and
 * samplers stripped (as `garmentMeasure.test.ts` does), her body mesh is found by its vertex count, and
 * `bodyInputOf` (the room's own reader) turns it into a BodyInput at 0% belly, normals included. Load it once per file,
 * in a `beforeAll`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { bodyInputOf } from '../src/sarahlab/garment/bodyInput';
import type { BodyInput } from '../src/sarahlab/garment/types';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const DROP = new Set(['EXT_texture_webp', 'KHR_texture_basisu', 'KHR_texture_transform']);
export const SARAH_MODEL = 'models/sarah-v2-body-slim.glb';
/** Her body mesh, among the file's skinned meshes. */
const BODY_VERTICES = 115710;

/** The GLB with its images, textures and samplers removed: the rig and the mesh, nothing that needs a browser to decode. */
function withoutTextures(file: string): ArrayBuffer {
  const buf = readFileSync(join(ROOT, 'public', file));
  const length = buf.readUInt32LE(8);
  let off = 12;
  let json: Record<string, unknown> | null = null;
  let bin: Buffer | null = null;
  while (off < length) {
    const chunkLength = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + chunkLength);
    if (type === JSON_CHUNK) json = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
    else if (type === BIN_CHUNK) bin = data;
    off += 8 + chunkLength;
  }
  if (json === null || bin === null) throw new Error(`${file}: not a GLB`);
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of (json.materials as Record<string, unknown>[] | undefined) ?? []) {
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
    const pbr = m.pbrMetallicRoughness as Record<string, unknown> | undefined;
    if (pbr) { delete pbr.baseColorTexture; delete pbr.metallicRoughnessTexture; }
    delete m.extensions;
  }
  const drop = (list: unknown): string[] => ((list as string[] | undefined) ?? []).filter((e) => !DROP.has(e));
  json.extensionsUsed = drop(json.extensionsUsed);
  json.extensionsRequired = drop(json.extensionsRequired);
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  while (text.length % 4 !== 0) text = Buffer.concat([text, Buffer.from(' ')]);
  let body = bin;
  while (body.length % 4 !== 0) body = Buffer.concat([body, Buffer.from([0])]);
  const total = 12 + 8 + text.length + 8 + body.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(text.length, 12); out.writeUInt32LE(JSON_CHUNK, 16); text.copy(out, 20);
  const binOff = 20 + text.length;
  out.writeUInt32LE(body.length, binOff); out.writeUInt32LE(BIN_CHUNK, binOff + 4); body.copy(out, binOff + 8);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

/** Her skinned body mesh, parsed from the GLB without its textures. */
export function loadSarahMesh(): Promise<THREE.SkinnedMesh> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise((resolve, reject) => {
    loader.parse(withoutTextures(SARAH_MODEL), '', (gltf) => {
      let mesh: THREE.SkinnedMesh | null = null;
      gltf.scene.traverse((node) => {
        const m = node as THREE.SkinnedMesh;
        if (m.isSkinnedMesh === true && m.geometry.getAttribute('position').count === BODY_VERTICES) mesh = m;
      });
      if (mesh === null) reject(new Error(`${SARAH_MODEL}: no skinned mesh of ${BODY_VERTICES} vertices`));
      else resolve(mesh);
    }, reject);
  });
}

/** Her body as the garment generator reads it, at 0% belly (the room passes her 'belly' target at 1). */
export async function loadSarahInput(): Promise<BodyInput> {
  return bodyInputOf(await loadSarahMesh());
}
