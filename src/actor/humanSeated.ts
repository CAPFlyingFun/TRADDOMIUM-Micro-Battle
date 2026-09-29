/**
 * JACK OR SARAH IN A CHAIR — the seated poses `humanPose.ts` does not
 * have. That file is a body on its feet (stand, walk, run); a person at a
 * desk is a different skeleton shape, not a different gait, so it is a
 * different function rather than a fourth stance threaded through the
 * gait tables.
 *
 * The convention is `humanPose.ts`'s, unchanged, and its header is the
 * reference: every turn is an axis and an angle IN THE BIND POSE'S WORLD
 * FRAME, applied there first and then carried by the joint's parents, so
 * a knee is bent as if the thigh were still hanging and the hip's turn
 * carries it forward. The four sign rules, repeated because every number
 * below comes from them:
 *
 *   a bone along +Y (spine, chest, neck, head): Rx(+θ) tips its top
 *     FORWARD; Rz(+θ) tips its top toward −X.
 *   a bone along −Y (thigh, shin):  Rx(+θ) swings its end BACKWARD.
 *   a bone along +X (an arm):       Rz(+θ) lifts it; Ry(+θ) swings it back.
 *   a bone along −X (the other arm): Rz(+θ) brings it down; Ry(+θ)
 *     swings it forward.
 *   a HANGING arm (after it is brought down): Rx(−θ) swings it forward.
 *
 * `measure.leftSign` says which way the body's left lies, so nothing here
 * is hardcoded to a side and a mirrored re-export sits down correctly.
 *
 * ─── the chair does the rest ───────────────────────────────────────
 *
 * A pose bends joints; it does not move the body. The pelvis is not
 * turned (the legs hang off it, as `humanPose.ts` explains) and the hips
 * stay where the bind put them, so seating a body is two things: this
 * pose, and the owner lowering the whole model until the hips are a
 * thigh's half-thickness above the seat. `seatedHips` answers the second
 * without three: the hips are where they are in the bind.
 *
 * ─── the two seated poses Chapter 1 opens with ─────────────────────
 *
 *   `doze` — "Jack sat slumped in his chair with his arms folded across
 *            his chest, his head tilted toward one shoulder ... His eyes
 *            were closed." Slumped back, arms folded, the head dropped
 *            and rolled toward a shoulder, breathing slowly.
 *   `sit`  — upright at a desk, forearms forward over the lap.
 *
 * Pure: no three, no DOM. Deterministic in (measure, bind, pose, seconds).
 */
import type { BindJoint, HumanMeasure, JointTurn, MutableJointTurn } from './humanRig';
import { newJointTurn } from './humanRig';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export type SeatedStyle = 'doze' | 'sit';

export interface SeatedPose {
  readonly style: SeatedStyle;
  /** Which shoulder the dozing head rolls toward: +1 the body's right, −1 its left. */
  readonly headSide?: number;
  /** A free-running clock in seconds, for the breath. */
  readonly seconds: number;
}

/** Every seated pose writes these sixteen joints, parent before child, every frame. */
export const SEATED_TURNS = 16;

/**
 * Where the thigh and the shin end up, as angles from hanging straight
 * down (+ is forward). A task chair's seat is level, so the thigh is,
 * give or take; the shin hangs a little forward of the knee.
 *
 * These are TARGETS, not joint angles: neither master's leg hangs
 * plumb in the bind (Jack's thigh leans back 4.9° and his shin 6.5°), so
 * the flexion that reaches them is worked out from each body's own bones.
 */
const THIGH_TARGET = 88 * DEG;
const SHIN_TARGET = 8 * DEG;
/** Knees a little apart, the way a person sits. */
const THIGH_SPREAD = 7 * DEG;

