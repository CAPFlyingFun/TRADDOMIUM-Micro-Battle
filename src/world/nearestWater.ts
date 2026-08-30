/**
 * HOW FAR TO THE WATER, and which way — the instrument that was
 * missing while three wrong theories went past.
 *
 * Joshua, 2026-08-30, after "I landed on it, settled below the water":
 * "Add stats first to show the distance to the nearest fresh or ocean
 * water with +/- markers."
 *
 * He is right that it was not there. What the HUD had was AWL, and AWL
 * could not have told him: the readout clamps at zero
 * (`FlightHud.readHeight(Math.max(0, awl))`), so a queen forty
 * centimetres under a pond reads a tidy `0`; it only appears over
 * water deeper than 30 units, so a pond she can drown in never lights
 * it; and it measures against the QUERIED surface rather than the
 * drawn one, which is the disagreement the whole hunt was about.
 *
 * A number that cannot go negative cannot report being underneath
 * something. That is the whole lesson, and it is why the vertical half
 * of this is signed and unclamped.
 *
 * THE SEA IS FOUND BY MARCHING, because there is nothing else to ask.
 * Ground below zero IS the sea (the same rule the water query uses),
 * and the island is 56 km across, so a distance transform would be a
 * bake and this is an instrument. Rays out, growing steps, refine the
 * first crossing — approximate on purpose and honest about it: a
 * coarse march can step across a narrow inlet and report the next
 * coast instead. For "how far to the ocean" that is fine; nothing
 * steers by it.
 */
import { groundHeight } from './heightfield';

/** Where some water is, relative to her. */
export interface WaterBearing {
  /** World units to it, along the ground. Zero when she is over it. */
  readonly range: number;
  /** World radians, the direction to it. */
  readonly bearing: number;
}

/** How many ways to look. Twenty-four is 15° apart. */
const RAYS = 24;
/** First step out, world units — 2 m, finer than any beach is wide. */
const FIRST_STEP = 200;
/** Each step is this much longer than the last. */
const GROWTH = 1.12;
/** Stop looking past this, world units — 30 km, half the island. */
const CAP = 3_000_000;
/** Refine the crossing until the answer is this good, world units. */
const PRECISION = 100;

/**
 * The nearest SALT water, or null if none within CAP.
 *
 * Returns range zero when she is already over it, which is the honest
 * answer and reads better than a tiny non-zero number.
 */
export function nearestSea(wx: number, wz: number): WaterBearing | null {
  if (groundHeight(wx, wz) < 0) return { range: 0, bearing: 0 };
  let best: WaterBearing | null = null;
  for (let r = 0; r < RAYS; r++) {
    const a = (r / RAYS) * Math.PI * 2;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    // NEVER MARCH PAST A BETTER ANSWER. Once one ray has found the
    // coast at 4 km there is no reason for the next to walk to 30.
    const limit = best ? best.range : CAP;
    let dry = 0;
    let step = FIRST_STEP;
    let wet = -1;
    for (let d = FIRST_STEP; d <= limit; d += step, step *= GROWTH) {
      if (groundHeight(wx + dx * d, wz + dz * d) < 0) { wet = d; break; }
      dry = d;
    }
    if (wet < 0) continue;
    // Bisect the crossing. The march told us it is between the last
    // dry sample and the first wet one; the steps grow, so that gap
    // can be hundreds of metres by the time we are far out.
    let lo = dry;
    let hi = wet;
    while (hi - lo > PRECISION) {
      const mid = (lo + hi) / 2;
      if (groundHeight(wx + dx * mid, wz + dz * mid) < 0) hi = mid;
      else lo = mid;
    }
    if (!best || hi < best.range) best = { range: hi, bearing: a };
  }
  return best;
}
