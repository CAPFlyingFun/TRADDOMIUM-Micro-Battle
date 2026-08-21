/**
 * REAL KAUAʻI ↔ THE GAME WORLD — one transform, in one place.
 *
 * Latitude and longitude convert here and nowhere else. Spawn regions
 * are placed by real geography, weather will be sampled by real
 * geography, and a map wants to draw both — so the moment this
 * arithmetic is copied into three files it starts disagreeing with
 * itself in two of them.
 *
 * FITTED, NOT ASSUMED. The bake carries no geographic metadata, so the
 * mapping is derived from where the land actually sits in it:
 *
 *   land runs 41.8 km north to south in the grid
 *   real Kauaʻi runs 41.7 km, Kīlauea Point to Makahuena Point
 *   → 0.4% apart, which confirms an equirectangular bake at true scale
 *
 * North is −Z and east is +X: the DEM's first row is its northern edge
 * and its first column the western one.
 *
 * The east–west fit is the weaker half. Land reaches the grid's eastern
 * edge, so the bake is clipped there, and anchoring on either coast
 * would push the whole error to the other one. The longitude anchor is
 * therefore the island's CENTRE, which splits the residual: about 1.2
 * km of error at each coast, under a fifth of a degree. Good enough to
 * put a spawn region on the right beach and nowhere near good enough
 * to navigate by, which is the honest description of it.
 */
import { world, type WorldPoint } from './coords';

export interface GeoPoint {
  readonly lat: number;
  readonly lon: number;
}

/** Metres to a degree of latitude. Near enough constant everywhere. */
const METRES_PER_DEGREE_LAT = 110_574;
/** Metres to a degree of longitude AT THE EQUATOR; shrinks with latitude. */
const METRES_PER_DEGREE_LON = 111_320;

/** World units to a metre. A unit is a centimetre at true scale. */
const UNITS_PER_METRE = 100;

/** The island's middle, in both systems — the anchor the fit hangs on. */
export const ISLAND_CENTRE: GeoPoint = { lat: 22.0435, lon: -159.5385 };
const CENTRE_WORLD: WorldPoint = world(79_297, -8_203);

/** Units per degree, at Kauaʻi's latitude. */
const UNITS_PER_LAT = METRES_PER_DEGREE_LAT * UNITS_PER_METRE;
const UNITS_PER_LON = METRES_PER_DEGREE_LON
  * Math.cos((ISLAND_CENTRE.lat * Math.PI) / 180) * UNITS_PER_METRE;

/**
 * Real coordinates to the game world.
 *
 * Latitude runs the OPPOSITE way to Z: north is −Z, because the grid's
 * first row is its northern edge. Getting that backwards mirrors the
 * island and puts every spawn region on the wrong coast.
 */
export function geoToWorld(at: GeoPoint): WorldPoint {
  return world(
    CENTRE_WORLD.wx + (at.lon - ISLAND_CENTRE.lon) * UNITS_PER_LON,
    CENTRE_WORLD.wz - (at.lat - ISLAND_CENTRE.lat) * UNITS_PER_LAT,
  );
}

export function worldToGeo(at: WorldPoint): GeoPoint {
  return {
    lat: ISLAND_CENTRE.lat - (at.wz - CENTRE_WORLD.wz) / UNITS_PER_LAT,
    lon: ISLAND_CENTRE.lon + (at.wx - CENTRE_WORLD.wx) / UNITS_PER_LON,
  };
}

/** Great-circle-ish distance in world units. Flat earth is fine at 50 km. */
export function geoApart(a: GeoPoint, b: GeoPoint): number {
  const at = geoToWorld(a);
  const to = geoToWorld(b);
  return Math.hypot(at.wx - to.wx, at.wz - to.wz);
}
