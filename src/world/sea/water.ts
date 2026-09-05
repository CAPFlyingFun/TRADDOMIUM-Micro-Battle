/**
 * THE SEA AS THE WATER ROUTER SEES IT — the ocean's own answer to
 * "what is here, and which way is it going".
 *
 * Ten lines of arithmetic, and the point of the file is WHERE they
 * live. In v0 this body sat inside the fresh water window's
 * constructor, so the ocean's gameplay query was reached through
 * fresh-owned code and went away when the river window was disposed
 * (`docs/research/WATER_SYSTEM_AUDIT.md` §13 B1, "dispose() stops
 * un-registering the sea"). Here the sea owns it, the swell and the
 * surf it reads are the sea's, and nothing inland can touch it.
 *
 * ONE SURFACE, ASKED ONCE. The order is v0's and it matters: the swell
 * says where the surface is, the surface plus the bed is the depth, and
 * the surf reads BOTH — passed in rather than re-derived, because the
 * caller has already paid for them and asking twice risks two answers.
 *
 * Pure: no three, no DOM, no fetch. `src/world/` is core.
 */
import type { WorldPoint } from '../coords';
import { SEA_LEVEL } from '../heightfield';
import type { WaterSource, WaterSpot } from '../water/router';
import type { SeaSurf } from './surf';
import type { SeaSwell } from './swell';

export class SeaWater implements WaterSource<'sea'> {
  constructor(
    private readonly swell: SeaSwell,
    private readonly surf: SeaSurf,
  ) {}

  /**
   * The sea here, or null where the bed is out of the water.
   *
   * The null is not defensive padding: the router only asks below sea
   * level, but the surface moves, and a trough over a bed at -2 units
   * genuinely leaves sand. "No water here this instant" is a real
   * answer and the swash zone is made of it.
   */
  spotAt(at: WorldPoint): (WaterSpot & { readonly kind: 'sea' }) | null {
    const bed = this.swell.bedAt(at);
    const stillDepth = SEA_LEVEL - bed;
    if (stillDepth <= 0) return null;
    const surface = this.swell.heightAt(at, stillDepth);
    // NO SECOND GUARD HERE, and that is a decision rather than an
    // omission. The obvious next line is `if (stillDepth + surface <= 0)
    // return null` — a trough deep enough to leave sand — and it cannot
    // happen: the swell clamps its own trough with KEEL, so the surface
    // never comes closer than four units to the bed and the depth is at
    // least `min(stillDepth, KEEL)`. Writing the branch anyway would
    // read to the next person as a case that occurs.
    //
    // The invariant is the SWELL's, not this file's, so it is pinned by
    // a test at this seam (`tests/worldWaterRouter.test.ts`) rather than
    // trusted: take the keel out and the failure lands here, where the
    // negative depth would have gone into gameplay.
    const depth = stillDepth + surface;
    const flow = this.surf.flowAt(at, depth, surface);
    return { kind: 'sea', surface, depth, flowX: flow.x, flowZ: flow.z };
  }
}
