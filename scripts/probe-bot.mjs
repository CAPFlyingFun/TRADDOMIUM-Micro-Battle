/**
 * ONE BROWSER, AND SOMEBODY ELSE IN THE ROOM.
 *
 * Joshua joined a room on his phone and was the only one in it
 * (2026-09-04), and asked for a scripted player that walks about for five
 * minutes and draws its controls on screen. This probe is the proof that
 * it works from ONE device: a single browser turns the practice-bot
 * switch on, joins a room on a relay running on this machine, and the
 * probe then asks the page — not the bot — whether anybody is there.
 *
 * WHY THAT IS A DIFFERENT TEST FROM `probe:multiplayer`. That one drives
 * two browser contexts and proves two people can see each other. This one
 * proves the thing a person alone can actually do, and it proves it the
 * hard way round: the bot opens its OWN socket to the relay, so what the
 * page draws is a capsule built from snapshots that came back off the
 * wire. If the bot were faked locally the capsule would appear whether or
 * not a byte ever left the machine, and this probe would pass while
 * saying nothing.
 *
 * WHAT IT ASSERTS
 *   1. The room screen offers the practice-bot switch, it starts Off, and
 *      THE PANEL STILL FITS: a switch is another row, and this project has
 *      already shipped a menu whose lowest rows were below the fold. jsdom
 *      does no layout, so only a real browser can catch it.
 *   2. With it On, JOIN reaches the world and the HUD says `Connected`
 *      with exactly ONE other player — the bot, arriving over the relay.
 *   3. The page is DRAWING that capsule: a row in the world's hidden
 *      remote-capsule list, which is the scene graph's own truth and a
 *      different fact from the HUD's count.
 *   4. The capsule MOVES: its drawn position changes by more than a
 *      capsule's width, so what is on screen is a walking player and not
 *      a stationary marker.
 *   5. It is IN FRONT OF THE CAMERA: the angle between where the camera
 *      looks and where the capsule is stays inside the view. The first
 *      version of this feature placed the bot perfectly and left it off
 *      the edge of the screen, which a screenshot is a poor way to catch
 *      and a number is a good one.
 *   6. The bot's panel is on screen, counting down, and its control cells
 *      LIGHT: at least two different cells come on over the run, which is
 *      the thing Joshua asked to be able to see.
 *   7. The panel says, in words, that it is not a person.
 *   8. Nothing logged a console error and nothing threw.
 *
 * Two screenshots: the room screen with the switch on
 * (`shots/practice-bot-room.png`) and the world with the bot in it
 * (`shots/practice-bot.png`). The second is written either way, because a
 * failed run is exactly when somebody wants to look at the screen.
 *
 * It needs a build (`npm run build`) and nothing else: the relay is
 * started here with workerd out of `node_modules`, and the DEPLOYED relay
 * is never contacted.
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
const SHOT = path.join(ROOT, 'shots', 'practice-bot.png');
const SHOT_ROOM = path.join(ROOT, 'shots', 'practice-bot-room.png');

/** The design canvas: a phone in landscape at logical size. */
const VIEWPORT = { width: 932, height: 430 };

/**
 * The names the built page answers to. Repeated here rather than imported
 * because a .mjs probe cannot import TypeScript; each one is pinned in a
 * test — `src/app/actions.ts` (ACTION), `src/ui/RoomCodeScene.ts`
 * (ROOM_CODE_FIELD, PRACTICE_BOT_FIELD), `src/perf/BotHud.ts` (the panel
 * and its cells) and `src/perf/PerformanceWorldScene.ts`
 * (REMOTE_CAPSULES_ROLE).
 */
const ACTION = {
  newGame: 'new-game',
  multiplayer: 'multiplayer',
  joinRoom: 'join-room',
  pause: 'pause',
};
const ROOM_CODE_FIELD = 'room:code';
const PRACTICE_BOT_FIELD = 'room:practice-bot';
const CAPSULES_ROLE = 'remote-capsules';
const BOT_HUD_ROLE = 'bot-hud';

/**
 * Timeouts in milliseconds. One world on SwiftShader is faster than
 * `probe:multiplayer`'s two, but a frame is still most of a second. None
 * of these describe a phone.
 */
