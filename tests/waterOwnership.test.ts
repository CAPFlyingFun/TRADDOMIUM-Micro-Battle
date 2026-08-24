import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waterOwner } from '../src/world/waterOwnership';
import { buildReach, RiverWater } from '../src/world/RiverWater';
import { forgetRivers, useRivers } from '../src/world/rivers';
import type { Hydro } from '../src/world/hydro';
import { LakeWater } from '../src/world/LakeWater';
import { Ocean } from '../src/world/Ocean';
import { SAMPLES } from '../src/world/kauai';

afterEach(() => forgetRivers());

describe('water visual ownership', () => {
  it('has one total priority order for every overlap matrix', () => {
    expect(waterOwner({ pond: false, lake: false, river: false })).toBe('sea');
    expect(waterOwner({ pond: false, lake: false, river: true })).toBe('river');
    expect(waterOwner({ pond: false, lake: true, river: true })).toBe('lake');
    expect(waterOwner({ pond: true, lake: true, river: true })).toBe('pond');
    expect(waterOwner({ pond: true, lake: false, river: true })).toBe('pond');
  });

  it('conservatively removes a rejected river quad instead of stacking it', () => {
    // x, level, z, width: a small but genuinely sloped reach.
    const stations = new Float64Array([0, 100, 0, 40, 100, 80, 0, 40]);
    const plain = buildReach(stations, 50, 0)!;
    const blocked = buildReach(stations, 50, 0, () => false)!;
    expect(plain.getIndex()!.count / 3).toBe(2);
    expect(blocked.getIndex()!.count / 3).toBe(0);
    plain.dispose();
    blocked.dispose();
  });

  it('rebuilds and disposes rendered reaches without a decision-cell crossing', () => {
    const hydro: Hydro = {
      rivers: [{ name: null, order: 1, toOcean: false, first: 0, count: 2 }],
      lakes: [],
      x: new Int32Array([0, 10_000]),
      z: new Int32Array([0, 0]),
      y: new Int32Array([100, 80]),
      width: new Uint16Array([100, 100]),
      ringX: new Int32Array(),
      ringZ: new Int32Array(),
    };
    useRivers(hydro);
    const scene = new THREE.Scene();
    const water = new RiverWater(scene, hydro);
    water.follow({ wx: 0, wz: 0 });
    expect(water.shown).toBe(1);
    const oldMesh = scene.children[0] as THREE.Mesh;
    const dispose = vi.spyOn(oldMesh.geometry, 'dispose');
    // Same 50,000-unit cell: this must not take follow()'s early return.
    water.invalidateTerrain({ wx: 1, wz: 1 });
    expect(dispose).toHaveBeenCalledOnce();
    expect(scene.children).not.toContain(oldMesh);
    expect(water.shown).toBe(1);
    water.dispose();
  });

  it('uses ordered, depth-writing water materials', () => {
    const scene = new THREE.Scene();
    const lake = new LakeWater(scene) as unknown as { material: THREE.Material; dispose(): void };
    const ocean = new Ocean(scene, new Int16Array(SAMPLES * SAMPLES), null) as unknown as { mesh: THREE.Mesh; material: THREE.Material; dispose(): void };
    const material = lake.material as THREE.MeshStandardMaterial;
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(true);
    const seaMaterial = ocean.material as THREE.MeshStandardMaterial;
    expect(ocean.mesh.renderOrder).toBe(0);
    expect(seaMaterial.depthTest).toBe(true);
    expect(seaMaterial.depthWrite).toBe(true);
    lake.dispose();
    ocean.dispose();
  });
});