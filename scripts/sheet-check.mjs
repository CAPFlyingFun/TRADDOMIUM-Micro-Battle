import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto('http://localhost:4225/?scene=island', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
await page.evaluate((f) => window.__island.goTo(f), '22.21761654 -159.44999895 4.00m 191.0° -14.0° ×1.00');
await page.waitForTimeout(8000);
console.log(JSON.stringify(await page.evaluate(() => window.__island.sheets()), null, 1));
console.log('her local:', JSON.stringify(await page.evaluate(() => window.__island.origin())));
await browser.close();
