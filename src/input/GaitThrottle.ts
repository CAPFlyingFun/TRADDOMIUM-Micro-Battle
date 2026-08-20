/**
 * THE THROTTLE — a readout that becomes a control when auto-move is on.
 *
 * While you are driving, gait lives entirely on the stick and this bar
 * only reports it, so the zones you cannot see under your thumb are at
 * least legible. The moment auto-move takes over there is no thumb on
 * the stick to read, so the notches become tappable and this is where
 * the cruising speed is chosen.
 *
 * That split is deliberate: a control that does nothing most of the
 * time would be clutter, and one that competes with the stick would be
 * two ways to say the same thing.
 *
 * The glyphs are placeholders standing in for real art.
 */
import { GAITS, type Gait } from '../ant/gait';

const GLYPH: Record<Gait, string> = {
  crawl: '🐌',
  walk: '🐜',
  sprint: '⚡',
};

const TRACK_WIDTH = 34;
const NOTCH_HEIGHT = 44;

export class GaitThrottle {
  private readonly track: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly notches = new Map<Gait, HTMLButtonElement>();
  private readonly detach: Array<() => void> = [];

  private shown: Gait | null = null;
  private live = false;
  /** Set when a notch is tapped, for the scene to pick up. */
  private asked: Gait | null = null;

  constructor(host: HTMLElement) {
    this.track = document.createElement('div');
    this.fill = document.createElement('div');
    this.styleTrack();
    this.track.appendChild(this.fill);

    // Fastest at the top, the way a throttle reads.
    for (const gait of [...GAITS].reverse()) {
      const notch = document.createElement('button');
      notch.type = 'button';
      notch.textContent = GLYPH[gait];
      notch.setAttribute('aria-label', gait);
      this.styleNotch(notch);
      const onTap = (e: PointerEvent) => {
        if (!this.live) return;
        this.asked = gait;
        e.stopPropagation();
        e.preventDefault();
      };
      notch.addEventListener('pointerdown', onTap);
      this.detach.push(() => notch.removeEventListener('pointerdown', onTap));
      this.notches.set(gait, notch);
      this.track.appendChild(notch);
    }

    host.appendChild(this.track);
  }

  /** Whether the notches can be tapped — true only while auto-move runs. */
  setLive(live: boolean): void {
    if (this.live === live) return;
    this.live = live;
    this.track.style.borderColor = live
      ? 'rgba(143, 224, 168, .8)'
      : 'rgba(255, 210, 110, .5)';
    for (const notch of this.notches.values()) {
      notch.style.pointerEvents = live ? 'auto' : 'none';
      notch.style.cursor = live ? 'pointer' : 'default';
    }
  }

  /** A gait tapped since the last read, or null. */
  takeRequest(): Gait | null {
    const asked = this.asked;
    this.asked = null;
    return asked;
  }

  /** Move the throttle to whatever gait is in force. */
  show(gait: Gait): void {
    if (this.shown === gait) return;
    this.shown = gait;

    // Fill rises to the top of the active notch, so the bar reads as a
    // level rather than a highlighted cell.
    const step = GAITS.indexOf(gait) + 1;
    this.fill.style.height = `${(step / GAITS.length) * 100}%`;

    for (const [at, notch] of this.notches) {
      const live = at === gait;
      notch.style.opacity = live ? '1' : '.45';
      notch.style.transform = live ? 'scale(1.12)' : 'scale(1)';
    }
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.track.remove();
  }

  private styleTrack(): void {
    Object.assign(this.track.style, {
      position: 'fixed',
      left: 'calc(10px + env(safe-area-inset-left))',
      // Clear of the stick and its lock badge below.
      bottom: 'calc(212px + env(safe-area-inset-bottom))',
      width: `${TRACK_WIDTH}px`,
      height: `${NOTCH_HEIGHT * 3}px`,
      display: 'flex',
      flexDirection: 'column',
      borderRadius: `${TRACK_WIDTH / 2}px`,
      border: '2px solid rgba(255, 210, 110, .5)',
      background: 'rgba(18, 14, 6, .42)',
      overflow: 'hidden',
      zIndex: '12',
      transition: 'border-color 140ms ease',
    } satisfies Partial<CSSStyleDeclaration>);

    Object.assign(this.fill.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      bottom: '0',
      height: '33%',
      background: 'linear-gradient(rgba(255,210,110,.5), rgba(255,210,110,.22))',
      transition: 'height 130ms ease',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
  }

  private styleNotch(notch: HTMLButtonElement): void {
    Object.assign(notch.style, {
      position: 'relative',
      appearance: 'none',
      border: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: `${TRACK_WIDTH / 2}px`,
      flex: '1',
      padding: '0',
      background: 'transparent',
      font: '17px/1 system-ui, sans-serif',
      color: 'rgba(255, 226, 160, .95)',
      pointerEvents: 'none',
      transition: 'opacity 130ms ease, transform 130ms ease',
    } satisfies Partial<CSSStyleDeclaration>);
  }
}
