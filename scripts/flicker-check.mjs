/** Watch the approach rail for blinking while she cruises level. */
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
  ?? '22.21773624 -159.45097615 7.11m 040.0° -15.0° ×1.00');
await page.waitForTimeout(4000);
const seen = [];
for (let i = 0; i < 50; i++) {
  await page.waitForTimeout(500);
  seen.push(await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('div'));
    const lnd = rows.find((d) => d.children.length === 2
      && d.children[0].textContent === 'LND');
    return lnd ? lnd.style.opacity || '1' : '?';
  }));
}
let flips = 0;
for (let i = 1; i < seen.length; i++) if (seen[i] !== seen[i - 1]) flips++;
console.log('samples:', seen.join(''));
console.log('transitions over 25 s:', flips);
await browser.close();
