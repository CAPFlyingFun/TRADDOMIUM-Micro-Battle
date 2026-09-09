/**
 * The follow camera against a fake target under node: distances in body
 * lengths, an orbit that returns behind, a handoff that never cuts, and
 * a near plane that rides the target's size.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AHEAD_LENGTHS, BACK_LENGTHS, DEPTH_RATIO, DRIFT_TAU_S, FollowCamera, HANDOFF_S, LOOK_HOLD_S, LOOK_RADIANS_PER_PIXEL,
  MAX_NEAR, MIN_NEAR, NEAR_OF_ORBIT, ORBIT_LENGTHS, UP_LENGTHS, lookDeltaOf, type FollowTarget,
} from '../src/control/FollowCamera';
import { WORLD_UP } from '../src/creatures/surface';
import type { InputSnapshot } from '../src/input/Input';
import { yawForHeading } from '../src/perf/FreeFlyCamera';
import { world } from '../src/world/coords';
import { setOrigin } from '../src/world/origin';

const DT = 1 / 60;
/** The queen's 8 mm, world units. */
const QUEEN = 0.8;
/** The aphid's 1.4 mm. */
const APHID = 0.14;

function target(wx: number, wz: number, height: number, heading: number, lengthUnits: number): FollowTarget {
  return { at: world(wx, wz), height, heading, up: WORLD_UP, lengthUnits };
}

/** A 932 × 430 phone, snapped onto a target. */
function rig(t: FollowTarget): FollowCamera {
  const cam = new FollowCamera();
  cam.resize(932, 430);
  cam.retarget(t);
  cam.update(DT, t);
  return cam;
}

/** Run `seconds` of frames with no look. */
function run(cam: FollowCamera, t: FollowTarget, seconds: number): void {
  const frames = Math.ceil(seconds / DT);
  for (let i = 0; i < frames; i += 1) cam.update(DT, t);
}

function facing(cam: FollowCamera): THREE.Vector3 {
  return cam.camera.getWorldDirection(new THREE.Vector3());
}

/** Where the eye should rest for a target: behind along its heading, up, in ITS lengths. */
function restEye(t: FollowTarget): THREE.Vector3 {
  const L = t.lengthUnits;
  return new THREE.Vector3(
    t.at.wx - Math.sin(t.heading) * BACK_LENGTHS * L,
    t.height + UP_LENGTHS * L,
    t.at.wz - Math.cos(t.heading) * BACK_LENGTHS * L,
  );
}

beforeEach(() => {
  setOrigin(world(0, 0));
});

describe('FollowCamera: the rest pose, in body lengths', () => {
  it('stands four lengths behind and one and a half above, whatever the size', () => {
    for (const L of [QUEEN, APHID, 15]) {
      const t = target(10, -5, 100, 0, L);
      const cam = rig(t);
      const p = cam.camera.position;
      expect(p.x).toBeCloseTo(10, 6);
      expect(p.y).toBeCloseTo(100 + UP_LENGTHS * L, 6);
      expect(p.z).toBeCloseTo(-5 - BACK_LENGTHS * L, 6);
    }
  });

  it('is behind along the creature\'s heading', () => {
    const t = target(0, 0, 100, Math.PI / 2, QUEEN);
    const cam = rig(t);
    const want = restEye(t);
    expect(cam.camera.position.x).toBeCloseTo(want.x, 6);
    expect(cam.camera.position.z).toBeCloseTo(want.z, 6);
  });

  it('is aimed a length ahead of the creature, at its height, about world up', () => {
    const t = target(3, 4, 100, 0.9, QUEEN);
    const cam = rig(t);
    const aim = new THREE.Vector3(3 + Math.sin(0.9) * AHEAD_LENGTHS * QUEEN, 100, 4 + Math.cos(0.9) * AHEAD_LENGTHS * QUEEN);
    const want = aim.sub(cam.camera.position).normalize();
    const got = facing(cam);
    expect(got.x).toBeCloseTo(want.x, 6);
    expect(got.y).toBeCloseTo(want.y, 6);
    expect(got.z).toBeCloseTo(want.z, 6);
    // No roll: the camera's own up has no sideways lean.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.camera.quaternion);
    const side = new THREE.Vector3().crossVectors(got, new THREE.Vector3(0, 1, 0)).normalize();
    expect(Math.abs(up.dot(side))).toBeLessThan(1e-6);
  });

  it('the orbit radius is the rest offset\'s length', () => {
    expect(ORBIT_LENGTHS).toBeCloseTo(Math.hypot(4, 1.5), 12);
  });

  it('follows the position rigidly: a body moving at a metre a second keeps its camera behind it', () => {
    const t0 = target(0, 0, 100, 0, QUEEN);
    const cam = rig(t0);
    // 100 units a second along +z, one frame at a time, for a second.
    let z = 0;
    for (let i = 0; i < 60; i += 1) {
      z += 100 * DT;
      cam.update(DT, target(0, z, 100, 0, QUEEN));
    }
    expect(cam.camera.position.z).toBeCloseTo(z - BACK_LENGTHS * QUEEN, 6);
  });

  it('yaw is the free-fly convention for the creature\'s heading at rest', () => {
    const t = target(0, 0, 100, 1.3, QUEEN);
    const cam = rig(t);
    expect(cam.yaw).toBeCloseTo(yawForHeading(1.3), 9);
  });
});

