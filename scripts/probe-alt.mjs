/** A frame taken while she is still AIRBORNE at the asked height. */
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
await page.evaluate((f) => window.__island.goTo(f), process.env.PROBE_FIX);
await page.waitForTimeout(2500);
console.log('column:', JSON.stringify(await page.evaluate(() => window.__island.column())));
await page.screenshot({ path: process.env.OUT ?? '/tmp/alt.png' });
await browser.close();
