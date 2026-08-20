import { describe, expect, it } from 'vitest';
import {
  CRAWL_UNTIL, GAITS, GAIT_SPEED, GAIT_TURN, WALK_UNTIL, gaitFromDeflection,
} from '../src/ant/gait';

describe('gait from how hard the stick is pushed', () => {
  it('splits the ring in half, and sprints past its rim', () => {
    expect(gaitFromDeflection(0.2)).toBe('crawl');
    expect(gaitFromDeflection(0.75)).toBe('walk');
    expect(gaitFromDeflection(1.1)).toBe('sprint');
  });

  it('gives the crawl and the walk equal room to sit in', () => {
    // The complaint that started this: a 64 px stick with uneven bands
    // jumps from crawl to flat out with nowhere to hold a middle speed.
    expect(CRAWL_UNTIL).toBeCloseTo(WALK_UNTIL / 2, 6);
  });

  it('changes gait exactly at the drawn boundaries', () => {
    expect(gaitFromDeflection(CRAWL_UNTIL - 1e-6)).toBe('crawl');
    expect(gaitFromDeflection(CRAWL_UNTIL)).toBe('walk');
    expect(gaitFromDeflection(WALK_UNTIL - 1e-6)).toBe('walk');
    expect(gaitFromDeflection(WALK_UNTIL)).toBe('sprint');
  });

  it('never leaves a deflection without a gait', () => {
    for (let d = 0; d <= 1.3001; d += 0.01) {
      expect(GAITS).toContain(gaitFromDeflection(d));
    }
  });
});

describe('gait tuning', () => {
  it('gets faster and less nimble as she pushes harder', () => {
    expect(GAIT_SPEED.crawl).toBeLessThan(GAIT_SPEED.walk);
    expect(GAIT_SPEED.walk).toBeLessThan(GAIT_SPEED.sprint);
    // Momentum costs agility: running turns wider than crawling.
    expect(GAIT_TURN.crawl).toBeGreaterThan(GAIT_TURN.walk);
    expect(GAIT_TURN.walk).toBeGreaterThan(GAIT_TURN.sprint);
  });

  it('keeps a sprint from making the island trivial to cross', () => {
    // 5600 units flat out should still be minutes of travel.
    expect(5600 / GAIT_SPEED.sprint).toBeGreaterThan(200);
  });
});
