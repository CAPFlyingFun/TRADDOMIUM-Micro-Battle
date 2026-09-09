/**
 * The follow camera against a fake target under node: distances in body
 * lengths, an orbit that returns behind, a handoff that never cuts, and
 * a near plane that rides the target's size. Then the orbit off the
 * body's up (Creature Lab D): out from a wall, under a ceiling, and
 * continuous across an edge.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AHEAD_LENGTHS, BACK_LENGTHS, DEPTH_RATIO, DRIFT_TAU_S, FollowCamera, HANDOFF_S, LOOK_HOLD_S, LOOK_RADIANS_PER_PIXEL,
  MAX_NEAR, MIN_NEAR, NEAR_OF_ORBIT, ORBIT_LENGTHS, UP_EASE_S, UP_LENGTHS, lookDeltaOf, type FollowTarget,
} from '../src/control/FollowCamera';
import { FACE_NORMALS, WORLD_UP, aheadOn, dot, headingOn, rotateBetween, vec3, type MutableVec3, type Vec3 } from '../src/creatures/surface';
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

// ---------------------------------------------------------------------------
// The orbit off the body's up (Creature Lab D)
// ---------------------------------------------------------------------------

const X: Vec3 = FACE_NORMALS[0];
const NY: Vec3 = FACE_NORMALS[3];

function onFace(wx: number, wz: number, height: number, heading: number, up: Vec3, lengthUnits: number): FollowTarget {
  return { at: world(wx, wz), height, heading, up, lengthUnits };
}

function v(): MutableVec3 {
  return { x: 0, y: 0, z: 0 };
}

/** The camera's own right in world space: level when the look-at is about the world's up, whatever the face. */
function pictureRight(cam: FollowCamera): THREE.Vector3 {
  return new THREE.Vector3(1, 0, 0).applyQuaternion(cam.camera.quaternion);
}

