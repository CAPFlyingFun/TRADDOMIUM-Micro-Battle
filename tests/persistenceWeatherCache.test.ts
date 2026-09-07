/**
 * The weather cache: an untrusted document in, a usable one out, and the
 * `WeatherCache` seam over a storage root. Mutation-checked: a sanitizer
 * that let a reading through without its station id fails the pairing
 * test; one that kept a non-finite cloud fails the coercion test.
 */
import { describe, expect, it } from 'vitest';
import { WEATHER_CACHE_KEY, sanitizeConditions, sanitizeWeatherCache, weatherCacheOver } from '../src/persistence/weatherCache';
import { TYPICAL } from '../src/world/weather/conditions';
import type { KeyValueStore } from '../src/persistence/store';
import { createStorageRoot, type StorageRoot } from '../src/persistence/StorageRoot';

function memoryRoot(): { root: StorageRoot; kv: Map<string, string> } {
  const kv = new Map<string, string>();
  const store: KeyValueStore = {
    get: (k) => kv.get(k) ?? null,
    set: (k, v) => void kv.set(k, v),
    remove: (k) => void kv.delete(k),
  };
  return { root: createStorageRoot(store), kv };
}

const reading = { ...TYPICAL, precipitation: 3.5, cloud: 80 };

describe('the weather cache', () => {
  it('coerces every field of a reading and falls back to TYPICAL per field', () => {
    const c = sanitizeConditions({ temperature: 'hot', cloud: Number.NaN, precipitation: -2, windFrom: -90, visibility: 1 });
    expect(c.temperature).toBe(TYPICAL.temperature);
    expect(c.cloud).toBe(TYPICAL.cloud);
    expect(c.precipitation).toBe(0);
    expect(c.windFrom).toBe(270);
    expect(c.visibility).toBe(50);
    expect(sanitizeConditions(null)).toEqual(TYPICAL);
  });

  it('keeps ids and readings only as a matched pair, and an unmatched document reads as empty', () => {
    const good = sanitizeWeatherCache({ takenMs: 1000, ids: ['a', 'b'], conditions: [reading, reading] });
    expect(good.ids).toEqual(['a', 'b']);
    expect(good.takenMs).toBe(1000);
    const odd = sanitizeWeatherCache({ takenMs: 1000, ids: ['a'], conditions: [reading, reading] });
    expect(odd.ids).toEqual([]);
    expect(odd.takenMs).toBe(0);
    expect(sanitizeWeatherCache('garbage').conditions).toEqual([]);
  });

  it('reads null until something is written, then the readings back, through the storage root', () => {
    const { root, kv } = memoryRoot();
    const cache = weatherCacheOver(root);
    expect(cache.read()).toBeNull();
    cache.write({ takenMs: 5000, ids: ['lihue'], conditions: [reading] });
    expect(kv.has(WEATHER_CACHE_KEY)).toBe(true);
    const back = cache.read();
    expect(back?.takenMs).toBe(5000);
    expect(back?.ids).toEqual(['lihue']);
    expect(back?.conditions[0].precipitation).toBe(3.5);
    // A second root over the same storage sees the same reading: it is the device's, not the object's.
    expect(weatherCacheOver(root).read()?.ids).toEqual(['lihue']);
  });
});
