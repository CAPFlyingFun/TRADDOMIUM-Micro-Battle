/**
 * The Network Lab probe: does the bare URL reach the lab through the
 * hub, do two clients join one host and each see two capsules, does a
 * hang-up linger and re-attach to the SAME actor inside the grace and
 * to a fresh one after it, and is a teleport claim refused on screen?
 *
 * It drives what a player touches — the `data-action` names in
 * `src/app/actions.ts` and `src/devtools/netLabTool.ts` — on the
 * 932 × 430 design canvas, against the BUILT output. Never a `?scene=`
 * route: the lab is reached exactly the way a phone reaches it, through
 * EDITORS and the tool's OPEN button.
 *
 * Usage:
 *
 *     npm run build && npm run probe:netlab
 *
 * The caller runs the build. The probe refuses to run without `dist/`
 * rather than building silently, so "what did I just measure?" has one
 * answer: the dist on disk, the same files GitHub Pages serves.
 *
 * Checks, in order:
 *   1. the bare URL shows `[data-action="new-game"]`; EDITORS opens the hub;
 *      the hub has an OPEN button for `net-lab`;
 *   2. the lab's HUD appears and both clients report `connected` with
 *      2 actors known to each;
 *   3. B: disconnect → the host reports B lingering and A still knows 2
 *      actors (nobody said leave);
 *   4. B: reconnect inside the grace → B is connected again to the SAME
 *      actor id, and A still knows 2;
 *   5. B: disconnect → after the host's grace (10 s of the lab's clock)
 *      A knows 1 actor;
 *   6. B: reconnect after the grace → A knows 2 again and B's actor id
 *      is a FRESH one (the host forgot the old actor — the brief asked
 *      for "the same id" here, but past the grace the host's contract
 *      says the actor is gone, and this probe reports what the host
 *      does rather than what would be convenient);
 *   7. A: teleport (claim) → the HUD reports a refused claim, snapped
 *      back;
 *   8. the console logged no errors and the page threw none.
 *
 * Exit code 0 only when every check passes. The screenshot is written
 * either way (`shots/netlab.png`, gitignored) so a failure leaves
 * evidence. The frame rate here is SwiftShader's, not a phone's; the lab
 * clock runs on wall time, so the 10 s grace is 10 s however slow the
 * frames are.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const SHOT = path.join(ROOT, 'shots', 'netlab.png');

/** The design canvas: a phone in landscape at logical size. */
const VIEWPORT = { width: 932, height: 430 };

/**
 * The names the lab answers to. Repeated from `src/devtools/netLabTool.ts`
 * (`NET_LAB_ACTION`, `NET_LAB_HUD_ROLE`) because a .mjs probe cannot
 * import TypeScript; `tests/devtoolsNetLab.test.ts` pins the source.
 */
const TOOL_ID = 'net-lab';
const HUD_ROLE = 'net-lab-hud';
const ACTION = {
  bDisconnect: 'netlab:b-disconnect',
  bReconnect: 'netlab:b-reconnect',
  aTeleport: 'netlab:a-teleport',
};
const toolAction = (id) => `tool:${id}`;

/** `HOST_DEFAULTS.graceMs` in src/net/Host.ts. */
const GRACE_MS = 10_000;

/**
 * Timeouts in milliseconds. SwiftShader is slow: the first WebGL context
 * and three's shader compiles can take tens of seconds, and a frame can
 * take most of a second, so every HUD read is a poll with a generous
 * ceiling. None of these describe a phone.
 */
const TIMEOUT = {
  menu: 60_000,
  lab: 90_000,
  hud: 30_000,
  grace: GRACE_MS + 30_000,
  click: 30_000,
};

/** Carried from v0's probes: what Playwright's Chromium needs to give three a WebGL context here. */
const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'];

/** Where this machine keeps a Chromium when Playwright's own pinned one is absent. */
const CHROMIUM_FALLBACK = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const failures = [];
const verified = [];
const consoleErrors = [];
const pageErrors = [];

