/**
 * THE STORY'S LABORATORY IN 3D, WALKED THE WAY A PLAYER GETS THERE.
 *
 *     npm run probe:storylab
 *
 * Builds, serves dist/, opens the BARE URL, presses EDITORS and the
 * card's OPEN — no query parameter skips a step — and waits for the room
 * and both people to load. Then it takes the three cameras at 932 x 430:
 *
 *   shots/storylab-1-wide.png    the picture's own camera
 *   shots/storylab-2-push.png    the end of the push-in, close on Jack asleep
 *   shots/storylab-3-free.png    FREE, turned a little off the push-in
 *
 * and fails on a console error, on anything that did not load, or on a
 * frame that is blank (the room is dark by design, so blank means the
 * mean brightness is under 8 of 255 or the frame is one colour).
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
const APP_PORT = 4196;
const TOOL = 'lab.story';
const HUD = 'story-lab-hud';

const log = (m) => console.log(`[probe:storylab] ${m}`);
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
    log('bare URL -> EDITORS -> OPEN -> the story lab is up');

    await page.waitForFunction(() => (document.querySelector('[data-field="storylab-loaded"]')?.textContent ?? '').startsWith('loaded 3/3'), null, { timeout: 180_000 })
      .then(() => check(true, 'the room, Jack and Sarah all loaded'))
      .catch(async () => check(false, `everything loaded: ${await page.textContent('[data-field="storylab-loaded"]')}`));
    await page.waitForTimeout(1500);
    await shot(page, 'storylab-1-wide.png', 'WIDE');

    await page.click('[data-action="storylab:push"]');
    // the push runs on RAW time: nine seconds of wall clock whatever the frame rate
    await page.waitForTimeout(10_500);
    await shot(page, 'storylab-2-push.png', 'PUSH IN, at its end');

    await page.click('[data-action="storylab:free"]');
    // a short drag: turn a little off the push's line, to see the parallax round Jack
    const box = await page.locator('canvas').first().boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5, { steps: 12 });
      await page.mouse.up();
    }
    await page.waitForTimeout(1500);
    await shot(page, 'storylab-3-free.png', 'FREE');
    check(errors.length === 0, errors.length ? `no console errors:\n${errors.join('\n')}` : 'no console errors');
  } finally {
    await browser.close();
    server.httpServer.close();
  }
  if (failures) { log(`FAIL: ${failures} check(s)`); process.exit(1); }
  log('PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
