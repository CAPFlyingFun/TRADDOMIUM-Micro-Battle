/**
 * STAND WHERE THE SCREENSHOT WAS TAKEN.
 *
 * The position fix under the compass exists so a picture from Joshua's
 * phone can become a frame here (ui/fix.ts). This is the other end of
 * that: hand it the fixes off his shots and render the same views, so
 * a change meant to fix what a screenshot showed can be checked
 * against that screenshot rather than against a description of it.
 *
 *   PROBE_FIXES="<fix>|<fix>" npm run probe:revisit
 */
import { chromium } from 'playwright';
import { readPng } from './readPng.mjs';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';

/** The four Joshua sent with "looking like someone laid blue ribbon". */
const SHOTS = (process.env.PROBE_FIXES ?? [
  '22.03881701 -159.37112123 193.50m 105.2° -11.1°',
  '22.04088243 -159.36939923 221.86m 213.2° -11.1°',
  '22.04144962 -159.36895559 226.68m 217.9° -11.1°',
  '22.04197545 -159.36852863 231.06m 218.5° -11.1°',
].join('|')).split('|');

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
const shouts = [];
page.on('console', (m) => { if (m.type() === 'error') shouts.push(m.text()); });
page.on('pageerror', (e) => shouts.push(e.message.split('\n')[0]));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());

await page.goto(`${url}?scene=island`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });

/** Wait on SIMULATED time. Under SwiftShader wall time means nothing. */
const settle = async (seconds) => {
  const from = await page.evaluate(() => window.__island.simTime());
  await page.waitForFunction(
    (mark) => window.__island.simTime() > mark,
    from + seconds, { timeout: 300000, polling: 250 },
  );
};

await settle(1.0);

for (let i = 0; i < SHOTS.length; i++) {
  const went = await page.evaluate((fix) => window.__island.goTo(fix), SHOTS[i]);
  if (!went) { console.log(`shot ${i + 1}: REFUSED "${SHOTS[i]}"`); continue; }
  await settle(3);

  // CONVERGE ON THE PITCH, because one call does not land it.
  //
  // `goTo` aims the camera and the next frames move it again — the rig
  // keeps itself above the ground, the flight model settles toward its
  // held altitude, and the offset smooths. Measured: four frames asked
  // for -11.1 degrees and came back at -6.7, and one asked for -8.9 and
  // came back at -87.4 with the camera shoved through a hillside. A
  // frame that is not the frame the fix describes cannot be compared
  // with the screenshot it came from, which is the entire point of this
  // probe. So ask again with the residual folded in, and stop when it
  // is close or when it stops improving.
  const wanted = Number(SHOTS[i].split(/\s+/)[4]?.replace(/[^\d.-]/g, '') ?? NaN);
  let drift = NaN;
  if (Number.isFinite(wanted)) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const now = await page.evaluate(() => window.__island.fix());
      const got = Number(now.split(/\s+/)[4]?.replace(/[^\d.-]/g, '') ?? NaN);
      drift = got - wanted;
      if (!Number.isFinite(drift) || Math.abs(drift) < 0.4) break;
      const corrected = SHOTS[i].split(/\s+/);
      corrected[4] = `${(Number(corrected[4].replace(/[^\d.-]/g, '')) - drift).toFixed(1)}°`;
      await page.evaluate((fix) => window.__island.goTo(fix), corrected.join(' '));
      await settle(2);
    }
  }
  const file = `revisit-${i + 1}.png`;
  await page.screenshot({ path: file });

  // What is actually on screen, measured rather than eyeballed: how
  // much of the frame is water-coloured, and how much is the damp
  // corridor that is supposed to sit around it.
  const { width, height, data: pixels } = readPng(file);
  let water = 0;
  let ground = 0;
  for (let p = 0; p < width * height; p++) {
    const r = pixels[p * 4];
    const g = pixels[p * 4 + 1];
    const b = pixels[p * 4 + 2];
    if (b > r + 18 && b > 60 && g < b + 10) water++;
    else if (r > g && g > b && r > 60) ground++;
  }
  const seen = await page.evaluate(() => ({
    fix: window.__island.fix(),
    msl: window.__island.where()[1],
  }));
  console.log(
    `shot ${i + 1}: water ${(100 * water / (width * height)).toFixed(2)}%`
    + `  ground ${(100 * ground / (width * height)).toFixed(1)}%`
    ,
  );
  console.log(`         asked ${SHOTS[i]}`);
  console.log(`         got   ${seen.fix}`);
  if (Number.isFinite(drift)) {
    console.log(`         pitch drift after converging: ${drift.toFixed(2)}°`);
  }
}

const broken = shouts.filter((s) => /shader|glsl|program|compile/i.test(s));
if (broken.length) console.log(`SHADER TROUBLE: ${broken[0].slice(0, 300)}`);
await browser.close();
