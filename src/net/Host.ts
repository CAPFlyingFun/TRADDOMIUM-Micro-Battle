/**
 * THE HOST AUTHORITY (protocol.ts, ARCHITECTURE §5): the one party in a
 * multiplayer session that owns the truth of where every actor is.
 *
 * It holds the actor table and nothing else does. Clients arrive with
 * `hello` and get a `welcome` holding the whole world while everyone
 * else gets a `join`; they send `move` CLAIMS, which are applied only
 * when plausible; they go with `bye` or by hanging up, and the rest hear
 * `leave`. Twenty times a second the truth goes out as a `snapshot`.
 *
 * THE AUTHORITY BOUNDARY IS A TRAVEL BUDGET, NOT A PER-MESSAGE SPEED.
 * Claims arrive bunched — jitter can land two frames' worth in the same
 * millisecond — so "distance ÷ time since the last claim" would refuse
 * honest movement. Instead each actor earns travel at its top speed
 * (with a tolerance for rounding and clock disagreement) for every
 * millisecond of host time, banks at most a quarter second of it, and
 * spends it on each claim. A walk never runs dry; a teleport is refused
 * at once; a fast-forwarded clock buys nothing, because the budget
 * accrues on the HOST's clock. A refused claim is answered with a
 * one-actor snapshot carrying `ackSeq`, so the client learns which
 * claim was refused and where it really is.
 *
 * IDENTITY SURVIVES A DROPPED LINK. A player who hangs up keeps their
 * actor for `graceMs`: a phone switching apps or losing signal for a
 * moment finds its capsule where it left it, and nobody else saw a
 * `leave` and a `join`. A `hello` bearing a known PlayerId re-attaches
 * to that actor — same id, same colour, same name, whatever the new
 * hello says about looks — and a newer connection for a player already
 * connected replaces the older one, since the older is the one that has
 * usually died without saying so. Past the grace the actor is dropped
 * and `leave` goes out; a later hello starts a fresh actor.
 *
 * Pure: no socket, no timer, no `Date`. The moment a message arrives is
 * read through `now`; the moment the host acts is `tick(nowMs)`; both
 * must be the same clock.
 */
import { actorId, type ActorId } from '../actor/ActorId';
import { actorStateFrom, isActorState, type ActorState } from '../actor/ActorState';
import { DEBUG_CAPSULE_TUNING, type CapsuleTuning } from '../actor/CapsuleTuning';
import type { PlayerId } from '../actor/PlayerId';
import { wrapHeading } from '../actor/Transform';
import { world, type WorldPoint } from '../world/coords';
import {
  isMessage, moveFrom, type Authority, type AuthorityMessage, type ByeMessage, type HelloMessage, type MoveMessage,
  type Snapshot, type SnapshotMessage,
} from './protocol';
import type { Transport } from './Transport';

export interface HostOptions {
  /** Snapshots per second to every connected client. */
  readonly snapshotHz: number;
  /** How long a hung-up player's actor lingers before it is dropped. */
  readonly graceMs: number;
  /** Multiplies top speed when earning travel budget: slack for rounding and clock disagreement. */
  readonly tolerance: number;
  /** How much travel, in milliseconds at top speed, an actor may bank. Absorbs claims bunched by jitter. */
  readonly burstMs: number;
  /** Where top speed comes from. */
  readonly tuning: CapsuleTuning;
  /** Where the n-th actor ever spawned appears. */
  readonly spawn: (index: number) => WorldPoint;
  /** The n-th actor's id. */
  readonly mintActorId: (index: number) => ActorId;
}

/** GAME TUNING (debug): new capsules stand a metre apart along +wx so two never spawn inside each other. */
export const SPAWN_SPACING = 100;

/**
 * GAME TUNING. 20 Hz is the rate the 100 ms interpolation buffer is
 * derived from (Replica.ts). Ten seconds of grace covers a tab relaunch
 * without leaving a ghost standing for a minute. A quarter second of
 * banked travel absorbs jitter up to 250 ms; 25 % on speed absorbs the
 * rest of the arithmetic.
 */
