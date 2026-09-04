/**
 * WHERE THE RELAY IS AND WHAT A ROOM CODE IS — the two answers
 * `src/net/relayConfig.ts` gives, pinned.
 *
 * The room-code half imports the RELAY'S OWN FILE
 * (`worker/src/roomCode.ts`) and compares verdicts on the same inputs.
 * That is the point of the test: the client must never offer a code the
 * Worker will refuse (a player reads out a code and the join fails), and
 * must never refuse one the Worker would accept (a player is told their
 * friend's code is wrong when it is not). Two files, one rule, checked
 * against each other rather than against a copy of the rule written here.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ROOM_CODE_CHARS, ROOM_CODE_EDGES, ROOM_CODE_MAX_LENGTH, ROOM_CODE_MISSING,
  ROOM_CODE_MIN_LENGTH, ROOM_CODE_RULE, ROOM_PATH_PREFIX, generateRoomCode, isRoomCode, normaliseRoomCode,
  relayHost, resolveRelayUrl, roomCodeProblem, toRoomSocketUrl,
} from '../src/net/relayConfig';
import { BUILD_INFO } from '../src/ui/buildInfo';
import {
  ROOM_CODE_MAX_LENGTH as RELAY_MAX, ROOM_CODE_MIN_LENGTH as RELAY_MIN,
  normaliseRoomCode as relayNormalise,
} from '../worker/src/roomCode';

/** The relay `vite.config.ts` bakes in when nothing overrides it. */
const LIVE_RELAY = 'https://traddomium-relay.joshua-622.workers.dev';
/** What `npm run relay:dev` serves, and what `?relay=` is for. */
const LOCAL_RELAY = 'ws://127.0.0.1:8787';

const viteConfig = readFileSync(fileURLToPath(new URL('../vite.config.ts', import.meta.url)), 'utf8');

describe('where the relay address comes from', () => {
  it('takes the query parameter first, the build constant second, and nothing third', () => {
    expect(resolveRelayUrl(LOCAL_RELAY, LIVE_RELAY)).toBe(LOCAL_RELAY);
    expect(resolveRelayUrl(null, LIVE_RELAY)).toBe(LIVE_RELAY);
    expect(resolveRelayUrl(undefined, LIVE_RELAY)).toBe(LIVE_RELAY);
    expect(resolveRelayUrl(null, '')).toBe('');
  });

  it('treats a blank override as no override, not as "there is no relay"', () => {
    // `?relay=` with nothing after it is somebody who typed nothing.
    expect(resolveRelayUrl('', LIVE_RELAY)).toBe(LIVE_RELAY);
    expect(resolveRelayUrl('   ', LIVE_RELAY)).toBe(LIVE_RELAY);
    expect(resolveRelayUrl(`  ${LOCAL_RELAY} `, LIVE_RELAY)).toBe(LOCAL_RELAY);
    expect(resolveRelayUrl(null, `  ${LIVE_RELAY}  `)).toBe(LIVE_RELAY);
  });

  it('carries the build constant into the running code, defaulting to the deployed relay', () => {
    // The define must actually reach the module — a constant that never
    // arrives would silently make every build the no-relay build.
    expect(typeof BUILD_INFO.relayUrl).toBe('string');
    expect(BUILD_INFO.relayUrl).toBe(process.env.TRADDOMIUM_RELAY_URL ?? LIVE_RELAY);
  });

  it('keeps that default, and its override, in vite.config.ts where a build can see them', () => {
    expect(viteConfig).toContain(LIVE_RELAY);
    expect(viteConfig).toContain('TRADDOMIUM_RELAY_URL');
    expect(viteConfig).toContain('__RELAY_URL__: JSON.stringify(RELAY_URL)');
  });

  it('names the relay by its host, and hands back a typo rather than hiding it', () => {
    expect(relayHost(LIVE_RELAY)).toBe('traddomium-relay.joshua-622.workers.dev');
    expect(relayHost(` ${LOCAL_RELAY} `)).toBe('127.0.0.1:8787');
    expect(relayHost('not a url')).toBe('not a url');
  });
});

