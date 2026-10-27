/**
 * HER LIMBS AS CAPSULES FOR THE CLOTH (Stage 2b): what keeps a body piece of the procedural garment from passing
 * through her arm when her arm comes forward or in, through her thighs when she sits, and through the stool under her.
 * `clothSim.ts` pushes masked particles out of each capsule (a segment and a radius, world units) every substep.
 *
 * - ARMS: upper arm from ARM_START of the way down from shoulder to elbow (clear of her shoulder, where the sleeve's
 *   crown and the bodice meet and must be free to lie on her), to the elbow; forearm, elbow to wrist. Radius: her arm's
 *   own girth there (measure.ts) as a circle, times RADIUS_SHARE (inside her skin, so the capsule only ever catches
 *   cloth that has already gone into her).
 * - LEGS: thigh from LEG_START of the way down from hip to knee, to the knee; radius from her thigh's girth likewise.
 * - STOOL: a vertical capsule the stool's radius wide whose rounded top is the seat's height.
 *
 * Read from her skeleton every frame (posed bones, world), so they move with her. three.js, the room's side.
 */
import * as THREE from 'three';
import type { Capsules } from '../clothSim';
import type { BodyMeasure } from './types';

/** Upper arm and thigh capsules start this share of the way down the bone (clear of her shoulder and hip). */
const ARM_START = 0.45, LEG_START = 0.35;
/** A capsule's radius is this share of her limb's girth as a circle. */
const RADIUS_SHARE = 0.85;

export interface CapsuleRequest {
  readonly arms: boolean;
  readonly legs: boolean;
  /** The stool: its centre on the floor (world x, z), radius and seat height (world units); null for none. */
  readonly stool: { readonly x: number; readonly z: number; readonly radius: number; readonly top: number } | null;
}

/** Her skeleton's bones for the capsules ([+x side, -x side]): Sarah v2's indices. */
export interface CapsuleBones {
  readonly shoulder: readonly [number, number];
  readonly elbow: readonly [number, number];
  readonly wrist: readonly [number, number];
  readonly hip: readonly [number, number];
  readonly knee: readonly [number, number];
}

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();

/** How many capsules a request makes. */
export function capsuleCount(r: CapsuleRequest): number { return (r.arms ? 4 : 0) + (r.legs ? 2 : 0) + (r.stool ? 1 : 0); }

/**
 * Her capsules now, in world units, into `out` when it is the right size (reused frame to frame), else a new one.
 * `unitsPerMetre` turns her measured girths (metres) into world units.
 */
export function bodyCapsules(body: THREE.SkinnedMesh, bones: CapsuleBones, measure: BodyMeasure, request: CapsuleRequest, unitsPerMetre: number, out?: Capsules): Capsules {
  const count = capsuleCount(request);
  const caps: Capsules = out && out.count === count ? out : { count, a: new Float32Array(count * 3), b: new Float32Array(count * 3), radius: new Float32Array(count) };
  const B = body.skeleton.bones;
  let k = 0;
  const put = (a: THREE.Vector3, b: THREE.Vector3, r: number) => { caps.a[k * 3] = a.x; caps.a[k * 3 + 1] = a.y; caps.a[k * 3 + 2] = a.z; caps.b[k * 3] = b.x; caps.b[k * 3 + 1] = b.y; caps.b[k * 3 + 2] = b.z; caps.radius[k] = r; k++; };
  const circle = (girth: number) => (girth / (2 * Math.PI)) * RADIUS_SHARE * unitsPerMetre;
  if (request.arms) for (let s = 0; s < 2; s++) {
    const g = measure.arms[s].girths;
    B[bones.shoulder[s]].getWorldPosition(tmpA); B[bones.elbow[s]].getWorldPosition(tmpB); B[bones.wrist[s]].getWorldPosition(tmpC);
    const upper = circle(Math.max(...g.slice(3, 8))), fore = circle(Math.max(...g.slice(12, 16)));
    put(tmpA.clone().lerp(tmpB, ARM_START), tmpB, upper);
    put(tmpB, tmpC, fore);
  }
  if (request.legs) for (let s = 0; s < 2; s++) {
    B[bones.hip[s]].getWorldPosition(tmpA); B[bones.knee[s]].getWorldPosition(tmpB);
    put(tmpA.clone().lerp(tmpB, LEG_START), tmpB, circle(measure.thigh.girth));
  }
  if (request.stool) {
    const { x, z, radius, top } = request.stool;
    put(tmpA.set(x, 0, z), tmpB.set(x, Math.max(0, top - radius), z), radius);
  }
  return caps;
}
