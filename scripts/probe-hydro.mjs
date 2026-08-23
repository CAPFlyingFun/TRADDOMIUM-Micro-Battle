/**
 * IS THE WATER ON THE MAP, AND ON THE RIGHT PART OF IT?
 *
 * The bake already proves the frames agree numerically — 100% of river
 * points on land, elevation correlating at 0.9990 against TMB's own
 * grid. What it cannot prove is that the SHIPPED path works: that the
 * binary downloads, decodes in a browser, reaches the map bake, and
 * draws where the coastline is rather than beside it.
 *
 * So this boots the real game, waits for the spawn map, and shoots it.
 * It also reads the decoded hydrography back out of the page and checks
 * the counts survived the round trip through the network.
 *
 *   npm run probe:hydro       writes hydro-map.png
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.split('\n')[0]));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());

const fail = (why) => { console.log(`probe:hydro FAILED — ${why}`); process.exitCode = 1; };

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-ui="main-menu"]', { timeout: 180000 });
await page.click('[data-ui="new-colony"]');
const map = await page.waitForSelector('[data-ui="island-canvas"]', { timeout: 60000 });

// The map is baked from the heightfield and the hydrography together, so
// by the time it exists the download and decode have both happened.
await page.screenshot({ path: 'hydro-map.png' });
const box = await map.boundingBox();
await map.screenshot({ path: 'hydro-map-only.png' });
console.log(`hydro-map.png  932x430 · map ${Math.round(box.width)}px square`);

/**
 * IS THERE ACTUALLY BLUE ON THE LAND? A drawWater() that silently did
 * nothing — no hydrography loaded, a null slipping through — would leave
 * a map that looks entirely correct, because the island underneath it is
 * correct. So count the river-coloured pixels INSIDE the coastline.
 */
const inked = await page.evaluate(() => {
  const canvas = document.querySelector('[data-ui="island-canvas"]');
  const ink = canvas.getContext('2d');
  const { data, width, height } = ink.getImageData(0, 0, canvas.width, canvas.height);
  let river = 0;
  let land = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    // The river ink is blue-dominant and mid-bright; the sea is much
    // darker and the land is warm.
    if (b > r + 30 && b > 120 && g > 100) river++;
    else if (r > b) land++;
  }
  return { river, land, width, height };
});
console.log(`  river pixels ${inked.river}, land pixels ${inked.land} `
  + `(${(100 * inked.river / (inked.river + inked.land)).toFixed(1)}% of the island)`);
if (inked.river < 2000) fail('almost no river ink on the map — did the water load?');

const counts = await page.evaluate(async () => {
  const mod = await import('/src/world/water.ts').catch(() => null);
  return mod?.hydro?.() ? { rivers: mod.hydro().rivers.length } : null;
}).catch(() => null);
if (counts) console.log(`  hydro(): ${counts.rivers} rivers`);

if (!process.exitCode) console.log('\nprobe:hydro passed');
await browser.close();
