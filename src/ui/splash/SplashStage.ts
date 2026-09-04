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
 * swaps the art, re-aims the fill at the other hole, re-stacks the
 * layers (the portrait bar is drawn ON the picture, not cut out of it)
 * and re-fits the box, all off the one resize.
 *
 * Shared, because the boot splash shows this while the app arrives and
 * the loading screen shows it for the world, and the two drifting apart
 * would be immediately obvious. The boot splash's picture is painted by
 * the document (index.html), so the stage can also be assembled AROUND
 * markup that already exists.
 */
import { fitCover } from './fitCover';
import { Meter } from './Meter';
import { SPLASH_LANDSCAPE, splashFor, type SplashCut } from './splashFrame';
import './splash.css';

/** Alt text for the key art, wherever an `<img>` for it is created. */
export const SPLASH_ALT = 'TRADDOMIUM: Micro Battle!';

/**
 * How far past the bar the lowest thing written on it reaches.
 *
 * Covering the screen means cropping the picture on a shape it was not
 * composed for, and this is what stops the crop taking the readout with
 * it. A share of the picture's height, below the hole.
 */
const CAPTION_DROP = 0.075;

/** The gap above the hole where the heading sits. */
const PLACE_LIFT = 0.048;

/** Clear space to leave beyond a CUT-OUT bar before cropping into it. */
const SIDE_MARGIN = 0.02;

/**
 * How wide a DRAWN bar may get, against the screen rather than the
 * picture. A tall phone crops the sides off a portrait picture, so a
 * bar measured in the picture's width runs off them.
 */
const DRAWN_CAP = 'min(78vw, 460px)';

/** The rim on a drawn bar. A cut-out one gets its edge from the art. */
const RIM = 'rgba(255, 214, 140, .75)';

const pc = (n: number): string => `${(n * 100).toFixed(3)}%`;

/**
 * THE ONE COPY OF EACH PICTURE, moved from screen to screen.
 *
 * `index.html` paints the splash with the document, so by the time the
 * menu is up that image is decoded and on the GPU. Building a second
 * `<img>` with the same URL asks the browser for it again — free when
 * the cache is warm and, on a slow connection with the world's assets
 * in flight, a black screen with a floating bar on it for several
 * seconds. v0 measured exactly that the first time.
 *
 * Only one splash is on screen at once, so one element per orientation
 * can simply be re-parented from the boot splash into the loading
 * screen. No refetch, no second decode, nothing to depend on.
 */
const kept = new Map<string, HTMLImageElement>();

/** Hold on to an image the document already has, while it still exists to be found. */
export function keepSplashArt(cut: SplashCut, img: HTMLImageElement): void {
  if (!kept.has(cut.file)) kept.set(cut.file, img);
}

function freshArt(cut: SplashCut, doc: Document): HTMLImageElement {
  const img = doc.createElement('img');
  img.src = `${import.meta.env.BASE_URL}${cut.file}`;
  img.alt = SPLASH_ALT;
  return img;
}

function artFor(cut: SplashCut, doc: Document): HTMLImageElement {
  const had = kept.get(cut.file);
  // Verified, not trusted: the boot splash's copy lives inside a
  // `<picture>` with an orientation query, so turning the phone while
  // it is still there swaps what it is showing out from under the key
  // it was filed by.
  if (had && (had.currentSrc || had.src).endsWith(`/${cut.file}`)) return had;
  const img = freshArt(cut, doc);
  kept.set(cut.file, img);
  return img;
}

/** Resolves when the picture has PIXELS, not merely bytes; never rejects. */
function painted(img: HTMLImageElement): Promise<void> {
  // `decode()` rather than `load`: an image that has finished
  // downloading still has to be turned into something paintable, and
  // that work queues behind whatever else the main thread is doing.
  // jsdom has no decode(); there, there is nothing to wait for.
  if (typeof img.decode !== 'function') return Promise.resolve();
  // A picture that will not decode must not hold the screen shut.
  return img.decode().catch(() => undefined);
}

