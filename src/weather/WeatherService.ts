/**
 * THE WEATHER SERVICE — fetching, falling back, caching, easing.
 *
 * One object owns the whole chain so that no part of the game has to
 * know how many ways it can fail:
 *
 *   live reading  →  cached reading  →  simulated
 *
 * THE GAME MUST BOOT WITH THE CABLE UNPLUGGED. Weather is an
 * enhancement, and an enhancement that can prevent a launch is a
 * liability. So the constructor never waits on a network, `update()`
 * never throws, and there is a usable field before the first request
 * has even been sent — the simulated one, replaced in place the moment
 * something better lands.
 *
 * THE CACHE is what makes the second launch on a plane still look like
 * Kauaʻi rather than like the model. Readings are kept with the moment
 * they were taken, and used on the way up only while they are recent
 * enough to still be a description of the sky rather than a memory of
 * it.
 *
 * REFRESH IS SLOW ON PURPOSE. Every quarter hour, not every frame and
 * not every minute. Open-Meteo is free and this project is one of many
 * things asking it politely; the blend makes a quarter-hourly update
 * feel continuous anyway.
 *
 * Everything is addressed in GLOBAL coordinates. The floating origin
 * moving does not move a front, does not restart a shower, and does not
 * hand the summit's rain to the west coast.
 */
import type { WorldPoint } from '../world/coords';
import { WeatherField } from './field';
import { WeatherBlend } from './blend';
import { simulate } from './simulated';
import { OpenMeteo } from './openMeteo';
import { toGameWeather, type GameWeather } from './gameplay';
import { STATIONS, STATION_POINTS } from './stations';
import type {
  Conditions, WeatherProvider, WeatherSample, WeatherSource,
} from './conditions';

/** How often to ask for fresh readings. */
export const REFRESH_MS = 12 * 60 * 1000;

/** How long a cached reading may stand in for a live one. */
export const CACHE_GOOD_MS = 3 * 60 * 60 * 1000;

/** How long to wait after a failure before trying again. */
const RETRY_MS = 90 * 1000;

const STORE = 'traddomium.weather';

export type WeatherMode = 'live' | 'simulated';

interface Cached {
  readonly taken: number;
  readonly ids: readonly string[];
  readonly conditions: readonly Conditions[];
}

export interface WeatherServiceOptions {
  readonly live?: WeatherProvider;
  readonly clock?: () => number;
  readonly store?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

export class WeatherService {
  private readonly live: WeatherProvider;
  private readonly clock: () => number;
  private readonly store: Pick<Storage, 'getItem' | 'setItem'> | null;

  private readonly blend = new WeatherBlend();
  private held: WeatherField;
  private mode: WeatherMode = 'live';
  private nextTry = 0;
  private asking = false;

  constructor(options: WeatherServiceOptions = {}) {
    this.live = options.live ?? new OpenMeteo();
    this.clock = options.clock ?? (() => Date.now());
    this.store = options.store === undefined ? safeStore() : options.store;

    // There is a field before anything has been asked for. This is the
    // line that makes weather unable to block a boot.
    this.held = this.readCache() ?? this.makeSimulated();
  }

  get field(): WeatherField {
    return this.held;
  }

  get source(): WeatherSource {
    return this.held.source;
  }

  get using(): WeatherMode {
    return this.mode;
  }

  /** Switch between the real island's weather and the offline model. */
  setMode(mode: WeatherMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.nextTry = 0;
    if (mode === 'simulated') this.held = this.makeSimulated();
  }

  /**
   * Ask for readings if it is time to.
   *
   * Returns immediately; the answer lands in the field whenever it
   * lands. Nothing waits on it and nothing is told about a failure
   * beyond the source staying what it was.
   */
  poll(): void {
    if (this.mode !== 'live' || this.asking) return;
    const now = this.clock();
    if (now < this.nextTry) return;

    this.asking = true;
    // The next attempt is scheduled BEFORE the request, so a promise
    // that never settles cannot wedge the refresh loop shut.
    this.nextTry = now + REFRESH_MS;

    this.live.fetch(STATION_POINTS)
      .then((readings) => {
        if (readings.length === 0) throw new Error('no readings');
        const taken = this.clock();
        this.held = new WeatherField(pair(readings), 'live', taken);
        this.writeCache(taken, readings);
      })
      .catch(() => {
        // Keep whatever is already showing. If that is still the
        // opening simulated field, it stays, and the player is told.
        this.nextTry = this.clock() + RETRY_MS;
      })
      .finally(() => {
        this.asking = false;
      });
  }

