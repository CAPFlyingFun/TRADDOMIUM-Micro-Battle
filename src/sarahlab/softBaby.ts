/**
 * HER BABY'S SOFT BODY (Joshua, 2026-11-03: "could we make below the neck of the baby a soft body so it can naturally
 * move around, but any automatic movements would override for that time... Basically a hybrid"): its back, arms and
 * legs each follow the pose they are given through a spring, so they swing a little behind its motion, float in her
 * womb and hang under their own weight out of it -- and whenever an automatic move poses them (a kick, a roll, a
 * stretch, coming down her canal, being lifted onto her), that pose drives them outright for as long as it lasts.
 * Its head and neck are never touched: the birth's path is laid by them.
 *
 * Each bone is a direction (from it to the next bone down the limb) in the world, carried by a damped spring toward
 * where the pose puts it, its parent's soft swing included (parents first, so a whole arm swings from the shoulder).
 * Out of her womb its weight bends that target toward the floor (`sagDeg`), and a `push` the owner gives keeps a joint
 * out of what it lies on (her skin). Nothing is stored that the pose did not give it: each frame the owner first puts
 * back the pose (`restorePose`), poses it, and steps this over that.
 */
import * as THREE from 'three';

/** GAME TUNING: the springs (Hz, damping ratio), in air and in her womb's fluid; how far its weight bends a limb in air
 * (degrees at the most, a limb square to the floor); how far a limb may lag its pose (degrees); and how fast an
 * automatic move takes it and lets it go (seconds); how much of its swing is left when what it lies on stops it */
export const BABY_SOFT = Object.freeze({ hz: 2.4, damping: 0.32, fluidHz: 1.3, fluidDamping: 0.85, sagDeg: 16, mostDeg: 32, driveIn: 0.12, driveOut: 0.45, onSkin: 0.15 });

export interface SoftBaby {
  /** the bones it moves, parents first, and the next bone down from each (what its direction points at) */
  readonly bones: readonly THREE.Bone[];
  readonly next: readonly THREE.Bone[];
  /** how much of its weight bends each (1 a limb; 0 its back, held up by what it lies on) */
  readonly weight: readonly number[];
  /** the pose each was given this frame (local), put back before the next pose is laid */
  readonly posed: THREE.Quaternion[];
  /** each bone's soft direction and its swing (world, a unit vector and its rate) */
  readonly dir: THREE.Vector3[];
  readonly vel: THREE.Vector3[];
  /** whether it has a frame yet (its first takes the pose as it is) */
  ready: boolean;
  /** how much the pose drives it now (0 its springs .. 1 the pose outright) */
  drive: number;
}

/**
 * The soft body for a baby whose bones are `bones` (by name): `chains` each a run of bones from the body outward, every
 * one but the last moved (the last is where the one before points). Chains in the order to move them: its back first.
 * `unweighted` bones are not bent by its weight (its back: what it lies on holds that up -- 2026-11-03, a back let sag
 * gave it a hollow belly on her).
 */
export function createSoftBaby(bones: ReadonlyMap<string, THREE.Bone>, chains: readonly (readonly string[])[], unweighted: readonly string[] = []): SoftBaby {
  const moved: THREE.Bone[] = [], next: THREE.Bone[] = [], weight: number[] = [];
  for (const chain of chains) {
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = bones.get(chain[i]), b = bones.get(chain[i + 1]);
      if (a && b && !moved.includes(a)) { moved.push(a); next.push(b); weight.push(unweighted.includes(chain[i]) ? 0 : 1); }
    }
  }
  return { bones: moved, next, weight, posed: moved.map((b) => b.quaternion.clone()), dir: moved.map(() => new THREE.Vector3()), vel: moved.map(() => new THREE.Vector3()), ready: false, drive: 1 };
}

/** The pose put back as it was given (before this frame's posing: a pose left alone holds what it was given). */
export function restorePose(s: SoftBaby): void {
  if (!s.ready) return;
  s.bones.forEach((b, i) => b.quaternion.copy(s.posed[i]));
}

const tA = new THREE.Vector3(), tB = new THREE.Vector3(), tT = new THREE.Vector3(), tQ = new THREE.Quaternion(), tP = new THREE.Quaternion(), tW = new THREE.Quaternion(), tAcc = new THREE.Vector3(), tAx = new THREE.Vector3();

