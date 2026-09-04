/**
 * A ROOM CODE IS SOMETHING A PERSON READS ALOUD.
 *
 * Two phones meet in a room by one of them saying six characters to the
 * other across a table, so the alphabet is what survives being spoken and
 * retyped: lower-case letters, digits and the hyphen, nothing else. It is
 * matched case-insensitively because nobody hears a capital letter, and
 * the normalised (lower-case) form is what the Worker hands to
 * `idFromName` — otherwise `ABC` and `abc` would be two different rooms
 * holding two different games, which is the bug this file exists to
 * prevent.
 *
 * It is also the FIRST UNTRUSTED INPUT the relay sees. A code arrives in
 * a URL, so it can be percent-encoded, empty, a kilobyte long, or `../`
 * aimed at something. `normaliseRoomCode` answers with a code or with
 * null and never throws — including on malformed percent-encoding, which
 * makes `decodeURIComponent` throw a URIError and would otherwise reach
 * the client as a 500 for what is plainly a bad request.
 *
 * Pure: no runtime, no I/O. The router turns null into a 400.
 */

/** Short enough to say twice, long enough that guessing a live room is not a pastime. */
export const ROOM_CODE_MIN_LENGTH = 3;
export const ROOM_CODE_MAX_LENGTH = 24;

/** The whole alphabet, written out for the health check so a client need not guess it. */
export const ROOM_CODE_ALPHABET = 'a-z 0-9 -';

/**
 * Lower-case alphanumerics and hyphens, beginning and ending on an
 * alphanumeric: a hyphen is a separator inside a code (`red-ant-7`), not
 * a code of its own, and a leading or trailing one is invisible when
 * spoken.
 */
const SHAPE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * The single door. Returns the canonical form of `raw`, or null when it
 * is not a room code — for any reason, including one that would make
 * decoding throw.
 */
export function normaliseRoomCode(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null; // malformed percent-encoding is a bad code, not a server fault
  }
  const code = decoded.toLowerCase();
  if (code.length < ROOM_CODE_MIN_LENGTH || code.length > ROOM_CODE_MAX_LENGTH) return null;
  return SHAPE.test(code) ? code : null;
}
