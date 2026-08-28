/**
 * THE SEAM: hold a metre over the floor and cross the waterline.
 * Prints the column every two metres so a discontinuity in the FLOOR,
 * or a camera that dips under while she does not, shows itself.
 */
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
await page.evaluate((f) => window.__island.goTo(f), '21.86009770 -159.47834411 1.00m 180.0° -2.0° ×1.00');
await page.waitForTimeout(5000);
if (process.env.FLOOR_HOLD !== '0') {
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('div'))
      .find((d) => /^HOLD (MSL|AWL|AGL)$/.test(d.textContent || ''));
    if (el) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  await page.waitForTimeout(1000);
}
// AIRBORNE THE WHOLE WAY: goTo keeps her flying, so the floor is
// read as the flight model sees it rather than after a teleport has
// planted her on the bed.
for (let i = 0; i <= 16; i++) {
  const lat = (21.86009770 - i * 0.000090).toFixed(8);
  await page.evaluate((f) => window.__island.goTo(f),
    `${lat} -159.47834411 1.20m 180.0° -2.0° ×1.00`);
  await page.waitForTimeout(900);
  const c = await page.evaluate(() => window.__island.column());
  console.log(
    `${String(i).padStart(3)}  ground ${c.ground.toFixed(0).padStart(6)}`
    + `  depth ${c.depth.toFixed(0).padStart(5)}  floor ${c.floor.toFixed(1).padStart(7)}`
    + `  clear ${c.clearance.toFixed(1).padStart(6)}  herY ${c.herY.toFixed(1).padStart(7)}`
    + `  camUnder ${c.camUnder.toFixed(1).padStart(5)}  salt ${c.salt ? 'Y' : 'n'}`,
  );
}
if (errors.length) console.log('ERRORS:', errors.slice(0, 4));
await browser.close();
