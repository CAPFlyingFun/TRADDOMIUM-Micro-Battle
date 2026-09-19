/**
 * WHAT A HUMAN SKELETON IS, BEFORE ANYTHING POSES ONE.
 *
 * The two human masters are photogrammetry scans auto-rigged by Meshy,
 * and their bones are called `Bone_000` … `Bone_068`. There is no `hips`,
 * no `LeftArm`, no mixamorig: prefix — nothing to look a joint up BY. So
 * joints are found the way `fauna/rig.ts` finds an ant's legs: BY
 * MEASUREMENT, from the bind pose's own geometry. `humanSkeleton.ts`
 * does the finding, `humanPose.ts` does the posing, and both are pure —
 * a `BindJoint[]` in, numbers out, no three, no DOM.
 *
 * That split is not ceremony. It is what makes the T-pose fixable at
 * all: the thing that has to be got right is which index is a shoulder,
 * and an assertion about an index is a test in plain node, while an
 * assertion about a rendered arm is a screenshot somebody has to look
 * at.
 *
 * ─── the bind pose is a T, and that is the bug ──────────────────────
 *
 * Measured on `sarah.glb`: 35 joints, the pelvis at y 0.031 with three
 * children, a five-bone spine up to a chest at 0.398 that also has
 * three, and the two arm chains leaving that chest at y 0.449 and
 * running out to x ±0.68 — HORIZONTAL, the whole span. Jack's 69 joints
 * are the same skeleton with fingers. Neither master carries a single
 * animation clip (checked: `listAnimations()` is empty on both), so
 * every pose in this game is authored here or it does not exist.
 *
 * ─── turns are in BIND WORLD space, and the renderer converts ───────
 *
 * A `JointTurn` is an axis and an angle in the BIND POSE'S OWN WORLD
 * FRAME, not in a bone's local frame. That is deliberate and it is the
 * only thing in this file that needs an argument.
 *
 * An auto-rigged bone's local axes are whatever the rigger happened to
 * emit — they are not anatomical, they are not consistent between the
 * left arm and the right, and they differ between these two masters. A
 * pose written in local axes would therefore be a pose written for one
 * file. "Rotate the upper arm 75° about the world Z axis" is true of any
 * skeleton standing in a T, and stays true when Meshy re-exports.
 *
 * The conversion is one line at the render boundary and belongs there
 * (`view/HumanRig.ts`): for a joint J with bind world rotation `B` and
 * parent world rotation `P`, the local quaternion that realises a world
 * turn `R` is `P⁻¹ · R · B`. Nothing in `actor/` needs to know that.
 *
 * Pure: no three, no DOM, no storage, no network. This is core, and
 * `tests/simulationCore.test.ts` holds it to that.
 */

/**
 * One joint of a skeleton in its BIND pose, as the file stores it.
 *
 * `x, y, z` is the joint's position in the bind pose's world frame —
 * recovered from the skin's inverse bind matrix, not from the node's
 * local translation, because a local translation says nothing about
 * where a joint is without walking the whole chain first.
 *
 * `parent` indexes the SAME array and is -1 for the root. Joints outside
 * the skin are not in the array at all, so an index is always valid.
 */
export interface BindJoint {
  readonly name: string;
  readonly parent: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The joints a pose needs by name. Seventeen: the ones that carry a
 * human's stance and gait, and no more.
 *
 * Fingers are deliberately absent. Jack's master rigs them and Sarah's
 * does not (Joshua, 2026-09-18: "we don't need all fingers rigged for
 * either"), so a pose that reached for them would work on one body and
 * throw on the other — and nothing at the distance a player stands from
 * a scientist can read a knuckle.
 */
export type HumanJointName =
  | 'pelvis' | 'spine' | 'chest' | 'neck' | 'head'
  | 'shoulderL' | 'elbowL' | 'wristL'
  | 'shoulderR' | 'elbowR' | 'wristR'
  | 'hipL' | 'kneeL' | 'ankleL'
  | 'hipR' | 'kneeR' | 'ankleR';

export const HUMAN_JOINT_NAMES: readonly HumanJointName[] = Object.freeze([
  'pelvis', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'elbowL', 'wristL',
  'shoulderR', 'elbowR', 'wristR',
  'hipL', 'kneeL', 'ankleL',
  'hipR', 'kneeR', 'ankleR',
]);

/** Each named joint's index into the `BindJoint[]` it was measured from. */
export type HumanJoints = Readonly<Record<HumanJointName, number>>;

/**
 * A skeleton, measured.
 *
 * The lengths are in the BIND FILE'S OWN UNITS and are not metres: a
 * caller that wants metres scales by whatever the node carrying the skin
 * is scaled by. Nothing here needs them to be metres — they exist so a
 * pose can be written as a fraction of a limb rather than as a constant
 * that is right for one scan.
 */
export interface HumanMeasure {
  readonly joints: HumanJoints;
  /** Crown to the lower of the two soles. */
  readonly height: number;
  /** Wrist to wrist across the T. */
  readonly armSpan: number;
  /** Hip to ankle, the longer leg. */
  readonly legLength: number;
  /** Left hip to right hip. */
  readonly hipWidth: number;
  /** +1 when the left arm runs toward +x in the bind pose, -1 when toward -x. */
  readonly leftSign: number;
}

/**
 * One joint turned, as an axis and an angle IN THE BIND POSE'S WORLD
 * FRAME (see the header). The axis is a unit vector; a caller may assume
 * it is normalised.
 */
export interface JointTurn {
  /** Index into the `BindJoint[]` the measure was taken from. */
  readonly joint: number;
  readonly ax: number;
  readonly ay: number;
  readonly az: number;
  readonly radians: number;
}

/** A turn a poser may write into, so a frame allocates nothing. */
export interface MutableJointTurn extends JointTurn {
  joint: number;
  ax: number;
  ay: number;
  az: number;
  radians: number;
}

export function newJointTurn(): MutableJointTurn {
  return { joint: -1, ax: 0, ay: 1, az: 0, radians: 0 };
}

/**
 * What the body is doing. `stand` is a person at a desk; `walk` and
 * `run` are the same cycle at different amplitudes and arm swings.
 *
 * There is no `idle` separate from `stand`: an idle is a stand with the
 * breath term, and the breath is a function of time, which `HumanGait`
 * already carries as `seconds`.
 */
export type HumanStance = 'stand' | 'walk' | 'run';

/**
 * One frame of what to pose.
 *
 * `phase` is the gait cycle in 0..1 and is the CALLER'S to advance,
 * because how fast a cycle turns is a function of how fast the body is
 * moving over the ground and the poser does not know that. `seconds` is
 * a free-running clock for the things that keep moving when the body
 * does not — breathing, the small sway of a person standing still.
 */
export interface HumanGait {
  readonly stance: HumanStance;
  /** 0..1, wrapping. Where in the stride the body is. */
  readonly phase: number;
  /** A free-running clock in seconds, for breath and sway. */
  readonly seconds: number;
  /**
   * How hard the body is turning, -1 (hard left) to +1 (hard right).
   * Leans the spine into the turn. Zero when going straight.
   */
  readonly lean: number;
}

export const STANDING: HumanGait = Object.freeze({ stance: 'stand', phase: 0, seconds: 0, lean: 0 });
