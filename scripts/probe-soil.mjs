/**
 * Built-game check of the first shared soil milestone, at the Wailua
 * forest used by probe:finder. Uses a fresh browser profile and the
 * player's SOIL / Find worm / depth / pause / resume controls. Screenshots
 * are evidence for visual review; software rendering is not phone timing.
 *
 * THE INSIDE SECTION (2026-09-08) walks the camera down to the cut floor
 * and looks along the worm's groove, the way Joshua's alpha.34 shots were
 * taken (shots/cutaway-along-tunnel.png and cutaway-below-floor.png), and
 * checks three things with pixels rather than with the scene's numbers:
 * that nothing below the horizon is the void under the island, that the
 * section is either not there or whole on the frame after it opens, and
 * that the camera's height on the sheet stops at the floor when Q is
 * held. What the reproduction taught, reused here: the stat sheet's
 * hidden columns stop refreshing when it is folded, so every reading is
 * taken with it open and every shot with it shut; the free-fly camera
 * integrates raw frame time, so it is slowed with a wheel event on the
 * canvas and stepped a frame at a time; and look-drags go on bare canvas,
 * because the sheet and the panel swallow pointer events.
 *
 * Run after npm run build. PLAYWRIGHT_CHROMIUM can select an installed
 * browser, as with probe:boot. No browser download or production save.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { readPng } from './probePng.mjs';
import { stubWeather } from './probeWeather.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAVE_KEY = 'traddomium.v1.solo-save';
const SHOTS = path.join(ROOT, 'shots');
const log = message => console.log(`[probe:soil] ${message}`);
const errors = [];
let server, browser;

/**
 * The same order every other probe here uses: an explicit override,
 * Playwright's own pinned path when it exists, then the browsers this
 * machine actually has. Playwright's pin moves with the npm dependency
 * while the installed Chromium does not, so a probe that asks only for
 * the pinned path refuses to run on a box where the others are fine —
 * which is what this one did (`chromium-1234` expected, `chromium-1194`
 * installed).
 */
function browserPath() {
  const override = process.env.PLAYWRIGHT_CHROMIUM;
  if (override) {
    assert(existsSync(override), `PLAYWRIGHT_CHROMIUM=${override} does not exist`);
    return override;
  }
  const pinned = chromium.executablePath();
  if (existsSync(pinned)) return pinned;
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  for (const guess of [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome',
    browsers ? path.join(browsers, 'chromium') : null,
  ]) {
    if (guess !== null && existsSync(guess)) return guess;
  }
  assert.fail(`No installed Chromium: Playwright expects ${pinned}. Set PLAYWRIGHT_CHROMIUM.`);
}

/** Save a shot and hand back its pixels, so a check never reads a different frame from the one on disk. */
async function shot(page, name) {
  const bytes = await page.screenshot({ timeout: 120_000 });
  writeFileSync(path.join(SHOTS, `soil-${name}.png`), bytes);
  log(`saved shots/soil-${name}.png`);
  return readPng(bytes);
}

async function frames(page, count) {
  await page.evaluate(n => new Promise(resolve => {
    const step = () => --n <= 0 ? resolve() : requestAnimationFrame(step);
    requestAnimationFrame(step);
  }), count);
}

async function saved(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), SAVE_KEY);
}

async function pauseAndRead(page) {
  const previous = (await saved(page)).savedAt;
  await page.locator('[data-action="pause"]').click();
  // The world observes AppState on its next animation frame. A click
  // completing is earlier than that save point on a software renderer.
  await page.waitForFunction(({ key, previous }) =>
    JSON.parse(localStorage.getItem(key))?.savedAt !== previous,
  { key: SAVE_KEY, previous });
  return saved(page);
}

