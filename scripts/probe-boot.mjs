/**
 * The boot probe (ARCHITECTURE §12): does the bare URL boot to a menu, and
 * does PLAY reach a running world with a live FPS readout and a clean
 * console?
 *
 * It drives what a player touches — the buttons named in
 * `src/app/actions.ts` — on the 932 × 430 design canvas, against the
 * BUILT output. Never a `?scene=` route and never a selector tied to a
 * layout: v0 once shipped a build that passed every check against a route
 * nobody played, and naming the controls rather than the screen is part
 * of the fix.
 *
 * Usage:
 *
 *     npm run build && npm run probe:boot
 *
 * The caller runs the build. The probe refuses to run without `dist/`
 * rather than building silently, so "what did I just measure?" has one
 * answer: the dist on disk, the same files GitHub Pages serves.
 *
 * Checks, in order:
 *   1. the bare URL shows `[data-action="play"]`;
 *   1a. EDITORS opens the dev-tools hub, whose first `li[data-tool]` is the
 *      Performance World with an OPEN button, and BACK returns to the menu;
 *   2. PLAY leads to a session picker with `[data-action="solo"]` (a build
 *      that goes straight to the world is reported, not failed — the
 *      picker is the ui agent's, the world is the perf agent's, and the
 *      probe must say which half is missing rather than blur them);
 *   3. the world's HUD appears (`[data-action="pause"]`);
 *   4. sixty animation frames run;
 *   5. the HUD text carries an FPS number;
 *   6. the console logged no errors and the page threw none.
 *
 * Exit code 0 only when every check passes. The screenshot is written
 * either way (`shots/boot.png`, gitignored) so a failure leaves evidence.
 * The frame rate it prints is SwiftShader's, not a phone's: it is
 * evidence the loop runs, never a number to tune against.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const SHOT = path.join(ROOT, 'shots', 'boot.png');

/** The design canvas: a phone in landscape at logical size. */
const VIEWPORT = { width: 932, height: 430 };

/** Enough frames for a HUD's ring buffer to hold something worth reading. */
const FRAMES = 60;

/** The tool §12 says the hub lists first, and how devtools/DevTool names its OPEN button. */
const FIRST_TOOL = 'perf-world';
const toolAction = (id) => `tool:${id}`;

/**
 * Timeouts in milliseconds. SwiftShader is slow: the first WebGL context
 * and three's shader compiles can take tens of seconds on a loaded
 * machine, and v0's world ran at about a frame and a half a second here,
 * so sixty frames is budgeted at two minutes. None of these describe a
 * phone. The picker's five seconds is deliberately short: it either
 * exists in this build or it does not.
 */
const TIMEOUT = {
  menu: 60_000,
  picker: 5_000,
  world: 60_000,
  frames: 120_000,
  fps: 15_000,
};

/** Carried from v0's probes: what Playwright's Chromium needs to give three a WebGL context here. */
const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'];

/** "58 fps", "58.2 FPS", or "FPS 58" / "fps: 58" — the number, whichever side of the word it sits. */
const FPS_PATTERNS = [/(\d+(?:\.\d+)?)\s*fps\b/i, /\bfps\b[^\d\n]{0,12}(\d+(?:\.\d+)?)/i];

const failures = [];
const consoleErrors = [];
const pageErrors = [];

const log = (message) => console.log(`[probe:boot] ${message}`);
const fail = (message) => {
  failures.push(message);
  console.error(`[probe:boot] FAIL: ${message}`);
};

/**
 * Never `playwright install`: the browser is preinstalled. Playwright pins
 * a Chromium revision per release and the machine may hold a different
 * one, so the order is: an explicit override (`PLAYWRIGHT_CHROMIUM`, v0's
 * convention), Playwright's own pinned path when it exists, then the
 * `chromium` symlink kept under `PLAYWRIGHT_BROWSERS_PATH`. Anything else
 * is a clear failure, not a download.
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

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms / 1000} s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** What the player can read right now: the UI layer's text, whitespace collapsed, for messages. */
async function uiText(page) {
  const text = await page.evaluate(() => (document.getElementById('ui') ?? document.body).innerText);
  return text.replace(/\s+/g, ' ').trim();
}

