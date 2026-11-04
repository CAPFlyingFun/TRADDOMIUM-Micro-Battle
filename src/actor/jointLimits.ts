/**
 * HOW FAR A HUMAN JOINT GOES, HELD (Joshua, 2026-11-04: "set up realistic max and min angles for each part of the body
 * with a bone... which will work for all human characters as one master stat"; "are other body joints also in there
 * like head and neck movements so they can't turn their head like an owl?").
 *
 * A pose's turns (`humanRig.JointTurn`: each joint's turn from its parent, in the bind pose's world frame) read as the
 * motions a clinician measures -- flexion and extension, a sideways bend or a swing out and in, and a rotation -- about
 * the BODY's own axes taken from its bind: up its spine, across its hips, and forward the way its toes point. Each
 * motion's angle can be READ (for a probe, a test, a report of a pose against the table) and HELD within the range given
 * for it.
 *
 * The ranges are not here. `actor/` may not read `data/` (ARCHITECTURE: actor → world, input only), so whoever builds
 * the limits passes them in -- `data/jointRange.ts`'s `rangeDeg` for a woman or for a man -- and this file never keeps
 * a number of its own.
 *
 * What is read, and how each is measured:
 * - the BACK: its spine's and chest's turns together, about its pelvis (the table's numbers are the whole thoracic and
 *   lumbar spine's, and every bone between the two is at its bind): flexion (up toward forward) and extension, side
 *   bending (either way), rotation about its spine (either way);
 * - the NECK: its neck's and head's turns together (the cervical spine with the head on it): the same three;
 * - each HIP: the thigh's swing -- flexion (the knee toward forward) and extension, abduction (out from the middle) and
 *   adduction -- and its twist about the thigh, internal (the toes toward the middle) and external;
 * - each KNEE: the shin's swing toward the back (flexion) and past straight (hyperextension);
 * - each ANKLE: the foot's swing up toward the shin (dorsiflexion) and down (plantarflexion).
 * Each is read in the clinician's order (Grood & Suntay's joint coordinate system, as the ISB recommends): the flexion
 * first, then the swing out to the side, then the rotation about the bone as it lies in the bind. A motion the table has no number for -- the knee's
 * sideways bend or its rotation, the ankle's inversion -- is read as zero and left as the pose wrote it. The arms are
 * held where they reach, by `sarahlab/armJoints.ts` (elbow, forearm, wrist), and are not touched here.
 *
 * HOLDING changes only the motion past its wall: the rest of the turn is put back together as it was. A chain (back,
 * neck) is held back as one -- each of its turns scaled by the same share in each motion -- so the bend stays shared
 * along it the way the pose shared it.
 *
 * Pure: no three, no DOM (core; `tests/simulationCore.test.ts`).
 */
import type { BindJoint, HumanMeasure, JointTurn, MutableJointTurn } from './humanRig';
import { newJointTurn } from './humanRig';

/** The joints and motions read, named as `data/jointRange.ts` names them. */
export type LimitedJoint = 'back' | 'neck' | 'hip' | 'knee' | 'ankle';
/** A motion's range in degrees from neutral (`data/jointRange.ts` `rangeDeg` for one sex). */
export type RangeOf = (joint: LimitedJoint, motion: string) => number;

/** Each motion read, degrees: positive the first-named way (flexion, abduction, internal rotation, dorsiflexion). */
export interface JointAngles {
  readonly back: { flexion: number; lateral: number; rotation: number };
  readonly neck: { flexion: number; lateral: number; rotation: number };
  readonly hipL: { flexion: number; abduction: number; rotation: number };
  readonly hipR: { flexion: number; abduction: number; rotation: number };
  readonly kneeL: number;
  readonly kneeR: number;
  readonly ankleL: number;
  readonly ankleR: number;
}

/** A motion past its wall: which, by how far, and the wall (degrees). */
export interface PastWall { readonly where: string; readonly motion: string; readonly angle: number; readonly wall: number }

type V = [number, number, number];
type Q = [number, number, number, number];
const DEG = 180 / Math.PI;

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: V): V => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-12 ? scale(a, 1 / l) : [0, 1, 0]; };
/** a with its part along unit n taken off, made unit */
const square = (a: V, n: V): V => unit(sub(a, scale(n, dot(a, n))));

