/**
 * STANDING TO SEATED, AND BACK, AS A MOVE (Joshua, 2026-10-28: "we probably need to add a smooth procedural standing to
 * sitting that lasts about 5s, and then see if from standing to sitting the sim does the dress correctly"). The room's
 * STAND and SIT were instant: her bones jumped and the cloth on her was laid again from her body, so a dress started
 * wherever its binding put it in the seated pose and never went through being sat in. Now SIT and STAND between the two
 * move her over SIT_SECONDS, the cloth simulated all the way.
 *
 * - Her bones: each joint's turn (`JointTurn`, a world-space rotation `HumanRig.apply` puts on her bind pose) is the
 *   rotation of the standing pose slerped toward the seated one's, by `sitEase` of how far she is through the move. A
 *   joint one pose does not name is at its bind (no turn) in that pose.
 * - Her place on the floor (the room's `place`): her feet stay where she stood and the stool is set behind her, so she
 *   sits back onto it rather than sliding her feet out.
 *
 * Plain TypeScript; three.js only for its quaternion.
 */
import * as THREE from 'three';
import { newJointTurn, type JointTurn, type MutableJointTurn } from '../actor/humanRig';

/** Seconds standing to seated (and seated to standing). */
export const SIT_SECONDS = 5;

/** How far through the move she looks at progress `u` (0..1): smoothstep, so she starts and settles gently. */
export function sitEase(u: number): number {
  const t = Math.min(1, Math.max(0, Number.isFinite(u) ? u : 0));
  return t * t * (3 - 2 * t);
}

/** Progress `amount` (0 standing, 1 seated) one step of `dt` seconds toward `target`, at one whole move per `seconds`. */
export function stepSit(amount: number, target: number, dt: number, seconds = SIT_SECONDS): number {
  const a = Math.min(1, Math.max(0, Number.isFinite(amount) ? amount : 0)), to = target >= 0.5 ? 1 : 0;
  if (!(dt > 0) || !(seconds > 0)) return a;
  return to > a ? Math.min(to, a + dt / seconds) : Math.max(to, a - dt / seconds);
}

const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), axis = new THREE.Vector3();

function turnOf(list: readonly JointTurn[]): Map<number, JointTurn> {
  // the last turn a list names for a joint is the one `HumanRig.apply` keeps
  const m = new Map<number, JointTurn>();
  for (const t of list) if (t.joint >= 0) m.set(t.joint, t);
  return m;
}

function quaternionOf(t: JointTurn | undefined, out: THREE.Quaternion): THREE.Quaternion {
  if (!t) return out.identity();
  axis.set(t.ax, t.ay, t.az);
  const l = axis.length();
  return l > 0 ? out.setFromAxisAngle(axis.divideScalar(l), t.radians) : out.identity();
}

/**
 * Pose `a` turned `t` of the way to pose `b` (0 is `a`, 1 is `b`), into `out` (grown as needed): one turn per joint
 * either names, each the slerp of the two rotations. Returns the turns written (a prefix of `out`).
 */
export function blendJointTurns(a: readonly JointTurn[], b: readonly JointTurn[], t: number, out: MutableJointTurn[]): readonly JointTurn[] {
  const A = turnOf(a), B = turnOf(b), joints = new Set<number>([...A.keys(), ...B.keys()]);
  const s = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  let k = 0;
  for (const j of joints) {
    quaternionOf(A.get(j), qa); quaternionOf(B.get(j), qb);
    // the short way round
    if (qa.dot(qb) < 0) qb.set(-qb.x, -qb.y, -qb.z, -qb.w);
    qa.slerp(qb, s).normalize();
    while (out.length <= k) out.push(newJointTurn());
    const o = out[k++], w = Math.min(1, Math.max(-1, qa.w)), sinHalf = Math.sqrt(Math.max(0, 1 - w * w));
    o.joint = j;
    if (sinHalf < 1e-9) { o.ax = 1; o.ay = 0; o.az = 0; o.radians = 0; }
    else { o.ax = qa.x / sinHalf; o.ay = qa.y / sinHalf; o.az = qa.z / sinHalf; o.radians = 2 * Math.acos(w); }
  }
  return out.slice(0, k);
}
