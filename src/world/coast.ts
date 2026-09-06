/**
 * HOW FAR THE SEA IS — from every sample of the coarse survey, worked
 * out once and then only looked up.
 *
 * A beach is not an elevation. Kauaʻi has flat ground at two metres a
 * kilometre inland (the Mānā plain, Hanalei's taro flats) and it is not
 * sand; and the north shore has forest that runs to the high-water
 * line. What makes a beach is being NEXT TO THE SEA, and nothing in the
 * repo could say how far that was: `spawn.ts` calls 1–14 m of elevation
 * "coast", the map calls 0–120 m "sand", and neither is a distance.
 *
 * SO THIS IS A DISTANCE. A multi-source breadth-first sweep over the
 * 1025² coarse grid from every sample the heightfield puts below sea
 * level (`ground < SEA_LEVEL` is the sea — the router's rule, verified
 * over 17.9 M samples by `tests/worldWaterline.test.ts`), stepping to
 * the eight neighbours and keeping the shortest path in world units.
 * Chamfer distance, not Euclidean: within 8% of the true value, which
 * for a question answered at 54.7 m a sample is the survey's own
 * uncertainty and not this file's.
 *
 * THE COARSE GRID, NOT THE HEIGHTFIELD, for the reason `islandChannels`
 * gives: the heightfield answers with whatever high-detail tiles have
 * streamed in, and a coastline that depended on which tiles a phone had
 * fetched would put the beach in a different place on every walk. The
 * coarse grid is the same 1,050,625 numbers on every device.
 *
 * ONCE, AT LOAD, beside the drainage bake: about 60 ms and 4 MB held.
 *
 * Pure: no three, no DOM. `src/world/` is core.
 */
import { COARSE_SAMPLES, COARSE_STEP, HEIGHT_SCALE, ISLAND_HALF_SPAN, type DemGrid } from './dem';
import { SEA_LEVEL } from './heightfield';
import type { WorldPoint } from './coords';

export interface CoastField {
  /** Distance from a world point to the nearest sea sample, world units. Zero at sea. */
  readonly distanceAt: (at: WorldPoint) => number;
  /** How many samples are sea, for a test. */
  readonly seaSamples: number;
  /** The farthest any land sample is from the sea, world units. */
  readonly farthest: number;
}

/** The eight neighbours and the length of a step to each, in samples. */
const STEPS: readonly { readonly dx: number; readonly dz: number; readonly cost: number }[] = [
  { dx: 1, dz: 0, cost: 1 }, { dx: -1, dz: 0, cost: 1 }, { dx: 0, dz: 1, cost: 1 }, { dx: 0, dz: -1, cost: 1 },
  { dx: 1, dz: 1, cost: Math.SQRT2 }, { dx: -1, dz: 1, cost: Math.SQRT2 },
  { dx: 1, dz: -1, cost: Math.SQRT2 }, { dx: -1, dz: -1, cost: Math.SQRT2 },
];

/**
 * Sweep the survey from the sea inward. Chamfer distance in sample
 * units, converted to world units on the way out.
 *
 * TWO PASSES OF A DIJKSTRA-FREE RELAXATION rather than a priority queue:
 * a forward raster scan and a backward one, each relaxing from the
 * neighbours already visited, is the standard two-pass chamfer
 * transform and is exact for the 3x3 mask up to its own metric. It
 * touches each cell twice with no allocation beyond the field itself.
 */
export function coastField(coarse: DemGrid): CoastField {
  const side = COARSE_SAMPLES;
  if (coarse.side !== side) {
    throw new Error(`world/coast: expected a ${side}-sample grid, got ${coarse.side}`);
  }
  const n = side * side;
  const dist = new Float32Array(n);
  let seaSamples = 0;
  for (let i = 0; i < n; i += 1) {
    if (coarse.samples[i] * HEIGHT_SCALE < SEA_LEVEL) {
      dist[i] = 0;
      seaSamples += 1;
    } else {
      dist[i] = Number.POSITIVE_INFINITY;
    }
  }
  const forward = STEPS.filter((s) => s.dz < 0 || (s.dz === 0 && s.dx < 0));
  const backward = STEPS.filter((s) => s.dz > 0 || (s.dz === 0 && s.dx > 0));
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) relax(dist, side, col, row, forward);
  }
  for (let row = side - 1; row >= 0; row -= 1) {
    for (let col = side - 1; col >= 0; col -= 1) relax(dist, side, col, row, backward);
  }
  let farthest = 0;
  for (let i = 0; i < n; i += 1) {
    if (Number.isFinite(dist[i])) {
      dist[i] *= COARSE_STEP;
      if (dist[i] > farthest) farthest = dist[i];
    } else {
      // An island with no sea at all — not this one, but the answer for
      // a grid that has none is "far", not infinity, so nothing downstream
      // has to special-case it.
      dist[i] = ISLAND_HALF_SPAN * 2;
    }
  }

  const distanceAt = (at: WorldPoint): number => {
    if (!Number.isFinite(at.wx) || !Number.isFinite(at.wz)) return 0;
    // Bilinear, because a distance is smooth and a beach that stepped
    // every 54.7 m would draw its own grid.
    const fx = Math.min(side - 1, Math.max(0, (at.wx + ISLAND_HALF_SPAN) / COARSE_STEP));
    const fz = Math.min(side - 1, Math.max(0, (at.wz + ISLAND_HALF_SPAN) / COARSE_STEP));
    const c0 = Math.min(side - 2, Math.floor(fx));
    const r0 = Math.min(side - 2, Math.floor(fz));
    const tx = fx - c0;
    const tz = fz - r0;
    const a = dist[r0 * side + c0];
    const b = dist[r0 * side + c0 + 1];
    const c = dist[(r0 + 1) * side + c0];
    const d = dist[(r0 + 1) * side + c0 + 1];
    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    return top + (bottom - top) * tz;
  };

  return { distanceAt, seaSamples, farthest };
}

function relax(
  dist: Float32Array,
  side: number,
  col: number,
  row: number,
  steps: readonly { readonly dx: number; readonly dz: number; readonly cost: number }[],
): void {
  const i = row * side + col;
  let best = dist[i];
  if (best === 0) return;
  for (let k = 0; k < steps.length; k += 1) {
    const s = steps[k];
    const nc = col + s.dx;
    const nr = row + s.dz;
    if (nc < 0 || nc >= side || nr < 0 || nr >= side) continue;
    const candidate = dist[nr * side + nc] + s.cost;
    if (candidate < best) best = candidate;
  }
  dist[i] = best;
}
