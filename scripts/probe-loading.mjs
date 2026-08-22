/**
 * THE WAY IN: does the loading screen tell the truth, and does it hold
 * the world back until there is a world to show?
 *
 * Runs the spawn on a throttled connection so the bar has a real wait
 * to describe, samples it while it runs, and checks the two things that
 * matter: the readouts move and stay honest, and no frame of the
 * half-built world is ever visible.
 */
import { chromium } from 'playwright';
const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());

// A slow phone connection, so the screen has a job to do. Throttled
// through the DevTools protocol rather than by delaying whole
// responses: the point is to watch the byte counter TICK, and a route
// handler that sleeps and then hands over the entire file at once
// would show it jump from zero to done and prove nothing.
const kbps = Number(process.env.KBPS ?? 900);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 120,
  downloadThroughput: (kbps * 1024) / 8,
  uploadThroughput: (kbps * 1024) / 8,
});

await page.goto(`${url}?spawnRoll=0.25`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-ui="main-menu"]', { timeout: 60000 });
await page.click('[data-ui="new-colony"]');
await page.waitForSelector('[data-ui="island-canvas"]', { timeout: 60000 });
const map = await page.evaluate(() => {
  const b = document.querySelector('[data-ui="island-canvas"]').getBoundingClientRect();
  return { left: b.left, top: b.top, size: b.width };
});
const r = await page.evaluate(() => window.__regions.find((x) => x.id === 'lihue'));
await page.mouse.click(map.left + r.mapX * map.size, map.top + r.mapY * map.size);
await page.waitForSelector('[data-ui="spawn-here"]', { timeout: 20000 });

const read = () => page.evaluate(() => {
  const veil = document.querySelector('[data-ui="loading"]');
  if (!veil) return null;
  const fill = veil.querySelector('div > div');
  const line = veil.lastElementChild;
  return {
    opacity: getComputedStyle(veil).opacity,
    width: veil.querySelectorAll('div')[3]?.style.width ?? '',
    text: [...line.children].map((c) => c.textContent).join(' | '),
  };
});

await page.click('[data-ui="spawn-here"]');

// THE VEIL MUST BE UP BEFORE THE SCENE DRAWS ANYTHING. The scene starts
// rendering on its first frame, and that frame has no ground textures
// in it — black underfoot, grey hills. If the screen is even one frame
// late, that is the frame the player sees.
const covered = await page.evaluate(
  () => Boolean(document.querySelector('[data-ui="loading"]')));
if (!covered) {
  console.log('probe:loading FAILED — the world was uncovered the moment it spawned');
  process.exitCode = 1;
}

const seen = [];
let shots = 0;
for (let i = 0; i < 90; i++) {
  const state = await read();
  if (state === null) break;
  const line = `${state.width.padStart(7)}  ${state.text}`;
  if (seen[seen.length - 1] !== line) seen.push(line);
  if (shots === 0 && parseFloat(state.width) > 25) {
    await page.screenshot({ path: 'loading-mid.png', timeout: 240000 });
    shots = 1;
  }
  await page.waitForTimeout(250);
}

console.log('what the screen said, as it changed:');
for (const line of seen.slice(0, 40)) console.log('  ' + line);

// AN ESTIMATE MAY NOT GET WORSE THE LONGER YOU WATCH IT. The first
// version of this climbed 12s -> 19s across a download that was running
// perfectly, because it averaged in every frame where no bytes landed.
const etas = seen
  .map((line) => /(\d+)s left/.exec(line))
  .filter(Boolean)
  .map((m) => Number(m[1]));
const worst = etas.reduce(
  (bad, eta, i) => (i === 0 ? 0 : Math.max(bad, eta - etas[i - 1])), 0);
console.log(`\nETA ran ${etas[0] ?? '—'}s -> ${etas[etas.length - 1] ?? '—'}s,`
  + ` worst upward step ${worst}s`);
if (etas.length < 4) {
  console.log('probe:loading FAILED — the screen never offered an estimate');
  process.exitCode = 1;
} else if (worst > 4) {
  console.log(`probe:loading FAILED — the estimate climbed by ${worst}s`);
  process.exitCode = 1;
}

// And the byte counter has to actually count.
const bytes = seen
  .map((line) => /\|\s*([\d.]+) (KB|MB) \//.exec(line))
  .filter(Boolean)
  .map((m) => Number(m[1]) * (m[2] === 'MB' ? 1024 : 1));
if (bytes.length < 4 || bytes[bytes.length - 1] <= bytes[0]) {
  console.log('probe:loading FAILED — the byte readout never moved');
  process.exitCode = 1;
}

await page.waitForFunction(() => !document.querySelector('[data-ui="loading"]'), null, { timeout: 240000 });
await page.waitForFunction(() => window.__island?.simTime?.() > 0.4, null, { timeout: 240000 });
await page.screenshot({ path: 'loading-done.png', timeout: 240000 });
if (process.exitCode) console.log('\nveil lifted, world up (with failures above)');
else console.log('\nprobe:loading passed — covered the whole way, honest numbers, veil lifted');
await browser.close();
