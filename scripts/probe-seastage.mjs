/**
 * STAGE C ON THE REAL BUILD — cost, and the three places the generated
 * sea could look wrong.
 *
 * The wave-rate numbers are measured at 60 Hz in
 * scripts/measure-stagec.ts, because this renderer manages about a
 * frame and a half a second. What CAN honestly be measured here is
 * what the DEVICE pays and what the frame LOOKS like:
 *
 *   COST  — the same page, the same viewpoint, the same second,
 *           toggled between the shipped two-wave sea and the generated
 *           five-component one with `__island.waves(...)`. Round-robin,
 *           so scene settling and thermal drift land on both.
 *   LOOK  — screenshots at the surf, and out at the rim, for the
 *           60-78 m flattening and the hand-off onto the flat far
 *           sheet.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'shots/stagec';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto('http://localhost:4225/?scene=island', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
await page.waitForTimeout(9000);

const LAT = 22.20069511;
const LON = -159.506429;

/** Frame times, hands off, from whatever sea is installed. */
async function frames(n) {
  return page.evaluate((count) => new Promise((done) => {
    const dts = [];
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      dts.push(now - last);
      last = now;
      if (dts.length <= count) requestAnimationFrame(tick);
      else done(dts.slice(1));
    };
    requestAnimationFrame(tick);
  }), n);
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

async function shot(name) {
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

// ---- the surf, where shoaling and breaking are visible -------------
await page.evaluate((f) => window.__island.goTo(f),
  `${LAT.toFixed(8)} ${LON.toFixed(8)} 0.05m 143.0° -21.8° ×1.00`);
await page.waitForTimeout(14000);

console.log('\nSEA REPORT — shipped');
console.log(JSON.stringify(await page.evaluate(() => window.__island.waves('fixed')), null, 1));
await shot('surf-fixed');
console.log('\nSEA REPORT — procedural');
console.log(JSON.stringify(await page.evaluate(() => window.__island.waves('procedural')), null, 1));
await shot('surf-procedural');

// ---- cost, round-robin so drift lands on both ---------------------
const fixedDts = [];
const procDts = [];
for (let round = 0; round < 4; round++) {
  await page.evaluate(() => window.__island.waves('fixed'));
  await page.waitForTimeout(2500);
  fixedDts.push(...await frames(12));
  await page.evaluate(() => window.__island.waves('procedural'));
  await page.waitForTimeout(2500);
  procDts.push(...await frames(12));
}
console.log('\nFRAME TIME (SwiftShader, 932x430, surf viewpoint)');
console.log(`  shipped 2-wave : median ${median(fixedDts).toFixed(0)} ms`
  + `  over ${fixedDts.length} frames`);
console.log(`  procedural x5  : median ${median(procDts).toFixed(0)} ms`
  + `  over ${procDts.length} frames`);
console.log(`  ratio ${(median(procDts) / median(fixedDts)).toFixed(3)}x`);
console.log('  (software rasteriser — read the RATIO, not the absolute'
  + ' milliseconds, and read it as an upper bound: a real GPU runs the'
  + ' vertex shader in parallel and this one does not.)');

// ---- the rim, from above, where the flattening would show ---------
for (const [name, which] of [['rim-fixed', 'fixed'], ['rim-procedural', 'procedural']]) {
  await page.evaluate((w) => window.__island.waves(w), which);
  await page.evaluate((f) => window.__island.goTo(f),
    `${LAT.toFixed(8)} ${LON.toFixed(8)} 12.00m 261.0° -18.0° ×1.00`);
  await page.waitForTimeout(9000);
  await shot(name);
}

console.log(`\nshots in ${OUT}/`);
console.log('pageerrors:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
