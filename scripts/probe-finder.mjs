/**
 * THE CREATURE FINDER, DRIVEN THE WAY A PERSON DRIVES IT.
 *
 * Joshua, 2026-09-08, from the phone: "I don't see any worms in the game
 * or any of the glb models you added unless you didn't yet... can you
 * make a simple 3D finder I can turn on to find them better?"
 *
 * `probe:ecology` already proves the animals are THERE — forty worms of
 * forty at the Wailua forest, a hundred and fifty aphids, fifty flies.
 * What it cannot show is that a person can find one, and that is the
 * whole of the complaint: a 150 mm worm on a 5,600,000-unit island,
 * usually 12 mm under the soil, is a correct ecology and an empty
 * screen. So this probe does what he would do, in his order, and fails
 * if any step of it does not work:
 *
 *   1. stand in the forest with the finder OFF          shots/finder-off.png
 *   2. switch it on: pins appear over the animals       shots/finder-on.png
 *      and two more presses tour the other two          shots/finder-tour-N.png
 *   3. press GO: the camera flies to the nearest one it can SEE and
 *      folds the sheet out of the way              shots/finder-close.png
 *
 * WHAT IT ASSERTS, rather than merely photographing:
 *
 *   - `eco-find` reads `find off` while it is off, and names an animal,
 *     a distance and a bearing once it is on. A forest that reads
 *     `find nothing near` is a failure: the simulation is holding forty
 *     worms there.
 *   - The PINS ARE ON THE SCREEN. The three pin colours are counted in
 *     the pixels of shot 1 and shot 2; the island does not contain them,
 *     so a count that does not climb means nothing was drawn, however
 *     confident the HUD line is.
 *   - GO MOVES THE CAMERA, and lands it within a couple of body lengths
 *     of an animal that is ABOVE GROUND: the line's distance falls to
 *     nothing, the camera's own position changes, and the animal is one
 *     that can actually be looked at. Being flown to a buried worm is
 *     being flown to a patch of dirt, which is the complaint itself.
 *   - EACH PRESS SHOWS A DIFFERENT MODEL. GO rotates the species rather
 *     than walking a colony of aphids one centimetre at a time.
 *   - The switch STAYS ON across a reload, because it is written to the
 *     settings document like the HUD's fold — which is what makes it
 *     usable on a phone that reloads itself on every push.
 *
 * The last shot is the point of the exercise: the earthworm rig, the one
 * he has never seen, filling a phone screen.
 *
 * WHAT IT EXPECTS OF THE SCENE (so a missing half fails by name):
 *   data-field="eco-find"          the finder's line
 *   data-action="finder"           its checkbox, in the LAYERS column
 *   data-action="finder-go"        the GO button, disabled until there is somewhere to go
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { readPng } from './probePng.mjs';
import { stubWeather } from './probeWeather.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const SHOTS = path.join(ROOT, 'shots');

const VIEWPORT = { width: 932, height: 430 };
const CHROMIUM_ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];
const TIMEOUT = { menu: 60_000, world: 300_000, settle: 60_000 };
const SHOT_TIMEOUT_MS = 120_000;

const SAVE_KEY = 'traddomium.v1.solo-save';
const SAVE_VERSION = 2;
const MAP_ID = 'perf-empty';

const SETTLE_FRAMES = 30;
const DRAIN_FRAMES = 240;
const POLL_FRAMES = 10;

/** The Wailua forest, `probe:ecology`'s own site: every species above zero there. */
const SITE = { x: 1_559_200, z: -2_400, ground: 12_501, facing: 300 };
/** Three metres over the ground, looking slightly down — a person's flying height, not a plan view. */
const EYE_ABOVE_GROUND = 300;
const EYE_TOLERANCE = 60;
const PITCH = -18;

/** Held, so the shot and the counts are the same island every run (a worm surfaces at night and in rain). */
const HELD = { sky: 'clear', hour: 12 };
const DETAIL = 'high';

/**
 * The pin colours from `fauna/FinderView.PIN_LOOK`: the solid one an
 * animal in the open gets, and the pale one a buried worm gets.
 */
