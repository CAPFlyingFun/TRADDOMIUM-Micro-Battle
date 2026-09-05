/**
 * THE BUOY, FORWARDED — `GET /sea/<station>`.
 *
 * WHY THE RELAY SERVES THE SEA AT ALL. NDBC publishes the Hanalei
 * waverider with no key and no `Access-Control-Allow-Origin`, so a
 * browser is refused — and from inside a page a CORS refusal and a dead
 * network are the same `TypeError`, which is why v0 could never
 * establish which one it had. It left the seam open instead and said so
 * (`ndbcFeed.ts`, `NdbcFeedOptions.base`: "PROXY-READY, NOT PROXIED — if
 * the browser turns out to be refused by CORS the answer is a small
 * worker at a base of our own"). This is that worker. It already exists,
 * `npm run relay:deploy` already deploys it, and NDBC needs no
 * credentials, so the route costs one handler and no secrets.
 *
 * IT FORWARDS THE DOCUMENT UNPARSED, on the same rule that keeps every
 * game rule in `src/net/Host.ts` rather than in `worker/`: turning a
 * feed into wave heights is a rule, and rules live in `src/` where the
 * browser shares them unchanged and a node test can run them without a
 * network. This file owns a fetch, a timeout and a cache hint. Nothing
 * else.
 *
 * WHY IT IS A FILE OF ITS OWN and not ten lines in the router. It is the
 * one part of `worker/` that is portable — plain `Request`, `Response`
 * and `fetch`, no Durable Object, no `WebSocketPair` — so it can be
 * imported and exercised by `tests/relaySeaRoute.test.ts` under the
 * APP's tsconfig, which has no Workers globals. `index.ts` cannot be:
 * it names `DurableObjectNamespace`, and dragging that into the app
 * project would mean giving the app the Workers lib, which is exactly
 * the separation CLAUDE.md keeps (`relay:typecheck` is not the same
 * check as `typecheck`, on purpose). The router's own wiring is covered
 * where it can be: `npm run probe:relay`, against real workerd.
 */
import {
  STATION_ALPHABET, STATION_MAX_LENGTH, STATION_MIN_LENGTH, normaliseStation,
} from './seaStation';

export const SEA_PREFIX = '/sea/';

/**
 * Where the buoy lives. The station id is pasted between this and the
 * suffix, and `normaliseStation` has already guaranteed it is letters
 * and digits — so there is nothing in it that could reach a different
 * path.
 */
export const NDBC_BASE = 'https://www.ndbc.noaa.gov/data/latest_obs';
export const NDBC_SUFFIX = '.rss';

/**
 * How long the edge may serve the same observation, seconds.
 *
 * The feed advertises `<ttl>30</ttl>` and NDBC's observations land about
 * hourly, so ten minutes is fresher than the data and stops a room full
 * of phones from hammering NOAA: every client on the planet asking this
 * relay costs NDBC six requests an hour, not six a second.
 */
export const SEA_CACHE_SECONDS = 600;

/** A subrequest that never settles would hold the whole invocation. */
export const SEA_TIMEOUT_MS = 10_000;

const TEXT = { 'Content-Type': 'text/plain; charset=utf-8' } as const;

/**
 * CORS ON THE FAILURES TOO. A 502 a browser cannot read is invisible to
 * the page that needs to log it, and the telemetry line would say
 * "TypeError" all over again — which is the exact ambiguity this route
 * exists to remove.
 */
const OPEN = { 'Access-Control-Allow-Origin': '*' } as const;
const NEVER_CACHE = { ...TEXT, ...OPEN, 'Cache-Control': 'no-store' } as const;

/** True when this request is for the sea route, whatever it turns out to say. */
export function isSeaRequest(pathname: string): boolean {
  return pathname.startsWith(SEA_PREFIX);
}

/** What the health check says about this route, from the constants that serve it. */
export function seaManifest(): Record<string, unknown> {
  return {
    path: `${SEA_PREFIX}<station>`,
    upstream: `${NDBC_BASE}/<station>${NDBC_SUFFIX}`,
    cacheSeconds: SEA_CACHE_SECONDS,
    alphabet: STATION_ALPHABET,
    minLength: STATION_MIN_LENGTH,
    maxLength: STATION_MAX_LENGTH,
  };
}

/**
 * Answer a request on the sea route.
 *
 * A FAILURE IS NEVER CACHED AND NEVER A 500. NDBC being down, slow, or
 * unhappy with a station id is an ordinary thing that a relay must
 * report as itself: the status and the reason travel back in plain text
 * so the device can tell "NOAA said 404" from "NOAA never answered".
 */
export async function serveSea(request: Request, pathname: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('the sea feed answers GET\n', { status: 405, headers: TEXT });
  }
  const station = normaliseStation(pathname.slice(SEA_PREFIX.length));
  if (station === null) {
    return new Response(
      `station id: ${STATION_MIN_LENGTH}-${STATION_MAX_LENGTH} characters of ${STATION_ALPHABET} (the Hanalei waverider is 51208)\n`,
      { status: 400, headers: { ...TEXT, ...OPEN } },
    );
  }

  const upstream = `${NDBC_BASE}/${station}${NDBC_SUFFIX}`;
  let reply: Response;
  try {
    reply = await fetch(upstream, {
      signal: AbortSignal.timeout(SEA_TIMEOUT_MS),
      // Cloudflare's own cache, in front of NOAA rather than in front of
      // this Worker: one origin fetch serves every client for the ttl.
      //
      // THE CAST IS THE PRICE OF BEING TESTED. `cf` is a Workers
      // extension to RequestInit, and this file is compiled by TWO
      // tsconfigs — the relay's, where `cf` exists, and the app's, where
      // it does not. Casting here is narrower than loosening either
      // project's lib, and the property is inert anywhere but Cloudflare.
      cf: { cacheTtl: SEA_CACHE_SECONDS, cacheEverything: true },
    } as RequestInit);
  } catch (err) {
    const why = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return new Response(`the buoy did not answer: ${why}\n`, { status: 504, headers: NEVER_CACHE });
  }

  if (!reply.ok) {
    return new Response(`the buoy answered HTTP ${reply.status} for station ${station}\n`, {
      status: 502,
      headers: NEVER_CACHE,
    });
  }

  const body = await reply.text();
  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      ...OPEN,
      'Cache-Control': `public, max-age=${SEA_CACHE_SECONDS}`,
    },
  });
}
