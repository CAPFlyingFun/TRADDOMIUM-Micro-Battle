/**
 * THE FLASH: does a browser-toolbar animation resize the game?
 *
 * iOS fires a burst of `scroll` events on `visualViewport` while the
 * toolbar slides, each reporting a different height. Written straight
 * through to `--app-height` they resize `#app` — canvas, HUD anchors
 * and all — several times over a third of a second, which reads as the
 * ground detail jumping and the HUD ducking out. The app box must hold
 * still through the burst and move exactly once, at the end.
 */
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args:['--use-gl=angle','--use-angle=swiftshader','--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: 932, height: 430 } });
await p.route('**://api.open-meteo.com/**', r => r.abort());
await p.goto('http://localhost:4173/?spawnRoll=0.25', { waitUntil:'domcontentloaded' });
await p.waitForSelector('[data-ui="main-menu"]', {timeout:60000});
await p.click('[data-ui="new-colony"]');
await p.waitForSelector('[data-ui="island-canvas"]', {timeout:60000});
const map = await p.evaluate(() => {
  const r = document.querySelector('[data-ui="island-canvas"]').getBoundingClientRect();
  return { left:r.left, top:r.top, size:r.width };
});
const r = await p.evaluate(() => window.__regions.find(x => x.id === 'lihue'));
await p.mouse.click(map.left + r.mapX*map.size, map.top + r.mapY*map.size);
await p.waitForSelector('[data-ui="spawn-here"]', {timeout:20000});
await p.click('[data-ui="spawn-here"]');
await p.waitForFunction(() => Boolean(window.__island), null, {timeout:120000});
await p.waitForFunction(() => window.__island.simTime() > 0.4, null, {timeout:240000});

const appH = () => p.evaluate(() => Math.round(document.getElementById('app').getBoundingClientRect().height));
console.log('settled app box:', await appH());

// A TOOLBAR ANIMATION, as iOS actually delivers it: a burst of scroll
// events on visualViewport, each reporting a different height, then a
// final value that holds.
const sizes = await p.evaluate(async () => {
  const vv = window.visualViewport;
  const real = vv.height;
  let fake = real;
  Object.defineProperty(vv, 'height', { configurable: true, get: () => fake });
  const seen = [];
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  for (const k of [1.04, 1.09, 1.14, 1.18, 1.18, 1.18, 1.18, 1.18, 1.18, 1.18]) {
    fake = real * k;
    vv.dispatchEvent(new Event('scroll'));
    await frame();
    seen.push(Math.round(document.getElementById('app').getBoundingClientRect().height));
  }
  return seen;
});
console.log('app box, frame by frame through the burst:', sizes.join(' '));
await p.waitForTimeout(600);
const ended = await appH();
console.log('after it settles:', ended);

// One move, and only after the reported height stopped changing.
const moves = sizes.filter((h, i) => i > 0 && h !== sizes[i - 1]).length;
if (moves > 1) {
  console.log(`probe:viewport FAILED — the app box resized ${moves} times mid-burst`);
  process.exitCode = 1;
} else if (ended === 430) {
  console.log('probe:viewport FAILED — the settled height was never applied');
  process.exitCode = 1;
} else {
  console.log('probe:viewport passed — held still through the burst, applied once at the end');
}
await b.close();
