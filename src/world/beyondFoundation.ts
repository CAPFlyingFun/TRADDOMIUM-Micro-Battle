/**
 * Shared Kauaʻi world contract.
 *
 * Beyond Extinction and TRADDOMIUM use the same island, centred at the
 * origin. Beyond measures that world in metres; the ant game measures it in
 * centimetres. Keep the conversion and the water draw decisions here so a
 * future port cannot quietly mix those frames.
 */
import { UNITS_PER_METRE } from './kauai';

/** One Beyond Extinction metre expressed in TRADDOMIUM world units. */
export const BEYOND_METRE = UNITS_PER_METRE;
/** The shared Kauaʻi source terrain spans ±28 km around the origin. */
export const BEYOND_HALF_WORLD_METRES = 28_000;
export const BEYOND_HALF_WORLD_UNITS = BEYOND_HALF_WORLD_METRES * BEYOND_METRE;

/**
 * Values adapted from Beyond Extinction's river presentation, expressed in
 * source metres. The ant renderer converts them once at the boundary below.
 */
export const BEYOND_RIVER_DRAW = Object.freeze({
  reach: 200,
  fadeFrom: 130,
  splineStep: 6,
});

export function beyondMetres(metres: number): number {
  if (!Number.isFinite(metres)) throw new Error('Beyond distance must be finite');
  return metres * BEYOND_METRE;
}

export function metresFromWorld(units: number): number {
  if (!Number.isFinite(units)) throw new Error('TRADDOMIUM distance must be finite');
  return units / BEYOND_METRE;
}

/**
 * Reject hydrography that cannot belong to the shared, origin-centred island.
 * This is deliberately a load-time check: a 100× frame mistake otherwise
 * renders plausible-looking water tens of kilometres from its riverbed.
 */
export function validateBeyondHydroFrame(
  x: ArrayLike<number>,
  z: ArrayLike<number>,
): void {
  if (x.length !== z.length) throw new Error('hydrography coordinate arrays disagree');
  let farthest = 0;
  for (let i = 0; i < x.length; i++) {
    farthest = Math.max(farthest, Math.abs(x[i]), Math.abs(z[i]));
  }
  if (farthest > BEYOND_HALF_WORLD_UNITS) {
    throw new Error(
      'hydrography is outside the shared Kauaʻi frame; check the Beyond metres → ant units conversion',
    );
  }
}