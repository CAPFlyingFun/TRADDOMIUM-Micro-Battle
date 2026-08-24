/**
 * THE ISLAND'S WATER, held in one place.
 *
 * Right now this owns the loaded hydrography and nothing more — Phase 1
 * of the port in `docs/WATER_PORT.md` is "bake it, load it, prove it
 * lands on the right island", and it does. What grows here later is the
 * query layer everything else will speak to: `waterLevelAt`, depth,
 * flow direction, whether she is over a river, a lake or the sea.
 *
 * It is a module singleton for the same reason the heightfield is: the
 * island is one island, the data is read-only once loaded, and threading
 * a handle to it through the scene, the map, the terrain builder and the
 * flight telemetry would be four arguments that can never differ.
 *
 * GLOBAL COORDINATES. Everything answered here is in the island's real
 * million-unit frame. See hydro.ts, and origin.ts for what happens when
 * that rule is broken.
 */
import type { Hydro } from './hydro';

let loaded: Hydro | null = null;

/** Hand over the hydrography, once, at boot. */
export function useHydro(from: Hydro): void {
  loaded = from;
}

/**
 * The hydrography, or null before it has landed.
 *
 * NULLABLE ON PURPOSE. The island lab boots straight into the world and
 * a probe may not have waited for anything, so a caller that assumes
 * this is present will fail in exactly the environments we test in.
 * Draw the water when there is water to draw.
 */
export function hydro(): Hydro | null {
  return loaded;
}

/** Throw it away — scene resets and tests. */
export function forgetHydro(): void {
  loaded = null;
}

/**
 * ONE QUESTION, THREE WATERS: what water is here, and what is it doing?
 *
 * The sea, the lakes and the rivers each answer for themselves in their
 * own modules; this is the place that asks all three and hands back the
 * one explicit owner: contained pond, vector lake, river, then sea. A
 * river entering a lake is under the lake's surface; a contained pond
 * retains that river's current while owning its spill elevation. Everything
 * downstream of gameplay (drinking, wading, currents,
 * one day swimming) talks to this and never to the parts.
 *
 * RAW FRAME. Lake and river levels come out of the hydrography
 * unscaled; the sea is its own frame (relief cannot move zero). The
 * caller who wants to compare against `groundHeight` multiplies by the
 * relief dial — the scene's `waterAt` handle does exactly that.
 */
import { seaHeightAt } from './swell';
import { terrainHeight } from './heightfield';
import { lakeLevel } from './lakes';
import { riverAt, inChannel } from './rivers';
import { containedPondLevel } from './pond';
import { waterOwner } from './waterOwnership';

export type WaterKind = 'sea' | 'lake' | 'river';

export interface WaterBody {
  readonly kind: WaterKind;
  /** The surface, in the raw (unscaled) world frame. */
  readonly level: number;
  /** What the water itself is doing, world units a second. */
  readonly flowX: number;
  readonly flowZ: number;
}

export function waterBodyAt(
  wx: number, wz: number, seconds: number,
): WaterBody | null {
  const river = riverAt(wx, wz);
  const inRiver = river !== null && inChannel(river);
  const pond = containedPondLevel(wx, wz, terrainHeight(wx, wz));
  const lake = lakeLevel(wx, wz);
  switch (waterOwner({ pond: pond !== null, lake: lake !== null, river: inRiver })) {
    case 'pond':
    // A priority-flood cell is the authority wherever it resolves water.
    // Keep the vector centreline's current, but never its independent
    // elevation: the terrain-derived spill level is the waterline.
    return inRiver
      ? {
        kind: 'river', level: pond!,
        flowX: river.flowX, flowZ: river.flowZ,
      }
      : { kind: 'lake', level: pond!, flowX: 0, flowZ: 0 };
    case 'lake':
      return { kind: 'lake', level: lake!, flowX: 0, flowZ: 0 };
    case 'river':
      return { kind: 'river', level: river!.level, flowX: river!.flowX, flowZ: river!.flowZ };
    case 'sea':
      return { kind: 'sea', level: seaHeightAt(wx, wz, seconds), flowX: 0, flowZ: 0 };
  }
}
