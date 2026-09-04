/**
 * THE RELAY PROBE: two real players, one real room, no Cloudflare account.
 *
 * `tests/netReplication.test.ts` already proves the authority's rules with
 * two `Client`s wired to a `Host` through `LoopbackTransport` — in one
 * process, with no sockets and a clock the test controls. That test can
 * never fail for the reasons a relay fails: a Worker that does not boot, a
 * room code that reaches two different Durable Objects, a frame that never
 * survives JSON, a socket close the host never hears. This probe closes
 * exactly that gap. It starts the Worker itself, opens TWO ordinary
 * WebSockets from Node into the same room, and asserts the things a
 * player would notice:
 *
 *   1. the relay answers /health, and says what it speaks;
 *   2. A joins and is told who it is;
 *   3. B joins the SAME code and sees A; A is told B arrived;
 *   4. A moves and B sees A move;
 *   5. A claims a teleport and the authority refuses it — the correction
 *      comes back to A, and B never sees the teleport at all;
 *   6. B's link drops and, inside the grace, B reconnects with the SAME
 *      playerId and gets the SAME actor back — same id, same colour,
 *      standing where it stood, and no third capsule in the room.
 *
 * Every rule being checked lives in `src/net/Host.ts` and is shared
 * unchanged with the browser. What is under test HERE is the runtime
 * around it: `worker/src/index.ts` routing a code to one Durable Object,
 * `worker/src/RoomDurableObject.ts` holding one `Host` and ticking it, and
 * `worker/src/WebSocketTransport.ts` carrying the protocol over a real
 * socket.
 *
 * WHAT IT COSTS AND NEEDS: nothing. `wrangler dev --local` runs workerd
 * from the npm package on this machine. There is no login, no account, no
 * deploy and no network — which is the point: the relay can be proven
 * before anybody pays for it or trusts it with a phone.
 *
 * Usage, from the repository root:
 *
 *     npm run probe:relay
 *
 * The probe starts and stops the Worker itself, on a free port it picks,
 * with its Durable Object state in a temporary directory that it deletes
 * afterwards — so it never collides with a `npm run relay:dev` you have
 * open, and never leaves a room's state in the repo.
 *
 * IT MUST NOT HANG AND IT MUST NOT LIE. Every wait has a timeout, there
 * is a watchdog over the whole run, and the Worker is stopped on the way
 * out whether the run passed, failed or threw. If the Worker will not
 * start, the probe says so with the Worker's own output and exits 1 — it
 * does not fall back to something easier and call that a pass.
 */
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER_CONFIG = 'worker/wrangler.toml';
/** Wrangler writes its scratch state beside the config it was given. */
const WRANGLER_SCRATCH = path.join(ROOT, 'worker', '.wrangler');

/** workerd is compiled and booted on the first run; a cold start is slow, a warm one is a second. */
const BOOT_TIMEOUT_MS = 60_000;
/** At 20 Hz a snapshot is due every 50 ms, so anything this probe waits for is late by 5 s. */
const MESSAGE_TIMEOUT_MS = 5_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
/** The whole run, boot included. Past this something is wedged and a stuck probe helps nobody. */
const WATCHDOG_MS = 150_000;

/**
 * How far A walks in one claim, in world units (one unit is a
 * centimetre), and how far it then tries to cheat.
 *
 * GAME TUNING, derived from the authority's own numbers rather than
 * guessed: a capsule earns travel at walkSpeed × sprintFactor × tolerance
 * = 60 × 2 × 1.25 = 150 units a second and banks at most burstMs = 250 ms
 * of it, so 37.5 units is the most any single claim may spend
 * (`HOST_DEFAULTS` and `DEBUG_CAPSULE_TUNING`). 24 units is comfortably
 * inside that budget and 5 km is comfortably outside it, so this probe
 * does not become a re-tuning of the budget. If those constants change
 * and this probe starts failing on check 4, this is the paragraph to
 * re-read: the number to change is STEP_UNITS, not the budget.
 */
