/**
 * probe:hud — the stat sheet fits the phone it is on, and folds.
 *
 * Joshua, from the phone (2026-09-07), after saving the game to his home
 * screen: "it made everything UI bigger and I can't minimize the large
 * stat screen". The home-screen app's viewport is narrower in CSS pixels
 * than Safari's 932, and a sheet laid out in fixed pixels ran under
 * PAUSE and put its own fold toggle beneath it. The sheet now sizes
 * itself from the viewport (`PerfHud.ts`, SHEET_FONT_VW) and caps its
 * width clear of PAUSE; this probe holds it to that at three phone
 * widths — the iPhone 15 Plus design canvas, the 15 Pro, and the
 * zoomed / older 812 px layout — by asking the DOM what a finger would
 * land on:
 *
 *   1. the sheet's box ends left of PAUSE's box, with air between;
 *   2. `document.elementFromPoint` at the fold toggle's centre IS the
 *      toggle (nothing sits on top of it);
 *   3. the sheet's computed font is at least MIN_FONT_PX, so smaller is
 *      not the same as unreadable;
 *   4. tapping the toggle folds the sheet to its one-line summary, and
 *      tapping again unfolds it.
 *
 * Walks the real front door (menu → NEW GAME → SOLO → slot → world),
 * because a probe that took a shortcut a player cannot take has shipped
 * a build that passed against something the phone was not running.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { stubWeather } from './probeWeather.mjs';
import { chooseSpawn } from './probeSpawn.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const SHOTS = path.join(ROOT, 'shots');
const PORT = 4192;

/** The phone widths the sheet must fit, CSS pixels: the design canvas, the 15 Pro, and the 812 px layout. */
const VIEWPORTS = [
  { name: 'iphone-15-plus', width: 932, height: 430 },
  { name: 'iphone-15-pro', width: 852, height: 393 },
  { name: 'iphone-zoomed', width: 812, height: 375 },
];
/** Air between the sheet and PAUSE, CSS px: a thumb must not land on both. */
const CLEARANCE_PX = 8;
/** The smallest the sheet's type may go, CSS px: three device pixels each on the phone. */
const MIN_FONT_PX = 8;
const TIMEOUT = { menu: 20_000, world: 240_000, fold: 10_000 };
const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'];

const failures = [];
const log = (message) => console.log(`[probe:hud] ${message}`);
const fail = (message) => {
  failures.push(message);
  console.error(`[probe:hud] FAIL: ${message}`);
};

function chromiumPath() {
  const override = process.env.PLAYWRIGHT_CHROMIUM;
  if (override) return override;
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const linked = browsers ? path.join(browsers, 'chromium') : null;
  if (linked && existsSync(linked)) return linked;
  return undefined;
}

async function enterWorld(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('[data-action="new-game"]', { timeout: TIMEOUT.menu });
  await page.click('[data-action="new-game"]', { timeout: TIMEOUT.menu });
  const solo = page.locator('[data-action="solo"]');
  try {
    await solo.waitFor({ state: 'attached', timeout: TIMEOUT.menu });
    await solo.click({ timeout: TIMEOUT.menu });
  } catch {
    // A build with no session picker goes straight to the slots.
  }
  await page.waitForSelector('[data-action="slot:1"]', { state: 'attached', timeout: TIMEOUT.menu });
  await page.click('[data-action="slot:1"]', { timeout: TIMEOUT.menu });
  await chooseSpawn(page, 'anini', log, TIMEOUT.world);
  await page.waitForSelector('[data-action="pause"]', { timeout: TIMEOUT.world });
  await page.waitForSelector('[data-role="perf-hud"]', { timeout: TIMEOUT.world });
}

