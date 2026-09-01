/**
 * THE LANDMARK TREES — where they stand, and which ones are in her way.
 *
 * The first things on the island with a footprint she cannot fly
 * through. Eighteen to thirty metres tall, one to a 20 m lattice cell
 * where the canopy raster says forest, and none anywhere it does not.
 *
 * WHY LANDMARKS AND NOT A FOREST. A queen a centimetre long does not
 * see a forest; she sees the six trunks in front of her and a green
 * roof. What makes the island READ as wooded from her height is the
 * tiers underneath — bushes and saplings — and those are the LOD
 * card's Stage 3, gated on Joshua's go. The giants come first because
 * they are what the route planner needs: a thing with a real trunk,
 * in a real place, that she visibly goes round. Thronemound's island
 * made the same split for the same reason (its forest.ts: "the giants
 * CANNOT be the forest. They are landmarks").
 *
 * WHERE THEY COME FROM. The ESA WorldCover rasters TMB already bakes
 * (landcover.ts): the class says forest or not, the canopy cover sets
 * how likely a cell is to hold one, the river-corridor intensity keeps
 * them off the flood plain. Beyond Extinction places its Kauaʻi forest
 * from these same three planes and that part of the idea ports; what
 * does not is anything of BE's sized in metres for a human camera, or
 * its `fract(sin)` hash, which is not bit-stable across engines.
 *
 * ONE PLANT PER CELL, THROWN INSIDE IT. A jittered grid rather than
 * noise: pure random clumps and leaves bald patches, which reads as a
 * bug, and a grid has the property that matters — the tree in a cell
 * depends on nothing but that cell, so any window of the island can
 * be grown on its own, repeatably, and two phones grow the same tree
 * at `lm:cx,cz`. The hash is the ground cover's (stableHash.ts).
 *
 * EVERYTHING HERE IS PURE AND IN WORLD UNITS. It reads the rasters,
 * the heightfield and the drainage; it writes nothing, draws nothing
 * and never touches the terrain. The renderer (Landmarks.ts) and the
 * planner ask it questions.
 */
import type { Hazard } from '../ant/hazards';
import { CHUNK_SPAN, type WorldPoint } from './coords';
import { groundHeight } from './heightfield';
import { islandChannelsReady, isLandWatercourse } from './islandChannels';
import { SHRUB, TREE, coverAt, haveVeg } from './landcover';
import { stableHash } from './stableHash';

/**
 * The lattice pitch, world units — four terrain chunks, 20.48 m.
 *
 * One giant per ~420 m² at most. Kauaʻi's real canopy trees stand
 * closer than that, but the point of this tier is a trunk she can
 * steer round, not a wall; the density that makes it a forest is the
 * tiers below (Stage 3). At full canopy this gives roughly one tree
 * per 780 m², a little over one in a 30 m circle.
 */
export const PITCH = CHUNK_SPAN * 4;

/** Height, world units: 18 m plus up to 12 m. */
export const LEAST_HEIGHT = 1_800;
export const HEIGHT_RANGE = 1_200;
/** Trunk diameter at the foot, as a fraction of height. TCS's landmark. */
export const GIRTH_OF_HEIGHT = 0.04;
/**
 * The HAZARD ring's radius, as a fraction of height — the trunk, with
 * its foot flare, and NOT the crown.
 *
 * At the bands she actually flies (55 cm to a few metres) she is under
 * the lowest bough, which starts at `LOWEST_BOUGH` of the height —
 * seven and a half metres on the smallest of these. A crown-sized ring
 * would also let `pushOut` move a pin tapped "at that tree" nine
 * metres; the trunk keeps it under 4.2.
 */
export const TRUNK_OF_HEIGHT = 0.03;
/** Where the boughs begin, as a fraction of height. TCS's growTree. */
export const LOWEST_BOUGH = 0.42;
/** Crown radius as a fraction of height — for the renderer's reach. */
export const CROWN_OF_HEIGHT = 0.18;

/** A cell holds a tree with probability `canopy × PRESENCE`. */
export const PRESENCE = 0.6;
/** Shrubland grows a few, at this share of the forest's odds. */
export const SHRUB_SHARE = 0.25;
/** River-corridor intensity above which nothing this big stands. */
export const RIVER_LIMIT = 0.35;
/** Ground this close to sea level is beach or marsh, world units. */
export const SHORE = 100;
/** Steepest ground it will take, as rise over run. */
export const STEEPEST = 0.75;
/** Half-span of the slope's central difference, world units. */
const SLOPE_REACH = 400;

