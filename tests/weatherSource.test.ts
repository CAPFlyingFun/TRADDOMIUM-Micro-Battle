import { describe, expect, it } from 'vitest';
import { readPlace, readReply, requestUrl } from '../src/weather/openMeteo';
import { simulate, wetness } from '../src/weather/simulated';
import { STATIONS, STATION_POINTS } from '../src/weather/stations';
import { TYPICAL } from '../src/weather/conditions';

describe('the station grid', () => {
  it('samples the island many times, not once', () => {
    expect(STATIONS.length).toBeGreaterThanOrEqual(16);
    expect(STATIONS.length).toBeLessThanOrEqual(30);
  });

  it('has no two stations answering to the same name', () => {
    expect(new Set(STATIONS.map((s) => s.id)).size).toBe(STATIONS.length);
  });

  it('puts every station on Kauaʻi', () => {
    for (const station of STATIONS) {
      expect(station.where.lat).toBeGreaterThan(21.84);
      expect(station.where.lat).toBeLessThan(22.26);
      expect(station.where.lon).toBeGreaterThan(-159.83);
      expect(station.where.lon).toBeLessThan(-159.27);
    }
  });

  it('covers every side of the island', () => {
    const centre = { lat: 22.0435, lon: -159.5385 };
    const sectors = new Set<number>();
    for (const s of STATIONS) {
      const bearing = (Math.atan2(
        s.where.lon - centre.lon, s.where.lat - centre.lat,
      ) * 180) / Math.PI;
      sectors.add(Math.floor((((bearing % 360) + 360) % 360) / 45));
    }
    // All eight compass octants have at least one station in them.
    expect(sectors.size).toBe(8);
  });

  it('reaches both ends of the rain gradient', () => {
    const ids = STATIONS.map((s) => s.id);
    expect(ids).toContain('waialeale'); // ~9,500 mm a year
    expect(ids).toContain('kekaha'); // ~500 mm a year
  });
});

describe('the offline model', () => {
  it('knows the summit is wet and the lee coast is not', () => {
    const summit = wetness({ lat: 22.070, lon: -159.498 });
    const lee = wetness({ lat: 21.968, lon: -159.718 });
    expect(summit).toBeGreaterThan(0.8);
    expect(lee).toBeLessThan(0.3);
  });

  it('rains more on the mountain than on the west coast', () => {
    // Averaged over a day, because a shower is a passing thing.
    let mountain = 0;
    let coast = 0;
    for (let minute = 0; minute < 1440; minute += 5) {
      const when = minute * 60_000;
      mountain += simulate({ lat: 22.070, lon: -159.498 }, when).rain;
      coast += simulate({ lat: 21.968, lon: -159.718 }, when).rain;
    }
    expect(mountain).toBeGreaterThan(coast * 3);
  });

  it('stays plausible everywhere, at every hour', () => {
    for (const station of STATIONS) {
      for (let minute = 0; minute < 1440; minute += 17) {
        const now = simulate(station.where, minute * 60_000);
        expect(now.temperature).toBeGreaterThan(10);
        expect(now.temperature).toBeLessThan(35);
        expect(now.humidity).toBeGreaterThanOrEqual(0);
        expect(now.humidity).toBeLessThanOrEqual(100);
        expect(now.rain).toBeGreaterThanOrEqual(0);
        expect(now.cloud).toBeGreaterThanOrEqual(0);
        expect(now.cloud).toBeLessThanOrEqual(100);
        expect(now.windSpeed).toBeGreaterThan(0);
        expect(now.windFrom).toBeGreaterThanOrEqual(0);
        expect(now.windFrom).toBeLessThan(360);
        expect(now.visibility).toBeGreaterThan(0);
      }
    }
  });

  it('does not stand still', () => {
    const where = { lat: 22.070, lon: -159.498 };
    const early = simulate(where, 0).cloud;
    let moved = false;
    for (let minute = 5; minute < 240; minute += 5) {
      if (Math.abs(simulate(where, minute * 60_000).cloud - early) > 5) {
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);
  });

  it('gives different places different weather at the same moment', () => {
    const now = 9 * 60 * 60_000;
    const clouds = STATIONS.map((s) => simulate(s.where, now).cloud);
    expect(Math.max(...clouds) - Math.min(...clouds)).toBeGreaterThan(20);
  });
});

describe('reading Open-Meteo', () => {
  it('asks for every station in one request', () => {
    const url = requestUrl(STATION_POINTS);
    const query = new URLSearchParams(url.split('?')[1]);
    expect(query.get('latitude')?.split(',')).toHaveLength(STATIONS.length);
    expect(query.get('longitude')?.split(',')).toHaveLength(STATIONS.length);
    expect(query.get('current')).toContain('wind_direction_10m');
    expect(query.get('hourly')).toContain('visibility');
  });

  it('reads a well-formed place', () => {
    const place = {
      current: {
        time: '2026-08-21T12:00',
        temperature_2m: 26.4,
        relative_humidity_2m: 81,
        rain: 1.2,
        cloud_cover: 74,
        wind_speed_10m: 23.4,
        wind_direction_10m: 68,
        wind_gusts_10m: 41,
        weather_code: 61,
      },
      hourly: {
        time: ['2026-08-21T11:00', '2026-08-21T12:00', '2026-08-21T13:00'],
        visibility: [24_000, 8_400, 3_000],
      },
    };
    const read = readPlace(place);
    expect(read.temperature).toBeCloseTo(26.4, 6);
    expect(read.rain).toBeCloseTo(1.2, 6);
    expect(read.windFrom).toBeCloseTo(68, 6);
    expect(read.code).toBe(61);
    // The hour that matches, not the first one in the list.
    expect(read.visibility).toBeCloseTo(8_400, 6);
  });

  it('survives a reply made of nonsense', () => {
    for (const rubbish of [
      null, undefined, 42, 'error', [], {}, { current: null },
      { current: { temperature_2m: 'warm', wind_direction_10m: null } },
      { current: {}, hourly: { time: 'no', visibility: 5 } },
    ]) {
      const read = readPlace(rubbish);
      expect(Number.isFinite(read.temperature)).toBe(true);
      expect(Number.isFinite(read.windFrom)).toBe(true);
      expect(read.windFrom).toBeGreaterThanOrEqual(0);
      expect(read.windFrom).toBeLessThan(360);
      expect(read.visibility).toBeGreaterThan(0);
      expect(read.rain).toBeGreaterThanOrEqual(0);
    }
  });

  it('wraps a wind direction that came back out of range', () => {
    expect(readPlace({ current: { wind_direction_10m: 450 } }).windFrom)
      .toBeCloseTo(90, 6);
    expect(readPlace({ current: { wind_direction_10m: -30 } }).windFrom)
      .toBeCloseTo(330, 6);
  });

  it('takes an array of places, or a bare one', () => {
    const one = { current: { temperature_2m: 20 } };
    expect(readReply([one, one, one], 3)).toHaveLength(3);
    expect(readReply(one, 1)).toHaveLength(1);
    expect(readReply(one, 1)[0].temperature).toBeCloseTo(20, 6);
  });

  it('does not invent places the reply did not contain', () => {
    const short = readReply([{ current: { temperature_2m: 20 } }], 22);
    expect(short.length).toBeLessThanOrEqual(22);
    expect(short.length).toBeGreaterThan(0);
  });

  it('falls back to typical values rather than to nothing', () => {
    const empty = readPlace({ current: {} });
    expect(empty.temperature).toBeCloseTo(TYPICAL.temperature, 6);
    expect(empty.cloud).toBeCloseTo(TYPICAL.cloud, 6);
  });
});
