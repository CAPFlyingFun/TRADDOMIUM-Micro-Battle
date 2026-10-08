/**
 * THE SARAH LAB, OPENED THE WAY JOSHUA OPENS IT.
 *
 *     npm run probe:sarahlab
 *
 * Builds, serves dist/, opens the BARE URL, presses EDITORS and the Sarah
 * Lab's OPEN, waits for the base model, then works every control at 932 x 430:
 *
 *   shots/sarahlab-1-full.png      as loaded: full bump, shirt and leggings
 *   shots/sarahlab-2-flat.png      BUMP slider at 0
 *   shots/sarahlab-2b-twins.png    BUMP slider at 200, past full term
 *   shots/sarahlab-3-walk.png      WALK, bump back at 100
 *   shots/sarahlab-4-sit.png       SIT
 *   shots/sarahlab-5-fist.png      STAND, FINGERS at 100, close on the hands
 *   shots/sarahlab-6-bikini.png    OUTFIT once: the bikini
 *   shots/sarahlab-7-swimsuit.png  OUTFIT twice: the swimsuit
 *   shots/sarahlab-8-bare.png      OUTFIT three times: none
 *
 * and fails on a console error, a model that did not load, a file without the
 * belly slider or the clothes, or a blank frame.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build, preview } from 'vite';
import { readPng } from './probePng.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(ROOT, 'shots');
const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'];
/** Joshua's phone in landscape. */
const VIEWPORT = { width: 932, height: 430 };
const APP_PORT = 4197;
const TOOL = 'lab.sarah';
const HUD = 'sarah-lab-hud';

const log = (m) => console.log(`[probe:sarahlab] ${m}`);
let failures = 0;
function check(ok, what) {
  log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures += 1;
  return ok;
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

function brightness(file) {
  const img = readPng(readFileSync(file));
  let sum = 0, min = 255, max = 0;
  const px = img.width * img.height;
  for (let i = 0; i < px; i += 1) {
    const o = i * 4;
    const l = 0.3 * img.data[o] + 0.59 * img.data[o + 1] + 0.11 * img.data[o + 2];
    sum += l; if (l < min) min = l; if (l > max) max = l;
  }
  return { mean: sum / px, spread: max - min };
}

async function shot(page, name, what) {
  const file = path.join(SHOTS, name);
  await page.screenshot({ path: file });
  const b = brightness(file);
  check(b.mean > 8 && b.spread > 40, `${what}: a picture, not a blank (mean ${b.mean.toFixed(1)}, spread ${b.spread.toFixed(0)}) -> shots/${name}`);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  log('building, because preview serves dist/ and a stale dist/ is a lie');
  await build({ root: ROOT, logLevel: 'error' });
  const server = await preview({ root: ROOT, preview: { host: '127.0.0.1', port: APP_PORT, strictPort: false, open: false }, logLevel: 'error' });
  const url = server.resolvedUrls.local[0];
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('[data-action="new-game"]', { timeout: 120_000 });
    await page.click('[data-action="editors"]', { timeout: 60_000 });
    await page.waitForSelector(`[data-action="tool:${TOOL}"]`, { state: 'attached', timeout: 60_000 });
    await page.click(`[data-action="tool:${TOOL}"]`, { timeout: 60_000 });
    await page.waitForSelector(`[data-role="${HUD}"]`, { timeout: 180_000 });
    log('bare URL -> EDITORS -> OPEN -> the Sarah lab is up');

    const status = '[data-field="sarahlab-status"]';
    await page.waitForFunction((sel) => (document.querySelector(sel)?.textContent ?? '').startsWith('base model'), status, { timeout: 180_000 })
      .then(() => check(true, 'the base model loaded'))
      .catch(async () => check(false, `the base model loaded: ${await page.textContent(status)}`));
    const line = await page.textContent(status);
    check(/belly slider/.test(line) && /4 garments/.test(line), `the file has the belly slider and all four garments: "${line}"`);
    await page.waitForTimeout(1500);
    await shot(page, 'sarahlab-1-full.png', 'FULL BUMP, dressed');

    const setSlider = (field, value) => page.evaluate(([f, v]) => {
      const label = document.querySelector(`[data-field="${f}"]`);
      const input = label?.nextElementSibling;
      if (!(input instanceof HTMLInputElement)) return false;
      input.value = String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, [field, value]);
    check(await setSlider('sarahlab-bump', 0), 'the BUMP slider moved to 0');
    await page.waitForTimeout(800);
    check(/nearly flat/.test(await page.textContent('[data-field="sarahlab-bump"]')), 'the BUMP line reads nearly flat');
    await shot(page, 'sarahlab-2-flat.png', 'BUMP 0');

    check(await setSlider('sarahlab-bump', 200), 'the BUMP slider moved to 200');
    await page.waitForTimeout(800);
    check(/200% · past full term/.test(await page.textContent('[data-field="sarahlab-bump"]')), 'the BUMP line reads 200% past full term');
    await shot(page, 'sarahlab-2b-twins.png', 'BUMP 200');

    await setSlider('sarahlab-bump', 100);
    await page.click('[data-action="sarahlab:walk"]');
    await page.waitForTimeout(1500);
    await shot(page, 'sarahlab-3-walk.png', 'WALK');

    await page.click('[data-action="sarahlab:sit"]');
    await page.waitForTimeout(1500);
    await shot(page, 'sarahlab-4-sit.png', 'SIT');

    await page.click('[data-action="sarahlab:stand"]');
    check(await setSlider('sarahlab-fingers', 100), 'the FINGERS slider moved to 100');
    // come closer: a wheel toward her
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, -300);
    await page.waitForTimeout(1500);
    await shot(page, 'sarahlab-5-fist.png', 'FINGERS 100, closer');

    for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, 300);
    await setSlider('sarahlab-fingers', 0);
    await page.click('[data-action="sarahlab:outfit"]');
    await page.waitForTimeout(800);
    check(/bikini/.test(await page.textContent('[data-action="sarahlab:outfit"]')), 'OUTFIT reads bikini');
    await shot(page, 'sarahlab-6-bikini.png', 'OUTFIT bikini');
    await page.click('[data-action="sarahlab:outfit"]');
    await page.waitForTimeout(800);
    await shot(page, 'sarahlab-7-swimsuit.png', 'OUTFIT swimsuit');
    await page.click('[data-action="sarahlab:outfit"]');
    await page.waitForTimeout(1200);
    await shot(page, 'sarahlab-8-bare.png', 'OUTFIT none');
    check(errors.length === 0, errors.length ? `no console errors:\n${errors.join('\n')}` : 'no console errors');
  } finally {
    await browser.close();
    server.httpServer.close();
  }
  if (failures) { log(`FAIL: ${failures} check(s)`); process.exit(1); }
  log('PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
