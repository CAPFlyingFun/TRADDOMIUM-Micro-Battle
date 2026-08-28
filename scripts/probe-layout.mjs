/**
 * #1 ACCEPTANCE: do the HUD clusters hold still?
 *
 * Records the bounding box of every rail row, the VS line, the TGT
 * line and the hold pill through a long flight that crosses water,
 * descends, and flips hold modes. Anything that moves is reported.
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
await page.waitForTimeout(4000);
const boxes = () => page.evaluate(() => {
  const out = {};
  const rail = document.querySelector('[data-ui="flight-hud"]');
  if (!rail) return out;
  for (const d of rail.querySelectorAll('div')) {
    const label = d.children[0]?.textContent ?? '';
    const key = /^(MSL|AWL|LND|VS)$/.test(label) ? label
      : /^HOLD /.test(d.textContent ?? '') ? 'HOLD'
        : (d.textContent ?? '').includes('·') ? 'TGT' : null;
    if (!key) continue;
    const r = d.getBoundingClientRect();
    out[key] = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  }
  return out;
});
const seen = {};
const fixes = [
  '22.21588963 -159.44718333 1.65m 306.0° -13.6° ×1.00',  // over sand
  '22.21999268 -159.45432456 1.60m 342.0° -13.8° ×1.00',  // over water
  '22.21588963 -159.44718333 4.00m 306.0° -25.0° ×1.00',  // higher, descending
];
for (let round = 0; round < 3; round++) {
  await page.evaluate((f) => window.__island.goTo(f), fixes[round]);
  await page.waitForTimeout(1500);
  if (round === 1) {
    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('div'))
        .find((d) => /^HOLD (MSL|AWL|AGL)$/.test(d.textContent || ''));
      if (el) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
  }
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(250);
    const b = await boxes();
    for (const [k, v] of Object.entries(b)) {
      (seen[k] ??= new Set()).add(v.join(','));
    }
  }
}
let moved = 0;
for (const [k, set] of Object.entries(seen)) {
  const n = set.size;
  if (n > 1) moved++;
  console.log(`${k.padEnd(5)} ${n === 1 ? 'FIXED' : `MOVED (${n})`}  ${[...set].join('  |  ')}`);
}
console.log(moved === 0 ? 'ALL CLUSTERS FIXED' : `${moved} cluster(s) moved`);
await browser.close();
