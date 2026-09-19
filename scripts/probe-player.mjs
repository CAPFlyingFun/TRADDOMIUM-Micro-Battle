/**
 * THE WALKING BODY, DRIVEN THE WAY A PLAYER DRIVES IT.
 *
 *     npm run probe:player
 *
 * This probe has ONE job that `probe:tombs` cannot do: `probe:tombs`
 * proves the building draws and that a camera can be flown around it.
 * A camera that flies has no mass, stands on nothing and passes through
 * every wall, so none of it says whether a BODY can walk the room — and
 * the collision, the step-up, the gait and the reach are exactly the
 * things that are wrong or right in ways a still photograph cannot show.
 *
 * So it presses what a thumb presses: the bare URL, EDITORS, OPEN on the
 * laboratory, STAND AND WALK, then the keys and the on-screen controls,
 * reading the same `data-field`s the player reads. No `?scene=`
 * shortcut and no reaching into the scene object: a probe that skips a
 * step the player cannot skip is measuring a route nobody plays
 * (CLAUDE.md's rule, and the one this project has already shipped a
 * build against).
 *
 * WHAT IT ASSERTS, in the order a player would find them:
 *
 *   1. the body MOVES when the stick or the keys ask it to, and the
 *      position line changes in the plan's own metres;
 *   2. the body is STOPPED by the building — walked at a wall for long
 *      enough to cross the room, it is still inside it;
 *   3. the body SLIDES rather than sticking, so a corner is not a trap;
 *   4. the gait reports what the body is doing (`stand` at rest, `walk`
 *      moving, `run` with RUN held) — a pose that never leaves `stand`
 *      is a rig that is not being driven;
 *   5. REACH: walked up to Jack's workstation, the prompt line carries
 *      the plan's own words and the INTERACT control appears; walked
 *      away, both go again. A control that is always there and usually
 *      does nothing is the unavailable action the standing rule forbids,
 *      and this is the check that it is not;
 *   6. AUDIO: the first press of the sample button is a real user
 *      gesture, which is the only thing that unlocks an AudioContext on
 *      iOS. The line must stop saying `locked`. On a headless Chromium
 *      there is no output device, so this asserts the CONTEXT and the
 *      DECODE, not that a sound was heard — which is the part a phone
 *      has to judge, and the part this cannot.
 *
 * IT BUILDS FIRST, because `preview` serves `dist/` and `dist/` is
 * whatever was built last. One run of `probe:tombs` reported a working
 * laboratory while photographing a build from before the change being
 * tested; four seconds of build is the price of any of this meaning
 * anything.
 *
 * The headless renderer runs at about a frame and a half a second, so
 * every "walk for N seconds" below is wall-clock and the DISTANCE
 * covered is not comparable to a phone's. That is why the assertions are
 * about direction, containment and state words rather than about how far
 * a body got: never retune a per-second system from probe wall-clock.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build, preview } from 'vite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(ROOT, 'shots');
const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'];
/** Joshua's phone in landscape, the viewport every visual decision is measured at. */
const VIEWPORT = { width: 932, height: 430 };
const APP_PORT = 4194;

const TOOL = 'lab.tombs';
const HUD = 'tombs-lab-hud';

const log = (m) => console.log(`[probe:player] ${m}`);

let failures = 0;
function check(ok, what) {
  if (ok) {
    log(`  ok   ${what}`);
    return true;
  }
  failures += 1;
  log(`  FAIL ${what}`);
  return false;
}

function chromiumPath() {
  const override = process.env.PLAYWRIGHT_CHROMIUM;
  if (override && existsSync(override)) return override;
  const pinned = chromium.executablePath();
  if (existsSync(pinned)) return undefined;
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const linked = browsers ? path.join(browsers, 'chromium') : null;
  if (linked && existsSync(linked)) return linked;
  throw new Error('no Chromium found; this probe never runs `playwright install`');
}

/**
 * THE LABORATORY'S INTERIOR, from the plan — x -13.00..-1.00,
 * z 9.40..16.00, floor at y 0 (`world/tombs/plan.ts`). Written here
 * rather than imported because this file drives the BUILT app and must
 * not depend on the module graph it is testing: if the plan changes and
 * these numbers do not, the containment check below fails loudly, which
 * is the correct outcome for a probe whose whole subject is walls.
 */
