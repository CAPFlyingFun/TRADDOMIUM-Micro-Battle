import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMIT, VERSION } from '../src/build';
import {
  autoUpdate, isNewer, liveBuild, outOfDate, takeUpdate, updateLabel, type Live,
} from '../src/ui/updates';

/** What the server says it is serving. */
const served = (over: Partial<Live> = {}): Live => ({
  version: '9.9.9', commit: 'feedbee', built: '2026-08-23T01:00:00.000Z', ...over,
});

let replaced: string[] = [];
let store: Record<string, string> = {};

beforeEach(() => {
  replaced = [];
  store = {};
  vi.stubGlobal('document', { baseURI: 'https://example.test/game/' });
  vi.stubGlobal('window', {
    location: {
      href: 'https://example.test/game/',
      replace: (to: string) => replaced.push(to),
    },
  });
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
  });
  vi.stubGlobal('navigator', {});
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** A fetch that answers with `body`, or fails. */
function answering(body: unknown, ok = true) {
  const seen: string[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    seen.push(`${url}|${init?.cache}`);
    if (!ok) return Promise.reject(new Error('offline'));
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
  return seen;
}

describe('asking the server what it is serving', () => {
  it('asks for version.json beside the app, uncached, and cache-busted', () => {
    // Both, on purpose: the header is what a well-behaved cache
    // honours and the query is what gets past one that does not.
    const seen = answering(served());
    return liveBuild().then(() => {
      expect(seen).toHaveLength(1);
      expect(seen[0]).toContain('https://example.test/game/version.json?t=');
      expect(seen[0]).toContain('|no-store');
    });
  });

  it('reads back what the build stamp writes', async () => {
    answering(served());
    expect(await liveBuild()).toEqual(served());
  });

  it('says "cannot tell" rather than "up to date" when it cannot reach it', async () => {
    // The distinction the whole thing turns on. An offline check that
    // reported success would be a check that never finds an update.
    answering(null, false);
    expect(await liveBuild()).toBeNull();
  });

  it('refuses a reply that is not a version stamp', async () => {
    // A Pages 404 page, a captive-portal login, a half-written deploy.
    answering({ hello: 'there' });
    expect(await liveBuild()).toBeNull();
    answering('<!doctype html>');
    expect(await liveBuild()).toBeNull();
  });
});

describe('deciding whether it is newer', () => {
  it('compares the COMMIT, because that is what a build actually is', () => {
    expect(isNewer(served({ commit: 'feedbee' }))).toBe(true);
    expect(isNewer(served({ commit: COMMIT }))).toBe(false);
    // Same version, different commit, is still a different build — and
    // the version is not bumped for every change.
    expect(isNewer(served({ version: VERSION, commit: 'other' }))).toBe(true);
  });

  it('never calls a dev build out of date', () => {
    // A developer whose page reloaded itself mid-edit would rightly
    // file that as a bug. Tested through the pure form, because vitest
    // applies Vite's `define` and COMMIT is a real commit even here.
    expect(outOfDate('dev', served())).toBe(false);
    expect(outOfDate('aaaaaaa', served({ commit: 'aaaaaaa' }))).toBe(false);
    expect(outOfDate('aaaaaaa', served({ commit: 'bbbbbbb' }))).toBe(true);
  });

  it('shows the version, since that is what a person reads', () => {
    expect(updateLabel(served({ version: '1.2.3' }))).toBe('v1.2.3 available');
    expect(updateLabel(served({ version: VERSION, commit: 'abc1234' })))
      .toBe('New build abc1234');
  });
});

describe('taking the update', () => {
  it('reloads to a URL nothing has ever requested', async () => {
    // A plain reload can re-fetch the same cached index.html and re-run
    // the same stale bundle. Vite hashes every other asset, so a fresh
    // document is the whole fix — and a new query string is how you get
    // one past a cache that is holding the old one.
    await takeUpdate(served({ commit: 'abc1234' }));
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toBe('https://example.test/game/?build=abc1234');
  });

  it('survives a browser with no cache or worker APIs at all', async () => {
    await expect(takeUpdate(served())).resolves.toBeUndefined();
    expect(replaced).toHaveLength(1);
  });

  it('clears caches and unregisters workers before it goes', async () => {
    // Belt and braces against a service worker being added later and
    // silently turning this button into a no-op.
    const dropped: string[] = [];
    let unregistered = 0;
    vi.stubGlobal('window', {
      location: { href: 'https://example.test/game/', replace: (to: string) => replaced.push(to) },
      caches: {},
    });
    vi.stubGlobal('caches', {
      keys: () => Promise.resolve(['old-a', 'old-b']),
      delete: (k: string) => { dropped.push(k); return Promise.resolve(true); },
    });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistrations: () => Promise.resolve([
          { unregister: () => { unregistered++; return Promise.resolve(true); } },
        ]),
      },
    });
    await takeUpdate(served());
    expect(dropped).toEqual(['old-a', 'old-b']);
    expect(unregistered).toBe(1);
    expect(replaced).toHaveLength(1);
  });
});

describe('the automatic check, and the loop it must not enter', () => {
  it('does nothing when the server has the same build', async () => {
    answering(served({ commit: COMMIT }));
    expect(await autoUpdate()).toBeNull();
    expect(replaced).toHaveLength(0);
  });

  it('does nothing when it cannot reach the server', async () => {
    answering(null, false);
    expect(await autoUpdate()).toBeNull();
    expect(replaced).toHaveLength(0);
  });

  it('RELOADS ONCE PER BUILD AND NO MORE', async () => {
    // The failure mode that would make the game unplayable rather than
    // merely stale: a reload that comes back running the same old
    // bundle would find the same newer version and reload again,
    // forever. One attempt, then the button takes over.
    answering(served({ commit: 'feedbee' }));

    // Pretend the first attempt already happened this session.
    store['tmb:update-tried'] = 'feedbee';
    expect(await autoUpdate()).toBeNull();
    expect(replaced).toHaveLength(0);

    // A DIFFERENT newer build is still worth one attempt.
    answering(served({ commit: 'cafe123' }));
    expect(await autoUpdate()).not.toBeNull();
    expect(replaced).toHaveLength(1);
  });

  it('does not auto-update when storage will not hold the guard', async () => {
    // Private browsing. Without somewhere to remember the attempt there
    // is no way to stop the loop, so the safe answer is not to start.
    answering(served({ commit: 'feedbee' }));
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    expect(await autoUpdate()).toBeNull();
    expect(replaced).toHaveLength(0);
  });
});
