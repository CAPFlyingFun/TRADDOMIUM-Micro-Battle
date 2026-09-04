/**
 * NetworkedWorld against a fake wire: the glue between a world and the
 * authority, with nothing else in the room.
 *
 * The transport here is the smallest thing that satisfies the contract —
 * it records what was sent and hands the far end's messages back on
 * demand — so every assertion is about THIS module's decisions: when a
 * claim goes out, what happens when one is refused, what the world may
 * draw, and what the status is allowed to say. No host, no loopback and
 * no timer: the clock is a variable, as it is everywhere in `net/`.
 *
 * Runs in node, without a DOM: `net/` is core (ARCHITECTURE §2.6).
 */
import { describe, expect, it, vi } from 'vitest';
import { actorId } from '../src/actor/ActorId';
import type { ActorState } from '../src/actor/ActorState';
import { playerId, type PlayerId } from '../src/actor/PlayerId';
import { colorFor } from '../src/actor/playerColor';
import { spawnCapsule } from '../src/actor/spawnCapsule';
import { CLAIM_HZ, NetworkedWorld, REJOIN_MS, type NetworkIdentity } from '../src/net/NetworkedWorld';
import type { MessageHandler, Transport, TransportState } from '../src/net/Transport';
import type { Message, MoveMessage, Snapshot } from '../src/net/protocol';
import { world } from '../src/world/coords';

const ME = playerId('device-me');
const THEM = playerId('device-them');
const MY_ACTOR = actorId('capsule-1');
const THEIR_ACTOR = actorId('capsule-2');
const IDENTITY: NetworkIdentity = { playerId: ME, name: 'Keeper' };

/** The claim interval the module documents: the authority's own snapshot period. */
const CLAIM_MS = 1000 / CLAIM_HZ;

/**
 * A wire that does exactly what the contract says and nothing more.
 * `deliver` is the far end speaking; `refuse` is a relay that will not
 * take the call.
 */
class FakeTransport implements Transport {
  state: TransportState = 'closed';
  readonly sent: Message[] = [];
  connects = 0;
  /** When set, the next `connect()` rejects with this reason. */
  refuse: string | null = null;
  private readonly handlers = new Set<MessageHandler>();
  private readonly closers = new Set<() => void>();

  async connect(): Promise<void> {
    this.connects += 1;
    if (this.refuse !== null) {
      this.state = 'closed';
      throw new Error(this.refuse);
    }
    this.state = 'open';
  }

  disconnect(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    for (const cb of [...this.closers]) cb();
  }

  send(msg: unknown): void {
    this.sent.push(msg as Message);
  }

  onMessage(cb: MessageHandler): () => void {
    this.handlers.add(cb);
    return () => {
      this.handlers.delete(cb);
    };
  }

  onClose(cb: () => void): () => void {
    this.closers.add(cb);
    return () => {
      this.closers.delete(cb);
    };
  }

  /** The far end speaks. */
  deliver(msg: Message): void {
    for (const cb of [...this.handlers]) cb(msg);
  }

  kind(k: Message['kind']): Message[] {
    return this.sent.filter((m) => m.kind === k);
  }

  moves(): MoveMessage[] {
    return this.sent.filter((m): m is MoveMessage => m.kind === 'move');
  }
}

function capsuleOf(owner: PlayerId, id = MY_ACTOR, wx = 0, wz = 0): ActorState {
  return spawnCapsule(owner, owner === ME ? 'Keeper' : 'Other', colorFor(owner), world(wx, wz), id);
}

function snapshot(tick: number, actors: readonly ActorState[]): Snapshot {
  return { tick, actors };
}

/** Enough microtask turns for a handshake that awaits an already-resolved transport. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

interface Rig {
  readonly transport: FakeTransport;
  readonly net: NetworkedWorld;
  readonly corrections: ActorState[];
  now(): number;
  advance(ms: number): void;
  /** Open the link and answer the hello with a welcome, as an authority would. */
  join(at?: ActorState): Promise<void>;
}

