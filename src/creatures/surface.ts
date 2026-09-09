/**
 * SURFACES — what a legged body stands on when the ground is not the
 * only thing there is: the frame a body carries on a wall or a ceiling,
 * the solids it may climb, and the arithmetic that keeps its feet on
 * them and carries it round an edge.
 *
 * Joshua, 2026-09-09, from the phone: "All the insects besides the worm
 * need to be able to climb vertical and upside down while sticking to
 * the surface. I tried crawling up the wall in the Queen and I got
 * teleported to the top of it." That is the brief's §14 — "top → down
 * wall → underneath → around corner → back upward", and the queen's
 * release from the underside — which the Lab deferred as Creature Lab D
 * and which this file opens.
 *
 * ─── the frame: a heading and an UP ─────────────────────────────────
 *
 * A body's orientation is two things: which way it faces and which way
 * its feet point. On the ground the second was always +y, so the state
 * carried only a heading and everything — the integrator, the brain,
 * the renderer, the camera — took `ahead = (sin h, cos h)` in the
 * horizontal plane as read. A body on a wall has the same heading in
 * the same sense, ONE number, but measured in the wall's own plane; so
 * the state now also carries `up`, the unit normal of the surface it
 * stands on (`CreatureState.up`, `WORLD_UP` everywhere it used to be
 * implied), and this file defines what a heading MEANS for a given up:
 *
 *   ahead(up, h)  =  R(up) · (sin h, 0, cos h)
 *
 * where `R(up)` is the MINIMAL rotation taking +y to `up` (Rodrigues,
 * `rotateBetween`). For `up = +y` that is the identity and every
 * existing rule is untouched to the bit, which is what lets the island
 * — where no surface is anything but the ground — run exactly as it
 * did. For the one antiparallel case, a ceiling (`up = −y`), the
 * minimal rotation is ambiguous and the choice is FIXED: a half turn
 * about +x, so `ahead(−y, h) = (sin h, 0, −cos h)`. Any fixed choice
 * would do; what matters is that every reader of the state makes the
 * SAME one, and they all do by calling here. On every face a growing
 * heading turns the body about its own up in the same sense (the
 * derivative of `ahead` in h is `up × ahead`): a positive `turn` is a
 * left turn on the floor, on a wall and on the ceiling alike, which is
 * what makes a possessed ant's stick mean the same thing wherever its
 * feet are.
 *
 * ─── the solids: axis-aligned boxes ─────────────────────────────────
 *
 * A `Climbable` is an axis-aligned box in world coordinates (x and z
 * the world's, y the height above sea level), and a world offers a
 * list of them (`CreatureWorld.climbables`; absent on the island). Its
 * six faces are the surfaces; the ground (`groundAt`) is the seventh,
 * everywhere. Boxes, and not a mesh, on purpose: the Lab's block is one
 * (two, since the underside became a real place to stand — the block
 * is a slab on a pedestal, `labWorld.ts`), every edge is a right angle,
 * and every question below — which face is under the feet, where a
 * step leaves a face, which face is next — is exact arithmetic with no
 * tolerance to tune. When the island grows a rock a body should climb,
 * it is a box first and a mesh only if a box will not do.
 *
 * ─── round an edge ──────────────────────────────────────────────────
 *
 * A body walking off the top of a box onto its side, or off a wall
 * onto the ceiling under it, has its up turned from one face's normal
 * to the next, and its ahead turned BY THE SAME ROTATION (`rotateBetween`
 * from the old up to the new): walking east off the top, ahead +x
 * becomes −y — straight down the east wall — and a body walking along
 * the edge is not turned at all. The same rule serves a concave edge
 * (walking into a wall from the floor: ahead −x becomes +y, up the
 * wall) and a convex one, with no case analysis, because it is the one
 * rotation that keeps ahead perpendicular to up. `surfaceStep` is that
 * rule applied to a straight step of the requested length, split at
 * each edge it crosses.
 *
 * ─── who may climb ──────────────────────────────────────────────────
 *
 * `CreatureSpecies.climber`. The ants, the fly and the aphid climb
 * (tarsal claws and adhesive pads — Federle et al. 2000, 2002 on ants;
 * Liu et al. 2019 on a fly's inverted landing; an aphid's colony sits
 * on leaf undersides, aphid.md); the worm does not. A non-climber in a
 * world with boxes stands on the ground and treats a box as ground it
 * cannot enter; a climber in a world WITHOUT boxes is a walker exactly
 * as before.
 *
 * Pure: no three, no DOM. `src/creatures/` is core; a server can run
 * the same step. Every function writes into an `out` its caller keeps,
 * so a frame allocates nothing here.
 */
import { world, type WorldPoint } from '../world/coords';

