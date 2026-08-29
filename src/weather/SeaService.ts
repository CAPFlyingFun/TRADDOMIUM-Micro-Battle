/**
 * WHAT THE SEA IS TODAY — live, cached, or the fallback, in that order.
 *
 * Built to the shape WeatherService already established, because the
 * problem is the same one: a slow remote fact that must never be able
 * to block a boot, break a frame, or leave the world empty when the
 * network is not there.
 *
 *   FRESH LIVE OBSERVATION
 *     falls back to CACHED OBSERVATION (a sea state is a slow thing;
 *     six hours either side of a reading the swell is recognisably
 *     the same — SEA_CACHE_GOOD_MS)
 *       falls back to TYPICAL_SEA, which is a real 51208 reading and
 *       not an invented one
 *
 * NOTHING BECOMES ZERO. A refused request, a partial record, an MM
 * where an instrument had nothing to say, a malformed document — every
 * one of them keeps the last valid state. A sea of no height is the
 * one outcome this must never produce, because it is indistinguishable
 * from "the ocean is broken" and the player cannot tell which.
 *
 * THE CACHE IS READ IN THE CONSTRUCTOR, so the first frame already has
 * yesterday's sea rather than a flat calm that gets replaced a second
 * later. The network is asked afterwards and lands whenever it lands.
 */
import { NdbcFeed, NDBC_WAVE_STATION, type SeaProvider } from './ndbcFeed';
import {
  SEA_CACHE_GOOD_MS, SEA_REFRESH_MS, type SeaObservation, type SeaSource,
} from './seaState';

const STORE = 'tmb.sea.v1';
/** After a failure, wait this long before troubling NDBC again. */
export const SEA_RETRY_MS = 5 * 60 * 1000;

interface Cached {
  readonly observation: SeaObservation;
  readonly fetchedAt: number | null;
  readonly station: string;
  readonly ttlMinutes?: number;
}

export interface SeaServiceOptions {
  readonly live?: SeaProvider;
  readonly clock?: () => number;
  readonly store?: Pick<Storage, 'getItem' | 'setItem'> | null;
  readonly station?: string;
}

/** What the telemetry line needs, and what a probe reports. */
export interface SeaFeedState {
  readonly source: SeaSource;
  readonly station: string;
  readonly observation: SeaObservation | null;
  /** Milliseconds since the OBSERVATION, not since the fetch. */
  readonly ageMs: number | null;
  readonly fetchedAt: number | null;
  /** The last thing that went wrong, if anything has. */
  readonly failure: string | null;
  readonly asking: boolean;
}

export class SeaService {
  private readonly live: SeaProvider;
  private readonly clock: () => number;
  private readonly store: Pick<Storage, 'getItem' | 'setItem'> | null;
  private readonly station: string;

  private held: SeaObservation | null = null;
  private heldSource: SeaSource = 'fallback';
  private fetchedAt: number | null = null;
  private ttlMs = SEA_REFRESH_MS;
  private failure: string | null = null;
  private nextTry = 0;
  private asking = false;
  /** Bumped whenever a DIFFERENT observation takes hold. */
  private stamp = 0;

  constructor(options: SeaServiceOptions = {}) {
    this.live = options.live ?? new NdbcFeed();
    this.clock = options.clock ?? (() => Date.now());
    this.store = options.store === undefined ? safeStore() : options.store;
    this.station = options.station ?? NDBC_WAVE_STATION;
    this.restore();
  }

  /** The observation in force, or null when nothing valid is known. */
  get observation(): SeaObservation | null {
    return this.held;
  }

  /**
   * Which of the three it is, decided fresh each time rather than
   * remembered: an observation that was live when it landed becomes
   * cached by sitting still, and eventually stops speaking for the sea
   * at all.
   */
  get source(): SeaSource {
    if (!this.held) return 'fallback';
    const age = this.clock() - this.held.observedAt;
    if (age < 0) return 'live';                    // clock skew
    if (age <= SEA_REFRESH_MS * 2) return this.heldSource === 'live' ? 'live' : 'cached';
    if (age <= SEA_CACHE_GOOD_MS) return 'cached';
    return 'fallback';
  }

  /** Changes when a new observation takes hold — the blend's trigger. */
  get version(): number {
    return this.stamp;
  }

