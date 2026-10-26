/**
 * HER BUILD, APPLIED TO HER SKINNED BODY: height, section lengths, widths and part sizes
 * (Joshua, 2026-10-26: "a height adjuster so you can raise or shorten the length of the legs,
 * hips, arms, hands and more basic body controls"). `actor/bodyBuild.ts` turns the controls
 * into `BuildAmounts`; this file is the render-boundary half that moves her.
 *
 * Two things move, and they have to agree:
 *
 *  - BONES. Every bone's local translation takes an offset and the head, wrists and ankles a
 *    uniform scale. Her clothes and hair share her live skeleton, so they follow with no
 *    further work. `view/HumanRig.ts` only ever writes bone QUATERNIONS, so position and scale
 *    are free for this file to own, and every write is REST + OFFSET from values captured at
 *    prepare: nothing accumulates, and approved amounts put every bone back bit for bit.
 *
 *  - A REST-SPACE FIELD per mesh, added to the position attribute with the matching normal
 *    change. Moving bones alone tears the skin at the weight blends (a vertex half on the hip
 *    and half on the knee would land halfway between two rigid copies); the field makes the
 *    skin between two joints stretch evenly instead.
 *
 * ─── the model (geometry units throughout; amounts arrive in metres) ───
 *
 * A SEGMENT runs from a start joint to an end joint along a unit axis u, between a START PLANE
 * and an END PLANE, with a FREE bone set and a FIXED bone set. For a point p, b is how far it
 * is past the start plane and r how far short of the end plane, both measured along u, and
 * T(p) = b / (b + r), clamped to 0..1. With both planes square to u that is the plain band
 * clamp((p − start)·u / length); where two segments meet at a bent knee or elbow, the plane
 * between them is the one halfway between their axes, so the thigh's band ends exactly where
 * the shin's begins and no wedge behind the knee belongs to both (or to neither). The joint
 * itself sits on both planes, so its offset is exact.
 *
 * A free bone's offset fraction is T(its joint) unless given; a fixed bone's is given; every
 * other bone inherits its parent's (a bone with no parent bone: 0). A bone's offset is
 * Σ_segments ΔL·f·u. A vertex's field per unit ΔL is q = Σ_free w_k·(T(v) − f_k), so with the
 * bones moved a vertex wholly on free bones lands at p + T(v)·ΔL·u: an even stretch. Its normal
 * follows the deformation gradient F = I + ΔL·u⊗∇q through the cofactor of F (∝ F⁻ᵀ).
 *
 * The UPPER ARM's field also FADES with distance from the arm's axis. Her upper-arm bones carry
 * a few percent of weight on her torso (the side of her chest and waist, beside the hanging
 * arm), and a free bone drags whatever it weights: at +26 cm that torso skin slid 1–2 cm down
 * beside the elbow and folded through itself and her inner arm. Measured on her: the arm's own
 * skin lies within 6.0 cm of its axis, the torso skin it weights is 5.9–13 cm off it near the
 * shoulder and 9 cm or more beside the elbow, so the field is whole within 6.5 cm and gone by 9.
 *
 * A GIRTH region (waist, hips) moves only the mesh: D = σ·m·g(y)·(x − x_c, 0, e_z·(z − z_c)),
 * m the vertex's weight on the member bones, g a cos² bump about a peak height, e_z the back's
 * or the front's share. Given her SLIM rest shape (`girthRef`), the offsets, the front/back
 * test and the height are read from it, so the waist acts on her real waist and a bump rides
 * out with it rather than being stretched sideways.
 *
 * A SIZE scales its bone. The head stays a bone scale and nothing else. The hands and feet get
 * a field of their own as well: her weights blend from shin to foot within a millimetre at the
 * Achilles (and nearly as sharply at the wrists), so a bone scale alone left a ledge there.
 * The field makes the posed result p + (s_eff − 1)(p − joint), s_eff ramping smoothly from the
 * full size at and past the ankle or wrist to none 6 cm up the shin or 4 cm up the forearm.
 * Every field under a scaled bone is divided by the vertex's blended scale, so a stretch lands
 * where it would at size 1.
 *
 * Every number about her is MEASURED from the loaded skeleton and mesh; nothing here knows
 * her by name except through `HumanJoints`. measureHuman's `head` is her HEAD END (the crown
 * joint, Bone_015 on her); the head BONE, the one a bigger head scales and the neck stretches
 * to, is the neck's child on the path to it (Bone_016).
 *
 * Measured on her edges (`tests/bodyBuildView.test.ts` prints the table): the free sets differ
 * from the first draft in three places, each named where it is built — the lower leg and
 * forearm also free the limb bone above them (f 0), and the shoulders free the collarbone with
 * the whole spine line, faded with distance from the collarbone.
 *
 * `view/` may import `actor/` as types only, so the segment list is spelled out here rather
 * than imported.
 */
import * as THREE from 'three';
import type { BuildAmounts, BuildMeasure, BuildSegment, BuildSegmentMeasure } from '../actor/bodyBuild';
import type { HumanJoints } from '../actor/humanRig';

type V3 = readonly [number, number, number];

/** What scales a segment's ΔL: a segment's own length, or the shoulders (half to each side). */
export type BuildAmountKey = BuildSegment | 'shoulders';

const SEGMENT_KEYS: readonly BuildSegment[] = ['upperLeg', 'lowerLeg', 'torso', 'neck', 'upperArm', 'forearm'];

/** Where the upper arm's field fades out, metres from the arm's axis (measured; see the header). */
const ARM_FADE_FROM = 0.065;
const ARM_FADE_TO = 0.09;
/** Where the shoulders' field fades out, metres from the collarbone's line. */
const SHOULDER_FADE_FROM = 0.14;
const SHOULDER_FADE_TO = 0.24;
/** How far up the limb a hand's or a foot's size reaches, metres. */
const HAND_RAMP = 0.04;
const FOOT_RAMP = 0.06;

/** One segment instance (each limb side is its own), in the body's geometry units. */
export interface BuildSegmentFrame {
  readonly name: string;
  readonly amount: BuildAmountKey;
  /** Its share of the amount: 1, or 0.5 for each side of the shoulders. */
  readonly share: number;
  /** The start joint (or point) and the end. */
  readonly start: V3;
  readonly end: V3;
  readonly axis: V3;
  /** Its length along the axis, (end − start)·u. */
  readonly length: number;
  /** The start and end planes' normals, each divided by its dot with u, so (p − start)·startNormal is b. */
  readonly startNormal: V3;
  readonly endNormal: V3;
  /** The distance from the axis over which the field fades out, [from, to], or null for none. */
  readonly fade: readonly [number, number] | null;
  /** Per rig bone: 1 when it is a FREE bone of this segment. */
  readonly free: Uint8Array;
  /** Per rig bone: its offset fraction, inheritance resolved. */
  readonly f: Float64Array;
}

