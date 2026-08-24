/**
 * IS THE STREAMBED VISIBLE, AND WHERE?
 *
 * Two builds photographed a minute apart cannot answer this: the sun
 * moves, the weather rolls, and a third of the frame changes for
 * reasons that are not the bed. So this shoots ONE session twice with
 * only `showWater('riverbed', ...)` between the frames.
 *
 * THE PICTURES ARE THE EVIDENCE, not the percentage. The world keeps
 * running between the two shots — the ripple scrolls, the rain falls —
 * so the figure printed is an upper bound on the bed's footprint, not
 * a measurement of it. Look at the frames.
 *
 *   npm run probe:riverbed     writes /tmp/bed-on.png, /tmp/bed-off.png
 */
import { chromium } from 'playwright';
import { readPng } from './readPng.mjs';
const url = process.env.PROBE_URL ?? 'http://localhost:4183/';
const FIX = process.env.PROBE_FIX ?? '22.07011614 -159.34241965 22.32m 309.3° -8.9° ×1.00';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.addInitScript(() => {
  localStorage.setItem('traddomium.settings', JSON.stringify({ terrainRelief: 1.0 }));
});
await page.goto(`${url}?scene=island`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
const settle = async (s) => {
  const from = await page.evaluate(() => window.__island.simTime());
  await page.waitForFunction((m) => window.__island.simTime() > m, from + s,
    { timeout: 300000, polling: 250 });
};
await settle(1);
await page.evaluate((f) => window.__island.goTo(f), FIX);
await settle(3);
for (const on of [true, false]) {
  await page.evaluate((v) => window.__island.showWater('riverbed', v), on);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/bed-${on ? 'on' : 'off'}.png` });
}
const a = readPng('/tmp/bed-on.png');
const b = readPng('/tmp/bed-off.png');
let n = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
  const p = (y * a.width + x) * 4;
  const d = Math.abs(a.data[p] - b.data[p]) + Math.abs(a.data[p+1] - b.data[p+1])
    + Math.abs(a.data[p+2] - b.data[p+2]);
  if (d > 16) { n++;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y; }
}
console.log(`frame differs by ${(100*n/(a.width*a.height)).toFixed(2)}% with the bed on (upper bound — see header)`);
if (n) console.log(`  region x ${minX}..${maxX}  y ${minY}..${maxY}`);
await browser.close();
