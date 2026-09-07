/**
 * THE ISLAND'S OWN WEATHER, IN THE GAME — the bridge, and the chain.
 *
 * Joshua, 2026-09-07, opening Phase 5: "real weather synced." Two things
 * live here because they are the two halves of that sentence.
 *
 * THE BRIDGE (`toWeatherNow`) is the one wall between the real
 * atmosphere and the game. Everything upstream — the provider's reply,
 * the field, the blend — is metric meteorology: Celsius, percent, km/h,
 * a bearing the wind comes FROM. Everything downstream reads
 * `WeatherNow`: mm/hr gated at the visible floor, cloud 0..1, a wind
 * VELOCITY in world units on the ground plane, visibility in metres.
 * Nothing crosses without passing through here, and the crossing that
 * has bitten this project before — a north wind blowing north — is
 * pinned by a test against two real stations rather than by a comment.
 *
 * THE CHAIN (`LiveWeather`) is v0's, carried whole:
 *
 *   live reading  →  cached reading  →  simulated
 *
 * THE GAME MUST BOOT WITH THE CABLE UNPLUGGED. Weather is an
 * enhancement, and an enhancement that can prevent a launch is a
 * liability. So nothing here waits on a network: there is a usable
 * `WeatherSource` from the first frame — the seeded `SkyModel`, which is
 * what the sky read before Phase 5 and what it reads again the moment
 * the readings are too old to trust — and the honesty rule (CLAUDE.md)
 * is carried in every reading's `source`, so the HUD can never say
 * "Kauaʻi" over a sky the model made up.
 *
 * THE CACHE is what makes the second launch on a plane still look like
 * Kauaʻi rather than like the model. Readings are kept with the moment
 * they were taken and used only while young enough to still describe
 * the sky rather than remember it. The cache is a typed seam
 * (`WeatherCache`) that whoever owns storage implements; core reads and
 * writes a value and never learns where it went.
 *
 * REFRESH IS SLOW ON PURPOSE. Every twelve minutes, not every frame and
 * not every minute: Open-Meteo is free and this project is one of many
 * things asking it politely, and the blend makes a quarter-hourly
 * update feel continuous anyway.
 *
 * CORE STARTS NO PROMISE ON ITS OWN TIMER. `src/world/` is core and owns
 * no clock and no scheduler; the wall clock is a hook, and the decision
 * to ask the network is the scene's. So `tick(dt)` advances the blend
 * and the model in SIMULATION seconds, `dueForRefresh()` says whether
 * the clock has come round, and the owner does
 * `if (weather.dueForRefresh()) void weather.refresh()`. A paused game
 * hands in a dt of zero and the sky holds; the clock keeps running and
 * the readings keep refreshing underneath, which is right — the island's
 * weather did not pause.
 *
 * Everything is addressed in WORLD coordinates. The floating origin
 * moving does not move a front, does not restart a shower, and does not
 * hand the summit's rain to the west coast.
 */
import type { WorldPoint } from '../coords';
import type { GeoPoint } from '../geo';
import { WeatherBlend } from './blend';
import { TYPICAL, type Conditions, type WeatherProvider } from './conditions';
import { WeatherField } from './field';
import { CLOUDY_FLOOR, KMH_TO_UNITS_PER_SECOND, RAIN_VISIBLE_MM_HR, type SkyModel } from './skyModel';
import { STATIONS, type Station } from './stations';
import {
  FAIR,
  type Sky,
  type WeatherNow,
  type WeatherSource,
  type WeatherSourceKind,
} from './weather';

// ---------------------------------------------------------------------------
// The bridge
// ---------------------------------------------------------------------------

/**
 * THE SMALLEST PRECIPITATION A WET WMO CODE MAY IMPLY, in mm/hr. v0's
 * table, untouched.
 *
 * v0's panel once said DRIZZLE and, underneath it, "Rain: none", with
 * nothing falling. Both halves were honest: the code genuinely was
 * drizzle, and drizzle genuinely is not counted as rain. The
 * contradiction was in showing them together. Reading the TOTAL
 * precipitation fixes almost all of it; what is left is that a real
 * drizzle can round to 0.0 mm/hr at the provider, and can be
 * interpolated toward zero between stations — so the code says wet and
 * the number says nothing. Where that happens the description wins by a
 * hair: just enough falling to be seen, and no more.
 *
 * These are NOT invented rainfall. A drizzle floor of 0.08 mm/hr is
 * below what most gauges resolve, which is exactly why the provider
 * reported zero. The point is only that the world must never say one
 * thing and show another.
 */
