import { readableBytes } from './loadPlan';
import { fitCover } from './ratioBox';
import { Meter } from './Meter';
import { SPLASH_RATIO, SPLASH_WINDOW } from './splashFrame';
import { GOLD, GOLD_DIM, KEEP_VISIBLE, keepSplashArt } from './splashStage';

/**
 * FILL THE HOLE IN THE BOOT SPLASH.
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
 * So the picture is the document's job and the layers behind it are
 * this one's. They are INSERTED BEFORE the image in the DOM, which is
 * what puts them behind it — same sandwich as `Meter`, assembled around
 * markup that already exists rather than built from nothing.
 *
 * The gap between the two is the moment it takes to parse one module,
 * against a two-megabyte elevation download that has not started yet.
 */

const FILL = 'linear-gradient(90deg, #f6c24b 0%, #ff9e2c 52%, #ff5a36 100%)';
const pc = (n: number): string => `${(n * 100).toFixed(3)}%`;

/**
 * Put a fill and a caption on the boot splash.
 *
 * @returns a function to report bytes, or to say something went wrong
 */
export function fitBootBar(
  boot: HTMLElement,
): (done: number, total: number, trouble?: string) => void {
  const stage = boot.querySelector('.stage') as HTMLElement | null;
  const art = stage?.querySelector('img') as HTMLImageElement | null;
  if (!stage || !art) return () => {};
  // Claim it now, while the boot screen still exists: the in-game
  // loading screen re-parents this very element rather than asking the
  // browser for the picture a second time.
  keepSplashArt(art);

  // The markup sized the stage from viewport units, which is right for
  // the first paint and cannot do the one thing that needs measuring:
  // sliding the crop up so the caption stays on screen on a wide phone.
  // Same fit the in-game screen uses.
  fitCover(stage, boot, SPLASH_RATIO, KEEP_VISIBLE);

  const { left, right, top, bottom } = SPLASH_WINDOW;
  const bleed = (bottom - top) * Meter.BLEED;
  const clip = document.createElement('div');
  Object.assign(clip.style, {
    position: 'absolute',
    left: pc(left),
    top: pc(top - bleed),
    width: pc(right - left),
    height: pc(bottom - top + bleed * 2),
    overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);

  const fill = document.createElement('div');
  Object.assign(fill.style, {
    height: '100%',
    width: '0%',
    background: FILL,
    transition: 'width 200ms linear',
  } as Partial<CSSStyleDeclaration>);
  clip.appendChild(fill);

  const caption = document.createElement('div');
  Object.assign(caption.style, {
    position: 'absolute',
    left: '0',
    width: '100%',
    top: pc(bottom + 0.038),
    textAlign: 'center',
    whiteSpace: 'nowrap',
    lineHeight: '1.2',
    color: GOLD_DIM,
    textShadow: '0 1px 2px rgba(0,0,0,.95), 0 2px 10px rgba(0,0,0,.9), 0 0 22px rgba(0,0,0,.85)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontWeight: '600',
    // Sized against the picture rather than the window, so the caption
    // keeps its place on the artwork at any size. The vw value is the
    // fallback for anything without container queries.
    fontSize: 'clamp(9px, 1.5vw, 15px)',
    letterSpacing: '0.14em',
    textIndent: '0.14em',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  caption.style.setProperty('font-size', '1.5cqw');
  caption.textContent = 'SURVEYING THE ISLAND…';

  // BEFORE the image: that is what puts it behind the hole.
  stage.insertBefore(clip, art);
  stage.appendChild(caption);

  return (done, total, trouble) => {
    if (trouble) {
      caption.textContent = trouble;
      caption.style.color = 'rgba(255, 150, 130, 0.95)';
      return;
    }
    if (total <= 0) return;
    fill.style.width = `${Math.min(100, (done / total) * 100).toFixed(1)}%`;
    caption.textContent =
      `SURVEYING THE ISLAND · ${readableBytes(done)} / ${readableBytes(total)}`;
    caption.style.color = done >= total ? GOLD : GOLD_DIM;
  };
}
