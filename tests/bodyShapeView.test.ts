import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyShapeFields, liftShapeFields } from '../src/view/bodyShapeView';

function residualShirt() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([.1, .2, .3, 1, 2, 3], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 3));
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = [
    new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
    new THREE.Float32BufferAttribute([.5, 0, 0, 0, 0, 0], 3),
  ];
  // The baked fit normal contains the opposite of a retained native GPU
  // normal change. They must be added together before normalizing once.
  geometry.morphAttributes.normal = [
    new THREE.Float32BufferAttribute([0, -2, 0, 0, 0, 0], 3),
    new THREE.Float32BufferAttribute([0, 2, 0, 0, 0, 0], 3),
  ];
  const mesh = new THREE.Mesh(geometry);
  mesh.morphTargetDictionary = { belly: 0, 'shape:fitBelly0': 1 };
  mesh.morphTargetInfluences = [1, 0];
  return { mesh, shape: liftShapeFields(mesh)! };
}

const weights = { 'shape:fitBelly0': 1 };
const normal = (mesh: THREE.Mesh) => new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('normal'), 0);

describe('CPU shape normal composition', () => {
  it('preserves the raw CPU residual so the retained GPU normal morph cancels it before final normalization', () => {
    const { mesh, shape } = residualShirt();
    applyShapeFields(mesh, shape, weights, { normalizeNormals: false });
    expect(normal(mesh).toArray()).toEqual([0, 2, 1]);
    const gpuDelta = new THREE.Vector3().fromBufferAttribute(mesh.geometry.morphAttributes.normal![0], 0);
    const final = normal(mesh).add(gpuDelta).normalize();
    expect(final.toArray()).toEqual([0, 0, 1]);
  });

  it('keeps default normalization and identical positions when only normalization mode changes at the same weights', () => {
    const { mesh, shape } = residualShirt();
    applyShapeFields(mesh, shape, weights);
    const normalized = normal(mesh).clone();
    const positions = mesh.geometry.getAttribute('position').array.slice();
    expect(normalized.length()).toBeCloseTo(1, 7);
    expect(normalized.y).toBeCloseTo(2 / Math.sqrt(5), 7);
    expect(normalized.z).toBeCloseTo(1 / Math.sqrt(5), 7);

    applyShapeFields(mesh, shape, weights, { normalizeNormals: false });
    expect(normal(mesh).toArray()).toEqual([0, 2, 1]);
    expect(mesh.geometry.getAttribute('position').array).toEqual(positions);

    applyShapeFields(mesh, shape, weights);
    expect(normal(mesh).toArray()).toEqual(normalized.toArray());
    expect(mesh.geometry.getAttribute('position').array).toEqual(positions);
    expect(new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('normal'), 1).toArray()).toEqual([0, 0, 1]);
  });
});
