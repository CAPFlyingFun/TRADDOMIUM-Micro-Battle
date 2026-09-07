/**
 * OPEN-METEO — the live weather provider, the sky's half of the one
 * loader (ARCHITECTURE §2.5). Ported from v0 (`src/weather/openMeteo.ts`,
 * legacy/v0-main) deliberately, not copied: same request, same reading,
 * the fetch injected and the failures made loud.
 *
 * Chosen because it takes arbitrary coordinates, takes MANY of them in
 * one request, needs no key for this kind of use, and answers in small
 * plain JSON. All twenty-two stations (`world/weather/stations.ts`) are
 * one call.
 *
 * THIS FILE IS THE ONLY ONE THAT KNOWS THE SERVICE EXISTS. `world/` is
 * core and may not so much as spell `fetch` (tests/simulationCore.test.ts);
 * it defines `WeatherProvider` and `Conditions` and is handed an instance
 * of this class the way it is handed the survey and the landcover. Every
 * consumer deals in `Conditions`, so a NOAA station feed or a radar
 * product later is a new file here and one line of wiring, not a refactor
 * of the sky.
 *
 * A REPLY IS UNTRUSTED INPUT. It arrives over a network from a service
 * this project does not run, and it can be truncated, rate-limited,
 * reshaped by an API version, or an error document with a 200 on it.
 * Every field is therefore coerced with `Number.isFinite` and every
 * missing one falls back to `TYPICAL`, so the worst a bad reply can do
 * is make the weather boring. What it may never do is throw past
 * `sample`'s own rejection: a reply that cannot be trusted AT ALL — a
 * non-OK status, a body that is not JSON, a service error, the wrong
 * number of places — REJECTS, and the service upstream keeps the
 * readings it already has rather than painting the island with
 * fallbacks. Anything short of that reads as conditions.
 *
 * TWO QUIRKS worth writing down, because both have bitten people:
 *
 *  - Ask for several coordinates and the reply is an ARRAY of location
 *    objects. Ask for one and it is a bare object. Normalised in
 *    `readReply`, and a test breaks if the normalisation goes.
 *  - `visibility` is not offered as a CURRENT value, only as an hourly
 *    series, so it is asked for hourly and the row nearest the reading's
 *    own timestamp is taken. Everything else comes from `current`.
 *
 * And one v0 bug worth naming so it is not re-made: Open-Meteo splits
 * precipitation three ways (`rain`, `showers`, and the `precipitation`
 * total that also carries drizzle). v0 once read `rain` alone and told
 * the player DRIZZLE and "Rain: none" in one breath. The total is what
 * `Conditions.precipitation` carries, and a test pins it.
 */
import type { GeoPoint } from '../world/geo';
import { TYPICAL, type Conditions, type WeatherProvider } from '../world/weather/conditions';

export const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

/**
 * What `current=` asks for, in Open-Meteo's own names. ALL THREE
 * precipitation fields: the total is the one the game reads, and the
 * two parts are kept because a later effect may care whether it is
 * steady rain or a passing shower, on a request already being made.
 */
export const CURRENT_FIELDS: readonly string[] = Object.freeze([
  'temperature_2m',
  'relative_humidity_2m',
  'precipitation',
  'rain',
  'showers',
  'cloud_cover',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'weather_code',
]);

/**
 * How long to wait before giving up and letting the service keep what it
 * has. Nine seconds is long enough for a phone on one bar and short
 * enough that a sky which is not going to update stops pretending it
 * might.
 */
export const DEFAULT_TIMEOUT_MS = 9_000;

/** Nothing on the island sees less than this; below it the number is noise. */
const VISIBILITY_FLOOR_M = 50;

export function requestUrl(points: readonly GeoPoint[]): string {
  const query = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(4)).join(','),
    longitude: points.map((p) => p.lon.toFixed(4)).join(','),
    current: CURRENT_FIELDS.join(','),
    hourly: 'visibility',
    forecast_days: '1',
    timezone: 'UTC',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  });
  return `${ENDPOINT}?${query.toString()}`;
}

/** A finite number, or the fallback. A string that spells one is a shape change, not a number. */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function percent(value: unknown, fallback: number): number {
  return Math.min(100, Math.max(0, num(value, fallback)));
}

function nonNegative(value: unknown, fallback: number): number {
  return Math.max(0, num(value, fallback));
}

/**
 * Open-Meteo stamps its times as `2026-08-21T12:15` with no zone; the
 * request asks for UTC, so that is what they are. `Date.parse` would
 * read a zoneless stamp as LOCAL time, and two stamps either side of a
 * daylight-saving change would then be an hour further apart than they
 * are — enough to pick the wrong row. Pinning the zone makes the
 * arithmetic the same on every machine that runs the tests.
 */
function parseUtc(stamp: unknown): number {
  if (typeof stamp !== 'string' || stamp === '') return NaN;
  const zoned = /(?:Z|[+-]\d\d:?\d\d)$/.test(stamp) ? stamp : `${stamp}Z`;
  return Date.parse(zoned);
}

/**
 * The hourly visibility row nearest the reading's own timestamp.
 *
 * Both are ISO strings on the same clock, so nearest-by-string-prefix
 * would nearly work and would break at midnight. Comparing parsed times
 * costs nothing and does not.
 */
