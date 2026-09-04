/**
 * THE TWO-CAPSULE PROOF (ARCHITECTURE §5): before any ant exists, two
 * players in one tiny session see each other move — with identity,
 * joining, an authority boundary, replication, remote representation and
 * disconnect/reconnect — in-process, over a loopback wire that is as
 * late, uneven and lossy as the test asks. Every millisecond here is
 * simulated: the lab owns the clock, pumps the wire and ticks the host.
 */
import { describe, expect, it } from 'vitest';
import { actorId, type ActorId } from '../src/actor/ActorId';
import type { ActorState } from '../src/actor/ActorState';
import { DEBUG_CAPSULE_TUNING } from '../src/actor/CapsuleTuning';
import { playerId } from '../src/actor/PlayerId';
import { Client } from '../src/net/Client';
import { HOST_DEFAULTS, Host, SPAWN_SPACING, type HostOptions } from '../src/net/Host';
import { LoopbackTransport, loopbackLink, type LoopbackLink } from '../src/net/LoopbackTransport';
import type { Transport } from '../src/net/Transport';
import { networkConditions, type NetworkConditions } from '../src/net/NetworkConditions';
import { isMessage, type HelloMessage, type MessageKind, type WelcomeMessage } from '../src/net/protocol';
import { seededRandom } from '../src/net/seededRandom';
import { translate, world } from '../src/world/coords';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const WALK = DEBUG_CAPSULE_TUNING.walkSpeed;
const SPRINT = WALK * DEBUG_CAPSULE_TUNING.sprintFactor;

interface Player {
  readonly client: Client;
  readonly transport: LoopbackTransport;
  readonly hostEnd: LoopbackTransport;
  readonly welcome: WelcomeMessage;
  readonly hello: HelloMessage;
}

/** One host, any number of clients, one clock. */
class Lab {
  clock = 0;
  readonly conditions: NetworkConditions;
  readonly link: LoopbackLink;
  readonly host: Host;
  private readonly ends: LoopbackTransport[] = [];

  constructor(conditions: Partial<NetworkConditions> = {}, hostOptions: Partial<HostOptions> = {}, seed = 7) {
    this.conditions = networkConditions(conditions);
    this.link = loopbackLink(() => this.clock, this.conditions, seededRandom(seed));
    this.host = new Host(() => this.clock, hostOptions);
  }

  pair(): [LoopbackTransport, LoopbackTransport] {
    const ends = LoopbackTransport.pair(this.link);
    this.ends.push(...ends);
    return ends;
  }

  /** Connect a new client and run the clock until its welcome arrives. */
  async join(id: string, name: string, color: string, client = new Client(() => this.clock)): Promise<Player> {
    const [hostEnd, transport] = this.pair();
    await this.host.attach(hostEnd);
    const hello: HelloMessage = { kind: 'hello', playerId: playerId(id), name, color };
    const welcome = await this.until(client.connect(transport, hello));
    return { client, transport, hostEnd, welcome, hello };
  }

  /** Advance the clock in slices, pumping every wire end and ticking the host each slice. */
  async run(ms: number, stepMs = 10): Promise<void> {
    const end = this.clock + ms;
    while (this.clock < end) {
      this.clock = Math.min(end, this.clock + stepMs);
      await flush();
      for (const t of this.ends) t.pump(this.clock);
      this.host.tick(this.clock);
    }
    await flush();
  }

  /** Run until a promise settles — a round trip at the worst the wire can do, plus a snapshot. */
  async until<T>(p: Promise<T>): Promise<T> {
    let settled = false;
    p.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const budget = 2 * (this.conditions.latencyMs + this.conditions.jitterMs) + 200;
    const deadline = this.clock + budget;
    while (!settled && this.clock < deadline) await this.run(10);
    if (!settled) throw new Error(`nothing settled within ${budget} ms of simulated time`);
    return p;
  }

  /** Walk an actor along +wz, one claim per step, as a player's own transform would produce them. */
  async walk(client: Client, steps: number, stepMs: number, speed: number): Promise<ActorState> {
    let pose = client.self();
    if (pose === null) throw new Error('walk before welcome');
    for (let i = 0; i < steps; i += 1) {
      pose = { ...pose, at: translate(pose.at, 0, (speed * stepMs) / 1000) };
      client.sendMove(pose);
      await this.run(stepMs);
    }
    return pose;
  }
}

