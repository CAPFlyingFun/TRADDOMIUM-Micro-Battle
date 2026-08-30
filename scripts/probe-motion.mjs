/** STAGE G: does the derived state agree with the physics it came from? */
import { chromium } from 'playwright';
const url = 'http://localhost:4220/';
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
const settle = (n) => page.waitForTimeout(n * 700);

const read = () => page.evaluate(() => ({
  motion: window.__island.motion(),
  act: window.__island.act(),
  w: window.__island.wading(),
  airborne: window.__island.airborne(),
  wings: window.__island.wingDry(),
}));
const seen = new Set();
const bad = [];
async function step(label) {
  const s = await read();
  seen.add(s.motion);
  const want = s.airborne ? 'flying'
    : s.w.under ? 'diving' : s.w.afloat ? 'swimming'
    : s.w.depth > 0 ? 'wading' : null;
  if (want && s.motion !== want) bad.push(`${label}: said ${s.motion}, physics said ${want} — ${JSON.stringify(s)}`);
  console.log(label.padEnd(13), s.motion.padEnd(9), 'act=' + s.act.padEnd(9),
    'afloat=' + String(s.w.afloat).padEnd(5), 'under=' + String(s.w.under).padEnd(5),
    'depth=' + s.w.depth.toFixed(2).padStart(6), 'wetWings=' + s.wings.wet);
}

await page.evaluate((f) => window.__island.goTo(f), FIX);
await settle(2); await step('after goTo');

const slider = await page.$('[data-ui="lift-slider"]');
const box = await slider.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.95, { steps: 8 });
await settle(12); await step('descending');
await page.mouse.up();
await settle(4);

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
await settle(3); await step('on the water');
await page.waitForFunction(() => window.__island.wading().afloat, null, { timeout: 60000, polling: 500 });
await step('afloat');

// Dive: hold the lever down again.
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.95, { steps: 8 });
for (let i = 0; i < 4; i++) { await settle(3); await step('diving ' + i); }
await page.mouse.up();
for (let i = 0; i < 4; i++) { await settle(3); await step('rising ' + i); }

console.log('\nstates seen:', [...seen].join(', '));
console.log('page errors:', errors.length ? errors : 'none');
console.log(bad.length ? 'DISAGREEMENTS:\n' + bad.join('\n')
  : 'the state agreed with the physics on every sample');
await browser.close();
