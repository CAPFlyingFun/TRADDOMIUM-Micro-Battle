/**
 * WHERE JACK AND SARAH'S HANDS GO — a post-pass on an animated pose that
 * puts a hand ON something in the world (a keyboard's grip, an intercom
 * button), holds it there while it is comfortably within reach, and lets
 * it go, gently, when it is not.
 *
 * `humanPose.poseHuman` and `humanSeated.poseSeated` write arms that know
 * nothing of the room. This module runs AFTER them — and after the aim
 * pass, because the body's turn is an INPUT here: the shoulders are
 * wherever the posed spine and chest carried them — reads the turns it is
 * given and hands back the same list with the arms' turns replaced.
 *
 * ─── the rules, and where each came from ─────────────────────────────
 *
 * Joshua agreed every rule below on 2026-09-30, from renders of the
 * prototype that preceded this file.
 *
 *  1. FORWARD KINEMATICS in the bind frame, exactly as `humanFeet` does
 *     it: `A_j = A_parent · R_j`, and a posed bone stands at
 *     `p_parent + A_parent · (b_j − b_parent)`. Every joint the turn list
 *     does not name has R = identity; where a joint is named twice the
 *     LAST entry wins, which is what `view/HumanRig.apply` does too.
 *
 *  2. THE ARM is shoulder → elbow → wrist → FINGERTIP, and the fingertip
 *     is the wrist's descendant furthest from it in the bind — the middle
 *     finger's tip on both masters. Its LENGTH is the sum of the three
 *     spans in the bind: Jack 0.60 m, Sarah 0.63-0.64 m (her forearms
 *     differ by 7 mm, so each arm is measured on its own).
 *
 *  3. A HAND HOLDS only while its target is COMFORTABLY within reach from
 *     its OWN shoulder: the shoulder joint to the target no further than
 *     HOLD_OUT of the arm's length, and the horizontal direction to it
 *     within ANGLE_OUT of the body's straight ahead, inward or outward
 *     (arms may cross). Past either it lets go, and it takes hold again
 *     only under HOLD_IN and ANGLE_IN — hysteresis, so a target on the
 *     line does not make the hand twitch. "Straight ahead" is the posed
 *     CHEST's forward, flattened, so an aim pass that turns the torso turns
 *     the window with it; seated or standing without one, it is the root's.
 *
 *  4. A HAND THAT IS NOT HOLDING RESTS. Seated, it lies on its own thigh,
 *     REST_ALONG of the way from hip to knee and REST_ABOVE above that
 *     line, palm down — the rest is the base the hold is layered over, so
 *     letting go of a keyboard is the hand travelling back to the lap.
 *     Standing, there is no rest: the arm is the animation again.
 *
 *  5. BLENDS, never pops. The hold's weight and the rest's weight each
 *     move linearly toward what they want over BLEND_TIME, so the time is
 *     the same at 30 fps as at 120, and each is applied through a
 *     smoothstep so the hand leaves and arrives at rest. A turn is
 *     `slerp(slerp(animated, rest, rest weight), hold, hold weight)`.
 *
 *  6. THE FINGERTIP ARRIVES, not the wrist. The wrist is placed a hand's
 *     length short of the target along the HORIZONTAL approach from the
 *     shoulder, raised HAND_RAISE, and exactly a hand's length from the
 *     target — so the hand pointed from the wrist to the target puts the
 *     tip on it, fingers tipped a few degrees down onto what they hold.
 *
 *  7. THE PALM lies flat on what it holds. In the T-pose bind both palms
 *     face DOWN (−Y); the hand is turned so its long axis runs wrist →
 *     target and its palm faces the target's `palm` direction (default
 *     world down), orthogonalised against that axis. The roll this takes
 *     — a forward reach hangs the palm inward, a keyboard wants it down —
 *     is PRONATION, which in a real arm happens along the forearm; this
 *     rig has no twist bone, so FOREARM_ROLL of it goes on the elbow
 *     (about the forearm's own axis, which moves nothing) and the rest on
 *     the wrist, halving the candy-wrapper at each.
 *
 *  8. THE ELBOW hangs down and outward — BIOLOGICAL SHAPE — and it is a
 *     HINGE. The bend plane contains shoulder → wrist and a pole of
 *     `down + POLE_OUT × outward`; where that pole runs along the arm, a
 *     backward pole is blended in continuously (never switched), so the
 *     elbow cannot flip. Each bone is placed by its own direction AND the
 *     hinge axis (the bind's `bone × forward`, which is the axis
 *     `humanPose` flexes an elbow about), so the elbow's turn is a
 *     flexion and nothing the auto-rigger's local axes invented.
 *
 *  9. CROSSING. When both hands hold and one arm reaches across the
 *     body's midline (its target on the far side of the chest), the two
 *     arms' upper-arm and forearm segments are tested as capsules of
 *     CAPSULE_RADIUS; closer than 2 × radius + CAPSULE_MARGIN, one hand
 *     YIELDS. A HOLD yields to a PRESS; between two of a kind the arm that
 *     crossed keeps its target and the OTHER yields. The yielding hand
 *     slides along its target's `slideAxis`, trying both ways in SLIDE_STEP
 *     steps to ±`slideRange`, and takes the SMALLER move that clears and
 *     stays comfortably in reach (+ first on a tie). If nothing within the
 *     range clears — or it has no axis — it lets go and rests. It never
 *     slides off the range. The slide itself eases at SLIDE_SPEED.
 *
 * 10. WRITTEN BACK as bind-frame turns `R_j = A_parent⁻¹ · A_j`, the
 *     shoulder's parent (the clavicle) taken from the animation as posed.
 *
 * ─── units and frames ────────────────────────────────────────────────
 *
 * The solve is in the BIND FRAME and the bind file's units, where the
 * turns are; targets, palms and slide axes arrive in WORLD METRES and
 * are carried in through `ReachFrame`, whose root, yaw (three.js
 * `rotation.y`), `unitsPerMetre` and `floorY` mean exactly what they mean
 * to `humanFeet`: a bind point (x, y, z) stands in the world at
 * (rootX + (x cosψ + z sinψ)/u, rootY + (y − floorY)/u,
 * rootZ + (−x sinψ + z cosψ)/u). A seated body is lowered by its owner
 * moving rootY; this module moves nothing but numbers.
 *
 * ─── the turn list ───────────────────────────────────────────────────
 *
 * The returned list is every input turn, in order, copied through —
 * except the shoulder, elbow and wrist turns of an arm with any weight,
 * which are replaced by the blend of rule 5 — followed by any of the six
 * arm joints (shoulderL, elbowL, wristL, shoulderR, elbowR, wristR, in
 * that order) the input did not name. Those are appended EVERY frame,
 * as identity when their arm is idle, so the list's length only changes
 * when the input's does: a consumer never sees a joint named one frame
 * and dropped the next.
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

const DEG = Math.PI / 180;

/** A holding hand lets go when its target is further than this share of the arm from its shoulder. GAME TUNING (Joshua, 2026-09-30). */
export const HOLD_OUT = 0.9;

