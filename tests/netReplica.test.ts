/**
 * The replica reads between the two snapshots that bracket a moment a
 * little behind now, appears where an actor was first known, holds at
 * the newest truth rather than guessing past it, and forgets only on
 * `leave`.
 */
import { describe, expect, it } from 'vitest';
import { actorId } from '../src/actor/ActorId';
import type { ActorState } from '../src/actor/ActorState';
import { playerId } from '../src/actor/PlayerId';
import { INTERPOLATION_MS, Replica } from '../src/net/Replica';
import type { Snapshot } from '../src/net/protocol';
import { world } from '../src/world/coords';

const capsule = (over: Partial<ActorState> = {}): ActorState => ({
  id: actorId('a1'),
  kind: 'capsule',
  owner: playerId('p1'),
  at: world(0, 0),
  height: 0,
  heading: 0,
  color: '#00aaff',
  name: 'Ant',
  ...over,
});

const snap = (tick: number, ...actors: ActorState[]): Snapshot => ({ tick, actors });

describe('Replica', () => {
  it('defaults to a 100 ms buffer and refuses a nonsense one', () => {
    expect(new Replica().interpolationMs).toBe(100);
    expect(INTERPOLATION_MS).toBe(100);
    expect(new Replica({ interpolationMs: 250 }).interpolationMs).toBe(250);
    expect(new Replica({ interpolationMs: -1 }).interpolationMs).toBe(100);
    expect(new Replica({ interpolationMs: Number.NaN }).interpolationMs).toBe(100);
  });

  it('appears at its first known state on join and holds still until it hears more', () => {
    const replica = new Replica();
    replica.join(capsule({ at: world(5, 6), heading: 1 }), 1000);
    expect(replica.size).toBe(1);
    expect(replica.has(actorId('a1'))).toBe(true);
    for (const now of [0, 1000, 1050, 1100, 5000]) {
      expect(replica.states(now)).toEqual([capsule({ at: world(5, 6), heading: 1 })]);
    }
  });

  it('interpolates position, height and heading between the two samples bracketing nowMs − interpolationMs', () => {
    const replica = new Replica();
    replica.apply(snap(1, capsule({ at: world(0, 0), height: 0, heading: 0 })), 0);
    replica.apply(snap(2, capsule({ at: world(10, 20), height: 4, heading: 1 })), 100);
    const [half] = replica.states(150); // cursor at 50: halfway
    expect(half?.at.wx).toBeCloseTo(5, 9);
    expect(half?.at.wz).toBeCloseTo(10, 9);
    expect(half?.height).toBeCloseTo(2, 9);
    expect(half?.heading).toBeCloseTo(0.5, 9);
    const [quarter] = replica.states(125);
    expect(quarter?.at.wx).toBeCloseTo(2.5, 9);
    // The untouched fields come from the newer sample.
    expect(half?.color).toBe('#00aaff');
    expect(half?.owner).toBe('p1');
  });

  it('never extrapolates beyond the newest snapshot, and holds at the oldest before it', () => {
    const replica = new Replica();
    replica.apply(snap(1, capsule({ at: world(0, 0) })), 0);
    replica.apply(snap(2, capsule({ at: world(10, 0) })), 100);
    // Cursor exactly at the newest sample, and far past it: the newest, unchanged.
    expect(replica.states(200)[0]?.at).toEqual({ wx: 10, wz: 0 });
    expect(replica.states(1_000_000)[0]?.at).toEqual({ wx: 10, wz: 0 });
    // Cursor at and before the oldest: the oldest.
    expect(replica.states(100)[0]?.at).toEqual({ wx: 0, wz: 0 });
    expect(replica.states(-1_000_000)[0]?.at).toEqual({ wx: 0, wz: 0 });
  });

  it('ignores a snapshot whose tick is not newer for that actor, and a join for an actor it already tracks', () => {
    const replica = new Replica();
    replica.apply(snap(5, capsule({ at: world(50, 0) })), 500);
    replica.apply(snap(4, capsule({ at: world(40, 0) })), 600); // late
    replica.apply(snap(5, capsule({ at: world(45, 0) })), 700); // repeated
    replica.join(capsule({ at: world(0, 0) }), 800); // announced again
    expect(replica.newest(actorId('a1'))?.at).toEqual({ wx: 50, wz: 0 });
    expect(replica.states(5000)[0]?.at).toEqual({ wx: 50, wz: 0 });
    replica.apply(snap(6, capsule({ at: world(60, 0) })), 900);
    expect(replica.newest(actorId('a1'))?.at).toEqual({ wx: 60, wz: 0 });
  });

  it('removes every actor a player owned on leave, and nothing else', () => {
    const replica = new Replica();
    const p2 = playerId('p2');
    replica.apply(
      snap(
        1,
        capsule(),
        capsule({ id: actorId('a2'), owner: p2 }),
        capsule({ id: actorId('a3'), owner: p2 }),
      ),
      0,
    );
    expect(replica.size).toBe(3);
    expect(replica.leave(p2)).toBe(2);
    expect(replica.ids()).toEqual(['a1']);
    expect(replica.leave(playerId('nobody'))).toBe(0);
    // An actor omitted from a later snapshot is merely not mentioned.
    replica.apply(snap(2, capsule({ id: actorId('a4'), owner: p2 })), 10);
    expect(replica.ids()).toEqual(['a1', 'a4']);
    replica.clear();
    expect(replica.size).toBe(0);
    expect(replica.newest(actorId('a1'))).toBeNull();
  });

  it('takes the short way round when a heading crosses ±π', () => {
    const replica = new Replica();
    replica.apply(snap(1, capsule({ heading: 3.0 })), 0);
    replica.apply(snap(2, capsule({ heading: -3.0 })), 100);
    const [mid] = replica.states(150);
    expect(Math.abs(Math.abs(mid?.heading ?? 0) - Math.PI)).toBeLessThan(1e-6);
    const [early] = replica.states(125);
    expect(early?.heading).toBeCloseTo(3.0 + (2 * Math.PI - 6) / 4, 9);
  });

  it('rebuilds what it is given, so the sender cannot reach into the buffer afterwards', () => {
    const replica = new Replica();
    const given = capsule({ at: world(1, 1) });
    replica.join(given, 0);
    (given as { name: string }).name = 'Changed';
    expect(replica.newest(actorId('a1'))?.name).toBe('Ant');
  });

  it('keeps only what can still bracket the cursor, and caps the buffer under a stalled clock', () => {
    const replica = new Replica();
    for (let i = 0; i < 5; i += 1) replica.apply(snap(i + 1, capsule({ at: world(i * 10, 0) })), i * 50);
    // Newest landed at 200 with the cursor at 100; the samples at 0 and 50 can never be read again.
    expect(replica.states(-1e9)[0]?.at).toEqual({ wx: 20, wz: 0 });
    expect(replica.states(250)[0]?.at.wx).toBeCloseTo(30, 9);
    const stalled = new Replica();
    for (let i = 0; i < 100; i += 1) stalled.apply(snap(i + 1, capsule({ at: world(i, 0) })), 0);
    expect(stalled.states(-1e9)[0]?.at.wx).toBe(100 - 64);
    expect(stalled.states(1e9)[0]?.at.wx).toBe(99);
  });

  it('lands a sample stamped earlier than the last with the last, rather than reading time backwards', () => {
    const replica = new Replica();
    replica.apply(snap(1, capsule({ at: world(0, 0) })), 100);
    replica.apply(snap(2, capsule({ at: world(10, 0) })), 90);
    // Both samples now sit at 100: at the cursor the newest stands, before it the oldest — never a division by zero between them.
    expect(replica.states(200)[0]?.at).toEqual({ wx: 10, wz: 0 });
    expect(replica.states(199)[0]?.at).toEqual({ wx: 0, wz: 0 });
  });
});
