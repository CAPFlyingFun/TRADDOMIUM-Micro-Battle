/**
 * A PERSON WALKING IN A BUILDING — the one integrator that turns an
 * Intent into a moved humanoid body, as core.
 *
 * `input/Intent.ts` is the one movement shape and `control/PlayerDemand.ts`
 * is how a stick, a set of keys and a camera yaw already become one. This
 * file is the other end of that sentence: the INTEGRATOR. It takes the
 * request, decides what a body with mass, legs and a ceiling over its head
 * can honour, and writes the result into a state the caller owns. It reads
 * no input device, it owns no camera and it never asks a second question
 * about what the player pressed — "AI says what it wants. Player says what
 * they want. The creature's locomotion decides how the body achieves it"
 * (Joshua's Creature Lab brief, §3/§42, quoted in `PlayerDemand`'s header).
 * A walking person is that same sentence said for a species with two legs.
 *
 * It exists beside `creatures/demand.ts` rather than inside it because the
 * animals' integrator is written for bodies measured in millimetres that
 * burrow, fly and cling to the underside of a slab, on an island whose
 * ground is a heightfield. A scientist in the Tombs laboratory is a 1.75 m
 * cylinder in a room made of axis-aligned boxes, in LOCAL METRES with the
 * floor at y = 0 (`world/tombs/types.ts`, rule 2). Nothing about the two
 * problems is shared except the Intent, and the Intent is shared.
 *
 * ─── the world is a QUERY OBJECT, and this file names three questions ──
 *
 * `WalkWorld` below is the whole of what the walker knows about the
 * building: move-and-resolve, what is under a point, what is over one.
 * That is the `CreatureWorld` pattern (ARCHITECTURE §3, `creatures/world.ts`)
 * and it buys the same two things — the walker is testable in plain node
 * against twenty lines of fake floor, and the building's collision can be
 * replaced, indexed differently or held by a server without this file
 * changing a character.
 *
 * `world/tombs/collide.ts` answers all three. Its functions carry the
 * prepared index as their first argument, so the integration seam binds it
 * once and hands the walker the bound object:
 *
 *   const ix = indexLab(layout);
 *   const world: WalkWorld = {
 *     moveBody: (from, radius, height, delta, out) => moveBody(ix, from, radius, height, delta, out),
 *     groundUnder: (x, z, fromY) => groundUnder(ix, x, z, fromY),
 *     ceilingOver: (x, z, fromY) => ceilingOver(ix, x, z, fromY),
 *   };
 *
 * `WalkMove` is declared with exactly the eight fields of that file's
 * `BodyMove`, in the same order and the same mutability, so the two shapes
 * are ONE shape to the compiler and no copy is made at the seam. The
 * walker reads four of them; the other four ride along so a `BodyMove`
 * passes through this interface unchanged.
 *
 * ─── what the numbers are, and what they are not ──────────────────────
 *
 * Every constant below is labelled the way `creatures/species.ts` labels
 * its table — MEASURED, BIOLOGICAL SHAPE or GAME TUNING — because the
 * difference matters when somebody later wants to change one. A MEASURED
 * number moves only when the measurement does; a GAME TUNING number moves
 * when the game feels wrong.
 *
 * ─── the three decisions worth arguing for ────────────────────────────
 *
 * 1. THE VELOCITY THE WALKER CARRIES IS THE VELOCITY THE WORLD GRANTED.
 *    After every resolve the walker reads back the displacement it
 *    actually got and, where that differs from what it asked for by more
 *    than a micron, replaces its own velocity with it. A blocked axis
 *    therefore zeroes itself while a free axis keeps running, which is
 *    what a player feels as sliding along a wall; a body pressed into a
 *    wall accumulates no stored speed to shoot out with when it finally
 *    turns away; and the gait phase, which counts DISTANCE, stops
 *    advancing the moment the feet stop covering ground. One rule, three
 *    symptoms cured, and it works against any world — including one whose
 *    resolver this file has never seen.
 *
 * 2. THE WALKER NEVER ASKS THE WORLD TO TELEPORT IT. A request longer
 *    than `SUBSTEP_M` is split, so a resolver only ever has to be correct
 *    over a 100 mm move. `world/tombs/collide.ts` limits a slide against
 *    the first blocking face and would survive a longer one, but a
 *    walker that depends on that is a walker that tunnels the day a
 *    simpler world is handed to it — and the failure is invisible until a
 *    frame hitches, which is exactly when nobody is looking.
 *
 * 3. TIME CONSTANTS, NOT ACCELERATIONS. Every ease below is
 *    `1 - exp(-dt / tau)`, the exact solution of a first-order lag rather
 *    than `rate × dt`, so a 16.7 ms frame and a 33 ms frame land in the
 *    same place and a 1 s frame does not overshoot past the target and
 *    oscillate. `tau` is readable as physics: 63% of the way there in one
 *    tau, 95% in three.
 *
 * ─── steering is looking, and the short way round is a real bug ───────
 *
 * The standing rule (CLAUDE.md): "camera-relative stick, pace as a
 * CEILING, steering is looking." The stick is already camera-relative by
 * the time it arrives — `PlayerDemand` resolved it into the body's own
 * frame — so `forward` and `strafe` are read in the heading frame with no
 * further rotation. What is left for the integrator is the heading
 * itself, and it eases toward the look ONLY WHILE THE BODY IS MOVING. A
 * person standing at a desk does not pirouette because the camera swung
 * round to look at their face, and a body that chased the camera onto its
 * own nose could never be looked at from the front (`PlayerDemand`'s "AT
 * REST THE BODY IS LEFT ALONE", and v0's REST_DEADZONE before it).
 *
 * The ease goes the SHORT way round the circle, which is one call to
 * `wrapHeading` and is not decoration. Easing a heading of 3.0 rad toward
 * -3.0 rad on the raw difference turns the body -6.0 radians: a 344°
 * unwind through zero, to arrive 16° from where it started. The body
 * spins on the spot, the animation blurs, and the bug reads as "the
 * camera is broken" because it only ever appears near the ±pi seam. The
 * signed error through `wrapHeading` is ±0.283 rad across the seam, and
 * the body crosses pi.
 *
 * ─── the gait phase is advanced by DISTANCE, never by time ────────────
 *
 * This is the thing that makes feet look planted. A phase advanced by
 * time gives every stride the same duration, so a body at half speed
 * takes the same 1.09 s to swing a leg and the foot slides backwards
 * along the floor for half the stride — the skate every cheap walk cycle
 * has. Advance it by `travelled / STRIDE_M` and a stride is a fixed
 * DISTANCE: at half speed it takes twice as long, at a standstill it
 * stops, and a foot planted on the ground stays where it was put.
 * `fauna/motion.ts` counts the ants' strides the same way for the same
 * reason (`gait.strideLengthsAt`), which is where the lesson was learned.
 *
 * Pure: no three, no DOM, no storage, no network. This is core, and
 * `tests/simulationCore.test.ts` holds it to that.
 */
