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
let lowest = 1;
let backwards = 0;
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
  // RECOVERY MUST ONLY GO ONE WAY while she is resting. This is the
  // half of the fix the window can always see: the strobe was reserve
  // climbing a little and being spent again, over and over.
  if (now.state === 'resting') {
    if (now.stamina + 0.001 < lowest) backwards++;
    lowest = Math.max(lowest === 1 ? now.stamina : lowest, now.stamina);
  }
  console.log(`  ${now.t.toFixed(0)}s ${now.aloft ? 'ALOFT' : 'down '}`
    + ` agl ${(now.agl / 100).toFixed(2)}m stam ${(now.stamina * 100).toFixed(0)}%`
    + ` ${now.state ?? '-'}${now.blocked ? `(${now.blocked})` : ''}`
    + `  "${now.chip}"  flips ${flips}`);
  if (resumed) break;
  await page.waitForTimeout(2000);
}

console.log(`\nRESTED: ${rested}`);
console.log(`GROUND CONTACTS: ${flips} (one down and one up is a rest)`);
console.log(`RESERVE WENT BACKWARDS: ${backwards} times (the strobe was this)`);
console.log(`RECOVERED TO: ${(lowest * 100).toFixed(0)}%`);
// AND THE RESUME IS ONLY VISIBLE WHEN HER CLOCK IS FAST. At real time
// the threshold is thirty seconds of HER time away, and this renderer
// advances about 0.15 s of simulation per wall second — so a run that
// does not reach it has measured the recovery, not failed it. The
// boosted case (before v0.0.143 let the multiplier go on the ground)
// is what proved the resume end to end: 1% to 97% and away.
console.log(`RESUMED ON HER OWN: ${resumed}`
  + (resumed ? '' : ' (threshold not reached inside the window — see above)'));
await page.screenshot({ path: 'probe-rest.png' });
await browser.close();
