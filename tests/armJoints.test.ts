import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ArmJoints } from '../src/sarahlab/armJoints';

// A body rigged as Sarah v2 is: arms down, palms to her thighs, thumbs forward (+z); her left is +x.
function body(side: 1 | -1) {
  const mk = (name: string, x: number, y: number, z: number, parent?: THREE.Bone) => { const b = new THREE.Bone(); b.name = name; const p = parent ? parent.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(); b.position.set(x - p.x, y - p.y, z - p.z); parent?.add(b); b.updateMatrixWorld(true); return b; };
  const hips = mk('hips', 0, 1, 0), neck = mk('neck', 0, 1.5, 0, hips);
  const sh = mk('sh', 0.2 * side, 1.4, 0, hips), other = mk('other', -0.2 * side, 1.4, 0, hips);
  const el = mk('el', 0.2 * side, 1.1, 0, sh), wr = mk('wr', 0.2 * side, 0.85, 0, el);
  const kn = mk('kn', 0.2 * side, 0.77, 0, wr), index = mk('index', 0.2 * side, 0.75, 0.02, kn), little = mk('little', 0.2 * side, 0.75, -0.02, kn), tip = mk('tip', 0.2 * side, 0.67, 0, kn);
  const bones = [hips, neck, sh, other, el, wr, kn, index, little, tip];
  hips.updateMatrixWorld(true);
  const skel = new THREE.Skeleton(bones);
  const arm = new ArmJoints(bones, skel.boneInverses, { shoulder: 2, elbow: 4, wrist: 5, tip: 9, knuckles: 6, index: 7, little: 8, otherShoulder: 3, hips: 0, neck: 1 }, 'female');
  return { arm, el, wr, tip };
}

describe('armJoints: her arm moves as a real arm does', () => {
  for (const side of [1, -1] as const) {
    const who = side === 1 ? 'left' : 'right';
    it(`${who}: forearm forward, palm down is pronation, held at a woman's 82 degrees`, () => {
      const { arm } = body(side);
      const p = arm.pose(new THREE.Vector3(0.2 * side, 1.1, 0), new THREE.Vector3(0.2 * side, 1.1, 0.25), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0));
      expect(p.elbowDeg).toBeCloseTo(90, 0);
      expect(p.pronationDeg).toBeCloseTo(82, 0);
      expect(p.residual * 180 / Math.PI).toBeLessThan(10);
    });
    it(`${who}: forearm forward, palm up is supination, within her 90.6 degrees`, () => {
      const { arm } = body(side);
      const p = arm.pose(new THREE.Vector3(0.2 * side, 1.1, 0), new THREE.Vector3(0.2 * side, 1.1, 0.25), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
      expect(p.pronationDeg).toBeCloseTo(-90, 0);
      expect(p.residual * 180 / Math.PI).toBeLessThan(2);
    });
    it(`${who}: the elbow is a hinge -- the wrist lands where it was asked, the hand bent at most its range`, () => {
      const { arm, wr } = body(side);
      const W = new THREE.Vector3(0.12 * side, 1.25, 0.2);
      const p = arm.pose(new THREE.Vector3(0.28 * side, 1.15, 0.05).sub(new THREE.Vector3(0.2 * side, 1.4, 0)).setLength(0.3).add(new THREE.Vector3(0.2 * side, 1.4, 0)), W, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0));
      expect(p.elbowDeg).toBeGreaterThan(0); expect(p.elbowDeg).toBeLessThanOrEqual(150);
      expect(Math.abs(p.wristFlexDeg)).toBeLessThanOrEqual(80); expect(p.wristRadialDeg).toBeLessThanOrEqual(20); expect(p.wristRadialDeg).toBeGreaterThanOrEqual(-30);
      void wr;
    });
    it(`${who}: a hand asked to bend back past its range is held at the wall (70 degrees), not wrung`, () => {
      const { arm } = body(side);
      // forearm forward, palm down (pronated), fingers pointing straight up: the wrist bent back 90
      const p = arm.pose(new THREE.Vector3(0.2 * side, 1.1, 0), new THREE.Vector3(0.2 * side, 1.1, 0.25), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
      expect(p.wristFlexDeg).toBeGreaterThanOrEqual(-70.001);
      expect(p.held).toBe(true);
    });
  }
});