/** A plain unit vector, serialisable as it stands: what the state carries as its `up`. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A vector a caller may write into, so a frame allocates nothing. Assignable to `Vec3`. */
export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

/** The ground's up, the air's up, the up every creature was born with. One shared frozen object. */
export const WORLD_UP: Vec3 = Object.freeze({ x: 0, y: 1, z: 0 });

/** The six face normals of a box, frozen: what `faceUnder` matches an up against. */
export const FACE_NORMALS: readonly Vec3[] = Object.freeze([
  Object.freeze({ x: 1, y: 0, z: 0 }), Object.freeze({ x: -1, y: 0, z: 0 }),
  Object.freeze({ x: 0, y: 1, z: 0 }), Object.freeze({ x: 0, y: -1, z: 0 }),
  Object.freeze({ x: 0, y: 0, z: 1 }), Object.freeze({ x: 0, y: 0, z: -1 }),
]);

/**
 * How far off a face a standing body is held, world units: a hundredth
 * of a micron, so the straight step along a face never re-enters the
 * face's own box by a rounding error, and no reader can see it.
 */
export const SURFACE_SKIN = 1e-6;

/** Within this of a face plane counts as ON the face, world units (a micron). GAME TUNING of a tolerance: well over the skin, well under a foot. */
export const FACE_TOLERANCE = 1e-4;

/** Two unit vectors closer than this are the same direction, or exactly opposite: the Rodrigues axis has vanished. */
const PARALLEL_EPSILON = 1e-12;

/** A fresh vector. Tests and one-off callers; the frame path writes into what it keeps. */
export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3, out: MutableVec3): MutableVec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

/** `v` scaled to unit length, or left as it is when it has none. */
export function normalize(v: MutableVec3): MutableVec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len > 0 && Number.isFinite(len)) {
    v.x /= len;
    v.y /= len;
    v.z /= len;
  }
  return v;
}

/**
 * THE MINIMAL ROTATION taking unit `from` to unit `to`, applied to `v`
 * (Rodrigues). When the two coincide it is the identity. When they are
 * OPPOSITE the minimal rotation is any half turn about an axis
 * perpendicular to `from`, and the choice is fixed, not left to a
 * rounding error: the projection of +x onto the plane perpendicular to
 * `from`, or of +z when `from` is nearly ±x. That is what makes
 * `ahead(−y, h) = (sin h, 0, −cos h)` on a ceiling, and every reader of
 * the state agree on it.
 */