const qMul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qConj = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]];
const qOfTurn = (t: JointTurn): Q => { const s = Math.sin(t.radians / 2), l = Math.hypot(t.ax, t.ay, t.az) || 1; return [(t.ax / l) * s, (t.ay / l) * s, (t.az / l) * s, Math.cos(t.radians / 2)]; };
function writeTurn(out: MutableJointTurn, joint: number, q: Q): void {
  let [x, y, z, w] = q;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.hypot(x, y, z);
  out.joint = joint;
  if (s < 1e-9) { out.ax = 0; out.ay = 1; out.az = 0; out.radians = 0; return; }
  out.ax = x / s; out.ay = y / s; out.az = z / s; out.radians = 2 * Math.atan2(s, w);
}

/**
 * A turn read the way a clinician reads a joint (the joint coordinate system of Grood & Suntay, as the ISB recommends
 * for the hip and the spine): first a FLEXION -- the bone `t` (unit, as it lies in the bind) turned toward `f` (unit,
 * square to t) -- then a sideways swing toward `o` (unit, square to both: abduction, a side bend), then a ROTATION about
 * the bone itself; `turn = Rot(t×f, α) · Rot(t×o, β) · Rot(t, γ)`, all three in radians. Unlike reading the whole swing
 * as one rotation, this keeps a thigh drawn up and then let fall open at the flexion and the opening it was given.
 */