/** Record the kinds of protocol messages arriving on a wire end. */
function tap(end: LoopbackTransport): MessageKind[] {
  const kinds: MessageKind[] = [];
  end.onMessage((raw) => {
    if (isMessage(raw)) kinds.push(raw.kind);
  });
  return kinds;
}

const remoteOf = (client: Client, id: ActorId, nowMs: number): ActorState | undefined =>
  client.remotes(nowMs).find((a) => a.id === id);

describe('joining', () => {
  it('A joins, then B: each welcome shows the world as it stands, and each replica shows the other', async () => {
    const lab = new Lab();
    const a = await lab.join('device-a', 'Ada', '#ff8800');
    expect(a.welcome.yourId).toBe('device-a');
    expect(a.welcome.snapshot.actors).toHaveLength(1);
    expect(a.client.self()).toMatchObject({
      id: 'capsule-1', kind: 'capsule', owner: 'device-a', at: { wx: 0, wz: 0 }, height: 0, heading: 0, color: '#ff8800', name: 'Ada',
    });
    expect(a.client.state).toBe('connected');
    expect(a.client.playerId).toBe('device-a');
    expect(a.client.actorId).toBe('capsule-1');

    const arrivingAtA = tap(a.transport);
    const b = await lab.join('device-b', 'Bea', '#0088ff');
    expect(b.welcome.snapshot.actors.map((x) => x.id)).toEqual(['capsule-1', 'capsule-2']);
    expect(b.client.self()).toMatchObject({ id: 'capsule-2', owner: 'device-b', at: { wx: SPAWN_SPACING, wz: 0 }, color: '#0088ff' });

    await lab.run(100);
    expect(arrivingAtA).toContain('join');
    expect(a.client.remotes(lab.clock).map((x) => x.id)).toEqual(['capsule-2']);
    expect(b.client.remotes(lab.clock).map((x) => x.id)).toEqual(['capsule-1']);
    expect(remoteOf(a.client, actorId('capsule-2'), lab.clock)).toMatchObject({ color: '#0088ff', name: 'Bea' });
    expect(lab.host.snapshot().actors.map((x) => x.id)).toEqual(['capsule-1', 'capsule-2']);
    expect(lab.host.presence(playerId('device-a'))).toBe('connected');
    expect(lab.host.presence(playerId('device-b'))).toBe('connected');
    expect(lab.host.presence(playerId('device-c'))).toBe('absent');
    expect(lab.host.connectionCount).toBe(2);
  });

  it('a client cannot claim a move before its welcome, or connect twice', async () => {
    const lab = new Lab();
    const client = new Client(() => lab.clock);
    expect(() => client.sendMove({ at: world(0, 0), height: 0, heading: 0 })).toThrow(/move while idle/);
    expect(() => client.reconnect()).toThrow(/reconnect before connect/);
    const [hostEnd, transport] = lab.pair();
    await lab.host.attach(hostEnd);
    const welcome = client.connect(transport, { kind: 'hello', playerId: playerId('device-a'), name: 'Ada', color: '#ff8800' });
    expect(client.state).toBe('connecting');
    expect(() => client.connect(transport, { kind: 'hello', playerId: playerId('device-a'), name: 'Ada', color: '#ff8800' })).toThrow(
      /connect while connecting/,
    );
    await lab.until(welcome);
    expect(client.state).toBe('connected');
  });

  it('a first handshake that never opens leaves the client able to try again', async () => {
    // The relay was unreachable when the player pressed JOIN. Before this
    // was fixed the client stayed 'connecting' for good, so every retry
    // threw 'connect while connecting' and only a page reload helped.
    const lab = new Lab();
    const client = new Client(() => lab.clock);
    const refused: Transport = {
      get state() {
        return 'closed' as const;
      },
      connect: () => Promise.reject(new Error('relay unreachable')),
      disconnect: () => {},
      send: () => {},
      onMessage: () => () => {},
      onClose: () => () => {},
    };
    const hello: HelloMessage = { kind: 'hello', playerId: playerId('device-a'), name: 'Ada', color: '#ff8800' };
    await expect(client.connect(refused, hello)).rejects.toThrow(/relay unreachable/);
    expect(client.state).toBe('disconnected');

    // And the retry actually works, against a relay that is up this time.
    const [hostEnd, transport] = lab.pair();
    await lab.host.attach(hostEnd);
    await lab.until(client.connect(transport, hello));
    expect(client.state).toBe('connected');
  });

  it('rejects the welcome promise when the link closes first', async () => {
    const lab = new Lab({ latencyMs: 50 });
    const client = new Client(() => lab.clock);
    const [hostEnd, transport] = lab.pair();
    await lab.host.attach(hostEnd);
    const welcome = client.connect(transport, { kind: 'hello', playerId: playerId('device-a'), name: 'Ada', color: '#ff8800' });
    await flush();
    lab.host.detach(hostEnd);
    await expect(lab.until(welcome)).rejects.toThrow(/link closed before welcome/);
    expect(client.state).toBe('disconnected');
    expect(lab.host.connectionCount).toBe(0);
  });
});

