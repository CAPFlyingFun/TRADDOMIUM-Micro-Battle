/**
 * The free-fly camera against synthetic input snapshots. three's math runs
 * in node without a DOM, so this needs no jsdom.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { InputSnapshot, PointerState, TouchPoint } from '../src/input/Input';
import type { StickReading } from '../src/input/MoveStick';
import { DEFAULT_SPEED, FreeFlyCamera, STICK_MIN_SPEED, headingOfYaw, stickSpeed, yawForHeading } from '../src/perf/FreeFlyCamera';

const IDLE_POINTER: PointerState = { down: false, buttons: 0, x: 0, y: 0, dx: 0, dy: 0 };

interface SnapshotParts {
  readonly keys?: readonly string[];
  readonly pointer?: Partial<PointerState>;
  readonly touches?: readonly TouchPoint[];
  readonly wheel?: number;
}

function snap(parts: SnapshotParts = {}): InputSnapshot {
  return {
    keys: new Set(parts.keys ?? []),
    pointer: { ...IDLE_POINTER, ...parts.pointer },
    touches: parts.touches ?? [],
    wheel: parts.wheel ?? 0,
  };
}

/** A 932 × 430 phone, at the origin, looking down −Z, 10 units/s. */
function rig(): FreeFlyCamera {
  const cam = new FreeFlyCamera();
  cam.resize(932, 430);
  cam.place(0, 0, 0, 0, 0);
  cam.speed = 10;
  return cam;
}

/** The perf world's camera: 30 m/s, so the stick's curve reads in whole numbers. */
function flyRig(): FreeFlyCamera {
  const cam = rig();
  cam.speed = 3000;
  return cam;
}

function facing(cam: FreeFlyCamera): THREE.Vector3 {
  return cam.camera.getWorldDirection(new THREE.Vector3());
}

/** A stick reading as `MoveStick.read()` shapes one: (x, y) in the unit disc, deflection its length. */
function push(x: number, y: number): StickReading {
  return { x, y, deflection: Math.hypot(x, y), held: true };
}

