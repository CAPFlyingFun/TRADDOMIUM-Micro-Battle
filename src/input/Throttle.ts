/**
 * THE THROTTLE GAUGE — a warship telegraph for an ant.
 *
 * A ladder of notches with the setting marked and a fill running from
 * Stop toward it, so a glance reads both which way she is going and how
 * hard. Tap a notch to go there: stepping one along and dropping from a
 * sprint straight to astern are the same gesture, which matters when
 * the thing you are reversing away from is already on top of you.
 *
 * The sprint notch doubles as the stamina meter. It is the only notch
 * that costs anything to hold, so it is the only one that needs to show
 * a reserve, and putting the bar inside the control it limits saves a
 * separate readout.
 */
import {
  COSTS_STAMINA, NOTCHES, NOTCH_MARK, NOTCH_NAME, NOTCH_SPEED, type Notch,
} from '../ant/gait';

const TRACK_WIDTH = 50;
const NOTCH_HEIGHT = 30;

export class Throttle {
  private readonly track: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly readout: HTMLDivElement;
  private readonly cells = new Map<Notch, HTMLButtonElement>();
  private readonly reserves = new Map<Notch, HTMLDivElement>();
  private readonly detach: Array<() => void> = [];

  private asked: Notch | null = null;
  private steps = 0;
  private shown: Notch | null = null;
  private shownStamina = -1;
  private shownSpent = false;

  constructor(host: HTMLElement) {
    this.track = document.createElement('div');
    this.fill = document.createElement('div');
    this.readout = document.createElement('div');
    this.styleTrack();
    this.track.append(this.fill);

    // Fastest ahead at the top, astern at the bottom, the way a
    // telegraph reads.
    for (const notch of [...NOTCHES].reverse()) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.setAttribute('aria-label', NOTCH_NAME[notch]);
      this.styleCell(cell);

      if (notch === COSTS_STAMINA) {
        const reserve = document.createElement('div');
        this.styleReserve(reserve);
        cell.appendChild(reserve);
        this.reserves.set(notch, reserve);
      }

      const mark = document.createElement('span');
      mark.textContent = NOTCH_MARK[notch];
      mark.style.position = 'relative';
      mark.style.letterSpacing = '-1px';
      cell.appendChild(mark);

      const onTap = (e: PointerEvent) => {
        this.asked = notch;
        e.stopPropagation();
        e.preventDefault();
      };
      cell.addEventListener('pointerdown', onTap);
      this.detach.push(() => cell.removeEventListener('pointerdown', onTap));

      this.cells.set(notch, cell);
      this.track.appendChild(cell);
    }

    this.styleReadout();
    host.append(this.track, this.readout);