const CODE_FLOOR: ReadonlyArray<{ readonly from: number; readonly floor: number }> = [
  { from: 95, floor: 1.2 }, // thunderstorm
  { from: 80, floor: 0.5 }, // showers
  { from: 71, floor: 0.3 }, // snow — Waiʻaleʻale, once in a lifetime
  { from: 61, floor: 0.4 }, // rain
  { from: 51, floor: 0.08 }, // drizzle
];

/** The least that can be falling, given what the WMO code claims. */
export function floorFor(code: number): number {
  for (const band of CODE_FLOOR) if (code >= band.from) return band.floor;
  return 0;
}

/**
 * The least visibility the bridge will report, in metres.
 *
 * Whiteout is a weather effect; being unable to see your own feet is a
 * broken game. Phase 5's brief puts the floor at 50 m (v0's was 60); the
 * fog reads this number and nothing else.
 */
export const MIN_VISIBILITY_M = 50;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** A number, or the typical value for the field when the reading is not one. */
function finite(value: number, typical: number): number {
  return Number.isFinite(value) ? value : typical;
}

/**
 * Real meteorology in, the game's weather out. The one conversion.
 *
 *  - RAIN is the TOTAL precipitation (`Conditions.precipitation`, the
 *    field that decides whether anything is falling), lifted to the WMO
 *    code's floor so a wet code drizzles, and gated at
 *    `RAIN_VISIBLE_MM_HR` — the same floor the seeded model uses, so
 *    "is it raining" has one answer whichever source is in force. A
 *    measurable total under a dry code is believed: rain that is
 *    actually falling is drawn whatever a stale code says.
 *  - CLOUD is percent made 0..1.
 *  - WIND is a VELOCITY, world units a second, travelling AWAY from the
 *    bearing it comes from. North is −wz and east is +wx (`geo.ts`,
 *    `dem.ts`), so a wind FROM bearing b travels (−sin b, +cos b): a
 *    north wind blows +wz, south. The same construction `SkyModel` uses,
 *    and the test pins it against Kīlauea Point and Poʻipū rather than
 *    against a sign somebody remembered. It is the ten-metre wind;
 *    reducing it to ant height is the job of whatever is being blown
 *    about (`skyModel.ts`, `WIND_REFERENCE_HEIGHT`).
 *  - VISIBILITY is the provider's metres, floored at `MIN_VISIBILITY_M`.
 *  - SKY is chosen from the BUILT set only. Rain → `rain`; cloud at or
 *    above `CLOUDY_FLOOR` → `cloudy`; else `clear`. A live THUNDERSTORM
 *    (WMO 95–99) reads as `rain`: the honesty rule says an unbuilt sky
 *    may never be reported as though the game could draw it, and until
 *    a strike channel exists what a thunderstorm IS on the ground is
 *    heavy rain — which is what its floor of 1.2 mm/hr produces. The day
 *    `thunderstorm` joins `BUILT_SKIES`, the mapping is one line here.
 *
 * A non-finite field is read as `TYPICAL`'s: the provider's builder is
 * supposed to have coerced every field already, and this is the second
 * line, so a NaN can never reach the water solver.
 */