describe('replication', () => {
  it('A moves and B sees it after the wire, gliding, never ahead of the truth', async () => {
    const lab = new Lab({ latencyMs: 100 });
    const a = await lab.join('device-a', 'Ada', '#ff8800');
    const b = await lab.join('device-b', 'Bea', '#0088ff');
    await lab.run(300);
    const aId = actorId('capsule-1');
    const t0 = lab.clock;
    const seen: { at: number; wz: number }[] = [];
    const watch = (): void => {
      const view = remoteOf(b.client, aId, lab.clock);
      const truth = lab.host.actorsOf(playerId('device-a'))[0];
      if (view === undefined || truth === undefined) throw new Error('A vanished from the world');
      expect(view.at.wz).toBeLessThanOrEqual(truth.at.wz + 1e-9);
      seen.push({ at: lab.clock, wz: view.at.wz });
    };
    // Ten claims, 50 ms apart, at a plain walk: 3 cm each, 30 cm in all.
    let pose = a.client.self();
    if (pose === null) throw new Error('unreachable');
    for (let i = 0; i < 10; i += 1) {
      pose = { ...pose, at: translate(pose.at, 0, (WALK * 50) / 1000) };
      a.client.sendMove(pose);
      for (let s = 0; s < 5; s += 1) {
        await lab.run(10);
        watch();
      }
    }
    for (let s = 0; s < 50; s += 1) {
      await lab.run(10);
      watch();
    }
    // Nothing could be seen before the claim had crossed the wire twice.
    for (const s of seen) if (s.at <= t0 + 200) expect(s.wz).toBe(0);
    // It arrived, all of it, and B's picture agrees with the authority's.
    const final = seen[seen.length - 1];
    expect(final?.wz).toBeCloseTo(30, 6);
    expect(lab.host.actorsOf(playerId('device-a'))[0]?.at.wz).toBeCloseTo(30, 6);
    expect(a.client.self()?.at.wz).toBeCloseTo(30, 6);
    expect(a.client.corrections).toBe(0);
    // It glided: monotonic, and read at many positions in between, not ten jumps.
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]?.wz).toBeGreaterThanOrEqual(seen[i - 1]?.wz ?? 0);
    expect(new Set(seen.map((s) => s.wz.toFixed(6))).size).toBeGreaterThan(15);
  });

  it('a teleport claim is refused and corrected; the world never sees it', async () => {
    const lab = new Lab();
    const a = await lab.join('device-a', 'Ada', '#ff8800');
    const b = await lab.join('device-b', 'Bea', '#0088ff');
    await lab.run(100);
    const corrected: ActorState[] = [];
    a.client.onCorrection((truth) => corrected.push(truth));
    const arrivingAtA: unknown[] = [];
    a.transport.onMessage((raw) => arrivingAtA.push(raw));

    // A plain step is accepted and acknowledged.
    const step = a.client.sendMove({ at: world(0, 2), height: 0, heading: 0.3 });
    await lab.run(100);
    expect(a.client.self()).toMatchObject({ at: { wx: 0, wz: 2 }, heading: 0.3 });
    expect(lab.host.stats).toEqual({ claimsAccepted: 1, claimsRefused: 0 });
    expect(arrivingAtA.some((m) => isMessage(m) && m.kind === 'snapshot' && m.ackSeq === step)).toBe(true);
    expect(a.client.corrections).toBe(0);

    // Fifty metres in one claim is a teleport.
    const jump = a.client.sendMove({ at: world(0, 5000), height: 0, heading: 0 });
    await lab.run(20);
    expect(lab.host.stats).toEqual({ claimsAccepted: 1, claimsRefused: 1 });
    expect(lab.host.actorsOf(playerId('device-a'))[0]?.at).toEqual({ wx: 0, wz: 2 });
    expect(a.client.corrections).toBe(1);
    expect(corrected).toHaveLength(1);
    expect(corrected[0]).toMatchObject({ id: 'capsule-1', at: { wx: 0, wz: 2 } });
    expect(a.client.self()?.at).toEqual({ wx: 0, wz: 2 });
    const correction = arrivingAtA.find((m) => isMessage(m) && m.kind === 'snapshot' && m.ackSeq === jump);
    expect(correction).toMatchObject({ kind: 'snapshot', ackSeq: jump, snapshot: { actors: [{ id: 'capsule-1', at: { wx: 0, wz: 2 } }] } });
    await lab.run(300);
    expect(remoteOf(b.client, actorId('capsule-1'), lab.clock)?.at).toEqual({ wx: 0, wz: 2 });
    expect(a.client.corrections).toBe(1);

    // From the truth, a step is fine again — and so is a tall one, straight up.
    a.client.sendMove({ at: world(0, 4), height: 3, heading: 0 });
    await lab.run(100);
    expect(a.client.self()).toMatchObject({ at: { wx: 0, wz: 4 }, height: 3 });
    expect(a.client.corrections).toBe(1);
  });

  it('waiting buys no distance: the budget banks a quarter second, on the host clock', async () => {
    const lab = new Lab();
    const a = await lab.join('device-a', 'Ada', '#ff8800');
    await lab.run(5000, 50);
    const cap = (SPRINT * HOST_DEFAULTS.tolerance * HOST_DEFAULTS.burstMs) / 1000;
    a.client.sendMove({ at: world(0, cap + 1), height: 0, heading: 0 });
    await lab.run(50);
    expect(lab.host.stats.claimsRefused).toBe(1);
    expect(a.client.self()?.at).toEqual({ wx: 0, wz: 0 });
    a.client.sendMove({ at: world(0, cap - 1), height: 0, heading: 0 });
    await lab.run(100);
    expect(lab.host.stats).toEqual({ claimsAccepted: 1, claimsRefused: 1 });
    expect(a.client.self()?.at).toEqual({ wx: 0, wz: cap - 1 });
  });

  it('refuses a claim on another player’s actor, ignores a stale seq, and ignores garbage on the wire', async () => {
    const lab = new Lab();
    const a = await lab.join('device-a', 'Ada', '#ff8800');
    const b = await lab.join('device-b', 'Bea', '#0088ff');
    await lab.run(100);
    const seq = a.client.sendMove({ at: world(0, 1), height: 0, heading: 0 });
    await lab.run(50);
    // Not yours.
    a.transport.send({ kind: 'move', actorId: 'capsule-2', at: { wx: SPAWN_SPACING, wz: 1 }, height: 0, heading: 0, seq: seq + 1 });
    // Already seen.
    a.transport.send({ kind: 'move', actorId: 'capsule-1', at: { wx: 0, wz: 1.5 }, height: 0, heading: 0, seq });
    // Not messages, or not a client's to send.
    a.transport.send({ kind: 'teleport', to: 'anywhere' });
    a.transport.send('hello');
    a.transport.send(null);
    a.transport.send({ kind: 'snapshot', snapshot: { tick: 999, actors: [] } });
    a.hostEnd.send({ kind: 'hello', playerId: 'device-x', name: 'X', color: '#000000' });
    a.hostEnd.send({ kind: 'move', actorId: 'capsule-1', at: { wx: 0, wz: 0 }, height: 0, heading: 0, seq: 0 });
    await lab.run(100);
    expect(lab.host.stats).toEqual({ claimsAccepted: 1, claimsRefused: 1 });
    expect(lab.host.actorsOf(playerId('device-a'))[0]?.at).toEqual({ wx: 0, wz: 1 });
    expect(lab.host.actorsOf(playerId('device-b'))[0]?.at).toEqual({ wx: SPAWN_SPACING, wz: 0 });
    expect(b.client.self()?.at).toEqual({ wx: SPAWN_SPACING, wz: 0 });
    expect(a.client.self()?.at).toEqual({ wx: 0, wz: 1 });
    expect(a.client.corrections).toBe(0);
    expect(lab.host.snapshot().actors).toHaveLength(2);
  });
});

