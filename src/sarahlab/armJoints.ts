/**
 * HER ARM AS A REAL ARM'S JOINTS (Joshua, 2026-11-04: "check her arms at the elbow and wrist... it looks really
 * uncomfortable and in a distorted position. We need to set up realistic max and min angles for each part of the body").
 *
 * A reach (her hands on her knees, on her baby, holding it) gives a shoulder, an elbow place and a wrist place, and a
 * way the hand should lie. Turned there by the shortest turns, the arm came out wrung: its elbow bent in whatever
 * plane the turn happened to leave it, and the whole roll the hand needed -- no forearm twist bone -- taken at the
 * wrist. Here each joint moves only as that joint can (data/jointRange.ts, the woman's or the man's numbers):
 *
 *   - THE UPPER ARM points at the elbow and is rolled so its elbow's hinge lies square to the arm's plane;
 *   - THE ELBOW is a HINGE: the forearm turns about that hinge alone, from straight (a few degrees past, a woman's) to
 *     its most bent;
 *   - THE FOREARM'S ROLL (pronation, supination) is the hand's roll about the forearm, held within its range, and taken
 *     half by the forearm and half by the wrist (`FOREARM_SHARE`, as actor/humanReach.ts does: no twist bone);
 *   - THE WRIST bends toward the palm or the back of the hand and toward the thumb or the little finger, each held
 *     within its range.
 *
 * What cannot be reached within those walls is not reached: the hand lies as near the way asked as the joints allow,
 * and `pose` says how far off (`residual`) so a reach can choose the elbow's place that needs least.
 *
 * The elbow's hinge, the forearm's neutral roll and the wrist's neutral are read once from the skeleton's BIND (Sarah
 * v2 is rigged arms down, palms to her thighs: the forearm's mid position). Her forward is read from the bind too (her
 * shoulders and her spine), so a model laid any way round in its file reads the same.
 */
import * as THREE from 'three';
import { rangeDeg, type Sex } from '../data/jointRange';

/** GAME TUNING: the share of the forearm's roll the forearm bone takes (the rest the wrist), as humanReach's FOREARM_ROLL. */
export const FOREARM_SHARE = 0.5;

const DEG = Math.PI / 180;

export interface ArmJointIndex {
  readonly shoulder: number; readonly elbow: number; readonly wrist: number;
  /** the hand: its fingertip, its knuckles' middle (the hand bone), the index finger's and the little finger's first joints */
  readonly tip: number; readonly knuckles: number; readonly index: number; readonly little: number;
  /** her other shoulder, her hips and her neck (for her forward in the bind) */
  readonly otherShoulder: number; readonly hips: number; readonly neck: number;
}

export interface ArmPose {
  /** how far (radians) the hand lies from the way asked, once every joint is held within its range */
  readonly residual: number;
  /** the elbow's bend (degrees, 0 straight), the forearm's roll (degrees, + pronation) and the wrist's bend (degrees,
   * + toward the palm) and sideways bend (+ toward the thumb), as posed */
  readonly elbowDeg: number; readonly pronationDeg: number; readonly wristFlexDeg: number; readonly wristRadialDeg: number;
  /** whether any joint was held at its wall */
  readonly held: boolean;
}

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3();

function bindWorld(inv: THREE.Matrix4, outPos: THREE.Vector3, outQ: THREE.Quaternion): void {
  tmpM.copy(inv).invert().decompose(outPos, outQ, tmpS);
}

/** A rotation taking the frame (a, b) to the frame (a2, b2) -- each pair's second made square to its first. */
function frameTurn(a: THREE.Vector3, b: THREE.Vector3, a2: THREE.Vector3, b2: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const basis = (x: THREE.Vector3, y: THREE.Vector3) => { const X = x.clone().normalize(), Y = y.clone().addScaledVector(X, -y.dot(X)).normalize(); return new THREE.Matrix4().makeBasis(X, Y, new THREE.Vector3().crossVectors(X, Y)); };
  return out.setFromRotationMatrix(basis(a2, b2).multiply(basis(a, b).transpose()));
}

