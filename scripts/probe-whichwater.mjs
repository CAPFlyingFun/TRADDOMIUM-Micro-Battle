/**
 * WHICH LAYER IS PUTTING BLUE ON THE SCREEN.
 *
 * Three of them can, and a screenshot cannot say which. This stands at
 * one fix and shoots four frames: everything, then each water layer
 * turned off in turn. Whichever removal makes the blue go away is the
 * one that owns it.
 */
import { chromium } from 'playwright';
import { readPng } from './readPng.mjs';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const FIX = process.env.PROBE_FIX
  ?? '22.07011614 -159.34241965 22.32m 309.3° -8.9° ×1.00';

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto(`${url}?scene=island`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });

const settle = async (seconds) => {
  const from = await page.evaluate(() => window.__island.simTime());
  await page.waitForFunction(
    (mark) => window.__island.simTime() > mark,
    from + seconds, { timeout: 300000, polling: 250 },
  );
};
await settle(1);
await page.evaluate((fix) => window.__island.goTo(fix), FIX);
await settle(3);

/** Blue-ish pixels ABOVE the horizon band are the suspicious ones. */
function blue(file) {
  const { width, height, data } = readPng(file);
  let n = 0;
  for (let p = 0; p < width * height; p++) {
    const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2];
    if (b > r + 14 && b > 45 && b > g + 6) n++;
  }
  return (100 * n) / (width * height);
}

const LAYERS = ['sea', 'lakes', 'rivers'];
for (const on of [null, ...LAYERS]) {
  for (const l of LAYERS) {
    await page.evaluate(
      ([which, show]) => window.__island.showWater(which, show),
      [l, on === null ? true : l !== on],
    );
  }
  await settle(0.6);
  const name = on === null ? 'all' : `no-${on}`;
  const file = `water-${name}.png`;
  await page.screenshot({ path: file });
  console.log(`${name.padEnd(10)} blue ${blue(file).toFixed(2)}%`);
}
await browser.close();
