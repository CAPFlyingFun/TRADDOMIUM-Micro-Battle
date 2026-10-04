/**
 * WHERE JACK AND SARAH'S FEET MEET THE GROUND — a post-pass on an
 * animated pose that makes the FEET drive the body, not the other way
 * round.
 *
 * `humanPose.poseHuman` writes a walk cycle as if the world were a flat
 * sheet at the soles of the bind pose. It is not, and it cannot be told:
 * the poser knows a phase and a clock, never the ground. So this module
 * runs AFTER it, every frame, reads the turns it wrote and hands back
 * the same list with the six leg turns corrected, plus how far the whole
 * body has to come down so its feet can reach their floor.
 *
 * Joshua, asking for it: "we had feet that snapped to ground and released
 * like in water or jumping", and "make sure the feet drive the model …
 * so it always stands on solid ground and the feet can't slip unless the
 * ground texture has no grip". The first sentence is Beyond Extinction's
 * foot IK, which this is a port of (`characters/foot_ik.gd` in the Godot
 * build, `IslandCharacter.applyFootIk` in the three.js one). The second
 * is new here: the WORLD FOOT LOCK, its grip, and the heel rise that lets
 * a trailing leg keep its lock without dragging the body down.
 *
 * ─── the rules, and where each came from ─────────────────────────────
 *
 *  1. FORWARD KINEMATICS in the bind frame, exactly as `humanPose`'s
 *     header defines a turn: `A_j = A_parent · R_j`, and a posed bone
 *     stands at `p_parent + A_parent · (b_j − b_parent)`. Every joint the
 *     turn list does not name has R = identity. The pass walks a
 *     parent-first order computed once at `createFeet`, so it does not
 *     care what order the bind file stores its joints in.
 *
 *  2. THE FOOT is two contact points. The BALL is the ankle's first
 *     child in the bind — the joint the rig puts under the metatarsal
 *     heads, 0.12 fixture units ahead of the ankle and 0.07 below it on
 *     both masters — and it touches the ground `ballClear` below itself
 *     (its bind height above the soles). The HEEL is a point on the bind
 *     floor HEEL_BACK of the ankle-to-ball distance behind the ankle. Each
 *     contact stands on or above its OWN ground and the foot rests on
 *     whichever touches first: on even ground that is the lower contact
 *     on the floor (a heel strike, toes up, stands on its heel), and
 *     across a kerb it is a foot that lands with its ball on the step and
 *     its heel over the road — never a heel stood on air at the step's
 *     height. A rig whose ankle has no child has one contact, `sole`
 *     under the ankle, and everything below still works with the pitch
 *     and the flattening left out.
 *
 *  3. THE TARGET, whole cycle: the foot resting on its ground (rule 2)
 *     plus LIFT, where lift is how far the animation has raised this
 *     foot's lower contact above the other foot's. So a swinging foot
 *     keeps its lift and still follows the terrain — it clears a step
 *     because the step raised its target, not because it hit it. A foot
 *     that is locked, or about to lock (rule 5), has no lift: it is on the
 *     ground, and only a foot whose lift is under LOCK_LIFT gets there, so
 *     dropping it is a step of millimetres; it eases back over BLEND when
 *     the foot goes. The ball's ground is the higher of what lies under
 *     it and under a LEAD point ahead of it along the body's facing, so a
 *     moving foot sees a kerb before it stubs on it (BE Godot's
 *     SCAN_FRAC). The lead is where the foot will be SCAN_LEAD seconds on
 *     at its present speed, capped at SCAN_FRAC of a leg: long through the
 *     swing, nothing by the time the foot has slowed to land, so a planted
 *     foot reads the ground it actually stands on.
 *
 *  4. THE SWING GATE (BE Godot): a foot the animation lifts SWING above
 *     the other is mid-step, and its STANCE weight ramps to 0 over that
 *     lift. The gate decides what is PLANTED — which foot may lock, which
 *     may rise onto its toes, and which foot's reach is allowed to pull
 *     the body down — and not whether the leg follows the terrain, which
 *     rule 3 already made safe for a lifted foot.
 *
 *  5. THE WORLD FOOT LOCK — "the feet can't slip". A foot is a CANDIDATE
 *     when it is planted (stance over LOCK_ON), down (lift under
 *     LOCK_LIFT) AND STILL: the animated ANKLE's own speed over the world,
 *     this frame against the last, under LOCK_SPEED. The third clause is
 *     the one the new walk cycle made necessary. Its swing lands with the
 *     stance's own slope, so late in the swing a foot is already low —
 *     millimetres over the other — while still travelling forward; a lock
 *     taken there holds a point the animation then carries the foot 30 cm
 *     past, and MAX_LOCK snaps it. Speed is what tells a landing foot from
 *     a landed one. A first frame has no speed and cannot lock; a jump of
 *     more than MAX_LOCK in one frame is a teleport, not a speed, and
 *     cannot either. A candidate LOCKS once the body has come down far
 *     enough for its leg to reach (within LOCK_REACH): a lock is a foot on
 *     the ground, not one the animation says is nearly there.
 *     The lock first holds the ANKLE's world XZ, while the foot turns FLAT
 *     (rule 6); once flat it hands over to the BALL — flat, the ball is
 *     exactly where the ankle puts it, so the hand-over moves nothing — and
 *     the ball then stays put while the heel rises about it (rule 9).
 *     It lets go when the ANIMATION takes the foot away: its lower contact
 *     well clear of its ground (UNLOCK_CLEAR), or off it at all (LIFTOFF)
 *     and travelling faster than UNLOCK_SPEED — the pair catches a toe-off
 *     when the body is low, as in the first steps from standing — or its
 *     stance under LOCK_OFF. A body carried over a foot the animation
 *     holds still is none of those, so the foot keeps its spot. On letting
 *     go, the gap between where the lock held the ankle and where the
 *     animation has it is handed over as a DRIFT that decays over BLEND,
 *     so the swing starts from where the foot really was and never snaps.
 *     MAX_LOCK (the lock further than that from where the animation has
 *     the held point: a turn on the spot, a teleport) and release (rule 7)
 *     are safety nets; in a steady walk neither ends a lock, and
 *     `maxLockReleases` counts it if one ever does.
 *     GRIP: every frame the lock slides toward the animated held point by
 *     `1 − grip^(dt / SLIP_FRAME)` of the gap. Grip 1 never slides; grip
 *     0 slides all the way every frame, which is the foot following the
 *     animation: a slip. Written as a power of the grip so the slide per
 *     second does not depend on the frame rate.
 *
 *  6. A PLANTED FOOT IS FLAT. The walk cycle rocks the foot about its
 *     ankle — the hip's swing and the ankle's roll together pitch it about
 *     38° toes-up at landing and as far toes-down at toe-off, ±55° running
 *     — while holding the ANKLE still over the world. A foot that stood on
 *     that rocker would carry its ankle a heel-to-ball length (17-23 cm)
 *     ahead of the animated one through every stance, with the hip left
 *     where the animation put it. So a locked foot turns from the
 *     animation's orientation to flat — the bind's own angle of its
 *     ankle-to-ball line, on the animated heading — over FLATTEN_TIME,
 *     which is a heel strike's slap onto the floor, and a released foot
 *     turns back to the animation's over BLEND.
 *
 *  7. RELEASE (BE three.js's RELEASE): while the body stands on nothing —
 *     airborne, jumping, falling, swimming — or when the ground under a
 *     foot is further than RELEASE from the ground under the body (a
 *     ledge: the leg must not reach for the bottom of it), that foot's
 *     weight eases to 0 and its lock clears. Weights move toward what
 *     they want linearly over BLEND seconds, so snapping on and letting
 *     go are both a fade, and a fade that takes the same time at 30 fps
 *     as at 120.
 *
 *  8. THE DEAD ZONE (BE Godot): a target within DEAD_MIN of the animated
 *     ankle leaves the animated leg ALONE, ramping in by DEAD_MAX. On flat
 *     ground a standing body is exactly its animation. BE's zone was
 *     centimetres wide because re-solving a near-straight leg with an
 *     undefined bend plane is what crossed its idle legs; here the knee's
 *     plane always carries a forward bias (rule 10), so the zone can be a
 *     millimetre and a planted foot is held to the floor, not near it.
 *
 *  9. HEEL RISE, then ROOT DROP. A target a leg cannot reach has two
 *     answers, and a walker uses them in this order. A TRAILING foot locked
 *     flat on its ball first rises onto its toes: the foot pitches about
 *     its ball, which stays on its lock, and the ankle climbs the arc — up
 *     to HEEL_RISE of a leg, and never past HEEL_PITCH. Only what that
 *     still cannot reach brings the BODY down: the drop is the vertical
 *     distance that puts every planted leg within reach at its highest
 *     permitted heel, weighted by that foot's stance, clamped to MAX_DROP
 *     and eased — down fast, up slower (DROP_DOWN_TIME, DROP_UP_TIME).
 *     Then each heel rises only as far as it still needs to under the drop
 *     the body actually took. The heel rise is for a foot BEHIND where its
 *     leg hangs at rest (a leading foot lands heel first and never rises);
 *     its permission ramps with how far behind the foot is and eases in
 *     and out over BLEND, so it is zero for a body standing still on flat
 *     ground and it never pops. The drop is never negative: this module
 *     lowers a body onto its feet and never lifts one. "Within reach"
 *     means REACH of thigh + shin, OR as far as the animation already has
 *     the leg, whichever is longer, so a pose that stands on a straight leg
 *     is never pulled down merely for standing on it.
 *
 * 10. TWO-BONE IK per leg in the bind frame, from the (dropped) hip to
 *     the target ankle. The bend plane is the ANIMATED knee's — the part
 *     of knee − hip perpendicular to hip → target — with a small constant
 *     FORWARD bias added, and any BACKWARD part of the animated bend
 *     removed first. BIOLOGICAL SHAPE: a human knee is a hinge that
 *     flexes only one way, and it is forward (+Z, both masters face +Z).
 *     The bias is BE Godot's near-straight fallback made continuous: it
 *     is what decides the plane when the animated leg is straight and
 *     vanishes into the animated bend when it is not, instead of flipping
 *     between the two at a threshold. The corrected thigh is the shortest
 *     arc from the animated thigh to the solved one, applied ON TOP of
 *     the animated accumulated rotation (BE's `aimBone`), then the shin
 *     likewise from where the new hip carried it. The ANKLE keeps the
 *     animated foot's orientation, turned flat by rule 6 and pitched by
 *     rule 9 and by nothing else, so the sole does not tilt with a leg
 *     correction. Each is written back as a bind-frame turn
 *     `R_j = A_parent⁻¹ · A_j`, slerped with the animated turn by that
 *     foot's weight.
 *
 * ─── units and frames ────────────────────────────────────────────────
 *
 * Everything the IK does is in the BIND FRAME and the bind file's units,
 * where the turns are. Everything the world is asked — ground, locks,
 * grip, speed — is in WORLD METRES. The seam is `FeetFrame`: where the
 * model's root stands, its yaw (three.js `rotation.y`), and how many bind
 * units make a metre. The model root is the bind point (0, floorY, 0), and
 * it is LOWERED by `rootDrop`: the caller moves its model, this module
 * moves nothing but numbers.
 *
 * On the two masters as `view/HumanRig` loads them, one bind unit is
 * 0.85 m (`HumanRig.bindScale`, 1.176471 units per metre) and the soles
 * stand at bind y −1.0, the drawn body being bind × 0.85 lifted 0.85 m.
 * Those are the numbers an integrator passes; they are the rig's, not
 * this file's, which is why both are parameters.
 *
 * Pure: no three, no DOM, no storage, no network. This is core, and
 * `tests/simulationCore.test.ts` holds it to that. Deterministic, no
 * `Math.random`, and nothing allocated after the first call has grown
 * the caller's `out`.
 */

