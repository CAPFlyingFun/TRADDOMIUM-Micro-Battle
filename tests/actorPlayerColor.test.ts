/**
 * A player's colour is a pure function of their id: the same on every
 * client, after every reload, without a message carrying it.
 */
import { describe, expect, it } from 'vitest';
import { HEX_COLOR, isActorState } from '../src/actor/ActorState';
import { playerId } from '../src/actor/PlayerId';
import { PLAYER_PALETTE, colorFor, paletteIndexFor } from '../src/actor/playerColor';
import { spawnCapsule } from '../src/actor/spawnCapsule';
import { world } from '../src/world/coords';

describe('playerColor', () => {
  it('is stable per player and always a palette entry the state guard accepts', () => {
    const ids = ['device-1', 'device-2', '3f7c2d9e-1a4b-4c6d-9e8f-0a1b2c3d4e5f', 'x'];
    for (const raw of ids) {
      const player = playerId(raw);
      const first = colorFor(player);
      expect(colorFor(player)).toBe(first);
      expect(colorFor(playerId(raw))).toBe(first);
      expect(PLAYER_PALETTE).toContain(first);
      expect(HEX_COLOR.test(first)).toBe(true);
      expect(isActorState(spawnCapsule(player, 'Ant', first, world(0, 0)))).toBe(true);
    }
  });

  it('pins the mapping: a changed palette order or hash would recolour every saved player', () => {
    expect(paletteIndexFor(playerId('device-1'))).toBe(1);
    expect(paletteIndexFor(playerId('device-2'))).toBe(0);
    expect(colorFor(playerId('device-1'))).toBe('#ffb400');
    expect(colorFor(playerId('device-2'))).toBe('#e4572e');
  });

  it('has a palette of distinct, lower-case #rrggbb colours', () => {
    expect(PLAYER_PALETTE.length).toBeGreaterThanOrEqual(8);
    expect(new Set(PLAYER_PALETTE).size).toBe(PLAYER_PALETTE.length);
    for (const color of PLAYER_PALETTE) expect(color).toMatch(HEX_COLOR);
    expect(Object.isFrozen(PLAYER_PALETTE)).toBe(true);
  });

  it('spreads real-looking ids across the whole palette rather than piling on one slot', () => {
    const counts = new Array<number>(PLAYER_PALETTE.length).fill(0);
    const total = 2000;
    for (let i = 0; i < total; i += 1) {
      // UUID-shaped, differing in the way device ids differ: a few hex digits.
      const raw = `${(0x10000000 + i * 2654435761) >>> 0}-4c6d-9e8f-${i.toString(16).padStart(12, '0')}`;
      counts[paletteIndexFor(playerId(raw))] += 1;
    }
    const expected = total / PLAYER_PALETTE.length;
    for (const [slot, count] of counts.entries()) {
      expect(count, `slot ${slot} got ${count} of ${total}`).toBeGreaterThan(expected * 0.5);
      expect(count, `slot ${slot} got ${count} of ${total}`).toBeLessThan(expected * 1.5);
    }
  });
});
