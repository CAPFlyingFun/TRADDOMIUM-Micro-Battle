import { describe, expect, it } from 'vitest';
import { Grace, GRACE_SECONDS } from '../src/ant/grace';

const run = (grace: Grace, seconds: number, step = 1 / 60) => {
  for (let i = 0; i < Math.round(seconds / step); i++) grace.update(step);
};

describe('spawn grace', () => {
  it('is off until she arrives', () => {
    const grace = new Grace();
    expect(grace.active).toBe(false);
    expect(grace.shielded).toBe(false);
    expect(grace.disarmed).toBe(false);
  });

  it('lasts the five minutes it advertises', () => {
    const grace = new Grace();
    grace.begin();
    run(grace, GRACE_SECONDS - 5);
    expect(grace.active).toBe(true);
    run(grace, 10);
    expect(grace.active).toBe(false);
    expect(grace.seconds).toBe(0);
  });

  it('protects and disarms as ONE rule, never one without the other', () => {
    // The rule the whole thing exists for. A shield without the
    // disarm is five minutes of being immortal in a fight you picked.
    const grace = new Grace();
    for (const seconds of [0, 1, 60, GRACE_SECONDS, GRACE_SECONDS + 10]) {
      grace.begin();
      run(grace, seconds);
      expect(grace.shielded, `${seconds}s in`).toBe(grace.disarmed);
    }
  });

  it('runs the same however coarse the frames are', () => {
    const fine = new Grace();
    const coarse = new Grace();
    fine.begin();
    coarse.begin();
    run(fine, 100, 1 / 240);
    run(coarse, 100, 1 / 4);
    expect(fine.seconds).toBeCloseTo(coarse.seconds, 6);
  });

  it('starts over on a new queen rather than topping up', () => {
    const grace = new Grace();
    grace.begin();
    run(grace, 200);
    grace.begin();
    expect(grace.seconds).toBe(GRACE_SECONDS);
  });

  it('can be given up early', () => {
    const grace = new Grace();
    grace.begin();
    grace.end();
    expect(grace.active).toBe(false);
  });

  it('never goes negative, however long she waits', () => {
    const grace = new Grace();
    grace.begin();
    run(grace, GRACE_SECONDS * 3);
    expect(grace.seconds).toBe(0);
  });
});
