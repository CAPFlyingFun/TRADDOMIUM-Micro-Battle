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
  it('sits on the bearing the view holds, not on her nose', () => {
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

describe('holding station on a moving queen', () => {
  /**
   * THE WIND BUG. A 4 mph wind moves her at 179 units a second —
   * two and a half times her own top airspeed — and the old camera,
   * lerping its world position, trailed thirty units upwind while
   * aiming at her, which pointed the view downwind whatever the stick
   * said. The camera must keep the same station relative to her at any
   * carry speed, because smoothing lives in offset space now.
   */
  it('keeps its station behind a queen carried by wind', () => {
    const ant = antFacingNorth();
    const follow = new FollowCamera(2);
    follow.snapTo(ant);
    const rest = follow.camera.position.clone().sub(ant.position);

    const input = look({ active: false });
    for (let i = 0; i < 400; i++) {
      ant.position.x += 179 / 60; // a 4 mph wind, at 60 fps
      follow.update(ant, input, 1 / 60);
    }
    const now = follow.camera.position.clone().sub(ant.position);
    // Same offset as at rest — no trail, however fast she is carried.
    expect(now.distanceTo(rest)).toBeLessThan(0.05);
  });

  it('keeps the view pointed past her, not back along the drift', () => {
    const ant = antFacingNorth();
    const follow = new FollowCamera(2);
    follow.snapTo(ant);
    const input = look({ active: false });
    for (let i = 0; i < 400; i++) {
      ant.position.x += 179 / 60;
      follow.update(ant, input, 1 / 60);
    }
    // The rest bearing puts the camera at -Z of her; carried east at
    // any speed, it must STAY at her -Z rather than falling to her -X
    // and staring east. The offset says which way the camera faces,
    // since it always aims at her.
    const offset = follow.camera.position.clone().sub(ant.position);
    expect(offset.z).toBeLessThan(-4);
    expect(Math.abs(offset.x)).toBeLessThan(0.5);
  });

  it('still eases a drag while she is being carried', () => {
    const ant = antFacingNorth();
    const follow = new FollowCamera(2);
    follow.snapTo(ant);
    // One frame of a hard drag: the offset must move toward the new
    // bearing but not arrive — that smoothing is what the lerp is FOR,
    // and holding station must not have thrown it away.
    const before = follow.camera.position.clone().sub(ant.position);
    follow.update(ant, look({ yaw: 1.2 }), 1 / 60);
    const after = follow.camera.position.clone().sub(ant.position);
    expect(after.distanceTo(before)).toBeGreaterThan(0.01);
    for (let i = 0; i < 400; i++) follow.update(ant, look({ yaw: 1.2 }), 1 / 60);
    const settled = follow.camera.position.clone().sub(ant.position);
    expect(settled.distanceTo(after)).toBeGreaterThan(0.5);
  });
});
