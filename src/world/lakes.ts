/**
 * KAUAʻI'S LAKES, PRESSED INTO THE ISLAND.
 *
 * 111 of them from USGS NHDPlus HR — mostly plantation reservoirs, plus
 * the Alakaʻi bogs — each with a real shoreline ring and a real baked
 * waterline. See hydro.ts for where they come from.
 *
 * THEY DO NOT FIT, AND THAT IS THE WHOLE REASON THIS FILE EXISTS.
 * WATER_PORT.md said lakes would need no carve because they already sit
 * in basins. Measured, they do not:
 *
 *   median lake width          130 m
 *   height-grid sample spacing  55 m
 *   lakes whose terrain is ABOVE their own waterline   72 of 111
 *
 * A lake two or three samples across has no basin in a grid this
 * coarse — the hollow is averaged flat and the waterline ends up buried
 * in a hillside by a median of eighty centimetres. Drawn as flat
 * polygons at their stated level, most of them would be underground.
 *
 * So the ground is pressed down under them, and the good news is that
 * lakes are the EASY half of the carve. A river is 5.5 m across and
 * cannot survive the 312.5-unit transition tier; a lake is 130 m across
 * and gets forty vertices there. The hard tier-handover problem that
 * WATER_PORT.md 3a describes for rivers simply does not arise.
 *
 * THE CARVE IS A FUNCTION, NOT A BAKE, for the reason 3b gives: the
 * grid is 5,463 units a sample and cannot hold a lake edge. Evaluated
 * inside `terrainHeight`, it reaches the mesh, `groundHeight`, the
 * camera's floor clamp and the flight telemetry at once, so all four
 * agree about the bed instead of agreeing by arrangement.
 *
 * GLOBAL COORDINATES throughout. Nothing here goes near the GPU.
 */
import { SPAN } from './kauai';
import type { Hydro, Lake } from './hydro';

/**
 * How far below its waterline a lake's bed is pressed, in world units.
 * Two metres, Beyond Extinction's figure, and deep enough that the
 * surface reads as a body of water rather than a wet sheen.
 */
export const LAKE_DEPTH = 200;

/**
 * How far in from the shore the full depth is reached.
 *
 * Ten metres rather than BE's fifteen, because the median lake here is
 * 130 m across and a feather that eats a fifth of it from each side
 * leaves a bowl with no bottom. Clamped again per lake below, so the
 * smallest reservoir still gets a floor.
 */
export const LAKE_FEATHER = 1_000;

/** The bed is never pressed below this, so a low lake cannot read as sea. */
export const SHALLOWEST = 20;

/**
 * How far under the waterline the ground just OUTSIDE a lake is taken
 * when a coarse vertex stands for a piece of that lake.
 *
 * Only far enough that the surface is not coplanar with the ground it
 * is drawn against. The rim is not a bank — the bank belongs to the
 * eased profile inside the shore — it is the smallest concession that
 * stops a plate poking through the vertex next to it.
 */
const BRIM = 20;

/**
 * THE WIDEST FOOTPRINT A COARSE TIER MAY ASK ABOUT, in world units.
 * Bounded well under CELL so the one-cell neighbour walk in `lakeBed`
 * cannot miss a basin. See the
 * matching constant in rivers.ts for why any of this exists.
 */
export const CARVE_SLACK = 5_000;

/**
 * Index cell size. Five hundred metres: comfortably larger than all but
 * the biggest lake, so most lakes touch one or two cells, and coarse
 * enough that the whole island is a 112-square grid rather than a
 * hundred thousand mostly-empty buckets.
 */
const CELL = 50_000;
const CELLS = Math.ceil(SPAN / CELL);