function rig(options: { readonly claimHz?: number } = {}): Rig {
  let nowMs = 0;
  const transport = new FakeTransport();
  const corrections: ActorState[] = [];
  const net = new NetworkedWorld({
    transport,
    identity: IDENTITY,
    now: () => nowMs,
    ...(options.claimHz === undefined ? {} : { claimHz: options.claimHz }),
    onCorrection: (truth) => corrections.push(truth),
  });
  return {
    transport,
    net,
    corrections,
    now: () => nowMs,
    advance: (ms) => {
      nowMs += ms;
    },
    async join(at: ActorState = capsuleOf(ME)) {
      const opening = net.connect();
      await flush();
      transport.deliver({ kind: 'welcome', yourId: ME, snapshot: snapshot(1, [at]) });
      await opening;
    },
  };
}

describe('NetworkedWorld: joining', () => {
  it('opens the link, says hello with the identity and a colour every machine agrees on, and reports connected', async () => {
    const { transport, net } = rig();
    expect(net.status).toEqual({ state: 'idle', actorCount: 0, refusedClaims: 0 });

    const opening = net.connect();
    await flush();
    expect(transport.connects).toBe(1);
    expect(transport.kind('hello')).toEqual([{ kind: 'hello', playerId: ME, name: 'Keeper', color: colorFor(ME) }]);
    // The handshake is in flight and the status says exactly that.
    expect(net.status.state).toBe('connecting');

    transport.deliver({ kind: 'welcome', yourId: ME, snapshot: snapshot(1, [capsuleOf(ME)]) });
    await opening;
    expect(net.status).toEqual({ state: 'connected', actorCount: 0, refusedClaims: 0 });
    expect(net.playerId).toBe(ME);
    expect(net.localActor()?.id).toBe(MY_ACTOR);
  });

  it('a relay that will not take the call leaves the world running and the status honest', async () => {
    const { transport, net } = rig();
    transport.refuse = 'relay refused the connection';
    // The promise RESOLVES: a failed link is not an exception that unwinds
    // whatever was entering the world.
    await expect(net.connect()).resolves.toBeUndefined();
    expect(net.status.state).toBe('failed');
    expect(net.remoteActors()).toEqual([]);
    expect(() => net.update({ at: world(1, 1), height: 0, heading: 0 })).not.toThrow();
    expect(transport.moves()).toEqual([]);
  });

  it('claims nothing before it has been welcomed', () => {
    const { transport, net } = rig();
    net.update({ at: world(5, 5), height: 0, heading: 0 });
    expect(transport.sent).toEqual([]);
  });
});

describe('NetworkedWorld: the claim cadence', () => {
  it('sends at the authority’s snapshot rate and no faster, however often it is updated', async () => {
    const r = rig();
    await r.join();
    // One millisecond a frame for a second: a thousand chances to claim.
    for (let i = 0; i < 1000; i += 1) {
      r.advance(1);
      r.net.update({ at: world(i + 1, 0), height: 0, heading: 0 });
    }
    const moves = r.transport.moves();
    expect(moves.length).toBe(CLAIM_HZ);
    expect(CLAIM_MS).toBe(50);
    // And the seqs run forward one at a time, which is what lets the
    // authority ignore a claim that arrives after a newer one.
    expect(moves.map((m) => m.seq)).toEqual([...Array(CLAIM_HZ).keys()]);
  });

  it('never claims twice inside one interval at a real frame rate', async () => {
    const r = rig();
    await r.join();
    const at: number[] = [];
    for (let i = 0; i < 120; i += 1) {
      r.advance(1000 / 60);
      r.net.update({ at: world(i + 1, 0), height: 0, heading: 0 });
      if (r.transport.moves().length > at.length) at.push(r.now());
    }
    expect(at.length).toBeLessThanOrEqual(CLAIM_HZ * 2);
    for (let i = 1; i < at.length; i += 1) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(CLAIM_MS);
  });

  it('a standing actor says nothing, and moving again resumes', async () => {
    const r = rig();
    await r.join();
    const still = { at: world(10, 10), height: 0, heading: 0 };
    r.advance(CLAIM_MS);
    r.net.update(still);
    expect(r.transport.moves().length).toBe(1);
    for (let i = 0; i < 10; i += 1) {
      r.advance(CLAIM_MS);
      r.net.update(still);
    }
    expect(r.transport.moves().length).toBe(1);

    r.advance(CLAIM_MS);
    r.net.update({ at: world(11, 10), height: 0, heading: 0 });
    expect(r.transport.moves().length).toBe(2);
  });

  it('claims the pose it was given, as a WorldPoint, and nothing of its own', async () => {
    const r = rig();
    await r.join();
    r.advance(CLAIM_MS);
    r.net.update({ at: world(120, -45), height: 3, heading: 1.25 });
    expect(r.transport.moves()[0]).toEqual({
      kind: 'move',
      actorId: MY_ACTOR,
      at: world(120, -45),
      height: 3,
      heading: 1.25,
      seq: 0,
    });
  });
});

