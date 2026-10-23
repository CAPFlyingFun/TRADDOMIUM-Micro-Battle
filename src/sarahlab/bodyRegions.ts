/**
 * HER BODY, MAPPED FOR PAINTING (Joshua, 2026-10-20: "map out regions for body painting... arms, legs, belly, neck,
 * head, chest"; then the region list and clothing templates of his design note: "editing regions, not necessarily
 * separate meshes... a stable surface-attached region mapping rather than selecting vertices solely by their current
 * world position").
 *
 * The map is worked out ONCE, on her REST surface in the skeleton's bind space, and stored per vertex; after that it
 * is a property of the vertex and moves with it through every morph, slider and pose. Nothing in her file changes.
 *
 * Two things a vertex carries:
 *
 * 1. A REGION. Limbs come from her skin: the bone that weighs most on the vertex, followed up the skeleton to the
 *    nearest of the seventeen named joints, says which limb and which side. Along the limb, the vertex's place on the
 *    bone line (below) says which part -- upper thigh, knee, calf, foot -- so the knee band sits around the knee joint
 *    whatever the weights do. The torso is divided by height on her trunk, front from back by the rest normal
 *    (her skin gives the belly to the pelvis bone and the breasts to the spine, so bones alone could not do it), and
 *    the head by distance from the neck's own axis, so the chin is face and not neck.
 *
 * 2. CONTINUOUS COORDINATES the clothing templates read (`paintTemplates.ts`): `trunk` (0 at her hip joints, 1 at the
 *    base of her neck), `leg` (0 at the hip joint, 1 at the ankle, along that leg), `arm` (0 at the shoulder, 1 at the
 *    wrist). A template is a set of ranges over these, which is why its edges are smooth curves around her instead of
 *    the triangles' sawtooth, why a hem or a sleeve can slide to any length, and why the same template fits Lena or
 *    anyone on the same base model whatever her proportions: the coordinates are fractions of her own bones.
 *
 * Pure arithmetic over plain arrays; nothing here reads a mesh or the GPU.
 */
import type { HumanJointName, HumanJoints } from '../actor/humanRig';

export interface BodyRegion { readonly id: string; readonly name: string; readonly side: 'L' | 'R' | null; readonly tint: readonly [number, number, number] }

/** Region 0 is "none"; a vertex's region is its index here plus one. Sides are hers. */
export const BODY_REGIONS: readonly BodyRegion[] = Object.freeze(([
  ['face', 'Face', null, [1.0, 0.95, 0.35]],
  ['scalp', 'Scalp', null, [0.8, 0.65, 0.2]],
  ['neck', 'Neck', null, [1.0, 0.42, 0.0]],
  ['chest', 'Chest', null, [0.9, 0.2, 0.3]],
  ['upperBack', 'Upper back', null, [0.55, 0.3, 0.75]],
  ['belly', 'Belly', null, [1.0, 0.55, 0.8]],
  ['lowerBack', 'Lower back', null, [0.35, 0.35, 0.9]],
  ['hips', 'Hips', null, [0.25, 0.85, 0.85]],
  ['seat', 'Seat', null, [0.1, 0.5, 0.55]],
  ['crotch', 'Crotch', null, [0.1, 0.7, 0.4]],
  ['upperArmL', 'Shoulder & upper arm', 'L', [0.3, 0.8, 0.4]],
  ['upperArmR', 'Shoulder & upper arm', 'R', [0.22, 0.65, 0.3]],
  ['forearmL', 'Forearm', 'L', [0.2, 0.6, 0.95]],
  ['forearmR', 'Forearm', 'R', [0.15, 0.45, 0.8]],
  ['handL', 'Hand', 'L', [0.95, 0.95, 0.45]],
  ['handR', 'Hand', 'R', [0.8, 0.8, 0.3]],
  ['thighL', 'Upper thigh', 'L', [0.95, 0.5, 0.2]],
  ['thighR', 'Upper thigh', 'R', [0.8, 0.38, 0.12]],
  ['kneeL', 'Knee', 'L', [0.95, 0.85, 0.75]],
  ['kneeR', 'Knee', 'R', [0.8, 0.7, 0.6]],
  ['calfL', 'Calf & ankle', 'L', [0.7, 0.45, 0.95]],
  ['calfR', 'Calf & ankle', 'R', [0.55, 0.33, 0.8]],
  ['footL', 'Foot', 'L', [0.65, 0.65, 0.65]],
  ['footR', 'Foot', 'R', [0.42, 0.42, 0.42]],
] as const).map(([id, name, side, tint]) => Object.freeze({ id, name, side, tint })));

