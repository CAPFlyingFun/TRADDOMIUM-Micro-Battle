/**
 * THE NAVIGATION MAP, PHOTOGRAPHED — minimap, fog, and the full screen.
 *
 * Discovery is meant to take hours of flying to open up, which is right
 * for a player and useless for a screenshot: a fresh run's minimap is
 * an almost-black square with one lit cell in it, and no picture of
 * that can tell you whether the compositing works or whether the thing
 * is simply broken. So this drives the real front door, then walks the
 * reveal along a line through the island with the probe hook and takes
 * the shots that can actually be judged.
 *
 *   npm run probe:map
 *   VIEW=430x932 npm run probe:map      portrait
 *
 * Writes map-hud.png (the gameplay HUD with the minimap on it) and
 * map-screen.png (the full-screen map, open).
 *
 * IT GOES THROUGH THE FRONT DOOR ON PURPOSE. CLAUDE.md's standing rule
 * is that the bare URL is the game and a probe that skips a step the
 * player cannot skip is measuring a different program — so this clicks
 * NEW COLONY like a thumb would, and picks up whichever session mode
 * the menu defaults to rather than forcing one.
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const [wide, tall] = (process.env.VIEW ?? '932x430').split('x').map(Number);

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: wide, height: tall } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto(`${url}?spawnRoll=${process.env.SPAWN_ROLL ?? '0.25'}`,
  { waitUntil: 'domcontentloaded' });

await page.waitForSelector('[data-ui="main-menu"]', { timeout: 120000 });
await page.screenshot({ path: 'map-menu.png' });
await page.click('[data-ui="new-colony"]');

// THE SPAWN PICKER IS A DOOR, NOT A DETOUR. `island-canvas` here is the
// picker's own map, and a probe that stopped at it would photograph a
// screen the game does not play on — CLAUDE.md's rule about not
// skipping a step a player cannot skip cuts both ways.
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
await page.waitForSelector('[data-ui="minimap"]', { timeout: 60000 });

// The fresh minimap, before anything has been explored — this is what a
// new player's first frame actually looks like.
await page.screenshot({ path: 'map-fresh.png' });

// A fresh run knows one disc. Walk her reveal a long way so the fog has
// a shape worth photographing, then let a frame paint it.
const seen = await page.evaluate(() => {
  const [wx, , wz] = window.__island.where();
  return window.__island.explore(
    wx - 900_000, wz - 700_000, wx + 900_000, wz + 600_000, 120,
  );
});
await page.waitForTimeout(1200);
await page.screenshot({ path: 'map-hud.png' });

// And the full screen, opened the way a thumb opens it.
await page.click('[data-ui="minimap"]');
await page.waitForSelector('[data-ui="map-screen"]', { timeout: 20000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'map-screen.png' });

// A tap on the island should PREVIEW, never commit.
const before = await page.evaluate(() => window.__island.autonomy().primary);
const box = await page.locator('[data-ui="map-screen"]').boundingBox();
await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.45);
await page.waitForTimeout(600);
const afterTap = await page.evaluate(() => window.__island.autonomy().primary);
await page.screenshot({ path: 'map-preview.png' });

// And FLY HERE should.
await page.click('[data-ui="fly-here"]');
await page.waitForTimeout(600);
const afterFly = await page.evaluate(() => window.__island.autonomy().primary);
await page.screenshot({ path: 'map-active.png' });

console.log(`explored ${(seen * 100).toFixed(1)}% of the mask`);
console.log(`primary mission: before=${before} afterTap=${afterTap} afterFly=${afterFly}`);
console.log('map-menu.png · map-fresh.png · map-hud.png · map-screen.png'
  + ' · map-preview.png · map-active.png');
await browser.close();
