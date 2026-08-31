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
    engaged: ap.engaged,
    surrendered: ap.surrendered,
    aloft: ap.aloft,
    state: ap.nav?.state ?? null,
    range: ap.nav?.range ?? null,
    // The LABEL, not the root: textContent would include the
    // CONTINUE button's own text even while it is display:none.
    chip: text('[data-ui="autopilot-chip"] span'),
    air: text('[data-ui="compass-air"]'),
    ground: text('[data-ui="compass-ground"]'),
  };
});

console.log('before takeoff:', JSON.stringify(await read()));

// Airborne the way a player does it: run up, then the lever.
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

let best = 1;
const began = Date.now();
while (Date.now() - began < 240_000) {
  const now = await read();
  best = Math.max(best, now.travel);
  console.log(`  ${now.t.toFixed(0)}s x${now.travel.toFixed(2)}`
    + ` ${now.engaged ? 'engaged' : 'idle'}${now.surrendered ? ' SURRENDERED' : ''}`
    + ` ${now.state ?? '-'}`
    + `  chip "${now.chip}"  air "${now.air}"`);
  if (now.travel > 9.9) break;
  await page.waitForTimeout(2500);
}

console.log(`\nBEST TRAVEL SCALE REACHED: x${best.toFixed(2)}`);
const end = await read();
console.log(`chip   "${end.chip}"`);
console.log(`air    "${end.air}"`);
console.log(`ground "${end.ground}"`);
console.log(`surrendered after a player-order takeoff: ${end.surrendered}`);

await page.screenshot({ path: 'probe-travel.png' });
await browser.close();
