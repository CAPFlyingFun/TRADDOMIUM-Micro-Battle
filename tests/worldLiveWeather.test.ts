/**
 * THE BRIDGE IS THE RIGHT WAY ROUND, AND THE CHAIN NEVER BREAKS THE BOOT.
 *
 * `toWeatherNow` is the one conversion from meteorology to the game, and
 * the thing this file pins hardest is the compass: a north wind must
 * blow FROM Kīlauea Point TOWARD Poʻipū, and the stations' own world
 * positions say which way that is — not a sign somebody remembered.
 *
 * `LiveWeather` is the chain live → cached → simulated, with a fake
 * provider and a fake clock, so every branch of it runs in milliseconds
 * with no network: it starts simulated, goes live on a good reply, stays
 * simulated on a bad one and retries after ninety seconds, reads a young
 * cache as cached and drops a stale one, is due every twelve minutes,
 * honours a held sky and hands it back, and never throws.
 */
import { describe, expect, it } from 'vitest';
import type { WorldPoint } from '../src/world/coords';
import type { GeoPoint } from '../src/world/geo';
import { TYPICAL, type Conditions, type WeatherProvider } from '../src/world/weather/conditions';
import { TAU } from '../src/world/weather/blend';
import {
  CACHE_GOOD_MS,
  LiveWeather,
  MIN_VISIBILITY_M,
  REFRESH_MS,
  RETRY_MS,
  conditionsOf,
  floorFor,
  toWeatherNow,
  type CachedReadings,
  type WeatherCache,
} from '../src/world/weather/liveWeather';
import {
  CLOUDY_FLOOR,
  KMH_TO_UNITS_PER_SECOND,
  RAIN_VISIBLE_MM_HR,
  SkyModel,
} from '../src/world/weather/skyModel';
import { STATIONS, STATION_POINTS, type Station } from '../src/world/weather/stations';
import { FAIR, skyIsBuilt, type WeatherNow } from '../src/world/weather/weather';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function station(id: string): Station {
  const found = STATIONS.find((s) => s.id === id);
  if (!found) throw new Error(`no station ${id}`);
  return found;
}

const KILAUEA = station('kilauea');
const POIPU = station('poipu');
const HAENA = station('haena');
const LIHUE = station('lihue');

function conditions(patch: Partial<Conditions> = {}): Conditions {
  return { ...TYPICAL, ...patch };
}

/** Clear, dry, calm: the reading that makes the sky read `clear`. */
const CALM = conditions({ precipitation: 0, rain: 0, showers: 0, cloud: 0, windSpeed: 0, code: 0 });

const HOUR_MS = 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

function fakeClock(start = T0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}

interface FakeProvider extends WeatherProvider {
  /** Set to make every request fail. */
  fail: boolean;
  /** What each request asked for. */
  readonly asked: GeoPoint[][];
}

/** Answers every station with `reading` (or with what `each` returns for it). */
function fakeProvider(reading: Conditions, each?: (point: GeoPoint, i: number) => unknown): FakeProvider {
  const p: FakeProvider = {
    id: 'fake',
    fail: false,
    asked: [],
    async sample(points) {
      p.asked.push([...points]);
      if (p.fail) throw new Error('provider down');
      return points.map((point, i) => (each ? each(point, i) : reading)) as Conditions[];
    },
  };
  return p;
}

interface FakeCache extends WeatherCache {
  stored: CachedReadings | null;
  readonly writes: CachedReadings[];
}

function fakeCache(initial: CachedReadings | null = null): FakeCache {
  const c: FakeCache = {
    stored: initial,
    writes: [],
    read() {
      return c.stored;
    },
    write(value) {
      c.writes.push(value);
      c.stored = value;
    },
  };
  return c;
}

