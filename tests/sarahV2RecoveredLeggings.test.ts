import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NodeIO, type Accessor, type Document, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';

const sourceHash = '47e990f0f28097efca488b4274f2cac0e0fa588904bc2c10cb00695600897f42';
const steps = [0, 50, 100, 150, 200];
type Frame = { step: number; bodyMatrix: number[]; bindMatrix: number[]; bindMatrixInverse: number[]; boneMatrices: number[]; dict: Record<string, number>; weights: number[] };
const targetNames = steps.map(step => `shape:recoveryLeggings${step}`);
let original: Document, recovered: Document, native: Primitive[], pants: Primitive[];

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  [original, recovered] = await Promise.all(['public/models/sarah-v2-body.glb', 'public/models/sarah-v2-leggings.glb'].map(path => io.read(path)));
  native = original.getRoot().listMeshes()[0].listPrimitives().filter(p => ['leggings', 'leggingsTrim'].includes(p.getMaterial()!.getName()));
  pants = recovered.getRoot().listMeshes()[0].listPrimitives();
}, 60000);

function sameAccessor(actual: Accessor | null, expected: Accessor | null) {
  expect(Boolean(actual)).toBe(Boolean(expected));
  if (!actual || !expected) return;
  expect(actual.getType()).toBe(expected.getType());
  expect(actual.getNormalized()).toBe(expected.getNormalized());
  const a = actual.getArray()!, b = expected.getArray()!;
  expect(a.constructor).toBe(b.constructor);
  // Avoid constructing hundreds of thousands of assertions for byte-identical data.
  expect(Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength))).toBe(true);
}

function values(accessor: Accessor): Float32Array {
  const result = new Float32Array(accessor.getCount() * accessor.getElementSize()), value: number[] = [];
  for (let i = 0; i < accessor.getCount(); i++) { accessor.getElement(i, value); result.set(value, i * value.length); }
  return result;
}

