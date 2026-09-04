/**
 * THE MULTIPLAYER PROBE: two real browsers, one real relay, one room —
 * and each of them watching the other move.
 *
 * This is the check the rest of the suite cannot make. `npm test` proves
 * the rules in one process with a loopback wire; `npm run probe:relay`
 * proves the Worker and its Durable Object with two Node sockets; the
 * Network Lab proves two clients against a host in one tab. None of them
 * runs the GAME: the menu, the room screen, the session the wiring
 * builds, the world scene opening a socket, the claims a free-fly camera
 * sends, the capsules `view/` draws for the other player. That whole path
 * exists only in a browser, and until it is driven in one, "multiplayer
 * works" is an inference from parts.
 *
 * So: `wrangler dev --local` on a free port, `vite preview` over the
 * BUILT dist, and TWO browser contexts — separate storage, so separate
 * device profiles and separate player ids, which is what makes them two
 * players rather than one player reconnecting — pointed at the bare URL
 * with `?relay=ws://127.0.0.1:<port>` and driven through the same
 * controls a person touches:
 *
 *   NEW GAME → MULTIPLAYER → the room code → JOIN → the world.
 *
 * Checks, in order:
 *   1. both browsers reach the world (`[data-action="pause"]`) after
 *      typing the SAME room code;
 *   2. both HUDs read `Connected` — which means a welcomed client on an
 *      open socket and nothing more (PerfHud) — and each reports exactly
 *      ONE other player;
 *   3. each browser is DRAWING one remote capsule: a row per capsule mesh
 *      in the scene graph (`REMOTE_CAPSULES_ROLE`), which is a different
 *      fact from the HUD's count and the one a person would actually see;
 *   4. driving A's camera changes the position B reports for A, and B's
 *      capsule ends up where A's own HUD says A is — the point of the
 *      whole feature;
 *   5. closing A leaves B running and honest: B's link is still up, and
 *      once the authority's disconnect grace runs out B stops drawing a
 *      player who is not there any more;
 *   6. neither context logged a console error or threw.
 *
 * Usage:
 *
 *     npm run build && npm run probe:multiplayer
 *
 * The caller runs the build. The probe refuses to run without `dist/`
 * rather than building silently, so "what did I just measure?" has one
 * answer: the dist on disk, the same files GitHub Pages serves.
 *
 * IT NEVER TOUCHES THE DEPLOYED RELAY. `?relay=` points the built game at
 * the Worker this probe started on 127.0.0.1 (that override is what the
 * parameter is for), so nothing here depends on a network, an account or
 * somebody else's live server — and a green run is evidence about THIS
 * commit, not about whatever is deployed.
 *
 * The screenshots are written either way (`shots/multiplayer-a.png`,
 * `shots/multiplayer-b.png`, and `shots/multiplayer-b-alone.png` after A
 * leaves; all gitignored) so a failure leaves evidence. Frame rates here
 * are SwiftShader's, with two worlds sharing one software renderer: they
 * are evidence the loops run, never numbers to tune against.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { startRelay } from './relayHarness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const SHOT_A = path.join(ROOT, 'shots', 'multiplayer-a.png');
const SHOT_B = path.join(ROOT, 'shots', 'multiplayer-b.png');
const SHOT_B_ALONE = path.join(ROOT, 'shots', 'multiplayer-b-alone.png');

/** The design canvas: a phone in landscape at logical size. */
const VIEWPORT = { width: 932, height: 430 };

/**
 * The names the built page answers to. Repeated here rather than imported
 * because a .mjs probe cannot import TypeScript; each one is pinned in a
 * test — `src/app/actions.ts` (ACTION), `src/ui/RoomCodeScene.ts`
 * (ROOM_CODE_FIELD) and `src/perf/PerformanceWorldScene.ts`
 * (REMOTE_CAPSULES_ROLE).
 */
const ACTION = {
  newGame: 'new-game',
  multiplayer: 'multiplayer',
  joinRoom: 'join-room',
  pause: 'pause',
};
const ROOM_CODE_FIELD = 'room:code';
const CAPSULES_ROLE = 'remote-capsules';

/** `HOST_DEFAULTS.graceMs` in src/net/Host.ts: how long a hung-up player's capsule lingers. */
const GRACE_MS = 10_000;

/**
 * Timeouts in milliseconds. TWO three.js worlds share one SwiftShader
 * renderer here, so everything is slower than the boot probe's single
 * page — a frame can take most of a second in each. None of these
 * describe a phone.
 */
