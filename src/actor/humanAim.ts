/**
 * WHERE JACK AND SARAH ARE LOOKING — a post-pass on an animated pose that
 * turns the head, neck, chest and spine toward a point in the world, and
 * hands whatever the body cannot turn by itself to the BODY.
 *
 * Joshua, asking for it: "a raycast for the body and head ... so as Sarah
 * looks between the computer and Jack, it will know exactly where to
 * position the head angles to face each thing as well as body". So this
 * is a LOOK SOLVER. It is told where a thing is — a person's eyes, the
 * middle of a monitor — in world metres, and it answers with the same
 * turn list the animation wrote, the aim joints turned toward that thing
 * within anatomical limits, plus a yaw for the whole body: a standing
 * body turns on its feet, a seated one swivels its chair. The caller
 * adds that yaw to its root; this module moves nothing but numbers.
 *
 * It runs AFTER the poser (`humanPose.poseHuman`, `humanSeated.poseSeated`)
 * and BEFORE `humanFeet.groundFeet`, which copies every turn it does not
 * own straight through.
 *
 * ─── the rules, and where each came from ─────────────────────────────
 *
 *  1. FORWARD KINEMATICS in the bind frame, exactly as `humanPose`'s
 *     header defines a turn and `humanFeet` walks it: `A_j = A_parent ·
 *     R_j`, and a posed joint stands at `p_parent + A_parent · (b_j −
 *     b_parent)`. Only the CHAIN matters here — the skull and every joint
 *     above it to the root, resolved once at `createAim` — so a frame
 *     walks eight joints, not sixty-nine.
 *
 *  2. THE STAGES are four joints on that chain, turned in a human order.
 *     The SKULL is the joint that turns the head: `measure.joints.head` is
 *     the CROWN, the top of the head, a leaf with nothing hanging off it,
 *     so the skull is the crown's parent unless that parent is the neck,
 *     in which case it is the crown itself (TMB-Story's rule). Then the
 *     NECK, the CHEST and the SPINE. On both masters the chain is spine
 *     (Bone_004) → Bone_003 → chest (Bone_002) → neck (Bone_018) → skull
 *     (Bone_017) → crown. A stage whose joint is not on the chain, or
 *     sits above a stage it should sit below, is disabled: its share
 *     passes on to the next as if its limit were zero.
 *
 *  3. THE EYE is a point carried by the skull: EYE_UP of the way from the
 *     skull joint to the crown, plus EYE_FORWARD of that same skull-to-
 *     crown length straight ahead (bind +Z). The LOOK is the skull's own
 *     forward, bind +Z carried by its accumulated rotation. A look is on
 *     target when the line from the eye along the look passes through the
 *     target — which is the "raycast" asked for, and why `state.eye` and
 *     `state.look` are published in world metres for anyone drawing it.
 *
 *  4. THE DIRECTION is solved CLOSED-LOOP, not read off once. The desired
 *     yaw (from the body's forward, bind +Z under `rootYaw`) and pitch (up
 *     positive) are measured from the eye to the target; the look those
 *     angles produce is measured by FK; the difference is fed back into
 *     the command, SOLVE_PASSES times a frame, warm-started from the last
 *     frame. Two things make this necessary rather than tidy. The eye is
 *     9 cm ahead of the skull's pivot, so it MOVES as the head turns — a
 *     face 0.85 m away is several degrees off from where the unturned eye
 *     saw it. And the animation already bends the chain (the seated pose
 *     pitches the head 8° down; a doze rolls it 20°), and a yaw about a
 *     tilted neck is not a yaw about the vertical. Both are what the loop
 *     measures and removes, so the animation's lean and breath survive
 *     AND the eye still lands on the face.
 *
 *  5. THE SPLIT. The command is a total yaw and a total pitch; each stage
 *     takes what it can and passes the rest on, skull first:
 *
 *        yaw:   skull ±40°, neck ±30°, chest ±15°, spine ±15°, then the
 *               BODY takes the remainder when `bodyFree`, and otherwise
 *               it is dropped and the look falls short (`onTarget` false).
 *        pitch: skull +20°/−30°, neck +15°/−20° (up/down); the chest and
 *               spine take none.
 *
 *     "Takes what it can" is a SOFT clamp, not `min`: a stage passes its
 *     input through unchanged up to SOFT_KNEE of its limit, then eases
 *     into the limit along a parabola that meets it with zero slope at
 *     (2 − SOFT_KNEE) of it. The split is therefore C¹ everywhere — no
 *     kink where a stage saturates and the next one wakes, so a target
 *     drifting across that line moves every joint smoothly — and it still
 *     REACHES each limit exactly, which `tanh` never does. A small glance
 *     is all skull: a command of 20° is 20° of skull and nothing else;
 *     30° is 28.75° of skull and 1.25° of neck; 60° is skull 40°, neck
 *     19.6°, chest 0.4°, body 0; 100° is skull 40°, neck 30°, chest 15°,
 *     spine 13.1° and 1.9° of body. (A COMMAND, not a target: the eye
 *     rides forward of the pivots, so a face 100° round at 2 m needs about
 *     97° — measured on both masters in `tests/humanAim.test.ts`, which is
 *     also why a held body still reaches it.)
 *
 *  6. THE AXES. A stage's yaw is a twist about its PARENT'S rotated up
 *     axis (anatomical axial rotation about the spine), its pitch is about
 *     the lateral axis after that yaw, and both go on top of the animated
 *     turn at that joint: `R'_j = Ry(yaw) · Rx(−pitch) · R_j`, all in the
 *     bind frame. Because the renderer carries a bind-frame turn by the
 *     parent's accumulated rotation, `Ry` applied there IS a twist about
 *     the parent's rotated up — which is the `R_j = A_parent⁻¹ · A_j` of
 *     `humanFeet` written the short way round. (`Rx(+θ)` tips a +Y bone
 *     forward, so looking UP is `Rx(−θ)`.)
 *
 *  7. THE ORDER — head first, body last. Each stage eases toward its goal
 *     with its own time constant (skull 0.08 s, neck 0.12 s, torso 0.2 s,
 *     body 0.35 s) as `1 − exp(−dt/τ)`, so the same seconds give the same
 *     motion at 30 fps and at 120. The chest, spine and body ease toward
 *     the SETTLED split of rule 5. The skull and neck ease toward the same
 *     split applied to what the torso and body have NOT YET delivered —
 *     re-solved closed-loop against the torso as it stands this frame —
 *     so the gaze arrives at the head's pace and the head then gives back,
 *     counter-turning as the body comes round under it, until it rests at
 *     its settled share. (In that re-solve the skull takes its soft share
 *     and the neck takes the rest outright up to its limit — see `split` —
 *     so it hands back exactly the settled shares once the body arrives.)
 *     That is the order a person turns in: eyes and
 *     head to the thing, then the body, the head re-centring as it goes.
 *     A null target relaxes every stage to zero with the same constants
 *     (the body to the nearest whole turn, so it never unwinds the long
 *     way).
 *
 *  8. CONTINUITY. Yaw is never wrapped once it is a command: the error
 *     fed back is `wrap(desired − achieved)`, so the command moves the
 *     SHORT way from where the look already is, and a target that sweeps
 *     across 180° behind the body is followed round without a flip. A
 *     body with `bodyFree` false has a command clamped to what the chain
 *     can reach, so it holds its side until the target is half a turn
 *     from where it looks. A target at the eye (or straight overhead, for
 *     yaw) leaves the command where it was: no NaN, no spin. `dt = 0`
 *     eases nothing and returns the current state; `weight` scales every
 *     output angle, 0 being the animation untouched.
 *
 * ─── the output list ─────────────────────────────────────────────────
 *
 * `turns` in, every entry in the SAME order and at the same index, the
 * non-aim joints copied through unchanged; then, APPENDED after them in
 * parent-first order (spine, chest, neck, skull), one turn for each
 * enabled stage joint the input did not name. The appended turns are
 * written every frame whether or not they are turned — the fixed-list
 * rule of `humanPose`'s header, so a consumer never holds a stale skull.
 * `poseHuman`'s fifteen come back as sixteen (the skull appended),
 * `poseSeated`'s sixteen as seventeen (it names the CROWN, which is not
 * the skull). If the input names an aim joint more than once, the LAST
 * occurrence is the one turned, which is the one a renderer applying the
 * list in order keeps.
 *
 * ─── angles out ──────────────────────────────────────────────────────
 *
 * Every yaw here is in three.js `rotation.y` sense — positive turns bind
 * +Z toward bind +X — because that is what `bodyYaw` has to be for a
 * caller to ADD it to its root, and a result that spoke two conventions
 * would be a sign bug waiting. On a rig whose left lies toward +X
 * (`measure.leftSign` +1, both masters) the body's RIGHT is therefore
 * NEGATIVE yaw. Nothing in the solve needs `leftSign`: every angle is
 * measured from geometry in the bind frame, so a mirrored re-export looks
 * the right way without a sign changing; the tests place their targets on
 * the body's right through `leftSign` and check exactly that.
 *
 * Units: the solve is in the BIND FRAME and the bind file's units; the
 * seam to the world is `AimFrame`, the same root/yaw/unitsPerMetre seam as
 * `humanFeet.FeetFrame` (the model root is bind point (0, floorY, 0)).
 *
 * Pure: no three, no DOM, no storage, no network. This is core, and
 * `tests/simulationCore.test.ts` holds it to that. Deterministic, no
 * `Math.random`, and nothing allocated after the first call has grown the
 * caller's `out`.
 */

