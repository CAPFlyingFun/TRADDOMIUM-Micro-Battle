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
   * The picture. An element rather than a URL is allowed, and for the
   * splash it is the point: the same already-decoded image moves from
   * the boot screen into the loading screen instead of being fetched
   * twice.
   */
  readonly frame: string | HTMLImageElement;
  /**
   * Whether the picture goes IN FRONT of the fill, with the bar cut out
   * of it, or BEHIND, with the bar drawn on top.
   *
   * In front is the better-looking of the two — the artwork does all
   * the decoration and hides every rounding error. Behind is the easier
   * one to art, needs no cutting, and is the only one whose bar can be
   * sized against the screen rather than the picture, which is what
   * keeps it off the crop on a tall phone.
   */
  readonly behind?: boolean;
  /** A rim around the bar. For a drawn one, which has no artwork rim. */
  readonly rim?: string;
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
  private readonly fill: HTMLDivElement;
  private readonly backing: HTMLDivElement;
  private readonly clip: HTMLDivElement;
  private frame: HTMLImageElement;
  private readonly behind: boolean;
  /** A CSS length the bar may not exceed. See `aim`. */
  private cap: string | null = null;

  /**
   * The three layers, BACK TO FRONT, in the order they are stacked.
   *
   * Read rather than stored because the front one can be swapped —
   * turning the phone changes the artwork — and a stored list would go
   * stale the first time it happened.
   */
  get layers(): readonly HTMLElement[] {
    return this.behind
      ? [this.frame, this.backing, this.clip]
      : [this.backing, this.clip, this.frame];
  }

  constructor(look: MeterLook) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'relative',
      // The caller sizes this; everything inside is a fraction of it.
      lineHeight: '0',
    } as Partial<CSSStyleDeclaration>);

    // BACK — the empty bar.
    const backing = document.createElement('div');
    backing.style.background = look.backing ?? 'rgba(6, 8, 5, 0.92)';

    // MIDDLE — the only thing that ever changes.
    const clip = document.createElement('div');
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

    // The artwork, in front of both layers or behind them.
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

    if (look.behind) {
      Object.assign(frame.style, { position: 'absolute', inset: '0' } as Partial<CSSStyleDeclaration>);
      // A drawn bar needs its own edges: rounded, and rimmed if asked,
      // because there is no artwork around it doing that job.
      const round = '999px';
      backing.style.borderRadius = round;
      clip.style.borderRadius = round;
      this.fill.style.borderRadius = round;
      if (look.rim) {
        backing.style.boxShadow = `0 0 0 1.5px ${look.rim}, 0 2px 14px rgba(0,0,0,.55)`;
      }
    }

    this.backing = backing;
    this.clip = clip;
    this.frame = frame;
    this.behind = Boolean(look.behind);
    this.root.append(...(look.behind ? [frame, backing, clip] : [backing, clip, frame]));
    this.aim(look.window);
  }

  /**
   * Point the hidden layers at a (new) hole.
   *
   * Called again when the artwork is swapped — turning a phone changes
   * the picture, and the bar is somewhere else in the portrait one.
   */
  aim(window: Window, cap?: string): void {
    const { left, right, top, bottom } = window;
    const tall = bottom - top;
    // A cut-out bar bleeds past the hole so no seam shows at its edge.
    // A drawn one IS its own edge, so bleeding would just make it fat.
    const bleed = this.behind ? 0 : tall * BLEED;
    const pc = (n: number): string => `${(n * 100).toFixed(3)}%`;
    this.cap = cap ?? this.cap;
    for (const el of [this.backing, this.clip]) {
      Object.assign(el.style, {
        position: 'absolute',
        top: pc(top - bleed),
        height: pc(tall + bleed * 2),
      } as Partial<CSSStyleDeclaration>);
      if (this.cap) {
        // CENTRED AND CAPPED. The picture is wider than the screen when
        // a tall phone crops it, so a bar measured in the picture's
        // width runs off the sides — which is exactly how the first
        // portrait bar lost its left end. Both boxes share a centre, so
        // centring on the picture centres on the screen.
        el.style.left = '50%';
        el.style.transform = 'translateX(-50%)';
        el.style.width = `min(${pc(right - left)}, ${this.cap})`;
      } else {
        el.style.left = pc(left);
        el.style.width = pc(right - left);
      }
    }
  }

  /** Swap the artwork on the front. */
  wear(art: HTMLImageElement): void {
    if (art === this.frame) return;
    this.frame.replaceWith(art);
    this.frame = art;
  }

  /** What is on the front right now. */
  get worn(): HTMLImageElement {
    return this.frame;
  }

  /** Set the reading, 0 to 1. */
  set(fraction: number): void {
    const held = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
    this.fill.style.width = `${(held * 100).toFixed(2)}%`;
  }

}
