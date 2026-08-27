import { flowAccumulation } from './drainage';
import { HEIGHT_SCALE, SAMPLES, SPAN, type HeightGrid } from './kauai';

/**
 * THE ISLAND'S OWN DRAINAGE, DERIVED ONCE — the world-space channel map.
 *
 * THE BUG THIS FIXES was found by an outside review (PR #2), and its
 * diagnosis was right: the window ran D8 flow accumulation on ITS OWN
 * 256 m bed every re-centre, and accumulation over a finite moving
 * window depends on where the rim happens to fall — the upstream area
 * is truncated there. Measured, two windows one re-centre apart
 * disagreed on 16% of their shared channel cells. The rivers were being
 * re-invented per camera position, and Joshua watched them morph as she
 * flew toward them.
 *
 * THE FIX THE PR PROPOSED was to lock the channels to the surveyed
 * centrelines and carve the sim's bed along them. Locking is right;
 * both halves of the how are wrong here. The carve breaks the standing
 * rule (CLAUDE.md — the water's own ground counts), and it re-creates
 * the floating sheet: a trench below the surrounding ground must FILL
 * before water can flow, the drawn surface is ground + depth, so every
 * carved river renders its own trench-depth above the ground she
 * walks. And the bake, measured on the real survey, costs 39.6 s and
 * 2.4 GB of heap at boot — a phone's tab dies well before that.
 *
 * SO: D8 STAYS — Joshua's rule is that the terrain decides — but it
 * runs ONCE, over the WHOLE island, on the coarse grid. That grid is
 * immutable and everywhere, so the answer at a world position never
 * depends on where she is standing. The 1025² accumulation costs about
 * a second at load and four megabytes, and after it the window only
 * ever LOOKS UP membership.
 *
 * RESOLUTION, HONESTLY. A coarse node is 54.7 m, so "watercourse" here
 * is a 55 m-wide claim, not a 1 m one. That is fine, and it is why
 * this works at all: the mask only says where BASEFLOW enters. The
 * 1 m solver still routes that water downhill inside the window, so it
 * gathers into the true 1 m thalweg on its own — feed placement is
 * coarse, routing is fine. Nothing here touches the terrain.
 */

/** World units per coarse node. */
const NODE = SPAN / (SAMPLES - 1);
/** Square metres of real ground one coarse node stands for. */
const NODE_M2 = (NODE / 100) * (NODE / 100);

/**
 * Minimum upstream catchment, in square metres, for a node to carry a
 * watercourse. Real channel initiation in wet climates sits around
 * 10^4..10^5 m²; swept against the surveyed network in
 * tests/fullness.test.ts — see the table there before moving it.
 */
export const CATCHMENT_M2 = 120_000;

let acc: Float32Array | null = null;

/**
 * PRIORITY-FLOOD SINK FILLING (Barnes et al.), and why island-scale D8
 * cannot skip it. drainage.ts deliberately lets a pit keep its water —
 * right inside the window, where pooling and spilling are the
 * solver's job — but at island scale an unfilled pit TRUNCATES every
 * flow path that crosses it. Measured before this existed: the
 * Waimea-class trunks accumulated 2.9 km² where the real river drains
 * over a hundred, because the path from the mountains died at the
 * first depression. Filling raises every cell to its spill level
 * (never below its own height), so accumulation runs mountain-to-sea
 * the way the water eventually would. Only this baked ANALYSIS sees
 * the filled surface; the terrain everyone walks and renders is
 * untouched.
 */
function fillSinks(bed: Float32Array, n: number): Float32Array {
  const filled = Float32Array.from(bed);
  const seen = new Uint8Array(n * n);
  // Binary min-heap of cell indices, keyed by filled height.
  const heap: number[] = [];
  const less = (a: number, b: number) => filled[a] < filled[b];
  const push = (i: number) => {
    heap.push(i);
    let c = heap.length - 1;
    while (c > 0) {
      const parent = (c - 1) >> 1;
      if (!less(heap[c], heap[parent])) break;
      [heap[c], heap[parent]] = [heap[parent], heap[c]];
      c = parent;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === c) break;
        [heap[c], heap[m]] = [heap[m], heap[c]];
        c = m;
      }
    }
    return top;
  };
  // Seed from the border — every drop eventually leaves through it.
  for (let c = 0; c < n; c++) {
    for (const i of [c, (n - 1) * n + c, c * n, c * n + n - 1]) {
      if (!seen[i]) { seen[i] = 1; push(i); }
    }
  }
  while (heap.length) {
    const i = pop();
    const cx = i % n;
    const cy = (i / n) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if (seen[j]) continue;
        seen[j] = 1;
        // THE EPSILON IS THE FIX, not a nicety. A plain fill turns
        // every pit into an EXACT flat, and D8's "strictly downhill"
        // test stops dead on a flat — so paths still truncated, just
        // at the flats instead of the pits (measured: an order-5
        // trunk's midpoint saw 0.28 km² either way). Raising each
        // filled cell a hair above the one it spills through gives
        // every flat a monotone path to the border. 0.05 units is half
        // a millimetre of fictional tilt per cell — and it exists only
        // in this analysis; nothing rendered or walked ever sees it.
        if (filled[j] < filled[i] + 0.05) filled[j] = filled[i] + 0.05;
        push(j);
      }
    }
  }
  return filled;
}

/** Bake the island-wide accumulation. Call once; idempotent. */
export function bakeIslandChannels(grid: HeightGrid): void {
  if (acc) return;
  const bed = new Float32Array(SAMPLES * SAMPLES);
  for (let i = 0; i < bed.length; i++) bed[i] = grid[i] * HEIGHT_SCALE;
  acc = flowAccumulation(fillSinks(bed, SAMPLES), SAMPLES);
}

export function islandChannelsReady(): boolean {
  return acc !== null;
}

/** Upstream catchment area (m²) draining through the node nearest wx,wz. */
export function catchmentAt(wx: number, wz: number): number {
  if (!acc) return 0;
  const c = Math.round((wx + SPAN / 2) / NODE);
  const r = Math.round((wz + SPAN / 2) / NODE);
  if (c < 0 || r < 0 || c >= SAMPLES || r >= SAMPLES) return 0;
  return acc[r * SAMPLES + c] * NODE_M2;
}

/** Whether the island's own drainage says a watercourse runs here. */
export function isWatercourse(wx: number, wz: number): boolean {
  return catchmentAt(wx, wz) >= CATCHMENT_M2;
}

/** For tests and scene teardown. */
export function forgetIslandChannels(): void {
  acc = null;
}