export const regionNumber = (id: string): number => BODY_REGIONS.findIndex((r) => r.id === id) + 1;

/** What the editor offers: a region, or both sides of one, picked by the side switch. */
export interface RegionGroup { readonly id: string; readonly name: string; readonly regions: readonly string[]; readonly sided: boolean }
export const REGION_GROUPS: readonly RegionGroup[] = Object.freeze(([
  ['face', 'FACE', ['face']], ['scalp', 'SCALP', ['scalp']], ['neck', 'NECK', ['neck']],
  ['chest', 'CHEST', ['chest']], ['upperBack', 'UPPER BACK', ['upperBack']], ['belly', 'BELLY', ['belly']], ['lowerBack', 'LOWER BACK', ['lowerBack']],
  ['hips', 'HIPS', ['hips']], ['seat', 'SEAT', ['seat']], ['crotch', 'CROTCH', ['crotch']],
  ['upperArms', 'SHOULDERS & UPPER ARMS', ['upperArmL', 'upperArmR']], ['forearms', 'FOREARMS', ['forearmL', 'forearmR']], ['hands', 'HANDS', ['handL', 'handR']],
  ['thighs', 'UPPER THIGHS', ['thighL', 'thighR']], ['knees', 'KNEES', ['kneeL', 'kneeR']], ['calves', 'CALVES & ANKLES', ['calfL', 'calfR']], ['feet', 'FEET', ['footL', 'footR']],
] as const).map(([id, name, regions]) => Object.freeze({ id, name, regions, sided: regions.length === 2 })));

export type RegionSide = 'both' | 'L' | 'R';
/** The region numbers a group covers on the chosen side. */
export function groupRegions(group: RegionGroup, side: RegionSide): number[] {
  return group.regions.filter((id) => side === 'both' || !group.sided || BODY_REGIONS[regionNumber(id) - 1].side === side).map(regionNumber);
}
/** The group a region belongs to (what a tap on her selects). */
export const groupOf = (region: number): RegionGroup | null => REGION_GROUPS.find((g) => g.regions.includes(BODY_REGIONS[region - 1]?.id ?? '')) ?? null;

/**
 * The lines the map is drawn by, as fractions of her own trunk (hip joints 0, base of the neck 1) or of a limb (its
 * top joint 0, its end joint 1). Measured on Sarah at 100% from the front, side and back (docs/reviews/sarah-fabric).
 */
export const MAP_LINES = Object.freeze({
  underbust: 0.6, pubic: -0.05, shoulderBlades: 0.62, seat: 0.02, gluteal: -0.08,
  /** half-width of the crotch, as a fraction of the distance between her hip joints */
  crotchHalfWidth: 0.42,
  /** the knee band around the knee joint, and the elbow line, as fractions of the limb */
  kneeHalf: 0.07,
  /** skin within this many times the neck's median radius of the neck axis is neck, not face... */
  neckReach: 1.18,
  /** ...up to the jaw at the front and the hairline at the back, as fractions of the way from the neck joint to the
   * head joint (her head joint is at eye level) */
  neckTopFront: 0.45, neckTopBack: 0.72,
  /** above this fraction of the way from the head joint to the crown, or facing back, the head is scalp */
  scalpFrom: 0.55, faceFacing: 0.25,
  /** skin facing sideways (|normal z| below this) is front or back by where it stands against her spine instead */
  sideways: 0.35,
  /** how far in front of the spine line her side seam runs, as a fraction of her trunk */
  seamAhead: 0.06,
});