/** A released hand takes hold again only under this share. GAME TUNING (Joshua, 2026-09-30): the hysteresis band. */
export const HOLD_IN = 0.85;

/** A holding hand lets go when its target lies further than this from straight ahead, either way. GAME TUNING (Joshua, 2026-09-30). */
export const ANGLE_OUT = 90 * DEG;

/**
 * A released hand takes hold again only within this of straight ahead.
 * GAME TUNING, and an EXTENSION of what was agreed, which named a
 * hysteresis for the distance only: without one here, a target standing
 * on the 90° line is crossed and recrossed by the chest's breath, and the
 * hand twitches in and out at the breathing rate. Five degrees is the
 * same width, in spirit, as the 85/90 distance band.
 */
export const ANGLE_IN = 85 * DEG;

/** Seconds for a hold or a rest to blend fully in or out. GAME TUNING (Joshua, 2026-09-30). */
export const BLEND_TIME = 0.25;

/** A seated hand rests this share of the way from hip to knee. GAME TUNING (Joshua, 2026-09-30). */
export const REST_ALONG = 0.62;

/** ... and this far above that line, metres, world up: the top of a thigh, not its bone. GAME TUNING (Joshua, 2026-09-30). */
export const REST_ABOVE_M = 0.1;

/**
 * How far the wrist is raised above the fingertip's height, metres. GAME
 * TUNING, from the approved prototype: 3 cm over a 15-18 cm hand tips the
 * fingers 10-12° down onto the keys — a typist's hand, not a flat board.
 */
export const HAND_RAISE_M = 0.03;

/**
 * The longest a solved arm (shoulder to wrist) may be, as a share of
 * upper arm + forearm. GAME TUNING, the same number as `humanFeet.REACH`
 * and for the same reason: a two-bone solve dead straight has no bend
 * plane left, and the last half-percent is where an elbow snaps.
 */
export const ARM_REACH = 0.995;

/**
 * How far OUTWARD the elbow's pole leans, per unit of down. BIOLOGICAL
 * SHAPE with a tuned size: an elbow hangs down and a little out from the
 * line of a reach; 0.6 (about 31° out from straight down) is the
 * prototype's, approved from renders.
 */
export const POLE_OUT = 0.6;

/**
 * Below this length of the pole's part perpendicular to the arm (the
 * pole running along the arm), a BACKWARD pole is blended in. GAME
 * TUNING: a unit pole within 17° of the arm is too near parallel to trust.
 */
const POLE_MIN = 0.3;

/**
 * Below this horizontal distance from the shoulder to a target, metres,
 * the approach direction blends toward straight ahead. GAME TUNING: a
 * target directly under or over the shoulder has no horizontal direction.
 */
const APPROACH_MIN_M = 0.05;

/**
 * The share of the palm's roll the forearm takes (rule 7). GAME TUNING:
 * pronation is a forearm's motion; with no twist bone, half at the elbow
 * and half at the wrist keeps either joint's skin from wringing.
 */
export const FOREARM_ROLL = 0.5;

/** The radius of each arm segment's capsule, metres. GAME TUNING (Joshua, 2026-09-30): a forearm is 8-10 cm thick. */
export const CAPSULE_RADIUS_M = 0.045;

/** The air two capsules must keep between them, metres. GAME TUNING (Joshua, 2026-09-30). */
export const CAPSULE_MARGIN_M = 0.01;

/** The step a yielding hand's slide is searched in, metres. GAME TUNING (Joshua, 2026-09-30). */
export const SLIDE_STEP_M = 0.01;

/** The slide range when a target names none, metres either way. GAME TUNING (Joshua, 2026-09-30). */
export const SLIDE_RANGE_M = 0.2;

/**
 * How fast a yielding hand slides to its clear spot, metres per second.
 * GAME TUNING: the whole 20 cm range in a quarter second, the blend's
 * time, so a hand making room moves no faster than one taking hold.
 */
export const SLIDE_SPEED_M = 0.8;

// ─── public shapes ───────────────────────────────────────────────────

export type HandSide = 'L' | 'R';

export interface HandTarget {
  readonly side: HandSide;
  /** Where the FINGERTIP goes, world metres. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly kind: 'hold' | 'press';
  /** Which way the palm faces, world; default (0, −1, 0). Need not be unit. */
  readonly palm?: { x: number; y: number; z: number };
  /** The line a yielding hand may slide along, world; default none (the hand lets go instead). Need not be unit. */
  readonly slideAxis?: { x: number; y: number; z: number };
  /** Metres either way along `slideAxis`; default SLIDE_RANGE_M. */
  readonly slideRange?: number;
}

export interface ReachFrame {
  /** Seconds since the last call (the simulation dt). */
  readonly dt: number;
  /** Where the model's root (bind point (0, floorY, 0)) stands, world metres, and its yaw (three.js rotation.y). */
  readonly rootX: number;
  readonly rootY: number;
  readonly rootZ: number;
  readonly rootYaw: number;
  /** Bind-frame units per world metre. */
  readonly unitsPerMetre: number;
  /** Seated: a free hand rests on its thigh. Standing: a free hand is the animation's. */
  readonly seated: boolean;
  /** 0, 1 or 2 entries. A second entry for a side already given is ignored. */
  readonly hands: readonly HandTarget[];
}