describe('FollowCamera: on a wall and under a ceiling', () => {
  it('on the ground the eased up is WORLD_UP exactly and wantedLook is (sin h, 0, cos h) to the bit', () => {
    const t = target(0, 0, 100, 1.3, QUEEN);
    const cam = rig(t);
    run(cam, t, 2);
    const l = cam.wantedLook(v());
    expect(l.x).toBe(Math.sin(1.3));
    expect(l.y).toBe(0);
    expect(l.z).toBe(Math.cos(1.3));
  });

  it('on a wall (up = +x) the eye is UP_LENGTHS out along the normal and BACK_LENGTHS behind along the face', () => {
    // Heading 0 on the +x face is ahead +z (aheadOn(+x, 0) = (0, 0, 1)); the wall's own "up the wall" is +y.
    const along = onFace(10, -5, 100, 0, X, QUEEN);
    const cam = rig(along);
    const p = cam.camera.position;
    expect(p.x).toBeCloseTo(10 + UP_LENGTHS * QUEEN, 6);
    expect(p.y).toBeCloseTo(100, 6);
    expect(p.z).toBeCloseTo(-5 - BACK_LENGTHS * QUEEN, 6);

    const upTheWall = headingOn(X, vec3(0, 1, 0));
    const climbing = onFace(10, -5, 100, upTheWall, X, QUEEN);
    const cam2 = rig(climbing);
    const q = cam2.camera.position;
    expect(q.x).toBeCloseTo(10 + UP_LENGTHS * QUEEN, 6);
    expect(q.y).toBeCloseTo(100 - BACK_LENGTHS * QUEEN, 6);
    expect(q.z).toBeCloseTo(-5, 6);
    // Aimed a length ahead along the face, at the body's own height off it.
    const want = new THREE.Vector3(10, 100 + AHEAD_LENGTHS * QUEEN, -5).sub(q).normalize();
    const got = facing(cam2);
    expect(got.x).toBeCloseTo(want.x, 6);
    expect(got.y).toBeCloseTo(want.y, 6);
    expect(got.z).toBeCloseTo(want.z, 6);
    // The picture does not roll: the look-at is still about the world's up, so the screen's right is level.
    expect(Math.abs(pictureRight(cam2).y)).toBeLessThan(1e-6);
  });

  it('wantedLook on a wall is a unit vector tangent to the eased up', () => {
    const cam = rig(onFace(0, 0, 100, 0.8, X, QUEEN));
    cam.update(DT, onFace(0, 0, 100, 0.8, X, QUEEN), { dx: 200, dy: 0 });
    const l = cam.wantedLook(v());
    expect(Math.hypot(l.x, l.y, l.z)).toBeCloseTo(1, 12);
    expect(Math.abs(dot(l, X))).toBeLessThan(1e-12);
  });

  it('the orbit on a wall turns about the wall\'s normal: a drag keeps the eye the same distance out from the wall', () => {
    const t = onFace(0, 0, 100, 0, X, QUEEN);
    const cam = rig(t);
    cam.update(DT, t, { dx: (Math.PI / 2) / LOOK_RADIANS_PER_PIXEL, dy: 0 });
    run(cam, t, 0.5);
    const p = cam.camera.position;
    expect(p.x).toBeCloseTo(UP_LENGTHS * QUEEN, 3);
    expect(p.distanceTo(new THREE.Vector3(0, 100, 0))).toBeCloseTo(ORBIT_LENGTHS * QUEEN, 6);
    // A quarter turn clockwise about +x from ahead +z: the lens is now off along the face's other axis.
    expect(Math.hypot(p.y - 100, p.z)).toBeCloseTo(BACK_LENGTHS * QUEEN, 2);
    expect(Math.abs(p.z)).toBeLessThan(0.02);
  });

  it('on the ceiling (up = −y) the eye hangs below the body, and the picture stays upright — the ant is the one upside down', () => {
    // Heading 0 on the ceiling is ahead −z (the fixed half turn about +x).
    const t = onFace(3, 4, 100, 0, NY, QUEEN);
    const cam = rig(t);
    const p = cam.camera.position;
    expect(p.x).toBeCloseTo(3, 6);
    expect(p.y).toBeCloseTo(100 - UP_LENGTHS * QUEEN, 6);
    expect(p.z).toBeCloseTo(4 + BACK_LENGTHS * QUEEN, 6);
    expect(facing(cam).y).toBeGreaterThan(0);
    expect(Math.abs(pictureRight(cam).y)).toBeLessThan(1e-6);
    const l = cam.wantedLook(v());
    expect(l.y).toBeCloseTo(0, 12);
    expect(l.z).toBeCloseTo(-1, 12);
  });

  it('a target with an up that is not a number is refused, and the last pose stands', () => {
    const t = target(0, 0, 100, 0, QUEEN);
    const cam = rig(t);
    const before = cam.camera.position.clone();
    cam.update(DT, onFace(5, 5, 100, 0, vec3(NaN, 0, 0), QUEEN));
    expect(cam.camera.position.distanceTo(before)).toBe(0);
  });
});

