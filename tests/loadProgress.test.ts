import { describe, expect, it } from 'vitest';
import { ETA_WINDOW_MS, LoadProgress } from '../src/world/LoadProgress';

function rig(): { p: LoadProgress; at: (ms: number) => void } {
  let now = 0;
  const p = new LoadProgress(() => now);
  return {
    p,
    at: (ms) => {
      now = ms;
    },
  };
}

describe('LoadProgress', () => {
  it('weights milestones and reads 1 when nothing is defined', () => {
    const { p } = rig();
    expect(p.fraction()).toBe(1);
    p.define([{ id: 'dem', weight: 3 }, { id: 'veg', weight: 1 }]);
    expect(p.fraction()).toBe(0);
    p.report('dem', 1);
    expect(p.fraction()).toBeCloseTo(0.75, 9);
    p.report('veg', 0.5);
    expect(p.fraction()).toBeCloseTo(0.875, 9);
    expect(p.complete()).toBe(false);
    p.report('veg', 1);
    expect(p.complete()).toBe(true);
  });

  it('never decreases, whatever the signals do', () => {
    const { p } = rig();
    p.define([{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }]);
    const noisy = [0.2, 0.5, 0.3, 0.9, 0.1, NaN, -1, 0.95, 0.4];
    let last = 0;
    for (const f of noisy) {
      p.report('a', f);
      p.report('b', f / 2);
      expect(p.fraction()).toBeGreaterThanOrEqual(last);
      expect(p.fraction()).toBeLessThanOrEqual(1);
      last = p.fraction();
    }
    // a peaked at 0.95, b at 0.475; the dips and the garbage left no mark.
    expect(last).toBeCloseTo((0.95 + 0.475) / 2, 9);
    p.report('a', 2);
    p.report('b', 1.5);
    expect(p.fraction()).toBe(1);
  });

  it('ignores unknown ids and non-positive weights', () => {
    const { p } = rig();
    p.define([{ id: 'a', weight: 1 }, { id: 'zero', weight: 0 }, { id: 'neg', weight: -2 }]);
    p.report('typo', 1);
    p.report('zero', 1);
    expect(p.fraction()).toBe(0);
    p.report('a', 1);
    expect(p.fraction()).toBe(1);
  });

  it('has no ETA until there is a rate, then extrapolates it over the window', () => {
    const { p, at } = rig();
    p.define([{ id: 'a', weight: 1 }]);
    expect(p.etaMs()).toBeNull();
    at(0);
    p.report('a', 0.1);
    expect(p.etaMs()).toBeNull(); // one sample, no rate
    at(1000);
    p.report('a', 0.2); // 0.1 per second → 0.8 remaining → 8 s
    expect(p.etaMs()).toBeCloseTo(8000, 6);
    at(2000);
    p.report('a', 0.4);
    // over 2 s the fraction rose 0.3 → 0.6 remaining at 0.15/s → 4 s
    expect(p.etaMs()).toBeCloseTo(4000, 6);
  });

  it('forgets samples older than the sliding window and reports 0 when complete', () => {
    const { p, at } = rig();
    p.define([{ id: 'a', weight: 1 }]);
    at(0);
    p.report('a', 0.1);
    at(500);
    p.report('a', 0.5); // fast start
    at(ETA_WINDOW_MS + 1000);
    p.report('a', 0.6); // the fast start has aged out; only the slow tail counts
    // Kept: the sample at or before the window edge (500) and the new one.
    // rate = 0.1 over 7500 ms → 0.4 remaining → 30000 ms
    expect(p.etaMs()).toBeCloseTo(30000, 3);
    at(ETA_WINDOW_MS + 1100);
    p.report('a', 1);
    expect(p.etaMs()).toBe(0);
  });
});