describe('NetworkedWorld: the authority answers', () => {
  it('counts a refused claim, hands the truth to its owner, and lets the next pose through at once', async () => {
    const r = rig();
    await r.join();
    r.advance(CLAIM_MS);
    // A claim a travel budget would never pay for.
    r.net.update({ at: world(50_000, 0), height: 0, heading: 0 });
    const refusedSeq = r.transport.moves()[0].seq;

    r.advance(30);
    const truth = capsuleOf(ME, MY_ACTOR, 40, 0);
    r.transport.deliver({ kind: 'snapshot', snapshot: snapshot(2, [truth]), ackSeq: refusedSeq });

    expect(r.corrections).toEqual([truth]);
    expect(r.net.status.refusedClaims).toBe(1);
    // The client applied it: the local actor is now where the authority says.
    expect(r.net.localActor()).toEqual(truth);
    // Claim-to-acknowledgement, measured — not a ping, and not a guess.
    expect(r.net.status.roundTripMs).toBe(30);

    // The latch is re-armed: the very next pose is claimed even though the
    // caller has not moved since the refusal.
    r.advance(CLAIM_MS);
    r.net.update({ at: world(50_000, 0), height: 0, heading: 0 });
    expect(r.transport.moves().length).toBe(2);
  });

  it('an accepted claim is no correction: nothing is counted and nobody is told', async () => {
    const r = rig();
    await r.join();
    r.advance(CLAIM_MS);
    const pose = { at: world(30, 0), height: 0, heading: 0 };
    r.net.update(pose);
    const accepted = capsuleOf(ME, MY_ACTOR, 30, 0);
    r.transport.deliver({ kind: 'snapshot', snapshot: snapshot(2, [accepted]), ackSeq: 0 });
    expect(r.corrections).toEqual([]);
    expect(r.net.status.refusedClaims).toBe(0);
  });

  it('draws every OTHER actor from the snapshots and never the local one', async () => {
    const r = rig();
    await r.join();
    const mine = capsuleOf(ME, MY_ACTOR, 0, 0);
    const theirs = capsuleOf(THEM, THEIR_ACTOR, 100, 0);
    r.transport.deliver({ kind: 'snapshot', snapshot: snapshot(2, [mine, theirs]) });

    const drawn = r.net.remoteActors();
    expect(drawn.map((a) => a.id)).toEqual([THEIR_ACTOR]);
    expect(drawn[0].owner).toBe(THEM);
    expect(r.net.status.actorCount).toBe(1);

    // A `leave` empties the world of that player, which is how a capsule
    // stops being drawn at all.
    r.transport.deliver({ kind: 'leave', playerId: THEM });
    expect(r.net.remoteActors()).toEqual([]);
    expect(r.net.status.actorCount).toBe(0);
  });

  it('reads remote actors behind receipt, so a capsule glides between snapshots instead of snapping onto them', async () => {
    const r = rig({});
    await r.join();
    r.transport.deliver({ kind: 'snapshot', snapshot: snapshot(2, [capsuleOf(THEM, THEIR_ACTOR, 0, 0)]) });
    r.advance(100);
    r.transport.deliver({ kind: 'snapshot', snapshot: snapshot(3, [capsuleOf(THEM, THEIR_ACTOR, 100, 0)]) });
    r.advance(50);
    // Read 100 ms behind receipt (Replica's default), which is half way
    // between a sample at 0 ms and one at 100 ms.
    const half = r.net.remoteActors(r.now());
    expect(half[0].at.wx).toBeCloseTo(50, 6);
  });
});

