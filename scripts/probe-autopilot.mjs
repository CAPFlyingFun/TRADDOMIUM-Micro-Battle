/**
 * DOES SHE ACTUALLY FLY THERE — Phase 2's own acceptance, headless.
 *
 * The unit tests prove the control laws: which way she turns, that she
 * crabs, that the approach slows, that capture does not let go. None of
 * that proves the thing is WIRED — that the demand reaches Flight, that
 * the pin reaches the autopilot, that the whole loop closes around a
 * real island with real wind on her. This flies it.
 *
 *   npm run probe:autopilot
 *   RANGE=3000 npm run probe:autopilot     a longer leg
 *
 * A NOTE ON THE DISTANCE, because it is not arbitrary. She cruises at
 * 40 world units a second — 0.4 m/s — and the software renderer manages
 * about a frame and a half a second with dt clamped at a tenth, so the
 * simulation advances roughly 0.15 s per wall second. A hundred-metre
 * leg would be half an hour of wall clock. Eight metres is four times
 * the capture radius — a real turn, a real approach and a real capture
 * — and finishes. The CLIMB is the expensive part, not the leg: at 16
 * units a second, every metre of altitude is six seconds of wall clock.
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
/** World units from her to the pin. 2,000 is 20 m. */
const RANGE = Number(process.env.RANGE ?? 800);

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

// GET HER AIRBORNE THE WAY A PLAYER DOES — run up, then the lever. The
// autopilot deliberately will not do this for her: taking off costs
// stamina and is a decision.
await page.evaluate(() => {
  window.__island.setPace('run');
  window.__island.setSprint(true);
});
await page.keyboard.down('KeyW');
await page.waitForFunction(() => window.__island.canTakeOff(), null, { timeout: 300000 });
await page.keyboard.down('Space');
await page.waitForFunction(() => window.__island.height() > 500, null, { timeout: 300000 });
await page.keyboard.up('Space');
await page.keyboard.up('KeyW');
// Hands OFF. Anything on the stick is the player flying, and the
// autopilot is required to stand down for it.
await page.waitForTimeout(1500);

// Five metres up: over the autopilot's four-metre clearance, so it is
// holding rather than climbing out of the ground when the pin arrives.
// A pin off her right shoulder, so the first thing she has to do is
// turn — a target dead ahead would pass a broken controller.
const pin = await page.evaluate((range) => {
  const [wx, , wz] = window.__island.where();
  const at = { wx: wx + range * 0.8, wz: wz - range * 0.6 };
  window.__island.orderTo(at.wx, at.wz);
  return at;
}, RANGE);

console.log(`pin set ${(RANGE / 100).toFixed(0)} m off her shoulder`);

const seen = [];
let held = false;
const began = Date.now();
while (Date.now() - began < 420_000) {
  const now = await page.evaluate(() => {
    const probe = window.__island.autopilot();
    const ap = probe.nav;
    return ap === null ? null : { ...ap, t: window.__island.simTime() };
  });
  if (now) {
    seen.push(now);
    // Streamed, not buffered: a probe that only speaks when it finishes
    // tells you nothing at all when it is killed for taking too long,
    // which is exactly when you want to know where it got to.
    console.log(`  ${now.t.toFixed(0)}s ${now.state.padEnd(7)}`
      + ` range ${(now.range / 100).toFixed(2)}m`
      + ` err ${now.error >= 0 ? '+' : ''}${now.error.toFixed(0)}deg`
      + ` spd ${now.target.toFixed(0)}/${now.airspeed.toFixed(0)}`);
    if (now.state === 'hold') { held = true; break; }
  }
  await page.waitForTimeout(2000);
}

const first = seen[0];
const last = seen[seen.length - 1];
const ranges = seen.map((s) => s.range);
const closest = Math.min(...ranges);
// AN ORBIT IS THE FAILURE THIS IS LOOKING FOR: range that stops
// improving and starts opening again after getting close.
const bottom = ranges.indexOf(closest);
const after = ranges.slice(bottom + 1);
const orbiting = after.length > 2 && Math.max(...after) > closest * 2;

console.log(`samples ${seen.length}, sim ${(last.t - first.t).toFixed(0)} s`);
console.log(`range   ${(first.range / 100).toFixed(1)} m -> ${(last.range / 100).toFixed(1)} m`
  + `  (closest ${(closest / 100).toFixed(2)} m)`);
console.log(`state   ${first.state} -> ${last.state}${last.blocked ? ` (${last.blocked})` : ''}`);
console.log(`track   wanted ${last.wanted.toFixed(0)} actual ${last.track.toFixed(0)}`
  + ` err ${last.error.toFixed(0)}deg`);
console.log(`speed   asked ${last.target.toFixed(0)} flying ${last.airspeed.toFixed(0)}`);
console.log(`CAPTURED: ${held}   ORBITED: ${orbiting}`);

// Did the approach actually slow her down?
const early = seen.find((s) => s.range > closest * 4);
if (early) {
  console.log(`approach: asked ${early.target.toFixed(0)} at`
    + ` ${(early.range / 100).toFixed(1)} m, ${last.target.toFixed(0)} at`
    + ` ${(last.range / 100).toFixed(2)} m`);
}

// And the player must be able to take it straight back.
await page.keyboard.down('KeyA');
await page.waitForTimeout(1200);
const grabbed = await page.evaluate(() => window.__island.autopilot());
await page.keyboard.up('KeyA');
console.log(`manual override disengages: ${grabbed !== null && !grabbed.engaged}`);

await browser.close();