function cachedAt(takenMs: number, reading: Conditions, stations: readonly Station[] = STATIONS): CachedReadings {
  return { takenMs, ids: stations.map((s) => s.id), conditions: stations.map(() => reading) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Enough simulated time for every blend channel to close its gap. */
function settle(weather: LiveWeather, at: WorldPoint): WeatherNow {
  weather.sample(at);
  weather.tick(TAU.temperature * 40);
  return weather.sample(at);
}

// ---------------------------------------------------------------------------
// The bridge
// ---------------------------------------------------------------------------

describe('toWeatherNow: rain', () => {
  it('reads the TOTAL precipitation, not the large-scale share', () => {
    // v0 once read `rain` alone and told the player DRIZZLE and "Rain:
    // none" in one breath.
    expect(toWeatherNow(conditions({ precipitation: 3, rain: 0.5, showers: 2.5, code: 0 }), 'live').rainMmHr).toBe(3);
  });

  it('gates rain at RAIN_VISIBLE_MM_HR — the same floor the model uses', () => {
    expect(RAIN_VISIBLE_MM_HR).toBe(0.05);
    expect(toWeatherNow(conditions({ precipitation: 0.049, code: 0 }), 'live').rainMmHr).toBe(0);
    expect(toWeatherNow(conditions({ precipitation: 0.05, code: 0 }), 'live').rainMmHr).toBe(0.05);
    expect(toWeatherNow(conditions({ precipitation: -2, code: 0 }), 'live').rainMmHr).toBe(0);
  });

  it('lifts a wet WMO code to its floor, so drizzle drizzles', () => {
    expect(floorFor(0)).toBe(0);
    expect(floorFor(45)).toBe(0); // fog is not precipitation
    expect(floorFor(51)).toBe(0.08);
    expect(floorFor(61)).toBe(0.4);
    expect(floorFor(71)).toBe(0.3);
    expect(floorFor(80)).toBe(0.5);
    expect(floorFor(95)).toBe(1.2);
    expect(floorFor(99)).toBe(1.2);
    for (const [code, floor] of [[51, 0.08], [61, 0.4], [71, 0.3], [80, 0.5], [95, 1.2]] as const) {
      expect(toWeatherNow(conditions({ precipitation: 0, code }), 'live').rainMmHr).toBe(floor);
    }
  });

  it('believes a measurable total under a dry code, and never caps at the floor', () => {
    expect(toWeatherNow(conditions({ precipitation: 3, code: 0 }), 'live').rainMmHr).toBe(3);
    expect(toWeatherNow(conditions({ precipitation: 5, code: 61 }), 'live').rainMmHr).toBe(5);
  });
});

describe('toWeatherNow: the rest of the numbers', () => {
  it('makes cloud percent into 0..1', () => {
    expect(toWeatherNow(conditions({ cloud: 45 }), 'live').cloud).toBe(0.45);
    expect(toWeatherNow(conditions({ cloud: 150 }), 'live').cloud).toBe(1);
    expect(toWeatherNow(conditions({ cloud: -5 }), 'live').cloud).toBe(0);
  });

  it('makes km/h into world units a second', () => {
    // 36 km/h is 10 m/s is 1,000 cm/s: a thousand units a second.
    const now = toWeatherNow(conditions({ windSpeed: 36, windFrom: 123 }), 'live');
    expect(Math.hypot(now.windX, now.windZ)).toBeCloseTo(1_000, 9);
    expect(36 * KMH_TO_UNITS_PER_SECOND).toBeCloseTo(1_000, 9);
    expect(toWeatherNow(conditions({ windSpeed: -10 }), 'live').windX).toBe(-0);
  });

  it('floors visibility at 50 m and passes clear air through', () => {
    expect(MIN_VISIBILITY_M).toBe(50);
    expect(toWeatherNow(conditions({ visibility: 10 }), 'live').visibilityM).toBe(50);
    expect(toWeatherNow(conditions({ visibility: 24_000 }), 'live').visibilityM).toBe(24_000);
  });

  it('passes the source through and freezes the reading', () => {
    for (const source of ['live', 'cached', 'simulated'] as const) {
      const now = toWeatherNow(TYPICAL, source);
      expect(now.source).toBe(source);
      expect(Object.isFrozen(now)).toBe(true);
    }
  });

  it('reads a non-finite field as TYPICAL\'s, never as NaN', () => {
    const broken = {
      temperature: NaN, humidity: NaN, precipitation: NaN, rain: NaN, showers: NaN,
      cloud: NaN, windSpeed: Infinity, windFrom: NaN, windGust: NaN, visibility: NaN, code: NaN,
    };
    const now = toWeatherNow(broken, 'live');
    const typical = toWeatherNow(TYPICAL, 'live');
    expect(now).toEqual(typical);
    for (const value of Object.values(now)) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe('toWeatherNow: which way the wind blows', () => {
  it('blows a north wind from Kīlauea Point toward Poʻipū', () => {
    // THE STATIONS SAY WHICH WAY SOUTH IS. Kīlauea Point is the island's
    // north tip and Poʻipū its south coast; `geo.ts` puts north at -wz,
    // and this line is where that fact is measured rather than trusted.
    expect(POIPU.at.wz).toBeGreaterThan(KILAUEA.at.wz);
    const toPoipu = { x: POIPU.at.wx - KILAUEA.at.wx, z: POIPU.at.wz - KILAUEA.at.wz };

    // A north wind comes FROM the north and travels south: +wz.
    const north = toWeatherNow(conditions({ windSpeed: 20, windFrom: 0 }), 'live');
    expect(north.windZ).toBeGreaterThan(0);
    expect(Math.abs(north.windX)).toBeLessThan(1e-9);
    expect(north.windX * toPoipu.x + north.windZ * toPoipu.z).toBeGreaterThan(0);

    // And a south wind goes the other way.
    const south = toWeatherNow(conditions({ windSpeed: 20, windFrom: 180 }), 'live');
    expect(south.windZ).toBeLessThan(0);
  });

  it('blows an east wind from Kīlauea Point toward Hāʻena', () => {
    // Hāʻena is on the north shore too, well west of Kīlauea Point.
    expect(HAENA.at.wx).toBeLessThan(KILAUEA.at.wx);
    const east = toWeatherNow(conditions({ windSpeed: 20, windFrom: 90 }), 'live');
    expect(east.windX).toBeLessThan(0);
    expect(Math.abs(east.windZ)).toBeLessThan(1e-9);
  });

  it('sends the trades west-south-west, as the model does', () => {
    // From 65° (ENE), so travelling -wx and +wz — the same sign the
    // SkyModel test pins for its own wind.
    const trades = toWeatherNow(conditions({ windSpeed: 20, windFrom: 65 }), 'live');
    expect(trades.windX).toBeLessThan(0);
    expect(trades.windZ).toBeGreaterThan(0);
    expect(Math.abs(trades.windX)).toBeGreaterThan(Math.abs(trades.windZ));
  });
});

describe('toWeatherNow: the sky', () => {
  it('is rain when rain falls, cloudy from three eighths, clear below', () => {
    expect(toWeatherNow(conditions({ cloud: 37.4, precipitation: 0, code: 0 }), 'live').sky).toBe('clear');
    expect(toWeatherNow(conditions({ cloud: CLOUDY_FLOOR * 100, precipitation: 0, code: 0 }), 'live').sky).toBe('cloudy');
    expect(toWeatherNow(conditions({ cloud: 100, precipitation: 0, code: 0 }), 'live').sky).toBe('cloudy');
    expect(toWeatherNow(conditions({ cloud: 0, precipitation: 1, code: 0 }), 'live').sky).toBe('rain');
    expect(toWeatherNow(conditions({ cloud: 0, precipitation: 0.04, code: 0 }), 'live').sky).toBe('clear');
  });

  it('reads a live thunderstorm as rain — the honesty rule', () => {
    // `thunderstorm` is named in `Sky` and not built. A reading may not
    // claim a sky the game cannot draw, so WMO 95–99 is what it is on
    // the ground: heavy rain.
    for (const code of [95, 96, 99]) {
      const now = toWeatherNow(conditions({ precipitation: 0, cloud: 100, code }), 'live');
      expect(now.sky).toBe('rain');
      expect(now.rainMmHr).toBe(1.2);
    }
  });

  it('only ever produces a built sky, for every code and intensity', () => {
    for (let code = 0; code <= 99; code += 1) {
      for (const precipitation of [0, 0.04, 0.5, 20]) {
        for (const cloud of [0, 50, 100]) {
          expect(skyIsBuilt(toWeatherNow(conditions({ code, precipitation, cloud }), 'live').sky)).toBe(true);
        }
      }
    }
  });
});

describe('conditionsOf: the bridge run backwards', () => {
  it('round-trips the model\'s reading through Conditions', () => {
    const model = new SkyModel({ seed: 5, wetness: 1 });
    let checked = 0;
    for (let i = 0; i < 4_000; i += 1) {
      const now = model.advance(30);
      const back = toWeatherNow(conditionsOf(now), 'simulated');
      expect(back.rainMmHr).toBeCloseTo(now.rainMmHr, 9);
      expect(back.cloud).toBeCloseTo(now.cloud, 9);
      expect(back.windX).toBeCloseTo(now.windX, 6);
      expect(back.windZ).toBeCloseTo(now.windZ, 6);
      expect(back.visibilityM).toBeCloseTo(now.visibilityM, 9);
      expect(back.sky).toBe(now.sky);
      if (now.rainMmHr > 0) checked += 1;
    }
    expect(checked, 'it never rained, so the rain leg proved nothing').toBeGreaterThan(50);
  });

  it('keeps a trace of rain a trace: no code floor exceeds the rain that chose it', () => {
    const light: WeatherNow = { ...FAIR, sky: 'rain', rainMmHr: 0.06, cloud: 0.7 };
    const back = toWeatherNow(conditionsOf(light), 'simulated');
    expect(back.rainMmHr).toBeCloseTo(0.06, 12);
    expect(back.sky).toBe('rain');
  });

  it('recovers the bearing the wind came from', () => {
    const speed = 20 * KMH_TO_UNITS_PER_SECOND;
    const from = (65 * Math.PI) / 180;
    const trades: WeatherNow = { ...FAIR, windX: -speed * Math.sin(from), windZ: speed * Math.cos(from) };
    const c = conditionsOf(trades);
    expect(c.windFrom).toBeCloseTo(65, 9);
    expect(c.windSpeed).toBeCloseTo(20, 9);
    expect(c.temperature).toBe(TYPICAL.temperature);
  });
});

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

describe('LiveWeather: the chain', () => {
  it('starts simulated, FAIR before any sample, the model after one', () => {
    const clock = fakeClock();
    const fallback = new SkyModel({ seed: 7 });
    const weather = new LiveWeather({ provider: fakeProvider(CALM), clock: clock.now, cache: null, fallback });
    expect(weather.now()).toBe(FAIR);
    expect(weather.source).toBe('simulated');
    const first = weather.sample(LIHUE.at);
    expect(first.source).toBe('simulated');
    expect(first).toEqual(fallback.now());
    expect(weather.now()).toBe(first);
  });

  it('is due on the first frame and goes live on a good reply', async () => {
    const clock = fakeClock();
    const provider = fakeProvider(conditions({ cloud: 100, precipitation: 0, code: 3 }));
    const weather = new LiveWeather({ provider, clock: clock.now, cache: null, fallback: new SkyModel({ seed: 7 }) });
    expect(weather.dueForRefresh()).toBe(true);
    await weather.refresh();
    expect(weather.source).toBe('live');
    // It asked for the whole grid, in order.
    expect(provider.asked.length).toBe(1);
    expect(provider.asked[0]).toEqual([...STATION_POINTS]);
    const now = settle(weather, LIHUE.at);
    expect(now.source).toBe('live');
    expect(now.cloud).toBeCloseTo(1, 6);
    expect(now.sky).toBe('cloudy');
    expect(weather.now()).toBe(now);
  });

  it('fades the island in from the sky that was showing, rather than snapping', async () => {
    const clock = fakeClock();
    const fallback = new SkyModel({ seed: 7 });
    const weather = new LiveWeather({
      provider: fakeProvider(conditions({ cloud: 100, precipitation: 0, code: 3 })),
      clock: clock.now, cache: null, fallback,
    });
    const before = weather.sample(LIHUE.at);
    expect(before.source).toBe('simulated');
    expect(before.cloud).toBeLessThan(0.9);

    await weather.refresh();
    const first = weather.sample(LIHUE.at);
    expect(first.source).toBe('live');
    // The first live frame shows the model's cloud, not the island's.
    expect(first.cloud).toBeCloseTo(before.cloud, 9);

    // One cloud tau later it has closed 63% of the way to overcast.
    weather.tick(TAU.cloud);
    const later = weather.sample(LIHUE.at);
    expect(later.cloud).toBeCloseTo(before.cloud + (1 - before.cloud) * (1 - Math.exp(-1)), 9);
  });

  it('stays simulated on a bad reply and retries after ninety seconds, not before', async () => {
    for (const kind of ['reject', 'throw', 'empty'] as const) {
      const clock = fakeClock();
      const provider: WeatherProvider = {
        id: kind,
        sample: kind === 'reject' ? () => Promise.reject(new Error('down'))
          : kind === 'throw' ? () => { throw new Error('down'); }
            : () => Promise.resolve([]),
      };
      const weather = new LiveWeather({ provider, clock: clock.now, cache: null, fallback: new SkyModel({ seed: 7 }) });
      await expect(weather.refresh()).resolves.toBeUndefined();
      expect(weather.sample(LIHUE.at).source).toBe('simulated');
      expect(weather.dueForRefresh()).toBe(false);
      clock.advance(RETRY_MS - 1);
      expect(weather.dueForRefresh()).toBe(false);
      clock.advance(1);
      expect(weather.dueForRefresh()).toBe(true);
    }
    expect(RETRY_MS).toBe(90_000);
  });

  it('reads a young cache as cached when live fails, and drops it after three hours', async () => {
    const clock = fakeClock();
    const takenMs = clock.now() - HOUR_MS;
    const cache = fakeCache(cachedAt(takenMs, conditions({ cloud: 100, code: 3 })));
    const provider = fakeProvider(CALM);
    provider.fail = true;
    const weather = new LiveWeather({ provider, clock: clock.now, cache, fallback: new SkyModel({ seed: 7 }) });

    expect(weather.source).toBe('cached');
    await weather.refresh();
    expect(weather.source).toBe('cached');
    expect(settle(weather, LIHUE.at).source).toBe('cached');
    expect(settle(weather, LIHUE.at).cloud).toBeCloseTo(1, 6);

    clock.set(takenMs + CACHE_GOOD_MS);
    expect(weather.sample(LIHUE.at).source).toBe('cached');
    clock.advance(1);
    expect(weather.sample(LIHUE.at).source).toBe('simulated');
    expect(weather.source).toBe('simulated');
    expect(CACHE_GOOD_MS).toBe(3 * HOUR_MS);
  });

  it('is simulated from the start when the cache is already stale', () => {
    const clock = fakeClock();
    const cache = fakeCache(cachedAt(clock.now() - CACHE_GOOD_MS - 1, conditions({ cloud: 100 })));
    const weather = new LiveWeather({ provider: null, clock: clock.now, cache, fallback: new SkyModel({ seed: 7 }) });
    expect(weather.sample(LIHUE.at).source).toBe('simulated');
  });

  it('writes the cache on success, by station id, and a short reply is a partial field', async () => {
    const clock = fakeClock();
    const cache = fakeCache();
    const reading = conditions({ cloud: 60 });
    const provider = fakeProvider(reading, (_point, i) => (i < 3 ? reading : undefined));
    // Three readings back: the provider answered a prefix of the grid.
    provider.sample = async (points) => {
      provider.asked.push([...points]);
      return points.slice(0, 3).map(() => reading);
    };
    const weather = new LiveWeather({ provider, clock: clock.now, cache, fallback: new SkyModel({ seed: 7 }) });
    clock.advance(1234);
    await weather.refresh();
    expect(cache.writes.length).toBe(1);
    expect(cache.writes[0]).toEqual({
      takenMs: clock.now(),
      ids: STATIONS.slice(0, 3).map((s) => s.id),
      conditions: [reading, reading, reading],
    });
    expect(weather.source).toBe('live');
  });

  it('matches cached readings by station id, not by position', () => {
    const clock = fakeClock();
    // The ids REVERSED against the station list, with Poʻipū overcast and
    // Kīlauea Point clear.
    const reversed = [...STATIONS].reverse();
    const cache = fakeCache({
      takenMs: clock.now(),
      ids: reversed.map((s) => s.id),
      conditions: reversed.map((s) => conditions({ cloud: s.id === 'poipu' ? 100 : 0, code: 0 })),
    });
    const weather = new LiveWeather({ provider: null, clock: clock.now, cache, fallback: new SkyModel({ seed: 7 }) });
    expect(settle(weather, POIPU.at).cloud).toBeCloseTo(1, 6);
    expect(settle(weather, KILAUEA.at).cloud).toBeCloseTo(0, 6);
  });

  it('is not due while a request is in flight, then due every twelve minutes', async () => {
    const clock = fakeClock();
    const pending = deferred<readonly Conditions[]>();
    const provider: WeatherProvider = { id: 'slow', sample: () => pending.promise };
    const weather = new LiveWeather({ provider, clock: clock.now, cache: null, fallback: new SkyModel({ seed: 7 }) });

    const started = clock.now();
    const first = weather.refresh();
    expect(weather.refresh()).toBe(first);
    expect(weather.dueForRefresh()).toBe(false);
    clock.advance(HOUR_MS);
    expect(weather.dueForRefresh()).toBe(false);

    clock.set(started);
    pending.resolve(STATIONS.map(() => CALM));
    await first;
    expect(weather.source).toBe('live');
    expect(weather.dueForRefresh()).toBe(false);
    clock.set(started + REFRESH_MS - 1);
    expect(weather.dueForRefresh()).toBe(false);
    clock.advance(1);
    expect(weather.dueForRefresh()).toBe(true);
    expect(REFRESH_MS).toBe(12 * 60 * 1000);
  });

  it('is never due without a provider, and refresh resolves', async () => {
    const clock = fakeClock();
    const cache = fakeCache(cachedAt(clock.now(), CALM));
    const weather = new LiveWeather({ provider: null, clock: clock.now, cache, fallback: new SkyModel({ seed: 7 }) });
    expect(weather.dueForRefresh()).toBe(false);
    clock.advance(24 * HOUR_MS);
    expect(weather.dueForRefresh()).toBe(false);
    await expect(weather.refresh()).resolves.toBeUndefined();
    expect(cache.writes.length).toBe(0);
  });

  it('asks only for the stations it was given', async () => {
    const clock = fakeClock();
    const provider = fakeProvider(CALM);
    const weather = new LiveWeather({
      provider, clock: clock.now, cache: null, fallback: new SkyModel({ seed: 7 }), stations: [LIHUE, POIPU],
    });
    await weather.refresh();
    expect(provider.asked[0]).toEqual([LIHUE.where, POIPU.where]);
    expect(weather.source).toBe('live');
  });

  it('falls back to the model when a live reading goes stale, and recovers', async () => {
    const clock = fakeClock();
    const provider = fakeProvider(CALM);
    const weather = new LiveWeather({ provider, clock: clock.now, cache: null, fallback: new SkyModel({ seed: 7 }) });
    await weather.refresh();
    expect(weather.sample(LIHUE.at).source).toBe('live');

    provider.fail = true;
    clock.advance(CACHE_GOOD_MS + 1);
    expect(weather.dueForRefresh()).toBe(true);
    await weather.refresh();
    expect(weather.sample(LIHUE.at).source).toBe('simulated');

    provider.fail = false;
    clock.advance(RETRY_MS);
    expect(weather.dueForRefresh()).toBe(true);
    await weather.refresh();
    expect(weather.sample(LIHUE.at).source).toBe('live');
  });
});

describe('LiveWeather: time', () => {
  it('advances the fallback model by exactly the simulated seconds it is handed', () => {
    const clock = fakeClock();
    const fallback = new SkyModel({ seed: 21 });
    const twin = new SkyModel({ seed: 21 });
    const start = twin.now();
    const weather = new LiveWeather({ provider: null, clock: clock.now, cache: null, fallback });
    for (let i = 0; i < 180; i += 1) {
      weather.tick(60);
      twin.advance(60);
      expect(weather.sample(LIHUE.at)).toEqual(twin.now());
    }
    // Not vacuous: three hours moved the twin somewhere.
    expect(twin.now()).not.toEqual(start);
  });

  it('holds the sky at dt 0 — a paused game', async () => {
    const clock = fakeClock();
    const weather = new LiveWeather({
      provider: fakeProvider(conditions({ cloud: 100, code: 3 })),
      clock: clock.now, cache: null, fallback: new SkyModel({ seed: 7 }),
    });
    await weather.refresh();
    const a = weather.sample(LIHUE.at);
    weather.tick(0);
    weather.tick(Number.NaN);
    weather.tick(-5);
    expect(weather.sample(LIHUE.at)).toEqual(a);
    weather.tick(1);
    expect(weather.sample(LIHUE.at)).not.toEqual(a);
  });
});

describe('LiveWeather: a held sky', () => {
  it('overrides everything while forced, and release gives the island back', async () => {
    const clock = fakeClock();
    const fallback = new SkyModel({ seed: 6, wetness: 0 });
    const weather = new LiveWeather({ provider: fakeProvider(CALM), clock: clock.now, cache: null, fallback });
    await weather.refresh();
    expect(settle(weather, LIHUE.at).sky).toBe('clear');
    expect(weather.forcedSky).toBeNull();

    expect(weather.force('rain')).toBe(true);
    expect(weather.forcedSky).toBe('rain');
    expect(weather.source).toBe('simulated');
    // `now()` follows the held sky as it ramps, WITHOUT a sample in
    // between — a probe polling the source sees the rain it asked for
    // arrive, rather than the last clear frame it happened to sample.
    for (let i = 0; i < 60; i += 1) weather.tick(10);
    expect(weather.now()).toBe(fallback.now());
    expect(weather.now().sky).toBe('rain');
    expect(weather.now().source).toBe('simulated');
    const held = weather.sample(LIHUE.at);
    expect(held.source).toBe('simulated');
    expect(held.sky).toBe('rain');
    expect(held).toBe(fallback.now());
    expect(weather.now()).toBe(fallback.now());

    // An unbuilt sky is refused and the override is left alone.
    expect(weather.force('hurricane')).toBe(false);
    expect(weather.forcedSky).toBe('rain');

    weather.release();
    expect(weather.forcedSky).toBeNull();
    const back = weather.sample(LIHUE.at);
    expect(back.source).toBe('live');
    expect(back.sky).toBe('clear');
    expect(back.rainMmHr).toBe(0);
  });
});

describe('LiveWeather: never throws', () => {
  it('survives a cache that throws on read and on write', async () => {
    const clock = fakeClock();
    const cache: WeatherCache = {
      read: () => { throw new Error('private window'); },
      write: () => { throw new Error('quota'); },
    };
    const weather = new LiveWeather({ provider: fakeProvider(CALM), clock: clock.now, cache, fallback: new SkyModel({ seed: 7 }) });
    expect(weather.source).toBe('simulated');
    await expect(weather.refresh()).resolves.toBeUndefined();
    expect(weather.source).toBe('live');
  });

  it('makes garbage readings boring rather than broken', async () => {
    const clock = fakeClock();
    const garbage = [
      { temperature: 'hot', cloud: NaN, windSpeed: Infinity },
      null, 42, 'rain', undefined, { code: 61 }, [],
    ];
    const provider = fakeProvider(CALM, (_p, i) => garbage[i % garbage.length]);
    const weather = new LiveWeather({ provider, clock: clock.now, cache: null, fallback: new SkyModel({ seed: 7 }) });
    await expect(weather.refresh()).resolves.toBeUndefined();
    expect(weather.source).toBe('live');
    const now = settle(weather, LIHUE.at);
    expect(now.cloud).toBeCloseTo(TYPICAL.cloud / 100, 6);
    expect(Math.hypot(now.windX, now.windZ)).toBeCloseTo(TYPICAL.windSpeed * KMH_TO_UNITS_PER_SECOND, 3);
    for (const value of Object.values(now)) {
      if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('ignores a malformed cache entry', () => {
    const clock = fakeClock();
    for (const stored of [
      { takenMs: NaN, ids: ['lihue'], conditions: [CALM] },
      { takenMs: clock.now(), ids: 'lihue', conditions: [CALM] },
      { takenMs: clock.now(), ids: ['nowhere'], conditions: [CALM] },
      { takenMs: clock.now(), ids: ['lihue'], conditions: [null] },
      'not an object',
    ]) {
      const cache: WeatherCache = { read: () => stored as unknown as CachedReadings, write: () => {} };
      const weather = new LiveWeather({ provider: null, clock: clock.now, cache, fallback: new SkyModel({ seed: 7 }) });
      expect(weather.source).toBe('simulated');
    }
  });
});
