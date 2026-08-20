import { describe, expect, it } from 'vitest';
import {
  CATCHUP_MAX_SPEED, fasterPace, PACE_MARK, PACE_NAME, PACE_SPEED, PACES,
  REVERSE_CAP, slowerPace, SPRINT_SPEED, type Pace,
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

describe('the catch-up ceiling', () => {
  it('covers a crawl and nothing faster', () => {
    // Joshua's call: you slow down to turn. This is the one constant
    // that reverses it, so it is worth pinning where it sits.
    expect(CATCHUP_MAX_SPEED).toBeGreaterThanOrEqual(PACE_SPEED.crawl);
    expect(CATCHUP_MAX_SPEED).toBeLessThan(PACE_SPEED.walk);
  });
});

describe('the paces themselves', () => {
  it('are ordered slowest first, as the selector stacks them', () => {
    const slowest: Pace = PACES[0];
    expect(PACE_SPEED[slowest]).toBe(Math.min(...PACES.map((p) => PACE_SPEED[p])));
  });
});
