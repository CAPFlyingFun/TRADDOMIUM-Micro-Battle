/**
 * AUTO — drag past the rim, release on the lock.
 *
 * No permanent Auto button: the right side of the screen belongs to
 * bite, grab, dig and abilities, and a travel aid must not spend one of
 * those slots. Instead the gesture grows out of the stick the thumb is
 * already on.
 *
 * Two rules make it safe rather than surprising.
 *
 * Reaching full forward must NOT engage it — full forward is just fast,
 * and it happens constantly. There has to be deliberate extra travel
 * beyond the ordinary radius, which is what the lane is.
 *
 * And entering the lock only ARMS it. Auto engages when the thumb is
 * lifted inside the lock, so sliding back out is a free change of mind.
 */

export type AutoState = 'off' | 'arming' | 'ready' | 'active';

/** Where in the lane a thumb currently is. */
export type Lane = 'none' | 'arming' | 'ready';

/** Chevrons start appearing here, as a multiple of the stick radius. */
export const LANE_FROM = 1.15;

/** The lock zone begins here. Well beyond an ordinary full push. */
export const LANE_LOCK = 1.9;

/**
 * The lane only reads a push that is roughly upward. A hard sideways
 * drag past the rim is a big sidestep, not a request to lock.
 */
export const LANE_CONE = Math.cos((35 * Math.PI) / 180);

/**
 * How much forward or backward intent cancels Auto. A thumb aiming
 * sideways is untidy — 0.90 across and 0.08 up is an ordinary sidestep
 * — so the axis that wins matters more than the raw amount.
 */
export const CANCEL_Y = 0.45;

/**
 * Read the lane from a raw pointer offset in px, before any clamp to
 * the stick radius.
 *
 * @param x pointer offset from the stick centre, right positive
 * @param y pointer offset from the stick centre, UP positive
 */
export function laneAt(x: number, y: number, range: number): Lane {
  const reach = Math.hypot(x, y);
  if (reach < range * LANE_FROM) return 'none';
  // Upward enough to be a lane push rather than a wide sidestep.
  if (y / reach < LANE_CONE) return 'none';
  return reach >= range * LANE_LOCK ? 'ready' : 'arming';
}

/**
 * Whether a stick reading is a clear enough fore/aft intent to take
 * manual control back. Sidestepping and thumb wobble must not.
 */
export function cancelsAuto(move: { x: number; y: number }): boolean {
  return Math.abs(move.y) > CANCEL_Y && Math.abs(move.y) > Math.abs(move.x);
}

/**
 * The state machine. Kept free of the DOM so every transition in the
 * brief can be tested without a browser.
 */
export class AutoRun {
  private current: AutoState = 'off';
  private direction: 1 | -1 = 1;

  get state(): AutoState {
    return this.current;
  }

  get active(): boolean {
    return this.current === 'active';
  }

  /**
   * Which way it is carrying her: +1 ahead, -1 astern.
   *
   * Astern exists for hauling — an ant dragging something walks
   * backwards, and holding reverse across a long haul is exactly the
   * fatigue Auto is for. For now the player flips it; when carrying
   * arrives it can be chosen from what she has hold of.
   */
  get way(): 1 | -1 {
    return this.direction;
  }

  /** Turn Auto around without giving it up. */
  flip(): void {
    this.direction = this.direction === 1 ? -1 : 1;
  }

  /**
   * @param lane where the thumb is in the lane this frame
   * @param released true on the frame the thumb was lifted
   * @param move the stick reading, for cancellation
   */
  update(lane: Lane, released: boolean, move: { x: number; y: number }): AutoState {
    if (this.current === 'active') {
      if (cancelsAuto(move)) this.current = 'off';
      return this.current;
    }

    if (released) {
      // Engaging happens on RELEASE, and only from inside the lock.
      this.current = this.current === 'ready' ? 'active' : 'off';
      return this.current;
    }

    // The lane only ever locks her AHEAD; astern is flipped afterwards.
    // A downward lane would have to reach below the stick, and there is
    // not that much screen under a thumb resting in the corner.
    if (lane !== 'none') this.direction = 1;
    this.current = lane === 'ready' ? 'ready' : lane === 'arming' ? 'arming' : 'off';
    return this.current;
  }

  /** Engage Auto outright, with no gesture — the desktop key. */
  engage(way: 1 | -1 = 1): void {
    this.direction = way;
    this.current = 'active';
  }

  /** Stop Auto outright — an explicit cancel rather than a stick push. */
  cancel(): void {
    this.current = 'off';
    this.direction = 1;
  }
}
