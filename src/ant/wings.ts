/**
 * WET WINGS — why she cannot fly straight back out of the water.
 *
 * Joshua's design, 2026-08-30: "real ants can fly off of water but
 * need the wings pretty much dry, so my main idea is you are flying
 * and land in the water... you have to wait 30s to dry off to fly, if
 * you decide to dive say at 10s left on the countdown to be dry
 * enough to fly, the timer will stop/hide, and when you resurface,
 * will start over at 30s because obviously you went underwater and
 * have to re-dry."
 *
 * WHAT IT IS FOR. Water was a one-way trap: she landed on it and
 * that was the end of the flight, with nothing to do but paddle for a
 * shore that might be a kilometre off. This turns the trap into a
 * PRICE — thirty seconds, payable from where she is — which is
 * CLAUDE.md's survival invariant in its plainest form: a bar may only
 * move if there is a way to move it back. It also makes diving while
 * wet a real decision rather than a free look around, because the
 * dive spends the drying she has already done.
 *
 * FLOATING DRIES HER (Joshua, 2026-08-30). She rides the surface film
 * rather than swimming through the water — see wading.ts, and the
 * hydrophobic cuticle that puts her there — so a queen bobbing on the
 * top is a queen in the sun and the wind with her wings out of the
 * water. That is also the only reading under which "resurface and it
 * starts over at 30" means anything: if the surface did not dry her,
 * surfacing would restart a clock that was never going to run.
 *
 * SO IT IS THE EDGE THAT SOAKS HER, NOT THE CONTACT. The clock starts
 * on the frame she ENTERS the water and then runs while she is still
 * in it. Anything that re-armed on continuous contact would pin a
 * floating queen at thirty seconds for ever — she would dry, the same
 * frame would soak her again, and the one state the feature exists to
 * let her escape would be the one state she can never escape. The
 * first version of this file did exactly that and its own test caught
 * it, which is why the water is passed in rather than announced.
 *
 * RAIN STRETCHES IT (Joshua, 2026-08-30), rather than stopping it.
 * Stopping would let the sky strand her with no move of her own that
 * changes anything, and that is the exact shape the survival
 * invariant exists to forbid. Slowing keeps the way out open and
 * still makes the weather worth reading.
 *
 * NOTHING HERE KNOWS ABOUT WATER, FLIGHT OR THE HUD. It is fed two
 * booleans and a dial and answers how long is left, the same way
 * breath.ts is fed "is her head under". The scene owns the wiring.
 */

/**
 * THIRTY SECONDS, out of the rain — Joshua's number, and it is game
 * tuning rather than measured biology.
 *
 * What biology says is only that the direction is right: a fire ant's
 * wings are membranous and thin enough that surface water clings to
 * them, and a wet alate does not launch. How long a real one takes to
 * shed it is not a figure this project has a source for, and pretending
 * otherwise would put an invented citation in the code.
 */
export const DRY_SECONDS = 30;

/**
 * How much longer drying takes in the heaviest rain the island offers
 * — twice as long, so thirty seconds becomes sixty.
 *
 * Scaled by `rainfall`, the 0–1 dial (gameplay.ts), not by millimetres
 * an hour: the raw figure has no ceiling and a tropical downburst
 * would divide the clock by something absurd. A drizzle costs her a
 * few seconds; a squall costs her the other thirty.
 */
export const RAIN_STRETCH = 2;

/** How fast the clock runs, 1 in the dry and 1/RAIN_STRETCH in rain. */
export function dryingRate(rainfall: number): number {
  const wet = Math.min(1, Math.max(0, rainfall));
  return 1 / (1 + (RAIN_STRETCH - 1) * wet);
}

/**
 * The state of her wings: dry, or drying with a clock on it.
 */
export class Wings {
  /** Seconds of drying left. Zero means dry and able to fly. */
  private left = 0;
  /** Whether she was under the surface last time she was ticked. */
  private submerged = false;
  /** Whether she was in the water at all — the edge is what soaks her. */
  private wading = false;

  /** True while she cannot fly. Stays true underwater. */
  get wet(): boolean {
    return this.left > 0;
  }

  /**
   * Seconds left, or null when there is nothing to show — either she
   * is dry, or she is UNDER, where the count is stopped and hidden
   * because it is not counting toward anything.
   */
  get seconds(): number | null {
    if (this.left <= 0 || this.submerged) return null;
    return this.left;
  }

  /** Whether the clock is stopped because she is under the surface. */
  get held(): boolean {
    return this.left > 0 && this.submerged;
  }

  /**
   * Advance a frame.
   *
   * @param inWater whether the water has her — afloat, in this build,
   *   because wading is a film round her feet and her wings are a body
   *   up. False while she flies, so a second landing soaks her again.
   * @param under whether her body is below the surface this frame —
   *   the same signal breath.ts is given.
   * @param rainfall the 0–1 weather dial. Zero when it is not raining
   *   or when the weather has not arrived yet.
   * @returns true on the single frame she finishes drying, so the
   *   caller can say something about it without watching for an edge.
   */
  update(dt: number, inWater: boolean, under: boolean, rainfall = 0): boolean {
    const entered = inWater && !this.wading;
    this.wading = inWater;
    if (under) {
      // STOPPED AND HIDDEN while she is down there, and held at the
      // full count rather than at what was left — which is the same
      // thing as restarting on the way up, said once instead of twice.
      this.submerged = true;
      this.left = DRY_SECONDS;
      return false;
    }
    this.submerged = false;
    if (entered) this.left = DRY_SECONDS;
    if (this.left <= 0) return false;
    this.left = Math.max(0, this.left - dt * dryingRate(rainfall));
    return this.left <= 0;
  }
}