import { clampIntent, type Intent } from '../input/Intent';
import { wrapHeading } from './Transform';

// ---------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------

/**
 * The body's radius, metres. GAME TUNING anchored on measured human
 * breadth: ANSUR II (2012) puts adult bideltoid (shoulder) breadth at
 * about 0.49 m for men and 0.44 m for women, so a 0.25 m radius is a
 * 0.50 m cylinder that circumscribes the widest of them.
 *
 * It has to be checked against the doors, not only against the shoulders:
 * the laboratory's openings are 1.4 to 2.0 m wide and its corridors 2.6 m
 * (`world/tombs/plan.ts`), so a 0.50 m body threads the narrowest door
 * with 0.45 m of clearance on each side. `collide.ts` works its
 * cylinder-against-box arithmetic for "a 0.6 m body" — this one is
 * narrower than the worked example, which is the safe side of it.
 */
export const BODY_RADIUS_M = 0.25;

/**
 * The body's height, metres. GAME TUNING at the measured adult mean:
 * ANSUR II (2012) gives a male stature of about 1.756 m. Everything the
 * building has to clear is checked against it — the doorways are 2.4 m
 * and the lowest ceiling in the plan is 3.2 m, so a standing body has
 * head room everywhere it is meant to walk.
 */
export const BODY_HEIGHT_M = 1.75;

/**
 * The eye, metres above the feet.
 *
 * DELIBERATELY EQUAL TO `tombs/tombsTool.ts`'s `EYE_HEIGHT_M`, and
 * deliberately NOT imported from it: `src/tombs/` is a renderer directory
 * and `src/actor/` is core, so the dependency would run the wrong way
 * (ARCHITECTURE §3). The two are held together by a test rather than by a
 * memory, because the number is what a probe photographs the building
 * from and the day they disagree the camera and the body are standing in
 * different places.
 *
 * GAME TUNING from ordinary human scale, as that file says: 0.10 m below
 * the crown, which is about where eyes sit on a 1.75 m person.
 */
