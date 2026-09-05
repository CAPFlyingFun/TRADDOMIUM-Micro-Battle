/**
 * The boot probe (ARCHITECTURE §12): does the bare URL boot to a menu, and
 * does NEW GAME reach a running world with a live FPS readout and a clean
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
 *   1. the bare URL shows `[data-action="new-game"]` and NO
 *      `[data-action="resume"]`, because the profile is fresh: a menu that
 *      offers to resume nothing is the dishonest one;
 *   1a. EDITORS opens the dev-tools hub, whose first `li[data-tool]` is the
 *      Performance World with an OPEN button, and BACK returns to the menu;
 *   2. NEW GAME leads to a session picker with `[data-action="solo"]`, and
 *      SOLO to a slot list whose three rows all read "Empty" (a build that
 *      goes straight to the world is reported, not failed — the picker is
 *      the ui agent's, the world is the perf agent's, and the probe must
 *      say which half is missing rather than blur them);
 *   3. the world's HUD appears (`[data-action="pause"]`);
 *   4. sixty animation frames run;
 *   5. the HUD text carries an FPS number;
 *   6. PAUSE → QUIT lands on a menu that offers `[data-action="resume"]`
 *      saying "Last played just now" (the solo save exists and this build
 *      has the world it names), and RESUME — one saved game, so no list —
 *      reaches the world's HUD again;
 *   7. QUIT again, NEW GAME → SOLO shows slot 1 played and slots 2 and 3
 *      empty; choosing slot 1 ASKS before replacing it, and "Keep it"
 *      leaves the save where it was;
 *   8. the console logged no errors and the page threw none.
 *
 * The menu's RESUME and the pause menu's carry the same `data-action`, so
 * every selector here that means the menu's says `[data-screen="menu"]`.
 *
 * Exit code 0 only when every check passes. The screenshots are written
 * either way (all gitignored) so a failure leaves evidence:
 * `shots/menu-new-game.png` (a fresh profile), `shots/boot.png` (the first
 * world entry), `shots/menu-resume.png` (the menu after QUIT),
 * `shots/slot-picker.png` (one slot played, two empty) and
 * `shots/slot-overwrite.png` (the question in front of a saved game).
 * The frame rate it prints is SwiftShader's, not a phone's: it is
 * evidence the loop runs, never a number to tune against.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { chooseSpawn } from './probeSpawn.mjs';
import { preview } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const SHOT = path.join(ROOT, 'shots', 'boot.png');
const SHOT_RESUME = path.join(ROOT, 'shots', 'menu-resume.png');
const SHOT_NEW_GAME = path.join(ROOT, 'shots', 'menu-new-game.png');
const SHOT_SLOTS = path.join(ROOT, 'shots', 'slot-picker.png');
const SHOT_OVERWRITE = path.join(ROOT, 'shots', 'slot-overwrite.png');

/** The menu's own RESUME. The pause overlay's shares the verb; only the screen tells them apart. */
const MENU_RESUME = '[data-screen="menu"] [data-action="resume"]';

/** The three solo save slots, and the first of them. */
const SLOT_COUNT = 3;
const SLOT_ONE = '[data-action="slot:1"]';

/** The document-painted splash index.html carries; `src/ui/splash/BootSplash.ts` removes it. */
const BOOT_ID = 'boot';

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
  slots: 5_000,
  world: 60_000,
  frames: 120_000,
  fps: 15_000,
  /** The splash's own 700 ms fade, with room for a slow first paint. */
  splash: 15_000,
};

/** Carried from v0's probes: what Playwright's Chromium needs to give three a WebGL context here. */
const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'];

/** "58 fps", "58.2 FPS", or "FPS 58" / "fps: 58" — the number, whichever side of the word it sits. */
const FPS_PATTERNS = [/(\d+(?:\.\d+)?)\s*fps\b/i, /\bfps\b[^\d\n]{0,12}(\d+(?:\.\d+)?)/i];

