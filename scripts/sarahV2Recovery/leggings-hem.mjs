/** Bake signed vertical pants-to-shirt hem distances, in posed world centimetres.
 * node scripts/sarahV2Recovery/leggings-hem.mjs [snapshot-directory] [leggings.glb]
 * Custom scalar attributes are loaded by Three with lowercase names.
 */
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';
import { LEGGINGS_STEPS, matchNativePart } from './leggings-build.mjs';

const TAU = 2 * Math.PI, CENTER_Z = -6;
function values(accessor) {
  const array = new Float32Array(accessor.getCount() * accessor.getElementSize()), value = [];
  for (let i = 0; i < accessor.getCount(); i++) { accessor.getElement(i, value); array.set(value, i * value.length); }
  return array;
}

/** The frozen buildHemProfile conservative cell lower bound, on world-space export arrays. */
export function buildRecoveredHemProfile(garments, bins = 1024) {
  const hem = new Float64Array(bins).fill(Infinity), vertexMin = new Float64Array(bins).fill(Infinity);
  for (const { positions: p, indices: ix } of garments) {
    for (let i = 0; i < p.length; i += 3) {
      const cell = (Math.floor(Math.atan2(p[i], p[i + 2] - CENTER_Z) / TAU * bins) % bins + bins) % bins;
      vertexMin[cell] = Math.min(vertexMin[cell], p[i + 1]);
    }
    for (let k = 0; k < ix.length; k += 3) for (let edge = 0; edge < 3; edge++) {
      const a = ix[k + edge] * 3, b = ix[k + (edge + 1) % 3] * 3;
      const ax = p[a], ay = p[a + 1], az = p[a + 2] - CENTER_Z, bx = p[b], by = p[b + 1], bz = p[b + 2] - CENTER_Z;
      const aa = Math.atan2(ax, az); let bb = Math.atan2(bx, bz);
      while (bb - aa > Math.PI) bb -= TAU;
      while (bb - aa < -Math.PI) bb += TAU;
      const lo = Math.ceil(Math.min(aa, bb) / TAU * bins - 1e-9), hi = Math.floor(Math.max(aa, bb) / TAU * bins + 1e-9);
      for (let j = lo; j <= hi; j++) {
        const theta = j / bins * TAU, sin = Math.sin(theta), cos = Math.cos(theta), sa = cos * ax - sin * az, sb = cos * bx - sin * bz, den = sa - sb;
        let t;
        if (Math.abs(den) < 1e-12) { if (Math.abs(sa) > 1e-8) continue; t = ay <= by ? 0 : 1; } else t = sa / den;
        if (t < -1e-8 || t > 1 + 1e-8) continue;
        t = Math.max(0, Math.min(1, t));
        const x = ax + t * (bx - ax), z = az + t * (bz - az);
        if (x * sin + z * cos <= 0) continue;
        const bin = (j % bins + bins) % bins;
        hem[bin] = Math.min(hem[bin], ay + t * (by - ay));
      }
    }
  }
  const cellLowerHem = new Float64Array(bins);
  for (let k = 0; k < bins; k++) cellLowerHem[k] = Math.min(hem[k], hem[(k + 1) % bins], vertexMin[k]);
  return { bins, cellLowerHem };
}

