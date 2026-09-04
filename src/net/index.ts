/**
 * The network module's public surface. Sessions import from here;
 * nothing outside `net/` reaches into a file by name.
 */
export { Client, CORRECTION_EPSILON, type ClientState, type CorrectionHandler, type MovePose } from './Client';
export { HOST_DEFAULTS, Host, SPAWN_SPACING, type HostOptions, type HostStats, type Presence } from './Host';
export { LOOPBACK_SEED, LoopbackTransport, loopbackLink, type LoopbackLink } from './LoopbackTransport';
export {
  delayFor, loses, networkConditions, perfectConditions, type NetworkConditions,
} from './NetworkConditions';
export { INTERPOLATION_MS, Replica, type ReplicaOptions } from './Replica';
export { seededRandom } from './seededRandom';
export type { MessageHandler, Transport, TransportState } from './Transport';
export {
  MESSAGE_KINDS, isBye, isHello, isJoin, isLeave, isMessage, isMove, isSnapshot, isSnapshotMessage, isWelcome, moveFrom,
  snapshotFrom, type Authority, type AuthorityMessage, type ByeMessage, type ClientMessage, type HelloMessage,
  type JoinMessage, type LeaveMessage, type Message, type MessageKind, type MoveMessage, type Snapshot,
  type SnapshotMessage, type WelcomeMessage,
} from './protocol';
