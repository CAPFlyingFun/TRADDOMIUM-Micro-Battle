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
  /**
   * Where the camera looks, degrees from north — or NaN.
   *
   * NOT PRINTED ANY MORE. The compass ribbon says the heading three
   * centimetres above this line, and Joshua asked for one of the two
   * to go: "there are two headings and can drop the one in the stat
   * numbers." The field stays because a fix taken from an OLDER
   * screenshot carries one, and because a fix that knows which way she
   * was facing reproduces the picture rather than just the spot.
   *
   * So: written when it is known, absent when it is not, and a fix
   * with no bearing leaves the camera pointing wherever it already
   * was rather than snapping to north.
   */
  readonly bearing: number;
  /** Camera attitude, degrees. Positive is looking up. */
  readonly pitch: number;
}

/**
 * HOW HIGH SHE IS, from the three things that can hold her up.
 *
 * A pure function because the inline version cost us the altimeter.
 * It was `ground + flight.height`, which is right on land and in the
 * air and WRONG on water: the water's lift lives in the `above`
 * PlayerAnt is placed with, so the readout showed the riverbed she was
 * floating over — 79 cm low on the reach in Joshua's swimming
 * screenshots. He caught it from the picture: "check your altitude."
 *
 * It was not only a readout. The position fix records this number, so
 * every fix taken afloat wrote the bed down as her height, and
 * restoring one put her a metre low — then read that height as
 * airborne and held her in FLIGHT over the water. Replaying his own
 * swimming frame came back as a flight over dry grass.
 *
 * The terms never double-count: `riding` is zero in the air (the
 * wings' lift is `flying`) and zero on land.
 */
export function mslOf(ground: number, flying: number, riding: number): number {
  return ground + flying + riding;
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
  // NO BEARING. It was here and it was the same number the compass
  // ribbon prints directly above it, which is a heading on screen
  // twice. The `×` on the dial is what lets the reader back in tell
  // this shape from the one that had it — see parseFix.
  return [
    fix.lat.toFixed(PLACES),
    fix.lon.toFixed(PLACES),
    `${(fix.msl / UNITS_PER_METRE).toFixed(2)}m`,
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
  if (!found || found.length < 4) return null;
  const [lat, lon, msl] = found.slice(0, 3).map(Number);

  // WHICH SHAPE IS THIS? Four of them, and every one of them has been
  // printed by some version of this game, so all four have to read.
  //
  //   lat lon msl bearing° pitch° ×dial     six numbers
  //   lat lon msl bearing° pitch°           five, no dial
  //   lat lon msl pitch° ×dial               five, no bearing  <- now
  //   lat lon msl pitch°                     four
  //
  // Six and four are unambiguous. Five is the awkward one, and the
  // `×` settles it: a line with a dial has its last number marked, so
  // five numbers ending in a marked one is the new shape and five
  // ending unmarked is the old. Every line this game has ever printed
  // carries the marker when it carries a dial, which is what makes
  // this a reading of the format rather than a guess at the numbers.
  const marked = /[×x]\s*-?\d+(?:\.\d+)?\s*$/.test(text.trim());
  const hasBearing = found.length >= 6 || (found.length === 5 && !marked);
  const rest = found.slice(3).map(Number);
  const bearing = hasBearing ? rest[0] : Number.NaN;
  const pitch = hasBearing ? rest[1] : rest[0];
  if (![lat, lon, msl, pitch].every(Number.isFinite)) return null;
  if (hasBearing && !Number.isFinite(bearing)) return null;
  // The dial is last and OPTIONAL, because fixes typed off older
  // screenshots do not have one. Absent, the caller's own dial is the
  // honest assumption — it is what the fix was taken under if nobody
  // has touched it since.
  const dial = Number(rest[hasBearing ? 2 : 1]);
  const relief = Number.isFinite(dial) && dial > 0 ? dial : Number.NaN;
  // Kauaʻi, generously. A fix from a different game is not a fix.
  if (lat < 21 || lat > 23 || lon < -161 || lon > -158) return null;
  return { lat, lon, msl: msl * UNITS_PER_METRE, bearing, pitch, relief };
}