const TIMEOUT = {
  menu: 60_000,
  room: 30_000,
  world: 180_000,
  connect: 90_000,
  capsule: 90_000,
  moved: 120_000,
  gone: 90_000,
  /** The splash's own 700 ms fade, with room for a slow first paint. */
  splash: 20_000,
};
/** How often a poll looks again. Slow enough not to fight the frame loop for time. */
const POLL_MS = 500;

/** The whole run. Past this something is wedged, and a stuck probe helps nobody. */
const WATCHDOG_MS = 600_000;

/**
 * HOW A IS FLOWN, and why slowly.
 *
 * The authority pays for travel at 150 world units a second and banks a
 * quarter second of it, so no single claim may spend more than 37.5 units
 * (`HOST_DEFAULTS`, `DEBUG_CAPSULE_TUNING`). A claim carries a whole
 * frame's flying, and under SwiftShader — with two worlds sharing one
 * software renderer — a frame can be most of a second long. At the
 * camera's default 40 units/s that is already close to the budget, and a
 * refused claim would say something about this probe's frame rate rather
 * than about the wire.
 *
 * So the wheel takes the camera down to about 7 units/s first, where a
 * frame would have to last five seconds to outrun the budget, and then W
 * is simply held. The probe looks at B after every slice and stops as
 * soon as B has seen the movement.
 */
const WHEEL_NOTCHES = 8;
const WHEEL_DELTA = 100;
const FLY_SLICES = 12;
const FLY_SLICE_MS = 1_000;

/**
 * Radians of turn per pixel of drag (`LOOK_RADIANS_PER_PIXEL` in
 * `src/perf/FreeFlyCamera.ts`, at the default look sensitivity), and how
 * long the button is held. The camera reads a drag on the frame it is
 * held down, so the button must stay down across one — at a frame and a
 * half a second, a drag that ends between frames is a drag the camera
 * never saw.
 */
const RADIANS_PER_PIXEL = 0.0035;
const DRAG_HOLD_MS = 1_500;
/** Kept inside the viewport; a longer turn is several drags. */
const DRAG_MAX_PX = 300;
/** World units. Bigger than a capsule's radius, so "it moved" cannot be interpolation wobble. */
const MOVED_UNITS = 8;
/**
 * How far apart A's own camera and B's picture of it may end up. The
 * replica draws `INTERPOLATION_MS` behind receipt and a slow frame adds
 * another claim interval, so a few units of lag is correct behaviour, not
 * a fault. Generous on purpose: this check is "B is drawing A where A
 * is", not a latency measurement.
 */
const AGREEMENT_UNITS = 60;

/** Carried from v0's probes: what Playwright's Chromium needs to give three a WebGL context here. */
const CHROMIUM_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--disable-dev-shm-usage',
  // TWO pages must keep animating at once. Chromium throttles rAF in a
  // page it thinks is in the background, and exactly one of these two can
  // be in front — without these the page that is not focused stops
  // stepping its world and the probe would measure the throttle.
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

/** What the watchdog has to clean up if the run never reaches its own `finally`. */
const live = { relay: null };

