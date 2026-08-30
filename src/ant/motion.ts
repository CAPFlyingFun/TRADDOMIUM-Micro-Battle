/**
 * WHAT SHE IS DOING, named once — Stage G.
 *
 * Joshua, 2026-08-30: "Probably need to add some switch states like
 * Idle, Walking, Dig, Combat, Swimming, etc... so will be able to
 * separate different things from others, and more organized."
 *
 * THE ARGUMENT FOR IT IS A BUG, and it is v0.0.123. Both halves of
 * that one were the same fault — a question asked of the WRONG STATE:
 *
 *   1. `leverFor` was handed `afloat` and `canTakeOff` as two loose
 *      booleans and had to GUESS the situation from them, so a
 *      floating queen read 'dive' whether or not she could leave.
 *   2. `canTakeOff` is a GROUND question — "did she run up to 6.5?" —
 *      and it was asked about a queen on water, where paddling caps
 *      her at 3.96 and the answer is no for ever.
 *
 * Neither was a typo. Both are what happens when a situation is
 * INFERRED from a handful of flags at each call site instead of being
 * decided once. There were nine such flags on IslandScene, mutually
 * constrained, with the constraints written down nowhere.
 *
 * DERIVED, NOT TRANSITIONED, and that is the whole safety of it. There
 * is no `setMotion` and nothing may assign one: the state is a pure
 * function of the world she is in, recomputed every frame from the
 * same numbers the physics just used. A machine with hand-written
 * transitions can disagree with the water; this one cannot, because it
 * has no memory to be wrong with.
 *
 * TWO AXES, because they answer different questions.
 *
 *   MOTION is where her body is. She is in exactly one, always, and
 *   nothing she chooses can change it directly — the water and the air
 *   decide.
 *
 *   ACT is what she is doing with it, and an act can be INTERRUPTED
 *   while a motion cannot. Drinking ends when she lets go, walks off,
 *   or takes off; swimming does not end because she would like it to.
 *   Folding these into one enum would have made 'drinking' and
 *   'wading' exclusive, which they are not — she drinks standing in
 *   the shallows.
 *
 * THE LADDER IS THE SPEC. Read `motionOf` top to bottom: the first
 * true line wins, and the order encodes what outranks what. Air beats
 * water beats ground; under beats afloat beats standing in it.
 */

/**
 * Where her body is. Exactly one, every frame.
 *
 * `diving` is MEASURED — her body is under the surface, the same
 * signal breath.ts is fed. It is deliberately NOT the dive lever:
 * `IslandScene` keeps a separate `dive > 0.15` test for the underwater
 * tint, because that one wants INTENT ("a crest washing over a
 * floating queen must not read as a dive, and a real dive must not
 * wait"). Two different questions that happen to agree most of the
 * time; do not collapse them.
 */
export type Motion =
  | 'idle'
  | 'walking'
  | 'wading'
  | 'swimming'
  | 'diving'
  | 'flying';

/**
 * What she is doing with her body, if anything.
 *
 * `digging` and `fighting` ARE NOT BUILT. They are named here at
 * Joshua's instruction so the shape is visible from the start and the
 * mechanics slot in rather than bolting on — nothing in `src` can
 * currently produce either, and `tests/motion.test.ts` says so out
 * loud rather than leaving a reader to wonder. Naming a state is not
 * offering an action: CLAUDE.md's rule is about controls that look
 * functional, and there is no control here.
 */
export type Act = 'none' | 'drinking' | 'digging' | 'fighting';

/**
 * Below this she is standing still rather than walking — the same
 * threshold the stamina ladder already used for `resting`, so the
 * state and the cost cannot disagree about whether she is moving.
 */
export const STILL = 0.05;

/** Everything the state is derived from. All of it already measured. */
export interface Posture {
  /** Off the ground, by the flight model's own reckoning. */
  readonly aloft: boolean;
  /** Feet off the bottom — `Wade.afloat`. */
  readonly afloat: boolean;
  /** Body below the surface — the signal breath.ts is fed. */
  readonly under: boolean;
  /** Water standing over the ground under her, drawn units. */
  readonly depth: number;
  /** How fast she is actually travelling over the ground. */
  readonly speed: number;
}

/**
 * WHICH ONE SHE IS IN. A pure function, and the ladder is the design.
 */
export function motionOf(p: Posture): Motion {
  // Air beats everything. Whatever is below her, she is not in it.
  if (p.aloft) return 'flying';
  // Under beats afloat: she is still floating by buoyancy while she
  // swims down, and 'swimming' would lose the fact that she cannot
  // breathe.
  if (p.under) return 'diving';
  if (p.afloat) return 'swimming';
  // Feet on the bed with water round them. Wading is walking that
  // costs more, which is why it sits on this side of the line.
  if (p.depth > 0) return 'wading';
  return p.speed > STILL ? 'walking' : 'idle';
}

/**
 * Whether the water is carrying her — feet off the bottom.
 *
 * The HUD's old `!aloft && afloat` in one word, and it must keep
 * including `diving`: the swim instruments stay lit while she is
 * under, which is the behaviour Joshua asked for ("show water speed +
 * underwater speed and movement like in the air with same hud").
 */
export function afloatIn(m: Motion): boolean {
  return m === 'swimming' || m === 'diving';
}

/** Whether she is touching water at all, feet down or not. */
export function inWater(m: Motion): boolean {
  return m === 'wading' || afloatIn(m);
}

/** Whether the full flight/swim instrument panel should be lit. */
export function instrumented(m: Motion): boolean {
  return m === 'flying' || afloatIn(m);
}
