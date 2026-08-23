/**
 * WHERE THE CAMERA WAS — one line, readable off a screenshot and
 * parseable straight back into the same frame.
 *
 * The problem it solves is a working one. Joshua tests on a phone and
 * sends a picture; deciding whether a change fixed what the picture
 * shows means standing in the same place, looking the same way, from
 * the same height. Walking there at ant pace is not a plan, and
 * "somewhere on the north shore" is not a coordinate.
 *
 * REAL LATITUDE AND LONGITUDE, because the world already has them. The
 * island is true-scale Kauaʻi and `geo.ts` already maps world units to
 * WGS-84 both ways — the spawn regions are DEFINED in lat/lon. So
 * there is no scale factor to invent here and no second convention to
 * keep in step: the readout is the transform the rest of the game
 * already uses, printed.
 *
 * EIGHT DECIMAL PLACES, which is not a guess either:
 *
 *   1 degree of latitude   11,057,400 units
 *   1 degree of longitude  10,319,900 units at Kauaʻi's latitude
 *
 *   6 places   11 units    11 cm — ten body lengths, useless
 *   7 places   1.1 units   1.1 cm — one adult body length
 *   8 places   0.11 units  1.1 mm — under a body length
 *
 * A queen is 5.5 mm at founding and 10 mm grown, and the camera rides
 * four centimetres off the ground, so a centimetre of error is a
 * visibly different picture. Eight places it is.
 *
 * EXACTLY REPRODUCIBLE, APPROXIMATELY REAL, and the distinction
 * matters. The world↔geo transform is a bijection, so a fix round-trips
 * to the millimetre and putting her back is exact. The FIT to the real
 * island is another matter: geo.ts is candid that the east–west anchor
 * leaves about 1.2 km of error at each coast. Good enough to say which
 * beach; not good enough to navigate by. Reproducing our own frames
 * only ever needs the first property.
 */
import { geoToWorld, worldToGeo, type GeoPoint } from '../world/geo';
import type { WorldPoint } from '../world/coords';
import { UNITS_PER_METRE } from '../world/kauai';

/** Decimal places on the angles. See the header for why eight. */
export const PLACES = 8;

export interface Fix extends GeoPoint {
  /** Her altitude above sea level, in WORLD UNITS. */
  readonly msl: number;
  /**
   * THE RELIEF DIAL THE FIX WAS TAKEN UNDER.
   *
   * Altitude is not a property of the island alone. `groundHeight`
   * returns `relief x height`, so the same spot is 192 m up at a dial
   * of 1 and 288 m at 1.5 — and a fix restored on the other dial put
   * the queen ninety-five metres inside a hill, where the floor clamp
   * dutifully stood her on the summit. Rendered side by side it was
   * obvious; from the numbers alone it looked like drift.
   *
   * Carried so the altitude can be converted rather than trusted.
   */
  readonly relief: number;
  /** Where the camera looks, degrees from north. */
  readonly bearing: number;
  /** Camera attitude, degrees. Positive is looking up. */
  readonly pitch: number;
}

/** Build a fix from what the scene already has to hand. */
export function fixAt(
  at: WorldPoint, msl: number, bearing: number, pitch: number,
  relief: number,
): Fix {
  const geo = worldToGeo(at);
  return { lat: geo.lat, lon: geo.lon, msl, bearing, pitch, relief };
}

/** Where on the island a fix points. */
export function fixToWorld(fix: Fix): WorldPoint {
  return geoToWorld(fix);
}

/**
 * The one line.
 *
 * Metres, not units, for the altitude — it is the only figure here a
 * person reads as a quantity rather than as an address, and the flight
 * panel already says metres. Two decimals is a centimetre.
 */
export function formatFix(fix: Fix): string {
  return [
    fix.lat.toFixed(PLACES),
    fix.lon.toFixed(PLACES),
    `${(fix.msl / UNITS_PER_METRE).toFixed(2)}m`,
    `${wrap360(fix.bearing).toFixed(1)}°`,
    `${fix.pitch.toFixed(1)}°`,
    `×${fix.relief.toFixed(2)}`,
  ].join(' ');
}

/**
 * Read one back.
 *
 * DELIBERATELY LIBERAL about everything except the order of the
 * numbers, because the text is going to arrive typed out of a
 * photograph as often as pasted. Units, degree signs, commas, extra
 * spaces and a `Lat:`/`Lon:` dressing are all ignored; five signed
 * decimals in the order printed are all that is required. Returns null
 * rather than a partial fix, so a mistyped line fails at the door
 * instead of teleporting her into the sea.
 */
export function parseFix(text: string): Fix | null {
  const found = text.match(/-?\d+(?:\.\d+)?/g);
  if (!found || found.length < 5) return null;
  const [lat, lon, msl, bearing, pitch] = found.slice(0, 5).map(Number);
  if (![lat, lon, msl, bearing, pitch].every(Number.isFinite)) return null;
  // The dial is the sixth and it is OPTIONAL, because fixes typed off
  // older screenshots do not have one. Absent, the caller's own dial
  // is the honest assumption — it is what the fix was taken under if
  // nobody has touched it since.
  const dial = found.length > 5 ? Number(found[5]) : Number.NaN;
  const relief = Number.isFinite(dial) && dial > 0 ? dial : Number.NaN;
  // Kauaʻi, generously. A fix from a different game is not a fix.
  if (lat < 21 || lat > 23 || lon < -161 || lon > -158) return null;
  return { lat, lon, msl: msl * UNITS_PER_METRE, bearing, pitch, relief };
}

/** Degrees into 0..360, so a fix never reads 361 or -3. */
function wrap360(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}
