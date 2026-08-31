/**
 * DOES SHE REST, OR DOES SHE STROBE?
 *
 * Joshua photographed a queen a hand's width off the ground at 1%
 * stamina, flickering: recover past the flight model's three per cent,
 * launch, spend it climbing, fall back, repeat. This drains her to
 * nothing mid-flight and watches what happens next.
 *
 *   npm run probe:rest
 *
 * What it is looking for is one landing and one takeoff, rather than a
 * dozen of each.
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto(`${url}?spawnRoll=${process.env.SPAWN_ROLL ?? '0.25'}`,
  { waitUntil: 'domcontentloaded' });

await page.waitForSelector('[data-ui="main-menu"]', { timeout: 120000 });
await page.click('[data-ui="new-colony"]');
await page.waitForSelector('[data-ui="island-canvas"]', { timeout: 60000 });
const pick = await page.evaluate(() => {
  const b = document.querySelector('[data-ui="island-canvas"]').getBoundingClientRect();
  return { left: b.left, top: b.top, size: b.width };
});
const region = await page.evaluate(
  (id) => window.__regions.find((r) => r.id === id), process.env.SPOT ?? 'lihue');
await page.mouse.click(pick.left + region.mapX * pick.size, pick.top + region.mapY * pick.size);
await page.waitForSelector('[data-ui="spawn-here"]', { timeout: 20000 });
await page.click('[data-ui="spawn-here"]');
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 120000 });
await page.waitForFunction(
  () => !document.querySelector('[data-ui="loading"]'), null, { timeout: 240000 });
await page.waitForFunction(() => window.__island.simTime() > 0.4, null, { timeout: 240000 });

// A destination far enough that she cannot possibly reach it on one
// tank, and then take the tank away.
await page.evaluate(() => {
  const [wx, , wz] = window.__island.where();
  window.__island.orderTo(wx + 200_000, wz - 150_000);
});
await page.waitForFunction(() => window.__island.height() > 90, null, { timeout: 300000 });
console.log('airborne, draining her');
await page.evaluate(() => window.__island.setStamina(0.02));

const read = () => page.evaluate(() => {
  const ap = window.__island.autopilot();
  const text = (sel) => document.querySelector(sel)?.textContent ?? '';
  return {
    t: window.__island.simTime(),
    aloft: ap.aloft,
    state: ap.nav?.state ?? null,
    blocked: ap.nav?.blocked ?? null,
    stamina: window.__island.stamina(),
    agl: window.__island.height(),
    chip: text('[data-ui="autopilot-chip"] span'),
  };
});

let was = null;
let flips = 0;
let rested = false;
let resumed = false;
const began = Date.now();
// AT REAL TIME NOW. The boost lets go the moment she stops travelling
// (v0.0.143), so the thirty seconds of resting recovery are thirty of
// HER seconds at 1x — and this renderer advances about 0.15 s of
// simulation per wall second. That is the window this needs.
while (Date.now() - began < 1_200_000) {
  const now = await read();
  // A FLIP is her leaving or meeting the ground. One of each is a rest;
  // a dozen is the strobe.
  if (was !== null && was !== now.aloft) flips++;
  was = now.aloft;
  if (now.state === 'resting') rested = true;
  if (rested && now.aloft && now.state !== 'resting') resumed = true;
  console.log(`  ${now.t.toFixed(0)}s ${now.aloft ? 'ALOFT' : 'down '}`
    + ` agl ${(now.agl / 100).toFixed(2)}m stam ${(now.stamina * 100).toFixed(0)}%`
    + ` ${now.state ?? '-'}${now.blocked ? `(${now.blocked})` : ''}`
    + `  "${now.chip}"  flips ${flips}`);
  if (resumed) break;
  await page.waitForTimeout(2000);
}

console.log(`\nRESTED: ${rested}`);
console.log(`RESUMED ON HER OWN: ${resumed}`);
console.log(`GROUND CONTACTS: ${flips} (one down and one up is a rest)`);
await page.screenshot({ path: 'probe-rest.png' });
await browser.close();