export const HOST_DEFAULTS: HostOptions = Object.freeze({
  snapshotHz: 20,
  graceMs: 10_000,
  tolerance: 1.25,
  burstMs: 250,
  tuning: DEBUG_CAPSULE_TUNING,
  spawn: (index: number): WorldPoint => world(index * SPAWN_SPACING, 0),
  mintActorId: (index: number): ActorId => actorId(`capsule-${index + 1}`),
});

/** Whether a player is here, hung up but not yet dropped, or unknown. */
export type Presence = 'connected' | 'lingering' | 'absent';

export interface HostStats {
  claimsAccepted: number;
  claimsRefused: number;
}

interface Connection {
  readonly transport: Transport;
  player: PlayerRecord | null;
  off: () => void;
}

interface PlayerRecord {
  readonly id: PlayerId;
  connection: Connection | null;
  /** Host time the link was lost; null while connected, and always null for an in-process player. */
  disconnectedAt: number | null;
  /** The newest claim seen on the current connection; −1 until one arrives. A hello restarts it. */
  lastSeq: number;
  /** Admitted by the session on this machine: no link to lose, never lingers. */
  readonly local: boolean;
}

interface ActorRecord {
  state: ActorState;
  /** World units this actor may still travel before a claim is a teleport. */
  budget: number;
  /** Host time of the last claim, accepted or not: the budget accrues from here. */
  lastClaimAt: number;
}

