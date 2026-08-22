import { Meter } from './Meter';
import { fitCover } from './ratioBox';
import { splashFor, type SplashCut } from './splashFrame';

/**
 * THE SPLASH, AS A BAR.
 *
 * The artwork is not a backdrop with a loading bar near it — it IS the
 * loading bar's front layer, a picture with the bar's interior cut out.
 * So the whole picture becomes one `Meter`: fill behind, art in front,
 * and the only part of the fill anyone sees is the part framed by the
 * hole Joshua cut. The portrait bar's rounded ends come for free that
 * way; the fill behind it is still a square-cornered rectangle.
 *
 * TWO PICTURES, one per orientation. The game is landscape and asks for
 * the phone to be turned, but the boot screen appears BEFORE anyone has
 * been asked — and a 16:9 picture on a portrait phone is either
 * letterboxed or cropped to the middle of a tree. Turning the phone
 * swaps the art, re-aims the fill at the other hole, and re-fits the
 * box, all off the one resize.
 *
 * Shared, because the boot screen shows this for the elevation download
 * and the spawn screen shows it for the island, and the two drifting
 * apart would be immediately obvious.
 */

export const GOLD = 'rgba(255, 226, 160, 0.94)';
export const GOLD_DIM = 'rgba(255, 226, 160, 0.62)';

/**
 * How far past the bar the lowest thing written on it reaches.
 *
 * Covering the screen means cropping the picture on a shape it was not
 * composed for, and this is what stops the crop taking the readout with
 * it. A share of the picture's height, below the hole.
 */
const CAPTION_DROP = 0.075;

/** The gap above the hole where the place name sits. */
const PLACE_LIFT = 0.048;

/**
 * THE ONE COPY OF EACH PICTURE, moved from screen to screen.
 *
 * `index.html` paints the splash with the document, so by the time
 * anyone spawns, that image is decoded and on the GPU. Building a
 * second `<img>` with the same URL throws that away and asks the
 * browser for it again — which is free when the cache is warm and, on a
 * slow connection with five megabytes of textures already in flight, is
 * a black screen with a floating bar on it for several seconds. It
 * behaved exactly that way the first time it was measured.
 *
 * Only one splash is on screen at once, so one element per orientation
 * can simply be re-parented from the boot screen into the loading
 * screen. No refetch, no second decode, nothing to depend on.
 */
const kept = new Map<string, HTMLImageElement>();

/**
 * Hold on to an image the document already has.
 *
 * Called while the boot screen still exists, because once it has been
 * removed there is nothing left to query for.
 */
export function keepSplashArt(cut: SplashCut, img: HTMLImageElement): void {
  if (!kept.has(cut.file)) kept.set(cut.file, img);
}

function artFor(cut: SplashCut): HTMLImageElement {
  const had = kept.get(cut.file);
  // Verified, not trusted: the boot screen's copy lives inside a
  // `<picture>` with an orientation query, so turning the phone while
  // it is still there swaps what it is showing out from under the key
  // it was filed by.
  if (had && (had.currentSrc || had.src).endsWith(cut.file)) return had;
  const img = new Image();
  img.src = `${import.meta.env.BASE_URL}${cut.file}`;
  img.alt = 'TRADDOMIUM — Micro Battle!';
  Object.assign(img.style, {
    position: 'relative',
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'fill',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  kept.set(cut.file, img);
  return img;
}

export interface Stage {
  readonly root: HTMLDivElement;
  readonly meter: Meter;
  /** A caption above the bar, clear of "MICRO BATTLE!". */
  readonly above: HTMLDivElement;
  /** A caption below the bar, in the art's open forest floor. */
  readonly below: HTMLDivElement;
  readonly stopFitting: () => void;
}

export function buildStage(): Stage {
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    background: '#080c06',
    overflow: 'hidden',
    touchAction: 'none',
    userSelect: 'none',
  } as Partial<CSSStyleDeclaration>);

  let cut = splashFor(window.innerWidth, window.innerHeight);
  const meter = new Meter({ frame: artFor(cut), window: cut });
  meter.root.style.containerType = 'size';

  const above = document.createElement('div');
  const below = document.createElement('div');
  for (const [line, side] of [[above, 'above'], [below, 'below']] as const) {
    Object.assign(line.style, {
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
      // Sized against the picture, so a caption keeps its place on the
      // artwork at any window size. The vw value is the fallback for
      // anything without container queries; the cqmin below overrides
      // it where they exist and is dropped where they do not. `cqmin`
      // rather than `cqw`: the portrait picture is the narrow one, and
      // sizing off its width would print the caption twice as large.
      fontSize: 'clamp(9px, 1.5vmin, 15px)',
      letterSpacing: side === 'above' ? '0.26em' : '0.14em',
      textIndent: side === 'above' ? '0.26em' : '0.14em',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    line.style.setProperty('font-size', '2.6cqmin');
  }
  meter.root.append(above, below);

  /** Put the captions where this picture's hole is. */
  const place = (): void => {
    const pc = (n: number): string => `${(n * 100).toFixed(3)}%`;
    above.style.bottom = pc(1 - cut.top + PLACE_LIFT);
    below.style.top = pc(cut.bottom + CAPTION_DROP * 0.5);
  };
  place();

  root.append(meter.root);
  const stopFitting = fitCover(meter.root, root, () => {
    // Asked on every resize, which is where the orientation swap lives:
    // one place that notices the screen changed shape, rather than a
    // second listener that could disagree with this one about when.
    const now = splashFor(window.innerWidth, window.innerHeight);
    if (now.file !== cut.file) {
      cut = now;
      meter.wear(artFor(cut));
      meter.aim(cut);
      place();
    }
    return { ratio: cut.ratio, keepVisible: cut.bottom + CAPTION_DROP };
  });

  return { root, meter, above, below, stopFitting };
}
