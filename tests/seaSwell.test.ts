/**
 * THE ONE SURFACE EVERYBODY ASKS — the swell's contract.
 *
 * The renderer bakes the same table into its vertex shader
 * (swellChunk), so what is testable here is the CPU half plus the
 * promise that the chunk really is built from the same numbers.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEPTH_HI, DEPTH_LO, SWELL_REACH,
  resetSwell, seaSwellAt, swellChunk, swellTime, tickSwell,
} from '../src/world/seaSwell';

afterEach(() => resetSwell());

const DEEP = 10_000;

describe('the surface', () => {
  it('never leaves sea level further than its own reach', () => {
    tickSwell(3.7);
    for (let i = 0; i < 500; i++) {
      const y = seaSwellAt(i * 137.3, i * -91.7, DEEP);
      expect(Math.abs(y)).toBeLessThanOrEqual(SWELL_REACH + 1e-9);
    }
    expect(SWELL_REACH).toBe(10); // 7 + 3 — modest on purpose
  });

  it('actually undulates — different places, different heights', () => {
    tickSwell(1);
    const a = seaSwellAt(0, 0, DEEP);
    const b = seaSwellAt(300, -500, DEEP);
    const c = seaSwellAt(-900, 200, DEEP);
    expect(new Set([a, b, c].map((v) => v.toFixed(4))).size).toBeGreaterThan(1);
  });

  it('travels — the same spot changes as the clock runs', () => {
    const before = seaSwellAt(1234, -5678, DEEP);
    tickSwell(0.7);
    const after = seaSwellAt(1234, -5678, DEEP);
    expect(after).not.toBeCloseTo(before, 3);
  });

  it('is deterministic under reset — the tests can trust replays', () => {
    tickSwell(2.5);
    const once = seaSwellAt(50, 60, DEEP);
    resetSwell();
    tickSwell(2.5);
    expect(seaSwellAt(50, 60, DEEP)).toBe(once);
  });
});

describe('the shore exemption', () => {
  it('is dead flat in water shallower than DEPTH_LO', () => {
    tickSwell(5);
    expect(seaSwellAt(0, 0, DEPTH_LO)).toBe(0);
    expect(seaSwellAt(0, 0, DEPTH_LO / 2)).toBe(0);
    expect(seaSwellAt(0, 0, 0)).toBe(0);
  });

  it('reaches full height only past DEPTH_HI', () => {
    tickSwell(5);
    const full = seaSwellAt(777, -777, DEEP);
    expect(seaSwellAt(777, -777, DEPTH_HI)).toBeCloseTo(full, 9);
    const mid = seaSwellAt(777, -777, (DEPTH_LO + DEPTH_HI) / 2);
    expect(Math.abs(mid)).toBeLessThan(Math.abs(full) + 1e-9);
    expect(Math.abs(mid)).toBeCloseTo(Math.abs(full) * 0.5, 1);
  });

  it('can never trough below a shelf it fades over', () => {
    // In the fade band the amplitude is a fraction of a column that
    // is already deeper than the full reach at the band's top.
    expect(DEPTH_HI).toBeGreaterThan(SWELL_REACH * 2);
  });
});

describe('the clock', () => {
  it('accumulates and reports the same now everywhere', () => {
    expect(tickSwell(0.5)).toBeCloseTo(0.5, 12);
    expect(tickSwell(0.25)).toBeCloseTo(0.75, 12);
    expect(swellTime()).toBeCloseTo(0.75, 12);
  });
});

describe('the shader chunk', () => {
  it('is baked from the very table the CPU sums', () => {
    const glsl = swellChunk();
    // Both amplitudes, both as literals; the uniform and the two
    // accumulators the vertex shader contract names.
    expect(glsl).toContain('7.00');
    expect(glsl).toContain('3.00');
    expect(glsl).toContain('uTime');
    expect(glsl).toContain('sw +=');
    expect(glsl).toContain('swSlope +=');
  });
});
