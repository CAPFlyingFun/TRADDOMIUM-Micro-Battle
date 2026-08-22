/**
 * A BAR THAT IS THREE FLAT LAYERS AND A HOLE.
 *
 * Joshua's architecture, and it is the right one:
 *
 *     front   a decorative image with the bar's interior cut out
 *     middle  a plain rectangle whose WIDTH is the value
 *     back    a plain dark rectangle, the empty bar
 *
 * The player only sees what shows through the hole, so the fill can be
 * the most boring rectangle in the world while the bar looks carved,
 * rounded, ornate, or any shape at all. Nothing underneath has to match
 * that shape, and the front layer covers the fill's square corners and
 * any rounding error at its edges.
 *
 * That last part is why this exists rather than a `border-radius` and a
 * gradient. The first attempt at the loading bar positioned a fill next
 * to the frame painted into the splash, and every small disagreement
 * about how a 16:9 picture fits a 2.17:1 phone showed up as the bar
 * sitting off its rails. With the picture ON TOP the disagreement is
 * invisible: the fill and the hole are placed in the same box, in the
 * same fractions, so they move together no matter what that box does.
 *
 * The same three layers will do health, food, water, stamina, growth
 * and carry — swap the front image, keep the code.
 */

/** Where the hole is, as fractions of the frame image. */
export interface Window {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface MeterLook {
  /**
   * The decorative image, with the bar's interior cut out of it.
   *
   * An element rather than a URL is allowed, and for the splash it is
   * the point: the same already-decoded picture moves from the boot
   * screen into the loading screen instead of being fetched twice.
   */
  readonly frame: string | HTMLImageElement;
  readonly window: Window;
  /** The empty bar behind the fill. */
  readonly backing?: string;
  /** The fill itself — any CSS background. */
  readonly fill?: string;
  /** Alt text for the frame image. Empty for a purely decorative one. */
  readonly alt?: string;
}

/**
 * How far the hidden layers reach past the hole, as a share of its
 * height.
 *
 * Joshua's "few pixels of opaque overlap" from the other side: rather
 * than ask the artwork to overlap the fill, the fill overlaps the
 * artwork. Same effect, and it survives the image being drawn at any
 * scale — a fixed pixel bleed would be too much on a phone and too
 * little on a desktop. Only the vertical edges bleed. The right-hand
 * edge is the reading, and the left is covered by the frame anyway.
 */
const BLEED = 0.28;

export class Meter {
  /** Shared with anything assembling these layers by hand. */
  static readonly BLEED = BLEED;

  /** The one box every layer is positioned inside. Size this. */
  readonly root: HTMLDivElement;
  /**
   * The three layers, BACK TO FRONT, in the order they are stacked.
   *
   * Held as a list rather than as three fields because that is what
   * they are: one stack, sized by one box, and anything that has to
   * walk them (a resize, a theme, a debug overlay) should not need to
   * know their names.
   */
  readonly layers: readonly HTMLElement[];
  private readonly fill: HTMLDivElement;

  constructor(look: MeterLook) {
    const { left, right, top, bottom } = look.window;
    const tall = bottom - top;
    const bleed = tall * BLEED;
    const pc = (n: number): string => `${(n * 100).toFixed(3)}%`;

    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'relative',
      // The caller sizes this; everything inside is a fraction of it.
      lineHeight: '0',
    } as Partial<CSSStyleDeclaration>);

    const seat = (el: HTMLElement): void => {
      Object.assign(el.style, {
        position: 'absolute',
        left: pc(left),
        top: pc(top - bleed),
        width: pc(right - left),
        height: pc(tall + bleed * 2),
      } as Partial<CSSStyleDeclaration>);
    };

    // BACK — the empty bar.
    const backing = document.createElement('div');
    seat(backing);
    backing.style.background = look.backing ?? 'rgba(6, 8, 5, 0.92)';

    // MIDDLE — the only thing that ever changes.
    const clip = document.createElement('div');
    seat(clip);
    clip.style.overflow = 'hidden';
    this.fill = document.createElement('div');
    // Named so a probe can read the value off the DOM. The fill is the
    // only part of a meter that says anything.
    this.fill.dataset.ui = 'meter-fill';
    Object.assign(this.fill.style, {
      height: '100%',
      width: '0%',
      background: look.fill ?? 'linear-gradient(90deg, #f6c24b 0%, #ff9e2c 52%, #ff5a36 100%)',
      // Nothing here animates on a timer. The width IS the value.
      transition: 'width 180ms linear',
    } as Partial<CSSStyleDeclaration>);
    clip.appendChild(this.fill);

    // FRONT — the artwork, over the top of both.
    const frame = typeof look.frame === 'string'
      ? document.createElement('img')
      : look.frame;
    if (typeof look.frame === 'string') frame.src = look.frame;
    if (look.alt !== undefined) frame.alt = look.alt;
    Object.assign(frame.style, {
      position: 'relative',
      display: 'block',
      width: '100%',
      height: '100%',
      objectFit: 'fill',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);

    this.layers = [backing, clip, frame];
    this.root.append(...this.layers);
  }

  /** Set the reading, 0 to 1. */
  set(fraction: number): void {
    const held = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
    this.fill.style.width = `${(held * 100).toFixed(2)}%`;
  }

}