    // W and S work the telegraph, A and D steer — the arrangement the
    // warship games settled on, and the reason this control exists.
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.steps += 1;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') this.steps -= 1;
    };
    window.addEventListener('keydown', onKey);
    this.detach.push(() => window.removeEventListener('keydown', onKey));
  }

  /** Net notches asked for by the keyboard since the last read. */
  takeStep(): number {
    const steps = this.steps;
    this.steps = 0;
    return steps;
  }

  /** A notch tapped since the last read, or null. */
  takeRequest(): Notch | null {
    const asked = this.asked;
    this.asked = null;
    return asked;
  }

  /** Show the setting in force, and what is left in the tank. */
  show(notch: Notch, stamina: number, spent: boolean): void {
    if (this.shown !== notch) {
      this.shown = notch;

      // The fill runs from the Stop line out to the live notch, so
      // ahead and astern read as opposite directions rather than as
      // more or less of the same thing.
      const stop = NOTCHES.indexOf('stop');
      const at = NOTCHES.indexOf(notch);
      const step = 100 / NOTCHES.length;
      const from = Math.min(stop, at);
      const span = Math.abs(at - stop);
      this.fill.style.bottom = `${from * step}%`;
      this.fill.style.height = `${(span + (span === 0 ? 0 : 1)) * step}%`;
      this.fill.style.background = NOTCH_SPEED[notch] < 0
        ? 'linear-gradient(rgba(255,150,110,.42), rgba(255,150,110,.18))'
        : 'linear-gradient(rgba(255,210,110,.5), rgba(255,210,110,.2))';

      for (const [at2, cell] of this.cells) {
        const live = at2 === notch;
        cell.style.opacity = live ? '1' : '.45';
        cell.style.color = live
          ? 'rgba(255, 244, 214, 1)'
          : 'rgba(255, 226, 160, .9)';
      }

      // One world unit is about a centimetre, which is a speed an ant
      // can be described in.
      const speed = Math.abs(NOTCH_SPEED[notch]);
      this.readout.textContent = speed === 0 ? '—' : `${speed.toFixed(1)} cm/s`;
    }

    if (stamina !== this.shownStamina || spent !== this.shownSpent) {
      this.shownStamina = stamina;
      this.shownSpent = spent;
      const reserve = this.reserves.get(COSTS_STAMINA);
      if (reserve) {
        reserve.style.height = `${Math.max(0, Math.min(1, stamina)) * 100}%`;
        reserve.style.background = spent
          ? 'rgba(255, 120, 96, .38)'
          : 'rgba(143, 224, 168, .34)';
      }
      const cell = this.cells.get(COSTS_STAMINA);
      if (cell) cell.style.filter = spent ? 'grayscale(1)' : 'none';
    }
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.track.remove();
    this.readout.remove();
  }

  private styleTrack(): void {
    Object.assign(this.track.style, {
      position: 'fixed',
      left: 'calc(10px + env(safe-area-inset-left))',
      bottom: 'calc(196px + env(safe-area-inset-bottom))',
      width: `${TRACK_WIDTH}px`,
      height: `${NOTCH_HEIGHT * NOTCHES.length}px`,
      display: 'flex',
      flexDirection: 'column',
      borderRadius: '14px',
      border: '2px solid rgba(255, 210, 110, .5)',
      background: 'rgba(18, 14, 6, .44)',
      overflow: 'hidden',
      touchAction: 'none',
      userSelect: 'none',
      zIndex: '12',
    } as Partial<CSSStyleDeclaration>);

    Object.assign(this.fill.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      bottom: '0',
      height: '0',
      transition: 'height 110ms ease, bottom 110ms ease',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
  }

  private styleCell(cell: HTMLButtonElement): void {
    Object.assign(cell.style, {
      position: 'relative',
      appearance: 'none',
      border: '0',
      background: 'transparent',
      flex: '1',
      padding: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      font: '600 15px/1 "Chakra Petch", system-ui, sans-serif',
      color: 'rgba(255, 226, 160, .9)',
      touchAction: 'none',
      cursor: 'pointer',
      transition: 'opacity 120ms ease, color 120ms ease',
    } as Partial<CSSStyleDeclaration>);
  }

  private styleReserve(reserve: HTMLDivElement): void {
    Object.assign(reserve.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      bottom: '0',
      height: '100%',
      background: 'rgba(143, 224, 168, .34)',
      pointerEvents: 'none',
      transition: 'background 160ms ease',
    } as Partial<CSSStyleDeclaration>);
  }

  private styleReadout(): void {
    Object.assign(this.readout.style, {
      position: 'fixed',
      left: 'calc(10px + env(safe-area-inset-left))',
      bottom: 'calc(170px + env(safe-area-inset-bottom))',
      width: `${TRACK_WIDTH}px`,
      textAlign: 'center',
      font: '600 11px/1 "JetBrains Mono", ui-monospace, monospace',
      color: 'rgba(255, 226, 160, .72)',
      userSelect: 'none',
      pointerEvents: 'none',
      zIndex: '12',
    } as Partial<CSSStyleDeclaration>);
    this.readout.textContent = '—';
  }
}
