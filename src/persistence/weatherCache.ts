/**
 * THE LAST WEATHER THIS DEVICE SAW — kept, so the next launch on a plane
 * still opens on Kauaʻi's sky rather than on the model's.
 *
 * v0's WeatherService kept its readings in localStorage with the moment
 * they were taken and used them on the way up only while they were
 * young enough to still describe the sky (three hours; the number is
 * `liveWeather.ts`'s). This is that store, shaped like every other one
 * here: a versioned document, a sanitizer that trusts nothing it reads,
 * and the `WeatherCache` seam `world/weather/liveWeather.ts` asks for —
 * core names the seam, this file implements it over `StorageRoot`, and
 * `app/registerScenes.ts` hands one to the world.
 *
 * `persistence/` is core: no DOM, no storage globals. The storage is
 * handed in.
 */
import { TYPICAL, type Conditions } from '../world/weather/conditions';
import type { CachedReadings, WeatherCache } from '../world/weather/liveWeather';
import type { StorageRoot } from './StorageRoot';
import type { StoreSpec, Versioned } from './store';

export const WEATHER_CACHE_KEY = 'traddomium.v1.weather-cache';
export const WEATHER_CACHE_VERSION = 1;

/** The stored shape: the readings plus the document version. */
export interface WeatherCacheDocument extends Versioned, CachedReadings {}

const EMPTY: WeatherCacheDocument = Object.freeze({
  version: WEATHER_CACHE_VERSION,
  takenMs: 0,
  ids: [],
  conditions: [],
});

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** One reading, every field a finite number or `TYPICAL`'s. */
export function sanitizeConditions(raw: unknown): Conditions {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    temperature: finite(r.temperature, TYPICAL.temperature),
    humidity: finite(r.humidity, TYPICAL.humidity),
    precipitation: Math.max(0, finite(r.precipitation, TYPICAL.precipitation)),
    rain: Math.max(0, finite(r.rain, TYPICAL.rain)),
    showers: Math.max(0, finite(r.showers, TYPICAL.showers)),
    cloud: Math.min(100, Math.max(0, finite(r.cloud, TYPICAL.cloud))),
    windSpeed: Math.max(0, finite(r.windSpeed, TYPICAL.windSpeed)),
    windFrom: ((finite(r.windFrom, TYPICAL.windFrom) % 360) + 360) % 360,
    windGust: Math.max(0, finite(r.windGust, TYPICAL.windGust)),
    visibility: Math.max(50, finite(r.visibility, TYPICAL.visibility)),
    code: Math.max(0, Math.floor(finite(r.code, TYPICAL.code))),
  };
}

/** Untrusted JSON → a valid document. Mismatched ids and readings are dropped together: a reading without its station is nobody's weather. */
export function sanitizeWeatherCache(raw: unknown, defaults: WeatherCacheDocument = EMPTY): WeatherCacheDocument {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const ids = Array.isArray(r.ids) ? r.ids.filter((id): id is string => typeof id === 'string') : [];
  const conditions = Array.isArray(r.conditions) ? r.conditions.map(sanitizeConditions) : [];
  const paired = ids.length === conditions.length && ids.length > 0;
  return {
    version: defaults.version,
    takenMs: paired ? Math.max(0, finite(r.takenMs, 0)) : 0,
    ids: paired ? ids : [],
    conditions: paired ? conditions : [],
  };
}

export const WEATHER_CACHE_SPEC: StoreSpec<WeatherCacheDocument> = {
  key: WEATHER_CACHE_KEY,
  version: WEATHER_CACHE_VERSION,
  defaults: EMPTY,
  sanitize: sanitizeWeatherCache,
};

/** The seam the live weather asks for, over this device's storage. Empty reads as `null`: nothing kept yet. */
export function weatherCacheOver(storage: StorageRoot): WeatherCache {
  const store = storage.open(WEATHER_CACHE_SPEC);
  return {
    read(): CachedReadings | null {
      const doc = store.read();
      if (doc.takenMs <= 0 || doc.ids.length === 0) return null;
      return { takenMs: doc.takenMs, ids: doc.ids, conditions: doc.conditions };
    },
    write(readings: CachedReadings): void {
      store.write({ version: WEATHER_CACHE_VERSION, takenMs: readings.takenMs, ids: [...readings.ids], conditions: [...readings.conditions] });
    },
  };
}
