/**
 * THE SKY DOES NOT SNAP — and it does not drift with the frame rate.
 *
 * `WeatherBlend` eases what the field reports. Pinned here: the first
 * reading is arrived in, not faded to; each variable closes 63% of its
 * gap in exactly its own tau; a dt of zero (a paused game) freezes it;
 * one step of 60 s lands where sixty steps of 1 s do; the wind backs
 * the short way round the compass; and the WMO code, a label, changes
 * when it changes.
 */
import { describe, expect, it } from 'vitest';
import { TAU, WeatherBlend } from '../src/world/weather/blend';
import { TYPICAL, type Conditions } from '../src/world/weather/conditions';

const A: Conditions = Object.freeze({
  temperature: 20,
  humidity: 50,
  precipitation: 0,
  rain: 0,
  showers: 0,
  cloud: 20,
  windSpeed: 10,
  windFrom: 350,
  windGust: 15,
  visibility: 24_000,
  code: 1,
});

const B: Conditions = Object.freeze({
  temperature: 30,
  humidity: 90,
  precipitation: 6,
  rain: 4,
  showers: 2,
  cloud: 100,
  windSpeed: 30,
  windFrom: 10,
  windGust: 55,
  visibility: 4_000,
  code: 61,
});

/** 63.2%: what `1 - exp(-1)` closes in one tau. */
const ONE_TAU = 1 - Math.exp(-1);

function closed(from: number, to: number, now: number): number {
  return (now - from) / (to - from);
}

describe('the table is v0\'s', () => {
  it('keeps the eight time constants', () => {
    expect(TAU).toEqual({
      temperature: 300,
      humidity: 240,
      rain: 35,
      cloud: 150,
      windSpeed: 40,
      windFrom: 60,
      windGust: 12,
      visibility: 120,
    });
  });
});

describe('starting', () => {
  it('reports TYPICAL and stays unstarted before anything is aimed', () => {
    const blend = new WeatherBlend();
    expect(blend.started).toBe(false);
    expect(blend.current).toBeNull();
    expect(blend.target).toBeNull();
    expect(blend.advance(5)).toBe(TYPICAL);
    expect(blend.started).toBe(false);
  });

  it('arrives in the first conditions rather than easing from nothing', () => {
    // v0's lesson: easing from zero spawns her in a freezing, airless,
    // perfectly clear world that warms up over five minutes.
    const blend = new WeatherBlend();
    blend.aim(A);
    expect(blend.started).toBe(true);
    expect(blend.current).toEqual(A);
    expect(blend.advance(1_000)).toEqual(A);
  });

  it('set arrives, and the target is the shown value', () => {
    const blend = new WeatherBlend();
    blend.aim(A);
    blend.aim(B);
    blend.advance(10);
    blend.set(A);
    expect(blend.current).toEqual(A);
    expect(blend.target).toEqual(A);
    expect(blend.advance(1_000)).toEqual(A);
  });
});

describe('each variable has its own pace', () => {
  const channels: ReadonlyArray<readonly [keyof Conditions, keyof typeof TAU]> = [
    ['temperature', 'temperature'],
    ['humidity', 'humidity'],
    ['precipitation', 'rain'],
    ['rain', 'rain'],
    ['showers', 'rain'],
    ['cloud', 'cloud'],
    ['windSpeed', 'windSpeed'],
    ['windGust', 'windGust'],
    ['visibility', 'visibility'],
  ];

  for (const [channel, tau] of channels) {
    it(`closes 63% of the ${channel} gap in exactly TAU.${tau} seconds`, () => {
      const blend = new WeatherBlend();
      blend.set(A);
      blend.aim(B);
      const now = blend.advance(TAU[tau]);
      expect(closed(A[channel], B[channel], now[channel])).toBeCloseTo(ONE_TAU, 9);
    });
  }

  it('moves the three precipitation figures in step', () => {
    // The same weather counted three ways must not drift apart.
    const blend = new WeatherBlend();
    blend.set(A);
    blend.aim(B);
    const now = blend.advance(20);
    const p = closed(A.precipitation, B.precipitation, now.precipitation);
    expect(closed(A.rain, B.rain, now.rain)).toBeCloseTo(p, 12);
    expect(closed(A.showers, B.showers, now.showers)).toBeCloseTo(p, 12);
  });

  it('switches the code immediately: it is a label, not a quantity', () => {
    const blend = new WeatherBlend();
    blend.set(A);
    blend.aim(B);
    expect(blend.advance(0.001).code).toBe(B.code);
  });
});

describe('time', () => {
  it('freezes at dt 0, negative and NaN — a paused game holds the sky', () => {
    const blend = new WeatherBlend();
    blend.set(A);
    blend.aim(B);
    const before = blend.advance(5);
    for (const dt of [0, -1, -1e9, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(blend.advance(dt)).toBe(before);
    }
    expect(blend.current).toBe(before);
  });

  it('lands in the same place stepped once or sixty times', () => {
    // `1 - exp(-dt/tau)`, not `dt * rate`: a phone at 60 fps and the
    // headless probe at a frame and a half a second must be in the same
    // sky at the same simulated second.
    const once = new WeatherBlend();
    once.set(A);
    once.aim(B);
    const coarse = once.advance(60);

    const many = new WeatherBlend();
    many.set(A);
    many.aim(B);
    let fine: Conditions = A;
    for (let i = 0; i < 60; i += 1) fine = many.advance(1);

    for (const key of Object.keys(A) as (keyof Conditions)[]) {
      expect(fine[key]).toBeCloseTo(coarse[key], 9);
    }
  });

  it('converges on the target given enough time', () => {
    const blend = new WeatherBlend();
    blend.set(A);
    blend.aim(B);
    const now = blend.advance(TAU.temperature * 40);
    for (const key of Object.keys(B) as (keyof Conditions)[]) {
      expect(now[key]).toBeCloseTo(B[key], 6);
    }
  });
});

describe('the wind backs the short way', () => {
  it('eases 350° toward 10° through north, never through south', () => {
    const blend = new WeatherBlend();
    blend.set(A); // from 350
    blend.aim(B); // from 10
    for (let i = 0; i < 30; i += 1) {
      const from = blend.advance(TAU.windFrom / 10).windFrom;
      // Within twenty degrees of north, on either side of the wrap.
      expect(Math.cos((from * Math.PI) / 180)).toBeGreaterThan(Math.cos((20 * Math.PI) / 180));
      expect(from).toBeGreaterThanOrEqual(0);
      expect(from).toBeLessThan(360);
    }
    expect(blend.advance(TAU.windFrom * 40).windFrom).toBeCloseTo(10, 6);
  });
});

describe('what it hands out', () => {
  it('returns frozen conditions, so a caller cannot corrupt the blend', () => {
    const blend = new WeatherBlend();
    blend.aim(A);
    expect(Object.isFrozen(blend.current)).toBe(true);
    blend.aim(B);
    expect(Object.isFrozen(blend.target)).toBe(true);
    expect(Object.isFrozen(blend.advance(1))).toBe(true);
  });
});
