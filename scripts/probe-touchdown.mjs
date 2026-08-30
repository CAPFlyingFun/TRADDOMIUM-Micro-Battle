/**
 * THE LANDING, FRAME BY FRAME — where does she end up relative to the
 * water she can SEE? (F2 touchdown snap + F1/A5 bed disagreement.)
 *   PROBE_TAG=after node scripts/probe-touchdown.mjs
 */
import { chromium } from 'playwright';
const url = 'http://localhost:4220/';
const TAG = process.env.PROBE_TAG ?? 'now';
const FIX = '21.97470778 -159.72064395 40.00m 225.0° -10.0° x1.00';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto(`${url}?scene=island`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });

// Find a deep pool, then fly her over it and let her down onto it.
await page.evaluate((f) => window.__island.goTo(f), FIX);
await page.waitForTimeout(12000);   // let the sim fill a pool
const pool = await page.evaluate(() => {
  const w = window.__island.where();
  let best = { d: 0, x: w[0], z: w[2] };
  for (let dz = -4000; dz <= 4000; dz += 200) {
    for (let dx = -4000; dx <= 4000; dx += 200) {
      const d = window.__island.waterDepth(w[0] + dx, w[2] + dz);
      if (d > best.d) best = { d, x: w[0] + dx, z: w[2] + dz };
    }
  }
  return best;
});
console.log(`[${TAG}] pool depth ${pool.d.toFixed(1)} units`);

const sample = () => page.evaluate(() => {
  const w = window.__island.where();
  const s = window.__island.waterSkin(w[0], w[2]);
  const c = window.__island.column();
  return {
    motion: window.__island.motion(),
    herY: c.herY,
    skin: s ? s.skin : null,
    queried: c.ground + c.depth,
    ground: c.ground,
    height: c.clearance,
  };
});

// Put her in the air right over the pool and hold the lever down.
await page.evaluate((p) => window.__island.putAt(p.x, p.z, 120), pool);
await page.waitForTimeout(1200);
const slider = await page.$('[data-ui="lift-slider"]');
const box = await slider.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.95, { steps: 8 });

console.log(`[${TAG}] ${'motion'.padEnd(9)} ${'herY'.padStart(9)}`
  + ` ${'drawn skin'.padStart(11)} ${'her - skin'.padStart(11)}`);
let last = null;
for (let i = 0; i < 26; i++) {
  await page.waitForTimeout(500);
  const s = await sample();
  const gap = s.skin === null ? null : s.herY - s.skin;
  console.log(`[${TAG}] ${s.motion.padEnd(9)} ${s.herY.toFixed(2).padStart(9)}`
    + ` ${(s.skin ?? 0).toFixed(2).padStart(11)}`
    + ` ${gap === null ? '   —' : gap.toFixed(2).padStart(11)}`
    + (last !== null && Math.abs(s.herY - last) > 5
      ? `   <-- SNAP ${(s.herY - last).toFixed(2)}` : ''));
  last = s.herY;
  if (s.motion === 'swimming' || s.motion === 'diving') {
    await page.mouse.up();
    // SETTLED means settled: let go and wait until she is back at the
    // surface and no longer diving, or the comparison is between a
    // queen who was pushed under and one who was not.
    await page.waitForFunction(
      () => window.__island.motion() === 'swimming'
        && window.__island.wading().dive < 0.02,
      null, { timeout: 60000, polling: 250 },
    ).catch(() => console.log(`[${TAG}] (never stopped diving)`));
    await page.waitForTimeout(2500);
    const f = await sample();
    console.log(`[${TAG}] SETTLED  ${f.motion}  her - drawn skin`
      + ` ${(f.herY - f.skin).toFixed(2)}   her - queried surface`
      + ` ${(f.herY - f.queried).toFixed(2)}`);
    break;
  }
}
await page.screenshot({ path: `/tmp/touchdown-${TAG}.png` });
console.log(`[${TAG}] page errors:`, errors.length ? errors : 'none');
await browser.close();
