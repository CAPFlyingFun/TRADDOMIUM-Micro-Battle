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
  /**
   * What the dozing arms do. `fold` (the default) is Jack's, arms folded
   * across the chest. `cradle` rests the hands on the sides of a pregnant
   * belly instead: folded forearms press straight into a bump and dent it
   * (Joshua, 2026-10-07, of Sarah: "her hands and arms need to be
   * differently as it changes the belly and doesn't look good"). The
   * skeleton cannot see a belly, so the owner says which, from what it
   * knows of the person.
   */
  readonly arms?: 'fold' | 'cradle';
  /**
   * `pregnant`: a sitting posture for a body carrying late in a pregnancy
   * (Joshua, 2026-10-07, of Sarah at 32 weeks: "torso relatively upright,
   * slightly more open hip angle, knees/feet positioned naturally, enough
   * thigh-to-belly clearance, subtle lumbar/postural adjustment, arms resting
   * naturally"). Applies to `sit`; a doze keeps its own slump.
   */
  readonly posture?: 'pregnant';
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

/**
 * One arm: down from the T, pitched forward, twisted in about its own
 * length, bent at the elbow, and the hand bent at the wrist — `wristBend`
 * the way the elbow bends, `wristTilt` about the forward axis. Folded, the
 * hands wrap back round the other arm instead of sticking out past the body.
 */
interface ArmSpec {
  readonly down: number;
  readonly forward: number;
  readonly twist: number;
  readonly elbow: number;
  readonly wristBend: number;
  readonly wristTilt: number;
  /** The forearm rolled about its own length before the elbow bends (+ turns the palm down). */
  readonly pronate?: number;
}

interface Style {
  /** Spine: + tips forward. A doze slumps BACK into the chair. */
  readonly spine: number;
  readonly chest: number;
  /** Neck and head: + drops the chin. */
  readonly neck: number;
  readonly head: number;
  /** Neck and head roll toward the chosen shoulder. */
  readonly roll: number;
  /**
   * The two arms. Folded arms are not a mirror image: one forearm lies OVER
   * the other, further forward and a little higher, and each hand reaches
   * past the middle toward the other elbow. A symmetric fold puts both
   * forearms at the same height and they pass through each other
   * (Joshua, 2026-09-29: "Jack's hands cross through each other").
   */
  readonly over: ArmSpec;
  readonly under: ArmSpec;
  /** Breath rise at the chest, radians, and its rate in Hz. */
  readonly breath: number;
  readonly breathHz: number;
}

const STYLES: Readonly<Record<SeatedStyle, Style>> = {
  // Arms folded across the chest: the upper arms hang a little forward, the
  // forearms turn in across the body, the OVER one in front of the UNDER.
  doze: {
    spine: -9 * DEG, chest: 5 * DEG, neck: 26 * DEG, head: 18 * DEG, roll: 20 * DEG,
    // Found by search against both real skeletons (tests/humanSeated.test.ts
    // pins the result): the elbows at the sides (never past hanging, which
    // drives the upper arm into the chest), the forearms stacked across the
    // stomach with their centre lines a forearm's thickness apart, the right
    // over the left, 6 cm in front of it and 7-9 cm higher, the hands level.
    over: { down: 88 * DEG, forward: 45 * DEG, twist: 81 * DEG, elbow: 85 * DEG, wristBend: 11 * DEG, wristTilt: 9 * DEG },
    under: { down: 88 * DEG, forward: 26 * DEG, twist: 83 * DEG, elbow: 81 * DEG, wristBend: 12 * DEG, wristTilt: -5 * DEG },
    breath: 1.6 * DEG, breathHz: 0.2,
  },
  // At the desk: upper arms down and forward, forearms out over the lap.
  sit: {
    spine: 2 * DEG, chest: 2 * DEG, neck: 4 * DEG, head: 2 * DEG, roll: 0,
    over: { down: 80 * DEG, forward: 24 * DEG, twist: 25 * DEG, elbow: 70 * DEG, wristBend: 0, wristTilt: 4 * DEG },
    under: { down: 80 * DEG, forward: 24 * DEG, twist: 25 * DEG, elbow: 70 * DEG, wristBend: 0, wristTilt: 4 * DEG },
    breath: 1.0 * DEG, breathHz: 0.25,
  },
};

/**
 * A dozing pregnant body's arms: the upper arms hang by her sides, a little
 * forward and a little out, the elbows bend, and the hands cup the underside
 * of the bump from either side, fingertips meeting below the navel. Nothing
 * crosses the front of the belly, so nothing presses into it. GAME TUNING,
 * chosen from three sweeps of four variants rendered front and side on the
 * toon Sarah (2026-10-07): more forward and the hands float in front of the
 * bump; less, or a deeper elbow, and they sink into its underside.
 */
const CRADLE: { readonly over: ArmSpec; readonly under: ArmSpec } = {
  over: { down: 74 * DEG, forward: 18 * DEG, twist: 60 * DEG, elbow: 48 * DEG, wristBend: 35 * DEG, wristTilt: 0 },
  under: { down: 74 * DEG, forward: 18 * DEG, twist: 60 * DEG, elbow: 48 * DEG, wristBend: 35 * DEG, wristTilt: 0 },
};

