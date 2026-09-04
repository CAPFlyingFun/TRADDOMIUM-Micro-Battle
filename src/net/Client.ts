/**
 * ONE PLAYER'S END of the authority boundary.
 *
 * It says `hello` and waits for `welcome`; it sends the local actor's
 * pose as numbered CLAIMS; it keeps a `Replica` of what the authority
 * says the world is, and beside it the authority's latest word on the
 * player's own actor. That word is the truth; the claim is only what
 * was asked for. When a snapshot acknowledges a claim (`ackSeq`) and
 * the truth disagrees with what was claimed, the authority refused it —
 * a teleport, a fast clock, a step off the island — and the client
 * counts a correction and tells whoever is listening where it really
 * is. Nothing here snaps a local actor back; that is the session's
 * business when the player shell arrives (Phase 7). This module only
 * makes the refusal visible and honest.
 *
 * A dropped link does not end the player. `reconnect()` says hello again
 * with the SAME PlayerId, and the authority hands back the same actor if
 * it has not yet given up on it. The claim sequence restarts with every
 * hello, since the authority reads it per connection.
 *
 * Pure: no socket, no timer. The moment a message arrives is read
 * through `now`, the same clock the replica is read with.
 */
import type { ActorId } from '../actor/ActorId';
import { actorStateFrom, type ActorState } from '../actor/ActorState';
import type { PlayerId } from '../actor/PlayerId';
import { wrapHeading } from '../actor/Transform';
import { world, type WorldPoint } from '../world/coords';
import {
  isMessage, snapshotFrom, type HelloMessage, type MoveMessage, type Snapshot, type WelcomeMessage,
} from './protocol';
import { Replica, type ReplicaOptions } from './Replica';
import type { Transport } from './Transport';

export type ClientState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'left';

/** What a claim carries: where the actor is, how high, which way. An ActorState fits. */
export interface MovePose {
  readonly at: WorldPoint;
  readonly height: number;
  readonly heading: number;
}

export type CorrectionHandler = (truth: ActorState) => void;

/**
 * Closer than this and a claim and the truth are the same place: a
 * hundredth of a millimetre, far below anything a step or a serialiser
 * can move a number by, far above float noise.
 */
export const CORRECTION_EPSILON = 1e-3;

function agrees(claim: MovePose, truth: ActorState): boolean {
  return (
    Math.abs(claim.at.wx - truth.at.wx) <= CORRECTION_EPSILON &&
    Math.abs(claim.at.wz - truth.at.wz) <= CORRECTION_EPSILON &&
    Math.abs(claim.height - truth.height) <= CORRECTION_EPSILON &&
    Math.abs(wrapHeading(claim.heading - truth.heading)) <= CORRECTION_EPSILON
  );
}

interface Pending {
  readonly resolve: (welcome: WelcomeMessage) => void;
  readonly reject: (reason: Error) => void;
}

export class Client {
  readonly replica: Replica;
  private transport: Transport | null = null;
  private off: (() => void) | null = null;
  private hello: HelloMessage | null = null;
  private current: ClientState = 'idle';
  private me: PlayerId | null = null;
  /** The authority's latest word on the player's own actor. */
  private truth: ActorState | null = null;
  private nextSeq = 0;
  /** Claims the authority has not yet acknowledged, by seq. */
  private readonly claims = new Map<number, MovePose>();
  private pending: Pending | null = null;
  private correctionCount = 0;
  private readonly correctionHandlers = new Set<CorrectionHandler>();

  constructor(
    private readonly now: () => number,
    options: ReplicaOptions = {},
  ) {
    this.replica = new Replica(options);
  }

  get state(): ClientState {
    return this.current;
  }

  /** The id the authority knows this player by; null before the first welcome. */
  get playerId(): PlayerId | null {
    return this.me;
  }

  get actorId(): ActorId | null {
    return this.truth?.id ?? null;
  }

  get corrections(): number {
    return this.correctionCount;
  }

  /** The authority's latest word on the player's own actor, uninterpolated; null before welcome. */
  self(): ActorState | null {
    return this.truth === null ? null : actorStateFrom(this.truth);
  }

  /** Everyone but the player's own actor, read smoothly. */
  remotes(nowMs: number): ActorState[] {
    const mine = this.truth?.id ?? null;
    return this.replica.states(nowMs).filter((actor) => actor.id !== mine);
  }

  onCorrection(cb: CorrectionHandler): () => void {
    this.correctionHandlers.add(cb);
    return () => {
      this.correctionHandlers.delete(cb);
    };
  }

  /** Open the transport, say hello, and resolve with the welcome. Rejects if the link closes first. */
  connect(transport: Transport, hello: HelloMessage): Promise<WelcomeMessage> {
    if (this.current === 'connecting' || this.current === 'connected') {
      throw new Error(`Client: connect while ${this.current}`);
    }
    this.hello = hello;
    this.listen(transport);
    return this.open();
  }

  /**
   * Say hello again with the same PlayerId — on a new transport when the
   * old one cannot be reopened (a socket), on the same one when it can
   * (the loopback). Resolves with the welcome, which names the actor the
   * authority handed back.
   */
  reconnect(transport: Transport | null = this.transport): Promise<WelcomeMessage> {
    if (this.hello === null || transport === null) throw new Error('Client: reconnect before connect');
    if (this.current === 'connecting' || this.current === 'connected') {
      throw new Error(`Client: reconnect while ${this.current}`);
    }
    if (transport !== this.transport) this.listen(transport);
    return this.open();
  }