/** A girth region, in the body's geometry units. */
export interface BuildGirthFrame {
  readonly amount: 'waist' | 'hips';
  readonly peak: number;
  readonly top: number;
  readonly bottom: number;
  readonly xc: number;
  readonly zc: number;
  /** The share of σ applied to z behind the centre line, and in front of it. */
  readonly ezBack: number;
  readonly ezFront: number;
  /** Per rig bone: 1 when its weight counts toward membership. */
  readonly member: Uint8Array;
}

/** A hand's or a foot's size ramp, in the body's geometry units. */
export interface BuildSizeRamp {
  readonly amount: 'hands' | 'feet';
  /** The scaled joint (wrist or ankle) and the limb's axis toward it (forearm or shin). */
  readonly joint: V3;
  readonly axis: V3;
  /** How far up the limb the ramp reaches. */
  readonly reach: number;
  /** Per rig bone: 1 for the limb the ramp belongs to (the elbow's or the knee's subtree). */
  readonly limb: Uint8Array;
  /** Per rig bone: 1 for the bones the size scales (the wrist's or the ankle's subtree). */
  readonly scaled: Uint8Array;
}

/** A foot, for `standingLift`: its ankle bone and the lowest approved vertex it carries. */
export interface BuildFoot {
  readonly ankle: number;
  readonly ankleY: number;
  readonly soleY: number;
}

export interface BuildRig {
  readonly measure: BuildMeasure;
  readonly metresPerUnit: number;
  /** The body's skeleton bones; every per-bone array below is indexed like this. */
  readonly bones: readonly THREE.Bone[];
  readonly index: ReadonlyMap<THREE.Object3D, number>;
  /** Each bone's parent bone, or −1. */
  readonly parent: Int32Array;
  /** Each bone's joint in the body's geometry units, 3 per bone. */
  readonly joint: Float64Array;
  readonly segments: readonly BuildSegmentFrame[];
  readonly girths: readonly BuildGirthFrame[];
  readonly ramps: readonly BuildSizeRamp[];
  /** The bones a size scales: head, then the two wrists, then the two ankles. */
  readonly headBone: number;
  readonly wrists: readonly [number, number];
  readonly ankles: readonly [number, number];
  readonly feet: readonly BuildFoot[];
  /** The lowest approved sole, geometry y. */
  readonly soleY: number;
  /** Bone local translation and scale as approved, 3 per bone. */
  readonly restPosition: Float64Array;
  readonly restScale: Float64Array;
  /** Per bone, 9 (row-major): geometry offset → change of its local translation, linear(IBM_parent)·linear(bindMatrix). */
  readonly toLocal: Float64Array;
  /** The inverse of the body's bindMatrix (geometry ← bind space), for meshes bound elsewhere. */
  readonly bindMatrixInverse: THREE.Matrix4;
  /** Scratch: the last bone offsets computed, 3 per bone. */
  readonly offsets: Float64Array;
}

// ------------------------------------------------------------------------------------------------------------------
// small vector arithmetic on plain numbers

function at(a: Float64Array, k: number): [number, number, number] { return [a[3 * k], a[3 * k + 1], a[3 * k + 2]]; }
function sub(a: V3, b: V3): [number, number, number] { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function len(a: V3): number { return Math.hypot(a[0], a[1], a[2]); }
function dot(a: V3, b: V3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function unit(a: V3): [number, number, number] { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; }
function scaled(a: V3, k: number): [number, number, number] { return [a[0] * k, a[1] * k, a[2] * k]; }

/** Row-major 3×3 of a Matrix4's linear part (three stores column-major). */
function linear(m: THREE.Matrix4): number[] {
  const e = m.elements;
  return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
}
function mul3(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) out[3 * r + c] = a[3 * r] * b[c] + a[3 * r + 1] * b[3 + c] + a[3 * r + 2] * b[6 + c];
  return out;
}
function mulV(m: readonly number[], v: V3): [number, number, number] {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}
function transpose(m: readonly number[]): number[] { return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]; }

/** A segment's two planes. */
type Planes = Pick<BuildSegmentFrame, 'start' | 'end' | 'startNormal' | 'endNormal'>;

/** T at a point (see the header): 0 before the start plane, 1 past the end plane, b/(b + r) between. */
function fraction(s: Planes, x: number, y: number, z: number): number {
  const b = (x - s.start[0]) * s.startNormal[0] + (y - s.start[1]) * s.startNormal[1] + (z - s.start[2]) * s.startNormal[2];
  if (b <= 0) return 0;
  const r = (s.end[0] - x) * s.endNormal[0] + (s.end[1] - y) * s.endNormal[1] + (s.end[2] - z) * s.endNormal[2];
  if (r <= 0) return 1;
  return b / (b + r);
}

/** The girth profile g(y) = cos²((π/2)·d) and dg/dy. */
function profile(y: number, g: BuildGirthFrame): [number, number] {
  if (y >= g.peak) {
    const span = g.top - g.peak;
    const d = span > 0 ? (y - g.peak) / span : 1;
    if (d >= 1) return [0, 0];
    const c = Math.cos((Math.PI / 2) * d);
    return [c * c, -Math.sin(Math.PI * d) * Math.PI / (2 * span)];
  }
  const span = g.peak - g.bottom;
  const d = span > 0 ? (g.peak - y) / span : 1;
  if (d >= 1) return [0, 0];
  const c = Math.cos((Math.PI / 2) * d);
  return [c * c, Math.sin(Math.PI * d) * Math.PI / (2 * span)];
}

function attr(geometry: THREE.BufferGeometry, name: string): THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null {
  return (geometry.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined) ?? null;
}