import {
  newJointTurn,
  type BindJoint,
  type HumanMeasure,
  type JointTurn,
  type MutableJointTurn,
} from './humanRig';

// ─── tuning ──────────────────────────────────────────────────────────

/**
 * The longest the ground scan may lead the ball, as a fraction of leg
 * length. GAME TUNING, carried from BE Godot's SCAN_FRAC (0.28), which
 * scanned this far ahead of every foot; here it is the cap on a lead that
 * scales with the foot's speed (SCAN_LEAD).
 */
export const SCAN_FRAC = 0.28;

/**
 * How far ahead in TIME the scan looks: the lead is the foot's speed
 * times this. GAME TUNING: about a sixth of a walking swing (the swing
 * is 0.4 of a cycle of roughly 1.1 s), so a foot sees a kerb in the last
 * third of its reach toward it, and a landing foot, whose speed has
 * fallen to nothing, reads the ground under itself.
 */
export const SCAN_LEAD = 0.12;

/**
 * A foot lifted this far above the other, as a fraction of leg length, is
 * mid-step and has no stance weight. GAME TUNING: BE Godot's SWING_H was
 * 0.16 m, which on a human leg of about 0.75 m is this fraction.
 */
export const SWING_FRAC = 0.2;

/** Seconds for a foot's weight, heel permission or lift to fade fully in or out. GAME TUNING, BE's BLEND_T. */
export const BLEND_TIME = 0.15;

/** Stance weight above which a foot may lock to the world. GAME TUNING. */
export const LOCK_ON = 0.9;

/**
 * Stance weight below which a lock lets go. GAME TUNING. Well below
 * LOCK_ON, so a foot hovering near the threshold cannot lock and unlock
 * on alternate frames and walk in little jerks.
 */
export const LOCK_OFF = 0.5;

/**
 * The most a foot may be lifted over the other and still lock, as a
 * fraction of leg length. GAME TUNING: 0.004 of a 0.73 m leg is 2.9 mm,
 * which is the whole of the step a lock takes when it zeroes the lift —
 * inside the contact the tests hold a locked foot to.
 */
export const LOCK_LIFT_FRAC = 0.004;

/**
 * How far short of its ground a candidate foot may still be, in metres,
 * and lock: the body has to have come down to within this of what the
 * leg needs. GAME TUNING, under the 3 mm a locked foot is held to.
 */
export const LOCK_REACH_M = 0.002;

/**
 * The fastest a foot's animated ANKLE may be moving over the world and
 * the foot still lock, in leg lengths per second. GAME TUNING, chosen off
 * the new walk cycle and measured in `tests/humanFeet.test.ts`'s walks
 * (both masters, 10 s at 1.4 m/s): through a walking stance the planted
 * animated ankle wobbles at no more than 0.13 legs/s (Jack; Sarah 0.07),
 * and on the last frame a landing foot is still above this gate it is
 * doing at least 0.34 (Sarah; Jack 0.46). 0.25 sits between the two, so
 * a walking lock is taken a frame or two after the foot has actually come
 * to rest — measured at 0.01 legs/s. Running (3.6 m/s) the stance wobble
 * reaches 0.32, above the gate, which is harmless: the gate is only asked
 * at landing, where a running foot comes down through 0.11–0.24.
 */
export const LOCK_SPEED_FRAC = 0.25;

/**
 * A locked foot whose animated lower contact stands this far above its
 * ground, as a fraction of leg length, is lifting off: it lets go at any
 * speed. GAME TUNING, off the walks and runs of `tests/humanFeet.test.ts`:
 * through a steady stance a planted foot's animated contact stands at
 * most 0.016 of a leg above its ground (Jack walking — his bind legs
 * slope back; Sarah, and both running, never above it), and a toe-off
 * passes 0.04 within a frame or two.
 */
export const UNLOCK_CLEAR_FRAC = 0.04;

/**
 * Off its ground by this much (a fraction of leg length, 3.6 mm on a
 * 0.73 m leg) AND carried over the world faster than UNLOCK_SPEED, a
 * locked foot is being taken away by the animation and lets go. GAME
 * TUNING: the pair catches a toe-off that UNLOCK_CLEAR alone misses when
 * the body is low — the first steps from standing, where a still-building
 * drop holds the animated foot down — while a body carried over a foot
 * the animation holds still, which is on its ground, never trips it.
 */
export const LIFTOFF_FRAC = 0.005;

/**
 * The speed, in leg lengths per second, above which a foot that is off
 * its ground at all is leaving (LIFTOFF). GAME TUNING: above everything a
 * planted animated ankle does in stance (0.13 legs/s walking, 0.32
 * running, measured as for LOCK_SPEED), below what a toe-off reaches
 * within two frames of leaving.
 */
export const UNLOCK_SPEED_FRAC = 0.45;

/**
 * Furthest a lock may sit from where the animation has the point it
 * holds (the ankle, or the ball once flat), as a fraction of leg length,
 * before the foot gives up. GAME TUNING: a safety net for a turn on the
 * spot or a teleport. A steady walk or run never reaches it — the planted
 * animated ankle drifts millimetres, not a third of a leg — and the tests
 * count that it never ends a lock there.
 */
export const MAX_LOCK_FRAC = 0.35;

/**
 * The frame length the grip is quoted per. GAME TUNING: at 60 fps a lock
 * on ground of grip g slides `1 − g` of its gap each frame, and at any
 * other rate the same amount per second.
 */
export const SLIP_FRAME = 1 / 60;

/**
 * A foot whose ground is further than this from the ground under the body
 * is over a ledge and lets go, in metres. GAME TUNING, BE three.js's
 * RELEASE (0.7 m): about a human's inside leg, the most a leg could step
 * down or up without the body going with it.
 */
export const RELEASE_M = 0.7;

/**
 * How far above the animated foot the ground search starts, in metres.
 * GAME TUNING, and not a free number: ground higher than RELEASE above
 * the foot would be released as a ledge anyway, so starting the search
 * any higher only risks finding a table top.
 */
export const SEARCH_UP_M = RELEASE_M;

