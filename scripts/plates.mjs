/**
 * CLEAN PLATES: the world with no interface on it.
 *
 * Every HUD decision so far has been argued over a mockup drawn on a
 * blank rectangle, which is the one background the HUD will never be
 * seen against. These are the real thing — real terrain, real light,
 * real queen, at the real design canvas — with every `data-ui` element
 * hidden, so a proposal can be drawn over what it actually has to be
 * legible on.
 *
 *   npm run plates                  ground and flight, 932x430
 *   VIEW=430x932 npm run plates     portrait
 *   ALT=400 npm run plates          climb higher first (slow: the
 *                                   software renderer flies in treacle)
 *
 * Writes plate-ground.png and plate-flight.png.
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const [wide, tall] = (process.env.VIEW ?? '932x430').split('x').map(Number);
const spot = process.env.SPOT ?? 'lihue';
const wanted = Number(process.env.ALT ?? 120);

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});

async function plate(flying) {
  const page = await browser.newPage({ viewport: { width: wide, height: tall } });
  await page.route('**://api.open-meteo.com/**', (r) => r.abort());
  await page.goto(`${url}?spawnRoll=${process.env.SPAWN_ROLL ?? '0.25'}`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-ui="main-menu"]', { timeout: 120000 });
  await page.click('[data-ui="new-colony"]');
  await page.waitForSelector('[data-ui="island-canvas"]', { timeout: 60000 });
  const map = await page.evaluate(() => {
    const b = document.querySelector('[data-ui="island-canvas"]').getBoundingClientRect();
    return { left: b.left, top: b.top, size: b.width };
  });
  const region = await page.evaluate((id) => window.__regions.find((r) => r.id === id), spot);
  await page.mouse.click(map.left + region.mapX * map.size, map.top + region.mapY * map.size);
  await page.waitForSelector('[data-ui="spawn-here"]', { timeout: 20000 });
  await page.click('[data-ui="spawn-here"]');
  await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 120000 });
  await page.waitForFunction(
    () => !document.querySelector('[data-ui="loading"]'), null, { timeout: 240000 });
  await page.waitForFunction(() => window.__island.simTime() > 0.4, null, { timeout: 240000 });

  if (flying) {
    await page.evaluate(() => {
      window.__island.setPace('run');
      window.__island.setSprint(true);
    });
    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => window.__island.canTakeOff(), null, { timeout: 300000 });
    await page.keyboard.down('Space');
    // Climb to a height worth drawing an altimeter against, rather than
    // whatever two seconds of holding the key happens to reach.
    await page.waitForFunction(
      (want) => window.__island.height() >= want, wanted, { timeout: 120000 })
      .catch(() => console.log('  (did not reach the asked-for height)'));
    await page.keyboard.up('Space');
    await page.waitForTimeout(600);
  }

  // EVERY scrap of interface, gone — by structure, not by tag. Hiding
  // `[data-ui]` leaves behind anything nobody remembered to label, and
  // the first plate came back with the thumbstick and the pace readout
  // still on it. The canvas is the world; everything else in the host
  // is interface by definition.
  await page.addStyleTag({
    content: '#app > *:not(canvas){visibility:hidden!important}',
  });
  await page.waitForFunction(() => {
    const kids = [...document.querySelectorAll('#app > *')];
    return kids.every((el) => el.tagName === 'CANVAS'
      || getComputedStyle(el).visibility === 'hidden');
  }, null, { timeout: 20000 });

  const state = await page.evaluate(() => ({
    height: Math.round(window.__island.height()),
    bearing: Math.round((window.__island.compass() + 360) % 360),
    speed: Math.round(window.__island.speed() * 10) / 10,
  }));
  const name = flying ? 'plate-flight.png' : 'plate-ground.png';
  await page.screenshot({ path: name, timeout: 240000 });
  console.log(`${name}  ${wide}x${tall}  alt ${state.height} cm, ${state.speed} cm/s, ${state.bearing}deg`);
  await page.keyboard.up('KeyW').catch(() => {});
  await page.close();
}

await plate(false);
await plate(true);
await browser.close();