/** One hand, as a HUD or a test reads it. Written only here. */
export interface HandStatus {
  /** Whether the hand holds its target this frame (after any yield). */
  holding: boolean;
  /** The hold's blend weight, 0..1, linear in time. */
  weight: number;
  /** Shoulder to target over the arm's length; 0 with no target. */
  share: number;
  /** Degrees from straight ahead, horizontal, + outward (toward this arm's own side), − inward; 0 with no target. */
  angle: number;
  /** What the crossing rule did to this hand this frame. */
  yielded: 'none' | 'slid' | 'let go';
  /** Metres slid along the target's slide axis, signed, as applied (eased). */
  slid: number;
  /**
   * EXTENSION: the rest's blend weight, 0..1. Not in the agreed shape;
   * added because "let go" and "at rest on the thigh" are different
   * moments a quarter-second apart, and a HUD or a test needs both.
   */
  rest: number;
}

export interface ReachResult {
  readonly turns: readonly JointTurn[];
  readonly L: HandStatus;
  readonly R: HandStatus;
  /**
   * EXTENSION: which arm the crossing rule found reaching across the
   * midline this frame, and the closest its capsule axes came to the
   * other arm's BEFORE any yield, metres (Infinity when not tested).
   * Added so the gap the rule acted on can be read, not re-derived.
   */
  readonly crossed: HandSide | 'none';
  readonly gap: number;
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

/** One arm of the rig, resolved once at `createReach`. Bind units. */
export interface ArmRig {
  readonly side: HandSide;
  /** False when the chain is not shoulder → elbow → wrist, parent to child: the arm then never reaches. */
  readonly ok: boolean;
  readonly shoulder: number;
  readonly elbow: number;
  readonly wrist: number;
  /** The fingertip: the wrist's descendant furthest from it in the bind (or the wrist, with none). */
  readonly tip: number;
  /** The shoulder's parent (the clavicle), or -1. */
  readonly parent: number;
  readonly upper: number;
  readonly fore: number;
  readonly hand: number;
  /** upper + fore + hand: the length a share is measured against. */
  readonly length: number;
  /** +1 when this arm runs toward +x in the bind. */
  readonly xSign: number;
  /** Bind directions of the upper arm and forearm, and each one's hinge axis (`bone × +Z`, unit). */
  readonly ub: Vec;
  readonly uh: Vec;
  readonly fb: Vec;
  readonly fh: Vec;
  /** The leg this hand rests on. */
  readonly hip: number;
  readonly knee: number;
}

/** A solved arm: its three local turns and where its joints stand, bind frame. */
interface ArmSolve {
  readonly s: Quat;
  readonly e: Quat;
  readonly w: Quat;
  readonly S: Vec;
  readonly E: Vec;
  readonly W: Vec;
}

/** One hand's memory between frames. */
interface HandMemory {
  readonly status: HandStatus;
  /** The reach latch (rule 3), before any yield. */
  inReach: boolean;
  /** Whether this hand wants to hold this frame, after any yield. */
  want: boolean;
  /** Whether a target was given this frame, and whether one ever was. */
  given: boolean;
  has: boolean;
  /** The last target given, world. */
  tx: number;
  ty: number;
  tz: number;
  px: number;
  py: number;
  pz: number;
  sx: number;
  sy: number;
  sz: number;
  hasAxis: boolean;
  range: number;
  kind: 'hold' | 'press';
  /** The slide applied, and the slide wanted, metres. */
  offset: number;
  wantOffset: number;
  /** This frame's target and palm in the bind (no slide), and the slide axis in the bind (unit). */
  readonly tb: Vec;
  readonly pb: Vec;
  readonly ab: Vec;
}

export interface ReachState {
  readonly floorY: number;
  readonly arms: readonly [ArmRig, ArmRig];
  readonly hands: readonly [HandMemory, HandMemory];
  /** Joint indices, every parent before its children. */
  readonly order: Int32Array;
  /** Per joint: the index of the (last) turn naming it this frame, or -1. */
  readonly turnOf: Int32Array;
  /** Per joint: accumulated animated rotation, xyzw, and animated position, bind frame. */
  readonly rot: Float64Array;
  readonly pos: Float64Array;
  readonly hold: readonly [ArmSolve, ArmSolve];
  readonly rest: readonly [ArmSolve, ArmSolve];
  readonly probe: readonly [ArmSolve, ArmSolve];
  readonly view: MutableJointTurn[];
  readonly result: {
    turns: readonly JointTurn[];
    L: HandStatus;
    R: HandStatus;
    crossed: HandSide | 'none';
    gap: number;
  };
  readonly q: readonly Quat[];
  readonly v: readonly Vec[];
  /** This frame's body: the chest's forward and the body's left, horizontal and unit, bind frame. */
  readonly body: { fx: number; fz: number; lx: number; lz: number; cx: number; cz: number; upm: number };
}

// ─── small arithmetic, allocation-free ───────────────────────────────

function qSet(o: Quat, x: number, y: number, z: number, w: number): Quat {
  o.x = x;
  o.y = y;
  o.z = z;
  o.w = w;
  return o;
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

/** o = a⁻¹ for a unit quaternion. Safe when o aliases a. */
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

/** o = slerp(a, b, t), the short way round. o may alias a. */
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

/**
 * The rotation carrying the orthonormal pair (a, n) onto the orthonormal
 * pair (b, m) — each a unit direction and a unit normal perpendicular to
 * it — written into `o`. R = [b m b×m] · [a n a×n]ᵀ, then Shepperd.
 */
function qFromFrames(o: Quat, a: Vec, n: Vec, b: Vec, m: Vec): Quat {
  const cx = a.y * n.z - a.z * n.y;
  const cy = a.z * n.x - a.x * n.z;
  const cz = a.x * n.y - a.y * n.x;
  const dx = b.y * m.z - b.z * m.y;
  const dy = b.z * m.x - b.x * m.z;
  const dz = b.x * m.y - b.y * m.x;
  const r00 = b.x * a.x + m.x * n.x + dx * cx;
  const r01 = b.x * a.y + m.x * n.y + dx * cy;
  const r02 = b.x * a.z + m.x * n.z + dx * cz;
  const r10 = b.y * a.x + m.y * n.x + dy * cx;
  const r11 = b.y * a.y + m.y * n.y + dy * cy;
  const r12 = b.y * a.z + m.y * n.z + dy * cz;
  const r20 = b.z * a.x + m.z * n.x + dz * cx;
  const r21 = b.z * a.y + m.z * n.y + dz * cy;
  const r22 = b.z * a.z + m.z * n.z + dz * cz;
  const trace = r00 + r11 + r22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    qSet(o, (r21 - r12) * s, (r02 - r20) * s, (r10 - r01) * s, 0.25 / s);
  } else if (r00 > r11 && r00 > r22) {
    const s = 2 * Math.sqrt(Math.max(1e-12, 1 + r00 - r11 - r22));
    qSet(o, 0.25 * s, (r01 + r10) / s, (r02 + r20) / s, (r21 - r12) / s);
  } else if (r11 > r22) {
    const s = 2 * Math.sqrt(Math.max(1e-12, 1 + r11 - r00 - r22));
    qSet(o, (r01 + r10) / s, 0.25 * s, (r12 + r21) / s, (r02 - r20) / s);
  } else {
    const s = 2 * Math.sqrt(Math.max(1e-12, 1 + r22 - r00 - r11));
    qSet(o, (r02 + r20) / s, (r12 + r21) / s, 0.25 * s, (r10 - r01) / s);
  }
  return qNormalize(o);
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

function vSet(o: Vec, x: number, y: number, z: number): Vec {
  o.x = x;
  o.y = y;
  o.z = z;
  return o;
}

function vUnit(o: Vec): Vec {
  const n = Math.hypot(o.x, o.y, o.z);
  if (n < 1e-12) return vSet(o, 0, 0, 0);
  return vSet(o, o.x / n, o.y / n, o.z / n);
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Linear, and SNAPPED within a billionth: fifteen sixtieths of a quarter
 * second sum to 0.9999999999999999, and a weight that never quite arrives
 * never reports a hand as fully on its target.
 */
function moveToward(value: number, target: number, step: number): number {
  const next = value < target ? Math.min(target, value + step) : Math.max(target, value - step);
  return Math.abs(next - target) < 1e-9 ? target : next;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The closest two segments come, p1→q1 and p2→q2 (Ericson, Real-Time
 * Collision Detection, 5.1.9), in the segments' own units.
 */
function segmentGap(p1: Vec, q1: Vec, p2: Vec, q2: Vec): number {
  const d1x = q1.x - p1.x;
  const d1y = q1.y - p1.y;
  const d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x;
  const d2y = q2.y - p2.y;
  const d2z = q2.z - p2.z;
  const rx = p1.x - p2.x;
  const ry = p1.y - p2.y;
  const rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s: number;
  let t: number;
  if (a <= 1e-12 && e <= 1e-12) {
    s = 0;
    t = 0;
  } else if (a <= 1e-12) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-12) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const den = a * e - b * b;
      s = den > 1e-12 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  return Math.hypot(rx + d1x * s - d2x * t, ry + d1y * s - d2y * t, rz + d1z * s - d2z * t);
}

/** The closest the capsule axes of two solved arms come, over all four upper/fore pairs, bind units. */
function armGap(a: ArmSolve, b: ArmSolve): number {
  return Math.min(
    segmentGap(a.E, a.W, b.E, b.W),
    segmentGap(a.E, a.W, b.S, b.E),
    segmentGap(a.S, a.E, b.E, b.W),
    segmentGap(a.S, a.E, b.S, b.E),
  );
}

// ─── the rig, once ───────────────────────────────────────────────────

function span(bind: readonly BindJoint[], a: number, b: number): number {
  return Math.hypot(bind[a].x - bind[b].x, bind[a].y - bind[b].y, bind[a].z - bind[b].z);
}

/** A bone's bind direction and its hinge axis, `bone × +Z`, both unit. */
function hingeOf(bind: readonly BindJoint[], from: number, to: number, dir: Vec, hinge: Vec): void {
  vUnit(vSet(dir, bind[to].x - bind[from].x, bind[to].y - bind[from].y, bind[to].z - bind[from].z));
  // dir × (0, 0, 1) = (dir.y, −dir.x, 0)
  vUnit(vSet(hinge, dir.y, -dir.x, 0));
}

function readArm(
  bind: readonly BindJoint[],
  side: HandSide,
  shoulder: number,
  elbow: number,
  wrist: number,
  hip: number,
  knee: number,
): ArmRig {
  const ok = bind[elbow].parent === shoulder && bind[wrist].parent === elbow;
  // The fingertip: the wrist's descendant furthest from it.
  let tip = wrist;
  let far = 0;
  for (let i = 0; i < bind.length; i += 1) {
    let at = bind[i].parent;
    let steps = 0;
    while (at >= 0 && at !== wrist && steps <= bind.length) {
      at = bind[at].parent;
      steps += 1;
    }
    if (at !== wrist) continue;
    const d = span(bind, i, wrist);
    if (d > far) {
      far = d;
      tip = i;
    }
  }
  const ub = { x: 0, y: 0, z: 0 };
  const uh = { x: 0, y: 0, z: 0 };
  const fb = { x: 0, y: 0, z: 0 };
  const fh = { x: 0, y: 0, z: 0 };
  hingeOf(bind, shoulder, elbow, ub, uh);
  hingeOf(bind, elbow, wrist, fb, fh);
  const upper = span(bind, shoulder, elbow);
  const fore = span(bind, elbow, wrist);
  return {
    side,
    ok: ok && upper > 1e-9 && fore > 1e-9 && far > 1e-9,
    shoulder,
    elbow,
    wrist,
    tip,
    parent: bind[shoulder].parent,
    upper,
    fore,
    hand: far,
    length: upper + fore + far,
    xSign: bind[wrist].x >= bind[shoulder].x ? 1 : -1,
    ub,
    uh,
    fb,
    fh,
    hip,
    knee,
  };
}

function newStatus(): HandStatus {
  return { holding: false, weight: 0, share: 0, angle: 0, yielded: 'none', slid: 0, rest: 0 };
}

function newMemory(): HandMemory {
  return {
    status: newStatus(),
    inReach: false,
    want: false,
    given: false,
    has: false,
    tx: 0,
    ty: 0,
    tz: 0,
    px: 0,
    py: -1,
    pz: 0,
    sx: 0,
    sy: 0,
    sz: 0,
    hasAxis: false,
    range: SLIDE_RANGE_M,
    kind: 'hold',
    offset: 0,
    wantOffset: 0,
    tb: { x: 0, y: 0, z: 0 },
    pb: { x: 0, y: -1, z: 0 },
    ab: { x: 0, y: 0, z: 0 },
  };
}

function newSolve(): ArmSolve {
  return {
    s: { x: 0, y: 0, z: 0, w: 1 },
    e: { x: 0, y: 0, z: 0, w: 1 },
    w: { x: 0, y: 0, z: 0, w: 1 },
    S: { x: 0, y: 0, z: 0 },
    E: { x: 0, y: 0, z: 0 },
    W: { x: 0, y: 0, z: 0 },
  };
}

/**
 * A body's hands, before the first frame: nothing held, nothing at rest,
 * both fading in from the animation over BLEND_TIME.
 *
 * `floorY` is the bind-frame height of the soles, exactly as
 * `humanFeet.createFeet` takes it: 0 by default, −1.0 on the two masters
 * as `view/HumanRig` loads them.
 */
export function createReach(measure: HumanMeasure, bind: readonly BindJoint[], floorY = 0): ReachState {
  const n = bind.length;
  const j = measure.joints;

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
  for (let i = 0; i < 16; i += 1) v.push({ x: 0, y: 0, z: 0 });

  const L = readArm(bind, 'L', j.shoulderL, j.elbowL, j.wristL, j.hipL, j.kneeL);
  const R = readArm(bind, 'R', j.shoulderR, j.elbowR, j.wristR, j.hipR, j.kneeR);
  const hands: [HandMemory, HandMemory] = [newMemory(), newMemory()];

  return {
    floorY,
    arms: [L, R],
    hands,
    order,
    turnOf: new Int32Array(n).fill(-1),
    rot: new Float64Array(n * 4),
    pos: new Float64Array(n * 3),
    hold: [newSolve(), newSolve()],
    rest: [newSolve(), newSolve()],
    probe: [newSolve(), newSolve()],
    view: [],
    result: { turns: [], L: hands[0].status, R: hands[1].status, crossed: 'none', gap: Infinity },
    q,
    v,
    body: { fx: 0, fz: 1, lx: 1, lz: 0, cx: 0, cz: 0, upm: 1 },
  };
}

/** The animated skeleton, written into `state.rot` and `state.pos` — `humanFeet.animateBind`'s arithmetic. */
function animate(state: ReachState, bind: readonly BindJoint[], turns: readonly JointTurn[]): void {
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
    const jt = order[k];
    const parent = bind[jt].parent;
    if (parent < 0) qSet(carried, 0, 0, 0, 1);
    else qLoad(carried, rot, parent);
    const t = turnOf[jt];
    if (t >= 0) qMul(carried, carried, qFromTurn(own, turns[t]));
    qStore(rot, jt, carried);
    if (parent < 0) {
      pos[jt * 3] = bind[jt].x;
      pos[jt * 3 + 1] = bind[jt].y;
      pos[jt * 3 + 2] = bind[jt].z;
    } else {
      qLoad(carried, rot, parent);
      qRotate(offset, carried, bind[jt].x - bind[parent].x, bind[jt].y - bind[parent].y, bind[jt].z - bind[parent].z);
      pos[jt * 3] = pos[parent * 3] + offset.x;
      pos[jt * 3 + 1] = pos[parent * 3 + 1] + offset.y;
      pos[jt * 3 + 2] = pos[parent * 3 + 2] + offset.z;
    }
  }
}

// ─── one arm ─────────────────────────────────────────────────────────

/**
 * Solve one arm so its fingertip reaches `T` (bind frame) with its palm
 * facing `palm` (bind frame, need not be unit), rules 6-8 and 10. Reads
 * the animated skeleton; writes only `into`.
 */
function solveArm(state: ReachState, arm: ArmRig, T: Vec, palm: Vec, into: ArmSolve): void {
  const pos = state.pos;
  const rot = state.rot;
  const body = state.body;
  const upm = body.upm;
  const v = state.v;
  const q = state.q;
  const S = into.S;
  const E = into.E;
  const W = into.W;
  const dir = v[1];
  const pole = v[2];
  const un = v[3];
  const fn = v[4];
  const hn = v[5];
  const a1 = v[6];
  const n1 = v[7];
  const a0 = v[8];
  const n0 = v[9];
  const tmp = v[10];
  const parentQ = q[2];
  const As = q[3];
  const Ae = q[4];
  const Aw = q[5];
  const delta = q[6];
  const roll = q[7];
  const inv = q[8];

  vSet(S, pos[arm.shoulder * 3], pos[arm.shoulder * 3 + 1], pos[arm.shoulder * 3 + 2]);
  const outSign = arm.side === 'L' ? 1 : -1;
  const outX = body.lx * outSign;
  const outZ = body.lz * outSign;

  // The approach: horizontal, shoulder to target, blending toward straight
  // ahead as the target comes over the shoulder (rule 6).
  let apx = T.x - S.x;
  let apz = T.z - S.z;
  const apl = Math.hypot(apx, apz);
  const approachMin = APPROACH_MIN_M * upm;
  if (apl < approachMin) {
    apx += body.fx * (approachMin - apl);
    apz += body.fz * (approachMin - apl);
  }
  const apn = Math.hypot(apx, apz);
  apx = apn > 1e-12 ? apx / apn : body.fx;
  apz = apn > 1e-12 ? apz / apn : body.fz;

  // The wrist: a hand's length from the target, raised, short along the approach.
  const hand = arm.hand;
  const raise = Math.min(HAND_RAISE_M * upm, 0.9 * hand);
  const back = Math.sqrt(hand * hand - raise * raise);
  const wx = T.x - apx * back;
  const wy = T.y + raise;
  const wz = T.z - apz * back;

  // Two bones, shoulder to wrist.
  const l1 = arm.upper;
  const l2 = arm.fore;
  vSet(dir, wx - S.x, wy - S.y, wz - S.z);
  const distance = Math.hypot(dir.x, dir.y, dir.z);
  if (distance > 1e-12) vSet(dir, dir.x / distance, dir.y / distance, dir.z / distance);
  else vSet(dir, body.fx, 0, body.fz);
  const reach = clamp(distance, Math.abs(l1 - l2) + 1e-6 * (l1 + l2), ARM_REACH * (l1 + l2));

  // The pole: down and outward, less its part along the arm; a backward
  // pole blended in, continuously, where that leaves too little (rule 8).
  vSet(pole, outX * POLE_OUT, -1, outZ * POLE_OUT);
  vUnit(pole);
  let along = pole.x * dir.x + pole.y * dir.y + pole.z * dir.z;
  vSet(pole, pole.x - dir.x * along, pole.y - dir.y * along, pole.z - dir.z * along);
  const pl = Math.hypot(pole.x, pole.y, pole.z);
  if (pl < POLE_MIN) {
    along = -body.fx * dir.x - body.fz * dir.z;
    vSet(tmp, -body.fx - dir.x * along, -dir.y * along, -body.fz - dir.z * along);
    vUnit(tmp);
    const k = POLE_MIN - pl;
    vSet(pole, pole.x + tmp.x * k, pole.y + tmp.y * k, pole.z + tmp.z * k);
  }
  vUnit(pole);

  const cosA = clamp((l1 * l1 + reach * reach - l2 * l2) / (2 * l1 * reach), -1, 1);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  vSet(un, dir.x * cosA + pole.x * sinA, dir.y * cosA + pole.y * sinA, dir.z * cosA + pole.z * sinA);
  vSet(E, S.x + un.x * l1, S.y + un.y * l1, S.z + un.z * l1);
  vSet(W, S.x + dir.x * reach, S.y + dir.y * reach, S.z + dir.z * reach);
  vUnit(vSet(fn, W.x - E.x, W.y - E.y, W.z - E.z));
  // The hinge: pole × arm, perpendicular to the bend plane.
  vUnit(vSet(hn, pole.y * dir.z - pole.z * dir.y, pole.z * dir.x - pole.x * dir.z, pole.x * dir.y - pole.y * dir.x));

  qFromFrames(As, arm.ub, arm.uh, un, hn);
  qFromFrames(Ae, arm.fb, arm.fh, fn, hn);

  // The hand: its long axis from the wrist to the target, its palm on the
  // target's palm direction (rule 7). The tip's offset from the wrist in
  // the bind is read through the animation, so a posed finger still lands.
  const tipX = pos[arm.tip * 3] - pos[arm.wrist * 3];
  const tipY = pos[arm.tip * 3 + 1] - pos[arm.wrist * 3 + 1];
  const tipZ = pos[arm.tip * 3 + 2] - pos[arm.wrist * 3 + 2];
  qLoad(inv, rot, arm.wrist);
  qInv(inv, inv);
  qRotate(a0, inv, tipX, tipY, tipZ);
  vUnit(a0);
  // The bind palm faces down: −Y, less its part along the hand.
  vUnit(vSet(n0, a0.y * a0.x, -1 + a0.y * a0.y, a0.y * a0.z));
  vUnit(vSet(a1, T.x - W.x, T.y - W.y, T.z - W.z));
  if (a1.x === 0 && a1.y === 0 && a1.z === 0) vSet(a1, apx, 0, apz);
  const pd = palm.x * a1.x + palm.y * a1.y + palm.z * a1.z;
  const pn = Math.hypot(palm.x, palm.y, palm.z);
  vSet(n1, palm.x - a1.x * pd, palm.y - a1.y * pd, palm.z - a1.z * pd);
  const nl = pn > 1e-12 ? Math.hypot(n1.x, n1.y, n1.z) / pn : 0;
  if (nl < POLE_MIN) {
    // A palm that faces along the hand: fall back, continuously, on a palm
    // facing back along the approach — a hand pointing down, palm to the body.
    const fb = -apx * a1.x - apz * a1.z;
    vSet(tmp, -apx + a1.x * fb, a1.y * fb, -apz + a1.z * fb);
    vUnit(tmp);
    const k = (POLE_MIN - nl) * (pn > 1e-12 ? pn : 1);
    vSet(n1, n1.x + tmp.x * k, n1.y + tmp.y * k, n1.z + tmp.z * k);
  }
  vUnit(n1);
  qFromFrames(Aw, a0, n0, a1, n1);

  // Pronation: FOREARM_ROLL of the wrist's twist about the forearm goes on
  // the elbow, about the forearm's own axis, which moves neither joint.
  qMul(delta, Aw, qInv(inv, Ae));
  if (delta.w < 0) qSet(delta, -delta.x, -delta.y, -delta.z, -delta.w);
  const proj = delta.x * fn.x + delta.y * fn.y + delta.z * fn.z;
  const phi = 2 * Math.atan2(proj, delta.w);
  const half = phi * FOREARM_ROLL * 0.5;
  const sh = Math.sin(half);
  qSet(roll, fn.x * sh, fn.y * sh, fn.z * sh, Math.cos(half));
  qMul(Ae, roll, Ae);

  // Local turns: R_j = A_parent⁻¹ · A_j (rule 10).
  if (arm.parent >= 0) qLoad(parentQ, rot, arm.parent);
  else qSet(parentQ, 0, 0, 0, 1);
  qNormalize(qMul(into.s, qInv(parentQ, parentQ), As));
  qNormalize(qMul(into.e, qInv(inv, As), Ae));
  qNormalize(qMul(into.w, qInv(inv, Ae), Aw));
}

// ─── the frame ───────────────────────────────────────────────────────

/** A world point into the bind frame. */
function pointToBind(state: ReachState, frame: ReachFrame, x: number, y: number, z: number, into: Vec): Vec {
  const upm = state.body.upm;
  const cos = Math.cos(frame.rootYaw);
  const sin = Math.sin(frame.rootYaw);
  const dx = x - frame.rootX;
  const dz = z - frame.rootZ;
  return vSet(into, (dx * cos - dz * sin) * upm, (y - frame.rootY) * upm + state.floorY, (dx * sin + dz * cos) * upm);
}

/** A world direction into the bind frame (rotation only). */
function dirToBind(frame: ReachFrame, x: number, y: number, z: number, into: Vec): Vec {
  const cos = Math.cos(frame.rootYaw);
  const sin = Math.sin(frame.rootYaw);
  return vSet(into, x * cos - z * sin, y, x * sin + z * cos);
}

/** The share and the signed angle (radians, + outward) of a bind-frame target, from this arm's posed shoulder. */
function measureTarget(state: ReachState, arm: ArmRig, T: Vec, status: HandStatus): void {
  const pos = state.pos;
  const body = state.body;
  const dx = T.x - pos[arm.shoulder * 3];
  const dy = T.y - pos[arm.shoulder * 3 + 1];
  const dz = T.z - pos[arm.shoulder * 3 + 2];
  const outSign = arm.side === 'L' ? 1 : -1;
  const ahead = dx * body.fx + dz * body.fz;
  const out = (dx * body.lx + dz * body.lz) * outSign;
  status.share = Math.hypot(dx, dy, dz) / arm.length;
  status.angle = Math.atan2(out, ahead) / DEG;
}

/** Whether a share and an angle (degrees) are within the hold's window, for a hand holding or not. */
function inWindow(holding: boolean, share: number, angleDeg: number): boolean {
  const angle = Math.abs(angleDeg) * DEG;
  return holding ? share <= HOLD_OUT && angle <= ANGLE_OUT : share < HOLD_IN && angle <= ANGLE_IN;
}

/**
 * Put the hands where their targets are. `turns` is the animation's list
 * (poseHuman or poseSeated, with any aim turns appended; read-only);
 * `out` is a caller-owned buffer the result is written into (grown once,
 * never allocated into after the first call). See the header for what
 * the returned list holds and in what order.
 */
export function reachHands(
  state: ReachState,
  measure: HumanMeasure,
  bind: readonly BindJoint[],
  turns: readonly JointTurn[],
  frame: ReachFrame,
  out: MutableJointTurn[],
): ReachResult {
  const count = turns.length;
  while (out.length < count) out.push(newJointTurn());
  for (let i = 0; i < count; i += 1) copyTurn(out[i], turns[i]);

  animate(state, bind, turns);

  const upm = frame.unitsPerMetre > 0 ? frame.unitsPerMetre : 1;
  const dt = Math.max(0, frame.dt);
  const body = state.body;
  body.upm = upm;

  // The body: the posed chest's forward, flattened, and its left (rule 3).
  const chest = measure.joints.chest;
  const cq = qLoad(state.q[0], state.rot, chest);
  const fwd = qRotate(state.v[0], cq, 0, 0, 1);
  const fl = Math.hypot(fwd.x, fwd.z);
  body.fx = fl > 1e-9 ? fwd.x / fl : 0;
  body.fz = fl > 1e-9 ? fwd.z / fl : 1;
  const left = measure.leftSign < 0 ? -1 : 1;
  body.lx = left * body.fz;
  body.lz = -left * body.fx;
  body.cx = state.pos[chest * 3];
  body.cz = state.pos[chest * 3 + 2];

  // This frame's targets.
  const hands = state.hands;
  hands[0].given = false;
  hands[1].given = false;
  for (let i = 0; i < frame.hands.length; i += 1) {
    const h = frame.hands[i];
    const mem = hands[h.side === 'L' ? 0 : 1];
    if (mem.given) continue;
    mem.given = true;
    mem.has = true;
    mem.tx = h.x;
    mem.ty = h.y;
    mem.tz = h.z;
    mem.kind = h.kind;
    if (h.palm !== undefined) {
      mem.px = h.palm.x;
      mem.py = h.palm.y;
      mem.pz = h.palm.z;
    } else {
      mem.px = 0;
      mem.py = -1;
      mem.pz = 0;
    }
    const axis = h.slideAxis;
    const al = axis !== undefined ? Math.hypot(axis.x, axis.y, axis.z) : 0;
    mem.hasAxis = al > 1e-9;
    if (axis !== undefined && mem.hasAxis) {
      mem.sx = axis.x / al;
      mem.sy = axis.y / al;
      mem.sz = axis.z / al;
    }
    mem.range = h.slideRange !== undefined && h.slideRange >= 0 ? h.slideRange : SLIDE_RANGE_M;
  }

  // The reach latch (rule 3).
  for (let side = 0; side < 2; side += 1) {
    const arm = state.arms[side];
    const mem = hands[side];
    const status = mem.status;
    status.yielded = 'none';
    mem.wantOffset = 0;
    if (!arm.ok || !mem.given) {
      mem.inReach = false;
      mem.want = false;
      status.share = 0;
      status.angle = 0;
      continue;
    }
    pointToBind(state, frame, mem.tx, mem.ty, mem.tz, mem.tb);
    dirToBind(frame, mem.px, mem.py, mem.pz, mem.pb);
    dirToBind(frame, mem.sx, mem.sy, mem.sz, mem.ab);
    measureTarget(state, arm, mem.tb, status);
    mem.inReach = inWindow(mem.inReach, status.share, status.angle);
    mem.want = mem.inReach;
  }

  // Crossing (rule 9).
  const result = state.result;
  result.crossed = 'none';
  result.gap = Infinity;
  if (hands[0].want && hands[1].want) crossing(state, hands[0], hands[1]);

  // Ease the slides and the weights (rule 5).
  const blendStep = BLEND_TIME > 0 ? dt / BLEND_TIME : 1;
  const slideStep = SLIDE_SPEED_M * dt;
  for (let side = 0; side < 2; side += 1) {
    const mem = hands[side];
    const status = mem.status;
    mem.offset = moveToward(mem.offset, mem.hasAxis ? mem.wantOffset : 0, slideStep);
    status.holding = mem.want;
    status.weight = moveToward(status.weight, mem.want ? 1 : 0, blendStep);
    status.rest = moveToward(status.rest, frame.seated && state.arms[side].ok ? 1 : 0, blendStep);
    status.slid = mem.offset;
  }

  // Solve and write.
  let used = count;
  for (let side = 0; side < 2; side += 1) {
    const arm = state.arms[side];
    const mem = hands[side];
    const status = mem.status;
    const holdW = arm.ok && mem.has ? smooth(status.weight) : 0;
    const restW = arm.ok ? smooth(status.rest) : 0;
    if (holdW > 0) {
      const T = state.v[11];
      pointToBind(
        state,
        frame,
        mem.tx + mem.sx * mem.offset,
        mem.ty + mem.sy * mem.offset,
        mem.tz + mem.sz * mem.offset,
        T,
      );
      dirToBind(frame, mem.px, mem.py, mem.pz, state.v[12]);
      solveArm(state, arm, T, state.v[12], state.hold[side]);
    }
    if (restW > 0 && holdW < 1) {
      const T = restPoint(state, arm, state.v[11]);
      solveArm(state, arm, T, vSet(state.v[12], 0, -1, 0), state.rest[side]);
    }
    used = writeJoint(state, out, used, arm.shoulder, holdW, restW, state.hold[side].s, state.rest[side].s);
    used = writeJoint(state, out, used, arm.elbow, holdW, restW, state.hold[side].e, state.rest[side].e);
    used = writeJoint(state, out, used, arm.wrist, holdW, restW, state.hold[side].w, state.rest[side].w);
  }

  result.turns = usedPrefix(state, out, used);
  return result;
}

/** Where a seated hand rests on its thigh, bind frame (rule 4). */
function restPoint(state: ReachState, arm: ArmRig, into: Vec): Vec {
  const pos = state.pos;
  const h = arm.hip * 3;
  const k = arm.knee * 3;
  return vSet(
    into,
    pos[h] + (pos[k] - pos[h]) * REST_ALONG,
    pos[h + 1] + (pos[k + 1] - pos[h + 1]) * REST_ALONG + REST_ABOVE_M * state.body.upm,
    pos[h + 2] + (pos[k + 2] - pos[h + 2]) * REST_ALONG,
  );
}

/**
 * One arm joint's output turn: the animation's (or identity, appended at
 * `used` when the input does not name the joint), blended to the rest and
 * then to the hold. Returns the new used count.
 */
function writeJoint(
  state: ReachState,
  out: MutableJointTurn[],
  used: number,
  joint: number,
  holdW: number,
  restW: number,
  hold: Quat,
  rest: Quat,
): number {
  let index = state.turnOf[joint];
  let next = used;
  const q = state.q[9];
  if (index < 0) {
    while (out.length <= used) out.push(newJointTurn());
    index = used;
    next = used + 1;
    qSet(q, 0, 0, 0, 1);
  } else {
    // An idle arm's own turn is the copy already in `out`, bit for bit.
    if (restW <= 0 && holdW <= 0) return next;
    qFromTurn(q, out[index]);
  }
  if (restW <= 0 && holdW <= 0) {
    writeQuatTurn(out[index], joint, q);
    return next;
  }
  if (restW > 0 && holdW < 1) qSlerp(q, q, rest, restW);
  if (holdW > 0) qSlerp(q, q, hold, holdW);
  writeQuatTurn(out[index], joint, q);
  return next;
}

/** The lateral offset of a bind-frame point from the chest, toward the body's left. */
function lateral(state: ReachState, T: Vec): number {
  const body = state.body;
  return (T.x - body.cx) * body.lx + (T.z - body.cz) * body.lz;
}

/**
 * Rule 9: both hands want to hold. If one arm reaches across the midline
 * and the solved arms come too close, the yielding hand slides along its
 * axis to the nearest clear spot, or lets go.
 */
function crossing(state: ReachState, handL: HandMemory, handR: HandMemory): void {
  const result = state.result;
  const upm = state.body.upm;
  const latL = lateral(state, handL.tb);
  const latR = lateral(state, handR.tb);
  const crossL = latL < 0 ? -latL : 0;
  const crossR = latR > 0 ? latR : 0;
  if (crossL <= 0 && crossR <= 0) return;
  const crosser = crossL >= crossR ? 0 : 1;
  result.crossed = crosser === 0 ? 'L' : 'R';

  // A hold yields to a press; between two of a kind, the arm that did not cross yields.
  let yielder = 1 - crosser;
  if (handL.kind !== handR.kind) yielder = handL.kind === 'hold' ? 0 : 1;
  const keeper = 1 - yielder;
  const hands = state.hands;
  const mem = hands[yielder];
  const arm = state.arms[yielder];
  const keep = state.probe[keeper];
  const probe = state.probe[yielder];

  solveArm(state, state.arms[keeper], hands[keeper].tb, hands[keeper].pb, keep);
  solveArm(state, arm, mem.tb, mem.pb, probe);
  const clear = (2 * CAPSULE_RADIUS_M + CAPSULE_MARGIN_M) * upm;
  const gap = armGap(keep, probe);
  result.gap = gap / upm;
  if (gap >= clear) return;

  if (mem.hasAxis) {
    const steps = Math.floor(mem.range / SLIDE_STEP_M + 1e-9);
    const cand = state.v[13];
    const status = mem.status;
    // The status' share and angle are this frame's for the ORIGINAL target;
    // the search measures candidates into a scratch and restores them.
    const share = status.share;
    const angle = status.angle;
    for (let k = 1; k <= steps; k += 1) {
      for (let s = 1; s >= -1; s -= 2) {
        const move = s * k * SLIDE_STEP_M * upm;
        vSet(cand, mem.tb.x + mem.ab.x * move, mem.tb.y + mem.ab.y * move, mem.tb.z + mem.ab.z * move);
        measureTarget(state, arm, cand, status);
        if (!inWindow(true, status.share, status.angle)) continue;
        solveArm(state, arm, cand, mem.pb, probe);
        if (armGap(keep, probe) >= clear) {
          status.share = share;
          status.angle = angle;
          mem.wantOffset = s * k * SLIDE_STEP_M;
          status.yielded = 'slid';
          return;
        }
      }
    }
    status.share = share;
    status.angle = angle;
  }
  mem.want = false;
  mem.status.yielded = 'let go';
}

/**
 * The turns written, as an array exactly `used` long: `out` itself when
 * it is that long, otherwise a view held on the state and only re-pointed
 * when it has to be — `humanFeet`'s device.
 */
function usedPrefix(state: ReachState, out: MutableJointTurn[], used: number): readonly JointTurn[] {
  if (out.length === used) return out;
  const view = state.view;
  if (view.length !== used) view.length = used;
  for (let i = 0; i < used; i += 1) {
    if (view[i] !== out[i]) view[i] = out[i];
  }
  return view;
}