export function rotateBetween(from: Vec3, to: Vec3, v: Vec3, out: MutableVec3): MutableVec3 {
  const ax = from.y * to.z - from.z * to.y;
  const ay = from.z * to.x - from.x * to.z;
  const az = from.x * to.y - from.y * to.x;
  const c = from.x * to.x + from.y * to.y + from.z * to.z;
  const s2 = ax * ax + ay * ay + az * az;
  if (s2 < PARALLEL_EPSILON) {
    if (c > 0) {
      out.x = v.x;
      out.y = v.y;
      out.z = v.z;
      return out;
    }
    // A half turn about k: v' = 2 (k·v) k − v.
    let kx: number;
    let ky: number;
    let kz: number;
    if (Math.abs(from.x) < 0.9) {
      kx = 1 - from.x * from.x;
      ky = -from.x * from.y;
      kz = -from.x * from.z;
    } else {
      kx = -from.z * from.x;
      ky = -from.z * from.y;
      kz = 1 - from.z * from.z;
    }
    const kl = Math.hypot(kx, ky, kz);
    kx /= kl;
    ky /= kl;
    kz /= kl;
    const d = 2 * (kx * v.x + ky * v.y + kz * v.z);
    const x = d * kx - v.x;
    const y = d * ky - v.y;
    const z = d * kz - v.z;
    out.x = x;
    out.y = y;
    out.z = z;
    return out;
  }
  // v' = v c + (a × v) + a (a·v)(1 − c) / |a|², with a = from × to (|a| = sin θ).
  const cx = ay * v.z - az * v.y;
  const cy = az * v.x - ax * v.z;
  const cz = ax * v.y - ay * v.x;
  const d = ((ax * v.x + ay * v.y + az * v.z) * (1 - c)) / s2;
  const x = v.x * c + cx + ax * d;
  const y = v.y * c + cy + ay * d;
  const z = v.z * c + cz + az * d;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

/** The world's +x and +z, carried onto a face: the two axes a heading is measured against there (`e1`, `e2` in the header). */
export function tangentBasis(up: Vec3, e1: MutableVec3, e2: MutableVec3): void {
  rotateBetween(WORLD_UP, up, FACE_NORMALS[0], e1);
  rotateBetween(WORLD_UP, up, FACE_NORMALS[4], e2);
}

const _e1: MutableVec3 = { x: 0, y: 0, z: 0 };
const _e2: MutableVec3 = { x: 0, y: 0, z: 0 };

/**
 * WHERE A HEADING POINTS ON A FACE: `R(up) · (sin h, 0, cos h)`. On the
 * ground it is `(sin h, 0, cos h)` exactly — the actor convention — and
 * on any other face the same heading carried onto it by the one
 * rotation the header fixes.
 */
export function aheadOn(up: Vec3, heading: number, out: MutableVec3): MutableVec3 {
  tangentBasis(up, _e1, _e2);
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  // `|| 0` turns a −0 (a sine times a zero axis) into +0: on the ground
  // this is (sin h, 0, cos h) to the bit, the same object a test can
  // compare with `toBe`.
  out.x = s * _e1.x + c * _e2.x || 0;
  out.y = s * _e1.y + c * _e2.y || 0;
  out.z = s * _e1.z + c * _e2.z || 0;
  return out;
}

/**
 * THE HEADING A TANGENT DIRECTION HAS ON A FACE — the inverse of
 * `aheadOn`, in (−π, π]. A direction with no tangent component (or
 * none at all) reads as 0, never NaN.
 */
export function headingOn(up: Vec3, dir: Vec3): number {
  tangentBasis(up, _e1, _e2);
  const s = dot(dir, _e1);
  const c = dot(dir, _e2);
  if (s === 0 && c === 0) return 0;
  return Math.atan2(s, c);
}

/** The body's RIGHT on a face: ahead × up. On the ground, `(−cos h, 0, sin h)` — the capsule's rule. */
export function rightOn(up: Vec3, ahead: Vec3, out: MutableVec3): MutableVec3 {
  return cross(ahead, up, out);
}

const _c: MutableVec3 = { x: 0, y: 0, z: 0 };

/**
 * The signed angle from `from` to `to` about `up`, both tangent to it:
 * positive when `to` is to the LEFT of `from` (a growing heading), in
 * (−π, π]. The turn the brain wants on a face, and on the ground the
 * same number `wrapHeading(bearing − heading)` gives.
 */
export function signedAngleAbout(up: Vec3, from: Vec3, to: Vec3): number {
  cross(from, to, _c);
  const s = dot(_c, up);
  const c = dot(from, to);
  if (s === 0 && c === 0) return 0;
  return Math.atan2(s, c);
}

/** `v` with its component along `up` removed: the tangent part. Not normalised. */
export function tangentOf(up: Vec3, v: Vec3, out: MutableVec3): MutableVec3 {
  const d = dot(up, v);
  out.x = v.x - d * up.x;
  out.y = v.y - d * up.y;
  out.z = v.z - d * up.z;
  return out;
}

// ---------------------------------------------------------------------------
// The solids
// ---------------------------------------------------------------------------

/** An axis-aligned solid a climber may walk on, world coordinates: x and z the world's, y the height above sea level. */
export interface Climbable {
  readonly id: string;
  readonly min: Vec3;
  readonly max: Vec3;
}

/** A face a body stands on: the box and which of its six sides, as the outward unit normal. */
export interface FaceHit {
  readonly box: Climbable;
  readonly normal: Vec3;
}

/** How near two unit vectors must be to be the same face normal. */
const SAME_NORMAL = 0.999;

/** The face found by the last `faceIndexAt`: its outward normal, one of `FACE_NORMALS`. Read straight after the call, never kept. */
let _faceNormal: Vec3 = WORLD_UP;

/**
 * The index of the box whose face is under a point, or −1, with the
 * face's normal left in `_faceNormal`: the allocation-free heart of
 * `faceUnder`, which the step calls once per segment and the integrator
 * once per frame. Numbers in, a number out — no point object, no hit
 * object.
 */
function faceIndexAt(x: number, y: number, z: number, up: Vec3, boxes: readonly Climbable[], tolerance: number): number {
  if (boxes.length === 0) return -1;
  let normal: Vec3 | null = null;
  for (let i = 0; i < FACE_NORMALS.length; i += 1) {
    if (dot(up, FACE_NORMALS[i]) > SAME_NORMAL) {
      normal = FACE_NORMALS[i];
      break;
    }
  }
  if (normal === null) return -1;
  for (let i = 0; i < boxes.length; i += 1) {
    const b = boxes[i];
    const plane = normal.x !== 0 ? (normal.x > 0 ? b.max.x : b.min.x) : normal.y !== 0 ? (normal.y > 0 ? b.max.y : b.min.y) : normal.z > 0 ? b.max.z : b.min.z;
    const along = normal.x !== 0 ? x : normal.y !== 0 ? y : z;
    if (Math.abs(along - plane) > tolerance) continue;
    const inX = normal.x !== 0 || (x >= b.min.x - tolerance && x <= b.max.x + tolerance);
    const inY = normal.y !== 0 || (y >= b.min.y - tolerance && y <= b.max.y + tolerance);
    const inZ = normal.z !== 0 || (z >= b.min.z - tolerance && z <= b.max.z + tolerance);
    if (inX && inY && inZ) {
      _faceNormal = normal;
      return i;
    }
  }
  return -1;
}

/**
 * WHICH BOX FACE IS UNDER THE FEET — the face whose plane the body's
 * reference point lies on (within `tolerance`) and whose outward normal
 * is the body's `up`, with the point inside the face's rectangle. Null
 * for a body on the ground, in the air or under it: the box list is
 * short and the check is exact, so this is asked fresh each frame
 * rather than remembered (ARCHITECTURE §2.3 — derived from measured
 * facts, never latched). The first match wins; two boxes sharing a face
 * plane at the same point would be one solid drawn twice.
 */
export function faceUnder(at: WorldPoint, height: number, up: Vec3, boxes: readonly Climbable[], tolerance = FACE_TOLERANCE): FaceHit | null {
  const i = faceIndexAt(at.wx, height, at.wz, up, boxes, tolerance);
  return i < 0 ? null : { box: boxes[i], normal: _faceNormal };
}

/**
 * `faceUnder` as a number: the index into `boxes` of the face's box, or
 * −1 for no face. What a frame path asks — the integrator wants "is
 * there a face under it" once per body per frame and should not pay an
 * object for the answer.
 */
export function faceIndexUnder(at: WorldPoint, height: number, up: Vec3, boxes: readonly Climbable[], tolerance = FACE_TOLERANCE): number {
  return faceIndexAt(at.wx, height, at.wz, up, boxes, tolerance);
}

/** The word a HUD prints for a face: what a body on it is doing with its feet. */
export type FaceWord = 'on top' | 'on wall' | 'on ceiling';

export function faceWord(normal: Vec3): FaceWord {
  if (normal.y > 0.5) return 'on top';
  if (normal.y < -0.5) return 'on ceiling';
  return 'on wall';
}

// ---------------------------------------------------------------------------
// The step, the aim, the floor and the way round — Creature Lab D's leaf
// ---------------------------------------------------------------------------

/**
 * The four fields a surface step reads and writes. `CreatureState`
 * satisfies it; a test can hand in a bare object.
 */
export interface SurfaceBody {
  at: WorldPoint;
  height: number;
  heading: number;
  up: Vec3;
}

/**
 * How many edges one step may cross before the rest of it is given up
 * where it stands. GAME TUNING of a guard: a step is a few millimetres
 * at sixty hertz and the Lab's edges are centimetres apart, so a fourth
 * edge in one step is a body walking round a box smaller than its own
 * stride, which no box in the game is. A body that runs out stops at
 * the last edge; it never enters a solid.
 */
export const MAX_EDGES_PER_STEP = 4;

/** Scratch for the step and the aim: the direction of travel, the body's ahead, and a rotation's output. Never escape. */
const _dir: MutableVec3 = { x: 0, y: 0, z: 0 };
const _ahd: MutableVec3 = { x: 0, y: 0, z: 0 };
const _rgt: MutableVec3 = { x: 0, y: 0, z: 0 };

/** The frozen normal for an axis and a sign — and for +y the ground's own `WORLD_UP`, so a body on a box top carries the one object a body on the ground does. */
function normalFor(axis: number, sign: number): Vec3 {
  if (axis === 1 && sign > 0) return WORLD_UP;
  return FACE_NORMALS[axis * 2 + (sign > 0 ? 0 : 1)];
}

/** The x, y or z of a vector by axis index. */
function axisOf(v: Vec3, axis: number): number {
  return axis === 0 ? v.x : axis === 1 ? v.y : v.z;
}

/**
 * Carry the frame round an edge: the direction of travel and the ahead
 * turned by the one rotation from the old up to the new (the header),
 * in place, and the heading the carried ahead has on the new face.
 */
function carryFrame(from: Vec3, to: Vec3): number {
  rotateBetween(from, to, _dir, _dir);
  rotateBetween(from, to, _ahd, _ahd);
  return headingOn(to, _ahd);
}

/**
 * ONE STEP ALONG WHATEVER THE BODY STANDS ON: `step` world units along
 * the request (`forward` ahead, `strafe` to the right, on the unit
 * disc), keeping the feet on the surface and carrying the frame round
 * every edge the step crosses (the header). On the ground, away from
 * every box, it is `planeStep`'s arithmetic to the bit, with the height
 * re-read from `groundAt` where the body lands. Walking INTO a box from
 * the ground or from another box's face is a concave edge; walking off
 * a face is a convex one, onto the next face — or onto the ground where
 * a wall meets it. Returns the distance travelled along the surface.
 * Writes `body.at`, `body.height`, `body.up` and `body.heading`;
 * `body.at` and `body.up` are REPLACED, never mutated, as the state's
 * rule is.
 *
 * HOW A STEP IS SPLIT. The body is a point `P` in three dimensions —
 * `at` on the plane, `height` up — held `SURFACE_SKIN` outside the face
 * it stands on, and the request is a direction `d` on that face of
 * length at most one. Up to `MAX_EDGES_PER_STEP` times, over what is
 * left of the step:
 *
 *   1. CONCAVE. Does the straight segment enter a box OTHER than the
 *      one whose face is underfoot (a slab test on all three axes)? A
 *      segment along a face never re-enters that face's own box: the
 *      skin is what keeps it out. If it enters box `b` at `t` through
 *      the face whose slab it crosses LAST, the body is moved to the
 *      entry point, pulled out by the skin along that face's normal,
 *      and the frame is carried onto it: `up` is the normal, `d` and
 *      the ahead are rotated by `rotateBetween(up, normal)`. Walking
 *      into a wall from the floor turns the walk into a climb; climbing
 *      a pillar into the slab over it turns the climb outward along the
 *      underside.
 *   2. ON A FACE. Does the segment stay inside the face's rectangle? If
 *      it crosses an edge — the nearer of the two when it would cross
 *      both, so a diagonal off a corner takes the earlier edge — the
 *      body is moved to the edge and wrapped CONVEX onto the
 *      neighbouring face of the same box, the one whose normal is the
 *      axis overflowed, by the same rotation. Two exceptions put it on
 *      the GROUND instead, up `WORLD_UP` and the height from `groundAt`:
 *      a wall that reaches the ground (the ground plane is crossed
 *      before the wall's bottom edge — the Lab's pillar is sunk into the
 *      floor), and a bottom edge within `FACE_TOLERANCE` of the ground
 *      (a wall standing on it). A wall whose bottom is in the air wraps
 *      onto the underside.
 *   3. THE GROUND. No face under it: `at` moves by the plane step's own
 *      expression in its own order — `(f·sin h − st·cos h, f·cos h +
 *      st·sin h)·s`, or `ahead` when there is no strafe — and the
 *      height is read from the ground it lands on (left alone where the
 *      ground is not a number, as `applyDemand` leaves it). Done.
 *
 * On a face the coordinate along the normal is held at the plane plus
 * the skin and the other two move; `faceUnder` is asked fresh at every
 * segment, never remembered. Never NaN: a step that is not positive, or
 * a request, a body or an up that is not finite, moves nothing and
 * returns 0.
 */
export function surfaceStep(
  body: SurfaceBody, forward: number, strafe: number, step: number, groundAt: (at: WorldPoint) => number, boxes: readonly Climbable[],
): number {
  if (!(step > 0) || !Number.isFinite(step) || !Number.isFinite(forward) || !Number.isFinite(strafe)) return 0;
  if (forward === 0 && strafe === 0) return 0;
  let px = body.at.wx;
  let py = body.height;
  let pz = body.at.wz;
  let up = body.up;
  let heading = body.heading;
  if (
    !Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz) || !Number.isFinite(heading)
    || !Number.isFinite(up.x) || !Number.isFinite(up.y) || !Number.isFinite(up.z)
  ) return 0;

  // The request on the unit disc, as `planeStep` bounds it.
  let f = forward;
  let st = strafe;
  const magnitude = Math.hypot(f, st);
  if (magnitude > 1) {
    f /= magnitude;
    st /= magnitude;
  }
  // The length of the request: what a unit of `s` travels.
  const m = Math.hypot(f, st);

  // The direction of travel on the current surface: f·ahead + st·right.
  aheadOn(up, heading, _ahd);
  rightOn(up, _ahd, _rgt);
  _dir.x = f * _ahd.x + st * _rgt.x;
  _dir.y = f * _ahd.y + st * _rgt.y;
  _dir.z = f * _ahd.z + st * _rgt.z;

  let s = step;
  let travelled = 0;
  for (let edges = 0; edges <= MAX_EDGES_PER_STEP; edges += 1) {
    const face = faceIndexAt(px, py, pz, up, boxes, FACE_TOLERANCE);
    const own = face < 0 ? null : boxes[face];
    const ownNormal = face < 0 ? null : _faceNormal;

    // 1. CONCAVE: the nearest box the segment enters, other than the face's own.
    let hitT = Infinity;
    let hitBox: Climbable | null = null;
    let hitAxis = -1;
    let hitSign = 0;
    for (let i = 0; i < boxes.length; i += 1) {
      if (i === face) continue;
      const b = boxes[i];
      let tIn = -Infinity;
      let tOut = Infinity;
      let inAxis = -1;
      let inSign = 0;
      let miss = false;
      for (let axis = 0; axis < 3 && !miss; axis += 1) {
        const p = axis === 0 ? px : axis === 1 ? py : pz;
        const d = axisOf(_dir, axis) * s;
        const lo = axisOf(b.min, axis);
        const hi = axisOf(b.max, axis);
        if (d === 0) {
          // Not moving along this axis: the segment is inside the slab or it is not. Closed, so a box standing
          // exactly on the ground is entered through its wall by a body on that ground; the skin keeps a body
          // that stands OUTSIDE a face from reading as inside it.
          if (!(p >= lo && p <= hi)) miss = true;
          continue;
        }
        let t1 = (lo - p) / d;
        let t2 = (hi - p) / d;
        if (t1 > t2) {
          const swap = t1;
          t1 = t2;
          t2 = swap;
        }
        if (t1 > tIn) {
          tIn = t1;
          inAxis = axis;
          // Entering through the low face going up the axis: that face's normal points down the axis, and vice versa.
          inSign = d > 0 ? -1 : 1;
        }
        if (t2 < tOut) tOut = t2;
      }
      if (miss || inAxis < 0 || !(tIn < tOut) || !(tOut > 0) || !(tIn < 1)) continue;
      const t = tIn < 0 ? 0 : tIn;
      if (t < hitT) {
        hitT = t;
        hitBox = b;
        hitAxis = inAxis;
        hitSign = inSign;
      }
    }
    if (hitBox !== null) {
      const t = hitT;
      px += _dir.x * s * t;
      py += _dir.y * s * t;
      pz += _dir.z * s * t;
      const plane = hitSign > 0 ? axisOf(hitBox.max, hitAxis) + SURFACE_SKIN : axisOf(hitBox.min, hitAxis) - SURFACE_SKIN;
      if (hitAxis === 0) px = plane;
      else if (hitAxis === 1) py = plane;
      else pz = plane;
      travelled += m * s * t;
      s *= 1 - t;
      const normal = normalFor(hitAxis, hitSign);
      heading = carryFrame(up, normal);
      up = normal;
      if (!(s > 0)) break;
      continue;
    }

    // 2. ON A FACE: the rectangle's edges, and the ground where a wall meets it.
    if (own !== null && ownNormal !== null) {
      const normalAxis = ownNormal.x !== 0 ? 0 : ownNormal.y !== 0 ? 1 : 2;
      let tEdge = Infinity;
      let edgeAxis = -1;
      let edgeSign = 0;
      for (let axis = 0; axis < 3; axis += 1) {
        if (axis === normalAxis) continue;
        const d = axisOf(_dir, axis) * s;
        if (d === 0) continue;
        const p = axis === 0 ? px : axis === 1 ? py : pz;
        const t = d > 0 ? (axisOf(own.max, axis) - p) / d : (axisOf(own.min, axis) - p) / d;
        if (t < tEdge) {
          tEdge = t;
          edgeAxis = axis;
          edgeSign = d > 0 ? 1 : -1;
        }
      }
      if (tEdge < 0) tEdge = 0;

      // A wall going down meets the ground before its own bottom edge: the pillar is sunk into the floor.
      let tGround = Infinity;
      let groundHere = NaN;
      if (ownNormal.y === 0 && _dir.y < 0) {
        groundHere = groundAt(world(px, pz));
        if (Number.isFinite(groundHere)) {
          tGround = (groundHere - py) / (_dir.y * s);
          if (tGround < 0) tGround = 0;
        }
      }
      if (tGround <= tEdge && tGround < 1) {
        const t = tGround;
        px += _dir.x * s * t;
        pz += _dir.z * s * t;
        py = groundHere;
        travelled += m * s * t;
        s *= 1 - t;
        heading = carryFrame(up, WORLD_UP);
        up = WORLD_UP;
        if (!(s > 0)) break;
        continue;
      }
      if (tEdge < 1) {
        const t = tEdge;
        px += _dir.x * s * t;
        py += _dir.y * s * t;
        pz += _dir.z * s * t;
        travelled += m * s * t;
        s *= 1 - t;
        if (edgeAxis === 1 && edgeSign < 0) {
          // The bottom edge of a wall: onto the ground when the wall stands on it, else onto the underside.
          const at = world(px, pz);
          const g = groundAt(at);
          if (Number.isFinite(g) && own.min.y <= g + FACE_TOLERANCE) {
            py = g;
            heading = carryFrame(up, WORLD_UP);
            up = WORLD_UP;
            if (!(s > 0)) break;
            continue;
          }
        }
        const plane = edgeSign > 0 ? axisOf(own.max, edgeAxis) + SURFACE_SKIN : axisOf(own.min, edgeAxis) - SURFACE_SKIN;
        if (edgeAxis === 0) px = plane;
        else if (edgeAxis === 1) py = plane;
        else pz = plane;
        const normal = normalFor(edgeAxis, edgeSign);
        heading = carryFrame(up, normal);
        up = normal;
        if (!(s > 0)) break;
        continue;
      }
      // The whole of what is left, along the face.
      px += _dir.x * s;
      py += _dir.y * s;
      pz += _dir.z * s;
      travelled += m * s;
      s = 0;
      break;
    }

    // 3. THE GROUND: `planeStep`'s own expression in its own order, then the ground where it lands.
    {
      const sin = Math.sin(heading);
      const cos = Math.cos(heading);
      let dx: number;
      let dz: number;
      if (st === 0) {
        const along = f * s;
        dx = sin * along;
        dz = cos * along;
      } else {
        dx = (f * sin - st * cos) * s;
        dz = (f * cos + st * sin) * s;
      }
      const at = world(px + dx, pz + dz);
      const g = groundAt(at);
      body.at = at;
      if (Number.isFinite(g)) body.height = g;
      else body.height = py;
      body.heading = heading;
      if (body.up !== WORLD_UP) body.up = WORLD_UP;
      return travelled + m * s;
    }
  }

  body.at = world(px, pz);
  body.height = py;
  body.heading = heading;
  if (body.up !== up) body.up = up;
  return travelled;
}

