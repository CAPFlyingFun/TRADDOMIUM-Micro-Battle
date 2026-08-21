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
 * How high she gets, in world units. One world unit is about a
 * centimetre and she is roughly a centimetre long, so this is about a
 * body length — a hop that reads as effort, not a moon jump.
 *
 * This is the DESIGN number and the arc is derived from it, rather than
 * the other way round. Tuning a launch speed and reading the height
 * back off it means the height is whatever the maths happened to give,
 * and it moved with the frame rate besides.
 */
export const JUMP_HEIGHT = 1.0;

/**
 * World units per second squared, downward. Not Earth's 981 cm/s²: at
 * true scale a hop this size is over in a seventh of a second, which on
 * a phone is a twitch you cannot see. This is GAME TUNING chosen to
 * give an airtime you can watch, and to sit in one place so flight
 * later has one gravity to fight.
 */
export const GRAVITY = 24;

/** Push-off speed, derived so the peak IS `JUMP_HEIGHT`. */
export const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);

/** How long the whole arc takes, up and back down. */
export const JUMP_AIRTIME = (2 * JUMP_SPEED) / GRAVITY;

/**
 * Seconds of recovery a jump blocks. Longer than the arc it buys, so
 * hammering the button never sneaks a frame of recovery in between one
 * landing and the next push-off, however coarse the frames are.
 */
export const JUMP_HOLD = 0.8;

/** Landing under this speed is a step down, not a landing. */
export const SETTLE_SPEED = 0.05;

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
  /** Seconds since the push-off. The arc is a function of this. */
  private elapsed = 0;
  /** True on the frame she leaves the ground — the HUD reads it. */
  private launched = false;

  get height(): number {
    return this.above;
  }

  get rising(): number {
    return this.aloft ? JUMP_SPEED - GRAVITY * this.elapsed : 0;
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
    this.elapsed = 0;
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
   * SOLVED, not stepped. Adding gravity to a velocity and the velocity
   * to a height loses energy at coarse frame steps — the same arc
   * peaked at 1.02 units at 60fps, 0.96 at 30 and 0.72 at 10, so a slow
   * phone jumped lower than a fast one for no reason the player could
   * see. Reading the height straight off the elapsed time gives every
   * device the same jump.
   *
   * @returns true on the frame she lands, so the caller can thump.
   */
  update(dt: number): boolean {
    if (!this.aloft) return false;
    this.elapsed += dt;
    this.above = JUMP_SPEED * this.elapsed - 0.5 * GRAVITY * this.elapsed * this.elapsed;
    if (this.above > 0) return false;
    this.above = 0;
    return true;
  }

  /** Put her flat on the ground — respawns, teleports, scene resets. */
  clear(): void {
    this.above = 0;
    this.elapsed = 0;
    this.launched = false;
  }
}