export function toWeatherNow(c: Conditions, source: WeatherSourceKind): WeatherNow {
  const total = Math.max(0, finite(c.precipitation, TYPICAL.precipitation));
  const falling = Math.max(total, floorFor(finite(c.code, TYPICAL.code)));
  const rainMmHr = falling >= RAIN_VISIBLE_MM_HR ? falling : 0;

  const cloud = clamp01(finite(c.cloud, TYPICAL.cloud) / 100);

  const speed = Math.max(0, finite(c.windSpeed, TYPICAL.windSpeed)) * KMH_TO_UNITS_PER_SECOND;
  const from = finite(c.windFrom, TYPICAL.windFrom) * DEG_TO_RAD;
  const windX = -speed * Math.sin(from);
  const windZ = speed * Math.cos(from);

  const visibilityM = Math.max(MIN_VISIBILITY_M, finite(c.visibility, TYPICAL.visibility));

  const sky: Sky = rainMmHr > 0 ? 'rain' : cloud >= CLOUDY_FLOOR ? 'cloudy' : 'clear';

  return Object.freeze({ sky, rainMmHr, cloud, windX, windZ, visibilityM, source });
}

/**
 * The bridge run BACKWARDS, for one purpose: when the first real reading
 * lands over a simulated sky, the blend needs somewhere to ease FROM, or
 * the sky snaps from the model's weather to the island's between one
 * frame and the next — at boot, in front of the player, every session
 * the provider answers. Handing the blend the model's reading as
 * `Conditions` lets the island's weather fade in from whatever was
 * showing, over the same taus a refresh uses.
 *
 * The model has no temperature or humidity, so those are `TYPICAL`. The
 * WMO code is v0's offline mapping, chosen so no code's floor exceeds
 * the rain that produced it: `toWeatherNow(conditionsOf(x))` gives back
 * `x`'s rain, cloud, wind, visibility and sky, and a test says so. The
 * code never shows anyway — the blend takes the live code on the first
 * aim — but a round trip that lies would be a trap for the next reader.
 */
export function conditionsOf(now: WeatherNow): Conditions {
  const rain = Math.max(0, finite(now.rainMmHr, 0));
  const cloud = clamp01(finite(now.cloud, 0)) * 100;
  const windX = finite(now.windX, 0);
  const windZ = finite(now.windZ, 0);
  const windSpeed = Math.hypot(windX, windZ) / KMH_TO_UNITS_PER_SECOND;
  const windFrom = (((Math.atan2(-windX, windZ) * RAD_TO_DEG) % 360) + 360) % 360;
  const code = rain > 4 ? 65 : rain > 1 ? 61 : rain > 0.1 ? 51
    : cloud > 80 ? 3 : cloud > 45 ? 2 : cloud > 15 ? 1 : 0;

  return Object.freeze({
    temperature: TYPICAL.temperature,
    humidity: TYPICAL.humidity,
    precipitation: rain,
    rain,
    showers: 0,
    cloud,
    windSpeed,
    windFrom,
    windGust: windSpeed,
    visibility: Math.max(MIN_VISIBILITY_M, finite(now.visibilityM, TYPICAL.visibility)),
    code,
  });
}

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

/** How often to ask for fresh readings: twelve minutes. v0's number. */
export const REFRESH_MS = 12 * 60 * 1000;

/** How long a reading may stand in for a live one: three hours. v0's number. */
export const CACHE_GOOD_MS = 3 * 60 * 60 * 1000;

/** How long to wait after a failure before trying again: ninety seconds. v0's number. */
export const RETRY_MS = 90 * 1000;

/**
 * What the cache holds: when the readings were taken, and the readings
 * BY STATION ID. The station list can change between builds, so a
 * reader matches by id rather than by position — or a re-ordered grid
 * silently hands Polihale's sunshine to the Alakaʻi swamp.
 */
export interface CachedReadings {
  /** Unix milliseconds. */
  readonly takenMs: number;
  readonly ids: readonly string[];
  readonly conditions: readonly Conditions[];
}

/**
 * Somewhere to keep the last readings between sessions. Implemented
 * outside core, over storage; core never learns what kind. Either call
 * may throw — a full or private store — and is treated as "no cache".
 */
export interface WeatherCache {
  read(): CachedReadings | null;
  write(value: CachedReadings): void;
}

export interface LiveWeatherOptions {
  /** Who answers for the island. `null` is a build with no online weather: the chain is cache → simulated. */
  readonly provider: WeatherProvider | null;
  /** Unix milliseconds. Core owns no clock; this is the one it is lent. */
  readonly clock: () => number;
  readonly cache: WeatherCache | null;
  /** The seeded model the chain falls back to, and the thing `force` holds open. */
  readonly fallback: SkyModel;
  /** Defaults to the island's twenty-two. */
  readonly stations?: readonly Station[];
}

