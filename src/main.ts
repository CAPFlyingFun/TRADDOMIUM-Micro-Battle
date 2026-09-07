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
