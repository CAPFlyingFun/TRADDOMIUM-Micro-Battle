/**
 * WHICH OF KAUAʻI'S CELLS CARRY A WATERCOURSE — worked out ONCE, over
 * the whole island, and then only looked up.
 *
 * `drainage.ts` does the analysis; this decides WHAT IT IS RUN OVER, and
 * that is the entire reason the file exists. D8 accumulation over a
 * MOVING WINDOW depends on where the window's rim falls, because a cell
 * at the rim has no upstream beyond it. v0 ran the analysis on the
 * window's own bed at every recentre, and two windows one recentre apart
 * disagreed about 16% of their shared channel cells — so the rivers
 * visibly reorganised themselves as the player flew towards them.
 *
 * The island does not move. Run it on the island.
 *
 * ONCE, AND IT IS NOT FREE. The coarse grid is 1025² = 1,050,625 cells,
 * and the accumulation sorts them by height — so this is a second or so
 * of work and about a megabyte held. It happens at load, beside the
 * survey it reads, and never again: the answer is a property of the
 * island's shape, and the island's shape is not ours to move.
 *
 * WHY THE COARSE GRID AND NOT THE HD ONE. The HD survey is 4097² —
 * sixteen times the cells and a sort that is worse than sixteen times
 * the work — and it answers a different question better than this one
 * needs. A channel mask decides WHERE BASEFLOW GOES, at 54.7 m, and the
 * solver then runs at 1 m over ground it reads at whatever detail has
 * streamed in. Catchment area is the thing being thresholded and it is a
 * broad-scale quantity: the difference between a 54.7 m and a 13.67 m
 * accumulation is which side of a ridge a headwater trickle starts on,
 * not whether the Wailua is a river.
 *
 * Pure: no three, no DOM. `src/world/` is core.
 */
import { COARSE_SAMPLES, COARSE_STEP, HEIGHT_SCALE, ISLAND_HALF_SPAN, type DemGrid } from '../dem';
import type { WorldPoint } from '../coords';
import { channelMask } from './drainage';

/**
 * How much ground has to drain through a place before the island calls
 * it a watercourse. CALIBRATED AGAINST THE SURVEY, which is the only
 * thing here that knows where Kauaʻi's rivers actually are.
 *
 * `drainage.CATCHMENT_M2` is 120,000 m² and that is far too generous at
 * this grid: measured over the shipped survey it paints 6.01% of the
 * island's LAND as watercourse. The surveyed network is 679 km of river
 * at a median 5.5 m wide — about 3.7 km² against 1,430 km² of land, or
 * 0.26%. Six per cent is a wet hillside, not a river system.
 *
 * The threshold cannot be calibrated on LENGTH, because a 54.7 m cell is
 * ten times wider than the channel it stands for, so it is calibrated on
 * AREA at true width:
 *
 *   0.12 km²   paints 6.01% of land   (~0.60% at true channel width)
 *   0.30 km²   paints 2.70%           (~0.27%)   <- the survey's 0.26%
 *   0.60 km²   paints 1.21%           (~0.12%)
 *   1.00 km²   paints 0.62%           (~0.06%)
 *
 * WHAT THIS DOES NOT FIX, and it is worth knowing before trusting the
 * number: the derived network and the surveyed one do not agree about
 * WHERE. At 0.12 km² the D8 channels cover 32.2% of the surveyed points;
 * at 0.30 they cover 18.3%. That is not a bug in either — it is the
 * 54.7 m grid's valleys not being Kauaʻi's, which v0 measured from the
 * other side (only 21% of surveyed river points sit within 5 m of the
 * blurred terrain, against 88% unblurred). The survey is the CHECK and
 * the check says they overlap by a fifth. Reporting that is the right
 * response; bending the island is not.
 */
export const CATCHMENT_M2 = 300_000;

export interface IslandChannels {
  /** Whether this point carries a watercourse. World-fixed, forever. */
  readonly isChannel: (at: WorldPoint) => boolean;
  /** How many of the island's cells were marked. For a test and a probe. */
  readonly marked: number;
  /** The grid it was computed over. */
  readonly side: number;
  readonly step: number;
}

/**
 * Run the drainage over the whole island and hand back a lookup.
 *
 * TAKES THE COARSE SURVEY, not a `Heightfield`, and that is deliberate.
 * The heightfield answers with whatever HD tiles have STREAMED IN, so a
 * mask built through it would depend on how far the player had walked
 * before it was computed — which is exactly the moving-window
 * non-determinism this file exists to remove, arriving by a different
 * door. The coarse grid is the same 1,050,625 numbers on every device
 * and in every session.
 */
export function islandChannels(
  coarse: DemGrid,
  minCatchmentM2: number = CATCHMENT_M2,
): IslandChannels {
  const side = COARSE_SAMPLES;
  if (coarse.side !== side) {
    throw new Error(`water/islandChannels: expected a ${side}-sample grid, got ${coarse.side}`);
  }
  // Stored decimetres to world units, once. `channelMask` compares only
  // heights against each other, so the scale would not change which
  // cells are marked — it is converted anyway because a bed in the wrong
  // unit is the kind of thing that is right until somebody reads it.
  const bed = new Float32Array(side * side);
  for (let i = 0; i < bed.length; i += 1) bed[i] = coarse.samples[i] * HEIGHT_SCALE;
  const mask = channelMask(bed, side, COARSE_STEP, minCatchmentM2);
  let marked = 0;
  for (let i = 0; i < mask.length; i += 1) marked += mask[i];

  const isChannel = (at: WorldPoint): boolean => {
    // NEAREST, not interpolated: this is a yes or no, and interpolating
    // one gives a number between yes and no that somebody then has to
    // pick a threshold for — which is the same decision made twice, in
    // two places, with two answers.
    const col = Math.round((at.wx + ISLAND_HALF_SPAN) / COARSE_STEP);
    const row = Math.round((at.wz + ISLAND_HALF_SPAN) / COARSE_STEP);
    if (!(col >= 0 && col < side && row >= 0 && row < side)) return false;
    return mask[row * side + col] === 1;
  };

  return { isChannel, marked, side, step: COARSE_STEP };
}
