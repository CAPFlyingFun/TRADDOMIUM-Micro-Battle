import { describe, expect, it } from 'vitest';
import { PlayerAnt, type Drive } from '../src/ant/PlayerAnt';
import { GAIT_SPEED, type Gait } from '../src/ant/gait';

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

const DT = 1 / 60;

function drive(over: Partial<Drive> = {}): Drive {
  return { move: { x: 0, y: 0 }, gait: 'walk', bearing: null, ...over };
}

/** Hold one stick direction for a while and report where she ends up. */
function walk(
  move: { x: number; y: number },
  seconds = 2,
  gait: Gait = 'walk',
): { x: number; z: number } {
  const ant = new PlayerAnt();
  ant.placeAt(0, 0);
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    ant.update(drive({ move, gait }), CAMERA_BEHIND_YAW, DT);
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
    expect(walk({ x: 1, y: 0 }).x).toBeLessThan(-1);
  });

  it('walks to the viewer’s left on stick left', () => {
    expect(walk({ x: -1, y: 0 }).x).toBeGreaterThan(1);
  });

  it('faces the way she travels', () => {
    const ant = new PlayerAnt();
    ant.placeAt(0, 0);
    for (let i = 0; i < 120; i++) {
      ant.update(drive({ move: { x: 1, y: 0 } }), CAMERA_BEHIND_YAW, DT);
    }
    // Her local +Z is her nose; it should point the way she moved (-X).
    const nose = { x: Math.sin(ant.bearing), z: Math.cos(ant.bearing) };
    expect(nose.x).toBeLessThan(-0.9);
    expect(Math.abs(nose.z)).toBeLessThan(0.3);
  });
});

describe('gaits', () => {
  it('covers more ground the harder she is pushed', () => {
    const crawl = walk({ x: 0, y: 1 }, 2, 'crawl').z;
    const walked = walk({ x: 0, y: 1 }, 2, 'walk').z;
    const ran = walk({ x: 0, y: 1 }, 2, 'run').z;
    expect(crawl).toBeLessThan(walked);
    expect(walked).toBeLessThan(ran);
  });

  it('travels at about the gait’s stated speed', () => {
    // Flat ground with no grid loaded, so this is pure horizontal travel.
    const seconds = 2;
    for (const gait of ['crawl', 'walk', 'run'] as Gait[]) {
      const end = walk({ x: 0, y: 1 }, seconds, gait);
      expect(end.z).toBeCloseTo(GAIT_SPEED[gait] * seconds, 0);
    }
  });
});

describe('auto-walk', () => {
  it('holds its bearing no matter what the stick says', () => {
    const ant = new PlayerAnt();
    ant.placeAt(0, 0, 0);
    const bearing = Math.PI / 2; // due +X
    for (let i = 0; i < 120; i++) {
      // Stick shoved hard the other way; the lock must win.
      ant.update(drive({ move: { x: 0, y: -1 }, bearing }), CAMERA_BEHIND_YAW, DT);
    }
    expect(ant.root.position.x).toBeGreaterThan(10);
    expect(Math.abs(ant.root.position.z)).toBeLessThan(0.5);
    expect(ant.bearing).toBeCloseTo(bearing, 6);
  });

  it('is not steered by where the camera is pointing', () => {
    const run = (cameraYaw: number) => {
      const ant = new PlayerAnt();
      ant.placeAt(0, 0, 0);
      for (let i = 0; i < 60; i++) {
        ant.update(drive({ bearing: 0 }), cameraYaw, DT);
      }
      return ant.root.position.z;
    };
    // Swinging the camera right round must not change where she goes.
    expect(run(0)).toBeCloseTo(run(Math.PI * 0.75), 6);
  });
});
