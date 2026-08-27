/**
 * HER AIR, AND WHY IT IS A METER RATHER THAN A STOPWATCH.
 *
 * The dive used to end after four seconds — a number chosen because a
 * dive had to end somehow, invisible to the player, and impossible to
 * tell apart from the game simply deciding. Air is a thing she can
 * see, spend and get back, and it is the reason the gauge exists.
 */
import { describe, expect, it } from 'vitest';
import {
  Breath, HOLD, REFILL, SHORT,
  FADE_FROM, FADE_TO, DROWN_HP_PER_SECOND, blackout,
} from '../src/ant/breath';

const TICK = 1 / 60;

function hold(seconds: number, submerged = true): Breath {
  const air = new Breath();
  for (let t = 0; t < seconds; t += TICK) air.update(submerged, TICK);
  return air;
}

describe('the meter', () => {
  it('starts full', () => {
    expect(new Breath().fraction).toBe(1);
  });

  it('empties in the time it says it does', () => {
    expect(hold(HOLD).fraction).toBeCloseTo(0, 2);
    expect(hold(HOLD * 0.5).fraction).toBeCloseTo(0.5, 2);
  });

  it('never goes past either end', () => {
    expect(hold(HOLD * 3).fraction).toBe(0);
    const back = hold(HOLD * 3);
    for (let t = 0; t < REFILL * 3; t += TICK) back.update(false, TICK);
    expect(back.fraction).toBe(1);
  });

  it('comes back faster than it goes, because bobbing is not gameplay', () => {
    expect(REFILL).toBeLessThan(HOLD);
  });

  it('warns before it is too late to do anything about it', () => {
    // A quarter of a breath has to be enough to reach the surface from
    // anywhere one breath could have taken her.
    expect(hold(HOLD * (1 - SHORT) + 0.2).short).toBe(true);
    expect(HOLD * SHORT).toBeGreaterThan(8);
  });
});

describe('the darkness when the air runs short', () => {
  it('leaves the world alone above thirty percent', () => {
    expect(blackout(1)).toBe(0);
    expect(blackout(FADE_FROM)).toBe(0);
    expect(blackout(FADE_FROM + 0.01)).toBe(0);
  });

  it('darkens on the way down and never reaches full black', () => {
    let last = -1;
    for (let f = FADE_FROM; f >= 0; f -= 0.01) {
      const veil = blackout(f);
      expect(veil).toBeGreaterThanOrEqual(last);
      last = veil;
    }
    expect(blackout(0)).toBe(FADE_TO);
    expect(FADE_TO).toBeLessThan(1);        // she can still barely see
  });

  it('starts as a hint, not a curtain', () => {
    // Quadratic: just under the line the veil is a few percent, so
    // crossing 30% is an onset rather than a step.
    expect(blackout(FADE_FROM * 0.9)).toBeLessThan(0.02);
  });

  it('drowning is a steady rate on top of the salt, only ever down there', () => {
    expect(DROWN_HP_PER_SECOND).toBe(1);
  });
});
