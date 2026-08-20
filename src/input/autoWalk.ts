/**
 * AUTO-WALK ARMING — the pure half of the lock, with no DOM in it.
 *
 * Two ways in, because they suit different moments. Hold a bearing
 * steady and it arms itself, which is what you want when you have
 * already set off and realise the far shore is a long way away. Or
 * double-tap the stick and it locks at once, which is what you want when
 * you knew before you started.
 *
 * The tolerance matters more than the timer. A thumb never holds a
 * bearing exactly, so demanding a perfectly steady angle would mean the
 * hold never completes on a real device.
 */

/** Seconds of steady pushing before the hold locks. */
export const HOLD_SECONDS = 2;

/** How far the bearing may wander while arming, in radians. */
export const DRIFT_LIMIT = (25 * Math.PI) / 180;

/** How hard she must be pushed for the hold to count. */
export const ARM_DEFLECTION = 0.85;

/** Milliseconds within which a second tap counts as a double-tap. */
export const DOUBLE_TAP_MS = 320;

/**
 * How long after breaking a lock the double-tap is ignored, so the tap
 * that cancelled auto-walk cannot immediately turn it back on.
 */
export const REARM_BLOCK_MS = 400;

/** Shortest signed angle from a to b. */
export function angleBetween(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

export class LockArmer {
  /** How far through the hold we are, 0 to 1, for the arming ring. */
  progress = 0;

  private held = 0;
  private bearing = 0;
  private steady = false;

  /**
   * Feed one frame of stick state.
   *
   * @returns true on the single frame the hold completes.
   */
  sample(deflection: number, bearing: number, dt: number): boolean {
    if (deflection < ARM_DEFLECTION) {
      this.reset();
      return false;
    }
    if (!this.steady || Math.abs(angleBetween(this.bearing, bearing)) > DRIFT_LIMIT) {
      // Started pushing, or swung off the bearing being held: begin again
      // from this direction rather than giving up on the gesture.
      this.steady = true;
      this.bearing = bearing;
      this.held = 0;
      this.progress = 0;
      return false;
    }
    this.held += dt;
    this.progress = Math.min(1, this.held / HOLD_SECONDS);
    if (this.held >= HOLD_SECONDS) {
      this.reset();
      return true;
    }
    return false;
  }

  reset(): void {
    this.held = 0;
    this.progress = 0;
    this.steady = false;
  }
}

/**
 * Watches taps for a double. Times come from the caller so this stays
 * testable without a clock.
 */
export class TapWatcher {
  private lastTapAt = -Infinity;
  private blockedUntil = -Infinity;

  /** @returns true when this tap completes a double-tap. */
  tap(now: number): boolean {
    if (now < this.blockedUntil) {
      // Forget blocked taps entirely. Recording them would let a tap
      // made during the block pair with one made just after it, and
      // re-arm the very lock the player just cancelled.
      this.lastTapAt = -Infinity;
      return false;
    }
    const doubled = now - this.lastTapAt <= DOUBLE_TAP_MS;
    this.lastTapAt = doubled ? -Infinity : now;
    return doubled;
  }

  /** Called when a tap broke an existing lock. */
  blockRearm(now: number): void {
    this.blockedUntil = now + REARM_BLOCK_MS;
    this.lastTapAt = -Infinity;
  }
}
