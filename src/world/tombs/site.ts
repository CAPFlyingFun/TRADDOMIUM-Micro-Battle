/**
 * WHERE THE TOMBS LABORATORY STANDS — one coordinate, measured once.
 *
 * Joshua, 2026-09-18, opening this milestone: "find ONE canonical flat
 * location on the EXISTING island, record world coordinates, leave room
 * for a future settlement." One, and recorded — so this file is the only
 * place the number lives and every later building measures from it.
 *
 * WHY THIS POINT. It was SEARCHED for in the survey rather than typed:
 * a scan of the coarse DEM for the flattest ground that is neither water
 * nor wetland, with `kauai-hydro.bin`'s rivers excluded, then checked
 * against `kauai-veg.bin`. What came back, and what re-measuring it from
 * the raw files says today:
 *
 *   ground          89.30 m
 *   gradient        0.0067 — 0.38 degrees, flat enough to stand a slab on
 *   within  100 m   88.7 - 90.1 m   (1.4 m of relief)
 *   within  200 m   87.8 - 91.1 m   (3.3 m)
 *   within  400 m   85.5 - 94.1 m   (8.5 m), 100% grass, no river
 *   within  800 m   trees begin, 10% of the ring
 *   beyond  800 m   the ground climbs to 160 m at a kilometre
 *
 * The laboratory's own footprint is 26 x 26 m. A quarter-kilometre of
 * ground inside three metres of relief is the room the settlement will
 * need, and the hills beyond it are the reason this reads as a valley
 * floor rather than as a plain that goes on for ever.
 *
 * WHAT IT IS NOT. It is not a story coordinate. The manuscript puts the
 * settlement "near the island's center" on an island "roughly fifty-six
 * kilometers across" (ch 1) — and this island is 5,600,000 units at a
 * centimetre a unit, which is exactly fifty-six kilometres, so the two
 * agree on size without either being bent to fit. The precise spot is
 * ours to choose and this is the choice.
 *
 * Pure: no three, no DOM, no storage, no network. This is core.
 */
import { world, type WorldPoint } from '../coords';
import { UNITS_PER_METRE } from '../dem';

/**
 * THE coordinate. Authoritative and persistent — a WorldPoint, never a
 * render position (CLAUDE.md: "World position is authoritative; the
 * floating origin is not").
 */
export const TOMBS_SITE: WorldPoint = world(1_842_969, 377_344);

/**
 * The ground the survey reads under that point, in metres above sea
 * level. RECORDED, not authoritative: the heightfield answers from the
 * coarse lattice until an HD tile lands and from the tile after, and the
 * two differ everywhere between samples. Anything that has to sit ON the
 * ground asks `Heightfield.heightAt` for it every time — this number is
 * for a readout, a test and a sanity check, and `siteDrift` below is how
 * a caller says how far the live ground has moved from it.
 */
export const TOMBS_GROUND_METRES = 89.3;

/** The same height in world units, which is what the renderer places with. */
export const TOMBS_GROUND_UNITS = TOMBS_GROUND_METRES * UNITS_PER_METRE;

/**
 * Where that is on the real island, for anyone checking the spot against
 * a map. Derived from `world/geo.ts`'s centre; not used to place
 * anything.
 */
export const TOMBS_GEO = Object.freeze({ lat: 22.0095, lon: -159.3596 });

/**
 * Which way the building faces, in world radians (0 is north, as
 * `compassBearing` reads it).
 *
 * ZERO, deliberately. The laboratory is axis-aligned with the world, so
 * its local +X is world east and its local +Z is world south, and a
 * reader comparing a floor plan with a coordinate does not have to carry
 * a rotation in their head. The day the settlement wants the street grid
 * at an angle, this is the one number that turns it.
 */
export const TOMBS_YAW = 0;

/**
 * How far the live ground under the site has drifted from the surveyed
 * figure, in metres. Positive means the ground is HIGHER than recorded.
 *
 * The building does not float: it is placed on whatever the heightfield
 * answers. This exists so a probe or a test can say the drift out loud
 * rather than discover it as a gap under a doorstep.
 */
export function siteDrift(groundUnits: number): number {
  return groundUnits / UNITS_PER_METRE - TOMBS_GROUND_METRES;
}
