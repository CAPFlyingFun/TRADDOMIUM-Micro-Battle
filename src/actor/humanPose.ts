/**
 * WHERE JACK AND SARAH'S ARMS COME DOWN — the only place either body is
 * ever anything but a T.
 *
 * Neither human master carries a single animation clip. `listAnimations()`
 * is empty on both GLBs, and the bind pose they ship in is a T: measured
 * out of `tests/fixtures/humanBind.json`, Sarah's 35 joints and Jack's 69
 * put the shoulders at x ±0.155 and ±0.178 and run the arms STRAIGHT OUT
 * from there to wrists at ±0.533 and ±0.522 — a reach of 0.38 that
 * changes height by 0.011 on Sarah and 0.023 on Jack, which is 3.5° and
 * 9.8° off dead level. So every pose in this game is authored in this
 * file or it does not exist, and a scientist standing in the laboratory
 * with her arms out level is not a missing animation — it is this module
 * not having been called.
 *
 * The failure this prevents is specific and it has already been paid for
 * once elsewhere: a body that reads as BROKEN rather than as unfinished.
 * `LabPeople` loads two photogrammetry scans with real faces and real
 * clothing, and the one thing a player cannot forgive in them is the
 * scarecrow silhouette.
 *
 * ─── what a turn means, and why an elbow may be written in the T ─────
 *
 * `humanRig.ts` explains why a `JointTurn` is an axis and an angle in the
 * BIND POSE'S OWN WORLD FRAME rather than in a bone's local axes (the
 * auto-rigger's local axes are not anatomical and differ between the two
 * masters). The consequence for THIS file is the part worth stating,
 * because it is what makes the poses below short:
 *
 *   The renderer's conversion is `local' = P⁻¹ · R · B`, so a joint's
 *   accumulated world turn is `A_j = A_parent · R_j` and a posed bone
 *   offset is `A_parent · (p_j − p_parent)`. Read from the far end:
 *   EVERY TURN IS APPLIED IN THE BIND FRAME FIRST AND THEN CARRIED BY
 *   ITS PARENTS.
 *
 * So the elbow is authored as if the arm were still horizontal — flexion
 * is a rotation about world Y, which is true of a T-posed arm and stays
 * true after the shoulder has swung the whole arm down, because the
 * shoulder's turn carries the bent forearm with it. Nothing here has to
 * track a frame that has already moved, and no angle below is a
 * correction for another angle above it.
 *
 * ─── the axes, once, in the bind frame ───────────────────────────────
 *
 * +Y is up and +Z is the way the body faces (both masters are modelled
 * facing +Z; `humanSkeleton.measureHuman` confirms it from the toes and
 * publishes `leftSign`, the x direction the body's LEFT lies along). The
 * four rules every sign below comes from:
 *
 *   a bone along +Y (spine, chest, neck): Rx(+θ) tips its top FORWARD;
 *                                          Rz(+θ) tips its top toward −X.
 *   a bone along −Y (thigh, shin):        Rx(+θ) swings its end BACKWARD.
 *   a bone along +X (the left arm):       Rz(+θ) lifts it; Ry(+θ) swings
 *                                          it backward.
 *   a bone along −X (the right arm):      Rz(+θ) brings it DOWN; Ry(+θ)
 *                                          swings it forward.
 *
 * Which is why the arms' signs are all `-armSign` and the legs' are not:
 * the arms lie along opposite axes and mirror, while both thighs point
 * down and a forward swing is forward for both. Nothing is hardcoded to
 * a side — `leftSign` decides, so a re-export that mirrors the rig poses
 * correctly without a line changing here.
 *
 * ─── the turn list is a FIXED FIFTEEN, and that is a decision ────────
 *
 * Every stance writes the same fifteen joints in the same order, parent
 * before child, standing included — where the six leg turns are zero. It
 * costs a renderer fifteen identity-ish quaternions a frame and it closes
 * a bug that a shorter list invites: a consumer applies the turns it is
 * GIVEN, so a knee that appears in `walk` and is omitted from `stand`
 * keeps last frame's bend and the body stands there with a bent leg. A
 * pose that names every joint it owns, every frame, cannot leave one
 * holding a stale angle.
 *
 * The pelvis is deliberately NOT in the list. In both masters the legs
 * hang off the pelvis, so a pelvis turn tips the whole stance and lifts a
 * foot off the floor; where a real body shifts its weight, the sway below
 * is put on the SPINE over planted feet. Where the body is and which way
 * it faces belong to the actor, not to a pose.
 *
 * ─── amplitudes are fractions of a measured limb ─────────────────────
 *
 * The two legs' amplitudes are written as fractions of the skeleton's own
 * `legLength` and resolved against its own shin, so the same constants
 * are right for both masters and for a re-export at another scale. The
 * numbers are the only ones in the file that come from outside it:
 *
 *   STEP as 0.75 of leg length walking and 1.15 running is BIOLOGICAL
 *   SHAPE — a human's step length scales with leg length, and the hip
 *   flexion that falls out of `asin(step / 2 legLength)` is 22.0° walking
 *   and 35.1° running, inside the ranges gait labs report for both.
 *   KNEE LIFT as 0.06 and 0.15 of leg length is GAME TUNING at the low
 *   end of that biology (a real swing knee flexes further than 28°); it
 *   is set by how the silhouette reads at the distance a player stands
 *   from these two, not by a goniometer.
 *   BREATH at 0.25 Hz is fifteen breaths a minute, the middle of the
 *   12-20 of a resting adult. SWAY at 0.11 Hz is GAME TUNING in the
 *   sub-hertz band quiet standing actually wanders in.
 *
 * Measured on the fixture, those fractions land the same pose on two
 * different bodies: a 0.06 knee lift is 28.4° on Sarah (leg 0.638, shin
 * 0.317) and 29.1° on Jack (leg 0.678, shin 0.323), and neither master's
 * units are metres.
 *
 * Pure: no three, no DOM, no storage, no network. This is core, and
 * `tests/simulationCore.test.ts` holds it to that. It allocates on the
 * first frame that grows `out` and never again.
 */