async function checkControlsFit(page, width, height) {
  const controls = await page.locator('.soil-inspector button, .soil-inspector input').evaluateAll(nodes =>
    nodes.filter(node => node.getClientRects().length).map(node => {
      const box = node.getBoundingClientRect();
      return { name: node.getAttribute('aria-label') ?? node.textContent,
        x: box.x, y: box.y, right: box.right, bottom: box.bottom, height: box.height };
    }));
  assert.equal(controls.length, 5, 'All four buttons and the depth slider must be visible.');
  for (const box of controls) {
    assert(box.x >= 0 && box.y >= 0 && box.right <= width + 1 && box.bottom <= height + 1,
      `${box.name} is outside ${width}×${height}`);
    assert(box.height >= 44, `${box.name} needs a usable touch target`);
  }
  log(`all soil controls fit ${width}×${height}, with touch targets at least 44 px high`);
}

// ─── the inside section's instruments ────────────────────────────────

const field = (page, name) => page.evaluate(n => document.querySelector(`[data-field="${n}"]`)?.textContent ?? null, name);
const status = page => page.locator('.soil-inspector [role="status"]').textContent();
const expand = async page => { await page.getByRole('button', { name: 'Expand stats' }).click(); await frames(page, 2); };
const collapse = async page => { await page.getByRole('button', { name: 'Collapse stats' }).click(); await frames(page, 2); };
/** The camera's height off the sheet's camera column, world units to a tenth. Read with the sheet OPEN. */
const yOf = async page => Number(/y (-?[\d.]+)/.exec((await field(page, 'camera-position')) ?? '')?.[1] ?? NaN);
const pitchOf = async page => Number(/pitch (-?\d+)°/.exec((await field(page, 'camera-facing')) ?? '')?.[1] ?? NaN);
async function logPose(page) {
  log(`${await field(page, 'camera-position')} | ${await field(page, 'camera-facing')} | ${await field(page, 'camera-above')}`);
}
/** Slow the camera by the wheel, dispatched on the canvas: 1.25× a notch, exponential, so 1000 is about ×0.1. */
async function slowWheel(page, deltaY) {
  await page.evaluate(d => document.querySelector('canvas')?.dispatchEvent(
    new WheelEvent('wheel', { deltaY: d, bubbles: true, cancelable: true })), deltaY);
  await frames(page, 3);
}
/** Hold a key for exactly one animation frame, with nothing focused that could eat it. */
async function tapKey(page, code) {
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.down(code);
  await frames(page, 1);
  await page.keyboard.up(code);
}
/** Drag the look on bare canvas — below the folded sheet, right of the stick, left of the panel. */
async function dragLook(page, dx, dy) {
  const x = dx < 0 ? 600 : 400, y = 400;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await frames(page, 4);
}
/**
 * Level the look to a pitch, to the degree the sheet prints: the drag's
 * turn is 0.0035 rad a pixel (`FreeFlyCamera`), so the remaining error
 * is a known number of pixels. Reads with the sheet open, drags with it
 * shut.
 */
async function levelTo(page, targetDeg) {
  for (let i = 0; i < 6; i += 1) {
    await expand(page);
    const pitch = await pitchOf(page);
    await collapse(page);
    const delta = targetDeg - pitch;
    if (!Number.isFinite(pitch) || Math.abs(delta) <= 1) return pitch;
    await dragLook(page, 0, -(delta * Math.PI / 180) / 0.0035);
  }
  await expand(page);
  const pitch = await pitchOf(page);
  await collapse(page);
  return pitch;
}
/**
 * Step a key a frame at a time, reading the open sheet, until the
 * camera's height stops changing: three readings within half a unit,
 * which the clamp produces (the floor follows the ground's slope by a
 * fraction of a unit a step) and a descent down the view does not.
 */
async function stepUntilHeld(page, code, cap) {
  const y0 = await yOf(page);
  let last = y0, still = 0;
  for (let i = 0; i < cap; i += 1) {
    await tapKey(page, code);
    const y = await yOf(page);
    still = Math.abs(y - last) < 0.5 ? still + 1 : 0;
    last = y;
    if (i % 10 === 0) log(`${code} step ${i}: y ${y.toFixed(1)} (dropped ${(y0 - y).toFixed(1)})`);
    if (still >= 3) return { steps: i + 1, y, dropped: y0 - y };
  }
  return { steps: cap, y: last, dropped: y0 - last };
}