const STEP_UNITS = 24;
/**
 * A teleport that is a LEGAL MESSAGE. It must stay on the island
 * (`isWorldPointLike` refuses anything past half of ISLAND_SPAN, and a
 * refused message is dropped by the transport before `Host` ever sees
 * it), because what is being tested is the travel budget refusing a
 * plausible-looking claim — not the guard refusing a malformed one.
 */
const TELEPORT_WX = 500_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Checks that have passed, in order, for the summary at the end. */
const passed = [];

/**
 * What the watchdog has to clean up if the run never reaches its own
 * `finally`. A wedged probe that leaves workerd running behind it would
 * hold a port and a few hundred megabytes until someone noticed.
 */
const live = { worker: null, persistTo: null, scratchToClear: null };

function pass(line) {
  passed.push(line);
  console.log(`  ok   ${line}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------
// The Worker
// ---------------------------------------------------------------------------

/** A port the OS says is free right now. Racy in principle; wrangler's own bind is the real test. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * `wrangler dev --local`, watched. Its output is kept so a failure to
 * boot can be reported with the reason wrangler gave rather than with a
 * timeout and a shrug.
 */
function startWorker({ port, persistTo }) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(
    npx,
    [
      'wrangler', 'dev',
      '--config', WRANGLER_CONFIG,
      '--local',
      '--ip', '127.0.0.1',
      '--port', String(port),
      '--persist-to', persistTo,
    ],
    {
      cwd: ROOT,
      // No telemetry from a probe: it needs no network and should ask for none.
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process group, so stopping it stops workerd too and not
      // just the npx wrapper that launched it.
      detached: process.platform !== 'win32',
    },
  );

  const output = [];
  const keep = (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim().length > 0) output.push(line);
    }
    while (output.length > 200) output.shift();
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);

  const worker = { child, output, exit: null };
  child.on('exit', (code, signal) => {
    worker.exit = { code, signal };
  });
  child.on('error', (error) => {
    worker.exit = { code: null, signal: null, error };
  });
  return worker;
}

/** GET /health over plain http, deliberately not `fetch`: no proxy env var may reach 127.0.0.1. */
function getHealth(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = httpGet({ host: '127.0.0.1', port, path: '/health', timeout: timeoutMs }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('timeout', () => request.destroy(new Error(`no answer from /health within ${timeoutMs} ms`)));
    request.on('error', reject);
  });
}

/** Poll until the relay answers, or say plainly that it never did and why. */
async function waitForHealth(worker, port) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let lastError = 'nothing answered yet';
  while (Date.now() < deadline) {
    if (worker.exit !== null) {
      // Two different failures, and they are fixed differently: wrangler
      // that could not be LAUNCHED (not installed, no npx on PATH) versus
      // wrangler that ran and gave up (a port in use, a config it refused).
      const why =
        worker.exit.error !== undefined
          ? `wrangler could not be launched: ${worker.exit.error.message}`
          : `wrangler exited (code ${worker.exit.code}, signal ${worker.exit.signal})`;
      throw new Error(`the relay would not start: ${why}.\n${byHand()}\n${workerOutput(worker)}`);
    }
    try {
      const { status, body } = await getHealth(port, 2_000);
      if (status === 200) return body;
      lastError = `/health answered ${status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(
    `the relay did not answer /health on 127.0.0.1:${port} within ${BOOT_TIMEOUT_MS} ms (${lastError}).\n` +
      `${byHand()}\n${workerOutput(worker)}`,
  );
}

/** The one command that shows a person what the probe could only report second-hand. */
const byHand = () => `  Run the relay by hand to see why:  npx wrangler dev --config ${WRANGLER_CONFIG} --local`;

function workerOutput(worker) {
  const tail = worker.output.slice(-40);
  return tail.length === 0 ? '  (wrangler printed nothing)' : tail.map((line) => `  | ${line}`).join('\n');
}

/** SIGTERM the whole group, then SIGKILL if it will not go. Always resolves. */
async function stopWorker(worker) {
  if (worker === null || worker.exit !== null) return;
  const ended = new Promise((resolve) => worker.child.once('exit', resolve));
  signal(worker, 'SIGTERM');
  const timer = setTimeout(() => signal(worker, 'SIGKILL'), SHUTDOWN_TIMEOUT_MS);
  await ended;
  clearTimeout(timer);
}

function signal(worker, name) {
  try {
    if (process.platform !== 'win32' && worker.child.pid !== undefined) process.kill(-worker.child.pid, name);
    else worker.child.kill(name);
  } catch {
    // Already gone: nothing to stop, and nothing worth reporting.
  }
}

// ---------------------------------------------------------------------------
// A player
// ---------------------------------------------------------------------------

/**
 * One WebSocket to one room, with a log of everything the relay said.
 *
 * Waiting is always "the first message after this point that satisfies
 * this predicate, or an error naming what we were waiting for" — a probe
 * that waits without a timeout is a probe that hangs a CI run, and one
 * that waits without a description leaves a failure nobody can read.
 */
class RelayClient {
  constructor(label, url) {
    this.label = label;
    this.url = url;
    /** Every parsed message, oldest first. `mark()` indexes into it. */
    this.log = [];
    this.waiters = new Set();
    this.socket = null;
    this.gone = null;
  }

  async open(timeoutMs = MESSAGE_TIMEOUT_MS) {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('message', (event) => this.receive(event.data));
    socket.addEventListener('close', (event) => this.ended(`the relay closed the link (code ${event.code})`));
    socket.addEventListener('error', () => this.ended('the socket errored'));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${this.label}: ${this.url} did not open within ${timeoutMs} ms`)),
        timeoutMs,
      );
      const settle = (fn, value) => {
        clearTimeout(timer);
        fn(value);
      };
      socket.addEventListener('open', () => settle(resolve), { once: true });
      socket.addEventListener('error', () => settle(reject, new Error(`${this.label}: could not open ${this.url}`)), {
        once: true,
      });
      socket.addEventListener(
        'close',
        (event) => settle(reject, new Error(`${this.label}: ${this.url} closed before it opened (code ${event.code})`)),
        { once: true },
      );
    });
  }

  /** Where the log stands now, so a later wait cannot be satisfied by something already said. */
  mark() {
    return this.log.length;
  }

  send(message) {
    assert(this.socket !== null && this.socket.readyState === WebSocket.OPEN, `${this.label}: cannot send, the link is not open`);
    this.socket.send(JSON.stringify(message));
  }

  /** Every message since `since` that matches, as an array. For "it never said X" assertions. */
  seen(predicate, since = 0) {
    return this.log.slice(since).filter(predicate);
  }

  waitFor(description, predicate, { since = 0, timeoutMs = MESSAGE_TIMEOUT_MS } = {}) {
    for (const message of this.log.slice(since)) {
      if (predicate(message)) return Promise.resolve(message);
    }
    if (this.gone !== null) {
      return Promise.reject(new Error(`${this.label}: ${this.gone} before ${description} arrived`));
    }
    return new Promise((resolve, reject) => {
      const waiter = { description, predicate };
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`${this.label}: timed out after ${timeoutMs} ms waiting for ${description}`));
      }, timeoutMs);
      waiter.settle = (error, message) => {
        clearTimeout(timer);
        this.waiters.delete(waiter);
        if (error !== null) reject(error);
        else resolve(message);
      };
      this.waiters.add(waiter);
    });
  }

  /** A clean hang-up from the player's end: the relay sees a close, not a `bye`. */
  close() {
    if (this.socket === null) return;
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close(1000, 'probe finished with this link');
    }
  }

  receive(data) {
    if (typeof data !== 'string') {
      this.record({ kind: '<binary frame>' });
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.record({ kind: '<unparseable>', raw: data.slice(0, 200) });
      return;
    }
    this.record(parsed);
  }

  record(message) {
    this.log.push(message);
    for (const waiter of [...this.waiters]) {
      if (waiter.predicate(message)) waiter.settle(null, message);
    }
  }

  ended(reason) {
    if (this.gone !== null) return;
    this.gone = reason;
    for (const waiter of [...this.waiters]) {
      waiter.settle(new Error(`${this.label}: ${reason} while waiting for ${waiter.description}`), undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// Small readers over the protocol, so the checks below read as prose
// ---------------------------------------------------------------------------

const isWelcome = (message) => message.kind === 'welcome';
const isSnapshot = (message) => message.kind === 'snapshot';
const actorOf = (snapshot, owner) => snapshot.actors.find((actor) => actor.owner === owner);
const actorById = (snapshot, id) => snapshot.actors.find((actor) => actor.id === id);
const at = (actor) => `(${actor.at.wx}, ${actor.at.wz})`;

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function run() {
  assert(
    typeof WebSocket === 'function',
    `this probe needs Node's built-in WebSocket (Node 22 or newer); this is ${process.version}`,
  );
  assert(
    existsSync(path.join(ROOT, 'node_modules', 'wrangler')),
    'wrangler is not installed. Run `npm install` first: the probe runs the relay locally with it.',
  );

  // A fresh code per run, so nothing left over from an earlier run or an
  // open `npm run relay:dev` can be mistaken for this one's room.
  const room = `probe-${randomBytes(3).toString('hex')}`;
  const playerA = `probe-a-${randomBytes(3).toString('hex')}`;
  const playerB = `probe-b-${randomBytes(3).toString('hex')}`;
  const colorA = '#ff3b30';
  const colorB = '#0a84ff';

  // Wrangler writes worker/.wrangler as a side effect of running. Leave
  // it alone if it was already there (someone's dev session owns it);
  // clear it if this probe is what created it, so a probe run never
  // leaves a directory for someone to wonder about or commit.
  const scratchExisted = existsSync(WRANGLER_SCRATCH);
  live.scratchToClear = scratchExisted ? null : WRANGLER_SCRATCH;
  const persistTo = mkdtempSync(path.join(tmpdir(), 'traddomium-relay-probe-'));
  const port = await freePort();
  let worker = null;
  const clients = [];

  try {
    console.log(`relay probe: starting the Worker on 127.0.0.1:${port}, room "${room}"`);
    worker = startWorker({ port, persistTo });
    live.worker = worker;
    live.persistTo = persistTo;
    const health = JSON.parse(await waitForHealth(worker, port));

    // ---- 1. the relay is up and says what it is ---------------------------
    assert(health.service === 'traddomium-relay', `/health says service "${health.service}"`);
    assert(health.status === 'ok', `/health says status "${health.status}"`);
    const { snapshotHz, graceMs } = health.protocol;
    assert(Number.isFinite(snapshotHz) && snapshotHz > 0, `/health reports a nonsense snapshotHz: ${snapshotHz}`);
    assert(Number.isFinite(graceMs) && graceMs > 0, `/health reports a nonsense graceMs: ${graceMs}`);
    pass(`the Worker booted and /health answers: v${health.version}, ${snapshotHz} Hz snapshots, ${graceMs} ms grace`);

    const url = `ws://127.0.0.1:${port}/room/${room}`;

    // ---- 2. A joins -------------------------------------------------------
    const a = new RelayClient('A', url);
    clients.push(a);
    await a.open();
    a.send({ kind: 'hello', playerId: playerA, name: 'Probe A', color: colorA });
    const welcomeA = await a.waitFor('A’s welcome', isWelcome);
    assert(welcomeA.yourId === playerA, `A was welcomed as "${welcomeA.yourId}", not as itself`);
    const actorA = actorOf(welcomeA.snapshot, playerA);
    assert(actorA !== undefined, 'A’s welcome carried no actor of A’s own');
    pass(`A joined room "${room}" and was given actor ${actorA.id} at ${at(actorA)}`);

    // ---- 3. B joins the same room, and each sees the other -----------------
    const markA = a.mark();
    const b = new RelayClient('B', url);
    clients.push(b);
    await b.open();
    b.send({ kind: 'hello', playerId: playerB, name: 'Probe B', color: colorB });
    const welcomeB = await b.waitFor('B’s welcome', isWelcome);
    assert(welcomeB.yourId === playerB, `B was welcomed as "${welcomeB.yourId}", not as itself`);
    const actorB = actorOf(welcomeB.snapshot, playerB);
    assert(actorB !== undefined, 'B’s welcome carried no actor of B’s own');
    assert(
      actorById(welcomeB.snapshot, actorA.id) !== undefined,
      `B’s welcome does not list A’s actor ${actorA.id}; it holds ${welcomeB.snapshot.actors.length} actor(s)`,
    );
    pass(`B joined the same code and its welcome already holds A: ${welcomeB.snapshot.actors.length} actors`);

    const joinAtA = await a.waitFor('the join announcing B to A', (m) => m.kind === 'join' && m.actor.owner === playerB, {
      since: markA,
    });
    assert(joinAtA.actor.id === actorB.id, `A was told B is ${joinAtA.actor.id}, but B was given ${actorB.id}`);
    const bothAtA = await a.waitFor('a snapshot at A holding both actors', (m) => isSnapshot(m) && m.snapshot.actors.length === 2, {
      since: markA,
    });
    assert(actorById(bothAtA.snapshot, actorB.id) !== undefined, 'A’s two-actor snapshot is not the one holding B');
    pass(`A was told B arrived (${actorB.id}) and A’s snapshots now carry both capsules`);

    // ---- 4. A moves; B sees it --------------------------------------------
    const markB = b.mark();
    const walkTo = { wx: actorA.at.wx + STEP_UNITS, wz: actorA.at.wz };
    a.send({ kind: 'move', actorId: actorA.id, at: walkTo, height: 0, heading: 0, seq: 1 });
    const movedAtB = await b.waitFor(
      `B to see A at (${walkTo.wx}, ${walkTo.wz})`,
      (m) => isSnapshot(m) && actorById(m.snapshot, actorA.id)?.at.wx === walkTo.wx,
      { since: markB },
    );
    assert(
      actorById(movedAtB.snapshot, actorA.id).at.wz === walkTo.wz,
      'B saw A’s wx change but not its wz: the claim was applied in part',
    );
    pass(`A walked ${STEP_UNITS} units and B saw it: A is at ${at(actorById(movedAtB.snapshot, actorA.id))} on B’s screen`);

    // ---- 5. the authority refuses a teleport -------------------------------
    const teleportSeq = 2;
    const markTeleportA = a.mark();
    const markTeleportB = b.mark();
    a.send({ kind: 'move', actorId: actorA.id, at: { wx: TELEPORT_WX, wz: 0 }, height: 0, heading: 0, seq: teleportSeq });
    const correction = await a.waitFor(
      'the correction for A’s refused teleport',
      (m) => isSnapshot(m) && m.ackSeq === teleportSeq,
      { since: markTeleportA },
    );
    const correctedA = actorById(correction.snapshot, actorA.id);
    assert(correctedA !== undefined, 'the correction does not mention the actor whose claim was refused');
    assert(
      correctedA.at.wx === walkTo.wx && correctedA.at.wz === walkTo.wz,
      `the authority accepted a ${TELEPORT_WX} unit jump: A came back at ${at(correctedA)}, not at (${walkTo.wx}, ${walkTo.wz})`,
    );
    pass(`A’s 5 km teleport was refused and answered with a correction (ackSeq ${teleportSeq}) putting A back at ${at(correctedA)}`);

    // Let several snapshot rounds go by, then read what B was told.
    await sleep(Math.ceil(5000 / snapshotHz));
    const teleportsAtB = b.seen((m) => isSnapshot(m) && actorById(m.snapshot, actorA.id)?.at.wx === TELEPORT_WX, markTeleportB);
    assert(teleportsAtB.length === 0, `B saw A at the teleport target in ${teleportsAtB.length} snapshot(s): the refusal did not hold`);
    const heldAtB = b.seen((m) => isSnapshot(m) && actorById(m.snapshot, actorA.id)?.at.wx === walkTo.wx, markTeleportB);
    assert(heldAtB.length > 0, 'B received no snapshot at all after the teleport claim: is the room still ticking?');
    pass(`B never saw the teleport: ${heldAtB.length} snapshots later A is still at ${at(actorById(heldAtB.at(-1).snapshot, actorA.id))}`);

    // ---- 6. B drops and re-attaches inside the grace -----------------------
    const markDropA = a.mark();
    const droppedAt = Date.now();
    b.close();
    await sleep(Math.ceil(8000 / snapshotHz));
    assert(
      a.seen((m) => m.kind === 'leave', markDropA).length === 0,
      'A was told B left the moment B’s link dropped: the disconnect grace did not run',
    );
    const lingering = a.seen((m) => isSnapshot(m) && actorById(m.snapshot, actorB.id) !== undefined, markDropA);
    assert(lingering.length > 0, 'B’s capsule vanished from A’s snapshots as soon as the link dropped');
    pass(`B’s link dropped and its capsule lingered: A saw it in ${lingering.length} snapshots and heard no leave`);

    const b2 = new RelayClient('B (reconnected)', url);
    clients.push(b2);
    await b2.open();
    b2.send({ kind: 'hello', playerId: playerB, name: 'Probe B', color: colorB });
    const welcomeB2 = await b2.waitFor('B’s welcome after reconnecting', isWelcome);
    const elapsed = Date.now() - droppedAt;
    assert(elapsed < graceMs, `the reconnect took ${elapsed} ms, which is past the ${graceMs} ms grace: this proves nothing`);
    assert(welcomeB2.yourId === playerB, `the reconnected B was welcomed as "${welcomeB2.yourId}"`);
    const actorB2 = actorOf(welcomeB2.snapshot, playerB);
    assert(actorB2 !== undefined, 'the reconnected B was given no actor');
    assert(actorB2.id === actorB.id, `the reconnected B was given a NEW actor ${actorB2.id}; it had ${actorB.id}`);
    assert(
      actorB2.color === actorB.color && actorB2.at.wx === actorB.at.wx && actorB2.at.wz === actorB.at.wz,
      `B’s capsule came back changed: ${actorB2.color} at ${at(actorB2)}, was ${actorB.color} at ${at(actorB)}`,
    );
    assert(
      welcomeB2.snapshot.actors.length === 2,
      `the room holds ${welcomeB2.snapshot.actors.length} actors after the reconnect; a third capsule was spawned`,
    );
    pass(`B reconnected ${elapsed} ms later with the same playerId and got the SAME capsule back: ${actorB2.id}, ${actorB2.color}, at ${at(actorB2)}`);

    assert(
      a.seen((m) => m.kind === 'leave', markDropA).length === 0,
      'A was told B left during the reconnect: the re-attach was seen as a leave',
    );
    assert(
      a.seen((m) => m.kind === 'join', markDropA).length === 0,
      'A was told a new actor joined during the reconnect: the re-attach spawned a capsule',
    );
    pass('A saw no leave and no second join across the whole drop: from A’s side B never went away');

    // A clean goodbye from both, so the room empties and stops ticking.
    a.send({ kind: 'bye', playerId: playerA });
    b2.send({ kind: 'bye', playerId: playerB });
    await sleep(100);
  } finally {
    for (const client of clients) client.close();
    await stopWorker(worker);
    rmSync(persistTo, { recursive: true, force: true });
    if (!scratchExisted) rmSync(WRANGLER_SCRATCH, { recursive: true, force: true });
  }
}

const watchdog = setTimeout(() => {
  console.error(`\nrelay probe FAILED: nothing finished within ${WATCHDOG_MS} ms. Something is wedged.`);
  // No waiting and no promises here: whatever is wedged must not get a
  // say in whether the Worker is stopped and the probe exits.
  if (live.worker !== null) signal(live.worker, 'SIGKILL');
  if (live.persistTo !== null) rmSync(live.persistTo, { recursive: true, force: true });
  if (live.scratchToClear !== null) rmSync(live.scratchToClear, { recursive: true, force: true });
  process.exit(1);
}, WATCHDOG_MS);

try {
  await run();
  clearTimeout(watchdog);
  console.log(`\nrelay probe PASSED: ${passed.length} checks against a locally running Worker + Durable Object.`);
  console.log('Two real WebSockets, one room, the authority in charge — no Cloudflare account involved.');
  process.exit(0);
} catch (error) {
  clearTimeout(watchdog);
  console.error(`\nrelay probe FAILED after ${passed.length} passing check(s):`);
  console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
