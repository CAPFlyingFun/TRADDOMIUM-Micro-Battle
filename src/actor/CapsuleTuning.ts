/**
 * How fast a capsule moves and turns.
 *
 * PLACEHOLDER CAPSULE NUMBERS, NOT ANT BIOLOGY. A capsule is the debug
 * actor that exists before any ant does (ARCHITECTURE §5: two coloured
 * capsules, two browsers). These values are chosen so a capsule crosses
 * a screen-sized patch of ground in a few seconds and turns about in
 * about one, which is what makes a movement bug visible in a probe.
 * When the player shell arrives (Phase 7) the ant's numbers come from
 * the caste registry as growth-curve stats (`data/registries`), labelled
 * MEASURED / BIOLOGICAL SHAPE / GAME TUNING as `docs/research/
 * FIRE_ANT_BIOLOGY.md` §38 requires — not from this object.
 *
 * A value object, passed in: `Transform.step` takes its tuning as a
 * parameter so a test can pin the numbers and a session can hand every
 * actor the same ones (ARCHITECTURE §2.1, §2.8).
 */
export interface CapsuleTuning {
  /** World units per second at a plain walk (one unit is a centimetre). */
  readonly walkSpeed: number;
  /** What `intent.sprint` multiplies the walk by. */
  readonly sprintFactor: number;
  /** Radians per second at full `intent.turn`. */
  readonly turnRate: number;
}

/** GAME TUNING (debug): 60 cm/s walk, twice that at a sprint, a half-turn a second. */
export const DEBUG_CAPSULE_TUNING: CapsuleTuning = Object.freeze({
  walkSpeed: 60,
  sprintFactor: 2,
  turnRate: Math.PI,
});