export const EYE_HEIGHT_M = 1.65;

// ---------------------------------------------------------------------------
// Pace
// ---------------------------------------------------------------------------

/**
 * The walking ceiling, metres a second. GAME TUNING set AT the measured
 * figure: Bohannon's meta-analysis of comfortable gait speed in healthy
 * adults (1997) lands every age and sex band between 1.27 and 1.46 m/s,
 * with the middle of the range at about 1.4. A person crossing a room is
 * doing exactly this, so there is nothing to tune away from.
 */
export const WALK_SPEED_M_S = 1.4;

/**
 * The running ceiling, metres a second. GAME TUNING, and the number the
 * brief argues about: this is A JOG INDOORS, NOT A SPRINT. The measured
 * walk-run transition is about 2.0 m/s (Thorstensson and Roberthson,
 * 1987; the Froude-number argument puts it at the same place), and a
 * trained sprinter averages over 10 m/s, so 3.6 m/s is unambiguously a
 * run and a quarter of a sprint. The reason it is not faster is the
 * building: the corridors are 2.6 m wide and the whole footprint is
 * 26.8 m across, which at 3.6 m/s is crossed in 7.4 seconds. A body that
 * ran at 6 m/s in here would spend the game bouncing off door jambs.
 */
export const RUN_SPEED_M_S = 3.6;

/**
 * How quickly the body comes UP to the pace it is asking for, as the time
 * constant of a first-order lag, seconds. GAME TUNING: 63% of the ceiling
 * in 0.12 s and 95% in 0.36 s, which is about two steps — a person
 * leaving a standstill is at walking pace within a stride or two, and a
 * body that took longer would read as ice.
 */
export const ACCELERATE_TAU_S = 0.12;

/**
 * How quickly it comes DOWN, seconds. GAME TUNING, and shorter than
 * `ACCELERATE_TAU_S` on purpose: letting go of the stick is a decision
 * the player just made, and a body that keeps drifting for a third of a
 * second after it reads as a controller that missed the input. Braking
 * with legs really is the faster of the two — a walker can plant a foot.
 */
export const BRAKE_TAU_S = 0.09;

/**
 * How quickly the body comes round onto the look, seconds. GAME TUNING:
 * 95% of the way round in 0.30 s, so a body that reverses direction is
 * facing the new way within a third of a second and the turn is still
 * visible as a turn rather than a snap.
 */
export const TURN_TAU_S = 0.10;

/**
 * The turn rate a body uses when it is steered by `Intent.turn` instead
 * of by a look, radians a second. GAME TUNING at the pace a person pivots
 * while walking: 3 rad/s is a half turn in about a second.
 *
 * This is the AUTONOMY path, not a second input path. `Intent.turn` is
 * the channel a mission brain or a scripted mover fills (`input/Intent.ts`
 * names the three producers), and such a producer has no camera to look
 * along. ONE STEERING SIGNAL IS READ PER STEP AND NEVER TWO: a finite
 * look wins and `turn` is ignored, because `PlayerDemand` derives `turn`
 * FROM the look and honouring both would steer the body twice.
 */
export const TURN_RATE_RAD_S = 3.0;

// ---------------------------------------------------------------------------
// Falling
// ---------------------------------------------------------------------------

/**
 * MEASURED: standard gravity is 9.80665 m/s². At Kauaʻi's latitude it is
 * nearer 9.789, which over the 7.65 m the laboratory is tall is a
 * difference of 5 mm in the landing position — below anything that can be
 * seen and far below the 100 mm the walker resolves in.
 */
export const GRAVITY_M_S2 = 9.81;

/**
 * The fastest the body falls, metres a second. MEASURED on a human in a
 * stable belly-to-earth spread: about 53 m/s (roughly 120 mph).
 *
 * Nothing in this building can reach it — the longest drop is 7.65 m,
 * which ends at 12 m/s. It is here as a bound on the arithmetic rather
 * than as physics: a body that falls out of the world through a hole in a
 * plan would otherwise gain speed until its per-step request was longer
 * than the substep budget, and the one thing a walker must never do is
 * pass through a floor.
 */
export const TERMINAL_FALL_M_S = 53;

// ---------------------------------------------------------------------------
// The gait
// ---------------------------------------------------------------------------

