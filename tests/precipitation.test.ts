import { describe, expect, it } from 'vitest';
import {
  describeWeather, fallingNow, floorFor, glyphFor, toGameWeather,
} from '../src/weather/gameplay';
import { TYPICAL, type Conditions } from '../src/weather/conditions';
import { readPlace, requestUrl } from '../src/weather/openMeteo';
import { STATION_POINTS } from '../src/weather/stations';

const at = (over: Partial<Conditions>): Conditions => ({ ...TYPICAL, ...over });

/** WMO: 51-55 drizzle, 61-65 rain, 80-82 showers, 95+ storm. */
const DRIZZLE = 53;
const RAIN = 63;
const MOSTLY_CLEAR = 1;

describe('the drizzle contradiction', () => {
  it('asks the provider for total precipitation, not only rain', () => {
    const query = new URLSearchParams(requestUrl(STATION_POINTS).split('?')[1]);
    const current = query.get('current') ?? '';
    expect(current).toContain('precipitation');
    expect(current).toContain('rain');
    expect(current).toContain('showers');
  });

  it('reads the total the provider sends', () => {
    const read = readPlace({
      current: { precipitation: 0.3, rain: 0, showers: 0.3, weather_code: 80 },
    });
    expect(read.precipitation).toBeCloseTo(0.3, 6);
    expect(read.rain).toBeCloseTo(0, 6);
    expect(read.showers).toBeCloseTo(0.3, 6);
  });

  it('rebuilds a missing total from its parts rather than reporting dry', () => {
    const read = readPlace({ current: { rain: 0.4, showers: 0.2 } });
    expect(read.precipitation).toBeCloseTo(0.6, 6);
  });

  /** A) drizzle code with a real measurement. */
  it('A: drizzle with 0.2 mm/h drizzles, and says 0.2', () => {
    const now = at({ code: DRIZZLE, precipitation: 0.2, rain: 0 });
    expect(fallingNow(now)).toBeCloseTo(0.2, 6);
    expect(describeWeather(now.code, fallingNow(now))).toBe('Drizzle');
    expect(toGameWeather(now).rainfall).toBeGreaterThan(0);
  });

  /**
   * B) THE BUG JOSHUA CAUGHT. A drizzle code whose total has rounded
   * away to nothing must still drizzle, and must never read "none".
   */
  it('B: drizzle rounded to zero still drizzles and never says none', () => {
    const now = at({ code: DRIZZLE, precipitation: 0, rain: 0, showers: 0 });
    const falling = fallingNow(now);
    expect(falling).toBeGreaterThan(0);
    expect(falling).toBeLessThan(0.15); // a hair, not invented weather
    expect(describeWeather(now.code, falling)).toBe('Drizzle');
    expect(toGameWeather(now).rainfall).toBeGreaterThan(0);
  });

  /** C) a dry sky stays dry. */
  it('C: mostly clear with nothing falling renders no drops', () => {
    const now = at({ code: MOSTLY_CLEAR, precipitation: 0, rain: 0, showers: 0 });
    expect(fallingNow(now)).toBe(0);
    expect(toGameWeather(now).rainfall).toBe(0);
    expect(describeWeather(now.code, 0)).toBe('Mostly clear');
  });

  /** D) water falling beats a code that says otherwise. */
  it('D: measurable precipitation is drawn whatever the code claims', () => {
    const now = at({ code: MOSTLY_CLEAR, precipitation: 1.4 });
    expect(fallingNow(now)).toBeCloseTo(1.4, 6);
    expect(toGameWeather(now).rainfall).toBeGreaterThan(0.3);
    // And it must not still be calling itself clear over visible rain.
    expect(describeWeather(now.code, 1.4)).not.toMatch(/clear/i);
    expect(glyphFor(now.code, 1.4)).not.toBe('☀️');
  });

  it('never lets the description and the drops disagree', () => {
    for (const code of [0, 1, 2, 3, 45, 51, 53, 61, 63, 65, 80, 81, 95]) {
      for (const precipitation of [0, 0, 0.02, 0.2, 1, 6]) {
        const now = at({ code, precipitation });
        const falling = fallingNow(now);
        const words = describeWeather(code, falling);
        const wet = /drizzle|rain|shower|storm|snow/i.test(words);
        const drops = toGameWeather(now).rainfall > 0;
        expect(wet).toBe(drops);
      }
    }
  });

  it('lifts a wet code by a hair, never into a downpour', () => {
    for (const code of [51, 53, 61, 63, 80, 95]) {
      expect(floorFor(code)).toBeGreaterThan(0);
      expect(floorFor(code)).toBeLessThan(2);
    }
    // A storm floor still reads as less than an actual storm.
    expect(floorFor(95)).toBeLessThan(6);
  });

  it('believes a real measurement over a code floor', () => {
    // Heavy rain under a drizzle code is heavy rain.
    expect(fallingNow(at({ code: DRIZZLE, precipitation: 5 }))).toBeCloseTo(5, 6);
    expect(fallingNow(at({ code: RAIN, precipitation: 3 }))).toBeCloseTo(3, 6);
  });
});
