/**
 * THE MOVEMENT STICK — fixed, not floating.
 *
 * Fixed because things are anchored around it now: a floating stick
 * lands wherever you touch, including on top of the gait rail.
 *
 * It does two jobs beyond steering. How far you push decides the gait,
 * so speed and direction are one motion. And holding a bearing arms the
 * auto-walk lock, with a ring sweeping the rim so the lock is visibly
 * coming rather than a surprise.
 */
import { LockArmer, TapWatcher } from './autoWalk';

export interface MoveInput {
  x: number;
  y: number;
}

export interface StickReading extends MoveInput {
  /** How far she is pushed, 0 to 1. */
  deflection: number;
  /** True on the frame the player asks for the auto-walk lock. */
  wantsLock: boolean;
  /** True on the frame the player takes the wheel back. */
  wantsRelease: boolean;
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
  private readonly arc: HTMLDivElement;
  private readonly badge: HTMLDivElement;
  private readonly detach: Array<() => void> = [];

  private readonly keys = new Set<string>();
  private readonly armer = new LockArmer();
  private readonly taps = new TapWatcher();

  private pointerId: number | null = null;
  private vector = { x: 0, y: 0 };
  private pressedAt = 0;
  private movedWhilePressed = false;
  private lockRequested = false;
  private releaseRequested = false;
  private locked = false;

  constructor(host: HTMLElement) {
    this.ring = document.createElement('div');
    this.nub = document.createElement('div');
    this.arc = document.createElement('div');
    this.badge = document.createElement('div');
    this.style();
    this.ring.append(this.arc, this.nub, this.badge);
    host.appendChild(this.ring);

    this.listen(this.ring, 'pointerdown', (e: PointerEvent) => {
      if (this.pointerId !== null) return;
      if (!this.withinGrab(e)) return;
      this.pointerId = e.pointerId;
      this.pressedAt = e.timeStamp;
      this.movedWhilePressed = false;
      this.ring.setPointerCapture(e.pointerId);
      // Any hand on the stick takes the wheel back immediately.
      if (this.locked) {
        this.releaseRequested = true;
        this.taps.blockRearm(e.timeStamp);
      }
      this.aimAt(e);
      e.stopPropagation();
      e.preventDefault();
    });

    this.listen(this.ring, 'pointermove', (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.aimAt(e);
      if (this.deflectionOf(this.vector) > DEAD_ZONE) this.movedWhilePressed = true;
      e.stopPropagation();
      e.preventDefault();
    });

    const lift = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      // A tap is a press that never really went anywhere. Two of them in
      // quick succession lock the bearing she is already holding.
      const brief = e.timeStamp - this.pressedAt < 260;
      if (brief && !this.movedWhilePressed && this.taps.tap(e.timeStamp)) {
        this.lockRequested = true;
      }
      this.vector = { x: 0, y: 0 };
      this.armer.reset();
      this.paint();
    };
    this.listen(this.ring, 'pointerup', lift);
    this.listen(this.ring, 'pointercancel', lift);

    this.listen(window, 'keydown', (e: KeyboardEvent) => {
      if (!e.repeat) this.keys.add(e.code);
      if (e.code === 'KeyL') this.lockRequested = true;
    });
    this.listen(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    this.listen(window, 'blur', () => this.keys.clear());
    this.paint();
  }

  /** Tell the stick whether auto-walk currently has the wheel. */
  showLocked(locked: boolean): void {
    if (this.locked === locked) return;
    this.locked = locked;
    if (locked) this.armer.reset();
    this.paint();
  }

  read(dt: number): StickReading {
    const raw = this.pointerId !== null ? this.vector : this.fromKeys();
    const deflection = this.deflectionOf(raw);
    const live = deflection > DEAD_ZONE ? raw : { x: 0, y: 0 };

    if (!this.locked && deflection > DEAD_ZONE) {
      if (this.armer.sample(deflection, Math.atan2(live.x, live.y), dt)) {
        this.lockRequested = true;
      }
    } else if (!this.locked) {
      this.armer.reset();
    }

    const reading: StickReading = {
      x: live.x,
      y: live.y,
      deflection: deflection > DEAD_ZONE ? deflection : 0,
      wantsLock: this.lockRequested,
      wantsRelease: this.releaseRequested,
    };
    this.lockRequested = false;
    this.releaseRequested = false;
    this.paint();
    return reading;
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

    const arming = this.armer.progress;
    this.arc.style.opacity = arming > 0 ? '1' : '0';
    // A conic sweep round the rim: the lock is visibly on its way.
    this.arc.style.background =
      `conic-gradient(rgba(143,224,168,.95) ${arming * 360}deg, transparent 0)`;

    this.badge.style.opacity = this.locked ? '1' : '0';
    this.ring.style.borderColor = this.locked
      ? 'rgba(143, 224, 168, .85)'
      : 'rgba(255, 210, 110, .55)';
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
      transition: 'border-color 140ms ease',
    } satisfies Partial<CSSStyleDeclaration>);

    Object.assign(this.arc.style, {
      position: 'absolute',
      inset: '-9px',
      borderRadius: '50%',
      opacity: '0',
      pointerEvents: 'none',
      // Keep only a thin band of the sweep, so it reads as a rim.
      mask: 'radial-gradient(closest-side, transparent 86%, #000 88%)',
      webkitMask: 'radial-gradient(closest-side, transparent 86%, #000 88%)',
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

    Object.assign(this.badge.style, {
      position: 'absolute',
      // Beside the stick, not above it: stacking it overhead put it
      // straight into the throttle on the same edge.
      left: 'calc(100% + 12px)',
      top: '10px',
      whiteSpace: 'nowrap',
      padding: '5px 11px',
      borderRadius: '999px',
      background: 'rgba(12, 20, 14, .74)',
      border: '1px solid rgba(143, 224, 168, .7)',
      font: '600 13px/1 "Chakra Petch", system-ui, sans-serif',
      letterSpacing: '.08em',
      color: 'rgba(170, 236, 190, .98)',
      opacity: '0',
      pointerEvents: 'none',
      transition: 'opacity 140ms ease',
    } satisfies Partial<CSSStyleDeclaration>);

    this.badge.textContent = '🔒 AUTO';
  }
}
