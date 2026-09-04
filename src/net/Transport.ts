/**
 * The network seam. Gameplay and sessions send and receive through this
 * interface and never touch a socket; the first multiplayer milestone (two
 * browsers, two capsules) plugs a real transport in here, and the
 * two-capsule test plugs `LoopbackTransport` in instead.
 *
 * LIVENESS IS THE TRANSPORT'S JOB. A transport says when its connection
 * is gone (`onClose`) — a socket's close event, a relay's ping timeout —
 * and the authority reacts. The authority keeps no heartbeat of its own,
 * so the protocol needs no keepalive message and an idle player is not
 * mistaken for a dead one.
 *
 * Pure: no DOM, no WebSocket import.
 */
export type TransportState = 'closed' | 'connecting' | 'open';
export type MessageHandler = (msg: unknown) => void;

export interface Transport {
  readonly state: TransportState;
  connect(): Promise<void>;
  disconnect(): void;
  send(msg: unknown): void;
  /** Returns the unsubscribe function. */
  onMessage(cb: MessageHandler): () => void;
  /**
   * The connection is gone: this end was disconnected, or the far end
   * hung up. Nothing more will arrive and anything sent is lost. Returns
   * the unsubscribe function.
   */
  onClose(cb: () => void): () => void;
}

// The in-memory implementation lives in its own file; it is re-exported
// here so the import path the Phase 0 tests use stays valid.
export { LoopbackTransport, loopbackLink, type LoopbackLink } from './LoopbackTransport';
