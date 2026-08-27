import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 500 } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto((process.env.PROBE_URL ?? 'http://localhost:4225/') + '?scene=island', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
await page.waitForTimeout(3000);
// Joshua's own framing: his screenshot's fix line, low over the lake.
await page.evaluate((f) => window.__island.goTo(f), process.env.PROBE_FIX ?? '22.01501048 -159.37777455 26.00m 200.0° -28.0° ×1.00');
await page.waitForTimeout(30000);
await page.screenshot({ path: '/tmp/skin-a.png' });
  if (process.env.ZOOM === '1') {
    await page.screenshot({ path: '/tmp/skin-zoom.png',
      clip: { x: 300, y: 120, width: 400, height: 260 } });
  }
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/skin-b.png' });
await browser.close();