import {
  newJointTurn,
  type BindJoint,
  type HumanMeasure,
  type JointTurn,
  type MutableJointTurn,
} from './humanRig';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

// ─── tuning ──────────────────────────────────────────────────────────

/**
 * The eye's height above the skull joint, as a fraction of the skull-to-
 * crown span. BIOLOGICAL SHAPE: an adult's pupils sit about 11 cm under
 * the vertex (head height ~23 cm, eyes at about its middle), and eye
 * height is about 0.93 of stature in standard anthropometric tables. On
 * both masters the crown is 0.146 m above the skull joint, so 0.25 puts
 * the eye 3.7 cm above it — Sarah's eye at 1.49 m on a 1.60 m body, 0.93
 * of her height.
 */
export const EYE_UP_FRAC = 0.25;

/**
 * The eye's distance ahead of the skull joint (bind +Z), as a fraction of
 * the skull-to-crown span. BIOLOGICAL SHAPE, approximate: the head's
 * pivot on the spine lies under the ear, and the eyes are 8–9 cm in front
 * of it. 0.6 of 0.146 m is 8.8 cm.
 */
export const EYE_FORWARD_FRAC = 0.6;

/** Stage indices, in the order the split FILLS them: head first. */
export const SKULL = 0;
export const NECK = 1;
export const CHEST = 2;
export const SPINE = 3;
export const AIM_STAGES = 4;

