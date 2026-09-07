/**
 * THE FIELD HAS NO SEAMS, AND A STATION IS ITSELF.
 *
 * `WeatherField` turns twenty-two readings into a value anywhere on the
 * island. What is pinned here is the set of promises the rest of Phase 5
 * leans on: a station reads exactly what it reported; the midpoint of
 * two stations is between them; nothing steps as you walk; wind is
 * averaged as a vector and never as degrees; the WMO code is the
 * nearest station's; and far offshore the nearest coast answers.
 *
 * Nothing here needs a clock, a network or a canvas — the readings are
 * built by hand from `TYPICAL` and the real station positions.
 */
import { describe, expect, it } from 'vitest';
import { translate, world, type WorldPoint } from '../src/world/coords';
import { TYPICAL, type Conditions } from '../src/world/weather/conditions';
import { REACH, UNDERFOOT, WeatherField, type StationReading } from '../src/world/weather/field';
import { STATIONS, type Station } from '../src/world/weather/stations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function station(id: string): Station {
  const found = STATIONS.find((s) => s.id === id);
  if (!found) throw new Error(`no station ${id}`);
  return found;
}

function reading(id: string, patch: Partial<Conditions> = {}): StationReading {
  return { station: station(id), conditions: { ...TYPICAL, ...patch } };
}

function midpoint(a: WorldPoint, b: WorldPoint): WorldPoint {
  return world((a.wx + b.wx) / 2, (a.wz + b.wz) / 2);
}

/** A point `t` of the way from `a` to `b`. */
function along(a: WorldPoint, b: WorldPoint, t: number): WorldPoint {
  return world(a.wx + (b.wx - a.wx) * t, a.wz + (b.wz - a.wz) * t);
}

/** Every station, each with its own distinct numbers, so a swap would show. */
function varied(): StationReading[] {
  return STATIONS.map((s, i) => ({
    station: s,
    conditions: {
      ...TYPICAL,
      temperature: 10 + i,
      humidity: 40 + i * 2,
      precipitation: (i * 7) % 11,
      rain: (i * 5) % 11,
      showers: (i * 3) % 11,
      cloud: (i * 17) % 101,
      windSpeed: 5 + i,
      windFrom: (i * 37) % 360,
      windGust: 10 + i * 2,
      visibility: 1000 + i * 500,
      code: i % 4 === 0 ? 61 : 0,
    },
  }));
}

const LIHUE = station('lihue');
const POIPU = station('poipu');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('the constants are v0\'s', () => {
  it('reaches twenty kilometres and treats a metre as underfoot', () => {
    expect(REACH).toBe(2_000_000);
    expect(UNDERFOOT).toBe(100);
  });
});

describe('a station is itself', () => {
  it('answers each of the twenty-two with exactly what it reported', () => {
    const field = new WeatherField(varied());
    for (const r of field.readings) {
      expect(field.at(r.station.at)).toBe(r.conditions);
    }
  });

  it('is still the station within a metre of it', () => {
    const field = new WeatherField(varied());
    const r = field.readings[3];
    // 70 cm off the mark, on both axes: within UNDERFOOT, so exact.
    expect(field.at(translate(r.station.at, 50, 50))).toBe(r.conditions);
    // Two metres off: no longer exact, but within a whisker.
    const near = field.at(translate(r.station.at, 150, 150));
    expect(near).not.toBe(r.conditions);
    expect(near.temperature).toBeCloseTo(r.conditions.temperature, 3);
  });
});

describe('between stations', () => {
  it('reads the midpoint of two stations as the mean of their readings', () => {
    const field = new WeatherField([
      reading('lihue', { temperature: 10, cloud: 20, visibility: 2_000 }),
      reading('poipu', { temperature: 30, cloud: 80, visibility: 10_000 }),
    ]);
    const mid = field.at(midpoint(LIHUE.at, POIPU.at));
    expect(mid.temperature).toBeCloseTo(20, 6);
    expect(mid.cloud).toBeCloseTo(50, 6);
    expect(mid.visibility).toBeCloseTo(6_000, 6);
  });

  it('keeps every interpolated channel inside the range of the readings', () => {
    // A weighted mean with non-negative weights cannot leave the hull of
    // its inputs. If it does, a weight went negative — the taper's sign
    // is wrong, or a station past REACH is subtracting.
    const readings = varied();
    const field = new WeatherField(readings);
    const channels = ['temperature', 'humidity', 'precipitation', 'rain', 'showers', 'cloud', 'windGust', 'visibility'] as const;
    const xs = STATIONS.map((s) => s.at.wx);
    const zs = STATIONS.map((s) => s.at.wz);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [z0, z1] = [Math.min(...zs), Math.max(...zs)];

    for (let i = 0; i <= 8; i += 1) {
      for (let k = 0; k <= 8; k += 1) {
        const c = field.at(world(x0 + ((x1 - x0) * i) / 8, z0 + ((z1 - z0) * k) / 8));
        for (const channel of channels) {
          const values = readings.map((r) => r.conditions[channel]);
          expect(c[channel]).toBeGreaterThanOrEqual(Math.min(...values) - 1e-9);
          expect(c[channel]).toBeLessThanOrEqual(Math.max(...values) + 1e-9);
        }
      }
    }
  });

  it('fades a station\'s vote to nothing at the edge of its reach', () => {
    // Shepard's taper, not plain inverse distance: at 19.99 km a station
    // is all but silent, so its entering or leaving the sum at 20 km is
    // not a step. With a 1/d weight it would still hold a third of the
    // vote at that range and the border would be hard.
    const field = new WeatherField([
      reading('lihue', { cloud: 0 }),
      reading('poipu', { cloud: 100 }),
    ]);
    // A point 10 m inside Līhuʻe's reach, 12 km from Poʻipū: Poʻipū's.
    const edge = along(POIPU.at, LIHUE.at, 1 - (REACH - 1_000) / Math.hypot(LIHUE.at.wx - POIPU.at.wx, LIHUE.at.wz - POIPU.at.wz));
    const apart = Math.hypot(edge.wx - LIHUE.at.wx, edge.wz - LIHUE.at.wz);
    expect(apart).toBeCloseTo(REACH - 1_000, 3);
    expect(field.at(edge).cloud).toBeGreaterThan(99.99);
    // And well inside its reach, it is heard.
    expect(field.at(along(POIPU.at, LIHUE.at, 0.5)).cloud).toBeLessThan(60);
  });

  it('has no hard borders: walking from Līhuʻe to Poʻipū never steps', () => {
    // v0's whole reason for Shepard's taper over k-nearest. 200 samples
    // along an 11 km line: no consecutive pair may differ by more than
    // a twentieth of the total range of cloud across the island.
    const field = new WeatherField(varied());
    const clouds = field.readings.map((r) => r.conditions.cloud);
    const range = Math.max(...clouds) - Math.min(...clouds);
    let previous = field.at(along(LIHUE.at, POIPU.at, 0.002)).cloud;
    for (let i = 1; i <= 200; i += 1) {
      const t = 0.002 + (0.996 * i) / 200;
      const cloud = field.at(along(LIHUE.at, POIPU.at, t)).cloud;
      expect(Math.abs(cloud - previous)).toBeLessThan(range * 0.05);
      previous = cloud;
    }
  });
});