/** Whether two boxes' footprints overlap (closed). */
function footprintsOverlap(a: Climbable, b: Climbable): boolean {
  return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.z <= b.max.z && a.max.z >= b.min.z;
}

/**
 * THE DIRECTION A BRAIN SHOULD HEAD ON A SURFACE to reach a target on
 * the plane at `targetHeight`: the target's direction projected onto
 * the face, unit length, into `out` — except on a CEILING, where a
 * target below is reached by way of whatever holds the ceiling up (the
 * box that meets this face from below, the pedestal), since no tangent
 * of a ceiling goes down. Null when there is no direction (the target
 * is straight along the normal). On the ground it is the horizontal
 * direction to the target, and the brain does not call it there.
 *
 * THE WAY DOWN FROM A CEILING is the box that TOUCHES the face from
 * below — another box whose top is within `FACE_TOLERANCE` of this
 * face's plane with an overlapping footprint — and the aim is
 * horizontal, at the nearest point of that box's footprint (the body's
 * x and z clamped into its range). A body already at that footprint,
 * or a ceiling nothing holds up, falls back to the projection.
 */
export function aimOnSurface(body: Readonly<SurfaceBody>, target: WorldPoint, targetHeight: number, boxes: readonly Climbable[], out: MutableVec3): MutableVec3 | null {
  const up = body.up;
  if (up.y < -0.5) {
    const face = faceIndexAt(body.at.wx, body.height, body.at.wz, up, boxes, FACE_TOLERANCE);
    if (face >= 0) {
      const own = boxes[face];
      for (let i = 0; i < boxes.length; i += 1) {
        if (i === face) continue;
        const c = boxes[i];
        if (Math.abs(c.max.y - own.min.y) > FACE_TOLERANCE || !footprintsOverlap(c, own)) continue;
        const cx = Math.min(c.max.x, Math.max(c.min.x, body.at.wx));
        const cz = Math.min(c.max.z, Math.max(c.min.z, body.at.wz));
        const dx = cx - body.at.wx;
        const dz = cz - body.at.wz;
        const len = Math.hypot(dx, dz);
        if (!(len >= FACE_TOLERANCE) || !Number.isFinite(len)) break;
        out.x = dx / len;
        out.y = 0;
        out.z = dz / len;
        return out;
      }
    }
  }
  _rgt.x = target.wx - body.at.wx;
  _rgt.y = targetHeight - body.height;
  _rgt.z = target.wz - body.at.wz;
  tangentOf(up, _rgt, out);
  const len = Math.hypot(out.x, out.y, out.z);
  if (!(len > 0) || !Number.isFinite(len)) return null;
  out.x /= len;
  out.y /= len;
  out.z /= len;
  return out;
}