describe('FollowCamera: the orbit', () => {
  it('a drag right swings the eye round the creature, and the yaw says so at once', () => {
    const t = target(0, 0, 100, 0, QUEEN);
    const cam = rig(t);
    const quarter = (Math.PI / 2) / LOOK_RADIANS_PER_PIXEL;
    cam.update(DT, t, { dx: quarter, dy: 0 });
    // The wanted bearing is a quarter turn clockwise: heading −π/2.
    expect(cam.yaw).toBeCloseTo(yawForHeading(-Math.PI / 2), 6);
    // The lens eases onto it: within half a second it is to the creature's +x side.
    run(cam, t, 0.5);
    expect(cam.camera.position.x).toBeCloseTo(BACK_LENGTHS * QUEEN, 2);
    expect(Math.abs(cam.camera.position.z)).toBeLessThan(0.01);
  });

  it('holds the orbit through the hold, then drifts back behind the creature', () => {
    const t = target(0, 0, 100, 0, QUEEN);
    const cam = rig(t);
    cam.update(DT, t, { dx: (Math.PI / 2) / LOOK_RADIANS_PER_PIXEL, dy: 0 });
    run(cam, t, LOOK_HOLD_S * 0.9);
    // Still round the side, nothing drifted.
    expect(cam.yaw).toBeCloseTo(yawForHeading(-Math.PI / 2), 6);
    // Ten time constants: e^−10 of a quarter turn is under a tenth of a milliradian.
    run(cam, t, LOOK_HOLD_S * 0.1 + DRIFT_TAU_S * 10);
    const rest = restEye(t);
    expect(cam.camera.position.x).toBeCloseTo(rest.x, 2);
    expect(cam.camera.position.z).toBeCloseTo(rest.z, 2);
    expect(cam.yaw).toBeCloseTo(yawForHeading(0), 3);
  });

  it('a drag down looks further down, so the eye rises; invertY reads it the other way', () => {
    const t = target(0, 0, 100, 0, QUEEN);
    const cam = rig(t);
    const restY = cam.camera.position.y;
    cam.update(DT, t, { dx: 0, dy: 120 });
    run(cam, t, 0.5);
    expect(cam.camera.position.y).toBeGreaterThan(restY + 0.1);
    // And looking down more: the facing's y is more negative.
    expect(facing(cam).y).toBeLessThan(-Math.sin(Math.atan2(UP_LENGTHS, BACK_LENGTHS)) + 0.01);

    const flipped = rig(t);
    flipped.setLook({ sensitivity: 1, invertY: true });
    flipped.update(DT, t, { dx: 0, dy: 120 });
    run(flipped, t, 0.5);
    expect(flipped.camera.position.y).toBeLessThan(restY);
  });

  it('never goes under the creature\'s plane and never straight over it', () => {
    const t = target(0, 0, 100, 0, QUEEN);
    const cam = rig(t);
    cam.update(DT, t, { dx: 0, dy: -100_000 });
    run(cam, t, 0.5);
    expect(cam.camera.position.y).toBeGreaterThan(100);
    cam.update(DT, t, { dx: 0, dy: 100_000 });
    run(cam, t, 0.5);
    const p = cam.camera.position;
    expect(Math.hypot(p.x, p.z)).toBeGreaterThan(0.01);
  });

  it('the keeps the animal the same size on the screen at every elevation', () => {
    const t = target(0, 0, 100, 0, QUEEN);
    const cam = rig(t);
    const before = cam.camera.position.distanceTo(new THREE.Vector3(0, 100, 0));
    cam.update(DT, t, { dx: 0, dy: 150 });
    run(cam, t, 1);
    const after = cam.camera.position.distanceTo(new THREE.Vector3(0, 100, 0));
    expect(after).toBeCloseTo(before, 6);
    expect(before).toBeCloseTo(ORBIT_LENGTHS * QUEEN, 6);
  });

  it('a look that is not a number is no look', () => {
    const t = target(0, 0, 100, 0, QUEEN);
    const cam = rig(t);
    cam.update(DT, t, { dx: NaN, dy: Infinity });
    run(cam, t, 0.2);
    const rest = restEye(t);
    expect(cam.camera.position.x).toBeCloseTo(rest.x, 6);
    expect(cam.camera.position.z).toBeCloseTo(rest.z, 6);
  });
});

