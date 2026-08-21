import { describe, expect, it } from 'vitest';
import { WeatherField, REACH } from '../src/weather/field';
import { TYPICAL, type Conditions, type WeatherSample } from '../src/weather/conditions';
import { STATIONS } from '../src/weather/stations';
import { world } from '../src/world/coords';
import { geoToWorld } from '../src/world/geo';

function sample(
  id: string, wx: number, wz: number, over: Partial<Conditions>,
): WeatherSample {
  return {
    id,
    name: id,
    where: { lat: 22, lon: -159.5 },
    at: world(wx, wz),
    conditions: { ...TYPICAL, ...over },
  };
}

describe('the weather field', () => {
  it('reports a station exactly, standing on it', () => {
    const field = new WeatherField([
      sample('a', 0, 0, { rain: 4, cloud: 90 }),
      sample('b', 500_000, 0, { rain: 0, cloud: 5 }),
    ], 'live', 0);

    const here = field.at(world(0, 0));
    expect(here.rain).toBeCloseTo(4, 6);
    expect(here.cloud).toBeCloseTo(90, 6);
  });

  it('puts the midpoint between the two readings', () => {
    const field = new WeatherField([
      sample('a', 0, 0, { cloud: 100 }),
      sample('b', 400_000, 0, { cloud: 0 }),
    ], 'live', 0);

    const middle = field.at(world(200_000, 0));
    expect(middle.cloud).toBeGreaterThan(30);
    expect(middle.cloud).toBeLessThan(70);
  });

  it('leans toward whichever station is nearer', () => {
    const field = new WeatherField([
      sample('wet', 0, 0, { rain: 10 }),
      sample('dry', 1_000_000, 0, { rain: 0 }),
    ], 'live', 0);

    const nearWet = field.at(world(200_000, 0)).rain;
    const nearDry = field.at(world(800_000, 0)).rain;
    expect(nearWet).toBeGreaterThan(nearDry);
  });

  /**
   * THE SEAM TEST. Halve the sampling step and the largest change
   * between neighbouring samples should roughly halve too. A jump
   * discontinuity does not shrink when you look closer at it — that is
   * what makes it a jump — so this catches the hard border the
   * naive nearest-four method would leave behind.
   */
  it('has no hard borders anywhere along a transect', () => {
    const field = new WeatherField(
      STATIONS.map((s, i) => ({
        id: s.id,
        name: s.name,
        where: s.where,
        at: s.at,
        conditions: {
          ...TYPICAL,
          rain: (i % 5) * 2.5,
          cloud: (i * 37) % 100,
          windFrom: (i * 53) % 360,
        },
      })),
      'live',
      0,
    );

    const from = geoToWorld({ lat: 21.90, lon: -159.78 });
    const to = geoToWorld({ lat: 22.23, lon: -159.30 });

    const worstAt = (steps: number): number => {
      let worst = 0;
      let last = field.at(from).cloud;
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const here = field.at(world(
          from.wx + (to.wx - from.wx) * t,
          from.wz + (to.wz - from.wz) * t,
        )).cloud;
        worst = Math.max(worst, Math.abs(here - last));
        last = here;
      }
      return worst;
    };

    const coarse = worstAt(400);
    const fine = worstAt(800);
    // Continuous: looking twice as closely finds steps about half the
    // size. A seam would hold its height at any resolution.
    expect(fine).toBeLessThan(coarse * 0.75);
  });

  it('blends wind across north without swinging through south', () => {
    const field = new WeatherField([
      sample('a', 0, 0, { windFrom: 350 }),
      sample('b', 400_000, 0, { windFrom: 10 }),
    ], 'live', 0);

    const middle = field.at(world(200_000, 0)).windFrom;
    // Somewhere around due north — never 180, which is what averaging
    // the raw degrees would have said.
    const offNorth = Math.min(middle, 360 - middle);
    expect(offNorth).toBeLessThan(5);
  });

  it('does not average the weather code into a fiction', () => {
    const field = new WeatherField([
      sample('clear', 0, 0, { code: 0 }),
      sample('storm', 400_000, 0, { code: 95 }),
    ], 'live', 0);

    for (const wx of [0, 100_000, 199_000, 250_000, 400_000]) {
      const code = field.at(world(wx, 0)).code;
      expect([0, 95]).toContain(code);
    }
  });

  it('falls back to the nearest station far out to sea', () => {
    const field = new WeatherField([
      sample('coast', 0, 0, { rain: 3 }),
    ], 'live', 0);

    const far = field.at(world(REACH * 4, 0));
    expect(far.rain).toBeCloseTo(3, 6);
  });

  it('is anchored to real geography, not to render space', () => {
    // A station's world position is exactly what the one geo transform
    // says it is. Nothing here knows the floating origin exists.
    for (const station of STATIONS) {
      const expected = geoToWorld(station.where);
      expect(station.at.wx).toBeCloseTo(expected.wx, 6);
      expect(station.at.wz).toBeCloseTo(expected.wz, 6);
    }
  });

  it('gives the same answer for the same global point, always', () => {
    const field = new WeatherField([
      sample('a', 0, 0, { rain: 7 }),
      sample('b', 900_000, 300_000, { rain: 0 }),
    ], 'live', 0);
    const point = world(310_000, 88_000);
    const first = field.at(point);
    for (let i = 0; i < 50; i += 1) field.at(world(i * 9_999, i * -7_777));
    expect(field.at(point)).toEqual(first);
  });

  it('refuses to answer with no samples at all', () => {
    const field = new WeatherField([], 'live', 0);
    expect(field.empty).toBe(true);
    expect(() => field.at(world(0, 0))).toThrow();
  });
});