/**
 * THE FLOOR A FLIER MEASURES FROM, with boxes in the world: the ground,
 * or the top of the highest box under the point that is at or below the
 * body's height — so a queen over the slab lands on the slab and a fly
 * under it keeps the floor. `ground` is the world's `floorAt` answer
 * (the ground, or the water's surface) for the point.
 *
 * The footprint is closed and "at or below" allows `FACE_TOLERANCE`, so
 * a body standing on a top face — a skin above it — reads that face as
 * its floor. A ground that is not a number is replaced by a box top
 * under the body, which is a floor whatever the ground under it is; with
 * no box under it the answer is the ground as given.
 */
export function floorOverBoxes(at: WorldPoint, height: number, ground: number, boxes: readonly Climbable[]): number {
  let floor = ground;
  const x = at.wx;
  const z = at.wz;
  for (let i = 0; i < boxes.length; i += 1) {
    const b = boxes[i];
    if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
    const top = b.max.y;
    if (!(top <= height + FACE_TOLERANCE)) continue;
    floor = Number.isFinite(floor) ? Math.max(floor, top) : top;
  }
  return floor;
}

/**
 * Does the open rectangle [x0,x1]×[z0,z1] have the segment a→b pass
 * through its INTERIOR? A segment along an edge, or one that only
 * touches a corner, does not: a grown corner is a place to stand and a
 * grown edge a line to walk. A segment that starts inside does.
 */