const log = (message) => console.log(`[probe:netlab] ${message}`);
const fail = (message) => {
  failures.push(message);
  console.error(`[probe:netlab] FAIL: ${message}`);
};
const pass = (message) => {
  verified.push(message);
  log(`ok: ${message}`);
};

/**
 * Never `playwright install`: the browser is preinstalled. Order: an
 * explicit override (`PLAYWRIGHT_CHROMIUM`), Playwright's own pinned path
 * when it exists, the `chromium` symlink under `PLAYWRIGHT_BROWSERS_PATH`,
 * then this machine's known fallback. Anything else is a clear failure,
 * not a download.
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
  if (existsSync(CHROMIUM_FALLBACK)) return CHROMIUM_FALLBACK;
  throw new Error(
    `no Chromium found. Playwright expects ${pinned}; ${linked ?? 'PLAYWRIGHT_BROWSERS_PATH is unset'} and ` +
      `${CHROMIUM_FALLBACK} are absent too. Point PLAYWRIGHT_CHROMIUM at a chrome binary — this probe never runs \`playwright install\`.`,
  );
}

/** What the player can read right now: the UI layer's text, whitespace collapsed, for messages. */
async function uiText(page) {
  const text = await page.evaluate(() => (document.getElementById('ui') ?? document.body).innerText);
  return text.replace(/\s+/g, ' ').trim();
}

/** Every `[data-field]` in the HUD as name → text: the words the player reads, not the numbers behind them. */
async function hudFields(page) {
  return page.evaluate((role) => {
    const out = {};
    const hud = document.querySelector(`[data-role="${role}"]`);
    if (!hud) return out;
    for (const el of hud.querySelectorAll('[data-field]')) out[el.dataset.field] = (el.textContent ?? '').trim();
    return out;
  }, HUD_ROLE);
}

/** Poll the HUD until `accept(fields)` is truthy. Returns the fields; throws with the last reading on timeout. */
async function hudUntil(page, what, accept, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let fields = {};
  for (;;) {
    fields = await hudFields(page);
    if (accept(fields)) return fields;
    if (Date.now() >= deadline) {
      throw new Error(`${what} did not happen within ${timeoutMs / 1000} s. HUD reads: ${JSON.stringify(fields)}`);
    }
    await page.waitForTimeout(250);
  }
}

const actorIdOf = (text) => /^actor (\S+)/.exec(text ?? '')?.[1] ?? null;
const knownCount = (text) => Number(/^(\d+) known/.exec(text ?? '')?.[1] ?? NaN);
const refusedCount = (text) => Number(/^refused (\d+) claim/.exec(text ?? '')?.[1] ?? NaN);