const failures = [];
const log = (message) => console.log(`[probe:multiplayer] ${message}`);
const fail = (message) => {
  failures.push(message);
  console.error(`[probe:multiplayer] FAIL: ${message}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Never `playwright install`: the browser is preinstalled. An explicit
 * override first (`PLAYWRIGHT_CHROMIUM`), then Playwright's own pinned
 * path when it exists, then the `chromium` symlink under
 * `PLAYWRIGHT_BROWSERS_PATH`. Anything else is a clear failure, not a
 * download. (The same rule as `scripts/probe-boot.mjs`.)
 */
function chromiumPath() {
  const override = process.env.PLAYWRIGHT_CHROMIUM;
  if (override) {
    if (existsSync(override)) return override;
    throw new Error(`PLAYWRIGHT_CHROMIUM=${override} does not exist`);
  }
  const pinned = chromium.executablePath();
  if (existsSync(pinned)) return undefined;
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const linked = browsers ? path.join(browsers, 'chromium') : null;
  if (linked && existsSync(linked)) return linked;
  throw new Error(
    `no Chromium found. Playwright expects ${pinned}; ${linked ?? 'PLAYWRIGHT_BROWSERS_PATH is unset'} is absent too. ` +
      'Point PLAYWRIGHT_CHROMIUM at a chrome binary — this probe never runs `playwright install`.',
  );
}

// ---------------------------------------------------------------------------
// One player: a browser context of its own, and the few things it can be
// asked about itself
// ---------------------------------------------------------------------------

/**
 * A player is a CONTEXT, not a tab: a context has its own storage, so it
 * has its own device profile and therefore its own PlayerId. Two tabs of
 * one context would be one player rejoining, which is a different test
 * (`probe:relay` check 6) and would prove nothing about two people.
 */
class Player {
  constructor(label, context, page) {
    this.label = label;
    this.context = context;
    this.page = page;
    this.consoleErrors = [];
    this.pageErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') this.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => this.pageErrors.push(error.message));
  }

  static async open(browser, label, url) {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    const player = new Player(label, context, page);
    await page.goto(url, { waitUntil: 'load' });
    return player;
  }

  /** What the player can read right now, whitespace collapsed, for messages. */
  async uiText() {
    const text = await this.page.evaluate(() => (document.getElementById('ui') ?? document.body).innerText);
    return text.replace(/\s+/g, ' ').trim();
  }

  /** One `[data-field]` of the perf HUD as its words, or '' when it is not there yet. */
  async field(name) {
    return this.page.evaluate(
      (field) => document.querySelector(`[data-field="${field}"]`)?.textContent?.trim() ?? '',
      name,
    );
  }

  /**
   * The capsules this page is DRAWING: one row per mesh in the world's
   * `remote-actors` group, with that mesh's own render position. The
   * scene graph's truth, not the wire's.
   */
  async capsules(role) {
    return this.page.evaluate((r) => {
      const rows = document.querySelectorAll(`[data-role="${r}"] [data-capsule]`);
      return [...rows].map((row) => ({
        capsule: row.dataset.capsule ?? '',
        lx: Number(row.dataset.lx),
        ly: Number(row.dataset.ly),
        lz: Number(row.dataset.lz),
      }));
    }, role);
  }

  /** Where this player's own camera is, from the HUD: "x -1.0  y 25.0  z 40.0". */
  async cameraAt() {
    const text = await this.field('camera-position');
    const numbers = [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    return numbers.length === 3 ? { x: numbers[0], y: numbers[1], z: numbers[2] } : null;
  }

  async click(action, timeout) {
    await this.page.click(`[data-action="${action}"]`, { timeout });
  }

  async close() {
    await this.context.close();
  }
}

/** Poll `read` until `ready` says so, or give up and say what was last seen. */
async function until(what, read, ready, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await read();
    if (ready(last)) return { ok: true, value: last };
    if (Date.now() >= deadline) return { ok: false, value: last };
    await sleep(POLL_MS);
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** Menu → NEW GAME → MULTIPLAYER → this room code → JOIN → the world. */
async function joinRoom(player, code) {
  log(`${player.label}: opening the game`);
  await player.page.waitForSelector(`[data-action="${ACTION.newGame}"]`, { timeout: TIMEOUT.menu });
  // The menu is BEHIND the document-painted boot splash until main.ts
  // takes it down; clicking through it would be clicking at artwork.
  await player.page.waitForSelector('#boot', { state: 'detached', timeout: TIMEOUT.splash }).catch(() => {
    fail(`${player.label}: the boot splash never came down`);
  });
  await player.click(ACTION.newGame, TIMEOUT.menu);

  // A build with a relay offers rooms; one without would start the mock
  // here, and the room field below would never appear. Saying which is
  // the difference between "the wiring is wrong" and "this build has no
  // relay in it", so the probe reports what it sees.
  await player.click(ACTION.multiplayer, TIMEOUT.menu);
  try {
    await player.page.waitForSelector(`[data-action="${ROOM_CODE_FIELD}"]`, { timeout: TIMEOUT.room });
  } catch {
    throw new Error(
      `${player.label}: MULTIPLAYER did not lead to a room code field within ${TIMEOUT.room / 1000} s. ` +
        `Is a relay compiled in, and did ?relay= reach it? UI reads: "${await player.uiText()}"`,
    );
  }
  // The same string in both browsers: that IS the room.
  await player.page.fill(`[data-action="${ROOM_CODE_FIELD}"]`, code);
  await player.click(ACTION.joinRoom, TIMEOUT.menu);
  try {
    await player.page.waitForSelector(`[data-action="${ACTION.pause}"]`, { timeout: TIMEOUT.world });
  } catch {
    throw new Error(
      `${player.label}: JOIN did not reach the world within ${TIMEOUT.world / 1000} s. ` +
        `UI reads: "${await player.uiText()}"`,
    );
  }
  log(`${player.label}: is in the world, room "${code}"`);
}

/** Wait for the HUD's SESSION line to say the link is up, and read the whole line back. */
async function waitConnected(player) {
  const seen = await until(
    `${player.label} connected`,
    () => player.field('session'),
    (line) => line.startsWith('Connected'),
    TIMEOUT.connect,
  );
  if (!seen.ok) {
    fail(`${player.label}: the HUD never said Connected within ${TIMEOUT.connect / 1000} s; it reads "${seen.value}"`);
    return null;
  }
  log(`${player.label}: SESSION reads "${seen.value}"`);
  return seen.value;
}

/** Wait until this page is drawing exactly one other capsule, and hand back the row. */
async function waitOneCapsule(player) {
  const seen = await until(
    `${player.label} draws one capsule`,
    () => player.capsules(CAPSULES_ROLE),
    (rows) => rows.length === 1,
    TIMEOUT.capsule,
  );
  if (!seen.ok) {
    fail(
      `${player.label}: after ${TIMEOUT.capsule / 1000} s it is drawing ${seen.value.length} remote capsule(s), ` +
        'not 1: the other player is not on screen',
    );
    return null;
  }
  log(`${player.label}: is drawing ${seen.value[0].capsule} at (${seen.value[0].lx}, ${seen.value[0].lz})`);
  return seen.value[0];
}

/**
 * Turn a player's camera by dragging, the way a thumb does. Best effort
 * and never a failure: it is here so each screenshot shows the OTHER
 * player's capsule rather than an empty grid, and so A flies toward B
 * instead of away. Nothing asserted below depends on where anyone is
 * looking.
 */
async function look(player, radians) {
  let pixels = -radians / RADIANS_PER_PIXEL;
  const y = VIEWPORT.height / 2;
  while (Math.abs(pixels) > 1) {
    const chunk = Math.max(-DRAG_MAX_PX, Math.min(DRAG_MAX_PX, pixels));
    const from = VIEWPORT.width / 2 - chunk / 2;
    await player.page.mouse.move(from, y);
    await player.page.mouse.down();
    await player.page.mouse.move(from + chunk, y, { steps: 8 });
    // Held across a frame, because the camera reads the drag while the
    // button is down and forgets it once it is up.
    await sleep(DRAG_HOLD_MS);
    await player.page.mouse.up();
    pixels -= chunk;
  }
}

/**
 * Point `player` at `target`. The camera looks down -Z at yaw 0 and the
 * world's spawn points are known only at run time, so the angle is worked
 * out from what the page itself reports: its own camera position, and the
 * capsule row it is drawing for the other player.
 */
async function aimAt(player, target) {
  const from = await player.cameraAt();
  if (from === null) return;
  const yaw = Math.atan2(-(target.lx - from.x), -(target.lz - from.z));
  // The camera keeps START's yaw of 0 when it adopts its spawn, so the
  // turn needed is the bearing itself.
  await look(player, yaw);
  log(`${player.label}: turned ${(yaw * (180 / Math.PI)).toFixed(0)}° toward the other player`);
}

/**
 * Fly A forward until B sees it, or until the slices run out. Returns what
 * B last reported, so the caller can say how far it moved.
 */
async function flyUntilSeen(a, b, from) {
  const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
  await a.page.mouse.move(centre.x, centre.y);
  for (let i = 0; i < WHEEL_NOTCHES; i += 1) await a.page.mouse.wheel(0, WHEEL_DELTA);
  await sleep(POLL_MS);
  log(`A: camera speed is now "${await a.field('camera-speed')}" (slowed so no single claim outruns the budget)`);

  let seenMoving = null;
  await a.page.keyboard.down('KeyW');
  try {
    for (let slice = 1; slice <= FLY_SLICES; slice += 1) {
      await sleep(FLY_SLICE_MS);
      const now = (await b.capsules(CAPSULES_ROLE))[0];
      if (now === undefined) continue;
      if (Math.hypot(now.lx - from.lx, now.lz - from.lz) >= MOVED_UNITS) {
        log(`A flew for ${slice} s and B saw it`);
        seenMoving = now;
        break;
      }
    }
  } finally {
    await a.page.keyboard.up('KeyW');
  }
  if (seenMoving !== null) return seenMoving;
  // Flying is done; give the wire a last few seconds in case the frames
  // were very slow rather than the movement missing.
  const seen = await until(
    'B to see A move',
    () => b.capsules(CAPSULES_ROLE),
    (rows) => rows.length === 1 && Math.hypot(rows[0].lx - from.lx, rows[0].lz - from.lz) >= MOVED_UNITS,
    TIMEOUT.moved,
  );
  return seen.ok ? seen.value[0] : null;
}

async function drive(browser, url, code) {
  const a = await Player.open(browser, 'A', url);
  const b = await Player.open(browser, 'B', url);
  try {
    // ---- 1. both reach the world through the same code --------------------
    await joinRoom(a, code);
    await joinRoom(b, code);

    // ---- 2. both are connected, and each sees exactly one other player ----
    const lineA = await waitConnected(a);
    const lineB = await waitConnected(b);
    for (const [label, line] of [['A', lineA], ['B', lineB]]) {
      if (line !== null && !/\b1 other player\b/.test(line)) {
        const others = await until(
          `${label} to see one other player`,
          () => (label === 'A' ? a : b).field('session'),
          (text) => /\b1 other player\b/.test(text),
          TIMEOUT.connect,
        );
        if (!others.ok) {
          fail(`${label}: the HUD reads "${others.value}"; expected it to report exactly 1 other player`);
        } else {
          log(`${label}: SESSION now reads "${others.value}"`);
        }
      }
    }

    // ---- 3. and each is DRAWING that player's capsule ---------------------
    const seenByA = await waitOneCapsule(a);
    const seenByB = await waitOneCapsule(b);
    if (seenByA !== null && seenByB !== null && seenByA.capsule === seenByB.capsule) {
      fail(
        `both browsers are drawing the same capsule (${seenByA.capsule}): they are looking at one actor, ` +
          'so this is one player twice over rather than two players',
      );
    }
    // A REFUSED CLAIM BEFORE ANYONE HAS MOVED means the world and the
    // authority disagree about where this player joined — the seam that
    // makes a player a statue on every other screen. Nothing has flown
    // yet, so there is nothing else it could be.
    for (const player of [a, b]) {
      const line = await player.field('session');
      if (/refused/.test(line)) {
        fail(
          `${player.label} had claims refused before flying anywhere: "${line}". The camera and the actor the ` +
            'authority spawned are not in the same place, so nothing this player does will ever be accepted.',
        );
      }
    }

    // Turn each camera toward the other, so the pictures show what the
    // rows above assert: another player's capsule, on screen.
    if (seenByA !== null) await aimAt(a, seenByA);
    if (seenByB !== null) await aimAt(b, seenByB);
    await screenshot(a.page, SHOT_A);
    await screenshot(b.page, SHOT_B);

    // ---- 4. A moves, and B's picture of A moves with it -------------------
    if (seenByB === null) return;
    // Read B's picture of A again after the turning: that is the baseline
    // the movement is measured from.
    const baseline = (await b.capsules(CAPSULES_ROLE))[0] ?? seenByB;
    const before = await a.cameraAt();
    const after = await flyUntilSeen(a, b, baseline);
    const cameraNow = await a.cameraAt();
    if (before === null || cameraNow === null) {
      fail("A's own camera readout could not be read, so there is nothing to compare B's picture against");
      return;
    }
    const flew = Math.hypot(cameraNow.x - before.x, cameraNow.z - before.z);
    if (flew < MOVED_UNITS) {
      fail(
        `A's own camera barely moved (${flew.toFixed(1)} units): the keyboard never reached the page, so this run ` +
          'says nothing about whether B would have seen it',
      );
      return;
    }
    log(`A's camera moved ${flew.toFixed(1)} units, to x ${cameraNow.x}, z ${cameraNow.z}`);
    if (after === null) {
      fail(`B never saw A move: B still draws A at (${baseline.lx}, ${baseline.lz}) while A flew ${flew.toFixed(1)} units`);
      return;
    }
    const moved = Math.hypot(after.lx - baseline.lx, after.lz - baseline.lz);
    const apart = Math.hypot(after.lx - cameraNow.x, after.lz - cameraNow.z);
    if (apart > AGREEMENT_UNITS) {
      fail(
        `B draws A at (${after.lx}, ${after.lz}) while A's own camera is at (${cameraNow.x}, ${cameraNow.z}): ` +
          `${apart.toFixed(1)} units apart, which is further than interpolation and one claim can explain`,
      );
    } else {
      log(
        `B followed A: its capsule moved ${moved.toFixed(1)} units to (${after.lx}, ${after.lz}), ` +
          `${apart.toFixed(1)} units from where A says it is`,
      );
    }
    log(`A's SESSION line after flying: "${await a.field('session')}"`);

    // ---- 5. A leaves; B keeps running and stops drawing a ghost -----------
    log('closing A');
    await a.close();
    const gone = await until(
      'B to stop drawing A',
      async () => ({ rows: await b.capsules(CAPSULES_ROLE), line: await b.field('session') }),
      (state) => state.rows.length === 0,
      GRACE_MS + TIMEOUT.gone,
    );
    if (!gone.ok) {
      fail(
        `${GRACE_MS / 1000} s of grace and ${TIMEOUT.gone / 1000} s later B still draws ${gone.value.rows.length} ` +
          `capsule(s) for a player who left; its HUD reads "${gone.value.line}"`,
      );
    } else if (!gone.value.line.startsWith('Connected')) {
      fail(`after A left, B's own link reads "${gone.value.line}"; B was not the one who hung up`);
    } else {
      log(`A left; B is still up and honest about it: "${gone.value.line}"`);
    }
    await screenshot(b.page, SHOT_B_ALONE);
  } finally {
    for (const player of [a, b]) {
      for (const message of player.consoleErrors) fail(`${player.label} console error: ${message}`);
      for (const message of player.pageErrors) fail(`${player.label} uncaught page error: ${message}`);
    }
    await b.close().catch(() => {});
    await a.close().catch(() => {});
  }
}

