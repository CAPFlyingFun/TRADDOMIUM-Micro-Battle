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
 * one that stands highest — a river entering a lake is under the lake's
 * surface, a lake behind the beach outranks the sea that cannot reach
 * it. Everything downstream of gameplay (drinking, wading, currents,
 * one day swimming) talks to this and never to the parts.
 *
 * RAW FRAME. Lake and river levels come out of the hydrography
 * unscaled; the sea is its own frame (relief cannot move zero). The
 * caller who wants to compare against `groundHeight` multiplies by the
 * relief dial — the scene's `waterAt` handle does exactly that.
 */
import { seaHeightAt } from './swell';
import { reliefScale } from './heightfield';
import { lakeLevel } from './lakes';
import { riverAt } from './rivers';

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
  // COMPARED IN THE DRAWN FRAME, RETURNED IN THE RAW ONE. Fresh levels
  // are raw and the sea is not, and the first version compared them
  // anyway — so at the shipped relief of 1.5, a river mouth whose
  // surface is DRAWN above the swell still answered "sea", and the surf
  // model ran on standing river water. The review caught it; the
  // returned level stays raw because every caller already scales it.
  const relief = reliefScale();

  const sea = seaHeightAt(wx, wz, seconds);
  let best: WaterBody = { kind: 'sea', level: sea, flowX: 0, flowZ: 0 };
  let drawn = sea;

  const lake = lakeLevel(wx, wz);
  if (lake !== null && lake * relief > drawn) {
    best = { kind: 'lake', level: lake, flowX: 0, flowZ: 0 };
    drawn = lake * relief;
  }

  const river = riverAt(wx, wz);
  if (river && river.off <= river.width / 2 && river.level * relief > drawn) {
    best = {
      kind: 'river', level: river.level,
      flowX: river.flowX, flowZ: river.flowZ,
    };
  }
  return best;
}
