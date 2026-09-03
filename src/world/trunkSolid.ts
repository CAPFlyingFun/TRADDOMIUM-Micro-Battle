/**
 * THE WOOD SHE CANNOT WALK THROUGH — and it is the wood she can see.
 *
 * Joshua: "let's make the trees able to climb/walk, and in turn,
 * collision." Collision is the enabler and this is it.
 *
 * BUILT FROM THE SAME SKELETON THE MESH IS SKINNED FROM, in the same
 * unit space, transformed by the same scale and spin. Not an
 * approximation of it — the identical polyline — so the bark you see
 * and the bark you cannot pass are one shape by construction.
 *
 * Thronemound learned that the hard way and wrote it down: its first
 * collision was "a straight vertical cone from base radius to a
 * fraction of it", which measured up to 33 per cent FATTER than the
 * drawn wood at mid-height and modelled none of the trunk's lean. She
 * stood on the invisible one and floated over the visible one, and it
 * was reported as hovering. A trunk here wanders by more than its own
 * radius over its height, so the same mistake would put the solid part
 * of the tree somewhere the picture is not.
 *
 * TRUNKS ONLY, and deliberately. Foliage is not a surface an ant stands
 * on in any sense this game models, and a solid canopy is a thing to
 * get wedged inside.
 *
 * THE DRAWN RING IS WHAT SHE MEETS, not the limb's own radius. The mesh
 * is a polygon and the limb is a circle, and `skin` pushes the vertices
 * out to `1 / cos(pi / sides)` so the flats are TANGENT to the circle
 * rather than chords inside it. The solid has to know the same number
 * or it describes a thinner tree than the one on screen.
 *
 * PURE, and in unit space: a profile is one unit tall and is stretched
 * by each tree's own height, exactly as the instanced mesh is.
 */
import type { WorldPoint } from './coords';
import { DETAILS, growTree, type TreeSpec } from './treeMesh';

/** The trunk's own line, one unit tall. */
export interface TrunkProfile {
  /** Axis points up the trunk, in unit-height space. */
  readonly pts: readonly { x: number; y: number; z: number }[];
  /** The DRAWN radius at each point, same space. */
  readonly r: readonly number[];
  /** The widest of them, for a cheap reject. */
  readonly widest: number;
}

/** How much wider the drawn ring is than the limb, at `sides`. */
export function ringFactor(sides: number): number {
  return 1 / Math.cos(Math.PI / Math.max(3, sides));
}

/**
 * The trunk's line, scaled to one unit tall.
 *
 * @param sides the tessellation the MESH was baked at — a six-sided
 *   far trunk stands 15% proud of the circle it was grown from, and
 *   she meets the corners.
 */
export function trunkProfile(spec: TreeSpec, sides: number): TrunkProfile {
  const trunk = growTree(spec).limbs.filter((l) => l.order === 0);
  const k = 1 / spec.height;
  const f = ringFactor(sides) * k;
  const pts = [{ x: trunk[0].a.x * k, y: trunk[0].a.y * k, z: trunk[0].a.z * k }];
  const r = [trunk[0].ra * f];
  for (const limb of trunk) {
    pts.push({ x: limb.b.x * k, y: limb.b.y * k, z: limb.b.z * k });
    r.push(limb.rb * f);
  }
  return { pts, r, widest: Math.max(...r) };
}

/** The profile for a detail level, at that level's own tessellation. */
export function profileFor(spec: TreeSpec, level: number): TrunkProfile {
  const d = DETAILS[Math.min(DETAILS.length - 1, Math.max(0, level))];
  return trunkProfile(spec, d.sides);
}

/**
 * HOW FAR INSIDE THE WOOD a point is, in the profile's own unit space.
 * Negative outside.
 *
 * THE THREE-DIMENSIONAL ANSWER, which is the right one for "is this
 * vertex of the mesh inside the solid" and the wrong one for pushing a
 * walker out — see `TrunkField.bump`, which asks horizontally at her
 * own height instead.
 *
 * A union of round cones down the polyline — the same shape the mesh is
 * skinned onto, so the two cannot drift apart with height the way a
 * single straight cone did.
 */
