/**
 * The reserve knows nothing about what is spending it — it takes a
 * rate. These tests speak in rates for that reason: a test that talked
 * about "sprinting" would be re-asserting the old two-boolean model
 * that flight had to replace.
 */
import { describe, expect, it } from 'vitest';
import {
  MOVING_RECOVERY, REARM_AT, RECOVER_SECONDS, RESTING_BONUS, RESTING_RECOVERY,
  RESTING_SECONDS, SPRINT_DRAIN, SPRINT_SECONDS, Stamina,
} from '../src/ant/stamina';

/** Run a constant rate for a while at a fixed step. */
const hold = (bar: Stamina, rate: number, seconds: number, step = 1 / 60) => {
  let dry = false;
  for (let i = 0; i < Math.round(seconds / step); i++) {
    if (bar.update(rate, step)) dry = true;
  }
  return dry;
};

describe('the reserve', () => {
  it('starts full', () => {
    expect(new Stamina().fraction).toBe(1);
    expect(new Stamina().spent).toBe(false);
  });

  it('lasts the sprint it advertises', () => {
    const bar = new Stamina();
    hold(bar, SPRINT_DRAIN, SPRINT_SECONDS - 1);
    expect(bar.fraction).toBeGreaterThan(0);
    hold(bar, SPRINT_DRAIN, 2);
    expect(bar.fraction).toBe(0);
  });

  it('refills in the time it advertises, resting and moving', () => {
    for (const [rate, seconds] of [
      [RESTING_RECOVERY, RESTING_SECONDS],
      [MOVING_RECOVERY, RECOVER_SECONDS],
    ] as const) {
      const bar = new Stamina();
      bar.spend(1);
      hold(bar, rate, seconds * 0.9);
      expect(bar.fraction).toBeLessThan(1);
      hold(bar, rate, seconds * 0.2);
      expect(bar.fraction).toBe(1);
    }
  });

  it('keeps the resting bonus honest against the two times', () => {
    // One of the two figures is the truth and the bonus is the ratio.
    // Writing both by hand is how they drift apart.
    expect(RESTING_BONUS).toBeCloseTo(RECOVER_SECONDS / RESTING_SECONDS, 9);
  });

  it('costs the same however coarse the frames are', () => {
    const fine = new Stamina();
    const coarse = new Stamina();
    hold(fine, SPRINT_DRAIN, 10, 1 / 240);
    hold(coarse, SPRINT_DRAIN, 10, 1 / 6);
    expect(fine.fraction).toBeCloseTo(coarse.fraction, 6);
  });
});

describe('running dry', () => {
  it('says so exactly once, not every frame after', () => {
    const bar = new Stamina();
    let cries = 0;
    for (let i = 0; i < 60 * (SPRINT_SECONDS + 5); i++) {
      if (bar.update(SPRINT_DRAIN, 1 / 60)) cries += 1;
    }
    expect(cries).toBe(1);
  });

  it('stays spent until the re-arm mark, not until the first drop', () => {
    // What stops a bar hovering near zero from stuttering in and out
    // of a sprint on a held key.
    const bar = new Stamina();
    bar.spend(1);
    expect(bar.spent).toBe(true);
    hold(bar, RESTING_RECOVERY, RESTING_SECONDS * REARM_AT * 0.5);
    expect(bar.fraction).toBeGreaterThan(0);
    expect(bar.spent).toBe(true);
    hold(bar, RESTING_RECOVERY, RESTING_SECONDS * REARM_AT);
    expect(bar.spent).toBe(false);
  });

  it('never goes below empty or above full', () => {
    const bar = new Stamina();
    hold(bar, SPRINT_DRAIN * 10, 60);
    expect(bar.fraction).toBe(0);
    hold(bar, RESTING_RECOVERY * 10, 60);
    expect(bar.fraction).toBe(1);
  });
});

describe('a lump sum', () => {
  it('takes what it asks for', () => {
    const bar = new Stamina();
    expect(bar.spend(0.3)).toBeCloseTo(0.3, 9);
    expect(bar.fraction).toBeCloseTo(0.7, 9);
  });

  it('cannot take what she does not have', () => {
    const bar = new Stamina();
    bar.spend(0.9);
    expect(bar.spend(0.5)).toBeCloseTo(0.1, 9);
    expect(bar.fraction).toBe(0);
    expect(bar.spent).toBe(true);
  });

  it('ignores a negative cost rather than refilling her', () => {
    const bar = new Stamina();
    bar.spend(0.5);
    expect(bar.spend(-1)).toBe(0);
    expect(bar.fraction).toBeCloseTo(0.5, 9);
  });
});

describe('one reserve, many workloads', () => {
  it('lets a negative rate pay back what a positive one took', () => {
    // The whole reason for a rate instead of two booleans: a glide is
    // just a small negative number, and nothing here needs to know it
    // was a glide.
    const bar = new Stamina();
    hold(bar, SPRINT_DRAIN, 10);
    const low = bar.fraction;
    hold(bar, -0.005, 10);
    expect(bar.fraction).toBeGreaterThan(low);
  });
});