function segmentCrossesRect(ax: number, az: number, bx: number, bz: number, x0: number, x1: number, z0: number, z1: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  let tIn = 0;
  let tOut = 1;
  if (dx === 0) {
    if (!(ax > x0 && ax < x1)) return false;
  } else {
    let t1 = (x0 - ax) / dx;
    let t2 = (x1 - ax) / dx;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tIn) tIn = t1;
    if (t2 < tOut) tOut = t2;
  }
  if (dz === 0) {
    if (!(az > z0 && az < z1)) return false;
  } else {
    let t1 = (z0 - az) / dz;
    let t2 = (z1 - az) / dz;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tIn) tIn = t1;
    if (t2 < tOut) tOut = t2;
  }
  return tIn < tOut;
}

/**
 * A WAY ROUND: the target itself when the straight line from `at` to it
 * crosses no box that stands in a walker's way at `height` (a box whose
 * bottom is at or below the walker and whose top is above it), else a
 * waypoint — a corner of that box's footprint grown by `clearance`,
 * the one that makes the shorter detour — for the brain to aim at
 * instead. The brain's soft containment for solids: a walker that meets
 * a box climbs it (`surfaceStep`), and this is how the AI mostly does
 * not, so an ant is not sent up the pedestal on every errand.
 *
 * THE CORNER CHOSEN. Of the four grown corners, the one that minimises
 * `|at − corner| + |corner − target|` among those whose two legs both
 * keep out of the grown rectangle; when none does — a target on the far
 * side needs two corners, and a body already inside the grown rectangle
 * cannot leave it without crossing — among those whose FIRST leg keeps
 * out, since that is the leg the body walks now and the next think
 * routes the rest; and when not even that, the minimum overall. Ties
 * go to the nearer corner. Boxes are taken in order, each against the
 * target the last one left; a box not in the way at this height — the
 * slab over a walker on the floor — is walked under.
 */
