/**
 * HER AIR, AND WHY IT IS A METER RATHER THAN A STOPWATCH.
 *
 * The dive used to end after four seconds — a number chosen because a
 * dive had to end somehow, invisible to the player, and impossible to
 * tell apart from the game simply deciding. Air is a thing she can
 * see, spend and get back, and it is the reason the gauge exists.
 */
import { describe, expect, it } from 'vitest';
import { Breath, HOLD, REFILL, SHORT } from '../src/ant/breath';
import { Swim } from '../src/ant/swim';

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

describe('what it does to a dive', () => {
  const water = { level: 20, bed: 0 };
  const BODY = 1;

  it('holds her down while she has air', () => {
    const swim = new Swim();
    for (let t = 0; t < 1; t += TICK) swim.update(water, BODY, 1, true, TICK, 1);
    expect(swim.afloat.state).toBe('under');
  });

  it('and floats her out when she has none, lever or no lever', () => {
    // OUT OF AIR IS NOT A CHOICE. She can decline to go down; she
    // cannot decline to come up.
    const swim = new Swim();
    for (let t = 0; t < 1; t += TICK) swim.update(water, BODY, 1, true, TICK, 1);
    expect(swim.afloat.state).toBe('under');
    swim.update(water, BODY, 1, true, TICK, 0);
    expect(swim.afloat.state).not.toBe('under');
  });

  it('and will not let her duck straight back under on the same breath', () => {
    const swim = new Swim();
    for (let t = 0; t < 1; t += TICK) swim.update(water, BODY, 1, true, TICK, 0);
    expect(swim.afloat.state).not.toBe('under');
  });
});

describe('it still cannot drown her', () => {
  it('runs out and leaves her swimming, not dead', () => {
    // The survival invariant, checked at the one place a new meter
    // could break it: air only falls where it can be refilled, and
    // running out costs her the dive rather than the queen.
    const swim = new Swim();
    const air = new Breath();
    const water = { level: 20, bed: 0 };
    for (let t = 0; t < HOLD + 10; t += TICK) {
      const wet = swim.update(water, 1, 1, true, TICK, air.fraction);
      air.update(wet.state === 'under', TICK);
    }
    expect(air.fraction).toBeGreaterThan(0);
    expect(['skating', 'swimming']).toContain(swim.afloat.state);
  });
});
