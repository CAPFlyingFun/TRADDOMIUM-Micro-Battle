/**
 * THE FIRST SHADOW'S NUMBERS, held to Joshua's brief (2026-09-07)
 * without a canvas, because `sky/shadows.ts` is pure:
 *
 *   the table names every rung the detail ladder has, and no other,
 *     with the map growing up the ladder and NOTHING under medium
 *   high — the most a phone is offered — is 1024 texels, and no mobile
 *     rung asks for more: "High must stay a viable mobile rung"
 *   an unknown rung reads as medium, as the rain's cap does
 *   the night's 0.06 key light casts nothing; a clear sun does
 *   the shadow is gone at the key light's floor and full by 15°, and
 *     moves continuously between — nothing pops in at sunrise
 *   an overcast sky has no hard shadow: the strength is 1 − gloom
 *   the normal bias is 1.5 texels, and more than float32's spacing at
 *     the coast at every rung that has a map
 */
import { describe, expect, it } from 'vitest';
import { DETAIL_TIERS, MOBILE_DETAIL } from '../src/assets/detailQuality';
import {
  NORMAL_BIAS_TEXELS, NO_SHADOW, SHADOW_FULL_ABOVE_DEG, SHADOW_GONE_AT_DEG, SHADOW_RUNGS, SHADOW_SUN_MIN,
  shadowCasts, shadowElevationFade, shadowFor, shadowIntensityFor, shadowNormalBias, shadowTexel,
} from '../src/sky/shadows';
import { LIGHT_FLOOR, skyLook } from '../src/sky/skyLook';
import type { SunPosition } from '../src/world/weather/solar';
import { FAIR, visibilityFor, type WeatherNow } from '../src/world/weather/weather';

const DEG = Math.PI / 180;
/** 100 world units to the metre, as everywhere. */
const M = 100;

const sun = (elevationDeg: number, azimuthDeg = 180): SunPosition => ({
  elevation: elevationDeg * DEG,
  azimuth: azimuthDeg * DEG,
  declination: 0,
  equationOfTimeMinutes: 0,
});
const weather = (over: Partial<WeatherNow> = {}): WeatherNow => ({ ...FAIR, ...over });

const CLEAR = weather({ cloud: 0.1 });
const OVERCAST = weather({ sky: 'cloudy', cloud: 0.95, visibilityM: visibilityFor(0, 0.95) });

describe('the rungs', () => {
  it('name every rung the detail ladder has, and no other', () => {
    expect(Object.keys(SHADOW_RUNGS).sort()).toEqual([...DETAIL_TIERS].sort());
    for (const tier of DETAIL_TIERS) expect(SHADOW_RUNGS[tier], tier).toBeDefined();
  });

  it('grow the map up the ladder, with nothing under medium', () => {
    let last = -1;
    for (const tier of DETAIL_TIERS) {
      const spec = SHADOW_RUNGS[tier];
      expect(spec.mapSize, tier).toBeGreaterThanOrEqual(last);
      expect(spec.mapSize, `${tier} map is not an integer`).toBe(Math.floor(spec.mapSize));
      last = spec.mapSize;
    }
    expect(SHADOW_RUNGS['ultra-low']).toEqual(NO_SHADOW);
    expect(SHADOW_RUNGS.low).toEqual(NO_SHADOW);
    expect(SHADOW_RUNGS.medium.mapSize).toBeGreaterThan(0);
    // A map with no reach, or a reach with no map, is not a shadow.
    for (const tier of DETAIL_TIERS) {
      const spec = SHADOW_RUNGS[tier];
      expect(spec.mapSize > 0, tier).toBe(spec.reach > 0);
    }
  });

  it('keep every mobile rung at or under 1024 texels: high must stay a viable mobile rung', () => {
    expect(SHADOW_RUNGS.high.mapSize).toBe(1024);
    for (const tier of MOBILE_DETAIL) expect(SHADOW_RUNGS[tier].mapSize, tier).toBeLessThanOrEqual(1024);
    expect(SHADOW_RUNGS['ultra-high'].mapSize).toBeGreaterThan(SHADOW_RUNGS.high.mapSize);
  });

  it('reach further up the ladder, and put a 1024 map over 8 m at under a centimetre a texel', () => {
    let last = -1;
    for (const tier of DETAIL_TIERS) {
      expect(SHADOW_RUNGS[tier].reach, tier).toBeGreaterThanOrEqual(last);
      last = SHADOW_RUNGS[tier].reach;
    }
    expect(SHADOW_RUNGS.high.reach).toBe(4 * M);
    expect(shadowTexel(SHADOW_RUNGS.high)).toBeCloseTo(0.78125, 9);
    expect(shadowTexel(SHADOW_RUNGS.medium)).toBeLessThan(1);
    expect(shadowTexel(SHADOW_RUNGS['ultra-high'])).toBeLessThan(1);
    expect(shadowTexel(NO_SHADOW)).toBe(0);
  });

  it('read an unknown rung as medium', () => {
    expect(shadowFor('nonsense')).toBe(SHADOW_RUNGS.medium);
    expect(shadowFor('high')).toBe(SHADOW_RUNGS.high);
    expect(shadowFor('low')).toBe(NO_SHADOW);
  });
});