function visibilityNow(place: Record<string, unknown>, when: unknown): number {
  const hourly = place.hourly;
  if (typeof hourly !== 'object' || hourly === null) return TYPICAL.visibility;
  const { time: times, visibility: values } = hourly as Record<string, unknown>;
  if (!Array.isArray(times) || !Array.isArray(values) || values.length === 0) return TYPICAL.visibility;

  const target = parseUtc(when);
  let best = 0;
  if (Number.isFinite(target)) {
    let closest = Infinity;
    for (let i = 0; i < times.length && i < values.length; i += 1) {
      const at = parseUtc(times[i]);
      if (!Number.isFinite(at)) continue;
      const apart = Math.abs(at - target);
      if (apart < closest) {
        closest = apart;
        best = i;
      }
    }
  }
  return num(values[best], TYPICAL.visibility);
}

/**
 * One location object from the reply, turned into game-agnostic numbers.
 * Never throws: rubbish in, `TYPICAL` out.
 */
export function readPlace(place: unknown): Conditions {
  if (typeof place !== 'object' || place === null) return { ...TYPICAL };
  const record = place as Record<string, unknown>;
  const current = (typeof record.current === 'object' && record.current !== null
    ? record.current
    : {}) as Record<string, unknown>;

  const rain = nonNegative(current.rain, 0);
  const showers = nonNegative(current.showers, 0);

  return {
    temperature: num(current.temperature_2m, TYPICAL.temperature),
    humidity: percent(current.relative_humidity_2m, TYPICAL.humidity),
    // THE TOTAL, not `rain` (see the header). If the total is missing,
    // rebuild it from the parts rather than reporting a dry day: a reply
    // reshaped by an API version should degrade to slightly-wrong, never
    // to silently-dry.
    precipitation: nonNegative(current.precipitation, rain + showers),
    rain,
    showers,
    cloud: percent(current.cloud_cover, TYPICAL.cloud),
    windSpeed: nonNegative(current.wind_speed_10m, TYPICAL.windSpeed),
    windFrom: ((num(current.wind_direction_10m, TYPICAL.windFrom) % 360) + 360) % 360,
    windGust: nonNegative(current.wind_gusts_10m, TYPICAL.windGust),
    visibility: Math.max(VISIBILITY_FLOOR_M, visibilityNow(record, current.time)),
    code: Math.round(num(current.weather_code, TYPICAL.code)),
  };
}

/**
 * The whole body, as the list of conditions it describes — one per point
 * asked for, in the order they were asked.
 *
 * Throws when the body cannot be that list: a service error document
 * (`{ error: true, reason }`, which Open-Meteo will send with a 200 on
 * some routes), or a count of places that is not the count of points.
 * v0 padded a short reply and carried on; here the caller keeps its last
 * good readings instead, which is a better field than half an island
 * of fallbacks stitched to half an island of weather.
 */
export function readReply(body: unknown, expected: number): readonly Conditions[] {
  if (typeof body === 'object' && body !== null && !Array.isArray(body)
    && (body as Record<string, unknown>).error === true) {
    const reason = (body as Record<string, unknown>).reason;
    throw new Error(`open-meteo refused: ${typeof reason === 'string' ? reason : 'no reason given'}`);
  }
  // Several points answer with an array; one answers with a bare object.
  const places: readonly unknown[] = Array.isArray(body) ? body : [body];
  if (places.length !== expected) {
    throw new Error(`open-meteo answered for ${places.length} place(s) when ${expected} were asked for`);
  }
  return places.map(readPlace);
}

export interface OpenMeteoOptions {
  /** Injected for tests. Defaults to the global. */
  readonly fetch?: typeof fetch;
  /** Wait before giving up. Default `DEFAULT_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
}

export class OpenMeteo implements WeatherProvider {
  readonly id = 'open-meteo';
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OpenMeteoOptions = {}) {
    // Bound to the global, because an unbound `fetch` throws "Illegal
    // invocation" in a browser when called as a method of something else.
    this.doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * All the points in ONE request. Resolves with one `Conditions` per
   * point, in order, or REJECTS — never throws synchronously, never
   * resolves with something other than what was asked for.
   */
  async sample(points: readonly GeoPoint[]): Promise<readonly Conditions[]> {
    if (points.length === 0) return [];

    const stop = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The abort tears the real request down; the race is for a fetch
    // implementation that does not honour its signal, so a hang is a
    // rejection at the deadline either way.
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(`open-meteo: no answer within ${this.timeoutMs} ms`));
        stop.abort();
      }, this.timeoutMs);
    });

    try {
      const response = await Promise.race([
        this.doFetch(requestUrl(points), { signal: stop.signal }),
        deadline,
      ]);
      if (!response.ok) throw new Error(`open-meteo answered ${response.status}`);

      // The text, then our own parse: a rate-limit page or a proxy's HTML
      // with a 200 on it is then named for what it is rather than as a
      // bare SyntaxError.
      const text = await Promise.race([response.text(), deadline]);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`open-meteo answered with something that is not JSON: ${text.slice(0, 40).trim()}…`);
      }
      return readReply(body, points.length);
    } catch (error) {
      if (timedOut) throw new Error(`open-meteo: no answer within ${this.timeoutMs} ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
