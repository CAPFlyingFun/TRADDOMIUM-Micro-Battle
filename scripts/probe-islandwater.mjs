/** Is there water on the ISLAND, in the game, without touching a key? */
import { chromium } from 'playwright';
const url = process.env.PROBE_URL ?? 'http://localhost:4200/';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto(`${url}?scene=island`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
// No simTime in this lineage — wall clock, and the water runs on the
// frame clock anyway.
const settle = (s) => page.waitForTimeout(s * 1000);
await settle(3);
// Stand her ON a surveyed trunk — the Waiakoali, order 5 — rather than
// wherever the spawn roll dropped her.
const FIX = process.env.PROBE_FIX ?? '22.07701231 -159.65661266 332.78m 180.0° -12.0° ×1.00';
console.log('goTo:', await page.evaluate((f) => window.__island.goTo(f), FIX));
for (const [tag, wait] of [['a', 20], ['b', 35]]) {
  await settle(wait);
  const info = await page.evaluate(() => {
    const w = window.__island.where();
    return {
      at: `${Math.round(w[0])},${Math.round(w[2])}`,
      drawn: window.__island.waterDrawn(),
      underfoot: window.__island.waterDepth(w[0], w[2]).toFixed(1),
    };
  });
  await page.screenshot({ path: `/tmp/isl-${tag}.png` });
  console.log(`${tag} (+${wait}s): drawn ${info.drawn} cells, ${info.underfoot} units underfoot, at ${info.at}`);
}
if (errors.length) console.log('ERRORS:', errors.slice(0, 6));
await browser.close();
