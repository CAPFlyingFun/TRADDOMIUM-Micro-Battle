import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PlayerAnt, type Drive } from '../src/ant/PlayerAnt';
import { PACE_SPEED, REST_DEADZONE } from '../src/ant/pace';

/**
 * The heading the player is LOOKING along. An ant facing +Z with the
 * camera behind her is being looked at along +Z, which is heading 0.
 * Add to it to swing the view round to her left.
 */
const BEHIND = 0;

const DT = 1 / 60;

function drive(over: Partial<Drive> = {}): Drive {
  const full = { ahead: 0, across: 0, speed: 0, ...over };
  // Callers give the components; the magnitude follows from them.
  full.speed = Math.hypot(full.ahead, full.across);
  return full;
}

/** Run her for a while and report where she ended up. */
function travel(over: Partial<Drive>, seconds = 2, view = BEHIND) {
  const ant = new PlayerAnt();
  ant.placeAt(0, 0, 0); // facing +Z, camera behind on -Z
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    ant.update(drive(over), view, DT);
  }
  return {
    x: ant.root.position.x,
    z: ant.root.position.z,
    bearing: ant.bearing,
    pace: ant.pace,
  };
}

describe('the stick is in the camera’s frame', () => {
  it('stands still when nothing is asked of her', () => {
    // Release the stick and she stops. No setting carries her.
    const end = travel({});
    expect(Math.hypot(end.x, end.z)).toBe(0);
  });

  it('sends her away from the camera on a forward push', () => {
    const end = travel({ ahead: PACE_SPEED.walk });
    expect(end.z).toBeGreaterThan(1);
    expect(Math.abs(end.x)).toBeLessThan(0.5);
  });

  it('backs her toward the camera on a reverse push', () => {
    expect(travel({ ahead: -2.2 }).z).toBeLessThan(-1);
  });

  it('sends her to the view’s right on a sideways push', () => {
    // Looking along +Z, the viewer's right is world -X.
    expect(travel({ across: 4 }).x).toBeLessThan(-1);
  });

  it('sends her to the view’s left on a left push', () => {
    expect(travel({ across: -4 }).x).toBeGreaterThan(1);
  });

  it('goes where the CAMERA points, not where she is facing', () => {
    // This is the whole scheme in one check. She starts facing +Z with
    // the view swung a quarter turn; a forward push must follow the
    // view, and her body must come round to it rather than resist.
    const end = travel({ ahead: PACE_SPEED.walk }, 2, BEHIND + Math.PI / 2);
    expect(Math.abs(end.x)).toBeGreaterThan(1);
    expect(Math.abs(end.bearing)).toBeGreaterThan(1);
  });
});

describe('steering is looking', () => {
  it('brings her onto the view while she is driven', () => {
    const end = travel({ ahead: PACE_SPEED.walk }, 1, BEHIND + 0.9);
    expect(end.bearing).toBeCloseTo(0.9, 1);
  });

  it('does it briskly — steering that lags reads as ice', () => {
    // Most of the way round inside a fifth of a second.
    const end = travel({ ahead: PACE_SPEED.walk }, 0.2, BEHIND + 1.0);
    expect(end.bearing).toBeGreaterThan(0.9);
  });

  it('leaves her alone at rest inside the deadzone', () => {
    // Standing still you can look most of the way round her and she
    // just watches you over her shoulder.
    expect(travel({}, 2, BEHIND + REST_DEADZONE * 0.8).bearing).toBe(0);
  });

  it('turns at rest once looking is not enough on its own', () => {
    expect(travel({}, 2, BEHIND + 1.9).bearing).toBeGreaterThan(0.4);
  });

  it('comes back only to the EDGE of the deadzone, not onto her nose', () => {
    // Chasing it to zero would mean she could never be looked at from
    // the side at all.
    const swing = 1.9;
    const end = travel({}, 4, BEHIND + swing);
    expect(end.bearing).toBeCloseTo(swing - REST_DEADZONE, 1);
  });

  it('turns the other way for a look the other way', () => {
    expect(travel({}, 2, BEHIND - 1.9).bearing).toBeLessThan(-0.4);
  });
});

describe('her legs run off what she is doing', () => {
  it('strides while travelling', () => {
    const ant = new PlayerAnt();
    ant.placeAt(0, 0, 0);
    const from = ant.stridePhase;
    for (let i = 0; i < 60; i++) ant.update(drive({ ahead: PACE_SPEED.walk }), BEHIND, DT);
    expect(ant.stridePhase).toBeGreaterThan(from);
  });

  it('strides while turning on the spot, going nowhere', () => {
    // Driving the gait off travel alone left her spinning with six legs
    // frozen underneath her, which is most of why a rotation read as a
    // slide rather than as an ant.
    const ant = new PlayerAnt();
    ant.placeAt(0, 0, 0);
    const from = ant.stridePhase;
    for (let i = 0; i < 60; i++) ant.update(drive({}), BEHIND + 1.9, DT);
    expect(ant.pace).toBe(0);
    expect(ant.stridePhase).toBeGreaterThan(from);
  });

  it('is still when she is', () => {
    const ant = new PlayerAnt();
    ant.placeAt(0, 0, 0);
    const from = ant.stridePhase;
    for (let i = 0; i < 60; i++) ant.update(drive({}), BEHIND, DT);
    expect(ant.stridePhase).toBe(from);
  });
});

