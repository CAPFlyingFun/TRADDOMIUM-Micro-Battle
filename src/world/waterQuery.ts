/**
 * THE ONE QUESTION EVERYTHING ASKS THE WATER — "what is here, and
 * which way is it going" — behind a plug.
 *
 * Wading, drinking, the underwater look and the HUD all need the same
 * reading, and none of them should hold the IslandWater instance: the
 * lab scene has no island, the tests have no scene, and the island
 * itself replaces its water across a reload. The window REGISTERS here
 * when it exists; everyone else asks this module and handles null,
 * which is also exactly what "the water has not loaded yet" looks
 * like, so there is no second code path for it.
 */
export interface WaterSpot {
  /** Water over the drawn ground at this point, DRAWN units. */
  readonly depth: number;
  /** The current, world units a second, at the surface. */
  readonly flowX: number;
  readonly flowZ: number;
  /** The sea. Floats her like any water; drinks like none. */
  readonly salt?: boolean;
}

type Query = (wx: number, wz: number) => WaterSpot | null;

let query: Query | null = null;

export function useWaterQuery(fn: Query | null): void {
  query = fn;
}

/** The water at a world point, or null where there is none (or none yet). */
export function waterSpotAt(wx: number, wz: number): WaterSpot | null {
  return query ? query(wx, wz) : null;
}