describe('recovered Sarah v2 native high leggings', () => {
  it('leaves the approved source immutable and contains only the four high leggings primitives', () => {
    expect(createHash('sha256').update(readFileSync('public/models/sarah-v2-body.glb')).digest('hex')).toBe(sourceHash);
    expect(pants.map(p => p.getMaterial()!.getName())).toEqual(['leggings', 'leggingsTrim', 'leggingsTrim', 'leggingsTrim']);
    expect(recovered.getRoot().listMaterials().map(m => m.getName()).sort()).toEqual(['leggings', 'leggingsTrim']);
    expect(recovered.getRoot().listMeshes()).toHaveLength(1);
    expect(recovered.getRoot().listMeshes()[0].getExtras().recoveryLeggings).toMatchObject({ sourceSHA256: sourceHash, originalTargets: 43, steps });
  });

  it('retains the original 68-bone skin, native attributes and all 43 morph targets byte-for-byte, with full oriented topology', () => {
    const a = recovered.getRoot().listSkins()[0], b = original.getRoot().listSkins()[0];
    expect(a.listJoints()).toHaveLength(68);
    expect(a.listJoints().map(j => [j.getName(), j.getMatrix()])).toEqual(b.listJoints().map(j => [j.getName(), j.getMatrix()]));
    sameAccessor(a.getInverseBindMatrices(), b.getInverseBindMatrices());
    pants.forEach((primitive, index) => {
      const source = native[index];
      expect(primitive.listSemantics().filter(s => !s.startsWith('_HEM_')).sort()).toEqual(source.listSemantics().sort());
      for (const semantic of source.listSemantics()) sameAccessor(primitive.getAttribute(semantic), source.getAttribute(semantic));
      const actualIndices = primitive.getIndices()!.getArray()!, originalIndices = source.getIndices()!.getArray()!;
      expect(actualIndices.length).toBe(originalIndices.length);
      // Meshopt TRIANGLES may cyclically rotate a triangle's three vertices.
      let changedTriangles = 0;
      for (let i = 0; i < actualIndices.length; i += 3) {
        let same = false;
        for (let r = 0; r < 3; r++) if ([0, 1, 2].every(d => actualIndices[i + d] === originalIndices[i + (d + r) % 3])) same = true;
        if (!same) changedTriangles++;
      }
      expect(changedTriangles).toBe(0);
      expect(primitive.listTargets()).toHaveLength(48);
      for (let i = 0; i < 43; i++) {
        const actual = primitive.listTargets()[i], expected = source.listTargets()[i];
        expect(actual.getName()).toBe(expected.getName());
        expect(actual.listSemantics().sort()).toEqual(expected.listSemantics().sort());
        for (const semantic of expected.listSemantics()) sameAccessor(actual.getAttribute(semantic), expected.getAttribute(semantic));
      }
      expect(primitive.listTargets().slice(43).map(t => t.getName())).toEqual(targetNames);
    });
    expect(recovered.getRoot().listMeshes()[0].getWeights()).toEqual([...original.getRoot().listMeshes()[0].getWeights(), 0, 0, 0, 0, 0]);
    expect(recovered.getRoot().listMeshes()[0].getExtras().targetNames).toEqual(pants[0].listTargets().map(t => t.getName()));
  });


  it('includes ten finite signed hem fields for interpolation, with positive covered waistband and negative ankles', () => {
    const semantics = ['SPANDEX', 'RELAXED'].flatMap(style => steps.map(step => `_HEM_${style}_${step}`));
    const metadata = recovered.getRoot().listMeshes()[0].getExtras().recoveryLeggingsHem as { units: string; profiles: { semantic: string; bins: number; hemMinCm: number; hemMaxCm: number; cellLowerHemCm: number[]; frame: Frame }[] };
    expect(metadata.units).toBe('world centimetres');
    expect(metadata.profiles.map(profile => profile.semantic)).toEqual(semantics);
    for (const [index, primitive] of pants.entries()) {
      expect(primitive.listSemantics().filter(s => s.startsWith('_HEM_')).sort()).toEqual([...semantics].sort());
      for (const semantic of semantics) {
        const attr = primitive.getAttribute(semantic)!;
        expect(attr.getType()).toBe('SCALAR');
        expect(attr.getCount()).toBe(primitive.getAttribute('POSITION')!.getCount());
        const array = attr.getArray()!;
        expect(array.every(Number.isFinite)).toBe(true);
        if (index === 1) expect(array.every(value => value > 0)).toBe(true);
        if (index >= 2) expect(array.every(value => value < 0)).toBe(true);
        if (index === 0) { expect(array.some(value => value > 0)).toBe(true); expect(array.some(value => value < 0)).toBe(true); }
      }
    }
    for (const profile of metadata.profiles) {
      const frame = profile.frame, outer = new Matrix4().fromArray(frame.bodyMatrix).multiply(new Matrix4().fromArray(frame.bindMatrixInverse));
      const bind = new Matrix4().fromArray(frame.bindMatrix), blend = new Matrix4(), map = new Matrix4(), vertex = new Vector3();
      const step = Number(profile.semantic.split('_').at(-1));
      for (const primitive of pants) {
        const base = values(primitive.getAttribute('POSITION')!), delta = values(primitive.listTargets()[43 + steps.indexOf(step)].getAttribute('POSITION')!);
        const joints = values(primitive.getAttribute('JOINTS_0')!), skin = values(primitive.getAttribute('WEIGHTS_0')!), distances = primitive.getAttribute(profile.semantic)!.getArray()!;
        const morphs = primitive.listTargets().slice(0, 43).map(target => ({ weight: frame.weights[frame.dict[target.getName()]] ?? 0, target })).filter(m => m.weight).map(m => ({ weight: m.weight, array: values(m.target.getAttribute('POSITION')!) }));
        // Sample all surfaces across their vertex order, independently replaying the
        // corrected native GPU geometry against the stored conservative profile.
        for (let v = 0; v < distances.length; v += 97) {
          const offset = v * 3, point = [0, 1, 2].map(d => Math.fround(base[offset + d] + delta[offset + d]));
          for (const morph of morphs) for (let d = 0; d < 3; d++) point[d] += morph.weight * morph.array[offset + d];
          blend.elements.fill(0);
          for (let c = 0; c < 4; c++) for (let d = 0; d < 16; d++) blend.elements[d] += skin[v * 4 + c] * frame.boneMatrices[joints[v * 4 + c] * 16 + d];
          map.copy(outer).multiply(blend).multiply(bind); vertex.fromArray(point).applyMatrix4(map);
          const theta = Math.atan2(vertex.x, vertex.z + 6), cell = Math.floor(((theta / (2 * Math.PI) * 1024) % 1024 + 1024) % 1024);
          expect(Math.abs(distances[v] - (vertex.y - profile.cellLowerHemCm[cell]))).toBeLessThan(1e-3);
        }
      }
      expect(profile.bins).toBe(1024);
      expect(profile.cellLowerHemCm).toHaveLength(1024);
      expect(profile.cellLowerHemCm.every(Number.isFinite)).toBe(true);
      expect(Math.min(...profile.cellLowerHemCm)).toBe(profile.hemMinCm);
      expect(Math.max(...profile.cellLowerHemCm)).toBe(profile.hemMaxCm);
    }
  });

  it('replays each additive correction only in the front 82–94 cm strip, radially outward by at most 0.8 cm', () => {
    const frames = (recovered.getRoot().listMeshes()[0].getExtras().recoveryLeggings as { snapshots: Frame[] }).snapshots;
    expect(frames.map(f => f.step)).toEqual(steps);
    for (const frame of frames) {
      const outer = new Matrix4().fromArray(frame.bodyMatrix).multiply(new Matrix4().fromArray(frame.bindMatrixInverse));
      const bind = new Matrix4().fromArray(frame.bindMatrix), blend = new Matrix4(), map = new Matrix4();
      let moved = 0, maxLift = 0;
      for (const primitive of pants) {
        const base = values(primitive.getAttribute('POSITION')!), joints = values(primitive.getAttribute('JOINTS_0')!), skin = values(primitive.getAttribute('WEIGHTS_0')!);
        const correction = primitive.listTargets()[43 + steps.indexOf(frame.step)], delta = values(correction.getAttribute('POSITION')!), normalDelta = values(correction.getAttribute('NORMAL')!);
        const shaped = base.slice();
        for (let t = 0; t < 43; t++) {
          const target = primitive.listTargets()[t], weight = frame.weights[frame.dict[target.getName()]] ?? 0;
          if (!weight) continue;
          const attr = values(target.getAttribute('POSITION')!);
          for (let i = 0; i < shaped.length; i++) shaped[i] += weight * attr[i];
        }
        const position = new Vector3(), displacement = new Vector3();
        for (let v = 0; v < base.length / 3; v++) {
          const offset = v * 3;
          if (delta[offset] === 0 && delta[offset + 1] === 0 && delta[offset + 2] === 0 && normalDelta[offset] === 0 && normalDelta[offset + 1] === 0 && normalDelta[offset + 2] === 0) continue;
          blend.elements.fill(0);
          for (let c = 0; c < 4; c++) for (let d = 0; d < 16; d++) blend.elements[d] += skin[v * 4 + c] * frame.boneMatrices[joints[v * 4 + c] * 16 + d];
          map.copy(outer).multiply(blend).multiply(bind);
          position.fromArray(shaped, offset).applyMatrix4(map);
          displacement.fromArray(delta, offset);
          const e = map.elements, x = displacement.x, y = displacement.y, z = displacement.z;
          displacement.set(e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z);
          const radius = Math.hypot(position.x, position.z + 6), rx = position.x / radius, rz = (position.z + 6) / radius;
          const radial = displacement.x * rx + displacement.z * rz;
          expect(position.y).toBeGreaterThan(82 - 1e-4);
          expect(position.y).toBeLessThan(94 + 1e-4);
          expect(rz).toBeGreaterThan(.35 - 1e-4);
          expect(radial).toBeGreaterThanOrEqual(-1e-5);
          expect(radial).toBeLessThanOrEqual(.8001);
          expect(Math.abs(displacement.y)).toBeLessThan(1e-4);
          expect(Math.abs(displacement.x * rz - displacement.z * rx)).toBeLessThan(1e-4);
          maxLift = Math.max(maxLift, radial); moved++;
        }
      }
      expect(moved).toBeGreaterThan(100);
      expect(maxLift).toBeGreaterThan(.01);
    }
  }, 30000);
});
