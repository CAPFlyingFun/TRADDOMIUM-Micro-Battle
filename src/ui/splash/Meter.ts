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
 * gradient. v0's first loading bar positioned a fill next to the frame
 * painted into the splash, and every small disagreement about how a 16:9
 * picture fits a 2.17:1 phone showed up as the bar sitting off its
 * rails. With the picture ON TOP the disagreement is invisible: the fill
 * and the hole are placed in the same box, in the same fractions, so
 * they move together no matter what that box does.
 *
 * Generic on purpose. The same three layers will do health, food, water,
 * stamina, growth and carry — swap the front image, keep the code. It
 * knows nothing about which picture it wears or where the numbers came
 * from; `SplashStage` supplies both.
 */

/** Where the hole is, as fractions of the frame image. */
export interface MeterWindow {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** How the hidden layers are pointed at a picture: which hole, which side of it, how wide at most. */
export interface MeterAim {
  readonly window: MeterWindow;
  /**
   * Whether the picture goes BEHIND the fill, with the bar drawn on top,
   * rather than IN FRONT with the bar cut out of it.
   *
   * In front is the better-looking of the two — the artwork does all the
   * decoration and hides every rounding error. Behind is the easier one
   * to art, needs no cutting, and is the only one whose bar can be sized
   * against the screen rather than the picture, which is what keeps it
   * off the crop on a tall phone.
   */
  readonly behind?: boolean;
  /**
   * A CSS length the bar may not exceed, for a drawn bar. The picture is
   * wider than the screen when a tall phone crops it, so a bar measured
   * in the picture's width runs off the sides — which is exactly how the
   * first portrait bar lost its left end.
   */
  readonly cap?: string;
}

export interface MeterLook extends MeterAim {
  /**
   * The picture. An element rather than a URL, and for the splash that is
   * the point: the same already-decoded image moves from the boot screen
   * into the loading screen instead of being fetched twice.
   */
  readonly frame: HTMLImageElement;
  /**
   * Assemble the layers AROUND markup that already exists. `frame` is
   * already a descendant of `host` — the boot splash's `<picture>` — and
   * the hidden layers are inserted beside it. Without this the meter
   * builds its own box and puts the frame in it.
   */
  readonly host?: HTMLElement;
  /** A rim around a DRAWN bar, which has no artwork rim of its own. */
  readonly rim?: string;
  /** The empty bar behind the fill. */
  readonly backing?: string;
  /** The fill itself — any CSS background. */
  readonly fill?: string;
}

/**
 * How far the hidden layers reach past a cut-out hole, as a share of its
 * height.
 *
 * Joshua's "few pixels of opaque overlap" from the other side: rather
 * than ask the artwork to overlap the fill, the fill overlaps the
 * artwork. Same effect, and it survives the image being drawn at any
 * scale — a fixed pixel bleed would be too much on a phone and too
 * little on a desktop. Only the vertical edges bleed: the right-hand
 * edge is the reading, and the left is covered by the frame anyway.
 */
const BLEED = 0.28;

const FILL = 'linear-gradient(90deg, #f6c24b 0%, #ff9e2c 52%, #ff5a36 100%)';
const BACKING = 'rgba(6, 8, 5, 0.92)';
/** A drawn bar's own edge, since there is no artwork around it doing that job. */
const ROUND = '999px';

const pc = (n: number): string => `${(n * 100).toFixed(3)}%`;

export class Meter {
  /** Shared with anything assembling these layers by hand. */
  static readonly BLEED = BLEED;

  /** The one box every layer is positioned inside. Size this. */
  readonly root: HTMLElement;
  private readonly fill: HTMLDivElement;
  private readonly backing: HTMLDivElement;
  private readonly clip: HTMLDivElement;
  private readonly rim: string | undefined;
  private frame: HTMLImageElement;
  private behind = false;
  private reading = 0;