async function press(page, action) {
  // Playwright waits for the button to be visible, enabled and receiving
  // pointer events: robust to the fade layer and to a button the HUD has
  // not yet re-enabled after its 5 Hz repaint.
  await page.click(`[data-action="${action}"]`, { timeout: TIMEOUT.click });
  log(`pressed ${action}`);
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
  log('main menu is up; opening EDITORS');
  await page.click('[data-action="editors"]', { timeout: TIMEOUT.menu });
  try {
    await page.waitForSelector(`[data-action="${toolAction(TOOL_ID)}"]`, { state: 'attached', timeout: TIMEOUT.menu });
  } catch {
    fail(`the dev-tools hub has no [data-action="${toolAction(TOOL_ID)}"] button. UI reads: "${await uiText(page)}"`);
    return;
  }
  pass(`bare URL → EDITORS → hub lists "${TOOL_ID}" with an OPEN button`);
  await page.click(`[data-action="${toolAction(TOOL_ID)}"]`, { timeout: TIMEOUT.menu });

  try {
    await page.waitForSelector(`[data-role="${HUD_ROLE}"]`, { state: 'attached', timeout: TIMEOUT.lab });
  } catch {
    fail(`the lab's HUD ([data-role="${HUD_ROLE}"]) did not appear within ${TIMEOUT.lab / 1000} s. UI reads: "${await uiText(page)}"`);
    return;
  }

  let fields;
  try {
    fields = await hudUntil(
      page,
      'both clients connected with 2 actors each',
      (f) => f['a-state'] === 'connected' && f['b-state'] === 'connected' && knownCount(f['a-actors']) === 2 && knownCount(f['b-actors']) === 2,
      TIMEOUT.hud,
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }
  const originalB = actorIdOf(fields['b-actor']);
  const originalA = actorIdOf(fields['a-actor']);
  if (!originalB || !originalA) {
    fail(`the HUD names no actor for a client: a-actor="${fields['a-actor']}", b-actor="${fields['b-actor']}"`);
    return;
  }
  pass(`A (${originalA}) and B (${originalB}) both connected; each knows 2 actors: "${fields['a-actors']}"`);

  try {
    await press(page, ACTION.bDisconnect);
    fields = await hudUntil(
      page,
      'host reports B lingering with A still knowing 2 actors',
      (f) => /lingering/.test(f['host-b'] ?? '') && knownCount(f['a-actors']) === 2,
      TIMEOUT.hud,
    );
    pass(`B hung up: host says "${fields['host-b']}"; A still knows 2 (no leave was sent)`);

    await press(page, ACTION.bReconnect);
    fields = await hudUntil(
      page,
      'B reconnected to the same actor inside the grace',
      (f) => f['b-state'] === 'connected' && actorIdOf(f['b-actor']) === originalB && knownCount(f['a-actors']) === 2,
      TIMEOUT.hud,
    );
    pass(`B reconnected inside the grace to the SAME actor ${originalB}; A knows 2: "${fields['a-actors']}"`);

    await press(page, ACTION.bDisconnect);
    fields = await hudUntil(page, 'A sees 1 actor after the grace', (f) => knownCount(f['a-actors']) === 1, TIMEOUT.grace);
    pass(`after the host's ${GRACE_MS / 1000} s grace A knows 1 actor: "${fields['a-actors']}"; host says "${fields['host-b']}"`);

    await press(page, ACTION.bReconnect);
    fields = await hudUntil(
      page,
      'B reconnected after the grace with A knowing 2 actors again',
      (f) => f['b-state'] === 'connected' && knownCount(f['a-actors']) === 2 && actorIdOf(f['b-actor']) !== null,
      TIMEOUT.hud,
    );
    const freshB = actorIdOf(fields['b-actor']);
    if (freshB === originalB) {
      fail(`B reconnected after the grace to ${freshB}, the old actor; the host should have dropped it and minted a fresh one`);
    } else {
      pass(`B reconnected after the grace as a FRESH actor ${freshB} (was ${originalB}); A knows 2: "${fields['a-actors']}"`);
    }

    await press(page, ACTION.aTeleport);
    fields = await hudUntil(page, 'the HUD reports a refused claim', (f) => refusedCount(f['a-corrections']) >= 1, TIMEOUT.hud);
    pass(`teleport claim refused and snapped back: "${fields['a-corrections']}"; host: "${fields['host-claims']}"`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
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
  } else {
    pass('zero console errors');
  }
  if (pageErrors.length > 0) {
    fail(`${pageErrors.length} uncaught page error(s):\n${pageErrors.map((e) => `    ${e}`).join('\n')}`);
  } else {
    pass('zero uncaught page errors');
  }
}

await main();

log(`verified ${verified.length} thing(s):\n${verified.map((v) => `    - ${v}`).join('\n')}`);
if (failures.length > 0) {
  console.error(`[probe:netlab] ${failures.length} check(s) failed.`);
  process.exitCode = 1;
} else {
  log('PASS: hub → Network Lab, two clients on one host, linger/re-attach/fresh actor, teleport refused, clean console.');
}
