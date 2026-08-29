/**
 * THE SURF ZONE, BEFORE AND AFTER THE DEPTH LIMIT.
 *
 * The cap is a static function of STILL-water depth, so it cannot pump
 * at wave rate — that part is pinned in tests. What only a rendered
 * frame can answer is whether the shoreline now carries a visible
 * seam: a ring where the waves stop, a flattened band, or a wall.
 *
 * Run it once before the change and once after, with a tag, and put
 * the two sets side by side:
 *
 *   node scripts/probe-breaker.mjs before
 *   node scripts/probe-breaker.mjs after
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const TAG = process.argv[2] ?? 'now';
const OUT = 'shots/breaker';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto('http://localhost:4225/?scene=island', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
await page.waitForTimeout(9000);

const LAT = 22.20069511;
const LON = -159.506429;

/** Three heights over the same piece of coast. */
const VIEWS = [
  ['waterline', '0.05m 143.0° -21.8°'],
  ['low', '3.00m 261.0° -12.0°'],
  ['band', '12.00m 261.0° -18.0°'],
];

for (const which of ['fixed', 'procedural']) {
  await page.evaluate((w) => window.__island.waves(w), which);
  for (const [name, where] of VIEWS) {
    await page.evaluate((f) => window.__island.goTo(f),
      `${LAT.toFixed(8)} ${LON.toFixed(8)} ${where} ×1.00`);
    await page.waitForTimeout(11000);
    await page.screenshot({ path: `${OUT}/${TAG}-${which}-${name}.png` });
    const c = await page.evaluate(() => window.__island.column());
    console.log(`${TAG} ${which.padEnd(11)} ${name.padEnd(10)}`
      + ` ground ${c.ground?.toFixed?.(0)}  depth ${c.depth?.toFixed?.(1)}`
      + `  afloat ${c.afloat}`);
  }
}

console.log(`\nshots in ${OUT}/${TAG}-*`);
console.log('pageerrors:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