export function routeAround(at: WorldPoint, target: WorldPoint, height: number, clearance: number, boxes: readonly Climbable[]): WorldPoint {
  if (!Number.isFinite(at.wx) || !Number.isFinite(at.wz) || !Number.isFinite(target.wx) || !Number.isFinite(target.wz)) return target;
  const grow = Number.isFinite(clearance) && clearance > 0 ? clearance : 0;
  let goal = target;
  for (let i = 0; i < boxes.length; i += 1) {
    const b = boxes[i];
    if (!(b.min.y <= height + FACE_TOLERANCE) || !(b.max.y > height + FACE_TOLERANCE)) continue;
    const x0 = b.min.x - grow;
    const x1 = b.max.x + grow;
    const z0 = b.min.z - grow;
    const z1 = b.max.z + grow;
    if (!segmentCrossesRect(at.wx, at.wz, goal.wx, goal.wz, x0, x1, z0, z1)) continue;
    let bestX = x0;
    let bestZ = z0;
    let bestTier = -1;
    let bestTotal = Infinity;
    let bestNear = Infinity;
    for (let k = 0; k < 4; k += 1) {
      const cx = k & 1 ? x1 : x0;
      const cz = k & 2 ? z1 : z0;
      const near = Math.hypot(cx - at.wx, cz - at.wz);
      const total = near + Math.hypot(goal.wx - cx, goal.wz - cz);
      const firstClear = !segmentCrossesRect(at.wx, at.wz, cx, cz, x0, x1, z0, z1);
      const secondClear = !segmentCrossesRect(cx, cz, goal.wx, goal.wz, x0, x1, z0, z1);
      const tier = firstClear && secondClear ? 2 : firstClear ? 1 : 0;
      const better = tier > bestTier
        || (tier === bestTier && (total < bestTotal - 1e-9 || (Math.abs(total - bestTotal) <= 1e-9 && near < bestNear)));
      if (better) {
        bestTier = tier;
        bestTotal = total;
        bestNear = near;
        bestX = cx;
        bestZ = cz;
      }
    }
    goal = world(bestX, bestZ);
  }
  return goal;
}
