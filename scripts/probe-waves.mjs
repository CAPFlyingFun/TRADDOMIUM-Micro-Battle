/**
 * DOES SHE CLEAR THE WAVES, OR FLY THROUGH THEM?
 *
 * Joshua: "when flying over the ocean, it should get the max wave
 * height + 1m for a safe margin between the waves and ant."
 *
 * She used to hold 55 cm over the DAMPED sea — the surface she flies
 * against, which is roughly mean water — so a crest standing a metre
 * above mean water went straight through her. This flies her out over
 * the ocean and asks, every couple of seconds, how high the crests have
 * been and how high she actually is.
 *
 *   npm run probe:waves
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
/** How far out to sea. 300 m: past the surf and into real swell. */
const RANGE = Number(process.env.RANGE ?? 30_000);

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto(`${url}?spawnRoll=${process.env.SPAWN_ROLL ?? '0.25'}`,
  { waitUntil: 'domcontentloaded' });

await page.waitForSelector('[data-ui="main-menu"]', { timeout: 120000 });
await page.click('[data-ui="new-colony"]');
await page.waitForSelector('[data-ui="island-canvas"]', { timeout: 60000 });
const pick = await page.evaluate(() => {
  const b = document.querySelector('[data-ui="island-canvas"]').getBoundingClientRect();
  return { left: b.left, top: b.top, size: b.width };
});
const region = await page.evaluate(
  (id) => window.__regions.find((r) => r.id === id), process.env.SPOT ?? 'lihue');
await page.mouse.click(pick.left + region.mapX * pick.size, pick.top + region.mapY * pick.size);
await page.waitForSelector('[data-ui="spawn-here"]', { timeout: 20000 });
await page.click('[data-ui="spawn-here"]');
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 120000 });
await page.waitForFunction(
  () => !document.querySelector('[data-ui="loading"]'), null, { timeout: 240000 });
await page.waitForFunction(() => window.__island.simTime() > 0.4, null, { timeout: 240000 });

// PUT HER OVER THE SEA RATHER THAN FLYING HER THERE. The nearest salt
// water from a Lihue spawn is a couple of kilometres off, and at her
// pace that is most of an hour of headless wall clock to reach — a
// probe about what she does OVER the ocean should not spend its life
// getting there. `putAt` is the same door goTo uses.
const out = await page.evaluate((range) => {
  const [wx, , wz] = window.__island.where();
  let best = { d: 0, wx, wz };
  for (let ring = range; ring <= range * 20; ring += range) {
    for (let deg = 0; deg < 360; deg += 10) {
      const a = (deg * Math.PI) / 180;
      const at = { wx: wx + Math.sin(a) * ring, wz: wz + Math.cos(a) * ring };
      // THE SHARED QUERY, and SALT specifically: `waterDepth` is the
      // inland simulation and a hunt for the ocean with it finds
      // streams. The first run of this probe searched 3.6 km and
      // reported no water at all while she was standing beside one.
      const spot = window.__island.seaAt(at.wx, at.wz);
      if (spot !== null && spot.salt && spot.depth > best.d) {
        best = { d: spot.depth, ...at };
      }
    }
    if (best.d > 200) break;
  }
  return best;
}, RANGE);
if (out.d <= 0) {
  console.log('NO WATER FOUND within reach of this spawn — try SPOT=');
  await browser.close();
  process.exit(1);
}
console.log(`sea found ${(out.d / 100).toFixed(1)} m deep`);
await page.evaluate((at) => window.__island.putAt(at.wx, at.wz, 0), out);
await page.waitForTimeout(2000);
// And a pin further out along the same line, so she has a reason to fly.
const pin = await page.evaluate((at) => {
  const [wx, , wz] = window.__island.where();
  const len = Math.hypot(at.wx - wx, at.wz - wz) || 1;
  const to = {
    wx: at.wx + ((at.wx - wx) / len) * 8_000,
    wz: at.wz + ((at.wz - wz) / len) * 8_000,
  };
  window.__island.orderTo(to.wx, to.wz);
  return to;
}, out);
console.log(`pin 80 m further out at ${pin.wx.toFixed(0)},${pin.wz.toFixed(0)}`);

let worst = null;
let overSea = 0;
const began = Date.now();
while (Date.now() - began < 600_000) {
  const now = await page.evaluate(() => {
    const w = window.__island.seaClear();
    const [wx, , wz] = window.__island.where();
    return {
      t: window.__island.simTime(),
      agl: window.__island.height(),
      depth: window.__island.seaAt(wx, wz)?.depth ?? 0,
      aloft: window.__island.autopilot().aloft,
      state: window.__island.autopilot().nav?.state ?? null,
      ...w,
    };
  });
  if (now.aloft && now.depth > 0) {
    overSea++;
    // THE ONE NUMBER THIS PROBE EXISTS FOR: how much air was between
    // the highest crest lately and her. Negative is a wet queen.
    const spare = now.agl - now.crest;
    if (worst === null || spare < worst.spare) worst = { ...now, spare };
    console.log(`  ${now.t.toFixed(0)}s agl ${(now.agl / 100).toFixed(2)}m`
      + ` crest ${(now.crest / 100).toFixed(2)}m`
      + ` wants ${(now.clearance / 100).toFixed(2)}m`
      + ` · spare ${(spare / 100).toFixed(2)}m  ${now.state ?? '-'}`);
  }
  if (now.state === 'hold') break;
  await page.waitForTimeout(2500);
}

console.log(`\nsamples over water: ${overSea}`);
if (worst) {
  console.log(`TIGHTEST: ${(worst.spare / 100).toFixed(2)} m of air over the crest`
    + ` (agl ${(worst.agl / 100).toFixed(2)}m, crest ${(worst.crest / 100).toFixed(2)}m)`);
  console.log(`CLEARED THE WAVES: ${worst.spare > 0}`);
}
await page.screenshot({ path: 'probe-waves.png' });
await browser.close();