/** A skinned mesh's influences, 4 per vertex: bone indices into ITS skeleton and weights. */
function influences(mesh: THREE.SkinnedMesh): { index: Int32Array; weight: Float32Array; count: number } {
  const si = attr(mesh.geometry, 'skinIndex');
  const sw = attr(mesh.geometry, 'skinWeight');
  if (si === null || sw === null) throw new Error(`body build: ${mesh.name || 'a mesh'} has no skinIndex/skinWeight`);
  const count = si.count;
  const index = new Int32Array(4 * count);
  const weight = new Float32Array(4 * count);
  for (let i = 0; i < count; i += 1) {
    index[4 * i] = si.getX(i); index[4 * i + 1] = si.getY(i); index[4 * i + 2] = si.getZ(i); index[4 * i + 3] = si.getW(i);
    weight[4 * i] = sw.getX(i); weight[4 * i + 1] = sw.getY(i); weight[4 * i + 2] = sw.getZ(i); weight[4 * i + 3] = sw.getW(i);
  }
  return { index, weight, count };
}

// ------------------------------------------------------------------------------------------------------------------
// the rig

/**
 * Measure her and capture her rest. `basePos` is the body's approved rest positions (geometry
 * units, 3 per vertex); `joints` index `body.skeleton.bones`; `metresPerUnit` is what one
 * geometry unit is in metres (0.89974678 on her).
 */
