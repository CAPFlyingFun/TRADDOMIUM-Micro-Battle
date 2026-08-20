/**
 * THE STICK — how much movement she is being asked for, right now.
 *
 * Release it and she stops. That is the whole difference from the
 * telegraph this replaced: the pace selector says how fast a FULL push
 * is, and this says how much of that push there is. Nothing moves
 * because a setting is set.
 *
 * Above the stick lives the Auto lane. It is not drawn until a thumb
 * pushes toward it, because a permanent ladder up the side of the
 * screen is exactly what the last build got wrong.
 */
import { laneAt, LANE_FROM, LANE_LOCK, type Lane } from './autoRun';
import { settings } from '../ui/settings';

export interface MoveInput {
  x: number;
  y: number;
}

export interface StickReading extends MoveInput {
  /** How far she is pushed, 0 to 1, after the dead zone is taken out. */
  deflection: number;
  /** Where the thumb is in the Auto lane. */
  lane: Lane;
  /** True on the single frame the thumb was lifted. */
  released: boolean;
}

/** Radius of full deflection, in px. */
const RANGE = 64;
/** Below this the stick reads as centred. */
const DEAD_ZONE = 0.12;
/** How far outside the ring a touch still counts as grabbing the stick. */
const GRAB_SLACK = 1.7;

export class MoveStick {
  private readonly ring: HTMLDivElement;
  private readonly nub: HTMLDivElement;
  private readonly lane: HTMLDivElement;
  private readonly chevrons: HTMLDivElement[] = [];
  private readonly lock: HTMLDivElement;
  private readonly detach: Array<() => void> = [];

  private readonly keys = new Set<string>();
  private pointerId: number | null = null;
  private vector = { x: 0, y: 0 };
  /** Raw px offset from centre, unclamped — the lane lives out here. */
  private reach = { x: 0, y: 0 };
  private lifted = false;
  private autoAsked = false;
  private shownLane: Lane | null = null;

  constructor(host: HTMLElement) {
    this.ring = document.createElement('div');
    this.nub = document.createElement('div');
    this.lane = document.createElement('div');
    this.lock = document.createElement('div');
    this.ring.dataset.control = 'stick';
    this.lane.dataset.control = 'auto-lane';
    this.style();
    this.ring.appendChild(this.nub);
    host.append(this.lane, this.ring);

    this.listen(this.ring, 'pointerdown', (e: PointerEvent) => {
      if (this.pointerId !== null || !this.withinGrab(e)) return;
      this.pointerId = e.pointerId;
      this.ring.setPointerCapture(e.pointerId);
      this.aimAt(e);
      // Keep the camera drag from also claiming this pointer.
      e.stopPropagation();
      e.preventDefault();
    });

    this.listen(this.ring, 'pointermove', (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      // Pointer capture is what makes the lane possible: the thumb
      // travels well outside this element's box and still reports here.
      this.aimAt(e);
      e.stopPropagation();
      e.preventDefault();
    });

    const lift = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.lifted = true;
      this.vector = { x: 0, y: 0 };
      this.reach = { x: 0, y: 0 };
      this.paint();
    };
    this.listen(this.ring, 'pointerup', lift);
    this.listen(this.ring, 'pointercancel', lift);