/** The signed angle of `q`'s twist about unit `axis` (swing-twist), radians. */
function twistAbout(q: THREE.Quaternion, axis: THREE.Vector3): number {
  const p = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  const a = 2 * Math.atan2(p, q.w);
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class ArmJoints {
  /** the elbow's hinge in the upper arm's and in the forearm's own frames; the forearm's way in its own frame */
  private readonly hingeUpper = new THREE.Vector3();
  private readonly hingeFore = new THREE.Vector3();
  /** the wrist's bind turn in its parent's frame (the hand neutral on the forearm) */
  private readonly wristNeutral = new THREE.Quaternion();
  /** + about the forearm's way (toward the hand) is pronation (+1) or supination (-1) */
  private readonly pronationSign: number;
  /** the palm's side of (thumb's way x fingers' way): a left hand's and a right hand's are opposite */
  private readonly palmSign: number;
  private readonly range: { flexMax: number; hyperMax: number; pron: number; sup: number; wFlex: number; wExt: number; wRad: number; wUln: number };

  constructor(private readonly bones: readonly THREE.Bone[], boneInverses: readonly THREE.Matrix4[], private readonly j: ArmJointIndex, sex: Sex) {
    const P = (i: number) => { const p = new THREE.Vector3(), q = new THREE.Quaternion(); bindWorld(boneInverses[i], p, q); return { p, q }; };
    const S = P(j.shoulder), E = P(j.elbow), W = P(j.wrist), O = P(j.otherShoulder), H = P(j.hips), N = P(j.neck);
    const tip = P(j.tip).p, index = P(j.index).p, little = P(j.little).p, knuckles = P(j.knuckles).p;
    // her forward in the bind: from her right side to her left (this shoulder against the other, signed by which is
    // which below) crossed with her spine's way up
    const up = N.p.clone().sub(H.p).normalize();
    const across = S.p.clone().sub(O.p).normalize();
    let forward = new THREE.Vector3().crossVectors(across, up).normalize();
    // (this arm's side: left if forward is across x up with across pointing to her left; a right arm's across points to
    // her right, which turns that cross around)
    const palm = new THREE.Vector3().crossVectors(knuckles.clone().sub(W.p), index.clone().sub(little));
    // her palms face her thighs in the bind: the palm faces in toward her middle, away from this shoulder's side
    if (palm.dot(across) > 0) palm.negate();
    palm.normalize();
    // forward: the side her thumbs are on when her palms face her thighs, arms down -- her front
    const thumbWay = index.clone().sub(little).normalize();
    if (forward.dot(thumbWay) < 0) forward.negate();
    this.palmSign = palm.dot(new THREE.Vector3().crossVectors(thumbWay, tip.clone().sub(W.p))) >= 0 ? 1 : -1;
    const u = E.p.clone().sub(S.p).normalize(), f = W.p.clone().sub(E.p).normalize();
    // THE HINGE: square to the upper arm and to her forward, signed so a turn about it brings the forearm forward (flexion)
    const hinge = new THREE.Vector3().crossVectors(u, forward).normalize();
    this.hingeUpper.copy(hinge).applyQuaternion(S.q.clone().invert());
    this.hingeFore.copy(hinge).applyQuaternion(E.q.clone().invert());
    this.wristNeutral.copy(E.q.clone().invert().multiply(W.q));
    // PRONATION'S WAY: arm down, palm to her thigh (mid position), pronation turns the palm to face behind her
    const turned = palm.clone().applyAxisAngle(f, 0.3);
    this.pronationSign = turned.dot(forward) < palm.dot(forward) ? 1 : -1;
    this.range = {
      flexMax: rangeDeg('elbow', 'flexion', sex) * DEG, hyperMax: rangeDeg('elbow', 'hyperextension', sex) * DEG,
      pron: rangeDeg('forearm', 'pronation', sex) * DEG, sup: rangeDeg('forearm', 'supination', sex) * DEG,
      wFlex: rangeDeg('wrist', 'flexion', sex) * DEG, wExt: rangeDeg('wrist', 'extension', sex) * DEG,
      wRad: rangeDeg('wrist', 'radialDeviation', sex) * DEG, wUln: rangeDeg('wrist', 'ulnarDeviation', sex) * DEG,
    };
  }

  private wp(i: number, out = new THREE.Vector3()): THREE.Vector3 { return this.bones[i].getWorldPosition(out); }

  /** Turn bone i by world rotation q (about its own place). */
  private turnWorld(i: number, q: THREE.Quaternion): void {
    const b = this.bones[i], pq = b.parent ? b.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion(), bq = b.getWorldQuaternion(new THREE.Quaternion());
    b.quaternion.copy(pq.invert().multiply(q).multiply(bq)); b.updateMatrixWorld(true);
  }

  /** The hand's way along (wrist to fingertip) and the way its palm faces, as drawn now. */
  handNow(): { along: THREE.Vector3; palm: THREE.Vector3; radial: THREE.Vector3 } {
    const j = this.j, w = this.wp(j.wrist), along = this.wp(j.tip).sub(w).normalize(), radial = this.wp(j.index).sub(this.wp(j.little));
    radial.addScaledVector(along, -radial.dot(along)).normalize();
    // (the palm: thumb's way x fingers' way, the side the bind's palm faced -- a hand cannot turn that round)
    const palm = new THREE.Vector3().crossVectors(radial, along).multiplyScalar(this.palmSign).normalize();
    return { along, palm, radial };
  }

  /**
   * Pose the arm: its elbow at E, its wrist at W, its hand lying with fingers along `along` and palm facing `palm`
   * (world). The shoulder and elbow stay where they are; each joint is held within its range.
   */
  pose(E: THREE.Vector3, W: THREE.Vector3, along: THREE.Vector3, palm: THREE.Vector3): ArmPose {
    const j = this.j, R = this.range;
    const S = this.wp(j.shoulder);
    const u = E.clone().sub(S).normalize();
    // THE UPPER ARM: at the elbow, rolled so its hinge is square to the arm's plane (the hinge's way: u x f, a bend that is
    // flexion; straight, the hinge it has)
    const wNow = W.clone().sub(E).normalize();
    let hinge = new THREE.Vector3().crossVectors(u, wNow);
    const sh = this.bones[j.shoulder];
    sh.updateMatrixWorld(true);
    const hingeNow = this.hingeUpper.clone().applyQuaternion(sh.getWorldQuaternion(tmpQ));
    if (hinge.lengthSq() < 1e-8) hinge = hingeNow.clone(); else hinge.normalize();
    const uNow = this.wp(j.elbow).sub(S).normalize();
    this.turnWorld(j.shoulder, frameTurn(uNow, hingeNow, u, hinge, tmpQ2));
    // THE ELBOW: the forearm onto the hinge first (no roll of its own), then bent about it toward the wrist -- held
    // between a few degrees past straight and its most bent
    const el = this.bones[j.elbow];
    const Ew = this.wp(j.elbow), fNow = this.wp(j.wrist).sub(Ew).normalize();
    const hingeF = this.hingeFore.clone().applyQuaternion(el.getWorldQuaternion(tmpQ));
    this.turnWorld(j.elbow, frameTurn(fNow, hingeF, u, hinge, new THREE.Quaternion()));
    let bend = Math.atan2(new THREE.Vector3().crossVectors(u, wNow).dot(hinge), u.dot(wNow));
    let held = false;
    if (bend > R.flexMax) { bend = R.flexMax; held = true; }
    if (bend < -R.hyperMax) { bend = -R.hyperMax; held = true; }
    this.turnWorld(j.elbow, new THREE.Quaternion().setFromAxisAngle(hinge, bend));
    // THE HAND neutral on the forearm, then the turn it needs to lie as asked
    const wr = this.bones[j.wrist];
    wr.quaternion.copy(this.wristNeutral); wr.updateMatrixWorld(true);
    const f = this.wp(j.wrist).sub(this.wp(j.elbow)).normalize();
    const h0 = this.handNow();
    const need = frameTurn(h0.along, h0.palm, along, palm, new THREE.Quaternion());
    // ITS ROLL ABOUT THE FOREARM (pronation +), held within its range, half on the forearm and half on the wrist
    const twist = twistAbout(need, f) * this.pronationSign;
    let pron = twist;
    if (pron > R.pron) { pron = R.pron; held = true; }
    if (pron < -R.sup) { pron = -R.sup; held = true; }
    const roll = pron * this.pronationSign;
    this.turnWorld(j.elbow, new THREE.Quaternion().setFromAxisAngle(f, roll * FOREARM_SHARE));
    this.turnWorld(j.wrist, new THREE.Quaternion().setFromAxisAngle(f, roll * (1 - FOREARM_SHARE)));
    // ITS BEND AT THE WRIST: what is left, toward the palm (+) or its back, toward the thumb (+) or the little finger,
    // each within its range
    const h1 = this.handNow();
    const swing = frameTurn(h1.along, h1.palm, along, palm, new THREE.Quaternion());
    const ang = 2 * Math.acos(Math.min(1, Math.abs(swing.w))), s = Math.sqrt(Math.max(0, 1 - swing.w * swing.w));
    const rot = s > 1e-6 ? tmpV.set(swing.x / s, swing.y / s, swing.z / s).multiplyScalar(swing.w < 0 ? -ang : ang) : tmpV.set(0, 0, 0);
    const flexAxis = new THREE.Vector3().crossVectors(h1.along, h1.palm).normalize();
    // (a turn about the palm's face by + takes the fingers toward palm x along: radial if the thumb is that side)
    const radialSign = new THREE.Vector3().crossVectors(h1.palm, h1.along).dot(h1.radial) >= 0 ? 1 : -1;
    let flex = rot.dot(flexAxis), dev = rot.dot(h1.palm) * radialSign;
    if (flex > R.wFlex) { flex = R.wFlex; held = true; }
    if (flex < -R.wExt) { flex = -R.wExt; held = true; }
    if (dev > R.wRad) { dev = R.wRad; held = true; }
    if (dev < -R.wUln) { dev = -R.wUln; held = true; }
    const bendQ = new THREE.Quaternion().setFromAxisAngle(flexAxis, flex).premultiply(new THREE.Quaternion().setFromAxisAngle(h1.palm, dev * radialSign));
    this.turnWorld(j.wrist, bendQ);
    // how far the hand lies from the way asked
    const h2 = this.handNow(), left = frameTurn(h2.along, h2.palm, along, palm, new THREE.Quaternion());
    const residual = 2 * Math.acos(Math.min(1, Math.abs(left.w)));
    return { residual, elbowDeg: bend / DEG, pronationDeg: pron / DEG, wristFlexDeg: flex / DEG, wristRadialDeg: dev / DEG, held };
  }
}
