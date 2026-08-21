/**
 * OPEN-METEO — the live provider.
 *
 * Chosen because it takes arbitrary coordinates, takes MANY of them in
 * one request, needs no key for this kind of use, and answers in small
 * plain JSON. All twenty-two stations are one call.
 *
 * NOTHING ELSE IN THE GAME KNOWS THIS FILE EXISTS. Everything upstream
 * of `WeatherProvider` deals in `Conditions`, so swapping in a NOAA
 * station feed or a radar product later is a new file and one line of
 * wiring, not a refactor of the sky.
 *
 * A REPLY IS UNTRUSTED INPUT. It arrives over a network from a service
 * this project does not run, and it can be truncated, rate-limited,
 * reshaped by an API version, or an error document with a 200 on it.
 * Every field is therefore coerced and every missing one falls back to
 * a typical value, so the worst a bad response can do is make the
 * weather boring. It can never make the game unbootable — which is the
 * whole point of the fallback chain this provider sits at the top of.
 *
 * TWO QUIRKS worth writing down, because both have bitten people:
 *
 *  - Ask for several coordinates and the reply is an ARRAY of location
 *    objects. Ask for one and it is a bare object. Normalised below.
 *  - `visibility` is not offered as a CURRENT value, only an hourly
 *    series, so it is fetched hourly and the row nearest to now is
 *    taken. Everything else comes from `current`.
 */
import type { GeoPoint } from '../world/geo';
import { TYPICAL, type Conditions, type WeatherProvider } from './conditions';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

const CURRENT_FIELDS = [
  'temperature_2m',
  'relative_humidity_2m',
  // ALL THREE. `precipitation` is the total and the one the game reads;
  // the other two are kept because a future effect may care whether it
  // is steady rain or a passing shower, and asking for them costs
  // nothing on a request already being made.
  'precipitation',
  'rain',
  'showers',
  'cloud_cover',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'weather_code',
].join(',');

/** How long to wait before giving up and using what we already have. */
const TIMEOUT_MS = 9_000;

export function requestUrl(points: readonly GeoPoint[]): string {
  const lat = points.map((p) => p.lat.toFixed(4)).join(',');
  const lon = points.map((p) => p.lon.toFixed(4)).join(',');
  const query = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: CURRENT_FIELDS,
    hourly: 'visibility',
    forecast_days: '1',
    timezone: 'UTC',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  });
  return `${ENDPOINT}?${query.toString()}`;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * The hourly visibility row nearest to the reading's own timestamp.
 *
 * Both are ISO strings on the same clock, so nearest-by-string-prefix
 * would nearly work and would break at midnight. Comparing parsed times
 * costs nothing and does not.
 */
function visibilityNow(place: Record<string, unknown>, when: unknown): number {
  const hourly = place.hourly as Record<string, unknown> | undefined;
  const times = hourly?.time;
  const values = hourly?.visibility;
  if (!Array.isArray(times) || !Array.isArray(values)) return TYPICAL.visibility;

  const target = typeof when === 'string' ? Date.parse(when) : NaN;
  let best = 0;
  if (Number.isFinite(target)) {
    let closest = Infinity;
    for (let i = 0; i < times.length; i += 1) {
      const at = Date.parse(String(times[i]));
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

/** One location object from the reply, turned into game-agnostic numbers. */
export function readPlace(place: unknown): Conditions {
  if (typeof place !== 'object' || place === null) return { ...TYPICAL };
  const record = place as Record<string, unknown>;
  const current = (record.current ?? {}) as Record<string, unknown>;

  return {
    temperature: num(current.temperature_2m, TYPICAL.temperature),
    humidity: num(current.relative_humidity_2m, TYPICAL.humidity),
    // If the total is missing, rebuild it from the parts rather than
    // reporting a dry day: a reply that has been reshaped by an API
    // version should degrade to slightly-wrong, never to silently-dry.
    precipitation: Math.max(0, num(
      current.precipitation,
      Math.max(0, num(current.rain, 0)) + Math.max(0, num(current.showers, 0)),
    )),
    rain: Math.max(0, num(current.rain, 0)),
    showers: Math.max(0, num(current.showers, 0)),
    cloud: num(current.cloud_cover, TYPICAL.cloud),
    windSpeed: Math.max(0, num(current.wind_speed_10m, TYPICAL.windSpeed)),
    windFrom: ((num(current.wind_direction_10m, TYPICAL.windFrom) % 360) + 360) % 360,
    windGust: Math.max(0, num(current.wind_gusts_10m, TYPICAL.windGust)),
    visibility: Math.max(50, visibilityNow(record, current.time)),
    code: Math.round(num(current.weather_code, TYPICAL.code)),
  };
}

/** Array of places, bare object, or nonsense — always an array out. */
export function readReply(
  body: unknown,
  expected: number,
): readonly Conditions[] {
  const places = Array.isArray(body) ? body : [body];
  const read = places.map(readPlace);
  if (read.length >= expected) return read.slice(0, expected);
  // Short reply: pad rather than throw. Fewer stations still makes a
  // usable field, and the interpolation does not care how many there are.
  return read;
}

export class OpenMeteo implements WeatherProvider {
  readonly id = 'open-meteo';

  async fetch(points: readonly GeoPoint[]): Promise<readonly Conditions[]> {
    if (points.length === 0) return [];

    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), TIMEOUT_MS);
    try {
      const reply = await globalThis.fetch(requestUrl(points), {
        signal: stop.signal,
      });
      if (!reply.ok) {
        throw new Error(`open-meteo answered ${reply.status}`);
      }
      return readReply(await reply.json(), points.length);
    } finally {
      clearTimeout(timer);
    }
  }
}
