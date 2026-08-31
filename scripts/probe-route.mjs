/**
 * DOES SHE ACTUALLY GO ROUND IT — Phase 3's acceptance, headless.
 *
 * The route planner is pure and its own tests prove the geometry. What
 * they cannot prove is that the plan REACHES her: that a pin becomes
 * legs, that the autopilot is handed them one at a time, that arriving
 * at a corner advances to the next, and that the last one is still the
 * place the player asked for.
 *
 *   npm run probe:route
 *
 * The hazard is placed by the probe, through `__island.addHazard`,
 * because the shipped hazard list is empty — TMB has no predators or
 * trees with tops yet, and inventing some to give the router something
 * to do would be a feature that exists only in the code avoiding it.
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
/**
 * World units to the pin.
 *
 * SIXTY METRES, and that is not timidity. This renderer manages about a
 * frame and a half a second with dt clamped at a tenth, so the world
 * advances roughly 0.15 s per wall second — and she cruises at 70 cm/s.
 * A 400 m leg is an hour of wall clock and the first run of this probe
 * spent ten minutes proving she had set off. Sixty metres is a real
 * acquire, a real corner and a real arrival, and it finishes.
 */
const RANGE = Number(process.env.RANGE ?? 6_000);

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

// A no-go astride the straight line, and a tall thing early on it.
const placed = await page.evaluate((range) => {
  const [wx, , wz] = window.__island.where();
  const to = { wx: wx + range * 0.8, wz: wz - range * 0.6 };
  const midX = wx + (to.wx - wx) * 0.55;
  const midZ = wz + (to.wz - wz) * 0.55;
  // Straight through the middle of the leg, and no top: go round.
  window.__island.addHazard(midX, midZ, range / 8, null);
  // And something four metres tall a quarter of the way along, which she
  // should fly OVER rather than round.
  window.__island.addHazard(
    wx + (to.wx - wx) * 0.25, wz + (to.wz - wz) * 0.25, range / 20, 400);
  window.__island.orderTo(to.wx, to.wz);
  return { to, midX, midZ, keepOut: range / 8 };
}, RANGE);

// THE MAP, BEFORE SHE HAS FLOWN ANY OF IT. A route that bends is a
// visual claim and wants a frame: a player who cannot see WHY she is
// flying north-east to reach a pin due east would be right to think the
// autopilot had lost its mind.
await page.evaluate(() => {
  const [wx, , wz] = window.__island.where();
  window.__island.explore(wx - 30_000, wz - 30_000, wx + 30_000, wz + 30_000, 60);
  window.__island.openMap();
});
await page.waitForTimeout(2500);
await page.screenshot({ path: 'probe-route-map.png' });
await page.evaluate(() => window.__island.closeMap());
await page.waitForTimeout(500);

const plan = await page.evaluate(() => window.__island.routePlan());
console.log('PLAN');
console.log(JSON.stringify(plan, null, 1));
console.log(`pin ${placed.to.wx.toFixed(0)},${placed.to.wz.toFixed(0)}`);

const read = () => page.evaluate(() => {
  const ap = window.__island.autopilot();
  const plan = window.__island.routePlan();
  const [wx, , wz] = window.__island.where();
  return {
    t: window.__island.simTime(),
    wx, wz,
    aloft: ap.aloft,
    state: ap.nav?.state ?? null,
    leg: plan?.at ?? null,
    legs: plan?.legs.length ?? 0,
    agl: window.__island.height(),
    words: plan?.words ?? '',
  };
});

const track = [];
let seenLeg = 0;
const began = Date.now();
while (Date.now() - began < 600_000) {
  const now = await read();
  track.push(now);
  if (now.leg !== seenLeg) {
    console.log(`  ── leg ${now.leg + 1}/${now.legs} at ${now.t.toFixed(0)}s`);
    seenLeg = now.leg;
  }
  if (track.length % 4 === 1) console.log(`  ${now.t.toFixed(0)}s leg ${now.leg + 1}/${now.legs}`
    + ` ${now.aloft ? 'ALOFT' : 'down '} agl ${(now.agl / 100).toFixed(2)}m`
    + ` ${now.state ?? '-'}  ${now.words}`);
  if (now.leg === now.legs - 1 && now.state === 'hold') break;
  await page.waitForTimeout(3000);
}

// Did any of it pass through the no-go?
const closest = Math.min(...track.filter((s) => s.aloft).map(
  (s) => Math.hypot(s.wx - placed.midX, s.wz - placed.midZ)));
console.log(`\nclosest approach to the no-go: ${(closest / 100).toFixed(1)} m`
  + ` (its radius is ${(placed.keepOut / 100).toFixed(1)} m)`);
console.log(`MISSED IT: ${closest > placed.keepOut}`);
const end = track[track.length - 1];
console.log(`arrived: ${Math.hypot(end.wx - placed.to.wx, end.wz - placed.to.wz) < 400}`);

await page.screenshot({ path: 'probe-route.png' });
await browser.close();
