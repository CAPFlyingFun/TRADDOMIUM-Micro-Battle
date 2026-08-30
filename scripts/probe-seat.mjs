/**
 * IS SHE ON THE WATER OR UNDER IT? — the A5 seat, seen rather than measured.
 *   PROBE_TAG=after node scripts/probe-seat.mjs
 */
import { chromium } from 'playwright';
const url = 'http://localhost:4220/';
const TAG = process.env.PROBE_TAG ?? 'now';
const FIX = '21.97470778 -159.72064395 40.00m 225.0° -10.0° x1.00';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto(`${url}?scene=island`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
const settle = (n) => page.waitForTimeout(n * 700);
await page.evaluate((f) => window.__island.goTo(f), FIX);
await settle(3);
// Drop onto the water, then stand her in the deepest of it nearby.
const slider = await page.$('[data-ui="lift-slider"]');
const box = await slider.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.95, { steps: 8 });
await settle(12);
await page.mouse.up();
await settle(4);
await page.evaluate(() => {
  const w = window.__island.where();
  let best = { d: 0, x: w[0], z: w[2] };
  for (let dz = -3000; dz <= 3000; dz += 250) {
    for (let dx = -3000; dx <= 3000; dx += 250) {
      const d = window.__island.waterDepth(w[0] + dx, w[2] + dz);
      if (d > best.d) best = { d, x: w[0] + dx, z: w[2] + dz };
    }
  }
  window.__island.putAt(best.x, best.z, 0);
});
await page.waitForFunction(() => window.__island.wading().afloat,
  null, { timeout: 60000, polling: 500 });
await settle(6);
const s = await page.evaluate(() => {
  const sheets = (window.__island.sheets?.() ?? []).map((m) => m);
  return {
    motion: window.__island.motion(),
    wade: window.__island.wading(),
    col: window.__island.column(),
    sheets,
  };
});
console.log(`[${TAG}] motion ${s.motion}`);
console.log(`[${TAG}] ground ${s.col.ground.toFixed(2)} depth ${s.col.depth.toFixed(2)}`
  + ` herY ${s.col.herY.toFixed(2)} floor ${s.col.floor.toFixed(2)}`);
console.log(`[${TAG}] wade ${JSON.stringify(s.wade)}`);
console.log(`[${TAG}] she rides ${(s.col.herY - s.col.ground).toFixed(2)} above the ground`);
console.log(`[${TAG}] sheets`, JSON.stringify(s.sheets));
await page.screenshot({ path: `/tmp/seat-${TAG}.png` });
console.log(`[${TAG}] page errors:`, errors.length ? errors : 'none');
await browser.close();
