/**
 * STAMINA — one reserve, many workloads.
 *
 * There is ONE physical exertion reserve and it serves everything she
 * does: sprinting, taking off, holding a climb, gliding home. Two bars
 * would be two recovery rates and two answers to "how tired is she".
 *
 * WHAT CHANGED, AND WHY IT MATTERS. This used to be
 * `update(sprinting, resting, dt)` — two booleans naming the only two
 * things the game could do. Flight has a continuum of workloads between
 * a lazy glide and a hard climb, and no boolean says which. So the
 * reserve now takes a RATE and knows nothing about what is spending it:
 *
 *   ground sprint    +1/30 per second
 *   hard climb       high positive
 *   cruise           small positive
 *   glide            small NEGATIVE — she is recovering
 *   recovery descent stronger negative
 *   resting          strongest negative
 *
 * The caller decides what its activity costs. This only counts.
 *
 * THIRTY SECONDS, not six. Six bought a dash, which was right when a
 * dash was the whole game. It is far too short once escaping a predator,
 * reaching cover and getting to takeoff speed all come out of the same
 * bar. The longer reserve is paid for with slower recovery.
 */

/** Seconds of continuous ground sprinting a full bar buys. */
export const SPRINT_SECONDS = 30;

/** Seconds to refill from empty while she keeps moving. */
export const RECOVER_SECONDS = 60;

/** Seconds to refill from empty while standing still. */
export const RESTING_SECONDS = 30;

/**
 * Standing still catches her breath this many times faster. Derived so
 * the two figures above cannot drift apart — one of them is the truth
 * and this is the ratio between them.
 */
export const RESTING_BONUS = RECOVER_SECONDS / RESTING_SECONDS;

/** How much must be back before a spent reserve can be asked again. */
export const REARM_AT = 0.25;

/** Fraction of the reserve a ground sprint costs per second. */
export const SPRINT_DRAIN = 1 / SPRINT_SECONDS;
/** Fraction returned per second while moving, as a NEGATIVE rate. */
export const MOVING_RECOVERY = -1 / RECOVER_SECONDS;
/** Fraction returned per second while stationary. */
export const RESTING_RECOVERY = -1 / RESTING_SECONDS;

export class Stamina {
  /** Full is 1, empty is 0. */
  private level = 1;
  private winded = false;

  get fraction(): number {
    return this.level;
  }

  /**
   * True while she is too spent to be asked for another effort.
   *
   * Not the same as empty: it latches when she runs dry and only clears
   * once REARM_AT is back, which is what stops a bar hovering near zero
   * from stuttering in and out of a sprint.
   */
  get spent(): boolean {
    return this.winded;
  }

  /**
   * Take a lump out of the reserve — a takeoff, and once anything else
   * costs a one-off price.
   *
   * Separate from `update` because a burst is not a rate: it happens on
   * one frame and must cost the same whatever the frame rate is.
   *
   * @returns what was actually taken, which is less than asked for if
   *   she did not have it
   */
  spend(cost: number): number {
    const taken = Math.min(this.level, Math.max(0, cost));
    this.level -= taken;
    if (this.level <= 0) this.winded = true;
    return taken;
  }

  /**
   * @param rate fraction of a full reserve per second. POSITIVE spends,
   *   NEGATIVE recovers. The caller knows what its activity costs; this
   *   does not care what the activity was.
   * @returns true on the frame the reserve just ran out, so the caller
   *   can ease off
   */
  update(rate: number, dt: number): boolean {
    this.level = Math.min(1, Math.max(0, this.level - rate * dt));

    if (rate > 0) {
      if (this.level > 0) return false;
      const first = !this.winded;
      this.winded = true;
      return first;
    }

    if (this.winded && this.level >= REARM_AT) this.winded = false;
    return false;
  }

  /** Put her back to full — respawns and scene resets. */
  clear(): void {
    this.level = 1;
    this.winded = false;
  }
}