describe('FollowCamera: crossing an edge', () => {
  /** The heading the integrator gives a body whose up went from `from` to `to`: its ahead carried by the same rotation. */
  function carried(from: Vec3, to: Vec3, heading: number): number {
    const ahead = aheadOn(from, heading, v());
    return headingOn(to, rotateBetween(from, to, ahead, v()));
  }

  it('the eye moves by less than the orbit in the first frame, the look is continuous, and it settles within a second', () => {
    // Walking east (+x) along the top of the block, then over its east edge onto the +x wall, straight down.
    const top = target(0, 0, 120, Math.PI / 2, QUEEN);
    const cam = rig(top);
    run(cam, top, 2);
    const before = cam.camera.position.clone();
    const lookBefore = cam.wantedLook(v());

    const wall = onFace(0, 0, 120, carried(WORLD_UP, X, Math.PI / 2), X, QUEEN);
    cam.update(DT, wall);
    const first = cam.camera.position.distanceTo(before);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(ORBIT_LENGTHS * QUEEN * 0.2);
    const lookAfter = cam.wantedLook(v());
    // One frame's share of a right angle at UP_EASE_S: 6.5% of it, a tenth of a radian.
    const share = (Math.PI / 2) * (1 - Math.exp(-DT / UP_EASE_S));
    expect(Math.acos(Math.min(1, dot(lookBefore, lookAfter)))).toBeLessThan(share * 1.05);

    // Every following frame turns the look by a smaller step still, never a jump, and the eye never leaves the orbit.
    let previous = lookAfter;
    for (let i = 0; i < 60; i += 1) {
      cam.update(DT, wall);
      const now = cam.wantedLook(v());
      expect(Math.acos(Math.min(1, dot(previous, now)))).toBeLessThan(share * 1.05);
      expect(Math.hypot(now.x, now.y, now.z)).toBeCloseTo(1, 12);
      expect(cam.camera.position.distanceTo(new THREE.Vector3(0, 120, 0))).toBeCloseTo(ORBIT_LENGTHS * QUEEN, 6);
      previous = now;
    }

    // A second in: four time constants, under two degrees of the right angle left — within a fifth of a length of
    // the wall's rest pose, out along +x and behind (above) the body walking down.
    const rest = new THREE.Vector3(UP_LENGTHS * QUEEN, 120 + BACK_LENGTHS * QUEEN, 0);
    expect(cam.camera.position.distanceTo(rest)).toBeLessThan(0.2 * QUEEN);
    run(cam, wall, 2);
    expect(cam.camera.position.distanceTo(rest)).toBeLessThan(1e-3 * QUEEN);
    // And the wanted look runs down the wall: the way the body is walking.
    const settled = cam.wantedLook(v());
    expect(settled.y).toBeCloseTo(-1, 3);
  });

  it('re-expresses a held orbit in the new frame, so a drag survives the edge', () => {
    const top = target(0, 0, 120, Math.PI / 2, QUEEN);
    const cam = rig(top);
    // Orbit a quarter turn round, then hold it by dragging every frame a little.
    cam.update(DT, top, { dx: (Math.PI / 2) / LOOK_RADIANS_PER_PIXEL, dy: 0 });
    run(cam, top, 0.5);
    const yawBefore = cam.yaw;
    const onWall = carried(WORLD_UP, X, Math.PI / 2);
    const wall = onFace(0, 0, 120, onWall, X, QUEEN);
    const eyeBefore = cam.camera.position.clone();
    cam.update(DT, wall);
    // From the ground onto any face the re-expressed number is the number itself: R(+y → up) IS the face's basis.
    expect(cam.yaw).toBeCloseTo(yawBefore, 9);
    // And the eye moved by one frame's share of the edge, not by the edge.
    expect(cam.camera.position.distanceTo(eyeBefore)).toBeLessThan(ORBIT_LENGTHS * QUEEN * 0.15);
    run(cam, wall, 2);

    // Wall to ceiling is not the number itself: a bearing of 0 on the +x face (ahead +z) carried onto the
    // ceiling reads π there — and the residual is what keeps the look from jumping by that.
    expect(carried(X, NY, 0)).toBeCloseTo(Math.PI, 9);
    const ceiling = onFace(0, 0, 112, carried(X, NY, onWall), NY, QUEEN);
    const lookBefore = cam.wantedLook(v());
    const eyeOnWall = cam.camera.position.clone();
    cam.update(DT, ceiling);
    const lookAfter = cam.wantedLook(v());
    const share = (Math.PI / 2) * (1 - Math.exp(-DT / UP_EASE_S));
    expect(Math.acos(Math.min(1, dot(lookBefore, lookAfter)))).toBeLessThan(share * 1.05);
    // The body's reference point dropped 8 units with it; the eye's own move is that plus a share of the turn.
    expect(cam.camera.position.distanceTo(eyeOnWall)).toBeLessThan(8 + ORBIT_LENGTHS * QUEEN * 0.15);
    // And it settles under the ceiling: below the body, the picture level.
    run(cam, ceiling, 3);
    expect(cam.camera.position.y).toBeCloseTo(112 - UP_LENGTHS * QUEEN, 3);
    expect(Math.abs(pictureRight(cam).y)).toBeLessThan(1e-6);
  });

  it('retarget snaps the up to the new creature\'s; the handoff blend covers the eye', () => {
    const cam = rig(target(0, 0, 100, 0, QUEEN));
    const wall = onFace(20, 20, 110, 0, X, APHID);
    cam.retarget(wall);
    expect(cam.blending).toBe(true);
    const l = cam.wantedLook(v());
    expect(Math.abs(dot(l, X))).toBeLessThan(1e-12);
    run(cam, wall, HANDOFF_S + DT);
    expect(cam.blending).toBe(false);
    expect(cam.camera.position.x).toBeCloseTo(20 + UP_LENGTHS * APHID, 6);
    expect(cam.camera.position.z).toBeCloseTo(20 - BACK_LENGTHS * APHID, 6);
  });
});
