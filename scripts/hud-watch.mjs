/**
 * WATCH THE WHOLE HUD LAYER, not one row. Records the computed style
 * of the flight HUD root every 250 ms while she stays airborne, and
 * reports every distinct state it passes through.
 */
import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 500 } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto('http://localhost:4225/?scene=island', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
await page.waitForTimeout(3000);
await page.evaluate((f) => window.__island.goTo(f), process.env.PROBE_FIX
  ?? '22.21588963 -159.44718333 1.65m 306.0° -13.6° ×1.00');
await page.waitForTimeout(2000);
const states = new Map();
const line = [];
let aloftLost = 0;
for (let i = 0; i < 240; i++) {
  await page.waitForTimeout(250);
  const snap = await page.evaluate(() => {
    const all = document.querySelectorAll('[data-ui="flight-hud"]');
    const el = all[all.length - 1];
    if (!el) return { state: 'MISSING', n: 0 };
    const cs = getComputedStyle(el);
    return {
      n: all.length,
      opacity: cs.opacity,
      state: [cs.opacity, cs.filter, cs.display, cs.visibility].join(' | '),
      aloft: window.__island.airborne(),
      wading: window.__island.wading(),
    };
  });
  if (i < 60 || snap.opacity !== '1') {
    line.push(`${i}:${snap.opacity}${snap.aloft ? 'A' : '-'}${snap.wading.afloat ? 'F' : ''}`);
  }
  if (!snap.aloft) aloftLost++;
  states.set(snap.state, (states.get(snap.state) ?? 0) + 1);
}
console.log('roots:', await page.evaluate(() => document.querySelectorAll('[data-ui="flight-hud"]').length));
console.log('timeline:', line.join(' '));
console.log(`airborne-lost samples: ${aloftLost} / 240`);
console.log(`distinct root states: ${states.size}`);
for (const [k, n] of states) console.log(`  ${n.toString().padStart(3)}x  ${k}`);
await browser.close();