export interface BodyMapInput {
  /** Four bone indices and four weights a vertex (the skin's own `skinIndex` / `skinWeight`). */
  readonly skinIndex: ArrayLike<number>;
  readonly skinWeight: ArrayLike<number>;
  /** Each bone's parent (-1 for the root), in the skeleton's bone order. */
  readonly parents: ArrayLike<number>;
  readonly joints: HumanJoints;
  /** Each named joint's position, in the bind space the positions below are in. */
  readonly jointAt: Readonly<Record<HumanJointName, readonly [number, number, number]>>;
  /** Rest positions and normals, three a vertex, in bind space. */
  readonly restPosition: ArrayLike<number>;
  readonly restNormal: ArrayLike<number>;
}

/** The map: per vertex, its region and its place on her trunk and limbs (NaN off that limb). */
export interface BodyMap {
  readonly region: Uint8Array;
  readonly trunk: Float32Array;
  readonly leg: Float32Array;
  readonly arm: Float32Array;
  /** -1 her right, +1 her left, 0 the midline (torso, head). */
  readonly side: Int8Array;
  /** +1 facing her front, -1 her back. */
  readonly front: Int8Array;
  /** Distance from her midline as a fraction of hip-joint spacing; for the crotch and a template's side seams. */
  readonly across: Float32Array;
  /** Distance from her neck's axis, across (ignoring height), in neck radii: where a neckline opens. */
  readonly collar: Float32Array;
  /**
   * How far in front of her neck's axis each vertex is, in neck radii (negative behind it), by where it is: what a
   * neckline's front is told apart by. Optional: a map made without it (a test's) is told apart by `front`.
   */
  readonly forward?: Float32Array;
  /** Distance from her neck's axis sideways only, in neck radii: where a strap runs over her shoulder. */
  readonly lateral: Float32Array;
  /**
   * Where the vertex stands AROUND her, smoothly: 1 at the middle of her front, 0 at the middle of her back, 0.5 at her
   * sides. A template blends its front and back lines by it, so a waistband or a hem curves round her hips like a
   * real one instead of stepping where the front meets the back.
   */
  readonly around: Float32Array;
  /** Her trunk's length (hip joints to the base of the neck) in the positions' own units: what a "fraction" is of. */
  readonly trunkLength: number;
  /** Her neck's radius, in the same units: what `collar` and `lateral` count in. */
  readonly neckRadius: number;
  /** The distance between her hip joints, in the same units: what `across` counts in. */
  readonly hipSpan: number;
  /** How squarely the skin faces sideways at rest (|normal x|, 0 to 1): the insides of her thighs, where they meet. */
  readonly sideFacing: Float32Array;
  /** How squarely the skin faces up or down at rest (|normal y|, 0 to 1): where a height changes slowly across her. */
  readonly upFacing: Float32Array;
  /**
   * For her legs' skin, where it stands round its OWN thigh, as `around` is round her trunk: 1 the front of the thigh,
   * 0 its back, 0.5 its sides; NaN off her legs. `around` is measured round her spine, which puts the front of her
   * thigh -- well out to the side of it -- at her side; a leg opening goes round the leg, so it asks this.
   */
  readonly legAround: Float32Array;
  /** Which way she faces along z in the rest pose: +1 or -1. */
  readonly facing: number;
  /** The vertex at each vertex's mirror image across her midline (for MIRROR); -1 where none was found. */
  readonly mirror: Int32Array;
}

const LIMB_OF: Partial<Record<HumanJointName, 'armL' | 'armR' | 'legL' | 'legR' | 'head'>> = {
  head: 'head', shoulderL: 'armL', elbowL: 'armL', wristL: 'armL', shoulderR: 'armR', elbowR: 'armR', wristR: 'armR',
  hipL: 'legL', kneeL: 'legL', ankleL: 'legL', hipR: 'legR', kneeR: 'legR', ankleR: 'legR',
};

type V3 = readonly [number, number, number];
/** Where p falls along a → b: 0 at a, 1 at b. */
function along(p: V3, a: V3, b: V3): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l2 = dx * dx + dy * dy + dz * dz || 1;
  return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / l2;
}
function distanceToLine(p: V3, a: V3, b: V3): number {
  const t = along(p, a, b), x = a[0] + (b[0] - a[0]) * t - p[0], y = a[1] + (b[1] - a[1]) * t - p[1], z = a[2] + (b[2] - a[2]) * t - p[2];
  return Math.sqrt(x * x + y * y + z * z);
}