describe('NetworkedWorld: a link that dies', () => {
  it('survives a mid-session close: nothing throws, nothing is sent, and the status stops saying connected', async () => {
    const r = rig();
    await r.join();
    r.transport.deliver({ kind: 'snapshot', snapshot: snapshot(2, [capsuleOf(THEM, THEIR_ACTOR, 100, 0)]) });

    r.transport.disconnect();
    expect(r.net.status.state).toBe('disconnected');

    const before = r.transport.sent.length;
    for (let i = 0; i < 30; i += 1) {
      r.advance(16);
      expect(() => r.net.update({ at: world(i + 1, 0), height: 0, heading: 0 })).not.toThrow();
    }
    expect(r.transport.sent.length).toBe(before);
    // What was on screen stays on screen, stale and honestly so: only a
    // `leave` removes an actor.
    expect(r.net.status.actorCount).toBe(1);
  });

  it('offers the same identity again on a bounded cadence, and the authority may hand back the same actor', async () => {
    const r = rig();
    await r.join();
    r.transport.disconnect();
    const connectsBefore = r.transport.connects;

    // Too soon: the cadence is a bound, not a scramble.
    r.advance(REJOIN_MS / 2);
    r.net.update(null);
    await flush();
    expect(r.transport.connects).toBe(connectsBefore);

    r.advance(REJOIN_MS);
    r.net.update(null);
    await flush();
    expect(r.transport.connects).toBe(connectsBefore + 1);
    // The SAME PlayerId, which is what lets the authority re-attach the actor.
    const hellos = r.transport.kind('hello');
    expect(hellos.length).toBe(2);
    expect(hellos[1]).toEqual(hellos[0]);

    r.transport.deliver({ kind: 'welcome', yourId: ME, snapshot: snapshot(9, [capsuleOf(ME)]) });
    await flush();
    expect(r.net.status.state).toBe('connected');
    // The claim sequence restarts with every hello, as the authority reads it.
    r.advance(REJOIN_MS);
    r.net.update({ at: world(7, 7), height: 0, heading: 0 });
    expect(r.transport.moves()[r.transport.moves().length - 1].seq).toBe(0);
  });

  it('a rejoin the relay refuses leaves the world running and says so', async () => {
    const r = rig();
    await r.join();
    r.transport.disconnect();
    r.transport.refuse = 'relay is down';
    r.advance(REJOIN_MS);
    expect(() => r.net.update(null)).not.toThrow();
    await flush();
    expect(r.net.status.state).toBe('failed');
  });

  it('leaves cleanly: a bye, a hung-up wire, and no rejoin after it', async () => {
    const r = rig();
    await r.join();
    r.net.close();
    expect(r.transport.kind('bye')).toEqual([{ kind: 'bye', playerId: ME }]);
    expect(r.transport.state).toBe('closed');
    expect(r.net.status.state).toBe('left');

    const connects = r.transport.connects;
    r.advance(REJOIN_MS * 3);
    r.net.update({ at: world(1, 1), height: 0, heading: 0 });
    await flush();
    expect(r.transport.connects).toBe(connects);
    // Twice is not an error: a world may be disposed after it has left.
    expect(() => r.net.close()).not.toThrow();
  });

  it('stops measuring the wire once it has left', async () => {
    const r = rig();
    const spy = vi.fn();
    r.transport.onMessage(spy);
    await r.join();
    r.net.close();
    r.transport.deliver({ kind: 'snapshot', snapshot: snapshot(3, [capsuleOf(THEM, THEIR_ACTOR, 1, 1)]) });
    // The far end's message reached the wire's other subscribers, and this
    // module is no longer one of them.
    expect(spy).toHaveBeenCalled();
    expect(r.net.status.state).toBe('left');
  });
});
