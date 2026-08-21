import { describe, expect, it } from 'vitest';
import {
  compass, describe as describeCode, fahrenheit, glyph, headingFromBearing,
  mph, toGameWeather, RAIN_FULL, WIND_FULL,
} from '../src/weather/gameplay';
import { TYPICAL, type Conditions } from '../src/weather/conditions';
import { UNITS_PER_METRE } from '../src/world/kauai';

const at = (over: Partial<Conditions>): Conditions => ({ ...TYPICAL, ...over });

/** Travel for a world heading, in the game's own convention. */
function travel(heading: number) {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

describe('turning weather into game numbers', () => {
  it('puts an ordinary trade wind around two thirds of the dial', () => {
    // 20 mph is the island's normal afternoon.
    const kmh = 20 * 1.609344;
    const game = toGameWeather(at({ windSpeed: kmh }));
    expect(game.windStrength).toBeGreaterThan(0.6);
    expect(game.windStrength).toBeLessThan(0.7);
  });

  it('never lets a real number off the leash', () => {
    const hurricane = toGameWeather(at({
      windSpeed: 260, windGust: 340, rain: 180, cloud: 100, humidity: 100,
      temperature: 48,
    }));
    for (const value of [
      hurricane.windStrength, hurricane.gustStrength, hurricane.rainfall,
      hurricane.cloudiness, hurricane.gloom, hurricane.warmth, hurricane.damp,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('leaves her something to see in the very worst of it', () => {
    const blind = toGameWeather(at({ visibility: 0 }));
    expect(blind.sight).toBeGreaterThan(10 * UNITS_PER_METRE);
    const gloomiest = toGameWeather(at({ cloud: 100, rain: 200 }));
    expect(gloomiest.gloom).toBeLessThan(1);
  });

  it('blows a north wind toward the south', () => {
    // North is -Z, so south is +Z.
    const north = toGameWeather(at({ windFrom: 0 }));
    const go = travel(north.windHeading);
    expect(go.z).toBeGreaterThan(0.99);
    expect(Math.abs(go.x)).toBeLessThan(0.01);
  });

  it('blows an east wind toward the west', () => {
    // East is +X, so west is -X.
    const east = toGameWeather(at({ windFrom: 90 }));
    const go = travel(east.windHeading);
    expect(go.x).toBeLessThan(-0.99);
    expect(Math.abs(go.z)).toBeLessThan(0.01);
  });

  it('blows the trades from the northeast toward the southwest', () => {
    const trades = toGameWeather(at({ windFrom: 65 }));
    const go = travel(trades.windHeading);
    expect(go.x).toBeLessThan(0); // toward the west
    expect(go.z).toBeGreaterThan(0); // and the south
  });

  it('reads a bearing back the way it went in', () => {
    for (const bearing of [0, 45, 90, 137, 180, 225, 270, 359]) {
      const heading = headingFromBearing(bearing);
      expect(heading).toBeGreaterThanOrEqual(-Math.PI);
      expect(heading).toBeLessThanOrEqual(Math.PI);
      const go = travel(heading);
      const back = ((Math.atan2(go.x, -go.z) * 180) / Math.PI + 360) % 360;
      expect(Math.abs(back - bearing)).toBeLessThan(1e-6);
    }
  });

  it('makes drizzle visible without making it a downpour', () => {
    // PRECIPITATION, not `rain`. Drizzle is not counted as rain by the
    // provider, which is the whole reason the panel could say DRIZZLE
    // and "none" at once.
    const drizzle = toGameWeather(at({ precipitation: 0.2 })).rainfall;
    const downpour = toGameWeather(at({ precipitation: RAIN_FULL })).rainfall;
    expect(drizzle).toBeGreaterThan(0.1);
    expect(drizzle).toBeLessThan(0.3);
    expect(downpour).toBeCloseTo(1, 6);
  });

  it('gets darker as it clouds over', () => {
    const clear = toGameWeather(at({ cloud: 0, rain: 0 })).gloom;
    const grey = toGameWeather(at({ cloud: 60, rain: 0 })).gloom;
    const black = toGameWeather(at({ cloud: 100, rain: 6 })).gloom;
    expect(clear).toBeLessThan(grey);
    expect(grey).toBeLessThan(black);
  });

  it('spends the sight budget in world units', () => {
    const game = toGameWeather(at({ visibility: 5_000 }));
    expect(game.sight).toBeCloseTo(5_000 * UNITS_PER_METRE, 6);
  });

  it('has a name and a face for every code it will meet', () => {
    expect(describeCode(0)).toBe('Clear');
    expect(describeCode(3)).toBe('Overcast');
    expect(describeCode(61)).toBe('Rain');
    expect(describeCode(95)).toBe('Thunderstorms');
    for (const code of [0, 1, 2, 3, 45, 51, 61, 65, 80, 95, 99]) {
      expect(describeCode(code).length).toBeGreaterThan(2);
      expect(glyph(code).length).toBeGreaterThan(0);
    }
  });

  it('speaks in the units Joshua reads the forecast in', () => {
    expect(fahrenheit(25)).toBeCloseTo(77, 6);
    expect(fahrenheit(0)).toBeCloseTo(32, 6);
    expect(mph(1.609344)).toBeCloseTo(1, 6);
    expect(compass(0)).toBe('N');
    expect(compass(65)).toBe('ENE');
    expect(compass(180)).toBe('S');
    expect(compass(359)).toBe('N');
  });

  it('keeps its tuning where it can be found', () => {
    expect(WIND_FULL).toBeGreaterThan(0);
    expect(RAIN_FULL).toBeGreaterThan(0);
  });
});