/**
 * One full gait cycle, metres — left foot to left foot, both steps.
 * MEASURED, and self-consistent with the walking ceiling: adult step
 * length is about 0.75 m, so a stride is about 1.5 m, and 1.4 m/s over a
 * 1.5 m stride is 0.93 strides a second, or 112 steps a minute. Ordinary
 * human cadence is 110 to 120. The three numbers agree because they are
 * the same measurement read three ways, which is the check that the
 * stride is not merely plausible.
 */
export const STRIDE_M = 1.5;

/**
 * Below this speed the body is standing, metres a second. GAME TUNING:
 * a fourteenth of walking pace, at which one stride would take fifteen
 * seconds. No pose module should be asked to animate that as a walk.
 */
export const STAND_SPEED_M_S = 0.10;

/**
 * At or above this the body is running, metres a second. MEASURED: the
 * walk-run transition, about 2.0 m/s (Thorstensson and Roberthson, 1987).
 * It sits between the two ceilings by construction — 1.4 m/s is a walk
 * whatever the stick does, and only the sprint ceiling can reach it.
 */
export const RUN_STANCE_M_S = 2.0;

/**
 * How far past a stance threshold the speed must go to LEAVE the stance
 * it is in, metres a second. GAME TUNING, and the same shape as the
 * creature LOD's `TEXTURED_IN` / `TEXTURED_OUT` (CLAUDE.md): a body
 * accelerating through a threshold sits on it for several frames, and
 * without a hold the stance flickers between two animations at frame
 * rate. One latch, two numbers, nothing timed.
 */
export const STANCE_HOLD_M_S = 0.05;

/**
 * The turn rate at which the lean saturates, radians a second. GAME
 * TUNING: a person walking a 2 m circle at 1.4 m/s is turning at
 * 0.7 rad/s and leans a little; 3 rad/s is as hard as a walking body
 * turns, and is full lean.
 */
export const LEAN_FULL_RAD_S = 3.0;

/**
 * How quickly the lean follows the turn, seconds. GAME TUNING: the lean
 * is a derivative — heading change over dt — and a derivative read off
 * one frame is noise at any frame rate. The lag is what makes it a signal
 * a pose module can use without filtering it again.
 */
export const LEAN_TAU_S = 0.15;

// ---------------------------------------------------------------------------
// Ground contact
// ---------------------------------------------------------------------------

/**
 * How far the feet are put back down onto ground that has dropped away
 * under them, metres. GAME TUNING at the size of the thing it exists for:
 * a 2 cm lip, a threshold, the joint between two slabs. Without it every
 * such lip starts a fall — the body leaves the ground for two frames, the
 * stance says airborne, and a walk across a flat floor stutters.
 *
 * It cannot glue a body to a ledge it means to walk off: the lowest real
 * drop in the laboratory is the 0.45 m entrance bench (`collide.ts`
 * measured the whole list of top faces), nine times this.
 *
 * ONE THING IS ASKED OF THE WORLD IN RETURN. The ground query is a POINT
 * query, so putting the feet down on what it answers can leave the body's
 * CIRCLE a couple of centimetres inside the lip it just left. A world
 * must therefore let a body walk out of a solid it is already inside —
 * which `collide.ts` does, and argues for at length: held there by the
 * very solid it is in, "every direction is into it".
 */
export const SNAP_DOWN_M = 0.05;

/**
 * How far the feet are lifted onto ground that has risen under them,
 * metres. The same 50 mm, for the same thresholds read the other way, and
 * gated on there being head room for the raised body — a walker that
 * stood up into a slab would be inside the building rather than in it.
 *
 * `collide.ts` takes a much larger step (0.25 m) during its own resolve;
 * this is the remainder, and it is what lets the walker work over a world
 * that only answers "what is under this point".
 */
export const SNAP_UP_M = 0.05;

/**
 * How close a solid top must be under the feet to count as standing on
 * it, metres. One millimetre — the same figure `collide.ts` uses for
 * `BodyMove.grounded`, and the lattice `world/SparseSoil.ts` samples on.
 */
export const GROUND_TOUCH_M = 1e-3;

// ---------------------------------------------------------------------------
// Resolving
// ---------------------------------------------------------------------------

/**
 * The longest move the walker will ask the world to resolve in one go,
 * metres. Under half the body's radius, and well under the thinnest
 * structural member in the canonical plan (the 0.25 m ceiling slab, the
 * 0.40 m shell). See decision 2 in the header.
 */
export const SUBSTEP_M = 0.10;

