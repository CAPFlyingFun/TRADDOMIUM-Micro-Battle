/**
 * THE LOW LEGGINGS ARE RECOVERED LIKE THE HIGH ONES (Joshua, 2026-10-20: "the spandex low over 100% around 140-200%
 * start digging into the underside of the belly... make sure spandex low is also applying the same techniques as
 * spandex high"). The native low leggings are copied out of the approved body unchanged and carry their own nine fit
 * corrections (scripts/sarahV2Recovery/leggings-low-build.mjs, then leggings-fit.mjs).
 */
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
let original: Document, low: Document, native: Primitive[], pants: Primitive[];

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  [original, low] = await Promise.all(['assets-archive/models/sarah-v2-body.glb', 'assets-archive/models/sarah-v2-leggings-low.glb'].map(path => io.read(path)));
  native = original.getRoot().listMeshes()[0].listPrimitives().filter(p => ['leggingsLow', 'leggingsLowTrim'].includes(p.getMaterial()!.getName()));
  pants = low.getRoot().listMeshes()[0].listPrimitives();
}, 60000);

function values(accessor: Accessor): Float32Array {
  const result = new Float32Array(accessor.getCount() * accessor.getElementSize()), value: number[] = [];
  for (let i = 0; i < accessor.getCount(); i++) { accessor.getElement(i, value); result.set(value, i * value.length); }
  return result;
}
const same = (a: Accessor | null, b: Accessor | null) => {
  expect(Boolean(a)).toBe(Boolean(b)); if (!a || !b) return;
  const x = a.getArray()!, y = b.getArray()!;
  expect(Buffer.from(x.buffer, x.byteOffset, x.byteLength).equals(Buffer.from(y.buffer, y.byteOffset, y.byteLength))).toBe(true);
};

describe('recovered Sarah v2 native low leggings', () => {
  it('copies the native low leggings out of the unchanged approved body, byte for byte, with nine corrections after the 43 native targets', () => {
    expect(createHash('sha256').update(readFileSync('assets-archive/models/sarah-v2-body.glb')).digest('hex')).toBe(sourceHash);
    expect(pants.map(p => p.getMaterial()!.getName())).toEqual(['leggingsLow', 'leggingsLowTrim', 'leggingsLowTrim', 'leggingsLowTrim']);
    const extras = low.getRoot().listMeshes()[0].getExtras();
    expect(extras.recoveryLeggings).toMatchObject({ sourceSHA256: sourceHash, originalTargets: 43, rise: 'low', fitKeys: [...LEGGINGS_FIT_KEYS] });
    expect(low.getRoot().listSkins()[0].listJoints()).toHaveLength(68);
    pants.forEach((primitive, index) => {
      const source = native[index];
      expect(primitive.listSemantics().sort()).toEqual(source.listSemantics().sort());
      for (const semantic of source.listSemantics()) same(primitive.getAttribute(semantic), source.getAttribute(semantic));
      expect(primitive.listTargets()).toHaveLength(43 + LEGGINGS_FIT_KEYS.length);
      for (let i = 0; i < 43; i++) for (const semantic of source.listTargets()[i].listSemantics()) same(primitive.listTargets()[i].getAttribute(semantic), source.listTargets()[i].getAttribute(semantic));
      expect(primitive.listTargets().slice(43).map(t => t.getName())).toEqual(LEGGINGS_FIT_KEYS.map(k => `shape:recoveryLeggings${k}`));
    });
    expect(extras.targetNames).toEqual(pants[0].listTargets().map(t => t.getName()));
  });

  it('keeps the low leggings and their waistband at least 1.2 mm off her body at every fit key', () => {
    const weightsAt = (p: number): Record<string, number> => ({ ...bellyWeights(p), ...breastWeightsFor(p, true), bellyUpper: bellyUpperWeight(p), ...navelWeights(p), navelFlat: navelFlatWeight(p), ...bellyMotionWeights(p, 0, restingBellySpring(), 20) });
    const worldOf = (doc: Document) => { const s = doc.getRoot().listSkins()[0]; return new Matrix4().fromArray(s.listJoints()[0].getWorldMatrix()).multiply(new Matrix4().fromArray(Array.from(s.getInverseBindMatrices()!.getArray()!.slice(0, 16)))); };
    const replay = (doc: Document, primitive: Primitive, weights: Record<string, number>) => {
      const names = doc.getRoot().listMeshes()[0].getExtras().targetNames as string[], out = values(primitive.getAttribute('POSITION')!);
      primitive.listTargets().forEach((target, k) => { const w = weights[names[k]] ?? 0; if (!w) return; const d = values(target.getAttribute('POSITION')!); for (let i = 0; i < out.length; i++) out[i] += w * d[i]; });
      const m = worldOf(doc), v = new Vector3(), world = new Float64Array(out.length);
      for (let i = 0; i < out.length; i += 3) { v.set(out[i], out[i + 1], out[i + 2]).applyMatrix4(m); world[i] = v.x * 100; world[i + 1] = v.y * 100; world[i + 2] = v.z * 100; }
      return world;
    };
    const skin = original.getRoot().listMeshes()[0].listPrimitives().find(p => p.getMaterial()!.getName() === 'Material_0')!, idx = skin.getIndices()!.getArray()!;
    for (const key of LEGGINGS_FIT_KEYS) {
      const weights = weightsAt(key), body = replay(original, skin, weights), torso: number[] = [];
      for (let i = 0; i < idx.length; i += 3) if ([0, 1, 2].some(e => body[idx[i + e] * 3 + 1] > 35 && body[idx[i + e] * 3 + 1] < 130)) torso.push(idx[i], idx[i + 1], idx[i + 2]);
      const collider = new SkinCollider(body, torso);
      for (const [piece, cloth] of [['leggings', pants[0]], ['waistband', pants[1]]] as const) {
        const points = replay(low, cloth, { ...weights, [`shape:recoveryLeggings${key}`]: 1 });
        let checked = 0, close = 0, nearest = Infinity;
        for (let i = 0; i < points.length; i += 6) {
          if (points[i + 1] < 35) continue;
          const hit = collider.closest([points[i], points[i + 1], points[i + 2]]);
          if (!hit) continue;
          checked++; nearest = Math.min(nearest, hit.signedDistance); if (hit.signedDistance < 0.12) close++;
        }
        expect(checked, `${piece} ${key}%`).toBeGreaterThan(1000);
        expect(close, `${piece} ${key}%: closer than 1.2 mm (nearest ${nearest.toFixed(3)} cm)`).toBe(0);
      }
    }
  }, 120000);
});
