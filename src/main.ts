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
 */
import { App } from './app/App';
import { dismissBootSplash, reportBoot } from './ui';

const host = document.getElementById('app');
const uiLayer = document.getElementById('ui');
if (!host || !uiLayer) throw new Error('index.html must provide #app and #ui');

reportBoot(0, 'Starting');
void new App(host, uiLayer).start().then(() => {
  reportBoot(1, 'Ready');
  dismissBootSplash();
});
