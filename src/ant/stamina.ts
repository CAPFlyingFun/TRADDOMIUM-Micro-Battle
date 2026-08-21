/**
 * STAMINA — the price of a sprint.
 *
 * The project rule is that a bar may only move if there is a way to
 * move it back, so this one recovers on its own the moment she stops
 * sprinting, and faster still when she stops altogether. It is a cost,
 * not a countdown.
 *
 * Runs out and the throttle drops her to a run; she cannot call for
 * another sprint until there is enough in reserve to be worth having,
 * which stops an empty bar from stuttering in and out of a sprint.
 */

/** Seconds of continuous sprinting a full bar buys. */
export const SPRINT_SECONDS = 6;

/** Seconds to refill from empty while moving at anything slower. */
export const RECOVER_SECONDS = 14;

/** Standing still catches her breath this many times faster. */
export const RESTING_BONUS = 2.2;

/** How much must be back before a sprint can be asked for again. */
export const REARM_AT = 0.25;

export class Stamina {
  /** Full is 1, empty is 0. */
  private level = 1;
  private winded = false;
  /** Seconds of recovery still blocked by a burst of effort. */
  private held = 0;

  get fraction(): number {
    return this.level;
  }

  /** True while she is too winded to be asked for another sprint. */
  get spent(): boolean {
    return this.winded;
  }

  /**
   * Take a lump out of the reserve — a jump, and later a takeoff.
   *
   * Separate from `update` because a burst is not a rate: it happens on
   * one frame and must cost the same whatever the frame rate is. Emptying
   * her this way winds her exactly as running her dry does, so a jump
   * cannot leave her at zero and still able to call for a sprint.
   *
   * @param cost fraction of a full reserve, 0 to 1
   * @returns what was actually taken
   */
  /**
   * Block recovery for a while — the aftermath of a burst.
   *
   * Without this the cost of a burst depends on the frame rate: a jump
   * only stops recovery for as long as she is off the ground, and how
   * many frames that is decides how much creeps back between one jump
   * and the next. On a slow phone that was NINE jumps where a fast one
   * gave eight, which is a slow phone playing an easier game.
   *
   * Counted in simulated seconds, so the answer is the same everywhere.
   * The longest hold wins; a second burst cannot shorten the first.
   */
  hold(seconds: number): void {
    this.held = Math.max(this.held, seconds);
  }

  spend(cost: number): number {
    const taken = Math.min(this.level, Math.max(0, cost));
    this.level -= taken;
    if (this.level <= 0) this.winded = true;
    return taken;
  }

  /**
   * @param sprinting whether she is holding a sprint this frame
   * @param resting whether she is stationary
   * @returns true if the sprint just ran out and she must ease off
   */
  update(sprinting: boolean, resting: boolean, dt: number): boolean {
    if (sprinting) {
      this.level = Math.max(0, this.level - dt / SPRINT_SECONDS);
      if (this.level > 0) return false;
      this.winded = true;
      return true;
    }

    if (this.held > 0) {
      this.held = Math.max(0, this.held - dt);
      return false;
    }

    const rate = (resting ? RESTING_BONUS : 1) / RECOVER_SECONDS;
    this.level = Math.min(1, this.level + dt * rate);
    if (this.winded && this.level >= REARM_AT) this.winded = false;
    return false;
  }
}
