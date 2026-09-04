/**
 * Two transport ends joined in memory, with a wire between them that can
 * be as bad as a test needs.
 *
 * Two ways to run it:
 *
 *   pair()      A perfect wire delivering on the next microtask, as in
 *               Phase 0. Code written against it still cannot depend on
 *               a synchronous reply, which no real network would give.
 *   pair(link)  A MODELLED wire. Each message is stamped on `send()`
 *               with the link's clock plus the link's latency and jitter
 *               (or lost, at its drop rate), and nothing arrives until
 *               `pump(nowMs)` is called on the receiving end. The test
 *               owns the clock, so the test owns delivery: a replication
 *               proof runs in simulated milliseconds, deterministically.
 *
 * IN ORDER, ALWAYS. Jitter delays a message; it never lets a later one
 * overtake it. That is the guarantee a stream transport (a WebSocket, a
 * reliable data channel) gives, and the guarantee `Host` and `Replica`
 * lean on: a `leave` cannot be overtaken by a stale snapshot. Loss is
 * modelled on top of order, as a sequenced datagram channel would show
 * it — a message is either delivered in its turn or never.
 *
 * A hang-up travels the wire too. `disconnect()` closes this end at
 * once and sends the far end a close marker that arrives behind whatever
 * was sent before it, so a `bye` reaches the host before the host learns
 * the socket closed — the order a real socket gives. The far end's own
 * `state` is not changed by a hang-up: it is told (`onClose`), and what
 * it sends from then on is dropped, as on the wire.
 *
 * Pure: no timer (the microtask path is the event loop, not a clock),
 * no `Math.random` (the link carries its generator).
 */
import { delayFor, loses, perfectConditions, type NetworkConditions } from './NetworkConditions';
import { seededRandom } from './seededRandom';
import type { MessageHandler, Transport, TransportState } from './Transport';

/** The wire between two ends: one clock, one set of dials, one generator, shared by both directions. */
export interface LoopbackLink {
  /** Milliseconds on the test's clock. Read on every `send()` to stamp the message. */
  readonly now: () => number;
  /** Mutable and shared: turn a dial mid-run and both ends feel it from the next send. */
  readonly conditions: NetworkConditions;
  /** 0 ≤ r < 1. */
  readonly random: () => number;
}

/** Fixed so a link built without a generator is still the same wire on every run. */
export const LOOPBACK_SEED = 0x5eed;

export function loopbackLink(
  now: () => number,
  conditions: NetworkConditions = perfectConditions(),
  random: () => number = seededRandom(LOOPBACK_SEED),
): LoopbackLink {
  return { now, conditions, random };
}

interface Queued {
  readonly deliverAt: number;
  readonly payload: unknown;
  /** The far end hung up; there is no payload. */
  readonly close: boolean;
}

export class LoopbackTransport implements Transport {
  private peer: LoopbackTransport | null = null;
  private link: LoopbackLink | null = null;
  private current: TransportState = 'closed';
  private readonly handlers = new Set<MessageHandler>();
  private readonly closeHandlers = new Set<() => void>();
  /** What is on the wire towards THIS end, in delivery order. Modelled mode only. */
  private readonly inbound: Queued[] = [];
  /** When the last thing queued for this end lands: nothing may land before it. */
  private lastScheduledAt = Number.NEGATIVE_INFINITY;

  static pair(link?: LoopbackLink): [LoopbackTransport, LoopbackTransport] {
    const a = new LoopbackTransport();
    const b = new LoopbackTransport();
    a.peer = b;
    b.peer = a;
    a.link = link ?? null;
    b.link = link ?? null;
    return [a, b];
  }

  get state(): TransportState {
    return this.current;
  }

  /** The dials both ends share, or null on a perfect microtask pair. */
  get conditions(): NetworkConditions | null {
    return this.link?.conditions ?? null;
  }

  /** How many messages and hang-ups are on the wire towards this end. */
  get queued(): number {
    return this.inbound.length;
  }

  async connect(): Promise<void> {
    if (this.current === 'open') return;
    this.current = 'connecting';
    await Promise.resolve();
    this.current = 'open';
  }

  /** Idempotent: a second hang-up on a closed end tells nobody anything. */
  disconnect(): void {
    if (this.current === 'closed') return;
    this.current = 'closed';
    // Nothing queued for a closed end arrives; a real socket discards it too.
    this.inbound.length = 0;
    this.lastScheduledAt = Number.NEGATIVE_INFINITY;
    for (const cb of [...this.closeHandlers]) cb();
    const peer = this.peer;
    if (peer && peer.current === 'open') peer.enqueue(undefined, true);
  }

  /** Throws when not open: sending into a closed socket is a bug, not a no-op. */
  send(msg: unknown): void {
    if (this.current !== 'open') throw new Error(`LoopbackTransport: send while ${this.current}`);
    const peer = this.peer;
    if (!peer || peer.current !== 'open') return; // dropped, as on the wire
    peer.enqueue(msg, false);
  }

  /**
   * Deliver everything on the wire towards this end whose time has come,
   * oldest first. Returns how many things landed (a hang-up counts).
   * Does nothing on a perfect microtask pair, which delivers itself.
   */
  pump(nowMs: number): number {
    let landed = 0;
    while (this.inbound.length > 0) {
      const head = this.inbound[0];
      if (head === undefined || head.deliverAt > nowMs) break;
      this.inbound.shift();
      this.deliver(head);
      landed += 1;
    }
    return landed;
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

  /** Put something on the wire towards this end. The far end calls it; it never calls itself. */
  private enqueue(payload: unknown, close: boolean): void {
    const link = this.link;
    if (link === null) {
      // Perfect wire: the event loop is the delivery order, and it is FIFO.
      queueMicrotask(() => this.deliver({ deliverAt: 0, payload, close }));
      return;
    }
    // Loss is drawn before delay, so a message that is lost never consumes a jitter draw.
    if (!close && loses(link.conditions, link.random)) return;
    const wanted = link.now() + delayFor(link.conditions, link.random);
    const deliverAt = Math.max(wanted, this.lastScheduledAt);
    this.lastScheduledAt = deliverAt;
    this.inbound.push({ deliverAt, payload, close });
  }

  private deliver(entry: Queued): void {
    if (this.current !== 'open') return;
    if (entry.close) {
      for (const cb of [...this.closeHandlers]) cb();
      return;
    }
    for (const cb of [...this.handlers]) cb(entry.payload);
  }
}
