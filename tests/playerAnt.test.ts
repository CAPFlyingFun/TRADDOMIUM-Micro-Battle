import { describe, expect, it } from 'vitest';
import { PlayerAnt, type Drive } from '../src/ant/PlayerAnt';
import { CATCHUP_MAX_SPEED, FREE_LOOK_ANGLE, PACE_SPEED } from '../src/ant/pace';

/**
 * Camera parked behind her on -Z. `cameraYaw` is the bearing FROM her
 * TO the camera, which is what IslandScene measures, so directly behind
 * an ant facing +Z is atan2(0, -7) = PI. Add to it to swing the camera.
 */
const BEHIND = Math.atan2(0, -7);

const DT = 1 / 60;

function drive(over: Partial<Drive> = {}): Drive {
  return { forward: 0, strafe: 0, speed: 0, ...over };
}

/** Run her for a while and report where she ended up. */
function travel(over: Partial<Drive>, seconds = 2, cameraYaw = BEHIND) {
  const ant = new PlayerAnt();
  ant.placeAt(0, 0, 0); // facing +Z
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    ant.update(drive(over), cameraYaw, DT);
  }
  return { x: ant.root.position.x, z: ant.root.position.z, bearing: ant.bearing };
}

/** Hold the camera at a fixed world bearing and see if she comes round. */
function watched(swing: number, speed: number, seconds = 2) {
  const ant = new PlayerAnt();
  ant.placeAt(0, 0, 0);
  let absorbed = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    // The scene hands each turn back to the look control so the camera
    // stays put in the world; holding cameraYaw fixed here is the same
    // thing seen from the other side.
    absorbed += ant.update(drive({ speed }), BEHIND + swing, DT);
  }
  return { bearing: ant.bearing, absorbed };
}

describe('she moves in her own frame', () => {
  it('stands still when nothing is asked of her', () => {
    // Release the stick and she stops. No setting carries her.
    const end = travel({});
    expect(Math.hypot(end.x, end.z)).toBe(0);
  });

  it('walks forward along her heading', () => {
    const end = travel({ forward: PACE_SPEED.walk, speed: PACE_SPEED.walk });
    expect(end.z).toBeCloseTo(PACE_SPEED.walk * 2, 0);
    expect(Math.abs(end.x)).toBeLessThan(1e-9);
  });

  it('backs up without turning round', () => {
    const end = travel({ forward: -2.2, speed: 2.2 });
    expect(end.z).toBeLessThan(-1);
    expect(end.bearing).toBe(0);
  });

  it('sidesteps to her right without turning', () => {
    // Facing +Z, her right is -X: right = forward cross up.
    const end = travel({ strafe: 4, speed: 4 });
    expect(end.x).toBeLessThan(-1);
    expect(Math.abs(end.z)).toBeLessThan(1e-9);
    expect(end.bearing).toBe(0);
  });

  it('sidesteps to her left on a left push', () => {
    expect(travel({ strafe: -4, speed: 4 }).x).toBeGreaterThan(1);
  });

  it('carries the sidestep round with her heading', () => {
    const ant = new PlayerAnt();
    ant.placeAt(0, 0, Math.PI / 2); // facing +X, so her right is +Z
    for (let i = 0; i < 60; i++) ant.update(drive({ strafe: 4, speed: 4 }), BEHIND, DT);
    expect(ant.root.position.z).toBeGreaterThan(1);
  });
});

describe('the camera may lead her, but only slowly', () => {
  it('ignores a small pan — she must not wiggle', () => {
    expect(watched(FREE_LOOK_ANGLE * 0.6, 0).bearing).toBe(0);
  });

  it('comes round to a sustained look, after a beat', () => {
    expect(watched(0.9, 0).bearing).toBeGreaterThan(0.5);
  });

  it('waits out the delay before starting', () => {
    // Nothing has moved yet at 0.3 s; BODY_CATCHUP_DELAY is 0.35.
    expect(watched(0.9, 0, 0.3).bearing).toBe(0);
  });

  it('lines up with the look rather than stopping at the cone edge', () => {
    expect(watched(0.9, 0, 3).bearing).toBeCloseTo(0.9, 1);
  });

  it('turns the other way for a look the other way', () => {
    expect(watched(-0.9, 0).bearing).toBeLessThan(-0.5);
  });

  it('still leads her at a crawl', () => {
    expect(watched(0.9, CATCHUP_MAX_SPEED).bearing).toBeGreaterThan(0.3);
  });

  it('does NOT redirect her at a walk', () => {
    // Looking around at speed must never yank her onto a new heading.
    expect(watched(0.9, PACE_SPEED.walk).bearing).toBe(0);
  });

  it('does NOT redirect her at a sprint', () => {
    expect(watched(2.5, 18).bearing).toBe(0);
  });

  it('reports every radian it turned, so the view can absorb them', () => {
    const end = watched(0.9, 0, 3);
    expect(end.absorbed).toBeCloseTo(end.bearing, 6);
  });
});
