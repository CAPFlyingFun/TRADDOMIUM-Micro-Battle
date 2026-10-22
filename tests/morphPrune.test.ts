import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { dropIdleMorphs, morphTextureBytes } from '../src/view/morphPrune';

/** A four-vertex mesh with three targets: `still` moves nothing, `belly` moves one vertex, `tilt` only bends a normal. */
function mesh(tiltBendsNormal: boolean): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  const zero = () => new THREE.BufferAttribute(new Float32Array(12), 3);
  const belly = zero(); belly.setXYZ(2, 0, 0, 1);
  const tiltN = zero(); if (tiltBendsNormal) tiltN.setXYZ(1, 0.2, 0, 0);
  g.morphAttributes.position = [zero(), belly, zero()];
  g.morphAttributes.normal = [zero(), zero(), tiltN];
  const m = new THREE.Mesh(g);
  m.morphTargetDictionary = { still: 0, belly: 1, tilt: 2 };
  m.morphTargetInfluences = [0.3, 0.6, 0.9];
  return m;
}

describe('morph targets that move nothing are not sent to the GPU (Joshua, 2026-10-21)', () => {
  it('drops a target that moves nothing, keeps the rest by name with their weights', () => {
    const m = mesh(true);
    expect(dropIdleMorphs(m)).toEqual({ before: 3, after: 2, normalsDropped: false });
    expect(m.morphTargetDictionary).toEqual({ belly: 0, tilt: 1 });
    expect(m.morphTargetInfluences).toEqual([0.6, 0.9]);
    expect(m.geometry.morphAttributes.normal).toHaveLength(2);
  });
  it('drops the normal deltas when no kept target bends a normal, and the GPU texture shrinks with it', () => {
    const m = mesh(false), before = morphTextureBytes(m.geometry);
    expect(dropIdleMorphs(m)).toEqual({ before: 3, after: 1, normalsDropped: true });
    expect(m.morphTargetDictionary).toEqual({ belly: 0 });
    expect(m.geometry.morphAttributes.normal).toBeUndefined();
    expect(morphTextureBytes(m.geometry)).toBe(before / 6);
  });
  it('leaves a mesh whose every target moves exactly as it was', () => {
    const m = mesh(true);
    (m.geometry.morphAttributes.position![0] as THREE.BufferAttribute).setXYZ(0, 1, 0, 0);
    const pos = m.geometry.morphAttributes.position;
    expect(dropIdleMorphs(m)).toEqual({ before: 3, after: 3, normalsDropped: false });
    expect(m.geometry.morphAttributes.position).toBe(pos);
  });
  it('draws a part where nothing moves as a plain mesh, with no morph shader to build', () => {
    const m = mesh(false);
    (m.geometry.morphAttributes.position![1] as THREE.BufferAttribute).setXYZ(2, 0, 0, 0);
    expect(dropIdleMorphs(m)).toEqual({ before: 3, after: 0, normalsDropped: true });
    expect(m.geometry.morphAttributes).toEqual({});
    expect(m.morphTargetInfluences).toBeUndefined();
  });
});
