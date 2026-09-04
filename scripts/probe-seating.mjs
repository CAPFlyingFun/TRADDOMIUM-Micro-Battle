/**
 * HOW FAR HER DRAWN BODY SITS ABOVE HER OWN ORIGIN.
 *
 *   npm run probe:seating
 *
 * Joshua, three versions running: "ant is still slightly floating off
 * the trees". Her SEAT has been measured in-game at 0.01 cm off the
 * bark — she is exactly on it — so whatever is left is her model
 * standing above its own zero. Boot only; no climbing needed.
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto(`${url}?spawnRoll=0.25`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-ui="main-menu"]', { timeout: 120000 });
await page.click('[data-ui="new-colony"]');
await page.waitForSelector('[data-ui="island-canvas"]', { timeout: 60000 });
const pick = await page.evaluate(() => {
  const b = document.querySelector('[data-ui="island-canvas"]').getBoundingClientRect();
  return { left: b.left, top: b.top, size: b.width };
});
const region = await page.evaluate(() => window.__regions.find((r) => r.id === 'wailua-forest'));
await page.mouse.click(pick.left + region.mapX * pick.size, pick.top + region.mapY * pick.size);
await page.waitForSelector('[data-ui="spawn-here"]', { timeout: 20000 });
await page.click('[data-ui="spawn-here"]');
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 120000 });
await page.waitForFunction(
  () => !document.querySelector('[data-ui="loading"]'), null, { timeout: 240000 });
// The real model arrives over the network; give it a moment to land.
await page.waitForFunction(() => window.__island.simTime() > 1.5, null, { timeout: 240000 });
await page.waitForTimeout(4000);

const seat = await page.evaluate(() => window.__island.seating());
console.log('LOWEST DRAWN POINT relative to her origin, world units (cm):');
console.log(`  whole model: ${seat.whole}`);
for (const [name, y] of Object.entries(seat.parts)) console.log(`  ${name}: ${y}`);
console.log('\n0 means her lowest drawn part touches her seat.');
console.log('POSITIVE means she floats by that much, wherever she stands.');
await browser.close();