const PIN_COLOURS = [
  { name: 'worm', rgb: [0xff, 0x6a, 0x4d] },
  { name: 'worm (buried)', rgb: [0xff, 0xd0, 0xc4] },
  { name: 'aphid', rgb: [0xc6, 0xff, 0x4a] },
  { name: 'aphid (buried)', rgb: [0xe8, 0xff, 0xbe] },
  { name: 'fly', rgb: [0x6f, 0xd8, 0xff] },
];
/**
 * PER CHANNEL, and tight. Measured against a real forest shot with the
 * finder off: at 20 per channel not one of 400,760 pixels of island,
 * canopy or sky lands on any pin colour, so a count that climbs is pins
 * and nothing else. A loose Manhattan sum was tried first and matched a
 * quarter of a million pixels of forest floor — the check passed while
 * measuring the ground.
 */
const COLOUR_TOLERANCE = 20;
/** Pins to insist on: fewer than this over forty animals is nothing drawn. */
const MIN_PIN_PIXELS = 60;
/** And with the finder OFF the screen must be practically free of them. */
const MAX_PIN_PIXELS_OFF = 300;

const log = (message) => console.log(`[probe:finder] ${message}`);
let failed = false;
const fail = (message) => {
  failed = true;
  console.error(`[probe:finder] FAIL: ${message}`);
};

function chromiumPath() {
  const override = process.env.PLAYWRIGHT_CHROMIUM;
  if (override) {
    if (existsSync(override)) return override;
    throw new Error(`PLAYWRIGHT_CHROMIUM=${override} does not exist`);
  }
  if (existsSync(chromium.executablePath())) return undefined;
  for (const guess of ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']) {
    if (existsSync(guess)) return guess;
  }
  throw new Error(`no Chromium found; Playwright expects ${chromium.executablePath()}`);
}

/** A bearing (0 = north, clockwise) as the camera yaw the save wants. */
function yawForBearing(bearing) {
  const heading = ((180 - bearing) * Math.PI) / 180;
  return heading + Math.PI;
}

const runFrames = (page, count) => page.evaluate((n) => new Promise((done) => {
  let left = n;
  const step = () => {
    left -= 1;
    if (left <= 0) done(null);
    else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}), count);

const uiText = (page) => page.evaluate(() => document.getElementById('ui')?.innerText ?? '');

const field = (page, name) => page.evaluate(
  (n) => document.querySelector(`[data-field="${n}"]`)?.textContent ?? null,
  name,
);

const control = (page, action) => page.evaluate((a) => {
  const el = document.querySelector(`[data-action="${a}"]`);
  if (el === null) return null;
  return { checked: el.checked === true, disabled: el.disabled === true, text: el.textContent ?? '' };
}, action);

/** Put the camera at the site through a solo save, then resume into it. */
async function resumeAt(page, url, height) {
  const query = `sky=${encodeURIComponent(HELD.sky)}&hour=${encodeURIComponent(String(HELD.hour))}&detail=${DETAIL}`;
  const opened = `${url}${url.includes('?') ? '&' : '?'}${query}`;
  await page.goto(opened, { waitUntil: 'load' });
  await page.evaluate(({ key, save }) => window.localStorage.setItem(key, JSON.stringify(save)), {
    key: SAVE_KEY,
    save: {
      version: SAVE_VERSION,
      savedAt: '2026-01-01T00:00:00.000Z',
      mapId: MAP_ID,
      camera: {
        at: { wx: SITE.x, wz: SITE.z },
        height,
        yaw: yawForBearing(SITE.facing),
        pitch: (PITCH * Math.PI) / 180,
      },
    },
  });
  await page.goto(opened, { waitUntil: 'load' });
  await page.waitForSelector('[data-action="resume"]', { timeout: TIMEOUT.menu });
  await page.click('[data-action="resume"]', { timeout: TIMEOUT.menu });
  await page.waitForSelector('[data-action="pause"]', { timeout: TIMEOUT.world });
  await runFrames(page, SETTLE_FRAMES);
  for (let waited = 0; waited < DRAIN_FRAMES; waited += 10) {
    const pending = /pending (\d+)/.exec(await uiText(page));
    if (pending === null || Number(pending[1]) === 0) break;
    await runFrames(page, 10);
  }
  return opened;
}

/** Stand three metres over the TRUE ground: arrive, read the HUD's ABOVE line, correct, arrive again. */
async function arrive(page, url) {
  let height = SITE.ground + EYE_ABOVE_GROUND;
  let opened = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    opened = await resumeAt(page, url, height);
    const text = await uiText(page);
    const at = /x (-?[\d.]+) y (-?[\d.]+) z (-?[\d.]+)/.exec(text);
    const above = /above (-?[\d.]+) m/.exec(text);
    if (!at || !above) {
      fail('the HUD prints no camera position or ABOVE line');
      return opened;
    }
    const error = Number(above[1]) * 100 - EYE_ABOVE_GROUND;
    if (Math.abs(error) <= EYE_TOLERANCE) return opened;
    height = Number(at[2]) - Number(above[1]) * 100 + EYE_ABOVE_GROUND;
    log(`${above[1]} m over the ground on attempt ${attempt + 1}; correcting to y ${height.toFixed(0)}`);
  }
  return opened;
}

