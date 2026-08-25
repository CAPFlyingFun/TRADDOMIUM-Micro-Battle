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

/** What the lever is for right now. */
export type Lever = 'full' | 'takeoff' | 'dive' | 'off';

/**
 * WHICH OF THOSE IT IS, given where she is — and this is a pure
 * function because the version of it that was three lines inline cost
 * us the whole of diving.
 *
 * The old rule had two cases: flying, or on the ground. Afloat is
 * neither. She is not flying and she is never going to reach takeoff
 * speed while the water has her, so she fell through to `off` — and
 * `off` forces `lift` to read zero, so the dive demand downstream was
 * multiplied by nothing every frame it was ever asked for. Diving was
 * written, wired, tested against its own model, and unreachable.
 * Joshua, twice, over two releases: "can't dive underwater yet."
 *
 * Being HELD by something is not the same as being unable to act. That
 * was written in a comment next to the bug, correctly, and the code
 * under it still said otherwise.
 */
export function leverFor(
  aloft: boolean, afloat: boolean, canTakeOff: boolean,
): Lever {
  // Never off in the air, even spent: coming DOWN is always hers, and
  // the flight model refuses the up half itself when there is nothing
  // left to spend on it.
  if (aloft) return 'full';
  // Afloat beats takeoff: she cannot run up to speed on water, and
  // down is the direction that means something there.
  if (afloat) return 'dive';
  return canTakeOff ? 'takeoff' : 'off';
}

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

  /**
   * Grey it out — an exhausted queen cannot ask to climb.
   *
   * `dive` is live like `full` and reads as something else, because it
   * IS something else: in the water this lever is how deep she swims,
   * not how high she flies. Same lever, same gesture, and the glyph is
   * the only thing that has to say which.
   */
  enable(state: Lever): void {
    const was = this.on;
    this.on = state !== 'off';
    this.root.style.opacity = this.on ? '1' : '.45';
    this.knob.textContent = state === 'takeoff' ? '🪽'
      : state === 'dive' ? '🌊' : '⇕';
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
      // STOPS HERE. LookDrag listens on the host and claims the first
      // pointer it sees without asking what it landed on — every other
      // control on this screen stops the bubble for exactly that
      // reason, and this one did not. Holding the lever therefore also
      // dragged the camera: keep it pressed and turn, and the view
      // stopped following her because the drag had swung it off her
      // tail. preventDefault alone does not do this; propagation does.
      e.stopPropagation();
      e.preventDefault();
      this.root.setPointerCapture(e.pointerId);
      this.gripped = e.pointerId;
      this.armed = true;
      this.grab(e);
    };
    const move = (e: PointerEvent) => {
      if (this.gripped !== e.pointerId) return;
      e.stopPropagation();
      e.preventDefault();
      this.grab(e);
    };
    const up = (e: PointerEvent) => {
      if (this.gripped !== e.pointerId) return;
      e.stopPropagation();
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