describe('leaving and coming back', () => {
  it('B says bye: A hears leave at once and B is forgotten', async () => {
    const lab = new Lab({ latencyMs: 50 }, { graceMs: 5000 });
    const a = await lab.join('device-a', 'Ada', '#ff8800');
    const b = await lab.join('device-b', 'Bea', '#0088ff');
    await lab.run(100);
    const arrivingAtA = tap(a.transport);
    b.client.leave();
    expect(b.client.state).toBe('left');
    await lab.run(150);
    expect(arrivingAtA).toContain('leave');
    expect(a.client.remotes(lab.clock)).toEqual([]);
    expect(lab.host.presence(playerId('device-b'))).toBe('absent');
    expect(lab.host.snapshot().actors.map((x) => x.id)).toEqual(['capsule-1']);
    expect(lab.host.connectionCount).toBe(1);
  });

  it('B hangs up without a word: her capsule lingers for the grace, then A hears leave', async () => {
    const lab = new Lab({ latencyMs: 50 }, { graceMs: 500 });
    const a = await lab.join('device-a', 'Ada', '#ff8800');
    const b = await lab.join('device-b', 'Bea', '#0088ff');
    await lab.run(100);
    const bId = actorId('capsule-2');
    b.transport.disconnect();
    expect(b.client.state).toBe('disconnected');
    await lab.run(60);
    const hungUpAt = lab.clock;
    expect(lab.host.presence(playerId('device-b'))).toBe('lingering');
    // Still standing where she was, for everyone.
    await lab.run(300);
    expect(lab.host.presence(playerId('device-b'))).toBe('lingering');
    expect(remoteOf(a.client, bId, lab.clock)?.at).toEqual({ wx: SPAWN_SPACING, wz: 0 });
    // Then gone.
    await lab.run(hungUpAt + 600 - lab.clock);
    expect(lab.host.presence(playerId('device-b'))).toBe('absent');
    expect(a.client.remotes(lab.clock)).toEqual([]);
    expect(lab.host.snapshot().actors.map((x) => x.id)).toEqual(['capsule-1']);
  });

  it('B reconnects within the grace with the same PlayerId: same actor, same colour, nobody saw her go', async () => {
    const lab = new Lab({ latencyMs: 50 }, { graceMs: 2000 });
    const a = await lab.join('device-a', 'Ada', '#ff8800');
    const b = await lab.join('device-b', 'Bea', '#0088ff');
    await lab.run(100);
    const bId = actorId('capsule-2');
    const bWalked = await lab.walk(b.client, 5, 50, WALK);
    await lab.run(200);
    expect(b.client.self()?.at.wz).toBeCloseTo(bWalked.at.wz, 9);

    const arrivingAtA = tap(a.transport);
    b.transport.disconnect();
    await lab.run(200);
    expect(lab.host.presence(playerId('device-b'))).toBe('lingering');

    // The same client, the same wire (a loopback can be reopened; a socket would be handed in fresh).
    const welcome = await lab.until(b.client.reconnect());
    expect(b.client.state).toBe('connected');
    expect(welcome.yourId).toBe('device-b');
    expect(lab.host.presence(playerId('device-b'))).toBe('connected');
    const mine = b.client.self();
    expect(mine).toMatchObject({ id: 'capsule-2', color: '#0088ff', name: 'Bea' });
    expect(mine?.at.wz).toBeCloseTo(bWalked.at.wz, 9);
    expect(b.client.remotes(lab.clock).map((x) => x.id)).toEqual(['capsule-1']);
    await lab.run(200);
    expect(arrivingAtA).not.toContain('leave');
    expect(arrivingAtA).not.toContain('join');
    expect(remoteOf(a.client, bId, lab.clock)?.at.wz).toBeCloseTo(bWalked.at.wz, 9);

    // The claim sequence starts over with the new connection, and moves are accepted again.
    const seq = b.client.sendMove({ ...bWalked, at: translate(bWalked.at, 0, 2) });
    expect(seq).toBe(0);
    await lab.run(200);
    expect(b.client.corrections).toBe(0);
    expect(lab.host.actorsOf(playerId('device-b'))[0]?.at.wz).toBeCloseTo(bWalked.at.wz + 2, 9);
  });

  it('a fresh client with the same PlayerId (a reload) gets the same actor back, whatever its hello says about looks', async () => {
    const lab = new Lab({ latencyMs: 50 }, { graceMs: 2000 });
    const a = await lab.join('device-a', 'Ada', '#ff8800');
    const b = await lab.join('device-b', 'Bea', '#0088ff');
    await lab.run(100);
    b.transport.disconnect();
    await lab.run(100);
    const arrivingAtA = tap(a.transport);
    const again = await lab.join('device-b', 'Bee', '#123456');
    expect(again.client).not.toBe(b.client);
    expect(again.client.self()).toMatchObject({ id: 'capsule-2', color: '#0088ff', name: 'Bea', at: { wx: SPAWN_SPACING, wz: 0 } });
    await lab.run(200);
    expect(arrivingAtA).not.toContain('leave');
    expect(arrivingAtA).not.toContain('join');
    expect(lab.host.snapshot().actors).toHaveLength(2);
    expect(lab.host.connectionCount).toBe(3); // the old loopback end still listens; a socket owner would detach it
    lab.host.detach(b.hostEnd);
    expect(lab.host.connectionCount).toBe(2);
    expect(lab.host.presence(playerId('device-b'))).toBe('connected');
  });

  it('B reconnects after the grace: a fresh actor, and A saw her leave and join', async () => {
    const lab = new Lab({ latencyMs: 50 }, { graceMs: 200 });
    const a = await lab.join('device-a', 'Ada', '#ff8800');
    const b = await lab.join('device-b', 'Bea', '#0088ff');
    await lab.run(100);
    const arrivingAtA = tap(a.transport);
    b.transport.disconnect();
    await lab.run(400);
    expect(lab.host.presence(playerId('device-b'))).toBe('absent');
    expect(arrivingAtA).toContain('leave');
    await lab.until(b.client.reconnect());
    expect(b.client.self()).toMatchObject({ id: 'capsule-3', color: '#0088ff' });
    await lab.run(100);
    expect(arrivingAtA).toContain('join');
    expect(a.client.remotes(lab.clock).map((x) => x.id)).toEqual(['capsule-3']);
  });

  it('a newer connection for a player already connected replaces the older one', async () => {
    const lab = new Lab({ latencyMs: 50 });
    const first = await lab.join('device-b', 'Bea', '#0088ff');
    const second = await lab.join('device-b', 'Bea', '#0088ff');
    await lab.run(200);
    expect(second.client.self()).toMatchObject({ id: 'capsule-1' });
    expect(first.client.state).toBe('disconnected');
    expect(first.hostEnd.state).toBe('closed');
    expect(lab.host.connectionCount).toBe(1);
    expect(lab.host.snapshot().actors).toHaveLength(1);
    expect(lab.host.presence(playerId('device-b'))).toBe('connected');
  });
});