/**
 * The most each stage may yaw either way, radians: skull, neck, chest,
 * spine. GAME TUNING toward anatomy. Adults turn the head on the trunk
 * by about 70° each way (Youdas et al., Phys Ther 72:770, 1992, active
 * cervical rotation in young adults), about half of it at the atlanto-
 * axial joint (White & Panjabi, Clinical Biomechanics of the Spine, 2nd
 * ed., 1990) — hence skull 40° + neck 30°. The thoracic spine adds some
 * tens of degrees and the lumbar little; 15° + 15° is a torso that turns
 * visibly without the pelvis, which in these rigs carries the legs and
 * is never turned.
 */
export const YAW_LIMITS: readonly number[] = Object.freeze([40 * DEG, 30 * DEG, 15 * DEG, 15 * DEG]);

/**
 * Pitch limits per stage, radians: how far UP (extension) and DOWN
 * (flexion). GAME TUNING toward anatomy: the neck flexes about 50° and
 * extends about 60° in total (Youdas et al. 1992), a share of it at the
 * skull's own joint; this game asks less of it than that — a look, not a
 * stretch. The chest and spine take no pitch: a body that bows to look
 * down is a different animation, not an aim.
 */
export const PITCH_UP_LIMITS: readonly number[] = Object.freeze([20 * DEG, 15 * DEG, 0, 0]);
export const PITCH_DOWN_LIMITS: readonly number[] = Object.freeze([30 * DEG, 20 * DEG, 0, 0]);

/**
 * Easing time constants per stage, seconds: skull, neck, chest, spine.
 * GAME TUNING in the human order — in a gaze shift the head arrives
 * before the trunk, and the trunk before the feet or the chair.
 */
export const STAGE_TAUS: readonly number[] = Object.freeze([0.08, 0.12, 0.2, 0.2]);

/** Easing time constant of the body's (or chair's) yaw, seconds. GAME TUNING: last of all. */
export const BODY_TAU = 0.35;

/**
 * Where a stage's soft clamp stops passing its input straight through, as
 * a fraction of its limit (rule 5). GAME TUNING: half. Lower and a small
 * glance already leaks into the neck; higher and the hand-over from one
 * stage to the next is abrupt — the parabola that joins them is
 * `2 (1 − SOFT_KNEE)` limits long.
 */
export const SOFT_KNEE = 0.5;

/**
 * The look is ON TARGET when it passes within this angle of the target,
 * radians. GAME TUNING: a degree at conversational distance is 1.5 cm at
 * a metre — inside a face, well inside the space between two eyes.
 */
export const ON_TARGET = 1 * DEG;

/**
 * Closed-loop passes per solve (rule 4). GAME TUNING, numerical: the loop
 * gains nearly one-for-one (the split sums to its command until a stage
 * saturates), so one pass removes almost all of the error and the rest
 * mop up the eye's movement and the chain's tilt; four leave nothing a
 * test can see, warm-started from the last frame.
 */
export const SOLVE_PASSES = 4;

/** Below this many bind units the target is AT the eye and there is no direction to it. */
const AT_EYE = 1e-9;

// ─── public shapes ───────────────────────────────────────────────────

/** A point in the world, metres. */
export interface AimPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface AimFrame {
  /** Seconds since the last call (the simulation dt). */
  readonly dt: number;
  /**
   * Where the model's root (bind point (0, floorY, 0)) stands in the
   * world, metres — the same convention as `FeetFrame`.
   */
  readonly rootX: number;
  readonly rootY: number;
  readonly rootZ: number;
  /**
   * The root's yaw, three.js `rotation.y`, BEFORE this module's body yaw:
   * the caller draws the model at `rootYaw + result.bodyYaw`.
   */
  readonly rootYaw: number;
  /** Bind units per world metre (`HumanRig.bindScale`). */
  readonly unitsPerMetre: number;
  /** What to look at, world metres. null relaxes to straight ahead. */
  readonly target: AimPoint | null;
  /**
   * May the body (or its chair) take the yaw the torso cannot? false: the
   * torso stops at its limit and the rest is dropped.
   */
  readonly bodyFree: boolean;
  /** 0..1, how much of the aim to apply over the animation. Default 1. */
  readonly weight?: number;
}