describe('FollowCamera: the handoff', () => {
  it('the first target is snapped to, never blended from the origin', () => {
    const t = target(50, 50, 100, 0, QUEEN);
    const cam = new FollowCamera();
    cam.retarget(t);
    expect(cam.blending).toBe(false);
    cam.update(DT, t);
    const rest = restEye(t);
    expect(cam.camera.position.x).toBeCloseTo(rest.x, 6);
    expect(cam.camera.position.z).toBeCloseTo(rest.z, 6);
  });

  it('blends from the old pose to the new one over HANDOFF_S with a bounded, zero-start derivative', () => {
    const a = target(0, 0, 100, 0, QUEEN);
    const b = target(30, 10, 100, 1, APHID);
    const cam = rig(a);
    const start = cam.camera.position.clone();
    const end = restEye(b);
    const span = start.distanceTo(end);
    expect(span).toBeGreaterThan(20);

    cam.retarget(b);
    expect(cam.blending).toBe(true);
    // The yaw the thumbs steer toward is the new creature's at once.
    expect(cam.yaw).toBeCloseTo(yawForHeading(1), 9);

    let previous = start.clone();
    let first = -1;
    let largest = 0;
    const frames = Math.ceil(HANDOFF_S / DT) + 2;
    for (let i = 0; i < frames; i += 1) {
      cam.update(DT, b);
      const step = cam.camera.position.distanceTo(previous);
      if (first < 0) first = step;
      largest = Math.max(largest, step);
      previous = cam.camera.position.clone();
    }
    // Smoothstep: no movement on the first frame, and never faster than 1.5× the mean.
    expect(first).toBeLessThan(span * 0.01);
    expect(largest).toBeLessThanOrEqual((1.5 * span / HANDOFF_S) * DT * 1.05);
    expect(cam.blending).toBe(false);
    expect(cam.camera.position.x).toBeCloseTo(end.x, 6);
    expect(cam.camera.position.y).toBeCloseTo(end.y, 6);
    expect(cam.camera.position.z).toBeCloseTo(end.z, 6);
  });

  it('the near plane crosses over continuously during the blend', () => {
    const a = target(0, 0, 100, 0, 15);
    const b = target(5, 5, 100, 0, APHID);
    const cam = rig(a);
    const from = cam.camera.near;
    cam.retarget(b);
    let last = from;
    const frames = Math.ceil(HANDOFF_S / DT) + 1;
    for (let i = 0; i < frames; i += 1) {
      cam.update(DT, b);
      expect(cam.camera.near).toBeLessThanOrEqual(last + 1e-9);
      last = cam.camera.near;
    }
    expect(cam.camera.near).toBeCloseTo(MIN_NEAR, 9);
  });

  it('a target with a number missing is refused, and the last pose stands', () => {
    const t = target(0, 0, 100, 0, QUEEN);
    const cam = rig(t);
    const before = cam.camera.position.clone();
    cam.retarget({ at: world(NaN, 0), height: 100, heading: 0, up: WORLD_UP, lengthUnits: QUEEN });
    cam.update(DT, { at: world(1, 1), height: 100, heading: 0, up: WORLD_UP, lengthUnits: 0 });
    expect(cam.blending).toBe(false);
    expect(cam.camera.position.distanceTo(before)).toBe(0);
  });
});