/**
 * The most substeps one call will take. 160 of them is 16 m, which at the
 * running ceiling is 4.4 seconds of simulated time in a single step —
 * far past any dt the frame clock hands out (ARCHITECTURE §2.4 clamps
 * sim dt; this file does not clamp again, exactly as `Transform.step`
 * does not). Past the cap the substeps grow longer than `SUBSTEP_M` and
 * decision 2's guarantee lapses; the cap is set where only a dt no clock
 * produces can reach it, so that it bounds WORK and never the body.
 */
export const MAX_SUBSTEPS = 160;

/**
 * How much the world has to change a requested move before the walker
 * believes it, metres. A micron: a thousandth of `collide.ts`'s 0.1 mm
 * skin, so a resolve that honoured the request is read as honoured and
 * the velocity survives the round trip through the world unchanged.
 * Without it, dividing the granted displacement by dt every frame bleeds
 * the last bits off the speed and a body on a flat floor slowly stops.
 */
export const GRANTED_M = 1e-6;

/**
 * Below this stick deflection the body is not being driven. GAME TUNING
 * at the edge of arithmetic rather than at the edge of a thumb — the
 * stick's own dead zone is `input/MoveStick.ts`'s business, and by the
 * time a push reaches an Intent it has already been applied. This only
 * has to separate "nothing pressed" from "pressed".
 */
export const DRIVING_DEFLECTION = 1e-3;

// ---------------------------------------------------------------------------
// The world the walker is allowed to ask about
// ---------------------------------------------------------------------------

/** A point or an offset in LOCAL METRES, the plan's own units. */
export interface WalkVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Where a body ended up and what it met. Structurally identical to
 * `world/tombs/collide.ts`'s `BodyMove` — same eight fields, same order,
 * same mutability — so that file's `newBodyMove()` can be handed straight
 * to the walker and its `moveBody` can write straight into the walker's.
 *
 * The walker reads `x`, `y`, `z`, `stepped` and `grounded`. `hitX`,
 * `hitY` and `hitZ` are carried rather than read: the walker works out
 * what was blocked from the displacement it was granted (decision 1),
 * which is an answer every world can give, and the ids are there for a
 * caller that wants to name the thing it scraped.
 */
export interface WalkMove {
  /** The resolved position of the FEET, in local metres. */
  x: number;
  y: number;
  z: number;
  /** The id of the solid that limited the x move, or null if nothing did. */
  hitX: string | null;
  /** The id of the solid that limited the y move: what the body landed on, or hit its head on. */
  hitY: string | null;
  /** The id of the solid that limited the z move, or null. */
  hitZ: string | null;
  /** How far the feet rose onto a step, in metres. 0 when nothing was stepped onto. */
  stepped: number;
  /** Is the body standing on something once the move is resolved? */
  grounded: boolean;
}

/** A fresh `WalkMove` for a caller to own and reuse. */
export function newWalkMove(): WalkMove {
  return { x: 0, y: 0, z: 0, hitX: null, hitY: null, hitZ: null, stepped: 0, grounded: false };
}

/**
 * EVERYTHING THE WALKER KNOWS ABOUT THE BUILDING. Three questions, no
 * state, no types of its own: the header's dependency argument in a
 * dozen lines. `world/tombs/collide.ts` answers all three once its index
 * is bound (the header shows the binding).
 */
export interface WalkWorld {
  /**
   * Move a vertical cylinder whose FEET are at `from` by `delta` and
   * resolve it against the building, writing `out` and returning it.
   * Implementations must not allocate.
   */
  moveBody(from: WalkVec3, radius: number, height: number, delta: WalkVec3, out: WalkMove): WalkMove;
  /**
   * The highest solid top face at or below `fromY` under the POINT
   * `x, z`, or `-Infinity` where there is nothing to stand on.
   */
  groundUnder(x: number, z: number, fromY: number): number;
  /**
   * The lowest solid bottom face at or above `fromY` over the point
   * `x, z`, or `+Infinity` where a body could rise for ever.
   */
  ceilingOver(x: number, z: number, fromY: number): number;
}

// ---------------------------------------------------------------------------
// The state
// ---------------------------------------------------------------------------

/**
 * What the body is doing, for whatever poses it. Three words and no more:
 * a pose module picks a cycle, and the continuous signals it needs to
 * blend with — the speed, the phase, the lean — are numbers beside it
 * rather than more words. ("Renderers and cameras take continuous
 * signals … never a gameplay mode enum", ARCHITECTURE §2.)
 */
export type Stance = 'stand' | 'walk' | 'run';

