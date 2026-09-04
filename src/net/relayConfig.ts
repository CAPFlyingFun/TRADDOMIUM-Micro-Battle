/**
 * WHERE THE RELAY IS, AND WHAT A ROOM CODE IS.
 *
 * Two questions, one file, because both are asked in more than one place
 * and a second copy of either answer is a bug waiting for a Friday:
 *
 *  - The ADDRESS is asked by the wiring that builds a multiplayer session
 *    (`app/registerScenes.ts`) and shown by the screen that offers a room
 *    (`ui/RoomCodeScene.ts`).
 *  - The ROOM-CODE RULE is enforced by the relay
 *    (`worker/src/roomCode.ts`) and must be enforced by the client BEFORE
 *    it offers a code, or the game hands the player a code the relay will
 *    refuse. `tests/relayConfig.test.ts` imports the worker's own file and
 *    pins the two rules to the same verdict on the same inputs.
 *
 * WHERE THE ADDRESS COMES FROM, in order:
 *
 *   1. `?relay=` in the address bar — a developer or a probe pointing the
 *      running build at `ws://127.0.0.1:8787` (`npm run relay:dev`).
 *      Nothing here reads it: this module is core (ARCHITECTURE §2.6) and
 *      may not name a browser global, so the CALLER reads the parameter
 *      and passes the value in. That also makes the order testable
 *      without a browser.
 *   2. `__RELAY_URL__`, the build-time constant (`vite.config.ts`), whose
 *      default is the deployed relay.
 *   3. Empty — the honest no-relay case. Not an error, not a fallback to
 *      a guess: a build with nowhere to connect says exactly "Online play
 *      is not built yet." and offers no room screen at all.
 *
 * PURE. No DOM, no socket, no import-time global: an address is a string,
 * a room code is a string, and both are decided by functions a node test
 * can call. Turning either into a live link is `WebSocketTransport`'s job.
 */

/** The address-bar override, named once so the reader and the docs agree. */
export const RELAY_QUERY_PARAM = 'relay';

/**
 * The relay this build was compiled with, or '' when it was built without
 * one. `typeof` rather than a bare read so importing this module outside a
 * Vite build (a bare node script) is harmless rather than a ReferenceError.
 */
export const BUILT_IN_RELAY_URL: string = typeof __RELAY_URL__ === 'string' ? __RELAY_URL__ : '';

/**
 * The relay address this run should use. `override` is the `?relay=`
 * value the caller read (null when absent); `builtIn` defaults to the
 * compiled-in constant and is a parameter so a test can state both halves.
 *
 * Whitespace is trimmed and an empty override is no override — a bare
 * `?relay=` in a URL means "I typed nothing", not "there is no relay".
 * Whether what comes back is a USABLE address is `toRoomSocketUrl`'s
 * question: a typo must fail loudly at the moment it is used, with the
 * bad value in the message, rather than silently becoming the no-relay
 * build and telling the player online play was never built.
 */
export function resolveRelayUrl(override?: string | null, builtIn: string = BUILT_IN_RELAY_URL): string {
  const typed = (override ?? '').trim();
  return typed.length > 0 ? typed : builtIn.trim();
}

/** The path the Worker serves a room on (`worker/src/index.ts`). */
export const ROOM_PATH_PREFIX = '/room/';

/**
 * A page's scheme and a socket's scheme are not the same word. The relay
 * is configured as the address a person can open in a browser
 * (`https://…/health` is how you check it is alive); a socket to a room
 * on it is `wss://…/room/<code>`. Both directions are listed so an
 * address already written as `ws://` is left alone rather than refused.
 */
const SOCKET_SCHEME: ReadonlyMap<string, string> = new Map([
  ['https:', 'wss:'],
  ['wss:', 'wss:'],
  ['http:', 'ws:'],
  ['ws:', 'ws:'],
]);

/**
 * The socket URL for one room on one relay, as `WebSocketTransport`
 * wants it (`ws://` or `wss://`).
 *
 * Trailing slashes on the relay address are absorbed, because a person
 * pasting an address ends it with one about half the time and
 * `…workers.dev//room/x` is a different path to the Worker.
 *
 * It THROWS on a relay address that is not an address and on a code that
 * is not a code, rather than returning something that would open a socket
 * to the wrong place: the caller shows the message (the room screen puts
 * it under the field), which is how a typo in `?relay=` stays visible
 * instead of hiding behind "online play is not built yet".
 */
