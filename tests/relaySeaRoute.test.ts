/**
 * THE BUOY, THROUGH OUR OWN RELAY.
 *
 * NDBC serves the Hanalei waverider with no key and no
 * `Access-Control-Allow-Origin`, so a browser cannot read it — and from
 * inside a page a CORS refusal and a dead network are the same
 * TypeError, which is why v0 could never establish which one it had. v0
 * left the seam open instead and said so in `ndbcFeed.ts`:
 * "PROXY-READY, NOT PROXIED — if the browser turns out to be refused by
 * CORS the answer is a small worker at a base of our own". This is that
 * worker's route.
 *
 * TWO HALVES, PINNED TOGETHER, exactly as `relayConfig.test.ts` pins the
 * room code: the relay's rule for a station id (`worker/src/
 * seaStation.ts`) and the client's (`src/net/relayConfig.ts`) are
 * imported side by side and asked the same questions, so the game cannot
 * build a URL the relay will refuse.
 *
 * THE HANDLER IS TESTED WITHOUT A NETWORK, by handing `serveSea` a
 * Request and a stub `fetch`. That covers the parts that are ours —
 * validation, the upstream URL, headers, cache policy, what a failure
 * looks like — and deliberately does not cover NOAA being up, which is
 * not a thing a test should assert.
 *
 * IT IMPORTS `seaRoute.ts` AND NOT `index.ts`, and that is a constraint
 * rather than a preference: the router names `DurableObjectNamespace`
 * and `WebSocketPair`, which exist under the RELAY's tsconfig and not
 * under the app's. Giving the app project the Workers lib to reach them
 * would dissolve the separation `relay:typecheck` exists to keep
 * (CLAUDE.md: "npm run typecheck is NOT the whole typecheck"). The
 * router's own wiring — that `/sea/` reaches this handler at all, and
 * that the health check advertises it — is covered against real workerd
 * by `npm run probe:relay`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NDBC_BASE, NDBC_SUFFIX, SEA_CACHE_SECONDS, SEA_PREFIX,
  isSeaRequest, seaManifest, serveSea,
} from '../worker/src/seaRoute';
import {
  STATION_MAX_LENGTH, STATION_MIN_LENGTH, normaliseStation,
} from '../worker/src/seaStation';
import {
  NDBC_WAVE_STATION, SEA_PATH_PREFIX, SEA_STATION_MAX_LENGTH, SEA_STATION_MIN_LENGTH,
  isSeaStation, toSeaFeedUrl,
} from '../src/net/relayConfig';

/**
 * Ask the handler, the way the router does: the pathname the URL parser
 * produced, and the Request itself.
 */
const call = (path: string, init?: RequestInit): Promise<Response> => {
  const request = new Request(`https://relay.example${path}`, init);
  return serveSea(request, new URL(request.url).pathname);
};

const RSS = '<rss><channel><ttl>30</ttl><item><description>Waves</description></item></channel></rss>';

/** Stand in for NOAA. Records what it was asked, and how. */
interface Ask { readonly url: string; readonly init: Record<string, unknown> }
function stubUpstream(reply: () => Promise<Response> | Response): { asks: Ask[] } {
  const asks: Ask[] = [];
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    asks.push({ url: String(input), init: (init ?? {}) as unknown as Record<string, unknown> });
    return Promise.resolve(reply());
  });
  return { asks };
}
const urlsOf = (upstream: { asks: Ask[] }): string[] => upstream.asks.map((a) => a.url);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what a station id is, on both sides of the wire', () => {
  it('agrees with the client on the bounds', () => {
    expect(STATION_MIN_LENGTH).toBe(SEA_STATION_MIN_LENGTH);
    expect(STATION_MAX_LENGTH).toBe(SEA_STATION_MAX_LENGTH);
  });

  it('agrees with the client on every verdict', () => {
    const cases = [
      '51208', 'NWWH1', 'nwwh1', '51208 ', ' 51208', '5120', '512', '512080000',
      '51-208', '51.208', '51/208', '../health', '%2e%2e%2fhealth', '', 'abcd',
      'ABCDEFGH', 'ABCDEFGHI', 'a b c', '51208.rss',
    ];
    for (const raw of cases) {
      const relay = normaliseStation(raw);
      const client = isSeaStation(raw.trim().toLowerCase());
      expect(relay !== null, `relay vs client on ${JSON.stringify(raw)}`).toBe(client);
    }
  });

  it('never throws on malformed percent-encoding', () => {
    // `decodeURIComponent('%')` is a URIError, and an unhandled one here
    // would reach the client as a 500 for what is plainly a bad request.
    for (const raw of ['%', '%zz', '%E0%A4%A', '%%%']) {
      expect(() => normaliseStation(raw)).not.toThrow();
      expect(normaliseStation(raw)).toBeNull();
    }
  });

  it('admits nothing that could reach a different path', () => {
    // The route pastes the id between a fixed base and a fixed suffix,
    // so the only defence that matters is that no separator survives.
    for (const raw of ['../room/abc', 'a/../b', 'a.b', 'a%2Fb', 'a?b', 'a#b', 'a:b']) {
      expect(normaliseStation(raw), raw).toBeNull();
    }
  });
});

