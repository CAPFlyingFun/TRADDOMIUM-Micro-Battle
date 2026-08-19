import { describe, expect, it } from 'vitest';
import { PlayerAnt } from '../src/ant/PlayerAnt';

/**
 * Camera parked behind the ant on -Z and looking at her, so the camera
 * looks along world +Z.
 *
 * Screen directions in that frame — this is what the stick must match:
 *   forward (away from camera) = world +Z
 *   the viewer's RIGHT         = world -X
 *
 * The right-hand one is the trap. three.js cameras look down their local
 * -Z, so a camera looking along world +Z has local +Z = world -Z, and its
 * local +X (screen right) = localY x localZ = (0,1,0) x (0,0,-1) = (-1,0,0).
 */
const CAMERA_BEHIND_YAW = Math.atan2(0, -7);

/** Hold one stick direction for a while and report where she ends up. */
function walk(move: { x: number; y: number }, seconds = 2): { x: number; z: number } {
  const ant = new PlayerAnt();
  ant.placeAt(0, 0);
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    ant.update(move, CAMERA_BEHIND_YAW, dt);
  }
  return { x: ant.root.position.x, z: ant.root.position.z };
}

describe('direct control steering', () => {
  it('walks away from the camera on stick forward', () => {
    const end = walk({ x: 0, y: 1 });
    expect(end.z).toBeGreaterThan(1);
    expect(Math.abs(end.x)).toBeLessThan(0.5);
  });

  it('walks toward the camera on stick back', () => {
    const end = walk({ x: 0, y: -1 });
    expect(end.z).toBeLessThan(-1);
  });

  it('walks to the viewer’s right on stick right', () => {
    const end = walk({ x: 1, y: 0 });
    expect(end.x).toBeLessThan(-1);
  });

  it('walks to the viewer’s left on stick left', () => {
    const end = walk({ x: -1, y: 0 });
    expect(end.x).toBeGreaterThan(1);
  });

  it('faces the way she travels', () => {
    const ant = new PlayerAnt();
    ant.placeAt(0, 0);
    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) ant.update({ x: 1, y: 0 }, CAMERA_BEHIND_YAW, dt);
    // Her local +Z is her nose; it should point the way she moved (-X).
    const nose = { x: Math.sin(ant.root.rotation.y), z: Math.cos(ant.root.rotation.y) };
    expect(nose.x).toBeLessThan(-0.9);
    expect(Math.abs(nose.z)).toBeLessThan(0.3);
  });
});