    this.listen(window, 'keydown', (e: KeyboardEvent) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      // A keyboard cannot drag past a rim, so Auto gets a key. It lives
      // here because it is the same control: the lock is a thing the
      // stick does, however it is asked for.
      if (e.code === 'Equal') this.autoAsked = true;
    });
    this.listen(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    this.listen(window, 'blur', () => this.keys.clear());
    this.paint();
  }

  read(): StickReading {
    const held = this.pointerId !== null;
    const raw = held ? this.vector : this.fromKeys();
    const reach = Math.min(1, Math.hypot(raw.x, raw.y));

    // Rescale from the edge of the dead zone rather than stepping over
    // it, so the smallest push she answers is the smallest push there
    // is. Precision inside a pace is the entire point of this control.
    const live = reach > DEAD_ZONE ? (reach - DEAD_ZONE) / (1 - DEAD_ZONE) : 0;
    const scale = reach > 0 ? live / reach : 0;

    // laneAt reads UP as positive; the raw offset is screen pixels.
    const lane = held ? laneAt(this.reach.x, -this.reach.y, RANGE) : 'none';
    this.showLane(lane);

    const released = this.lifted;
    this.lifted = false;
    this.paint();

    // The lane is read off the RAW reach, deliberately: inverting the
    // stick must not put the Auto lock underneath the thumb.
    const flip = settings().invertStickY ? -1 : 1;
    return {
      x: raw.x * scale, y: raw.y * scale * flip, deflection: live, lane, released,
    };
  }

  /** Whether the desktop Auto key was struck since the last read. */
  takeAutoKey(): boolean {
    const asked = this.autoAsked;
    this.autoAsked = false;
    return asked;
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.ring.remove();
    this.lane.remove();
  }

  /**
   * Keyboard equivalent. W and S are manual forward and back — they
   * move her while held and stop when let go, the same rule the stick
   * follows — and A / D sidestep.
   */
  private fromKeys(): MoveInput {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    return { x, y };
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
    this.reach = { x: dx, y: dy };
    const len = Math.hypot(dx, dy);
    const scale = len > 0 ? Math.min(1, len / RANGE) / len : 0;
    // Screen up is forward, so y flips.
    this.vector = { x: dx * scale, y: -dy * scale };
  }

  private paint(): void {
    const v = this.pointerId !== null ? this.vector : this.fromKeys();
    this.nub.style.transform = `translate(${v.x * RANGE}px, ${-v.y * RANGE}px)`;
  }

  /** The lane is contextual: invisible until a thumb reaches for it. */
  private showLane(lane: Lane): void {
    if (lane === this.shownLane) return;
    this.shownLane = lane;
    this.lane.style.opacity = lane === 'none' ? '0' : '1';
    for (const [i, chevron] of this.chevrons.entries()) {
      chevron.style.opacity = lane === 'none'
        ? '0'
        : lane === 'ready' ? '1' : `${0.3 + i * 0.2}`;
    }
    const ready = lane === 'ready';
    this.lock.style.transform = ready ? 'scale(1.18)' : 'scale(1)';
    this.lock.style.background = ready
      ? 'rgba(255, 210, 110, .9)'
      : 'rgba(18, 14, 6, .5)';
    this.lock.style.borderColor = ready
      ? 'rgba(255, 244, 214, .95)'
      : 'rgba(255, 210, 110, .7)';
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
    // The Dynamic Island sits at the MIDDLE of the long edge, so the
    // bottom corner is not actually obstructed by it. Taking the full
    // ~59px inset there only pushes the controls needlessly inboard;
    // this clamp clears the rounded corner and no more.
    const edge = 'calc(10px + min(env(safe-area-inset-left), 14px))';
    const floor = 'calc(20px + min(env(safe-area-inset-bottom), 12px))';

    Object.assign(this.ring.style, {
      position: 'fixed',
      left: edge,
      bottom: floor,
      width: `${RANGE * 2}px`,
      height: `${RANGE * 2}px`,
      borderRadius: '50%',
      border: '3px solid rgba(255, 216, 130, .8)',
      // Darker and outlined since the ground gained its texture: over
      // pale sand in sunlight the old glass was barely there.
      background: 'rgba(18, 14, 6, .42)',
      boxShadow: '0 0 0 2px rgba(0, 0, 0, .35), 0 2px 10px rgba(0, 0, 0, .35)',
      touchAction: 'none',
      userSelect: 'none',
      zIndex: '12',
    } as Partial<CSSStyleDeclaration>);

    Object.assign(this.nub.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '52px',
      height: '52px',
      marginLeft: '-26px',
      marginTop: '-26px',
      borderRadius: '50%',
      background: 'rgba(255, 210, 110, .85)',
      border: '2px solid rgba(40, 28, 10, .5)',
      boxSizing: 'border-box',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);

    // The lane rises from the stick. Pointer capture handles the input,
    // so this is display only and must never eat a touch.
    Object.assign(this.lane.style, {
      position: 'fixed',
      left: edge,
      bottom: `calc(${floor} + ${RANGE + RANGE * LANE_FROM}px)`,
      width: `${RANGE * 2}px`,
      // Tall enough that the lock sits at the far end of the lane the
      // thumb must actually cross, not just above the ring.
      height: `${RANGE * (LANE_LOCK - LANE_FROM) + 40}px`,
      display: 'flex',
      flexDirection: 'column-reverse',
      alignItems: 'center',
      gap: '5px',
      opacity: '0',
      transition: 'opacity 140ms ease',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '11',
    } as Partial<CSSStyleDeclaration>);

    for (let i = 0; i < 3; i++) {
      const chevron = document.createElement('div');
      chevron.textContent = '▲';
      Object.assign(chevron.style, {
        font: '600 12px/1 system-ui, sans-serif',
        color: 'rgba(255, 210, 110, .9)',
        opacity: '0',
        transition: 'opacity 140ms ease',
      } as Partial<CSSStyleDeclaration>);
      this.chevrons.push(chevron);
      this.lane.appendChild(chevron);
    }

    this.lock.textContent = '🔒';
    Object.assign(this.lock.style, {
      marginBottom: '3px',
      width: '34px',
      height: '34px',
      borderRadius: '50%',
      border: '2px solid rgba(255, 210, 110, .7)',
      background: 'rgba(18, 14, 6, .5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      font: '600 15px/1 system-ui, sans-serif',
      transition: 'transform 140ms ease, background 140ms ease, border-color 140ms ease',
    } as Partial<CSSStyleDeclaration>);
    this.lane.appendChild(this.lock);
  }
}

export { RANGE as STICK_RANGE };
