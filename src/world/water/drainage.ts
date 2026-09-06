/**
 * WHERE THIS GROUND SENDS ITS WATER — D8 flow accumulation.
 *
 * Pure analysis of a heightfield. It READS the terrain and writes
 * nothing (CLAUDE.md: "The terrain is not ours to move"), and it needs no
 * survey: the channels it finds are the ones the island's own shape
 * defines. Joshua's standing rule is that the terrain decides, and this
 * is that rule expressed as arithmetic.
 *
 * WHY IT EXISTS. Baseflow is not rain. In real hydrology a river runs
 * between storms because groundwater seeps into its CHANNEL — the
 * hillsides above it are dry. Feeding an island by raining on its upper
 * half forever does get water into the channels, but it also leaves every
 * slope permanently wet, which is not what an island looks like and not
 * what Joshua expected when he asked whether it would drain.
 *
 * So the two feeds are separated (`sim.ts`, `WaterFeed`) and this is what
 * makes that possible: baseflow goes into cells with enough upstream area
 * to be a watercourse, and rain goes on everything only while it is
 * actually raining. Between showers the slopes soak dry and the drainage
 * keeps running.
 *
 * D8: each cell gives all its water to the steepest downhill neighbour of
 * eight. Crude next to a real routing model and exactly right here — the
 * question is "is this cell a watercourse", not "what is its discharge in
 * cumecs".
 *
 * RUN IT ONCE, OVER GROUND THAT DOES NOT MOVE. Accumulation over a finite
 * window depends on where the rim falls, because the upstream area is
 * truncated there: v0 ran D8 on its 256 m window's own bed at every
 * re-centre, and two windows one re-centre apart disagreed on 16% of
 * their shared channel cells — the rivers were re-invented per camera
 * position and visibly morphed as the player flew at them (found by an
 * outside review of v0, whose diagnosis was right even though its
 * proposed fix carved the terrain). The answer is to accumulate ONCE over
 * the whole immutable island and have the moving window look membership
 * up: `WaterSim.channelMask` takes exactly that kind of world-fixed
 * predicate.
 *
 * RESOLUTION, HONESTLY. On the coarse island grid a node is 54.7 m, so
 * "watercourse" there is a 55 m-wide claim and not a 1 m one. That is
 * fine, and it is why the split works at all: the mask only says where
 * baseflow ENTERS. The 1 m solver still routes that water downhill inside
 * its window, so it gathers into the true thalweg on its own — feed
 * placement is coarse, routing is fine, and nothing anywhere touches the
 * terrain.
 *
 * Pure: no three, no DOM, no fetch. `src/world/` is core.
 */

/** Diagonal steps are longer, so a diagonal must be steeper to win. */
const ROOT2 = Math.SQRT2;

/** World units in a metre. A unit is a centimetre; see CLAUDE.md on true scale. */
const UNITS_PER_METRE = 100;

/**
 * Upstream cell count for every cell of an `n` x `n` bed, row-major.
 *
 * A cell's own area counts, so the minimum is 1 and a value of 500 means
 * five hundred cells drain through here. `bed` is read and never written.
 *
 * ONE PASS, IN DESCENDING HEIGHT, so a cell is always resolved after
 * everything that could drain into it. That is what makes a single pass
 * correct: no iteration to convergence, and no chance of a cycle. Ties in
 * height do not route at all — a neighbour at the same height has no drop
 * — so the order among equal heights cannot change the answer.
 *
 * A PIT KEEPS ITS WATER. D8 has no answer for a closed depression and
 * this deliberately does not invent one (the usual fix, filling the pits,
 * is a write to the terrain in everything but name). The shallow-water
 * solver is the part that is good at pits: it pools there and spills at
 * the lowest rim on its own.
 */
export function flowAccumulation(bed: Float32Array, n: number): Float32Array {
  if (!Number.isInteger(n) || n < 2) throw new Error('water/drainage: n must be at least 2');
  if (bed.length !== n * n) {
    throw new Error(`water/drainage: the bed is ${bed.length} cells and n says ${n * n}`);
  }
  const acc = new Float32Array(n * n).fill(1);

  // An Int32Array of indices sorted by height, rather than v0's boxed
  // `Array.from(...).sort(...)`: the island grid is 1,050,625 cells and
  // the boxed version allocates a JS array of that many numbers to throw
  // away. Same order, same answer — %TypedArray%.sort takes the same
  // comparator.
  const order = new Int32Array(n * n);
  for (let i = 0; i < order.length; i += 1) order[i] = i;
  order.sort((a, b) => bed[b] - bed[a]);

  for (let k = 0; k < order.length; k += 1) {
    const i = order[k];
    const cx = i % n;
    const cy = (i / n) | 0;
    const here = bed[i];
    let best = -1;
    let steepest = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = cy + dy;
      if (ny < 0 || ny >= n) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        if (nx < 0 || nx >= n) continue;
        const j = ny * n + nx;
        const drop = here - bed[j];
        if (drop <= 0) continue;
        const slope = drop / (dx !== 0 && dy !== 0 ? ROOT2 : 1);
        if (slope > steepest) {
          steepest = slope;
          best = j;
        }
      }
    }
    if (best >= 0) acc[best] += acc[i];
  }
  return acc;
}

/**
 * Minimum upstream catchment for a cell to carry a watercourse, in SQUARE
 * METRES of real ground.
 *
 * An area rather than v0's fraction of the window, and the difference is
 * the same lesson as the header's: a share of the grid means a different
 * river every time the grid changes size, while an area is a fact about
 * the island. Real channel initiation in wet climates sits around
 * 10^4..10^5 m²; v0 swept this against the surveyed NHDPlus network and
 * shipped 120,000, which on the coarse island grid marks about 2% of the
 * land as channel.
 *
 * Measured here on Waimea Canyon, a 2.56 km window at 20 m cells over the
 * shipped survey: 2.1% of cells pass, 288 of them are valley floors, and
 * NOT ONE is a ridge (`tests/worldWaterSim.test.ts`).
 *
 * Tuning informed by hydrology, not measured hydrology.
 */
export const CATCHMENT_M2 = 120_000;

/**
 * A mask of the cells that carry a watercourse: 1 channel, 0 not.
 *
 * `cell` is the grid's spacing in WORLD UNITS (a unit is a centimetre),
 * because the threshold is a real area and the two only meet through the
 * cell size. Passing metres here would mark ten thousand times too much
 * of the island as river, which is the kind of unit bug true scale makes
 * cheap to write and expensive to see.
 */
export function channelMask(
  bed: Float32Array,
  n: number,
  cell: number,
  minCatchmentM2: number = CATCHMENT_M2,
): Uint8Array {
  if (!(cell > 0)) throw new Error('water/drainage: cell must be a positive world-unit spacing');
  const acc = flowAccumulation(bed, n);
  const metres = cell / UNITS_PER_METRE;
  const needCells = minCatchmentM2 / (metres * metres);
  const mask = new Uint8Array(n * n);
  for (let i = 0; i < mask.length; i += 1) mask[i] = acc[i] >= needCells ? 1 : 0;
  return mask;
}

/**
 * The real ground draining through a cell, in square metres.
 *
 * The reading `CATCHMENT_M2` is compared against, exposed so a probe or a
 * dev tool can print the same number the threshold is written in rather
 * than a cell count nobody can check against hydrology.
 */
export function catchmentM2(upstreamCells: number, cell: number): number {
  const metres = cell / UNITS_PER_METRE;
  return upstreamCells * metres * metres;
}
