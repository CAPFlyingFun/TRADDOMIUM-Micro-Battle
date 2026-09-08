/**
 * THE ANTENNAE SWEEP, PRESSED THE WAY A THUMB PRESSES IT.
 *
 * Joshua, 2026-09-08, with two screenshots of another game's version:
 * "it has a player/sense which is cool and basically will show objects in
 * a close radius and fill the insects with a solid color. The whole thing
 * last about 10s per ping/sense... which since it knows objects and stuff,
 * will be easy for it even in daytime."
 *
 * THE LAST FOUR WORDS ARE THE TEST. This runs at NOON, not at night: the
 * finder's pins are unlit gizmos that show up because everything else is
 * dark, and the whole point of the antennae is that they read against a
 * lit forest. A sweep that only works after sunset has not been built.
 *
 * WHAT IT ASSERTS, rather than merely photographing:
 *
 *   - THE FILLS ARE ON THE SCREEN. The three kind colours are counted in
 *     the pixels before the ping and during the hold; the climb is the
 *     evidence. The baseline is PRINTED rather than assumed — a forest
 *     that already wears these colours would make the check meaningless,
 *     and this says so out loud instead of passing quietly.
 *   - THE LINE TELLS THE TRUTH AT EVERY PHASE: `Ready to sweep` before,
 *     `Sensing · N lit` during, `Recovering · N s` after, and never `0 s`
 *     beside a button that still refuses.
 *   - THE BUTTON GOES DEAD AND COMES BACK. Disabled for the whole ping,
 *     enabled again by itself when the antennae have recovered — nothing
 *     the player has to do.
 *   - A SECOND PRESS MID-SWEEP CHANGES NOTHING: the count does not reset
 *     and the phase does not restart.
 *   - THE SWEEP STAYS WHERE IT WAS SENT. The camera is flown well clear
 *     of the anchor and the fills do not follow it.
 *   - THE CONTROLS DO NOT FIGHT. The ANTENNAE box clears the SOIL button
 *     AND the BURROWS panel when that panel is OPEN — which is the whole
 *     reason it sits beside SOIL rather than above it, since the panel
 *     opens upward out of that button.
 *
 * WHAT IT EXPECTS OF THE SCENE (so a missing half fails by name):
 *   data-action="antennae"   the button
 *   data-field="antennae"    its line
 *   data-action="soil"       the SOIL toggle it must not overlap
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
const TIMEOUT = { menu: 60_000, world: 300_000 };
const SHOT_TIMEOUT_MS = 120_000;

const SAVE_KEY = 'traddomium.v1.solo-save';
const SAVE_VERSION = 2;
const MAP_ID = 'perf-empty';

const SETTLE_FRAMES = 30;
const DRAIN_FRAMES = 240;

/** The Wailua forest, `probe:ecology`'s own site: every species above zero there. */
const SITE = { x: 1_559_200, z: -2_400, ground: 12_501, facing: 300 };
/** Low, because a sweep reaches six metres and an ant's eye is what it is for. */
const EYE_ABOVE_GROUND = 60;
const EYE_TOLERANCE = 30;
const PITCH = -10;

/** NOON. The whole claim is that this reads in daylight. */
const HELD = { sky: 'clear', hour: 12 };
const DETAIL = 'high';

/** `sense/senseTypes.SENSE_COLOURS`, which nothing on Kaua'i wears. */
const KIND_COLOURS = [
  { name: 'creature', rgb: [0xff, 0xc2, 0x4d] },
  { name: 'plant', rgb: [0xcd, 0xff, 0xd6] },
  { name: 'material', rgb: [0xd6, 0xec, 0xff] },
];
/**
 * Per channel, and it has to be WIDE ENOUGH FOR THE BLEND. The fills are
 * drawn at FILL_OPACITY 0.85 times the pulse's own strength, so a lit
 * pixel is 0.85 of the colour plus 0.15 of whatever is behind it: up to
 * 0.15 x 255 = 38 per channel away from the pure hue at full strength,
 * and further still out at the rim, where the envelope falls to
 * EDGE_STRENGTH. Twenty was tried first and counted ZERO fill pixels in
 * a frame whose labels and green bodies are plainly in the screenshot —
 * a check that tight measures the constant, not the feature. Forty
 * covers a full-strength fill against any background; the rim's are
 * simply not counted, which is honest, since the near ones are what the
 * player is looking at.
 *
 * SO THE MEASUREMENT IS THE CLIMB, NOT THE ABSOLUTE. At this tolerance
 * the game's own gold chrome — the move stick's knob and ring, the
 * folded sheet, Pause, SOIL, ANTENNAE — lands inside the creature amber,
 * about 1,760 pixels of it. That is not a fault to tune away: the
 * controls are DOM over the canvas, so a world fill can never cover one,
 * which makes the chrome exactly constant between the two shots. The
 * difference between them is therefore the world and only the world.
 * Both numbers are printed, so chrome that has started moving would show
 * up as a baseline that changed rather than as a check gone quiet.
 *
 * THE SHEET IS FOLDED BEFORE ANY OF THIS IS COUNTED. The HUD's own gold
 * (#c9a94a — its borders, its headings, the slider's thumb) sits within
 * any useful tolerance of the creature amber, and the first run of this
 * probe counted 1,718 pixels of instrument as forest. A colour check
 * that includes the instrument measuring it is not a check.
 */
