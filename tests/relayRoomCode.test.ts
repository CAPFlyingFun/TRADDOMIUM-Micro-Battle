/**
 * THE ROOM CODE IS THE RELAY'S FIRST UNTRUSTED INPUT, and the one piece
 * of the Worker that can be tested without a runtime: it is pure string
 * work (`worker/src/roomCode.ts`), so it is checked here in the ordinary
 * test suite rather than only through `npm run probe:relay`, which needs
 * workerd running.
 *
 * Two properties are worth a test each, and both are bugs that would be
 * invisible until two phones failed to meet:
 *
 * ONE CODE IS ONE ROOM. `normaliseRoomCode` produces the name the router
 * hands to `idFromName`, so if `ABC` and `abc` normalised differently the
 * two people who said that code aloud would land in two different Durable
 * Objects, each holding its own game, each looking empty to the other.
 * The canonical form is what makes "say six characters across a table"
 * work at all.
 *
 * A BAD CODE IS A 400, NEVER A 500. A code arrives inside a URL, so it
 * can be empty, a kilobyte long, `../`-shaped, or malformed
 * percent-encoding that makes `decodeURIComponent` THROW. The function
 * answers null for every one of those and never throws — that is what
 * lets the router answer a typo with a plain-text 400 instead of falling
 * over on it.
 */
import { describe, expect, it } from 'vitest';
import {
  ROOM_CODE_ALPHABET, ROOM_CODE_MAX_LENGTH, ROOM_CODE_MIN_LENGTH, normaliseRoomCode,
} from '../worker/src/roomCode';

describe('room codes that are one room', () => {
  it('accepts a code a person can say out loud, unchanged', () => {
    expect(normaliseRoomCode('red-ant-7')).toBe('red-ant-7');
    expect(normaliseRoomCode('abc')).toBe('abc');
    expect(normaliseRoomCode('7f3')).toBe('7f3');
  });

  it('folds case, so nobody hears a capital letter and lands in another room', () => {
    expect(normaliseRoomCode('RED-ANT-7')).toBe('red-ant-7');
    expect(normaliseRoomCode('Red-Ant-7')).toBe('red-ant-7');
    expect(normaliseRoomCode('rEd-AnT-7')).toBe(normaliseRoomCode('red-ant-7'));
  });

  it('decodes the URL before judging it, so an encoded code is the same room', () => {
    // %52%45%44 is "RED": percent-encoded AND upper case, and still one room with "red".
    expect(normaliseRoomCode('%52%45%44')).toBe('red');
    expect(normaliseRoomCode('red%2Dant%2D7')).toBe('red-ant-7');
  });

  it('takes codes at both ends of the length rule', () => {
    expect(normaliseRoomCode('a'.repeat(ROOM_CODE_MIN_LENGTH))).toBe('a'.repeat(ROOM_CODE_MIN_LENGTH));
    expect(normaliseRoomCode('a'.repeat(ROOM_CODE_MAX_LENGTH))).toBe('a'.repeat(ROOM_CODE_MAX_LENGTH));
  });
});

describe('room codes that are refused', () => {
  it('refuses lengths outside the rule', () => {
    expect(normaliseRoomCode('')).toBeNull();
    expect(normaliseRoomCode('a'.repeat(ROOM_CODE_MIN_LENGTH - 1))).toBeNull();
    expect(normaliseRoomCode('a'.repeat(ROOM_CODE_MAX_LENGTH + 1))).toBeNull();
    expect(normaliseRoomCode('a'.repeat(4096))).toBeNull();
  });

  it('refuses a hyphen at either end: it is a separator, not a code', () => {
    expect(normaliseRoomCode('-abc')).toBeNull();
    expect(normaliseRoomCode('abc-')).toBeNull();
    expect(normaliseRoomCode('---')).toBeNull();
  });

  it('refuses anything outside the spoken alphabet', () => {
    for (const code of ['red ant', 'red_ant', 'red.ant', 'red/ant', 'réd', 'a\nb', 'ab<c>', '../secret', '..']) {
      expect(normaliseRoomCode(code), `"${code}" is not a room code`).toBeNull();
    }
  });

  it('refuses a path aimed at something else, however it is spelled', () => {
    // Decoded, these are `../`, `..%2F` and a NUL — none of them a code,
    // and none of them may become part of a Durable Object's name.
    expect(normaliseRoomCode('%2E%2E%2F')).toBeNull();
    expect(normaliseRoomCode('..%2Fadmin')).toBeNull();
    expect(normaliseRoomCode('ab%00c')).toBeNull();
  });

  it('answers malformed percent-encoding with null instead of throwing', () => {
    // Each of these makes decodeURIComponent throw a URIError. Reaching
    // the router as an exception would turn a typo into a 500.
    for (const code of ['%', '%E0%A4%A', '%zz', 'red-%']) {
      expect(() => normaliseRoomCode(code)).not.toThrow();
      expect(normaliseRoomCode(code), `"${code}" is malformed encoding, not a code`).toBeNull();
    }
  });
});

describe('the rule the health check publishes', () => {
  it('states an alphabet and bounds a client can act on', () => {
    expect(ROOM_CODE_MIN_LENGTH).toBeGreaterThan(0);
    expect(ROOM_CODE_MAX_LENGTH).toBeGreaterThan(ROOM_CODE_MIN_LENGTH);
    expect(ROOM_CODE_ALPHABET).toContain('a-z');
    expect(ROOM_CODE_ALPHABET).toContain('0-9');
  });
});
