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
await page.evaluate((f) => window.__island.goTo(f), '22.22200000 -159.45500000 3.00m 200.0° -9.0° ×1.00');
await page.waitForTimeout(3000);
// Hide EVERY water sheet — whatever colour remains is not water.
await page.evaluate(() => window.__island.hideAllWater());
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/nowater.png' });
await browser.close();
