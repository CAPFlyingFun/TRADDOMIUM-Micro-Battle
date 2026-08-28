import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
const msgs = [];
page.on('console', (m) => { if (m.type() === 'error') msgs.push(m.text().slice(0, 400)); });
page.on('pageerror', (e) => msgs.push('PAGEERROR ' + e.message.slice(0, 300)));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto('http://localhost:4225/?scene=island', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
await page.waitForTimeout(6000);
console.log(msgs.length ? msgs.slice(0, 3).join('\n--\n') : 'no errors');
console.log('cells:', await page.evaluate(() => window.__island.cells?.() ?? '?'));
await browser.close();