import {
  newJointTurn,
  type BindJoint,
  type HumanGait,
  type HumanMeasure,
  type HumanStance,
  type JointTurn,
  type MutableJointTurn,
} from './humanRig';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/**
 * How many turns `poseHuman` writes, every call, whatever the stance.
 * Exported so an integrator can size its `out` array once at load —
 * `Array.from({ length: HUMAN_POSE_TURNS }, newJointTurn)` — and never
 * allocate in a frame at all.
 */
export const HUMAN_POSE_TURNS = 15;

/**
 * How far the upper arm comes down from the horizontal bind. 77.5° of
 * the 90° that would hang it dead vertical, so the 12.5° left over is
 * the flare that carries the forearm and hand clear of the hips: the
 * hanging wrist lands 0.256 from the body's centre line on Sarah and
 * 0.237 on Jack, against a hip half-width of 0.068 on both.
 */
const ARM_DOWN = 77.5 * DEG;

/** Arms hang a little in front of the torso, not beside it. */
const SHOULDER_ROLL = 6 * DEG;

/**
 * The hand's own tip, carried a little further round the arm's arc than
 * the forearm — which for an arm flared outward reads as the relaxed
 * inward hand it is meant to be, and needs no second axis to say so.
 */
const WRIST_IN = 8 * DEG;

/** Elbow flexion held whatever the arm is doing. A runner's arms are up. */
const ELBOW_BENDS: Readonly<Record<HumanStance, number>> = {
  stand: 10 * DEG,
  walk: 24 * DEG,
  run: 72 * DEG,
};

/** Extra flexion as an arm comes forward, and none as it goes back. */
const ELBOW_PUMPS: Readonly<Record<HumanStance, number>> = {
  stand: 0,
  walk: 10 * DEG,
  run: 18 * DEG,
};

/** Fore and aft swing of the whole arm about the shoulder. */
const ARM_SWINGS: Readonly<Record<HumanStance, number>> = {
  stand: 0,
  walk: 18 * DEG,
  run: 38 * DEG,
};

