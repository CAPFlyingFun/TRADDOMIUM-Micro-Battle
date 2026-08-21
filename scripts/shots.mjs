/** Spawn in each named region and save a clean screenshot. No probing. */
import { chromium } from 'playwright';
const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const spots = (process.env.SHOTS ?? 'mana,lihue,poipu,kokee,hanalei-bay').split(',');
const tag = process.env.TAG ?? 'shot';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
try {
  for (const spot of spots) {
    const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
    // A SHADER THAT WILL NOT COMPILE FAILS QUIETLY — the terrain just
    // is not there, and a screenshot of an empty blue world looks like
    // a spawn in the sea rather than like a broken build. The error is
    // on the console, so the console is watched.
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) {
        errors.push(m.text());
      }
    });
    await page.route('**://api.open-meteo.com/**', (r) => r.abort());
    await page.goto(`${url}?spawnRoll=0.25`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-ui="main-menu"]', { timeout: 60000 });
    await page.click('[data-ui="new-colony"]');
    await page.waitForSelector('[data-ui="island-canvas"]', { timeout: 60000 });
    const map = await page.evaluate(() => {
      const b = document.querySelector('[data-ui="island-canvas"]').getBoundingClientRect();
      return { left: b.left, top: b.top, size: b.width };
    });
    const r = await page.evaluate((w) => window.__regions.find((x) => x.id === w), spot);
    if (!r) { console.log(`no region ${spot}`); await page.close(); continue; }
    await page.mouse.click(map.left + r.mapX * map.size, map.top + r.mapY * map.size);
    await page.waitForSelector('[data-ui="spawn-here"]', { timeout: 20000 });
    await page.click('[data-ui="spawn-here"]');
    await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__island.simTime() > 3, null, { timeout: 180000 });
    await page.addStyleTag({
      content: '[data-ui]:not([data-ui="island-canvas"]){visibility:hidden!important}',
    });
    await page.waitForFunction(() => {
      const v = document.querySelector('[data-ui="vitals"]');
      return v === null || getComputedStyle(v).visibility === 'hidden';
    }, null, { timeout: 20000 });
    await page.screenshot({ path: `${tag}-${spot}.png` });
    if (errors.length) {
      console.log(`${spot}: FAILED — ${errors[0].split('\n')[0]}`);
      process.exitCode = 1;
    } else {
      console.log(`${tag}-${spot}.png`);
    }
    await page.close();
  }
} finally { await browser.close(); }