/** The camera's position, off the HUD. */
async function cameraAt(page) {
  const at = /x (-?[\d.]+) y (-?[\d.]+) z (-?[\d.]+)/.exec(await uiText(page));
  return at === null ? null : { x: Number(at[1]), y: Number(at[2]), z: Number(at[3]) };
}

/** Poll `eco-find` until `want(line)` or the clock runs out. */
async function untilLine(page, want, ms = TIMEOUT.settle) {
  const started = Date.now();
  for (;;) {
    const line = await field(page, 'eco-find');
    if (line === null) return { line, missing: true };
    if (want(line)) return { line, missing: false };
    if (Date.now() - started >= ms) return { line, missing: false, timedOut: true };
    await runFrames(page, POLL_FRAMES);
  }
}

/** Count pixels within tolerance of any pin colour. Nothing on the island is this saturated. */
function pinPixels(png) {
  const counts = PIN_COLOURS.map(() => 0);
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    for (let c = 0; c < PIN_COLOURS.length; c += 1) {
      const [pr, pg, pb] = PIN_COLOURS[c].rgb;
      if (Math.abs(r - pr) <= COLOUR_TOLERANCE && Math.abs(g - pg) <= COLOUR_TOLERANCE && Math.abs(b - pb) <= COLOUR_TOLERANCE) {
        counts[c] += 1;
        break;
      }
    }
  }
  return { counts, total: counts.reduce((a, b) => a + b, 0) };
}

async function shoot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  const png = readPng(await page.screenshot({ path: file, timeout: SHOT_TIMEOUT_MS }));
  log(`saved shots/${name}.png`);
  return png;
}

/** `find worm 12m NE` / `under worm 3m S` → the parts, or null. */
function parseFind(line) {
  const m = /^(find|under) (worm|aphid|fly) (\d+)m ([NSEW]{1,2})$/.exec(line ?? '');
  return m === null ? null : { under: m[1] === 'under', species: m[2], metres: Number(m[3]), bearing: m[4] };
}

