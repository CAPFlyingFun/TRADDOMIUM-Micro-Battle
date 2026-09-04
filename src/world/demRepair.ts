/**
 * LOAD-TIME SANITISATION — the ONLY sanctioned write to a stored sample,
 * and the narrowest one that leaves a readable surface.
 *
 * CLAUDE.md, "the terrain is not ours to move": the terrain may be
 * written at load time for demonstrably INVALID samples and for nothing
 * else — never for gameplay, never for hydrology, never for a look. This
 * module is that clause and holds nothing else. It runs once, before the
 * heightfield exists, and after it nothing writes a height again.
 *
 * WHAT IS ACTUALLY WRONG WITH THE SHIPPED FILES, counted rather than
 * assumed: 70 NODATA samples of 1,050,625 in the coarse grid and 774 of
 * 16,842,816 across the tiles — 0.005%, in seven tiles, B3 holding 476
 * of them.
 *
 * THEY ARE MOSTLY GAPS IN THE OFFSHORE SONAR. In the tiles the valid
 * neighbours around a hole sit at a median of −827 m, −675 m, −584 m and
 * −720 m in the four worst, and only FOUR of the 774 tile holes have any
 * land among their neighbours — all in B3, where the gap runs up to the
 * foot of the Napali cliffs. The coarse grid is a different story for a
 * plain reason: sampled every 54.7 m, a hole's neighbourhood spans 164 m
 * and reaches the shoreline far more often, so 33 of its 70 holes fill
 * above water, the highest at 107 m. That was measured, not assumed —
 * the first version of this comment claimed every hole was sea floor and
 * the shipped bytes said otherwise twice.
 *
 * THE FILL: the mean of a hole's valid 8-neighbours, repeated until no
 * hole is left. Deterministic (no random, no seed), bounded (it can only
 * write where the sentinel was), and convergent — every hole in every
 * shipped file has at least one valid 8-neighbour, so the first pass
 * already reaches all but the interiors of the largest clusters. A pass
 * that fills nothing stops the loop, so a file with a genuinely
 * unreachable hole terminates instead of spinning, and reports it.
 *
 * A MEAN CANNOT EXCEED ITS OWN TERMS, which is the guarantee that makes
 * this a repair and not a fifth carve: a filled sample always lies
 * between the lowest and highest real samples around it, so no pass can
 * raise a peak, sink a pit or add relief that was not already there. The
 * test asserts it against the survey anyway.
 *
 * NON-FINITE SAMPLES CANNOT EXIST HERE and there is no code for them: a
 * decoded grid is an `Int16Array`, so NaN and infinity are not
 * representable. The invariant is enforced by the type, which is better
 * than a branch nobody can reach.
 *
 * "DRY LAND BELOW SEA LEVEL" — the third clause of the rule — needs a
 * land mask to even ask, and there is none until landcover arrives in
 * Phase 6. Hawaiʻi has no such land, so there is nothing to correct; the
 * clause is left unimplemented rather than approximated by a rule that
 * would flatten real bathymetry.
 *
 * Pure: no three, no DOM, no fetch. `src/world/` is core.
 */
import { NODATA, heightOf, type DemGrid } from './dem';

/** What the repair did, so a load can say it out loud instead of silently editing the survey. */
export interface RepairReport {
  /** Samples the survey had no value for. */
  readonly holes: number;
  /** How many of them now have one. Equal to `holes` unless something was unreachable. */
  readonly filled: number;
  /** Holes with no valid neighbour to fill from, left as NODATA. Zero for every shipped file. */
  readonly unreachable: number;
  /** Passes the fill needed. One for an isolated hole; more for the middle of a cluster. */
  readonly passes: number;
  /** The highest sample the repair WROTE, in world units, or null when it wrote nothing. */
  readonly highestFilled: number | null;
  /** The lowest sample the repair wrote, in world units, or null when it wrote nothing. */
  readonly lowestFilled: number | null;
}

/** A grid with nothing left to repair, and the account of what that took. */
export interface RepairedGrid {
  readonly grid: DemGrid;
  readonly report: RepairReport;
}

/** A grid that needed no repair at all — the common case for most tiles. */
const CLEAN: Omit<RepairReport, 'passes'> = {
  holes: 0,
  filled: 0,
  unreachable: 0,
  highestFilled: null,
  lowestFilled: null,
};

/**
 * Fill every NODATA sample from its valid neighbours, and report it.
 *
 * The input is not touched: the caller keeps the grid it decoded, which
 * is what lets a test compare before against after.
 */
export function repairGrid(input: DemGrid): RepairedGrid {
  const holes = countHoles(input);
  if (holes === 0) return { grid: input, report: { ...CLEAN, passes: 0 } };

  const { side } = input;
  const samples = new Int16Array(input.samples);
  let remaining = holes;
  let passes = 0;
  let highestFilled: number | null = null;
  let lowestFilled: number | null = null;

  // Each pass reads the PREVIOUS pass's grid and writes a fresh one, so a
  // hole is never filled from a value invented earlier in the same sweep —
  // that would make the result depend on which corner the loop started at.
  while (remaining > 0) {
    const before = samples.slice();
    let filledThisPass = 0;
    for (let row = 0; row < side; row += 1) {
      for (let col = 0; col < side; col += 1) {
        const index = row * side + col;
        if (before[index] !== NODATA) continue;
        const mean = neighbourMean(before, side, col, row);
        if (mean === null) continue;
        samples[index] = mean;
        filledThisPass += 1;
        const height = heightOf(mean);
        if (highestFilled === null || height > highestFilled) highestFilled = height;
        if (lowestFilled === null || height < lowestFilled) lowestFilled = height;
      }
    }
    passes += 1;
    remaining -= filledThisPass;
    // Nothing moved: what is left has no valid neighbour and never will.
    // Stopping is the honest outcome; spinning is not.
    if (filledThisPass === 0) break;
  }

  return {
    grid: { side, samples },
    report: {
      holes,
      filled: holes - remaining,
      unreachable: remaining,
      passes,
      highestFilled,
      lowestFilled,
    },
  };
}

/** Samples the survey has no value for. */
export function countHoles(grid: DemGrid): number {
  let holes = 0;
  for (let i = 0; i < grid.samples.length; i += 1) if (grid.samples[i] === NODATA) holes += 1;
  return holes;
}

/** True when nothing is left for the heightfield to trip over. */
export function isRepaired(grid: DemGrid): boolean {
  return countHoles(grid) === 0;
}

/**
 * The mean of the valid samples in the 8 cells around one, rounded to a
 * whole decimetre, or null when every neighbour is a hole too.
 */
function neighbourMean(samples: Int16Array, side: number, col: number, row: number): number | null {
  let sum = 0;
  let count = 0;
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= side || nr >= side) continue;
      const value = samples[nr * side + nc];
      if (value === NODATA) continue;
      sum += value;
      count += 1;
    }
  }
  return count === 0 ? null : Math.round(sum / count);
}
