/**
 * THE GLUE THAT MAKES A WORLD NETWORKED: one `Client`, its `Replica`,
 * and the cadence at which the local player's pose goes out as CLAIMS.
 *
 * A world scene should not know what a `hello` is. It knows three
 * things — where the local player is this frame, which other actors to
 * draw, and one honest line about the link — so this module holds
 * everything between those three and the wire (ARCHITECTURE §5). The
 * same object serves the Performance World today and whatever world
 * carries an ant later: nothing here is about capsules or cameras.
 *
 * WHY A CADENCE AND NOT EVERY FRAME. The authority answers on its own
 * clock — `HOST_DEFAULTS.snapshotHz`, 20 rounds a second — so a claim
 * sent at 60 Hz cannot be answered any sooner than one sent at 20 Hz.
 * It would simply be three times the uplink for the same truth, on a
 * phone, over a radio. So claims go out at the authority's own snapshot
 * rate and no faster, and a pose that has not changed says nothing at
 * all: a standing actor is already described by the last claim the
 * authority accepted (this is the Network Lab's rule too, and the two
 * ends must agree or the loopback stops predicting the relay).
 *
 * A MOVE IS A CLAIM (protocol.ts). What comes back may put the actor
 * somewhere else — a teleport, a fast clock, a step the travel budget
 * will not pay for. The `Client` reconciles and reports the refusal;
 * this module counts it, re-arms the claim latch so the next pose is
 * sent even if the caller has not moved, and hands the truth to the
 * owner through `onCorrection`. Who snaps to it — a simulated actor
 * should, an instrument camera should not — is the owner's decision,
 * not the network's.
 *
 * A DROPPED LINK IS NOT THE END OF THE WORLD. Every failure path here
 * ends in a status a HUD can read honestly, never in a throw that would
 * take the frame loop down with it: `connect()` does not reject, a
 * refused claim is a number, and a link that dies mid-session is
 * re-offered the same PlayerId on a bounded cadence so the authority
 * hands the same actor back inside its grace. What the status says is
 * measured, never assumed — `connected` means the client has been
 * welcomed on an open socket, and nothing more than that.
 *
 * CLOCKS. `now` is RAW wall-clock milliseconds (FrameClock's rule): a
 * network does not pause because a frame stalled, and a replica read on
 * a clamped clock would fall behind the wire it is reading.
 *
 * Pure: no three, no DOM, no socket and no timer of its own — it is
 * driven by `update()` from whatever loop owns the frame, and reaches
 * the wire only through the injected `Transport`.
 */
import type { ActorState } from '../actor/ActorState';
import type { PlayerId } from '../actor/PlayerId';
import { colorFor } from '../actor/playerColor';
import { world } from '../world/coords';
import { Client, type MovePose } from './Client';
import { HOST_DEFAULTS } from './Host';
import type { ReplicaOptions } from './Replica';
import type { Transport } from './Transport';
import { isSnapshotMessage, type HelloMessage } from './protocol';

/**
 * The client's own states plus the one it cannot express: an opening
 * handshake that never completed, because the relay refused, timed out
 * or is not there. A `Client` whose `connect()` rejects stays in
 * `connecting` for good, so saying `failed` here is the difference
 * between a HUD that keeps promising and a HUD that tells the truth.
 */
export type NetworkedWorldState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'left' | 'failed';

/** Who this player is on the wire. The colour is derived when it is not given, so every client agrees on it. */
export interface NetworkIdentity {
  readonly playerId: PlayerId;
  readonly name: string;
  /** `#rrggbb`. Defaults to `colorFor(playerId)`, which every machine computes identically. */
  readonly color?: string;
}

/** The small readonly truth a HUD may show. Everything in it is measured. */
export interface NetworkedWorldStatus {
  readonly state: NetworkedWorldState;
  /** OTHER players currently visible — the actors this world would draw. The local player is not counted. */
  readonly actorCount: number;
  /**
   * Milliseconds from a claim leaving to the snapshot that acknowledged
   * it. That is not a ping: an accepted claim waits up to one snapshot
   * period for the authority's next round, so this is an upper bound on
   * the wire's round trip. Absent until one claim has been acknowledged.
   */
  readonly roundTripMs?: number;
  /** Claims the authority answered with a different truth. Each one is a movement it would not allow. */
  readonly refusedClaims: number;
}

