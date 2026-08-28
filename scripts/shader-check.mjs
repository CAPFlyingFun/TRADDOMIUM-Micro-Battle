import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
const msgs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') msgs.push(m.text().slice(0, 600)); });
page.on('pageerror', (e) => msgs.push('PAGEERROR ' + e.message.slice(0, 400)));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto('http://localhost:4225/?scene=island', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
await page.evaluate((f) => window.__island.goTo(f), '22.21761654 -159.44999895 4.00m 191.0° -14.0° ×1.00');
await page.waitForTimeout(9000);
console.log(msgs.length ? msgs.join('\n---\n') : 'no console errors');
await browser.close();