async function main() {
  if (!existsSync(DIST_INDEX)) {
    fail('dist/index.html is missing. Run `npm run build` first.');
    process.exitCode = 1;
    return;
  }
  mkdirSync(SHOTS, { recursive: true });
  let server = null;
  let browser = null;
  try {
    server = await preview({ preview: { port: 4193, strictPort: true }, logLevel: 'silent' });
    const url = server.resolvedUrls.local[0];
    browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await stubWeather(page);
    page.on('pageerror', (error) => fail(`uncaught page error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') fail(`console error: ${message.text()}`);
    });

    // ── 1. THE FOREST, FINDER OFF: what he sees today ────────────────
    const opened = await arrive(page, url);
    const offLine = await field(page, 'eco-find');
    if (offLine === null) {
      fail('the HUD has no data-field="eco-find" line — the finder hook is not wired');
      return;
    }
    if (offLine !== 'find off') fail(`the finder line reads "${offLine}" before it is switched on; expected "find off"`);
    const box = await control(page, 'finder');
    if (box === null) fail('the LAYERS column has no data-action="finder" checkbox');
    else if (box.checked) fail('the finder is ON when the world opens; an instrument starts off');
    const go = await control(page, 'finder-go');
    if (go === null) fail('there is no data-action="finder-go" button');
    else if (!go.disabled) fail('GO is live while the finder is off — an unavailable action must never look functional');

    const before = await shoot(page, 'finder-off');
    const beforePins = pinPixels(before);
    log(`finder off: "${offLine}", ${beforePins.total} pin-coloured pixels on screen`);
    if (beforePins.total > MAX_PIN_PIXELS_OFF) {
      fail(`${beforePins.total} pin-coloured pixels with the finder OFF: either something is drawing pins, or a pin colour is a colour the island already wears`);
    }

    // ── 2. SWITCH IT ON: pins over the animals ───────────────────────
    await page.click('[data-action="finder"]', { timeout: TIMEOUT.menu });
    const onResult = await untilLine(page, (line) => line !== 'find off');
    if (onResult.timedOut) fail(`the finder line still reads "${onResult.line}" ${TIMEOUT.settle / 1000} s after the switch`);
    const found = parseFind(onResult.line);
    if (onResult.line === 'find nothing near') {
      fail('the forest reads "find nothing near"; probe:ecology counts forty worms of forty here');
    } else if (found === null) {
      fail(`the finder line reads "${onResult.line}", which is not a bearing on an animal`);
    } else {
      log(`finder on: "${onResult.line}" — ${found.species}, ${found.metres} m ${found.bearing}${found.under ? ', underground' : ''}`);
    }
    await runFrames(page, POLL_FRAMES);
    const after = await shoot(page, 'finder-on');
    const afterPins = pinPixels(after);
    const named = afterPins.counts
      .map((n, i) => (n > 0 ? `${PIN_COLOURS[i].name} ${n}` : null))
      .filter((s) => s !== null)
      .join(', ');
    log(`pin pixels: ${beforePins.total} → ${afterPins.total}${named === '' ? '' : ` (${named})`}`);
    if (afterPins.total < MIN_PIN_PIXELS) {
      fail(`only ${afterPins.total} pin-coloured pixels with the finder on: the line names an animal but nothing was drawn`);
    }
    if (afterPins.total <= beforePins.total) fail('the pin count did not climb when the finder was switched on');

    // GO must have woken up now that there is somewhere to go.
    const goOn = await control(page, 'finder-go');
    if (goOn !== null && goOn.disabled && found !== null) fail('GO is still disabled with an animal named on the line');

    // ── 3. PRESS GO: the camera lands on the animal ──────────────────
    const from = await cameraAt(page);
    await page.click('[data-action="finder-go"]', { timeout: TIMEOUT.menu });
    await runFrames(page, POLL_FRAMES);
    // GO FOLDS THE SHEET, because the centre of the screen — where the
    // camera has just put the animal — is underneath it. So the shot is
    // taken folded, which is what the player sees, and the sheet is
    // opened again before the line is read: a folded sheet stops writing
    // its columns, and reading one is reading the frame before GO.
    const folded = await control(page, 'hud-collapse');
    if (folded === null) fail('there is no data-action="hud-collapse" button to fold the sheet with');
    else if (folded.text.trim() !== '+') fail(`GO did not fold the stat sheet (its corner reads "${folded.text.trim()}"); the animal is behind it`);
    await shoot(page, 'finder-close');
    await page.click('[data-action="hud-collapse"]', { timeout: TIMEOUT.menu });
    await runFrames(page, POLL_FRAMES);

    const closeResult = await untilLine(page, (line) => {
      const p = parseFind(line);
      return p !== null && p.metres <= 1;
    }, 20_000);
    const to = await cameraAt(page);
    const closed = parseFind(closeResult.line);
    if (from === null || to === null) {
      fail('the HUD stopped printing a camera position');
    } else {
      const moved = Math.hypot(to.x - from.x, to.z - from.z, to.y - from.y);
      log(`GO moved the camera ${(moved / 100).toFixed(2)} m; the line now reads "${closeResult.line}"`);
      if (moved < 10) fail(`GO moved the camera ${moved.toFixed(1)} units; it did not go anywhere`);
    }
    if (closed === null) fail(`after GO the line reads "${closeResult.line}"`);
    else if (closed.metres > 1) fail(`after GO the nearest animal is still ${closed.metres} m away; the camera did not arrive`);
    else if (closed.under) {
      // THE WHOLE POINT: pressing GO must put a MODEL on the screen. The
      // nearest animal in a forest is usually a worm under the soil, and
      // being flown to one is being flown to a patch of dirt — which is
      // the complaint. `preferVisible` is what makes this pass, and a
      // forest holding a hundred and fifty aphids and fifty flies always
      // has something above ground to be taken to.
      fail(`GO landed on an animal that is underground ("${closeResult.line}") — nothing can be seen there; is preferVisible wired?`);
    } else {
      log(`GO put a ${closed.species} on the screen`);
    }

    // ── 3b. PRESS IT AGAIN: a DIFFERENT SPECIES ─────────────────────
    // Excluding the last animal is not enough — aphids live in colonies,
    // so the next-nearest is another aphid a centimetre away on the same
    // leaf. The tour rotates the species, so a second press must show a
    // different MODEL. Three species, so three presses come back round.
    const seenSpecies = closed === null ? [] : [closed.species];
    for (let press = 0; press < 2; press += 1) {
      const before2 = await cameraAt(page);
      await page.click('[data-action="finder-go"]', { timeout: TIMEOUT.menu });
      await runFrames(page, POLL_FRAMES);
      await page.click('[data-action="hud-collapse"]', { timeout: TIMEOUT.menu });
      await runFrames(page, POLL_FRAMES);
      const after2 = await cameraAt(page);
      const line2 = parseFind(await field(page, 'eco-find'));
      // One shot per animal, folded again so the sheet is not over it:
      // these three ARE the answer to "I don't see any of the models".
      await page.click('[data-action="hud-collapse"]', { timeout: TIMEOUT.menu });
      await runFrames(page, 2);
      await shoot(page, `finder-tour-${press + 2}`);
      await page.click('[data-action="hud-collapse"]', { timeout: TIMEOUT.menu });
      const moved = before2 === null || after2 === null
        ? null
        : Math.hypot(after2.x - before2.x, after2.z - before2.z, after2.y - before2.y);
      log(`press ${press + 2}: moved ${moved === null ? '?' : (moved / 100).toFixed(2)} m, now "${line2 === null ? '?' : `${line2.under ? 'under' : 'find'} ${line2.species}`}"`);
      if (line2 === null) { fail(`press ${press + 2}: the line reads nothing useful`); break; }
      if (seenSpecies.includes(line2.species)) {
        fail(`press ${press + 2} showed a ${line2.species} again (seen: ${seenSpecies.join(', ')}); the tour should rotate the species`);
        break;
      }
      seenSpecies.push(line2.species);
    }
    log(`the tour showed: ${seenSpecies.join(' → ')}`);

    // ── 4. THE SWITCH SURVIVES A RELOAD ─────────────────────────────
    // It is written to the settings document, like the HUD's fold: the
    // app reloads itself on every push now, and an instrument that came
    // back off each time would be switched on by hand every time.
    await page.goto(opened, { waitUntil: 'load' });
    await page.waitForSelector('[data-action="resume"]', { timeout: TIMEOUT.menu });
    await page.click('[data-action="resume"]', { timeout: TIMEOUT.menu });
    await page.waitForSelector('[data-action="pause"]', { timeout: TIMEOUT.world });
    await runFrames(page, SETTLE_FRAMES);
    const kept = await control(page, 'finder');
    if (kept === null) fail('after the reload there is no finder checkbox');
    else if (!kept.checked) fail('the finder switched itself off across a reload; the setting is not being written');
    else log('the switch survived a reload');

    if (!failed) {
      log('PASS: the line names an animal, the pins are on the screen, GO lands on it, and the switch is kept.');
    }
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
  }
  if (failed) process.exitCode = 1;
}

await main();