  /**
   * Claim a pose. Returns the seq it went out under. `seq` defaults to
   * the next in sequence and may only run forward; the authority ignores
   * anything at or below what it has already seen.
   */
  sendMove(pose: MovePose, seq: number = this.nextSeq): number {
    const transport = this.transport;
    const truth = this.truth;
    if (this.current !== 'connected' || transport === null || truth === null) {
      throw new Error(`Client: move while ${this.current}`);
    }
    if (!Number.isInteger(seq) || seq < this.nextSeq) throw new Error(`Client: seq ${seq} is not after ${this.nextSeq - 1}`);
    const claim: MovePose = { at: world(pose.at.wx, pose.at.wz), height: pose.height, heading: wrapHeading(pose.heading) };
    const move: MoveMessage = { kind: 'move', actorId: truth.id, at: claim.at, height: claim.height, heading: claim.heading, seq };
    this.claims.set(seq, claim);
    this.nextSeq = seq + 1;
    transport.send(move);
    return seq;
  }

  /** A clean goodbye: `bye`, then hang up. The replica keeps its last picture; a reconnect replaces it. */
  leave(): void {
    const transport = this.transport;
    if (this.current === 'connected' && transport !== null && transport.state === 'open' && this.me !== null) {
      transport.send({ kind: 'bye', playerId: this.me });
    }
    this.settle('left', new Error('Client: left before welcome'));
    transport?.disconnect();
  }

  private async open(): Promise<WelcomeMessage> {
    const transport = this.transport;
    const hello = this.hello;
    if (transport === null || hello === null) throw new Error('Client: open without a transport');
    this.current = 'connecting';
    this.claims.clear();
    this.nextSeq = 0;
    try {
      await transport.connect();
    } catch (error) {
      // A HANDSHAKE THAT NEVER OPENED IS NOT A CONNECTING CLIENT.
      // Leaving `connecting` set here stranded the client for good: every
      // later connect() and reconnect() refuses with "while connecting",
      // so a player who opened the game while the relay was unreachable
      // could never try again without reloading. A failed open settles to
      // `disconnected`, which is the state reconnect() accepts.
      this.current = 'disconnected';
      throw error;
    }
    if (this.current !== 'connecting') throw new Error(`Client: link closed while connecting`);
    const welcome = new Promise<WelcomeMessage>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
    transport.send(hello);
    return welcome;
  }

  private listen(transport: Transport): void {
    this.off?.();
    this.transport = transport;
    const offMessage = transport.onMessage((raw) => this.receive(raw));
    const offClose = transport.onClose(() => this.closed());
    this.off = () => {
      offMessage();
      offClose();
    };
  }

  /** The link is gone under us. What the replica holds stays, stale and honestly so. */
  private closed(): void {
    if (this.current === 'left' || this.current === 'disconnected' || this.current === 'idle') return;
    this.settle('disconnected', new Error('Client: link closed before welcome'));
  }

  private settle(next: ClientState, reason: Error): void {
    this.current = next;
    const pending = this.pending;
    this.pending = null;
    pending?.reject(reason);
  }

  private receive(raw: unknown): void {
    if (!isMessage(raw)) return;
    switch (raw.kind) {
      case 'welcome':
        this.onWelcome(raw);
        return;
      case 'join':
        if (this.current === 'connected') this.replica.join(actorStateFrom(raw.actor), this.now());
        return;
      case 'leave':
        if (this.current === 'connected') this.replica.leave(raw.playerId);
        return;
      case 'snapshot': {
        if (this.current !== 'connected') return;
        const snapshot = snapshotFrom(raw.snapshot);
        this.replica.apply(snapshot, this.now());
        this.reconcile(snapshot, raw.ackSeq);
        return;
      }
      default:
        return; // a client's own kinds have no business arriving here
    }
  }

  private onWelcome(welcome: WelcomeMessage): void {
    const pending = this.pending;
    if (this.current !== 'connecting' || pending === null) return;
    const snapshot = snapshotFrom(welcome.snapshot);
    const mine = snapshot.actors.find((actor) => actor.owner === welcome.yourId);
    if (mine === undefined) {
      this.settle('disconnected', new Error('Client: welcome named no actor of mine'));
      return;
    }
    this.pending = null;
    this.current = 'connected';
    this.me = welcome.yourId;
    this.truth = mine;
    this.replica.clear();
    this.replica.apply(snapshot, this.now());
    pending.resolve({ kind: 'welcome', yourId: welcome.yourId, snapshot });
  }

  /** The truth for our actor replaces what we held; an acknowledged claim that disagrees with it was refused. */
  private reconcile(snapshot: Snapshot, ackSeq: number | undefined): void {
    const held = this.truth;
    if (held === null) return;
    const truth = snapshot.actors.find((actor) => actor.id === held.id);
    if (truth === undefined) return;
    this.truth = truth;
    if (ackSeq === undefined) return;
    const claim = this.claims.get(ackSeq);
    for (const seq of [...this.claims.keys()]) {
      if (seq <= ackSeq) this.claims.delete(seq);
    }
    if (claim === undefined || agrees(claim, truth)) return;
    this.correctionCount += 1;
    for (const cb of [...this.correctionHandlers]) cb(actorStateFrom(truth));
  }
}
