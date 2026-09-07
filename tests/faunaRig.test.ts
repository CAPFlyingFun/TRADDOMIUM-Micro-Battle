/**
 * THE RIGS, READ BY MEASUREMENT — on synthetic skeletons shaped like the
 * three GLBs (`faunaFixtures.ts`), because the real ones name nothing:
 *
 *   six legs are the six lowest tips, in mirrored ±X pairs, ranked
 *     along Z within their side, and the two halves of the tripod
 *     alternate across every pair
 *   wings are the mirrored pair off the thorax hub whose tips sit
 *     highest; a rig without them reports none without being told
 *   antennae are the mirrored pair off the head hub with the highest tips
 *   the chain is ordered by PARENTAGE whatever order its names came in
 *   the spine is the chain's length, or the median band's extent
 *   dressing keeps the base map, drops the packed maps, sets the skin
 *   the placeholder is a box the creature's own length on the ground
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EARTHWORM } from '../src/creatures';
import {
  CREATURE_ROUGHNESS, MEDIAN_BAND, bonesOf, chainOf, disposeRig, dressRig, findAntennae, findLegs, findWings, hubOf,
  measureRig, measureSpine, placeholderFor, trianglesOf,
} from '../src/fauna/rig';
import { LEGGED_UNIT_SPINE, boneless, leggedRig, wormRig } from './faunaFixtures';

const tipY = (root: THREE.Object3D, name: string): number => {
  root.updateMatrixWorld(true);
  const bone = root.getObjectByName(name) as THREE.Bone;
  return new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld).y;
};

describe('findLegs', () => {
  it('finds six legs in mirrored pairs, ranked within their side, with alternating tripod halves', () => {
    const rig = leggedRig(3.9, true);
    const legs = findLegs(rig);
    expect(legs).toHaveLength(6);
    expect(legs.filter((l) => l.side === 1)).toHaveLength(3);
    expect(legs.filter((l) => l.side === -1)).toHaveLength(3);
    for (const side of [1, -1]) {
      const ranks = legs.filter((l) => l.side === side).map((l) => l.rank).sort();
      expect(ranks).toEqual([0, 1, 2]);
    }
    // Every mirrored pair has one leg in each half of the tripod.
    for (let rank = 0; rank < 3; rank += 1) {
      const pair = legs.filter((l) => l.rank === rank);
      expect(pair).toHaveLength(2);
      expect(pair[0].phase).not.toBe(pair[1].phase);
    }
    // The coxa is the hub's child; the tip is on the ground.
    const hub = hubOf(bonesOf(rig))!;
    for (const leg of legs) {
      const coxa = rig.getObjectByName(leg.coxa) as THREE.Bone;
      expect(coxa.parent).toBe(hub);
      expect(tipY(rig, leg.tip)).toBeCloseTo(0, 6);
      // The swing axis is the body's vertical, in the parent's frame — the hub is unrotated here, so it is +Y.
      expect(leg.axis.y).toBeCloseTo(1, 6);
    }
  });

  it('finds nothing on a chain or a boneless model', () => {
    expect(findLegs(wormRig(20))).toEqual([]);
    expect(findLegs(boneless())).toEqual([]);
  });
});

describe('findWings and findAntennae', () => {
  it('finds the wing pair on a flier and none on a walker', () => {
    const fly = leggedRig(3.9, true);
    const bones = bonesOf(fly);
    const legs = findLegs(fly, bones);
    const wings = findWings(fly, bones, legs);
    expect(wings).toHaveLength(2);
    expect(wings.map((w) => w.side).sort()).toEqual([-1, 1]);
    // Their tips are the highest on the rig.
    const highest = Math.max(...bones.map((b) => tipY(fly, b.name)));
    for (const w of wings) expect(tipY(fly, w.tip)).toBeCloseTo(highest, 6);
    // The hinge bones are the hub's children, and not legs.
    const hub = hubOf(bones)!;
    for (const w of wings) {
      expect((fly.getObjectByName(w.bone) as THREE.Bone).parent).toBe(hub);
      expect(legs.some((l) => l.coxa === w.bone)).toBe(false);
    }
    const aphid = leggedRig(3.9, false);
    const aphidBones = bonesOf(aphid);
    expect(findWings(aphid, aphidBones, findLegs(aphid, aphidBones))).toEqual([]);
  });

  it('finds the feelers on the head hub, on both rigs', () => {
    for (const winged of [true, false]) {
      const rig = leggedRig(3.9, winged);
      const bones = bonesOf(rig);
      const legs = findLegs(rig, bones);
      const antennae = findAntennae(rig, bones, legs);
      expect(antennae).toHaveLength(2);
      expect(antennae.map((a) => a.side).sort()).toEqual([-1, 1]);
      // On the head, not the thorax; and not the wings.
      const hub = hubOf(bones)!;
      for (const a of antennae) {
        const bone = rig.getObjectByName(a.bone) as THREE.Bone;
        expect(bone.parent).not.toBe(hub);
        expect(bone.parent).not.toBeNull();
        expect(tipY(rig, a.tip)).toBeGreaterThan(0.5);
      }
    }
  });
});

describe('chainOf and measureSpine', () => {
  it('orders the worm chain by parentage, root first, whatever order the names came in', () => {
    const rig = wormRig(128.699);
    const chain = chainOf(rig, EARTHWORM.model.chain!);
    expect(chain).toHaveLength(17);
    expect(chain[0].name).toBe('Bone_000');
    expect(chain[1].name).toBe('Bone_016');
    expect(chain[16].name).toBe('Bone_001');
    for (let i = 1; i < chain.length; i += 1) expect(chain[i].parent).toBe(chain[i - 1]);
    // The same answer from a shuffled list.
    const shuffled = [...EARTHWORM.model.chain!].reverse();
    expect(chainOf(rig, shuffled).map((b) => b.name)).toEqual(chain.map((b) => b.name));
  });

  it('measures the chain\'s length, and the median band\'s extent for a legged rig', () => {
    expect(measureSpine(wormRig(128.699), EARTHWORM.model.chain)).toBeCloseTo(128.699, 6);
    expect(measureSpine(wormRig(20), EARTHWORM.model.chain)).toBeCloseTo(20, 6);
    expect(measureSpine(leggedRig(LEGGED_UNIT_SPINE, true), null)).toBeCloseTo(LEGGED_UNIT_SPINE, 6);
    expect(measureSpine(leggedRig(9.166, true), null)).toBeCloseTo(9.166, 6);
    expect(measureSpine(leggedRig(6.67, false), null)).toBeCloseTo(6.67, 6);
    expect(measureSpine(boneless(), null)).toBe(0);
    // The band is TCS's fraction of the width; the legs sit well outside it.
    expect(MEDIAN_BAND).toBe(0.12);
  });

  it('measureRig describes a chain with its lengths, directions and lift, and a legged rig with its parts', () => {
    const worm = measureRig(wormRig(30), EARTHWORM.model.chain);
    expect(worm.chain).not.toBeNull();
    expect(worm.chain!.bones).toHaveLength(17);
    expect(worm.chain!.lengths).toHaveLength(16);
    expect(worm.chain!.lengths.reduce((a, b) => a + b, 0)).toBeCloseTo(30, 6);
    for (const d of worm.chain!.dirs) expect(d.length()).toBeCloseTo(1, 6);
    // The axis sits one skin radius above the underside.
    expect(worm.chain!.lift).toBeCloseTo(0.033 * 30, 6);
    expect(worm.legs).toEqual([]);
    expect(worm.wings).toEqual([]);
    expect(worm.triangles).toBe(17 * 2);
    const fly = measureRig(leggedRig(9.166, true), null);
    expect(fly.chain).toBeNull();
    expect(fly.legs).toHaveLength(6);
    expect(fly.wings).toHaveLength(2);
    expect(fly.antennae).toHaveLength(2);
    expect(fly.spine).toBeCloseTo(9.166, 6);
    expect(fly.box.min.y).toBeLessThanOrEqual(0);
    expect(fly.triangles).toBe(trianglesOf(leggedRig(9.166, true)));
  });
});

describe('dressRig', () => {
  it('keeps the base map, drops the packed maps, and sets the skin once per material', () => {
    const rig = leggedRig(3.9, true);
    const mesh = rig.getObjectByName('output_unwrapped') as THREE.SkinnedMesh;
    const material = mesh.material as THREE.MeshStandardMaterial;
    const map = material.map!;
    const dropped = [material.normalMap!, material.roughnessMap!, material.metalnessMap!];
    const disposed = dropped.map((t) => { let n = 0; t.addEventListener('dispose', () => { n += 1; }); return () => n; });
    expect(dressRig(rig)).toBe(1);
    expect(material.map).toBe(map);
    expect(material.normalMap).toBeNull();
    expect(material.roughnessMap).toBeNull();
    expect(material.metalnessMap).toBeNull();
    expect(material.roughness).toBe(CREATURE_ROUGHNESS);
    expect(material.metalness).toBe(0);
    for (const count of disposed) expect(count()).toBe(1);
    // A posed rig leaves its bind-pose bounds: never culled by them.
    expect(mesh.frustumCulled).toBe(false);
    // Dressing again touches the same one material, not zero and not two.
    expect(dressRig(rig)).toBe(1);
  });

  it('disposeRig releases every geometry, material and texture', () => {
    const rig = leggedRig(3.9, true);
    const mesh = rig.getObjectByName('output_unwrapped') as THREE.SkinnedMesh;
    const material = mesh.material as THREE.MeshStandardMaterial;
    let geometries = 0;
    let materials = 0;
    let textures = 0;
    mesh.geometry.addEventListener('dispose', () => { geometries += 1; });
    material.addEventListener('dispose', () => { materials += 1; });
    material.map!.addEventListener('dispose', () => { textures += 1; });
    disposeRig(rig);
    expect(geometries).toBe(1);
    expect(materials).toBe(1);
    expect(textures).toBe(1);
  });
});

describe('placeholderFor', () => {
  it('is a box the creature\'s length, standing on the ground, in world units', () => {
    const box = placeholderFor(15, 0.045, 0x9a6e62);
    const mesh = box.children[0] as THREE.Mesh;
    const g = mesh.geometry as THREE.BoxGeometry;
    expect(g.parameters.depth).toBe(15);
    expect(g.parameters.width).toBeCloseTo(15 * 0.045, 9);
    expect(mesh.position.y).toBeCloseTo((15 * 0.045) / 2, 9);
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(material.roughness).toBe(CREATURE_ROUGHNESS);
    expect(material.metalness).toBe(0);
    expect(findLegs(box)).toEqual([]);
  });
});
