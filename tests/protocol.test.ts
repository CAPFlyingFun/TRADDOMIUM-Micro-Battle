/**
 * The wire shapes, and the guards that stand between a peer's bytes and
 * the authority's state. A message that survives JSON and passes the
 * guard is the whole of the framing.
 */
import { describe, expect, it } from 'vitest';
import { actorId } from '../src/actor/ActorId';
import type { ActorState } from '../src/actor/ActorState';
import { playerId } from '../src/actor/PlayerId';
import {
  MESSAGE_KINDS, isMessage, isMove, isSnapshot, moveFrom, snapshotFrom, type Message, type MoveMessage, type Snapshot,
} from '../src/net/protocol';
import { ISLAND_SPAN, world } from '../src/world/coords';

const actor: ActorState = {
  id: actorId('a1'),
  kind: 'capsule',
  owner: playerId('p1'),
  at: world(10, -20),
  height: 0,
  heading: 0.5,
  color: '#00aaff',
  name: 'Ant',
};

const snapshot: Snapshot = { tick: 7, actors: [actor] };

const wire = (msg: Message): unknown => JSON.parse(JSON.stringify(msg));

describe('protocol guards', () => {
  it('accepts every kind of message after a trip through JSON', () => {
    const all: Message[] = [
      { kind: 'hello', playerId: playerId('p1'), name: 'Ant', color: '#00aaff' },
      { kind: 'welcome', yourId: playerId('p1'), snapshot },
      { kind: 'join', actor },
      { kind: 'leave', playerId: playerId('p1') },
      { kind: 'move', actorId: actorId('a1'), at: world(11, -20), height: 0, heading: 0.5, seq: 3 },
      { kind: 'snapshot', snapshot },
      { kind: 'bye', playerId: playerId('p1') },
    ];
    expect(all.map((m) => m.kind)).toEqual([...MESSAGE_KINDS]);
    for (const m of all) expect(isMessage(wire(m)), m.kind).toBe(true);
  });

  it('rejects what is not a message', () => {
    for (const bad of [null, undefined, 42, 'hello', [], {}, { kind: 'hello' }, { kind: 'teleport' }]) {
      expect(isMessage(bad)).toBe(false);
    }
  });

  it('rejects a move with a non-finite, off-island or negative field', () => {
    const good: MoveMessage = { kind: 'move', actorId: actorId('a1'), at: world(1, 2), height: 0, heading: 0, seq: 0 };
    expect(isMove(good)).toBe(true);
    expect(isMove({ ...good, at: { wx: Number.NaN, wz: 0 } })).toBe(false);
    expect(isMove({ ...good, at: { wx: ISLAND_SPAN, wz: 0 } })).toBe(false);
    expect(isMove({ ...good, height: -1 })).toBe(false);
    expect(isMove({ ...good, heading: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isMove({ ...good, seq: -1 })).toBe(false);
    expect(isMove({ ...good, seq: 1.5 })).toBe(false);
    expect(isMove({ ...good, actorId: '' })).toBe(false);
  });

  it('rejects a snapshot holding one bad actor', () => {
    expect(isSnapshot(snapshot)).toBe(true);
    expect(isSnapshot({ tick: 1, actors: [{ ...actor, color: 'orange' }] })).toBe(false);
    expect(isSnapshot({ tick: 1, actors: [{ ...actor, heading: 4 }] })).toBe(false);
    expect(isSnapshot({ tick: 1, actors: [{ ...actor, kind: 'ant' }] })).toBe(false);
    expect(isSnapshot({ tick: 1, actors: [{ ...actor, name: '' }] })).toBe(false);
    expect(isSnapshot({ tick: -1, actors: [] })).toBe(false);
  });

  it('rebuilds checked input field by field, dropping anything extra', () => {
    const raw = wire({ kind: 'snapshot', snapshot: { tick: 2, actors: [{ ...actor, extra: 'ride-along' } as ActorState] } });
    expect(isMessage(raw)).toBe(true);
    if (!isMessage(raw) || raw.kind !== 'snapshot') throw new Error('unreachable');
    const rebuilt = snapshotFrom(raw.snapshot);
    expect(rebuilt).toEqual({ tick: 2, actors: [actor] });
    expect(Object.keys(rebuilt.actors[0])).not.toContain('extra');

    const move = wire({ kind: 'move', actorId: actorId('a1'), at: world(1, 2), height: 3, heading: 0.1, seq: 9 });
    if (!isMove(move)) throw new Error('unreachable');
    expect(moveFrom({ ...move, seq: 9 })).toEqual({ kind: 'move', actorId: 'a1', at: { wx: 1, wz: 2 }, height: 3, heading: 0.1, seq: 9 });
  });
});
