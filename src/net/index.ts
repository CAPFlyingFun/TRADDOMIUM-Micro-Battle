/**
 * The network module's public surface. Sessions, the world and the
 * Network Lab import from here; nothing outside `net/` reaches into a
 * file by name.
 *
 * ONE DOCUMENTED EXCEPTION: `src/ui/RoomCodeScene.ts` imports
 * `./relayConfig` by file name. The room screen needs the room-code RULE
 * and nothing else, and a menu screen that imported this barrel would
 * drag `Host`, `Client`, `Replica` and `WebSocketTransport` into
 * whatever chunk the front door ends up in for the sake of one regular
 * expression. The rule is re-exported below all the same, so everything
 * that already holds the barrel — the wiring, the sessions, the tests —
 * keeps asking one place what a room code is.
 */
export { Client, CORRECTION_EPSILON, type ClientState, type CorrectionHandler, type MovePose } from './Client';
export { HOST_DEFAULTS, Host, SPAWN_SPACING, type HostOptions, type HostStats, type Presence } from './Host';
export { LOOPBACK_SEED, LoopbackTransport, loopbackLink, type LoopbackLink } from './LoopbackTransport';
export {
  delayFor, loses, networkConditions, perfectConditions, type NetworkConditions,
} from './NetworkConditions';
export {
  CLAIM_HZ, NetworkedWorld, REJOIN_MS,
  type NetworkIdentity, type NetworkedWorldOptions, type NetworkedWorldState, type NetworkedWorldStatus,
} from './NetworkedWorld';
export {
  PRACTICE_BOT_NAME, PRACTICE_BOT_SECONDS, PracticeBot,
  type PracticeBotOptions, type PracticeBotPhase, type PracticeBotReadout,
} from './PracticeBot';
export { INTERPOLATION_MS, Replica, type ReplicaOptions } from './Replica';
export {
  RELAY_QUERY_PARAM, ROOM_CODE_CHARS, ROOM_CODE_EDGES, ROOM_CODE_MAX_LENGTH,
  ROOM_CODE_MIN_LENGTH, ROOM_CODE_MISSING, ROOM_CODE_RULE, ROOM_PATH_PREFIX,
  generateRoomCode, isRoomCode, normaliseRoomCode, relayHost, resolveRelayUrl, roomCodeProblem, toRoomSocketUrl,
} from './relayConfig';
export { seededRandom } from './seededRandom';
export type { MessageHandler, Transport, TransportState } from './Transport';
export {
  RELAY_BACKOFF, RELAY_SCHEMES, WebSocketTransport, backoffDelay, globalSocketFactory, isRelayUrl, wallClockScheduler,
  type Scheduler, type SocketCloseEvent, type SocketFactory, type SocketLike, type SocketMessageEvent,
  type TransportStats, type WebSocketTransportOptions,
} from './WebSocketTransport';
export {
  MESSAGE_KINDS, isBye, isHello, isJoin, isLeave, isMessage, isMove, isSnapshot, isSnapshotMessage, isWelcome, moveFrom,
  snapshotFrom, type Authority, type AuthorityMessage, type ByeMessage, type ClientMessage, type HelloMessage,
  type JoinMessage, type LeaveMessage, type Message, type MessageKind, type MoveMessage, type Snapshot,
  type SnapshotMessage, type WelcomeMessage,
} from './protocol';
