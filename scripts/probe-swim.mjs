/**
 * LAND ON THE WATER, FLOAT, DIVE — the whole arc, measured.
 *   npm run probe:swim
 */
import { chromium } from 'playwright';
const url = process.env.PROBE_URL ?? 'http://localhost:4220/';
// Joshua's lake from his screenshot: 21.9747 -159.7206 (the west-side pool).
// LOW fix: goTo grounds her when the asked height is at the ground, and
// wadeAt floats her off it — the same arc a real landing ends in.
const FIX = process.env.PROBE_FIX ?? '21.97470778 -159.72064395 40.00m 225.0° -10.0° ×1.00';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto(`${url}?scene=island`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
const settle = (s) => page.waitForTimeout(s * 1000);
await settle(3);
await page.evaluate((f) => window.__island.goTo(f), FIX);
// Let the window fill its lake, then report the arc.
await settle(30);
const read = () => page.evaluate(() => {
  const w = window.__island.where();
  return {
    at: `${Math.round(w[0])},${Math.round(w[2])}`, y: w[1].toFixed(1),
    airborne: window.__island.airborne(),
    wading: window.__island.wading(),
    depthHere: window.__island.waterDepth(w[0], w[2]).toFixed(1),
  };
});
console.log('after goTo (should be airborne):', JSON.stringify(await read()));
await page.screenshot({ path: '/tmp/swim-air.png' });
// Land: hold the descend side of the lift slider via its debug-free path —
// flight lands when height reaches the floor, so just push the lever down.
// The slider is a DOM element; drag it to the bottom.
const slider = await page.$('[data-ui="lift-slider"]') ?? await page.$('.lift-slider');
if (slider) {
  const box = await slider.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.95, { steps: 8 });
  await settle(12);              // descend to the surface
  console.log('descending:', JSON.stringify(await read()));
  await page.mouse.up();
} else {
  console.log('NO SLIDER FOUND — dumping data-ui ids');
  console.log(await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-ui]')).map((e) => e.getAttribute('data-ui')).join(',')));
}
await settle(4);
// Stand her in the deepest water near here — the drift varies run to
// run, and the probe is after the physics, not the walk. putAt is the
// same door goTo uses.
await page.evaluate(() => {
  const w = window.__island.where();
  let best = { d: 0, x: w[0], z: w[2] };
  for (let dz = -3000; dz <= 3000; dz += 250) {
    for (let dx = -3000; dx <= 3000; dx += 250) {
      const d = window.__island.waterDepth(w[0] + dx, w[2] + dz);
      if (d > best.d) best = { d, x: w[0] + dx, z: w[2] + dz };
    }
  }
  window.__island.putAt(best.x, best.z, 0);
});
await settle(2);
await page.waitForFunction(() => window.__island.wading().afloat, null, { timeout: 60000, polling: 500 });
console.log('after landing (afloat?):', JSON.stringify(await read()));
await page.screenshot({ path: '/tmp/swim-float.png' });
// Dive: push the lever down again while afloat.
if (slider) {
  const box = await slider.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.95, { steps: 8 });
  await settle(3);
  console.log('diving:', JSON.stringify(await read()));
  await settle(3);
  console.log('deeper:', JSON.stringify(await read()));
  await page.screenshot({ path: '/tmp/swim-dive.png' });
  await page.mouse.up();
}
if (errors.length) console.log('ERRORS:', errors.slice(0, 5));
await browser.close();
