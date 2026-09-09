/**
 * THE TRIPOD, PINNED — `gait.ts` is arithmetic and these are its claims:
 *
 *   the two tripods never both swing: at every point in the cycle
 *     exactly three legs are in the air, L1/R2/L3 against R1/L2/R3
 *   a leg swings for `SWING_DUTY` of its cycle and stands for the rest
 *   the foot's station is continuous — no jump where swing meets stance
 *     or stance meets swing — and reaches +1 forward and −1 back
 *   the lift is zero throughout stance and rises only in swing
 *   the tripod a leg belongs to is the rule `rig.ts` uses for `phase`
 *   the stride advances with DISTANCE, not time
 */
import { describe, expect, it } from 'vitest';
import {
  STRIDES_PER_LENGTH, STRIDE_LENGTHS, SWING_DUTY, TRIPODS, inSwing, legCycle, lift, protraction, strideCycle, strideFrequency,
  tripodOf,
} from '../src/fauna/gait';

const SAMPLES = 400;

describe('the tripod', () => {
  it('names six legs in two tripods, L1/R2/L3 against R1/L2/R3, and phase is the same rule rig.ts uses', () => {
    expect(TRIPODS).toHaveLength(2);
    const all = TRIPODS.flat();
    expect(all).toHaveLength(6);
    for (const side of [1, -1]) for (const rank of [0, 1, 2]) {
      const t = TRIPODS.findIndex((tripod) => tripod.some((l) => l.side === side && l.rank === rank));
      expect(t, `side ${side} rank ${rank}`).toBe(tripodOf(side, rank));
      expect(t).toBe(((side === 1 ? 1 : 0) + rank) % 2);
    }
    // Within a tripod the sides alternate front/mid/hind; across the pair every rank is split.
    for (const tripod of TRIPODS) expect(tripod.map((l) => l.side)).toEqual([tripod[0].side, -tripod[0].side, tripod[0].side]);
    for (const rank of [0, 1, 2]) expect(tripodOf(1, rank)).not.toBe(tripodOf(-1, rank));
  });

  it('never has both tripods in swing, and always has exactly one', () => {
    for (let k = 0; k < SAMPLES; k += 1) {
      const cycle = k / SAMPLES;
      const swinging = [0, 1].filter((tripod) => inSwing(legCycle(cycle, tripod)));
      expect(swinging, `cycle ${cycle}`).toHaveLength(1);
    }
  });

  it('gives every leg a swing of SWING_DUTY and a stance of the rest', () => {
    for (const tripod of [0, 1]) {
      let swing = 0;
      for (let k = 0; k < SAMPLES; k += 1) if (inSwing(legCycle(k / SAMPLES, tripod))) swing += 1;
      expect(swing / SAMPLES).toBeCloseTo(SWING_DUTY, 2);
    }
    expect(SWING_DUTY).toBe(0.5);
  });

  it('carries the foot from −1 to +1 in swing and back in stance, continuously, with no jump at either boundary', () => {
    let previous = protraction(0);
    let max = -Infinity;
    let min = Infinity;
    for (let k = 1; k <= SAMPLES * 2; k += 1) {
      const t = k / SAMPLES;
      const p = protraction(t);
      expect(Math.abs(p - previous), `jump at ${t}`).toBeLessThan(0.05);
      max = Math.max(max, p);
      min = Math.min(min, p);
      previous = p;
    }
    expect(max).toBeCloseTo(1, 6);
    expect(min).toBeCloseTo(-1, 6);
    // The two boundaries meet exactly.
    expect(protraction(0)).toBeCloseTo(-1, 9);
    expect(protraction(SWING_DUTY - 1e-9)).toBeCloseTo(protraction(SWING_DUTY), 6);
    expect(protraction(1 - 1e-9)).toBeCloseTo(protraction(0), 6);
    // Swing goes forward, stance goes back.
    expect(protraction(SWING_DUTY / 2)).toBeGreaterThan(protraction(SWING_DUTY / 4));
    expect(protraction(0.75)).toBeLessThan(protraction(0.6));
  });

  it('lifts the foot only in swing, to a peak mid-swing, and never in stance', () => {
    for (let k = 0; k < SAMPLES; k += 1) {
      const t = k / SAMPLES;
      const l = lift(t);
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThanOrEqual(1);
      if (!inSwing(t)) expect(l, `stance at ${t}`).toBe(0);
    }
    expect(lift(SWING_DUTY / 2)).toBeCloseTo(1, 6);
    expect(lift(0)).toBeCloseTo(0, 6);
  });

  it('advances the stride with distance in body lengths, wraps, and offsets by the creature\'s phase', () => {
    expect(STRIDE_LENGTHS).toBeCloseTo(0.4, 9);
    expect(STRIDES_PER_LENGTH).toBeCloseTo(2.5, 9);
    expect(strideCycle(0, 0)).toBe(0);
    expect(strideCycle(STRIDE_LENGTHS, 0)).toBeCloseTo(0, 9);
    expect(strideCycle(STRIDE_LENGTHS / 2, 0)).toBeCloseTo(0.5, 9);
    expect(strideCycle(0, 0.3)).toBeCloseTo(0.3, 9);
    expect(strideCycle(STRIDE_LENGTHS * 0.9, 0.3)).toBeCloseTo(0.2, 9);
    // The derived rate: a body moving one length a second takes 2.5 strides in it; standing still takes none.
    expect(strideFrequency(1)).toBeCloseTo(STRIDES_PER_LENGTH, 9);
    expect(strideFrequency(0)).toBe(0);
    expect(strideFrequency(-1)).toBe(0);
  });
});