/**
 * How far either side of a leg the planner is shown trees, world units.
 *
 * DERIVED, not chosen: a detour corner sits one ring reach off the
 * line, and the leg out of that corner can graze a tree one reach
 * further out — so the corridor has to be at least twice the largest
 * ring reach. The largest ring is a 30 m tree's trunk (90) plus the
 * planner's margin (300), pushed out to the octagon's corner by
 * 1/cos(22.5°): 422 units. Twice that is 844; half a pitch is 1,024
 * and is the number that makes the cell walk below exact.
 */
export const CORRIDOR = PITCH / 2;
/**
 * The most trees one leg is planned against.
 *
 * `routeAround` tests every node pair against every ring, so the cost
 * grows as the square of the corners. Eight octagons are 66 nodes and
 * a few hundred thousand segment tests; nineteen would be 154 nodes
 * and millions. Eight is the number that fits a phone's frame with
 * room to spare, and the count past it is reported so it can be raised
 * once `planMs` has been read on a device.
 */
export const MOST_PER_LEG = 8;

/** Disjoint from the ground cover's, which is 1 to 5. */
const SALT = { presence: 11, jx: 12, jz: 13, height: 14, spin: 15 } as const;

/** One tree, placed. World units throughout. */
export interface Landmark {
  /** `lm:cx,cz` — the lattice cell, so it is the same tree on any device. */
  readonly id: string;
  readonly cx: number;
  readonly cz: number;
  readonly at: WorldPoint;
  /** Ground height where it stands, as read when it was placed. */
  readonly ground: number;
  readonly height: number;
  /** Diameter at the foot. */
  readonly girth: number;
  /** The hazard ring's radius. */
  readonly trunk: number;
  readonly crown: number;
  /** Radians about Y. */
  readonly spin: number;
  /** A 32-bit seed for its shape. */
  readonly seed: number;
}

/** Where the tree in this cell would stand, before asking whether it does. */
function seatOf(cx: number, cz: number): WorldPoint {
  // Thrown inside its own cell, never onto the line — a jitter that can
  // reach the edge lets two neighbours meet and read as a pair.
  const jx = 0.12 + 0.76 * stableHash(cx, cz, SALT.jx);
  const jz = 0.12 + 0.76 * stableHash(cx, cz, SALT.jz);
  return { wx: (cx + jx) * PITCH, wz: (cz + jz) * PITCH };
}

/** Rise over run at a point, by central difference on the drawn ground. */
export function slopeAt(wx: number, wz: number): number {
  const r = SLOPE_REACH;
  const dx = (groundHeight(wx + r, wz) - groundHeight(wx - r, wz)) / (2 * r);
  const dz = (groundHeight(wx, wz + r) - groundHeight(wx, wz - r)) / (2 * r);
  return Math.hypot(dx, dz);
}

/**
 * The tree in a lattice cell, or null.
 *
 * THE GATES, cheapest first: the raster says forest; the river
 * corridor says not here; the hash says this cell; then the ground —
 * above the shore, not a channel, not a cliff. Every answer is a pure
 * function of the cell and the world's baked data, so it is the same
 * answer after a reload and on another phone.
 *
 * The one thing that CAN change the answer is the ground itself: an HD
 * tile landing moves `groundHeight`, so a tree on the shore or on a
 * steep edge may appear or go when the fine ground arrives. The
 * renderer re-asks on that event.
 */
export function landmarkAt(cx: number, cz: number): Landmark | null {
  if (!haveVeg()) return null;
  const at = seatOf(cx, cz);
  const cover = coverAt(at.wx, at.wz);
  const share = cover.kind === TREE ? 1 : cover.kind === SHRUB ? SHRUB_SHARE : 0;
  if (share === 0) return null;
  if (cover.river > RIVER_LIMIT) return null;
  if (stableHash(cx, cz, SALT.presence) >= cover.canopy * PRESENCE * share) return null;
  const ground = groundHeight(at.wx, at.wz);
  if (!(ground > SHORE)) return null;
  if (islandChannelsReady() && isLandWatercourse(at.wx, at.wz)) return null;
  if (slopeAt(at.wx, at.wz) > STEEPEST) return null;
  // Squared, so most of a stand is on the short side and the tall ones
  // are exceptions — a flat draw gives a plantation.
  const t = stableHash(cx, cz, SALT.height);
  const height = LEAST_HEIGHT + HEIGHT_RANGE * t * t;
  return {
    id: `lm:${cx},${cz}`,
    cx,
    cz,
    at,
    ground,
    height,
    girth: height * GIRTH_OF_HEIGHT,
    trunk: height * TRUNK_OF_HEIGHT,
    crown: height * CROWN_OF_HEIGHT,
    spin: stableHash(cx, cz, SALT.spin) * Math.PI * 2,
    seed: Math.floor(stableHash(cx, cz, SALT.height + 100) * 0xffffffff) >>> 0,
  };
}