export interface NetworkedWorldOptions {
  /** The wire. Owned by whoever built it (the session); this module opens and closes it, never replaces it. */
  readonly transport: Transport;
  readonly identity: NetworkIdentity;
  /** RAW wall-clock milliseconds, monotonic. */
  readonly now: () => number;
  /** Claims per second. Defaults to `CLAIM_HZ`; see the module comment for why that is the authority's rate. */
  readonly claimHz?: number;
  readonly replica?: ReplicaOptions;
  /**
   * A claim was refused and this is where the authority says the local
   * actor really is. The owner decides what to do with it — a simulated
   * actor snaps to it; a free-fly instrument does not.
   */
  readonly onCorrection?: (truth: ActorState) => void;
  /** How often a dropped link is re-offered the same identity. Defaults to `REJOIN_MS`. */
  readonly rejoinMs?: number;
}

/**
 * GAME TUNING, derived rather than chosen: the authority's own snapshot
 * rate, read from the one place it is configured, so the two cannot
 * drift apart in a comment.
 */
export const CLAIM_HZ = HOST_DEFAULTS.snapshotHz;

/**
 * GAME TUNING. Two seconds between rejoin attempts: a lift or a tunnel
 * is covered without a visible gap, while a relay that is genuinely
 * down is asked five times a minute rather than sixty times a second.
 * The transport does its own exponential backoff underneath this, so a
 * long outage costs less than this number suggests.
 */
export const REJOIN_MS = 2_000;

/** Enough acknowledgements outstanding to cover a second of claims on a slow wire; a bound, not a rate. */
const MAX_UNACKED_CLAIMS = 64;

function samePose(a: MovePose, b: MovePose): boolean {
  return a.at.wx === b.at.wx && a.at.wz === b.at.wz && a.height === b.height && a.heading === b.heading;
}

export class NetworkedWorld {
  private readonly transport: Transport;
  private readonly client: Client;
  private readonly hello: HelloMessage;
  private readonly now: () => number;
  private readonly claimIntervalMs: number;
  private readonly rejoinMs: number;
  private readonly correctionHandler: ((truth: ActorState) => void) | undefined;

  /** Unsubscribes the round-trip listener; the client owns its own subscriptions. */
  private readonly offWire: () => void;

  /** When each unacknowledged claim went out, by seq: the only way to measure a round trip without a ping. */
  private readonly claimedAt = new Map<number, number>();
  private lastClaim: MovePose | null = null;
  private lastClaimAt = Number.NEGATIVE_INFINITY;
  private lastAttemptAt = Number.NEGATIVE_INFINITY;
  private roundTrip: number | null = null;
  /** A handshake is in flight: neither a second one nor a rejoin may start. */
  private opening = false;
  /** The last handshake failed. Cleared when the next one starts, so `connecting` is never a lie. */
  private linkFailed = false;
  /** `close()` was called: this end has left for good and nothing rejoins. */
  private done = false;

  constructor(options: NetworkedWorldOptions) {
    this.transport = options.transport;
    this.now = options.now;
    this.correctionHandler = options.onCorrection;
    const hz = options.claimHz ?? CLAIM_HZ;
    this.claimIntervalMs = Number.isFinite(hz) && hz > 0 ? 1000 / hz : 1000 / CLAIM_HZ;
    const rejoin = options.rejoinMs ?? REJOIN_MS;
    this.rejoinMs = Number.isFinite(rejoin) && rejoin >= 0 ? rejoin : REJOIN_MS;
    this.client = new Client(options.now, options.replica ?? {});
    this.hello = {
      kind: 'hello',
      playerId: options.identity.playerId,
      name: options.identity.name,
      color: options.identity.color ?? colorFor(options.identity.playerId),
    };
    this.client.onCorrection((truth) => {
      // The authority's word replaced the claim inside the client. Re-arm
      // the latch so the very next pose is claimed rather than skipped as
      // "unchanged", and let the owner decide whether to snap to it.
      this.lastClaim = null;
      this.correctionHandler?.(truth);
    });
    this.offWire = this.transport.onMessage((raw) => this.measure(raw));
  }

  /** The id the authority knows this player by; null until the first welcome. */
  get playerId(): PlayerId | null {
    return this.client.playerId;
  }

  get status(): NetworkedWorldStatus {
    const roundTripMs = this.roundTrip;
    return {
      state: this.state,
      actorCount: this.remoteActors().length,
      ...(roundTripMs === null ? {} : { roundTripMs }),
      refusedClaims: this.client.corrections,
    };
  }

  /**
   * Open the link and say hello. NEVER REJECTS: a world that cannot
   * reach its relay is still a world, and the reason it failed belongs
   * in the status where a HUD can say it, not in an exception that
   * would unwind whatever was entering the scene.
   */
  async connect(): Promise<void> {
    if (this.done || this.opening || this.client.state === 'connected') return;
    this.opening = true;
    this.linkFailed = false;
    this.lastAttemptAt = this.now();
    this.resetClaims();
    try {
      await this.client.connect(this.transport, this.hello);
    } catch {
      // The status now reads `failed`; the caller's world keeps running.
      this.linkFailed = true;
    } finally {
      this.opening = false;
    }
  }

