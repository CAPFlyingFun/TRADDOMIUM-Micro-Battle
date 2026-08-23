/**
 * THE VERTICAL CONTROL — a lever that springs back to the middle.
 *
 * It replaces two hold-buttons, and the reason is that two buttons can
 * only ever ask for one rate. Held in the mountains on a rising wind
 * she could not get down: full descent was a fixed 26 cm/s whether she
 * needed a nudge or needed OUT, and there was no way to ask for more
 * because the button was already all the way pressed.
 *
 * A lever has an amount. Push it a little for a little, push it to the
 * stop and hold for everything the wings have — and the flight model
 * ramps the authority with the hold (see LIFT_RAMP), so the stop is
 * not a teleport either.
 *
 * SPRINGS BACK, over a second, because level is the thing she spends
 * most of her time wanting and a control that stays where you left it
 * makes holding an altitude a chore. Release is "stop climbing", not
 * "stop touching the screen and hope".
 *
 * ON THE GROUND it is a takeoff: shove it up past the detent and she
 * goes, which is the same gesture as asking to climb and reads as the
 * same intention.
 */

/** Seconds for an untouched lever to come home. */
export const RETURN = 1;

/** Past this from centre counts as asking for something. */
export const DEADZONE = 0.08;

/** Shove it this far up on the ground and she takes off. */
export const TAKEOFF_DETENT = 0.55;

const TRACK_H = 168;
const KNOB_H = 46;

export class LiftSlider {
  private readonly root: HTMLDivElement;
  private readonly track: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly detach: Array<() => void> = [];
  /** −1 down, +1 up, 0 centred. */
  private at = 0;
  private gripped: number | null = null;
  private armed = true;
  private takeoffs = 0;
  private on = true;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.dataset.control = 'lift';
    Object.assign(this.root.style, {
      position: 'fixed',
      right: 'calc(14px + min(env(safe-area-inset-right), 14px))',
      bottom: 'calc(18px + min(env(safe-area-inset-bottom), 14px))',
      width: '58px',
      height: `${TRACK_H}px`,
      touchAction: 'none',
      zIndex: '14',
      userSelect: 'none',
    } as Partial<CSSStyleDeclaration>);

    this.track = document.createElement('div');
    Object.assign(this.track.style, {
      position: 'absolute',
      inset: '0',
      borderRadius: '29px',
      border: '2px solid rgba(214, 178, 96, .75)',
      background: 'linear-gradient(180deg,'
        + ' rgba(52, 86, 62, .55) 0%,'
        + ' rgba(26, 20, 12, .62) 50%,'
        + ' rgba(86, 52, 40, .55) 100%)',
      boxShadow: 'inset 0 0 14px rgba(0, 0, 0, .55)',
    } as Partial<CSSStyleDeclaration>);
    this.root.appendChild(this.track);

    // The centre detent, so "level" is a place on the control and not
    // just the absence of a push.
    const mark = document.createElement('div');
    Object.assign(mark.style, {
      position: 'absolute', left: '8px', right: '8px', top: '50%',
      height: '1px', background: 'rgba(214, 178, 96, .5)',
    } as Partial<CSSStyleDeclaration>);
    this.root.appendChild(mark);

    this.knob = document.createElement('div');
    Object.assign(this.knob.style, {
      position: 'absolute',
      left: '5px', right: '5px',
      height: `${KNOB_H}px`,
      top: `${(TRACK_H - KNOB_H) / 2}px`,
      borderRadius: '22px',
      border: '2px solid rgba(255, 226, 160, .9)',
      background: 'radial-gradient(circle at 50% 35%,'
        + ' rgba(120, 106, 74, .96), rgba(46, 38, 24, .96))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      font: '700 15px/1 system-ui, sans-serif',
      color: 'rgba(255, 236, 190, .95)',
      willChange: 'transform',
    } as Partial<CSSStyleDeclaration>);
    this.knob.textContent = '⇕';
    this.root.appendChild(this.knob);

