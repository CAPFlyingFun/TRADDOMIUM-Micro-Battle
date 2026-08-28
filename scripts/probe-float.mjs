/**
 * TEST A: is she riding the waves, or riding ONE wave?
 *
 * She floats at a fixed world position with no input. The travelling
 * swell must pass under her, so her height should oscillate at the
 * wave period. If it sits still, she is phase-locked to a crest.
 */
import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 450 } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto('http://localhost:4225/?scene=island', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
await page.waitForTimeout(4000);
await page.evaluate((f) => window.__island.goTo(f), '22.21999268 -159.45432456 1.20m 342.0° -13.8° ×1.00');
await page.waitForTimeout(4000);
// Put her down ON the water and let her float.
await page.evaluate(() => { const w = window.__island.where(); window.__island.putAt(w[0], w[2], 0); });
await page.waitForFunction(() => window.__island.wading().afloat, null, { timeout: 60000, polling: 400 });
await page.waitForTimeout(1500);
const rows = [];
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(200);
  rows.push(await page.evaluate(() => {
    const c = window.__island.column();
    const w = window.__island.where();
    return { t: window.__island.elapsed?.() ?? 0, y: c.herY, cam: c.camY,
      surf: c.ground + c.depth, wx: w[0], wz: w[2], afloat: c.afloat, dive: c.dive };
  }));
}
const span = (v) => (Math.max(...v) - Math.min(...v)).toFixed(1);
const ys = rows.map((r) => r.y);
const ss = rows.map((r) => r.surf);
const cs = rows.map((r) => r.cam);
console.log(`her Y span   ${span(ys)}   surface span ${span(ss)}   camera span ${span(cs)}`);
console.log(`drift        dx ${(rows.at(-1).wx - rows[0].wx).toFixed(1)}  dz ${(rows.at(-1).wz - rows[0].wz).toFixed(1)}`);
console.log(`afloat ${rows.at(-1).afloat}  dive ${rows.at(-1).dive.toFixed(2)}`);
console.log('depth below surface (surf - y):',
  rows.slice(0, 12).map((r) => (r.surf - r.y).toFixed(1)).join(' '));
console.log('surface trace:', ss.slice(0, 30).map((v) => v.toFixed(0)).join(' '));
console.log('her Y trace  :', ys.slice(0, 30).map((v) => v.toFixed(0)).join(' '));
await browser.close();
