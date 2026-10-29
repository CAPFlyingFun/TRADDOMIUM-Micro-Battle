import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { JointTurn, MutableJointTurn } from '../src/actor/humanRig';
import { blendJointTurns, SIT_SECONDS, sitEase, stepSit } from '../src/sarahlab/poseBlend';

const turn = (joint: number, ax: number, ay: number, az: number, radians: number): JointTurn => ({ joint, ax, ay, az, radians });
const quat = (t: JointTurn | undefined) => {
  if (!t || t.radians === 0) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(t.ax, t.ay, t.az).normalize(), t.radians);
};
const same = (a: THREE.Quaternion, b: THREE.Quaternion) => Math.abs(a.dot(b));

describe('standing to seated as a five-second move', () => {
  it('takes SIT_SECONDS each way and stops at the pose', () => {
    expect(SIT_SECONDS).toBe(5);
    let a = 0, frames = 0;
    while (a < 1 && frames < 10_000) { a = stepSit(a, 1, 1 / 60); frames++; }
    expect(frames).toBeGreaterThanOrEqual(299);
    expect(frames).toBeLessThanOrEqual(301);
    expect(stepSit(1, 1, 1)).toBe(1);
    expect(stepSit(1, 0, 2.5)).toBeCloseTo(0.5, 6);
    expect(stepSit(0.2, 0, 5)).toBe(0);
    expect(stepSit(0.4, 1, Number.NaN)).toBe(0.4);
  });

  it('eases in and out: still at both ends, halfway at half time', () => {
    expect(sitEase(0)).toBe(0);
    expect(sitEase(1)).toBe(1);
    expect(sitEase(0.5)).toBeCloseTo(0.5, 9);
    expect(sitEase(0.01)).toBeLessThan(0.001);
    expect(1 - sitEase(0.99)).toBeLessThan(0.001);
    expect(sitEase(-1)).toBe(0);
    expect(sitEase(2)).toBe(1);
  });

  it('turns each joint the short way from one pose to the other, a joint one pose leaves out at its bind', () => {
    const stand = [turn(1, 1, 0, 0, 0.2), turn(2, 0, 0, 1, -0.3)];
    const sit = [turn(1, 1, 0, 0, 1.6), turn(3, 0, 1, 0, 0.9)];
    const out: MutableJointTurn[] = [];
    const at = (t: number) => new Map(blendJointTurns(stand, sit, t, out).map((x) => [x.joint, { ...x }]));
    const start = at(0), end = at(1), mid = at(0.5);
    expect([...start.keys()].sort()).toEqual([1, 2, 3]);
    for (const j of [1, 2, 3]) {
      expect(same(quat(start.get(j)), quat(stand.find((x) => x.joint === j)))).toBeCloseTo(1, 6);
      expect(same(quat(end.get(j)), quat(sit.find((x) => x.joint === j)))).toBeCloseTo(1, 6);
    }
    // halfway: joint 1 about x by 0.9 rad, joint 2 half its turn back to bind, joint 3 half its turn
    expect(same(quat(mid.get(1)), quat(turn(1, 1, 0, 0, 0.9)))).toBeCloseTo(1, 6);
    expect(same(quat(mid.get(2)), quat(turn(2, 0, 0, 1, -0.15)))).toBeCloseTo(1, 6);
    expect(same(quat(mid.get(3)), quat(turn(3, 0, 1, 0, 0.45)))).toBeCloseTo(1, 6);
  });
});
