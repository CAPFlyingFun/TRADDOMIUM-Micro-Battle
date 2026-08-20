/**
 * ARMING AUTO-MOVE — the pure half, with no DOM in it.
 *
 * Two ways to set it going, because they suit different moments.
 * Double-tap when you already know you want it. Or push a steady
 * bearing for two seconds, watch the ring fill, and let go — the
 * release is what commits, so you can always back out by moving the
 * stick again before you lift.
 *
 * The drift tolerance matters more than the timer. A thumb never holds
 * a bearing exactly, so demanding a perfectly steady angle would mean
 * the ring never fills on a real device.
 */

/** Seconds of steady pushing before the release will commit. */
export const HOLD_SECONDS = 2;

/** How far the bearing may wander while arming, in radians. */
export const DRIFT_LIMIT = (25 * Math.PI) / 180;

/** Milliseconds within which a second tap counts as a double-tap. */
export const DOUBLE_TAP_MS = 320;

/** Shortest signed angle from a to b. */
export function angleBetween(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/**
 * Fills while a bearing is held steady. Unlike a timer that fires on
 * its own, this only ever reports READINESS — the caller decides what
 * to do when the thumb lifts.
 */
export class HoldArmer {
  /** How far through the hold we are, 0 to 1, for the ring. */
  progress = 0;

  private held = 0;
  private bearing = 0;
  private steady = false;

  /** Feed one frame of stick state. */
  sample(moving: boolean, bearing: number, dt: number): void {
    if (!moving) {
      this.reset();
      return;
    }
    if (!this.steady || Math.abs(angleBetween(this.bearing, bearing)) > DRIFT_LIMIT) {
      // Just started pushing, or swung off the bearing being held:
      // begin again from this direction rather than abandoning it.
      this.steady = true;
      this.bearing = bearing;
      this.held = 0;
      this.progress = 0;
      return;
    }
    this.held = Math.min(this.held + dt, HOLD_SECONDS);
    this.progress = this.held / HOLD_SECONDS;
  }

  /** True once a release would commit. */
  get ready(): boolean {
    return this.progress >= 1;
  }

  reset(): void {
    this.held = 0;
    this.progress = 0;
    this.steady = false;
  }
}

/** Watches taps for a double. Times come from the caller, so no clock. */
export class TapWatcher {
  private lastTapAt = -Infinity;

  /** @returns true when this tap completes a double-tap. */
  tap(now: number): boolean {
    const doubled = now - this.lastTapAt <= DOUBLE_TAP_MS;
    // A completed double consumes both taps, so a third starts fresh
    // rather than pairing with the second.
    this.lastTapAt = doubled ? -Infinity : now;
    return doubled;
  }
}