/**
 * WHERE A DOZING HEAD ENDS UP, as the forward pitch of the neck-to-crown line
 * from upright. The style's neck and head angles are TURNS, and a turn lands
 * wherever the bind started: Jack's toon head already leans 15° forward in
 * the bind and Sarah's leans 8° back, so the same doze dropped his chin to
 * 38° and hers only to 16° — he slept and she looked down at her hands
 * (Joshua, 2026-10-07: "Sarah doesn't sleep like Jack"). So the doze aims at
 * the PITCH Jack's approved doze reaches and the neck makes up the difference
 * on each body, the way the legs reach their targets from each body's own lean.
 */
const DOZE_HEAD_PITCH = 38 * DEG;
/** Per skeleton, the neck correction that lands the doze on DOZE_HEAD_PITCH. */
const dozeNeckFix = new WeakMap<readonly BindJoint[], number>();

/**
 * The pregnant sit (`posture: 'pregnant'`). Every number is a small move from
 * the plain sit, and GAME TUNING checked against front and side renders of the
 * toon Sarah:
 *   - the thighs a little below level (80° rather than 88° from hanging), which
 *     opens the hip and lowers the thigh away from the underside of the bump;
 *   - the knees further apart (13° each rather than 7°), which is how a late
 *     pregnancy sits and what gives the bump room between the thighs;
 *   - the spine upright with a slight lean back into the chair (−3°) and the
 *     chest open, rather than tipped forward over a desk;
 *   - the arms relaxed: upper arms hanging a little forward, forearms sloping
 *     down to the thighs and turned palm-down (`pronate`), so the hands rest
 *     on the thighs outside the bump — not cradling it, which a scene asks for
 *     when it wants it. They are clear of the bump because that is how she
 *     sits, not to hide it: the bump is round seated because of its weights
 *     (`scripts/protectBumpWeights.mjs`), and is checked with the arms away.
 */
const PREGNANT_SIT = {
  thigh: 80 * DEG, spread: 13 * DEG, spine: -3 * DEG, chest: -1 * DEG,
  arm: { down: 82 * DEG, forward: 28 * DEG, twist: 0, elbow: 24 * DEG, wristBend: -20 * DEG, wristTilt: 0, pronate: 170 * DEG } as ArmSpec,
};

// ------------------------------------------------------------ the palms

/**
 * WHICH WAY THIS RIG'S PALMS FACE IN ITS T, as a turn about world X from facing
 * forward (+Z) — the way the toon masters' do, which every arm above was tuned on.
 * Joshua, 2026-10-08, on the base Sarah sitting: "the palms and hands are facing
 * outwards, not inwards like normal". Her mannequin was rigged palms DOWN, a quarter
 * turn from the toons, so the same 170° `pronate` that lays a toon's hand on her thigh
 * turned the mannequin's palm out to the side. Read from the skeleton, never from a
 * name: under the wrist, the first joint with four or more branches is the hand; the
 * branch furthest from the others is the thumb; the palm faces along (wrist to
 * knuckles) × (little finger to index), signed by the side. A rig with no fingers
 * reads 0 and keeps the tuned arm exactly.
 */