const TIMEOUT = {
  menu: 60_000,
  room: 30_000,
  world: 120_000,
  connect: 90_000,
  capsule: 90_000,
  moved: 120_000,
  cells: 120_000,
  splash: 20_000,
};
const POLL_MS = 500;
const WATCHDOG_MS = 480_000;

/**
 * World units. A capsule is about a unit across at this scale, so eight
 * is comfortably "it walked" rather than interpolation wobble. The patrol
 * covers 150 units a side, so this is reached in the first second or two
 * of a leg.
 */
const MOVED_UNITS = 8;
/** How many different control cells must light before the run is satisfied. */
const CELLS_WANTED = 2;
/**
 * Degrees. The viewport is 932 x 430, so the horizontal field of view is
 * wide — a little over a hundred degrees — and half of it is about fifty.
 * Forty is comfortably inside the frame rather than on its edge.
 */
const IN_FRAME_DEGREES = 40;

/** Carried from v0's probes: what Playwright's Chromium needs to give three a WebGL context here. */
const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'];

/** What the watchdog has to clean up if the run never reaches its own `finally`. */
const live = { relay: null };

const failures = [];
const log = (message) => console.log(`[probe:bot] ${message}`);
const fail = (message) => {
  failures.push(message);
  console.error(`[probe:bot] FAIL: ${message}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The same rule as `scripts/probe-boot.mjs`: never `playwright install`. */
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

/** Poll `read` until `ready` says so, or give up and say what was last seen. */
async function until(read, ready, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ready(value)) return { ok: true, value };
    if (Date.now() >= deadline) return { ok: false, value };
    await sleep(POLL_MS);
  }
}

/** One `[data-field]` as its words, or '' when it is not on the page. */
const field = (page, name) =>
  page.evaluate((f) => document.querySelector(`[data-field="${f}"]`)?.textContent?.trim() ?? '', name);

/** The capsules the page is DRAWING, from the world's own instrumentation list. */
const capsules = (page) =>
  page.evaluate((role) => {
    const rows = document.querySelectorAll(`[data-role="${role}"] [data-capsule]`);
    return [...rows].map((row) => ({
      capsule: row.dataset.capsule ?? '',
      lx: Number(row.dataset.lx),
      lz: Number(row.dataset.lz),
    }));
  }, CAPSULES_ROLE);

/** Where the camera is and which way it LOOKS, from the perf HUD's own readout. */
async function camera(page) {
  const position = await field(page, 'camera-position');
  const facing = await field(page, 'camera-facing');
  const p = [...position.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  const f = /(-?\d+(?:\.\d+)?)/.exec(facing);
  if (p.length !== 3 || f === null) return null;
  return { x: p[0], z: p[2], facing: Number(f[1]) };
}

/** Degrees between where the camera looks and where something is, 0 (dead ahead) .. 180 (behind). */
function offAxis(cam, at) {
  // The heading convention the world uses: ahead is (sin h, cos h) in (x, z).
  const toIt = (Math.atan2(at.lx - cam.x, at.lz - cam.z) * 180) / Math.PI;
  // The shorter way round between two bearings, unsigned.
  return Math.abs((((toIt - cam.facing) % 360) + 540) % 360 - 180);
}

/**
 * The panel a player is looking at must not be taller than the screen.
 * The same measurement `probe:boot` makes of the menu, made here of the
 * room screen, because that is the panel this change adds a row to.
 */
async function checkPanelFits(page, where) {
  const panel = page.locator('.ui-panel').first();
  if ((await panel.count()) === 0) {
    fail(`no .ui-panel to measure on the ${where}`);
    return;
  }
  const size = await panel.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  const over = size.scroll - size.client;
  if (over > 1) {
    fail(
      `the ${where} panel overflows by ${over} px at ${VIEWPORT.width}x${VIEWPORT.height} ` +
        `(content ${size.scroll} px in ${size.client} px): its lowest rows are below the fold`,
    );
  } else {
    log(`the ${where} fits the ${VIEWPORT.width}x${VIEWPORT.height} canvas (${size.scroll} px of ${size.client} px)`);
  }
}

/**
 * Does an overlay fit ON the screen? Not the same question as whether a
 * panel's content fits INSIDE it: an absolutely-positioned HUD sized by
 * its own content simply runs off the edge, and nothing scrolls or
 * clips to tell you. The SESSION line only reaches its full length when
 * somebody else is in the room, which is exactly what a practice bot
 * creates — so this is the run that would notice.
 */
async function checkOnScreen(page, role, what) {
  const box = await page.evaluate((r) => {
    const el = document.querySelector(`[data-role="${r}"]`);
    if (el === null) return null;
    const b = el.getBoundingClientRect();
    return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
  }, role);
  if (box === null) {
    fail(`no [data-role="${role}"] to measure`);
    return null;
  }
  const over = [];
  if (box.right > VIEWPORT.width + 1) over.push(`${Math.round(box.right - VIEWPORT.width)} px past the right edge`);
  if (box.bottom > VIEWPORT.height + 1) over.push(`${Math.round(box.bottom - VIEWPORT.height)} px below the bottom`);
  if (box.left < -1) over.push(`${Math.round(-box.left)} px past the left edge`);
  if (box.top < -1) over.push(`${Math.round(-box.top)} px above the top`);
  if (over.length > 0) {
    fail(`the ${what} runs off the screen: ${over.join(', ')} at ${VIEWPORT.width}x${VIEWPORT.height}`);
  } else {
    log(`the ${what} fits on screen (${Math.round(box.right - box.left)} x ${Math.round(box.bottom - box.top)} px)`);
  }
  return box;
}

/**
 * Do two overlays sit on top of each other? Fitting the screen is not
 * the same as being readable: the perf HUD grows to the right with the
 * SESSION line, and the PAUSE button is pinned to the right edge, so the
 * two meet exactly when somebody else is in the room.
 */
async function checkNoOverlap(page, a, b, what) {
  const boxes = await page.evaluate(([sa, sb]) => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    return [rect(sa), rect(sb)];
  }, [a, b]);
  const [x, y] = boxes;
  if (x === null || y === null) {
    fail(`cannot measure ${what}: ${x === null ? a : b} is not on the page`);
    return;
  }
  const wide = Math.min(x.right, y.right) - Math.max(x.left, y.left);
  const tall = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
  if (wide > 1 && tall > 1) {
    fail(`${what} overlap by ${Math.round(wide)} x ${Math.round(tall)} px: one is drawn over the other`);
  } else {
    log(`${what} do not overlap`);
  }
}

/** Which control cells are lit right now, by id. */
const litCells = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-cell]')].filter((c) => c.dataset.lit === 'true').map((c) => c.dataset.cell),
  );


/**
 * THE BOTTOM-LEFT BELONGS TO THE THUMB — and the test is whether a finger
 * REACHES THE CAMERA, not where a box sits.
 *
 * `FreeFlyCamera`'s touch control is twin-zone: a drag that STARTS on the
 * left half of the screen is the virtual stick that moves you. `index.html`
 * gives every direct child of #ui `pointer-events:auto`, so an overlay
 * there does not merely sit in front of that gesture — it swallows it,
 * which is what Joshua hit on the device (2026-09-05).
 *
 * So this asks the DOM the same question the browser asks when a finger
 * lands: at points across the move zone, what would receive the touch? If
 * anything inside the bot panel would, the panel is in the way — however
 * it is positioned, and however it is later moved.
 */
async function checkThumbReachesCamera(page, what) {
  const blocked = await page.evaluate(
    ({ w, h }) => {
      const points = [];
      for (const fx of [0.08, 0.25, 0.42]) {
        for (const fy of [0.55, 0.72, 0.9]) points.push([Math.round(w * fx), Math.round(h * fy)]);
      }
      return points
        .filter(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return hit !== null && hit.closest('[data-role="bot-hud"]') !== null;
        })
        .map(([x, y]) => `${x},${y}`);
    },
    { w: VIEWPORT.width, h: VIEWPORT.height },
  );
  if (blocked.length > 0) {
    fail(`${what} would receive the touch at ${blocked.join(' and ')} — those are in the move zone, so the camera never gets the drag`);
  } else {
    log(`${what} lets the moving thumb through at every point tested in the bottom-left move zone`);
  }
}

async function run(browser, url, room) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    log('opening the game');
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector(`[data-action="${ACTION.newGame}"]`, { timeout: TIMEOUT.menu });
    // The menu is BEHIND the document-painted boot splash until main.ts
    // takes it down; clicking through it would be clicking at artwork.
    await page.waitForSelector('#boot', { state: 'detached', timeout: TIMEOUT.splash }).catch(() => {
      fail('the boot splash never came down');
    });
    await page.click(`[data-action="${ACTION.newGame}"]`, { timeout: TIMEOUT.menu });
    await page.click(`[data-action="${ACTION.multiplayer}"]`, { timeout: TIMEOUT.menu });

    try {
      await page.waitForSelector(`[data-action="${ROOM_CODE_FIELD}"]`, { timeout: TIMEOUT.room });
    } catch {
      throw new Error(
        `MULTIPLAYER did not lead to a room code field within ${TIMEOUT.room / 1000} s. ` +
          'Is a relay compiled in, and did ?relay= reach it?',
      );
    }

    // CHECK 1: the switch is there, and a room does not quietly come with
    // a scripted player in it.
    const toggle = page.locator(`[data-action="${PRACTICE_BOT_FIELD}"]`);
    if ((await toggle.count()) === 0) {
      throw new Error('the room screen has no practice-bot switch');
    }
    const before = (await toggle.textContent())?.trim();
    if (before !== 'Off') fail(`the practice-bot switch starts at "${before}", not Off`);
    else log('the practice-bot switch is on the room screen and starts Off');

    await toggle.click({ timeout: TIMEOUT.menu });
    const after = (await toggle.textContent())?.trim();
    if (after !== 'On') fail(`the practice-bot switch reads "${after}" after a tap, not On`);

    // With the switch on and its row on screen: does the whole thing fit?
    await checkPanelFits(page, 'room screen');
    await screenshot(page, SHOT_ROOM);

    await page.fill(`[data-action="${ROOM_CODE_FIELD}"]`, room);
    await page.click(`[data-action="${ACTION.joinRoom}"]`, { timeout: TIMEOUT.menu });
    try {
      await page.waitForSelector(`[data-action="${ACTION.pause}"]`, { timeout: TIMEOUT.world });
    } catch {
      throw new Error(`JOIN did not reach the world within ${TIMEOUT.world / 1000} s`);
    }
    log(`is in the world, room "${room}"`);

    // CHECK 2: the HUD says the wire brought exactly one other player.
    const session = await until(
      () => field(page, 'session'),
      (line) => line.startsWith('Connected') && line.includes('1 other player'),
      TIMEOUT.connect,
    );
    if (!session.ok) {
      fail(
        `the HUD never said Connected with one other player within ${TIMEOUT.connect / 1000} s; ` +
          `it reads "${session.value}"`,
      );
    } else {
      log(`SESSION reads "${session.value}" — the bot joined over the relay`);
    }

    // CHECK 3: and the page is DRAWING it. A join that arrived is not yet
    // a capsule on screen, and the second fact is the one that matters.
    const drawn = await until(() => capsules(page), (list) => list.length === 1, TIMEOUT.capsule);
    if (!drawn.ok) {
      // Everything after this reads that one row, so there is nothing left
      // to measure: say so once rather than throwing a TypeError over it.
      fail(`the world is drawing ${drawn.value.length} remote capsules, not 1`);
      return;
    }
    const [only] = drawn.value;
    log(`drawing ${only.capsule} at (${only.lx}, ${only.lz})`);

    // CHECK 4: it walks. The patrol's first leg is 150 units long, so a
    // few seconds of it is well past the threshold.
    const start = drawn.value[0];
    const moved = await until(
      () => capsules(page),
      (list) => list.length === 1 && Math.hypot(list[0].lx - start.lx, list[0].lz - start.lz) > MOVED_UNITS,
      TIMEOUT.moved,
    );
    if (!moved.ok) {
      fail(`the bot's capsule never moved more than ${MOVED_UNITS} units; it is a statue, or its claims are refused`);
    } else {
      const now = moved.value[0];
      const distance = Math.hypot(now.lx - start.lx, now.lz - start.lz);
      log(`the bot walked ${distance.toFixed(1)} units, to (${now.lx}, ${now.lz})`);
    }

    // CHECK 5: it is where a person can see it. Polled rather than read
    // once, because the world turns to keep it in frame and a single
    // reading could catch the turn mid-way.
    const framed = await until(
      async () => {
        const cam = await camera(page);
        const list = await capsules(page);
        return cam === null || list.length !== 1 ? null : offAxis(cam, list[0]);
      },
      (angle) => angle !== null && angle <= IN_FRAME_DEGREES,
      TIMEOUT.moved,
    );
    if (!framed.ok) {
      fail(
        `the bot is ${framed.value === null ? 'not readable' : `${framed.value.toFixed(0)}° off where the camera looks`}` +
          `, so it is off the edge of the screen`,
      );
    } else {
      log(`the bot is ${framed.value.toFixed(0)}° off the camera's own facing — in frame`);
    }

    // Both overlays have to be ON the screen, with the SESSION line at the
    // length only another player in the room gives it.
    await checkOnScreen(page, 'perf-hud', 'perf HUD');
    await checkOnScreen(page, 'bot-hud', 'bot panel');
    // And a finger in the move zone must reach the camera, not the panel.
    await checkThumbReachesCamera(page, 'the bot panel');
    await checkNoOverlap(page, '[data-role="perf-hud"]', '[data-action="pause"]', 'the perf HUD and PAUSE');

    // CHECK 6: the panel is there and its cells light. Two different ones,
    // because one could be a cell that is simply stuck on.
    if ((await page.locator(`[data-role="${BOT_HUD_ROLE}"]`).count()) === 0) {
      fail('the bot panel is not on screen');
    }
    const seen = new Set();
    const cells = await until(
      async () => {
        for (const id of await litCells(page)) seen.add(id);
        return seen;
      },
      (set) => set.size >= CELLS_WANTED,
      TIMEOUT.cells,
    );
    if (!cells.ok) {
      fail(`only ${seen.size} control cell(s) ever lit: ${[...seen].join(', ') || 'none'}`);
    } else {
      log(`its controls lit: ${[...seen].sort().join(', ')}`);
    }

    // CHECK 7: the panel says where it is, counts down, and says what it is.
    const where = await field(page, 'bot-where');
    const title = await field(page, 'bot-title');
    const note = await field(page, 'bot-note');
    if (!/wx -?\d/.test(where)) fail(`the panel does not show a position; it reads "${where}"`);
    if (!/\d:\d\d left/.test(title)) fail(`the panel does not count down; it reads "${title}"`);
    if (!/not a person/i.test(note)) fail(`the panel does not say what it is; it reads "${note}"`);
    log(`the panel reads "${title}" / "${where}"`);

  } finally {
    // CHECK 8: nothing went wrong quietly — drained HERE, not at the end of
    // the run, because a check that threw is exactly the run whose console
    // is worth reading, and the screenshot is worth having for the same
    // reason.
    for (const message of consoleErrors) fail(`console error: ${message}`);
    for (const message of pageErrors) fail(`page error: ${message}`);
    await screenshot(page, SHOT).catch(() => {});
    await context.close();
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

    server = await preview({
      root: ROOT,
      logLevel: 'silent',
      preview: { host: '127.0.0.1', port: 4184, strictPort: false, open: false },
    });
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error('vite preview started but reported no local URL');
    // THE OVERRIDE IS THE POINT: the built game carries the deployed relay
    // (vite.config.ts), and `?relay=` points that same build at this one.
    const url = `${base}${base.endsWith('/') ? '' : '/'}?relay=ws://127.0.0.1:${relay.port}`;
    log(`serving dist/ at ${base}, pointing the browser at ${url}`);

    browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
    log(`chromium ${browser.version()}`);

    // A fresh code per run, so nothing from an earlier run or an open
    // `npm run relay:dev` can be mistaken for this room.
    const room = `bot-${randomBytes(3).toString('hex')}`;
    await run(browser, url, room);
  } catch (error) {
    fail(`unexpected: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  } finally {
    await browser?.close();
    await server?.close();
    await relay?.stop();
  }
}

const watchdog = setTimeout(() => {
  console.error(`[probe:bot] FAIL: nothing finished within ${WATCHDOG_MS / 1000} s. Something is wedged.`);
  live.relay?.kill();
  process.exit(1);
}, WATCHDOG_MS);

await main();
clearTimeout(watchdog);

if (failures.length > 0) {
  console.error(`[probe:bot] ${failures.length} check(s) failed.`);
  process.exitCode = 1;
} else {
  log(
    'PASS: one browser, one room on a locally running relay — the practice bot joined over the wire, ' +
      'was drawn, walked, and its controls lit on screen.',
  );
}
