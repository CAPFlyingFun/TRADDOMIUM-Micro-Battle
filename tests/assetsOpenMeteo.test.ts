/**
 * THE LIVE PROVIDER, AND THE WAYS A REPLY GOES WRONG.
 *
 * Nothing here touches the network: a fake `fetch` answers with whatever
 * the test says the service said. The cases are the header of
 * `assets/openMeteo.ts` made concrete —
 *
 *  - the request: one call, every station, every field;
 *  - the reading: fields coerced, gaps filled from `TYPICAL`, the
 *    precipitation TOTAL (v0's DRIZZLE bug), the hourly visibility row
 *    nearest the reading's own time, across midnight;
 *  - the two reply shapes: an array for many points, a bare object for
 *    one;
 *  - the rejections: a non-OK status, HTML with a 200 on it, a hang past
 *    the deadline, a reply for the wrong number of places.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENT_FIELDS, DEFAULT_TIMEOUT_MS, ENDPOINT, OpenMeteo, readPlace, readReply, requestUrl,
} from '../src/assets/openMeteo';
import { TYPICAL, type Conditions } from '../src/world/weather/conditions';
import { STATIONS, STATION_POINTS } from '../src/world/weather/stations';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

/** A well-formed Open-Meteo location object, with `current` overridden as asked. */
function place(current: Json = {}, hourly?: Json): Json {
  return {
    current: {
      time: '2026-08-21T12:00',
      temperature_2m: 26.4,
      relative_humidity_2m: 81,
      precipitation: 1.5,
      rain: 0.2,
      showers: 0.3,
      cloud_cover: 74,
      wind_speed_10m: 23.4,
      wind_direction_10m: 68,
      wind_gusts_10m: 41,
      weather_code: 61,
      ...current,
    },
    hourly: hourly ?? {
      time: ['2026-08-21T11:00', '2026-08-21T12:00', '2026-08-21T13:00'],
      visibility: [24_000, 8_400, 3_000],
    },
  };
}

/** What the fake service says: a status and a body, as text. */
function answering(status: number, body: string) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  }) as unknown as Response);
}

const asFetch = (fake: ReturnType<typeof answering>): typeof fetch => fake as unknown as typeof fetch;

const ONE_POINT = [STATION_POINTS[0]];

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

