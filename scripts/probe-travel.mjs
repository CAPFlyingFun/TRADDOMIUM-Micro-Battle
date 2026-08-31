/**
 * IS THE x10 ACTUALLY WIRED, AND CAN SHE GET INTO IT — Joshua's order.
 *
 * `probe:autopilot` takes off FIRST and orders the pin second, and that
 * convenience hid a real bug for a whole stage: a player sets the
 * destination on the map, THEN takes off, and the takeoff shove on the
 * lift lever used to latch `surrendered` on the way up. The autopilot
 * then sat in STANDBY waiting for a destination it already had, so the
 * boost never spooled and Joshua's report was "I couldn't tell if it
 * was x10 times as fast yet".
 *
 * So this one does it his way round: pin, run-up, lever, and then watch
 * the travel scale, the chip and the AIR readout for a minute.
 *
 *   npm run probe:travel
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
/** World units to the pin. Far enough that she is still going at the end. */
const RANGE = Number(process.env.RANGE ?? 40_000);

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

// SEA=1 PUTS HER IN THE WATER FIRST — Joshua's second screenshot, a
// queen floating on the open sea with a waypoint set, `AI wait_wings`,
// and nothing happening. Leaving the water is its own door in the
// flight model and its own wait, so it is its own run of this probe.
if (process.env.SEA === '1') {
  await page.evaluate(() => {
    const w = window.__island.where();
    let best = { d: 0, x: w[0], z: w[2] };
    for (let dz = -4000; dz <= 4000; dz += 250) {
      for (let dx = -4000; dx <= 4000; dx += 250) {
        const d = window.__island.waterDepth(w[0] + dx, w[2] + dz);
        if (d > best.d) best = { d, x: w[0] + dx, z: w[2] + dz };
      }
    }
    window.__island.putAt(best.x, best.z, 0);
  });
  await page.waitForFunction(
    () => window.__island.wading().afloat, null, { timeout: 120000, polling: 500 });
  console.log('afloat on the open water, wings wet');
}

// THE PIN FIRST, standing on the ground, exactly as the map's FLY HERE
// leaves her.
await page.evaluate((range) => {
  const [wx, , wz] = window.__island.where();
  window.__island.orderTo(wx + range * 0.8, wz - range * 0.6);
}, RANGE);
console.log(`pin set ${(RANGE / 100).toFixed(0)} m off her shoulder, ON THE GROUND`);

const read = () => page.evaluate(() => {
  const ap = window.__island.autopilot();
  const text = (sel) => document.querySelector(sel)?.textContent ?? '';
  return {
    t: window.__island.simTime(),
    travel: ap.travel,
    agl: window.__island.height(),
    engaged: ap.engaged,
    surrendered: ap.surrendered,
    aloft: ap.aloft,
    state: ap.nav?.state ?? null,
    range: ap.nav?.range ?? null,
    // The LABEL, not the root: textContent would include the
    // CONTINUE button's own text even while it is display:none.
    chip: text('[data-ui="autopilot-chip"] span'),
    blocked: ap.nav?.blocked ?? null,
    dry: window.__island.wingsLeft(),
    air: text('[data-ui="compass-air"]'),
    ground: text('[data-ui="compass-ground"]'),
  };
});

console.log('before takeoff:', JSON.stringify(await read()));

// AND NOW NOTHING. No run-up, no lever, no key at all — the whole
// point of v0.0.139 is that confirming a destination is the last thing
// the player has to do. If she is still on the sand in a minute, the
// takeoff action is missing again.

let best = 1;
const began = Date.now();
// The sea run has thirty seconds of her time to pay before anything
// happens, and this renderer manages about a frame and a half a second.
while (Date.now() - began < (process.env.SEA === '1' ? 900_000 : 240_000)) {
  const now = await read();
  best = Math.max(best, now.travel);
  console.log(`  ${now.t.toFixed(0)}s x${now.travel.toFixed(2)}`
    + ` ${now.aloft ? 'ALOFT' : 'down '} agl ${(now.agl / 100).toFixed(2)}m`
    + ` ${now.engaged ? 'engaged' : 'idle'}${now.surrendered ? ' SURRENDERED' : ''}`
    + ` ${now.state ?? '-'}${now.blocked ? `(${now.blocked})` : ''}`
    + `${now.dry === null ? '' : ` dry-in ${now.dry.toFixed(0)}s`}`
    + `  chip "${now.chip}"  air "${now.air}"`);
  // Off the surface AND spooled. On the water she has thirty seconds of
  // drying to pay first, at real time, so the run is bounded by the
  // wall clock rather than by the ramp.
  if (now.travel > 9.9 && now.aloft) break;
  await page.waitForTimeout(2500);
}

console.log(`\nBEST TRAVEL SCALE REACHED: x${best.toFixed(2)}`);
const end = await read();
console.log(`chip   "${end.chip}"`);
console.log(`air    "${end.air}"`);
console.log(`ground "${end.ground}"`);
console.log(`surrendered without the player ever touching a control: ${end.surrendered}`);
console.log(`SHE LEFT THE SURFACE ON HER OWN: ${end.aloft}`);

await page.screenshot({ path: 'probe-travel.png' });
await browser.close();
