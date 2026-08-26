import { hydro } from './hydro';
import { SPAN } from './kauai';

/**
 * THE BED A SURVEYED RIVER RUNS IN.
 *
 * 70.3% of the network already sits below the ground it belongs to —
 * the valleys are real and the water is real, so mostly they agree. The
 * other 30% is buried by a median of nothing and a p90 of 1.24 m, which
 * breaks a run into a chain of pools: from the air the Hanalei traces
 * its own valley perfectly and does it as a dotted line.
 *
 * A metre and a quarter is a streambed. So one is cut, and BE cuts one
 * too — nothing at 13.67 m resolution holds a five-metre channel, not
 * even real terrain.
 *
 * THIS IS THE THIRD CARVE THIS PROJECT HAS HAD AND THE FIRST WITH BOTH
 * PROPERTIES IT NEEDED. The others failed in ways worth naming, because
 * the failures are what these two rules are:
 *
 *   IT IS NOT GATED. The old carve ran through `flowAt`, which stops
 *   answering at the collision index's claim — so past that radius the
 *   cut went from full depth to nothing between one lattice vertex and
 *   the next. A 73 cm cliff in 8 cm of ground, repeated down every bank
 *   as a row of fins. Nothing here can refuse: the cut is a function of
 *   distance to a centreline and `bank()` brings it to zero, and to
 *   zero SLOPE, at its own edge.
 *
 *   IT TAKES THE DEEPEST, NOT THE NEAREST. Selecting one segment and
 *   carving from its numbers looks equivalent and is not: two points
 *   either side of a Voronoi boundary pick different segments carrying
 *   different levels, so the cut jumps where the choice flips —
 *   measured at 48 cm in two units of travel. A maximum of continuous
 *   functions is continuous, which selection is not, and it is the
 *   better answer anyway: a confluence gets one merged hollow instead
 *   of a seam down the middle of it.
 *
 * And the third property, which is new and is the whole reason this one
 * should work: THE CENTRELINE IS SURVEYED. The old carves dug beds for
 * rivers derived from a blurred island, so the bed and the water and
 * the ground were three guesses that drifted apart. This digs where
 * USGS says the river is, on terrain from the same survey.
 */

/** How deep the water stands over its bed, in units. 30 cm. */
export const DRAUGHT = 30;

/**
 * The most any point may be lowered, however high it stands.
 *
 * Three metres. The p90 burial is 1.24 m so this clears the gaps with
 * margin, and the cap is what stops a stream that clips the shoulder of
 * a ridge from slicing a bench out of it — which is exactly what killed
 * the FIRST carve this project had, back when it pressed ground toward
 * a level with no bound at all and cut benches into the Nāpali walls.
 *
 * The 1% of the network buried deeper than this stays broken. That is
 * the honest trade: those are narrow gorges the 13.67 m grid cannot see,
 * and inventing thirteen metres of canyon to reach them is how the last
 * rebuild started.
 */
export const MAX_CUT = 300;

/**
 * How wide the bed is, from the surveyed channel — and the SAME
 * half-width the surface is drawn to.
 *
 * Shared deliberately. The drawn ribbon and the cut bed are the two
 * things that have to agree about where a river is, and the entire
 * history of this file is descriptions of one river drifting apart. One
 * function, two callers, nothing to keep in step.
 */
const MIN_HALF = 60;
export function channelHalf(width: number): number {
  return Math.max(MIN_HALF, width / 2);
}

/** How far past the channel the cut reaches, as a multiple of its half. */
export const SHOULDER = 1.5;

/**
 * AND NO BANK STEEPER THAN THIS, whatever the channel's width says.
 *
 * A narrow stream asks for a narrow bed, and a narrow bed given a
 * three-metre cut is a wall: at the 60-unit floor the reach is 90 units,
 * so the whole profile crosses three vertices of the 32-unit lattice
 * and each one steps 71 cm. Measured, and that lattice is what she sees
 * from eight metres out.
 *
 * So the reach also has a floor proportional to the DEEPEST cut
 * allowed. Two units of bank per unit of depth holds the profile's
 * steepest point near 1-in-1 however narrow the water is — which is
 * what a real streambank looks like anyway, since a channel cut a metre
 * into soil does not stand vertical.
 */
const BANK_RUN = 2;

/**
 * 1 on the centreline, 0 at the outer edge of the cut.
 *
 * Smootherstep, so the bank leaves the flat and reaches the bed with no
 * step in slope OR curvature. A raised cosine has zero slope at both
 * ends but not zero curvature, and the eye reads a curvature step as an
 * edge — which is the hard corner at the top of every trench the first
 * version of this cut.
 */
export function bank(t: number): number {
  const at = Math.min(1, Math.max(0, t));
  return 1 - at * at * at * (at * (at * 6 - 15) + 10);
}

/** Segment index: 163 m cells, each listing the runs that cross it. */
const CELL = 16_384;
const CELLS = Math.ceil(SPAN / CELL);
let heads: Int32Array | null = null;
let counts: Int32Array | null = null;
let buckets: Int32Array | null = null;
let ax: Float64Array | null = null;
let az: Float64Array | null = null;
let bx: Float64Array | null = null;
let bz: Float64Array | null = null;
let aLev: Float64Array | null = null;
let bLev: Float64Array | null = null;
let reach: Float64Array | null = null;