export interface Stage {
  /** Covers the screen; the stage sits inside it. */
  readonly root: HTMLElement;
  readonly meter: Meter;
  /** A caption above the bar, clear of the wordmark. */
  readonly above: HTMLElement;
  /** A caption below the bar, in the art's open forest floor. */
  readonly below: HTMLElement;
  /** Resolves once the picture is decoded (see `painted`). */
  readonly whenPainted: Promise<void>;
  /** Which picture is on the stage now. Changes when the phone is turned. */
  readonly cut: () => SplashCut;
  readonly stopFitting: () => void;
}

/** Markup the document already painted, for the stage to be assembled around. */
export interface ExistingStage {
  /** The element the stage covers: `#boot`. */
  readonly root: HTMLElement;
  /** The box the picture already sits in; it becomes the meter's box. */
  readonly stage: HTMLElement;
  /** The picture the document painted. */
  readonly art: HTMLImageElement;
}

export interface StageOptions {
  /** Assemble the stage around the boot markup instead of building one. */
  readonly around?: ExistingStage;
  /** Where to build a fresh stage. Defaults to the global document. */
  readonly document?: Document;
}

export function buildStage(options: StageOptions = {}): Stage {
  const doc = options.around?.root.ownerDocument ?? options.document ?? document;
  const view = doc.defaultView;
  /** The picture composed for the shape the screen is now. */
  const wanted = (): SplashCut => (view ? splashFor(view.innerWidth, view.innerHeight) : SPLASH_LANDSCAPE);

  let cut = wanted();
  let root: HTMLElement;
  let meter: Meter;
  if (options.around) {
    const { art } = options.around;
    root = options.around.root;
    // PIN THE SOURCE. An `<img>` inside a `<picture>` resolves the
    // orientation query only WHILE IT IS THERE. Re-parent it into the
    // loading screen later and the browser re-runs the selection with
    // no `<source>` beside it and silently falls back to the `src`
    // attribute: the landscape picture, stretched into a portrait box.
    // Pinning the URL ends the element's dependence on its neighbours.
    art.src = `${import.meta.env.BASE_URL}${cut.file}`;
    // Claim it now, while the boot splash still exists: the loading
    // screen re-parents this very element rather than asking the
    // browser for the picture a second time.
    keepSplashArt(cut, art);
    meter = new Meter({ frame: art, host: options.around.stage, window: cut, rim: RIM });
  } else {
    root = doc.createElement('div');
    root.className = 'splash-root';
    meter = new Meter({ frame: artFor(cut, doc), window: cut, rim: RIM });
    root.appendChild(meter.root);
  }
  meter.root.classList.add('splash-stage');

  const above = doc.createElement('div');
  above.className = 'splash-caption splash-caption--above';
  const below = doc.createElement('div');
  below.className = 'splash-caption splash-caption--below';
  meter.root.append(above, below);

  /** Put the bar and the captions where this picture wants them. */
  const place = (): void => {
    const drawn = cut.kind === 'drawn';
    meter.aim({ window: cut, behind: drawn, cap: drawn ? DRAWN_CAP : undefined });
    above.style.bottom = pc(1 - cut.top + PLACE_LIFT);
    below.style.top = pc(cut.bottom + CAPTION_DROP * 0.5);
  };
  place();

  const stopFitting = fitCover(meter.root, root, () => {
    // Asked on every resize, which is where the orientation swap lives:
    // one place that notices the screen changed shape, rather than a
    // second listener that could disagree with this one about when.
    const now = wanted();
    if (now.file !== cut.file) {
      cut = now;
      // The boot splash's `<picture>` swaps its own image; a built stage
      // has to be handed the other one.
      if (!options.around) meter.wear(artFor(cut, doc));
      place();
    }
    return {
      ratio: cut.ratio,
      keepVisible: cut.bottom + CAPTION_DROP,
      // A drawn bar is already capped to the screen, so nothing about
      // it needs the crop held back; only a cut-out one does.
      keepWide: cut.kind === 'cutout' ? cut.right - cut.left + SIDE_MARGIN * 2 : 0,
    };
  });

  return {
    root,
    meter,
    above,
    below,
    whenPainted: painted(meter.worn),
    cut: () => cut,
    stopFitting,
  };
}