interface Basin {
  /** Where the surface sits, world units above the sea. */
  readonly level: number;
  /** What the bed is pressed to. */
  readonly floor: number;
  /** How far in from the shore the floor is reached, for this lake. */
  readonly feather: number;
  /** Ring 0 is the shore; the rest are islands. Flat x,z pairs. */
  readonly rings: readonly Float64Array[];
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * WHICH LAKES COULD POSSIBLY BE HERE.
 *
 * `terrainHeight` is the hottest path in the world — every terrain
 * vertex, every ground query, and up to a hundred and ninety times a
 * frame from the touchdown solver — so the common answer, which is
 * "none", has to cost almost nothing. A flat array of bucket heads
 * makes it two reads and a comparison; a Map would make it a hash.
 */
let heads: Int32Array | null = null;
let counts: Int32Array | null = null;
let buckets: Int32Array | null = null;
let basins: Basin[] = [];

function cellOf(x: number, z: number): number {
  const cx = Math.floor((x + SPAN / 2) / CELL);
  const cz = Math.floor((z + SPAN / 2) / CELL);
  if (cx < 0 || cz < 0 || cx >= CELLS || cz >= CELLS) return -1;
  return cz * CELLS + cx;
}

/** Read the lakes out of the hydrography and build the index. */
export function useLakes(hydro: Hydro): void {
  basins = hydro.lakes.map((lake) => build(lake, hydro));
  index();
}

/** Throw it away — scene resets and tests. */
export function forgetLakes(): void {
  basins = [];
  heads = null;
  counts = null;
  buckets = null;
}

/** How many lakes are loaded. */
export function lakeCount(): number {
  return basins.length;
}

/** What a renderer needs to draw one: shape, level, and where it is. */
export interface LakeShape {
  readonly level: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** The lakes whose water is within `reach` of a point, nearest first. */
export function lakesNear(x: number, z: number, reach: number): number[] {
  const found: { at: number; gap: number }[] = [];
  for (let i = 0; i < basins.length; i++) {
    const lake = basins[i];
    // Distance to the box, which is zero when the point is inside it.
    const dx = Math.max(lake.minX - x, 0, x - lake.maxX);
    const dz = Math.max(lake.minZ - z, 0, z - lake.maxZ);
    const gap = Math.hypot(dx, dz);
    if (gap <= reach) found.push({ at: i, gap });
  }
  found.sort((a, b) => a.gap - b.gap);
  return found.map((f) => f.at);
}

/** The box and level of one lake, by index. */
export function lakeShape(at: number): LakeShape {
  const lake = basins[at];
  return {
    level: lake.level,
    minX: lake.minX,
    maxX: lake.maxX,
    minZ: lake.minZ,
    maxZ: lake.maxZ,
  };
}

/**
 * Is this point that lake's water?
 *
 * By index, so a renderer tessellating ONE lake is not asked to
 * rediscover which lake it is at every sample — and so two overlapping
 * boxes cannot make one lake's mesh borrow the other's shape.
 */
export function insideLake(at: number, x: number, z: number): boolean {
  const lake = basins[at];
  if (x < lake.minX || x > lake.maxX || z < lake.minZ || z > lake.maxZ) return false;
  if (!inside(lake.rings[0], x, z)) return false;
  for (let r = 1; r < lake.rings.length; r++) {
    if (inside(lake.rings[r], x, z)) return false;
  }
  return true;
}

function build(lake: Lake, hydro: Hydro): Basin {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const rings = lake.rings.map((ring) => {
    const flat = new Float64Array(ring.count * 2);
    for (let i = 0; i < ring.count; i++) {
      const at = ring.first + i;
      flat[i * 2] = hydro.ringX[at];
      flat[i * 2 + 1] = hydro.ringZ[at];
    }
    return flat;
  });
  const shore = rings[0];
  for (let i = 0; i < shore.length; i += 2) {
    if (shore[i] < minX) minX = shore[i];
    if (shore[i] > maxX) maxX = shore[i];
    if (shore[i + 1] < minZ) minZ = shore[i + 1];
    if (shore[i + 1] > maxZ) maxZ = shore[i + 1];
  }
  // A feather wider than the lake is half a lake with no floor at all.
  const across = Math.min(maxX - minX, maxZ - minZ);
  return {
    level: lake.level,
    floor: Math.max(SHALLOWEST, lake.level - LAKE_DEPTH),
    feather: Math.max(1, Math.min(LAKE_FEATHER, across * 0.3)),
    rings,
    minX,
    maxX,
    minZ,
    maxZ,
  };
}

function index(): void {
  const found: number[][] = [];
  for (let i = 0; i < basins.length; i++) {
    const lake = basins[i];
    const x0 = Math.max(0, Math.floor((lake.minX + SPAN / 2) / CELL));
    const x1 = Math.min(CELLS - 1, Math.floor((lake.maxX + SPAN / 2) / CELL));
    const z0 = Math.max(0, Math.floor((lake.minZ + SPAN / 2) / CELL));
    const z1 = Math.min(CELLS - 1, Math.floor((lake.maxZ + SPAN / 2) / CELL));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = cz * CELLS + cx;
        (found[cell] ??= []).push(i);
      }
    }
  }
  heads = new Int32Array(CELLS * CELLS).fill(-1);
  counts = new Int32Array(CELLS * CELLS);
  let total = 0;
  for (const list of found) total += list?.length ?? 0;
  buckets = new Int32Array(total);
  let at = 0;
  for (let cell = 0; cell < found.length; cell++) {
    const list = found[cell];
    if (!list) continue;
    heads[cell] = at;
    counts[cell] = list.length;
    for (const i of list) buckets[at++] = i;
  }
}

/** Even-odd ray cast. True when the point is inside this ring. */
function inside(ring: Float64Array, x: number, z: number): boolean {
  let within = false;
  const points = ring.length / 2;
  for (let i = 0, j = points - 1; i < points; j = i++) {
    const zi = ring[i * 2 + 1];
    const zj = ring[j * 2 + 1];
    if ((zi > z) === (zj > z)) continue;
    const xi = ring[i * 2];
    const xj = ring[j * 2];
    if (x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) within = !within;
  }
  return within;
}