    host.appendChild(this.root);
    this.listen();
  }

  /** How far she is being asked to climb, −1 to 1. */
  get lift(): number {
    return this.on ? this.at : 0;
  }

  /** Whether the lever was shoved up past the detent since last asked. */
  takeTakeoff(): boolean {
    const asked = this.takeoffs > 0;
    this.takeoffs = 0;
    return asked;
  }

  /** Grey it out — an exhausted queen cannot ask to climb. */
  enable(state: 'full' | 'takeoff' | 'off'): void {
    const was = this.on;
    this.on = state !== 'off';
    this.root.style.opacity = this.on ? '1' : '.45';
    this.knob.textContent = state === 'takeoff' ? '🪽' : '⇕';
    if (was && !this.on) {
      this.gripped = null;
      this.at = 0;
      this.draw();
    }
  }

  /**
   * Let go and it comes home. Linear rather than eased, because the
   * spring is a promise about WHEN — one second, every time — and an
   * exponential never quite arrives.
   */
  update(dt: number): void {
    if (this.gripped !== null || this.at === 0) return;
    const step = dt / RETURN;
    this.at = this.at > 0
      ? Math.max(0, this.at - step)
      : Math.min(0, this.at + step);
    this.draw();
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.root.remove();
  }

  private listen(): void {
    const down = (e: PointerEvent) => {
      if (!this.on) return;
      e.preventDefault();
      this.root.setPointerCapture(e.pointerId);
      this.gripped = e.pointerId;
      this.armed = true;
      this.grab(e);
    };
    const move = (e: PointerEvent) => {
      if (this.gripped !== e.pointerId) return;
      e.preventDefault();
      this.grab(e);
    };
    const up = (e: PointerEvent) => {
      if (this.gripped !== e.pointerId) return;
      this.gripped = null;
      this.root.releasePointerCapture?.(e.pointerId);
    };
    this.root.addEventListener('pointerdown', down);
    this.root.addEventListener('pointermove', move);
    this.root.addEventListener('pointerup', up);
    this.root.addEventListener('pointercancel', up);
    this.detach.push(
      () => this.root.removeEventListener('pointerdown', down),
      () => this.root.removeEventListener('pointermove', move),
      () => this.root.removeEventListener('pointerup', up),
      () => this.root.removeEventListener('pointercancel', up),
    );

    // The keys the two buttons had, so a desk test still flies.
    const key = (e: KeyboardEvent, to: number) => {
      if (e.repeat) return;
      if (e.code === 'Space') this.press(to);
      if (e.code === 'ShiftLeft') this.press(-to);
    };
    const held = (e: KeyboardEvent) => key(e, 1);
    const freed = (e: KeyboardEvent) => key(e, 0);
    window.addEventListener('keydown', held);
    window.addEventListener('keyup', freed);
    this.detach.push(
      () => window.removeEventListener('keydown', held),
      () => window.removeEventListener('keyup', freed),
    );
  }

  private press(to: number): void {
    if (!this.on) return;
    if (to === 0) { this.gripped = null; return; }
    this.gripped = -1;
    this.at = to;
    if (to >= TAKEOFF_DETENT) this.takeoffs += 1;
    this.draw();
  }

  private grab(e: PointerEvent): void {
    const box = this.root.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    // The knob cannot reach the very ends, so full deflection is the
    // travel the knob actually has rather than the track's height.
    const travel = (box.height - KNOB_H) / 2;
    const off = (middle - e.clientY) / Math.max(1, travel);
    this.at = Math.max(-1, Math.min(1, off));
    // ONE takeoff per shove, not one per frame of holding it up there.
    if (this.armed && this.at >= TAKEOFF_DETENT) {
      this.armed = false;
      this.takeoffs += 1;
    }
    if (this.at < DEADZONE) this.armed = true;
    this.draw();
  }

  private draw(): void {
    const travel = (TRACK_H - KNOB_H) / 2;
    this.knob.style.transform = `translateY(${(-this.at * travel).toFixed(1)}px)`;
  }
}
