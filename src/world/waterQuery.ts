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
  /**
   * How much of this column's surface the CAMERA HOLDS STILL AGAINST,
   * drawn units — signed, and already included in `depth`.
   *
   * FOR FRAMING ONLY. The camera subtracts it, so the view goes along
   * with only a small share of the slow heave and none of the chop
   * (seaSwell.seaHoldAt, and FollowCamera). It is built from the same
   * surface `depth` carries, not a second opinion about where the
   * water is: nothing that decides flotation, submersion, current or
   * what is drawn may read it. Absent — inland water, any query that
   * does not model a swell — means "nothing here to hold still
   * against", which is the honest answer for a pond.
   */
  readonly hold?: number;
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