interface Style {
  /** Spine: + tips forward. A doze slumps BACK into the chair. */
  readonly spine: number;
  readonly chest: number;
  /** Neck and head: + drops the chin. */
  readonly neck: number;
  readonly head: number;
  /** Neck and head roll toward the chosen shoulder. */
  readonly roll: number;
  /** Upper arm down from the T, swung forward, and twisted inward about its own length. */
  readonly armDown: number;
  readonly armForward: number;
  readonly armTwist: number;
  readonly elbow: number;
  readonly wrist: number;
  /** Breath rise at the chest, radians, and its rate in Hz. */
  readonly breath: number;
  readonly breathHz: number;
}

const STYLES: Readonly<Record<SeatedStyle, Style>> = {
  // Arms folded: upper arms down and a little forward, twisted in so the
  // bent forearms cross in front of the chest rather than pointing ahead.
  doze: {
    spine: -9 * DEG, chest: 5 * DEG, neck: 16 * DEG, head: 10 * DEG, roll: 16 * DEG,
    armDown: 74 * DEG, armForward: 34 * DEG, armTwist: 62 * DEG, elbow: 112 * DEG, wrist: 6 * DEG,
    breath: 1.6 * DEG, breathHz: 0.2,
  },
  // At the desk: upper arms down and forward, forearms out over the lap.
  sit: {
    spine: 2 * DEG, chest: 2 * DEG, neck: 4 * DEG, head: 2 * DEG, roll: 0,
    armDown: 80 * DEG, armForward: 24 * DEG, armTwist: 25 * DEG, elbow: 70 * DEG, wrist: 4 * DEG,
    breath: 1.0 * DEG, breathHz: 0.25,
  },
};

// ------------------------------------------------------------ quaternions
// [x, y, z, w]. Small and local: a core module cannot reach for three's.

type Q = [number, number, number, number];
const qAxis = (ax: number, ay: number, az: number, a: number): Q => {
  const s = Math.sin(a / 2);
  return [ax * s, ay * s, az * s, Math.cos(a / 2)];
};
const qMul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const rx = (a: number): Q => qAxis(1, 0, 0, a);
const ry = (a: number): Q => qAxis(0, 1, 0, a);
const rz = (a: number): Q => qAxis(0, 0, 1, a);