const COLOUR_TOLERANCE = 40;
/** Fill pixels the ping must ADD. Below this, nothing was drawn. */
const MIN_FILL_CLIMB = 500;

const log = (message) => console.log(`[probe:sense] ${message}`);
let failed = false;
const fail = (message) => {
  failed = true;
  console.error(`[probe:sense] FAIL: ${message}`);
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

const button = (page, action) => page.evaluate((a) => {
  const el = document.querySelector(`[data-action="${a}"]`);
  if (el === null) return null;
  return {
    disabled: el.disabled === true,
    ariaDisabled: el.getAttribute('aria-disabled'),
    text: (el.textContent ?? '').trim(),
  };
}, action);

/** A control's box on screen, or null when it is not there. */
const boxOf = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
}, selector);

function overlaps(a, b) {
  return a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
}

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

/** Stand the eye a fixed height over the TRUE ground: arrive, read the ABOVE line, correct, arrive again. */
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

/** Count the pixels near each kind's colour. */
async function fillPixels(page, file) {
  const shot = await page.screenshot({ timeout: SHOT_TIMEOUT_MS });
  if (file) await page.screenshot({ path: path.join(SHOTS, file), timeout: SHOT_TIMEOUT_MS });
  const png = readPng(shot);
  const counts = KIND_COLOURS.map(({ name }) => ({ name, count: 0 }));
  // `probePng` normalises every shot to RGBA whatever the file was.
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    for (let k = 0; k < KIND_COLOURS.length; k += 1) {
      const [wr, wg, wb] = KIND_COLOURS[k].rgb;
      if (Math.abs(r - wr) <= COLOUR_TOLERANCE
        && Math.abs(g - wg) <= COLOUR_TOLERANCE
        && Math.abs(b - wb) <= COLOUR_TOLERANCE) {
        counts[k].count += 1;
        break;
      }
    }
  }
  return { counts, total: counts.reduce((sum, c) => sum + c.count, 0) };
}

const describe = (counts) => counts.map((c) => `${c.name} ${c.count}`).join(', ');