describe('the socket URL for one room', () => {
  it('turns the page address into a socket address and appends the room path', () => {
    expect(toRoomSocketUrl(LIVE_RELAY, 'red-ant-7')).toBe(
      'wss://traddomium-relay.joshua-622.workers.dev/room/red-ant-7',
    );
    expect(toRoomSocketUrl('http://127.0.0.1:8787', 'red-ant-7')).toBe('ws://127.0.0.1:8787/room/red-ant-7');
    // An address already written as a socket is left as it is.
    expect(toRoomSocketUrl(LOCAL_RELAY, 'abc')).toBe('ws://127.0.0.1:8787/room/abc');
    expect(toRoomSocketUrl('wss://relay.example', 'abc')).toBe('wss://relay.example/room/abc');
  });

  it('absorbs a trailing slash rather than serving //room/', () => {
    expect(toRoomSocketUrl(`${LIVE_RELAY}/`, 'abc')).toBe(toRoomSocketUrl(LIVE_RELAY, 'abc'));
    expect(toRoomSocketUrl(`${LIVE_RELAY}///`, 'abc')).toBe(toRoomSocketUrl(LIVE_RELAY, 'abc'));
    expect(toRoomSocketUrl('https://relay.example/behind/a/path/', 'abc')).toBe(
      'wss://relay.example/behind/a/path/room/abc',
    );
  });

  it('normalises the code on the way in, so one spoken code is one room', () => {
    expect(toRoomSocketUrl(LIVE_RELAY, '  RED-Ant-7 ')).toBe(toRoomSocketUrl(LIVE_RELAY, 'red-ant-7'));
    expect(toRoomSocketUrl(LIVE_RELAY, 'abc')).toContain(`${ROOM_PATH_PREFIX}abc`);
  });

  it('throws, naming the bad value, rather than opening a socket somewhere unintended', () => {
    expect(() => toRoomSocketUrl('relay.example', 'abc')).toThrow(/not a URL/);
    expect(() => toRoomSocketUrl('ftp://relay.example', 'abc')).toThrow(/https:\/\//);
    expect(() => toRoomSocketUrl('', 'abc')).toThrow();
    expect(() => toRoomSocketUrl(LIVE_RELAY, 'no')).toThrow(/not a room code/);
    expect(() => toRoomSocketUrl(LIVE_RELAY, 'Room 7')).toThrow(/not a room code/);
  });

  it('produces exactly what the transport accepts as a relay URL', () => {
    for (const relay of [LIVE_RELAY, LOCAL_RELAY, 'http://127.0.0.1:8787/', 'wss://relay.example/']) {
      expect(toRoomSocketUrl(relay, 'red-ant-7')).toMatch(/^wss?:\/\/.+\/room\/red-ant-7$/);
    }
  });
});

describe('the room-code rule, against the relay that enforces it', () => {
  /** Codes a person could type, valid and not, including the edges of every bound. */
  const CASES: readonly string[] = [
    'abc', 'red-ant-7', 'a1b', '0ab', 'x'.repeat(ROOM_CODE_MAX_LENGTH), 'x'.repeat(ROOM_CODE_MAX_LENGTH + 1),
    'ab', 'a', '', '   ', 'AB-CD', 'RED-ANT-7', ' red-ant-7 ', '-abc', 'abc-', 'a--b', 'a b', 'room_7',
    'r00m!', 'ünicode', '../etc', 'a'.repeat(ROOM_CODE_MIN_LENGTH),
  ];

  it('agrees with worker/src/roomCode.ts on the bounds', () => {
    expect(ROOM_CODE_MIN_LENGTH).toBe(RELAY_MIN);
    expect(ROOM_CODE_MAX_LENGTH).toBe(RELAY_MAX);
  });

  it('accepts exactly what the relay accepts, for every case', () => {
    for (const raw of CASES) {
      const code = normaliseRoomCode(raw);
      const mine = isRoomCode(code);
      const theirs = relayNormalise(code) !== null;
      expect(mine, `${JSON.stringify(raw)} → ${JSON.stringify(code)}`).toBe(theirs);
      // And when both accept it, they accept the SAME string: the code the
      // client sends is the name the relay gives the room.
      if (mine) expect(relayNormalise(code)).toBe(code);
    }
  });

  it('says why in words a player can act on, never by refusing in silence', () => {
    expect(roomCodeProblem('red-ant-7')).toBeNull();
    expect(roomCodeProblem('  RED-Ant-7  ')).toBeNull();
    expect(roomCodeProblem('')).toBe(ROOM_CODE_MISSING);
    expect(roomCodeProblem('   ')).toBe(ROOM_CODE_MISSING);
    expect(roomCodeProblem('ab')).toBe(ROOM_CODE_RULE);
    expect(roomCodeProblem('x'.repeat(ROOM_CODE_MAX_LENGTH + 1))).toBe(ROOM_CODE_RULE);
    expect(roomCodeProblem('room_7')).toBe(ROOM_CODE_RULE);
    expect(roomCodeProblem('-abc')).toBe(ROOM_CODE_EDGES);
    expect(roomCodeProblem('abc-')).toBe(ROOM_CODE_EDGES);
    expect(ROOM_CODE_RULE).toContain('3–24 characters');
    expect(ROOM_CODE_RULE).toContain('lowercase letters, numbers and dashes');
  });

  it('normalises the way the relay does: trimmed and lower case', () => {
    expect(normaliseRoomCode('  RED-Ant-7 ')).toBe('red-ant-7');
    expect(normaliseRoomCode('abc')).toBe('abc');
  });
});

describe('the code this game offers a player to read out', () => {
  it('is always a code the relay will accept', () => {
    for (let i = 0; i < 2000; i += 1) {
      const code = generateRoomCode();
      expect(roomCodeProblem(code), code).toBeNull();
      expect(relayNormalise(code), code).toBe(code);
    }
  });

  it('holds no character that is read as another one down a phone line', () => {
    for (const lookalike of ['i', 'l', 'o', 's', 'z', 'g', 'q', '0', '1', '5']) {
      expect(ROOM_CODE_CHARS, lookalike).not.toContain(lookalike);
    }
    expect(generateRoomCode(() => 0)).toBe(`${ROOM_CODE_CHARS[0].repeat(3)}-${ROOM_CODE_CHARS[0].repeat(3)}`);
  });

  it('draws from its whole alphabet, and stays inside it at the top of the range', () => {
    // 0.999… must not index past the end: an undefined character would
    // reach a player as the word "undefined" in the middle of a code.
    const last = ROOM_CODE_CHARS[ROOM_CODE_CHARS.length - 1];
    expect(generateRoomCode(() => 0.999999)).toBe(`${last.repeat(3)}-${last.repeat(3)}`);
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i += 1) for (const c of generateRoomCode().replace('-', '')) seen.add(c);
    expect(seen.size).toBe(ROOM_CODE_CHARS.length);
  });
});
