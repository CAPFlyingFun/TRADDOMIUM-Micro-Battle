import { Meter } from './Meter';
import { fitCover } from './ratioBox';
import { SPLASH_RATIO, SPLASH_WINDOW } from './splashFrame';

/**
 * THE SPLASH, AS A BAR.
 *
 * The artwork is not a backdrop with a loading bar near it — it IS the
 * loading bar's front layer, a picture with the bar's interior cut out.
 * So the whole picture becomes one `Meter`: fill behind, art in front,
 * and the only part of the fill anyone sees is the part framed by the
 * hole Joshua cut.
 *
 * Shared, because the boot screen shows this for the elevation download
 * and the spawn screen shows it for the island, and the two drifting
 * apart would be immediately obvious.
 */

const SPLASH = `${import.meta.env.BASE_URL}splash.webp`;

/**
 * THE ONE COPY OF THE ARTWORK, moved from screen to screen.
 *
 * `index.html` paints the splash with the document, so by the time
 * anyone spawns, that image is decoded and on the GPU. Building a
 * second `<img>` with the same URL throws that away and asks the
 * browser for it again — which is free when the cache is warm and, on
 * a slow connection with five megabytes of textures already in flight,
 * is a black screen with a floating bar on it for several seconds. It
 * behaved exactly that way the first time this was measured.
 *
 * Only one splash is ever on screen at once, so one element can simply
 * be re-parented from the boot screen into the loading screen. No
 * refetch, no second decode, nothing to depend on.
 */
let theArt: HTMLImageElement | null = null;

/**
 * Hold on to the boot screen's copy.
 *
 * Called while the boot screen is still in the document, because once
 * it has been removed there is nothing left to query for.
 */
export function keepSplashArt(img: HTMLImageElement): void {
  theArt ??= img;
}

function splashArt(): HTMLImageElement {
  if (!theArt) {
    theArt = new Image();
    theArt.src = SPLASH;
    theArt.alt = 'TRADDOMIUM — Micro Battle!';
  }
  return theArt;
}
/**
 * How far down the picture the lowest thing written on it reaches.
 *
 * The caption under the bar. Covering the screen means cropping the
 * picture's height on a wide phone, and this is what stops the crop
 * taking the readout with it.
 */
export const KEEP_VISIBLE = SPLASH_WINDOW.bottom + 0.075;

export const GOLD = 'rgba(255, 226, 160, 0.94)';
export const GOLD_DIM = 'rgba(255, 226, 160, 0.62)';

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

  const meter = new Meter({
    frame: splashArt(),
    window: SPLASH_WINDOW,
  });
  Object.assign(meter.root.style, {
    // So the captions can be sized against the PICTURE rather than the
    // window — the picture is what they have to sit on.
    containerType: 'size',
  } as Partial<CSSStyleDeclaration>);

  const pc = (n: number): string => `${(n * 100).toFixed(3)}%`;
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
      // anything without container queries; the cqw below overrides it
      // where they exist and is dropped where they do not.
      fontSize: 'clamp(9px, 1.5vw, 15px)',
      letterSpacing: side === 'above' ? '0.26em' : '0.14em',
      textIndent: side === 'above' ? '0.26em' : '0.14em',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    line.style.setProperty('font-size', '1.5cqw');
    if (side === 'above') line.style.bottom = pc(1 - SPLASH_WINDOW.top + 0.048);
    else line.style.top = pc(SPLASH_WINDOW.bottom + 0.038);
  }
  meter.root.append(above, below);

  root.append(meter.root);
  const stopFitting = fitCover(meter.root, root, SPLASH_RATIO, KEEP_VISIBLE);
  return { root, meter, above, below, stopFitting };
}
