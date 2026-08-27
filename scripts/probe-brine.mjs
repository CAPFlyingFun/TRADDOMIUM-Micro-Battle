/** Land on the sea, float, dive — watching the salt clock and her air. */
import { chromium } from 'playwright';
const url = process.env.PROBE_URL ?? 'http://localhost:4225/';
const FIX = '22.22000000 -159.45000000 40.00m 200.0° -10.0° ×1.00';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto(`${url}?scene=island`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
await page.waitForTimeout(3000);
await page.evaluate((f) => window.__island.goTo(f), FIX);
await page.waitForTimeout(8000);
const read = () => page.evaluate(() => ({
  ...window.__island.sea(),
  wade: window.__island.wading(),
  airborne: window.__island.airborne(),
}));
console.log('aloft over sea:', JSON.stringify(await read()));
// Descend onto the water via the lever.
const slider = await page.$('[data-ui="lift-slider"]');
const box = await slider.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.95, { steps: 8 });
await page.waitForTimeout(12000);
await page.mouse.up();
await page.evaluate(() => { const w = window.__island.where(); window.__island.putAt(w[0], w[2], 0); });
await page.waitForFunction(() => window.__island.wading().afloat, null, { timeout: 60000, polling: 500 });
console.log('afloat:', JSON.stringify(await read()));
await page.waitForTimeout(10000);
console.log('10 s later (salt should grow, air full):', JSON.stringify(await read()));
// Dive and hold.
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.95, { steps: 8 });
await page.waitForTimeout(8000);
console.log('holding a dive (air draining):', JSON.stringify(await read()));
await page.screenshot({ path: '/tmp/brine-dive.png' });
await page.mouse.up();
await page.waitForTimeout(9000);
console.log('lever released (risen, air refilling):', JSON.stringify(await read()));
await page.screenshot({ path: '/tmp/brine-float.png' });
await page.waitForTimeout(40000);
console.log('40 s after release (buoyancy done?):', JSON.stringify(await read()));
await page.screenshot({ path: '/tmp/brine-surfaced.png' });
if (errors.length) console.log('ERRORS:', errors.slice(0, 5));
await browser.close();