describe('FreeFlyCamera', () => {
  it('starts at the default speed, with the aspect of its viewport', () => {
    const cam = new FreeFlyCamera();
    expect(cam.speed).toBe(DEFAULT_SPEED);
    cam.resize(932, 430);
    expect(cam.camera.aspect).toBeCloseTo(932 / 430, 9);
  });

  it('W flies along the view (−Z at yaw 0) at speed × dt, and Shift doubles it', () => {
    const cam = rig();
    cam.update(snap({ keys: ['KeyW'] }), 1);
    expect(cam.camera.position.z).toBeCloseTo(-10, 6);
    expect(cam.camera.position.x).toBeCloseTo(0, 9);
    expect(cam.camera.position.y).toBeCloseTo(0, 9);
    cam.update(snap({ keys: ['ArrowUp', 'ShiftLeft'] }), 1);
    expect(cam.camera.position.z).toBeCloseTo(-30, 6);
    cam.update(snap({ keys: ['KeyS'] }), 0.5);
    expect(cam.camera.position.z).toBeCloseTo(-25, 6);
  });

  it('strafes and lifts on the other keys, and a diagonal is no faster than a straight line', () => {
    const cam = rig();
    cam.update(snap({ keys: ['KeyD'] }), 1);
    expect(cam.camera.position.x).toBeCloseTo(10, 6);
    cam.update(snap({ keys: ['ArrowLeft'] }), 1);
    expect(cam.camera.position.x).toBeCloseTo(0, 6);
    cam.update(snap({ keys: ['Space'] }), 1);
    expect(cam.camera.position.y).toBeCloseTo(10, 6);
    cam.update(snap({ keys: ['KeyQ'] }), 1);
    expect(cam.camera.position.y).toBeCloseTo(0, 6);
    cam.update(snap({ keys: ['KeyE'] }), 1);
    cam.update(snap({ keys: ['KeyC'] }), 1);
    expect(cam.camera.position.y).toBeCloseTo(0, 6);

    cam.update(snap({ keys: ['KeyW', 'KeyD'] }), 1);
    expect(cam.camera.position.length()).toBeCloseTo(10, 6);
  });

  it('a mouse drag to the right turns the view to the right without moving; an unpressed pointer does nothing', () => {
    const cam = rig();
    cam.update(snap({ pointer: { down: false, dx: 200 } }), 0.016);
    expect(facing(cam).x).toBeCloseTo(0, 9);
    cam.update(snap({ pointer: { down: true, dx: 200, dy: 0 } }), 0.016);
    const dir = facing(cam);
    expect(dir.x).toBeGreaterThan(0.5);
    expect(dir.z).toBeLessThan(0);
    expect(cam.camera.position.length()).toBe(0);
    // Forward now follows the new view.
    cam.update(snap({ keys: ['KeyW'] }), 1);
    expect(cam.camera.position.x).toBeGreaterThan(5);
  });

  it('reports the pitch it is actually looking at, clamped like the camera itself', () => {
    // The HUD prints this and `npm run probe:shot` reads it back, so a
    // pitch that always answered zero would recreate every shot level
    // and look like the camera had moved rather than the readout lying.
    const cam = rig();
    cam.place(0, 0, 0, 0, -0.31);
    expect(cam.readout().pitch).toBeCloseTo(-0.31, 9);
    // Clamped by the same limit that keeps yaw from degenerating, so the
    // readout can never name a pose `place` would refuse to restore.
    cam.place(0, 0, 0, 0, 99);
    expect(cam.readout().pitch).toBeLessThan(Math.PI / 2);
    expect(cam.readout().pitch).toBeGreaterThan(1.4);
  });

  it('pitch stops short of vertical so yaw never degenerates', () => {
    const cam = rig();
    cam.update(snap({ pointer: { down: true, dx: 0, dy: -100000 } }), 0.016);
    const up = facing(cam);
    expect(up.y).toBeGreaterThan(0.99);
    expect(up.y).toBeLessThan(1);
    cam.update(snap({ pointer: { down: true, dx: 0, dy: 200000 } }), 0.016);
    const down = facing(cam);
    expect(down.y).toBeLessThan(-0.99);
    expect(down.y).toBeGreaterThan(-1);
  });

  it('the wheel scales speed by a fixed factor per notch, and the setter clamps', () => {
    const cam = rig();
    cam.update(snap({ wheel: -100 }), 0.016);
    expect(cam.speed).toBeCloseTo(12.5, 9);
    cam.update(snap({ wheel: 100 }), 0.016);
    expect(cam.speed).toBeCloseTo(10, 9);
    cam.speed = Number.NaN;
    expect(cam.speed).toBeCloseTo(10, 9);
    cam.speed = -5;
    expect(cam.speed).toBe(0.5);
    cam.speed = 1e9;
    expect(cam.speed).toBe(20000);
    // `facing` is the direction it LOOKS, as an actor heading: a camera at
    // yaw 0 looks down its own −Z, which is heading π in the world's terms.
    // DEEP-EQUAL ON PURPOSE: the readout is what `probe:shot` and the HUD
    // both read a pose out of, so a field appearing or quietly going away
    // is the thing worth failing on.
    expect(cam.readout()).toEqual({ x: 0, y: 0, z: 0, facing: Math.PI, pitch: 0, speed: 20000 });
  });

  it('reports the direction it LOOKS, not its yaw — the two are half a turn apart', () => {
    // A three camera looks down its own −Z; an actor's heading faces +wz.
    // Claiming the yaw raw pointed a player's capsule backwards on every
    // other screen, and left the practice bot off the edge of the frame
    // when the world tried to look at it.
    expect(headingOfYaw(0)).toBeCloseTo(Math.PI, 12);
    expect(headingOfYaw(Math.PI)).toBeCloseTo(0, 12);
    expect(headingOfYaw(Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 12);
    // Its own inverse: converting twice is where you started.
    for (const angle of [0, 0.3, -1.2, Math.PI / 2, 3]) {
      expect(headingOfYaw(yawForHeading(angle))).toBeCloseTo(angle, 12);
    }

    // And it agrees with the camera three actually renders: at this yaw
    // the camera's own forward vector points along the heading reported.
    const cam = rig();
    cam.place(0, 0, 0, 0.7, 0);
    const facing = cam.readout().facing;
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(cam.camera.rotation);
    expect(Math.atan2(forward.x, forward.z)).toBeCloseTo(facing, 9);
  });

  it('a touch drag on EITHER half of the screen looks and does not move', () => {
    // The twin-zone invisible stick is gone (2026-09-07): moving by thumb
    // is the visible MoveStick, whose events never reach the snapshot, so
    // every touch drag that does is a look — including one that starts on
    // the left, and one first seen already moving.
    const cam = rig();
    cam.update(snap({ touches: [{ id: 1, x: 100, y: 300, dx: 0, dy: 0 }] }), 1);
    expect(cam.camera.position.length()).toBe(0);
    expect(facing(cam).x).toBeCloseTo(0, 9);
    // Held still on the left, pulled up: no stick, so no flight and no turn.
    cam.update(snap({ touches: [{ id: 1, x: 100, y: 220, dx: 0, dy: 0 }] }), 1);
    expect(cam.camera.position.length()).toBe(0);

    cam.update(snap({ touches: [{ id: 1, x: 250, y: 220, dx: 150, dy: 0 }] }), 1);
    expect(facing(cam).x).toBeGreaterThan(0.3);
    expect(cam.camera.position.length()).toBe(0);

    const right = rig();
    right.update(snap({ touches: [{ id: 2, x: 800, y: 200, dx: 150, dy: 0 }] }), 1);
    expect(facing(right).x).toBeGreaterThan(0.3);
    expect(right.camera.position.length()).toBe(0);

    // Two fingers both look; neither moves.
    const both = rig();
    both.update(snap({ touches: [{ id: 3, x: 180, y: 200, dx: 80, dy: 0 }, { id: 4, x: 700, y: 200, dx: 70, dy: 0 }] }), 1);
    expect(facing(both).x).toBeGreaterThan(0.3);
    expect(both.camera.position.length()).toBe(0);
  });

  it('a full stick push flies along the view at the camera\'s own speed × dt, and a lifted stick stops', () => {
    const cam = flyRig();
    cam.update(snap(), 1, push(0, 1));
    expect(cam.camera.position.z).toBeCloseTo(-3000, 6);
    expect(cam.camera.position.x).toBeCloseTo(0, 9);
    expect(cam.camera.position.y).toBeCloseTo(0, 9);
    // Held still keeps flying: it is a stick, not a wheel.
    cam.update(snap(), 0.5, push(0, 1));
    expect(cam.camera.position.z).toBeCloseTo(-4500, 6);
    // A released reading, and no reading at all, both stop it.
    cam.update(snap(), 1, { x: 0, y: 0, deflection: 0, held: false });
    cam.update(snap(), 1, null);
    cam.update(snap(), 1);
    expect(cam.camera.position.z).toBeCloseTo(-4500, 6);
  });

  it('a half push flies at STICK_MIN_SPEED + (speed − STICK_MIN_SPEED) / 4: the curve is squared', () => {
    // GAME TUNING pinned: at 30 m/s a half push is 8.25 m/s, not 15.5. The
    // square is what gives the slow end room under a thumb.
    const cam = flyRig();
    cam.update(snap(), 1, push(0, 0.5));
    expect(cam.camera.position.z).toBeCloseTo(-(STICK_MIN_SPEED + (3000 - STICK_MIN_SPEED) / 4), 6);
    expect(cam.camera.position.z).toBeCloseTo(-825, 6);
    expect(stickSpeed(0.5, 3000)).toBeCloseTo(825, 9);
    expect(stickSpeed(0.25, 3000)).toBeCloseTo(281.25, 9);
    expect(stickSpeed(1, 3000)).toBe(3000);
    // Backwards is the same curve the other way.
    const back = flyRig();
    back.update(snap(), 1, push(0, -0.5));
    expect(back.camera.position.z).toBeCloseTo(825, 6);
  });

  it('the smallest live push is STICK_MIN_SPEED (1 m/s), and deflection 0 moves nothing', () => {
    const cam = flyRig();
    cam.update(snap(), 1, push(0, 0.001));
    expect(cam.camera.position.z).toBeCloseTo(-STICK_MIN_SPEED, 1);
    expect(STICK_MIN_SPEED).toBe(100);
    const still = flyRig();
    still.update(snap(), 1, { x: 0, y: 0, deflection: 0, held: true });
    expect(still.camera.position.length()).toBe(0);
    // A contradictory reading — pushed, but pointing nowhere — cannot move either.
    still.update(snap(), 1, { x: 0, y: 0, deflection: 1, held: true });
    expect(still.camera.position.length()).toBe(0);
  });

  it('a camera slower than the floor is capped at its own speed, never sped up by the floor', () => {
    const cam = rig(); // 10 units/s, well under STICK_MIN_SPEED
    cam.update(snap(), 1, push(0, 0.5));
    expect(cam.camera.position.z).toBeCloseTo(-10, 6);
    expect(stickSpeed(0.1, 10)).toBe(10);
  });

  it('a pure x push strafes right, and a diagonal splits the same speed between the two', () => {
    const cam = flyRig();
    cam.update(snap(), 1, push(1, 0));
    expect(cam.camera.position.x).toBeCloseTo(3000, 6);
    expect(cam.camera.position.z).toBeCloseTo(0, 9);
    const half = flyRig();
    half.update(snap(), 1, push(0.5, 0));
    expect(half.camera.position.x).toBeCloseTo(825, 6);
    const diagonal = flyRig();
    diagonal.update(snap(), 1, push(Math.SQRT1_2, Math.SQRT1_2));
    expect(diagonal.camera.position.length()).toBeCloseTo(3000, 6);
    expect(diagonal.camera.position.x).toBeCloseTo(diagonal.camera.position.z * -1, 6);
  });

  it('the stick is camera-relative: after a look, forward is the new view', () => {
    const cam = flyRig();
    cam.update(snap({ pointer: { down: true, dx: 200, dy: 0 } }), 0.016);
    const dir = facing(cam);
    cam.update(snap(), 1, push(0, 1));
    expect(cam.camera.position.x).toBeCloseTo(dir.x * 3000, 6);
    expect(cam.camera.position.z).toBeCloseTo(dir.z * 3000, 6);
  });

  it('the stick ignores Shift: a full push under boost is still one top speed', () => {
    const cam = flyRig();
    cam.update(snap({ keys: ['ShiftLeft'] }), 1, push(0, 1));
    expect(cam.camera.position.z).toBeCloseTo(-3000, 6);
    const half = flyRig();
    half.update(snap({ keys: ['ShiftRight'] }), 1, push(0, 0.5));
    expect(half.camera.position.z).toBeCloseTo(-825, 6);
  });

  it('keys and the stick add as vectors, and the planar sum never exceeds speed × boost', () => {
    // THE RULE, PINNED: W plus a full push is one top speed, not two; a
    // push against S subtracts; with Shift the ceiling is the boosted one.
    const cam = flyRig();
    cam.update(snap({ keys: ['KeyW'] }), 1, push(0, 1));
    expect(cam.camera.position.z).toBeCloseTo(-3000, 6);

    const against = flyRig();
    against.update(snap({ keys: ['KeyS'] }), 1, push(0, 1));
    expect(against.camera.position.length()).toBeCloseTo(0, 6);
    const partly = flyRig();
    partly.update(snap({ keys: ['KeyW'] }), 1, push(0, -0.5));
    expect(partly.camera.position.z).toBeCloseTo(-(3000 - 825), 6);

    const sideways = flyRig();
    sideways.update(snap({ keys: ['KeyD'] }), 1, push(0, 1));
    expect(sideways.camera.position.length()).toBeCloseTo(3000, 6);
    expect(sideways.camera.position.x).toBeCloseTo(-sideways.camera.position.z, 6);

    const boosted = flyRig();
    boosted.update(snap({ keys: ['KeyW', 'ShiftLeft'] }), 1, push(0, 1));
    expect(boosted.camera.position.z).toBeCloseTo(-6000, 6);

    // Lift rides on top, keyboard-only, as it always has.
    const lifted = flyRig();
    lifted.update(snap({ keys: ['Space'] }), 1, push(0, 1));
    expect(lifted.camera.position.z).toBeCloseTo(-3000, 6);
    expect(lifted.camera.position.y).toBeCloseTo(3000, 6);
  });

  it('does not move on a zero or non-finite dt, by key or by stick', () => {
    const cam = rig();
    cam.update(snap({ keys: ['KeyW'] }), 0);
    cam.update(snap({ keys: ['KeyW'] }), Number.NaN);
    cam.update(snap({ keys: ['KeyW'] }), -1);
    cam.update(snap(), 0, push(0, 1));
    cam.update(snap(), Number.NaN, push(0, 1));
    expect(cam.camera.position.length()).toBe(0);
  });
});
