/**
 * LOOKING AROUND — a drag, not a button.
 *
 * The camera used to have its own pad, which spent a control slot the
 * action buttons will want. It does not need one: a drag anywhere the
 * controls are not is unambiguous, because controls claim their own
 * pointers first.
 *
 * Taps are deliberately left alone. When grab, dig and bite arrive they
 * take taps, and a drag that happens to start on one of them still turns
 * the camera, which is how the big mobile action games handle it.
 *
 * THE VIEW STAYS WHERE IT IS PUT, and it is measured in WORLD terms
 * rather than relative to her. That is what makes steering-by-looking
 * work: the camera holds a bearing, her body comes onto it while she is
 * driven, and the two can never chase each other round in a circle the
 * way a view bolted to her heading would.
 */

export interface LookInput {
  /** Radians swung around the ant, away from directly behind her. */
  yaw: number;
  /** Radians lifted above the resting camera elevation. */
  pitch: number;
  /** True while the player is steering the view. */
  active: boolean;
}

const YAW_PER_PX = 0.008;
const PITCH_PER_PX = 0.006;
/**
 * No limit worth the name. The view is world-absolute now, so a limit
 * would stop her being steered past it — this only exists to keep the
 * accumulated number from growing without bound over a long session.
 */
const YAW_LIMIT = Math.PI * 1000;
const PITCH_UP = 0.95;
const PITCH_DOWN = -0.3;
/** How far a pointer must travel before it counts as a look rather than a tap. */
const DRAG_SLOP = 10;
/** Keyboard swing rate, radians per second. */
const KEY_RATE = 1.5;

export class LookDrag {
  private yaw = 0;
  private pitch = 0;
  private pointerId: number | null = null;
  private from = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };
  private dragging = false;
  private readonly keys = new Set<string>();
  private readonly detach: Array<() => void> = [];

  constructor(host: HTMLElement) {
    this.listen(host, 'pointerdown', (e: PointerEvent) => {
      if (this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      this.from = { x: e.clientX, y: e.clientY };
      this.last = { ...this.from };
      this.dragging = false;
    });

    this.listen(host, 'pointermove', (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      if (!this.dragging) {
        const travelled = Math.hypot(e.clientX - this.from.x, e.clientY - this.from.y);
        if (travelled < DRAG_SLOP) return;
        this.dragging = true;
        // Start from where the slop ended, so the view does not jump.
        this.last = { x: e.clientX, y: e.clientY };
        return;
      }
      this.swing(
        (e.clientX - this.last.x) * YAW_PER_PX,
        (e.clientY - this.last.y) * -PITCH_PER_PX,
      );
      this.last = { x: e.clientX, y: e.clientY };
    });

    const lift = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.dragging = false;
    };
    this.listen(host, 'pointerup', lift);
    this.listen(host, 'pointercancel', lift);

    this.listen(window, 'keydown', (e: KeyboardEvent) => {
      if (!e.repeat) this.keys.add(e.code);
    });
    this.listen(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    this.listen(window, 'blur', () => this.keys.clear());
  }

  read(dt: number): LookInput {
    let held = this.dragging;

    const rate = KEY_RATE * dt;
    let keyYaw = 0;
    let keyPitch = 0;
    if (this.keys.has('KeyQ')) keyYaw -= rate;
    if (this.keys.has('KeyE')) keyYaw += rate;
    if (this.keys.has('KeyR')) keyPitch += rate;
    if (this.keys.has('KeyF')) keyPitch -= rate;
    if (keyYaw !== 0 || keyPitch !== 0) {
      this.swing(keyYaw, keyPitch);
      held = true;
    }

    return { yaw: this.yaw, pitch: this.pitch, active: held };
  }

  /** Point the view at a bearing outright — used to open behind her. */
  setYaw(radians: number): void {
    this.yaw = radians;
  }

  dispose(): void {
    for (const off of this.detach) off();
  }

  private swing(dYaw: number, dPitch: number): void {
    this.yaw = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, this.yaw + dYaw));
    this.pitch = Math.max(PITCH_DOWN, Math.min(PITCH_UP, this.pitch + dPitch));
  }

  private listen(
    target: EventTarget,
    type: string,
    handler: (e: never) => void,
  ): void {
    target.addEventListener(type, handler as EventListener);
    this.detach.push(() => target.removeEventListener(type, handler as EventListener));
  }
}
