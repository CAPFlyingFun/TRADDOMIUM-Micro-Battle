/**
 * WHICH BUOY — the second untrusted string the relay reads out of a URL.
 *
 * `roomCode.ts` is the first, and this is the same job with a different
 * alphabet: a station id arrives in a path, so it can be
 * percent-encoded, empty, a kilobyte long, or `../` aimed at something.
 * `normaliseStation` answers with an id or with null and never throws —
 * including on malformed percent-encoding, which makes
 * `decodeURIComponent` throw a URIError and would otherwise reach the
 * client as a 500 for what is plainly a bad request.
 *
 * WHY A SHAPE AND NOT A LIST OF STATIONS. An allow-list would need
 * editing and redeploying to look at a second buoy, and it would buy
 * nothing this does not: the shape admits letters and digits only, so
 * there is no `/`, no `.` and no `%` to escape with, and the id is
 * pasted between a fixed base and a fixed suffix. The worst a stranger
 * can do with the route is ask NOAA for a different public buoy.
 *
 * NDBC's own ids are five characters — `51208` off Hanalei, `NWWH1` at
 * Nawiliwili — and the bounds are loose around that rather than exact,
 * because the id is NOAA's to define and a relay that refuses a real
 * station is worse than one that forwards a request NOAA will 404.
 *
 * Pure: no runtime, no I/O. The router turns null into a 400.
 */

export const STATION_MIN_LENGTH = 4;
export const STATION_MAX_LENGTH = 8;

/** Letters and digits. Nothing that means anything to a URL. */
export const STATION_ALPHABET = 'a-z0-9';

const SHAPE = /^[a-z0-9]+$/;

/**
 * The station id a path segment means, or null when it means nothing
 * usable. Lower-cased, because NDBC's paths are lower-case and `51208`
 * and `NWWH1` name the same buoys either way.
 */
export function normaliseStation(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Malformed percent-encoding. A bad request, not a crash.
    return null;
  }
  const id = decoded.trim().toLowerCase();
  if (id.length < STATION_MIN_LENGTH || id.length > STATION_MAX_LENGTH) return null;
  return SHAPE.test(id) ? id : null;
}