/**
 * The dead zone, in metres: a target nearer the animated ankle than
 * DEAD_MIN leaves the leg alone, and the correction ramps to full by
 * DEAD_MAX. GAME TUNING. BE Godot's 0.02 / 0.06 let a planted foot float
 * by whatever fell inside it — measured here, a 0.005 / 0.015 zone left
 * a locked heel 5–8 mm off the floor for half the stance — and the reason
 * BE needed it wide (a near-straight leg re-solved with no bend plane
 * crossed its idle legs) is answered by the knee's forward bias instead.
 * A millimetre is still wide enough for a standing body on flat ground to
 * be exactly its animation.
 */
export const DEAD_MIN_M = 0.001;
export const DEAD_MAX_M = 0.002;

/**
 * The longest a solved leg may be, as a fraction of thigh + shin. GAME
 * TUNING: a leg solved to dead straight has no bend plane left to keep,
 * and the last half-percent is where a two-bone solve's knee snaps.
 */
export const REACH = 0.995;

/** The most the body may be lowered, as a fraction of leg length. GAME TUNING. */
export const MAX_DROP_FRAC = 0.35;

/**
 * Time constants, in seconds, of the body settling DOWN onto a leg that
 * cannot reach, and of it rising back once the leg can. GAME TUNING, and
 * deliberately unequal: a body that is late coming down is a planted foot
 * dragged along by a leg at full stretch — the one slip rule 5 exists to
 * forbid — while a body that is late coming up only stands a few
 * millimetres low for a tenth of a second.
 */
export const DROP_DOWN_TIME = 0.04;
export const DROP_UP_TIME = 0.1;

/**
 * Below this a drop is arithmetic residue, not a posture, in metres: a
 * straight leg standing on the floor it was posed for computes a need of
 * 1e-16, and a body that never quite reaches zero would never report
 * standing at its full height.
 */
const DROP_EPSILON_M = 1e-6;

/**
 * The forward bias added to the knee's bend plane, as a fraction of leg
 * length. GAME TUNING: large beside the few millimetres of sideways
 * wobble a straight bind leg carries (Jack's is 2.4 mm), small beside the
 * several centimetres a walking knee is bent by, so it decides only the
 * case the animation leaves undecided.
 */
export const POLE_FORWARD_FRAC = 0.05;

/**
 * Where the heel's contact sits behind the ankle, as a fraction of the
 * ankle-to-ball distance. BIOLOGICAL SHAPE, approximate: in an adult foot
 * the ankle joint stands about a quarter of the foot's length from the
 * back of the heel and the ball about seven tenths, and the heel bears on
 * the rounded pad a little forward of its back edge — which puts the
 * contact about a third of the ankle-to-ball span behind the ankle.
 */
export const HEEL_BACK_FRAC = 0.3;

/**
 * The most a trailing heel may rise, as the ANKLE's climb in fractions of
 * leg length. GAME TUNING inside biology, set against the foot: 0.1 of a
 * leg is 7.3 cm on Sarah and 7.4 on Jack, about 0.3 of an adult foot's
 * length (0.15 of stature, ~25 cm) and half their own ankle-to-ball span
 * (15 and 17 cm) — a heel off the floor by a third of the foot, which is
 * a walker's toe-off and not yet a sprinter's. On these feet HEEL_PITCH
 * binds first: 45° about the ball climbs the ankle 6.7 cm (Sarah) and
 * 7.2 cm (Jack). The walks in `tests/humanFeet.test.ts` use up to 4.4 and
 * 5.6 cm of it.
 */
export const HEEL_RISE_FRAC = 0.1;

/**
 * The most the foot may pitch about its ball. GAME TUNING, set by the
 * same push-off anatomy as HEEL_RISE: beyond this a foot reads as a
 * dancer's pointe, not a walker's toe-off.
 */
export const HEEL_PITCH = (45 * Math.PI) / 180;

/**
 * How far behind its rest position a foot must be before it may rise
 * fully onto its toes, as a fraction of leg length. GAME TUNING: the
 * permission ramps from nothing at the leg's rest line to all of it this
 * far back, so a foot standing under its hip never rises and a trailing
 * foot in a stride (a quarter of a leg back, or more) always may.
 */
export const HEEL_BEHIND_FRAC = 0.1;

/**
 * Seconds for a locked foot to go from the animation's orientation to
 * flat. GAME TUNING toward the measured: a walking foot is flat on the
 * ground about a tenth of a second after the heel strikes (the loading
 * response is the first ~10% of a ~1.1 s cycle).
 */
export const FLATTEN_TIME = 0.1;

// ─── public shapes ───────────────────────────────────────────────────

/**
 * What is under a point of the world: its height (world metres) and how
 * much grip it has, 0 (ice, no grip) .. 1 (normal floor). null = nothing
 * there / not loaded.
 */
export interface FootGround {
  readonly y: number;
  readonly grip: number;
}

export interface FeetFrame {
  /** Seconds since the last call (the simulation dt). */
  readonly dt: number;
  /**
   * True while the body is not standing on anything: airborne, jumping,
   * falling, swimming. Feet let go and follow the animation.
   */
  readonly released: boolean;
  /**
   * Where the model's root (the point between its soles, bind y = floorY)
   * stands in the world, metres, and its yaw in radians using three.js
   * Object3D.rotation.y semantics (a bind-frame vector (x, z) maps to world
   * (x·cosψ + z·sinψ, −x·sinψ + z·cosψ)).
   */
  readonly rootX: number;
  readonly rootY: number;
  readonly rootZ: number;
  readonly rootYaw: number;
  /** Bind-frame units per world metre (the rig's bind positions ÷ this = metres). */
  readonly unitsPerMetre: number;
  /** Ground under a world point, searched downward from fromY (world metres). */
  groundAt(x: number, z: number, fromY: number): FootGround | null;
}

/** One foot's memory between frames. Readable by a HUD or a test; written only here. */
export interface FootState {
  /** Eased 0..1: how much this foot is grounded at all (release, ledges, nothing under it). */
  weight: number;
  /** `weight` times the swing gate: how PLANTED the foot is. Last frame's value. */
  stance: number;
  /** The weight the IK was actually applied with last frame (dead zone included). */
  applied: number;
  /** Whether the foot holds a world point. */
  locked: boolean;
  /** What the lock holds: the ankle while the foot goes flat, then the ball. */
  onBall: boolean;
  /** Eased 0..1: how far a locked foot has turned from the animation's orientation to flat. */
  flat: number;
  /** The held point — the ankle's or, once flat, the ball's world XZ, metres. Meaningful only while `locked`. */
  lockX: number;
  lockZ: number;
  /** The last ground found under this foot's ball (and the lead ahead of it), and under its heel, world metres. */
  groundY: number;
  heelGroundY: number;
  hasGround: boolean;
  /** The grip of that ground, 0..1. The next frame's slide reads it. */
  grip: number;
  /** The animated ankle's speed over the world last frame, m/s; Infinity when there is no sample. */
  speed: number;
  /** Last frame's animated ankle, world metres, for the speed. */
  prevX: number;
  prevZ: number;
  hasPrev: boolean;
  /** How far the ANIMATED foot's lower contact stands above this foot's ground, metres, last frame. */
  clear: number;
  /** Metres this foot asked the body to come down last frame, at its highest permitted heel, before its stance weighting. */
  need: number;
  /** Eased 0..1: how much of HEEL_RISE this foot is permitted. */
  heel: number;
  /** The heel rise used last frame: the ankle's climb in metres, and the foot's pitch in radians. */
  heelRise: number;
  heelPitch: number;
  /** Eased 0..1: how much of its lift an unlocked foot's target carries. */
  liftShare: number;
  /** The gap between a released lock and the animation, world metres, decaying over BLEND. */
  driftX: number;
  driftZ: number;
  /** How many locks this foot has taken, and how many MAX_LOCK ended. A steady walk keeps the second at 0. */
  locks: number;
  maxLockReleases: number;
  /** Last frame's target ankle, world metres. */
  targetX: number;
  targetY: number;
  targetZ: number;
}

/** A leg of the rig, resolved once at `createFeet`. Bind units. */
export interface LegRig {
  readonly hip: number;
  readonly knee: number;
  readonly ankle: number;
  readonly hipParent: number;
  readonly kneeParent: number;
  readonly ankleParent: number;
  readonly thigh: number;
  readonly shin: number;
  /** The ankle's bind height above the soles. */
  readonly sole: number;
  /** The ankle's first child — the ball — or -1 when the ankle has none. */
  readonly ball: number;
  /** Ball minus ankle in the bind; zero when there is no ball. */
  readonly ballX: number;
  readonly ballY: number;
  readonly ballZ: number;
  /** The ball's bind height above the soles (its contact is this far under it); `sole` when there is no ball. */
  readonly ballClear: number;
  /** The heel contact minus the ankle in the bind: on the floor, HEEL_BACK behind. */
  readonly heelX: number;
  readonly heelY: number;
  readonly heelZ: number;
  /** Ankle z minus hip z in the bind: where this leg's foot hangs at rest. */
  readonly restZ: number;
}

interface Vec {
  x: number;
  y: number;
  z: number;
}

interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Per-leg working values for one frame. Reused, never reallocated. Bind units unless named. */
interface LegWork {
  hipTurn: number;
  kneeTurn: number;
  ankleTurn: number;
  /** The animated ball and heel-contact offsets from the ankle, carried by the animated foot. */
  abx: number;
  aby: number;
  abz: number;
  ahx: number;
  ahy: number;
  ahz: number;
  /** The same offsets as the foot STANDS: turned toward flat by `flat`, before any heel pitch. */
  bx: number;
  by: number;
  bz: number;
  hx: number;
  hy: number;
  hz: number;
  /** That turn toward flat, xyzw, and the heel's pitch axis (horizontal, x and z). */
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  kx: number;
  kz: number;
  /** The animated foot's lowest contact height. */
  low: number;
  /** Whether this leg has a target at all this frame. */
  active: boolean;
  /** Whether `pointX, pointZ` is the ball (a locked, flat foot) rather than the ankle. */
  onBall: boolean;
  /** The target point's bind XZ and the ground's bind height, for a body NOT lowered. */
  pointX: number;
  pointZ: number;
  groundY: number;
  /** The ground under the heel, bind height for a body NOT lowered. */
  heelGroundY: number;
  /** Lift carried by the target. */
  lift: number;
  /** Largest heel pitch permitted, and the pitch chosen. */
  pitchLimit: number;
  pitch: number;
  /** For a ball-less rig, the straight ankle rise permitted and chosen. */
  riseLimit: number;
  rise: number;
  /** The solved target ankle, bind frame of the LOWERED body. */
  tx: number;
  ty: number;
  tz: number;
}

export interface FeetState {
  /** Bind-frame height of the soles. */
  readonly floorY: number;
  /** Left foot, then right. */
  readonly feet: readonly [FootState, FootState];
  /** Metres the body is currently lowered by, smoothed. */
  rootDrop: number;

  readonly legs: readonly [LegRig, LegRig];
  readonly legLength: number;
  /** Joint indices, every parent before its children. */
  readonly order: Int32Array;
  /** Per joint: the index of the turn naming it this frame, or -1. */
  readonly turnOf: Int32Array;
  /** Per joint: accumulated animated rotation, xyzw. */
  readonly rot: Float64Array;
  /** Per joint: animated position, bind frame. */
  readonly pos: Float64Array;
  readonly work: readonly [LegWork, LegWork];
  /** The view handed back when `out` is longer than the input. */
  readonly view: MutableJointTurn[];
  readonly result: { turns: readonly JointTurn[]; rootDrop: number };
  /** The ground answer each foot's search writes into. */
  readonly ground: GroundUnder;
  readonly q: readonly Quat[];
  readonly v: readonly Vec[];
}

/** What lies under a foot: its ball (with the lead ahead), its heel, the higher of the two, and the ball's grip. */
interface GroundUnder {
  y: number;
  heelY: number;
  top: number;
  grip: number;
}

export interface FeetResult {
  readonly turns: readonly JointTurn[];
  /** Metres to LOWER the model root this frame (≥ 0) so the feet can reach their ground. */
  readonly rootDrop: number;
}


// ─── small quaternion arithmetic, allocation-free ────────────────────

function qSet(o: Quat, x: number, y: number, z: number, w: number): Quat {
  o.x = x;
  o.y = y;
  o.z = z;
  o.w = w;
  return o;
}

function qCopy(o: Quat, a: Quat): Quat {
  return qSet(o, a.x, a.y, a.z, a.w);
}

/** o = a · b. Safe when o aliases a or b. */
function qMul(o: Quat, a: Quat, b: Quat): Quat {
  return qSet(
    o,
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  );
}

/** The inverse of a unit quaternion. */
function qInv(o: Quat, a: Quat): Quat {
  return qSet(o, -a.x, -a.y, -a.z, a.w);
}

function qNormalize(o: Quat): Quat {
  const n = Math.hypot(o.x, o.y, o.z, o.w);
  if (n < 1e-12) return qSet(o, 0, 0, 0, 1);
  return qSet(o, o.x / n, o.y / n, o.z / n, o.w / n);
}

function qFromTurn(o: Quat, turn: JointTurn): Quat {
  const half = turn.radians * 0.5;
  const s = Math.sin(half);
  return qSet(o, turn.ax * s, turn.ay * s, turn.az * s, Math.cos(half));
}

function qLoad(o: Quat, from: Float64Array, i: number): Quat {
  const k = i * 4;
  return qSet(o, from[k], from[k + 1], from[k + 2], from[k + 3]);
}

function qStore(to: Float64Array, i: number, a: Quat): void {
  const k = i * 4;
  to[k] = a.x;
  to[k + 1] = a.y;
  to[k + 2] = a.z;
  to[k + 3] = a.w;
}

/** o = q applied to (x, y, z). o may not alias q. */
function qRotate(o: Vec, q: Quat, x: number, y: number, z: number): Vec {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  o.x = x + q.w * tx + q.y * tz - q.z * ty;
  o.y = y + q.w * ty + q.z * tx - q.x * tz;
  o.z = z + q.w * tz + q.x * ty - q.y * tx;
  return o;
}

/** The shortest arc turning direction a onto direction b (neither need be unit). */
function qArc(o: Quat, a: Vec, b: Vec): Quat {
  const la = Math.hypot(a.x, a.y, a.z);
  const lb = Math.hypot(b.x, b.y, b.z);
  if (la < 1e-12 || lb < 1e-12) return qSet(o, 0, 0, 0, 1);
  const ax = a.x / la;
  const ay = a.y / la;
  const az = a.z / la;
  const bx = b.x / lb;
  const by = b.y / lb;
  const bz = b.z / lb;
  const d = ax * bx + ay * by + az * bz;
  if (d < -0.999999) {
    // Opposite: any axis perpendicular to a will do; a thigh never gets here.
    let px = 0;
    let py = -az;
    let pz = ay;
    if (py * py + pz * pz < 1e-6) {
      px = az;
      py = 0;
      pz = -ax;
    }
    return qNormalize(qSet(o, px, py, pz, 0));
  }
  // (a × b, 1 + a·b), normalised: half the angle without a trig call.
  return qNormalize(qSet(o, ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx, 1 + d));
}

/** o = slerp(a, b, t), taking the short way round. o may alias a. */
function qSlerp(o: Quat, a: Quat, b: Quat, t: number): Quat {
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  let cos = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let wa: number;
  let wb: number;
  if (cos > 0.9995) {
    wa = 1 - t;
    wb = t;
  } else {
    const angle = Math.acos(cos);
    const sin = Math.sin(angle);
    wa = Math.sin((1 - t) * angle) / sin;
    wb = Math.sin(t * angle) / sin;
  }
  return qNormalize(qSet(o, a.x * wa + bx * wb, a.y * wa + by * wb, a.z * wa + bz * wb, a.w * wa + bw * wb));
}

/** Write a unit quaternion into a turn as an axis and an angle, the way `humanPose` does. */
function writeQuatTurn(turn: MutableJointTurn, joint: number, q: Quat): void {
  let x = q.x;
  let y = q.y;
  let z = q.z;
  let w = q.w;
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  turn.joint = joint;
  const sine = Math.hypot(x, y, z);
  if (sine < 1e-12) {
    turn.ax = 0;
    turn.ay = 1;
    turn.az = 0;
    turn.radians = 0;
    return;
  }
  turn.ax = x / sine;
  turn.ay = y / sine;
  turn.az = z / sine;
  turn.radians = 2 * Math.atan2(sine, w);
}

