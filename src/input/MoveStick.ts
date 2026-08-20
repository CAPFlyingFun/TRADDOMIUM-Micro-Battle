/**
 * THE MOVEMENT STICK — fixed, not floating.
 *
 * Fixed because the throttle is anchored beside it: a floating stick
 * lands wherever you touch, including on top of the throttle.
 *
 * How far you push decides the gait as well as the direction, so speed
 * and steering are one motion and cost no screen space. That is the
 * whole control — there is no lock, and nothing to arm.
 */

export interface MoveInput {
  x: number;
  y: number;
}

export interface StickReading extends MoveInput {
  /** How far she is pushed, 0 to 1. */
  deflection: number;
}

/** Radius of full deflection, in px. */
const RANGE = 64;
/** Below this the stick reads as centred. */
const DEAD_ZONE = 0.08;
/** How far outside the ring a touch still counts as grabbing the stick. */
const GRAB_SLACK = 1.5;

export class MoveStick {
  private readonly ring: HTMLDivElement;
  private readonly nub: HTMLDivElement;
  private readonly detach: Array<() => void> = [];

  private readonly keys = new Set<string>();
  private pointerId: number | null = null;
  private vector = { x: 0, y: 0 };

  constructor(host: HTMLElement) {
    this.ring = document.createElement('div');
    this.nub = document.createElement('div');
    this.style();
    this.ring.appendChild(this.nub);
    host.appendChild(this.ring);

    this.listen(this.ring, 'pointerdown', (e: PointerEvent) => {
      if (this.pointerId !== null) return;
      if (!this.withinGrab(e)) return;
      this.pointerId = e.pointerId;
      this.ring.setPointerCapture(e.pointerId);
      this.aimAt(e);
      // Keep the camera drag from also claiming this pointer.
      e.stopPropagation();
      e.preventDefault();
    });

    this.listen(this.ring, 'pointermove', (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.aimAt(e);
      e.stopPropagation();
      e.preventDefault();
    });

    const lift = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.vector = { x: 0, y: 0 };
      this.paint();
    };
    this.listen(this.ring, 'pointerup', lift);
    this.listen(this.ring, 'pointercancel', lift);

    this.listen(window, 'keydown', (e: KeyboardEvent) => {
      if (!e.repeat) this.keys.add(e.code);
    });
    this.listen(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    this.listen(window, 'blur', () => this.keys.clear());
    this.paint();
  }

  read(): StickReading {
    const raw = this.pointerId !== null ? this.vector : this.fromKeys();
    const deflection = this.deflectionOf(raw);
    const live = deflection > DEAD_ZONE ? raw : { x: 0, y: 0 };
    this.paint();
    return {
      x: live.x,
      y: live.y,
      deflection: deflection > DEAD_ZONE ? deflection : 0,
    };
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.ring.remove();
  }

  private fromKeys(): MoveInput {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  private deflectionOf(v: MoveInput): number {
    return Math.min(1, Math.hypot(v.x, v.y));
  }

  private centre(): { x: number; y: number } {
    const box = this.ring.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }

  private withinGrab(e: PointerEvent): boolean {
    const c = this.centre();
    return Math.hypot(e.clientX - c.x, e.clientY - c.y) <= RANGE * GRAB_SLACK;
  }

  private aimAt(e: PointerEvent): void {
    const c = this.centre();
    const dx = e.clientX - c.x;
    const dy = e.clientY - c.y;
    const len = Math.hypot(dx, dy);
    const scale = len > 0 ? Math.min(1, len / RANGE) / len : 0;
    // Screen up is forward, so y flips.
    this.vector = { x: dx * scale, y: -dy * scale };
  }

  private paint(): void {
    const v = this.pointerId !== null ? this.vector : this.fromKeys();
    this.nub.style.transform = `translate(${v.x * RANGE}px, ${-v.y * RANGE}px)`;
  }

  private listen(
    target: EventTarget,
    type: string,
    handler: (e: never) => void,
  ): void {
    target.addEventListener(type, handler as EventListener);
    this.detach.push(() => target.removeEventListener(type, handler as EventListener));
  }

  private style(): void {
    Object.assign(this.ring.style, {
      position: 'fixed',
      left: 'calc(24px + env(safe-area-inset-left))',
      bottom: 'calc(24px + env(safe-area-inset-bottom))',
      width: `${RANGE * 2}px`,
      height: `${RANGE * 2}px`,
      borderRadius: '50%',
      border: '3px solid rgba(255, 210, 110, .55)',
      background: 'rgba(18, 14, 6, .3)',
      touchAction: 'none',
      zIndex: '12',
    } satisfies Partial<CSSStyleDeclaration>);

    Object.assign(this.nub.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '52px',
      height: '52px',
      marginLeft: '-26px',
      marginTop: '-26px',
      borderRadius: '50%',
      background: 'rgba(255, 210, 110, .72)',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
  }
}
