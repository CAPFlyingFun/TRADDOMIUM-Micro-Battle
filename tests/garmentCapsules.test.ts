/**
 * HER LIMBS AS CAPSULES FOR THE CLOTH (`src/sarahlab/garment/capsules.ts`), on a hand-built skeleton of THREE.Bone
 * objects under a moved and scaled parent (so world positions are what is read) and a measure whose girths are made up:
 * capsuleCount counts 4 for the arms, 2 for the legs, 1 for a stool; bodyCapsules writes them in that order -- upper
 * arm from 45% of the way down shoulder to elbow, forearm elbow to wrist, each 85% of its girth's circle in radius; thigh
 * from 5% of the way down hip to knee, 105% of its girth's circle (her thigh's own size: seated, a dress's front laid
 * inside her thighs is put out over them, Stage 3); scaled by unitsPerMetre; the stool a vertical capsule whose rounded top is
 * the seat -- reuses a buffer of the right size, makes a new one otherwise, and follows the bones when they move.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Capsules } from '../src/sarahlab/clothSim';
import { bodyCapsules, capsuleCount, type CapsuleBones, type CapsuleRequest } from '../src/sarahlab/garment/capsules';
import type { BodyMeasure } from '../src/sarahlab/garment/types';

const BONES: CapsuleBones = { shoulder: [0, 1], elbow: [2, 3], wrist: [4, 5], hip: [6, 7], knee: [8, 9] };
/** Local positions of the ten bones under the root ([+x side, -x side] pairs as BONES orders them). */
const LOCAL: readonly (readonly [number, number, number])[] = [
  [0.15, 1.37, -0.1], [-0.15, 1.37, -0.1], // shoulders
  [0.21, 1.12, -0.1], [-0.21, 1.12, -0.1], // elbows
  [0.28, 0.91, -0.08], [-0.28, 0.91, -0.08], // wrists
  [0.1, 0.89, -0.05], [-0.1, 0.89, -0.05], // hips
  [0.1, 0.52, -0.05], [-0.1, 0.52, -0.05], // knees
];
/** The root: moved and scaled, as her model is in the room. */
const ROOT_AT = new THREE.Vector3(1, 0.5, -2), ROOT_SCALE = 2;

function rig(): { mesh: THREE.SkinnedMesh; bones: THREE.Bone[]; root: THREE.Group } {
  const root = new THREE.Group();
  root.position.copy(ROOT_AT);
  root.scale.setScalar(ROOT_SCALE);
  const bones = LOCAL.map(([x, y, z]) => { const b = new THREE.Bone(); b.position.set(x, y, z); root.add(b); return b; });
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  return { mesh, bones, root };
}

/** Only what bodyCapsules reads of a measure: each arm's girths and the thigh's. */
const girths = (top: number) => Array.from({ length: 21 }, (_, i) => top - 0.01 * i);
const MEASURE = { arms: [{ girths: girths(0.30) }, { girths: girths(0.32) }], thigh: { y: 0.8, girth: 0.55 } } as unknown as BodyMeasure;

const world = (i: number) => new THREE.Vector3(...LOCAL[i]).multiplyScalar(ROOT_SCALE).add(ROOT_AT);
const radiusOf = (girth: number, upm: number, share = 0.85) => (girth / (2 * Math.PI)) * share * upm;

function expectCapsule(c: Capsules, k: number, a: THREE.Vector3, b: THREE.Vector3, r: number): void {
  for (let j = 0; j < 3; j++) {
    expect(c.a[k * 3 + j], `capsule ${k} a[${j}]`).toBeCloseTo(a.getComponent(j), 5);
    expect(c.b[k * 3 + j], `capsule ${k} b[${j}]`).toBeCloseTo(b.getComponent(j), 5);
  }
  expect(c.radius[k], `capsule ${k} radius`).toBeCloseTo(r, 6);
}

const ALL: CapsuleRequest = { arms: true, legs: true, stool: { x: 0.3, z: -0.2, radius: 0.18, top: 0.5 } };

describe('capsuleCount', () => {
  it('counts four for the arms, two for the legs, one for a stool', () => {
    const stool = ALL.stool;
    expect(capsuleCount({ arms: false, legs: false, stool: null })).toBe(0);
    expect(capsuleCount({ arms: true, legs: false, stool: null })).toBe(4);
    expect(capsuleCount({ arms: false, legs: true, stool: null })).toBe(2);
    expect(capsuleCount({ arms: false, legs: false, stool })).toBe(1);
    expect(capsuleCount({ arms: true, legs: true, stool: null })).toBe(6);
    expect(capsuleCount(ALL)).toBe(7);
  });
});