describe('a bad wire', () => {
  it('200 ms latency and 40 ms jitter: a sprint of claims arrives in order and none is refused', async () => {
    const lab = new Lab({ latencyMs: 200, jitterMs: 40 });
    const a = await lab.join('device-a', 'Ada', '#ff8800');
    const b = await lab.join('device-b', 'Bea', '#0088ff');
    await lab.run(500);
    const final = await lab.walk(a.client, 100, 16, SPRINT);
    await lab.run(800);
    expect(lab.host.stats).toEqual({ claimsAccepted: 100, claimsRefused: 0 });
    expect(a.client.corrections).toBe(0);
    expect(lab.host.actorsOf(playerId('device-a'))[0]?.at.wz).toBeCloseTo(final.at.wz, 6);
    expect(remoteOf(b.client, actorId('capsule-1'), lab.clock)?.at.wz).toBeCloseTo(final.at.wz, 6);
  });

  it('a 30 % drop rate loses claims and snapshots, and the replica still converges on the truth', async () => {
    const lab = new Lab({ latencyMs: 30 });
    const a = await lab.join('device-a', 'Ada', '#ff8800');
    const b = await lab.join('device-b', 'Bea', '#0088ff');
    await lab.run(200);
    const aId = actorId('capsule-1');
    const snapshotsAtB: unknown[] = [];
    b.transport.onMessage((raw) => snapshotsAtB.push(raw));
    lab.conditions.dropRate = 0.3; // the dial both ends share, turned mid-session
    const claimed = await lab.walk(a.client, 40, 50, WALK);
    await lab.run(500);
    lab.conditions.dropRate = 0;
    await lab.run(300);

    const truth = lab.host.actorsOf(playerId('device-a'))[0];
    if (truth === undefined) throw new Error('A vanished from the world');
    // Claims were lost: the host applied fewer than forty. The travel budget accrues
    // on time, not on claims, so what did arrive was honest and accepted.
    expect(lab.host.stats.claimsAccepted).toBeLessThan(40);
    expect(lab.host.stats.claimsAccepted).toBeGreaterThan(20);
    expect(lab.host.stats.claimsRefused).toBe(0);
    expect(a.client.corrections).toBe(0);
    // Snapshots were lost too, and the ones that landed were enough.
    const rounds = (lab.clock - 200) / 50;
    expect(snapshotsAtB.length).toBeLessThan(rounds);
    expect(remoteOf(b.client, aId, lab.clock)?.at).toEqual(truth.at);
    expect(a.client.self()?.at).toEqual(truth.at);
    // The truth is where the last claim that arrived put it: on A's path, at or before A's own picture.
    expect(truth.at.wz).toBeLessThanOrEqual(claimed.at.wz + 1e-9);
    expect(truth.at.wz).toBeGreaterThan(claimed.at.wz * 0.7);
    expect(truth.at.wx).toBe(0);
  });
});

