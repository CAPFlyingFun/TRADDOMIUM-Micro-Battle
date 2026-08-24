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
// THE CAMERA MUST NOT MOVE BETWEEN THEM, and it does if she is
// airborne — the hold drifts and descends, so a pixel that was sky in
// one frame is hillside in the next and the difference is measuring
// her flight rather than the bed. The fix line is printed either side
// of each shot; if they are not identical the comparison is void and
// this says so instead of quietly reporting nonsense.
const seen = [];
for (const on of [true, false]) {
  await page.evaluate((v) => window.__island.showWater('riverbed', v), on);
  await page.waitForTimeout(120);
  const before = await page.evaluate(() => window.__island.fix());
  await page.screenshot({ path: `/tmp/bed-${on ? 'on' : 'off'}.png` });
  const after = await page.evaluate(() => window.__island.fix());
  seen.push({ on, before, after });
}
const held = seen.every((s) => s.before === s.after)
  && seen[0].before === seen[1].before;
for (const s of seen) console.log(`  ${s.on ? 'on ' : 'off'}: ${s.before}`);
console.log(held ? 'CAMERA HELD — frames are comparable'
  : 'CAMERA MOVED — pixel comparison below is NOT valid');
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
