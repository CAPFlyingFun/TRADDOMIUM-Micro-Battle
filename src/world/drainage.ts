/**
 * WHERE THIS GROUND SENDS ITS WATER — D8 flow accumulation.
 *
 * Pure analysis of a heightfield. It READS the terrain and writes
 * nothing (CLAUDE.md: "The terrain is not ours to move"), and it needs
 * no survey: the channels it finds are the ones the island's own shape
 * defines.
 *
 * WHY IT EXISTS. Baseflow is not rain. In real hydrology a river runs
 * between storms because groundwater seeps into its CHANNEL — the
 * hillsides above it are dry. Feeding an island by raining on its
 * upper half forever gets water into the channels, but it also leaves
 * every slope permanently wet, which is not what an island looks like
 * and not what Joshua expected when he asked whether it would drain.
 *
 * So the two feeds are separated, and this is what makes that
 * possible: baseflow goes into cells with enough upstream area to be a
 * watercourse, and rain goes on everything only while it is actually
 * raining. Between showers the slopes soak dry and the drainage keeps
 * running, which is the behaviour he described.
 *
 * D8: each cell gives all its water to its steepest downhill
 * neighbour of eight. Crude next to a real routing model and exactly
 * right here — we are asking "is this cell a watercourse", not "what
 * is its discharge in cumecs".
 */

/** Diagonal steps cost more, so a diagonal must be steeper to win. */
const ROOT2 = Math.SQRT2;

/**
 * Upstream cell count for every cell of an n x n bed.
 *
 * A cell's own area counts, so the minimum is 1 and a value of 500
 * means five hundred cells drain through here.
 */
export function flowAccumulation(bed: Float32Array, n: number): Float32Array {
  const acc = new Float32Array(n * n).fill(1);
  // DESCENDING HEIGHT, so a cell is always resolved after everything
  // that could drain into it. This is what makes a single pass right;
  // no iteration to convergence and no chance of a cycle.
  const order = new Int32Array(n * n);
  for (let i = 0; i < order.length; i++) order[i] = i;
  const sorted = Array.from(order).sort((a, b) => bed[b] - bed[a]);

  for (const i of sorted) {
    const cx = i % n;
    const cy = (i / n) | 0;
    const here = bed[i];
    let best = -1;
    let steepest = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        const drop = here - bed[j];
        if (drop <= 0) continue;
        const slope = drop / (dx !== 0 && dy !== 0 ? ROOT2 : 1);
        if (slope > steepest) { steepest = slope; best = j; }
      }
    }
    // A pit keeps its water; the solver will pool there and spill on
    // its own, which is the part D8 is bad at and the shallow-water
    // model is good at.
    if (best >= 0) acc[best] += acc[i];
  }
  return acc;
}

/**
 * A mask of the cells that carry a watercourse.
 *
 * `share` is the fraction of the window that must drain through a cell
 * before it counts — so it scales with the window rather than being a
 * magic cell count.
 */
export function channels(bed: Float32Array, n: number, share: number): Uint8Array {
  const acc = flowAccumulation(bed, n);
  const need = n * n * share;
  const mask = new Uint8Array(n * n);
  for (let i = 0; i < mask.length; i++) mask[i] = acc[i] >= need ? 1 : 0;
  return mask;
}