function split(q: Q, t: V, f: V, o: V): { sa: number; sb: number; tw: number } {
  // where the bone points now, and from it the flexion (in t, f) and the swing out of that plane
  const d = rotate(q, t);
  const sb = Math.asin(Math.max(-1, Math.min(1, dot(d, o))));
  const sa = Math.atan2(dot(d, f), dot(d, t));
  // what is left once those two are taken off is a turn about the bone: its rotation
  const rest = qMul(qConj(qMul(qAxisV(cross(t, f), sa), qAxisV(cross(t, o), sb))), q);
  const tw = 2 * Math.atan2(rest[0] * t[0] + rest[1] * t[1] + rest[2] * t[2], rest[3]);
  return { sa, sb, tw: Math.atan2(Math.sin(tw), Math.cos(tw)) };
}
function join(t: V, f: V, o: V, sa: number, sb: number, tw: number): Q {
  return qMul(qMul(qAxisV(cross(t, f), sa), qAxisV(cross(t, o), sb)), qAxisV(t, tw));
}
const qAxisV = (axis: V, a: number): Q => { const n = unit(axis), s = Math.sin(a / 2); return [n[0] * s, n[1] * s, n[2] * s, Math.cos(a / 2)]; };
function rotate(q: Q, v: V): V {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** One joint's axes in the bind: its bone `t`, the way its flexion turns it (`a`) and the way its sideways swing does (`b`). */
interface Axes { readonly t: V; readonly a: V; readonly b: V; readonly twistSign: number }

export class JointLimits {
  private readonly j: HumanMeasure['joints'];
  private readonly spineChain: number[];
  private readonly neckChain: number[];
  private readonly body: Axes;
  private readonly hip: Record<'L' | 'R', Axes>;
  private readonly knee: Record<'L' | 'R', Axes>;
  private readonly ankle: Record<'L' | 'R', Axes>;
  private readonly range: RangeOf;
  private readonly at = new Map<number, number>();
  private readonly scratch: MutableJointTurn[] = [];

  /**
   * The body's axes from its bind, and the ranges it is held to. `bind` is the skeleton `measure` was taken from; `range`
   * gives each motion's range in degrees (`rangeDeg` of `data/jointRange.ts` for the character's sex).
   */
  constructor(measure: HumanMeasure, bind: readonly BindJoint[], range: RangeOf) {
    const j = (this.j = measure.joints);
    this.range = range;
    const P = (i: number): V => [bind[i].x, bind[i].y, bind[i].z];
    const up = unit(sub(P(j.neck), P(j.pelvis)));
    const across = square(sub(P(j.hipL), P(j.hipR)), up);
    // forward: square to both, the way the toes point (a mirrored rig is read as it stands)
    let fwd = unit(cross(across, up));
    const toe = (ankle: number): V | null => { const k = bind.findIndex((b) => b.parent === ankle); return k >= 0 ? sub(P(k), P(ankle)) : null; };
    const tl = toe(j.ankleL) ?? toe(j.ankleR);
    if (tl && dot(tl, fwd) < 0) fwd = scale(fwd, -1);
    // the back and neck: flexion turns up toward forward, a side bend toward her side, rotation about up
    this.body = { t: up, a: square(fwd, up), b: unit(cross(square(fwd, up), up)), twistSign: 1 };
    const limb = (from: number, to: number, toward: V, outward: V): Axes => {
      const t = unit(sub(P(to), P(from)));
      const a = square(toward, t), b = square(sub(outward, scale(a, dot(outward, a))), t);
      return { t, a, b, twistSign: 1 };
    };
    const side = (s: 'L' | 'R'): V => (s === 'L' ? across : scale(across, -1));
    const hip = (s: 'L' | 'R'): Axes => {
      const ax = limb(s === 'L' ? j.hipL : j.hipR, s === 'L' ? j.kneeL : j.kneeR, fwd, side(s));
      // internal rotation turns the toes (forward) toward the middle: positive about the thigh that way
      return { ...ax, twistSign: Math.sign(dot(cross(fwd, scale(side(s), -1)), ax.t)) || 1 };
    };
    this.hip = { L: hip('L'), R: hip('R') };
    // the knee bends the shin toward the back; the ankle the foot toward the shin (up)
    const knee = (s: 'L' | 'R'): Axes => limb(s === 'L' ? j.kneeL : j.kneeR, s === 'L' ? j.ankleL : j.ankleR, scale(fwd, -1), side(s));
    this.knee = { L: knee('L'), R: knee('R') };
    const ankle = (s: 'L' | 'R'): Axes => {
      const a0 = s === 'L' ? j.ankleL : j.ankleR, k = bind.findIndex((b) => b.parent === a0);
      const footTo: V = k >= 0 ? P(k) : (() => { const p = P(a0); return [p[0] + fwd[0], p[1] + fwd[1], p[2] + fwd[2]] as V; })();
      const t = unit(sub(footTo, P(a0)));
      return { t, a: square(up, t), b: square(sub(side(s), scale(square(up, t), dot(side(s), square(up, t)))), t), twistSign: 1 };
    };
    this.ankle = { L: ankle('L'), R: ankle('R') };
    // the chains: spine to chest, neck to head (the joints between them are at their bind)
    this.spineChain = [j.spine, j.chest];
    this.neckChain = [j.neck, j.head];
  }

  /** Each motion's angle in a pose (degrees). */
  read(turns: readonly JointTurn[]): JointAngles {
    this.index(turns);
    const chain = (c: number[]) => { const q = c.reduce<Q>((acc, i) => qMul(acc, this.q(turns, i)), [0, 0, 0, 1]); const s = split(q, this.body.t, this.body.a, this.body.b); return { flexion: s.sa * DEG, lateral: s.sb * DEG, rotation: s.tw * DEG }; };
    const hip = (s: 'L' | 'R') => { const A = this.hip[s], x = split(this.q(turns, s === 'L' ? this.j.hipL : this.j.hipR), A.t, A.a, A.b); return { flexion: x.sa * DEG, abduction: x.sb * DEG, rotation: x.tw * A.twistSign * DEG }; };
    const hinge = (A: Axes, i: number) => split(this.q(turns, i), A.t, A.a, A.b).sa * DEG;
    return {
      back: chain(this.spineChain), neck: chain(this.neckChain), hipL: hip('L'), hipR: hip('R'),
      kneeL: hinge(this.knee.L, this.j.kneeL), kneeR: hinge(this.knee.R, this.j.kneeR),
      ankleL: hinge(this.ankle.L, this.j.ankleL), ankleR: hinge(this.ankle.R, this.j.ankleR),
    };
  }

  /** Every motion of a pose past its wall (degrees past it, positive), for a report. */
  pastWalls(turns: readonly JointTurn[]): PastWall[] {
    const r = this.read(turns), R = this.range, out: PastWall[] = [];
    const check = (where: string, motion: string, angle: number, lo: number, hi: number) => {
      if (angle > hi + 1e-6) out.push({ where, motion, angle, wall: hi });
      else if (angle < -lo - 1e-6) out.push({ where, motion, angle, wall: -lo });
    };
    for (const [where, a, J] of [['back', r.back, 'back'], ['neck', r.neck, 'neck']] as const) {
      check(where, 'flexion/extension', a.flexion, R(J, 'extension'), R(J, 'flexion'));
      check(where, 'lateralFlexion', a.lateral, R(J, 'lateralFlexion'), R(J, 'lateralFlexion'));
      check(where, 'rotation', a.rotation, R(J, 'rotation'), R(J, 'rotation'));
    }
    for (const [where, h] of [['hipL', r.hipL], ['hipR', r.hipR]] as const) {
      check(where, 'flexion/extension', h.flexion, R('hip', 'extension'), R('hip', 'flexion'));
      check(where, 'abduction/adduction', h.abduction, R('hip', 'adduction'), R('hip', 'abduction'));
      check(where, 'internal/external rotation', h.rotation, R('hip', 'externalRotation'), R('hip', 'internalRotation'));
    }
    for (const [where, k] of [['kneeL', r.kneeL], ['kneeR', r.kneeR]] as const) check(where, 'flexion/hyperextension', k, R('knee', 'hyperextension'), R('knee', 'flexion'));
    for (const [where, k] of [['ankleL', r.ankleL], ['ankleR', r.ankleR]] as const) check(where, 'dorsi/plantarflexion', k, R('ankle', 'plantarflexion'), R('ankle', 'dorsiflexion'));
    return out;
  }

  /**
   * The pose with every motion held within its range: the turns it limits rewritten, every other passed through as it
   * came. Writes into `out` (grown as needed) and returns the used prefix.
   */
  limit(turns: readonly JointTurn[], out: MutableJointTurn[] = this.scratch): readonly JointTurn[] {
    this.index(turns);
    const R = this.range, rad = Math.PI / 180, clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
    const held = new Map<number, Q>();
    // a chain: read as one, each of its turns scaled back by the share its whole was held back in each motion
    const chain = (c: number[], J: 'back' | 'neck') => {
      const A = this.body;
      const total = split(c.reduce<Q>((acc, i) => qMul(acc, this.q(turns, i)), [0, 0, 0, 1]), A.t, A.a, A.b);
      const ka = share(total.sa, clamp(total.sa, -R(J, 'extension') * rad, R(J, 'flexion') * rad));
      const kb = share(total.sb, clamp(total.sb, -R(J, 'lateralFlexion') * rad, R(J, 'lateralFlexion') * rad));
      const kt = share(total.tw, clamp(total.tw, -R(J, 'rotation') * rad, R(J, 'rotation') * rad));
      if (ka === 1 && kb === 1 && kt === 1) return;
      for (const i of c) { if (!this.at.has(i)) continue; const s = split(this.q(turns, i), A.t, A.a, A.b); held.set(i, join(A.t, A.a, A.b, s.sa * ka, s.sb * kb, s.tw * kt)); }
    };
    chain(this.spineChain, 'back');
    chain(this.neckChain, 'neck');
    for (const s of ['L', 'R'] as const) {
      const hi = s === 'L' ? this.j.hipL : this.j.hipR;
      if (this.at.has(hi)) {
        const A = this.hip[s], x = split(this.q(turns, hi), A.t, A.a, A.b);
        const sa = clamp(x.sa, -R('hip', 'extension') * rad, R('hip', 'flexion') * rad), sb = clamp(x.sb, -R('hip', 'adduction') * rad, R('hip', 'abduction') * rad);
        const twIn = x.tw * A.twistSign, tw = clamp(twIn, -R('hip', 'externalRotation') * rad, R('hip', 'internalRotation') * rad) * A.twistSign;
        if (sa !== x.sa || sb !== x.sb || tw !== x.tw) held.set(hi, join(A.t, A.a, A.b, sa, sb, tw));
      }
      const hinge = (i: number, A: Axes, back: number, ahead: number) => {
        if (!this.at.has(i)) return;
        const x = split(this.q(turns, i), A.t, A.a, A.b), sa = clamp(x.sa, -back * rad, ahead * rad);
        if (sa !== x.sa) held.set(i, join(A.t, A.a, A.b, sa, x.sb, x.tw));
      };
      hinge(s === 'L' ? this.j.kneeL : this.j.kneeR, this.knee[s], R('knee', 'hyperextension'), R('knee', 'flexion'));
      hinge(s === 'L' ? this.j.ankleL : this.j.ankleR, this.ankle[s], R('ankle', 'plantarflexion'), R('ankle', 'dorsiflexion'));
    }
    while (out.length < turns.length) out.push(newJointTurn());
    for (let k = 0; k < turns.length; k++) {
      const t = turns[k], q = held.get(t.joint), o = out[k];
      // (a joint named twice: the last is the one the rig applies, and the one held)
      if (q && this.at.get(t.joint) === k) writeTurn(o, t.joint, q);
      else { o.joint = t.joint; o.ax = t.ax; o.ay = t.ay; o.az = t.az; o.radians = t.radians; }
    }
    return out.length === turns.length ? out : out.slice(0, turns.length);
  }

  /** where each joint's turn is in the list (the last, as the rig applies the last) */
  private index(turns: readonly JointTurn[]): void {
    this.at.clear();
    for (let k = 0; k < turns.length; k++) this.at.set(turns[k].joint, k);
  }
  private q(turns: readonly JointTurn[], joint: number): Q {
    const k = this.at.get(joint);
    return k === undefined ? [0, 0, 0, 1] : qOfTurn(turns[k]);
  }
}

/** how much of `from` is kept to land on `to` (1 when nothing changes; both on the same side of zero) */
function share(from: number, to: number): number {
  if (from === to || Math.abs(from) < 1e-9) return 1;
  return to / from;
}
