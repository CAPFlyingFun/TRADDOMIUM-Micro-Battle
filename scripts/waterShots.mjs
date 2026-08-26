/**
 * EVERY PLACE JOSHUA HAS PHOTOGRAPHED WATER, REVISITED ON THE BUILD.
 *
 * One boot, then goTo() per fix — the same path a pasted fix takes, so
 * these reproduce his frames rather than approximations of them. When
 * he reports a water fault, add its fix line here; the list is the
 * regression gallery, and a water change is not reviewed until these
 * frames have been LOOKED AT next to his originals.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/waterShots.mjs          # writes ./shots/*.png
 *
 * SwiftShader renders these — slower and flatter-lit than a phone GPU,
 * so judge geometry and coverage here, and judge sheen on the device.
 */
import { chromium } from 'playwright';

import { mkdirSync } from 'node:fs';
const OUT = process.env.SHOTS_DIR ?? 'shots';
mkdirSync(OUT, { recursive: true });
const SHOTS = [
  // The worst aerial shard views, bearings read off his compasses.
  ['aerial-shards-1', '22.04161170 -159.37212633 316.66m 252° -9.1° ×1.00'],
  ['aerial-shards-2', '22.04237933 -159.36980600 316.66m 251° -17.0° ×1.00'],
  ['aerial-shards-3', '22.04280928 -159.36848060 316.66m 251° -17.0° ×1.00'],
  // Low approach over the pond edge (was AGL 8 m, descending).
  ['low-pond', '22.04107133 -159.37387763 93.19m 21° -5.8° ×1.00'],
  // Standing at that lake's shore, looking along the waterline — the
  // jagged-edge complaint of v0.0.53, kept as its regression frame.
  ['pond-shore', '22.04107133 -159.37387763 85.6m 300° -20° ×1.00'],
  // AND THE SAME SHORE LOOKING NNE, which is Joshua's own view and not
  // this rig's. The shot above looks 300°, along the bank; his looks
  // 020-024°, ACROSS it — and that eighty degrees is the whole
  // difference between "organic now" and a row of terrain-cell
  // curtains standing in the water. A regression gallery that only
  // ever faces one way is a gallery of one bearing's bugs.
  ['pond-across', '22.04110839 -159.37390526 86.88m 024° -7.9° ×1.00'],
  ['pond-across-2', '22.04112252 -159.37389852 86.88m 020° -7.9° ×1.00'],
  // And the same shore from 25 m up, where the staircase showed most.
  ['pond-above', '22.04107133 -159.37387763 111m 300° -35° ×1.00'],
  // Ground level: the green-water closeup and standing in deep water.
  ['ground-green', '22.04770247 -159.37176130 89.95m 113° -33.6° ×1.00'],
  ['ground-deep', '22.04768893 -159.37047816 95.99m 199.4° -18.0° ×1.00'],
  // And the older invisible-water spot, looking along the stream.
  ['ground-along', '22.04768301 -159.37048212 96.25m 124.4° -18.7° ×1.00'],
  // High and level toward the interior: far rivers on the mask.
  ['aerial-horizon', '22.04161170 -159.37212633 400m 300° -12° ×1.00'],
];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
page.on('console', (m) => { if (m.type() === 'error') console.log('PAGE ERROR:', m.text()); });
page.on('pageerror', (e) => console.log('PAGE THROW:', e.message));
await page.goto('http://localhost:4173/?spawnRoll=0.25', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-ui="main-menu"]', { timeout: 120000 });
await page.click('[data-ui="new-colony"]');
await page.waitForSelector('[data-ui="island-canvas"]', { timeout: 60000 });
const map = await page.evaluate(() => {
  const b = document.querySelector('[data-ui="island-canvas"]').getBoundingClientRect();
  return { left: b.left, top: b.top, size: b.width };
});
const region = await page.evaluate(() => window.__regions.find((r) => r.id === 'lihue'));
await page.mouse.click(map.left + region.mapX * map.size, map.top + region.mapY * map.size);
await page.waitForSelector('[data-ui="spawn-here"]', { timeout: 20000 });
await page.click('[data-ui="spawn-here"]');

// The loading screen, twice, for the total-that-must-not-move.
await page.waitForSelector('[data-ui="loading"]', { timeout: 60000 }).catch(() => null);
await page.waitForTimeout(1200);
const early = await page.evaluate(() =>
  document.querySelector('[data-ui="loading"]')?.textContent ?? '(gone)');
await page.waitForTimeout(3500);
const late = await page.evaluate(() =>
  document.querySelector('[data-ui="loading"]')?.textContent ?? '(gone)');
console.log('LOADING EARLY:', early.slice(0, 160));
console.log('LOADING LATE :', late.slice(0, 160));
for (let n = 0; n < 6; n++) {
  await page.waitForTimeout(2500);
  const now = await page.evaluate(() =>
    document.querySelector('[data-ui="loading"]')?.textContent ?? '(gone)');
  console.log('LOADING     :', now.slice(0, 160));
  if (now === '(gone)') break;
}

await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
await page.waitForFunction(
  () => !document.querySelector('[data-ui="loading"]'), null, { timeout: 300000 });
await page.waitForFunction(() => window.__island.simTime() > 0.4, null, { timeout: 300000 });

for (const [name, fix] of SHOTS) {
  const took = await page.evaluate((f) => window.__island.goTo(f), fix);
  if (!took) { console.log(`GOTO REFUSED: ${name}`); continue; }
  // Let the water/terrain follow() rebuild and the frame settle. Sim
  // time crawls under SwiftShader, so wait on IT, not the wall.
  const t0 = await page.evaluate(() => window.__island.simTime());
  await page.waitForFunction(
    (t) => window.__island.simTime() > t + 0.8, t0, { timeout: 120000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 120000 });
  console.log(`shot ${name}`);
}
await browser.close();
console.log('DONE');
