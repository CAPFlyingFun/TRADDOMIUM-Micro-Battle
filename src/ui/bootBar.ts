import { readableBytes } from './loadPlan';
import { fitCover } from './ratioBox';
import { Meter } from './Meter';
import { splashFor, type SplashCut } from './splashFrame';
import { GOLD, GOLD_DIM, keepSplashArt } from './splashStage';

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
 * So the picture is the document's job — a `<picture>` with an
 * orientation media query, which needs no script at all — and the
 * layers behind it are this one's. They are INSERTED BEFORE the image
 * in the DOM, which is what puts them behind it: the same sandwich as
 * `Meter`, assembled around markup that already exists.
 *
 * The gap between the two is the moment it takes to parse one module,
 * against a two-megabyte elevation download that has not started yet.
 */

const FILL = 'linear-gradient(90deg, #f6c24b 0%, #ff9e2c 52%, #ff5a36 100%)';
const CAPTION_DROP = 0.075;
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

  let cut = splashFor(window.innerWidth, window.innerHeight);
  // Claim it now, while the boot screen still exists: the in-game
  // loading screen re-parents this very element rather than asking the
  // browser for the picture a second time. Which picture the markup
  // actually chose is on the element, not in our guess about it.
  keepSplashArt(fromSrc(art) ?? cut, art);

  const clip = document.createElement('div');
  clip.style.overflow = 'hidden';
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
    textAlign: 'center',
    whiteSpace: 'nowrap',
    lineHeight: '1.2',
    color: GOLD_DIM,
    textShadow: '0 1px 2px rgba(0,0,0,.95), 0 2px 10px rgba(0,0,0,.9), 0 0 22px rgba(0,0,0,.85)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontWeight: '600',
    fontSize: 'clamp(9px, 1.5vmin, 15px)',
    letterSpacing: '0.14em',
    textIndent: '0.14em',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  caption.style.setProperty('font-size', '2.6cqmin');
  caption.textContent = 'SURVEYING THE ISLAND…';

  /** Point the fill and the caption at this picture's hole. */
  const aim = (): void => {
    const bleed = (cut.bottom - cut.top) * Meter.BLEED;
    Object.assign(clip.style, {
      position: 'absolute',
      left: pc(cut.left),
      top: pc(cut.top - bleed),
      width: pc(cut.right - cut.left),
      height: pc(cut.bottom - cut.top + bleed * 2),
    } as Partial<CSSStyleDeclaration>);
    caption.style.top = pc(cut.bottom + CAPTION_DROP * 0.5);
  };
  aim();

  // BEFORE the image: that is what puts it behind the hole. The
  // reference node is the `<picture>` rather than the `<img>` inside
  // it — the image's parent is the picture, and inserting against the
  // wrong one throws. (`display: contents` on the picture is why the
  // image still lays out as though it were a child of the stage.)
  stage.insertBefore(clip, art.closest('picture') ?? art);
  stage.appendChild(caption);

  // The markup sized the stage from viewport units, which is right for
  // the first paint and cannot do the two things that need measuring:
  // sliding the crop up so the caption stays on a wide phone, and
  // noticing that turning it swapped the picture for the other one.
  fitCover(stage, boot, () => {
    const now = splashFor(window.innerWidth, window.innerHeight);
    if (now.file !== cut.file) {
      cut = now;
      aim();
    }
    return { ratio: cut.ratio, keepVisible: cut.bottom + CAPTION_DROP };
  });

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

/**
 * Which cut the markup's `<picture>` actually settled on.
 *
 * `currentSrc` is the browser's answer to the media query, and it is
 * the only honest one — asking the window its shape a second time can
 * disagree with what was chosen a frame earlier.
 */
function fromSrc(art: HTMLImageElement): SplashCut | null {
  const src = art.currentSrc || art.src;
  for (const wide of [true, false]) {
    const cut = splashFor(wide ? 2 : 1, wide ? 1 : 2);
    if (src.endsWith(cut.file)) return cut;
  }
  return null;
}
