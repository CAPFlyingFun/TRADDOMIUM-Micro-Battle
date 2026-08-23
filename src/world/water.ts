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
