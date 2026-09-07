/**
 * THE WATER, AS THE RESOURCE LAYER ASKS IT — one adapter from the water
 * system's answer (`world/water/router.ts`, a `WaterSpot` or null) to
 * the two questions ecology has (`resources.ts`, `WaterQuery`): how deep
 * is the fresh water here, and is this the sea.
 *
 * Joshua, 2026-09-07: "Water queries the REAL freshwater system — Water
 * is a WORLD SYSTEM, not an object quota." This file is how it does so.
 * It holds no water of its own, samples nothing ahead of time, and
 * cannot answer a question the router would not: a point where the
 * water has not loaded is dry to it, exactly as it is to the router,
 * so there is no second code path for "not yet".
 *
 * THE DEPTH IS THE SPOT'S OWN. `WaterSpot.depth` is the water over the
 * solver's bed, measured on the solver's grid (`water/sim.ts`) and
 * promised positive wherever a spot exists (`router.ts`). The other
 * reading on offer — `surface` minus the LIVE ground — would mix two
 * beds: the solver's 1 m bilinear one and the heightfield's, which is
 * HD where a tile is resident and coarse where it is not, and the two
 * can differ by decimetres at a bank. That difference would read as
 * water that is there on one phone and not on another. So the honest
 * field is `depth`, and `surface` is left to the camera and the fog,
 * which are what it is carried for.
 *
 * THE SEA IS THE BED'S, THEN THE SPOT'S. `isSeaAt` is true where the
 * ground is below mean sea level — the router's own classification,
 * sound on this island because `tests/worldWaterline.test.ts` found no
 * ground below MSL the ocean does not reach — and also where a source
 * answers with a `sea` spot, so that a router whose sea owner reaches
 * above the bed's line (a swell over the swash) is still believed.
 *
 * READ-ONLY BY CONSTRUCTION: the object returned is frozen and holds
 * two closures over two readers. There is nothing on it to write.
 *
 * Pure: no three, no DOM. `src/world/` is core.
 */
import type { WorldPoint } from '../coords';
import { SEA_LEVEL } from '../heightfield';
import type { WaterSpot } from '../water/router';
import type { WaterQuery } from './resources';

/** Whatever answers `spotAt`: the `WaterRouter`, or a single fresh source such as the inland water. */
export interface SpotSource {
  spotAt(at: WorldPoint): WaterSpot | null;
}

/**
 * Build the ecology's water query over a spot source and the ground.
 *
 * `spots` is normally the scene's `WaterRouter` (it classifies by the bed
 * and asks the right owner), and may be the inland water alone — then
 * `isSeaAt` still knows the sea, from the ground. `groundAt` is the
 * heightfield's `heightAt`, bound.
 */
export function waterQueryOf(spots: SpotSource, groundAt: (at: WorldPoint) => number): WaterQuery {
  return Object.freeze({
    freshDepthAt(at: WorldPoint): number {
      const spot = spots.spotAt(at);
      if (spot === null || spot.kind !== 'fresh') return 0;
      // `> 0` and finite: a NaN depth is not a depth, and the promise
      // that depth is positive is the router's to keep, not this file's
      // to assume.
      const depth = spot.depth;
      return Number.isFinite(depth) && depth > 0 ? depth : 0;
    },
    isSeaAt(at: WorldPoint): boolean {
      // A NaN ground compares false and falls through to the spot, which
      // is the right answer: nothing is known of the ground, ask the water.
      if (groundAt(at) < SEA_LEVEL) return true;
      const spot = spots.spotAt(at);
      return spot !== null && spot.kind === 'sea';
    },
  });
}
