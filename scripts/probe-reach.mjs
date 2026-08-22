/** How far the ground detail actually reaches, in metres, per fade setting. */
import { chromium } from 'playwright';
const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto(`${url}?spawnRoll=0.25`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-ui="main-menu"]', { timeout: 60000 });
await page.click('[data-ui="new-colony"]');
await page.waitForSelector('[data-ui="island-canvas"]', { timeout: 60000 });
// That canvas is the SPAWN MAP, not the game. Pick a region and land.
const map = await page.evaluate(() => {
  const b = document.querySelector('[data-ui="island-canvas"]').getBoundingClientRect();
  return { left: b.left, top: b.top, size: b.width };
});
const spot = process.env.SPOT ?? 'lihue';
const r = await page.evaluate((w) => window.__regions.find((x) => x.id === w), spot);
await page.mouse.click(map.left + r.mapX * map.size, map.top + r.mapY * map.size);
await page.waitForSelector('[data-ui="spawn-here"]', { timeout: 20000 });
await page.click('[data-ui="spawn-here"]');
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 120000 });
await page.waitForFunction(() => window.__island.simTime() > 0.4, null, { timeout: 240000 });
const out = await page.evaluate(() => window.__island.fadeProfile());

console.log(`camera ${(out.camHeightCm / 100).toFixed(2)} m above her, fov ${out.fov}deg, 932x430`);
console.log(`ground tile ${out.tileCm} cm, band map 1024 texels`);
console.log(`shipping fade: ${out.fadeFrom} -> ${out.fadeTo} texels per pixel\n`);

// Nearest-first, so a threshold is crossed once and in the right order.
const rows = out.rows.filter((r) => Number.isFinite(r.texels))
  .sort((a, b) => a.metres - b.metres);

/** Distance at which a pixel first averages `texels` source texels. */
const reach = (texels, tileCm = out.tileCm) => {
  const scale = out.tileCm / tileCm;           // texels scale exactly with 1/tile
  let prev = null;
  for (const r of rows) {
    const t = r.texels * scale;
    if (t >= texels) {
      if (!prev) return r.metres;
      const pt = prev.texels * scale;
      const f = (texels - pt) / (t - pt);
      return prev.metres + (r.metres - prev.metres) * f;
    }
    prev = r;
  }
  return Infinity;
};
const say = (m) => (Number.isFinite(m) ? (m >= 10 ? `${m.toFixed(0)} m` : `${m.toFixed(2)} m`) : 'horizon');

console.log('WHAT THE FADE MULTIPLIER BUYS (1x = what ships today)');
console.log('  mult    full detail to    all flat by');
for (const m of [0.25, 0.5, 1, 2, 4]) {
  console.log(`  ${String(m).padStart(4)}x  ${say(reach(out.fadeFrom * m)).padStart(14)}  ${say(reach(out.fadeTo * m)).padStart(13)}`);
}

console.log('\nWHAT A BIGGER GROUND TILE WOULD BUY (fade as shipped)');
console.log('  tile    full detail to    all flat by   texels per mm');
for (const t of [4, 10, 20, 40, 80]) {
  const perMm = (1024 / (t * 10)).toFixed(1);
  console.log(`  ${String(t).padStart(3)}cm  ${say(reach(out.fadeFrom, t)).padStart(14)}  ${say(reach(out.fadeTo, t)).padStart(13)}  ${perMm.padStart(13)}`);
}

console.log('\nWHAT IT WOULD TAKE TO REACH 80 m');
const at80 = rows[rows.length - 1];
console.log(`  farthest row measured: ${at80.metres.toFixed(0)} m at ${at80.texels.toExponential(2)} texels/pixel`);
console.log(`  one pixel there covers ${(at80.texels / 1024).toFixed(0)} full repeats of the ${out.tileCm} cm tile`);

console.log('\nMEASURED CURVE');
console.log('   metres   texels/px');
for (const r of rows.filter((_, i) => i % 8 === 0)) {
  console.log(`  ${r.metres.toFixed(2).padStart(7)}  ${r.texels.toFixed(0).padStart(10)}`);
}
await browser.close();