/** Build the index from the loaded hydrography. Idempotent. */
export function indexRiverBeds(): void {
  const data = hydro();
  if (!data) { forgetRiverBeds(); return; }
  let segments = 0;
  for (const r of data.rivers) segments += Math.max(0, r.count - 1);
  ax = new Float64Array(segments); az = new Float64Array(segments);
  bx = new Float64Array(segments); bz = new Float64Array(segments);
  aLev = new Float64Array(segments); bLev = new Float64Array(segments);
  reach = new Float64Array(segments);
  let at = 0;
  for (const r of data.rivers) {
    for (let i = 0; i < r.count - 1; i++, at++) {
      const p = r.first + i;
      ax[at] = data.x[p]; az[at] = data.z[p];
      bx[at] = data.x[p + 1]; bz[at] = data.z[p + 1];
      aLev[at] = data.level[p]; bLev[at] = data.level[p + 1];
      // The wider of the two ends, so the reach never narrows below
      // what either station asks for.
      reach[at] = Math.max(
        SHOULDER * channelHalf(Math.max(data.width[p], data.width[p + 1])),
        BANK_RUN * MAX_CUT,
      );
    }
  }
  // Each segment is folded into every cell its reach can touch, so a
  // miss needs no geometry — which is almost every query on the island.
  const found: number[][] = [];
  for (let s = 0; s < segments; s++) {
    const far = reach[s];
    const x0 = Math.max(0, Math.floor((Math.min(ax[s], bx[s]) - far + SPAN / 2) / CELL));
    const x1 = Math.min(CELLS - 1, Math.floor((Math.max(ax[s], bx[s]) + far + SPAN / 2) / CELL));
    const z0 = Math.max(0, Math.floor((Math.min(az[s], bz[s]) - far + SPAN / 2) / CELL));
    const z1 = Math.min(CELLS - 1, Math.floor((Math.max(az[s], bz[s]) + far + SPAN / 2) / CELL));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) (found[cz * CELLS + cx] ??= []).push(s);
    }
  }
  heads = new Int32Array(CELLS * CELLS).fill(-1);
  counts = new Int32Array(CELLS * CELLS);
  let total = 0;
  for (const list of found) total += list?.length ?? 0;
  buckets = new Int32Array(total);
  let write = 0;
  for (let cell = 0; cell < CELLS * CELLS; cell++) {
    const list = found[cell];
    if (!list) continue;
    heads[cell] = write;
    counts[cell] = list.length;
    for (const s of list) buckets[write++] = s;
  }
}

export function forgetRiverBeds(): void {
  heads = counts = buckets = null;
  ax = az = bx = bz = aLev = bLev = reach = null;
}

/** True once there is a bed to cut. */
export function riverBedsReady(): boolean {
  return heads !== null;
}

/**
 * How far the ground is lowered here — never negative, never more than
 * MAX_CUT, and zero outside every channel.
 *
 * `land` is the surface before any cut. The bed is aimed at one draught
 * below the WATER rather than below the ground, because a bed measured
 * from the ground would follow every bump in it and the water would not.
 */
export function riverCut(x: number, z: number, land: number): number {
  if (!heads || !counts || !buckets) return 0;
  const cx = Math.floor((x + SPAN / 2) / CELL);
  const cz = Math.floor((z + SPAN / 2) / CELL);
  if (cx < 0 || cz < 0 || cx >= CELLS || cz >= CELLS) return 0;
  const cell = cz * CELLS + cx;
  const from = heads[cell];
  if (from < 0) return 0;

  let deepest = 0;
  const many = counts[cell];
  for (let n = 0; n < many; n++) {
    const s = buckets[from + n];
    const far = reach![s];
    if (x < Math.min(ax![s], bx![s]) - far || x > Math.max(ax![s], bx![s]) + far) continue;
    if (z < Math.min(az![s], bz![s]) - far || z > Math.max(az![s], bz![s]) + far) continue;
    const ex = bx![s] - ax![s];
    const ez = bz![s] - az![s];
    const run = ex * ex + ez * ez;
    const t = run > 0
      ? Math.max(0, Math.min(1, ((x - ax![s]) * ex + (z - az![s]) * ez) / run)) : 0;
    const dx = x - (ax![s] + ex * t);
    const dz = z - (az![s] + ez * t);
    const off = Math.hypot(dx, dz);
    if (off >= far) continue;
    const shape = bank(off / far);
    const bed = aLev![s] + (bLev![s] - aLev![s]) * t - DRAUGHT;
    // THE BOUND IS SHAPED TOO. A flat cap would hold the cut at its
    // maximum all the way out and then drop it to nothing at the edge,
    // which is a vertical wall down both sides of every river on
    // sloping ground. Shaping it with the same curve as the bed means
    // the most that may be taken at the outer edge is nothing.
    const cut = Math.min(MAX_CUT * shape, Math.max(0, land - bed));
    if (cut > deepest) deepest = cut;
  }
  return deepest;
}
