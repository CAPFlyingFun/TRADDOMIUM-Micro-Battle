/**
 * THE JUMP — a short burst off the ground, paid for out of the same
 * reserve a sprint spends.
 *
 * This is deliberately the SMALLEST possible piece of getting off the
 * ground. Flight is the real target and it is a large system: takeoff
 * rolls, airspeed against altitude, gliding for the reserve back. A
 * jump shares the one thing all of that needs first — a body with a
 * height above the terrain and a vertical velocity — and none of the
 * things that make flight hard. Get this right and flight is that arc
 * held open under power.
 *
 * ONE POOL. The reserve is the same one running spends, because flight
 * will spend it too. Two pools would be two bars, two recovery rates
 * and two answers to "how tired is she".
 *
 * EIGHT IN A ROW, and the ninth is refused. That is a design target
 * rather than a physical result, so the numbers are chosen to meet it
 * and a test holds them to it: 12% each, and nothing comes back for a
 * moment afterwards.
 *
 * That last part is a HOLD counted in seconds, not "while she is off
 * the ground". The first version used airborne-ness and it made the
 * count depend on the frame rate: a phone rendering at 1 fps spent more
 * of each jump cycle standing on the ground recovering, and got nine
 * jumps where a phone at 60 fps got eight. A slow device must not play
 * an easier game.
 */

/** Fraction of the reserve one jump costs. */
export const JUMP_COST = 0.12;

/** How many she gets from full, back to back. */
export const JUMPS_FROM_FULL = Math.floor(1 / JUMP_COST);

/**
 * Upward world units per second at the push-off. One world unit is
 * about a centimetre and she is roughly a centimetre long, so this is a
 * few body lengths — a hop that reads as effort, not a moon jump.
 */
export const JUMP_SPEED = 7.2;

/**
 * World units per second squared, downward. Not Earth's 981 cm/s²: at
 * true scale a 7 cm/s push-off is over in a seventh of a second, which
 * on a phone is a twitch you cannot see. This is GAME TUNING chosen to
 * give an airtime you can watch (~0.6 s) and to sit in one place so
 * flight later has one gravity to fight.
 */
export const GRAVITY = 24;

/**
 * Seconds of recovery a jump blocks. Longer than the arc it buys, so
 * hammering the button never sneaks a frame of recovery in between one
 * landing and the next push-off, however coarse the frames are.
 */
export const JUMP_HOLD = 0.8;

export interface Airborne {
  /** Height above the terrain under her, world units. */
  readonly height: number;
  /** Vertical speed, world units per second. Negative is falling. */
  readonly rise: number;
  readonly aloft: boolean;
}

/**
 * Her vertical state. Owns nothing about the terrain: it is handed the
 * ground height each frame, which keeps it testable and keeps the
 * heightfield out of the mechanic.
 */
export class Jump {
  private above = 0;
  private rise = 0;
  /** True on the frame she leaves the ground — the HUD reads it. */
  private launched = false;

  get height(): number {
    return this.above;
  }

  get rising(): number {
    return this.rise;
  }

  get aloft(): boolean {
    return this.above > 0;
  }

  /** Whether a jump asked for right now would be given. */
  canJump(reserve: number): boolean {
    return !this.aloft && reserve >= JUMP_COST;
  }

  /**
   * Ask for a jump.
   *
   * @returns the reserve actually spent — zero if she was refused, so
   *   the caller cannot charge her for a jump she did not get.
   */
  ask(reserve: number): number {
    if (!this.canJump(reserve)) return 0;
    this.rise = JUMP_SPEED;
    // Off the ground THIS frame, so a second ask in the same frame is
    // refused rather than stacking into a double jump.
    this.above = 1e-6;
    this.launched = true;
    return JUMP_COST;
  }

  /** Read and clear the launch flag. */
  takeLaunch(): boolean {
    const went = this.launched;
    this.launched = false;
    return went;
  }

  /**
   * Advance the arc.
   *
   * @returns true on the frame she lands, so the caller can thump.
   */
  update(dt: number): boolean {
    if (!this.aloft) return false;
    this.rise -= GRAVITY * dt;
    this.above += this.rise * dt;
    if (this.above > 0) return false;
    this.above = 0;
    this.rise = 0;
    return true;
  }

  /** Put her flat on the ground — respawns, teleports, scene resets. */
  clear(): void {
    this.above = 0;
    this.rise = 0;
    this.launched = false;
  }
}
