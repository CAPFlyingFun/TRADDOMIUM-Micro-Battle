import { LoadPlan, readableBytes, readableWait } from './loadPlan';
import { fitCover } from './ratioBox';
import { Meter } from './Meter';
import { splashFor } from './splashFrame';
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
const SIDE_MARGIN = 0.02;
const DRAWN_CAP = 'min(78vw, 460px)';
const GRID_JOB = 'grid';
const RIM = 'rgba(255, 214, 140, .75)';
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
  // PIN THE SOURCE. The markup uses a `<picture>` with an orientation
  // query, which is how the right image is on screen before any script
  // runs — but an `<img>` inside a `<picture>` only resolves that way
  // WHILE IT IS THERE. Re-parent it into the loading screen later and
  // the browser re-runs the selection with no `<source>` beside it, and
  // silently falls back to the `src` attribute: the landscape picture,
  // stretched into a portrait box. Pinning the URL here ends the
  // element's dependence on its neighbours, and `aim` maintains it.
  art.src = `${import.meta.env.BASE_URL}${cut.file}`;
  // Claim it now, while the boot screen still exists: the in-game
  // loading screen re-parents this very element rather than asking the
  // browser for the picture a second time.
  keepSplashArt(cut, art);

  const backing = document.createElement('div');
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
  // TWO PIECES, ALLOWED TO WRAP. "Surveying the island · 1.8 MB /
  // 2.0 MB · 6s left" does not fit across a portrait phone on one line,
  // and `nowrap` would have run it off both edges. Split at the one
  // sensible place and let it break there when it has to; on anything
  // wider it stays on a single line.
  const what = document.createElement('span');
  what.textContent = 'SURVEYING THE ISLAND';
  const numbers = document.createElement('span');
  caption.append(what, numbers);
  Object.assign(caption.style, {
    position: 'absolute',
    // Capped to the SCREEN, not the picture — see the same note in
    // splashStage. A tall phone crops the picture's sides and a caption
    // laid out at 100% of it hangs off both edges.
    left: '50%',
    transform: 'translateX(-50%)',
    width: 'min(100%, 92vw)',
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: '0.7em',
    rowGap: '0.25em',
    textAlign: 'center',
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

  /**
   * Point the bar and the caption at this picture, and stack them the
   * way this picture wants.
   *
   * A CUT-OUT picture goes in front, so the bar is inserted BEFORE it —
   * the reference node is the `<picture>` rather than the `<img>`, as
   * the image's parent is the picture and inserting against the wrong
   * one throws. A DRAWN one goes behind, so the bar is appended after
   * it, gets its own rounded edge and rim, and is capped to the screen
   * rather than to the picture, which a tall phone crops.
   */
  const aim = (): void => {
    const want = `${import.meta.env.BASE_URL}${cut.file}`;
    if (!art.src.endsWith(cut.file)) art.src = want;
    const drawn = cut.kind === 'drawn';
    const bleed = drawn ? 0 : (cut.bottom - cut.top) * Meter.BLEED;
    const round = drawn ? '999px' : '0';
    for (const el of [backing, clip]) {
      Object.assign(el.style, {
        position: 'absolute',
        top: pc(cut.top - bleed),
        height: pc(cut.bottom - cut.top + bleed * 2),
        borderRadius: round,
      } as Partial<CSSStyleDeclaration>);
      if (drawn) {
        el.style.left = '50%';
        el.style.transform = 'translateX(-50%)';
        el.style.width = `min(${pc(cut.right - cut.left)}, ${DRAWN_CAP})`;
      } else {
        el.style.left = pc(cut.left);
        el.style.transform = 'none';
        el.style.width = pc(cut.right - cut.left);
      }
    }
    fill.style.borderRadius = round;
    backing.style.background = drawn ? 'rgba(6, 8, 5, 0.78)' : 'transparent';
    backing.style.boxShadow = drawn
      ? `0 0 0 1.5px ${RIM}, 0 2px 14px rgba(0,0,0,.55)` : 'none';
    caption.style.top = pc(cut.bottom + CAPTION_DROP * 0.5);

    const picture = art.closest('picture') ?? art;
    if (drawn) stage.append(backing, clip, caption);
    else {
      stage.insertBefore(backing, picture);
      stage.insertBefore(clip, picture);
      stage.appendChild(caption);
    }
  };
  aim();

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
    return {
      ratio: cut.ratio,
      keepVisible: cut.bottom + CAPTION_DROP,
      keepWide: cut.kind === 'cutout' ? cut.right - cut.left + SIDE_MARGIN * 2 : 0,
    };
  });

  // The same plan the spawn screen runs on, with one job in it. Reused
  // rather than reimplemented so both screens estimate the same way —
  // a trailing window over the bytes, which is what stops the number
  // climbing while a download runs perfectly.
  const plan = new LoadPlan();
  plan.add(GRID_JOB, 'Surveying the island', 1, true);

  return (done, total, trouble) => {
    if (trouble) {
      what.textContent = trouble;
      numbers.textContent = '';
      caption.style.color = 'rgba(255, 150, 130, 0.95)';
      return;
    }
    if (total <= 0) return;
    plan.resize(GRID_JOB, total);
    plan.advance(GRID_JOB, done);
    const state = plan.read();
    fill.style.width = `${Math.min(100, (done / total) * 100).toFixed(1)}%`;
    const left = state.secondsLeft;
    numbers.textContent = `${readableBytes(done)} / ${readableBytes(total)}`
      + (done >= total ? '' : left === null ? '' : ` · ${readableWait(left)} left`);
    caption.style.color = done >= total ? GOLD : GOLD_DIM;
  };
}