export interface SoftStep {
  /** how much the pose should drive it (0..1: 1 while an automatic move holds it) */
  readonly drive: number;
  /** how much it is in her womb's fluid (0 in air .. 1 floating) */
  readonly fluid: number;
  /** the way down in the world (unit) */
  readonly down: THREE.Vector3;
  /**
   * A joint kept out of what it lies on: given the bone's place (world), the direction it would point and its length,
   * the direction to point instead (written into `dir`, returning true), or false to leave it.
   */
  readonly push?: (from: THREE.Vector3, dir: THREE.Vector3, length: number) => boolean;
}

/** One frame (`dt` seconds) of its soft body over the pose its bones were just given. */
export function stepSoftBaby(s: SoftBaby, dt: number, step: SoftStep): void {
  const S = BABY_SOFT, n = s.bones.length;
  if (n === 0) return;
  // the pose as given, kept for the next frame
  s.bones.forEach((b, i) => s.posed[i].copy(b.quaternion));
  // the drive: in at once nearly, out slowly
  const want = Math.min(1, Math.max(0, step.drive));
  const rate = want > s.drive ? S.driveIn : S.driveOut;
  s.drive = rate > 0 ? s.drive + (want - s.drive) * (1 - Math.exp(-Math.max(0, dt) / rate)) : want;
  if (want >= 0.999 && s.drive > 0.98) s.drive = 1;
  const fluid = Math.min(1, Math.max(0, step.fluid));
  const hz = S.hz + (S.fluidHz - S.hz) * fluid, zeta = S.damping + (S.fluidDamping - S.damping) * fluid;
  const w0 = 2 * Math.PI * hz, sag = ((S.sagDeg * Math.PI) / 180) * (1 - fluid) * (1 - s.drive), most = (S.mostDeg * Math.PI) / 180;
  // (sub-steps, so a long frame does not throw it)
  const h = Math.min(Math.max(0, dt), 1 / 15), steps = Math.max(1, Math.ceil(h / (1 / 120))), sh = h / steps;
  s.bones[0].parent?.updateMatrixWorld(true);
  for (let i = 0; i < n; i++) {
    const b = s.bones[i], c = s.next[i];
    b.updateMatrixWorld(true);
    b.getWorldPosition(tA); c.getWorldPosition(tB);
    const length = tB.distanceTo(tA);
    if (length < 1e-9) continue;
    // where the pose points it, its parent's swing and all
    tT.copy(tB).sub(tA).divideScalar(length);
    const posedDir = tT.clone();
    // its weight, out of the fluid: bent toward the floor by as much as it lies across it
    if (sag > 0) {
      tAx.crossVectors(tT, step.down); const across = tAx.length();
      if (across > 1e-6) tT.applyAxisAngle(tAx.divideScalar(across), sag * across * s.weight[i]);
    }
    if (!s.ready) { s.dir[i].copy(posedDir); s.vel[i].set(0, 0, 0); }
    const d = s.dir[i], v = s.vel[i];
    for (let k = 0; k < steps && h > 0; k++) {
      tAcc.copy(tT).sub(d).multiplyScalar(w0 * w0).addScaledVector(v, -2 * zeta * w0);
      v.addScaledVector(tAcc, sh); d.addScaledVector(v, sh).normalize();
      v.addScaledVector(d, -v.dot(d));
    }
    // never further than `mostDeg` behind its pose
    const off = Math.acos(Math.min(1, Math.max(-1, d.dot(tT))));
    if (off > most) { tAx.crossVectors(tT, d); if (tAx.lengthSq() > 1e-12) { d.copy(tT).applyAxisAngle(tAx.normalize(), most); v.multiplyScalar(0.5); } }
    // the pose's share: an automatic move drives it outright
    if (s.drive > 0) { tQ.setFromUnitVectors(d, posedDir); tQ.slerp(tW.identity(), 1 - s.drive); d.applyQuaternion(tQ); v.multiplyScalar(1 - s.drive); }
    // kept out of what it lies on
    // (its swing taken up by what it lies on: kept, it bounced against her skin)
    if (step.push && step.push(tA, d, length)) v.multiplyScalar(BABY_SOFT.onSkin);
    // the bone turned so it points that way
    tQ.setFromUnitVectors(posedDir, d);
    if (b.parent) b.parent.getWorldQuaternion(tP).invert(); else tP.identity();
    b.getWorldQuaternion(tW);
    b.quaternion.copy(tP.multiply(tQ).multiply(tW));
    b.updateMatrixWorld(true);
  }
  s.ready = true;
}