export function toRoomSocketUrl(relayUrl: string, roomCode: string): string {
  const code = normaliseRoomCode(roomCode);
  if (!isRoomCode(code)) {
    throw new Error(`${JSON.stringify(roomCode)} is not a room code. ${ROOM_CODE_RULE}`);
  }
  const address = relayUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    throw new Error(`relay address ${JSON.stringify(relayUrl)} is not a URL`);
  }
  const scheme = SOCKET_SCHEME.get(parsed.protocol);
  if (scheme === undefined) {
    throw new Error(`relay address ${JSON.stringify(relayUrl)} must start with https://, http://, wss:// or ws://`);
  }
  parsed.protocol = scheme;
  // A relay address carries neither: a room is named by its path.
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}${ROOM_PATH_PREFIX}${code}`;
  return parsed.toString();
}

/**
 * The relay as a person reads it — the host alone, which is the part that
 * tells a developer whether they are pointed at their laptop or at the
 * deployed relay. An unparseable address comes back as it was typed,
 * because hiding it would hide the typo.
 */
export function relayHost(relayUrl: string): string {
  try {
    return new URL(relayUrl.trim()).host;
  } catch {
    return relayUrl.trim();
  }
}

// ---------------------------------------------------------------------------
// What a room code is. The relay's rule, on this side of the wire.
// ---------------------------------------------------------------------------

/** Both bounds are the relay's (`worker/src/roomCode.ts`), pinned equal by test. */
export const ROOM_CODE_MIN_LENGTH = 3;
export const ROOM_CODE_MAX_LENGTH = 24;

/**
 * The rule in words, because a control that refuses input must say why.
 * One sentence, in the field's own vocabulary — not "invalid".
 */
export const ROOM_CODE_RULE = 'Room codes are 3–24 characters: lowercase letters, numbers and dashes.';

/** Nothing typed yet is not a mistake, so it does not get told off like one. */
export const ROOM_CODE_MISSING = 'Type the code you were given, or share the one offered here.';

/** The one rule the sentence above cannot carry without becoming a paragraph. */
export const ROOM_CODE_EDGES = 'A room code starts and ends with a letter or a number.';

/**
 * The relay's shape (`worker/src/roomCode.ts`): lower-case alphanumerics
 * and hyphens, beginning and ending on an alphanumeric. A hyphen is a
 * separator inside a code (`red-ant-7`), and a leading or trailing one is
 * invisible when the code is read aloud.
 */
const SHAPE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * What a typed code becomes before anything looks at it: no surrounding
 * whitespace (a pasted code brings some) and lower case (nobody hears a
 * capital letter, and the relay names the Durable Object after the
 * lower-case form — `RED-ANT-7` and `red-ant-7` must be one room).
 *
 * Normalising and validating are two functions on purpose: the field
 * shows what the player typed and joins what this returns.
 */
export function normaliseRoomCode(raw: string): string {
  return raw.trim().toLowerCase();
}

/** True for a code the relay will accept. Expects the normalised form. */
export function isRoomCode(code: string): boolean {
  return code.length >= ROOM_CODE_MIN_LENGTH && code.length <= ROOM_CODE_MAX_LENGTH && SHAPE.test(code);
}

/**
 * Why this code cannot be used, in words a player can act on, or null
 * when it can. The screen shows this string; it never disables a control
 * without one, because a dead button with no reason is the same as a
 * broken one (ARCHITECTURE §2.9).
 */
export function roomCodeProblem(raw: string): string | null {
  const code = normaliseRoomCode(raw);
  if (code.length === 0) return ROOM_CODE_MISSING;
  if (isRoomCode(code)) return null;
  // The bounds and the alphabet are the sentence everyone knows; the edge
  // rule is the one a player would otherwise have to guess at.
  if (code.length < ROOM_CODE_MIN_LENGTH || code.length > ROOM_CODE_MAX_LENGTH) return ROOM_CODE_RULE;
  if (/[^a-z0-9-]/.test(code)) return ROOM_CODE_RULE;
  return ROOM_CODE_EDGES;
}

/**
 * THE GENERATED CODE IS READ DOWN A PHONE LINE, so the alphabet is what
 * survives being said and retyped by somebody who cannot see it:
 *
 *   dropped letters  i l o s z   (1 / l, o / 0, s / 5, z / 2)
 *   dropped letters  g q         (both heard and read as 9)
 *   dropped digits   0 1 5       (the other half of those pairs)
 *
 * 26 characters in six places is about 3 × 10⁸ codes — enough that
 * guessing a live room is not a pastime, short enough to say twice. The
 * hyphen in the middle is a breath, not a rule: it is what makes
 * `hk4-m7p` two chunks of three rather than one blur of six.
 *
 * `random` comes in so a test owns the draw.
 */
export const ROOM_CODE_CHARS = 'abcdefhjkmnprtuvwxy2346789';
const GROUP = 3;

export function generateRoomCode(random: () => number = Math.random): string {
  return `${group(random)}-${group(random)}`;
}

function group(random: () => number): string {
  let out = '';
  for (let i = 0; i < GROUP; i += 1) {
    const at = Math.min(ROOM_CODE_CHARS.length - 1, Math.max(0, Math.floor(random() * ROOM_CODE_CHARS.length)));
    out += ROOM_CODE_CHARS[at];
  }
  return out;
}
