/**
 * ASKING NDBC FOR THE SEA — the network half of the buoy.
 *
 * ndbc.ts turns a document into numbers and knows nothing about where
 * documents come from. This gets one, and is deliberately the only
 * place that does: one URL, one timeout, one place to put a proxy if
 * the browser turns out to need one.
 *
 * THE STATION IS 51208, Hanalei, and it is a Waverider. NWWH1 at
 * Nawiliwili is a water-level station that reports wind, pressure and
 * water temperature and NO WAVES — asking it for a sea state returns
 * null by design (ndbc.ts). It may be useful later for local wind; it
 * is not the wave source and must not be substituted for one.
 *
 * WHY THE FAILURE TEXT IS CARRIED BACK. A browser refused by CORS and
 * a browser with no network both reject with a TypeError, and neither
 * reaches any code that could tell them apart from the outside. The
 * only place the difference is visible is here, so the reason travels
 * with the result and ends up in the telemetry line — which is how the
 * DEVICE answers the CORS question rather than a guess doing it.
 */
import { parseSeaObservation } from './ndbc';
import type { SeaObservation } from './seaState';

/** The Waverider off Hanalei. The wave source, and the only one. */
export const NDBC_WAVE_STATION = '51208';

/**
 * NDBC's per-station RSS. Public, static, and served from the same
 * host as the station page a person would read.
 */
export function ndbcFeedUrl(station: string, base?: string): string {
  const root = (base ?? 'https://www.ndbc.noaa.gov/data/latest_obs')
    .replace(/\/+$/, '');
  return `${root}/${station.toLowerCase()}.rss`;
}

export interface SeaFetch {
  /** The observation, or null when the feed carried no usable waves. */
  readonly observation: SeaObservation | null;
  /** The feed's own `<ttl>`, minutes — 51208 advertises 30. */
  readonly ttlMinutes: number | null;
  /** Why nothing came back, verbatim. Absent on success. */
  readonly failure?: string;
}

export interface SeaProvider {
  fetch(station: string): Promise<SeaFetch>;
}

/** The feed's own refresh hint, minutes. Null when it does not say. */
export function parseTtlMinutes(xml: string): number | null {
  const hit = /<ttl>\s*(\d+)\s*<\/ttl>/i.exec(xml);
  if (!hit) return null;
  const minutes = Number(hit[1]);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

export interface NdbcFeedOptions {
  /**
   * Where to ask. Left unset this is NDBC itself; set, it is whatever
   * stands in front of NDBC. PROXY-READY, NOT PROXIED: if the browser
   * turns out to be refused by CORS the answer is a small worker at a
   * base of our own, and this is the seam it plugs into. Nothing here
   * invents one.
   */
  readonly base?: string;
  readonly timeoutMs?: number;
  readonly fetcher?: typeof fetch;
}

export class NdbcFeed implements SeaProvider {
  constructor(private readonly options: NdbcFeedOptions = {}) {}

  async fetch(station: string): Promise<SeaFetch> {
    const url = ndbcFeedUrl(station, this.options.base);
    const call = this.options.fetcher
      ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!call) return { observation: null, ttlMinutes: null, failure: 'no fetch' };
    const timeout = this.options.timeoutMs ?? 12_000;
    // A request that never settles must not wedge the refresh loop.
    const stop = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = stop ? setTimeout(() => stop.abort(), timeout) : null;
    try {
      const reply = await call(url, {
        ...(stop ? { signal: stop.signal } : {}),
        // Named rather than defaulted, because the whole open question
        // of this stage is whether a cross-origin GET is allowed.
        mode: 'cors',
      });
      if (!reply.ok) {
        return {
          observation: null, ttlMinutes: null,
          failure: `HTTP ${reply.status}`,
        };
      }
      const xml = await reply.text();
      const observation = parseSeaObservation(xml);
      return {
        observation,
        ttlMinutes: parseTtlMinutes(xml),
        // A 200 that parses to nothing is a real outcome and a
        // different one from a refused request: the station answered
        // and had no waves to report.
        ...(observation ? {} : { failure: 'no wave observation in feed' }),
      };
    } catch (err) {
      const why = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      return { observation: null, ttlMinutes: null, failure: why };
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
}
