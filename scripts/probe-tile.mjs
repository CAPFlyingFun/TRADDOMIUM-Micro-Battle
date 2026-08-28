/** THE TEXTURE SCALE SWEEP: one camera, one spot, four authored sizes. */
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
await page.evaluate(() => window.__island.setSetting('detailRange', 2));
const AGL = Number(process.env.AGL ?? 350);
for (const cm of [25, 50, 100, 200]) {
  await page.evaluate((v) => window.__island.setTileScale(v), cm);
  // Same camera every time: her ground here is ~8.8 m.
  // Same fix, same attitude, short settle so she has not glided away.
  await page.evaluate((f) => window.__island.goTo(f),
    `21.86200000 -159.47834411 ${((878 + Number(process.env.AGL ?? 350)) / 100).toFixed(2)}m 000.0° -45.0° ×1.00`);
  await page.waitForTimeout(1400);
  console.log('  at', JSON.stringify(await page.evaluate(() => {
    const c = window.__island.column();
    return { agl: Math.round(c.clearance), msl: Math.round(c.msl) };
  })));
  await page.screenshot({ path: `/tmp/tile-${cm}-agl${AGL}.png` });
  console.log(`tile ${cm} cm @ ${AGL} cm AGL`);
}
await browser.close();
