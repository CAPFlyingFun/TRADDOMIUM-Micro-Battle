import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FollowCamera } from '../src/camera/FollowCamera';
import type { LookInput } from '../src/input/LookDrag';

/**
 * She faces +Z, so the camera rests at -Z looking along +Z.
 *
 * In that frame the viewer's RIGHT is world -X: three.js cameras look
 * down their local -Z, so local +Z is world -Z, and local +X (screen
 * right) = localY x localZ = (0,1,0) x (0,0,-1) = (-1,0,0).
 */
function antFacingNorth(): THREE.Object3D {
  const ant = new THREE.Object3D();
  ant.position.set(0, 0, 0);
  ant.rotation.y = 0;
  return ant;
}

function look(over: Partial<LookInput> = {}): LookInput {
  return { yaw: 0, pitch: 0, active: true, ...over };
}

/** Settle the camera on a look input and report where it ended up. */
function orbit(input: LookInput): THREE.Vector3 {
  const ant = antFacingNorth();
  const follow = new FollowCamera(2);
  follow.snapTo(ant);
  // Plenty of frames to converge on the desired spot.
  for (let i = 0; i < 400; i++) follow.update(ant, input, 1 / 60);
  return follow.camera.position.clone();
}

describe('the chase camera', () => {
  it('rests behind her', () => {
    const at = orbit(look({ active: false }));
    expect(at.z).toBeLessThan(-4);
    expect(Math.abs(at.x)).toBeLessThan(0.5);
    expect(at.y).toBeGreaterThan(0);
  });

  it('swings the opposite way to the drag', () => {
    // A drag travelling right reports positive yaw. On the device,
    // walking the camera the same way round read as backwards, so a
    // rightward drag must move the camera toward world +X — the
    // viewer's LEFT — and a leftward drag the other way.
    expect(orbit(look({ yaw: 0.6 })).x).toBeGreaterThan(1);
    expect(orbit(look({ yaw: -0.6 })).x).toBeLessThan(-1);
  });

  it('lifts toward top-down on positive pitch', () => {
    const level = orbit(look({ pitch: 0 }));
    const lifted = orbit(look({ pitch: 0.8 }));
    expect(lifted.y).toBeGreaterThan(level.y);
  });

  it('comes home when nothing is driving it', () => {
    expect(Math.abs(orbit(look({ yaw: 0, active: false })).x)).toBeLessThan(0.5);
  });
});
