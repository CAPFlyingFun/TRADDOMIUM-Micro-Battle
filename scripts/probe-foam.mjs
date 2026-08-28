/**
 * THE FOAM'S DISTANCE LOD, measured rather than admired.
 *
 * One camera per altitude, and the only thing that changes between the
 * pair of frames at each is whether the simplification is applied.
 * Two numbers come out of the water pixels:
 *
 *   fine  mean |Laplacian| of luminance — how much high-frequency
 *         structure is being drawn. This is the speckle, and it is the
 *         thing that must fall away with altitude.
 *   surf  mean luminance — how much white is on the water at all. This
 *         is the surf LINE, and it must NOT fall away, or the fix has
 *         deleted the shoreline instead of resolving it.
 */
import { chromium } from 'playwright';
import { readPng } from './readPng.mjs';

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 450 } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto('http://localhost:4225/?scene=island', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
await page.waitForTimeout(9000);

/** Water pixels only: bluer than they are red. Sand and sky are not. */
function measure({ data, width, height }) {
  const lum = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  // SPECKLE IS NOT AN EDGE. A one-pixel Laplacian counts both, so it
  // rose when smoothing the foam unmasked the smooth bathymetric
  // terracing underneath — the metric said worse while the picture said
  // better. Residual against a 5x5 mean separates them: fine speckle
  // survives that blur, a gradient does not.
  const blur = (x, y) => {
    let sum = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) sum += lum(((y + dy) * width + (x + dx)) * 4);
    }
    return sum / 25;
  };
  let fine = 0; let speck = 0; let bright = 0; let n = 0;
  for (let y = 3; y < height - 3; y++) {
    for (let x = 3; x < width - 3; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 2] <= data[i] + 12) continue;          // not water
      fine += Math.abs(4 * lum(i) - lum(i - 4) - lum(i + 4)
        - lum(i - width * 4) - lum(i + width * 4));
      speck += Math.abs(lum(i) - blur(x, y));
      bright += lum(i);
      n++;
    }
  }
  return n < 500 ? null : { fine: fine / n, speck: speck / n, surf: bright / n, px: n };
}

const still = async () => {
  let last = ''; let repeats = 0;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(800);
    const now = await page.evaluate(() => {
      const c = window.__island.cameraAt().map((v) => Math.round(v));
      return `${c.join(',')}|${window.__island.fix()}`;
    });
    repeats = now === last ? repeats + 1 : 0;
    if (repeats >= 3) return now;
    last = now;
  }
  return last;
};

const LAT = 22.20069511;
const LON = -159.50342929;
for (const agl of [2, 20, 80, 166]) {
  // MSL, NOT MSL-PLUS-170. The fix sits over water, where the ground is
  // sea level and a metre of altitude is a metre of MSL — the first cut
  // of this added 170 to every rung and measured four high-altitude
  // frames while calling one of them two metres.
  const msl = (agl + 4).toFixed(2);
  await page.evaluate((f) => window.__island.goTo(f),
    `${LAT.toFixed(8)} ${LON.toFixed(8)} ${msl}m 268.0° -33.1° ×1.00`);
  await page.waitForTimeout(14000);
  const pose = await still();
  const out = {};
  for (const lod of [0, 1]) {
    await page.evaluate((v) => window.__island.foamLod(v), lod);
    await page.waitForTimeout(1200);
    const path = `/tmp/foam-agl${agl}-lod${lod}.png`;
    await page.screenshot({ path, timeout: 120000 });
    out[lod] = measure(readPng(path));
  }
  if (!out[0] || !out[1]) { console.log(`${agl} m  no water in frame`); continue; }
  const drop = (1 - out[1].fine / out[0].fine) * 100;
  const kept = (out[1].surf / out[0].surf) * 100;
  const sd = (1 - out[1].speck / out[0].speck) * 100;
  console.log(`${String(agl).padStart(3)} m AGL  speckle ${out[0].speck.toFixed(2)} -> `
    + `${out[1].speck.toFixed(2)} (${sd >= 0 ? '-' : '+'}${Math.abs(sd).toFixed(0)}%)`
    + `   edges ${out[0].fine.toFixed(1)} -> ${out[1].fine.toFixed(1)}`
    + `   surf kept ${kept.toFixed(0)}%   pose ${pose.slice(0, 18)}`);
  void drop;
}
await browser.close();