export function prepareBuildRig(body: THREE.SkinnedMesh, basePos: Float32Array, joints: HumanJoints, metresPerUnit: number): BuildRig {
  const skeleton = body.skeleton;
  const bones = skeleton.bones.slice();
  const n = bones.length;
  const index = new Map<THREE.Object3D, number>();
  for (let i = 0; i < n; i += 1) index.set(bones[i], i);

  const parent = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    const p = bones[i].parent;
    parent[i] = p !== null && index.has(p) ? index.get(p)! : -1;
  }
  // parents before children, whatever order the skin lists them in
  const depth = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    let d = 0;
    for (let k = parent[i]; k >= 0; k = parent[k]) { d += 1; if (d > n) throw new Error('body build: the skeleton has a parent cycle'); }
    depth[i] = d;
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => depth[a] - depth[b]);

  // inverse(bindMatrix), never `body.bindMatrixInverse`: in three's ATTACHED bind mode that one is re-set every frame to
  // the inverse of the mesh's WORLD matrix, which in the room carries her ×100 scale (geometry would come out 100× small)
  const bindInverse = body.bindMatrix.clone().invert();
  const bindLinear = linear(body.bindMatrix);
  const joint = new Float64Array(3 * n);
  const toLocal = new Float64Array(9 * n);
  const world = new THREE.Matrix4();
  const point = new THREE.Vector3();
  for (let i = 0; i < n; i += 1) {
    world.copy(skeleton.boneInverses[i]).invert();
    point.setFromMatrixPosition(world).applyMatrix4(bindInverse);
    joint[3 * i] = point.x; joint[3 * i + 1] = point.y; joint[3 * i + 2] = point.z;
    if (parent[i] >= 0) toLocal.set(mul3(linear(skeleton.boneInverses[parent[i]]), bindLinear), 9 * i);
  }
  const J = (k: number): [number, number, number] => at(joint, k);
  const subtreeOf = (top: number): Uint8Array => {
    const m = new Uint8Array(n);
    for (let k = 0; k < n; k += 1) for (let a = k; a >= 0; a = parent[a]) if (a === top) { m[k] = 1; break; }
    return m;
  };

  // ── the named joints and the ones derived from them
  const chainUp = (from: number, to: number): number[] => {
    const chain: number[] = [];
    for (let k = from; k >= 0; k = parent[k]) { chain.push(k); if (k === to) return chain; }
    throw new Error(`body build: bone ${to} is not above bone ${from}`);
  };
  const root = parent[joints.pelvis];
  if (root < 0) throw new Error('body build: the pelvis has no parent bone to be her root');
  const spineLine = chainUp(joints.chest, joints.pelvis); // chest … pelvis
  const chestParent = parent[joints.chest];
  let headBone = joints.head;
  for (let k = joints.head; k >= 0 && parent[k] >= 0; k = parent[k]) { if (parent[k] === joints.neck) { headBone = k; break; } }

  const yHips = (J(joints.hipL)[1] + J(joints.hipR)[1]) / 2;
  const yTop = (J(joints.spine)[1] + J(chestParent)[1]) / 2;

  // ── segments
  type Bones = readonly (readonly [number, number?])[];
  const segments: BuildSegmentFrame[] = [];
  interface Plan {
    readonly name: string; readonly amount: BuildAmountKey; readonly share?: number;
    readonly start: V3; readonly end: V3;
    /** The plane normals at each end (unit; default the axis). */
    readonly startPlane?: V3; readonly endPlane?: V3;
    readonly fade?: readonly [number, number];
    readonly free: Bones; readonly fixed: readonly (readonly [number, number])[];
  }
  const addSegment = (plan: Plan): void => {
    const axis = unit(sub(plan.end, plan.start));
    const startPlane = plan.startPlane ?? axis;
    const endPlane = plan.endPlane ?? axis;
    const partial: Planes = {
      start: plan.start, end: plan.end,
      startNormal: scaled(startPlane, 1 / dot(startPlane, axis)), endNormal: scaled(endPlane, 1 / dot(endPlane, axis)),
    };
    const freeMask = new Uint8Array(n);
    const explicit = new Map<number, number>();
    for (const [b, fx] of plan.free) { freeMask[b] = 1; if (fx !== undefined) explicit.set(b, fx); }
    for (const [b, fx] of plan.fixed) explicit.set(b, fx);
    const f = new Float64Array(n);
    for (const k of order) {
      const given = explicit.get(k);
      if (given !== undefined) f[k] = given;
      else if (freeMask[k] === 1) f[k] = fraction(partial, joint[3 * k], joint[3 * k + 1], joint[3 * k + 2]);
      else f[k] = parent[k] >= 0 ? f[parent[k]] : 0;
    }
    segments.push({
      name: plan.name, amount: plan.amount, share: plan.share ?? 1, start: plan.start, end: plan.end, axis,
      length: dot(sub(plan.end, plan.start), axis), startNormal: partial.startNormal, endNormal: partial.endNormal,
      fade: plan.fade ?? null, free: freeMask, f,
    });
  };
  /** The plane halfway between two limbs' axes at the joint they share (b): its normal is the mean of the two axes. */
  const mitre = (a: number, b: number, c: number): V3 => {
    const u1 = unit(sub(J(b), J(a))), u2 = unit(sub(J(c), J(b)));
    return unit([u1[0] + u2[0], u1[1] + u2[1], u1[2] + u2[2]]);
  };

  for (const [side, hip, knee, ankle] of [['L', joints.hipL, joints.kneeL, joints.ankleL], ['R', joints.hipR, joints.kneeR, joints.ankleR]] as const) {
    const atKnee = mitre(hip, knee, ankle);
    addSegment({ name: `upperLeg ${side}`, amount: 'upperLeg', start: J(hip), end: J(knee), endPlane: atKnee, free: [[hip], [knee]], fixed: [] });
    // the hip is FREE here too (f 0, as it inherits): its weight bleeds below her knee, and as a rigid bone it opened
    // the back of the knee to 0.07× at lowerLeg −50%; free, those vertices follow the shin's stretch
    addSegment({ name: `lowerLeg ${side}`, amount: 'lowerLeg', start: J(knee), end: J(ankle), startPlane: atKnee, free: [[hip, 0], [knee]], fixed: [[ankle, 1]] });
  }
  {
    const pelvis = J(joints.pelvis);
    addSegment({
      name: 'torso', amount: 'torso', start: [pelvis[0], yHips, pelvis[2]], end: [pelvis[0], yTop, pelvis[2]],
      free: [[root, 0], ...spineLine.map((k) => [k] as const), [joints.hipL], [joints.hipR]], fixed: [],
    });
  }
  addSegment({ name: 'neck', amount: 'neck', start: J(joints.neck), end: J(headBone), free: [[joints.neck]], fixed: [[headBone, 1]] });
  const armFade: readonly [number, number] = [ARM_FADE_FROM / metresPerUnit, ARM_FADE_TO / metresPerUnit];
  for (const [side, shoulder, elbow, wrist] of [['L', joints.shoulderL, joints.elbowL, joints.wristL], ['R', joints.shoulderR, joints.elbowR, joints.wristR]] as const) {
    const atElbow = mitre(shoulder, elbow, wrist);
    addSegment({
      name: `upperArm ${side}`, amount: 'upperArm', start: J(shoulder), end: J(elbow), endPlane: atElbow,
      fade: armFade, free: [[shoulder], [elbow]], fixed: [],
    });
    // the same for the shoulder bone's weight below her elbow (3.44× / 0.13× at the elbow before, 2.28× / 0.42× after)
    addSegment({ name: `forearm ${side}`, amount: 'forearm', start: J(elbow), end: J(wrist), startPlane: atElbow, free: [[shoulder, 0], [elbow]], fixed: [[wrist, 1]] });
  }
  const shoulderFade: readonly [number, number] = [SHOULDER_FADE_FROM / metresPerUnit, SHOULDER_FADE_TO / metresPerUnit];
  for (const [side, shoulder] of [['L', joints.shoulderL], ['R', joints.shoulderR]] as const) {
    const collar = parent[shoulder];
    if (collar < 0) throw new Error(`body build: the ${side} shoulder has no collarbone above it`);
    const c = J(collar);
    const dx = J(shoulder)[0] - c[0];
    // The collarbone AND the spine line are free (f 0), and the field fades with distance from the collarbone's line:
    // whole within 14 cm of it, gone by 24. A free collarbone alone tore the back of each shoulder blade, where her skin
    // jumps from spine weight to collarbone weight between vertices 0.6 mm apart (26.6× at +10 cm); with neither free,
    // the shoulder bone's own weight blend creased the back of the armpit (3.68× / 0.14×). With both, the upper back
    // and chest widen by position and the armpit's fold follows the arm (2.09× / 0.47×); her breasts and waist are
    // past the fade.
    addSegment({
      name: `shoulders ${side}`, amount: 'shoulders', share: 0.5, start: c, end: [c[0] + dx, c[1], c[2]], fade: shoulderFade,
      free: [[collar, 0], [root, 0], ...spineLine.map((k) => [k, 0] as const)], fixed: [[shoulder, 1]],
    });
  }

  // ── girth regions
  const mask = (list: readonly number[]): Uint8Array => { const m = new Uint8Array(n); for (const k of list) m[k] = 1; return m; };
  const ySpine = J(joints.spine)[1];
  const thigh = (len(sub(J(joints.kneeL), J(joints.hipL))) + len(sub(J(joints.kneeR), J(joints.hipR)))) / 2;
  const girths: BuildGirthFrame[] = [
    {
      // the hips' weight reaches up to 1.12 m on her, so without them the lower sides of her waist did not widen and
      // the waist ended in a hard edge; down to the hips' height, the change is broad and gentle
      amount: 'waist', peak: ySpine, top: yTop, bottom: yHips,
      xc: J(joints.pelvis)[0], zc: J(joints.spine)[2], ezBack: 0.6, ezFront: 0.5,
      member: mask([root, ...spineLine, joints.hipL, joints.hipR]),
    },
    {
      amount: 'hips', peak: yHips, top: ySpine, bottom: yHips - 0.5 * thigh,
      xc: J(joints.pelvis)[0], zc: J(joints.pelvis)[2], ezBack: 0.4, ezFront: 0.25,
      member: mask([root, joints.pelvis, joints.spine, joints.hipL, joints.hipR]),
    },
  ];

  // ── the hands' and feet's size ramps
  const ramps: BuildSizeRamp[] = [];
  for (const [elbow, wrist] of [[joints.elbowL, joints.wristL], [joints.elbowR, joints.wristR]] as const) {
    ramps.push({ amount: 'hands', joint: J(wrist), axis: unit(sub(J(wrist), J(elbow))), reach: HAND_RAMP / metresPerUnit, limb: subtreeOf(elbow), scaled: subtreeOf(wrist) });
  }
  for (const [knee, ankle] of [[joints.kneeL, joints.ankleL], [joints.kneeR, joints.ankleR]] as const) {
    ramps.push({ amount: 'feet', joint: J(ankle), axis: unit(sub(J(ankle), J(knee))), reach: FOOT_RAMP / metresPerUnit, limb: subtreeOf(knee), scaled: subtreeOf(ankle) });
  }

  // ── the body's extent and her soles
  const vertices = Math.floor(basePos.length / 3);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let v = 0; v < vertices; v += 1) {
    const y = basePos[3 * v + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const skin = influences(body);
  const feet: BuildFoot[] = [joints.ankleL, joints.ankleR].map((ankle) => {
    const foot = subtreeOf(ankle);
    let soleY = Infinity;
    for (let v = 0; v < Math.min(vertices, skin.count); v += 1) {
      let w = 0;
      for (let j = 0; j < 4; j += 1) {
        const b = skin.index[4 * v + j];
        if (b >= 0 && b < n && foot[b] === 1) w += skin.weight[4 * v + j];
      }
      if (w > 0.5 && basePos[3 * v + 1] < soleY) soleY = basePos[3 * v + 1];
    }
    if (!Number.isFinite(soleY)) soleY = J(ankle)[1];
    return { ankle, ankleY: J(ankle)[1], soleY };
  });
  const soleY = Math.min(feet[0].soleY, feet[1].soleY);

  // ── the measure, metres
  const mpu = metresPerUnit;
  const segmentMeasure = (key: BuildSegment): BuildSegmentMeasure => {
    const mine = segments.filter((s) => s.amount === key);
    let length = 0;
    let rise = 0;
    for (const s of mine) { length += s.length * mpu; rise += Math.abs(s.axis[1]); }
    return { length: length / mine.length, rise: rise / mine.length };
  };
  const measureSegments = {} as Record<BuildSegment, BuildSegmentMeasure>;
  for (const key of SEGMENT_KEYS) measureSegments[key] = segmentMeasure(key);
  const measure: BuildMeasure = {
    segments: measureSegments,
    shoulderSpan: segments.filter((s) => s.amount === 'shoulders').reduce((sum, s) => sum + s.length * mpu, 0),
    height: (maxY - minY) * mpu,
    crownAboveHead: (maxY - J(headBone)[1]) * mpu,
    soleBelowAnkle: ((feet[0].ankleY + feet[1].ankleY) / 2 - soleY) * mpu,
  };

  const restPosition = new Float64Array(3 * n);
  const restScale = new Float64Array(3 * n);
  for (let i = 0; i < n; i += 1) {
    restPosition[3 * i] = bones[i].position.x; restPosition[3 * i + 1] = bones[i].position.y; restPosition[3 * i + 2] = bones[i].position.z;
    restScale[3 * i] = bones[i].scale.x; restScale[3 * i + 1] = bones[i].scale.y; restScale[3 * i + 2] = bones[i].scale.z;
  }

  return {
    measure, metresPerUnit, bones, index, parent, joint, segments, girths, ramps,
    headBone, wrists: [joints.wristL, joints.wristR], ankles: [joints.ankleL, joints.ankleR], feet, soleY,
    restPosition, restScale, toLocal, bindMatrixInverse: bindInverse, offsets: new Float64Array(3 * n),
  };
}

/** A segment instance's ΔL in geometry units. */
function segmentAmount(rig: BuildRig, s: BuildSegmentFrame, amounts: BuildAmounts): number {
  const metres = s.amount === 'shoulders' ? amounts.shoulders : amounts.add[s.amount];
  return (metres * s.share) / rig.metresPerUnit;
}

/**
 * Every bone's rest offset in the body's geometry units, 3 per bone (into `out`, default the
 * rig's scratch). A bone with no parent bone is always 0 — nothing can move her root.
 */
export function buildBoneOffsets(rig: BuildRig, amounts: BuildAmounts, out: Float64Array = rig.offsets): Float64Array {
  out.fill(0);
  const n = rig.bones.length;
  for (const s of rig.segments) {
    const dl = segmentAmount(rig, s, amounts);
    if (dl === 0) continue;
    const ux = dl * s.axis[0], uy = dl * s.axis[1], uz = dl * s.axis[2];
    for (let k = 0; k < n; k += 1) {
      const f = s.f[k];
      if (f === 0) continue;
      out[3 * k] += f * ux; out[3 * k + 1] += f * uy; out[3 * k + 2] += f * uz;
    }
  }
  return out;
}

/**
 * Set every bone's local translation and scale from its rest plus the build. Never
 * accumulates; approved amounts restore the rest exactly. Call `updateMatrixWorld` after.
 */
export function applyBuildToBones(rig: BuildRig, amounts: BuildAmounts): void {
  const offsets = buildBoneOffsets(rig, amounts);
  const { bones, parent, restPosition: rp, restScale: rs, toLocal: A } = rig;
  for (let k = 0; k < bones.length; k += 1) {
    const p = parent[k];
    let dx = 0, dy = 0, dz = 0;
    if (p >= 0) {
      const ox = offsets[3 * k] - offsets[3 * p], oy = offsets[3 * k + 1] - offsets[3 * p + 1], oz = offsets[3 * k + 2] - offsets[3 * p + 2];
      if (ox !== 0 || oy !== 0 || oz !== 0) {
        const a = 9 * k;
        dx = A[a] * ox + A[a + 1] * oy + A[a + 2] * oz;
        dy = A[a + 3] * ox + A[a + 4] * oy + A[a + 5] * oz;
        dz = A[a + 6] * ox + A[a + 7] * oy + A[a + 8] * oz;
      }
    }
    // a zero offset writes the captured rest itself, so −0 and rounding can never creep in
    bones[k].position.set(
      dx === 0 ? rp[3 * k] : rp[3 * k] + dx,
      dy === 0 ? rp[3 * k + 1] : rp[3 * k + 1] + dy,
      dz === 0 ? rp[3 * k + 2] : rp[3 * k + 2] + dz,
    );
    bones[k].scale.set(rs[3 * k], rs[3 * k + 1], rs[3 * k + 2]);
  }
  size(rig, rig.headBone, amounts.head);
  size(rig, rig.wrists[0], amounts.hands); size(rig, rig.wrists[1], amounts.hands);
  size(rig, rig.ankles[0], amounts.feet); size(rig, rig.ankles[1], amounts.feet);
}

/** A uniform size about the bone's own origin; its children follow. */
function size(rig: BuildRig, k: number, factor: number): void {
  if (factor === 1) return;
  const rs = rig.restScale;
  rig.bones[k].scale.set(rs[3 * k] * factor, rs[3 * k + 1] * factor, rs[3 * k + 2] * factor);
}

/** Metres to raise her so her lower sole stays on the floor (0 when approved). */
export function standingLift(rig: BuildRig, amounts: BuildAmounts): number {
  let lowest = Infinity;
  for (const foot of rig.feet) {
    let oy = 0;
    for (const s of rig.segments) {
      const f = s.f[foot.ankle];
      if (f === 0) continue;
      const dl = segmentAmount(rig, s, amounts);
      if (dl !== 0) oy += dl * f * s.axis[1];
    }
    const sole = foot.soleY + oy + (amounts.feet - 1) * (foot.soleY - foot.ankleY);
    if (sole < lowest) lowest = sole;
  }
  return lowest === rig.soleY ? 0 : (rig.soleY - lowest) * rig.metresPerUnit;
}

// ------------------------------------------------------------------------------------------------------------------
// the mesh fields

/** Entries are 5 floats: a segment's [q, ∇q (mesh space), ·] or a girth's [m·g, m·g', rx, ry, rz] (r in mesh space). */
const STRIDE = 5;
/** Per region, 12 numbers: a segment's a = L⁻¹u, or a girth's L⁻¹·diag(1, 0, e_z)·L and Lᵀ·ŷ. */
const CONST = 12;
/** Size ramp records are 8 floats: [group (1 hands, 2 feet), h − W, r = p − joint (3), ∇h (3)], mesh space. */
const RAMP = 8;

export interface BuildMeshFields {
  /** How many vertices the build can move. */
  readonly vertices: number;
  readonly rig: BuildRig;
  /** Vertex index of each slot. */
  readonly slotVertex: Uint32Array;
  /** Entries of slot s are [slotStart[s], slotStart[s + 1]). */
  readonly slotStart: Uint32Array;
  /** Region id of each entry: segments first (rig.segments order), then for each girth its front and its back. */
  readonly entryRegion: Uint8Array;
  readonly entry: Float32Array;
  readonly regionConst: Float64Array;
  /**
   * Per slot, 3 numbers: the vertex's weight on the head, the hands and the feet (the bones a size scales, and their
   * subtrees). A size multiplies whatever the field adds under those bones, so the field is divided by
   * 1 + Σ W·(size − 1) to land where it would at size 1.
   */
  readonly slotSize: Float32Array;
  /** Per slot, its size ramp record, or −1. */
  readonly slotRamp: Int32Array;
  readonly ramp: Float32Array;
  /** Scratch: this apply's amount per region. */
  readonly regionAmount: Float64Array;
}

/**
 * Precompute what the build can do to `mesh` (any skinned mesh on the rig's skeleton or one
 * sharing its bones). `basePos` is its approved rest positions, geometry units, 3 per vertex.
 * `girthRef`, when given, is her SLIM rest shape for the same vertices (the room passes base +
 * the `belly` morph at weight 1): the waist and hips read their offsets and heights from it.
 */
export function buildMeshFields(rig: BuildRig, mesh: THREE.SkinnedMesh, basePos: Float32Array, girthRef?: Float32Array): BuildMeshFields {
  const segs = rig.segments;
  const girths = rig.girths;
  const ramps = rig.ramps;
  const nSeg = segs.length;
  const nRegion = nSeg + 2 * girths.length;
  if (nRegion > 32) throw new Error('body build: too many regions for a 32-bit mask');

  // mesh geometry → body geometry: X = inverse(body.bindMatrix) · mesh.bindMatrix
  const X = rig.bindMatrixInverse.clone().multiply(mesh.bindMatrix);
  const L = linear(X);
  const Linv = linear(X.clone().invert());
  const LT = transpose(L);
  const identity = X.equals(new THREE.Matrix4());
  const e = X.elements;

  const regionConst = new Float64Array(CONST * nRegion);
  for (let r = 0; r < nSeg; r += 1) regionConst.set(mulV(Linv, segs[r].axis), CONST * r);
  for (let g = 0; g < girths.length; g += 1) {
    for (const back of [0, 1]) {
      const ez = back === 1 ? girths[g].ezBack : girths[g].ezFront;
      const r = nSeg + 2 * g + back;
      regionConst.set(mul3(Linv, mul3([1, 0, 0, 0, 0, 0, 0, 0, ez], L)), CONST * r);
      regionConst.set(mulV(LT, [0, 1, 0]), CONST * r + 9);
    }
  }

  // which regions each rig bone can put a vertex in
  const nb = rig.bones.length;
  const regionsOf = new Uint32Array(nb);
  for (let r = 0; r < nSeg; r += 1) for (let k = 0; k < nb; k += 1) if (segs[r].free[k] === 1) regionsOf[k] |= 1 << r;
  for (let g = 0; g < girths.length; g += 1) for (let k = 0; k < nb; k += 1) if (girths[g].member[k] === 1) regionsOf[k] |= 3 << (nSeg + 2 * g);
  const rampsOf = new Uint32Array(nb);
  for (let i = 0; i < ramps.length; i += 1) for (let k = 0; k < nb; k += 1) if (ramps[i].limb[k] === 1) rampsOf[k] |= 1 << i;

  // which size group (1 head, 2 hands, 3 feet) each rig bone is scaled with
  const sizeGroup = new Uint8Array(nb);
  const groupTops: readonly (readonly [number, number])[] = [[rig.headBone, 1], [rig.wrists[0], 2], [rig.wrists[1], 2], [rig.ankles[0], 3], [rig.ankles[1], 3]];
  for (let k = 0; k < nb; k += 1) {
    for (let a = k; a >= 0 && sizeGroup[k] === 0; a = rig.parent[a]) for (const [top, group] of groupTops) if (a === top) sizeGroup[k] = group;
  }

  const map = mesh.skeleton.bones.map((b) => rig.index.get(b) ?? -1);
  const skin = influences(mesh);
  const count = Math.min(skin.count, Math.floor(basePos.length / 3));
  const ref = girthRef !== undefined && girthRef.length >= 3 * count ? girthRef : basePos;

  const slotVertex: number[] = [];
  const slotStart: number[] = [0];
  const entryRegion: number[] = [];
  const entry: number[] = [];
  const slotSize: number[] = [];
  const slotRamp: number[] = [];
  const ramp: number[] = [];
  const bone = new Int32Array(4);
  const weight = new Float64Array(4);
  const sized = new Float64Array(4);
  const toBody = (src: Float32Array, v: number): [number, number, number] => {
    const mx = src[3 * v], my = src[3 * v + 1], mz = src[3 * v + 2];
    if (identity) return [mx, my, mz];
    return [e[0] * mx + e[4] * my + e[8] * mz + e[12], e[1] * mx + e[5] * my + e[9] * mz + e[13], e[2] * mx + e[6] * my + e[10] * mz + e[14]];
  };
  const toMeshGrad = (gx: number, gy: number, gz: number): [number, number, number] => identity ? [gx, gy, gz] : mulV(LT, [gx, gy, gz]);
  const toMeshVec = (vx: number, vy: number, vz: number): [number, number, number] => identity ? [vx, vy, vz] : mulV(Linv, [vx, vy, vz]);

  for (let v = 0; v < count; v += 1) {
    let mask = 0;
    let rampMask = 0;
    for (let j = 0; j < 4; j += 1) {
      const w = skin.weight[4 * v + j];
      const m = skin.index[4 * v + j];
      const k = w > 0 && m >= 0 && m < map.length ? map[m] : -1;
      bone[j] = k; weight[j] = k >= 0 ? w : 0;
      if (k >= 0) { mask |= regionsOf[k]; rampMask |= rampsOf[k]; }
    }
    if (mask === 0 && rampMask === 0) continue;
    const [px, py, pz] = toBody(basePos, v);
    const before = entryRegion.length;

    for (let r = 0; r < nSeg; r += 1) {
      if ((mask & (1 << r)) === 0) continue;
      const s = segs[r];
      // T and ∇T, inline: this loop runs a dozen times for each of her 116k vertices
      const ox = px - s.start[0], oy = py - s.start[1], oz = pz - s.start[2];
      const b = ox * s.startNormal[0] + oy * s.startNormal[1] + oz * s.startNormal[2];
      const rr = (s.end[0] - px) * s.endNormal[0] + (s.end[1] - py) * s.endNormal[1] + (s.end[2] - pz) * s.endNormal[2];
      let T = 0, tx = 0, ty = 0, tz = 0;
      if (b > 0) {
        if (rr <= 0) T = 1;
        else {
          const l = b + rr, l2 = l * l;
          T = b / l;
          tx = (s.startNormal[0] * rr + s.endNormal[0] * b) / l2;
          ty = (s.startNormal[1] * rr + s.endNormal[1] * b) / l2;
          tz = (s.startNormal[2] * rr + s.endNormal[2] * b) / l2;
        }
      }
      let q = 0, W = 0;
      for (let j = 0; j < 4; j += 1) {
        const k = bone[j];
        if (k < 0 || s.free[k] === 0) continue;
        q += weight[j] * (T - s.f[k]);
        W += weight[j];
      }
      let gx = W * tx, gy = W * ty, gz = W * tz;
      if (s.fade !== null && q !== 0) {
        // the field fades with distance from the axis: q·ψ(d), ∇ = ψ∇q + q∇ψ
        const along = ox * s.axis[0] + oy * s.axis[1] + oz * s.axis[2];
        const dx = ox - along * s.axis[0], dy = oy - along * s.axis[1], dz = oz - along * s.axis[2];
        const d = Math.hypot(dx, dy, dz);
        const [from, to] = s.fade;
        if (d >= to) { q = 0; gx = 0; gy = 0; gz = 0; }
        else if (d > from) {
          const x = (d - from) / (to - from);
          const psi = 1 - x * x * (3 - 2 * x);
          const dpsi = -6 * x * (1 - x) / ((to - from) * d);
          gx = psi * gx + q * dpsi * dx; gy = psi * gy + q * dpsi * dy; gz = psi * gz + q * dpsi * dz;
          q *= psi;
        }
      }
      if (q === 0 && gx === 0 && gy === 0 && gz === 0) continue;
      const g = toMeshGrad(gx, gy, gz);
      entryRegion.push(r);
      entry.push(q, g[0], g[1], g[2], 0);
    }
    if (mask >>> nSeg !== 0) {
      const [rx, ry, rz] = ref === basePos ? [px, py, pz] : toBody(ref, v);
      for (let g = 0; g < girths.length; g += 1) {
        const r = nSeg + 2 * g;
        if ((mask & (1 << r)) === 0) continue;
        const G = girths[g];
        let m = 0;
        for (let j = 0; j < 4; j += 1) { const k = bone[j]; if (k >= 0 && G.member[k] === 1) m += weight[j]; }
        if (m === 0) continue;
        const [gv, dg] = profile(ry, G);
        if (gv === 0 && dg === 0) continue;
        const back = rz < G.zc ? 1 : 0;
        const rm = toMeshVec(rx - G.xc, 0, (back === 1 ? G.ezBack : G.ezFront) * (rz - G.zc));
        entryRegion.push(r + back);
        entry.push(m * gv, m * dg, rm[0], rm[1], rm[2]);
      }
    }

    sized.fill(0);
    for (let j = 0; j < 4; j += 1) if (bone[j] >= 0) sized[sizeGroup[bone[j]]] += weight[j];
    let rampAt = -1;
    for (let i = 0; i < ramps.length && rampAt < 0; i += 1) {
      if ((rampMask & (1 << i)) === 0) continue;
      const R = ramps[i];
      let M = 0, W = 0;
      for (let j = 0; j < 4; j += 1) {
        const k = bone[j];
        if (k < 0) continue;
        if (R.limb[k] === 1) M += weight[j];
        if (R.scaled[k] === 1) W += weight[j];
      }
      const ox = px - R.joint[0], oy = py - R.joint[1], oz = pz - R.joint[2];
      const a = ox * R.axis[0] + oy * R.axis[1] + oz * R.axis[2];
      let h = 0, dh = 0;
      if (a >= 0) h = 1;
      else if (a > -R.reach) { const x = 1 + a / R.reach; h = x * x * (3 - 2 * x); dh = 6 * x * (1 - x) / R.reach; }
      h *= M; dh *= M;
      if (h === W && dh === 0) continue;
      const rm = toMeshVec(ox, oy, oz);
      const gm = toMeshGrad(dh * R.axis[0], dh * R.axis[1], dh * R.axis[2]);
      rampAt = ramp.length / RAMP;
      ramp.push(R.amount === 'hands' ? 1 : 2, h - W, rm[0], rm[1], rm[2], gm[0], gm[1], gm[2]);
    }

    if (entryRegion.length === before && rampAt < 0) continue;
    slotVertex.push(v);
    slotStart.push(entryRegion.length);
    slotSize.push(sized[1], sized[2], sized[3]);
    slotRamp.push(rampAt);
  }

  return {
    vertices: slotVertex.length,
    rig,
    slotVertex: Uint32Array.from(slotVertex),
    slotStart: Uint32Array.from(slotStart),
    entryRegion: Uint8Array.from(entryRegion),
    entry: Float32Array.from(entry),
    regionConst,
    slotSize: Float32Array.from(slotSize),
    slotRamp: Int32Array.from(slotRamp),
    ramp: Float32Array.from(ramp),
    regionAmount: new Float64Array(nRegion),
  };
}

/**
 * Add the build's change to `position` and turn `normal` to match. Both already hold the
 * base shape plus every other field (the caller resets them from base, then calls this once).
 * `normalized`: unit normals out; otherwise each changed normal keeps its own length. Approved
 * amounts touch nothing, and so does a head size on its own. Allocates nothing.
 */
export function applyBuildToMesh(fields: BuildMeshFields, amounts: BuildAmounts, position: Float32Array, normal: Float32Array | null, normalized: boolean): void {
  const rig = fields.rig;
  const segs = rig.segments;
  const nSeg = segs.length;
  const amount = fields.regionAmount;
  let any = false;
  for (let r = 0; r < nSeg; r += 1) {
    const a = segmentAmount(rig, segs[r], amounts);
    amount[r] = a;
    if (a !== 0) any = true;
  }
  for (let g = 0; g < rig.girths.length; g += 1) {
    const a = rig.girths[g].amount === 'waist' ? amounts.waist : amounts.hips;
    amount[nSeg + 2 * g] = a; amount[nSeg + 2 * g + 1] = a;
    if (a !== 0) any = true;
  }
  const head = amounts.head - 1, hands = amounts.hands - 1, feet = amounts.feet - 1;
  if (!any && hands === 0 && feet === 0) return;

  const { slotVertex, slotStart, entryRegion, entry, regionConst: K, slotSize, slotRamp, ramp } = fields;
  const sized = head !== 0 || hands !== 0 || feet !== 0;
  for (let s = 0; s < slotVertex.length; s += 1) {
    const e1 = slotStart[s + 1];
    let moved = false;
    let dx = 0, dy = 0, dz = 0;
    let g00 = 0, g01 = 0, g02 = 0, g10 = 0, g11 = 0, g12 = 0, g20 = 0, g21 = 0, g22 = 0;
    for (let i = slotStart[s]; i < e1; i += 1) {
      const r = entryRegion[i];
      const amt = amount[r];
      if (amt === 0) continue;
      moved = true;
      const o = STRIDE * i;
      const k = CONST * r;
      if (r < nSeg) {
        // D = ΔL·q·a ;  F += ΔL·a⊗∇q
        const dq = amt * entry[o];
        const ax = K[k], ay = K[k + 1], az = K[k + 2];
        dx += dq * ax; dy += dq * ay; dz += dq * az;
        const bx = amt * entry[o + 1], by = amt * entry[o + 2], bz = amt * entry[o + 3];
        g00 += ax * bx; g01 += ax * by; g02 += ax * bz;
        g10 += ay * bx; g11 += ay * by; g12 += ay * bz;
        g20 += az * bx; g21 += az * by; g22 += az * bz;
      } else {
        // D = σ·m·g·r ;  F += σ·(m·g·Diag + r⊗(m·g'·Lᵀŷ))
        const mg = amt * entry[o];
        const rx = entry[o + 2], ry = entry[o + 3], rz = entry[o + 4];
        dx += mg * rx; dy += mg * ry; dz += mg * rz;
        g00 += mg * K[k]; g01 += mg * K[k + 1]; g02 += mg * K[k + 2];
        g10 += mg * K[k + 3]; g11 += mg * K[k + 4]; g12 += mg * K[k + 5];
        g20 += mg * K[k + 6]; g21 += mg * K[k + 7]; g22 += mg * K[k + 8];
        const md = amt * entry[o + 1];
        if (md !== 0) {
          const yx = md * K[k + 9], yy = md * K[k + 10], yz = md * K[k + 11];
          g00 += rx * yx; g01 += rx * yy; g02 += rx * yz;
          g10 += ry * yx; g11 += ry * yy; g12 += ry * yz;
          g20 += rz * yx; g21 += rz * yy; g22 += rz * yz;
        }
      }
    }
    // a hand's or a foot's size ramp: the bones scale the vertex by its weight W; the ramp wants h
    let extra = 0;
    const ri = slotRamp[s];
    if (ri >= 0) {
      const o = RAMP * ri;
      const k = ramp[o] === 1 ? hands : feet;
      if (k !== 0) {
        moved = true;
        const kd = k * ramp[o + 1];
        const rx = ramp[o + 2], ry = ramp[o + 3], rz = ramp[o + 4];
        dx += kd * rx; dy += kd * ry; dz += kd * rz;
        const hx = k * ramp[o + 5], hy = k * ramp[o + 6], hz = k * ramp[o + 7];
        g00 += rx * hx; g01 += rx * hy; g02 += rx * hz;
        g10 += ry * hx; g11 += ry * hy; g12 += ry * hz;
        g20 += rz * hx; g21 += rz * hy; g22 += rz * hz;
        extra = kd;
      }
    }
    if (!moved) continue;
    if (sized) {
      // the bones a size scales would scale the field too: divide the move by the vertex's blended scale, and the
      // gradient by the scale the vertex ends up with (its ramp's, where it has one)
      const grow = 1 + slotSize[3 * s] * head + slotSize[3 * s + 1] * hands + slotSize[3 * s + 2] * feet;
      const ends = grow + extra;
      if (grow !== 1 && grow > 1e-6) { const inv = 1 / grow; dx *= inv; dy *= inv; dz *= inv; }
      if (ends !== 1 && ends > 1e-6) {
        const inv = 1 / ends;
        g00 *= inv; g01 *= inv; g02 *= inv; g10 *= inv; g11 *= inv; g12 *= inv; g20 *= inv; g21 *= inv; g22 *= inv;
      }
    }
    const v = 3 * slotVertex[s];
    position[v] += dx; position[v + 1] += dy; position[v + 2] += dz;
    if (normal === null) continue;
    // n' ∝ F⁻ᵀ·n = cof(F)·n / det(F)
    const a = 1 + g00, b = g01, c = g02, d = g10, e = 1 + g11, f = g12, g = g20, h = g21, k = 1 + g22;
    const c00 = e * k - f * h, c01 = f * g - d * k, c02 = d * h - e * g;
    const det = a * c00 + b * c01 + c * c02;
    if (!(det > 1e-6)) continue;
    const c10 = c * h - b * k, c11 = a * k - c * g, c12 = b * g - a * h;
    const c20 = b * f - c * e, c21 = c * d - a * f, c22 = a * e - b * d;
    const nx = normal[v], ny = normal[v + 1], nz = normal[v + 2];
    const mx = c00 * nx + c01 * ny + c02 * nz;
    const my = c10 * nx + c11 * ny + c12 * nz;
    const mz = c20 * nx + c21 * ny + c22 * nz;
    const out = Math.hypot(mx, my, mz);
    if (!(out > 0)) continue;
    const scale = (normalized ? 1 : Math.hypot(nx, ny, nz)) / out;
    normal[v] = mx * scale; normal[v + 1] = my * scale; normal[v + 2] = mz * scale;
  }
}