/** A field in force, the kind of reading it is, and when it was taken. */
interface Held {
  readonly field: WeatherField;
  readonly kind: 'live' | 'cached';
  readonly takenMs: number;
}

const NUMERIC_FIELDS: ReadonlyArray<keyof Conditions> = [
  'temperature', 'humidity', 'precipitation', 'rain', 'showers',
  'cloud', 'windSpeed', 'windFrom', 'windGust', 'visibility', 'code',
];

/**
 * A reply or a cache entry is untrusted input. Every field is made a
 * finite number or `TYPICAL`'s, so the worst a bad one can do is make
 * the weather boring.
 */
function coerce(raw: unknown): Conditions {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of NUMERIC_FIELDS) {
    const value = source[key];
    out[key] = typeof value === 'number' && Number.isFinite(value) ? value : TYPICAL[key];
  }
  return Object.freeze(out as unknown as Conditions);
}

export class LiveWeather implements WeatherSource {
  private readonly provider: WeatherProvider | null;
  private readonly clock: () => number;
  private readonly cache: WeatherCache | null;
  private readonly fallback: SkyModel;
  private readonly stations: readonly Station[];
  private readonly points: readonly GeoPoint[];

  private readonly blend = new WeatherBlend();
  private held: Held | null = null;
  /** Whether the last `sample` read the field — so the next can tell when it starts to. */
  private inField = false;
  private nextTryMs = 0;
  private inFlight: Promise<void> | null = null;
  private last: WeatherNow = FAIR;

  constructor(options: LiveWeatherOptions) {
    this.provider = options.provider;
    this.clock = options.clock;
    this.cache = options.cache;
    this.fallback = options.fallback;
    this.stations = options.stations ?? STATIONS;
    this.points = this.stations.map((s) => s.where);

    // There is a field before anything has been asked for, if the last
    // session left one. This never waits and never throws: a cache that
    // cannot be read costs a cold start, nothing more.
    this.held = this.readCache();
  }

  /** What a `sample` would say it came from, this instant. */
  get source(): WeatherSourceKind {
    if (this.fallback.forcedSky !== null) return 'simulated';
    return this.usable()?.kind ?? 'simulated';
  }

  /** The sky being held open, if one is. */
  get forcedSky(): Sky | null {
    return this.fallback.forcedSky;
  }

  /**
   * Whether the owner should call `refresh()` now.
   *
   * True on the first frame, then every `REFRESH_MS` after an attempt was
   * started, or `RETRY_MS` after one failed; never while one is in
   * flight, and never at all without a provider.
   */
  dueForRefresh(): boolean {
    return this.provider !== null && this.inFlight === null && this.clock() >= this.nextTryMs;
  }