  get state(): SeaFeedState {
    const now = this.clock();
    return {
      source: this.source,
      station: this.station,
      observation: this.held,
      ageMs: this.held ? now - this.held.observedAt : null,
      fetchedAt: this.fetchedAt,
      failure: this.failure,
      asking: this.asking,
    };
  }

  /**
   * Ask NDBC if it is time to. Returns at once; the answer lands when
   * it lands, and a failure changes nothing but the retry clock.
   */
  poll(): void {
    if (this.asking) return;
    const now = this.clock();
    if (now < this.nextTry) return;
    this.asking = true;
    // Scheduled BEFORE the request, so a promise that never settles
    // cannot wedge the loop shut.
    this.nextTry = now + this.ttlMs;
    this.live.fetch(this.station)
      .then((reply) => {
        if (reply.ttlMinutes) {
          // The feed's own hint, honoured. 51208 advertises 30
          // minutes, which is also what the buoy actually reports at.
          this.ttlMs = reply.ttlMinutes * 60_000;
          this.nextTry = this.clock() + this.ttlMs;
        }
        if (!reply.observation) {
          // Partial, MM, malformed, or a met station in the wave slot.
          // Whatever it was, it is not a sea, and the last valid one
          // stands.
          this.failure = reply.failure ?? 'no observation';
          this.nextTry = this.clock() + SEA_RETRY_MS;
          return;
        }
        this.accept(reply.observation, 'live');
        this.failure = null;
      })
      .catch((err: unknown) => {
        this.failure = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        this.nextTry = this.clock() + SEA_RETRY_MS;
      })
      .finally(() => { this.asking = false; });
  }

  /** Take an observation from anywhere — tests, and a replayed fixture. */
  accept(observation: SeaObservation, source: SeaSource = 'live'): void {
    // A REPEAT IS NOT NEWS. NDBC republishes the same reading for the
    // whole half hour between buoy transmissions, and starting a
    // generation blend for a document that says exactly what the last
    // one said would keep the ocean permanently in transition.
    if (this.held && this.held.observedAt === observation.observedAt
      && this.held.station === observation.station) {
      this.fetchedAt = this.clock();
      return;
    }
    // NOR IS A STALE ONE. A feed that goes backwards — a cache in
    // front of NDBC, a replayed document — must not drag the sea back.
    if (this.held && observation.observedAt < this.held.observedAt) return;
    this.held = observation;
    this.heldSource = source;
    this.fetchedAt = this.clock();
    this.stamp += 1;
    this.save();
  }

  private restore(): void {
    if (!this.store) return;
    try {
      const raw = this.store.getItem(STORE);
      if (!raw) return;
      const body = JSON.parse(raw) as Partial<Cached>;
      const held = body.observation;
      if (!held || typeof held.observedAt !== 'number'
        || typeof held.significantWaveHeightM !== 'number'
        || typeof held.dominantPeriodS !== 'number'
        || typeof held.averagePeriodS !== 'number'
        || typeof held.meanFromDeg !== 'number') return;
      // Too old to speak for the sea at all: the fallback is a better
      // answer than a reading from last week.
      if (this.clock() - held.observedAt > SEA_CACHE_GOOD_MS) return;
      this.held = held;
      this.heldSource = 'cached';
      this.fetchedAt = typeof body.fetchedAt === 'number' ? body.fetchedAt : null;
      if (body.ttlMinutes) this.ttlMs = body.ttlMinutes * 60_000;
      this.stamp += 1;
    } catch {
      // A corrupt entry costs a cold start and nothing more.
    }
  }

  private save(): void {
    if (!this.store || !this.held) return;
    try {
      this.store.setItem(STORE, JSON.stringify({
        observation: this.held,
        fetchedAt: this.fetchedAt,
        station: this.station,
        ttlMinutes: Math.round(this.ttlMs / 60_000),
      } satisfies Cached));
    } catch {
      // A full or blocked store costs a cold start, nothing more.
    }
  }
}

function safeStore(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;                       // Private windows, blocked storage.
  }
}

let shared: SeaService | null = null;

/** The game's sea feed. One per session, made on first ask. */
export function seaFeed(): SeaService {
  if (!shared) shared = new SeaService();
  return shared;
}

/** Tests only — forget the shared instance. */
export function resetSeaFeed(): void {
  shared = null;
}