async function screenshot(page, file) {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file });
    log(`screenshot saved to ${path.relative(ROOT, file)}`);
  } catch (error) {
    fail(`screenshot could not be saved: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  if (!existsSync(DIST_INDEX)) {
    fail(
      'dist/index.html is missing. Run `npm run build` first: the probe measures the built output, the same files ' +
        'GitHub Pages serves.',
    );
    return;
  }

  let relay = null;
  let server = null;
  let browser = null;
  try {
    relay = await startRelay();
    live.relay = relay;
    log(`the relay is up on 127.0.0.1:${relay.port} (v${relay.health.version}, ${relay.health.protocol.snapshotHz} Hz)`);

    // vite's own preview server, in-process: the same thing `vite preview`
    // runs, minus a child process to babysit.
    server = await preview({
      root: ROOT,
      logLevel: 'silent',
      preview: { host: '127.0.0.1', port: 4183, strictPort: false, open: false },
    });
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error('vite preview started but reported no local URL');
    // THE OVERRIDE IS THE POINT: the built game carries the deployed relay
    // (vite.config.ts), and `?relay=` is how a developer — or this probe —
    // points that same build at a relay on this machine instead.
    const url = `${base}${base.endsWith('/') ? '' : '/'}?relay=ws://127.0.0.1:${relay.port}`;
    log(`serving dist/ at ${base}, pointing both browsers at ${url}`);

    browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
    log(`chromium ${browser.version()}`);

    // A fresh code per run, so nothing from an earlier run or an open
    // `npm run relay:dev` can be mistaken for this room. Lower case,
    // alphanumeric and a hyphen: the relay's own rule (worker/src/roomCode.ts).
    const room = `probe-${randomBytes(3).toString('hex')}`;
    await drive(browser, url, room);
  } catch (error) {
    fail(`unexpected: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  } finally {
    await browser?.close();
    await server?.close();
    await relay?.stop();
  }
}

const watchdog = setTimeout(() => {
  console.error(`[probe:multiplayer] FAIL: nothing finished within ${WATCHDOG_MS / 1000} s. Something is wedged.`);
  // No waiting and no promises here: whatever is wedged must not get a say
  // in whether the Worker is stopped and the probe exits.
  live.relay?.kill();
  process.exit(1);
}, WATCHDOG_MS);

await main();
clearTimeout(watchdog);

if (failures.length > 0) {
  console.error(`[probe:multiplayer] ${failures.length} check(s) failed.`);
  process.exitCode = 1;
} else {
  log(
    'PASS: two browsers, one room on a locally running relay — each connected, each drawing the other, ' +
      "A's flight followed on B's screen, A's exit leaving B up and honest, zero console errors.",
  );
}
