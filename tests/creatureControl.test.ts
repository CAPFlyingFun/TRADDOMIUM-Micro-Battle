/**
 * Control authority as a ledger: a player holds one creature, a creature
 * has one controller, possession changes the book and nothing else, the
 * records are plain and ordered, and an empty book is observer mode.
 */
import { describe, expect, it } from 'vitest';
import { playerId } from '../src/actor/PlayerId';
import { ControlLedger } from '../src/creatures/control';
import { labSpawns, newCreature } from '../src/creatures';

const A = playerId('player-a');
const B = playerId('player-b');

describe('ControlLedger', () => {
  it('starts empty — observer mode — and answers null for everyone', () => {
    const ledger = new ControlLedger();
    expect(ledger.size).toBe(0);
    expect(ledger.records()).toEqual([]);
    expect(ledger.controllerOf('queen:0,0:0')).toBeNull();
    expect(ledger.creatureOf(A)).toBeNull();
    expect(ledger.isPossessed('queen:0,0:0')).toBe(false);
    expect(ledger.release(A)).toBeNull();
  });

  it('a player holds at most one creature: possessing another releases the first and names it', () => {
    const ledger = new ControlLedger();
    expect(ledger.possess('queen:0,0:0', A)).toEqual({ released: null, taken: 'queen:0,0:0' });
    expect(ledger.creatureOf(A)).toBe('queen:0,0:0');
    expect(ledger.controllerOf('queen:0,0:0')).toBe(A);
    expect(ledger.possess('earthworm:0,-1:0', A)).toEqual({ released: 'queen:0,0:0', taken: 'earthworm:0,-1:0' });
    expect(ledger.controllerOf('queen:0,0:0')).toBeNull();
    expect(ledger.controllerOf('earthworm:0,-1:0')).toBe(A);
    expect(ledger.size).toBe(1);
    // Possessing what one already holds changes nothing and releases nothing.
    expect(ledger.possess('earthworm:0,-1:0', A)).toEqual({ released: null, taken: 'earthworm:0,-1:0' });
    expect(ledger.size).toBe(1);
  });

  it('a creature has at most one controller: the latest claim takes it from the earlier one', () => {
    const ledger = new ControlLedger();
    ledger.possess('housefly:0,-1:0', A);
    expect(ledger.possess('housefly:0,-1:0', B)).toEqual({ released: null, taken: 'housefly:0,-1:0' });
    expect(ledger.controllerOf('housefly:0,-1:0')).toBe(B);
    expect(ledger.creatureOf(A)).toBeNull();
    expect(ledger.creatureOf(B)).toBe('housefly:0,-1:0');
    expect(ledger.size).toBe(1);
  });

  it('release lets go and says what was let go; clear empties the book', () => {
    const ledger = new ControlLedger();
    ledger.possess('queen:0,0:0', A);
    ledger.possess('worker:0,0:0', B);
    expect(ledger.size).toBe(2);
    expect(ledger.release(A)).toBe('queen:0,0:0');
    expect(ledger.controllerOf('queen:0,0:0')).toBeNull();
    expect(ledger.isPossessed('worker:0,0:0')).toBe(true);
    ledger.clear();
    expect(ledger.size).toBe(0);
    expect(ledger.controllerOf('worker:0,0:0')).toBeNull();
    expect(ledger.creatureOf(B)).toBeNull();
  });

  it('records are plain, fresh, in creature order, and survive JSON', () => {
    const ledger = new ControlLedger();
    ledger.possess('worker:0,0:0', B);
    ledger.possess('aphid:-1,-1:0', A);
    const records = ledger.records();
    expect(records).toEqual([
      { creature: 'aphid:-1,-1:0', controller: A },
      { creature: 'worker:0,0:0', controller: B },
    ]);
    expect(JSON.parse(JSON.stringify(records))).toEqual(records);
    expect(ledger.records()).not.toBe(records);
    ledger.clear();
    expect(records).toHaveLength(2);
  });

  it('refuses an empty creature id', () => {
    expect(() => new ControlLedger().possess('', A)).toThrow(/never empty/);
  });

  it('the animal does not know who drives it: possession writes nothing on a creature state', () => {
    const spawn = labSpawns()[0];
    const queen = newCreature(spawn);
    const before = JSON.stringify(queen);
    const ledger = new ControlLedger();
    ledger.possess(queen.id, A);
    ledger.possess('worker:0,0:0', A);
    ledger.release(A);
    expect(JSON.stringify(queen)).toBe(before);
    expect(Object.keys(queen)).not.toContain('controller');
  });

  it('the Lab\'s brief: a hundred switches around the five leave exactly one held and every id intact', () => {
    const ledger = new ControlLedger();
    const ids = labSpawns().map((s) => s.id);
    for (let i = 0; i < 100; i += 1) {
      const next = ids[i % ids.length];
      const { released, taken } = ledger.possess(next, A);
      expect(taken).toBe(next);
      if (i > 0) expect(released).toBe(ids[(i - 1) % ids.length]);
      expect(ledger.size).toBe(1);
      expect(ledger.creatureOf(A)).toBe(next);
      for (const id of ids) expect(ledger.isPossessed(id)).toBe(id === next);
    }
  });
});
