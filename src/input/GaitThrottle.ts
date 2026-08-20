/**
 * THE THROTTLE — a readout, not a control.
 *
 * Gait lives entirely on the stick: how far you push decides it. This
 * bar exists so that analog control is never invisible — one slim
 * track with a fill that rises through the notches, so a glance reads
 * how hard she is pushing.
 *
 * Nothing here is tappable. Buttons that pin a gait were tried and cut:
 * they re-introduce the state the stick was meant to replace, and spend
 * screen space the action controls will want.
 *
 * The glyphs are placeholders standing in for real art.
 */
import { GAITS, type Gait } from '../ant/gait';

const GLYPH: Record<Gait, string> = {
  crawl: '🐌',
  walk: '🐜',
  run: '⚡',
};

const TRACK_WIDTH = 34;
const NOTCH_HEIGHT = 44;

export class GaitThrottle {
  private readonly track: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly notches = new Map<Gait, HTMLDivElement>();

  private shown: Gait | null = null;

  constructor(host: HTMLElement) {
    this.track = document.createElement('div');
    this.fill = document.createElement('div');
    this.styleTrack();
    this.track.appendChild(this.fill);

    // Fastest at the top, the way a throttle reads.
    for (const gait of [...GAITS].reverse()) {
      const notch = document.createElement('div');
      notch.textContent = GLYPH[gait];
      notch.setAttribute('aria-label', gait);
      this.styleNotch(notch);
      this.notches.set(gait, notch);
      this.track.appendChild(notch);
    }

    host.appendChild(this.track);
  }

  /** Move the throttle to whatever gait the stick is asking for. */
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
      pointerEvents: 'none',
      zIndex: '12',
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

  private styleNotch(notch: HTMLDivElement): void {
    Object.assign(notch.style, {
      position: 'relative',
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
