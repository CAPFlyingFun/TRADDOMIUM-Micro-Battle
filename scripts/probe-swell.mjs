/** Land on the swell, measure the ride, photograph the sea. */
import { chromium } from 'playwright';
const url = process.env.PROBE_URL ?? 'http://localhost:4225/';
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
await page.evaluate((f) => window.__island.goTo(f), '22.22000000 -159.45000000 40.00m 200.0° -10.0° ×1.00');
await page.waitForTimeout(6000);
await page.evaluate(() => { const w = window.__island.where(); window.__island.putAt(w[0], w[2], 0); });
await page.waitForFunction(() => window.__island.wading().afloat, null, { timeout: 60000, polling: 500 });
// RIDE: sample her height while she floats. The sim runs slow under
// swiftshader, so sample long; amplitude is unaffected by the tempo.
const ys = [];
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000);
  ys.push(await page.evaluate(() => window.__island.where()[1]));
}
const min = Math.min(...ys), max = Math.max(...ys);
console.log(`ride: min ${min.toFixed(1)} max ${max.toFixed(1)} spread ${(max - min).toFixed(1)} units`);
console.log('samples:', ys.map((y) => y.toFixed(1)).join(' '));
// LOOK: low over the surface toward the horizon — the swell should
// break the silhouette; then a step back for the sheet handover.
await page.evaluate((f) => window.__island.goTo(f), '22.22000000 -159.45000000 0.60m 245.0° -3.0° ×1.00');
await page.waitForTimeout(4000);
await page.screenshot({ path: '/tmp/swell-low.png' });
await page.evaluate((f) => window.__island.goTo(f), '22.22000000 -159.45000000 8.00m 245.0° -12.0° ×1.00');
await page.waitForTimeout(4000);
await page.screenshot({ path: '/tmp/swell-mid.png' });
// BEACH: the waterline must be exactly as approved — the shore is
// exempt from the swell by the depth fade.
await page.evaluate((f) => window.__island.goTo(f), '21.86009770 -159.47834411 0.40m 180.0° -14.0° ×1.00');
await page.waitForTimeout(5000);
await page.screenshot({ path: '/tmp/swell-beach.png' });
if (errors.length) console.log('ERRORS:', errors.slice(0, 5));
await browser.close();