/**
 * The walking body, mutated in place. A caller owns one per body and a
 * step allocates nothing, which is the rule `control/PlayerDemand.ts` and
 * `input/Intent.ts` already keep.
 *
 * Positions are the FEET, in LOCAL METRES with the floor at y = 0 — the
 * plan's anchor and `collide.ts`'s, so nothing has to remember whose
 * origin this is. The eye rides `EYE_HEIGHT_M` above `y`.
 */
export interface WalkerState {
  /** The feet, local metres. */
  x: number;
  y: number;
  z: number;
  /**
   * Which way the body points, radians, the actor convention: ahead is
   * (sin h, cos h) and the body's right is ahead × up = (-cos h, sin h).
   * The same rule `Transform.step` integrates on, and the same one the
   * rigs are measured against — the day the strafe was taken as local +X
   * instead, a possessed ant sidestepped the wrong way.
   */
  heading: number;
  /** Horizontal velocity in the plan's axes, metres a second. */
  vx: number;
  vz: number;
  /** Vertical velocity, metres a second, positive up. */
  vy: number;
  /** Is the body standing on something? */
  grounded: boolean;
  /** The ground under the feet, local metres, or -Infinity where there is none. */
  groundY: number;
  /** Clear space above the crown, metres; `Infinity` under open sky. */
  headroom: number;
  /** The horizontal speed the body ACTUALLY covered last step, metres a second. */
  speed: number;
  stance: Stance;
  /**
   * Where the body is in its gait cycle, 0..1, advanced by distance
   * travelled (see the header). 0 and 1 are the same instant of the
   * cycle; which foot that is, is the pose module's to decide.
   */
  phase: number;
  /**
   * How hard the body is turning, -1..1, eased. Positive is a LEFT turn —
   * the same sign as `Intent.turn`, which grows the heading, so a pose
   * module that leans by this number leans the same way the intent asked
   * to turn.
   */
  lean: number;
  /** How far the feet rose onto steps last step, metres. A camera that must not jolt reads it. */
  stepped: number;
  /** The world's answer to the last resolve. Owned here so a step allocates nothing. */
  move: WalkMove;
}

