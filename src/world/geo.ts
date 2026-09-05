/**
 * REAL KAUAʻI ↔ THE GAME WORLD — one transform, in one place.
 *
 * Latitude and longitude convert here and nowhere else. Spawn regions
 * are placed by real geography, a map wants to draw both, and weather
 * will one day be sampled by it — so the moment this arithmetic is
 * copied into three files it starts disagreeing with itself in two of
 * them.
 *
 * FITTED, NOT ASSUMED — AND RE-MEASURED AGAINST THIS REPO'S SURVEY.
 * The bake carries no geographic metadata, so the mapping is derived
 * from where the land actually sits in it. v0 fitted these numbers; they
 * were checked again here against `public/kauai-1025.bin` as it ships in
 * v1, by walking the whole coarse lattice and taking the bounding box of
 * everything above sea level:
 *
 *   land runs 41.84 km north to south in the grid
 *   real Kauaʻi runs 41.7 km, Kīlauea Point to Makahuena Point
 *   → 0.3% apart, which confirms an equirectangular bake at true scale
 *
 *   that box's centre is wx 79,297, wz -8,203 — the anchor below, to
 *   the unit
 *
 *   the highest sample is 1,592 m; Kawaikini is 1,598 m
 *
 * `tests/worldGeo.test.ts` re-runs that measurement, so a re-baked
 * heightfield cannot quietly move the island out from under the regions.
 *
 * NORTH IS −wz AND EAST IS +wx: the DEM's first row is its northern edge
 * and its first column the western one (`dem.ts`). Getting that backwards
 * mirrors the island and puts every spawn region on the wrong coast,
 * which is the single most likely way for this file to be wrong.
 *
 * THE EAST–WEST FIT IS THE WEAKER HALF. Land reaches the grid's eastern
 * edge, so the bake is clipped there, and anchoring on either coast would
 * push the whole error to the other one. The longitude anchor is
 * therefore the island's CENTRE, which splits the residual: about 1.2 km
 * of error at each coast, under a fifth of a degree. Good enough to put a
 * spawn region on the right beach and nowhere near good enough to
 * navigate by, which is the honest description of it.
 *
 * Pure: no three, no DOM. This is core.
 */
import { world, type WorldPoint } from './coords';
import { UNITS_PER_METRE } from './dem';

export interface GeoPoint {
  readonly lat: number;
  readonly lon: number;
}

/** Metres to a degree of latitude. Near enough constant everywhere. */
const METRES_PER_DEGREE_LAT = 110_574;
/** Metres to a degree of longitude AT THE EQUATOR; shrinks with latitude. */
const METRES_PER_DEGREE_LON = 111_320;

/** The island's middle, in both systems — the anchor the fit hangs on. */
export const ISLAND_CENTRE: GeoPoint = { lat: 22.0435, lon: -159.5385 };

/**
 * The same point in world units: the centre of the bounding box of every
 * sample above sea level in the shipped survey. Measured, not chosen.
 */
export const ISLAND_CENTRE_WORLD: WorldPoint = world(79_297, -8_203);

/** Units per degree, at Kauaʻi's latitude. */
const UNITS_PER_LAT = METRES_PER_DEGREE_LAT * UNITS_PER_METRE;
const UNITS_PER_LON = METRES_PER_DEGREE_LON
  * Math.cos((ISLAND_CENTRE.lat * Math.PI) / 180) * UNITS_PER_METRE;

/**
 * Real coordinates to the game world.
 *
 * Latitude runs the OPPOSITE way to wz, because the grid's first row is
 * its northern edge. That sign is the whole correctness of this file.
 */
export function geoToWorld(at: GeoPoint): WorldPoint {
  return world(
    ISLAND_CENTRE_WORLD.wx + (at.lon - ISLAND_CENTRE.lon) * UNITS_PER_LON,
    ISLAND_CENTRE_WORLD.wz - (at.lat - ISLAND_CENTRE.lat) * UNITS_PER_LAT,
  );
}

export function worldToGeo(at: WorldPoint): GeoPoint {
  return {
    lat: ISLAND_CENTRE.lat - (at.wz - ISLAND_CENTRE_WORLD.wz) / UNITS_PER_LAT,
    lon: ISLAND_CENTRE.lon + (at.wx - ISLAND_CENTRE_WORLD.wx) / UNITS_PER_LON,
  };
}

/**
 * Distance between two real coordinates, in world units.
 *
 * Flat earth, which is fine over fifty kilometres and would not be over
 * five hundred. Goes through the same transform as everything else so it
 * cannot disagree with it.
 */
export function geoApart(a: GeoPoint, b: GeoPoint): number {
  const at = geoToWorld(a);
  const to = geoToWorld(b);
  return Math.hypot(at.wx - to.wx, at.wz - to.wz);
}
