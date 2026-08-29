/**
 * THE ONE SURFACE EVERYBODY ASKS — the swell's contract.
 *
 * The renderer bakes the same table into its vertex shader
 * (swellChunk), so what is testable here is the CPU half plus the
 * promise that the chunk really is built from the same numbers.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  KEEL, SHOAL_CAP, SWASH_LO, SWELL_AMP_UNIFORM, swellReach,
  swellUniformChunk,
  resetSwell, seaSwellAt, shoalAt, swellChunk, swellTime, tickSwell,
} from '../src/world/seaSwell';

afterEach(() => resetSwell());

const DEEP = 10_000;

describe('the surface', () => {
  it('never leaves sea level further than its own reach', () => {
    tickSwell(3.7);
    for (let i = 0; i < 500; i++) {
      for (const d of [60, 200, DEEP]) {
        const y = seaSwellAt(i * 137.3, i * -91.7, d);
        expect(Math.abs(y)).toBeLessThanOrEqual(swellReach() + 1e-9);
      }
    }
    // (16 + 6) shoaled at the cap — the tallest the sea can ever stand.
    expect(swellReach()).toBeCloseTo(22 * SHOAL_CAP, 6);
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

describe('shoaling — waves grow toward the shore', () => {
  it('is dead flat only in the last few centimetres of swash', () => {
    tickSwell(5);
    expect(seaSwellAt(0, 0, SWASH_LO)).toBe(0);
    expect(seaSwellAt(0, 0, 0)).toBe(0);
  });

  it('is TALLER in shallow water than in deep — the whole point', () => {
    // Joshua: "offshore is smaller waves... as the waves get closer to
    // shore they visually get taller and more obvious." Sampled at one
    // spot and one instant, so only the depth differs.
    tickSwell(1.3);
    const deep = Math.abs(seaSwellAt(500, -300, DEEP));
    const shelf = Math.abs(seaSwellAt(500, -300, 300));
    const shallow = Math.abs(seaSwellAt(500, -300, 80));
    expect(shelf).toBeGreaterThan(deep);
    expect(shallow).toBeGreaterThan(shelf);
  });

  it('follows Green\'s law, capped so a reef cannot blow it up', () => {
    expect(shoalAt(DEEP)).toBeCloseTo(1, 2);          // deep water: as written
    expect(shoalAt(120)).toBeGreaterThan(1.3);        // shoaling
    expect(shoalAt(40)).toBeLessThanOrEqual(SHOAL_CAP);
    expect(shoalAt(1)).toBe(0);                       // swash: flat again
  });

  it('never troughs below the bed it runs over', () => {
    // The keel clamp, swept across every depth the shore offers and a
    // full wave period of phase — the guarantee that stops the sheet
    // driving through the sand (and z-fighting with it).
    for (let d = 0; d <= 400; d += 7) {
      for (let t = 0; t < 3; t += 0.05) {
        resetSwell();
        tickSwell(t);
        const y = seaSwellAt(d * 13.7, -d * 9.1, d);
        expect(y).toBeGreaterThanOrEqual(-Math.max(0, d - KEEL) - 1e-9);
      }
    }
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
    // Wavenumber, frequency and heading are still literals — they do
    // not change within a generation. Both of the default table's
    // wavenumbers appear, and the two accumulators the vertex shader
    // contract names.
    expect(glsl).toContain('0.01745329');
    expect(glsl).toContain('0.02991993');
    expect(glsl).toContain('uTime');
    expect(glsl).toContain('sw +=');
    expect(glsl).toContain('swSlope +=');
  });

  it('reads AMPLITUDE from the shared uniform, not from a literal', () => {
    // Amplitude is the one thing that moves within a generation —
    // wave groups are a slow modulation of it — so it is a uniform
    // the CPU fills from the very numbers it sums itself. Baked as a
    // literal it could not group, and a second copy of it could
    // disagree with the queen's flotation inside a single frame.
    const glsl = swellChunk();
    expect(glsl).toContain('uWaveAmp[0]');
    expect(glsl).toContain('uWaveAmp[1]');
    expect(glsl).not.toContain('16.00');
    expect(swellUniformChunk()).toBe('uniform float uWaveAmp[2];');
  });

  it('hands the shader exactly the amplitudes the CPU is using', () => {
    resetSwell();
    tickSwell(0);
    expect(SWELL_AMP_UNIFORM.value).toEqual([16, 6]);
    // And the default sea does not modulate: no envelopes, so the
    // amplitudes stand still however long it runs.
    tickSwell(37.5);
    expect(SWELL_AMP_UNIFORM.value).toEqual([16, 6]);
  });
});
