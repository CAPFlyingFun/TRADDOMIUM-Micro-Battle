/**
 * HER BIRTH POSITIONS (Joshua, 2026-10-30: "she should naturally have her legs open apart to give the most room for
 * birthing"; of standing, squatting or semi-reclined, "all three options... regarding the recline, can lean backwards on
 * an invisible object for now"). Three ways a woman gives birth, each with her legs open:
 *
 *   `apart`   — standing, feet wide, knees a little bent, leaning slightly forward over them;
 *   `squat`   — down on her heels, knees wide round her belly, leaning forward, looking ahead;
 *   `recline` — leaning back on something behind her, thighs up and wide, knees bent, as on a bed.
 *
 * The convention is `humanPose.ts`'s and `humanSeated.ts`'s, unchanged: every turn an axis and an angle IN THE BIND
 * POSE'S WORLD FRAME, applied there and carried by the joint's parents (a thigh along −Y: Rx(+θ) swings its end
 * BACK, Rz(+θ) toward +X; a spine bone along +Y: Rx(+θ) tips its top FORWARD). A pose bends joints and never moves
 * the body: the owner puts her feet on the floor (`apart`, `squat`) or leans her back onto her support by
 * `BIRTH_POSES.recline.leanBack` about her hips (`recline`), and keeps whatever arms it gives her standing.
 *
 * The thighs open with her belly (`spreadPerBump`): the bigger it is, the wider they go round it.
 *
 * Pure: no three, no DOM. Deterministic in (measure, bind, pose, seconds).
 */
import type { BindJoint, HumanMeasure, JointTurn, MutableJointTurn } from './humanRig';
import { newJointTurn } from './humanRig';

const DEG = Math.PI / 180;

export type BirthStyle = 'apart' | 'squat' | 'recline';
export const BIRTH_STYLES: readonly BirthStyle[] = Object.freeze(['apart', 'squat', 'recline']);

export interface BirthPose {
  readonly style: BirthStyle;
  /** A free-running clock in seconds, for her breath. */
  readonly seconds: number;
  /** Her belly against full term (1 at 100%): her thighs open wider round a bigger one. */
  readonly bump: number;
  /** A tester's change to the position's angles (the room's probes step the hip bend to find where her skin fails). */
  readonly tweak?: Partial<BirthSpec>;
}

export interface BirthSpec {
  /** how far each thigh swings out to her side (degrees), and how much more for each full-term belly */
  readonly spread: number; readonly spreadPerBump: number;
  /** how far each thigh comes forward from hanging (degrees), and each knee bends (degrees) */
  readonly flex: number; readonly knee: number;
  /** how far each foot turns out (degrees); whether it stays flat on the floor (else it follows the shin) */
  readonly turnOut: number; readonly footFlat: boolean;
  /** her back and chest tipped forward (degrees, negative back), her neck (forward) */
  readonly spine: number; readonly chest: number; readonly neck: number;
  /** her whole body leaned back about her hips onto what holds her up (degrees; the owner turns her) */
  readonly leanBack: number;
  /**
   * the thigh brought forward FIRST and then swung out about the vertical by `spread` (a deep squat: knees out wide and
   * up, each shin hanging down to its foot under the knee -- Joshua's references, 2026-10-31), rather than opened to the
   * side while it hangs and then brought forward (absent: false)
   */
  readonly swing?: boolean;
  /** (a test) only her left leg posed, her right hanging as standing (Joshua, 2026-11-01: "try lifting one leg vs both") */
  readonly oneLeg?: boolean;
}

/**
 * The three positions. GAME TUNING (the angles of each, from how women are shown giving birth in each; the thighs opened
 * wider on 2026-10-30, Joshua: in his references the area lies open between them).
 */
export const BIRTH_POSES: Readonly<Record<BirthStyle, BirthSpec>> = Object.freeze({
  apart: { spread: 18, spreadPerBump: 6, flex: 16, knee: 30, turnOut: 18, footFlat: true, spine: 6, chest: 2, neck: -4, leanBack: 0 },
  // (a deep squat as Joshua's references show it, 2026-10-31: low, knees wide and above her hips, shins down to her
  // feet under them, her back upright)
  // (a deeper one -- spread 70, flex 125, knee 150 -- was tried on 2026-11-02 and Joshua preferred these: "before was
  // closer, now it got shifted" round the knee)
  // (the knee held to 112 degrees and the thighs opened 12 degrees wider to make up for it -- Joshua, 2026-11-02: "limit
  // 112°... and widen how far apart the legs are at the hip joints". Past about 110 degrees the front of her knee folded
  // into a lip and from about 100 her calf sank into her thigh, up to 5 cm at 140: a squat sweep, birthContact.ts)
  squat: { spread: 62, spreadPerBump: 6, flex: 118, knee: 112, turnOut: 30, footFlat: true, spine: 4, chest: 2, neck: -6, leanBack: 0, swing: true },
  // (as a bed birth is (Joshua chose it, 2026-11-03, of three side by side): her back raised about 35 degrees off the bed
  // -- the semi-reclined position births are usually given in, not flat on her back -- her thighs drawn up first, about
  // 90 degrees, then let fall open, about 50 each way, her knees bent about 95. It had her thighs swung 80 degrees out to
  // her sides first and brought forward only 50, leaning back 40: flung sideways, not drawn up)
  recline: { spread: 46, spreadPerBump: 4, flex: 90, knee: 95, turnOut: 12, footFlat: false, spine: -2, chest: 10, neck: 26, leanBack: 55, swing: true },
});