/** Step length as a fraction of leg length; the hip angle falls out of it. */
const STEP_LENGTHS: Readonly<Record<HumanStance, number>> = {
  stand: 0,
  walk: 0.75,
  run: 1.15,
};

/**
 * How far the knee bend picks the foot up off the line of the thigh, as
 * a fraction of leg length. Resolved against the skeleton's own shin,
 * which is why `bind` is a parameter at all.
 */
const KNEE_LIFTS: Readonly<Record<HumanStance, number>> = {
  stand: 0,
  walk: 0.06,
  run: 0.15,
};

/** Plantarflexion at toe-off, dorsiflexion at the heel strike half a cycle later. */
const ANKLE_ROLLS: Readonly<Record<HumanStance, number>> = {
  stand: 0,
  walk: 12 * DEG,
  run: 20 * DEG,
};

/** Forward lean of the torso. A run leans into its own speed. */
const FORWARD_LEANS: Readonly<Record<HumanStance, number>> = {
  stand: 0,
  walk: 4 * DEG,
  run: 11 * DEG,
};

/** How the forward lean is split between the spine and the chest above it. */
const SPINE_SHARE = 0.65;

/**
 * How much of the lean the neck gives back, so a runner looks ahead of
 * his feet rather than at them.
 *
 * The breath and the sway are given back IN FULL, which is a different
 * claim and a load-bearing one: the head is the segment a standing body
 * holds still, and a chest that rocked the skull 0.9° twice a breath
 * would read as a body settling rather than as one breathing. It is also
 * what keeps the crown from bobbing — measured on Jack, whose head joint
 * sits 0.051 forward of his neck, a chest tilt alone moved the top of
 * him by 1.12 mm, and a pose is a rotation and never a stretch.
 */
const NECK_COUNTER = 0.55;

/** Roll into a full-rate turn, split spine then chest, with the neck levelling the head. */
const LEAN_ROLL = 14 * DEG;
const LEAN_SPINE_SHARE = 0.6;
const NECK_LEVEL = 0.45;

/** Fifteen breaths a minute, as a chest extension of under a degree. */
const BREATH_HZ = 0.25;
const BREATH_RISE = 0.9 * DEG;

/**
 * Quiet standing is never still. One slow roll of the torso with a
 * second, weaker term at an incommensurate rate, so the loop is long
 * enough that nobody watching a body at a desk sees it repeat, and the
 * chest gives back half of it to keep the head over the feet.
 */
const SWAY_HZ = 0.11;
const SWAY_ROLL = 1.1 * DEG;
const SWAY_SECOND = 0.35;
const SWAY_SECOND_RATIO = 0.41;
const SWAY_COUNTER = 0.55;

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function writeTurn(
  turn: MutableJointTurn,
  joint: number,
  ax: number,
  ay: number,
  az: number,
  radians: number,
): void {
  turn.joint = joint;
  turn.ax = ax;
  turn.ay = ay;
  turn.az = az;
  turn.radians = radians;
}

/**
 * A turn about two world axes at once, as ONE axis and angle: the
 * rotation `Rx(xRadians) · Rz(zRadians)`, Z first.
 *
 * The order is not a preference. A shoulder's Z brings the horizontal
 * arm DOWN and its X then swings the hanging arm fore and aft; the other
 * order would apply the swing to an arm still lying along its own
 * rotation axis, where it does nothing at all.
 *
 * One axis and angle out, because the renderer's conversion takes one
 * rotation per joint — two turns naming the same joint would be a second
 * pose fighting the first.
 */
function writeTurnXZ(turn: MutableJointTurn, joint: number, xRadians: number, zRadians: number): void {
  const sx = Math.sin(xRadians * 0.5);
  const cx = Math.cos(xRadians * 0.5);
  const sz = Math.sin(zRadians * 0.5);
  const cz = Math.cos(zRadians * 0.5);

  // Hamilton product of (sx, 0, 0, cx) and (0, 0, sz, cz), written out.
  let qx = sx * cz;
  let qy = -sx * sz;
  let qz = cx * sz;
  let qw = cx * cz;
  if (qw < 0) {
    qx = -qx;
    qy = -qy;
    qz = -qz;
    qw = -qw;
  }

  const sine = Math.hypot(qx, qy, qz);
  if (sine < 1e-9) {
    // No rotation at all. An axis is still required to be a unit vector,
    // so it is up: the angle is zero and nothing turns about it.
    writeTurn(turn, joint, 0, 1, 0, 0);
    return;
  }
  const scale = 1 / sine;
  writeTurn(turn, joint, qx * scale, qy * scale, qz * scale, 2 * Math.atan2(sine, qw));
}

