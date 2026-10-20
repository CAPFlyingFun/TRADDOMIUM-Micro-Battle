import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NodeIO, type Accessor, type Document, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { LEGGINGS_FIT_KEYS } from '../src/sarahlab/recoveredClothes';
import { bellyMotionWeights, bellyUpperWeight, bellyWeights, breastWeightsFor, navelFlatWeight, navelWeights, restingBellySpring } from '../src/sarahlab/sarahLabTool';
import { SkinCollider } from '../scripts/sarahV2Recovery/bikini/collider.mjs';

const sourceHash = '47e990f0f28097efca488b4274f2cac0e0fa588904bc2c10cb00695600897f42';
const steps = [0, 50, 100, 150, 200];
type Frame = { step: number; bodyMatrix: number[]; bindMatrix: number[]; bindMatrixInverse: number[]; boneMatrices: number[]; dict: Record<string, number>; weights: number[] };
const targetNames = LEGGINGS_FIT_KEYS.map(key => `shape:recoveryLeggings${key}`);
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
    expect(recovered.getRoot().listMeshes()[0].getExtras().recoveryLeggings).toMatchObject({ sourceSHA256: sourceHash, originalTargets: 43, steps, fitKeys: [...LEGGINGS_FIT_KEYS] });
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
      expect(primitive.listTargets()).toHaveLength(43 + LEGGINGS_FIT_KEYS.length);
      for (let i = 0; i < 43; i++) {
        const actual = primitive.listTargets()[i], expected = source.listTargets()[i];
        expect(actual.getName()).toBe(expected.getName());
        expect(actual.listSemantics().sort()).toEqual(expected.listSemantics().sort());
        for (const semantic of expected.listSemantics()) sameAccessor(actual.getAttribute(semantic), expected.getAttribute(semantic));
      }
      expect(primitive.listTargets().slice(43).map(t => t.getName())).toEqual(targetNames);
    });
    expect(recovered.getRoot().listMeshes()[0].getWeights()).toEqual([...original.getRoot().listMeshes()[0].getWeights(), ...LEGGINGS_FIT_KEYS.map(() => 0)]);
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
        const base = values(primitive.getAttribute('POSITION')!), delta = values(primitive.listTargets().find(t => t.getName() === `shape:recoveryLeggings${step}`)!.getAttribute('POSITION')!);
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

  // THE LEGGINGS CLEAR HER AT EVERY FIT KEY (Joshua, 2026-10-19: her body is never hidden under clothes, so the
  // cloth must stay outside it by itself). Replaces alpha.98's check that corrections stayed inside an 82-94 cm front
  // strip: that strip's edge printed a ridge along the groin, and its corrections are gone. Each key's correction is
  // replayed with the Lab's default weights at that size, against her body at the same size, in world centimetres.
  it('keeps the high leggings at least 1.2 mm off her body at every one of the nine fit keys', () => {
    const weightsAt = (p: number): Record<string, number> => ({ ...bellyWeights(p), ...breastWeightsFor(p, true), bellyUpper: bellyUpperWeight(p), ...navelWeights(p), navelFlat: navelFlatWeight(p), ...bellyMotionWeights(p, 0, restingBellySpring(), 20) });
    // the bind pose in world space: the skin's root joint times its inverse bind matrix (as the fit scripts measure)
    const worldOf = (doc: Document) => { const skinNode = doc.getRoot().listSkins()[0]; return new Matrix4().fromArray(skinNode.listJoints()[0].getWorldMatrix()).multiply(new Matrix4().fromArray(Array.from(skinNode.getInverseBindMatrices()!.getArray()!.slice(0, 16)))); };
    const replay = (doc: Document, primitive: Primitive, weights: Record<string, number>) => {
      const names = doc.getRoot().listMeshes()[0].getExtras().targetNames as string[], out = values(primitive.getAttribute('POSITION')!);
      primitive.listTargets().forEach((target, k) => { const w = weights[names[k]] ?? 0; if (!w) return; const d = values(target.getAttribute('POSITION')!); for (let i = 0; i < out.length; i++) out[i] += w * d[i]; });
      const m = worldOf(doc), v = new Vector3(), world = new Float64Array(out.length);
      for (let i = 0; i < out.length; i += 3) { v.set(out[i], out[i + 1], out[i + 2]).applyMatrix4(m); world[i] = v.x * 100; world[i + 1] = v.y * 100; world[i + 2] = v.z * 100; }
      return world;
    };
    const skin = original.getRoot().listMeshes()[0].listPrimitives().find(p => p.getMaterial()!.getName() === 'Material_0')!, cloth = pants[0], skinIndices = skin.getIndices()!.getArray()!;
    for (const key of LEGGINGS_FIT_KEYS) {
      const weights = weightsAt(key), body = replay(original, skin, weights), torso: number[] = [];
      for (let i = 0; i < skinIndices.length; i += 3) if ([0, 1, 2].some(e => body[skinIndices[i + e] * 3 + 1] > 35 && body[skinIndices[i + e] * 3 + 1] < 130)) torso.push(skinIndices[i], skinIndices[i + 1], skinIndices[i + 2]);
      const collider = new SkinCollider(body, torso), legs = replay(recovered, cloth, { ...weights, [`shape:recoveryLeggings${key}`]: 1 });
      let checked = 0, close = 0, nearest = Infinity;
      for (let i = 0; i < legs.length; i += 6) {
        if (legs[i + 1] < 35) continue;
        const hit = collider.closest([legs[i], legs[i + 1], legs[i + 2]]);
        if (!hit) continue;
        checked++; nearest = Math.min(nearest, hit.signedDistance);
        if (hit.signedDistance < 0.12) close++;
      }
      expect(checked, `${key}%`).toBeGreaterThan(10000);
      expect(close, `${key}%: cloth points closer than 1.2 mm (nearest ${nearest.toFixed(3)} cm)`).toBe(0);
    }
  }, 120000);
});