/** The cell a world point falls in. */
export function cellOf(at: WorldPoint): { cx: number; cz: number } {
  return { cx: Math.floor(at.wx / PITCH), cz: Math.floor(at.wz / PITCH) };
}

/** Every tree within a box, world units. */
export function landmarksIn(
  x0: number, z0: number, x1: number, z1: number,
): Landmark[] {
  const out: Landmark[] = [];
  if (!haveVeg()) return out;
  const c0x = Math.floor(Math.min(x0, x1) / PITCH);
  const c1x = Math.floor(Math.max(x0, x1) / PITCH);
  const c0z = Math.floor(Math.min(z0, z1) / PITCH);
  const c1z = Math.floor(Math.max(z0, z1) / PITCH);
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const tree = landmarkAt(cx, cz);
      if (tree) out.push(tree);
    }
  }
  return out;
}

/** Every tree within a radius of a point. */
export function landmarksNear(at: WorldPoint, radius: number): Landmark[] {
  return landmarksIn(at.wx - radius, at.wz - radius, at.wx + radius, at.wz + radius)
    .filter((tree) => Math.hypot(tree.at.wx - at.wx, tree.at.wz - at.wz) <= radius);
}

/** Distance from a point to a segment, world units. */
export function offLeg(p: WorldPoint, a: WorldPoint, b: WorldPoint): number {
  const dx = b.wx - a.wx;
  const dz = b.wz - a.wz;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((p.wx - a.wx) * dx + (p.wz - a.wz) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.wx - (a.wx + dx * t), p.wz - (a.wz + dz * t));
}

/** What a leg was planned against, and what it was not shown. */
export interface TreesAlong {
  readonly hazards: Hazard[];
  /** Trees inside the corridor. */
  readonly considered: number;
  /** Of those, the ones past the cap — she may be routed through them. */
  readonly dropped: number;
}

const NONE: TreesAlong = { hazards: [], considered: 0, dropped: 0 };

/**
 * THE TREES ONE LEG IS PLANNED AGAINST.
 *
 * Walks the leg half a pitch at a time and looks at the ring of cells
 * round each step, so the cost is the leg's LENGTH and not the area of
 * its bounding box — a diagonal crossing of the island is a few
 * thousand cells this way and six million the other. Every tree inside
 * `CORRIDOR` of the line is found: a tree within the corridor is within
 * corridor + a quarter pitch of some step, and that is inside the ring.
 *
 * Nearest to the line first, capped at `most`, and the ones past the
 * cap are COUNTED rather than pretended away: a leg that reports
 * `dropped > 0` is a leg she may fly through a tree on, and that has
 * to be visible in the readout before anyone trusts the number.
 *
 * `top: null` — go round, never over. Not because she could not climb
 * it: the planner raises the WHOLE leg to clear anything with a top,
 * and a 400 m leg flown at twenty-six metres to pass one trunk is the
 * wrong trade; and `top` is measured above the ground under HER, so a
 * tree upslope of her would be under-cleared. Numeric tops belong to
 * the bush tier, where flying over is the right answer.
 */
export function treeHazardsAlong(
  from: WorldPoint, to: WorldPoint, most = MOST_PER_LEG, corridor = CORRIDOR,
): TreesAlong {
  if (!haveVeg()) return NONE;
  const length = Math.hypot(to.wx - from.wx, to.wz - from.wz);
  const steps = Math.max(1, Math.ceil(length / (PITCH / 2)));
  const seen = new Set<string>();
  const found: { tree: Landmark; off: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const px = from.wx + (to.wx - from.wx) * s;
    const pz = from.wz + (to.wz - from.wz) * s;
    const here = cellOf({ wx: px, wz: pz });
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = here.cx + dx;
        const cz = here.cz + dz;
        const key = `${cx},${cz}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Where it WOULD stand, before the dearer question of whether
        // it does — most cells are nowhere near the line.
        const seat = seatOf(cx, cz);
        const off = offLeg(seat, from, to);
        if (off > corridor) continue;
        const tree = landmarkAt(cx, cz);
        if (tree) found.push({ tree, off });
      }
    }
  }
  if (found.length === 0) return NONE;
  found.sort((a, b) => a.off - b.off);
  const kept = found.slice(0, most);
  return {
    hazards: kept.map(({ tree }) => ({
      id: tree.id,
      at: tree.at,
      radius: tree.trunk,
      top: null,
      kind: 'obstacle',
      label: 'tree',
    })),
    considered: found.length,
    dropped: found.length - kept.length,
  };
}
