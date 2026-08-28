/** THE NEAR SHEET, ALONE, EXAGGERATED, AT TWO TIMES. */
import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 500 } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto('http://localhost:4225/?scene=island', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
await page.waitForTimeout(4000);
// Deep water, well outside the swash band, holding MSL so the camera
// does not ride the very thing being measured.
await page.evaluate((f) => window.__island.goTo(f), '22.22200000 -159.45500000 3.00m 200.0° -9.0° ×1.00');
await page.waitForTimeout(3000);
console.log('column:', JSON.stringify(await page.evaluate(() => window.__island.column())));
await page.evaluate(() => window.__island.solo(true));
await page.waitForTimeout(1500);
console.log('sheets after solo:', JSON.stringify(await page.evaluate(() => window.__island.sheets())));
console.log('centre pixel:', await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const g = document.createElement('canvas');
  g.width = c.width; g.height = c.height;
  g.getContext('2d').drawImage(c, 0, 0);
  const d = g.getContext('2d').getImageData(Math.floor(c.width * 0.5), Math.floor(c.height * 0.8), 1, 1).data;
  return `rgb(${d[0]},${d[1]},${d[2]})`;
}));
await page.screenshot({ path: '/tmp/solo-t1.png' });
await page.waitForTimeout(2200);
await page.screenshot({ path: '/tmp/solo-t2.png' });
await page.evaluate(() => window.__island.solo(false));
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/solo-all.png' });
await browser.close();
