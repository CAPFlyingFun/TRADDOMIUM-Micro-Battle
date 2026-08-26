/**
 * shots:smooth — the same view of the island at each smoothing setting.
 *
 * The dial's sharp end now has the real 13.67 m grid in it instead of a
 * blurred 54.7 m one, so what it costs and what it buys are both worth
 * looking at rather than measuring. Against real hydrography, the blur
 * at 1 puts the ground 13.28 m out; whether 0 is TOO sharp to look at
 * is not something a number can answer.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoothShots.mjs        # writes ./shots-smooth/*.png
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = process.env.SHOTS_DIR ?? 'shots-smooth';
mkdirSync(OUT, { recursive: true });
const DIALS = (process.env.DIALS ?? '0,0.25,0.5,1').split(',').map(Number);
// THE VALLEYS, chosen by the hydrography rather than by eye: the three
// deepest cuts on a third-order-or-better river, which is Waimea and
// Nāpali country — 220 to 286 m of relief across 300 m. A dial that
// erases valleys has to be judged on valleys. Joshua's own two frames
// come last for continuity with what he has already looked at.
const VIEWS = [
  ['valley-a', '22.07637247 -159.63485973 420.88m 243° -12.0° ×1.00'],
  ['valley-b', '22.01160715 -159.58080857 323.86m 239° -12.0° ×1.00'],
  ['valley-c', '22.05505073 -159.63161276 378.72m 258° -12.0° ×1.00'],
  ['air', '21.96132176 -159.40953829 402.42m 237° -7.9° ×1.00'],
  ['low', '22.04110839 -159.37390526 86.88m 024° -7.9° ×1.00'],
];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
page.on('pageerror', (e) => console.log('PAGE THROW:', e.message));
await page.goto('http://localhost:4173/?scene=island', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
await page.waitForFunction(() => window.__island.simTime() > 0.5, null, { timeout: 240000 });

// The fine ground streams in behind the first frame; nothing below is
// worth looking at until it has landed, or every shot is the coarse
// island wearing a different amount of blur.
await page.waitForFunction(() => window.__island.hdTiles() > 0, null, { timeout: 240000 });
console.log('HD tiles resident:', await page.evaluate(() => window.__island.hdTiles()));

for (const [name, fix] of VIEWS) {
  const took = await page.evaluate((f) => window.__island.goTo(f), fix);
  if (!took) { console.log(`GOTO REFUSED: ${name}`); continue; }
  for (const dial of DIALS) {
    await page.evaluate((d) => window.__island.setSmoothing(d), dial);
    const t0 = await page.evaluate(() => window.__island.simTime());
    await page.waitForFunction((t) => window.__island.simTime() > t + 0.5, t0, { timeout: 120000 });
    await page.waitForTimeout(300);
    const tag = String(dial).replace('.', 'p');
    await page.screenshot({ path: `${OUT}/${name}-${tag}.png` });
    console.log(`shot ${name} at smoothing ${dial}`);
  }
}
await browser.close();
console.log('DONE');
