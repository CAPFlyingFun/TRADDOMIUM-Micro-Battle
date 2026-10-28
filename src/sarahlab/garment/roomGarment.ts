/**
 * THE PROCEDURAL TEE IN THE ROOM, FOR REVIEW (Stage 2b): tailored to her as she stands in the room, put on her as
 * cloth, posed and measured -- behind the room's `?probe=cloth` hook only, beside the cloth tee and never instead of
 * it (Joshua, 2026-10-26: "Preserve the existing cloth tee... Develop the procedural garment independently").
 *
 * - TAILORED from her body at 0% belly (`bodyInput.ts`, her design shape) with the review's construction.
 * - WORN as `GarmentCloth` with the room's cloth dials (CLOTH_TUNE_DEFAULT) except FIT: a drafted pattern is already
 *   her size, so its rest lengths are taken at REST_SCALE instead of the cloth tee's 0.85.
 * - POSED on top of whatever the room's rig has her doing: her arms raised out to the side (`raise`, radians, about her
 *   front-to-back axis), brought forward (`forward`, about her side-to-side axis), her elbows bent -- the review's poses,
 *   which the room's own controls do not have.
 * - COLLIDING with her arms (and, asked for, her thighs and the stool) through `capsules.ts`.
 *
 * three.js, the room's side.
 */
import * as THREE from 'three';
import type { ClothSettings } from '../clothSim';
import { bodyInputOf, SARAH_V2_ARM_BONES, SARAH_V2_JOINTS } from './bodyInput';
import { bodyCapsules, type CapsuleRequest } from './capsules';
import { teeParams, type TeeParams } from './draft';
import { SARAH_V2_DETAIL_POINTS } from '../detailSpots';
import { GarmentCloth } from './garmentCloth';
import { tailor, type Tailored } from './tailor';

/** A drafted pattern is her size: its edges rest at this share of their pattern length (the cloth tee's FIT is 0.85). */
export const REST_SCALE = 0.98;
/** Drawn this far (metres) out from where it is simulated: her skin under it is not masked as under the room's tees. */
export const DRAW_LIFT = 0.003;

export interface RoomGarmentOptions {
  readonly body: THREE.SkinnedMesh;
  /** Her model's root: the frame her poses' axes are taken in. */
  readonly root: THREE.Object3D;
  readonly params: Partial<TeeParams>;
  readonly settings: Partial<ClothSettings>;
  readonly standOff: number;
  readonly unitsPerMetre: number;
  readonly scale: number;
  readonly offset: readonly [number, number, number];
  readonly material: THREE.Material;
  /** The neckline's edge rests at this share of its pattern length, over the params' own `neckBand`: `GarmentCloth`'s. */
  readonly neckBand?: number;
  /** False: no domes over her navel and nipples (a probe's before picture). Absent: domed. */
  readonly detail?: boolean;
}

export interface ArmPose { raise: number; forward: number; elbow: number }

const Z = new THREE.Vector3(0, 0, 1), X = new THREE.Vector3(1, 0, 0);

export class RoomGarment {
  readonly tailored: Tailored;
  readonly cloth: GarmentCloth;
  readonly pose: ArmPose = { raise: 0, forward: 0, elbow: 0 };
  capsules: CapsuleRequest = { arms: true, legs: false, stool: null };
  /** Particles that started within 7 cm of either armpit: the underarm the review measures. */
  readonly underarm: Uint8Array;
  private readonly options: RoomGarmentOptions;
  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();
  private readonly qc = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();

  constructor(options: RoomGarmentOptions) {
    this.options = options;
    const input = bodyInputOf(options.body, { belly: 1 });
    const params = teeParams(options.params);
    this.tailored = tailor(input, params, { scale: options.scale, offset: options.offset });
    const t = this.tailored;
    this.cloth = new GarmentCloth({
      body: options.body, sewn: t.sewn, binding: t.binding, trunkOnly: t.placed.trunkOnly, armBones: SARAH_V2_ARM_BONES,
      settings: { ...options.settings, restScale: REST_SCALE }, standOff: options.standOff, material: options.material, unitsPerMetre: options.unitsPerMetre,
      drawLift: DRAW_LIFT * options.unitsPerMetre, fabricRest: fabricRestOf(t.placed.positions, options.scale, options.offset), neckBand: options.neckBand ?? params.neckBand ?? 1, armpitRule: params.construction !== 'setIn', detail: SARAH_V2_DETAIL_POINTS, ...(options.detail === false ? { detailDomes: false } : {}),
    });
    this.underarm = new Uint8Array(t.sewn.count);
    for (let i = 0; i < t.sewn.count; i++) for (const ap of t.measure.armpit) if (Math.hypot(t.placed.positions[i * 3] - ap[0], t.placed.positions[i * 3 + 1] - ap[1], t.placed.positions[i * 3 + 2] - ap[2]) < 0.07) this.underarm[i] = 1;
  }

