import { describe, expect, it } from 'vitest';
import { PlayerAnt, type Drive } from '../src/ant/PlayerAnt';
import { NOTCH_SPEED, type Notch } from '../src/ant/gait';

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
  return { move: { x: 0, y: 0 }, notch: 'walk', ...over };
}

/** Run her for a while and report where she ended up. */
function travel(over: Partial<Drive>, seconds = 2) {
  const ant = new PlayerAnt();
  ant.placeAt(0, 0, 0); // facing +Z
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    ant.update(drive(over), CAMERA_BEHIND_YAW, DT);
  }
  return { x: ant.root.position.x, z: ant.root.position.z, bearing: ant.bearing };
}

describe('the throttle drives her', () => {
  it('travels with nothing touching the stick', () => {
    // This is what replaced auto-move: a setting, not a thing to hold.
    const end = travel({ notch: 'walk' });
    expect(end.z).toBeCloseTo(NOTCH_SPEED.walk * 2, 0);
  });

  it('stands still at stop', () => {
    const end = travel({ notch: 'stop' });
    expect(Math.hypot(end.x, end.z)).toBeCloseTo(0, 6);
  });

  it('covers more ground the further up the ladder she is set', () => {
    const each = (['crawl', 'walk', 'run', 'sprint'] as Notch[])
      .map((notch) => travel({ notch }).z);
    for (let i = 1; i < each.length; i++) {
      expect(each[i]).toBeGreaterThan(each[i - 1]);
    }
  });

  it('backs up on an astern notch, still facing forward', () => {
    const end = travel({ notch: 'backCrawl' });
    expect(end.z).toBeLessThan(-1);
    expect(end.bearing).toBeCloseTo(0, 6);
  });
});

describe('the stick aims her', () => {
  it('steers to the viewer’s right on stick right', () => {
    expect(travel({ move: { x: 1, y: 0 } }).x).toBeLessThan(-1);
  });

  it('steers to the viewer’s left on stick left', () => {
    expect(travel({ move: { x: -1, y: 0 } }).x).toBeGreaterThan(1);
  });

  it('holds a forward push straight ahead', () => {
    const end = travel({ move: { x: 0, y: 1 } });
    expect(end.z).toBeGreaterThan(1);
    expect(Math.abs(end.x)).toBeLessThan(0.5);
  });

  it('turns her round for a push astern that leans', () => {
    // Leaning left is unambiguous, so she comes round to it.
    expect(travel({ move: { x: -0.7, y: -0.7 } }).bearing).toBeGreaterThan(0.5);
    expect(travel({ move: { x: 0.7, y: -0.7 } }).bearing).toBeLessThan(-0.5);
  });

  it('does not spin an arbitrary way for a push dead astern', () => {
    // Neither way round is shorter at a half-turn, so the direction
    // used to fall to the sign of a floating-point zero. With no lean
    // to read, she holds her heading instead of guessing.
    const end = travel({ move: { x: 0, y: -1 }, notch: 'stop' });
    expect(end.bearing).toBeCloseTo(0, 6);
  });

  it('does not let the sign of a zero change the answer', () => {
    const at = (x: number) => travel({ move: { x, y: -1 }, notch: 'stop' });
    expect(at(0)).toEqual(at(-0));
  });

  it('pivots in place at stop', () => {
    const end = travel({ move: { x: 1, y: 0 }, notch: 'stop' }, 0.5);
    expect(Math.hypot(end.x, end.z)).toBeCloseTo(0, 6);
    expect(end.bearing).not.toBeCloseTo(0, 2);
  });

  it('takes a wider line the faster she is going', () => {
    const turned = (notch: Notch) =>
      Math.abs(travel({ move: { x: 1, y: 0 }, notch }, 0.3).bearing);
    expect(turned('crawl')).toBeGreaterThan(turned('sprint'));
  });
});