describe('the wind is a vector', () => {
  it('averages 350° and 10° to north, not to south', () => {
    const field = new WeatherField([
      reading('lihue', { windSpeed: 20, windFrom: 350 }),
      reading('poipu', { windSpeed: 20, windFrom: 10 }),
    ]);
    const mid = field.at(midpoint(LIHUE.at, POIPU.at));
    // Within a degree of north, on either side of the wrap.
    const off = Math.min(mid.windFrom, 360 - mid.windFrom);
    expect(off).toBeLessThan(1);
    expect(mid.windFrom).toBeGreaterThanOrEqual(0);
    expect(mid.windFrom).toBeLessThan(360);
  });

  it('cancels two opposite winds to a calm', () => {
    const field = new WeatherField([
      reading('lihue', { windSpeed: 20, windFrom: 0 }),
      reading('poipu', { windSpeed: 20, windFrom: 180 }),
    ]);
    expect(field.at(midpoint(LIHUE.at, POIPU.at)).windSpeed).toBeLessThan(1e-9);
  });

  it('does not shrink two equal winds', () => {
    // The mean of two identical vectors is that vector. A speed that
    // came out under 20 here would mean the speed was blended as a
    // scalar and then multiplied by a shortened unit vector.
    const field = new WeatherField([
      reading('lihue', { windSpeed: 20, windFrom: 65 }),
      reading('poipu', { windSpeed: 20, windFrom: 65 }),
    ]);
    const mid = field.at(midpoint(LIHUE.at, POIPU.at));
    expect(mid.windSpeed).toBeCloseTo(20, 9);
    expect(mid.windFrom).toBeCloseTo(65, 9);
  });

  it('carries the gust as a scalar', () => {
    const field = new WeatherField([
      reading('lihue', { windGust: 10 }),
      reading('poipu', { windGust: 30 }),
    ]);
    expect(field.at(midpoint(LIHUE.at, POIPU.at)).windGust).toBeCloseTo(20, 6);
  });
});

describe('labels and edges', () => {
  it('takes the WMO code from the nearest station', () => {
    const field = new WeatherField([
      reading('lihue', { code: 95 }),
      reading('poipu', { code: 0 }),
    ]);
    expect(field.at(along(LIHUE.at, POIPU.at, 0.25)).code).toBe(95);
    expect(field.at(along(LIHUE.at, POIPU.at, 0.75)).code).toBe(0);
  });

  it('answers the nearest coast far offshore, rather than a hole', () => {
    const field = new WeatherField(varied());
    // 150 km due south of Poʻipū: past every station's reach.
    const offshore = translate(POIPU.at, 0, 15_000_000);
    let nearest = field.readings[0];
    let best = Infinity;
    for (const r of field.readings) {
      const d = Math.hypot(r.station.at.wx - offshore.wx, r.station.at.wz - offshore.wz);
      if (d < best) {
        best = d;
        nearest = r;
      }
    }
    expect(best).toBeGreaterThan(REACH);
    expect(field.at(offshore)).toBe(nearest.conditions);
  });

  it('answers TYPICAL from an empty field and says it is empty', () => {
    const field = new WeatherField([]);
    expect(field.empty).toBe(true);
    expect(field.at(LIHUE.at)).toBe(TYPICAL);
    expect(new WeatherField(varied()).empty).toBe(false);
  });

  it('pairs a reply with the stations in order, and a short reply is a partial field', () => {
    const a = { ...TYPICAL, temperature: 1 };
    const b = { ...TYPICAL, temperature: 2 };
    const field = WeatherField.of(STATIONS, [a, b]);
    expect(field.readings.length).toBe(2);
    expect(field.readings[0].station).toBe(STATIONS[0]);
    expect(field.readings[0].conditions).toBe(a);
    expect(field.readings[1].station).toBe(STATIONS[1]);
    expect(field.readings[1].conditions).toBe(b);
    // A reply longer than the list is truncated, not an error.
    expect(WeatherField.of([STATIONS[0]], [a, b]).readings.length).toBe(1);
  });

  it('returns a frozen reading between stations', () => {
    const field = new WeatherField(varied());
    expect(Object.isFrozen(field.at(midpoint(LIHUE.at, POIPU.at)))).toBe(true);
  });
});