const failures = [];
/** Set once drive() has taken the first world shot, so the finally below only adds evidence on a failure before it. */
let worldShotTaken = false;
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
    await page.waitForSelector('[data-action="new-game"]', { timeout: TIMEOUT.menu });
  } catch {
    fail(`[data-action="new-game"] did not appear within ${TIMEOUT.menu / 1000} s. UI reads: "${await uiText(page)}"`);
    return;
  }
  // A fresh profile has nothing to resume, and the menu must not pretend otherwise.
  if ((await page.locator(MENU_RESUME).count()) > 0) {
    fail(`the menu of a fresh profile offers RESUME. UI reads: "${await uiText(page)}"`);
  }
  // The menu is BEHIND the boot splash until main.ts takes it down, so the
  // picture waits for the splash to be gone rather than photographing it.
  await menuVisible(page);
  await checkPanelFits(page, 'fresh menu');
  await screenshot(page, SHOT_NEW_GAME);
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
    await page.waitForSelector('[data-action="new-game"]', { timeout: TIMEOUT.menu });
  } catch {
    fail(`EDITORS did not open a hub with a tool list and a way back. UI reads: "${await uiText(page)}"`);
    return;
  }

  log('pressing NEW GAME');
  await page.click('[data-action="new-game"]', { timeout: TIMEOUT.menu });

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
    try {
      await page.waitForSelector(SLOT_ONE, { state: 'attached', timeout: TIMEOUT.slots });
      const subs = await page.locator('.ui-slots .ui-button__sub').allInnerTexts();
      if (subs.length !== SLOT_COUNT) {
        fail(`the slot list shows ${subs.length} slots; this build has ${SLOT_COUNT}. UI reads: "${await uiText(page)}"`);
      } else if (!subs.every((t) => t.trim() === 'Empty')) {
        fail(`a fresh profile's slots read ${JSON.stringify(subs)}; every one should read "Empty"`);
      } else {
        log(`slot list is up with ${SLOT_COUNT} empty slots; choosing slot 1`);
      }
      await page.click(SLOT_ONE, { timeout: TIMEOUT.menu });
      // And then the spawn map, which is now part of the front door.
      // ʻAnini: a coast region, 50 m from the water, so this probe's
      // screenshots show somewhere a player would actually recognise.
      await chooseSpawn(page, 'anini', log, TIMEOUT.world);
    } catch {
      fail(`SOLO did not lead to a slot list with ${SLOT_ONE} within ${TIMEOUT.slots / 1000} s. UI reads: "${await uiText(page)}"`);
      return;
    }
  } else {
    log(
      `session picker is not present: [data-action="solo"] never appeared within ${TIMEOUT.picker / 1000} s ` +
        'after NEW GAME, so this build goes straight to the world. Continuing to the world check.',
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

  // The world as the player first sees it, before the round trip below.
  await screenshot(page, SHOT);
  worldShotTaken = true;

  log('pressing PAUSE, then QUIT');
  await page.click('[data-action="pause"]', { timeout: TIMEOUT.menu });
  await page.click('[data-action="quit"]', { timeout: TIMEOUT.menu });
  try {
    await page.waitForSelector(MENU_RESUME, { timeout: TIMEOUT.menu });
  } catch {
    fail(`after QUIT the menu shows no ${MENU_RESUME} within ${TIMEOUT.menu / 1000} s. UI reads: "${await uiText(page)}"`);
    return;
  }
  const resumeText = (await page.locator(MENU_RESUME).innerText()).replace(/\s+/g, ' ').trim();
  if (!/Last played just now/i.test(resumeText)) {
    fail(`RESUME reads "${resumeText}"; expected it to say "Last played just now" right after QUIT`);
  } else {
    log(`menu offers RESUME: "${resumeText}"`);
  }
  // The tallest the menu ever gets: RESUME, NEW GAME and four more rows.
  await checkPanelFits(page, 'menu with RESUME');
  await screenshot(page, SHOT_RESUME);

  log('pressing RESUME');
  await page.click(MENU_RESUME, { timeout: TIMEOUT.menu });
  try {
    await page.waitForSelector('[data-action="pause"]', { state: 'attached', timeout: TIMEOUT.world });
    log('RESUME reached the world HUD again');
  } catch {
    fail(`[data-action="pause"] did not appear within ${TIMEOUT.world / 1000} s after RESUME. UI reads: "${await uiText(page)}"`);
    return;
  }

  await checkOverwriteIsAsked(page);
}

/**
 * The last check, and the one the slots exist for: with a game in slot 1,
 * starting a NEW game there must ask before it replaces it, and answering
 * "Keep it" must leave the game exactly where it was. A save that can be
 * destroyed by one tap is the thing this whole feature is here to prevent,
 * so it is verified in the built page and not only in a jsdom test.
 */
async function checkOverwriteIsAsked(page) {
  log('QUIT again, to look at the slot list with a game in it');
  await page.click('[data-action="pause"]', { timeout: TIMEOUT.menu });
  await page.click('[data-action="quit"]', { timeout: TIMEOUT.menu });
  await page.waitForSelector('[data-action="new-game"]', { timeout: TIMEOUT.menu });
  await page.click('[data-action="new-game"]', { timeout: TIMEOUT.menu });
  await page.click('[data-action="solo"]', { timeout: TIMEOUT.menu });
  try {
    await page.waitForSelector(SLOT_ONE, { state: 'attached', timeout: TIMEOUT.slots });
  } catch {
    fail(`SOLO did not lead to a slot list within ${TIMEOUT.slots / 1000} s. UI reads: "${await uiText(page)}"`);
    return;
  }
  const subs = (await page.locator('.ui-slots .ui-button__sub').allInnerTexts()).map((t) => t.trim());
  if (!/^Last played /.test(subs[0] ?? '') || subs.slice(1).some((t) => t !== 'Empty')) {
    fail(`with one game saved the slots read ${JSON.stringify(subs)}; expected slot 1 played and the rest "Empty"`);
  } else {
    log(`slot list reads ${JSON.stringify(subs)}`);
  }
  await screenshot(page, SHOT_SLOTS);

  await page.click(SLOT_ONE, { timeout: TIMEOUT.menu });
  try {
    await page.waitForSelector('[data-role="slot-overwrite"]', { timeout: TIMEOUT.slots });
  } catch {
    fail('a new game on an OCCUPIED slot started without asking. A save must never be replaced by one tap.');
    return;
  }
  const asked = (await page.locator('[data-role="slot-overwrite"]').innerText()).replace(/\s+/g, ' ').trim();
  log(`the overwrite question reads: "${asked}"`);
  await screenshot(page, SHOT_OVERWRITE);

  await page.click('[data-action="slot-keep"]', { timeout: TIMEOUT.menu });
  await page.click('[data-action="back"]', { timeout: TIMEOUT.menu });
  await page.click('[data-action="back"]', { timeout: TIMEOUT.menu });
  try {
    await page.waitForSelector(MENU_RESUME, { timeout: TIMEOUT.menu });
    log('KEEP IT kept the game: the menu still offers RESUME');
  } catch {
    fail(`after KEEP IT the menu no longer offers ${MENU_RESUME}: the save was lost. UI reads: "${await uiText(page)}"`);
  }
}

/**
 * THE MENU MUST FIT THE PHONE IT IS DESIGNED FOR.
 *
 * A row the player cannot see is not a design decision, it is a missing
 * control: the six-row menu (RESUME + NEW GAME + four) overflowed the
 * 430 px panel and cut ABOUT and the build stamp off below the fold.
 * jsdom cannot catch this — it does no layout — so the check lives here,
 * against the real built page at the real design canvas. One pixel of
 * slack for sub-pixel rounding; anything more is a row going missing.
 */
async function checkPanelFits(page, where) {
  const panel = page.locator('.ui-panel').first();
  if ((await panel.count()) === 0) {
    fail(`no .ui-panel to measure on the ${where}`);
    return;
  }
  const size = await panel.evaluate((el) => ({
    scroll: el.scrollHeight,
    client: el.clientHeight,
  }));
  const over = size.scroll - size.client;
  if (over > 1) {
    fail(
      `the ${where} panel overflows by ${over} px at ${VIEWPORT.width}×${VIEWPORT.height} ` +
        `(content ${size.scroll} px in ${size.client} px): its lowest rows are below the fold`,
    );
  } else {
    log(`the ${where} fits the ${VIEWPORT.width}×${VIEWPORT.height} canvas (${size.scroll} px of ${size.client} px)`);
  }
}

/**
 * Wait for the document-painted boot splash (`#boot`) to be removed, so a
 * screenshot shows the menu rather than the artwork still fading over it.
 * A missing element resolves at once; a splash that never goes is reported
 * rather than waited on forever.
 */
async function menuVisible(page) {
  try {
    await page.waitForSelector(`#${BOOT_ID}`, { state: 'detached', timeout: TIMEOUT.splash });
  } catch {
    fail(`the boot splash (#${BOOT_ID}) was still over the menu ${TIMEOUT.splash / 1000} s after it came up`);
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
      // Wherever the drive stopped: the first world shot is taken inside
      // drive() when it gets there, so this is the evidence of a failure.
      if (!worldShotTaken) await screenshot(page, SHOT);
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
  log(
    'PASS: menu → NEW GAME → SOLO → slot → world, FPS readout live, PAUSE → QUIT → RESUME → world, ' +
      'zero console errors, zero page errors.',
  );
}
