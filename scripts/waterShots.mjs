/**
 * shots:water — the surveyed rivers, on the island they were surveyed on.
 *
 * Views chosen from the hydrography rather than by eye: a named
 * fifth-order run, the Hanalei River, and a wide third-order reach.
 * When Joshua reports a water fault, add its fix line here — the list
 * is the regression gallery, and a water change is not reviewed until
 * these frames have been LOOKED AT.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/waterShots.mjs        # writes ./shots-water/*.png
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = process.env.SHOTS_DIR ?? 'shots-water';
mkdirSync(OUT, { recursive: true });
const SHOTS = [
  ['iliiliula', '22.03102021 -159.49371010 492.99m 113° -14.0° ×1.00'],
  ['hanalei', '22.14440383 -159.47945709 76.39m 11° -14.0° ×1.00'],
  ['wide-third', '21.99876073 -159.37879953 90.91m 23° -14.0° ×1.00'],
  // And from above, where a whole valley's drainage is in one frame.
  ['hanalei-air', '22.14440383 -159.47945709 260m 11° -22.0° ×1.00'],
  // JOSHUA'S OWN FRAME, the one where the water hung several hundred
  // metres over the ground: 67 m up, looking out past the transition
  // tier at a river the middle tier's 31 m triangles could not cut.
  ['floating-report', '21.97550568 -159.71791288 251.04m 248° -7.9° ×1.00'],
];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
page.on('pageerror', (e) => console.log('PAGE THROW:', e.message));
await page.goto('http://localhost:4173/?scene=island', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
await page.waitForFunction(() => window.__island.simTime() > 0.5, null, { timeout: 240000 });
await page.waitForFunction(() => window.__island.hdTiles() > 0, null, { timeout: 240000 });
await page.waitForFunction(() => window.__island.waterTiles() > 0, null, { timeout: 240000 });
console.log('hd tiles', await page.evaluate(() => window.__island.hdTiles()),
  '· water tiles', await page.evaluate(() => window.__island.waterTiles()));

for (const [name, fix] of SHOTS) {
  const took = await page.evaluate((f) => window.__island.goTo(f), fix);
  if (!took) { console.log(`GOTO REFUSED: ${name}`); continue; }
  const t0 = await page.evaluate(() => window.__island.simTime());
  await page.waitForFunction((t) => window.__island.simTime() > t + 0.8, t0, { timeout: 120000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`shot ${name}`);
}
await browser.close();
console.log('DONE');
