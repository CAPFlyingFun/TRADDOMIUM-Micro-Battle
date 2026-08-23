/**
 * IS THERE A NEWER BUILD, AND CAN WE HAVE IT?
 *
 * Joshua tests from the deployed Pages build on a phone, and the
 * failure this exists for is a specific and maddening one: the deploy
 * succeeds, the new build is genuinely live, and the device keeps
 * showing the old one. It looked like the push had not landed. It had.
 *
 * THERE IS NO SERVICE WORKER HERE, which is worth saying because
 * StormTracker's answer to the same problem is a service worker with a
 * hand-bumped cache counter. This app has no offline story to protect,
 * so the culprit is the plain HTTP cache — and the fix is much smaller.
 *
 * WHY A RELOAD IS NOT ENOUGH, and why this is not just
 * `location.reload()`. Vite content-hashes every asset, so the only
 * file whose URL does not change between builds is `index.html`. Pages
 * serves it with a ten-minute max-age and an installed PWA can hold it
 * considerably longer, so a reload can re-fetch the same stale document
 * and re-run the same stale bundle. Reloading to a URL that has never
 * been requested before cannot hit that cache, and once the document is
 * fresh every hashed asset under it follows automatically.
 *
 * COMMIT, NOT VERSION, is what gets compared. A version is bumped by
 * hand and is not bumped for every change; the commit is what the build
 * actually is. The version is what gets SHOWN, because that is what a
 * person reads.
 */
import { COMMIT, VERSION } from '../build';

/** What `version.json` carries — see the stamp plugin in vite.config.ts. */
export interface Live {
  readonly version: string;
  readonly commit: string;
  readonly built: string;
}

/**
 * Remembers which build we have already reloaded for.
 *
 * THE LOOP GUARD, and it is not paranoia. If a reload somehow comes
 * back running the same old bundle — a cache more stubborn than
 * expected, a proxy, an offline PWA shell — then an automatic update
 * would find the same newer version again and reload again, forever,
 * and the game would never start. One attempt per build; after that the
 * settings panel says so and the player decides.
 */
const TRIED = 'tmb:update-tried';

function alreadyTried(commit: string): boolean {
  try {
    return sessionStorage.getItem(TRIED) === commit;
  } catch {
    // Private mode, or storage blocked. A missing guard is worse than
    // no auto-update, so treat it as "already tried".
    return true;
  }
}

function rememberTried(commit: string): void {
  try {
    sessionStorage.setItem(TRIED, commit);
  } catch { /* nothing to be done, and nothing worth failing over */ }
}

/**
 * Ask the server what it is serving.
 *
 * `no-store` AND a cache-busting query, belt and braces: the header is
 * what a well-behaved cache honours and the query is what gets past one
 * that does not. Returns null on any failure — offline, a proxy, a
 * half-deployed Pages build — because "cannot tell" and "up to date"
 * are different answers and only one of them should ever reload.
 */
export async function liveBuild(): Promise<Live | null> {
  try {
    const url = new URL('version.json', document.baseURI);
    url.searchParams.set('t', String(Date.now()));
    const answer = await fetch(url.toString(), { cache: 'no-store' });
    if (!answer.ok) return null;
    const live = await answer.json() as Partial<Live>;
    if (typeof live.commit !== 'string' || typeof live.version !== 'string') return null;
    return { version: live.version, commit: live.commit, built: live.built ?? '' };
  } catch {
    return null;
  }
}

/**
 * Is what the server has different from what is running?
 *
 * Split from `isNewer` so both answers can be tested. The running
 * commit is a module constant injected at build time — and it turns out
 * vitest applies Vite's `define` too, so under test it is a REAL commit
 * and the dev-build branch below could never be reached from the
 * outside. A parameter can be.
 */
export function outOfDate(running: string, live: Live): boolean {
  // A dev build has no real commit, so it is never "out of date" — and
  // a developer whose page reloaded itself mid-edit would rightly file
  // that as a bug.
  return running !== 'dev' && live.commit !== running;
}

/** The same question, about this build. */
export function isNewer(live: Live): boolean {
  return outOfDate(COMMIT, live);
}

/** What to show beside the version when an update is waiting. */
export function updateLabel(live: Live): string {
  return live.version === VERSION
    ? `New build ${live.commit}`
    : `v${live.version} available`;
}

/**
 * Take the newer build.
 *
 * Clears anything a future service worker may have cached before
 * reloading, so that adding one later cannot silently turn this into a
 * no-op — the class of bug where the update button works for months
 * and then quietly stops.
 */
export async function takeUpdate(live: Live): Promise<void> {
  rememberTried(live.commit);
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch { /* a cleared cache is a nicety; the reload is the fix */ }
  try {
    if ('serviceWorker' in navigator) {
      const workers = await navigator.serviceWorker.getRegistrations();
      await Promise.all(workers.map((worker) => worker.unregister()));
    }
  } catch { /* same */ }

  const next = new URL(window.location.href);
  // The URL nothing has ever asked for. See the note at the top.
  next.searchParams.set('build', live.commit);
  window.location.replace(next.toString());
}

/**
 * On the way into the menu: if there is a newer build, take it.
 *
 * ONLY FROM THE MENU. Reloading mid-game would throw away a founding
 * run, and there is nothing to save it into yet. In game the same check
 * is offered as a button that says what it will cost.
 *
 * @returns the update it is reloading for, or null if it is not
 */
export async function autoUpdate(): Promise<Live | null> {
  const live = await liveBuild();
  if (!live || !isNewer(live) || alreadyTried(live.commit)) return null;
  await takeUpdate(live);
  return live;
}
