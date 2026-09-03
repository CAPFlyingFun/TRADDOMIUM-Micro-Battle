/**
 * DOES THE PLANNER SEE THE TREES — landmark trees on the bare URL,
 * plan only, headless.
 *
 *   npm run probe:treeplan
 *
 * One boot, no flight. Spawns in Wailua Forest through the front door
 * (menu, new colony, region, spawn here), waits for the vegetation
 * raster, asks the scene which trees stand near her, pins a course
 * past the nearest one, and reads the plan back: does it bend, was it
 * shown the tree, what did it cost. Flying it is probe:trees and is a
 * final-verification probe, not this one — at a frame and a half a
 * second a sixty-metre leg is ten minutes of wall clock.
 *
 * Unlike probe:route this places NOTHING: the hazards are the island's
 * own, which is the whole point.
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const SPOT = process.env.SPOT ?? 'wailua-forest';

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
  (id) => window.__regions.find((r) => r.id === id), SPOT);
if (!region) throw new Error(`no spawn region ${SPOT}`);
await page.mouse.click(pick.left + region.mapX * pick.size, pick.top + region.mapY * pick.size);
await page.waitForSelector('[data-ui="spawn-here"]', { timeout: 20000 });
await page.click('[data-ui="spawn-here"]');
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 120000 });
await page.waitForFunction(
  () => !document.querySelector('[data-ui="loading"]'), null, { timeout: 240000 });
await page.waitForFunction(() => window.__island.simTime() > 0.4, null, { timeout: 240000 });
// The raster is off the loading plan; give it a moment past first light.
await page.waitForFunction(() => window.__island.vegReady(), null, { timeout: 60000 });
await page.waitForTimeout(1500);

const stand = await page.evaluate(() => window.__island.landmarks());
console.log(`STAND ${JSON.stringify(stand)}`);
const near = await page.evaluate(() => {
  const [wx, , wz] = window.__island.where();
  return window.__island.trees(6_000)
    .map((t) => ({ ...t, d: Math.hypot(t.wx - wx, t.wz - wz) }))
    .sort((a, b) => a.d - b.d);
});
console.log(`TREES within 60 m: ${near.length}`);
for (const t of near.slice(0, 6)) {
  console.log(`  ${t.id} at ${(t.d / 100).toFixed(1)} m, ${(t.height / 100).toFixed(1)} m tall,`
    + ` trunk r ${t.trunk.toFixed(0)} cm, ground ${(t.ground / 100).toFixed(1)} m`);
}
if (near.length === 0) {
  console.log('NO TREES NEAR THE SPAWN — nothing to plan against here');
  await page.screenshot({ path: 'probe-treeplan.png' });
  await browser.close();
  process.exit(1);
}

// PIN A COURSE THROUGH THE NEAREST TREE: straight at it, and twenty
// metres past. The straight line enters its trunk ring, so a planner
// that sees it must bend.
const target = near[0];
const placed = await page.evaluate((t) => {
  const [wx, , wz] = window.__island.where();
  const dx = t.wx - wx;
  const dz = t.wz - wz;
  const len = Math.hypot(dx, dz);
  const to = { wx: t.wx + (dx / len) * 2_000, wz: t.wz + (dz / len) * 2_000 };
  window.__island.orderTo(to.wx, to.wz);
  return { to, from: { wx, wz } };
}, target);
// The order becomes a plan on the next frame that flies her, and at a
// frame and a half a second "next" is not "now".
await page.waitForFunction(() => window.__island.routePlan() !== null, null, { timeout: 60000 });

const plan = await page.evaluate(() => window.__island.routePlan());
console.log('PLAN');
console.log(JSON.stringify(plan, null, 1));

// TREES ARE NOT ROUTED — they are dodged. So what this probe checks is
// that the route is a straight line THROUGH the wood (nothing to route
// round, because the hazard list is honestly empty) and that the
// forward march can see the trunk she is about to reach.
const way = await page.evaluate(() => window.__island.inTheWay());
console.log(`\nlegs ${plan.legs.length} · avoided ${plan.avoided}`
  + ` · blocked ${plan.blocked} · planned in ${plan.planMs.toFixed(1)} ms`);
console.log(`LOOKOUT ${JSON.stringify(way)}`);
console.log(`ROUTE IS STRAIGHT (trees are not routed): ${plan.avoided === 0}`);

// THE MAP, with the bent route on it.
await page.evaluate(() => {
  const [wx, , wz] = window.__island.where();
  window.__island.explore(wx - 6_000, wz - 6_000, wx + 6_000, wz + 6_000, 40);
  window.__island.openMap();
});
await page.waitForTimeout(2500);
await page.screenshot({ path: 'probe-treeplan-map.png' });
await page.evaluate(() => window.__island.closeMap());
await page.waitForTimeout(800);
await page.screenshot({ path: 'probe-treeplan.png' });
await browser.close();
