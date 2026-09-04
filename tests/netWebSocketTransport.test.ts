/**
 * The socket transport, driven by a FAKE socket and a FAKE clock.
 *
 * No real network, and none wanted: the interesting behaviour is what
 * happens when the wire misbehaves — a handshake that is refused, a
 * frame that is not a message, a link that drops mid-game — and every
 * one of those is a thing a real relay would only do occasionally and at
 * a time of its own choosing. Here the test owns every event and every
 * millisecond, so the reconnect ladder is asserted exactly rather than
 * waited for.
 *
 * The fake also stands in for the boundary the transport is built
 * around: `src/net` may not name a browser global, so the socket always
 * comes in through a factory (`tests/simulationCore.test.ts` is the
 * enforcement; this file is the proof it is usable).
 */
import { describe, expect, it } from 'vitest';
import { actorId } from '../src/actor/ActorId';
import { playerId } from '../src/actor/PlayerId';
import {
  RELAY_BACKOFF, WebSocketTransport, backoffDelay, isRelayUrl,
  type Scheduler, type SocketCloseEvent, type SocketLike, type SocketMessageEvent,
} from '../src/net';
import type { HelloMessage, MoveMessage, SnapshotMessage } from '../src/net';
import { world } from '../src/world/coords';

const RELAY_URL = 'wss://relay.example/room/kauai';

const HELLO: HelloMessage = { kind: 'hello', playerId: playerId('device-7'), name: 'Joshua', color: '#ffcc00' };

const MOVE: MoveMessage = {
  kind: 'move', actorId: actorId('capsule-1'), at: world(100, -50), height: 0, heading: 0, seq: 0,
};

const SNAPSHOT: SnapshotMessage = { kind: 'snapshot', snapshot: { tick: 3, actors: [] } };

/** A socket the test opens, closes and speaks through by hand. */
class FakeSocket implements SocketLike {
  readonly sent: string[] = [];
  closedWith: SocketCloseEvent | null = null;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: SocketMessageEvent) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: SocketCloseEvent) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
  }

  // --- what the far end does ---
  open(): void {
    this.onopen?.(undefined);
  }

  deliver(data: unknown): void {
    this.onmessage?.({ data });
  }

  /** The connection ended without a close frame: nothing answered, or the link died. */
  drop(code = 1006, reason = ''): void {
    this.onclose?.({ code, reason });
  }

  /** An error, then the close a real socket always follows it with. */
  refuse(): void {
    this.onerror?.(undefined);
    this.onclose?.({ code: 1006, reason: '' });
  }

  /** Everything this socket sent, parsed back. */
  frames(): unknown[] {
    return this.sent.map((f) => JSON.parse(f) as unknown);
  }
}

function fakeRelay(): { factory: (url: string) => SocketLike; sockets: FakeSocket[]; last: () => FakeSocket } {
  const sockets: FakeSocket[] = [];
  return {
    factory: (url: string): SocketLike => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    sockets,
    last: (): FakeSocket => {
      const socket = sockets[sockets.length - 1];
      if (socket === undefined) throw new Error('no socket has been opened');
      return socket;
    },
  };
}

interface Timer {
  readonly fn: () => void;
  readonly ms: number;
  cancelled: boolean;
}

