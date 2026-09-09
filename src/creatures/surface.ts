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
import { type WorldPoint } from '../world/coords';

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
  if (boxes.length === 0) return null;
  let normal: Vec3 | null = null;
  for (let i = 0; i < FACE_NORMALS.length; i += 1) {
    if (dot(up, FACE_NORMALS[i]) > SAME_NORMAL) {
      normal = FACE_NORMALS[i];
      break;
    }
  }
  if (normal === null) return null;
  const x = at.wx;
  const y = height;
  const z = at.wz;
  for (let i = 0; i < boxes.length; i += 1) {
    const b = boxes[i];
    const plane = normal.x !== 0 ? (normal.x > 0 ? b.max.x : b.min.x) : normal.y !== 0 ? (normal.y > 0 ? b.max.y : b.min.y) : normal.z > 0 ? b.max.z : b.min.z;
    const along = normal.x !== 0 ? x : normal.y !== 0 ? y : z;
    if (Math.abs(along - plane) > tolerance) continue;
    const inX = normal.x !== 0 || (x >= b.min.x - tolerance && x <= b.max.x + tolerance);
    const inY = normal.y !== 0 || (y >= b.min.y - tolerance && y <= b.max.y + tolerance);
    const inZ = normal.z !== 0 || (z >= b.min.z - tolerance && z <= b.max.z + tolerance);
    if (inX && inY && inZ) return { box: b, normal };
  }
  return null;
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
 */
export function surfaceStep(
  body: SurfaceBody, forward: number, strafe: number, step: number, groundAt: (at: WorldPoint) => number, boxes: readonly Climbable[],
): number {
  void body; void forward; void strafe; void step; void groundAt; void boxes;
  throw new Error('creatures/surface: surfaceStep is Creature Lab D\'s leaf and is not built yet');
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
 */
export function aimOnSurface(body: Readonly<SurfaceBody>, target: WorldPoint, targetHeight: number, boxes: readonly Climbable[], out: MutableVec3): MutableVec3 | null {
  void body; void target; void targetHeight; void boxes; void out;
  throw new Error('creatures/surface: aimOnSurface is Creature Lab D\'s leaf and is not built yet');
}

/**
 * THE FLOOR A FLIER MEASURES FROM, with boxes in the world: the ground,
 * or the top of the highest box under the point that is at or below the
 * body's height — so a queen over the slab lands on the slab and a fly
 * under it keeps the floor. `ground` is the world's `floorAt` answer
 * (the ground, or the water's surface) for the point.
 */
export function floorOverBoxes(at: WorldPoint, height: number, ground: number, boxes: readonly Climbable[]): number {
  void at; void height; void ground; void boxes;
  throw new Error('creatures/surface: floorOverBoxes is Creature Lab D\'s leaf and is not built yet');
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
 */
export function routeAround(at: WorldPoint, target: WorldPoint, height: number, clearance: number, boxes: readonly Climbable[]): WorldPoint {
  void at; void target; void height; void clearance; void boxes;
  throw new Error('creatures/surface: routeAround is Creature Lab D\'s leaf and is not built yet');
}