/**
 * Shoulder, elbow and wrist of one arm, written at `at`, `at + 1` and
 * `at + 2`.
 *
 * `xSign` is the x direction this arm lies along in the bind pose, which
 * is `leftSign` for the left arm and its negation for the right;
 * `forward` is −1..+1, how far this arm is thrown ahead of the body.
 * Every sign below is `-xSign` because the two arms point along opposite
 * axes and a rotation that brings one down lifts the other.
 *
 * The standing arm is the BASE of all three stances: a walking body
 * swings its arms around a pose that is already down, and never returns
 * any part of the way to the T.
 */
function writeArm(
  out: MutableJointTurn[],
  at: number,
  shoulder: number,
  elbow: number,
  wrist: number,
  xSign: number,
  forward: number,
  stance: HumanStance,
): void {
  // Negative X is forward for a hanging arm, so the roll and the swing
  // share one angle and one sign.
  writeTurnXZ(out[at], shoulder, -(SHOULDER_ROLL + ARM_SWINGS[stance] * forward), -xSign * ARM_DOWN);
  writeTurn(out[at + 1], elbow, 0, 1, 0, -xSign * (ELBOW_BENDS[stance] + ELBOW_PUMPS[stance] * Math.max(0, forward)));
  writeTurn(out[at + 2], wrist, 0, 0, 1, -xSign * WRIST_IN);
}

/**
 * Hip, knee and ankle of one leg, written at `at`, `at + 1` and
 * `at + 2`. `forward` is −1..+1, where this leg is in its own swing.
 *
 * The knee is the one joint in the body that may only go one way, so its
 * flexion is `max(0, -forward)`: it bends through the back half of the
 * leg's swing, where a trailing leg has to fold to clear the ground, and
 * is exactly straight through the whole front half. A knee cannot be
 * hyperextended by a phase, a lean or an amplitude, because the only
 * angle that reaches it is a positive one.
 */
function writeLeg(
  out: MutableJointTurn[],
  at: number,
  hip: number,
  knee: number,
  ankle: number,
  forward: number,
  hipSwing: number,
  kneeBend: number,
  ankleRoll: number,
): void {
  writeTurn(out[at], hip, 1, 0, 0, -hipSwing * forward);
  writeTurn(out[at + 1], knee, 1, 0, 0, kneeBend * Math.max(0, -forward));
  writeTurn(out[at + 2], ankle, 1, 0, 0, -ankleRoll * forward);
}

/**
 * The turns actually written, as an array the caller may read straight
 * through.
 *
 * `out` is the caller's and is usually exactly `HUMAN_POSE_TURNS` long,
 * which is the whole of the fast path: the prefix IS the array. A longer
 * `out` — one array serving several bodies — gets a view held against it,
 * built once and then only checked, so the second frame allocates nothing
 * either. The view is kept per array rather than per module because
 * `LabPeople` poses two people in one frame and a single shared view
 * would hand Jack's turns to whoever read Sarah's second.
 */
const PREFIXES = new WeakMap<readonly MutableJointTurn[], MutableJointTurn[]>();

function usedPrefix(out: MutableJointTurn[], used: number): readonly JointTurn[] {
  if (out.length === used) return out;
  let view = PREFIXES.get(out);
  if (view === undefined) {
    view = [];
    PREFIXES.set(out, view);
  }
  if (view.length !== used) view.length = used;
  for (let i = 0; i < used; i += 1) {
    if (view[i] !== out[i]) view[i] = out[i];
  }
  return view;
}

