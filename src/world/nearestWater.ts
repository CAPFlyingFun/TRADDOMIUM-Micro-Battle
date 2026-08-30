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
import { islandChannelsReady, isLandWatercourse } from './islandChannels';
import { SAMPLES, SPAN } from './kauai';

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

/**
 * THE ISLAND'S OWN FRESH-WATER CANDIDATES — strategic, not simulated.
 *
 * TWO DIFFERENT ANSWERS, and they must never be confused for each other:
 *
 *   IslandWater.nearestFresh  — where water ACTUALLY IS, right now, in
 *     the 256 m simulated window. Real, live, and local by necessity:
 *     outside that window there is no solver state at all.
 *
 *   nearestWatercourse (here) — where the island's DRAINAGE says water
 *     runs. Whole island, no state, from the flow accumulation baked at
 *     boot. A CANDIDATE to travel to, not a promise of water on arrival.
 *
 * WHY THE DRAINAGE AND NOT THE SURVEY. `kauai-hydro.bin` holds 1,121
 * surveyed reaches and 111 lakes and would also answer island-wide —
 * but it is EXTERNAL data the terrain contradicts: the audit measured
 * 29.7% of its river points buried, the ground standing above the
 * water's own recorded level. The drainage is computed FROM the
 * heightfield, so it cannot disagree with the ground she will land on.
 * That is the same reason CLAUDE.md forbids moving terrain to fit
 * water: when the map and the island disagree, the island wins.
 *
 * SO THE HONEST CONTRACT IS "a channel runs here". Whether water is
 * standing in it when she arrives is the simulation's call, and a
 * caller that treats this as a guarantee will fly a thirsty queen to a
 * dry gully. Hand off to `nearestFresh` on arrival.
 *
 * AND IT HAS TO BE ON LAND. The drainage is baked over the whole coarse
 * grid, bathymetry included, and D8 keeps accumulating once the water
 * is offshore — 84.3% of the nodes clearing CATCHMENT_M2 are below sea
 * level, the deepest 3 km down carrying a 121 km² catchment. Every one
 * of those was a freshwater candidate until this asked
 * `isLandWatercourse` instead of `isWatercourse`. Found by Joshua's
 * review before Phase 2 gave the autopilot anything to trust
 * (2026-08-30).
 */

/** One coarse node — 54.7 m, the resolution the drainage is known at. */
const NODE = SPAN / (SAMPLES - 1);
/** Nodes from her own out to the island's far side. */
const RINGS = SAMPLES;

/**
 * The nearest node whose catchment carries a watercourse, or null when
 * the drainage has not been baked or the island holds none in range.
 *
 * RINGS OUTWARD RATHER THAN MARCHING, and that is not a detail: rays
 * are what `nearestSea` uses because a coastline is a huge continuous
 * thing a coarse step cannot miss twice. A channel is one node wide.
 * A ray march would step straight over rivers, and the answer would be
 * wrong in a way nothing downstream could detect.
 *
 * It stops at the first ring that holds one, so on an island as wet as
 * Kaua'i this reads a handful of nodes in the common case; only genuinely
 * dry country walks far.
 */
export function nearestWatercourse(wx: number, wz: number): WaterBearing | null {
  if (!islandChannelsReady()) return null;
  if (isLandWatercourse(wx, wz)) return { range: 0, bearing: 0 };
  const hit = (x: number, z: number): WaterBearing => ({
    range: Math.hypot(x - wx, z - wz),
    bearing: Math.atan2(x - wx, z - wz),
  });
  for (let r = 1; r < RINGS; r++) {
    let best: WaterBearing | null = null;
    const span = r * NODE;
    for (let i = -r; i <= r; i++) {
      const off = i * NODE;
      // The ring, not the square: only the nodes this radius adds.
      const edge: ReadonlyArray<readonly [number, number]> = [
        [wx + off, wz - span], [wx + off, wz + span],
        [wx - span, wz + off], [wx + span, wz + off],
      ];
      for (const [x, z] of edge) {
        if (!isLandWatercourse(x, z)) continue;
        const found = hit(x, z);
        if (!best || found.range < best.range) best = found;
      }
    }
    // A SQUARE RING IS NOT A CIRCLE, so the first ring to hold water can
    // carry a corner node further off than a nearer node one ring out.
    // One more ring settles it — the same correction nearestFresh makes.
    if (best) {
      const next = r + 1;
      const wide = next * NODE;
      for (let i = -next; i <= next; i++) {
        const off = i * NODE;
        const edge: ReadonlyArray<readonly [number, number]> = [
          [wx + off, wz - wide], [wx + off, wz + wide],
          [wx - wide, wz + off], [wx + wide, wz + off],
        ];
        for (const [x, z] of edge) {
          if (!isLandWatercourse(x, z)) continue;
          const found = hit(x, z);
          if (found.range < best.range) best = found;
        }
      }
      return best;
    }
  }
  return null;
}