describe('the client builds a URL the relay will accept', () => {
  it('points at the relay’s sea route, defaulting to the Hanalei waverider', () => {
    expect(toSeaFeedUrl('https://relay.example')).toBe(`https://relay.example${SEA_PATH_PREFIX}51208`);
    expect(NDBC_WAVE_STATION).toBe('51208');
  });

  it('asks over http even when the relay is written as a socket address', () => {
    // The feed is a document, not a socket. `?relay=ws://127.0.0.1:8787`
    // is how a developer points at a local relay, and the buoy still has
    // to be fetched from it.
    expect(toSeaFeedUrl('wss://relay.example')).toBe('https://relay.example/sea/51208');
    expect(toSeaFeedUrl('ws://127.0.0.1:8787')).toBe('http://127.0.0.1:8787/sea/51208');
  });

  it('absorbs a trailing slash, because half of pasted addresses have one', () => {
    expect(toSeaFeedUrl('https://relay.example/')).toBe('https://relay.example/sea/51208');
    expect(toSeaFeedUrl('https://relay.example///')).toBe('https://relay.example/sea/51208');
  });

  it('throws with the bad value in the message rather than fetching the wrong place', () => {
    expect(() => toSeaFeedUrl('not a url')).toThrow(/"not a url"/);
    expect(() => toSeaFeedUrl('https://relay.example', '../health')).toThrow(/"\.\.\/health"/);
    expect(() => toSeaFeedUrl('ftp://relay.example')).toThrow(/https:\/\//);
  });
});

describe('the route', () => {
  it('forwards the buoy with a CORS header a page can read', async () => {
    const upstream = stubUpstream(() => new Response(RSS, { status: 200 }));
    const reply = await call('/sea/51208');
    expect(reply.status).toBe(200);
    expect(await reply.text()).toBe(RSS);
    expect(reply.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(reply.headers.get('Content-Type')).toMatch(/rss\+xml/);
    // The one thing this route exists for: the document arrives at NDBC
    // as NDBC's own path, unmodified.
    expect(urlsOf(upstream)).toEqual(['https://www.ndbc.noaa.gov/data/latest_obs/51208.rss']);
  });

  it('lower-cases the station, so a shouted id reaches the same buoy', async () => {
    const upstream = stubUpstream(() => new Response(RSS, { status: 200 }));
    await call('/sea/NWWH1');
    expect(urlsOf(upstream)).toEqual(['https://www.ndbc.noaa.gov/data/latest_obs/nwwh1.rss']);
  });

  it('asks the edge to hold the answer, so a room of phones is one request to NOAA', async () => {
    const upstream = stubUpstream(() => new Response(RSS, { status: 200 }));
    const reply = await call('/sea/51208');
    // Two halves, and only the second is visible from a browser: the
    // response tells the CLIENT how long it may reuse this, and the `cf`
    // hint tells CLOUDFLARE to serve one origin fetch to everybody for
    // the same window. Without the second, every phone is a request to
    // NOAA no matter what the first says.
    expect(reply.headers.get('Cache-Control')).toBe(`public, max-age=${SEA_CACHE_SECONDS}`);
    expect(upstream.asks[0].init.cf).toEqual({ cacheTtl: SEA_CACHE_SECONDS, cacheEverything: true });
  });

  it('gives NOAA a deadline, so a hung subrequest cannot hold the invocation', async () => {
    const upstream = stubUpstream(() => new Response(RSS, { status: 200 }));
    await call('/sea/51208');
    expect(upstream.asks[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('answers HEAD with the headers and no body', async () => {
    stubUpstream(() => new Response(RSS, { status: 200 }));
    const reply = await call('/sea/51208', { method: 'HEAD' });
    expect(reply.status).toBe(200);
    expect(await reply.text()).toBe('');
    expect(reply.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('turns a bad station into a 400 that says what a station is', async () => {
    const upstream = stubUpstream(() => new Response(RSS, { status: 200 }));
    for (const path of ['/sea/', '/sea/abc', '/sea/51-208', '/sea/51208.rss', '/sea/a%20b%20c']) {
      const reply = await call(path);
      expect(reply.status, path).toBe(400);
      expect(await reply.text(), path).toMatch(/51208/);
    }
    // And nothing was asked of NOAA on the way to any of those.
    expect(urlsOf(upstream)).toEqual([]);
  });

  it('refuses an ENCODED traversal, which is the form that reaches the handler', async () => {
    // The bare `/sea/../health` never gets here: the URL parser resolves
    // it to `/health` before the router runs, and the health check
    // answers it. Worth pinning, because it looks like a hole and is
    // not — and because the percent-encoded form is NOT normalised, so
    // it does arrive, and `normaliseStation` is what stops it.
    expect(new URL('https://relay.example/sea/../health').pathname).toBe('/health');
    expect(isSeaRequest(new URL('https://relay.example/sea/../health').pathname)).toBe(false);

    const upstream = stubUpstream(() => new Response(RSS, { status: 200 }));
    for (const path of ['/sea/%2e%2e%2fhealth', '/sea/%2E%2E%2Froom%2Fabc', '/sea/%2f%2fevil.example%2fx']) {
      const reply = await call(path);
      expect(reply.status, path).toBe(400);
    }
    expect(urlsOf(upstream)).toEqual([]);
  });

  it('refuses a method it does not serve without reaching NOAA', async () => {
    const upstream = stubUpstream(() => new Response(RSS, { status: 200 }));
    const reply = await call('/sea/51208', { method: 'POST' });
    expect(reply.status).toBe(405);
    expect(urlsOf(upstream)).toEqual([]);
  });
});

describe('when the buoy is not there', () => {
  it('reports NOAA’s own status rather than falling over', async () => {
    stubUpstream(() => new Response('gone', { status: 404 }));
    const reply = await call('/sea/51208');
    // 502, not 500 and not 404: the relay is fine, the upstream is not,
    // and the device needs to be able to tell those apart.
    expect(reply.status).toBe(502);
    expect(await reply.text()).toMatch(/HTTP 404/);
    expect(reply.headers.get('Cache-Control')).toBe('no-store');
  });

  it('reports a refusal or a timeout as the reason it was', async () => {
    stubUpstream(() => Promise.reject(new DOMException('The operation was aborted', 'TimeoutError')));
    const reply = await call('/sea/51208');
    expect(reply.status).toBe(504);
    expect(await reply.text()).toMatch(/TimeoutError/);
    // A failure is never cached — the next ask must really ask.
    expect(reply.headers.get('Cache-Control')).toBe('no-store');
  });

  it('still lets a page read the failure, which is the whole point', async () => {
    // A 502 with no CORS header is invisible to the browser that needs
    // to log it, and the telemetry line would be "TypeError" again.
    stubUpstream(() => new Response('gone', { status: 503 }));
    const reply = await call('/sea/51208');
    expect(reply.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('what the health check will say about this route', () => {
  it('is built from the constants that serve it, so the manifest cannot drift', () => {
    // `index.ts` puts this object straight into /health. The router
    // itself is not importable here (see the header), but the thing it
    // publishes is — and it is generated, not hand-written, which is the
    // property worth pinning.
    const manifest = seaManifest();
    expect(manifest.path).toBe(`${SEA_PREFIX}<station>`);
    expect(manifest.upstream).toBe(`${NDBC_BASE}/<station>${NDBC_SUFFIX}`);
    expect(manifest.cacheSeconds).toBe(SEA_CACHE_SECONDS);
    expect(manifest.minLength).toBe(STATION_MIN_LENGTH);
    expect(manifest.maxLength).toBe(STATION_MAX_LENGTH);
  });

  it('claims the same prefix the client builds and the router matches', () => {
    // Three copies of "/sea/" would be three chances to move one.
    expect(SEA_PREFIX).toBe(SEA_PATH_PREFIX);
    expect(isSeaRequest(`${SEA_PREFIX}51208`)).toBe(true);
    expect(isSeaRequest('/room/red-ant-7')).toBe(false);
    expect(isSeaRequest('/health')).toBe(false);
  });
});