export class Host implements Authority {
  readonly stats: HostStats = { claimsAccepted: 0, claimsRefused: 0 };
  private readonly options: HostOptions;
  private readonly connections = new Set<Connection>();
  private readonly players = new Map<PlayerId, PlayerRecord>();
  private readonly actors = new Map<ActorId, ActorRecord>();
  private tick_ = 0;
  private minted = 0;
  private lastSnapshotAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly now: () => number,
    options: Partial<HostOptions> = {},
  ) {
    this.options = { ...HOST_DEFAULTS, ...options };
  }

  /** Top speed with tolerance, world units per millisecond. */
  private get earnRate(): number {
    const { tuning, tolerance } = this.options;
    return (tuning.walkSpeed * tuning.sprintFactor * tolerance) / 1000;
  }

  /** The most travel an actor can bank. */
  private get budgetCap(): number {
    return this.earnRate * this.options.burstMs;
  }

  // ---------------------------------------------------------------------------
  // Connections
  // ---------------------------------------------------------------------------

  /**
   * Take a connection on. The transport is opened if it is not already;
   * a server-side end is normally open the moment it is handed over.
   * The host listens on it until `detach` or until it is replaced by a
   * newer connection for the same player.
   */
  async attach(transport: Transport): Promise<void> {
    await transport.connect();
    const conn: Connection = { transport, player: null, off: () => {} };
    const offMessage = transport.onMessage((raw) => this.receive(conn, raw));
    const offClose = transport.onClose(() => this.hungUp(conn));
    conn.off = () => {
      offMessage();
      offClose();
    };
    this.connections.add(conn);
  }

  /** The socket's owner says this connection is finished. Its player, if any, lingers. */
  detach(transport: Transport): void {
    for (const conn of this.connections) {
      if (conn.transport !== transport) continue;
      this.hungUp(conn);
      this.close(conn);
      return;
    }
  }

  /** How many connections the host is listening on. */
  get connectionCount(): number {
    return this.connections.size;
  }

  presence(playerId: PlayerId): Presence {
    const player = this.players.get(playerId);
    if (player === undefined) return 'absent';
    return player.disconnectedAt === null ? 'connected' : 'lingering';
  }

  /** Every actor a player owns, as fresh values. */
  actorsOf(playerId: PlayerId): ActorState[] {
    const out: ActorState[] = [];
    for (const record of this.actors.values()) {
      if (record.state.owner === playerId) out.push(actorStateFrom(record.state));
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Authority
  // ---------------------------------------------------------------------------

  /** An in-process claim: the session on this machine speaks for the actor's owner. No correction goes out; read `snapshot()`. */
  claim(move: MoveMessage): void {
    const record = this.actors.get(move.actorId);
    if (record === undefined) return;
    const player = this.players.get(record.state.owner);
    if (player === undefined || move.seq <= player.lastSeq) return;
    player.lastSeq = move.seq;
    this.applyClaim(record, moveFrom(move), this.now());
  }

  admit(actor: ActorState): void {
    const state = actorStateFrom(actor);
    if (!this.players.has(state.owner)) {
      this.players.set(state.owner, { id: state.owner, connection: null, disconnectedAt: null, lastSeq: -1, local: true });
    }
    this.actors.set(state.id, { state, budget: this.budgetCap, lastClaimAt: this.now() });
    this.broadcast({ kind: 'join', actor: state }, null);
  }

  dismiss(player: PlayerId): void {
    const record = this.players.get(player);
    if (record !== undefined) this.remove(record);
  }

  snapshot(): Snapshot {
    return { tick: this.tick_, actors: this.allActors() };
  }

  // ---------------------------------------------------------------------------
  // Time
  // ---------------------------------------------------------------------------

  /**
   * Drop what has lingered past its grace, then send a snapshot round if
   * one is due. One round per call at most: a stalled host does not
   * catch up with a burst.
   */
  tick(nowMs: number): void {
    for (const player of [...this.players.values()]) {
      if (player.disconnectedAt !== null && nowMs - player.disconnectedAt >= this.options.graceMs) this.remove(player);
    }
    if (nowMs - this.lastSnapshotAt < 1000 / this.options.snapshotHz) return;
    this.lastSnapshotAt = nowMs;
    const actors = this.allActors();
    const tick = this.nextTick();
    for (const conn of this.connections) {
      if (conn.player === null) continue;
      this.send(conn, this.snapshotMessage(tick, actors, conn.player.lastSeq));
    }
  }

  // ---------------------------------------------------------------------------
  // Inbound
  // ---------------------------------------------------------------------------

  private receive(conn: Connection, raw: unknown): void {
    if (!isMessage(raw)) return;
    switch (raw.kind) {
      case 'hello':
        this.onHello(conn, raw);
        return;
      case 'move':
        this.onMove(conn, moveFrom(raw));
        return;
      case 'bye':
        this.onBye(conn, raw);
        return;
      default:
        return; // an authority's own kinds have no business arriving here
    }
  }

  private onHello(conn: Connection, hello: HelloMessage): void {
    // A connection speaks for one player; a second hello with another name is noise.
    if (conn.player !== null && conn.player.id !== hello.playerId) return;
    const now = this.now();
    let player = this.players.get(hello.playerId);
    if (player === undefined) {
      player = { id: hello.playerId, connection: null, disconnectedAt: null, lastSeq: -1, local: false };
      this.players.set(player.id, player);
    }
    if (player.connection !== null && player.connection !== conn) this.close(player.connection);
    player.connection = conn;
    player.disconnectedAt = null;
    player.lastSeq = -1;
    conn.player = player;

    const owned = this.actorsOf(player.id);
    if (owned.length === 0) {
      const state = this.spawn(hello);
      this.actors.set(state.id, { state, budget: this.budgetCap, lastClaimAt: now });
      this.send(conn, { kind: 'welcome', yourId: player.id, snapshot: { tick: this.nextTick(), actors: this.allActors() } });
      this.broadcast({ kind: 'join', actor: state }, conn);
      return;
    }
    // Re-attaching: the actor stands where it stood; the new link starts with a full budget.
    for (const record of this.actors.values()) {
      if (record.state.owner !== player.id) continue;
      record.budget = this.budgetCap;
      record.lastClaimAt = now;
    }
    this.send(conn, { kind: 'welcome', yourId: player.id, snapshot: { tick: this.nextTick(), actors: this.allActors() } });
  }

  private onMove(conn: Connection, move: MoveMessage): void {
    const player = conn.player;
    if (player === null) return; // no hello yet: nobody to speak for
    if (move.seq <= player.lastSeq) return; // late or repeated
    player.lastSeq = move.seq;
    const record = this.actors.get(move.actorId);
    if (record === undefined || record.state.owner !== player.id) {
      this.stats.claimsRefused += 1; // not yours to move; nothing of yours to correct
      return;
    }
    if (this.applyClaim(record, move, this.now())) return;
    this.send(conn, this.snapshotMessage(this.nextTick(), [actorStateFrom(record.state)], move.seq));
  }

  private onBye(conn: Connection, bye: ByeMessage): void {
    const player = conn.player;
    if (player === null || player.id !== bye.playerId) return;
    this.remove(player);
  }

  /**
   * The far end is gone. The player lingers; the connection stays
   * attached, because a transport that can come back (the loopback) may
   * carry the same player's next hello, and one that cannot simply never
   * speaks again until its owner calls `detach`.
   */
  private hungUp(conn: Connection): void {
    const player = conn.player;
    if (player === null) return;
    conn.player = null;
    if (player.connection !== conn) return;
    player.connection = null;
    player.disconnectedAt = this.now();
  }

  // ---------------------------------------------------------------------------
  // The boundary
  // ---------------------------------------------------------------------------

  /** Earn, then spend. True when the claim became the truth. */
  private applyClaim(record: ActorRecord, move: MoveMessage, nowMs: number): boolean {
    const elapsed = Math.max(0, nowMs - record.lastClaimAt);
    record.lastClaimAt = nowMs;
    record.budget = Math.min(this.budgetCap, record.budget + this.earnRate * elapsed);
    const from = record.state;
    const travelled = Math.hypot(move.at.wx - from.at.wx, move.at.wz - from.at.wz, move.height - from.height);
    const next: ActorState = {
      ...from,
      at: world(move.at.wx, move.at.wz),
      height: move.height,
      heading: wrapHeading(move.heading),
    };
    if (travelled > record.budget || !isActorState(next)) {
      this.stats.claimsRefused += 1;
      return false;
    }
    record.budget -= travelled;
    record.state = next;
    this.stats.claimsAccepted += 1;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Table
  // ---------------------------------------------------------------------------

  private spawn(hello: HelloMessage): ActorState {
    const index = this.minted;
    this.minted += 1;
    return {
      id: this.options.mintActorId(index),
      kind: 'capsule',
      owner: hello.playerId,
      at: this.options.spawn(index),
      height: 0,
      heading: 0,
      color: hello.color,
      name: hello.name,
    };
  }

  /** Every actor the player owns goes, everyone else hears it, and the player is forgotten. */
  private remove(player: PlayerRecord): void {
    let gone = 0;
    for (const [id, record] of this.actors) {
      if (record.state.owner !== player.id) continue;
      this.actors.delete(id);
      gone += 1;
    }
    if (gone > 0) this.broadcast({ kind: 'leave', playerId: player.id }, player.connection);
    if (player.connection !== null) this.close(player.connection);
    this.players.delete(player.id);
  }

  /** Stop listening and hang up. Any player still on it is detached first by the caller. */
  private close(conn: Connection): void {
    conn.off();
    this.connections.delete(conn);
    if (conn.player !== null && conn.player.connection === conn) conn.player.connection = null;
    conn.player = null;
    conn.transport.disconnect();
  }

  private allActors(): ActorState[] {
    const out: ActorState[] = [];
    for (const record of this.actors.values()) out.push(actorStateFrom(record.state));
    return out;
  }

  private nextTick(): number {
    this.tick_ += 1;
    return this.tick_;
  }

  private snapshotMessage(tick: number, actors: ActorState[], lastSeq: number): SnapshotMessage {
    const snapshot: Snapshot = { tick, actors };
    return lastSeq >= 0 ? { kind: 'snapshot', snapshot, ackSeq: lastSeq } : { kind: 'snapshot', snapshot };
  }

  // ---------------------------------------------------------------------------
  // Outbound
  // ---------------------------------------------------------------------------

  /** Only an open end can carry it; a closed one has already been told goodbye. */
  private send(conn: Connection, msg: AuthorityMessage): void {
    if (conn.transport.state === 'open') conn.transport.send(msg);
  }

  /** To every connection that has said hello, except one. */
  private broadcast(msg: AuthorityMessage, except: Connection | null): void {
    for (const conn of this.connections) {
      if (conn === except || conn.player === null) continue;
      this.send(conn, msg);
    }
  }
}