/** Rotate v by q. */
export function rotate(q: Q, v: readonly [number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

function write(out: MutableJointTurn, joint: number, q: Q): void {
  // q -> axis-angle, with the angle in [0, π] and a well-defined axis at zero
  let [x, y, z, w] = q;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.hypot(x, y, z);
  out.joint = joint;
  if (s < 1e-9) { out.ax = 0; out.ay = 1; out.az = 0; out.radians = 0; return; }
  out.ax = x / s; out.ay = y / s; out.az = z / s;
  out.radians = 2 * Math.atan2(s, w);
}

/**
 * One frame of a seated body. Writes into `out` (grown to SEATED_TURNS
 * as needed) and returns the used prefix.
 */
export function poseSeated(
  measure: HumanMeasure,
  bind: readonly BindJoint[],
  pose: SeatedPose,
  out: MutableJointTurn[],
): readonly JointTurn[] {
  while (out.length < SEATED_TURNS) out.push(newJointTurn());
  const j = measure.joints;
  const L = measure.leftSign < 0 ? -1 : 1;
  const st = STYLES[pose.style];
  const breath = Math.sin(pose.seconds * TAU * st.breathHz) * st.breath;
  // The body's right lies toward −L·X, and Rz(+θ) tips a +Y bone toward −X,
  // so a roll toward the right shoulder is Rz(+L·θ).
  const side = (pose.headSide ?? 1) < 0 ? -1 : 1;
  const roll = side * L * st.roll;

  write(out[0], j.spine, rx(st.spine));
  write(out[1], j.chest, rx(st.chest - breath));
  write(out[2], j.neck, qMul(rz(roll * 0.6), rx(st.neck + breath * 0.5)));
  write(out[3], j.head, qMul(rz(roll * 0.4), rx(st.head)));

  // Arms. `s` is the direction the arm runs in the bind: +1 along +X.
  const arm = (i: number, shoulder: number, elbow: number, wrist: number, s: number) => {
    // Read right to left: twist about its own length, bring it down, then
    // pitch the lowered arm forward. The pitch is about X, not Y: `Ry`
    // swings a HORIZONTAL arm fore and aft, but by then the arm hangs, and
    // turning a hanging arm about the vertical only spins it in place.
    write(out[i], shoulder, qMul(rx(-st.armForward), qMul(rz(-s * st.armDown), rx(st.armTwist))));
    write(out[i + 1], elbow, ry(-s * st.elbow));
    write(out[i + 2], wrist, rz(-s * st.wrist));
  };
  arm(4, j.shoulderL, j.elbowL, j.wristL, L);
  arm(7, j.shoulderR, j.elbowR, j.wristR, -L);

  // Legs: thigh forward to level and yawed a little out, shin back down,
  // foot back to flat. A bone's bind lean is measured as the angle it
  // hangs BACK from plumb in the y-z plane, which is the sense Rx(+θ)
  // swings it; the flexions are what take each bone from there to its
  // target, and the ankle undoes whatever the two left the foot tilted by.
  const lean = (a: number, b: number) => Math.atan2(-(bind[b].z - bind[a].z), -(bind[b].y - bind[a].y));
  const leg = (i: number, hip: number, knee: number, ankle: number, out_: number) => {
    const hipFlex = THIGH_TARGET + lean(hip, knee);
    const kneeFlex = hipFlex - SHIN_TARGET - lean(knee, ankle);
    write(out[i], hip, qMul(ry(out_ * THIGH_SPREAD), rx(-hipFlex)));
    write(out[i + 1], knee, rx(kneeFlex));
    write(out[i + 2], ankle, rx(hipFlex - kneeFlex));
  };
  leg(10, j.hipL, j.kneeL, j.ankleL, L);
  leg(13, j.hipR, j.kneeR, j.ankleR, -L);

  if (out.length !== SEATED_TURNS) out.length = SEATED_TURNS;
  return out;
}

/**
 * Every joint's posed position, in the bind file's own units — forward
 * kinematics with the same rule the renderer applies (a turn is applied
 * in the bind frame, then carried by the parents). For placing a body in
 * a chair without three, and for tests that want to know where a hand
 * ended up.
 */
export function posedJoints(bind: readonly BindJoint[], turns: readonly JointTurn[]): Array<[number, number, number]> {
  const own: Q[] = bind.map(() => [0, 0, 0, 1] as Q);
  for (const t of turns) if (t.joint >= 0 && t.joint < bind.length) own[t.joint] = qAxis(t.ax, t.ay, t.az, t.radians);
  const acc: Q[] = new Array(bind.length);
  const pos: Array<[number, number, number]> = new Array(bind.length);
  const done = new Uint8Array(bind.length);
  const visit = (i: number): void => {
    if (done[i]) return;
    const p = bind[i].parent;
    if (p < 0) {
      acc[i] = own[i];
      pos[i] = [bind[i].x, bind[i].y, bind[i].z];
    } else {
      visit(p);
      acc[i] = qMul(acc[p], own[i]);
      const off = rotate(acc[p], [bind[i].x - bind[p].x, bind[i].y - bind[p].y, bind[i].z - bind[p].z]);
      pos[i] = [pos[p][0] + off[0], pos[p][1] + off[1], pos[p][2] + off[2]];
    }
    done[i] = 1;
  };
  for (let i = 0; i < bind.length; i += 1) visit(i);
  return pos;
}

/**
 * Where the hips are, midway between the two, in bind units. A pose does
 * not move them (nothing above the hips is turned), so the owner seats a
 * body by putting this point a thigh's half-thickness above the seat.
 */
export function seatedHips(measure: HumanMeasure, bind: readonly BindJoint[]): [number, number, number] {
  const a = bind[measure.joints.hipL], b = bind[measure.joints.hipR];
  return [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
}