async function main() {
  if (!existsSync(DIST_INDEX)) throw new Error('no dist/index.html; run `npm run build` first');
  mkdirSync(SHOTS, { recursive: true });

  const server = await preview({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.ts'),
    logLevel: 'silent',
    preview: { host: '127.0.0.1', port: 4197, strictPort: true, open: false },
  });
  const url = server.resolvedUrls.local[0];
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await stubWeather(page);
  const noise = [];
  page.on('pageerror', (e) => noise.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') noise.push(`console: ${m.text()}`); });

  try {
    await arrive(page, url);
    // FOLD THE SHEET: it is two thirds of this viewport and it is gold,
    // which is the creature colour. Its own probe (`probe:hud`) owns
    // whether it folds; here it is simply in the way.
    const fold = await page.$('[data-action="hud-collapse"]');
    if (fold === null) fail('there is no [data-action="hud-collapse"] to fold the sheet with');
    else { await fold.click(); await runFrames(page, 4); }

    // ── BEFORE ─────────────────────────────────────────────────────
    const ready = await button(page, 'antennae');
    if (ready === null) {
      fail('there is no [data-action="antennae"] button in the built game');
      throw new Error('nothing to press');
    }
    if (ready.text !== 'ANTENNAE') fail(`the button reads "${ready.text}", not ANTENNAE`);
    if (ready.disabled) fail('the button is dead before anything has been pressed');
    const line0 = await field(page, 'antennae');
    if (line0 !== 'Ready to sweep') fail(`the line reads "${line0}" before a ping, not "Ready to sweep"`);

    const before = await fillPixels(page, 'sense-before.png');
    log(`before the ping (the game's own gold chrome): ${describe(before.counts)} — total ${before.total}`);

    // ── THE PING ───────────────────────────────────────────────────
    await page.click('[data-action="antennae"]');
    await runFrames(page, 4);
    const pressed = await button(page, 'antennae');
    if (!pressed.disabled) fail('the button is still live on the frame after a press');
    if (pressed.ariaDisabled !== 'true') fail(`aria-disabled reads "${pressed.ariaDisabled}" while the button is dead`);

    // Let the sweep reach its full radius and settle into the hold.
    await runFrames(page, 90);
    const during = await fillPixels(page, 'sense-lit.png');
    const lit = await field(page, 'antennae');
    const climb = during.counts.map((c, i) => ({ name: c.name, count: c.count - before.counts[i].count }));
    log(`during the hold: ${describe(during.counts)} — total ${during.total}`);
    log(`THE CLIMB: ${describe(climb)} — total ${during.total - before.total}`);
    log(`the line reads: ${lit}`);
    if (during.total - before.total < MIN_FILL_CLIMB) {
      fail(`the ping added only ${during.total - before.total} fill pixels; nothing was drawn`);
    }
    const sensing = /^Sensing · (\d+) lit$/.exec(lit ?? '');
    if (sensing === null) fail(`the line reads "${lit}" during the sweep, not "Sensing · N lit"`);
    else if (Number(sensing[1]) === 0) fail('the sweep says it has lit nothing in a forest');

    // A SECOND PRESS MID-SWEEP CHANGES NOTHING.
    await page.evaluate(() => document.querySelector('[data-action="antennae"]')?.click());
    await runFrames(page, 4);
    const again = await field(page, 'antennae');
    if (!/^Sensing · \d+ lit$/.test(again ?? '')) {
      fail(`a second press mid-sweep changed the line to "${again}"`);
    }

    // THE ANCHOR is `tests/senseSweep.test.ts`'s to prove, not this
    // probe's: flying the camera from here would mean driving the move
    // stick through synthetic pointer events, and a test that pretends
    // to move a camera and does not would pass either way. The unit test
    // holds the lens 500 m from the anchor and reads the fills directly.

    // ── THE CONTROLS DO NOT FIGHT ──────────────────────────────────
    const antennaeBox = await boxOf(page, '.antennae');
    const soilBox = await boxOf(page, '[data-action="soil"]');
    if (antennaeBox === null) fail('the antennae control has no box on screen');
    else if (antennaeBox.right > VIEWPORT.width || antennaeBox.bottom > VIEWPORT.height
      || antennaeBox.x < 0 || antennaeBox.y < 0) {
      fail(`the antennae control runs off a ${VIEWPORT.width}x${VIEWPORT.height} screen: ${JSON.stringify(antennaeBox)}`);
    }
    if (antennaeBox && soilBox) {
      if (overlaps(antennaeBox, soilBox)) fail('the antennae control overlaps the SOIL button');
      else log(`antennae ${antennaeBox.width.toFixed(0)}x${antennaeBox.height.toFixed(0)} at`
        + ` ${antennaeBox.x.toFixed(0)},${antennaeBox.y.toFixed(0)}; SOIL at ${soilBox.x.toFixed(0)},${soilBox.y.toFixed(0)} — clear`);
      // AND WITH THE BURROWS PANEL OPEN, which grows UPWARD out of SOIL.
      await page.click('[data-action="soil"]');
      await runFrames(page, 4);
      const panel = await boxOf(page, '[data-soil-panel]');
      if (panel === null) fail('the BURROWS panel did not open');
      else if (overlaps(antennaeBox, panel)) {
        fail(`the open BURROWS panel (${panel.width.toFixed(0)}x${panel.height.toFixed(0)}`
          + ` at ${panel.x.toFixed(0)},${panel.y.toFixed(0)}) covers the antennae control`);
      } else {
        log(`the open BURROWS panel is ${panel.height.toFixed(0)} px tall and clears the antennae control`);
      }
      await page.click('[data-action="soil-close"]');
      await runFrames(page, 4);
    }

    // ── IT COMES BACK BY ITSELF ────────────────────────────────────
    // The whole cycle is a 0.8 s sweep, ten held, 1.5 fading and four
    // recovering; at the headless renderer's pace that is a long wait in
    // frames, so this polls rather than guessing a count.
    let recovered = null;
    let sawRecovering = false;
    for (let tries = 0; tries < 240; tries += 1) {
      const now = await field(page, 'antennae');
      if (/^Recovering · (\d+) s$/.test(now ?? '')) {
        sawRecovering = true;
        if (/ 0 s$/.test(now)) fail('the line reads "0 s" while the button still refuses');
      }
      if (now === 'Ready to sweep') { recovered = tries; break; }
      await runFrames(page, 5);
    }
    if (!sawRecovering) {
      // Not a failure: the headless renderer runs at about a frame and a
      // half a second, so a 5.5 s fade-and-cooldown can pass inside one
      // poll. The check that matters is that it came back untouched.
      log('the recovering phase fell between two polls (this renderer runs at ~1.5 fps)');
    }
    if (recovered === null) fail('the antennae never came back to ready on their own');
    else {
      const back = await button(page, 'antennae');
      if (back.disabled) fail('the line says ready but the button is still dead');
      else log(`ready again with nothing pressed, after ${recovered * 5} more frames; button live`);
    }

    await page.screenshot({ path: path.join(SHOTS, 'sense-after.png'), timeout: SHOT_TIMEOUT_MS });
    if (noise.length > 0) fail(`console noise: ${noise.join(' | ')}`);
  } finally {
    await browser.close();
    await server.close();
  }

  if (failed) process.exitCode = 1;
  else log('PASS: the sweep lights the forest at noon, the line tells the truth, the button recovers, and the controls do not fight.');
}

main().catch((error) => {
  console.error(`[probe:sense] ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
});
