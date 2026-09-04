/**
 * ONE ACCEPTED WEBSOCKET, WEARING THE CORE `Transport` INTERFACE.
 *
 * `Host` (src/net/Host.ts) is pure: it knows `connect / send / onMessage
 * / onClose` and nothing about sockets, JSON or Cloudflare. This is the
 * whole of the adapter between the two, and it is the only file in the
 * relay that touches a `WebSocket`. Everything about who may move what,
 * how fast, and for how long a dropped player keeps their capsule stays
 * in `Host`, unchanged and shared with the browser build.
 *
 * A CLIENT MAY NOT CRASH A ROOM. Every frame is checked here before it
 * reaches `Host`: it must be text, it must parse as JSON, and it must
 * satisfy `isMessage()` from protocol.ts. A frame that fails any of those
 * is dropped and counted through `onRejected` — never thrown, because a
 * throw out of a socket event handler in a Durable Object takes the
 * object down and with it the game state of everyone else in the room.
 * `Host` re-checks with the same guard on arrival; the check here exists
 * so the rejection can be COUNTED and so a garbage frame never becomes an
 * exception.
 *
 * The socket is already open when this is constructed (the Durable Object
 * accepts it before handing it over), so `connect()` resolves at once —
 * there is nothing to dial.
 */
import { isMessage, type MessageHandler, type Transport, type TransportState } from '../../src/net/index';

/** Why a frame was refused. Counted per room so a misbehaving client is visible rather than silent. */
export type RejectReason = 'not-text' | 'not-json' | 'not-a-message';

export interface WebSocketTransportHooks {
  /** A frame that never reached `Host`. Called at most once per frame; must not throw. */
  readonly onRejected: (reason: RejectReason) => void;
}

/**
 * Close codes. 1000 is a normal closure: when the relay hangs up on a
 * client it is because the room is done with that connection, not because
 * anything failed.
 */
const NORMAL_CLOSURE = 1000;

export class WebSocketTransport implements Transport {
  private current: TransportState = 'open';
  private readonly handlers = new Set<MessageHandler>();
  private readonly closeHandlers = new Set<() => void>();

  constructor(
    private readonly socket: WebSocket,
    private readonly hooks: WebSocketTransportHooks,
  ) {
    socket.addEventListener('message', (event: MessageEvent) => this.onFrame(event.data));
    socket.addEventListener('close', () => this.gone());
    // An errored socket carries nothing more; to the authority that is the
    // same fact as a close, and it must run the same grace path.
    socket.addEventListener('error', () => this.gone());
  }

  get state(): TransportState {
    return this.current;
  }

  /** Already open: a server-side end of an accepted upgrade has nothing to dial. */
  async connect(): Promise<void> {
    return;
  }

  /** Hang up on the client. Idempotent, so `Host.detach` after a close event is a no-op. */
  disconnect(): void {
    if (this.current === 'closed') return;
    this.current = 'closed';
    try {
      this.socket.close(NORMAL_CLOSURE, 'room closed this connection');
    } catch {
      // Already closed by the far end or by the runtime; there is nothing left to say.
    }
    this.fireClose();
  }

  /**
   * Serialise and send. A closed end silently drops, as the wire would:
   * `Host` guards on `state` too, but a socket can close between its
   * check and this call, and that race must not become an exception
   * inside a broadcast loop.
   */
  send(msg: unknown): void {
    if (this.current !== 'open') return;
    try {
      this.socket.send(JSON.stringify(msg));
    } catch {
      // The socket died mid-send. Treat it exactly as a close event would.
      this.gone();
    }
  }

  onMessage(cb: MessageHandler): () => void {
    this.handlers.add(cb);
    return () => {
      this.handlers.delete(cb);
    };
  }

  onClose(cb: () => void): () => void {
    this.closeHandlers.add(cb);
    return () => {
      this.closeHandlers.delete(cb);
    };
  }

  /** Text → JSON → protocol message, or a counted rejection. Never throws. */
  private onFrame(data: unknown): void {
    if (typeof data !== 'string') {
      // The protocol is JSON text; a binary frame is not a message we speak.
      this.hooks.onRejected('not-text');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.hooks.onRejected('not-json');
      return;
    }
    if (!isMessage(parsed)) {
      this.hooks.onRejected('not-a-message');
      return;
    }
    for (const cb of [...this.handlers]) cb(parsed);
  }

  /** The far end is gone. Tell the authority once; its grace/re-attach path takes it from here. */
  private gone(): void {
    if (this.current === 'closed') return;
    this.current = 'closed';
    this.fireClose();
  }

  private fireClose(): void {
    for (const cb of [...this.closeHandlers]) cb();
  }
}
