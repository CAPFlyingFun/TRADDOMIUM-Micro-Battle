/**
 * WHAT THE FRONT DOOR IS ALLOWED TO PROMISE.
 *
 * There is no netcode anywhere in src/, so MULTIPLAYER can honestly
 * claim exactly one thing — the world keeps running while a menu or
 * the map is open — and it must not imply the other. The caption under
 * the split is the only place that promise is written down, which
 * makes it the only part of the control worth pinning: the buttons
 * themselves need a document and this suite has none, by design.
 *
 * If the day comes when a server really is out there, this file is
 * where the wording is renegotiated rather than quietly widened.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODE, modeCaption, type SessionMode } from '../src/game/session';
import { pausedWords } from '../src/ui/PauseMenu';

const MODES: readonly SessionMode[] = ['solo', 'multiplayer'];

describe('what each session mode says it does', () => {
  it('tells a Solo player that pausing stops the world', () => {
    expect(modeCaption('solo')).toBe('Pausing stops the world.');
  });

  it('promises Multiplayer a world that keeps running', () => {
    expect(modeCaption('multiplayer'))
      .toBe('The world keeps running. Online play is not built yet.');
  });

  it('admits the limit in the same breath as the promise', () => {
    // A line that only said "the world keeps running" would be read as
    // "and there are other people in it". The denial is not a footnote
    // to be trimmed later; it is half the sentence.
    expect(modeCaption('multiplayer')).toMatch(/not built yet/i);
  });

  it('gives the two modes genuinely different sentences', () => {
    // The split is only worth its screen space if the choice changes
    // something the player can read before making it.
    expect(modeCaption('solo')).not.toBe(modeCaption('multiplayer'));
  });

  it('leaves no mode without a caption', () => {
    for (const mode of MODES) {
      expect(modeCaption(mode).trim().length).toBeGreaterThan(0);
      expect(modeCaption(mode).endsWith('.')).toBe(true);
    }
  });
});

describe('and what the veil says once it is up', () => {
  it('says the world is stopped only when it actually is', () => {
    expect(pausedWords('solo').note).toBe('The world is stopped.');
    expect(pausedWords('multiplayer').note).not.toMatch(/stopped/i);
  });

  it('does not call a running world PAUSED', () => {
    // The old panel said "PAUSED · The world is stopped." on every
    // show(), which its own header comment had promised it would not
    // do. In multiplayer the wind, the sea, the water and the autonomy
    // are all still stepping behind that veil; the only thing that
    // stopped is her.
    expect(pausedWords('solo').title).toBe('PAUSED');
    expect(pausedWords('multiplayer').title).not.toBe('PAUSED');
  });

  it('tells a multiplayer player what DID stop', () => {
    // "The world keeps running" is the promise the menu made. This is
    // where it has to still be true, and it has to say what the player
    // will see when they close it: she is holding, not drifting off.
    expect(pausedWords('multiplayer').note).toMatch(/holding/i);
  });
});

describe('what a run defaults to when nothing chose', () => {
  it('is SOLO, so the dev routes and every probe keep their old world', () => {
    // ?scene=island builds IslandScene straight from main.ts with no
    // GameFlow in between, and every rig in scripts/ drives one of
    // those routes. Defaulting them to multiplayer would change what a
    // dozen existing measurements measure without a line of them
    // saying so. The front door picks multiplayer explicitly.
    expect(DEFAULT_MODE).toBe('solo');
  });
});
