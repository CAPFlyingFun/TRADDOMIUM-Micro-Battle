/**
 * THE LOOK PAD — the "‹ 🎥 ›" control.
 *
 * A compact pad rather than a whole screen half, so the rest of the
 * screen stays free for the action controls that grab, dig and bite
 * later. Drag it sideways to swing the camera around the ant, up and
 * down to lift the view toward top-down or drop it in behind her.
 *
 * Let go and it eases home: the camera's job is to follow behind the
 * player, and looking around is a thing you do, not a state you leave
 * the camera in. What "home" means — the resting angle — becomes a
 * setting later; see the camera-angle card on the board.
 */

export interface LookInput {
  /** Radians swung around the ant, away from directly behind her. */
  yaw: number;
  /** Radians lifted above the resting camera elevation. */
  pitch: number;
  /** True while the player is holding the pad. */
  active: boolean;
}

export class LookPad {
  /** Radians per pixel dragged. */
  private static readonly YAW_PER_PX = 0.011;
  private static readonly PITCH_PER_PX = 0.008;
  /** How far the view may swing before it stops following the drag. */
  private static readonly YAW_LIMIT = Math.PI * 0.9;
  private static readonly PITCH_UP = 0.95;
  private static readonly PITCH_DOWN = -0.3;
  /** Keyboard swing rate, radians per second. */
  private static readonly KEY_RATE = 1.5;

  private yaw = 0;
  private pitch = 0;
  private pointerId: number | null = null;
  private last = { x: 0, y: 0 };
  private readonly keys = new Set<string>();
  private readonly pad: HTMLDivElement;
  private readonly detach: Array<() => void> = [];

  constructor(host: HTMLElement) {
    this.pad = document.createElement('div');
    this.pad.textContent = '‹ 🎥 ›';
    this.stylePad();
    host.appendChild(this.pad);

    this.listen(this.pad, 'pointerdown', (e: PointerEvent) => {
      if (this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      this.last = { x: e.clientX, y: e.clientY };
      this.pad.setPointerCapture(e.pointerId);
      this.pad.style.background = 'rgba(255, 210, 110, 0.3)';
      // Keep the movement stick from also claiming this touch.
      e.stopPropagation();
      e.preventDefault();
    });

    this.listen(this.pad, 'pointermove', (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.swing(
        (e.clientX - this.last.x) * LookPad.YAW_PER_PX,
        (e.clientY - this.last.y) * -LookPad.PITCH_PER_PX,
      );
      this.last = { x: e.clientX, y: e.clientY };
      e.stopPropagation();
      e.preventDefault();
    });

    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.pad.style.background = 'rgba(20, 16, 8, 0.3)';
    };
    this.listen(this.pad, 'pointerup', release);
    this.listen(this.pad, 'pointercancel', release);

    this.listen(window, 'keydown', (e: KeyboardEvent) => {
      if (!e.repeat) this.keys.add(e.code);
    });
    this.listen(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    this.listen(window, 'blur', () => this.keys.clear());
  }

  /**
   * Current look offsets. Call once per frame — while nothing is held
   * this is what walks the camera back home.
   */
  read(dt: number): LookInput {
    let held = this.pointerId !== null;

    const rate = LookPad.KEY_RATE * dt;
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

    if (!held) {
      // Ease home at a rate that is stable across frame rates.
      const settle = Math.exp(-3.5 * dt);
      this.yaw *= settle;
      this.pitch *= settle;
      if (Math.abs(this.yaw) < 1e-4) this.yaw = 0;
      if (Math.abs(this.pitch) < 1e-4) this.pitch = 0;
    }

    return { yaw: this.yaw, pitch: this.pitch, active: held };
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.pad.remove();
  }

  private swing(dYaw: number, dPitch: number): void {
    const { YAW_LIMIT, PITCH_UP, PITCH_DOWN } = LookPad;
    this.yaw = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, this.yaw + dYaw));
    this.pitch = Math.max(PITCH_DOWN, Math.min(PITCH_UP, this.pitch + dPitch));
  }

  private listen(
    target: EventTarget,
    type: string,
    handler: (e: never) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler as EventListener, options);
    this.detach.push(() => target.removeEventListener(type, handler as EventListener, options));
  }

  private stylePad(): void {
    Object.assign(this.pad.style, {
      position: 'fixed',
      right: 'max(18px, env(safe-area-inset-right))',
      bottom: 'max(18px, env(safe-area-inset-bottom))',
      width: '132px',
      height: '52px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
      borderRadius: '26px',
      border: '2px solid rgba(255, 210, 110, 0.5)',
      background: 'rgba(20, 16, 8, 0.3)',
      color: 'rgba(255, 226, 160, 0.9)',
      font: '600 19px/1 system-ui, sans-serif',
      letterSpacing: '2px',
      userSelect: 'none',
      touchAction: 'none',
      cursor: 'grab',
      zIndex: '11',
    } satisfies Partial<CSSStyleDeclaration>);
  }
}