  /** Turn her arms to `pose` on top of what her rig set this frame (call after the rig, before skinning reads her). */
  applyPose(): void {
    const { raise, forward, elbow } = this.pose;
    if (!raise && !forward && !elbow) return;
    const bones = this.options.body.skeleton.bones, J = SARAH_V2_JOINTS;
    this.options.root.updateMatrixWorld(true);
    const frame = this.options.root.getWorldQuaternion(new THREE.Quaternion());
    const turn = (i: number, q: THREE.Quaternion) => {
      const b = bones[i];
      b.parent!.getWorldQuaternion(this.qa); b.getWorldQuaternion(this.qb);
      b.quaternion.copy(this.qa.invert().multiply(q).multiply(this.qb));
      b.updateMatrixWorld(true);
    };
    for (let s = 0; s < 2; s++) {
      const sign = s === 0 ? 1 : -1;
      const q = this.qc.setFromAxisAngle(this.axis.copy(Z).applyQuaternion(frame), sign * raise).multiply(new THREE.Quaternion().setFromAxisAngle(this.axis.copy(X).applyQuaternion(frame), -forward));
      turn(J.shoulder[s], q.clone());
      if (elbow) turn(J.elbow[s], new THREE.Quaternion().setFromAxisAngle(this.axis.copy(X).applyQuaternion(frame), -elbow));
    }
  }

  /** One frame of the cloth, her capsules read from her as she is now. */
  frame(dt: number): void {
    const t = this.tailored, J = SARAH_V2_JOINTS;
    const caps = bodyCapsules(this.options.body, { shoulder: J.shoulder, elbow: J.elbow, wrist: J.wrist, hip: J.hip, knee: J.knee }, t.measure, this.capsules, this.options.unitsPerMetre);
    this.cloth.frame(dt, caps.count ? caps : undefined);
  }

  /** The neckline's opening now: its middle (world) and its length round (world units). */
  neck(): { centre: [number, number, number]; length: number } {
    const o = this.tailored.sewn.openings.find((q) => q.edges.some((e) => e.endsWith(':neck')));
    const x = this.cloth.positions;
    if (!o) return { centre: [0, 0, 0], length: 0 };
    let cx = 0, cy = 0, cz = 0;
    for (const p of o.particles) { cx += x[p * 3]; cy += x[p * 3 + 1]; cz += x[p * 3 + 2]; }
    const k = o.particles.length || 1;
    return { centre: [cx / k, cy / k, cz / k], length: this.neckLength() };
  }

  /** The neckline's boundary length now (its boundary edges, which are the opening's own in any order). */
  private neckLength(): number {
    const o = this.tailored.sewn.openings.find((q) => q.edges.some((e) => e.endsWith(':neck')));
    if (!o) return 0;
    const on = new Uint8Array(this.tailored.sewn.count);
    for (const p of o.particles) on[p] = 1;
    const T = this.tailored.sewn.triangles, count = new Map<number, number>(), n = this.tailored.sewn.count;
    for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = T[t + e], b = T[t + (e + 1) % 3];
      if (!on[a] || !on[b]) continue;
      const key = a < b ? a * n + b : b * n + a;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    const x = this.cloth.positions;
    let L = 0;
    for (const [key, c] of count) {
      if (c !== 1) continue;
      const a = Math.floor(key / n), b = key % n;
      L += Math.hypot(x[a * 3] - x[b * 3], x[a * 3 + 1] - x[b * 3 + 1], x[a * 3 + 2] - x[b * 3 + 2]);
    }
    return L;
  }

  dispose(): void { this.cloth.dispose(); }
}

/** Rest metres into her geometry's units, per particle (`bind.ts`: geom = (rest - offset) / scale): the fabric's rest surface. */
function fabricRestOf(rest: Float32Array, scale: number, offset: readonly [number, number, number]): Float32Array {
  const out = new Float32Array(rest.length);
  for (let i = 0; i < rest.length; i += 3) for (let c = 0; c < 3; c++) out[i + c] = (rest[i + c] - offset[c]) / scale;
  return out;
}
