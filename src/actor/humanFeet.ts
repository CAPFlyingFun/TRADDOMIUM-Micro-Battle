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
 * body has to come down so the lower foot can reach its floor.
 *
 * Joshua, asking for it: "we had feet that snapped to ground and released
 * like in water or jumping", and "make sure the feet drive the model …
 * so it always stands on solid ground and the feet can't slip unless the
 * ground texture has no grip". The first sentence is Beyond Extinction's
 * foot IK, which this is a port of (`characters/foot_ik.gd` in the Godot
 * build, `IslandCharacter.applyFootIk` in the three.js one). The second
 * is new here: the WORLD FOOT LOCK and its grip.
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
 *  2. THE SOLE is the ankle's height above `floorY` in the bind pose. A
 *     foot stands on the ground when its ankle is `sole` above it.
 *
 *  3. THE TARGET, whole cycle: ground + sole + LIFT, where lift is how far
 *     the animation has raised this foot above the lower of the two. The
 *     ground is searched a little IN FRONT of the ankle along the body's
 *     facing (BE Godot's SCAN_FRAC): the ankle sits behind the contact
 *     point, and a moving foot is heading forward, so the scan
 *     anticipates the kerb rather than stubbing on it. A swinging foot
 *     therefore keeps its lift and still follows the terrain — it clears
 *     a step because the step raised its target, not because it hit it.
 *
 *  4. THE SWING GATE (BE Godot): a foot the animation lifts SWING above
 *     the other is mid-step, and its STANCE weight ramps to 0 over that
 *     lift. The gate decides what is PLANTED — which foot may lock and
 *     which foot's reach is allowed to pull the body down — and not
 *     whether the leg follows the terrain, which rule 3 already made
 *     safe for a lifted foot. Godot gated the whole IK because its
 *     target had no lift term; with the lift in the target the gate can
 *     be narrower, and a swinging foot over a rise no longer drags
 *     through it.
 *
 *  5. THE WORLD FOOT LOCK — "the feet can't slip". A foot whose stance
 *     weight passes LOCK_ON remembers where it stands in WORLD metres.
 *     From then on its target's XZ is that point, not the animation's, so
 *     the planted foot holds its spot while the body travels over it —
 *     the correction is the leg's, never the foot's. It lets go when the
 *     step lifts it (stance below LOCK_OFF), when the lock falls further
 *     than MAX_LOCK from where the animation has the foot (a turn on the
 *     spot, a teleport, a respawn — a leg must never be stretched after a
 *     point the body has left behind), or when the foot is released.
 *     GRIP: every frame the lock slides toward the animated foot by
 *     `1 − grip^(dt / SLIP_FRAME)` of the gap. Grip 1 never slides; grip
 *     0 slides all the way every frame, which is the foot following the
 *     animation: a slip. Written as a power of the grip so the slide per
 *     second does not depend on the frame rate.
 *
 *  6. RELEASE (BE three.js's RELEASE): while the body stands on nothing —
 *     airborne, jumping, falling, swimming — or when the ground under a
 *     foot is further than RELEASE from the ground under the body (a
 *     ledge: the leg must not reach for the bottom of it), that foot's
 *     weight eases to 0 and its lock clears. Weights move toward what
 *     they want linearly over BLEND seconds, so snapping on and letting
 *     go are both a fade, and a fade that takes the same time at 30 fps
 *     as at 120.
 *
 *  7. THE DEAD ZONE (BE Godot): a target within DEAD_MIN of the animated
 *     ankle leaves the animated leg ALONE, ramping in by DEAD_MAX. This
 *     is not an optimisation. Re-solving a near-straight leg replaces the
 *     clean animated leg with an analytic one whose bend plane is
 *     undefined, and that is what crossed Beyond Extinction's idle legs.
 *     On flat ground a standing body is exactly its animation.
 *
 *  8. ROOT DROP: a target a leg cannot reach means the BODY must come
 *     down — a foot cannot be longer than its leg. The drop is the
 *     vertical distance that brings the hardest-stretched PLANTED leg
 *     within reach, weighted by that foot's stance, clamped to MAX_DROP
 *     and eased — down fast, up slower (DROP_DOWN_TIME, DROP_UP_TIME).
 *     Never negative: this module lowers a body
 *     onto its feet, it never lifts one — a body standing too low is the
 *     caller's placement to fix, and the lower foot's IK bends the knee
 *     meanwhile. "Within reach" means REACH of thigh + shin, OR as far as
 *     the animation already has the leg, whichever is longer, so a pose
 *     that stands on a straight leg is never pulled down merely for
 *     standing on it.
 *
 *  9. TWO-BONE IK per leg in the bind frame, from the (dropped) hip to
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
 *     animated foot's orientation, so the sole does not tilt with a leg
 *     correction. Each is written back as a bind-frame turn
 *     `R_j = A_parent⁻¹ · A_j`, slerped with the animated turn by that
 *     foot's weight.
 *
 * ─── units and frames ────────────────────────────────────────────────
 *
 * Everything the IK does is in the BIND FRAME and the bind file's units,
 * where the turns are. Everything the world is asked — ground, locks,
 * grip — is in WORLD METRES. The seam is `FeetFrame`: where the model's
 * root stands, its yaw (three.js `rotation.y`), and how many bind units
 * make a metre. The model root is the bind point (0, floorY, 0), and it
 * is LOWERED by `rootDrop`: the caller moves its model, this module moves
 * nothing but numbers.
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
 * How far in front of the ankle the ground is scanned, as a fraction of
 * leg length. GAME TUNING, carried from BE Godot's SCAN_FRAC (0.28): the
 * ankle joint sits behind the ball of the foot that actually bears the
 * step, and a foot in motion is heading forward.
 */
export const SCAN_FRAC = 0.28;

/**
 * A foot lifted this far above the other, as a fraction of leg length, is
 * mid-step and has no stance weight. GAME TUNING: BE Godot's SWING_H was
 * 0.16 m, which on a human leg of about 0.75 m is this fraction.
 */
export const SWING_FRAC = 0.2;

/** Seconds for a foot's weight to fade fully in or out. GAME TUNING, BE's BLEND_T. */
export const BLEND_TIME = 0.15;

/** Stance weight above which a foot locks to the world. GAME TUNING. */
export const LOCK_ON = 0.9;

/**
 * Stance weight below which a lock lets go. GAME TUNING. Well below
 * LOCK_ON, so a foot hovering near the threshold cannot lock and unlock
 * on alternate frames and walk in little jerks.
 */
export const LOCK_OFF = 0.5;

/**
 * Furthest a lock may sit from where the animation has the foot, as a
 * fraction of leg length, before the foot gives up and steps. GAME
 * TUNING: comfortably more than a planted foot drifts in a stride whose
 * cycle is advanced by distance, and much less than a turn on the spot
 * or a teleport moves it.
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
 * How far above the animated ankle the ground search starts, in metres.
 * GAME TUNING, and not a free number: ground higher than RELEASE above
 * the foot would be released as a ledge anyway, so starting the search
 * any higher only risks finding a table top.
 */
export const SEARCH_UP_M = RELEASE_M;

/**
 * The dead zone, in metres: a target nearer the animated ankle than
 * DEAD_MIN leaves the leg alone, and the correction ramps to full by
 * DEAD_MAX. GAME TUNING, tighter than BE Godot's 0.02 / 0.06 because that
 * figure let a foot float 2 cm, which at a scientist's scale a player
 * standing beside her can see.
 */
export const DEAD_MIN_M = 0.005;
export const DEAD_MAX_M = 0.015;

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
 * millimetres low for a tenth of a second. Measured in
 * `tests/humanFeet.test.ts`'s worst case — the body carried forward
 * 1.2 m/s over a locked foot with the animation frozen, so the leg only
 * stretches — after five frames a 0.1 s descent had let Jack's foot
 * slide 2.5 mm; 0.04 s holds it to 1.5 mm (Sarah, 0.4 mm). The residue
 * is the lag of any easing behind a need that keeps growing; in a walk
 * whose phase is advanced by distance the animated foot travels back
 * with the ground and the need barely grows at all.
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
  /** The weight the IK was actually applied with last frame (stance-free, dead zone included). */
  applied: number;
  /** Whether the foot holds a world point. */
  locked: boolean;
  /** The held point, world metres. Meaningful only while `locked`. */
  lockX: number;
  lockZ: number;
  /** The last ground found under this foot, world metres, for a foot fading out over nothing. */
  groundY: number;
  hasGround: boolean;
  /** The grip of that ground, 0..1. The next frame's slide reads it. */
  grip: number;
  /** Last frame's target ankle, world metres. */
  targetX: number;
  targetY: number;
  targetZ: number;
}

/** A leg of the rig, resolved once at `createFeet`. Bind units. */
interface LegRig {
  readonly hip: number;
  readonly knee: number;
  readonly ankle: number;
  readonly hipParent: number;
  readonly kneeParent: number;
  readonly ankleParent: number;
  readonly thigh: number;
  readonly shin: number;
  readonly sole: number;
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

/** Per-leg working values for one frame. Reused, never reallocated. */
interface LegWork {
  /** Index of the hip / knee / ankle turn in the input list, or -1. */
  hipTurn: number;
  kneeTurn: number;
  ankleTurn: number;
  /** Animated ankle, world metres, with NO drop applied. */
  ankleX: number;
  ankleY0: number;
  ankleZ: number;
  /** Target ankle, world metres. */
  targetX: number;
  targetY: number;
  targetZ: number;
  /** Whether this leg has a target at all this frame. */
  active: boolean;
  /** Metres this leg needs the body lowered by, before weighting. */
  needDrop: number;
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
  readonly q: readonly Quat[];
  readonly v: readonly Vec[];
}

export interface FeetResult {
  readonly turns: readonly JointTurn[];
  /** Metres to LOWER the model root this frame (≥ 0) so the lower foot can reach its ground. */
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
  return {
    hip,
    knee,
    ankle,
    hipParent: bind[hip].parent,
    kneeParent: bind[knee].parent,
    ankleParent: bind[ankle].parent,
    thigh: span(bind, hip, knee),
    shin: span(bind, knee, ankle),
    sole: bind[ankle].y - floorY,
  };
}

function newFoot(): FootState {
  return {
    weight: 0,
    stance: 0,
    applied: 0,
    locked: false,
    lockX: 0,
    lockZ: 0,
    groundY: 0,
    hasGround: false,
    grip: 1,
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
    ankleX: 0,
    ankleY0: 0,
    ankleZ: 0,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    active: false,
    needDrop: 0,
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
 * the list does not name only costs the foot its level: the leg is still
 * solved.
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
  const legM = (measure.legLength > 0 ? measure.legLength : state.legLength) / upm;
  const pos = state.pos;

  // The body's forward, in the world: bind +Z under the yaw.
  const fwdX = sin;
  const fwdZ = cos;

  const rootGround = frame.released ? null : frame.groundAt(frame.rootX, frame.rootZ, frame.rootY + SEARCH_UP_M);

  // Where the animation has each sole: the lower one is the stance
  // reference every lift is measured from.
  const solesL = pos[state.legs[0].ankle * 3 + 1] - state.legs[0].sole;
  const solesR = pos[state.legs[1].ankle * 3 + 1] - state.legs[1].sole;
  const solesLow = Math.min(solesL, solesR);

  const blendStep = BLEND_TIME > 0 ? dt / BLEND_TIME : 1;
  let wantDrop = 0;

  for (let side = 0; side < 2; side += 1) {
    const leg = state.legs[side];
    const foot = state.feet[side];
    const work = state.work[side];
    work.hipTurn = state.turnOf[leg.hip];
    work.kneeTurn = state.turnOf[leg.knee];
    work.ankleTurn = state.turnOf[leg.ankle];
    work.active = false;
    work.needDrop = 0;

    // The animated ankle in the world, before any drop.
    const ax = pos[leg.ankle * 3] / upm;
    const az = pos[leg.ankle * 3 + 2] / upm;
    work.ankleX = frame.rootX + ax * cos + az * sin;
    work.ankleZ = frame.rootZ - ax * sin + az * cos;
    work.ankleY0 = frame.rootY + (pos[leg.ankle * 3 + 1] - floorY) / upm;
    const ankleYNow = work.ankleY0 - state.rootDrop;

    const lift = ((side === 0 ? solesL : solesR) - solesLow) / upm;
    const gate = 1 - clamp(lift / (SWING_FRAC * legM), 0, 1);

    // Grip first: a lock that slides this frame is searched where it slid to.
    if (foot.locked) {
      // The grip is the one found under this foot last frame: the ground
      // that was holding it is the ground it slips on.
      const grip = clamp(foot.grip, 0, 1);
      const slide = dt > 0 ? 1 - Math.pow(grip, dt / SLIP_FRAME) : 0;
      foot.lockX += (work.ankleX - foot.lockX) * slide;
      foot.lockZ += (work.ankleZ - foot.lockZ) * slide;
      if (Math.hypot(foot.lockX - work.ankleX, foot.lockZ - work.ankleZ) > MAX_LOCK_FRAC * legM) foot.locked = false;
    }

    let atX = foot.locked ? foot.lockX : work.ankleX;
    let atZ = foot.locked ? foot.lockZ : work.ankleZ;
    let ground = frame.released
      ? null
      : frame.groundAt(atX + fwdX * SCAN_FRAC * legM, atZ + fwdZ * SCAN_FRAC * legM, ankleYNow + SEARCH_UP_M);

    const grounded = ground !== null && rootGround !== null && Math.abs(ground.y - rootGround.y) <= RELEASE_M;
    foot.weight = moveToward(foot.weight, grounded ? 1 : 0, blendStep);
    foot.stance = foot.weight * gate;

    if (foot.locked && (!grounded || foot.stance < LOCK_OFF)) {
      foot.locked = false;
      atX = work.ankleX;
      atZ = work.ankleZ;
      if (!frame.released) {
        ground = frame.groundAt(atX + fwdX * SCAN_FRAC * legM, atZ + fwdZ * SCAN_FRAC * legM, ankleYNow + SEARCH_UP_M);
      }
    }
    if (!foot.locked && grounded && foot.stance > LOCK_ON) {
      foot.locked = true;
      foot.lockX = atX;
      foot.lockZ = atZ;
    }

    if (ground !== null) {
      foot.groundY = ground.y;
      foot.hasGround = true;
      foot.grip = ground.grip;
    }
    if (!foot.hasGround || foot.weight <= 0) continue;

    work.active = true;
    work.targetX = atX;
    work.targetZ = atZ;
    work.targetY = foot.groundY + leg.sole / upm + lift;
    foot.targetX = work.targetX;
    foot.targetY = work.targetY;
    foot.targetZ = work.targetZ;

    // How far the body has to come down for this leg to reach, if it is
    // planted. A leg may be as long as REACH of its bones, or as long as
    // the animation already has it — never pulled down for standing on a
    // leg the pose made straight.
    if (grounded && foot.stance > 0) {
      const hx = pos[leg.hip * 3] / upm;
      const hz = pos[leg.hip * 3 + 2] / upm;
      const hipX = frame.rootX + hx * cos + hz * sin;
      const hipZ = frame.rootZ - hx * sin + hz * cos;
      const hipY = frame.rootY + (pos[leg.hip * 3 + 1] - floorY) / upm;
      const animated = Math.hypot(
        pos[leg.ankle * 3] - pos[leg.hip * 3],
        pos[leg.ankle * 3 + 1] - pos[leg.hip * 3 + 1],
        pos[leg.ankle * 3 + 2] - pos[leg.hip * 3 + 2],
      );
      const reach = Math.max(REACH * (leg.thigh + leg.shin), animated) / upm;
      const across = Math.hypot(work.targetX - hipX, work.targetZ - hipZ);
      const down = hipY - work.targetY;
      const need = across < reach ? down - Math.sqrt(reach * reach - across * across) : down;
      work.needDrop = need > DROP_EPSILON_M ? need : 0;
      wantDrop = Math.max(wantDrop, work.needDrop * foot.stance);
    }
  }

  // The body settles onto its feet. Eased, never negative, never more
  // than MAX_DROP.
  wantDrop = clamp(wantDrop, 0, MAX_DROP_FRAC * legM);
  const settleTime = wantDrop > state.rootDrop ? DROP_DOWN_TIME : DROP_UP_TIME;
  const settle = dt > 0 ? 1 - Math.exp(-dt / settleTime) : 0;
  state.rootDrop = Math.max(0, state.rootDrop + (wantDrop - state.rootDrop) * settle);
  if (wantDrop === 0 && state.rootDrop < DROP_EPSILON_M) state.rootDrop = 0;
  const drop = state.rootDrop;

  for (let side = 0; side < 2; side += 1) {
    const leg = state.legs[side];
    const foot = state.feet[side];
    const work = state.work[side];
    foot.applied = 0;
    if (!work.active || work.hipTurn < 0 || work.kneeTurn < 0) continue;

    // The dead zone, measured against the animated ankle where it stands
    // NOW, with this frame's drop.
    const miss = Math.hypot(work.targetX - work.ankleX, work.targetY - (work.ankleY0 - drop), work.targetZ - work.ankleZ);
    const weight = foot.weight * clamp((miss - DEAD_MIN_M) / (DEAD_MAX_M - DEAD_MIN_M), 0, 1);
    if (weight <= 1e-6) continue;
    foot.applied = weight;

    solveLeg(state, leg, work, frame, upm, drop, cos, sin, weight, out);
  }

  const result = state.result;
  result.turns = usedPrefix(state, out, count);
  result.rootDrop = drop;
  return result;
}

/**
 * One leg's two-bone solve, written into `out` at the leg's own turn
 * indices, slerped from the animated turns by `weight`.
 */
function solveLeg(
  state: FeetState,
  leg: LegRig,
  work: LegWork,
  frame: FeetFrame,
  upm: number,
  drop: number,
  cos: number,
  sin: number,
  weight: number,
  out: MutableJointTurn[],
): void {
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
  const v = state.v;
  const hip = v[1];
  const knee = v[2];
  const ankle = v[3];
  const target = v[4];
  const thigh = v[5];
  const shin = v[6];
  const pole = v[7];

  hip.x = pos[leg.hip * 3];
  hip.y = pos[leg.hip * 3 + 1];
  hip.z = pos[leg.hip * 3 + 2];
  knee.x = pos[leg.knee * 3];
  knee.y = pos[leg.knee * 3 + 1];
  knee.z = pos[leg.knee * 3 + 2];
  ankle.x = pos[leg.ankle * 3];
  ankle.y = pos[leg.ankle * 3 + 1];
  ankle.z = pos[leg.ankle * 3 + 2];

  // The target, from the world into the bind frame of a body lowered by
  // `drop` — which is the same as raising the target by it.
  const dx = work.targetX - frame.rootX;
  const dz = work.targetZ - frame.rootZ;
  target.x = (dx * cos - dz * sin) * upm;
  target.z = (dx * sin + dz * cos) * upm;
  target.y = (work.targetY - (frame.rootY - drop)) * upm + state.floorY;

  const l1 = leg.thigh;
  const l2 = leg.shin;
  if (l1 < 1e-9 || l2 < 1e-9) return;

  let dirX = target.x - hip.x;
  let dirY = target.y - hip.y;
  let dirZ = target.z - hip.z;
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
  shin.x = hip.x + dirX * reach - (hip.x + nkx);
  shin.y = hip.y + dirY * reach - (hip.y + nky);
  shin.z = hip.z + dirZ * reach - (hip.z + nkz);
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

  // Ankle: keep the animated foot's orientation under a parent that now
  // carries Δk · Δh.
  if (work.ankleTurn >= 0) {
    qLoad(parentQ, rot, leg.ankleParent);
    qMul(parentQ, tmp, parentQ);
    qLoad(result, rot, leg.ankle);
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