function copyTurn(to: MutableJointTurn, from: JointTurn): void {
  to.joint = from.joint;
  to.ax = from.ax;
  to.ay = from.ay;
  to.az = from.az;
  to.radians = from.radians;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function moveToward(value: number, target: number, step: number): number {
  if (value < target) return Math.min(target, value + step);
  return Math.max(target, value - step);
}

// ─── the rig, once ───────────────────────────────────────────────────

function span(bind: readonly BindJoint[], a: number, b: number): number {
  return Math.hypot(bind[a].x - bind[b].x, bind[a].y - bind[b].y, bind[a].z - bind[b].z);
}

function readLegRig(bind: readonly BindJoint[], hip: number, knee: number, ankle: number, floorY: number): LegRig {
  const a = bind[ankle];
  const sole = a.y - floorY;
  // The ball is the ankle's first child in the bind file's own order.
  let ball = -1;
  for (let i = 0; i < bind.length; i += 1) {
    if (bind[i].parent === ankle) {
      ball = i;
      break;
    }
  }
  const ballX = ball >= 0 ? bind[ball].x - a.x : 0;
  const ballY = ball >= 0 ? bind[ball].y - a.y : 0;
  const ballZ = ball >= 0 ? bind[ball].z - a.z : 0;
  const ballClear = ball >= 0 ? bind[ball].y - floorY : sole;
  // The heel lies BEHIND the ankle along the foot's own line, which is the
  // ankle-to-ball direction flattened onto the floor.
  const along = Math.hypot(ballX, ballZ);
  const back = HEEL_BACK_FRAC * along;
  return {
    hip,
    knee,
    ankle,
    hipParent: bind[hip].parent,
    kneeParent: bind[knee].parent,
    ankleParent: a.parent,
    thigh: span(bind, hip, knee),
    shin: span(bind, knee, ankle),
    sole,
    ball,
    ballX,
    ballY,
    ballZ,
    ballClear,
    heelX: along > 0 ? (-ballX / along) * back : 0,
    heelY: -sole,
    heelZ: along > 0 ? (-ballZ / along) * back : 0,
    restZ: a.z - bind[hip].z,
  };
}

function newFoot(): FootState {
  return {
    weight: 0,
    stance: 0,
    applied: 0,
    locked: false,
    onBall: false,
    flat: 0,
    lockX: 0,
    lockZ: 0,
    groundY: 0,
    heelGroundY: 0,
    hasGround: false,
    grip: 1,
    speed: Infinity,
    prevX: 0,
    prevZ: 0,
    hasPrev: false,
    clear: 0,
    need: 0,
    heel: 0,
    heelRise: 0,
    heelPitch: 0,
    liftShare: 1,
    driftX: 0,
    driftZ: 0,
    locks: 0,
    maxLockReleases: 0,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
  };
}

function newWork(): LegWork {
  return {
    hipTurn: -1,
    kneeTurn: -1,
    ankleTurn: -1,
    abx: 0,
    aby: 0,
    abz: 0,
    ahx: 0,
    ahy: 0,
    ahz: 0,
    bx: 0,
    by: 0,
    bz: 0,
    hx: 0,
    hy: 0,
    hz: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    kx: 1,
    kz: 0,
    low: 0,
    active: false,
    onBall: false,
    pointX: 0,
    pointZ: 0,
    groundY: 0,
    heelGroundY: 0,
    lift: 0,
    pitchLimit: 0,
    pitch: 0,
    riseLimit: 0,
    rise: 0,
    tx: 0,
    ty: 0,
    tz: 0,
  };
}

/**
 * A body's feet, before the first frame. Both feet start UNGROUNDED and
 * fade in over BLEND_TIME, so a body placed into the world settles onto
 * its feet rather than snapping.
 *
 * `floorY` is the bind-frame height of the soles — the drawn body's
 * y = 0. Default 0; −1.0 on the two masters as `view/HumanRig` loads
 * them (see the header).
 */
export function createFeet(measure: HumanMeasure, bind: readonly BindJoint[], floorY = 0): FeetState {
  const n = bind.length;
  const joints = measure.joints;

  // Parent-first order by depth, so the forward pass never reads a parent
  // it has not written. The fixture already stores parents first; a
  // re-export is not obliged to.
  const depth = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    let d = 0;
    for (let at = bind[i].parent; at >= 0 && d <= n; at = bind[at].parent) d += 1;
    depth[i] = d;
  }
  const order = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => depth[a] - depth[b] || a - b);

  const q: Quat[] = [];
  for (let i = 0; i < 12; i += 1) q.push({ x: 0, y: 0, z: 0, w: 1 });
  const v: Vec[] = [];
  for (let i = 0; i < 8; i += 1) v.push({ x: 0, y: 0, z: 0 });

  return {
    floorY,
    feet: [newFoot(), newFoot()],
    rootDrop: 0,
    legs: [
      readLegRig(bind, joints.hipL, joints.kneeL, joints.ankleL, floorY),
      readLegRig(bind, joints.hipR, joints.kneeR, joints.ankleR, floorY),
    ],
    legLength: measure.legLength,
    order,
    turnOf: new Int32Array(n).fill(-1),
    rot: new Float64Array(n * 4),
    pos: new Float64Array(n * 3),
    work: [newWork(), newWork()],
    view: [],
    result: { turns: [], rootDrop: 0 },
    ground: { y: 0, heelY: 0, top: 0, grip: 1 },
    q,
    v,
  };
}

/**
 * The animated skeleton: every joint's accumulated rotation and position
 * in the bind frame, written into `state.rot` and `state.pos`. Exported
 * because a caller drawing debug feet, or a test, needs exactly this and
 * nothing else — the same arithmetic the renderer does.
 */
export function animateBind(state: FeetState, bind: readonly BindJoint[], turns: readonly JointTurn[]): void {
  const { turnOf, rot, pos, order } = state;
  const n = bind.length;
  turnOf.fill(-1);
  for (let i = 0; i < turns.length; i += 1) {
    const joint = turns[i].joint;
    if (joint >= 0 && joint < n) turnOf[joint] = i;
  }
  const carried = state.q[0];
  const own = state.q[1];
  const offset = state.v[0];
  for (let k = 0; k < n; k += 1) {
    const j = order[k];
    const parent = bind[j].parent;
    if (parent < 0) qSet(carried, 0, 0, 0, 1);
    else qLoad(carried, rot, parent);
    const t = turnOf[j];
    if (t >= 0) qMul(carried, carried, qFromTurn(own, turns[t]));
    qStore(rot, j, carried);
    if (parent < 0) {
      pos[j * 3] = bind[j].x;
      pos[j * 3 + 1] = bind[j].y;
      pos[j * 3 + 2] = bind[j].z;
    } else {
      qLoad(carried, rot, parent);
      qRotate(offset, carried, bind[j].x - bind[parent].x, bind[j].y - bind[parent].y, bind[j].z - bind[parent].z);
      pos[j * 3] = pos[parent * 3] + offset.x;
      pos[j * 3 + 1] = pos[parent * 3 + 1] + offset.y;
      pos[j * 3 + 2] = pos[parent * 3 + 2] + offset.z;
    }
  }
}


// ─── the frame ───────────────────────────────────────────────────────

/**
 * The ankle, in the bind frame of a body NOT lowered, for a planted foot
 * pitched `pitch` about its ball (heel up) and, on a rig with no ball,
 * raised a straight `rise`: the target point is the ankle itself, or the
 * ball once a locked foot has gone flat, and the lower of the foot's two
 * contacts stands on the ground plus the target's lift. Written into
 * `into`.
 */
function ankleAt(leg: LegRig, work: LegWork, pitch: number, rise: number, into: Vec): Vec {
  let bx = work.bx;
  let by = work.by;
  let bz = work.bz;
  let hy = work.hy;
  if (pitch !== 0) {
    // Rodrigues about the foot's horizontal lateral axis k = (kx, 0, kz):
    // v' = v·c + (k × v)·s + k (k · v)(1 − c). +pitch tips the ball end
    // DOWN, which is the heel up.
    const c = Math.cos(pitch);
    const s = Math.sin(pitch);
    const kx = work.kx;
    const kz = work.kz;
    const kb = (kx * work.bx + kz * work.bz) * (1 - c);
    bx = work.bx * c - kz * work.by * s + kx * kb;
    by = work.by * c + (kz * work.bx - kx * work.bz) * s;
    bz = work.bz * c + kx * work.by * s + kz * kb;
    hy = work.hy * c + (kz * work.hx - kx * work.hz) * s;
  }
  // Each contact on or above its OWN ground, the foot resting on whichever
  // touches first: over even ground that is the lower contact on the floor,
  // and across a kerb it is a foot that lands with its ball on the step and
  // its heel over the road, never a heel stood on air at the step's height.
  const onBall = work.groundY - (by - leg.ballClear);
  const onHeel = work.heelGroundY - hy;
  if (work.onBall) {
    into.x = work.pointX - bx;
    into.z = work.pointZ - bz;
  } else {
    into.x = work.pointX;
    into.z = work.pointZ;
  }
  into.y = Math.max(onBall, onHeel) + work.lift + rise;
  return into;
}

/**
 * How far, in bind units, the body would have to come down for this leg
 * to reach its ankle target with this heel rise. Zero when it reaches.
 */
function needFor(state: FeetState, leg: LegRig, work: LegWork, pitch: number, rise: number): number {
  const pos = state.pos;
  const ankle = ankleAt(leg, work, pitch, rise, state.v[0]);
  const hx = pos[leg.hip * 3];
  const hy = pos[leg.hip * 3 + 1];
  const hz = pos[leg.hip * 3 + 2];
  const animated = Math.hypot(pos[leg.ankle * 3] - hx, pos[leg.ankle * 3 + 1] - hy, pos[leg.ankle * 3 + 2] - hz);
  const reach = Math.max(REACH * (leg.thigh + leg.shin), animated);
  const across = Math.hypot(ankle.x - hx, ankle.z - hz);
  const down = hy - ankle.y;
  const need = across < reach ? down - Math.sqrt(reach * reach - across * across) : down;
  return need > 0 ? need : 0;
}

/** Bisection steps for the heel's two searches: 2^-16 of 45° is 0.0007°. */
const SEARCH_STEPS = 16;

/**
 * The largest pitch whose ankle climb stays within `cap` (bind units),
 * never past HEEL_PITCH. The climb grows with the pitch over that range:
 * the ankle rises on its arc about the ball until it stands over it, which
 * is well past 45° on both masters.
 */
