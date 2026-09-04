/**
 * THE RELAY, RUNNING ON THIS MACHINE: start it, wait until it answers,
 * stop it again — and say plainly why if it will not start.
 *
 * A helper module, not a probe. `scripts/probe-relay.mjs` (two Node
 * sockets against one room) and `scripts/probe-multiplayer.mjs` (two
 * BROWSERS against one room) both need exactly the same three things —
 * a free port, `wrangler dev --local` on it, and `/health` answering —
 * and neither is testing that plumbing: they are testing what happens
 * over it. Two copies of it would drift, and the first sign would be one
 * probe hanging while the other passed.
 *
 * WHAT IT COSTS AND NEEDS: nothing. `wrangler dev --local` runs workerd
 * from the npm package already in `node_modules`. No login, no account,
 * no deploy, no network — which is the point: everything about the relay
 * can be proven before anybody pays for it or trusts it with a phone.
 * Nothing here ever contacts the DEPLOYED relay; a probe that did would
 * be measuring somebody's live server.
 *
 * IT MUST NOT HANG AND IT MUST NOT LIE. Every wait has a timeout, the
 * Worker's own output is kept so a boot failure is reported with the
 * reason wrangler gave, and `stop()` is safe to call on any exit path.
 * `kill()` is the synchronous version for a watchdog, which cannot wait
 * for a promise it may be the reason nobody is resolving.
 *
 * Its Durable Object state goes to a temporary directory that `stop()`
 * deletes, so a probe never collides with a `npm run relay:dev` you have
 * open and never leaves a room's state in the repository.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WRANGLER_CONFIG = 'worker/wrangler.toml';
/** Wrangler writes its scratch state beside the config it was given. */
const WRANGLER_SCRATCH = path.join(ROOT, 'worker', '.wrangler');

/** workerd is compiled and booted on the first run; a cold start is slow, a warm one is a second. */
const BOOT_TIMEOUT_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A port the OS says is free right now. Racy in principle; wrangler's own bind is the real test. */
export function freePort() {
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
 * Start the relay and wait until `/health` answers, or throw saying why
 * not. Resolves to a handle: the port it is on, the parsed `/health`
 * body, `stop()` and `kill()`.
 *
 * `port` may be given (a probe that already picked one); otherwise a free
 * one is chosen here.
 */
export async function startRelay({ port } = {}) {
  if (!existsSync(path.join(ROOT, 'node_modules', 'wrangler'))) {
    throw new Error('wrangler is not installed. Run `npm install` first: the probe runs the relay locally with it.');
  }
  const chosen = port ?? (await freePort());
  // Leave wrangler's scratch alone if it was already there (someone's dev
  // session owns it); clear it if this run is what created it.
  const scratchExisted = existsSync(WRANGLER_SCRATCH);
  const persistTo = mkdtempSync(path.join(tmpdir(), 'traddomium-relay-'));
  const worker = spawnWorker({ port: chosen, persistTo });
  const handle = {
    port: chosen,
    health: null,
    worker,
    output: () => workerOutput(worker),
    stop: async () => {
      await stopWorker(worker);
      rmSync(persistTo, { recursive: true, force: true });
      if (!scratchExisted) rmSync(WRANGLER_SCRATCH, { recursive: true, force: true });
    },
    kill: () => {
      signal(worker, 'SIGKILL');
      rmSync(persistTo, { recursive: true, force: true });
      if (!scratchExisted) rmSync(WRANGLER_SCRATCH, { recursive: true, force: true });
    },
  };
  try {
    handle.health = JSON.parse(await waitForHealth(worker, chosen));
  } catch (error) {
    await handle.stop();
    throw error;
  }
  return handle;
}

/**
 * `wrangler dev --local`, watched. Its output is kept so a failure to
 * boot can be reported with the reason wrangler gave rather than with a
 * timeout and a shrug.
 */
function spawnWorker({ port, persistTo }) {
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
  child.on('exit', (code, signalName) => {
    worker.exit = { code, signal: signalName };
  });
  child.on('error', (error) => {
    worker.exit = { code: null, signal: null, error };
  });
  return worker;
}

/** GET /health over plain http, deliberately not `fetch`: no proxy env var may reach 127.0.0.1. */
export function getHealth(port, timeoutMs) {
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

/** The one command that shows a person what a probe could only report second-hand. */
export const byHand = () => `  Run the relay by hand to see why:  npx wrangler dev --config ${WRANGLER_CONFIG} --local`;

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