const palmRolls = new WeakMap<readonly BindJoint[], Map<number, number>>();
export function bindPalmRoll(bind: readonly BindJoint[], wrist: number): number {
  let known = palmRolls.get(bind);
  if (!known) palmRolls.set(bind, (known = new Map()));
  const hit = known.get(wrist);
  if (hit !== undefined) return hit;
  const kids: number[][] = bind.map(() => []);
  bind.forEach((b, i) => { if (b.parent >= 0) kids[b.parent].push(i); });
  let hand = -1;
  const queue = [wrist];
  while (queue.length) { const j = queue.shift()!; if (kids[j].length >= 4) { hand = j; break; } queue.push(...kids[j]); }
  let roll = 0;
  if (hand >= 0) {
    // each finger's SECOND joint: a rig whose fingers were added at bake time starts
    // every chain at nearly the same point, where no finger can be told from another
    const bases = kids[hand].map((k) => { const b = bind[kids[k][0] ?? k]; return [b.x, b.y, b.z]; });
    const c = [0, 1, 2].map((a) => bases.reduce((t, b) => t + b[a], 0) / bases.length);
    const dist = (b: number[], o: number[]) => Math.hypot(b[0] - o[0], b[1] - o[1], b[2] - o[2]);
    const thumb = bases.reduce((best, b, i) => (dist(b, c) > dist(bases[best], c) ? i : best), 0);
    const rest = bases.filter((_, i) => i !== thumb).sort((a, b) => dist(a, bases[thumb]) - dist(b, bases[thumb]));
    if (rest.length >= 2) {
      const index = rest[0], pinky = rest[rest.length - 1];
      const w = bind[wrist];
      const along = [c[0] - w.x, c[1] - w.y, c[2] - w.z];
      const across = [index[0] - pinky[0], index[1] - pinky[1], index[2] - pinky[2]];
      const side = Math.sign(w.x) || 1;
      const palm = [
        (along[1] * across[2] - along[2] * across[1]) * side,
        (along[2] * across[0] - along[0] * across[2]) * side,
        (along[0] * across[1] - along[1] * across[0]) * side,
      ];
      // the signed angle about +X from +Z to the palm, in the y-z plane
      if (Math.hypot(palm[1], palm[2]) > 1e-9) roll = Math.atan2(-palm[1], palm[2]);
    }
  }
  known.set(wrist, roll);
  return roll;
}

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

  let neckFix = 0;
  if (pose.style === 'doze') {
    const known = dozeNeckFix.get(bind);
    if (known === undefined) {
      // One pass with no correction, measure where the head went, and keep
      // the difference: the pitch is close to linear in the neck's turn
      // over these angles, so one correction lands it.
      const probe: MutableJointTurn[] = [];
      for (let k = 0; k < 4; k += 1) probe.push(newJointTurn());
      write(probe[0], j.spine, rx(st.spine));
      write(probe[1], j.chest, rx(st.chest));
      write(probe[2], j.neck, rx(st.neck));
      write(probe[3], j.head, rx(st.head));
      const P = posedJoints(bind, probe);
      const pitch = Math.atan2(P[j.head][2] - P[j.neck][2], P[j.head][1] - P[j.neck][1]);
      neckFix = DOZE_HEAD_PITCH - pitch;
      dozeNeckFix.set(bind, neckFix);
    } else {
      neckFix = known;
    }
  }

  const pregnant = pose.style === 'sit' && pose.posture === 'pregnant';
  write(out[0], j.spine, rx(pregnant ? PREGNANT_SIT.spine : st.spine));
  write(out[1], j.chest, rx((pregnant ? PREGNANT_SIT.chest : st.chest) - breath));
  write(out[2], j.neck, qMul(rz(roll * 0.6), rx(st.neck + neckFix + breath * 0.5)));
  write(out[3], j.head, qMul(rz(roll * 0.4), rx(st.head)));

  // Arms. `s` is the direction the arm runs in the bind: +1 along +X.
  const arm = (i: number, shoulder: number, elbow: number, wrist: number, s: number, a: ArmSpec) => {
    // the pregnant sit was tuned on the toon Sarah, palms forward in her T: a rig whose
    // palms face elsewhere is turned back by the difference (bindPalmRoll). The other
    // arms were tuned on each rig as it is, Jack's palms-down included, and keep them.
    const fix = a === PREGNANT_SIT.arm ? bindPalmRoll(bind, wrist) : 0;
    // Read right to left: twist about its own length, bring it down, then
    // pitch the lowered arm forward. The pitch is about X, not Y: `Ry`
    // swings a HORIZONTAL arm fore and aft, but by then the arm hangs, and
    // turning a hanging arm about the vertical only spins it in place.
    // `pronate` turns the palm down. A forearm has no twist bone in these
    // rigs, so the whole roll at the elbow would wring its skin like a
    // towel; half is taken at the shoulder instead, with the elbow's hinge
    // turned back by the same amount so the bend still points forward —
    // the elbow joint itself then only bends.
    const roll = ((a.pronate ?? 0) - fix) / 2;
    write(out[i], shoulder, qMul(rx(-a.forward), qMul(rz(-s * a.down), rx(a.twist + roll))));
    write(out[i + 1], elbow, roll ? qMul(rx(-roll), qMul(ry(-s * a.elbow), rx(2 * roll))) : ry(-s * a.elbow));
    write(out[i + 2], wrist, qMul(ry(-s * a.wristBend), rz(-s * a.wristTilt)));
  };
  // The right forearm over the left, the commoner fold (and either reads).
  const arms = pose.style === 'doze' && pose.arms === 'cradle' ? CRADLE
    : pregnant ? { over: PREGNANT_SIT.arm, under: PREGNANT_SIT.arm } : st;
  arm(4, j.shoulderL, j.elbowL, j.wristL, L, arms.under);
  arm(7, j.shoulderR, j.elbowR, j.wristR, -L, arms.over);

  // Legs: thigh forward to level and yawed a little out, shin back down,
  // foot back to flat. A bone's bind lean is measured as the angle it
  // hangs BACK from plumb in the y-z plane, which is the sense Rx(+θ)
  // swings it; the flexions are what take each bone from there to its
  // target, and the ankle undoes whatever the two left the foot tilted by.
  const lean = (a: number, b: number) => Math.atan2(-(bind[b].z - bind[a].z), -(bind[b].y - bind[a].y));
  const thighTarget = pregnant ? PREGNANT_SIT.thigh : THIGH_TARGET;
  const spread = pregnant ? PREGNANT_SIT.spread : THIGH_SPREAD;
  const leg = (i: number, hip: number, knee: number, ankle: number, out_: number) => {
    const hipFlex = thighTarget + lean(hip, knee);
    const kneeFlex = hipFlex - SHIN_TARGET - lean(knee, ankle);
    write(out[i], hip, qMul(ry(out_ * spread), rx(-hipFlex)));
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
