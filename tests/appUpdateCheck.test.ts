/**
 * The update watch (`src/app/updateCheck.ts`): a home-screen app that is
 * never reloaded by its owner must reload ITSELF when the server has a
 * newer build — and must never loop while a deploy propagates, never
 * reload out from under a live game, and never mistake a broken stamp
 * for a new commit.
 *
 * Plain node: every browser fact is a parameter, so the fakes here are
 * the whole environment.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CHECK_GAP_MS, RECHECK_MS, UPDATE_PARAM, planUpdate, readStamp, stampUrl, tidyHref, watchForUpdates,
  type UpdateWatchDeps,
} from '../src/app/updateCheck';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGE = 'https://capflyingfun.github.io/TRADDOMIUM-Micro-Battle/v1/';

describe('readStamp', () => {
  it('accepts what vite.config.ts writes', () => {
    expect(readStamp({ version: '1.0.0-alpha.24', commit: 'abc1234', built: '2026-09-07T20:00:00Z' }))
      .toEqual({ commit: 'abc1234', version: '1.0.0-alpha.24' });
  });

  it('reads anything without a commit as no answer, never as a different commit', () => {
    expect(readStamp(null)).toBeNull();
    expect(readStamp('abc1234')).toBeNull();
    expect(readStamp({})).toBeNull();
    expect(readStamp({ commit: '' })).toBeNull();
    expect(readStamp({ commit: 42 })).toBeNull();
    expect(readStamp({ commit: 'abc1234' })).toEqual({ commit: 'abc1234', version: '' });
  });
});

describe('planUpdate', () => {
  it('is current when the page is the build the server serves', () => {
    expect(planUpdate('abc1234', 'abc1234', PAGE)).toEqual({ kind: 'current', live: 'abc1234' });
  });

  it('reloads a stale page at the same address with the live commit stamped on it', () => {
    const plan = planUpdate('abc1234', 'def5678', PAGE);
    expect(plan.kind).toBe('reload');
    if (plan.kind !== 'reload') return;
    const url = new URL(plan.href);
    expect(url.origin + url.pathname).toBe(PAGE);
    expect(url.searchParams.get(UPDATE_PARAM)).toBe('def5678');
  });

  it('keeps every other parameter on the address', () => {
    const plan = planUpdate('abc1234', 'def5678', `${PAGE}?tier=low&relay=ws://127.0.0.1:8787`);
    if (plan.kind !== 'reload') throw new Error(plan.kind);
    const url = new URL(plan.href);
    expect(url.searchParams.get('tier')).toBe('low');
    expect(url.searchParams.get('relay')).toBe('ws://127.0.0.1:8787');
    expect(url.searchParams.get(UPDATE_PARAM)).toBe('def5678');
  });

  it('is stuck, not a second reload, when this page already IS the reload for that commit', () => {
    expect(planUpdate('abc1234', 'def5678', `${PAGE}?${UPDATE_PARAM}=def5678`))
      .toEqual({ kind: 'stuck', live: 'def5678' });
  });

  it('reloads again when a newer commit than the one stamped goes live', () => {
    const plan = planUpdate('abc1234', '9999999', `${PAGE}?${UPDATE_PARAM}=def5678`);
    if (plan.kind !== 'reload') throw new Error(plan.kind);
    expect(new URL(plan.href).searchParams.getAll(UPDATE_PARAM)).toEqual(['9999999']);
  });
});

describe('tidyHref', () => {
  it('takes only the update parameter off, and says when there was none', () => {
    expect(tidyHref(PAGE)).toBeNull();
    expect(tidyHref(`${PAGE}?tier=low`)).toBeNull();
    expect(tidyHref(`${PAGE}?${UPDATE_PARAM}=def5678`)).toBe(PAGE);
    expect(tidyHref(`${PAGE}?tier=low&${UPDATE_PARAM}=def5678&sky=rain`)).toBe(`${PAGE}?tier=low&sky=rain`);
  });
});

describe('stampUrl', () => {
  it('asks for version.json beside the page, under /v1/, with a query no cache has seen', () => {
    expect(stampUrl(PAGE, 1234)).toBe(`${PAGE}version.json?t=1234`);
    expect(stampUrl(`${PAGE}index.html?${UPDATE_PARAM}=def5678`, 5)).toBe(`${PAGE}version.json?t=5`);
    expect(stampUrl('http://127.0.0.1:4173/?tier=low', 7)).toBe('http://127.0.0.1:4173/version.json?t=7');
  });
});

interface Rig {
  readonly deps: UpdateWatchDeps;
  href: string;
  live: unknown;
  fail: boolean;
  inGame: boolean;
  clock: number;
  readonly fetched: string[];
  readonly navigated: string[];
  readonly rewritten: string[];
  readonly log: string[];
  visible(): void;
  tick(): void;
  visibleListeners: number;
  timers: number;
}

function rig(options: { href?: string; live?: unknown; inGame?: boolean } = {}): Rig {
  let onVisible: (() => void) | null = null;
  let onTimer: (() => void) | null = null;
  const r: Rig = {
    href: options.href ?? PAGE,
    live: options.live ?? { commit: 'abc1234', version: '1.0.0-alpha.24' },
    fail: false,
    inGame: options.inGame ?? false,
    clock: 1_000_000,
    fetched: [],
    navigated: [],
    rewritten: [],
    log: [],
    visibleListeners: 0,
    timers: 0,
    visible: () => onVisible?.(),
    tick: () => onTimer?.(),
    deps: {
      running: 'abc1234',
      href: () => r.href,
      fetchJson: (url) => {
        r.fetched.push(url);
        return r.fail ? Promise.reject(new Error('Failed to fetch')) : Promise.resolve(r.live);
      },
      navigate: (href) => {
        r.navigated.push(href);
      },
      rewrite: (href) => {
        r.rewritten.push(href);
        r.href = href;
      },
      mayReload: () => !r.inGame,
      now: () => r.clock,
      onVisible: (cb) => {
        onVisible = cb;
        r.visibleListeners++;
        return () => {
          onVisible = null;
          r.visibleListeners--;
        };
      },
      every: (ms, cb) => {
        expect(ms).toBe(RECHECK_MS);
        onTimer = cb;
        r.timers++;
        return () => {
          onTimer = null;
          r.timers--;
        };
      },
      log: (line) => {
        r.log.push(line);
      },
    },
  };
  return r;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('watchForUpdates', () => {
  it('asks the server at boot and leaves a current page alone', async () => {
    const r = rig();
    const watch = watchForUpdates(r.deps);
    await settle();
    expect(r.fetched).toEqual([`${PAGE}version.json?t=1000000`]);
    expect(r.navigated).toEqual([]);
    expect(r.rewritten).toEqual([]);
    expect(watch.last).toEqual({ kind: 'current', live: 'abc1234' });
    watch.stop();
  });

  it('reloads a stale page at the menu, with the live commit on the address', async () => {
    const r = rig({ live: { commit: 'def5678', version: '1.0.0-alpha.25' } });
    const watch = watchForUpdates(r.deps);
    await settle();
    expect(r.navigated).toEqual([`${PAGE}?${UPDATE_PARAM}=def5678`]);
    expect(watch.last?.kind).toBe('reload');
    expect(r.log.some((l) => l.includes('abc1234 → def5678') && l.includes('alpha.25'))).toBe(true);
    watch.stop();
  });

  it('holds a stale verdict while a game is live and acts on it once the game ends', async () => {
    const r = rig({ live: { commit: 'def5678', version: '' }, inGame: true });
    const watch = watchForUpdates(r.deps);
    await settle();
    expect(r.navigated).toEqual([]);
    expect(watch.last).toEqual({ kind: 'held', live: 'def5678' });

    r.inGame = false;
    r.clock += RECHECK_MS;
    r.tick();
    await settle();
    expect(r.navigated).toEqual([`${PAGE}?${UPDATE_PARAM}=def5678`]);
    watch.stop();
  });

  it('takes the update parameter off the address it booted with, and does not reload again for that commit', async () => {
    // The reload landed, but the server handed back the old document anyway.
    const r = rig({ href: `${PAGE}?${UPDATE_PARAM}=def5678`, live: { commit: 'def5678', version: '' } });
    const watch = watchForUpdates(r.deps);
    expect(r.rewritten).toEqual([PAGE]);
    await settle();
    // The parameter is gone from the address by the time the answer
    // comes back, so the watch must remember the commit it booted under
    // rather than read it: a plain stale verdict here would be the loop.
    expect(r.navigated).toEqual([]);
    expect(watch.last).toEqual({ kind: 'stuck', live: 'def5678' });
    watch.stop();
  });

  it('lets the parameter stand for a NEWER commit than the one it booted under', async () => {
    const r = rig({ href: `${PAGE}?${UPDATE_PARAM}=def5678`, live: { commit: '9999999', version: '' } });
    const watch = watchForUpdates(r.deps);
    await settle();
    expect(r.navigated).toEqual([`${PAGE}?${UPDATE_PARAM}=9999999`]);
    watch.stop();
  });

  it('swallows a failed fetch and a stamp with no commit, and never reloads on either', async () => {
    const r = rig({ live: { commit: 'def5678', version: '' } });
    r.fail = true;
    const watch = watchForUpdates(r.deps);
    await settle();
    expect(r.navigated).toEqual([]);
    expect(watch.last).toBeNull();
    expect(r.log.some((l) => l.startsWith('update check: no answer'))).toBe(true);

    r.fail = false;
    r.live = '<!doctype html>';
    r.clock += CHECK_GAP_MS;
    await watch.check();
    expect(r.navigated).toEqual([]);
    expect(watch.last).toBeNull();
    watch.stop();
  });

  it('treats two checks inside CHECK_GAP_MS as one', async () => {
    const r = rig();
    const watch = watchForUpdates(r.deps);
    await settle();
    r.visible();
    r.visible();
    await settle();
    expect(r.fetched).toHaveLength(1);
    r.clock += CHECK_GAP_MS;
    r.visible();
    await settle();
    expect(r.fetched).toHaveLength(2);
    watch.stop();
  });

  it('checks again when the page comes back on screen and on the timer, until stopped', async () => {
    const r = rig();
    const watch = watchForUpdates(r.deps);
    await settle();
    expect(r.visibleListeners).toBe(1);
    expect(r.timers).toBe(1);
    r.clock += CHECK_GAP_MS;
    r.visible();
    await settle();
    r.clock += RECHECK_MS;
    r.tick();
    await settle();
    expect(r.fetched).toHaveLength(3);
    watch.stop();
    expect(r.visibleListeners).toBe(0);
    expect(r.timers).toBe(0);
    r.clock += RECHECK_MS;
    expect(await watch.check()).toEqual({ kind: 'current', live: 'abc1234' });
    expect(r.fetched).toHaveLength(3);
  });
});

describe('the boot wiring', () => {
  const main = readFileSync(path.join(ROOT, 'src', 'main.ts'), 'utf8');

  it('starts the watch from main.ts with the build commit, a no-store fetch and the session as the reload gate', () => {
    expect(main).toContain('watchForUpdates({');
    expect(main).toContain('running: BUILD_INFO.commit');
    expect(main).toContain("cache: 'no-store'");
    expect(main).toContain('mayReload: () => app.handle.session === null');
    expect(main).toContain("'visibilitychange'");
    expect(main).toContain('location.replace(');
    expect(main).toContain('history.replaceState(');
  });
});
