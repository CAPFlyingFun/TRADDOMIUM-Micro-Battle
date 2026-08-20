/**
 * THE MOVEMENT STICK — fixed, not floating.
 *
 * How far you push decides the gait, in visible zones. The inner circle
 * is the crawl/walk line and the outer ring is the walk/sprint line, so
 * the two boundaries you have to feel for through a thumb are both
 * drawn on the glass. The nub is allowed to travel a little past the
 * rim, because a sprint you cannot see yourself entering feels like a
 * glitch.
 *
 * It also arms auto-move: hold a steady bearing and a ring fills round
 * the rim; let go while it is full and she keeps going. Double-tap
 * turns auto-move on or off outright.
 */
import { HoldArmer, TapWatcher } from './autoMove';

export interface MoveInput {
  x: number;
  y: number;
}

export interface StickReading extends MoveInput {
  /** Push distance in ring radii: 0.5 ends the crawl, 1 ends the walk. */
  deflection: number;
  /** True while a thumb is on the stick. */
  touching: boolean;
  /** True on the frame a double-tap asks to toggle auto-move. */
  toggleAuto: boolean;
  /** True on the frame a released hold asks to start auto-move. */
  engageAuto: boolean;
}

/** Ring radius in px — the walk/sprint line. */
const RING = 64;
/** How far the nub may stray past the rim, in ring radii. */
const OVERREACH = 1.2;
/** Below this the stick reads as centred. */
const DEAD_ZONE = 0.12;
/** How far outside the ring a touch still counts as grabbing the stick. */
const GRAB_SLACK = 1.7;
/** A press shorter than this, that never travelled, counts as a tap. */
const TAP_MS = 260;

export class MoveStick {
  private readonly ring: HTMLDivElement;
  private readonly zone: HTMLDivElement;
  private readonly arc: HTMLDivElement;
  private readonly nub: HTMLDivElement;
  private readonly detach: Array<() => void> = [];

  private readonly keys = new Set<string>();
  private readonly armer = new HoldArmer();
  private readonly taps = new TapWatcher();

  private pointerId: number | null = null;
  private vector = { x: 0, y: 0 };
  private pressedAt = 0;
  private travelled = false;
  private toggleAuto = false;
  private engageAuto = false;
  private autoOn = false;

  constructor(host: HTMLElement) {
    this.ring = document.createElement('div');
    this.zone = document.createElement('div');
    this.arc = document.createElement('div');
    this.nub = document.createElement('div');
    this.style();
    this.ring.append(this.zone, this.arc, this.nub);
    host.appendChild(this.ring);

    this.listen(this.ring, 'pointerdown', (e: PointerEvent) => {
      if (this.pointerId !== null || !this.withinGrab(e)) return;
      this.pointerId = e.pointerId;
      this.pressedAt = e.timeStamp;
      this.travelled = false;
      this.ring.setPointerCapture(e.pointerId);
      this.aimAt(e);
      e.stopPropagation();
      e.preventDefault();
    });

    this.listen(this.ring, 'pointermove', (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.aimAt(e);
      if (this.deflectionOf(this.vector) > DEAD_ZONE) this.travelled = true;
      e.stopPropagation();
      e.preventDefault();
    });

    const lift = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;

      const brief = e.timeStamp - this.pressedAt < TAP_MS;
      if (brief && !this.travelled) {
        // A tap that went nowhere. Two in quick succession switch
        // auto-move on or off.
        if (this.taps.tap(e.timeStamp)) this.toggleAuto = true;
      } else if (this.armer.ready && !this.autoOn) {
        // Held a bearing long enough and let go: the release commits.
        this.engageAuto = true;
      }

      this.vector = { x: 0, y: 0 };
      this.armer.reset();
      this.paint();
    };
    this.listen(this.ring, 'pointerup', lift);
    this.listen(this.ring, 'pointercancel', lift);

    this.listen(window, 'keydown', (e: KeyboardEvent) => {
      if (!e.repeat) this.keys.add(e.code);
      if (e.code === 'KeyL' && !e.repeat) this.toggleAuto = true;
    });
    this.listen(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    this.listen(window, 'blur', () => this.keys.clear());
    this.paint();
  }

  /** Tell the stick whether auto-move currently has the wheel. */
  showAuto(on: boolean): void {
    if (this.autoOn === on) return;
    this.autoOn = on;
    if (on) this.armer.reset();
    this.paint();
  }

