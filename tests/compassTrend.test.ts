import { describe, expect, it } from 'vitest';
import { trendReach } from '../src/ui/Compass';

describe('the turn trend on the heading tape', () => {
  it('shows nothing while she is flying straight', () => {
    // A bar that never quite vanishes is a bar whose absence has
    // stopped meaning anything.
    expect(trendReach(0)).toBe(0);
    expect(trendReach(1)).toBe(0);
    expect(trendReach(-1.4)).toBe(0);
  });

  it('reaches six seconds ahead, in degrees of tape', () => {
    // The G1000 contract: roll out when the bar's end touches the
    // bearing you want, and you roll out ON it.
    expect(trendReach(5)).toBeCloseTo(30, 6);
    expect(trendReach(-4)).toBeCloseTo(-24, 6);
  });

  it('leans the way she is turning', () => {
    expect(trendReach(6)).toBeGreaterThan(0);
    expect(trendReach(-6)).toBeLessThan(0);
  });

  it('stops growing before a spin fills the whole strip', () => {
    expect(trendReach(400)).toBe(45);
    expect(trendReach(-400)).toBe(-45);
  });

  it('is symmetric', () => {
    for (const rate of [2, 3.5, 7, 20, 300]) {
      expect(trendReach(-rate)).toBeCloseTo(-trendReach(rate), 9);
    }
  });
});
