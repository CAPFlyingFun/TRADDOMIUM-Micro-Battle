/**
 * WHAT CROSSES THE WIRE between a client and the authority.
 *
 * Plain data only: every message survives JSON and carries its `kind`,
 * so `Transport.send(unknown)` on one end and `isMessage()` on the other
 * are the whole of the framing. The shapes are fixed here; the
 * behaviour (`Host`, `Client`, `Replica`) is a leaf's job and is written
 * against these types.
 *
 * THE AUTHORITY BOUNDARY. One party owns the truth of where every actor
 * is — the `Authority` — and everyone else holds a replica of it:
 *
 *   client → authority   hello · move · bye
 *   authority → clients  welcome · join · leave · snapshot
 *
 * A `move` is a CLAIM, not a fact. The client says "my actor is here
 * now, this is my `seq`-th claim"; the authority applies it if it is
 * plausible and answers with the truth in the next `snapshot`, which
 * may put the actor somewhere else. That is how a teleport, a
 * fast-forwarded clock or a malformed position is refused without a
 * separate rejection message: the client reconciles to the snapshot,
 * and its own `seq` tells it which of its claims the authority has
 * seen. Every position in every message is a WorldPoint (coords.ts, THE
 * RULE): a LocalPoint means nothing to another machine.
 *
 * Two authorities hide behind one interface, so gameplay never learns
 * which it has (ARCHITECTURE §5):
 *
 *   LocalAuthority  solo. Applies moves directly; the snapshot is the
 *                   local state. No transport at all.
 *   HostAuthority   multiplayer. Validates each claim (bounded step
 *                   from the last accepted position, finite numbers, the
 *                   claimant owns the actor), applies it, and
 *                   rebroadcasts the result to every client at its own
 *                   tick rate.
 *
 * Pure: no DOM, no socket. Guards read untrusted input and reject on
 * the first field that is wrong.
 */
import { isActorId, type ActorId } from '../actor/ActorId';
import {
  HEX_COLOR, MAX_ACTOR_NAME, actorStateFrom, isActorState, isWorldPointLike, type ActorState,
} from '../actor/ActorState';
import { isPlayerId, type PlayerId } from '../actor/PlayerId';
import { world, type WorldPoint } from '../world/coords';

/** The authority's frame counter: monotonic, so a late snapshot is recognised and dropped. */
export interface Snapshot {
  readonly tick: number;
  readonly actors: readonly ActorState[];
}

/** First thing a client says: who it is, and how its capsule should look. */
export interface HelloMessage {
  readonly kind: 'hello';
  readonly playerId: PlayerId;
  readonly name: string;
  readonly color: string;
}

/** The authority's answer: the id it knows the client by, and the world as it stands. */
export interface WelcomeMessage {
  readonly kind: 'welcome';
  readonly yourId: PlayerId;
  readonly snapshot: Snapshot;
}

/** An actor has entered — the authority announces it, with the whole state so no client has to ask. */
export interface JoinMessage {
  readonly kind: 'join';
  readonly actor: ActorState;
}

/** A player has gone; every actor they owned goes with them. */
export interface LeaveMessage {
  readonly kind: 'leave';
  readonly playerId: PlayerId;
}

/**
 * A movement claim. `seq` increases by one per claim from the same
 * client and never repeats, so the authority can ignore a claim that
 * arrives after a newer one and the client can tell which claims the
 * snapshot already reflects.
 */
export interface MoveMessage {
  readonly kind: 'move';
  readonly actorId: ActorId;
  readonly at: WorldPoint;
  readonly height: number;
  readonly heading: number;
  readonly seq: number;
}

/** The truth, on the authority's clock. Replaces, never patches, what a client holds. */
export interface SnapshotMessage {
  readonly kind: 'snapshot';
  readonly snapshot: Snapshot;
}

/** A clean goodbye, so the authority need not wait for a timeout to say `leave`. */
export interface ByeMessage {
  readonly kind: 'bye';
  readonly playerId: PlayerId;
}

export type ClientMessage = HelloMessage | MoveMessage | ByeMessage;
export type AuthorityMessage = WelcomeMessage | JoinMessage | LeaveMessage | SnapshotMessage;
export type Message = ClientMessage | AuthorityMessage;
export type MessageKind = Message['kind'];

export const MESSAGE_KINDS: readonly MessageKind[] = ['hello', 'welcome', 'join', 'leave', 'move', 'snapshot', 'bye'];

/**
 * The seam both session kinds hide behind. A leaf implements it twice
 * (see the module comment); the session holds one and never asks which.
 */
export interface Authority {
  /** Offer a claim. The authority applies what it accepts; the next snapshot is the answer. */
  claim(move: MoveMessage): void;
  /** Add an actor to the world it owns. */
  admit(actor: ActorState): void;
  /** Remove every actor a player owns. */
  dismiss(player: PlayerId): void;
  /** The truth as of now. A fresh value: callers may not reach in. */
  snapshot(): Snapshot;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ACTOR_NAME;
}

function isColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

/** A non-negative integer: `seq` and `tick` count, they do not measure. */
function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

export function isSnapshot(value: unknown): value is Snapshot {
  return isRecord(value) && isCount(value.tick) && Array.isArray(value.actors) && value.actors.every(isActorState);
}

export function isHello(value: unknown): value is HelloMessage {
  return isRecord(value) && value.kind === 'hello' && isPlayerId(value.playerId) && isName(value.name) && isColor(value.color);
}

export function isWelcome(value: unknown): value is WelcomeMessage {
  return isRecord(value) && value.kind === 'welcome' && isPlayerId(value.yourId) && isSnapshot(value.snapshot);
}

export function isJoin(value: unknown): value is JoinMessage {
  return isRecord(value) && value.kind === 'join' && isActorState(value.actor);
}

export function isLeave(value: unknown): value is LeaveMessage {
  return isRecord(value) && value.kind === 'leave' && isPlayerId(value.playerId);
}

export function isMove(value: unknown): value is MoveMessage {
  return (
    isRecord(value) &&
    value.kind === 'move' &&
    isActorId(value.actorId) &&
    isWorldPointLike(value.at) &&
    isFiniteNumber(value.height) &&
    value.height >= 0 &&
    isFiniteNumber(value.heading) &&
    isCount(value.seq)
  );
}

export function isSnapshotMessage(value: unknown): value is SnapshotMessage {
  return isRecord(value) && value.kind === 'snapshot' && isSnapshot(value.snapshot);
}

export function isBye(value: unknown): value is ByeMessage {
  return isRecord(value) && value.kind === 'bye' && isPlayerId(value.playerId);
}

/** Any message of the protocol, whichever direction. What every `Transport.onMessage` handler runs first. */
export function isMessage(value: unknown): value is Message {
  return (
    isHello(value) ||
    isWelcome(value) ||
    isJoin(value) ||
    isLeave(value) ||
    isMove(value) ||
    isSnapshotMessage(value) ||
    isBye(value)
  );
}

/**
 * A snapshot rebuilt from checked input, so nothing a peer sent rides
 * along unread and every position carries the WorldPoint brand honestly.
 */
export function snapshotFrom(checked: Snapshot): Snapshot {
  return { tick: checked.tick, actors: checked.actors.map(actorStateFrom) };
}

/** A move rebuilt from checked input, for the same reason. */
export function moveFrom(checked: MoveMessage): MoveMessage {
  return {
    kind: 'move',
    actorId: checked.actorId,
    at: world(checked.at.wx, checked.at.wz),
    height: checked.height,
    heading: checked.heading,
    seq: checked.seq,
  };
}