/**
 * One frame of a human, as turns in the bind pose's world frame.
 *
 * `bind` is read for the one length `HumanMeasure` does not carry — the
 * shin, which is what a knee lift has to be resolved against — and for
 * nothing else; every other amplitude is a fraction of a measured span
 * or an angle.
 *
 * Deterministic: the same `measure`, `bind` and `gait` give the same
 * turns, every time, with no state kept between calls. Nothing is
 * remembered, so nothing can get out of step with a phase the caller
 * advances.
 */
export function poseHuman(
  measure: HumanMeasure,
  bind: readonly BindJoint[],
  gait: HumanGait,
  out: MutableJointTurn[],
): readonly JointTurn[] {
  while (out.length < HUMAN_POSE_TURNS) out.push(newJointTurn());

  const joints = measure.joints;
  const stance = gait.stance;
  const left = measure.leftSign < 0 ? -1 : 1;

  // The cycle. Positive is the LEFT leg thrown forward; the right leg is
  // half a cycle behind it, and each arm goes with the OPPOSITE leg, which
  // is what a counter-rotating torso does and what a body with both arms
  // swinging together does not.
  const cycle = Math.sin(gait.phase * TAU);

  const knee = bind[joints.kneeL];
  const ankle = bind[joints.ankleL];
  const shin = Math.hypot(ankle.x - knee.x, ankle.y - knee.y, ankle.z - knee.z);
  const lift = KNEE_LIFTS[stance] * measure.legLength;
  const kneeBend = shin > 0 ? Math.acos(clamp(1 - lift / shin, -1, 1)) : 0;
  // The step is a fraction of THIS body's leg, and the hip angle that
  // takes the foot that far is `asin(step / 2 legLength)`. The length
  // cancels, which is the point: the same fraction is the same angle on
  // Sarah's 0.638 leg and Jack's 0.678, and would be on a re-export in
  // millimetres.
  const step = STEP_LENGTHS[stance] * measure.legLength;
  const hipSwing = measure.legLength > 0
    ? Math.asin(clamp(step / (2 * measure.legLength), 0, 1))
    : 0;
  const ankleRoll = ANKLE_ROLLS[stance];

  // Breath and sway are functions of the CLOCK, never of the phase: a
  // body standing still has a phase that never advances, and these two
  // are the whole of what keeps it from reading as a statue. The sway is
  // a standing body's; a walking one is already moving its torso.
  const breath = Math.sin(gait.seconds * TAU * BREATH_HZ) * BREATH_RISE;
  const swayAt = gait.seconds * TAU * SWAY_HZ;
  const sway = stance === 'stand'
    ? (Math.sin(swayAt) + SWAY_SECOND * Math.sin(swayAt * SWAY_SECOND_RATIO)) * SWAY_ROLL
    : 0;

  // A lean is a roll about the forward axis, and +Z rolls the torso
  // toward −X, so the body's own right is `leftSign` away from the sign
  // of the lean rather than a hardcoded direction.
  const leanRoll = left * clamp(gait.lean, -1, 1) * LEAN_ROLL;
  const leanForward = FORWARD_LEANS[stance];

  writeTurnXZ(out[0], joints.spine, leanForward * SPINE_SHARE, leanRoll * LEAN_SPINE_SHARE + sway);
  writeTurnXZ(
    out[1],
    joints.chest,
    leanForward * (1 - SPINE_SHARE) - breath,
    leanRoll * (1 - LEAN_SPINE_SHARE) - sway * SWAY_COUNTER,
  );
  writeTurnXZ(
    out[2],
    joints.neck,
    breath - leanForward * NECK_COUNTER,
    -sway * (1 - SWAY_COUNTER) - leanRoll * NECK_LEVEL,
  );

  writeArm(out, 3, joints.shoulderL, joints.elbowL, joints.wristL, left, -cycle, stance);
  writeArm(out, 6, joints.shoulderR, joints.elbowR, joints.wristR, -left, cycle, stance);

  writeLeg(out, 9, joints.hipL, joints.kneeL, joints.ankleL, cycle, hipSwing, kneeBend, ankleRoll);
  writeLeg(out, 12, joints.hipR, joints.kneeR, joints.ankleR, -cycle, hipSwing, kneeBend, ankleRoll);

  return usedPrefix(out, HUMAN_POSE_TURNS);
}