export interface AimResult {
  /** The input turns, the aim joints turned, plus appended aim joints (see the header). */
  turns: readonly JointTurn[];
  /** Radians to ADD to the root's `rotation.y` this frame. Continuous, never wrapped. */
  bodyYaw: number;
  /** The head's yaw on the body — skull + neck + chest + spine — radians, `rotation.y` sense. */
  headYaw: number;
  /** The head's pitch — skull + neck — radians, up positive. */
  headPitch: number;
  /** The look passes within ON_TARGET of the target, this frame. False with no target. */
  onTarget: boolean;
  /**
   * The angle between the look and the line from the eye to the target,
   * radians; 0 with no target. Added to the spec'd result because
   * `onTarget` is a threshold, and a caller deciding when a glance has
   * "arrived" — or a test — needs the measurement it thresholds.
   */
  error: number;
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

/** One body's aim between frames. Readable by a HUD or a test; written only here. */
export interface AimState {
  /** Bind-frame height of the soles (the root). */
  readonly floorY: number;
  /** The joint that turns the skull (rule 2). */
  readonly skull: number;
  /** Per stage (SKULL..SPINE): its joint, or -1 when disabled. */
  readonly stageJoint: Int32Array;
  /** Root-first: every ancestor of the skull, then the skull. */
  readonly chain: Int32Array;
  /** Per chain entry: the stage turning it, or -1. */
  readonly chainStage: Int8Array;
  /** The eye minus the skull joint, bind frame and units. */
  readonly eyeOffset: Readonly<Vec>;

  /** Per stage, the current eased yaw and pitch (radians, before `weight`). */
  readonly yaw: Float64Array;
  readonly pitch: Float64Array;
  /** The current eased body yaw (radians, before `weight`). */
  body: number;
  /** Per stage, what it is easing toward this frame (rule 7), and the body's. */
  readonly goalYaw: Float64Array;
  readonly goalPitch: Float64Array;
  goalBody: number;
  /** The SETTLED split of the current command (rule 5): where each stage comes to rest. */
  readonly shareYaw: Float64Array;
  readonly sharePitch: Float64Array;
  shareBody: number;
  /** The closed-loop command, total yaw and pitch, warm-started from frame to frame. */
  cmdYaw: number;
  cmdPitch: number;
  hadTarget: boolean;

  /** Last frame's eye (world metres) and look (world unit vector), as drawn — the raycast. */
  readonly eye: Vec;
  readonly look: Vec;