export function insideProfile(
  profile: TrunkProfile, x: number, y: number, z: number,
): number {
  const { pts, r } = profile;
  let best = -Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const bax = b.x - a.x;
    const bay = b.y - a.y;
    const baz = b.z - a.z;
    const len2 = bax * bax + bay * bay + baz * baz;
    if (len2 < 1e-12) continue;
    const pax = x - a.x;
    const pay = y - a.y;
    const paz = z - a.z;
    let t = (pax * bax + pay * bay + paz * baz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const rr = r[i] + (r[i + 1] - r[i]) * t;
    const gap = rr - Math.hypot(pax - bax * t, pay - bay * t, paz - baz * t);
    if (gap > best) best = gap;
  }
  return best;
}

/** One tree, placed, ready to be walked into. */
export interface Standing {
  readonly id: string;
  /** Where its foot sits, WORLD. */
  readonly at: WorldPoint;
  /** The ground it is seated on, plus however far it is sunk. */
  readonly foot: number;
  /** Unit space is multiplied by this to reach the world. */
  readonly scale: number;
  /** Cosine and sine of its spin, so a query can un-turn a point. */
  readonly cos: number;
  readonly sin: number;
  readonly profile: TrunkProfile;
  /** World radius of the whole thing, for the bucket and the reject. */
  readonly reach: number;
  /** World height of its top. */
  readonly top: number;
}

/** What a query found: which tree, how deep in, and the way out. */
export interface Bump {
  readonly id: string;
  /** How far inside the wood, world units. Positive means inside. */
  readonly depth: number;
  /** Unit vector out of the trunk, horizontal. */
  readonly outX: number;
  readonly outZ: number;
  /** The trunk's surface at her height, world units from its axis. */
  readonly surface: number;
}

/**
 * THE TRUNKS NEAR HER, AS SOMETHING SOLID.
 *
 * Bucketed on a coarse grid because the question is asked several times
 * a frame and there may be dozens of trees: a probe looks up its own
 * bucket and tests the two or three in it, and away from everything it
 * is one bounds check.
 *
 * SMALL ON PURPOSE. A tree she cannot reach before the next refill does
 * not need to be solid, and the cost of this is linear in what it
 * holds.
 */
export class TrunkField {
  private readonly buckets = new Map<number, Standing[]>();
  private readonly cell: number;
  private lowest = Infinity;
  private highest = -Infinity;

  private readonly trees: readonly Standing[];

  constructor(standing: readonly Standing[], cell = 400) {
    this.cell = cell;
    this.trees = standing;
    for (const one of standing) {
      this.lowest = Math.min(this.lowest, one.foot);
      this.highest = Math.max(this.highest, one.top);
      const lo = Math.floor((one.at.wx - one.reach) / cell);
      const hi = Math.floor((one.at.wx + one.reach) / cell);
      const lz = Math.floor((one.at.wz - one.reach) / cell);
      const hz = Math.floor((one.at.wz + one.reach) / cell);
      for (let gz = lz; gz <= hz; gz++) {
        for (let gx = lo; gx <= hi; gx++) {
          const key = (gx * 73856093) ^ (gz * 19349663);
          const list = this.buckets.get(key);
          if (list) list.push(one);
          else this.buckets.set(key, [one]);
        }
      }
    }
  }

  get count(): number {
    return this.trees.length;
  }

  /** What the field holds, for a probe or a test to check against. */
  get all(): readonly Standing[] {
    return this.trees;
  }

  /**
   * HOW FAR INSIDE THE WOOD this world point is. Negative outside.
   *
   * The three-dimensional answer, in world units — `bump` is the
   * horizontal one, and the two exist for genuinely different jobs.
   * `bump` pushes a FLYING queen out sideways, which is what meeting a
   * trunk in the air is. This one is a FIELD: it is sampled around a
   * point to find which way the surface faces, and that is what lets
   * her walk onto bark instead of being shoved off it. See
   * world/solidField.ts.
   */
  depthAt(wx: number, y: number, wz: number): number {
    let best = -Infinity;
    for (const one of this.at(wx, wz)) {
      const dx = wx - one.at.wx;
      const dz = wz - one.at.wz;
      // Into the tree's own space: off its foot, un-spun, unscaled.
      // The inverse of the turn `bump` applies going the other way.
      const lx = (dx * one.cos - dz * one.sin) / one.scale;
      const lz = (dx * one.sin + dz * one.cos) / one.scale;
      const ly = (y - one.foot) / one.scale;
      const deep = insideProfile(one.profile, lx, ly, lz) * one.scale;
      if (deep > best) best = deep;
    }
    return best;
  }

