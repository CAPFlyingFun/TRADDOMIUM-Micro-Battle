/**
 * The network seam. Gameplay and sessions send and receive through this
 * interface and never touch a socket; the first multiplayer milestone (two
 * browsers, two capsules) plugs a real transport in here, and the
 * two-capsule test plugs `LoopbackTransport` in instead.
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
}

/**
 * Two ends joined in memory. Delivery is deferred to a microtask so that
 * code written against it cannot accidentally depend on a synchronous
 * reply, which no real network would give it.
 */
export class LoopbackTransport implements Transport {
  private peer: LoopbackTransport | null = null;
  private current: TransportState = 'closed';
  private readonly handlers = new Set<MessageHandler>();

  static pair(): [LoopbackTransport, LoopbackTransport] {
    const a = new LoopbackTransport();
    const b = new LoopbackTransport();
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  get state(): TransportState {
    return this.current;
  }

  async connect(): Promise<void> {
    if (this.current === 'open') return;
    this.current = 'connecting';
    await Promise.resolve();
    this.current = 'open';
  }

  disconnect(): void {
    this.current = 'closed';
  }

  /** Throws when not open: sending into a closed socket is a bug, not a no-op. */
  send(msg: unknown): void {
    if (this.current !== 'open') throw new Error(`LoopbackTransport: send while ${this.current}`);
    const peer = this.peer;
    if (!peer || peer.current !== 'open') return; // dropped, as on the wire
    queueMicrotask(() => {
      if (peer.current !== 'open') return;
      for (const cb of peer.handlers) cb(msg);
    });
  }

  onMessage(cb: MessageHandler): () => void {
    this.handlers.add(cb);
    return () => {
      this.handlers.delete(cb);
    };
  }
}