  /**
   * One frame. `at` is her GLOBAL position.
   *
   * @param dt SIMULATED seconds, so a slow device and a fast one reach
   *   the same weather at the same point in the game rather than at the
   *   same point on a wall clock.
   */
  update(at: WorldPoint, dt: number): GameWeather {
    this.poll();
    if (this.mode === 'simulated' && this.held.source !== 'simulated') {
      this.held = this.makeSimulated();
    }
    const target = this.held.at(at);
    return toGameWeather(this.blend.update(target, dt));
  }

  /** Arrive already in the weather rather than fading into it. */
  settleAt(at: WorldPoint): GameWeather {
    this.blend.set(this.held.at(at));
    return toGameWeather(this.blend.current as Conditions);
  }

  /** The raw reading in force, for the HUD panel. Null before the first. */
  get reading(): Conditions | null {
    return this.blend.current;
  }

  /** Conditions at any GLOBAL point — what the spawn map asks. */
  peek(at: WorldPoint): Conditions {
    return this.held.at(at);
  }

  private makeSimulated(): WeatherField {
    const now = this.clock();
    const samples = STATIONS.map((station) => ({
      id: station.id,
      name: station.name,
      where: station.where,
      at: station.at,
      conditions: simulate(station.where, now),
    }));
    return new WeatherField(samples, 'simulated', now);
  }

  private readCache(): WeatherField | null {
    if (!this.store) return null;
    let raw: string | null = null;
    try {
      raw = this.store.getItem(STORE);
    } catch {
      return null;
    }
    if (!raw) return null;

    let saved: unknown;
    try {
      saved = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof saved !== 'object' || saved === null) return null;

    const cached = saved as Partial<Cached>;
    if (typeof cached.taken !== 'number') return null;
    if (!Array.isArray(cached.conditions)) return null;
    if (this.clock() - cached.taken > CACHE_GOOD_MS) return null;

    // The station list can change between builds. Match by ID rather
    // than by position, or a re-ordered grid silently hands Polihale's
    // sunshine to the Alakaʻi swamp.
    const ids = Array.isArray(cached.ids) ? cached.ids : [];
    const byId = new Map<string, Conditions>();
    for (let i = 0; i < ids.length; i += 1) {
      const conditions = cached.conditions[i];
      if (typeof conditions === 'object' && conditions !== null) {
        byId.set(String(ids[i]), conditions as Conditions);
      }
    }

    const samples: WeatherSample[] = [];
    for (const station of STATIONS) {
      const conditions = byId.get(station.id);
      if (!conditions) continue;
      samples.push({
        id: station.id,
        name: station.name,
        where: station.where,
        at: station.at,
        conditions,
      });
    }
    if (samples.length === 0) return null;
    return new WeatherField(samples, 'cached', cached.taken);
  }

  private writeCache(taken: number, readings: readonly Conditions[]): void {
    if (!this.store) return;
    const body: Cached = {
      taken,
      ids: STATIONS.slice(0, readings.length).map((s) => s.id),
      conditions: readings,
    };
    try {
      this.store.setItem(STORE, JSON.stringify(body));
    } catch {
      // A full or blocked store costs a cold start, nothing more.
    }
  }
}

function pair(readings: readonly Conditions[]): WeatherSample[] {
  const samples: WeatherSample[] = [];
  for (let i = 0; i < readings.length && i < STATIONS.length; i += 1) {
    const station = STATIONS[i];
    samples.push({
      id: station.id,
      name: station.name,
      where: station.where,
      at: station.at,
      conditions: readings[i],
    });
  }
  return samples;
}

function safeStore(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // Private windows and blocked storage.
  }
}

let shared: WeatherService | null = null;

/** The game's weather. One per session, created on first ask. */
export function weather(): WeatherService {
  if (!shared) shared = new WeatherService();
  return shared;
}

/** Tests only — forget the shared instance. */
export function resetWeather(): void {
  shared = null;
}