describe('nothing snaps', () => {
  it('takes a moment to get up to speed', () => {
    // A standing start must not reach full pace in one frame.
    const ant = new PlayerAnt();
    ant.placeAt(0, 0, 0);
    ant.update(drive({ ahead: PACE_SPEED.run }), BEHIND, DT);
    expect(ant.pace).toBeGreaterThan(0);
    expect(ant.pace).toBeLessThan(PACE_SPEED.run * 0.5);
  });

  it('gets there soon enough to feel connected', () => {
    expect(travel({ ahead: PACE_SPEED.run }, 1).pace)
      .toBeGreaterThan(PACE_SPEED.run * 0.95);
  });

  it('coasts to a stop rather than halting dead', () => {
    const ant = new PlayerAnt();
    ant.placeAt(0, 0, 0);
    for (let i = 0; i < 90; i++) ant.update(drive({ ahead: PACE_SPEED.run }), BEHIND, DT);
    const running = ant.pace;
    ant.update(drive({}), BEHIND, DT);
    expect(ant.pace).toBeLessThan(running);
    expect(ant.pace).toBeGreaterThan(0);
  });

  it('does stop, and soon', () => {
    const ant = new PlayerAnt();
    ant.placeAt(0, 0, 0);
    for (let i = 0; i < 90; i++) ant.update(drive({ ahead: PACE_SPEED.run }), BEHIND, DT);
    for (let i = 0; i < 90; i++) ant.update(drive({}), BEHIND, DT);
    expect(ant.pace).toBeLessThan(0.05);
  });

  it('does not reverse her travel inside a frame', () => {
    // Flicking the stick across used to do exactly that, and the legs
    // are still mid-stride the old way when it happens.
    const ant = new PlayerAnt();
    ant.placeAt(0, 0, 0);
    for (let i = 0; i < 90; i++) ant.update(drive({ across: 5 }), BEHIND, DT);
    const before = ant.root.position.x;
    ant.update(drive({ across: -5 }), BEHIND, DT);
    // Still travelling the old way one frame after the reversal.
    expect(ant.root.position.x).toBeLessThan(before);
  });

  it('is frame-rate independent', () => {
    // A per-frame lerp factor with no dt in it — the usual mistake —
    // makes a 30 fps phone and a 120 fps one play at different speeds.
    // Chaining two exponentials leaves a few percent of discretisation
    // in the standing start; a missing dt leaves several hundred.
    const run = (dt: number, seconds: number) => {
      const ant = new PlayerAnt();
      ant.placeAt(0, 0, 0);
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        ant.update(drive({ ahead: PACE_SPEED.walk }), BEHIND, dt);
      }
      return { z: ant.root.position.z, pace: ant.pace };
    };
    const slow = run(1 / 30, 1);
    const fast = run(1 / 120, 1);
    expect(Math.abs(slow.z - fast.z) / fast.z).toBeLessThan(0.05);
    // Once the ease has settled they must agree exactly.
    expect(run(1 / 30, 3).pace).toBeCloseTo(run(1 / 120, 3).pace, 4);
  });
});

describe('putting the real body on', () => {
  it('leaves nothing of the placeholder behind', () => {
    // Her eyes were parented to the body rather than to the
    // placeholder group, so swapping in the real mesh removed the
    // stick legs and left two black orbs floating in mid-air where the
    // old, larger head had been. Counting what survives is the check
    // that no future part gets parented to the wrong thing.
    const ant = new PlayerAnt();
    const model = new THREE.Group();
    model.name = 'queen';
    ant.wear(model);

    const left: string[] = [];
    ant.root.traverse((part) => {
      if (part instanceof THREE.Mesh) left.push(part.name || part.type);
    });
    expect(left, `orphans: ${left.join(', ')}`).toHaveLength(0);
  });

  it('still has the placeholder before the model arrives', () => {
    // The other half of it: she must be visible from the first frame,
    // so an empty body would be its own bug.
    const ant = new PlayerAnt();
    let meshes = 0;
    ant.root.traverse((part) => { if (part instanceof THREE.Mesh) meshes += 1; });
    expect(meshes).toBeGreaterThan(10);
  });
});