  constructor(look: MeterLook) {
    const doc = look.frame.ownerDocument;
    this.root = look.host ?? doc.createElement('div');
    if (!look.host) {
      // The caller sizes this; everything inside is a fraction of it.
      this.root.style.position = 'relative';
      this.root.style.lineHeight = '0';
    }

    // BACK — the empty bar.
    this.backing = doc.createElement('div');
    this.backing.style.background = look.backing ?? BACKING;

    // MIDDLE — the only thing that ever changes.
    this.clip = doc.createElement('div');
    this.clip.style.overflow = 'hidden';
    this.fill = doc.createElement('div');
    // Named so a probe can read the value off the DOM. The fill is the
    // only part of a meter that says anything.
    this.fill.dataset.ui = 'meter-fill';
    this.fill.style.height = '100%';
    this.fill.style.width = '0%';
    this.fill.style.background = look.fill ?? FILL;
    // Nothing here animates on a timer. The width IS the value; the
    // transition only stops a burst of reports from looking like a jump.
    this.fill.style.transition = 'width 180ms linear';
    this.clip.appendChild(this.fill);

    this.rim = look.rim;
    this.frame = dress(look.frame);
    if (!look.host) this.root.appendChild(this.frame);
    this.aim(look);
  }

  /**
   * The three layers, BACK TO FRONT, in the order they are stacked.
   *
   * Read rather than stored because the front one can be swapped —
   * turning the phone changes the artwork — and a stored list would go
   * stale the first time it happened.
   */
  get layers(): readonly HTMLElement[] {
    return this.behind ? [this.frame, this.backing, this.clip] : [this.backing, this.clip, this.frame];
  }

  /** What is on the front right now. */
  get worn(): HTMLImageElement {
    return this.frame;
  }

  /** The last reading set, 0..1. */
  get fraction(): number {
    return this.reading;
  }

  /**
   * Point the hidden layers at a (new) hole, on the right side of it.
   *
   * Called again when the artwork is swapped — turning a phone changes
   * the picture, the bar is somewhere else in the portrait one, and the
   * portrait one is drawn on rather than cut out, so the stacking order
   * changes with it.
   */
  aim(aim: MeterAim): void {
    const { left, right, top, bottom } = aim.window;
    const tall = bottom - top;
    const behind = aim.behind ?? false;
    // A cut-out bar bleeds past the hole so no seam shows at its edge.
    // A drawn one IS its own edge, so bleeding would just make it fat.
    const bleed = behind ? 0 : tall * BLEED;
    for (const el of [this.backing, this.clip]) {
      el.style.position = 'absolute';
      el.style.top = pc(top - bleed);
      el.style.height = pc(tall + bleed * 2);
      el.style.borderRadius = behind ? ROUND : '0';
      if (aim.cap) {
        // CENTRED AND CAPPED. Both boxes share a centre, so centring on
        // the picture centres on the screen too.
        el.style.left = '50%';
        el.style.transform = 'translateX(-50%)';
        el.style.width = `min(${pc(right - left)}, ${aim.cap})`;
      } else {
        el.style.left = pc(left);
        el.style.transform = 'none';
        el.style.width = pc(right - left);
      }
    }
    this.fill.style.borderRadius = behind ? ROUND : '0';
    this.backing.style.boxShadow =
      behind && this.rim ? `0 0 0 1.5px ${this.rim}, 0 2px 14px rgba(0,0,0,.55)` : 'none';
    this.behind = behind;
    this.stack();
  }

  /** Swap the artwork on the front. The layers keep their order around it. */
  wear(art: HTMLImageElement): void {
    if (art === this.frame) return;
    this.frame.replaceWith(dress(art));
    this.frame = art;
  }

  /** Set the reading, 0 to 1. Anything unreadable is an empty bar, never a full one. */
  set(fraction: number): void {
    const held = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
    this.reading = held;
    this.fill.style.width = `${(held * 100).toFixed(2)}%`;
  }

  /**
   * Put the hidden layers on the right side of the picture.
   *
   * Inserted BEFORE the picture in the DOM to be behind it, AFTER it to be
   * in front: the same sandwich whether the meter built its own box or
   * was assembled around a `<picture>` the document painted. The
   * reference node is the picture's outermost wrapper inside the root —
   * for the boot splash that is the `<picture>`, not the `<img>`, and
   * inserting against the wrong one throws.
   */
  private stack(): void {
    let anchor: Element = this.frame;
    while (anchor.parentElement && anchor.parentElement !== this.root) anchor = anchor.parentElement;
    if (this.behind) anchor.after(this.backing, this.clip);
    else anchor.before(this.backing, this.clip);
  }
}

/**
 * Style the picture the way every stage needs it: filling the box exactly,
 * so a fraction of the picture is a fraction of the box. Absolute in both
 * stacking orders, so DOM order alone decides what is in front.
 */
function dress(img: HTMLImageElement): HTMLImageElement {
  img.style.position = 'absolute';
  img.style.inset = '0';
  img.style.display = 'block';
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'fill';
  img.style.pointerEvents = 'none';
  return img;
}
