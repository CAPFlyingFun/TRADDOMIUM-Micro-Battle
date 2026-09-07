/**
 * THE STICK — how much movement the thumb is asking for, right now, and
 * a ring on the screen that says so.
 *
 * A fixed ring at the bottom-left, a nub that follows the thumb, and a
 * reading any owner can take once a frame: a direction in the unit disc,
 * how far it is pushed after the dead zone is taken out, and whether a
 * pointer is holding it at all. Release it and it reads zero. It knows
 * nothing about what a push MEANS — a camera turns a full push into its
 * own top speed, a future ant into a pace — it only says how much of a
 * push there is.
 *
 * This is v0's `MoveStick` (`legacy/v0-main:src/input/MoveStick.ts`),
 * re-added deliberately in Phase 6 for the free-fly camera, as
 * ARCHITECTURE §11 says v0 parts are: in the phase that needs them,
 * checked against §2. Joshua, from his phone, 2026-09-07, of the camera's
 * invisible twin-zone stick: "allow the max if moving the invisible
 * joystick at 30 m/s, but allow it to be able to adjust speed from 1-30
 * depending on how much you push the stick forward and it should draw on
 * the screen while moving, but also would like it fixed and visible. You
 * can copy the one from v0." A joystick is generic UI and may be copied
 * (CLAUDE.md, the same day); this one is copied for its feel — the ring's
 * placement and safe-area clamp, the 64 px range, the 12 % dead zone
 * rescaled from its edge, the grab slack, the pointer capture, the gold
 * on dark glass — rather than for its file.
 *
 * What came across: the ring and nub, the look, `RANGE`, `DEAD_ZONE`,
 * `GRAB_SLACK`, pointer capture (the thumb travels outside the ring and
 * still reports here), and `stopPropagation` + `preventDefault` on the
 * pointer events it takes, so nothing above the ring in the UI layer sees
 * them. The nub is painted on every pointer move, not on `read()`: it
 * has to draw WHILE the thumb moves, and a stick nobody reads that frame
 * still has to look held.
 *
 * What was left in v0, and why:
 * - The Auto lane, its lock and its chevrons, and `laneAt`/autoRun. Auto
 *   is a Phase 9 autonomy idea; a benchmark camera has no pace to lock.
 * - The keyboard. In v1 keys are gathered once, by `Input.ts`, and the
 *   camera reads W/A/S/D from the snapshot; a second reader of the same
 *   keys is two owners of one fact (§2, principle 1).
 * - The `invertStickY` flip. That setting does not exist in v1, and the
 *   camera already owns its own `invertY` for looking.
 * - `released`, the one-frame edge. It existed for the lane's lock;
 *   nothing in v1 reads it, and `held` is the measured fact that principle
 *   3 asks for rather than a transition remembered by hand.
 */

export interface StickReading {
  /** Right positive, −1..1, dead-zone rescaled and clamped to the unit disc. */
  readonly x: number;
  /** FORWARD positive — screen up — −1..1, dead-zone rescaled and clamped to the unit disc. */
  readonly y: number;
  /** How far it is pushed, 0 to 1, after the dead zone is taken out. Equal to |(x, y)|. */
  readonly deflection: number;
  /** True while a pointer holds the stick. */
  readonly held: boolean;
}

/** Radius of full deflection, in px. */
const RANGE = 64;
/** Below this fraction of RANGE the stick reads as centred. */
const DEAD_ZONE = 0.12;
/** How far outside the ring, in ranges, a touch still counts as grabbing the stick. */
const GRAB_SLACK = 1.7;

const IDLE: StickReading = { x: 0, y: 0, deflection: 0, held: false };

export class MoveStick {
  private readonly ring: HTMLDivElement;
  private readonly nub: HTMLDivElement;
  private readonly detach: Array<() => void> = [];

  private pointerId: number | null = null;
  /** Direction and reach inside the unit disc, before the dead zone; y is screen UP. */
  private vector = { x: 0, y: 0 };

  constructor(host: HTMLElement) {
    const doc = host.ownerDocument;
    this.ring = doc.createElement('div');
    this.nub = doc.createElement('div');
    this.ring.dataset.control = 'stick';
    this.style();
    this.ring.appendChild(this.nub);
    host.appendChild(this.ring);

    this.listen(this.ring, 'pointerdown', (e: PointerEvent) => {
      if (this.pointerId !== null || !this.withinGrab(e)) return;
      this.pointerId = e.pointerId;
      // jsdom has no pointer capture; a browser does, and it is what lets
      // the thumb leave the ring's box and still report here.
      this.ring.setPointerCapture?.(e.pointerId);
      this.aimAt(e);
      // Keep whatever else lives in the UI layer from also claiming this pointer.
      e.stopPropagation();
      e.preventDefault();
    });

    this.listen(this.ring, 'pointermove', (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.aimAt(e);
      e.stopPropagation();
      e.preventDefault();
    });

    const lift = (e: PointerEvent): void => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.ring.releasePointerCapture?.(e.pointerId);
      this.vector = { x: 0, y: 0 };
      this.paint();
      e.stopPropagation();
      e.preventDefault();
    };
    this.listen(this.ring, 'pointerup', lift);
    this.listen(this.ring, 'pointercancel', lift);
    this.paint();
  }

  /** A read-only query: nothing about the stick changes because it was read. */
  read(): StickReading {
    if (this.pointerId === null) return IDLE;
    const raw = this.vector;
    const reach = Math.min(1, Math.hypot(raw.x, raw.y));

    // Rescale from the edge of the dead zone rather than stepping over
    // it, so the smallest push answered is the smallest push there is.
    // Precision at the slow end is the entire point of this control.
    const live = reach > DEAD_ZONE ? (reach - DEAD_ZONE) / (1 - DEAD_ZONE) : 0;
    const scale = reach > 0 ? live / reach : 0;
    return { x: raw.x * scale, y: raw.y * scale, deflection: live, held: true };
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach.length = 0;
    this.pointerId = null;
    this.ring.remove();
  }

  private centre(): { x: number; y: number } {
    const box = this.ring.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }

  private withinGrab(e: PointerEvent): boolean {
    const c = this.centre();
    return Math.hypot(e.clientX - c.x, e.clientY - c.y) <= RANGE * GRAB_SLACK;
  }

  /** Where the thumb is, as a vector from the ring's centre, clamped to the rim — and drawn there. */
  private aimAt(e: PointerEvent): void {
    const c = this.centre();
    const dx = e.clientX - c.x;
    const dy = e.clientY - c.y;
    const len = Math.hypot(dx, dy);
    const scale = len > 0 ? Math.min(1, len / RANGE) / len : 0;
    // Screen up is forward, so y flips.
    this.vector = { x: dx * scale, y: -dy * scale };
    this.paint();
  }

  private paint(): void {
    const v = this.vector;
    this.nub.style.transform = `translate(${v.x * RANGE}px, ${-v.y * RANGE}px)`;
  }

  private listen(target: EventTarget, type: string, handler: (e: never) => void): void {
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
      // Dark and outlined: over pale sand in sunlight a lighter glass was barely there.
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
  }
}

export { RANGE as STICK_RANGE };
