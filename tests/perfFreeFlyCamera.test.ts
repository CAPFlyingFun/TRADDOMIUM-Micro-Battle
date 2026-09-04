/**
 * The free-fly camera against synthetic input snapshots. three's math runs
 * in node without a DOM, so this needs no jsdom.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { InputSnapshot, PointerState, TouchPoint } from '../src/input/Input';
import { DEFAULT_SPEED, FreeFlyCamera, headingOfYaw, yawForHeading } from '../src/perf/FreeFlyCamera';

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

function facing(cam: FreeFlyCamera): THREE.Vector3 {
  return cam.camera.getWorldDirection(new THREE.Vector3());
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
    expect(cam.readout()).toEqual({ x: 0, y: 0, z: 0, facing: Math.PI, speed: 20000 });
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

  it('twin-zone touch: a drag that starts on the left half moves, one on the right half looks', () => {
    const cam = rig();
    // Land on the left, then pull up a full stick radius: forward.
    cam.update(snap({ touches: [{ id: 1, x: 100, y: 300, dx: 0, dy: 0 }] }), 0.016);
    expect(cam.camera.position.length()).toBe(0);
    cam.update(snap({ touches: [{ id: 1, x: 100, y: 220, dx: 0, dy: -80 }] }), 1);
    expect(cam.camera.position.z).toBeCloseTo(-10, 6);
    expect(facing(cam).x).toBeCloseTo(0, 9);
    // Holding still keeps flying: it is a stick, not a wheel.
    cam.update(snap({ touches: [{ id: 1, x: 100, y: 220, dx: 0, dy: 0 }] }), 1);
    expect(cam.camera.position.z).toBeCloseTo(-20, 6);

    // A second finger on the right looks and does not move.
    const before = cam.camera.position.clone();
    cam.update(snap({ touches: [{ id: 2, x: 800, y: 200, dx: 150, dy: 0 }] }), 0.016);
    expect(facing(cam).x).toBeGreaterThan(0.3);
    expect(cam.camera.position.distanceTo(before)).toBeLessThan(1e-9);
  });

  it('a stick keeps its zone after crossing the middle, and a lifted finger is forgotten', () => {
    const cam = rig();
    cam.update(snap({ touches: [{ id: 7, x: 400, y: 200, dx: 0, dy: 0 }] }), 0.016);
    cam.update(snap({ touches: [{ id: 7, x: 600, y: 200, dx: 200, dy: 0 }] }), 1);
    expect(cam.camera.position.x).toBeCloseTo(10, 6);
    expect(facing(cam).x).toBeCloseTo(0, 9);

    cam.update(snap(), 0.016);
    // The same id landing on the right half is a new touch, and a look.
    cam.update(snap({ touches: [{ id: 7, x: 700, y: 200, dx: 100, dy: 0 }] }), 0.016);
    expect(facing(cam).x).toBeGreaterThan(0.2);
    expect(cam.camera.position.x).toBeCloseTo(10, 6);
  });

  it('a touch first seen mid-movement is anchored where it landed', () => {
    const cam = rig();
    cam.update(snap({ touches: [{ id: 3, x: 180, y: 200, dx: 80, dy: 0 }] }), 1);
    expect(cam.camera.position.x).toBeCloseTo(10, 6);
  });

  it('does not move on a zero or non-finite dt', () => {
    const cam = rig();
    cam.update(snap({ keys: ['KeyW'] }), 0);
    cam.update(snap({ keys: ['KeyW'] }), Number.NaN);
    cam.update(snap({ keys: ['KeyW'] }), -1);
    expect(cam.camera.position.length()).toBe(0);
  });
});