/**
 * The HUD's boxes at 932 × 430, left out of every pixel count: the fps
 * box and PAUSE along the top, the stick bottom-left, the BURROWS panel
 * and the ANTENNAE / SOIL row bottom-right. The stick's ring is
 * translucent and the panel's text is gold, and both would otherwise
 * count as whatever colour the check is looking for.
 */
const HUD_BOXES = [[0, 172, 0, 54], [834, 932, 0, 52], [0, 160, 262, 430], [644, 924, 88, 362], [604, 932, 360, 420]];
const inHud = (x, y) => HUD_BOXES.some(([x0, x1, y0, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
const pixel = (png, x, y) => { const i = (y * png.width + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
const colourDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Count the world's pixels (the HUD left out) for which `test` holds, from `fromRow` down. */
function countWorld(png, test, fromRow = 0) {
  let count = 0, total = 0;
  for (let y = fromRow; y < png.height; y += 1) for (let x = 0; x < png.width; x += 1) {
    if (inHud(x, y)) continue;
    total += 1;
    if (test(pixel(png, x, y), x, y)) count += 1;
  }
  return { count, total };
}
/**
 * Soil, as the camera sees it: red over green over blue by a margin, and
 * not so dark it could be the panel or so light it could be the gold.
 * Grass (72, 99, 45) fails on red under green; the pit floor (96, 71, 45)
 * and its walls pass. Calibrated against shots/cutaway-outside.png.
 */
const isBrown = ([r, g, b]) => r >= 50 && r <= 200 && r > g + 10 && g > b + 10;
/** Soil or the unlit dark of a wall or the sheet's underside: what the ground line of a column is made of. */
const isGround = p => isBrown(p) || Math.max(p[0], p[1], p[2]) < 70;
/**
 * The horizon colour the void under the island is drawn in: the scene's
 * HORIZON, which is the BACKGROUND — not the dome. Through the tunnel
 * mouth in shots/cutaway-along-tunnel.png the void was (157, 182, 198)
 * while the dome at the top of the frame was (116, 138, 171), 66 apart,
 * so a check against the dome alone would never have seen the hole.
 */
const HORIZON = [157, 182, 198];
const SKY_TOLERANCE = 30;
/**
 * THE VOID IS SKY WITH SOIL OVER IT. A fixed row under the horizon was
 * tried first and read the real sky as a hole: the ground here slopes,
 * so on one side of the frame the land beyond the rim falls away under
 * the eye line and honest sky shows below row 230. What tells the two
 * apart is the column: real sky runs from the top of the frame down to
 * the first soil in its column, while the void under the island — the
 * far end of shots/cutaway-along-tunnel.png — has the rim wall ABOVE
 * it. So each column is walked from the top, its ground line is the
 * first soil-or-dark pixel, and only sky-coloured pixels BELOW that
 * line are counted. The HUD's boxes are skipped, not read.
 */
/** Consecutive soil-or-dark pixels that make a column's ground line: the rim's slanted edge leaves single dark specks with sky right under them. */
const GROUND_RUN = 3;
function voidUnderGround(png, skyish) {
  let count = 0, minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
  for (let x = 0; x < png.width; x += 1) {
    let ground = false, run = 0;
    for (let y = 0; y < png.height; y += 1) {
      if (inHud(x, y)) continue;
      const p = pixel(png, x, y);
      // A ground line is a run, not a speck: a slanted rim edge leaves
      // single dark pixels with sky right under them.
      if (!ground) { run = isGround(p) ? run + 1 : 0; if (run >= GROUND_RUN) ground = true; continue; }
      if (!skyish(p)) continue;
      count += 1;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  return { count, box: count ? `x${minX}-${maxX} y${minY}-${maxY}` : 'none' };
}

try {
  assert(existsSync(path.join(ROOT, 'dist/index.html')), 'Run npm run build first.');
  mkdirSync(SHOTS, { recursive: true });
  server = await preview({ root: ROOT, logLevel: 'silent',
    preview: { host: '127.0.0.1', port: 4183, strictPort: false, open: false } });
  const base = server.resolvedUrls?.local[0];
  assert(base, 'Vite must report the built-game URL.');
  const url = `${base}?sky=clear&hour=12&detail=medium`;
  browser = await chromium.launch({ executablePath: browserPath(),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 932, height: 430 }, hasTouch: true });
  page.setDefaultTimeout(180_000);
  await stubWeather(page);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  await page.evaluate(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), {
    key: SAVE_KEY,
    save: { version: 2, savedAt: '2026-09-08T00:00:00.000Z', mapId: 'perf-empty',
      camera: { at: { wx: 1_559_200, wz: -2_400 }, height: 12_801, yaw: 4.19, pitch: -.3 } },
  });
  await page.reload();
  await page.locator('[data-screen="menu"] [data-action="resume"]').click();
  await page.locator('[data-action="soil"]').waitFor();
  await frames(page, 30);
  await page.locator('[data-action="soil"]').tap();
  await page.locator('[data-action="soil-worm"]').tap();
  // THE FRAME AFTER THE SECTION OPENS. Either the ground is still intact
  // or the whole pit is there; a pit arriving a column at a time was the
  // sky-coloured rim of shots/cutaway-outside.png. Compared with the
  // finished view below, once it exists.
  await frames(page, 1);
  const openingStatus = await status(page);
  const opening = await shot(page, 'opening');
  log(`opening shot taken with the panel reading "${openingStatus}"`);
  assert.equal(await page.getByRole('slider').inputValue(), '12', 'Find worm must select cutaway depth.');
  log('Find worm selected a nearby worm and opened the cutaway');
  await checkControlsFit(page, 932, 430);
  const touchDepth = page.getByRole('slider');
  const touchBox = await touchDepth.boundingBox();
  assert(touchBox, 'The depth slider must have a touchable rectangle.');
  await touchDepth.tap({ position: { x: touchBox.width * .75, y: touchBox.height / 2 } });
  assert(Number(await touchDepth.inputValue()) > 12, 'A touch on the depth track must change the cutaway.');
  await page.locator('[data-action="soil-worm"]').tap();
  assert.equal(await touchDepth.inputValue(), '12');
  // Find worm folds the stats sheet. Its hidden columns deliberately stop
  // refreshing, so open it before observing the applied-edit counter.
  await page.getByRole('button', { name: 'Expand stats' }).click();
  // Enough simulated time to cross the worm submission spacing, even on
  // a slow software renderer. Inspect the applied counter, never attempts.
  await page.waitForFunction(() => /ground edits [1-9]\d*/.test(
    document.querySelector('[data-field="eco-ground"]')?.textContent ?? ''), null, { timeout: 180_000 });
  log(await page.locator('[data-field="eco-ground"]').textContent());
  // THE WHOLE PIT, before the finished shot — and the world PAUSED while
  // it is built. Nothing is published until every column of the window
  // is current (terrain/SoilView.ts), and a worm bites the column under
  // its head every fifth of a simulated second: at 60 fps on the phone
  // that is a bite every dozen frames against a column a frame, and a
  // hundred-column window arrives in about two seconds. This renderer
  // draws a frame a second and the simulation takes its capped tenth of
  // a second each, so here the worm bites every SECOND frame, each bite
  // re-queues the column nearest the focus ahead of the ones still
  // unbuilt, and the window settles at half a column a frame — minutes
  // (the diagnostic of 2026-09-08: pending 99 → 79 in 150 frames). That
  // is the probe's clock, not the game's ("never retune a per-second
  // system from probe wall-clock"), so the worm is frozen with the
  // pause the player has: the camera still flies and the section still
  // builds on wall-clock. The pause is also the save point the strokes
  // are checked at.
  await page.getByRole('button', { name: 'Collapse stats' }).click();
  const firstSave = await pauseAndRead(page);
  assert(firstSave.terrainEdits?.strokes.length > 0, 'Pause must persist actual worm cuts.');
  log(`pause saved ${firstSave.terrainEdits.strokes.length} soil cuts`);
  await page.waitForFunction(() =>
    document.querySelector('.soil-inspector [role="status"]')?.textContent !== 'Preparing soil view…', null, { timeout: 300_000 });
  log(`the whole window is built: ${await status(page)}`);
  await page.locator('[data-action="resume"]').click();
  await frames(page, 6);
  const finished = await shot(page, 'mobile-cutaway');
  const finishedBrown = countWorld(finished, isBrown).count;
  const openingBrown = countWorld(opening, isBrown).count;
  log(`soil-coloured pixels: ${openingBrown} the frame after opening, ${finishedBrown} finished`);
  assert(finishedBrown >= 2000, 'The finished cutaway must show a pit the pixel check can see.');
  assert(openingBrown <= finishedBrown * .05 || openingBrown >= finishedBrown * .9,
    `The frame after opening must show intact ground or the whole pit, not ${openingBrown} of ${finishedBrown} soil pixels.`);

  // ─── INSIDE: down to the cut floor, along the groove, and under it ──
  // Live, and brisk: the worm is crawling again at its measured 15 mm/s
  // of simulated time, a tenth of a second a frame here, and the window
  // follows it. A few units a frame down the view keeps the whole of
  // this section inside the window the worm is dragging along.
  await expand(page);
  await logPose(page);
  await slowWheel(page, 700);
  log(await field(page, 'camera-speed'));
  // Forward along the view, which Find worm aimed down at the worm, until
  // the height holds: the floor. Find worm stands 18 units over the
  // worm's ground and the cut is 12 mm, so the drop is about 19 units
  // less the slope crossed on the way.
  const descent = await stepUntilHeld(page, 'KeyW', 60);
  log(`held at y ${descent.y.toFixed(1)} after ${descent.steps} W frames, dropped ${descent.dropped.toFixed(1)} units`);
  assert(descent.steps < 60, 'The camera must reach the cut floor and be held there.');
  assert(descent.dropped >= 15 && descent.dropped <= 23,
    `A drop of ${descent.dropped.toFixed(1)} is not the 19 units from Find worm\'s stand to the floor.`);
  await logPose(page);
  await collapse(page);
  const pitch = await levelTo(page, 0);
  log(`levelled to pitch ${pitch}°`);
  await frames(page, 6);
  const along = await shot(page, 'inside-along');
  const dome = pixel(along, 466, 40);
  const skyish = p => colourDistance(p, dome) <= SKY_TOLERANCE || colourDistance(p, HORIZON) <= SKY_TOLERANCE;
  const hole = voidUnderGround(along, skyish);
  log(`sky-coloured pixels under soil in soil-inside-along: ${hole.count} (${hole.box}; dome sample ${dome})`);
  assert.equal(hole.count, 0,
    'Looking along the groove from the floor, no sky may show under soil: the tunnel\'s end must be a wall, not the void under the island.');

  // Q for a while: the sheet's y must stop at the floor.
  await expand(page);
  const floorY = await yOf(page);
  const lowest = { y: floorY };
  for (let i = 0; i < 15; i += 1) {
    await tapKey(page, 'KeyQ');
    lowest.y = Math.min(lowest.y, await yOf(page));
  }
  log(`after 15 frames of Q the height reads ${lowest.y.toFixed(1)}; the floor was ${floorY.toFixed(1)}`);
  assert(lowest.y >= floorY - .15, `Q took the camera below the cut floor: ${lowest.y.toFixed(1)} under ${floorY.toFixed(1)}.`);
  await logPose(page);
  await collapse(page);
  await frames(page, 4);
  await shot(page, 'inside-below');

  // Shut the section with the eye still at the floor: 12 mm inside solid
  // soil now, and the frame must be soil, not the void under the sheet.
  await page.locator('[data-action="soil-surface"]').tap();
  await frames(page, 6);
  const shut = await shot(page, 'inside-shut');
  const buried = countWorld(shut, isBrown);
  const empty = countWorld(shut, p => colourDistance(p, HORIZON) <= SKY_TOLERANCE);
  log(`with the section shut around the eye: ${buried.count} of ${buried.total} pixels soil-coloured, ${empty.count} horizon-coloured`);
  // The fog closes within five centimetres, so nothing beyond that can
  // be the horizon; what is nearer is the sheet's underside, unlit and
  // dark before the fog has it, which is why the soil share is a floor
  // and not the whole frame.
  assert.equal(empty.count, 0, 'With the eye inside the ground nothing may read as the empty space under the island.');
  assert(buried.count >= buried.total * .6, 'With the eye inside the ground the world must fog to the soil\'s colour.');
  // Back to the pit for the rest of the run, WHOLE again before the PC
  // shots: shutting the section released every column, and a fresh
  // window is built from nothing — so the worm is frozen for it once
  // more, for the reason given above. The pause is a save point too.
  await page.locator('[data-action="soil-worm"]').tap();
  assert.equal(await touchDepth.inputValue(), '12');
  const secondSave = await pauseAndRead(page);
  assert(secondSave.terrainEdits?.strokes.length >= firstSave.terrainEdits.strokes.length, 'A later pause must hold at least the cuts an earlier one did.');
  await page.waitForFunction(() =>
    document.querySelector('.soil-inspector [role="status"]')?.textContent !== 'Preparing soil view…', null, { timeout: 300_000 });
  log(`the window is whole again: ${await status(page)}`);
  await page.locator('[data-action="resume"]').click();
  await frames(page, 4);

  await page.setViewportSize({ width: 1200, height: 750 });
  await checkControlsFit(page, 1200, 750);
  const depth = page.getByRole('slider');
  await depth.focus();
  await depth.press('ArrowRight');
  assert.equal(await depth.inputValue(), '13', 'PC arrow key must control the focused depth slider.');
  // A depth change no longer clears the pit: the 12 mm one stays on
  // screen while the 13 mm one is built, so the shot needs no settling
  // time — a few frames for the viewport, and it shows the kept view
  // with the panel saying the new one is being prepared.
  await frames(page, 10);
  await shot(page, 'desktop-cutaway');
  await page.locator('[data-action="soil-surface"]').click();
  assert.equal(await depth.inputValue(), '0');
  await frames(page, 10);
  await shot(page, 'surface');
  await page.locator('[data-action="soil-close"]').click();
  assert.equal(await page.locator('[data-action="soil"]').getAttribute('aria-expanded'), 'false');
  const beforeReload = await pauseAndRead(page);
  await page.reload();
  await page.locator('[data-screen="menu"] [data-action="resume"]').click();
  await page.locator('[data-action="soil"]').waitFor();
  await frames(page, 10);
  const restored = await pauseAndRead(page);
  assert.deepEqual(restored.terrainEdits.strokes.slice(0, beforeReload.terrainEdits.strokes.length),
    beforeReload.terrainEdits.strokes, 'Reload/resume must retain every saved soil cut.');
  assert.equal(restored.camera.at.wx, beforeReload.camera.at.wx);
  assert.equal(restored.camera.at.wz, beforeReload.camera.at.wz);
  assert.deepEqual(errors, [], 'The built game must have no console or uncaught errors.');
  log('PASS: worm cuts, whole-or-nothing opening, the floor held, no void along the groove, soil fog when shut, mobile and PC controls, surface restore, pause/save/reload, clean console');
} catch (error) {
  console.error(`[probe:soil] FAIL: ${error.stack ?? error.message}`);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
}
