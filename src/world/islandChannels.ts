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
 * WHICH COARSE NODES ARE DRY LAND — baked beside the accumulation, from
 * the same immutable grid, and the reason it exists is measured.
 *
 * The drainage bake covers the WHOLE coarse grid, and the coarse grid
 * includes bathymetry: 51.4% of its nodes are seabed. D8 does not know
 * the difference. Every drop the island sheds keeps accumulating once
 * it is offshore, and the sink fill (above) turns the sea floor into
 * one enormous conveyor, so the seabed carries the biggest catchments
 * on the map. Counted on the shipped grid: 311,685 nodes clear
 * CATCHMENT_M2 and 262,894 of them — 84.3% — are below sea level. The
 * deepest sits 3,015 m down with a 121 km² catchment.
 *
 * That is not a bug in the accumulation. Water really does run that
 * way; it is simply the SEA once it gets there, and calling it a
 * freshwater candidate is what would have been wrong. See
 * `isLandWatercourse`.
 *
 * COARSE, AND DELIBERATELY SO. This is derived from the same 54.7 m
 * grid as `acc`, never from the HD terrain or the moving window: the
 * two answers have to be about the same node or the mask means nothing.
 * So it is a 55 m-wide claim like everything else here, and a node
 * straddling the surf line may fall either way. The consumer treats a
 * hit as a candidate to fly to, not as ground to stand on.
 */
let land: Uint8Array | null = null;

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

/** Bake the island-wide accumulation and its land mask. Idempotent. */
export function bakeIslandChannels(grid: HeightGrid): void {
  if (acc) return;
  const bed = new Float32Array(SAMPLES * SAMPLES);
  const dry = new Uint8Array(SAMPLES * SAMPLES);
  for (let i = 0; i < bed.length; i++) {
    bed[i] = grid[i] * HEIGHT_SCALE;
    // The RAW bed, before the sink fill — filling raises cells to their
    // spill level, and a mask read off the filled surface would promote
    // shallow seabed to land. Sea level is zero and the test matches the
    // water query's own (`groundHeight < 0` is the sea), so the two
    // cannot disagree about where the coast is. NODATA decodes far below
    // this, which puts it on the correct side without a special case.
    dry[i] = bed[i] >= 0 ? 1 : 0;
  }
  acc = flowAccumulation(fillSinks(bed, SAMPLES), SAMPLES);
  land = dry;
}

export function islandChannelsReady(): boolean {
  return acc !== null;
}

/** The baked node a world position falls on, or -1 off the grid. */
function nodeAt(wx: number, wz: number): number {
  const c = Math.round((wx + SPAN / 2) / NODE);
  const r = Math.round((wz + SPAN / 2) / NODE);
  if (c < 0 || r < 0 || c >= SAMPLES || r >= SAMPLES) return -1;
  return r * SAMPLES + c;
}

/** Upstream catchment area (m²) draining through the node nearest wx,wz. */
export function catchmentAt(wx: number, wz: number): number {
  const i = acc ? nodeAt(wx, wz) : -1;
  return i < 0 ? 0 : acc![i] * NODE_M2;
}

/** Whether the coarse grid says this node is dry land rather than seabed. */
export function isLandNode(wx: number, wz: number): boolean {
  const i = land ? nodeAt(wx, wz) : -1;
  return i >= 0 && land![i] === 1;
}

/**
 * Whether the island's own drainage says a watercourse runs here.
 *
 * SAY WHAT IT MEANS: this is "enough water passes through this node",
 * and it is true of most of the sea floor — see the `land` mask above.
 * It is the right question for BASEFLOW SEEDING, which is its one
 * caller (IslandWater): the sim window only ever asks about cells it is
 * already simulating, and a seeded cell out past the surf is water
 * entering water. It is the WRONG question for navigation, and
 * `isLandWatercourse` is the one to ask there.
 *
 * Left deliberately unchanged when the land mask arrived (Joshua,
 * 2026-08-30: "Do NOT change the meaning of isWatercourse globally if
 * existing water simulation relies on its current behavior"). It does.
 */
export function isWatercourse(wx: number, wz: number): boolean {
  return catchmentAt(wx, wz) >= CATCHMENT_M2;
}

/**
 * A watercourse ON LAND — the only kind worth navigating to.
 *
 * The freshwater half of the strategic finder rides on this rather than
 * on `isWatercourse`, because an accumulated node offshore is drainage
 * that has already reached the sea. Flying a thirsty queen to a 3 km
 * deep node with a 121 km² catchment would have been the autopilot
 * confidently steering her out over the Pacific to drink salt.
 *
 * Both halves are baked, so the answer at a world position never
 * depends on where she is standing — the property the island-wide bake
 * exists for in the first place.
 */
export function isLandWatercourse(wx: number, wz: number): boolean {
  return isWatercourse(wx, wz) && isLandNode(wx, wz);
}

/** For tests and scene teardown. */
export function forgetIslandChannels(): void {
  acc = null;
  land = null;
}