  /**
   * One frame. `pose` is where the local player is NOW, in world
   * coordinates; null when the world has nothing to claim yet (before a
   * camera is placed, or for a spectator). Claims are rate-limited and
   * deduplicated here — see the module comment — and a link that is not
   * up simply has nothing sent down it.
   */
  update(pose: MovePose | null): void {
    const nowMs = this.now();
    this.rejoinIfDropped(nowMs);
    if (pose === null) return;
    if (this.client.state !== 'connected' || this.transport.state !== 'open') return;
    if (this.client.actorId === null) return;
    if (nowMs - this.lastClaimAt < this.claimIntervalMs) return;
    const claim: MovePose = { at: world(pose.at.wx, pose.at.wz), height: pose.height, heading: pose.heading };
    // A standing actor says nothing: the authority already holds this pose.
    if (this.lastClaim !== null && samePose(this.lastClaim, claim)) return;
    const seq = this.client.sendMove(claim);
    this.lastClaim = claim;
    this.lastClaimAt = nowMs;
    this.claimedAt.set(seq, nowMs);
    // A wire that never acknowledges must not grow this map without end.
    while (this.claimedAt.size > MAX_UNACKED_CLAIMS) {
      const oldest = this.claimedAt.keys().next();
      if (oldest.done === true) break;
      this.claimedAt.delete(oldest.value);
    }
  }

  /**
   * Every OTHER actor, read `Replica.interpolationMs` behind receipt so
   * a remote capsule glides between snapshots instead of stuttering
   * onto each one. Defaults to this world's own clock, which is the
   * clock the samples were stamped with.
   */
  remoteActors(nowMs: number = this.now()): ActorState[] {
    return this.client.remotes(nowMs);
  }

  /** The authority's latest word on the LOCAL player's actor; null before the first welcome. */
  localActor(): ActorState | null {
    return this.client.self();
  }

  /** A clean goodbye, and no rejoin after it. Safe to call twice, and safe on a link that is already gone. */
  close(): void {
    this.done = true;
    this.offWire();
    this.client.leave();
    this.transport.disconnect();
  }

  /** Measured, never assumed: `connected` is a welcomed client on an open socket. */
  private get state(): NetworkedWorldState {
    const client = this.client.state;
    // Leaving is deliberate and outranks everything: a handshake this end
    // cancelled on the way out is not a relay that could not be reached.
    if (this.done || client === 'left') return 'left';
    if (client === 'connected') return this.transport.state === 'open' ? 'connected' : 'disconnected';
    if (this.linkFailed) return 'failed';
    return client;
  }

  /**
   * The link opened once and then died. Say hello again with the SAME
   * PlayerId: inside the authority's grace it hands back the same actor,
   * and after it a fresh one — either way the player is playing again
   * without leaving the world.
   *
   * KNOWN LIMIT: a FIRST handshake that never completed cannot be
   * retried from here. `Client.connect()` leaves its state at
   * `connecting` when the transport rejects, and both `connect()` and
   * `reconnect()` refuse to run in that state, so there is no legal call
   * to make. The status says `failed` rather than pretending otherwise;
   * the fix belongs in `Client`.
   */
  private rejoinIfDropped(nowMs: number): void {
    if (this.done || this.opening) return;
    if (this.client.state !== 'disconnected') return;
    if (nowMs - this.lastAttemptAt < this.rejoinMs) return;
    this.opening = true;
    this.linkFailed = false;
    this.lastAttemptAt = nowMs;
    this.resetClaims();
    void (async (): Promise<void> => {
      try {
        await this.client.reconnect(this.transport);
      } catch {
        this.linkFailed = true;
      } finally {
        this.opening = false;
      }
    })();
  }

  /**
   * A snapshot addressed to us names the newest claim it reflects. The
   * gap between that claim leaving and this message landing is the only
   * round trip this protocol can measure without adding a ping to it.
   */
  private measure(raw: unknown): void {
    if (!isSnapshotMessage(raw)) return;
    const ack = raw.ackSeq;
    if (ack === undefined) return;
    const sentAt = this.claimedAt.get(ack);
    for (const seq of [...this.claimedAt.keys()]) {
      if (seq <= ack) this.claimedAt.delete(seq);
    }
    if (sentAt === undefined) return;
    this.roundTrip = Math.max(0, this.now() - sentAt);
  }

  /** Every hello restarts the claim sequence at the authority, so nothing outstanding means anything any more. */
  private resetClaims(): void {
    this.claimedAt.clear();
    this.lastClaim = null;
    this.lastClaimAt = Number.NEGATIVE_INFINITY;
  }
}