/** Replay exactly the native GPU pose: corrected CPU base + live original morphs, then skin. */
export function recoveredNativeWorld(primitive, snapshot, part) {
  const posed = Float64Array.from(part.positions), joints = values(primitive.getAttribute('JOINTS_0')), skin = values(primitive.getAttribute('WEIGHTS_0'));
  for (const target of primitive.listTargets().slice(0, 43)) {
    const weight = snapshot.weights[snapshot.dict[target.getName()]] ?? 0;
    if (!weight) continue;
    const deltas = values(target.getAttribute('POSITION'));
    for (let i = 0; i < posed.length; i++) posed[i] += weight * deltas[i];
  }
  const outer = new Matrix4().fromArray(snapshot.bodyMatrix).multiply(new Matrix4().fromArray(snapshot.bindMatrixInverse));
  const bind = new Matrix4().fromArray(snapshot.bindMatrix), blend = new Matrix4(), map = new Matrix4(), vertex = new Vector3();
  for (let i = 0; i < posed.length / 3; i++) {
    blend.elements.fill(0);
    for (let c = 0; c < 4; c++) for (let d = 0; d < 16; d++) blend.elements[d] += skin[i * 4 + c] * snapshot.boneMatrices[joints[i * 4 + c] * 16 + d];
    map.copy(outer).multiply(blend).multiply(bind);
    vertex.fromArray(posed, i * 3).applyMatrix4(map);
    posed.set([vertex.x, vertex.y, vertex.z], i * 3);
  }
  return posed;
}

export function signedHemDistances(world, profile) {
  const distances = new Float32Array(world.length / 3);
  for (let i = 0; i < distances.length; i++) {
    const theta = Math.atan2(world[i * 3], world[i * 3 + 2] - CENTER_Z);
    const cell = Math.floor(((theta / TAU * profile.bins) % profile.bins + profile.bins) % profile.bins), hem = profile.cellLowerHem[cell];
    distances[i] = Number.isFinite(hem) ? world[i * 3 + 1] - hem : -1e6;
  }
  return distances;
}

export async function bakeRecoveredLeggingsHems({ snapshots = '.scratch/recovered-fits', output = 'assets-archive/models/sarah-v2-leggings.glb' } = {}) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const document = await io.read(output), root = document.getRoot(), mesh = root.listMeshes()[0], buffer = root.listBuffers()[0], reports = [];
  for (const style of ['spandex', 'relaxed']) for (const step of LEGGINGS_STEPS) {
    const snapshot = JSON.parse(readFileSync(resolve(snapshots, `${style}-high-${step}.json`))), profile = buildRecoveredHemProfile(snapshot.garments);
    if (snapshot.bump !== step || snapshot.fitStyle !== style || snapshot.leggings !== 'high' || profile.cellLowerHem.some(y => !Number.isFinite(y))) throw Error(`Incomplete hem snapshot ${style}-${step}`);
    const semantic = `_HEM_${style.toUpperCase()}_${step}`;
    for (const [index, primitive] of mesh.listPrimitives().entries()) {
      const part = matchNativePart(snapshot, primitive, [16, 21, 22, 23][index]);
      const distances = signedHemDistances(recoveredNativeWorld(primitive, snapshot, part), profile);
      const previous = primitive.getAttribute(semantic);
      primitive.setAttribute(semantic, document.createAccessor(semantic).setType('SCALAR').setArray(distances).setBuffer(buffer));
      previous?.dispose();
    }
    reports.push({ style, step, semantic, bins: profile.bins, hemMinCm: Math.min(...profile.cellLowerHem), hemMaxCm: Math.max(...profile.cellLowerHem), cellLowerHemCm: Array.from(profile.cellLowerHem), frame: { bodyMatrix: snapshot.bodyMatrix, bindMatrix: snapshot.bindMatrix, bindMatrixInverse: snapshot.bindMatrixInverse, boneMatrices: snapshot.boneMatrices.slice(0, 68 * 16), dict: snapshot.dict, weights: snapshot.weights } });
  }
  mesh.setExtras({ ...mesh.getExtras(), recoveryLeggingsHem: { units: 'world centimetres', sign: 'pants world Y minus conservative shirt hem Y; positive is covered', centerZ: CENTER_Z, profiles: reports } });
  document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(output, document);
  return { output, bytes: statSync(output).size, profiles: reports };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await bakeRecoveredLeggingsHems({ snapshots: process.argv[2], output: process.argv[3] });
  console.log(JSON.stringify({ ...result, profiles: result.profiles.map(({ style, step, semantic, bins, hemMinCm, hemMaxCm }) => ({ style, step, semantic, bins, hemMinCm, hemMaxCm })) }, null, 2));
}