  read(dt: number): StickReading {
    const raw = this.pointerId !== null ? this.vector : this.fromKeys();
    const deflection = this.deflectionOf(raw);
    const moving = deflection > DEAD_ZONE;
    const live = moving ? raw : { x: 0, y: 0 };

    // Only worth arming when auto-move is off; while it is on, a
    // double-tap is the way back out.
    if (!this.autoOn) {
      this.armer.sample(moving, Math.atan2(live.x, live.y), dt);
    }

    const reading: StickReading = {
      x: live.x,
      y: live.y,
      deflection: moving ? deflection : 0,
      touching: this.pointerId !== null || moving,
      toggleAuto: this.toggleAuto,
      engageAuto: this.engageAuto,
    };
    this.toggleAuto = false;
    this.engageAuto = false;
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
    if (len === 0) return { x: 0, y: 0 };
    // Keys have no travel, so they read as a walk unless Shift sprints.
    const reach = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1.1 : 0.75;
    return { x: (x / len) * reach, y: (y / len) * reach };
  }

  private deflectionOf(v: MoveInput): number {
    return Math.min(OVERREACH, Math.hypot(v.x, v.y));
  }

  private centre(): { x: number; y: number } {
    const box = this.ring.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }

  private withinGrab(e: PointerEvent): boolean {
    const c = this.centre();
    return Math.hypot(e.clientX - c.x, e.clientY - c.y) <= RING * GRAB_SLACK;
  }

  private aimAt(e: PointerEvent): void {
    const c = this.centre();
    const dx = e.clientX - c.x;
    const dy = e.clientY - c.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) {
      this.vector = { x: 0, y: 0 };
      return;
    }
    // Distance is kept in ring radii and allowed past 1, which is what
    // makes "push past the rim" mean sprint. Screen up is forward.
    const reach = Math.min(OVERREACH, len / RING);
    this.vector = { x: (dx / len) * reach, y: (-dy / len) * reach };
  }

  private paint(): void {
    const v = this.pointerId !== null ? this.vector : this.fromKeys();
    this.nub.style.transform = `translate(${v.x * RING}px, ${-v.y * RING}px)`;

    const sprinting = this.deflectionOf(v) >= 1;
    this.nub.style.background = sprinting
      ? 'rgba(255, 176, 92, .92)'
      : 'rgba(255, 210, 110, .72)';

    const arming = this.armer.progress;
    this.arc.style.opacity = arming > 0 ? '1' : '0';
    this.arc.style.background =
      `conic-gradient(rgba(143, 224, 168, .95) ${arming * 360}deg, transparent 0)`;

    this.ring.style.borderColor = this.autoOn
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
    const noSelect = {
      touchAction: 'none',
      userSelect: 'none',
      webkitUserSelect: 'none',
      webkitTouchCallout: 'none',
    } as Partial<CSSStyleDeclaration>;

    Object.assign(this.ring.style, {
      position: 'fixed',
      left: 'calc(24px + env(safe-area-inset-left))',
      bottom: 'calc(24px + env(safe-area-inset-bottom))',
      width: `${RING * 2}px`,
      height: `${RING * 2}px`,
      borderRadius: '50%',
      border: '3px solid rgba(255, 210, 110, .55)',
      background: 'rgba(18, 14, 6, .3)',
      zIndex: '12',
      transition: 'border-color 140ms ease',
      ...noSelect,
    } satisfies Partial<CSSStyleDeclaration>);

    // The crawl/walk line, drawn so it can be aimed for.
    Object.assign(this.zone.style, {
      position: 'absolute',
      left: '25%',
      top: '25%',
      width: '50%',
      height: '50%',
      borderRadius: '50%',
      border: '2px dashed rgba(255, 210, 110, .34)',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    Object.assign(this.arc.style, {
      position: 'absolute',
      inset: '-9px',
      borderRadius: '50%',
      opacity: '0',
      pointerEvents: 'none',
      mask: 'radial-gradient(closest-side, transparent 86%, #000 88%)',
      webkitMask: 'radial-gradient(closest-side, transparent 86%, #000 88%)',
    } as Partial<CSSStyleDeclaration>);

    Object.assign(this.nub.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '50px',
      height: '50px',
      marginLeft: '-25px',
      marginTop: '-25px',
      borderRadius: '50%',
      background: 'rgba(255, 210, 110, .72)',
      pointerEvents: 'none',
      transition: 'background 120ms ease',
    } satisfies Partial<CSSStyleDeclaration>);
  }
}