/** How many turns `poseBirth` writes. */
export const BIRTH_TURNS = 10;
/** Her breath, as a standing body's: so much of a degree at the chest, so often (Hz). */
const BREATH = 0.6 * DEG, BREATH_HZ = 0.25;

type Q = [number, number, number, number];
const qAxis = (ax: number, ay: number, az: number, a: number): Q => { const s = Math.sin(a / 2); return [ax * s, ay * s, az * s, Math.cos(a / 2)]; };
const qMul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qConj = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]];
const rx = (a: number): Q => qAxis(1, 0, 0, a);
const ry = (a: number): Q => qAxis(0, 1, 0, a);
const rz = (a: number): Q => qAxis(0, 0, 1, a);
function write(out: MutableJointTurn, joint: number, q: Q): void {
  let [x, y, z, w] = q;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.hypot(x, y, z);
  out.joint = joint;
  if (s < 1e-9) { out.ax = 0; out.ay = 1; out.az = 0; out.radians = 0; return; }
  out.ax = x / s; out.ay = y / s; out.az = z / s; out.radians = 2 * Math.atan2(s, w);
}

/** How wide her thighs open for a belly (degrees from hanging, each side). */
export function birthSpread(style: BirthStyle, bump: number): number {
  const s = BIRTH_POSES[style];
  return s.spread + s.spreadPerBump * Math.min(2, Math.max(0, Number.isFinite(bump) ? bump : 1));
}

/**
 * One frame of a birth position: her back, chest and neck, and each leg (hip, knee, ankle). Writes into `out` (grown
 * to BIRTH_TURNS) and returns it. Her arms are not here: the owner keeps her standing ones.
 *
 * A leg is read right to left: opened to her side while it hangs, then brought forward -- so a thigh raised to the
 * level still points out round her belly -- its knee bent in the leg's own plane (the hip's turn carries it), and the
 * foot turned back flat to the floor (everything above it undone) and out a little, or left to follow the shin.
 */
export function poseBirth(measure: HumanMeasure, bind: readonly BindJoint[], pose: BirthPose, out: MutableJointTurn[]): readonly JointTurn[] {
  while (out.length < BIRTH_TURNS) out.push(newJointTurn());
  const j = measure.joints, L = measure.leftSign < 0 ? -1 : 1, s: BirthSpec = pose.tweak ? { ...BIRTH_POSES[pose.style], ...pose.tweak } : BIRTH_POSES[pose.style];
  const breath = Math.sin(pose.seconds * 2 * Math.PI * BREATH_HZ) * BREATH;
  write(out[0], j.spine, rx(s.spine * DEG));
  write(out[1], j.chest, rx(s.chest * DEG - breath));
  write(out[2], j.neck, rx(s.neck * DEG + breath * 0.5));
  write(out[3], j.head, rx(0));
  const spread = (pose.tweak?.spread !== undefined ? s.spread + s.spreadPerBump * Math.min(2, Math.max(0, pose.bump)) : birthSpread(pose.style, pose.bump)) * DEG;
  // a bone's own lean in the bind (how far it hangs back from plumb, the sense Rx(+θ) swings it): the flex is from there
  const lean = (a: number, b: number) => Math.atan2(-(bind[b].z - bind[a].z), -(bind[b].y - bind[a].y));
  const leg = (i: number, hip: number, knee: number, ankle: number, side: number) => {
    const flex = s.flex * DEG + lean(hip, knee), bend = s.knee * DEG + lean(knee, ankle) - lean(hip, knee);
    const hipQ = s.swing ? qMul(ry(side * spread), rx(-flex)) : qMul(rx(-flex), rz(side * spread)), kneeQ = rx(bend);
    write(out[i], hip, hipQ);
    write(out[i + 1], knee, kneeQ);
    // flat: everything above it undone, then turned out about the vertical; else it follows the shin, a little pointed
    write(out[i + 2], ankle, s.footFlat ? qMul(qConj(qMul(hipQ, kneeQ)), ry(side * s.turnOut * DEG)) : rx(-10 * DEG));
  };
  leg(4, j.hipL, j.kneeL, j.ankleL, L);
  if (s.oneLeg) { write(out[7], j.hipR, rx(0)); write(out[8], j.kneeR, rx(0)); write(out[9], j.ankleR, rx(0)); }
  else leg(7, j.hipR, j.kneeR, j.ankleR, -L);
  if (out.length !== BIRTH_TURNS) out.length = BIRTH_TURNS;
  return out;
}