describe('the Authority interface in-process', () => {
  it('admit, claim and dismiss reach every client the same way a remote player would', async () => {
    const lab = new Lab();
    const a = await lab.join('device-a', 'Ada', '#ff8800');
    await lab.run(100);
    const arrivingAtA = tap(a.transport);
    const local: ActorState = {
      id: actorId('local-1'), kind: 'capsule', owner: playerId('device-host'), at: world(500, 500), height: 0, heading: 0,
      color: '#00ff00', name: 'Host',
    };
    lab.host.admit(local);
    expect(lab.host.presence(playerId('device-host'))).toBe('connected');
    await lab.run(50);
    expect(arrivingAtA).toContain('join');
    expect(remoteOf(a.client, local.id, lab.clock)).toMatchObject({ at: { wx: 500, wz: 500 }, color: '#00ff00' });

    lab.host.claim({ kind: 'move', actorId: local.id, at: world(500, 502), height: 0, heading: 1, seq: 0 });
    lab.host.claim({ kind: 'move', actorId: local.id, at: world(500, 5000), height: 0, heading: 1, seq: 1 });
    lab.host.claim({ kind: 'move', actorId: local.id, at: world(500, 503), height: 0, heading: 1, seq: 1 }); // stale
    expect(lab.host.stats).toEqual({ claimsAccepted: 1, claimsRefused: 1 });
    expect(lab.host.snapshot().actors.find((x) => x.id === local.id)).toMatchObject({ at: { wx: 500, wz: 502 }, heading: 1 });
    await lab.run(300);
    expect(remoteOf(a.client, local.id, lab.clock)?.at).toEqual({ wx: 500, wz: 502 });

    // An in-process player never lingers: no link, nothing to lose.
    await lab.run(HOST_DEFAULTS.graceMs + 1000, 100);
    expect(lab.host.presence(playerId('device-host'))).toBe('connected');

    lab.host.dismiss(playerId('device-host'));
    await lab.run(50);
    expect(arrivingAtA).toContain('leave');
    expect(a.client.remotes(lab.clock)).toEqual([]);
    expect(lab.host.presence(playerId('device-host'))).toBe('absent');
    // snapshot() hands out fresh values: reaching in changes nothing.
    const copy = lab.host.snapshot().actors[0];
    if (copy === undefined) throw new Error('A vanished from the world');
    (copy as { name: string }).name = 'Changed';
    expect(lab.host.snapshot().actors[0]?.name).toBe('Ada');
  });
});
