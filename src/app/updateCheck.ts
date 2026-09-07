/**
 * KEEP THE INSTALLED APP ON THE BUILD THAT IS LIVE.
 *
 * Joshua tests from the phone, where the game is a home-screen app with
 * no address bar and no reload button. An iOS home-screen app also does
 * not restart when it is reopened: the page that was loaded last week is
 * simply brought back to the front, and it stays that build until iOS
 * happens to evict it. So "the PWA still shows alpha.22" after alpha.23
 * deployed is not a failed deploy and not a cache header — it is a page
 * that was never asked to load again.
 *
 * This asks. The build knows the commit it was made from
 * (`__BUILD_COMMIT__`); the server publishes the commit it is serving
 * (`version.json`, emitted by `vite.config.ts` beside `index.html`). When
 * the two differ the running page is stale, and the fix is to load the
 * document again — at boot, when the app comes back to the front, and
 * every few minutes while it is at the menu.
 *
 * THE RELOAD IS A NAVIGATION TO THE SAME PAGE WITH `?update=<commit>`
 * ON IT, not a bare `location.reload()`, for two reasons that are the
 * same reason. GitHub Pages serves `index.html` with a ten-minute
 * freshness lifetime, so a reload can hand back the very document that
 * is stale; a URL nobody has fetched before cannot. And the parameter is
 * how the freshly loaded page knows the attempt was made: if it boots,
 * reads `?update=abc123`, and finds it is STILL not abc123, the server
 * has not caught up yet and it must not try again — that is the loop a
 * naive check gets into during the minute a deploy takes to propagate.
 * Once the right build is running it takes the parameter back off the
 * address, so the next reload is judged on its own.
 *
 * NEVER MID-GAME. A reload throws away the world the player is standing
 * in, so a stale verdict found while a session is live is HELD and acted
 * on at the next check that finds the app back at the menu. Nothing here
 * writes storage, so a build on a phone that forbids it updates exactly
 * the same way.
 *
 * Every browser fact is a parameter (`UpdateWatchDeps`), so the decisions
 * are testable under plain node and `main.ts` supplies the real fetch,
 * location and timers in one place.
 */

/** The query parameter a reload carries, and the running build removes. */
export const UPDATE_PARAM = 'update';

/** How often the check repeats while the page is on screen. */
export const RECHECK_MS = 5 * 60_000;

/**
 * Two checks closer together than this are one check: a phone that is
 * switched to and from a few times in a row need not hit the server for
 * each.
 */
export const CHECK_GAP_MS = 10_000;

/** What `version.json` must carry for a comparison to mean anything. */
export interface LiveStamp {
  readonly commit: string;
  readonly version: string;
}

/**
 * Validate a parsed `version.json`. Anything that is not a non-empty
 * commit string is `null`: a 404 page, an HTML error body parsed as
 * nothing, or a hand-edited file must read as "no answer", never as "a
 * different commit", or a broken stamp would reload every phone once
 * every ten minutes forever.
 */
export function readStamp(json: unknown): LiveStamp | null {
  if (typeof json !== 'object' || json === null) return null;
  const commit = (json as { commit?: unknown }).commit;
  if (typeof commit !== 'string' || commit.length === 0) return null;
  const version = (json as { version?: unknown }).version;
  return { commit, version: typeof version === 'string' ? version : '' };
}

export type UpdatePlan =
  /** The page is the build the server serves. */
  | { readonly kind: 'current'; readonly live: string }
  /** Stale: load `href`, which is this page with the live commit stamped on it. */
  | { readonly kind: 'reload'; readonly live: string; readonly href: string }
  /** Stale, and this page already IS the reload for `live`: the server has not caught up. */
  | { readonly kind: 'stuck'; readonly live: string }
  /** Stale, but a game is in progress; try again later. */
  | { readonly kind: 'held'; readonly live: string };

/** Pure: given the running commit, the live one and the address, what to do. */
export function planUpdate(running: string, live: string, href: string): UpdatePlan {
  if (running === live) return { kind: 'current', live };
  const url = new URL(href);
  if (url.searchParams.get(UPDATE_PARAM) === live) return { kind: 'stuck', live };
  url.searchParams.set(UPDATE_PARAM, live);
  return { kind: 'reload', live, href: url.href };
}

/**
 * The address with the update parameter taken off, or `null` when there
 * was none to take — so a caller can leave the history entry alone
 * rather than rewriting it on every boot. Every other parameter
 * (`?relay=`, `?tier=`, `?sky=`…) is kept exactly as it was.
 */