function pitchLimitFor(leg: LegRig, work: LegWork, cap: number, scratch: Vec): number {
  if (cap <= 0) return 0;
  const base = ankleAt(leg, work, 0, 0, scratch).y;
  if (ankleAt(leg, work, HEEL_PITCH, 0, scratch).y - base <= cap) return HEEL_PITCH;
  let lo = 0;
  let hi = HEEL_PITCH;
  for (let i = 0; i < SEARCH_STEPS; i += 1) {
    const mid = (lo + hi) * 0.5;
    if (ankleAt(leg, work, mid, 0, scratch).y - base <= cap) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * The least heel (pitch, or straight rise on a ball-less rig) that lets
 * the leg reach under a body lowered by `drop` (bind units), within the
 * permitted limit. The need falls as the heel rises — the ankle climbs
 * and, for a trailing foot, comes forward toward the hip.
 */
function heelFor(state: FeetState, leg: LegRig, work: LegWork, drop: number): void {
  work.pitch = 0;
  work.rise = 0;
  if (work.pitchLimit <= 0 && work.riseLimit <= 0) return;
  if (needFor(state, leg, work, 0, 0) <= drop) return;
  const byPitch = work.pitchLimit > 0;
  const limit = byPitch ? work.pitchLimit : work.riseLimit;
  if (needFor(state, leg, work, byPitch ? limit : 0, byPitch ? 0 : limit) >= drop) {
    if (byPitch) work.pitch = limit;
    else work.rise = limit;
    return;
  }
  let lo = 0;
  let hi = limit;
  for (let i = 0; i < SEARCH_STEPS; i += 1) {
    const mid = (lo + hi) * 0.5;
    if (needFor(state, leg, work, byPitch ? mid : 0, byPitch ? 0 : mid) <= drop) hi = mid;
    else lo = mid;
  }
  if (byPitch) work.pitch = hi;
  else work.rise = hi;
}

/**
 * Correct the leg turns of an animated pose so each foot stands on its
 * own ground. `turns` is poseHuman's output (read-only); `out` is a
 * caller-owned buffer the corrected list is written into (grow it once,
 * never allocate per frame after the first call).
 *
 * The returned list has exactly `turns.length` entries, in `turns`'s
 * order; every turn that is not a hip, knee or ankle is copied through
 * untouched, and so is every leg turn whose foot has no correction to
 * make. A leg whose hip or knee the list does not name is left alone —
 * a turn cannot be added without changing the list's length. An ankle
 * the list does not name costs the foot its flattening and its heel
 * pitch: the leg is still solved.
 */
export function groundFeet(
  state: FeetState,
  measure: HumanMeasure,
  bind: readonly BindJoint[],
  turns: readonly JointTurn[],
  frame: FeetFrame,
  out: MutableJointTurn[],
): FeetResult {
  const count = turns.length;
  while (out.length < count) out.push(newJointTurn());
  for (let i = 0; i < count; i += 1) copyTurn(out[i], turns[i]);

  animateBind(state, bind, turns);

  const upm = frame.unitsPerMetre > 0 ? frame.unitsPerMetre : 1;
  const dt = Math.max(0, frame.dt);
  const floorY = state.floorY;
  const cos = Math.cos(frame.rootYaw);
  const sin = Math.sin(frame.rootYaw);
  const legB = measure.legLength > 0 ? measure.legLength : state.legLength;
  const legM = legB / upm;
  const pos = state.pos;
  const rot = state.rot;
  const footQ = state.q[9];
  const flatQ = state.q[11];
  const scratch = state.v[1];
  const offset = state.v[2];
  const aim = state.v[3];
  const flatAim = state.v[4];

  // The body's forward, in the world: bind +Z under the yaw.
  const fwdX = sin;
  const fwdZ = cos;

  const rootGround = frame.released ? null : frame.groundAt(frame.rootX, frame.rootZ, frame.rootY + SEARCH_UP_M);

  // Each foot's two contacts as the animation carries them, and the lower
  // of them: the stance reference every lift is measured from.
  let lowMin = Infinity;
  for (let side = 0; side < 2; side += 1) {
    const leg = state.legs[side];
    const work = state.work[side];
    work.hipTurn = state.turnOf[leg.hip];
    work.kneeTurn = state.turnOf[leg.knee];
    work.ankleTurn = state.turnOf[leg.ankle];
    qLoad(footQ, rot, leg.ankle);
    qRotate(offset, footQ, leg.ballX, leg.ballY, leg.ballZ);
    work.abx = offset.x;
    work.aby = offset.y;
    work.abz = offset.z;
    qRotate(offset, footQ, leg.heelX, leg.heelY, leg.heelZ);
    work.ahx = offset.x;
    work.ahy = offset.y;
    work.ahz = offset.z;
    work.low = pos[leg.ankle * 3 + 1] + Math.min(work.ahy, work.aby - leg.ballClear);
    if (work.low < lowMin) lowMin = work.low;
  }

  const blendStep = BLEND_TIME > 0 ? dt / BLEND_TIME : 1;
  const flattenStep = FLATTEN_TIME > 0 ? dt / FLATTEN_TIME : 1;
  const decay = dt > 0 ? Math.exp(-dt / BLEND_TIME) : 1;
  let wantDrop = 0;

  for (let side = 0; side < 2; side += 1) {
    const leg = state.legs[side];
    const foot = state.feet[side];
    const work = state.work[side];
    work.active = false;
    work.pitchLimit = 0;
    work.riseLimit = 0;

    const lift = (work.low - lowMin) / upm;
    const gate = 1 - clamp(lift / (SWING_FRAC * legM), 0, 1);

    // The animated ankle in the world (a drop moves no XZ).
    const fx = pos[leg.ankle * 3] / upm;
    const fz = pos[leg.ankle * 3 + 2] / upm;
    const ankleX = frame.rootX + fx * cos + fz * sin;
    const ankleZ = frame.rootZ - fx * sin + fz * cos;
    const ankleY = frame.rootY - state.rootDrop + (pos[leg.ankle * 3 + 1] - floorY) / upm;

    // The ankle's speed over the world. No sample, no speed: a first frame
    // cannot lock, and a jump past MAX_LOCK in one frame is a teleport.
    if (dt > 0) {
      if (foot.hasPrev) {
        const moved = Math.hypot(ankleX - foot.prevX, ankleZ - foot.prevZ);
        foot.speed = moved > MAX_LOCK_FRAC * legM ? Infinity : moved / dt;
      } else {
        foot.speed = Infinity;
      }
      foot.prevX = ankleX;
      foot.prevZ = ankleZ;
      foot.hasPrev = true;
    }
    foot.driftX *= decay;
    foot.driftZ *= decay;

    // The foot as it stands: the animation's orientation turned toward
    // FLAT by the planted share `flat`. Flat is the bind's own angle of the
    // ankle-to-ball line under the horizon, on the animated foot's heading.
    const hb = Math.hypot(work.abx, work.abz);
    const headX = hb > 1e-9 ? work.abx / hb : 0;
    const headZ = hb > 1e-9 ? work.abz / hb : 1;
    const len = Math.hypot(leg.ballX, leg.ballY, leg.ballZ);
    const bindAlong = Math.hypot(leg.ballX, leg.ballZ);
    aim.x = work.abx;
    aim.y = work.aby;
    aim.z = work.abz;
    flatAim.x = headX * bindAlong;
    flatAim.y = leg.ballY;
    flatAim.z = headZ * bindAlong;
    if (leg.ball >= 0 && len > 0 && foot.flat > 0) {
      qArc(flatQ, aim, flatAim);
      qSlerp(flatQ, qSet(footQ, 0, 0, 0, 1), flatQ, foot.flat);
    } else {
      qSet(flatQ, 0, 0, 0, 1);
    }
    work.qx = flatQ.x;
    work.qy = flatQ.y;
    work.qz = flatQ.z;
    work.qw = flatQ.w;
    qRotate(offset, flatQ, work.abx, work.aby, work.abz);
    work.bx = offset.x;
    work.by = offset.y;
    work.bz = offset.z;
    qRotate(offset, flatQ, work.ahx, work.ahy, work.ahz);
    work.hx = offset.x;
    work.hy = offset.y;
    work.hz = offset.z;
    // The heel pitches about the foot's own lateral axis: up × heading.
    work.kx = headZ;
    work.kz = -headX;
    const ballDX = (work.bx * cos + work.bz * sin) / upm;
    const ballDZ = (-work.bx * sin + work.bz * cos) / upm;
    const heelDX = (work.hx * cos + work.hz * sin) / upm;
    const heelDZ = (-work.hx * sin + work.hz * cos) / upm;

    if (foot.locked) {
      // A foot that has gone flat hands its lock from the ankle to the
      // ball — flat, the ball is exactly where the ankle puts it, so the
      // hand-over moves nothing — and from then on the heel may rise.
      if (!foot.onBall && leg.ball >= 0 && foot.flat >= 1) {
        foot.lockX += ballDX;
        foot.lockZ += ballDZ;
        foot.onBall = true;
      }
      // Grip: the ground that was holding the foot is the ground it slips
      // on, so the grip is the one found under it last frame.
      const heldX = ankleX + (foot.onBall ? ballDX : 0);
      const heldZ = ankleZ + (foot.onBall ? ballDZ : 0);
      const grip = clamp(foot.grip, 0, 1);
      const slide = dt > 0 ? 1 - Math.pow(grip, dt / SLIP_FRAME) : 0;
      foot.lockX += (heldX - foot.lockX) * slide;
      foot.lockZ += (heldZ - foot.lockZ) * slide;
      if (Math.hypot(foot.lockX - heldX, foot.lockZ - heldZ) > MAX_LOCK_FRAC * legM) {
        release(foot, false, ankleX, ankleZ);
        foot.maxLockReleases += 1;
      }
    }

    // Where the ankle stands over the world, before any heel rise.
    let atX = foot.locked ? foot.lockX - (foot.onBall ? ballDX : 0) : ankleX + foot.driftX;
    let atZ = foot.locked ? foot.lockZ - (foot.onBall ? ballDZ : 0) : ankleZ + foot.driftZ;
    const lead = Math.min(SCAN_FRAC * legM, (Number.isFinite(foot.speed) ? foot.speed : 0) * SCAN_LEAD);
    const fromY = ankleY + SEARCH_UP_M;
    let ground = frame.released
      ? null
      : groundUnder(frame, state.ground, atX, atZ, ballDX, ballDZ, heelDX, heelDZ, fwdX * lead, fwdZ * lead, fromY);

    const grounded = ground !== null && rootGround !== null && Math.abs(ground.top - rootGround.y) <= RELEASE_M;
    foot.weight = moveToward(foot.weight, grounded ? 1 : 0, blendStep);
    foot.stance = foot.weight * gate;

    // How far the animation has the foot off this ground: the measure of a
    // foot LEAVING that works in a run's flight too, where both feet are up
    // and the lift of one over the other says nothing.
    foot.clear = ground !== null
      ? Math.min(ankleY + (work.aby - leg.ballClear) / upm - ground.y, ankleY + work.ahy / upm - ground.heelY)
      : 0;

    // LEAVING is the ANIMATION taking the foot away: well clear of its
    // ground, or off it at all and travelling. A body carried over a foot
    // the animation holds still is neither, so it keeps its lock.
    const leaving =
      foot.clear > UNLOCK_CLEAR_FRAC * legM ||
      (foot.clear > LIFTOFF_FRAC * legM && foot.speed > UNLOCK_SPEED_FRAC * legM);
    if (foot.locked && (!grounded || foot.stance < LOCK_OFF || leaving)) {
      release(foot, grounded, ankleX, ankleZ);
      atX = ankleX + foot.driftX;
      atZ = ankleZ + foot.driftZ;
      if (!frame.released) {
        ground = groundUnder(frame, state.ground, atX, atZ, ballDX, ballDZ, heelDX, heelDZ, fwdX * lead, fwdZ * lead, fromY);
      }
    }

    // A foot that is planted, down and still is a CANDIDATE: its target
    // gives up its lift at once (a step of under LOCK_LIFT) and its reach
    // joins the drop. It locks when the body has come down far enough for
    // it to REACH — a lock is a foot on the ground, not one the animation
    // says is nearly there.
    const candidate =
      !foot.locked &&
      grounded &&
      foot.stance > LOCK_ON &&
      lift <= LOCK_LIFT_FRAC * legM &&
      foot.speed <= LOCK_SPEED_FRAC * legM;
    foot.liftShare = foot.locked || candidate ? 0 : moveToward(foot.liftShare, 1, blendStep);

    if (ground !== null) {
      foot.groundY = ground.y;
      foot.heelGroundY = ground.heelY;
      foot.grip = ground.grip;
      foot.hasGround = true;
    }
    if (!foot.hasGround || foot.weight <= 0) {
      foot.need = 0;
      foot.flat = moveToward(foot.flat, 0, blendStep);
      foot.heel = moveToward(foot.heel, 0, blendStep);
      foot.heelRise = 0;
      foot.heelPitch = 0;
      continue;
    }

    work.active = true;
    work.onBall = foot.locked && foot.onBall;
    const pointX = foot.locked ? foot.lockX : atX;
    const pointZ = foot.locked ? foot.lockZ : atZ;
    const dx = pointX - frame.rootX;
    const dz = pointZ - frame.rootZ;
    work.pointX = (dx * cos - dz * sin) * upm;
    work.pointZ = (dx * sin + dz * cos) * upm;
    work.groundY = (foot.groundY - frame.rootY) * upm + floorY;
    work.heelGroundY = (foot.heelGroundY - frame.rootY) * upm + floorY;
    work.lift = lift * upm * foot.liftShare;

    // May this foot rise onto its toes? Only a foot locked flat on its
    // ball (or, on a rig with no ball, locked at all), only behind where it
    // hangs at rest, never ahead of the hip; eased like every other weight.
    const flat = ankleAt(leg, work, 0, 0, scratch);
    const hipZ = pos[leg.hip * 3 + 2];
    const behind = leg.restZ - (flat.z - hipZ);
    const mayRise = foot.locked && (leg.ball < 0 || foot.onBall);
    // `behind` is measured to a micron of a leg: a foot standing where it
    // hangs computes 1e-16 behind, and that is not a reason to rise.
    const heelWant = mayRise && flat.z <= hipZ
      ? foot.stance * clamp((behind - 1e-6 * legB) / (HEEL_BEHIND_FRAC * legB), 0, 1)
      : 0;
    foot.heel = moveToward(foot.heel, heelWant, blendStep);
    const cap = mayRise ? foot.heel * HEEL_RISE_FRAC * legB : 0;
    if (leg.ball >= 0) work.pitchLimit = pitchLimitFor(leg, work, cap, scratch);
    else work.riseLimit = cap;

    // What this leg needs of the body at its highest permitted heel.
    foot.need = 0;
    let need = 0;
    if (grounded && foot.stance > 0) {
      need = needFor(state, leg, work, work.pitchLimit, work.riseLimit) / upm;
      if (need > DROP_EPSILON_M) {
        foot.need = need;
        wantDrop = Math.max(wantDrop, need * foot.stance);
      }
    }

    if (candidate && need <= state.rootDrop + LOCK_REACH_M) {
      foot.locked = true;
      foot.onBall = false;
      foot.lockX = pointX;
      foot.lockZ = pointZ;
      foot.driftX = 0;
      foot.driftZ = 0;
      foot.locks += 1;
    }
    // A locked foot goes flat over FLATTEN; a free one returns to the
    // animation's orientation over BLEND.
    foot.flat = foot.locked ? moveToward(foot.flat, 1, flattenStep) : moveToward(foot.flat, 0, blendStep);
  }

  // The body settles onto its feet. Eased, never negative, never more
  // than MAX_DROP.
  wantDrop = clamp(wantDrop, 0, MAX_DROP_FRAC * legM);
  const settleTime = wantDrop > state.rootDrop ? DROP_DOWN_TIME : DROP_UP_TIME;
  const settle = dt > 0 ? 1 - Math.exp(-dt / settleTime) : 0;
  state.rootDrop = Math.max(0, state.rootDrop + (wantDrop - state.rootDrop) * settle);
  if (wantDrop === 0 && state.rootDrop < DROP_EPSILON_M) state.rootDrop = 0;
  const drop = state.rootDrop;
  const dropB = drop * upm;

  for (let side = 0; side < 2; side += 1) {
    const leg = state.legs[side];
    const foot = state.feet[side];
    const work = state.work[side];
    foot.applied = 0;
    if (!work.active) continue;

    // Each heel rises only as far as it still needs to under the drop the
    // body actually took.
    heelFor(state, leg, work, dropB);
    const base = ankleAt(leg, work, 0, 0, scratch).y;
    const ankle = ankleAt(leg, work, work.pitch, work.rise, scratch);
    foot.heelRise = (ankle.y - base) / upm;
    foot.heelPitch = work.pitch;
    work.tx = ankle.x;
    work.ty = ankle.y + dropB;
    work.tz = ankle.z;
    foot.targetX = frame.rootX + (work.tx * cos + work.tz * sin) / upm;
    foot.targetZ = frame.rootZ + (-work.tx * sin + work.tz * cos) / upm;
    foot.targetY = frame.rootY - drop + (work.ty - floorY) / upm;

    if (work.hipTurn < 0 || work.kneeTurn < 0) continue;

    // The dead zone, measured against the animated ankle in the frame of
    // the lowered body, with a turned foot counted by how far its ball
    // has swung.
    const turned = 2 * Math.acos(clamp(Math.abs(work.qw), 0, 1)) + work.pitch;
    const miss =
      Math.hypot(work.tx - pos[leg.ankle * 3], work.ty - pos[leg.ankle * 3 + 1], work.tz - pos[leg.ankle * 3 + 2]) / upm +
      (turned * Math.hypot(leg.ballX, leg.ballY, leg.ballZ)) / upm;
    const weight = foot.weight * clamp((miss - DEAD_MIN_M) / (DEAD_MAX_M - DEAD_MIN_M), 0, 1);
    if (weight <= 1e-6) continue;
    foot.applied = weight;

    solveLeg(state, leg, work, weight, out);
  }

  const result = state.result;
  result.turns = usedPrefix(state, out, count);
  result.rootDrop = drop;
  return result;
}

/**
 * Let go of a lock. On the ground, the gap between where the lock held
 * the ankle (last frame's target) and where the animation has it is
 * handed over as a decaying drift, so the swing starts from where the
 * foot really was; a foot that lost its ground, or a teleport, keeps none.
 */
function release(foot: FootState, keep: boolean, ankleX: number, ankleZ: number): void {
  foot.locked = false;
  foot.onBall = false;
  foot.driftX = keep ? foot.targetX - ankleX : 0;
  foot.driftZ = keep ? foot.targetZ - ankleZ : 0;
}

/**
 * The ground under a foot whose ankle is at `atX, atZ`: under its ball —
 * or under a lead point ahead of it (`leadX, leadZ` from the ball), when
 * that is higher, so a moving foot sees a kerb before it stubs on it —
 * and, separately, under its heel. Null when nothing is under the ball.
 * The grip is the ball's. Written into `into`.
 */
function groundUnder(
  frame: FeetFrame,
  into: GroundUnder,
  atX: number,
  atZ: number,
  ballDX: number,
  ballDZ: number,
  heelDX: number,
  heelDZ: number,
  leadX: number,
  leadZ: number,
  fromY: number,
): GroundUnder | null {
  const ballX = atX + ballDX;
  const ballZ = atZ + ballDZ;
  const ball = frame.groundAt(ballX, ballZ, fromY);
  if (ball === null) return null;
  const grip = ball.grip;
  let y = ball.y;
  if (Math.abs(leadX) + Math.abs(leadZ) > 1e-4) {
    const ahead = frame.groundAt(ballX + leadX, ballZ + leadZ, fromY);
    if (ahead !== null && ahead.y > y) y = ahead.y;
  }
  const heel = frame.groundAt(atX + heelDX, atZ + heelDZ, fromY);
  into.y = y;
  into.heelY = heel === null ? y : heel.y;
  into.top = Math.max(into.y, into.heelY);
  into.grip = grip;
  return into;
}

/**
 * One leg's two-bone solve toward `work`'s target, written into `out` at
 * the leg's own turn indices, slerped from the animated turns by `weight`.
 */
function solveLeg(state: FeetState, leg: LegRig, work: LegWork, weight: number, out: MutableJointTurn[]): void {
  const pos = state.pos;
  const rot = state.rot;
  // Indexed rather than destructured: an array pattern walks an iterator,
  // and this runs twice a frame for every body.
  const q = state.q;
  const hipQ = q[2];
  const dHip = q[3];
  const dKnee = q[4];
  const tmp = q[5];
  const parentQ = q[6];
  const result = q[7];
  const animQ = q[8];
  const pitchQ = q[10];
  const v = state.v;
  const hip = v[3];
  const knee = v[4];
  const ankle = v[5];
  const thigh = v[6];
  const shin = v[7];
  const pole = v[0];

  hip.x = pos[leg.hip * 3];
  hip.y = pos[leg.hip * 3 + 1];
  hip.z = pos[leg.hip * 3 + 2];
  knee.x = pos[leg.knee * 3];
  knee.y = pos[leg.knee * 3 + 1];
  knee.z = pos[leg.knee * 3 + 2];
  ankle.x = pos[leg.ankle * 3];
  ankle.y = pos[leg.ankle * 3 + 1];
  ankle.z = pos[leg.ankle * 3 + 2];

  const l1 = leg.thigh;
  const l2 = leg.shin;
  if (l1 < 1e-9 || l2 < 1e-9) return;

  let dirX = work.tx - hip.x;
  let dirY = work.ty - hip.y;
  let dirZ = work.tz - hip.z;
  const distance = Math.hypot(dirX, dirY, dirZ);
  if (distance < 1e-9) return;
  dirX /= distance;
  dirY /= distance;
  dirZ /= distance;
  const animated = Math.hypot(ankle.x - hip.x, ankle.y - hip.y, ankle.z - hip.z);
  const longest = Math.min(l1 + l2, Math.max(REACH * (l1 + l2), animated));
  const reach = clamp(distance, Math.abs(l1 - l2) + 1e-6 * (l1 + l2), longest);

  // The bend plane: the animated knee's, with any backward part removed
  // and a small forward bias added. BIOLOGICAL SHAPE: a knee flexes
  // forward and only forward.
  const kx = knee.x - hip.x;
  const ky = knee.y - hip.y;
  const kz = knee.z - hip.z;
  const along = kx * dirX + ky * dirY + kz * dirZ;
  pole.x = kx - dirX * along;
  pole.y = ky - dirY * along;
  pole.z = kz - dirZ * along;
  // Forward, perpendicular to the leg: +Z less its part along the leg.
  let fx = -dirX * dirZ;
  let fy = -dirY * dirZ;
  let fz = 1 - dirZ * dirZ;
  const fl = Math.hypot(fx, fy, fz);
  if (fl > 1e-9) {
    fx /= fl;
    fy /= fl;
    fz /= fl;
    const back = pole.x * fx + pole.y * fy + pole.z * fz;
    if (back < 0) {
      pole.x -= fx * back;
      pole.y -= fy * back;
      pole.z -= fz * back;
    }
    const bias = POLE_FORWARD_FRAC * state.legLength;
    pole.x += fx * bias;
    pole.y += fy * bias;
    pole.z += fz * bias;
  }
  const pl = Math.hypot(pole.x, pole.y, pole.z);
  if (pl < 1e-12) return;
  pole.x /= pl;
  pole.y /= pl;
  pole.z /= pl;

  const cosA = clamp((l1 * l1 + reach * reach - l2 * l2) / (2 * l1 * reach), -1, 1);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  // The solved knee, as a thigh vector from the hip.
  const nkx = dirX * l1 * cosA + pole.x * l1 * sinA;
  const nky = dirY * l1 * cosA + pole.y * l1 * sinA;
  const nkz = dirZ * l1 * cosA + pole.z * l1 * sinA;

  // Thigh: the shortest arc from the animated thigh to the solved one.
  thigh.x = kx;
  thigh.y = ky;
  thigh.z = kz;
  shin.x = nkx;
  shin.y = nky;
  shin.z = nkz;
  qArc(dHip, thigh, shin);

  // Shin: from where the new hip carried it to the reachable target.
  qRotate(thigh, dHip, ankle.x - knee.x, ankle.y - knee.y, ankle.z - knee.z);
  shin.x = dirX * reach - nkx;
  shin.y = dirY * reach - nky;
  shin.z = dirZ * reach - nkz;
  qArc(dKnee, thigh, shin);

  // Hip: R' = A_parent⁻¹ · Δh · A_hip.
  if (leg.hipParent >= 0) qLoad(parentQ, rot, leg.hipParent);
  else qSet(parentQ, 0, 0, 0, 1);
  qLoad(hipQ, rot, leg.hip);
  qMul(tmp, dHip, hipQ);
  qMul(result, qInv(parentQ, parentQ), tmp);
  blendInto(out[work.hipTurn], leg.hip, animQ, result, weight);

  // Knee: its parent now carries Δh; its own world is Δk · Δh · A_knee.
  qMul(tmp, dKnee, dHip);
  qLoad(parentQ, rot, leg.kneeParent);
  qMul(parentQ, dHip, parentQ);
  qLoad(result, rot, leg.knee);
  qMul(result, tmp, result);
  qMul(result, qInv(parentQ, parentQ), result);
  blendInto(out[work.kneeTurn], leg.knee, animQ, result, weight);

  // Ankle: the animated foot's orientation turned toward flat and pitched
  // by the heel rise about its lateral axis, under a parent that now
  // carries Δk · Δh.
  if (work.ankleTurn >= 0) {
    const half = work.pitch * 0.5;
    const sh = Math.sin(half);
    qSet(pitchQ, work.kx * sh, 0, work.kz * sh, Math.cos(half));
    qSet(animQ, work.qx, work.qy, work.qz, work.qw);
    qMul(pitchQ, pitchQ, animQ);
    qLoad(parentQ, rot, leg.ankleParent);
    qMul(parentQ, tmp, parentQ);
    qLoad(result, rot, leg.ankle);
    qMul(result, pitchQ, result);
    qMul(result, qInv(parentQ, parentQ), result);
    blendInto(out[work.ankleTurn], leg.ankle, animQ, result, weight);
  }
}

/** Slerp the turn already in `turn` (the animated one) toward `solved` by `weight`, in place. */
function blendInto(turn: MutableJointTurn, joint: number, scratch: Quat, solved: Quat, weight: number): void {
  qFromTurn(scratch, turn);
  if (weight >= 1 - 1e-9) qCopy(scratch, qNormalize(solved));
  else qSlerp(scratch, scratch, qNormalize(solved), weight);
  writeQuatTurn(turn, joint, scratch);
}

/**
 * The turns written, as an array exactly as long as the input: `out`
 * itself when it is that long, otherwise a view held on the state and
 * only re-pointed when it has to be — the same device `humanPose` uses.
 */
function usedPrefix(state: FeetState, out: MutableJointTurn[], used: number): readonly JointTurn[] {
  if (out.length === used) return out;
  const view = state.view;
  if (view.length !== used) view.length = used;
  for (let i = 0; i < used; i += 1) {
    if (view[i] !== out[i]) view[i] = out[i];
  }
  return view;
}