/** Resolve after `count` requestAnimationFrame callbacks in the page; returns the wall-clock ms they took. */
function runFrames(page, count) {
  const run = page.evaluate(
    (n) =>
      new Promise((resolve) => {
        const started = performance.now();
        let seen = 0;
        const step = () => {
          seen += 1;
          if (seen >= n) resolve(performance.now() - started);
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    count,
  );
  return withTimeout(run, TIMEOUT.frames, `${count} animation frames`);
}

/** Poll the HUD for an FPS number: a HUD that fills a buffer first, or updates at 2 Hz, still gets caught. */
async function readFps(page) {
  const deadline = Date.now() + TIMEOUT.fps;
  let text = '';
  for (;;) {
    text = await uiText(page);
    for (const pattern of FPS_PATTERNS) {
      const m = pattern.exec(text);
      if (m) return { value: Number(m[1]), matched: m[0], text };
    }
    if (Date.now() >= deadline) return { value: null, matched: null, text };
    await page.waitForTimeout(250);
  }
}

async function drive(page, url) {
  log(`opening the bare URL ${url} at ${VIEWPORT.width}×${VIEWPORT.height}`);
  await page.goto(url, { waitUntil: 'load' });

  try {
    await page.waitForSelector('[data-action="play"]', { timeout: TIMEOUT.menu });
  } catch {
    fail(`[data-action="play"] did not appear within ${TIMEOUT.menu / 1000} s. UI reads: "${await uiText(page)}"`);
    return;
  }
  log('main menu is up; opening EDITORS');
  // Playwright waits for the button to actually receive pointer events,
  // which is what makes this robust to the SceneManager's fade layer.
  await page.click('[data-action="editors"]', { timeout: TIMEOUT.menu });
  try {
    await page.waitForSelector('li[data-tool]', { state: 'attached', timeout: TIMEOUT.menu });
    const first = await page.locator('li[data-tool]').first().getAttribute('data-tool');
    const opener = await page.locator(`[data-action="${toolAction(FIRST_TOOL)}"]`).count();
    if (first !== FIRST_TOOL) {
      fail(`the dev-tools hub lists "${first}" first; ARCHITECTURE §12 wants "${FIRST_TOOL}" first`);
    } else if (opener === 0) {
      fail(`the hub lists "${FIRST_TOOL}" but has no [data-action="${toolAction(FIRST_TOOL)}"] button to open it`);
    } else {
      log(`dev-tools hub is up and lists "${FIRST_TOOL}" first; going back`);
    }
    await page.click('[data-action="back"]', { timeout: TIMEOUT.menu });
    await page.waitForSelector('[data-action="play"]', { timeout: TIMEOUT.menu });
  } catch {
    fail(`EDITORS did not open a hub with a tool list and a way back. UI reads: "${await uiText(page)}"`);
    return;
  }

  log('pressing PLAY');
  await page.click('[data-action="play"]', { timeout: TIMEOUT.menu });

  const solo = page.locator('[data-action="solo"]');
  let pickerPresent = true;
  try {
    await solo.waitFor({ state: 'attached', timeout: TIMEOUT.picker });
  } catch {
    pickerPresent = false;
  }
  if (pickerPresent) {
    log('session picker is up; choosing SOLO');
    await solo.click({ timeout: TIMEOUT.menu });
  } else {
    log(
      `session picker is not present: [data-action="solo"] never appeared within ${TIMEOUT.picker / 1000} s ` +
        'after PLAY, so this build goes straight to the world. Continuing to the world check.',
    );
  }

  try {
    await page.waitForSelector('[data-action="pause"]', { state: 'attached', timeout: TIMEOUT.world });
    log('world HUD is up ([data-action="pause"] exists)');
  } catch {
    fail(
      `[data-action="pause"] did not appear within ${TIMEOUT.world / 1000} s after PLAY: the scene that is current ` +
        `carries no perf HUD. UI reads: "${await uiText(page)}"`,
    );
  }

  try {
    const ms = await runFrames(page, FRAMES);
    log(`${FRAMES} animation frames ran in ${(ms / 1000).toFixed(2)} s (${((FRAMES * 1000) / ms).toFixed(1)} fps under SwiftShader — not a phone number)`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  const fps = await readFps(page);
  if (fps.value === null) {
    fail(`the HUD never showed an FPS number within ${TIMEOUT.fps / 1000} s of the frames finishing. UI reads: "${fps.text}"`);
  } else if (!(fps.value > 0)) {
    fail(`the HUD shows "${fps.matched}", which is not a running frame rate. UI reads: "${fps.text}"`);
  } else {
    log(`HUD FPS readout: "${fps.matched}" (parsed ${fps.value}). Full HUD text: "${fps.text}"`);
  }
}

async function screenshot(page) {
  try {
    mkdirSync(path.dirname(SHOT), { recursive: true });
    await page.screenshot({ path: SHOT });
    log(`screenshot saved to ${path.relative(ROOT, SHOT)}`);
  } catch (error) {
    fail(`screenshot could not be saved: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  if (!existsSync(DIST_INDEX)) {
    fail('dist/index.html is missing. Run `npm run build` first: the probe measures the built output, the same files GitHub Pages serves.');
    return;
  }

  let server = null;
  let browser = null;
  try {
    // vite's own preview server, in-process: the same thing `vite preview`
    // runs, minus a child process to babysit. strictPort false lets it walk
    // up from 4173 to a free port; resolvedUrls says which one it took.
    server = await preview({
      root: ROOT,
      logLevel: 'silent',
      preview: { host: '127.0.0.1', port: 4173, strictPort: false, open: false },
    });
    const url = server.resolvedUrls?.local[0];
    if (!url) throw new Error('vite preview started but reported no local URL');
    log(`serving dist/ at ${url}`);

    browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
    log(`chromium ${browser.version()}`);
    const page = await browser.newPage({ viewport: VIEWPORT });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await drive(page, url);
    } finally {
      await screenshot(page);
    }
  } catch (error) {
    fail(`unexpected: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  } finally {
    await browser?.close();
    await server?.close();
  }

  if (consoleErrors.length > 0) {
    fail(`${consoleErrors.length} console error(s):\n${consoleErrors.map((e) => `    ${e}`).join('\n')}`);
  }
  if (pageErrors.length > 0) {
    fail(`${pageErrors.length} uncaught page error(s):\n${pageErrors.map((e) => `    ${e}`).join('\n')}`);
  }
}

await main();

if (failures.length > 0) {
  console.error(`[probe:boot] ${failures.length} check(s) failed.`);
  process.exitCode = 1;
} else {
  log('PASS: menu → PLAY → world, FPS readout live, zero console errors, zero page errors.');
}