  /**
   * Ask the provider for every station. NEVER THROWS and never rejects:
   * a failure is recorded, the chain stays where it is, and the next
   * attempt is `RETRY_MS` away. A success replaces the field in force and
   * writes the cache. Calling it while a request is in flight returns
   * that request.
   */
  refresh(): Promise<void> {
    const provider = this.provider;
    if (provider === null) return Promise.resolve();
    if (this.inFlight !== null) return this.inFlight;

    // The next attempt is scheduled BEFORE the request, so a promise
    // that never settles cannot wedge the refresh loop shut.
    this.nextTryMs = this.clock() + REFRESH_MS;

    this.inFlight = Promise.resolve()
      // A provider that throws synchronously becomes a rejection here.
      .then(() => provider.sample(this.points))
      .then((readings) => this.landed(readings), () => this.failed())
      // `landed` cannot throw, but the chain is what "never rejects" rests on.
      .catch(() => this.failed())
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  /**
   * One frame of SIMULATED seconds: the blend chases its target and the
   * fallback model keeps its own schedule. Zero freezes both. The clock
   * is not consulted here; `dueForRefresh` does that.
   */
  tick(dt: number): void {
    this.fallback.advance(dt);
    this.blend.advance(dt);
  }

  /**
   * The weather at a WORLD position: the field there, eased, while a
   * reading young enough exists; the fallback model otherwise; the
   * fallback's forced reading while a sky is held open. Remembered, so
   * `now()` can answer for the last place asked about.
   */
  sample(at: WorldPoint): WeatherNow {
    let reading: WeatherNow;
    if (this.fallback.forcedSky !== null) {
      reading = this.fallback.now();
    } else {
      const held = this.usable();
      if (held === null) {
        this.inField = false;
        reading = this.fallback.now();
      } else {
        const target = held.field.at(at);
        if (!this.inField) {
          // The island's weather FADES IN from the sky that was showing,
          // rather than replacing it between two frames — see `conditionsOf`.
          this.blend.set(conditionsOf(this.fallback.now()));
          this.inField = true;
        }
        this.blend.aim(target);
        reading = toWeatherNow(this.blend.current ?? target, held.kind);
      }
    }
    this.last = reading;
    return reading;
  }

  /**
   * The `WeatherSource` door: the last `sample`d reading, `FAIR` before
   * any — or, while a sky is held open, the fallback's forced reading as
   * it ramps, so a probe polling this sees the sky it asked for arrive.
   */
  now(): WeatherNow {
    if (this.fallback.forcedSky !== null) return this.fallback.now();
    return this.last;
  }

  /**
   * Hold the sky at one state, or hand it back — a pass-through to the
   * fallback model, which is how a probe holds a sky open whatever the
   * island is doing. Readings keep refreshing underneath, so `release`
   * returns to the island's weather, not to the model's. Returns whether
   * the sky was accepted; an unbuilt sky is refused, as the model does.
   */
  force(sky: Sky | null): boolean {
    return this.fallback.force(sky);
  }

  /** Let the island's weather be its own again. */
  release(): void {
    this.fallback.release();
  }

  // -------------------------------------------------------------------------

  /** The field in force, if its readings are still young enough to describe the sky. */
  private usable(): Held | null {
    const held = this.held;
    if (held === null) return null;
    const age = this.clock() - held.takenMs;
    return age <= CACHE_GOOD_MS ? held : null;
  }

  private landed(readings: readonly Conditions[]): void {
    const n = Array.isArray(readings) ? Math.min(readings.length, this.stations.length) : 0;
    if (n === 0) {
      this.failed();
      return;
    }
    const takenMs = this.clock();
    const stations = this.stations.slice(0, n);
    const conditions = readings.slice(0, n).map(coerce);
    this.held = { field: WeatherField.of(stations, conditions), kind: 'live', takenMs };
    this.writeCache({ takenMs, ids: stations.map((s) => s.id), conditions });
  }

  private failed(): void {
    // Keep whatever is already in force. If that is still the model, it
    // stays, and the reading's `source` says so.
    this.nextTryMs = this.clock() + RETRY_MS;
  }

  private readCache(): Held | null {
    if (this.cache === null) return null;
    let cached: CachedReadings | null = null;
    try {
      cached = this.cache.read();
    } catch {
      return null;
    }
    if (typeof cached !== 'object' || cached === null) return null;
    if (!Number.isFinite(cached.takenMs)) return null;
    if (!Array.isArray(cached.ids) || !Array.isArray(cached.conditions)) return null;

    const byId = new Map<string, Conditions>();
    for (let i = 0; i < cached.ids.length && i < cached.conditions.length; i += 1) {
      const raw: unknown = cached.conditions[i];
      if (typeof raw === 'object' && raw !== null) byId.set(String(cached.ids[i]), coerce(raw));
    }

    const stations: Station[] = [];
    const conditions: Conditions[] = [];
    for (const station of this.stations) {
      const c = byId.get(station.id);
      if (c === undefined) continue;
      stations.push(station);
      conditions.push(c);
    }
    if (stations.length === 0) return null;
    return { field: WeatherField.of(stations, conditions), kind: 'cached', takenMs: cached.takenMs };
  }

  private writeCache(value: CachedReadings): void {
    if (this.cache === null) return;
    try {
      this.cache.write(value);
    } catch {
      // A full or blocked store costs a cold start next session, nothing more.
    }
  }
}