export function tidyHref(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has(UPDATE_PARAM)) return null;
  url.searchParams.delete(UPDATE_PARAM);
  return url.href;
}

/** Where `version.json` is, relative to the page, with a cache-buster no cache has seen. */
export function stampUrl(href: string, now: number): string {
  return new URL(`version.json?t=${now}`, href).href;
}

export interface UpdateWatchDeps {
  /** `BUILD_INFO.commit`: what this page was built from. */
  readonly running: string;
  /** `location.href`, read fresh each time. */
  readonly href: () => string;
  /** GET `url`, resolving the parsed JSON body; rejects on a network or HTTP failure. */
  readonly fetchJson: (url: string) => Promise<unknown>;
  /** `location.replace`: load the reload address in place of this page. */
  readonly navigate: (href: string) => void;
  /** `history.replaceState`: put the tidied address in the bar without loading anything. */
  readonly rewrite: (href: string) => void;
  /** True when nothing would be lost by loading the page again (no live session). */
  readonly mayReload: () => boolean;
  readonly now: () => number;
  /** Subscribe to "the page came back on screen"; returns the unsubscribe. */
  readonly onVisible: (cb: () => void) => () => void;
  /** `setInterval` with the unsubscribe returned. */
  readonly every: (ms: number, cb: () => void) => () => void;
  readonly log?: (line: string) => void;
}

export interface UpdateWatch {
  /** Ask the server now (throttled by `CHECK_GAP_MS`) and act on the answer. */
  check(): Promise<UpdatePlan | null>;
  /** The last verdict, `null` before the first answer or when the server gave none. */
  readonly last: UpdatePlan | null;
  stop(): void;
}

/**
 * Tidy the address, check now, and keep checking on every return to the
 * screen and every `RECHECK_MS` while on it. Every failure is logged and
 * swallowed: an update check that could take the game down would be
 * worse than a stale one.
 */
export function watchForUpdates(deps: UpdateWatchDeps): UpdateWatch {
  const log = deps.log ?? (() => {});
  let last: UpdatePlan | null = null;
  let lastAskedAt = -Infinity;
  let stopped = false;

  // The commit this page was reloaded FOR, remembered before the address
  // is tidied: the page that booted is the build the server served for
  // that address, whatever the parameter says, so the parameter has done
  // its job — but the evidence that the attempt was made must outlive it,
  // or the tidied page would judge itself stale and reload again.
  const bootedFor = new URL(deps.href()).searchParams.get(UPDATE_PARAM);
  const tidied = tidyHref(deps.href());
  if (tidied !== null) deps.rewrite(tidied);

  const decide = (live: string): UpdatePlan => {
    if (live !== deps.running && live === bootedFor) return { kind: 'stuck', live };
    const plan = planUpdate(deps.running, live, deps.href());
    if (plan.kind === 'reload' && !deps.mayReload()) return { kind: 'held', live };
    return plan;
  };

  const check = async (): Promise<UpdatePlan | null> => {
    if (stopped) return last;
    const now = deps.now();
    if (now - lastAskedAt < CHECK_GAP_MS) return last;
    lastAskedAt = now;

    let stamp: LiveStamp | null;
    try {
      stamp = readStamp(await deps.fetchJson(stampUrl(deps.href(), now)));
    } catch (err) {
      log(`update check: no answer (${err instanceof Error ? err.message : String(err)})`);
      return last;
    }
    if (stamp === null) {
      log('update check: version.json carried no commit');
      return last;
    }
    if (stopped) return last;

    const plan = decide(stamp.commit);
    last = plan;
    switch (plan.kind) {
      case 'current':
        break;
      case 'reload':
        log(`update: ${deps.running} → ${plan.live} (v${stamp.version}), reloading`);
        deps.navigate(plan.href);
        break;
      case 'held':
        log(`update: ${plan.live} is live, waiting for the game to end`);
        break;
      case 'stuck':
        log(`update: ${plan.live} is live but this address still served ${deps.running}; will not loop`);
        break;
    }
    return plan;
  };

  const offVisible = deps.onVisible(() => {
    void check();
  });
  const offTimer = deps.every(RECHECK_MS, () => {
    void check();
  });
  void check();

  return {
    check,
    get last() {
      return last;
    },
    stop() {
      stopped = true;
      offVisible();
      offTimer();
    },
  };
}