describe('the request', () => {
  it('asks for every station, every field, in one URL', () => {
    const url = requestUrl(STATION_POINTS);
    expect(url.startsWith(`${ENDPOINT}?`)).toBe(true);
    const query = new URLSearchParams(url.split('?')[1]);

    const lats = query.get('latitude')?.split(',') ?? [];
    const lons = query.get('longitude')?.split(',') ?? [];
    expect(STATIONS).toHaveLength(22);
    expect(lats).toHaveLength(22);
    expect(lons).toHaveLength(22);
    // In station order, to four decimals: about eleven metres on Kauaʻi.
    STATIONS.forEach((station, i) => {
      expect(lats[i]).toBe(station.where.lat.toFixed(4));
      expect(lons[i]).toBe(station.where.lon.toFixed(4));
    });

    const current = query.get('current')?.split(',') ?? [];
    for (const field of [
      'temperature_2m', 'relative_humidity_2m', 'precipitation', 'rain', 'showers',
      'cloud_cover', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'weather_code',
    ]) {
      expect(current).toContain(field);
    }
    expect(current).toEqual([...CURRENT_FIELDS]);
    expect(query.get('hourly')).toBe('visibility');
    expect(query.get('forecast_days')).toBe('1');
    expect(query.get('timezone')).toBe('UTC');
    expect(query.get('wind_speed_unit')).toBe('kmh');
    expect(query.get('precipitation_unit')).toBe('mm');
  });

  it('rounds a coordinate rather than sending fifteen decimals', () => {
    const query = new URLSearchParams(requestUrl([{ lat: 22.123456789, lon: -159.987654321 }]).split('?')[1]);
    expect(query.get('latitude')).toBe('22.1235');
    expect(query.get('longitude')).toBe('-159.9877');
  });

  it('is one call for all the points, on the URL requestUrl builds', async () => {
    const fake = answering(200, JSON.stringify(STATION_POINTS.map(() => place())));
    const provider = new OpenMeteo({ fetch: asFetch(fake) });
    expect(provider.id).toBe('open-meteo');
    await provider.sample(STATION_POINTS);
    expect(fake).toHaveBeenCalledTimes(1);
    expect(fake.mock.calls[0][0]).toBe(requestUrl(STATION_POINTS));
    // A real request is cancellable: the signal is handed to fetch.
    expect(fake.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not ask when there is nothing to ask for', async () => {
    const fake = answering(200, '[]');
    await expect(new OpenMeteo({ fetch: asFetch(fake) }).sample([])).resolves.toEqual([]);
    expect(fake).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The two reply shapes
// ---------------------------------------------------------------------------

describe('the shape of the reply', () => {
  it('maps an array of places onto the points, in order', async () => {
    const temps = STATION_POINTS.map((_, i) => 20 + i * 0.5);
    const body = temps.map((t) => place({ temperature_2m: t }));
    const provider = new OpenMeteo({ fetch: asFetch(answering(200, JSON.stringify(body))) });
    const read = await provider.sample(STATION_POINTS);
    expect(read).toHaveLength(22);
    read.forEach((c, i) => expect(c.temperature).toBeCloseTo(temps[i], 6));
    // The whole reading, not just the one field that varied.
    expect(read[0].humidity).toBe(81);
    expect(read[0].precipitation).toBeCloseTo(1.5, 6);
    expect(read[0].rain).toBeCloseTo(0.2, 6);
    expect(read[0].showers).toBeCloseTo(0.3, 6);
    expect(read[0].cloud).toBe(74);
    expect(read[0].windSpeed).toBeCloseTo(23.4, 6);
    expect(read[0].windFrom).toBe(68);
    expect(read[0].windGust).toBe(41);
    expect(read[0].visibility).toBe(8_400);
    expect(read[0].code).toBe(61);
  });

  it('turns the bare object one point gets into a one-element result', async () => {
    const provider = new OpenMeteo({ fetch: asFetch(answering(200, JSON.stringify(place({ temperature_2m: 19 })))) });
    const read = await provider.sample(ONE_POINT);
    expect(read).toHaveLength(1);
    expect(read[0].temperature).toBe(19);
  });

  it('accepts a one-element array for one point too', () => {
    expect(readReply([place({ temperature_2m: 19 })], 1)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

describe('reading a place', () => {
  it('falls back to TYPICAL field by field, not all or nothing', () => {
    const read = readPlace(place({
      temperature_2m: undefined,
      relative_humidity_2m: 'humid',
      cloud_cover: null,
      wind_speed_10m: Number.NaN,
      wind_gusts_10m: Number.POSITIVE_INFINITY,
      weather_code: undefined,
    }));
    expect(read.temperature).toBe(TYPICAL.temperature);
    expect(read.humidity).toBe(TYPICAL.humidity);
    expect(read.cloud).toBe(TYPICAL.cloud);
    expect(read.windSpeed).toBe(TYPICAL.windSpeed);
    expect(read.windGust).toBe(TYPICAL.windGust);
    expect(read.code).toBe(TYPICAL.code);
    // The fields that WERE there are still read.
    expect(read.windFrom).toBe(68);
    expect(read.precipitation).toBeCloseTo(1.5, 6);
  });

  it('reads TYPICAL entirely when there is no place at all', () => {
    expect(readPlace({ current: {} })).toEqual({ ...TYPICAL });
    expect(readPlace({})).toEqual({ ...TYPICAL });
  });

  it('carries the precipitation TOTAL, not rain alone', () => {
    // DRIZZLE: the total is there and the parts are zero. v0 read `rain`
    // and reported a dry day under a drizzling sky.
    const drizzle = readPlace(place({ precipitation: 0.3, rain: 0, showers: 0 }));
    expect(drizzle.precipitation).toBeCloseTo(0.3, 6);
    expect(drizzle.rain).toBe(0);
    // And the general case, where all three differ.
    const read = readPlace(place({ precipitation: 1.5, rain: 0.2, showers: 0.3 }));
    expect(read.precipitation).toBeCloseTo(1.5, 6);
    expect(read.rain).toBeCloseTo(0.2, 6);
    expect(read.showers).toBeCloseTo(0.3, 6);
  });

  it('rebuilds a missing total from rain plus showers', () => {
    const read = readPlace(place({ precipitation: undefined, rain: 0.4, showers: 0.6 }));
    expect(read.precipitation).toBeCloseTo(1.0, 6);
    // Missing parts are zero, not TYPICAL's anything: a total of nothing is nothing.
    expect(readPlace(place({ precipitation: undefined, rain: undefined, showers: undefined })).precipitation).toBe(0);
  });

  it('clamps a negative precipitation to zero', () => {
    const read = readPlace(place({ precipitation: -0.4, rain: -1, showers: -2 }));
    expect(read.precipitation).toBe(0);
    expect(read.rain).toBe(0);
    expect(read.showers).toBe(0);
    // A negative total is rebuilt from the parts the same way v0 did.
    expect(readPlace(place({ precipitation: -0.4, rain: 0.2, showers: 0.1 })).precipitation).toBe(0);
  });

  it('wraps a wind direction that came back out of range', () => {
    expect(readPlace(place({ wind_direction_10m: 450 })).windFrom).toBeCloseTo(90, 6);
    expect(readPlace(place({ wind_direction_10m: -30 })).windFrom).toBeCloseTo(330, 6);
    expect(readPlace(place({ wind_direction_10m: 360 })).windFrom).toBe(0);
  });

  it('keeps a percentage between 0 and 100', () => {
    expect(readPlace(place({ cloud_cover: 250, relative_humidity_2m: -5 })).cloud).toBe(100);
    expect(readPlace(place({ cloud_cover: 250, relative_humidity_2m: -5 })).humidity).toBe(0);
  });

  it('rounds the weather code to the integer it is', () => {
    expect(readPlace(place({ weather_code: 61.4 })).code).toBe(61);
  });

  it('survives a reply made of nonsense without throwing', () => {
    for (const rubbish of [
      null, undefined, 42, 'error', [], {}, { current: null }, { current: 'wet' },
      { current: { temperature_2m: 'warm', wind_direction_10m: null } },
      { current: {}, hourly: { time: 'no', visibility: 5 } },
      { current: { time: 12 }, hourly: { time: [12, null], visibility: ['far', {}] } },
      { current: {}, hourly: null },
    ]) {
      const read: Conditions = readPlace(rubbish);
      for (const value of Object.values(read)) expect(Number.isFinite(value)).toBe(true);
      expect(read.windFrom).toBeGreaterThanOrEqual(0);
      expect(read.windFrom).toBeLessThan(360);
      expect(read.visibility).toBeGreaterThanOrEqual(50);
      expect(read.precipitation).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('visibility, which is only hourly', () => {
  it('takes the row nearest the reading\'s own time, not the first', () => {
    expect(readPlace(place({ time: '2026-08-21T12:00' })).visibility).toBe(8_400);
    expect(readPlace(place({ time: '2026-08-21T12:29' })).visibility).toBe(8_400);
    expect(readPlace(place({ time: '2026-08-21T12:31' })).visibility).toBe(3_000);
    expect(readPlace(place({ time: '2026-08-21T10:50' })).visibility).toBe(24_000);
  });

  it('does not break across midnight', () => {
    const hourly = {
      time: ['2026-08-21T22:00', '2026-08-21T23:00', '2026-08-22T00:00', '2026-08-22T01:00'],
      visibility: [24_000, 20_000, 6_000, 4_000],
    };
    // Ten minutes to midnight is nearer tomorrow's first row than 23:00.
    expect(readPlace(place({ time: '2026-08-21T23:50' }, hourly)).visibility).toBe(6_000);
    // And ten past is nearer 00:00 than 01:00, on the new date.
    expect(readPlace(place({ time: '2026-08-22T00:10' }, hourly)).visibility).toBe(6_000);
    expect(readPlace(place({ time: '2026-08-21T23:20' }, hourly)).visibility).toBe(20_000);
  });

  it('is floored at fifty metres', () => {
    expect(readPlace(place({}, { time: ['2026-08-21T12:00'], visibility: [0] })).visibility).toBe(50);
    expect(readPlace(place({}, { time: ['2026-08-21T12:00'], visibility: [-500] })).visibility).toBe(50);
  });

  it('falls back to TYPICAL when the series is missing or the row is not a number', () => {
    expect(readPlace(place({}, { time: [], visibility: [] })).visibility).toBe(TYPICAL.visibility);
    expect(readPlace(place({}, { time: ['2026-08-21T12:00'], visibility: [null] })).visibility).toBe(TYPICAL.visibility);
    expect(readPlace({ current: { time: '2026-08-21T12:00' } }).visibility).toBe(TYPICAL.visibility);
  });

  it('takes the first row when the reading carries no usable time', () => {
    expect(readPlace(place({ time: undefined })).visibility).toBe(24_000);
    expect(readPlace(place({ time: 'noon' })).visibility).toBe(24_000);
  });
});

// ---------------------------------------------------------------------------
// The rejections — the service keeps what it has
// ---------------------------------------------------------------------------

describe('when the reply cannot be trusted at all', () => {
  it('rejects a 500', async () => {
    const provider = new OpenMeteo({ fetch: asFetch(answering(500, 'Internal Server Error')) });
    await expect(provider.sample(STATION_POINTS)).rejects.toThrow(/answered 500/);
  });

  it('rejects a 429 the same way — rate-limited is not weather', async () => {
    const provider = new OpenMeteo({ fetch: asFetch(answering(429, '{"error":true}')) });
    await expect(provider.sample(STATION_POINTS)).rejects.toThrow(/answered 429/);
  });

  it('rejects an HTML page wearing a 200', async () => {
    const html = '<!doctype html><html><body><h1>Service temporarily unavailable</h1></body></html>';
    const provider = new OpenMeteo({ fetch: asFetch(answering(200, html)) });
    await expect(provider.sample(STATION_POINTS)).rejects.toThrow(/not JSON/);
  });

  it('rejects an empty body — a truncated reply is not a dry island', async () => {
    const provider = new OpenMeteo({ fetch: asFetch(answering(200, '')) });
    await expect(provider.sample(ONE_POINT)).rejects.toThrow(/not JSON/);
  });

  it('rejects a service error document even with a 200 on it', async () => {
    const provider = new OpenMeteo({
      fetch: asFetch(answering(200, JSON.stringify({ error: true, reason: 'Minutely API request limit exceeded' }))),
    });
    await expect(provider.sample(ONE_POINT)).rejects.toThrow(/refused: Minutely API request limit exceeded/);
  });

  it('rejects a reply whose length does not match the points', async () => {
    const short = STATION_POINTS.slice(0, 5).map(() => place());
    const provider = new OpenMeteo({ fetch: asFetch(answering(200, JSON.stringify(short))) });
    await expect(provider.sample(STATION_POINTS)).rejects.toThrow(/5 place\(s\) when 22 were asked for/);
    // Too many is wrong too: nobody knows which of them is which station.
    const long = [...STATION_POINTS, STATION_POINTS[0]].map(() => place());
    await expect(new OpenMeteo({ fetch: asFetch(answering(200, JSON.stringify(long))) }).sample(STATION_POINTS))
      .rejects.toThrow(/23 place\(s\) when 22/);
    // And a bare object is ONE place, so it cannot stand for two.
    await expect(new OpenMeteo({ fetch: asFetch(answering(200, JSON.stringify(place()))) }).sample(STATION_POINTS.slice(0, 2)))
      .rejects.toThrow(/1 place\(s\) when 2/);
  });

  it('rejects a network failure as a rejection, not a throw', async () => {
    const fake = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const provider = new OpenMeteo({ fetch: fake as unknown as typeof fetch });
    // Not `.rejects` alone: `sample` itself must not throw before the promise exists.
    let pending: Promise<readonly Conditions[]> | undefined;
    expect(() => { pending = provider.sample(ONE_POINT); }).not.toThrow();
    await expect(pending).rejects.toThrow(/Failed to fetch/);
  });
});

describe('when the service does not answer', () => {
  it('rejects at the timeout, aborting the request, at 9,000 ms by default', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const hanging = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => {
      signal = init?.signal ?? undefined;
      signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    }));
    const provider = new OpenMeteo({ fetch: hanging as unknown as typeof fetch });

    const pending = provider.sample(STATION_POINTS);
    let settled: unknown = null;
    pending.then(() => { settled = 'resolved'; }, (error: unknown) => { settled = error; });

    expect(DEFAULT_TIMEOUT_MS).toBe(9_000);
    await vi.advanceTimersByTimeAsync(8_999);
    expect(settled).toBeNull();
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBeInstanceOf(Error);
    expect(String(settled)).toMatch(/no answer within 9000 ms/);
    expect(signal?.aborted).toBe(true);
  });

  it('honours a shorter timeout, and still rejects when fetch ignores its signal', async () => {
    vi.useFakeTimers();
    // Never settles, never listens: the worst polyfill there is.
    const deaf = vi.fn(() => new Promise<Response>(() => {}));
    const provider = new OpenMeteo({ fetch: deaf as unknown as typeof fetch, timeoutMs: 250 });
    const pending = provider.sample(ONE_POINT);
    const outcome = expect(pending).rejects.toThrow(/within 250 ms/);
    await vi.advanceTimersByTimeAsync(250);
    await outcome;
  });

  it('leaves no timer behind once it has answered', async () => {
    vi.useFakeTimers();
    const provider = new OpenMeteo({ fetch: asFetch(answering(200, JSON.stringify(place()))) });
    await provider.sample(ONE_POINT);
    expect(vi.getTimerCount()).toBe(0);
    // A rejection clears it too.
    await expect(new OpenMeteo({ fetch: asFetch(answering(503, '')) }).sample(ONE_POINT)).rejects.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