  /** The trunks whose footprint could hold this point. */
  private at(wx: number, wz: number): readonly Standing[] {
    const gx = Math.floor(wx / this.cell);
    const gz = Math.floor(wz / this.cell);
    return this.buckets.get((gx * 73856093) ^ (gz * 19349663)) ?? [];
  }

  /**
   * IS SHE IN THE WOOD, and which way is out?
   *
   * Answers the DEEPEST bump when several overlap, because that is the
   * one that has to be resolved for her to be out of all of them.
   */
  bump(wx: number, y: number, wz: number, radius = 0): Bump | null {
    if (y < this.lowest || y > this.highest) return null;
    let worst: Bump | null = null;
    for (const one of this.at(wx, wz)) {
      if (y < one.foot || y > one.top) continue;
      const dx = wx - one.at.wx;
      const dz = wz - one.at.wz;
      if (Math.hypot(dx, dz) > one.reach + radius) continue;
      // Into the tree's own space: off its foot, unscaled. Only the
      // height is needed here — the horizontal work below is done in
      // world space, against the axis read at that height.
      const ly = (y - one.foot) / one.scale;
      // AT HER HEIGHT, AND HORIZONTALLY — which is one question, asked
      // once, so the depth and the way out cannot disagree.
      //
      // `insideProfile` measures to the nearest point of the polyline
      // in three dimensions, which is the right answer for "is this
      // vertex inside the wood" and the wrong one for "how far do I
      // push her": the nearest point can be on a segment below her, so
      // the depth it returns is not the distance along the radial the
      // push travels, and one push left her still inside. A walker
      // meets a trunk sideways. So this reads the axis and the radius
      // AT HER OWN HEIGHT and works in the horizontal plane, and the
      // push then clears her exactly.
      //
      // OUT IS AWAY FROM THE AXIS AT HER HEIGHT, not away from the
      // foot: the trunk wanders off its own centre line by more than
      // its radius, so pushing off the foot would slide her round the
      // tree rather than off it.
      const axis = axisAt(one, ly);
      const ax = one.at.wx + (axis.x * one.cos + axis.z * one.sin) * one.scale;
      const az = one.at.wz + (-axis.x * one.sin + axis.z * one.cos) * one.scale;
      const surface = axis.r * one.scale;
      let ox = wx - ax;
      let oz = wz - az;
      const len = Math.hypot(ox, oz);
      const depth = surface + radius - len;
      // A SKIN, so a push that just cleared her does not read as a bump
      // again next frame. `len + depth` and `surface + radius` are the
      // same number in exact arithmetic and differ in the last bit or
      // two in floating point, which is enough to leave her jittering
      // against the bark for ever.
      if (depth <= SKIN || (worst !== null && depth <= worst.depth)) continue;
      if (len < 1e-6) { ox = 1; oz = 0; } else { ox /= len; oz /= len; }
      worst = { id: one.id, depth, outX: ox, outZ: oz, surface };
    }
    return worst;
  }

  /** Is this point inside any trunk? The cheap question. */
  solid(wx: number, y: number, wz: number, radius = 0): boolean {
    return this.bump(wx, y, wz, radius) !== null;
  }
}

/** The axis point and drawn radius at a height in unit space. */
function axisAt(one: Standing, ly: number): { x: number; z: number; r: number } {
  const { pts, r } = one.profile;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (ly > b.y && i < pts.length - 2) continue;
    const span = b.y - a.y;
    const t = span > 1e-9 ? Math.max(0, Math.min(1, (ly - a.y) / span)) : 0;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      r: r[i] + (r[i + 1] - r[i]) * t,
    };
  }
  return { x: pts[0].x, z: pts[0].z, r: r[0] };
}

/**
 * How much of a push counts as a push, world units.
 *
 * Half a millimetre: far below anything she or the eye can tell, and
 * comfortably above the last bit or two of a float.
 */
const SKIN = 0.05;

/** Nothing standing — the field before the raster lands. */
export const NO_TRUNKS = new TrunkField([]);
