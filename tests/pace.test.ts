import { describe, expect, it } from 'vitest';
import {
  DIRECTION_EASE, fasterPace, PACE_MARK, PACE_NAME, PACE_SPEED, PACES,
  REST_DEADZONE, REST_EASE, REVERSE_CAP, slowerPace, SPEED_EASE,
  SPRINT_SPEED, TURN_RATE, type Pace,
} from '../src/ant/pace';

describe('the pace ladder', () => {
  it('holds the three sustainable paces and nothing else', () => {
    // Stop is "let go of the stick" and reverse is "push it down".
    // Neither is a maximum forward speed, so neither is a pace.
    expect(PACES).toEqual(['crawl', 'walk', 'run']);
  });

  it('gets faster with every step up', () => {
    for (let i = 1; i < PACES.length; i++) {
      expect(PACE_SPEED[PACES[i]]).toBeGreaterThan(PACE_SPEED[PACES[i - 1]]);
    }
  });

  it('keeps a sprint above every sustainable pace', () => {
    for (const pace of PACES) expect(SPRINT_SPEED).toBeGreaterThan(PACE_SPEED[pace]);
  });

  it('caps reverse below the fastest pace', () => {
    expect(REVERSE_CAP).toBeLessThan(PACE_SPEED.run);
  });

  it('never leaves a pace without a mark and a name', () => {
    for (const pace of PACES) {
      expect(PACE_MARK[pace]).toBeTruthy();
      expect(PACE_NAME[pace]).toBeTruthy();
    }
  });
});

describe('stepping the pace', () => {
  it('moves one at a time', () => {
    expect(fasterPace('crawl')).toBe('walk');
    expect(slowerPace('run')).toBe('walk');
  });

  it('stops at the ends rather than wrapping round', () => {
    expect(slowerPace('crawl')).toBe('crawl');
    expect(fasterPace('run')).toBe('run');
  });
});

describe('the feel constants', () => {
  it('steers faster than it settles at rest', () => {
    // While she is driven, steering IS looking, so it has to be brisk.
    // At rest she is only shuffling round to face you, and that should
    // not read as a snap.
    expect(TURN_RATE).toBeGreaterThan(REST_EASE * 2);
  });

  it('leaves a real deadzone to be looked at within', () => {
    // It has to be big enough that she can be seen from the side at
    // all, and small enough that it is not felt as lag — she settles at
    // its EDGE, so whatever this is, it is how far behind the view she
    // permanently sits.
    expect(REST_DEADZONE).toBeGreaterThan(Math.PI / 18);
    expect(REST_DEADZONE).toBeLessThan(Math.PI / 4);
  });

  it('changes her mind more slowly than it changes her speed', () => {
    // Flicking the stick across must not reverse her travel in a frame,
    // which needs the direction to swing slower than the speed eases.
    expect(DIRECTION_EASE).toBeLessThan(SPEED_EASE);
  });
});

describe('the paces themselves', () => {
  it('are ordered slowest first, as the selector stacks them', () => {
    const slowest: Pace = PACES[0];
    expect(PACE_SPEED[slowest]).toBe(Math.min(...PACES.map((p) => PACE_SPEED[p])));
  });
});
