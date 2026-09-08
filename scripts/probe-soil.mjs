/**
 * Built-game check of the first shared soil milestone, at the Wailua
 * forest used by probe:finder. Uses a fresh browser profile and the
 * player's SOIL / Find worm / depth / pause / resume controls. Screenshots
 * are evidence for visual review; software rendering is not phone timing.
 *
 * Run after npm run build. PLAYWRIGHT_CHROMIUM can select an installed
 * browser, as with probe:boot. No browser download or production save.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { stubWeather } from './probeWeather.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAVE_KEY = 'traddomium.v1.solo-save';
const SHOTS = path.join(ROOT, 'shots');
const log = message => console.log(`[probe:soil] ${message}`);
const errors = [];
let server, browser;

function browserPath() {
  const candidate = process.env.PLAYWRIGHT_CHROMIUM ?? chromium.executablePath();
  assert(existsSync(candidate), 'No installed Chromium. Set PLAYWRIGHT_CHROMIUM.');
  return candidate;
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `soil-${name}.png`), timeout: 120_000 });
  log(`saved shots/soil-${name}.png`);
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
  await page.getByRole('button', { name: 'Collapse stats' }).click();
  await frames(page, 40);
  await shot(page, 'mobile-cutaway');

  const firstSave = await pauseAndRead(page);
  assert(firstSave.terrainEdits?.strokes.length > 0, 'Pause must persist actual worm cuts.');
  log(`pause saved ${firstSave.terrainEdits.strokes.length} soil cuts`);
  await page.locator('[data-action="resume"]').click();
  await page.setViewportSize({ width: 1200, height: 750 });
  await checkControlsFit(page, 1200, 750);
  const depth = page.getByRole('slider');
  await depth.focus();
  await depth.press('ArrowRight');
  assert.equal(await depth.inputValue(), '13', 'PC arrow key must control the focused depth slider.');
  await frames(page, 30);
  await shot(page, 'desktop-cutaway');
  await page.locator('[data-action="soil-surface"]').click();
  assert.equal(await depth.inputValue(), '0');
  await frames(page, 30);
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
  log('PASS: worm cuts, mobile and PC controls, surface restore, pause/save/reload, clean console');
} catch (error) {
  console.error(`[probe:soil] FAIL: ${error.stack ?? error.message}`);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
}
