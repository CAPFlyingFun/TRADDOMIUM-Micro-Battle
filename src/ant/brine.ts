/**
 * WHAT THE SEA COSTS HER — saltwater exposure, counted in seconds.
 *
 * A fire ant rides the ocean the way she rides any water: the film
 * holds her up and she does not drown (wading.ts owns that part). What
 * the sea does instead is wear her down. Salt water is hyperosmotic to
 * her tissue and hostile to the cuticle over hours, so exposure is a
 * CLOCK rather than a hazard: gentle at first, then a steady toll for
 * as long as she stays in it. Leave the sea and the toll stops at
 * once; stay out long enough and the clock forgets her entirely.
 *
 * THE SHAPE OF THE CLOCK. Sixty seconds of continuous contact are
 * free — a landing, a look around, a mistake corrected. Past that she
 * is in the damaging phase and loses one percent of her MAXIMUM
 * health every thirty seconds. Always the maximum, never what is
 * left: a fixed toll per tick, so a full queen faces about fifty
 * minutes of damaging exposure, not an asymptote she can never die
 * of. Getting out stops damage IMMEDIATELY, but the exposure already
 * accumulated is only forgiven after thirty continuous seconds ashore
 * — touching the beach for one frame does not buy a fresh grace
 * period.
 *
 * WHAT COUNTS is decided by the caller, not here: this class is a
 * pure clock over "is her body in salt water this frame". The scene
 * feeds it wade.salt && wade.depth > 0 — actually standing, swimming,
 * floating or diving in the sea — and feeds false while she flies
 * over it, stands on the beach, or swims fresh water.
 *
 * FRAME-RATE INDEPENDENT by construction: everything is seconds of
 * dt, and damage owed is derived from total exposure rather than
 * counted per frame, so one giant dt that crosses several tick
 * boundaries yields exactly the ticks it should (see update()).
 */

/** Seconds of continuous sea contact before the damaging phase. */
export const SALT_GRACE_SECONDS = 60;
/** Seconds between damage ticks once the phase has begun. */
export const SALT_DAMAGE_INTERVAL_SECONDS = 30;
/** Fraction of MAXIMUM health each tick takes. */
export const SALT_DAMAGE_FRACTION = 0.01;
/** Continuous seconds ashore before accumulated exposure is forgiven. */
export const SALT_RECOVERY_SECONDS = 30;
/**
 * How much harder sea swimming is than fresh — the chop, the spray,
 * the current she cannot read. Applied by the scene to the SWIM cost
 * only (never to recovery — a multiplier on a negative rate would
 * make the ocean restful).
 */
export const OCEAN_STAMINA_MULTIPLIER = 1.5;

export class SaltExposure {
  /** Continuous seconds her body has been in the sea. */
  private exposure = 0;
  /** Continuous seconds she has been out of it. */
  private ashore = 0;
  /** Damage ticks already charged against the current exposure. */
  private dealt = 0;
  /** Whether this frame's update was in salt — for `burning`. */
  private inSalt = false;

  /** Seconds of exposure on the clock right now. */
  get exposureSeconds(): number {
    return this.exposure;
  }

  /** True while she is in the sea AND past the grace period. */
  get burning(): boolean {
    return this.inSalt && this.exposure >= SALT_GRACE_SECONDS;
  }

  /**
   * Advance the clock.
   *
   * @param inSalt whether her body is in ocean water THIS frame
   * @returns how many damage ticks fell due this frame — usually 0 or
   *   1, but a huge dt that crosses several interval boundaries owes
   *   several, and every one is returned rather than lost. Each tick
   *   is worth maxHealth * SALT_DAMAGE_FRACTION; the caller applies
   *   it through the normal damage path.
   */
  update(inSalt: boolean, dt: number): number {
    this.inSalt = inSalt;
    if (!inSalt) {
      // Out of the sea the toll stops at once — exposure FREEZES
      // rather than draining, so a one-frame touch of the beach
      // cannot reset the grace period. Only a full recovery ashore
      // forgives it.
      this.ashore += dt;
      if (this.ashore >= SALT_RECOVERY_SECONDS) {
        this.exposure = 0;
        this.dealt = 0;
      }
      return 0;
    }
    this.ashore = 0;
    this.exposure += dt;
    const owed = Math.floor(
      Math.max(0, this.exposure - SALT_GRACE_SECONDS) / SALT_DAMAGE_INTERVAL_SECONDS,
    );
    const ticks = owed - this.dealt;
    this.dealt = owed;
    return ticks;
  }

  /** A fresh queen — respawns and scene resets. */
  clear(): void {
    this.exposure = 0;
    this.ashore = 0;
    this.dealt = 0;
    this.inSalt = false;
  }
}
