/**
 * THE COMPASS STRIP — which way she is looking, along the top.
 *
 * Ported in shape from StormTracker 3D's compass bar and re-dressed in
 * this game's black and gold. The idea worth taking is the TAPE: three
 * copies of 360° laid end to end and slid sideways behind a window, so
 * scrolling is one `translateX` and the wrap at north never shows a
 * seam. Building the ticks once and moving them is also the cheap way
 * — the alternative rewrites thirty-odd DOM nodes every frame, which on
 * a phone is the whole frame budget for something that has not moved.
 *
 * IT FOLLOWS THE CAMERA, NOT HER BODY. On the ground those are nearly
 * the same and the difference is easy to miss; in the air they are
 * completely different, because her heading is hers and the player can
 * look wherever they like. A compass is an answer to "which way am I
 * FACING", and facing means the view.
 *
 * WHERE IT SITS. Top centre, in the gap between the vitals panel on the
 * left and the weather chip and gear on the right, narrow enough to
 * keep out of both on a 932-wide landscape phone. It is the only thing
 * in that gap, which is why it can be there at all.
 *
 * MARKERS ARE BUILT IN FROM THE START. Nothing uses them yet beyond one
 * test pin, but the strip takes a list of global positions and places
 * them every frame, edge-pinning whatever is behind her. That is the
 * whole of the sticky-marker system's geometry; what is left for later
 * is deciding what deserves a marker.
 */
import {
  cardinalOf, easeBearing, place, rangeWords, wrap360,
  type CompassMarker, type PlacedMarker,
} from './compassMath';
import type { WorldPoint } from '../world/coords';

/** Pixels per degree of tape. Sets how fast the strip slides. */
const PX_PER_DEGREE = 2.6;

/** Degrees between ticks, and between the taller ones. */
const TICK_EVERY = 5;
const MAJOR_EVERY = 15;

/**
 * How quickly the strip settles onto the camera. Seconds.
 *
 * NEARLY NOTHING, on purpose. The camera's own yaw is already eased
 * upstream, so any smoothing added here is smoothing a smooth signal —
 * pure lag, no polish. At the original 0.09 a brisk turn left the
 * whole strip trailing ten to eighteen degrees and sliding back into
 * place after the thumb stopped, which read as the ticker drifting
 * right. What remains only irons out single-frame jitter.
 */
const EASE = 0.02;

const GOLD = 'rgba(255, 226, 160, .92)';
const GOLD_DIM = 'rgba(255, 226, 160, .34)';
const GOLD_FAINT = 'rgba(255, 226, 160, .16)';

const CARDINALS: Record<number, string> = {
  0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW',
};

export class Compass {
  private readonly root: HTMLDivElement;
  private readonly window: HTMLDivElement;
  private readonly tape: HTMLDivElement;
  private readonly readout: HTMLDivElement;
  private readonly pins = new Map<string, HTMLDivElement>();
  /** What the strip is SHOWING, which chases what the camera is doing. */
  private shown = 0;
  private started = false;
  private lastRead = '';

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.dataset.ui = 'compass';
    Object.assign(this.root.style, {
      position: 'fixed',
      top: 'calc(8px + min(env(safe-area-inset-top), 12px))',
      left: '50%',
      transform: 'translateX(-50%)',
      // Narrow enough to clear the vitals panel on the left and the
      // weather chip on the right, on the smallest landscape this game
      // supports. It is a strip, not a dial; it does not need width.
      width: 'min(320px, 34vw)',
      pointerEvents: 'none',
      zIndex: '13',
    } as Partial<CSSStyleDeclaration>);

    this.window = document.createElement('div');
    Object.assign(this.window.style, {
      position: 'relative',
      height: '30px',
      overflow: 'hidden',
      borderRadius: '8px',
      border: `1px solid ${GOLD_FAINT}`,
      background: 'rgba(14, 12, 10, .55)',
      backdropFilter: 'blur(3px)',
    } as Partial<CSSStyleDeclaration>);