describe('FollowCamera: the near plane rides the target\'s size', () => {
  it('an aphid\'s glass is the floor, and the far plane the fixed ratio beyond it', () => {
    const cam = rig(target(0, 0, 100, 0, APHID));
    expect(cam.camera.near).toBe(MIN_NEAR);
    expect(cam.camera.far).toBeCloseTo(MIN_NEAR * DEPTH_RATIO, 6);
    // 5 mm behind it: four lengths of 1.4 mm.
    expect(cam.camera.position.distanceTo(new THREE.Vector3(0, 100, 0))).toBeCloseTo(ORBIT_LENGTHS * APHID, 9);
  });

  it('a queen\'s already rides above the floor, and a large target\'s rises with its orbit', () => {
    const queen = rig(target(0, 0, 100, 0, QUEEN));
    expect(queen.camera.near).toBeCloseTo(ORBIT_LENGTHS * QUEEN * NEAR_OF_ORBIT, 9);
    expect(queen.camera.near).toBeGreaterThan(MIN_NEAR);
    const big = rig(target(0, 0, 100, 0, 10));
    expect(big.camera.near).toBeCloseTo(ORBIT_LENGTHS * 10 * NEAR_OF_ORBIT, 9);
    expect(big.camera.far).toBeCloseTo(big.camera.near * DEPTH_RATIO, 6);
  });

  it('and caps at the perf world\'s ceiling', () => {
    expect(rig(target(0, 0, 100, 0, 10_000)).camera.near).toBe(MAX_NEAR);
  });
});

describe('FollowCamera: pose, floor and clock', () => {
  it('pose() answers in WORLD coordinates whatever the floating origin', () => {
    setOrigin(world(4096, 2048));
    const t = target(4106, 2048, 100, 0, QUEEN);
    const cam = rig(t);
    expect(cam.camera.position.x).toBeCloseTo(10, 6);
    const pose = cam.pose();
    expect(pose.at.wx).toBeCloseTo(4106, 6);
    expect(pose.at.wz).toBeCloseTo(2048 - BACK_LENGTHS * QUEEN, 6);
    expect(pose.height).toBeCloseTo(100 + UP_LENGTHS * QUEEN, 6);
    // Looking along heading 0 is yaw π in the free-fly convention, tilted down onto the aim.
    expect(Math.abs(Math.abs(pose.yaw) - Math.PI)).toBeLessThan(1e-6);
    expect(pose.pitch).toBeCloseTo(-Math.atan2(UP_LENGTHS, BACK_LENGTHS + AHEAD_LENGTHS), 6);
    expect(cam.facing()).toBeCloseTo(0, 6);
  });

  it('holdAbove lifts the eye to a floor and re-aims; below the floor it leaves it', () => {
    const t = target(0, 0, 100, 0, QUEEN);
    const cam = rig(t);
    const y = cam.camera.position.y;
    cam.holdAbove(y - 1);
    expect(cam.camera.position.y).toBe(y);
    cam.holdAbove(y + 5);
    expect(cam.camera.position.y).toBe(y + 5);
    expect(facing(cam).y).toBeLessThan(-0.5);
    cam.holdAbove(NaN);
    expect(cam.camera.position.y).toBe(y + 5);
  });

  it('a dt that is not a positive number moves no angle but still places the lens on the target', () => {
    const t = target(0, 0, 100, 0, QUEEN);
    const cam = rig(t);
    cam.update(DT, t, { dx: (Math.PI / 2) / LOOK_RADIANS_PER_PIXEL, dy: 0 });
    const yaw = cam.yaw;
    const moved = target(7, 7, 100, 0, QUEEN);
    cam.update(NaN, moved);
    cam.update(0, moved);
    cam.update(-1, moved);
    expect(cam.yaw).toBe(yaw);
    // On the moved target's orbit, at the wanted bearing (the ease had no time to run, so wherever the lens was on it).
    expect(cam.camera.position.distanceTo(new THREE.Vector3(7, 100, 7))).toBeCloseTo(ORBIT_LENGTHS * QUEEN, 6);
  });

  it('lookDeltaOf sums the held pointer and every touch, and ignores a pointer that is up', () => {
    const snap = (down: boolean): InputSnapshot => ({
      keys: new Set(),
      pointer: { down, buttons: down ? 1 : 0, x: 0, y: 0, dx: 3, dy: -2 },
      touches: [{ id: 1, x: 0, y: 0, dx: 10, dy: 1 }, { id: 2, x: 0, y: 0, dx: -4, dy: 5 }],
      wheel: 0,
    });
    const out = { dx: 0, dy: 0 };
    expect(lookDeltaOf(snap(true), out)).toBe(out);
    expect(out).toEqual({ dx: 9, dy: 4 });
    lookDeltaOf(snap(false), out);
    expect(out).toEqual({ dx: 6, dy: 6 });
  });
});