describe('when there is a shadow', () => {
  const HIGH = SHADOW_RUNGS.high;

  it('never at night: the 0.06 key light is moon and skyglow, not a sun', () => {
    const night = skyLook(CLEAR, sun(-30));
    expect(night.sunIntensity).toBeLessThan(SHADOW_SUN_MIN);
    expect(shadowCasts(HIGH, night)).toBe(false);
    // And a clear day is well above the line.
    expect(skyLook(CLEAR, sun(80)).sunIntensity).toBeGreaterThan(SHADOW_SUN_MIN * 2);
    expect(shadowCasts(HIGH, skyLook(CLEAR, sun(80)))).toBe(true);
    // A rung with no map casts nothing, whatever the sun.
    expect(shadowCasts(NO_SHADOW, skyLook(CLEAR, sun(80)))).toBe(false);
  });

  it('is gone at the key light’s floor and full by fifteen degrees, continuously between', () => {
    expect(SHADOW_GONE_AT_DEG).toBeCloseTo(LIGHT_FLOOR / DEG, 12);
    expect(SHADOW_FULL_ABOVE_DEG).toBe(15);
    expect(shadowElevationFade(LIGHT_FLOOR)).toBe(0);
    expect(shadowElevationFade(SHADOW_FULL_ABOVE_DEG * DEG)).toBeCloseTo(1, 12);
    expect(shadowElevationFade(80 * DEG)).toBe(1);
    expect(shadowElevationFade((SHADOW_GONE_AT_DEG + SHADOW_FULL_ABOVE_DEG) / 2 * DEG)).toBeCloseTo(0.5, 9);
    // The look's key light is floored, so after sunset the fade is exactly zero, not merely small.
    expect(shadowIntensityFor(skyLook(CLEAR, sun(-10)))).toBe(0);
    expect(shadowIntensityFor(skyLook(CLEAR, sun(2)))).toBe(0);
    // Swept at a quarter of a degree: no step larger than the ramp's own slope.
    let last = shadowIntensityFor(skyLook(CLEAR, sun(-30)));
    for (let e = -30 + 0.25; e <= 90; e += 0.25) {
      const now = shadowIntensityFor(skyLook(CLEAR, sun(e)));
      expect(now - last, `at ${e}°`).toBeGreaterThanOrEqual(-1e-9);
      expect(now - last, `at ${e}°`).toBeLessThan(0.25 / (SHADOW_FULL_ABOVE_DEG - SHADOW_GONE_AT_DEG) + 1e-9);
      last = now;
    }
    expect(last).toBe(1);
  });

  it('is full under a clear noon and washed out under cover: an overcast sky has no hard shadow', () => {
    const clear = skyLook(CLEAR, sun(80));
    expect(clear.gloom).toBe(0);
    expect(shadowIntensityFor(clear)).toBe(1);
    const grey = skyLook(OVERCAST, sun(80));
    expect(grey.gloom).toBeGreaterThan(0.99);
    expect(shadowIntensityFor(grey)).toBeLessThan(0.01);
    expect(shadowCasts(HIGH, grey)).toBe(false);
    // Half cover: half a shadow, at the pace the light itself fades.
    const half = skyLook(weather({ cloud: 0.7 }), sun(80));
    expect(half.gloom).toBeCloseTo(0.5, 9);
    expect(shadowIntensityFor(half)).toBeCloseTo(0.5, 9);
    expect(shadowCasts(HIGH, half)).toBe(true);
    // Rain is gloom too.
    expect(shadowIntensityFor(skyLook(weather({ cloud: 0.1, rainMmHr: 10 }), sun(80)))).toBeLessThan(0.1);
  });

  it('does not pay for a depth pass when the shadow would be invisible', () => {
    // Between the night's line and the floor the sun is "up" but the fade is zero: no pass.
    for (const e of [-20, -5, 0, 6]) {
      const look = skyLook(CLEAR, sun(e));
      expect(shadowIntensityFor(look), `at ${e}°`).toBe(0);
      expect(shadowCasts(HIGH, look), `at ${e}°`).toBe(false);
    }
    expect(shadowCasts(HIGH, skyLook(CLEAR, sun(7)))).toBe(true);
  });
});

describe('the bias', () => {
  it('is a texel and a half, and more than float32’s quarter-unit spacing at the coast on every rung with a map', () => {
    expect(NORMAL_BIAS_TEXELS).toBe(1.5);
    for (const tier of DETAIL_TIERS) {
      const spec = SHADOW_RUNGS[tier];
      expect(shadowNormalBias(spec), tier).toBeCloseTo(shadowTexel(spec) * 1.5, 12);
      if (spec.mapSize > 0) expect(shadowNormalBias(spec), tier).toBeGreaterThan(0.25);
    }
    expect(shadowNormalBias(NO_SHADOW)).toBe(0);
  });
});