    this.tape = document.createElement('div');
    Object.assign(this.tape.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      height: '100%',
      whiteSpace: 'nowrap',
      willChange: 'transform',
    } as Partial<CSSStyleDeclaration>);
    this.tape.innerHTML = buildTape();
    this.tape.style.width = `${360 * 3 * PX_PER_DEGREE}px`;
    this.window.appendChild(this.tape);

    // The centre mark: a gold notch reading down onto the tape.
    const mark = document.createElement('div');
    Object.assign(mark.style, {
      position: 'absolute',
      top: '0',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '0',
      height: '0',
      borderLeft: '5px solid transparent',
      borderRight: '5px solid transparent',
      borderTop: `6px solid ${GOLD}`,
      zIndex: '3',
    } as Partial<CSSStyleDeclaration>);
    this.window.appendChild(mark);

    this.root.appendChild(this.window);

    this.readout = document.createElement('div');
    this.readout.dataset.ui = 'compass-heading';
    Object.assign(this.readout.style, {
      marginTop: '2px',
      textAlign: 'center',
      font: '700 10px/1 "JetBrains Mono", ui-monospace, monospace',
      letterSpacing: '.08em',
      color: GOLD,
      textShadow: '0 1px 3px rgba(0,0,0,.8)',
    } as Partial<CSSStyleDeclaration>);
    this.root.appendChild(this.readout);

    host.appendChild(this.root);
  }

  /**
   * One frame.
   *
   * @param bearing where the CAMERA is looking, degrees from north
   * @param from her GLOBAL position, for placing markers
   * @param markers what to point at. Empty is fine and costs nothing.
   * @param dt simulated seconds
   */
  update(
    bearing: number, from: WorldPoint, markers: readonly CompassMarker[],
    dt: number,
  ): void {
    // Arrive pointing the right way rather than spinning up to it.
    this.shown = this.started
      ? easeBearing(this.shown, bearing, dt, EASE)
      : wrap360(bearing);
    this.started = true;

    // The MIDDLE copy of the three, so there is a full turn of tape on
    // either side and the wrap at north never reaches an end.
    const half = this.window.clientWidth / 2;
    const slide = half - (this.shown + 360) * PX_PER_DEGREE;
    this.tape.style.transform = `translateX(${slide.toFixed(1)}px)`;

    // Modulo AFTER rounding: 359.7 rounds to 360, and a compass that
    // says "N 360" instead of "N 000" is wrong once a revolution.
    const degrees = Math.round(this.shown) % 360;
    const words = `${cardinalOf(this.shown)} ${String(degrees).padStart(3, '0')}°`;
    if (words !== this.lastRead) {
      this.lastRead = words;
      this.readout.textContent = words;
    }

    this.drawMarkers(from, markers, half);
  }

  /**
   * Markers are placed against the SHOWN bearing, not the true one, so
   * they slide with the tape instead of swimming against it while the
   * strip is still catching up.
   */
  private drawMarkers(
    from: WorldPoint, markers: readonly CompassMarker[], half: number,
  ): void {
    const spread = half / PX_PER_DEGREE;
    const alive = new Set<string>();

    for (const marker of markers) {
      alive.add(marker.id);
      const placed = place(marker, from, this.shown, spread);
      let pin = this.pins.get(marker.id);
      if (!pin) {
        pin = this.makePin(placed);
        this.pins.set(marker.id, pin);
        this.window.appendChild(pin);
      }
      this.dressPin(pin, placed, half);
    }

    for (const [id, pin] of this.pins) {
      if (alive.has(id)) continue;
      pin.remove();
      this.pins.delete(id);
    }
  }

  private makePin(marker: PlacedMarker): HTMLDivElement {
    const pin = document.createElement('div');
    pin.dataset.marker = marker.id;
    Object.assign(pin.style, {
      position: 'absolute',
      top: '1px',
      transform: 'translateX(-50%)',
      font: '700 9px/1.15 "JetBrains Mono", ui-monospace, monospace',
      letterSpacing: '.04em',
      textAlign: 'center',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      zIndex: '2',
    } as Partial<CSSStyleDeclaration>);
    return pin;
  }

  private dressPin(pin: HTMLDivElement, marker: PlacedMarker, half: number): void {
    // A MARKER IN VIEW IS CENTRED ON ITS BEARING; a pinned one is
    // tucked inside the edge instead. Centring a pinned marker puts
    // half its label outside a window that clips, so "START" arrives as
    // "STA" — the one thing a direction marker must not do is become
    // unreadable at exactly the moment it is telling you to turn round.
    const x = half + marker.offset * PX_PER_DEGREE;
    if (marker.side === -1) {
      pin.style.left = '3px';
      pin.style.transform = 'none';
      pin.style.textAlign = 'left';
    } else if (marker.side === 1) {
      pin.style.left = `${half * 2 - 3}px`;
      pin.style.transform = 'translateX(-100%)';
      pin.style.textAlign = 'right';
    } else {
      pin.style.left = `${x}px`;
      pin.style.transform = 'translateX(-50%)';
      pin.style.textAlign = 'center';
    }
    pin.style.color = marker.colour;
    // An arrow on a pinned marker, on the side it is pinned to, so
    // "off the left edge" is legible without reading the number.
    const arrow = marker.side === -1 ? '‹' : marker.side === 1 ? '›' : '';
    const label = marker.side === -1 ? `${arrow}${marker.label}`
      : marker.side === 1 ? `${marker.label}${arrow}` : marker.label;
    const text = `${label}\n${rangeWords(marker.range)}`;
    if (pin.dataset.text === text) return;
    pin.dataset.text = text;
    pin.textContent = '';
    const top = document.createElement('div');
    top.textContent = label;
    const under = document.createElement('div');
    under.textContent = rangeWords(marker.range);
    under.style.opacity = '.6';
    under.style.fontSize = '8px';
    pin.append(top, under);
  }

  dispose(): void {
    this.root.remove();
  }
}

/**
 * Three turns of tape, built once.
 *
 * Three rather than one because the strip has to show a window either
 * side of centre without ever running off an end: the middle copy is
 * the one on screen and the outer two are what the window looks into
 * when the heading is near north.
 */
function buildTape(): string {
  const parts: string[] = [];
  for (let turn = 0; turn < 3; turn += 1) {
    for (let d = 0; d < 360; d += TICK_EVERY) {
      const x = (turn * 360 + d) * PX_PER_DEGREE;
      const card = CARDINALS[d];
      const major = d % MAJOR_EVERY === 0;
      const height = card ? 12 : major ? 8 : 5;
      const shade = card ? GOLD : major ? GOLD_DIM : GOLD_FAINT;
      parts.push(
        `<div style="position:absolute;top:0;left:${x}px;width:1px;`
        + `height:${height}px;background:${shade}"></div>`,
      );
      if (card) {
        const strong = d % 90 === 0;
        parts.push(
          `<div style="position:absolute;top:13px;left:${x}px;`
          + 'transform:translateX(-50%);font:'
          + `${strong ? '700 11px' : '500 9px'}/1 "JetBrains Mono",ui-monospace,monospace;`
          + `color:${strong ? GOLD : GOLD_DIM};letter-spacing:.06em">${card}</div>`,
        );
      }
    }
  }
  return parts.join('');
}