  // ─── scratch, reused every frame ───
  readonly turnOf: Int32Array;
  /** Per chain entry: accumulated rotation xyzw and position, bind frame. */
  readonly rot: Float64Array;
  readonly pos: Float64Array;
  /** One split being tried: per-stage yaw and pitch, and the body. */
  readonly tryYaw: Float64Array;
  readonly tryPitch: Float64Array;
  /** Per stage, the output angle after `weight`. */
  readonly outYaw: Float64Array;
  readonly outPitch: Float64Array;
  /** What the last `poseChain` measured: the eye and the look, bind frame, body turned. */
  readonly fkEye: Vec;
  readonly fkLook: Vec;
  /** The target in the bind frame (before the body's yaw). */
  readonly target: Vec;
  readonly view: MutableJointTurn[];
  readonly result: AimResult;
  readonly q: readonly Quat[];
  readonly v: readonly Vec[];
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

function qFromTurn(o: Quat, turn: JointTurn): Quat {
  const half = turn.radians * 0.5;
  const s = Math.sin(half);
  return qSet(o, turn.ax * s, turn.ay * s, turn.az * s, Math.cos(half));
}

/** The aim's own rotation at a stage: `Ry(yaw) · Rx(−pitch)` (rule 6). */
function qAim(o: Quat, yaw: number, pitch: number): Quat {
  const sy = Math.sin(yaw * 0.5);
  const cy = Math.cos(yaw * 0.5);
  const sp = Math.sin(-pitch * 0.5);
  const cp = Math.cos(-pitch * 0.5);
  // (0, sy, 0, cy) · (sp, 0, 0, cp), written out.
  return qSet(o, cy * sp, sy * cp, -sy * sp, cy * cp);
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

/** An angle into (−π, π]. */
function wrap(a: number): number {
  return a - TAU * Math.round(a / TAU);
}

/**
 * The soft clamp of rule 5: `x` unchanged up to SOFT_KNEE of `limit`,
 * then a parabola that reaches `limit` with zero slope at (2 − SOFT_KNEE)
 * of it, then `limit`. C¹, odd, and exact at the limit.
 */
function soft(x: number, limit: number): number {
  if (!(limit > 0)) return 0;
  const a = SOFT_KNEE * limit;
  const b = (2 - SOFT_KNEE) * limit;
  const ax = x < 0 ? -x : x;
  if (ax <= a) return x;
  const v = ax >= b ? limit : limit - ((b - ax) * (b - ax)) / (2 * (b - a));
  return x < 0 ? -v : v;
}

/** The largest command a run of soft-clamped stages still answers to: past it nothing moves. */
function reachOf(limits: readonly number[], from: number, to: number): number {
  let sum = 0;
  for (let s = from; s < to; s += 1) sum += (2 - SOFT_KNEE) * limits[s];
  return sum;
}

// ─── the rig, once ───────────────────────────────────────────────────

/**
 * A body's aim, before the first frame: everything at rest, looking where
 * the animation looks.
 *
 * `floorY` is the bind-frame height of the soles — the model root. Default
 * 0; −1.0 on the two masters as `view/HumanRig` loads them (see
 * `humanFeet`'s header), −1/1.384083 in the test fixture's units.
 */
export function createAim(measure: HumanMeasure, bind: readonly BindJoint[], floorY = 0): AimState {
  const n = bind.length;
  const j = measure.joints;

  // Rule 2: the skull is the crown's parent unless that is the neck.
  const crown = j.head;
  const crownParent = crown >= 0 && crown < n ? bind[crown].parent : -1;
  const skull = crownParent >= 0 && crownParent !== j.neck ? crownParent : crown;

  // The chain: root-first, every ancestor of the skull, then the skull.
  let length = 0;
  for (let at = skull; at >= 0 && length <= n; at = bind[at].parent) length += 1;
  const chain = new Int32Array(length);
  {
    let k = length - 1;
    for (let at = skull; at >= 0 && k >= 0; at = bind[at].parent) chain[k--] = at;
  }

  // Stages, parent-first; one that is off the chain, or not below the
  // stage above it, is disabled.
  const stageJoint = new Int32Array(AIM_STAGES).fill(-1);
  const chainStage = new Int8Array(length).fill(-1);
  const wanted = [SPINE, CHEST, NECK, SKULL];
  const jointFor = [skull, j.neck, j.chest, j.spine];
  let above = -1;
  for (const stage of wanted) {
    const joint = jointFor[stage];
    let at = -1;
    for (let k = 0; k < length; k += 1) {
      if (chain[k] === joint) {
        at = k;
        break;
      }
    }
    if (at > above) {
      stageJoint[stage] = joint;
      chainStage[at] = stage;
      above = at;
    }
  }

  // Rule 3: the eye, as an offset carried by the skull.
  const s = bind[skull];
  const c = bind[crown];
  const span = Math.hypot(c.x - s.x, c.y - s.y, c.z - s.z);
  const eyeOffset: Vec = {
    x: EYE_UP_FRAC * (c.x - s.x),
    y: EYE_UP_FRAC * (c.y - s.y),
    z: EYE_UP_FRAC * (c.z - s.z) + EYE_FORWARD_FRAC * span,
  };

  const q: Quat[] = [];
  for (let i = 0; i < 6; i += 1) q.push({ x: 0, y: 0, z: 0, w: 1 });
  const v: Vec[] = [];
  for (let i = 0; i < 4; i += 1) v.push({ x: 0, y: 0, z: 0 });

  return {
    floorY,
    skull,
    stageJoint,
    chain,
    chainStage,
    eyeOffset,
    yaw: new Float64Array(AIM_STAGES),
    pitch: new Float64Array(AIM_STAGES),
    body: 0,
    goalYaw: new Float64Array(AIM_STAGES),
    goalPitch: new Float64Array(AIM_STAGES),
    goalBody: 0,
    shareYaw: new Float64Array(AIM_STAGES),
    sharePitch: new Float64Array(AIM_STAGES),
    shareBody: 0,
    cmdYaw: 0,
    cmdPitch: 0,
    hadTarget: false,
    eye: { x: 0, y: 0, z: 0 },
    look: { x: 0, y: 0, z: 1 },
    turnOf: new Int32Array(n).fill(-1),
    rot: new Float64Array(length * 4),
    pos: new Float64Array(length * 3),
    tryYaw: new Float64Array(AIM_STAGES),
    tryPitch: new Float64Array(AIM_STAGES),
    outYaw: new Float64Array(AIM_STAGES),
    outPitch: new Float64Array(AIM_STAGES),
    fkEye: { x: 0, y: 0, z: 0 },
    fkLook: { x: 0, y: 0, z: 1 },
    target: { x: 0, y: 0, z: 0 },
    view: [],
    result: { turns: [], bodyYaw: 0, headYaw: 0, headPitch: 0, onTarget: false, error: 0 },
    q,
    v,
  };
}

// ─── forward kinematics along the chain ──────────────────────────────

/**
 * The chain posed with the animation's turns plus `yaw`/`pitch` at each
 * stage, then the whole body turned by `body` about the root's vertical.
 * Writes the eye and the look, bind frame, into `state.fkEye` and
 * `state.fkLook`.
 */
function poseChain(
  state: AimState,
  bind: readonly BindJoint[],
  turns: readonly JointTurn[],
  yaw: Float64Array,
  pitch: Float64Array,
  body: number,
): void {
  const { chain, chainStage, rot, pos, turnOf } = state;
  const carried = state.q[0];
  const own = state.q[1];
  const aim = state.q[2];
  const offset = state.v[0];
  for (let k = 0; k < chain.length; k += 1) {
    const j = chain[k];
    const parent = bind[j].parent;
    if (k === 0) qSet(carried, 0, 0, 0, 1);
    else qLoad(carried, rot, k - 1);
    if (k === 0) {
      pos[0] = bind[j].x;
      pos[1] = bind[j].y;
      pos[2] = bind[j].z;
    } else {
      qRotate(offset, carried, bind[j].x - bind[parent].x, bind[j].y - bind[parent].y, bind[j].z - bind[parent].z);
      pos[k * 3] = pos[(k - 1) * 3] + offset.x;
      pos[k * 3 + 1] = pos[(k - 1) * 3 + 1] + offset.y;
      pos[k * 3 + 2] = pos[(k - 1) * 3 + 2] + offset.z;
    }
    const stage = chainStage[k];
    if (stage >= 0 && (yaw[stage] !== 0 || pitch[stage] !== 0)) {
      qMul(carried, carried, qAim(aim, yaw[stage], pitch[stage]));
    }
    const t = turnOf[j];
    if (t >= 0) qMul(carried, carried, qFromTurn(own, turns[t]));
    qStore(rot, k, carried);
  }

  const last = chain.length - 1;
  qLoad(carried, rot, last);
  const e = state.eyeOffset;
  qRotate(offset, carried, e.x, e.y, e.z);
  const ex = pos[last * 3] + offset.x;
  const ey = pos[last * 3 + 1] + offset.y;
  const ez = pos[last * 3 + 2] + offset.z;
  qRotate(offset, carried, 0, 0, 1);

  // The body's yaw, about the root's vertical (bind x = z = 0), in
  // `rotation.y` sense: (x, z) → (x cos + z sin, −x sin + z cos).
  const c = Math.cos(body);
  const s = Math.sin(body);
  const eye = state.fkEye;
  eye.x = ex * c + ez * s;
  eye.y = ey;
  eye.z = -ex * s + ez * c;
  const look = state.fkLook;
  look.x = offset.x * c + offset.z * s;
  look.y = offset.y;
  look.z = -offset.x * s + offset.z * c;
}

// ─── the split ───────────────────────────────────────────────────────

/**
 * Rule 5 into `state.tryYaw`/`tryPitch`, returning the body's share.
 *
 * `headOnly`: the chest, spine and body are held where they are EASED to
 * this frame, and only what they have not delivered is split over the
 * skull and neck (rule 7).
 */
function split(state: AimState, cmdYaw: number, cmdPitch: number, bodyFree: boolean, headOnly: boolean): number {
  const tryYaw = state.tryYaw;
  const tryPitch = state.tryPitch;
  const enabled = state.stageJoint;
  let rest = cmdYaw;
  let body: number;
  if (headOnly) {
    tryYaw[CHEST] = state.yaw[CHEST];
    tryYaw[SPINE] = state.yaw[SPINE];
    body = state.body;
    rest -= tryYaw[CHEST] + tryYaw[SPINE] + body;
    // The skull by the same soft clamp as the full split; the neck takes
    // the REST outright, up to its limit. That is what makes this split
    // hand back exactly the settled head shares once the torso and body
    // have arrived — the settled neck is soft-clamped on a larger input
    // than the head alone would give it, so soft-clamping it again here
    // would leave it short of its share, and the loop crawling toward it
    // with a gain near zero. A hard limit has a corner, but only where
    // the head is asked for more than it has, mid-turn, and the easing
    // rounds it off.
    const skull = enabled[SKULL] >= 0 ? soft(rest, YAW_LIMITS[SKULL]) : 0;
    tryYaw[SKULL] = skull;
    rest -= skull;
    tryYaw[NECK] = enabled[NECK] >= 0 ? clamp(rest, -YAW_LIMITS[NECK], YAW_LIMITS[NECK]) : 0;
  } else {
    for (let s = 0; s < AIM_STAGES; s += 1) {
      const take = enabled[s] >= 0 ? soft(rest, YAW_LIMITS[s]) : 0;
      tryYaw[s] = take;
      rest -= take;
    }
    body = bodyFree ? rest : 0;
  }
  rest = cmdPitch;
  for (let s = 0; s < AIM_STAGES; s += 1) {
    const limit = rest >= 0 ? PITCH_UP_LIMITS[s] : PITCH_DOWN_LIMITS[s];
    const take = enabled[s] >= 0 ? soft(rest, limit) : 0;
    tryPitch[s] = take;
    rest -= take;
  }
  return body;
}

/**
 * The closed loop of rule 4: split the command, pose it, measure where the
 * eye looks against where the target is, feed the difference back. Leaves
 * the final split in `tryYaw`/`tryPitch` and returns its body share; the
 * command it converged on is written back to the state for a full solve,
 * so the next frame starts there.
 */
function settle(
  state: AimState,
  bind: readonly BindJoint[],
  turns: readonly JointTurn[],
  bodyFree: boolean,
  headOnly: boolean,
): number {
  let cmdYaw = state.cmdYaw;
  let cmdPitch = state.cmdPitch;
  const target = state.target;
  const eye = state.fkEye;
  const look = state.fkLook;

  // What the chain can answer to (rule 8): past these, nothing moves.
  const fixed = headOnly ? state.yaw[CHEST] + state.yaw[SPINE] + state.body : 0;
  const yawReach = headOnly
    ? (2 - SOFT_KNEE) * YAW_LIMITS[SKULL] + YAW_LIMITS[NECK]
    : reachOf(YAW_LIMITS, 0, AIM_STAGES);
  const upReach = reachOf(PITCH_UP_LIMITS, 0, AIM_STAGES);
  const downReach = reachOf(PITCH_DOWN_LIMITS, 0, AIM_STAGES);
  const yawBounded = headOnly || !bodyFree;

  for (let pass = 0; pass < SOLVE_PASSES; pass += 1) {
    const body = split(state, cmdYaw, cmdPitch, bodyFree, headOnly);
    poseChain(state, bind, turns, state.tryYaw, state.tryPitch, body);
    const dx = target.x - eye.x;
    const dy = target.y - eye.y;
    const dz = target.z - eye.z;
    const across = Math.hypot(dx, dz);
    if (across + Math.abs(dy) < AT_EYE) break;
    const lookAcross = Math.hypot(look.x, look.z);
    const errPitch = Math.atan2(dy, across) - Math.atan2(look.y, lookAcross);
    // Straight overhead there is no yaw to want; hold it rather than spin.
    const errYaw = across > AT_EYE && lookAcross > AT_EYE ? wrap(Math.atan2(dx, dz) - Math.atan2(look.x, look.z)) : 0;
    cmdYaw += errYaw;
    cmdPitch = clamp(cmdPitch + errPitch, -downReach, upReach);
    if (yawBounded) cmdYaw = clamp(cmdYaw, fixed - yawReach, fixed + yawReach);
    if (Math.abs(errYaw) + Math.abs(errPitch) < 1e-12) break;
  }
  if (!headOnly) {
    state.cmdYaw = cmdYaw;
    state.cmdPitch = cmdPitch;
  }
  return split(state, cmdYaw, cmdPitch, bodyFree, headOnly);
}

// ─── the frame ───────────────────────────────────────────────────────

/**
 * One frame of looking. `turns` is the animation's list (`poseHuman`,
 * `poseSeated`); the result carries every one of them in order plus the
 * appended aim joints (see the header), and the yaw to add to the root.
 *
 * `out` is grown to fit on the first call and reused after; the result
 * object and, when `out` is longer than needed, the view of it are held
 * on the state, so a steady frame allocates nothing.
 */
export function aimBody(
  state: AimState,
  measure: HumanMeasure,
  bind: readonly BindJoint[],
  turns: readonly JointTurn[],
  frame: AimFrame,
  out: MutableJointTurn[],
): AimResult {
  void measure; // Everything this needs from the measure was read at `createAim`; kept for the pipeline's shape.
  const n = bind.length;
  const count = turns.length;
  const turnOf = state.turnOf;
  turnOf.fill(-1);
  for (let i = 0; i < count; i += 1) {
    const joint = turns[i].joint;
    if (joint >= 0 && joint < n) turnOf[joint] = i;
  }
  let used = count;
  for (let s = 0; s < AIM_STAGES; s += 1) {
    const joint = state.stageJoint[s];
    if (joint >= 0 && turnOf[joint] < 0) used += 1;
  }
  while (out.length < used) out.push(newJointTurn());

  const dt = frame.dt > 0 ? frame.dt : 0;
  const upm = frame.unitsPerMetre > 0 ? frame.unitsPerMetre : 1;
  const weightIn = frame.weight ?? 1;
  const weight = weightIn >= 0 ? (weightIn <= 1 ? weightIn : 1) : 0;
  const cos = Math.cos(frame.rootYaw);
  const sin = Math.sin(frame.rootYaw);
  const yaw = state.yaw;
  const pitch = state.pitch;
  const aim = frame.target;

  if (aim !== null) {
    // The target in the bind frame, before the body's yaw: undo the root.
    const dx = aim.x - frame.rootX;
    const dz = aim.z - frame.rootZ;
    const target = state.target;
    target.x = (dx * cos - dz * sin) * upm;
    target.y = state.floorY + (aim.y - frame.rootY) * upm;
    target.z = (dx * sin + dz * cos) * upm;
    if (!state.hadTarget) {
      // Start the loop from where the body already looks.
      state.cmdYaw = state.body + yaw[SKULL] + yaw[NECK] + yaw[CHEST] + yaw[SPINE];
      state.cmdPitch = pitch[SKULL] + pitch[NECK] + pitch[CHEST] + pitch[SPINE];
    }
    state.shareBody = settle(state, bind, turns, frame.bodyFree, false);
    for (let s = 0; s < AIM_STAGES; s += 1) {
      state.shareYaw[s] = state.tryYaw[s];
      state.sharePitch[s] = state.tryPitch[s];
      state.goalYaw[s] = state.tryYaw[s];
      state.goalPitch[s] = state.tryPitch[s];
    }
    state.goalBody = state.shareBody;
  } else {
    for (let s = 0; s < AIM_STAGES; s += 1) {
      state.shareYaw[s] = 0;
      state.sharePitch[s] = 0;
      state.goalYaw[s] = 0;
      state.goalPitch[s] = 0;
    }
    // The nearest whole turn: a body that followed a target round does
    // not unwind the long way.
    state.shareBody = state.body - wrap(state.body);
    state.goalBody = state.shareBody;
  }
  state.hadTarget = aim !== null;

  // Rule 7: the torso and the body first, toward the settled split …
  const bodyStep = dt > 0 ? 1 - Math.exp(-dt / BODY_TAU) : 0;
  state.body += (state.goalBody - state.body) * bodyStep;
  for (let s = CHEST; s <= SPINE; s += 1) {
    const step = dt > 0 ? 1 - Math.exp(-dt / STAGE_TAUS[s]) : 0;
    yaw[s] += (state.goalYaw[s] - yaw[s]) * step;
    pitch[s] += (state.goalPitch[s] - pitch[s]) * step;
  }
  // … then the head, toward what the torso and body have not yet delivered.
  if (aim !== null) {
    settle(state, bind, turns, frame.bodyFree, true);
    for (let s = SKULL; s <= NECK; s += 1) {
      state.goalYaw[s] = state.tryYaw[s];
      state.goalPitch[s] = state.tryPitch[s];
    }
  }
  for (let s = SKULL; s <= NECK; s += 1) {
    const step = dt > 0 ? 1 - Math.exp(-dt / STAGE_TAUS[s]) : 0;
    yaw[s] += (state.goalYaw[s] - yaw[s]) * step;
    pitch[s] += (state.goalPitch[s] - pitch[s]) * step;
  }

  // The turns: the input copied, each stage composed onto its joint's
  // animated turn, the unnamed stage joints appended parent-first.
  const outYaw = state.outYaw;
  const outPitch = state.outPitch;
  for (let s = 0; s < AIM_STAGES; s += 1) {
    outYaw[s] = yaw[s] * weight;
    outPitch[s] = pitch[s] * weight;
  }
  for (let i = 0; i < count; i += 1) copyTurn(out[i], turns[i]);
  const qAimed = state.q[3];
  const qAnim = state.q[4];
  let appendAt = count;
  for (let s = SPINE; s >= SKULL; s -= 1) {
    const joint = state.stageJoint[s];
    if (joint < 0) continue;
    let at = turnOf[joint];
    if (at < 0) {
      at = appendAt;
      appendAt += 1;
      const turn = out[at];
      turn.joint = joint;
      turn.ax = 0;
      turn.ay = 1;
      turn.az = 0;
      turn.radians = 0;
    }
    if (outYaw[s] === 0 && outPitch[s] === 0) continue;
    qAim(qAimed, outYaw[s], outPitch[s]);
    qMul(qAimed, qAimed, qFromTurn(qAnim, out[at]));
    writeQuatTurn(out[at], joint, qAimed);
  }

  // The look as it is DRAWN this frame, after the weight: the raycast.
  const bodyOut = state.body * weight;
  poseChain(state, bind, turns, outYaw, outPitch, bodyOut);
  const eye = state.fkEye;
  const look = state.fkLook;
  let error = 0;
  if (aim !== null) {
    const t = state.target;
    const dx = t.x - eye.x;
    const dy = t.y - eye.y;
    const dz = t.z - eye.z;
    const cx = look.y * dz - look.z * dy;
    const cy = look.z * dx - look.x * dz;
    const cz = look.x * dy - look.y * dx;
    const dot = look.x * dx + look.y * dy + look.z * dz;
    const cross = Math.hypot(cx, cy, cz);
    error = cross + Math.abs(dot) < AT_EYE ? 0 : Math.atan2(cross, dot);
  }
  // Publish the ray in the world: through the root and its yaw.
  const ex = eye.x / upm;
  const ez = eye.z / upm;
  state.eye.x = frame.rootX + ex * cos + ez * sin;
  state.eye.y = frame.rootY + (eye.y - state.floorY) / upm;
  state.eye.z = frame.rootZ - ex * sin + ez * cos;
  state.look.x = look.x * cos + look.z * sin;
  state.look.y = look.y;
  state.look.z = -look.x * sin + look.z * cos;

  const result = state.result;
  result.turns = usedPrefix(state, out, used);
  result.bodyYaw = bodyOut;
  result.headYaw = outYaw[SKULL] + outYaw[NECK] + outYaw[CHEST] + outYaw[SPINE];
  result.headPitch = outPitch[SKULL] + outPitch[NECK] + outPitch[CHEST] + outPitch[SPINE];
  result.error = error;
  result.onTarget = aim !== null && error <= ON_TARGET;
  return result;
}

/**
 * The turns written, as an array exactly `used` long: `out` itself when
 * it is that long, otherwise a view held on the state and only re-pointed
 * when it has to be — the same device `humanPose` and `humanFeet` use.
 */
function usedPrefix(state: AimState, out: MutableJointTurn[], used: number): readonly JointTurn[] {
  if (out.length === used) return out;
  const view = state.view;
  if (view.length !== used) view.length = used;
  for (let i = 0; i < used; i += 1) {
    if (view[i] !== out[i]) view[i] = out[i];
  }
  return view;
}
