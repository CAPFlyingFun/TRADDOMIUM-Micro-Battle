import { describe, expect, it } from 'vitest';
import {
  CRAWL_UNTIL, GAITS, GAIT_SPEED, GAIT_TURN, WALK_UNTIL, gaitFromDeflection,
} from '../src/ant/gait';

describe('gait from how hard the stick is pushed', () => {
  it('runs at the rim, walks in the middle, crawls near the centre', () => {
    expect(gaitFromDeflection(0.1)).toBe('crawl');
    expect(gaitFromDeflection(0.5)).toBe('walk');
    expect(gaitFromDeflection(1)).toBe('run');
  });

  it('changes gait exactly at the thresholds', () => {
    expect(gaitFromDeflection(CRAWL_UNTIL - 1e-6)).toBe('crawl');
    expect(gaitFromDeflection(CRAWL_UNTIL)).toBe('walk');
    expect(gaitFromDeflection(WALK_UNTIL - 1e-6)).toBe('walk');
    expect(gaitFromDeflection(WALK_UNTIL)).toBe('run');
  });

  it('never leaves a deflection without a gait', () => {
    for (let d = 0; d <= 1.0001; d += 0.01) {
      expect(GAITS).toContain(gaitFromDeflection(d));
    }
  });
});

describe('gait tuning', () => {
  it('gets faster and less nimble as she pushes harder', () => {
    expect(GAIT_SPEED.crawl).toBeLessThan(GAIT_SPEED.walk);
    expect(GAIT_SPEED.walk).toBeLessThan(GAIT_SPEED.run);
    // Momentum costs agility: running turns wider than crawling.
    expect(GAIT_TURN.crawl).toBeGreaterThan(GAIT_TURN.walk);
    expect(GAIT_TURN.walk).toBeGreaterThan(GAIT_TURN.run);
  });

  it('keeps a run from making the island trivial to cross', () => {
    // 5600 units at a run should still be minutes of travel, not seconds.
    expect(5600 / GAIT_SPEED.run).toBeGreaterThan(200);
  });
});