/** A body standing at a point, facing a heading, at rest. */
export function newWalkerState(x = 0, y = 0, z = 0, heading = 0): WalkerState {
  return {
    x, y, z,
    heading: wrapHeading(heading),
    vx: 0, vz: 0, vy: 0,
    grounded: false,
    groundY: -Infinity,
    headroom: Infinity,
    speed: 0,
    stance: 'stand',
    phase: 0,
    lean: 0,
    stepped: 0,
    move: newWalkMove(),
  };
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/**
 * The fraction of the way to the target a first-order lag covers in `dt`.
 * Exact rather than `dt / tau`, which is the same to three decimal places
 * at 60 fps and overshoots past 1 the moment a frame hitches.
 */
function ease(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

function clampUnit(value: number): number {
  return value > 1 ? 1 : value < -1 ? -1 : value;
}

/** Into 0..1, for the gait phase. */
function fract(value: number): number {
  return value - Math.floor(value);
}

/**
 * Which stance a speed reads as, given the one it is already in. The
 * thresholds move by `STANCE_HOLD_M_S` in the direction of travel, so a
 * body sitting on one does not flicker between two animations.
 */
export function stanceFor(now: Stance, speed: number): Stance {
  const leaveStand = STAND_SPEED_M_S + STANCE_HOLD_M_S;
  const enterRun = RUN_STANCE_M_S + STANCE_HOLD_M_S;
  if (now === 'stand') {
    if (speed < leaveStand) return 'stand';
    return speed >= enterRun ? 'run' : 'walk';
  }
  if (now === 'run') {
    if (speed >= RUN_STANCE_M_S) return 'run';
    return speed < STAND_SPEED_M_S ? 'stand' : 'walk';
  }
  if (speed >= enterRun) return 'run';
  return speed < STAND_SPEED_M_S ? 'stand' : 'walk';
}

/**
 * Scratch for the two vectors the world is handed. Module-level rather
 * than per-step because a step must allocate nothing, and safe for the
 * reason `collide.ts` gives for its own: both are written and read inside
 * one synchronous call and neither is ever held across one.
 */
const _from = { x: 0, y: 0, z: 0 };
const _delta = { x: 0, y: 0, z: 0 };

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

/**
 * ONE STEP OF A WALKING BODY. Mutates `state` and returns it.
 *
 * @param state      the body, owned by the caller and written in place.
 * @param world      the building, as three questions (`WalkWorld`).
 * @param intent     what is wanted, in the BODY'S heading frame — the one
 *                   movement shape, already camera-relative by the time
 *                   `control/PlayerDemand.ts` is finished with it. There
 *                   is no second input path here: `forward` and `strafe`
 *                   are read as they stand.
 * @param cameraYaw  THE LOOK'S HEADING, in the actor convention above —
 *                   NOT `FreeFlyCamera.yaw`, which is a three.js yaw and
 *                   a half turn away from it. The integrator converts
 *                   with `perf/FreeFlyCamera.headingOfYaw`, which core
 *                   may not import because that module imports three; the
 *                   conversion is one call at a seam that is not core, so
 *                   the half turn keeps ONE home. A non-finite value
 *                   means "no look", and then `Intent.turn` steers.
 * @param dt         SIM dt, seconds, already clamped by the frame clock
 *                   (ARCHITECTURE §2.4). Not clamped again here, exactly
 *                   as `Transform.step` does not — a second clamp is
 *                   where a raw wall-clock delta gets in quietly.
 */
export function step(
  state: WalkerState, world: WalkWorld, intent: Intent, cameraYaw: number, dt: number,
): WalkerState {
  // A step of no time is not a step. Returning early rather than dividing
  // by it keeps every "per second" below honest.
  if (!Number.isFinite(dt) || dt <= 0) return state;

  const want = clampIntent(intent);

  // THE PUSH, ON THE UNIT DISC. Pace is a ceiling and the ceiling is
  // round: full ahead with full strafe is one pace, not 1.41 of them
  // (`Transform.step`, `PlayerDemand`).
  let forward = want.forward;
  let strafe = want.strafe;
  let deflection = Math.hypot(forward, strafe);
  if (deflection > 1) {
    forward /= deflection;
    strafe /= deflection;
    deflection = 1;
  }
  const driving = deflection > DRIVING_DEFLECTION;

  // STEERING IS LOOKING — while the body is moving. One signal, never
  // two: a finite look is the steering, and `Intent.turn` is read only
  // where there is no look to read (see `TURN_RATE_RAD_S`).
  const turnedFrom = state.heading;
  if (Number.isFinite(cameraYaw)) {
    if (driving) {
      // THE SHORT WAY ROUND. `wrapHeading` puts the error in (-pi, pi],
      // so a body at 3.0 rad easing toward -3.0 rad turns +0.283 across
      // the seam instead of -6.0 the long way round. See the header: the
      // long way is a 344-degree spin that only shows up near ±pi.
      const error = wrapHeading(cameraYaw - state.heading);
      state.heading = wrapHeading(state.heading + error * ease(dt, TURN_TAU_S));
    }
  } else if (want.turn !== 0) {
    // No look: an autonomy producer's explicit turn, honoured standing
    // still as well as moving, because it is a request rather than a
    // consequence of where a camera happens to point.
    state.heading = wrapHeading(state.heading + want.turn * TURN_RATE_RAD_S * dt);
  }

  // THE PACE ASKED FOR. The sprint toggle raises the CEILING and the
  // stick's deflection scales it: the wanted velocity is the push vector
  // times the ceiling, so its length is deflection × ceiling and a half
  // push is half pace at either ceiling.
  const ceiling = want.sprint ? RUN_SPEED_M_S : WALK_SPEED_M_S;
  const sin = Math.sin(state.heading);
  const cos = Math.cos(state.heading);
  const wantVx = (forward * sin - strafe * cos) * ceiling;
  const wantVz = (forward * cos + strafe * sin) * ceiling;

  // EASE TOWARD IT, faster down than up. Because the ease is a convex
  // blend of the current velocity and a wanted one that is never longer
  // than the ceiling, the speed approaches the ceiling and cannot pass
  // it — the bound is structural, not a clamp bolted on after.
  const rising = Math.hypot(wantVx, wantVz) >= Math.hypot(state.vx, state.vz);
  const k = ease(dt, rising ? ACCELERATE_TAU_S : BRAKE_TAU_S);
  state.vx += (wantVx - state.vx) * k;
  state.vz += (wantVz - state.vz) * k;

  // GRAVITY IS UNCONDITIONAL. A walker does not know it is standing until
  // the world tells it, so it always falls and contact always cancels the
  // fall — which keeps the ground contact live rather than latched, and
  // is why walking off a ledge needs no event.
  state.vy -= GRAVITY_M_S2 * dt;
  if (state.vy < -TERMINAL_FALL_M_S) state.vy = -TERMINAL_FALL_M_S;

  // THE MOVE, IN PIECES SHORT ENOUGH FOR ANY RESOLVER (decision 2).
  const reach = Math.hypot(state.vx * dt, state.vy * dt, state.vz * dt);
  let pieces = Math.ceil(reach / SUBSTEP_M);
  if (!(pieces >= 1)) pieces = 1;
  if (pieces > MAX_SUBSTEPS) pieces = MAX_SUBSTEPS;
  const sdt = dt / pieces;

  let travelled = 0;
  let rose = 0;
  for (let i = 0; i < pieces; i += 1) {
    _from.x = state.x;
    _from.y = state.y;
    _from.z = state.z;
    _delta.x = state.vx * sdt;
    _delta.y = state.vy * sdt;
    _delta.z = state.vz * sdt;

    const move = world.moveBody(_from, BODY_RADIUS_M, BODY_HEIGHT_M, _delta, state.move);

    const dx = move.x - _from.x;
    const dz = move.z - _from.z;
    // The vertical the world GRANTED is what it moved the body minus what
    // it lifted it: a step up is the world raising the feet, not the body
    // flying, and reading it as velocity would launch a body that walked
    // up a threshold.
    const dy = move.y - _from.y - move.stepped;

    state.x = move.x;
    state.y = move.y;
    state.z = move.z;
    rose += move.stepped;
    travelled += Math.hypot(dx, dz);

    // DECISION 1: where the world changed the move, the velocity is what
    // happened. A move honoured to within a micron is left exactly alone,
    // so a body on a flat floor does not bleed speed through the round
    // trip.
    if (Math.abs(dx - _delta.x) > GRANTED_M) state.vx = dx / sdt;
    if (Math.abs(dz - _delta.z) > GRANTED_M) state.vz = dz / sdt;
    if (Math.abs(dy - _delta.y) > GRANTED_M) state.vy = dy / sdt;
    // Contact spends the rest of the descent, so a body resting on a face
    // carries no downward speed into the next frame.
    if (move.grounded && state.vy < 0) state.vy = 0;
    state.grounded = move.grounded;
  }
  state.stepped = rose;

  // THE GROUND, AND THE SNAP. One query, answering for both directions:
  // asking from `SNAP_UP_M` above the feet finds a face that has risen
  // under them as well as one that has dropped away.
  const ground = world.groundUnder(state.x, state.z, state.y + SNAP_UP_M);
  const ceilingAt = world.ceilingOver(state.x, state.z, state.y + BODY_HEIGHT_M);
  if (state.vy <= 0 && Number.isFinite(ground)) {
    const gap = state.y - ground;
    if (gap > 0 && gap <= SNAP_DOWN_M) {
      // A 2 cm lip is not a fall (see `SNAP_DOWN_M`).
      state.y = ground;
      state.vy = 0;
      state.grounded = true;
    } else if (gap < 0 && -gap <= SNAP_UP_M && ceilingAt - (ground + BODY_HEIGHT_M) >= 0) {
      // The ground rose under the feet and the raised body still fits.
      state.y = ground;
      state.vy = 0;
      state.grounded = true;
    }
  }
  state.groundY = ground;
  state.headroom = ceilingAt - (state.y + BODY_HEIGHT_M);
  if (!state.grounded && Number.isFinite(ground) && Math.abs(state.y - ground) <= GROUND_TOUCH_M && state.vy <= 0) {
    // A world that resolved the body onto a face without saying so still
    // has a body standing on it. The test is two-sided on purpose: the
    // ground query looks `SNAP_UP_M` above the feet, so a one-sided
    // comparison would call a body 50 mm UNDER a face it could not stand
    // up onto (no head room) grounded on it.
    state.grounded = true;
  }

  // WHAT THE BODY IS DOING, for whatever draws it. The speed is MEASURED
  // — distance covered over the time it took — so a body held against a
  // wall reports a standstill however hard the stick is pushed, and its
  // feet stop striding.
  state.speed = travelled / dt;
  state.stance = stanceFor(state.stance, state.speed);
  // The gait phase is advanced by DISTANCE (the header): at half speed a
  // stride takes twice as long, and at a standstill it does not move.
  state.phase = fract(state.phase + travelled / STRIDE_M);

  const turnRate = wrapHeading(state.heading - turnedFrom) / dt;
  state.lean += (clampUnit(turnRate / LEAN_FULL_RAD_S) - state.lean) * ease(dt, LEAN_TAU_S);

  return state;
}
