/**
 * DETAIL RADIUS, MEASURED ON LAND. Plants marker posts at 2.5, 5, 10,
 * 15 and 20 m due north of the queen, then shoots the same camera at
 * each dial setting so the region's edge can be read against them.
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
const FIX = process.env.PROBE_FIX ?? '21.86200000 -159.47834411 9.30m 000.0° -26.0° ×1.00';
for (const dial of (process.env.DIALS ?? '0.25,1,2').split(',')) {
  await page.evaluate((d) => window.__island.setSetting('detailRange', Number(d)), dial);
  await page.evaluate((f) => window.__island.goTo(f), FIX);
  await page.waitForTimeout(2500);
  // Mark true ground distances due north of her, so the region's edge
  // is read against the WORLD and not against a guess.
  await page.evaluate(() => {
    document.querySelectorAll('[data-probe="mark"]').forEach((n) => n.remove());
    for (const m of [2.5, 5, 10, 15, 20]) {
      const at = window.__island.project(0, -m * 100);
      if (!at) continue;
      const tag = document.createElement('div');
      tag.dataset.probe = 'mark';
      tag.textContent = `${m}m`;
      Object.assign(tag.style, {
        position: 'fixed', left: `${at.x}px`, top: `${at.y}px`, zIndex: '99',
        transform: 'translate(-50%, -50%)', color: '#ff2d55',
        font: '700 13px ui-monospace, monospace', pointerEvents: 'none',
        textShadow: '0 0 4px #000, 0 0 2px #000',
      });
      document.body.appendChild(tag);
    }
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `/tmp/detail-${dial}.png` });
  console.log('dial', dial, JSON.stringify(await page.evaluate(() => window.__island.column())));
}
await browser.close();
