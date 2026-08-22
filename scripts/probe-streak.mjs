/**
 * probe:streak — find ground that is smearing, by measuring it.
 *
 * Streaking is long runs of near-identical colour along one screen
 * direction and ordinary noise across the other. So for a band of the
 * frame, compare the mean absolute difference between HORIZONTALLY
 * adjacent pixels against the same for VERTICALLY adjacent ones. On
 * healthy ground the two are close. On smeared ground one collapses,
 * and the ratio between them says by how much.
 *
 * Screenshots and an opinion have already sent me the wrong way twice
 * on this; a number can be compared between builds and between
 * locations.
 */
import { chromium } from 'playwright';
import { readPng } from './readPng.mjs';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const regions = (process.env.PROBE_REGIONS
  ?? 'mana,poipu,lihue,kekaha,polihale,anini,kapaa,koloa,waimea-rim,kokee')
  .split(',');
const rolls = (process.env.PROBE_ROLLS ?? '0.25').split(',').map(Number);

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});

/** Mean absolute channel difference between neighbours, both ways. */
function smear(png, fromRow, toRow) {
  const { width, data } = png;
  let across = 0;
  let down = 0;
  let n = 0;
  const at = (x, y) => (y * width + x) * 4;
  for (let y = fromRow; y < toRow; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      const a = at(x, y);
      const r = at(x + 1, y);
      const b = at(x, y + 1);
      across += Math.abs(data[a] - data[r]) + Math.abs(data[a + 1] - data[r + 1]);
      down += Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]);
      n += 1;
    }
  }
  return { across: across / n, down: down / n };
}

const rows = [];
try {
  for (const region of regions) {
    for (const roll of rolls) {
      const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
      await page.route('**://api.open-meteo.com/**', (r) => r.abort());
      await page.goto(`${url}?spawnRoll=${roll}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-ui="main-menu"]', { timeout: 60000 });
      await page.click('[data-ui="new-colony"]');
      await page.waitForSelector('[data-ui="island-canvas"]', { timeout: 60000 });
      const map = await page.evaluate(() => {
        const b = document.querySelector('[data-ui="island-canvas"]').getBoundingClientRect();
        return { left: b.left, top: b.top, size: b.width };
      });
      const r = await page.evaluate((w) =>
        window.__regions.find((x) => x.id === w) ?? null, region);
      if (!r) { console.log(`${region}: no such region`); await page.close(); continue; }
      await page.mouse.click(map.left + r.mapX * map.size, map.top + r.mapY * map.size);
      await page.waitForSelector('[data-ui="spawn-here"]', { timeout: 20000 });
      await page.click('[data-ui="spawn-here"]');
      await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 120000 });
      await page.waitForFunction(() => window.__island.simTime() > 0.3,
        null, { timeout: 300000 });
      await page.addStyleTag({
        content: '[data-ui]:not([data-ui="island-canvas"]){visibility:hidden!important}',
      });
      await page.waitForFunction(() => {
        const v = document.querySelector('[data-ui="vitals"]');
        return v === null || getComputedStyle(v).visibility === 'hidden';
      }, null, { timeout: 20000 });
      await page.screenshot({ path: 'streak.png' });
      const png = readPng('streak.png');
      // The middle band: near enough to be ground, far enough to be
      // grazing. The bottom of the frame is underfoot and never smears.
      const mid = smear(png, Math.round(png.height * 0.30), Math.round(png.height * 0.55));
      const ratio = Math.max(mid.across, mid.down) / Math.max(0.001, Math.min(mid.across, mid.down));
      rows.push({ region, roll, ...mid, ratio });
      console.log(
        `${region.padEnd(12)} roll ${roll}  across ${mid.across.toFixed(2).padStart(6)}  `
        + `down ${mid.down.toFixed(2).padStart(6)}  ratio ${ratio.toFixed(2)}`,
      );
      await page.close();
    }
  }
  rows.sort((a, b) => b.ratio - a.ratio);
  console.log('\nworst three:');
  for (const row of rows.slice(0, 3)) {
    console.log(`  ${row.region} (roll ${row.roll}) ratio ${row.ratio.toFixed(2)}`);
  }
} finally {
  await browser.close();
}