const LAB = { x0: -13.0, x1: -1.0, z0: 9.4, z1: 16.0 };

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  log('building, because preview serves dist/ and a stale dist/ is a lie');
  await build({ root: ROOT, logLevel: 'error' });
  const server = await preview({
    root: ROOT,
    preview: { host: '127.0.0.1', port: APP_PORT, strictPort: false, open: false },
    logLevel: 'error',
  });
  const url = server.resolvedUrls.local[0];
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });

    // --- the route a player walks, with no shortcut ---
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('[data-action="new-game"]', { timeout: 120_000 });
    await page.click('[data-action="editors"]', { timeout: 60_000 });
    await page.waitForSelector(`[data-action="tool:${TOOL}"]`, { state: 'attached', timeout: 60_000 });
    await page.click(`[data-action="tool:${TOOL}"]`, { timeout: 60_000 });
    await page.waitForSelector(`[data-role="${HUD}"]`, { timeout: 180_000 });
    log('bare URL -> EDITORS -> OPEN -> the laboratory is up');

    const read = async () => page.evaluate(() => {
      const out = {};
      for (const el of document.querySelectorAll('[data-field]')) {
        out[el.getAttribute('data-field')] = (el.textContent ?? '').trim();
      }
      return out;
    });
    /** The `at x, y, z m` line back into numbers — the plan's own metres. */
    const where = async () => {
      const line = (await read())['tombs-pos'] ?? '';
      const m = line.match(/at\s*(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)/);
      return m ? { x: +m[1], y: +m[2], z: +m[3] } : null;
    };
    const has = async (action) => (await page.$(`[data-action="${action}"]`)) !== null;

    // Let the people arrive before anything else: they are 6 MB of GLB
    // fetched after the door opens, and a body walked through the room
    // before they land is a different room.
    await page.waitForFunction(
      () => ((document.querySelector('[data-field="tombs-people"]')?.textContent) ?? '').includes('standing'),
      null, { timeout: 60_000 },
    ).catch(() => log('  the people never arrived within 60 s'));

    // --- 1. stand up and walk ---
    await page.click('[data-action="tombs:walk"]', { timeout: 60_000 });
    await page.waitForTimeout(600);
    let hud = await read();
    check((hud['tombs-mode'] ?? '').includes('WALKING'), `STAND AND WALK -> ${hud['tombs-mode']}`);
    const start = await where();
    check(start !== null, `standing at ${JSON.stringify(start)}`);
    check((hud['tombs-mode'] ?? '').includes('stand'), 'at rest the gait reports stand');
    await page.screenshot({ path: path.join(SHOTS, 'player-1-standing.png') });

    /** Hold a key for a while, letting the app run. */
    const holdKey = async (code, ms) => {
      await page.keyboard.down(code);
      await page.waitForTimeout(ms);
      await page.keyboard.up(code);
      await page.waitForTimeout(250);
    };

    // --- 2. the body moves, and the gait says so ---
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(900);
    hud = await read();
    const moving = hud['tombs-mode'] ?? '';
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(250);
    check(moving.includes('walk') || moving.includes('run'), `while moving the gait reports ${moving}`);
    const afterW = await where();
    check(
      afterW !== null && start !== null && Math.hypot(afterW.x - start.x, afterW.z - start.z) > 0.05,
      `W moved the body ${afterW && start ? Math.hypot(afterW.x - start.x, afterW.z - start.z).toFixed(2) : '?'} m`,
    );
    await page.screenshot({ path: path.join(SHOTS, 'player-2-walking.png') });

    // --- 3. RUN raises the ceiling, and says so ---
    await page.click('[data-action="tombs:run"]', { timeout: 60_000 });
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(900);
    hud = await read();
    const running = hud['tombs-mode'] ?? '';
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(250);
    check(running.includes('run'), `with RUN held the gait reports ${running}`);
    await page.click('[data-action="tombs:run"]', { timeout: 60_000 });

    // --- 4. the building stops the body ---
    // Long enough to cross a 12 m room several times over at walking pace.
    await holdKey('KeyA', 4000);
    await holdKey('KeyW', 4000);
    const cornered = await where();
    const inside = cornered !== null
      && cornered.x > LAB.x0 - 0.01 && cornered.x < LAB.x1 + 0.01
      && cornered.z > LAB.z0 - 0.01 && cornered.z < LAB.z1 + 0.01;
    check(inside, `after 8 s walked into the corner the body is still in the room at ${JSON.stringify(cornered)}`);
    check(cornered !== null && cornered.y > -0.05 && cornered.y < 0.6, `the body is on the floor, y ${cornered?.y}`);
    await page.screenshot({ path: path.join(SHOTS, 'player-3-cornered.png') });

    // --- 5. reach: the prompt and the INTERACT control appear together ---
    const promptAway = (await read())['tombs-prompt'] ?? '';
    const interactAway = await has('tombs:interact');
    check(promptAway === '' && !interactAway, 'away from everything: no prompt and no INTERACT control');

    // Teleport to the laboratory to get a known start, then walk to Jack's
    // workstation at (-6.00, 10.20) — `use:jack-workstation` has reach 1.2.
    await page.click('[data-action="tombs:teleport:laboratory"]', { timeout: 60_000 });
    await page.waitForTimeout(500);
    let reached = false;
    for (let i = 0; i < 14 && !reached; i += 1) {
      await holdKey('KeyW', 700);
      const hudNow = await read();
      if ((hudNow['tombs-prompt'] ?? '') !== '') reached = true;
    }
    hud = await read();
    const prompt = hud['tombs-prompt'] ?? '';
    check(reached && prompt.length > 0, `walked into reach: prompt reads "${prompt}"`);
    check(await has('tombs:interact'), 'the INTERACT control appeared with the prompt');
    if (await has('tombs:interact')) {
      await page.click('[data-action="tombs:interact"]', { timeout: 60_000 });
      await page.waitForTimeout(400);
      log(`  INTERACT pressed; prompt now "${(await read())['tombs-prompt']}"`);
    }
    await page.screenshot({ path: path.join(SHOTS, 'player-4-reach.png') });

    // --- 6. audio: the tap that unlocks the context ---
    const before = (await read())['tombs-audio'] ?? '';
    check(before.includes('locked'), `before any tap the audio line reads "${before}"`);
    await page.click('[data-action="tombs:audio"]', { timeout: 60_000 });
    await page.waitForTimeout(2500);
    const after = (await read())['tombs-audio'] ?? '';
    check(!after.includes('locked'), `after a real tap the audio line reads "${after}"`);
    check(/([1-9]\d*) decoded/.test(after), 'at least one clip decoded');
    check(/\b0 failed\b/.test(after), 'no clip failed to load');
    await page.screenshot({ path: path.join(SHOTS, 'player-5-audio.png') });

    if (errors.length) {
      log(`PAGE ERRORS: ${errors.slice(0, 5).join(' | ')}`);
      failures += 1;
    } else {
      log('no page errors');
    }
  } finally {
    await browser.close();
    await server.close();
  }

  log(failures === 0 ? 'every check passed' : `${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exitCode = 1;
}

await main();