export function mapBody(input: BodyMapInput): BodyMap {
  const { skinIndex, skinWeight, parents, joints, jointAt: J, restPosition: P, restNormal: N } = input;
  const n = P.length / 3;
  const named = new Map<number, HumanJointName>();
  for (const [name, index] of Object.entries(joints) as [HumanJointName, number][]) named.set(index, name);
  const owner: HumanJointName[] = Array.from({ length: parents.length }, (_, b) => {
    for (let at = b, guard = 0; at >= 0 && guard < parents.length; at = parents[at], guard++) { const nm = named.get(at); if (nm) return nm; }
    return 'pelvis';
  });
  const L = MAP_LINES;
  const hipMid: V3 = [(J.hipL[0] + J.hipR[0]) / 2, (J.hipL[1] + J.hipR[1]) / 2, (J.hipL[2] + J.hipR[2]) / 2];
  const trunkLen = Math.max(1e-6, J.neck[1] - hipMid[1]), hipSpan = Math.max(1e-6, Math.hypot(J.hipL[0] - J.hipR[0], J.hipL[2] - J.hipR[2]));
  const at = (v: number): V3 => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];

  const limb = new Array<string | undefined>(n);
  for (let v = 0; v < n; v++) {
    let best = 0, weight = -1;
    for (let k = 0; k < 4; k++) if (skinWeight[v * 4 + k] > weight) { weight = skinWeight[v * 4 + k]; best = skinIndex[v * 4 + k]; }
    limb[v] = LIMB_OF[owner[best]] ?? (owner[best] === 'neck' ? 'neck' : 'torso');
  }

  // her skin weights are not quite symmetric: near one shoulder blade the back's skin is carried by the arm, at the
  // other by the spine, which put the back of a tank's strap on her torso on one side and on her arm on the other
  // (Joshua, 2026-10-21: "One of the shoulder straps is not sitting straight like the others"). So where a vertex's
  // mirror image is torso and it is an arm, and the two really are mirror images, it is torso too
  const mirror = mirrorIndex(P, (J.hipL[0] + J.hipR[0]) / 2);
  {
    // "really" mirror images: within 3% of her trunk (about 2 cm), since her mesh is itself not quite symmetric
    const mid = (J.hipL[0] + J.hipR[0]) / 2, near = Math.max(1e-6, (J.neck[1] - (J.hipL[1] + J.hipR[1]) / 2) * 0.03);
    // (mirror pairs are not always mutual on a mesh, so a vertex made torso can settle its own mirror's: a few passes)
    for (let pass = 0, changed = true; changed && pass < 4; pass++) {
      changed = false;
      const torsoNow = limb.map((k) => k === 'torso');
      for (let v = 0; v < n; v++) {
        const m = mirror[v];
        if (m < 0 || !torsoNow[m] || (limb[v] !== 'armL' && limb[v] !== 'armR')) continue;
        if (Math.hypot(P[m * 3] - (2 * mid - P[v * 3]), P[m * 3 + 1] - P[v * 3 + 1], P[m * 3 + 2] - P[v * 3 + 2]) <= near) { limb[v] = 'torso'; changed = true; }
      }
    }
  }

  // which way she faces: a pregnant torso reaches much further forward of its middle than back
  let lo = Infinity, hi = -Infinity, sum = 0, cnt = 0;
  for (let v = 0; v < n; v++) if (limb[v] === 'torso') { const z = P[v * 3 + 2]; lo = Math.min(lo, z); hi = Math.max(hi, z); sum += z; cnt++; }
  const mean = cnt ? sum / cnt : 0, facing = !cnt || hi - mean >= mean - lo ? 1 : -1;

  // the neck's own radius: the median distance from its axis of the skin halfway up it
  const midNeck = (J.neck[1] + J.head[1]) / 2, band = Math.abs(J.head[1] - J.neck[1]) * 0.15, radii: number[] = [];
  for (let v = 0; v < n; v++) if (Math.abs(P[v * 3 + 1] - midNeck) < band && (limb[v] === 'neck' || limb[v] === 'head' || limb[v] === 'torso')) radii.push(distanceToLine(at(v), J.neck, J.head));
  radii.sort((a, b) => a - b);
  const neckRadius = radii.length ? radii[Math.floor(radii.length / 2)] : trunkLen * 0.1;
  let crown = -Infinity;
  for (let v = 0; v < n; v++) if (limb[v] === 'head') crown = Math.max(crown, P[v * 3 + 1]);

  const kneeAtL = along(J.kneeL, J.hipL, J.ankleL), kneeAtR = along(J.kneeR, J.hipR, J.ankleR);
  const elbowAtL = along(J.elbowL, J.shoulderL, J.wristL), elbowAtR = along(J.elbowR, J.shoulderR, J.wristR);
  const num = new Map(BODY_REGIONS.map((r, i) => [r.id, i + 1]));
  const region = new Uint8Array(n), trunk = new Float32Array(n), leg = new Float32Array(n).fill(NaN), arm = new Float32Array(n).fill(NaN);
  const side = new Int8Array(n), front = new Int8Array(n), across = new Float32Array(n), collar = new Float32Array(n), forward = new Float32Array(n), lateral = new Float32Array(n), around = new Float32Array(n), sideFacing = new Float32Array(n), upFacing = new Float32Array(n), legAround = new Float32Array(n).fill(NaN);

  // her spine as a line through the torso's joints, for skin facing sideways (the flanks of her belly)
  const spine = (['pelvis', 'spine', 'chest', 'neck'] as const).map((k) => J[k]).sort((a, b) => a[1] - b[1]);
  const spineZ = (y: number): number => {
    if (y <= spine[0][1]) return spine[0][2];
    for (let i = 1; i < spine.length; i++) if (y <= spine[i][1]) { const a = spine[i - 1], b = spine[i], u = (y - a[1]) / Math.max(1e-6, b[1] - a[1]); return a[2] + (b[2] - a[2]) * u; }
    return spine[spine.length - 1][2];
  };
  for (let v = 0; v < n; v++) {
    const p = at(v), t = (p[1] - hipMid[1]) / trunkLen, nz = N[v * 3 + 2] * facing;
    const f = Math.abs(nz) >= L.sideways ? (nz >= 0 ? 1 : -1) : ((p[2] - spineZ(p[1])) * facing >= L.seamAhead * trunkLen ? 1 : -1);
    trunk[v] = t; front[v] = f as 1 | -1;
    across[v] = Math.abs(p[0] - hipMid[0]) / hipSpan;
    sideFacing[v] = Math.min(1, Math.abs(N[v * 3]));
    upFacing[v] = Math.min(1, Math.abs(N[v * 3 + 1]));
    {
      const dz = (p[2] - spineZ(p[1])) * facing - L.seamAhead * trunkLen, dx = p[0] - hipMid[0], r = Math.hypot(dx, dz);
      around[v] = r > 1e-9 ? 0.5 + 0.5 * (dz / r) : 0.5;
    }
    const radius = Number.isFinite(neckRadius) && neckRadius > 0 ? neckRadius : 1;
    collar[v] = Math.hypot(p[0] - J.neck[0], p[2] - J.neck[2]) / radius;
    lateral[v] = Math.abs(p[0] - J.neck[0]) / radius;
    forward[v] = ((p[2] - J.neck[2]) * facing) / radius;
    let id: string;
    const k = limb[v];
    if (k === 'legL' || k === 'legR') {
      const left = k === 'legL', s = left ? along(p, J.hipL, J.ankleL) : along(p, J.hipR, J.ankleR), knee = left ? kneeAtL : kneeAtR;
      leg[v] = s; side[v] = left ? 1 : -1;
      {
        // round its own thigh: from the hip-to-knee line, which way the skin stands, forward or back
        const hip = left ? J.hipL : J.hipR, kn = left ? J.kneeL : J.kneeR, u = along(p, hip, kn);
        const dx = p[0] - (hip[0] + (kn[0] - hip[0]) * u), dz = (p[2] - (hip[2] + (kn[2] - hip[2]) * u)) * facing, r = Math.hypot(dx, dz);
        legAround[v] = r > 1e-9 ? 0.5 + 0.5 * (dz / r) : 0.5;
      }
      // the seat and the front of the hips hang from the hip bones, but belong to the torso's regions
      if (f > 0 ? t >= L.pubic : t >= L.gluteal) id = f > 0 ? (across[v] < L.crotchHalfWidth && t < L.pubic + 0.05 ? 'crotch' : 'hips') : 'seat';
      else if (s > 1.0 && p[1] < J[left ? 'ankleL' : 'ankleR'][1]) id = left ? 'footL' : 'footR';
      else if (Math.abs(s - knee) <= L.kneeHalf) id = left ? 'kneeL' : 'kneeR';
      else id = s < knee ? (left ? 'thighL' : 'thighR') : (left ? 'calfL' : 'calfR');
    } else if (k === 'armL' || k === 'armR') {
      const left = k === 'armL', a = left ? along(p, J.shoulderL, J.wristL) : along(p, J.shoulderR, J.wristR);
      arm[v] = a; side[v] = left ? 1 : -1;
      id = a > 1.0 ? (left ? 'handL' : 'handR') : a < (left ? elbowAtL : elbowAtR) ? (left ? 'upperArmL' : 'upperArmR') : (left ? 'forearmL' : 'forearmR');
    } else if (k === 'head' || k === 'neck' || (p[1] > J.neck[1] && distanceToLine(p, J.neck, J.head) <= neckRadius * L.neckReach)) {
      const r = distanceToLine(p, J.neck, J.head), up = (p[1] - J.head[1]) / Math.max(1e-6, crown - J.head[1]);
      const neckTop = J.neck[1] + (J.head[1] - J.neck[1]) * (nz >= 0 ? L.neckTopFront : L.neckTopBack);
      if (p[1] <= J.neck[1] || (p[1] < neckTop && r <= neckRadius * L.neckReach)) id = 'neck';
      else id = up > L.scalpFrom || (N[v * 3 + 2] * facing < L.faceFacing && up > 0) ? 'scalp' : 'face';
    } else {
      // the torso, and torso skin above the neck joint but away from the neck (the tops of her shoulders)
      id = f > 0
        ? (t >= L.underbust ? 'chest' : t >= L.pubic ? 'belly' : across[v] < L.crotchHalfWidth ? 'crotch' : 'hips')
        : (t >= L.shoulderBlades ? 'upperBack' : t >= L.seat ? 'lowerBack' : 'seat');
    }
    region[v] = num.get(id)!;
  }
  return { region, trunk, leg, arm, side, front, across, collar, forward, lateral, around, trunkLength: trunkLen, neckRadius: Number.isFinite(neckRadius) && neckRadius > 0 ? neckRadius : 1, hipSpan, sideFacing, upFacing, legAround, facing, mirror };
}

