/**
 * THE WETNESS SETTINGS, AND THE TWO THINGS THEY MUST NEVER DO.
 *
 *  1. THEY MUST NEVER TOUCH A HEIGHT. `terrain/wetness.ts` is pure
 *     arithmetic on a reach and a rain strength; it imports no three,
 *     no DOM and no heightfield instance, and the shader it feeds reads
 *     a vertex's y and writes a colour. That half is pinned in
 *     `terrainView.test.ts`; this file pins the arithmetic.
 *  2. THEY MUST NOT DEPEND ON THE FRAME RATE. The rain easing is
 *     `1 - exp(-dt / tau)`, so sixty one-second steps and one
 *     sixty-second step land in the same place, and a paused game — a
 *     dt of zero — holds the ground. This project has shipped one bug
 *     where a per-second system turned out to be a per-frame one; the
 *     identity test here is what catches the next.
 */
import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../src/world/heightfield';
import {
  DRY_TAU_S, SHORE_FADE_OF_REACH, SHORE_TOP_OF_REACH, WET_TAU_S, easeRainWetness, shoreWetnessOf,
} from '../src/terrain/wetness';

/** The shipped swell's crest envelope, about — `SeaSwell.reach()` on the NOAA table. */
const SHIPPED_REACH = 48;

describe('where the sea leaves the ground wet', () => {
  it('puts the wet line above the highest crest and fades over a band above that', () => {
    const { shoreTop, shoreFade } = shoreWetnessOf(SHIPPED_REACH);
    // The run-up climbs past the crest: 48 × 1.25 = 60 units, 0.6 m.
    expect(shoreTop).toBeCloseTo(SEA_LEVEL + SHIPPED_REACH * SHORE_TOP_OF_REACH, 9);
    expect(shoreTop).toBeGreaterThan(SEA_LEVEL + SHIPPED_REACH);
    // And the damp band above it is wider than the crest: 48 × 1.5 = 72.
    expect(shoreFade).toBeCloseTo(SHIPPED_REACH * SHORE_FADE_OF_REACH, 9);
    expect(shoreFade).toBeGreaterThan(0);
    expect(SHORE_TOP_OF_REACH).toBe(1.25);
    expect(SHORE_FADE_OF_REACH).toBe(1.5);
  });

  it('rises with the swell, so a bigger sea wets more beach', () => {
    const calm = shoreWetnessOf(10);
    const rough = shoreWetnessOf(90);
    expect(rough.shoreTop).toBeGreaterThan(calm.shoreTop);
    expect(rough.shoreFade).toBeGreaterThan(calm.shoreFade);
  });

  it('reads no swell, a negative one or a broken one as wet to mean sea level and no further', () => {
    for (const reach of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const { shoreTop, shoreFade } = shoreWetnessOf(reach);
      expect(shoreTop).toBe(SEA_LEVEL);
      expect(shoreFade).toBe(0);
    }
  });
});

describe('how the rain wets the ground and how it dries', () => {
  it('rises monotonically toward soaked and never overshoots', () => {
    let wet = 0;
    let last = 0;
    for (let s = 0; s < 600; s += 1) {
      wet = easeRainWetness(wet, 1, 1);
      expect(wet).toBeGreaterThanOrEqual(last);
      expect(wet).toBeLessThanOrEqual(1);
      last = wet;
    }
    expect(wet).toBeGreaterThan(0.99);
  });

  it('falls monotonically toward dry once the rain stops, and never below it', () => {
    let wet = 1;
    let last = 1;
    for (let s = 0; s < 3600; s += 1) {
      wet = easeRainWetness(wet, 0, 1);
      expect(wet).toBeLessThanOrEqual(last);
      expect(wet).toBeGreaterThanOrEqual(0);
      last = wet;
    }
    expect(wet).toBeLessThan(0.01);
  });

  it('closes about 63% of the gap in one tau, wetting on WET_TAU_S and drying on DRY_TAU_S', () => {
    const e = 1 - Math.exp(-1);
    expect(easeRainWetness(0, 1, WET_TAU_S)).toBeCloseTo(e, 9);
    expect(easeRainWetness(1, 0, DRY_TAU_S)).toBeCloseTo(1 - e, 9);
    // Part-way gaps close by the same fraction.
    expect(easeRainWetness(0.2, 0.8, WET_TAU_S)).toBeCloseTo(0.2 + 0.6 * e, 9);
    expect(easeRainWetness(0.8, 0.2, DRY_TAU_S)).toBeCloseTo(0.8 - 0.6 * e, 9);
  });

  it('dries slower than it wets, with the taus the file says', () => {
    expect(WET_TAU_S).toBe(20);
    expect(DRY_TAU_S).toBe(180);
    expect(DRY_TAU_S).toBeGreaterThan(WET_TAU_S);
    // The same second of rain moves the ground more than the same second of sun.
    expect(easeRainWetness(0, 1, 1)).toBeGreaterThan(1 - easeRainWetness(1, 0, 1));
  });

  it('lands in the same place whether stepped once or sixty times', () => {
    // THE FRAME-RATE INDEPENDENCE this exists for. A phone at 30 fps
    // and the headless probe at a frame and a half a second hand in
    // different dts and must show the same ground at the same simulated
    // time.
    let stepped = 0;
    for (let s = 0; s < 60; s += 1) stepped = easeRainWetness(stepped, 1, 1);
    expect(stepped).toBeCloseTo(easeRainWetness(0, 1, 60), 12);

    let dried = 1;
    for (let s = 0; s < 60; s += 1) dried = easeRainWetness(dried, 0, 1);
    expect(dried).toBeCloseTo(easeRainWetness(1, 0, 60), 12);

    // And at an uneven cadence — the frame times a real game hands in.
    let ragged = 0.3;
    let clock = 0;
    for (const dt of [0.016, 0.033, 0.5, 0.016, 0.1, 0.25, 0.085]) {
      ragged = easeRainWetness(ragged, 0.9, dt);
      clock += dt;
    }
    expect(ragged).toBeCloseTo(easeRainWetness(0.3, 0.9, clock), 12);
  });

  it('holds the ground still when no time passes — a paused game, a negative dt, a broken one', () => {
    for (const dt of [0, -1, -0.001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(easeRainWetness(0.4, 1, dt)).toBe(0.4);
      expect(easeRainWetness(0.4, 0, dt)).toBe(0.4);
    }
  });

  it('is never NaN and never leaves 0..1, whatever it is handed', () => {
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -3, 7];
    for (const current of [...bad, 0, 0.5, 1]) {
      for (const target of [...bad, 0, 0.5, 1]) {
        for (const dt of [...bad, 0, 0.016, 60]) {
          const out = easeRainWetness(current, target, dt);
          expect(Number.isNaN(out)).toBe(false);
          expect(out).toBeGreaterThanOrEqual(0);
          expect(out).toBeLessThanOrEqual(1);
        }
      }
    }
    // A target that is not a number is not chased; a current value that
    // is not a number is read as dry rather than poisoning every frame.
    expect(easeRainWetness(0.4, Number.NaN, 1)).toBe(0.4);
    expect(easeRainWetness(Number.NaN, 1, 0)).toBe(0);
    // Out-of-range targets are clamped, so a rain strength of 7 soaks to 1 and stops there.
    expect(easeRainWetness(0.99, 7, 1_000_000)).toBeCloseTo(1, 9);
    expect(easeRainWetness(0.01, -3, 1_000_000)).toBeCloseTo(0, 9);
  });
});
