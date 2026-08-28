/** Does the hold ride the swell or ignore it? Measured, both modes. */
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
await page.evaluate((f) => window.__island.goTo(f), '22.22200000 -159.45500000 3.00m 200.0° -9.0° ×1.00');
await page.waitForTimeout(3000);
for (const mode of ['msl', 'floor']) {
  if (mode === 'floor') {
    await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('div'))
        .find((d) => /^HOLD (MSL|AWL|AGL)$/.test(d.textContent || ''));
      if (el) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    await page.waitForTimeout(1500);
  }
  const ys = [];
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    ys.push(await page.evaluate(() => window.__island.column().herY));
  }
  // De-trend: the interesting number is the WOBBLE, not the glide.
  const n = ys.length;
  const mean = ys.reduce((a, b) => a + b, 0) / n;
  const slope = ys.reduce((a, y, i) => a + (i - (n - 1) / 2) * (y - mean), 0)
    / ys.reduce((a, _, i) => a + (i - (n - 1) / 2) ** 2, 0);
  const resid = ys.map((y, i) => y - (mean + slope * (i - (n - 1) / 2)));
  const rms = Math.sqrt(resid.reduce((a, r) => a + r * r, 0) / n);
  console.log(`${mode.padEnd(6)} wobble RMS ${rms.toFixed(2)} units`
    + `  span ${(Math.max(...resid) - Math.min(...resid)).toFixed(1)}`);
}
await browser.close();
