/**
 * Boot only: construct the App, start it, and take the splash down.
 *
 * `index.html` paints the key art with the document so there is something
 * on screen before this module is even parsed. What it reports here are
 * FACTS, never a tween (ARCHITECTURE §10): "the modules have arrived" when
 * this runs, "the menu is up" when `start()` resolves. Between the two the
 * bar holds — honestly, because nothing measurable happens in between on
 * the empty world — and the splash is removed, not hidden, so it cannot
 * eat the first tap.
 *
 * The update watch is wired here too, because this is the one place that
 * may touch `location`, `history`, `fetch` and the document's visibility
 * together: `app/updateCheck.ts` decides, this file supplies the browser.
 */
import { App } from './app/App';
import { watchForUpdates } from './app/updateCheck';
import { BUILD_INFO, dismissBootSplash, reportBoot } from './ui';

/**
 * THE ROTATION THAT LEAVES SAFARI LAID OUT AT THE OLD WIDTH.
 *
 * iOS Safari can keep the LAYOUT VIEWPORT at the previous orientation's
 * width after a turn — most often when the device is turned through the
 * landscape gate (`#orient` in `index.html`), which is precisely the
 * turn this game asks every phone player to make. The page then lays out
 * at the portrait width and the browser scales it up, so the HUD and its
 * controls come back oversized and overflowing.
 *
 * Re-asserting the viewport meta forces a recompute: collapse it to the
 * bare width, then restore on the next frame. TWICE, because iOS reports
 * its final size late — the second pass is after the rotation animation
 * has settled, and a re-assert that changes nothing costs nothing.
 *
 * Diagnosed and solved first in Beyond Extinction, whose own comment
 * records the same symptom; carried here because this game now has the
 * same gate and therefore the same turn.
 */
const VIEWPORT = document.querySelector('meta[name="viewport"]');
const VIEWPORT_CONTENT = VIEWPORT?.getAttribute('content') ?? '';
const kickViewport = (): void => {
  if (VIEWPORT === null || VIEWPORT_CONTENT === '') return;
  VIEWPORT.setAttribute('content', 'width=device-width');
  requestAnimationFrame(() => VIEWPORT.setAttribute('content', VIEWPORT_CONTENT));
};
window.addEventListener('orientationchange', () => {
  kickViewport();
  window.setTimeout(kickViewport, 350);
});

const host = document.getElementById('app');
const uiLayer = document.getElementById('ui');
if (!host || !uiLayer) throw new Error('index.html must provide #app and #ui');

reportBoot(0, 'Starting');
const app = new App(host, uiLayer);

watchForUpdates({
  running: BUILD_INFO.commit,
  href: () => location.href,
  fetchJson: async (url) => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json() as Promise<unknown>;
  },
  navigate: (href) => location.replace(href),
  rewrite: (href) => history.replaceState(history.state, '', href),
  // A live session is a world the player would lose; the menu is not.
  mayReload: () => app.handle.session === null,
  now: () => Date.now(),
  onVisible: (cb) => {
    const on = (): void => {
      if (document.visibilityState === 'visible') cb();
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  },
  every: (ms, cb) => {
    const id = setInterval(cb, ms);
    return () => clearInterval(id);
  },
  log: (line) => console.info(`[update] ${line}`),
});

void app.start().then(() => {
  reportBoot(1, 'Ready');
  dismissBootSplash();
});