/** How far the point is from a ring's nearest edge. */
function toEdge(ring: Float64Array, x: number, z: number): number {
  let best = Infinity;
  const points = ring.length / 2;
  for (let i = 0, j = points - 1; i < points; j = i++) {
    const ax = ring[j * 2];
    const az = ring[j * 2 + 1];
    const bx = ring[i * 2];
    const bz = ring[i * 2 + 1];
    const ex = bx - ax;
    const ez = bz - az;
    const run = ex * ex + ez * ez;
    // Project onto the segment, clamped to its ends.
    const t = run > 0
      ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / run))
      : 0;
    const dx = x - (ax + ex * t);
    const dz = z - (az + ez * t);
    const gap = dx * dx + dz * dz;
    if (gap < best) best = gap;
  }
  return Math.sqrt(best);
}

/**
 * WHAT THE GROUND IS HERE, IF A LAKE HAS ANYTHING TO SAY ABOUT IT.
 *
 * Returns the height the bed should be pressed to, or null when this
 * point is not in a lake — which is almost every point on the island,
 * and is the case that has to be free.
 *
 * The floor is ABSOLUTE rather than a depth below the existing ground,
 * because the existing ground is frequently ABOVE the waterline: a
 * relative cut would dig a two-metre trench in a hilltop and leave the
 * lake still buried in it. Taken as a minimum, never a maximum, so a
 * lake can only ever lower the island.
 */
export function lakeBed(x: number, z: number, slack = 0): number | null {
  if (!heads || !counts || !buckets) return null;
  const give = Math.max(0, Math.min(slack, CARVE_SLACK));
  const cx = Math.floor((x + SPAN / 2) / CELL);
  const cz = Math.floor((z + SPAN / 2) / CELL);
  if (cx < 0 || cz < 0 || cx >= CELLS || cz >= CELLS) return null;
  if (give === 0) return claim(cz * CELLS + cx, x, z, 0);

  // One cell of neighbours, for the reason rivers.ts gives: a lake
  // whose box is wholly in the next cell can still be inside a coarse
  // vertex's footprint. CELL is 50,000 and the footprint is bounded at
  // 2,000, so the walk is generous by a wide margin.
  let low: number | null = null;
  for (let dz = -1; dz <= 1; dz++) {
    const nz = cz + dz;
    if (nz < 0 || nz >= CELLS) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx;
      if (nx < 0 || nx >= CELLS) continue;
      const bed = claim(nz * CELLS + nx, x, z, give);
      if (bed !== null && (low === null || bed < low)) low = bed;
    }
  }
  return low;
}

/** The lowest bed any lake in one bucket presses here, or null. */
function claim(cell: number, x: number, z: number, give: number): number | null {
  const from = heads![cell];
  if (from < 0) return null;

  let low: number | null = null;
  const many = counts![cell];
  for (let n = 0; n < many; n++) {
    const lake = basins[buckets![from + n]];
    if (x < lake.minX - give || x > lake.maxX + give) continue;
    if (z < lake.minZ - give || z > lake.maxZ + give) continue;

    // How far in from the water's edge this point is: positive inside
    // the lake, negative on the bank or on an island in it.
    let near = toEdge(lake.rings[0], x, z);
    let wet = inside(lake.rings[0], x, z);
    for (let r = 1; r < lake.rings.length; r++) {
      near = Math.min(near, toEdge(lake.rings[r], x, z));
      // An island in the lake is not the lake.
      if (inside(lake.rings[r], x, z)) wet = false;
    }
    if (!wet) near = -near;

    // The footprint reaches `give` further in than the vertex does.
    const reach = near + give;
    if (reach <= 0) continue;

    // Inside, the eased profile, so the bank is a bank and not a wall.
    // Outside — a vertex that merely STANDS FOR some water — only the
    // brim, because the ground there is still ground and lowering it to
    // the floor would dig a moat the finer tier does not have.
    const t = Math.min(1, reach / lake.feather);
    const eased = t * t * (3 - 2 * t);
    const bed = near > 0
      ? lake.level + (lake.floor - lake.level) * eased
      : lake.level - BRIM;
    if (low === null || bed < low) low = bed;
  }
  return low;
}

/** The surface height of the lake at this point, or null. */
export function lakeLevel(x: number, z: number): number | null {
  if (!heads || !counts || !buckets) return null;
  const cell = cellOf(x, z);
  if (cell < 0) return null;
  const from = heads[cell];
  if (from < 0) return null;
  const many = counts[cell];
  for (let n = 0; n < many; n++) {
    const lake = basins[buckets[from + n]];
    if (x < lake.minX || x > lake.maxX || z < lake.minZ || z > lake.maxZ) continue;
    if (!inside(lake.rings[0], x, z)) continue;
    let onLand = false;
    for (let r = 1; r < lake.rings.length; r++) {
      if (inside(lake.rings[r], x, z)) { onLand = true; break; }
    }
    if (!onLand) return lake.level;
  }
  return null;
}
