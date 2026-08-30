/**
 * IS SHE OFF, AND BY HOW MUCH? — a settled queen, no input at all.
 * The lever is never touched, so nothing is pushing her under and the
 * only thing left is the seat.
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
await page.evaluate((f) => window.__island.goTo(f), FIX);
await page.waitForTimeout(15000);            // let the sim fill

const findPools = () => page.evaluate(() => {
  const w = window.__island.where();
  const found = [];
  for (let dz = -4000; dz <= 4000; dz += 400) {
    for (let dx = -4000; dx <= 4000; dx += 400) {
      const d = window.__island.waterDepth(w[0] + dx, w[2] + dz);
      if (d > 1) found.push({ d, x: w[0] + dx, z: w[2] + dz });
    }
  }
  found.sort((a, b) => b.d - a.d);
  return found.slice(0, 6);
});
// The sim fills at whatever the simulated weather is doing, so wait
// for water rather than assuming it: a run with no pool measures
// nothing and says nothing.
let spots = await findPools();
for (let tries = 0; tries < 20 && spots.length === 0; tries++) {
  await page.waitForTimeout(5000);
  spots = await findPools();
}
if (spots.length === 0) {
  console.log(`[${TAG}] no water formed — nothing to measure`);
  await browser.close();
  process.exit(0);
}
console.log(`[${TAG}] ${spots.length} pools, deepest ${spots[0]?.d.toFixed(1)} units`);
console.log(`[${TAG}] wade = depth the movement used, query = fresh query,`
  + ` riding = herY-ground, want = wade-DRAUGHT`);

const read = async () => {
  const s = await page.evaluate(() => {
    const w = window.__island.where();
    const skin = window.__island.waterSkin(w[0], w[2]);
    const c = window.__island.column();
    return {
      motion: window.__island.motion(),
      dive: window.__island.wading().dive,
      // The depth the MOVEMENT used (this.wet = wade.depth) beside the
      // depth a fresh query gives now. If these differ, the seat and
      // the readout are not looking at the same water.
      wadeDepth: window.__island.wading().depth,
      depth: c.depth,
      herY: c.herY,
      skin: skin ? skin.skin : null,
      bed: skin ? skin.bed : null,
      ground: c.ground,
      queried: c.ground + c.depth,
    };
  });
  return s;
};

// ONE spot, sampled over time. A teleport is not something gameplay
// does, and the frame after one is not a steady state: the window
// re-centres, the depth under her can change by the whole column, and
// her seat is a frame behind it. So settle first, then watch.
const p = spots[0];
await page.evaluate((q) => window.__island.putAt(q.x, q.z, 0), p);
await page.waitForTimeout(8000);
let wasDepth = null;
for (let i = 0; i < 12; i++) {
  const s = await read();
  if (s.skin === null) { console.log(`[${TAG}] (no sheet here)`); break; }
  const rise = wasDepth === null ? 0 : (s.depth - wasDepth) / 1.0;
  wasDepth = s.depth;
  const riding = s.herY - s.ground;          // the `above` actually used
  console.log(`[${TAG}] wade ${s.wadeDepth.toFixed(2).padStart(7)}`
    + ` query ${s.depth.toFixed(2).padStart(7)}`
    + ` | riding ${riding.toFixed(2).padStart(7)}`
    + ` want ${(s.wadeDepth - 0.15).toFixed(2).padStart(7)}`
    + ` | her-skin ${(s.herY - s.skin).toFixed(2).padStart(7)}`
    + ` rise ${rise.toFixed(2)}`);
  await page.waitForTimeout(1000);
}
console.log(`[${TAG}] DRAUGHT is 0.15 — a settled queen should read -0.15`);
console.log(`[${TAG}] page errors:`, errors.length ? errors : 'none');
await browser.close();
