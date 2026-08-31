/**
 * THREE TAPS, ONE ROUTE — and a look at the HUD that moved.
 *
 * Phase 3's second half. It photographs two things:
 *
 *   the MAP, zoomed deep enough to see a route at her scale, with a
 *   chain of taps drawn in the order she will fly them
 *   the HUD, so the drink button is no longer under the minimap
 *
 *   npm run probe:chain
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
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

// THE HUD FIRST, before anything is opened over it.
await page.screenshot({ path: 'probe-chain-hud.png' });
const hud = await page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  };
  return {
    minimap: box('[data-ui="minimap"]'),
    actions: box('[data-ui="actions"]'),
    lift: box('[data-ui="lift-slider"]'),
    die: box('[data-ui="debug-die"]'),
  };
});
console.log('HUD', JSON.stringify(hud, null, 1));
// Do the two rectangles overlap at all? That was the complaint.
const over = (a, b) => a && b
  && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
console.log(`actions overlap the minimap: ${over(hud.actions, hud.minimap)}`);
console.log(`actions overlap the lift lever: ${over(hud.actions, hud.lift)}`);

// A chain of taps on the map, zoomed in far enough to see it.
await page.evaluate(() => {
  const [wx, , wz] = window.__island.where();
  window.__island.explore(wx - 40_000, wz - 40_000, wx + 40_000, wz + 40_000, 80);
  window.__island.openMap();
});
await page.waitForTimeout(1500);
// Deep zoom: press + until it stops.
for (let i = 0; i < 8; i++) {
  const on = await page.evaluate(() => {
    const b = document.querySelector('[data-ui="map-zoom-in"]');
    return b !== null && !b.disabled;
  });
  if (!on) break;
  await page.click('[data-ui="map-zoom-in"]');
  await page.waitForTimeout(150);
}
console.log('zoomed in as far as it goes');

const canvas = await page.evaluate(() => {
  const b = document.querySelector('[data-ui="map-canvas"]').getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
});
// Three taps in a bent line, so the drawing has a direction to read.
for (const [fx, fy] of [[0.42, 0.34], [0.58, 0.62], [0.74, 0.36]]) {
  await page.mouse.click(canvas.x + canvas.w * fx, canvas.y + canvas.h * fy);
  await page.waitForTimeout(250);
}
await page.waitForTimeout(600);
await page.screenshot({ path: 'probe-chain-map.png' });
const said = await page.evaluate(() => ({
  label: document.querySelector('[data-ui="map-destination"]')?.textContent ?? '',
  clear: document.querySelector('[data-ui="map-clear"]')?.textContent ?? '',
}));
console.log('sheet', JSON.stringify(said));

// FLY, and see what the planner made of it.
await page.click('[data-ui="fly-here"]');
// AND CLOSE IT. Solo halts the whole scene while the map is up, so the
// route is not planned until she is running again — `flyMyself` is the
// only thing that plans one, and it runs in the simulation.
console.log('after FLY, brain:',
  JSON.stringify(await page.evaluate(() => window.__island.autonomy().primary)));
await page.evaluate(() => window.__island.closeMap());
await page.waitForTimeout(4000);
console.log('after close, brain:',
  JSON.stringify(await page.evaluate(() => window.__island.autonomy().primary)));
console.log('plan', JSON.stringify(await page.evaluate(() => window.__island.routePlan())));

await browser.close();
