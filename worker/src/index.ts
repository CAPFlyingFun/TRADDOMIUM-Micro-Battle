/**
 * THE RELAY'S FRONT DOOR — a router, and nothing more.
 *
 * Two routes:
 *
 *   GET /health        what this relay is and what it speaks, as JSON.
 *   GET /room/<code>   with `Upgrade: websocket`, the way into a room.
 *
 * A room code is turned into a Durable Object id with `idFromName`, so
 * the same code always reaches the same object no matter which of
 * Cloudflare's machines the request landed on, and that object holds the
 * room's one `Host`. The Worker itself holds NO state: it validates, it
 * forwards, it gets out of the way. Every game rule lives in
 * `src/net/Host.ts`, shared unchanged with the browser build.
 *
 * BAD INPUT IS A 400, NEVER A 500. The room code arrives in a URL and is
 * therefore untrusted (`roomCode.ts`); the router answers a code it
 * cannot use with a plain-text 400 saying what a code looks like, so a
 * typo reads as a typo rather than as the relay falling over.
 *
 * CORS: a WebSocket upgrade is not subject to CORS, so only the health
 * check carries the header — it exists to be read from a page, a phone
 * or a terminal on any origin.
 */
import { MESSAGE_KINDS, HOST_DEFAULTS } from '../../src/net/index';
import pkg from '../../package.json';
import {
  ROOM_CODE_ALPHABET, ROOM_CODE_MAX_LENGTH, ROOM_CODE_MIN_LENGTH, normaliseRoomCode,
} from './roomCode';

export { RoomDurableObject } from './RoomDurableObject';

/** Bindings from wrangler.toml. One: the room namespace. No secrets — the relay has none. */
export interface Env {
  readonly ROOM: DurableObjectNamespace;
}

const ROOM_PREFIX = '/room/';

/** Plain text, because these answers are read by a person with curl as often as by a client. */
const TEXT = { 'Content-Type': 'text/plain; charset=utf-8' } as const;
const JSON_OPEN = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
} as const;

/**
 * What this relay is and what it speaks. Every value is read from the
 * code actually running — the protocol's own message list, the
 * authority's own defaults, the room-code rule from the file that
 * enforces it — so the health check cannot drift away from the truth the
 * way a hand-written manifest would.
 */
function healthBody(): string {
  return JSON.stringify({
    service: 'traddomium-relay',
    status: 'ok',
    version: pkg.version,
    protocol: {
      kinds: MESSAGE_KINDS,
      snapshotHz: HOST_DEFAULTS.snapshotHz,
      graceMs: HOST_DEFAULTS.graceMs,
    },
    room: {
      path: '/room/<code>',
      upgrade: 'websocket',
      alphabet: ROOM_CODE_ALPHABET,
      minLength: ROOM_CODE_MIN_LENGTH,
      maxLength: ROOM_CODE_MAX_LENGTH,
    },
  });
}

const badRoomCode = (): Response =>
  new Response(
    `room code: ${ROOM_CODE_MIN_LENGTH}-${ROOM_CODE_MAX_LENGTH} characters of ${ROOM_CODE_ALPHABET}, starting and ending with a letter or digit\n`,
    { status: 400, headers: TEXT },
  );

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('the health check answers GET\n', { status: 405, headers: TEXT });
      }
      return new Response(request.method === 'HEAD' ? null : healthBody(), { status: 200, headers: JSON_OPEN });
    }

    if (url.pathname.startsWith(ROOM_PREFIX)) {
      const code = normaliseRoomCode(url.pathname.slice(ROOM_PREFIX.length));
      if (code === null) return badRoomCode();
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('a room is joined over a WebSocket: connect with ws(s) and send hello\n', {
          status: 426,
          headers: { ...TEXT, Upgrade: 'websocket' },
        });
      }
      // The normalised code is the room's name, so every spelling of it
      // reaches the one object that owns that room's game.
      const room = env.ROOM.get(env.ROOM.idFromName(code));
      return room.fetch(request);
    }

    return new Response('no such route: this relay serves /health and /room/<code>\n', { status: 404, headers: TEXT });
  },
};