/** The sheet's geometry against PAUSE and the fold toggle, as the DOM has it. */
async function measure(page) {
  return page.evaluate(() => {
    const hud = document.querySelector('[data-role="perf-hud"]');
    const pause = document.querySelector('[data-action="pause"]');
    const fold = document.querySelector('[data-action="hud-collapse"]');
    if (!hud || !pause || !fold) return null;
    const h = hud.getBoundingClientRect();
    const p = pause.getBoundingClientRect();
    const f = fold.getBoundingClientRect();
    const cx = f.left + f.width / 2;
    const cy = f.top + f.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return {
      hud: { left: h.left, right: h.right, top: h.top, bottom: h.bottom, width: h.width, height: h.height },
      pause: { left: p.left, right: p.right },
      fold: { cx, cy, width: f.width, height: f.height },
      foldOnTop: hit !== null && (hit === fold || fold.contains(hit)),
      fontPx: Number.parseFloat(getComputedStyle(hud).fontSize),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

async function screenshot(page, name) {
  mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, name);
  await page.screenshot({ path: file });
  log(`saved shots/${name}`);
}

async function checkAt(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  // Two frames for the sheet to refresh and the scene to take the resize.
  await page.waitForTimeout(1_500);
  const m = await measure(page);
  if (m === null) {
    fail(`${viewport.name}: the sheet, PAUSE or the fold toggle is missing from the DOM`);
    return;
  }
  const where = `${viewport.name} (${m.viewport.width}×${m.viewport.height})`;
  log(`${where}: sheet ${Math.round(m.hud.width)}×${Math.round(m.hud.height)} px at ${Math.round(m.hud.left)}..${Math.round(m.hud.right)}, PAUSE from ${Math.round(m.pause.left)}, font ${m.fontPx.toFixed(2)} px`);
  if (m.hud.right > m.pause.left - CLEARANCE_PX) {
    fail(`${where}: the sheet reaches ${Math.round(m.hud.right)} px and PAUSE starts at ${Math.round(m.pause.left)} — under ${CLEARANCE_PX} px of air, or none`);
  }
  if (m.hud.right > m.viewport.width) fail(`${where}: the sheet runs ${Math.round(m.hud.right - m.viewport.width)} px off the right edge`);
  if (!m.foldOnTop) fail(`${where}: something covers the fold toggle at (${Math.round(m.fold.cx)}, ${Math.round(m.fold.cy)}) — a finger there would not fold the sheet`);
  if (!(m.fontPx >= MIN_FONT_PX)) fail(`${where}: the sheet's type is ${m.fontPx.toFixed(2)} px, under the ${MIN_FONT_PX} px floor`);
  await screenshot(page, `hud-${viewport.name}.png`);
  // Fold, then unfold, through the toggle a finger would press.
  const before = m.hud.height;
  await page.click('[data-action="hud-collapse"]', { timeout: TIMEOUT.fold });
  await page.waitForTimeout(600);
  const folded = await measure(page);
  if (folded === null || !(folded.hud.height < before * 0.5)) {
    fail(`${where}: tapping the fold toggle left the sheet ${folded ? Math.round(folded.hud.height) : '?'} px tall (was ${Math.round(before)})`);
  } else {
    log(`${where}: folded to ${Math.round(folded.hud.height)} px`);
    await screenshot(page, `hud-${viewport.name}-folded.png`);
  }
  await page.click('[data-action="hud-collapse"]', { timeout: TIMEOUT.fold });
  await page.waitForTimeout(600);
  const back = await measure(page);
  if (back === null || back.hud.height < before * 0.9) fail(`${where}: the sheet did not unfold (now ${back ? Math.round(back.hud.height) : '?'} px, was ${Math.round(before)})`);
}

async function main() {
  if (!existsSync(DIST_INDEX)) {
    fail('dist/index.html is missing. Run `npm run build` first.');
    process.exit(1);
  }
  const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
  const url = server.resolvedUrls?.local?.[0] ?? `http://localhost:${PORT}/`;
  log(`serving dist/ at ${url}`);
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
  try {
    const context = await browser.newContext({ viewport: VIEWPORTS[0] });
    const page = await context.newPage();
    await stubWeather(page);
    page.on('pageerror', (error) => fail(`uncaught page error: ${error.message}`));
    await enterWorld(page, url);
    for (const viewport of VIEWPORTS) await checkAt(page, viewport);
    await context.close();
  } finally {
    await browser.close();
    await server.close();
  }
  if (failures.length > 0) {
    console.error(`[probe:hud] ${failures.length} failure(s)`);
    process.exit(1);
  }
  log('PASS: the sheet clears PAUSE, its fold toggle is on top, its type is readable, and it folds and unfolds at every phone width');
}

main().catch((error) => {
  console.error('[probe:hud] crashed:', error);
  process.exit(1);
});
