/**
 * WHAT HAPPENS WHEN SHE TRIES TO LEAVE THE GROUND.
 *
 *   npm run probe:liftoff
 *
 * Joshua, twice: "on the ground and trying to fly, it starts to and
 * fails. Takes a few tries", then "as soon as I try to lift off the
 * ground that still snaps it back as I see it try to fly and back on
 * the ground." Reasoning about this from the source has produced two
 * wrong answers, so this watches it instead: run her up on flat
 * ground, ask for a takeoff, and log the flight state every frame.
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto(`${url}?spawnRoll=0.25`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-ui="main-menu"]', { timeout: 120000 });
await page.click('[data-ui="new-colony"]');
await page.waitForSelector('[data-ui="island-canvas"]', { timeout: 60000 });
const pick = await page.evaluate(() => {
  const b = document.querySelector('[data-ui="island-canvas"]').getBoundingClientRect();
  return { left: b.left, top: b.top, size: b.width };
});
const region = await page.evaluate(() => window.__regions.find((r) => r.id === 'wailua-forest'));
await page.mouse.click(pick.left + region.mapX * pick.size, pick.top + region.mapY * pick.size);
await page.waitForSelector('[data-ui="spawn-here"]', { timeout: 20000 });
await page.click('[data-ui="spawn-here"]');
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 120000 });
await page.waitForFunction(
  () => !document.querySelector('[data-ui="loading"]'), null, { timeout: 240000 });
await page.waitForFunction(() => window.__island.simTime() > 0.4, null, { timeout: 240000 });

const look = () => page.evaluate(() => {
  const ap = window.__island.autopilot();
  const [wx, y, wz] = window.__island.where();
  return {
    t: +window.__island.simTime().toFixed(3),
    aloft: ap.aloft,
    pace: +window.__island.speed().toFixed(2),
    y: +y.toFixed(2),
    // `climbing()` does not exist before v0.0.159, and this probe has
    // to run against the build Joshua says was fine. MSL height is in
    // every version and is all the climb profile needs.
    stam: +window.__island.stamina().toFixed(2),
  };
});

// RUN HER UP. A takeoff wants TAKEOFF_SPEED under her, so the run-up
// is part of the manoeuvre and not a preamble to it.
await page.evaluate(() => window.__island.setPace('run'));
await page.keyboard.down('KeyW');
const seen = [];
let last = null;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  const now = await look();
  if (!last || now.t !== last.t) seen.push({ ...now, phase: 'run' });
  last = now;
  if (now.pace > 7) break;
}
console.log(`RAN UP to ${last.pace} cm/s (takeoff wants 6.5)`);

// ASK FOR THE TAKEOFF, and hold the lever the way a thumb would.
const slider = await page.$('[data-ui="lift-slider"]');
const box = await slider.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.02, { steps: 6 });
const asked = last.t;
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000);
  const now = await look();
  if (now.t !== last.t) seen.push({ ...now, phase: 'lever' });
  last = now;
  if (now.t - asked > 12) break;
}
await page.mouse.up();
await page.keyboard.up('KeyW');

const after = seen.filter((s) => s.phase === 'lever');
const everUp = after.some((s) => s.aloft);
const endedUp = after.length > 0 && after[after.length - 1].aloft;
console.log(`\nEVER LEFT THE GROUND: ${everUp}`);
console.log(`STILL AIRBORNE AT THE END: ${endedUp}`);
const base = after.length ? after[0].y : 0;
const rises = after.map((s) => +(s.y - base).toFixed(2));
console.log(`climb from the first lever frame, per frame: ${JSON.stringify(rises.slice(0, 40))}`);
console.log(`highest she got: ${Math.max(0, ...rises).toFixed(2)} cm above where she started`);
console.log(`aloft flags: ${JSON.stringify(after.map((s) => (s.aloft ? 1 : 0)).slice(0, 40))}`);
if (errors.length) console.log(`PAGE ERRORS ${JSON.stringify(errors)}`);
await page.screenshot({ path: 'probe-liftoff.png' });
await browser.close();
