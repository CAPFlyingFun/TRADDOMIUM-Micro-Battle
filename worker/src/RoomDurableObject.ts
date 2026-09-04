/**
 * ONE ROOM = ONE DURABLE OBJECT = ONE `Host`.
 *
 * A Durable Object is single-threaded and unique for its id, which is
 * exactly the shape the authority needs: every player in a room reaches
 * the same object, so one `Host` instance owns the truth of where every
 * capsule is and no two copies of the room can disagree (ARCHITECTURE §5,
 * SESSION_ARCHITECTURE §2 — one core, two authorities).
 *
 * THIS FILE IMPLEMENTS NO GAME RULE. Move validation (the travel budget),
 * spawning, snapshots at `snapshotHz`, the disconnect grace and identity
 * re-attach all live in `src/net/Host.ts` and run here unchanged — the
 * same code the loopback test drives in `tests/netReplication.test.ts`.
 * What is added here is the three things `Host` deliberately does not
 * have: a socket (`WebSocketTransport`), a clock (`Date.now`) and
 * something to call `tick()`.
 *
 * WHY `accept()` AND NOT `state.acceptWebSocket()`. Hibernatable
 * WebSockets let the runtime evict the object between messages and
 * restore it later, and everything not written to storage is lost in
 * between. The room's entire state — the actor table, each actor's travel
 * budget, the tick counter, who is lingering and until when — lives
 * inside `Host` as Maps and closures. It is not serialisable, and
 * serialising it every frame at 20 Hz would cost more than staying in
 * memory. So the room is deliberately memory-resident FOR AS LONG AS
 * SOMEONE IS IN IT: `accept()` pins the object while a socket is open.
 * The moment the last socket closes, the ticker stops and the object goes
 * idle with nothing scheduled — an empty room costs nothing, and when it
 * is eventually evicted there is nothing in it worth keeping.
 *
 * WHY A TIMER AND NOT THE ALARM. Alarms are the right tool at seconds
 * and minutes; a snapshot round is due every 50 ms. `setInterval` while
 * the room is occupied is the honest match for that rate, and because
 * `Host.tick` takes the current time as an argument, a late or coalesced
 * timer callback simply reports the real elapsed time rather than
 * drifting.
 */
import { HOST_DEFAULTS, Host } from '../../src/net/index';
import { WebSocketTransport } from './WebSocketTransport';

/** Milliseconds between snapshot rounds, from the authority's own rate. 20 Hz → 50 ms. */
export const TICK_INTERVAL_MS = Math.max(1, Math.round(1000 / HOST_DEFAULTS.snapshotHz));

/** What the room has seen. Counters only: no player data, nothing that outlives the room. */
export interface RoomCounters {
  socketsAccepted: number;
  /** Frames dropped because they were not protocol messages. See `WebSocketTransport`. */
  framesRejected: number;
}

/**
 * The environment this object is given. It needs nothing from it — no
 * secrets, no bindings — and says so with an empty interface rather than
 * by taking `any`.
 */
export interface RoomEnv {
  readonly [key: string]: unknown;
}

export class RoomDurableObject implements DurableObject {
  private readonly host = new Host(() => Date.now());
  private readonly transports = new Set<WebSocketTransport>();
  private readonly counters: RoomCounters = { socketsAccepted: 0, framesRejected: 0 };
  private ticker: ReturnType<typeof setInterval> | null = null;

  /**
   * Neither argument is kept. The runtime hands every Durable Object its
   * state and its environment; this one needs no storage (its whole state
   * is the `Host` above, and it deliberately writes nothing — see the
   * header) and no binding of its own. Keeping unused references would
   * only suggest otherwise.
   */
  constructor(_state: DurableObjectState, _env: RoomEnv) {}

  /**
   * The only request a room answers is the upgrade the router forwarded.
   * Anything else reaching here is a bug in the router, not a client
   * error, and says so plainly rather than opening a socket by accident.
   */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('a room is joined over a WebSocket', { status: 426, headers: { 'Content-Type': 'text/plain' } });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    await this.admit(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** How many players are connected right now. Read by tests and by the ticker's stop condition. */
  get socketCount(): number {
    return this.transports.size;
  }

  /** A copy of the room's counters, for a test or a future admin route. Callers may not reach in. */
  get counts(): RoomCounters {
    return { ...this.counters };
  }

  /**
   * Hand an accepted socket to the authority and make sure the room is
   * ticking. The client says `hello` next; `Host` answers with `welcome`
   * and tells everyone else `join`.
   */
  private async admit(socket: WebSocket): Promise<void> {
    // Per connection, so the log line below is written once for a client
    // that cannot speak the protocol rather than once per bad frame — a
    // flood of frames must not become a flood of logs.
    let rejected = 0;
    const transport = new WebSocketTransport(socket, {
      onRejected: (reason) => {
        this.counters.framesRejected += 1;
        rejected += 1;
        if (rejected === 1) console.warn(`room: dropped a frame that is not a protocol message (${reason})`);
      },
    });
    this.transports.add(transport);
    this.counters.socketsAccepted += 1;
    // The room's own bookkeeping listens separately from the transport's,
    // so neither depends on the other's ordering.
    socket.addEventListener('close', () => this.forget(transport));
    socket.addEventListener('error', () => this.forget(transport));
    await this.host.attach(transport);
    this.startTicking();
  }

  /**
   * A socket is gone. `Host.detach` runs the grace path: the player
   * lingers with their capsule standing where it stood, so a phone that
   * switched apps re-attaches to the same actor instead of being seen to
   * leave and rejoin.
   */
  private forget(transport: WebSocketTransport): void {
    if (!this.transports.delete(transport)) return; // already forgotten
    this.host.detach(transport);
    if (this.transports.size === 0) this.stopTicking();
  }

  private startTicking(): void {
    if (this.ticker !== null) return;
    this.ticker = setInterval(() => this.host.tick(Date.now()), TICK_INTERVAL_MS);
  }

  /**
   * The room is empty. Nothing is scheduled until someone arrives.
   *
   * Players still inside their disconnect grace are not dropped here and
   * do not need to be: `Host.tick` compares against the wall clock, so
   * when the room next has an occupant the first tick expires whatever
   * ran out while nobody was watching. Nobody was listening for the
   * `leave` in the meantime.
   */
  private stopTicking(): void {
    if (this.ticker === null) return;
    clearInterval(this.ticker);
    this.ticker = null;
  }
}
