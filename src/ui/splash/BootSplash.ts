/**
 * FILL THE HOLE IN THE BOOT SPLASH, AND TAKE THE SPLASH DOWN.
 *
 * `index.html` paints the artwork with the document, which is the only
 * way for it to be there before any script runs, and the artwork has
 * the bar's interior cut out of it. What static markup cannot carry is
 * what goes behind that hole: the window's rectangle is measured off
 * the art's alpha at bake time and written into a generated module, and
 * generated numbers have no business being copied into hand-written
 * HTML where they would quietly go stale the next time the art is
 * re-cut.
 *
 * So the picture is the document's job — a `<picture>` with an
 * orientation media query, which needs no script at all — and the
 * layers behind it are this one's. They are INSERTED BEFORE the image
 * in the DOM, which is what puts them behind it: the same sandwich as
 * `Meter`, assembled around markup that already exists.
 *
 * The app owns the timing. `main.ts` reports what has measurably
 * happened (never a tween: a fraction here is a fact, such as "the
 * modules have arrived") and dismisses the splash once the menu is up.
 * This module only knows how to draw on `#boot` and how to remove it.
 */
import { buildStage, type Stage } from './SplashStage';

/** The id `index.html` gives the splash. */
export const BOOT_ID = 'boot';

/**
 * Matches `#boot`'s opacity transition in index.html, with a margin. The
 * element is removed on `transitionend`; this is the fallback for when
 * that event never comes (a browser with animations off, a test).
 */
const FADE_FALLBACK_MS = 800;

interface Boot {
  readonly stage: Stage;
}

/** One stage per splash element, built the first time the element is drawn on. */
const built = new WeakMap<HTMLElement, Boot>();

function bootRoot(): HTMLElement | null {
  return document.getElementById(BOOT_ID);
}

function attach(root: HTMLElement): Boot | null {
  const had = built.get(root);
  if (had) return had;
  const stage = root.querySelector<HTMLElement>('.stage');
  const art = stage?.querySelector('img') ?? null;
  if (!stage || !art) return null;
  const boot: Boot = { stage: buildStage({ around: { root, stage, art } }) };
  built.set(root, boot);
  return boot;
}

/**
 * Show how far boot has got: a MEASURED fraction, 0..1, and a caption
 * saying what it measures. No-op once the splash is gone, and when the
 * document has no splash (a test page, a dev tool of its own).
 */
export function reportBoot(fraction: number, caption: string): void {
  const root = bootRoot();
  const boot = root ? attach(root) : null;
  if (!boot) return;
  boot.stage.meter.set(fraction);
  boot.stage.below.textContent = caption;
  boot.stage.below.classList.toggle('splash-caption--lit', boot.stage.meter.fraction >= 1);
}

/**
 * Fade the splash out and take it out of the tree.
 *
 * Removed rather than left invisible: it is a fixed full-screen element
 * above everything, and would eat every tap. The stage stops fitting
 * first, so a resize during the fade cannot touch an element on its
 * way out.
 */
export function dismissBootSplash(): void {
  const root = bootRoot();
  if (!root) return;
  built.get(root)?.stage.stopFitting();
  built.delete(root);

  let removed = false;
  const remove = (): void => {
    if (removed) return;
    removed = true;
    root.remove();
  };
  root.addEventListener('transitionend', (event) => {
    // The meter's fill transitions its width, and that event bubbles;
    // only the splash's own fade means it has gone.
    if (event.target === root) remove();
  });
  root.classList.add('gone');
  setTimeout(remove, FADE_FALLBACK_MS);
}