function fakeClock(): { scheduler: Scheduler; timers: Timer[]; delays: () => number[]; fire: () => void } {
  const timers: Timer[] = [];
  return {
    scheduler: (fn, ms): (() => void) => {
      const timer: Timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    timers,
    delays: (): number[] => timers.map((t) => t.ms),
    /** Run the newest timer, as the clock would. */
    fire: (): void => {
      const timer = timers[timers.length - 1];
      if (timer === undefined || timer.cancelled) throw new Error('no live timer to fire');
      timer.fn();
    },
  };
}

/** A transport wired to a fake relay and a fake clock, with jitter drawn at zero so delays are exact. */
function rig(random: () => number = (): number => 0): {
  transport: WebSocketTransport;
  relay: ReturnType<typeof fakeRelay>;
  clock: ReturnType<typeof fakeClock>;
  closes: () => number;
} {
  const relay = fakeRelay();
  const clock = fakeClock();
  const transport = new WebSocketTransport({
    url: RELAY_URL, socketFactory: relay.factory, scheduler: clock.scheduler, random,
  });
  let closes = 0;
  transport.onClose(() => {
    closes += 1;
  });
  return { transport, relay, clock, closes: () => closes };
}

describe('WebSocketTransport: the handshake', () => {
  it('refuses a URL that is not a relay address, and says which schemes are', () => {
    expect(isRelayUrl('wss://relay.example/room')).toBe(true);
    expect(isRelayUrl('ws://localhost:8787/room')).toBe(true);
    expect(isRelayUrl('https://relay.example/room')).toBe(false);
    expect(isRelayUrl('wss://')).toBe(false);
    expect(() => new WebSocketTransport({ url: 'https://relay.example' })).toThrow(/ws:\/\/ or wss:\/\//);
  });

  it('runs closed → connecting → open, and connect() resolves on open', async () => {
    const { transport, relay } = rig();
    expect(transport.state).toBe('closed');
    const opening = transport.connect();
    expect(transport.state).toBe('connecting');
    expect(relay.sockets).toHaveLength(1);
    expect(relay.last().url).toBe(RELAY_URL);
    relay.last().open();
    await expect(opening).resolves.toBeUndefined();
    expect(transport.state).toBe('open');
    // A second connect on an open link is a no-op, not a second socket.
    await expect(transport.connect()).resolves.toBeUndefined();
    expect(relay.sockets).toHaveLength(1);
  });

  it('rejects a refused handshake with the address and something to do about it, and does not retry it', async () => {
    const { transport, relay, clock, closes } = rig();
    const opening = transport.connect();
    relay.last().refuse();
    await expect(opening).rejects.toThrow(new RegExp(`${RELAY_URL}.*could not be reached`));
    await expect(opening).rejects.toThrow(/wss:\/\/ address/);
    expect(transport.state).toBe('closed');
    expect(closes()).toBe(1);
    // A link that was never up is an address to fix, not a link to wait for.
    expect(clock.timers).toHaveLength(0);
    expect(transport.retrying).toBe(false);
  });

  it('reports a socket the platform would not even open', async () => {
    const clock = fakeClock();
    const transport = new WebSocketTransport({
      url: RELAY_URL,
      socketFactory: () => {
        throw new Error('mixed content blocked');
      },
      scheduler: clock.scheduler,
    });
    await expect(transport.connect()).rejects.toThrow(/could not be opened: mixed content blocked/);
    expect(transport.state).toBe('closed');
  });

  it('joins an attempt already in flight instead of opening a second socket', async () => {
    const { transport, relay } = rig();
    const first = transport.connect();
    const second = transport.connect();
    expect(relay.sockets).toHaveLength(1);
    relay.last().open();
    await Promise.all([first, second]);
    expect(transport.state).toBe('open');
  });
});

describe('WebSocketTransport: frames', () => {
  it('decodes a protocol message and hands it on', async () => {
    const { transport, relay } = rig();
    const opening = transport.connect();
    relay.last().open();
    await opening;
    const got: unknown[] = [];
    transport.onMessage((m) => got.push(m));
    relay.last().deliver(JSON.stringify(SNAPSHOT));
    expect(got).toEqual([SNAPSHOT]);
    expect(transport.stats.malformedIn).toBe(0);
  });

  it('drops and counts a frame that is not a valid message, and never throws into the game loop', async () => {
    const { transport, relay } = rig();
    const opening = transport.connect();
    relay.last().open();
    await opening;
    const got: unknown[] = [];
    transport.onMessage((m) => got.push(m));
    const socket = relay.last();
    expect(() => {
      socket.deliver('{not json');                       // a half-written frame
      socket.deliver(JSON.stringify({ kind: 'nonsense' })); // a kind this build does not know
      socket.deliver(JSON.stringify({ kind: 'move', seq: -1 })); // the right kind, wrong shape
      socket.deliver(new Uint8Array([1, 2, 3]));         // not text at all
    }).not.toThrow();
    expect(got).toEqual([]);
    expect(transport.stats.malformedIn).toBe(4);
    // And the link is still usable afterwards: garbage is dropped, not fatal.
    socket.deliver(JSON.stringify(SNAPSHOT));
    expect(got).toEqual([SNAPSHOT]);
  });

  it('encodes what it sends and refuses to put a non-message on the wire', async () => {
    const { transport, relay } = rig();
    const opening = transport.connect();
    relay.last().open();
    await opening;
    transport.send(MOVE);
    transport.send({ kind: 'gossip' });
    expect(relay.last().frames()).toEqual([MOVE]);
    expect(transport.stats.droppedOut).toBe(1);
  });
});

describe('WebSocketTransport: nothing is queued while the link is down', () => {
  it('drops an outbound message sent while closed and counts it', () => {
    const { transport, relay } = rig();
    transport.send(MOVE);
    expect(transport.stats.droppedOut).toBe(1);
    expect(relay.sockets).toHaveLength(0); // sending does not open a link
  });

  it('replays nothing on reconnect: the claims lost with the link stay lost', async () => {
    const { transport, relay, clock } = rig();
    const opening = transport.connect();
    relay.last().open();
    await opening;
    transport.send(HELLO);
    relay.last().drop();
    transport.send(MOVE);
    transport.send({ ...MOVE, seq: 1 });
    expect(transport.stats.droppedOut).toBe(2);
    clock.fire();
    relay.last().open();
    // Only the identity goes out again. Two stale claims are two positions
    // the player has already left; the next snapshot is the truth.
    expect(relay.last().frames()).toEqual([HELLO]);
  });
});

describe('WebSocketTransport: reconnection', () => {
  it('tells its listeners the link is gone, then backs off, re-sends the same hello and counts the reconnect', async () => {
    const { transport, relay, clock, closes } = rig();
    const opening = transport.connect();
    relay.last().open();
    await opening;
    transport.send(HELLO);
    expect(relay.last().frames()).toEqual([HELLO]);

    relay.last().drop();
    expect(transport.state).toBe('closed');
    expect(closes()).toBe(1);
    expect(transport.retrying).toBe(true);
    expect(clock.delays()).toEqual([RELAY_BACKOFF.baseMs / 2]);

    clock.fire();
    expect(relay.sockets).toHaveLength(2);
    expect(transport.state).toBe('connecting');
    relay.last().open();
    expect(transport.state).toBe('open');
    // The SAME hello, so the host re-attaches this player to the actor it kept.
    expect(relay.last().frames()).toEqual([HELLO]);
    expect(transport.stats.reconnects).toBe(1);
    expect(transport.retrying).toBe(false);
  });

  it('doubles the wait up to the cap while the relay stays down, and starts over once it is back', async () => {
    const { transport, relay, clock } = rig();
    const opening = transport.connect();
    relay.last().open();
    await opening;
    transport.send(HELLO);

    relay.last().drop();
    for (let i = 0; i < 6; i += 1) {
      clock.fire();
      relay.last().drop(); // the retry socket never opens either
    }
    // Half of 250, 500, 1000, 2000, 4000, then the 5000 ms cap, twice.
    expect(clock.delays()).toEqual([125, 250, 500, 1000, 2000, 2500, 2500]);

    clock.fire();
    relay.last().open();
    expect(transport.state).toBe('open');
    relay.last().drop();
    // A link that came back resets the ladder: the next hiccup waits a quarter second, not five.
    expect(clock.delays().at(-1)).toBe(125);
  });

  it('jitters the wait so a restarted relay does not meet every client at once', () => {
    expect(backoffDelay(1, () => 0)).toBe(125);
    expect(backoffDelay(1, () => 0.5)).toBe(187.5);
    expect(backoffDelay(99, () => 0)).toBe(RELAY_BACKOFF.capMs / 2);
    expect(backoffDelay(99, () => 0.999)).toBeLessThan(RELAY_BACKOFF.capMs);
    expect(backoffDelay(99, () => 0.999)).toBeGreaterThan(RELAY_BACKOFF.capMs / 2);
  });

  it('lets a caller take the handshake over: an explicit connect cancels the retry and sends no hello of its own', async () => {
    const { transport, relay, clock } = rig();
    const opening = transport.connect();
    relay.last().open();
    await opening;
    transport.send(HELLO);
    relay.last().drop();
    expect(transport.retrying).toBe(true);

    const again = transport.connect();
    expect(clock.timers[0]?.cancelled).toBe(true);
    expect(transport.retrying).toBe(false);
    relay.last().open();
    await again;
    // Nothing automatic: the caller (Client.reconnect) says hello itself,
    // and the relay must not receive it twice.
    expect(relay.last().frames()).toEqual([]);
  });

  it('stops for good on disconnect, and closes the socket cleanly', async () => {
    const { transport, relay, clock, closes } = rig();
    const opening = transport.connect();
    relay.last().open();
    await opening;
    transport.disconnect();
    expect(transport.state).toBe('closed');
    expect(closes()).toBe(1);
    expect(relay.last().closedWith).toEqual({ code: 1000, reason: 'client left' });
    expect(clock.timers).toHaveLength(0);
    transport.disconnect(); // idempotent
    expect(closes()).toBe(1);
  });

  it('does not retry a link the caller hung up while it was down', async () => {
    const { transport, relay, clock } = rig();
    const opening = transport.connect();
    relay.last().open();
    await opening;
    relay.last().drop();
    expect(transport.retrying).toBe(true);
    transport.disconnect();
    expect(transport.retrying).toBe(false);
    expect(clock.timers[0]?.cancelled).toBe(true);
    expect(relay.sockets).toHaveLength(1);
  });
});