describe('bodyCapsules', () => {
  it('writes arms, legs and stool in order, from the bones\' world positions, radii from her girths', () => {
    const { mesh } = rig();
    const upm = 1.25;
    const c = bodyCapsules(mesh, BONES, MEASURE, ALL, upm);
    expect(c.count).toBe(7);
    expect(c.a.length).toBe(21);
    expect(c.b.length).toBe(21);
    expect(c.radius.length).toBe(7);
    for (let s = 0; s < 2; s++) {
      const sh = world(BONES.shoulder[s]), el = world(BONES.elbow[s]), wr = world(BONES.wrist[s]);
      const top = s === 0 ? 0.30 : 0.32; // girths fall 1 cm a step: the largest of 3..7 is the 3rd, of 12..15 the 12th
      expectCapsule(c, 2 * s, sh.clone().lerp(el, 0.45), el, radiusOf(top - 0.03, upm));
      expectCapsule(c, 2 * s + 1, el, wr, radiusOf(top - 0.12, upm));
    }
    for (let s = 0; s < 2; s++) {
      const hip = world(BONES.hip[s]), knee = world(BONES.knee[s]);
      expectCapsule(c, 4 + s, hip.clone().lerp(knee, 0.05), knee, radiusOf(0.55, upm, 1.05));
    }
    // the stool: from the floor up to its seat less its radius, so the rounded top is the seat
    expectCapsule(c, 6, new THREE.Vector3(0.3, 0, -0.2), new THREE.Vector3(0.3, 0.5 - 0.18, -0.2), 0.18);
    for (let k = 0; k < 7; k++) expect(c.radius[k]).toBeGreaterThan(0);
    // an upper arm is fuller than its forearm, a thigh than either
    expect(c.radius[0]).toBeGreaterThan(c.radius[1]);
    expect(c.radius[4]).toBeGreaterThan(c.radius[0]);
  });

  it('scales the radii by unitsPerMetre and only the radii', () => {
    const { mesh } = rig();
    const one = bodyCapsules(mesh, BONES, MEASURE, { arms: true, legs: true, stool: null }, 1);
    const hundred = bodyCapsules(mesh, BONES, MEASURE, { arms: true, legs: true, stool: null }, 100);
    for (let k = 0; k < 6; k++) expect(hundred.radius[k]).toBeCloseTo(100 * one.radius[k], 4);
    expect(Array.from(hundred.a)).toEqual(Array.from(one.a));
    expect(Array.from(hundred.b)).toEqual(Array.from(one.b));
  });

  it('writes only what is asked: legs alone, a stool alone, a stool lower than its radius', () => {
    const { mesh } = rig();
    const legs = bodyCapsules(mesh, BONES, MEASURE, { arms: false, legs: true, stool: null }, 1);
    expect(legs.count).toBe(2);
    expectCapsule(legs, 0, world(6).lerp(world(8), 0.05), world(8), radiusOf(0.55, 1, 1.05));
    const low = bodyCapsules(mesh, BONES, MEASURE, { arms: false, legs: false, stool: { x: -1, z: 2, radius: 0.2, top: 0.1 } }, 1);
    expect(low.count).toBe(1);
    expectCapsule(low, 0, new THREE.Vector3(-1, 0, 2), new THREE.Vector3(-1, 0, 2), 0.2);
    const none = bodyCapsules(mesh, BONES, MEASURE, { arms: false, legs: false, stool: null }, 1);
    expect(none.count).toBe(0);
    expect(none.radius.length).toBe(0);
  });

  it('reuses a buffer of the right size, makes a new one otherwise, and follows the bones when they move', () => {
    const { mesh, bones, root } = rig();
    const req: CapsuleRequest = { arms: true, legs: false, stool: null };
    const first = bodyCapsules(mesh, BONES, MEASURE, req, 1);
    const elbowBefore = [first.b[0], first.b[1], first.b[2]];
    // her +x forearm swings forward: the elbow bone moves 10 cm (local, so 20 cm in the world)
    bones[BONES.elbow[0]].position.z += 0.1;
    root.updateMatrixWorld(true);
    const again = bodyCapsules(mesh, BONES, MEASURE, req, 1, first);
    expect(again).toBe(first);
    expect(again.b[2] - elbowBefore[2]).toBeCloseTo(0.2, 5);
    expect(again.b[0]).toBeCloseTo(elbowBefore[0], 5);
    // the forearm starts at the moved elbow; the other arm did not move
    expect(again.a[3 + 2]).toBeCloseTo(again.b[2], 5);
    expect(again.b[6 + 2]).toBeCloseTo(world(BONES.elbow[1]).z, 5);
    // a buffer of the wrong size is left alone
    const wrong: Capsules = { count: 7, a: new Float32Array(21), b: new Float32Array(21), radius: new Float32Array(7) };
    const fresh = bodyCapsules(mesh, BONES, MEASURE, req, 1, wrong);
    expect(fresh).not.toBe(wrong);
    expect(fresh.count).toBe(4);
    expect(Array.from(wrong.radius)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
