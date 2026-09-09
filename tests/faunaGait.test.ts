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
 *   THE STRIDE IS THE SPEED'S (Joshua, 2026-09-09: the aphid's legs
 *     "kind of was in slow motion"): the ants at their wander take the
 *     full stride they always took, and the aphid — 0.57 body lengths a
 *     second on a 1.4 mm body — takes a short one and steps about four
 *     times a second, six when it flees, instead of 1.4
 */
import { describe, expect, it } from 'vitest';
import { APHID, QUEEN, WORKER } from '../src/creatures';
import {
  STRIDES_PER_LENGTH, STRIDE_FULL_SPEED, STRIDE_LENGTHS, STRIDE_MIN_FRACTION, SWING_DUTY, TRIPODS, inSwing, legCycle, lift, protraction,
  strideCycle, strideFrequency, strideLengthsAt, tripodOf,
} from '../src/fauna/gait';

/** A species' pace in body lengths a second, from the table's own numbers. */
const lengthsPerS = (mmS: number, lengthMm: number): number => mmS / lengthMm;

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

  it('advances the stride with the strides walked, wraps, and offsets by the creature\'s phase', () => {
    expect(STRIDE_LENGTHS).toBeCloseTo(0.4, 9);
    expect(STRIDES_PER_LENGTH).toBeCloseTo(2.5, 9);
    // The cycle is the fraction of the stride count: a whole stride is back at the start.
    expect(strideCycle(0, 0)).toBe(0);
    expect(strideCycle(1, 0)).toBeCloseTo(0, 9);
    expect(strideCycle(0.5, 0)).toBeCloseTo(0.5, 9);
    expect(strideCycle(0, 0.3)).toBeCloseTo(0.3, 9);
    expect(strideCycle(0.9, 0.3)).toBeCloseTo(0.2, 9);
    // The derived rate: standing still takes no strides, and a negative speed is not a speed.
    expect(strideFrequency(0)).toBe(0);
    expect(strideFrequency(-1)).toBe(0);
    // At and over the full speed the full stride: 2.5 strides a body, so 6.25 a second at 2.5 bodies a second.
    expect(strideFrequency(STRIDE_FULL_SPEED)).toBeCloseTo(STRIDE_FULL_SPEED * STRIDES_PER_LENGTH, 9);
  });
});

describe('the stride is the speed\'s', () => {
  it('is the full stride at the full speed and above, shrinks with the speed below it, and never under the minimum', () => {
    expect(STRIDE_FULL_SPEED).toBe(2.5);
    expect(STRIDE_MIN_FRACTION).toBe(0.35);
    expect(strideLengthsAt(STRIDE_FULL_SPEED)).toBeCloseTo(STRIDE_LENGTHS, 12);
    expect(strideLengthsAt(STRIDE_FULL_SPEED * 3)).toBeCloseTo(STRIDE_LENGTHS, 12);
    expect(strideLengthsAt(STRIDE_FULL_SPEED / 2)).toBeCloseTo(STRIDE_LENGTHS / 2, 12);
    expect(strideLengthsAt(0)).toBeCloseTo(STRIDE_LENGTHS * STRIDE_MIN_FRACTION, 12);
    expect(strideLengthsAt(-3)).toBeCloseTo(STRIDE_LENGTHS * STRIDE_MIN_FRACTION, 12);
    // Never zero, never NaN: a count divided by it is always a number.
    expect(strideLengthsAt(Number.NaN)).toBeGreaterThan(0);
    expect(strideLengthsAt(Number.POSITIVE_INFINITY)).toBeCloseTo(STRIDE_LENGTHS, 12);
    // Monotone: a faster walker never takes a shorter stride.
    let last = 0;
    for (let v = 0; v <= 4; v += 0.05) {
      const stride = strideLengthsAt(v);
      expect(stride).toBeGreaterThanOrEqual(last - 1e-12);
      last = stride;
    }
  });

  it('leaves the two ants Joshua approved exactly as they were: the queen and the worker wander at or over the full speed', () => {
    const queen = lengthsPerS(QUEEN.pace.wanderMmS, QUEEN.lengthMm);
    const worker = lengthsPerS(WORKER.pace.wanderMmS, WORKER.lengthMm);
    // 20 mm/s on 8 mm is exactly the full speed; 8.55 on 3 is over it.
    expect(queen).toBeCloseTo(2.5, 9);
    expect(worker).toBeCloseTo(2.85, 9);
    expect(strideLengthsAt(queen)).toBeCloseTo(STRIDE_LENGTHS, 12);
    expect(strideLengthsAt(worker)).toBeCloseTo(STRIDE_LENGTHS, 12);
    // Which is the old rate, unchanged: 6.25 and 7.1 strides a second.
    expect(strideFrequency(queen)).toBeCloseTo(queen * STRIDES_PER_LENGTH, 9);
    expect(strideFrequency(worker)).toBeCloseTo(worker * STRIDES_PER_LENGTH, 9);
    expect(strideFrequency(queen)).toBeCloseTo(6.25, 6);
    expect(strideFrequency(worker)).toBeCloseTo(7.125, 6);
  });

  it('MEASURES THE APHID\'S SLOW MOTION and takes it out: 1.4 strides a second at the old stride, 4.1 at its own, 6.3 fleeing', () => {
    // 0.8 mm/s on a 1.4 mm body: 0.57 body lengths a second (MEASURED, Alford et al. 2012 via aphid.md).
    const wander = lengthsPerS(APHID.pace.wanderMmS, APHID.lengthMm);
    const flee = lengthsPerS(APHID.pace.fleeMmS, APHID.lengthMm);
    expect(wander).toBeCloseTo(0.5714, 3);
    // THE CAUSE: at one fixed stride the legs cycled 1.4 times a second.
    expect(wander * STRIDES_PER_LENGTH).toBeCloseTo(1.43, 2);
    // THE LAW: 0.23 of the full stride, clamped to the minimum 0.35 — a 0.14-body stride, 4.1 a second.
    expect(wander / STRIDE_FULL_SPEED).toBeLessThan(STRIDE_MIN_FRACTION);
    expect(strideLengthsAt(wander)).toBeCloseTo(0.14, 9);
    expect(strideFrequency(wander)).toBeCloseTo(4.08, 2);
    // Fleeing at 2.5 mm/s: 1.8 body lengths a second, 0.71 of the full stride, 6.3 a second — a scurry, not a sprint in slow motion.
    expect(flee).toBeCloseTo(1.786, 3);
    expect(strideLengthsAt(flee)).toBeCloseTo(STRIDE_LENGTHS * flee / STRIDE_FULL_SPEED, 12);
    expect(strideFrequency(flee)).toBeCloseTo(6.25, 2);
    // And the aphid's walk is now the same ORDER as the ants', which is what "walk like the queen and worker" asks.
    expect(strideFrequency(wander)).toBeGreaterThan(strideFrequency(2.5) / 2);
  });
});