/** Each vertex's partner across the midline x = `mid`: the nearest vertex to its reflection, by a spatial hash. */
export function mirrorIndex(P: ArrayLike<number>, mid: number): Int32Array {
  const n = P.length / 3;
  let lo = Infinity, hi = -Infinity;
  for (let v = 0; v < n; v++) { lo = Math.min(lo, P[v * 3 + 1]); hi = Math.max(hi, P[v * 3 + 1]); }
  const cell = Math.max(1e-6, (hi - lo) / 400);
  const hash = (cx: number, cy: number, cz: number) => (cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791);
  const grid = new Map<number, number[]>();
  for (let v = 0; v < n; v++) { const k = hash(Math.floor(P[v * 3] / cell), Math.floor(P[v * 3 + 1] / cell), Math.floor(P[v * 3 + 2] / cell)); const list = grid.get(k); if (list) list.push(v); else grid.set(k, [v]); }
  const out = new Int32Array(n).fill(-1);
  for (let v = 0; v < n; v++) {
    const x = 2 * mid - P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let best = -1, bestD = Infinity;
    for (let r = 1; r <= 8 && best < 0; r++) {
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
        const list = grid.get(hash(cx + i, cy + j, cz + k));
        if (!list) continue;
        for (const w of list) { const dx = P[w * 3] - x, dy = P[w * 3 + 1] - y, dz = P[w * 3 + 2] - z, d = dx * dx + dy * dy + dz * dz; if (d < bestD) { bestD = d; best = w; } }
      }
    }
    out[v] = best;
  }
  return out;
}
