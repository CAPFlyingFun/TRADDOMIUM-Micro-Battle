/**
 * ARE THE LAKES THERE, AND ARE THEY IN THEIR OWN BASINS?
 *
 * The carve happens inside `terrainHeight`, so a mistake in it does not
 * throw — it produces an island that is subtly the wrong shape, with a
 * lake surface drawn inside a hill. The unit tests prove the arithmetic;
 * this proves the arithmetic reached the mesh, the ant and the camera,
 * which are three different consumers of the same function and the
 * whole reason the carve is a function at all.
 *
 * Waita Reservoir on the south coast: 1.2 km across, the biggest on
 * Kauaʻi, and big enough that a queen standing at its edge sees water
 * rather than a puddle.
 *
 *   npm run probe:lakes      writes lake-shore.png
 */
import { chromium } from 'playwright';
import { readPng } from './readPng.mjs';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';

/** Waita Reservoir: centre, and a spot on its south bank. */
const WAITA = { wx: 922_859, wz: 1_517_838, level: 7_460 };
/** Its north bank, a few metres back from the water. */
const BANK = { wx: 922_859, wz: 1_451_000 };

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
const shouts = [];
page.on('console', (m) => { if (m.type() === 'error') shouts.push(m.text()); });
page.on('pageerror', (e) => shouts.push(e.message.split('\n')[0]));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());

const fail = (why) => { console.log(`probe:lakes FAILED — ${why}`); process.exitCode = 1; };

await page.goto(`${url}?scene=island`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 180000 });
await page.waitForFunction(() => window.__island.simTime() > 1.2, null, { timeout: 300000 });

const broken = shouts.filter((s) => /shader|glsl|program|compile|attribute/i.test(s));
if (broken.length) fail(`the lake shader did not compile:\n    ${broken[0].slice(0, 400)}`);

/**
 * STAND HER IN IT. The camera's floor clamp, the ant's footing and the
 * terrain mesh all read `terrainHeight`, so if the carve reached the
 * function it reached all three — and the ground under her at the
 * middle of a reservoir must be BELOW its waterline.
 */
await page.evaluate((at) => window.__island.putAt(at.wx, at.wz, 0), WAITA);
await page.waitForFunction(
  (was) => window.__island.simTime() > was + 0.5,
  await page.evaluate(() => window.__island.simTime()), { timeout: 300000 },
);
const middle = await page.evaluate((at) => ({
  ground: window.__island.groundUnderfoot(),
  surface: window.__island.waterAt(at.wx, at.wz),
  lakes: window.__island.lakesDrawn(),
}), WAITA);

/**
 * BOTH IN THE DRAWN FRAME. `groundHeight` returns `relief x height` and
 * so does the lake mesh, so comparing either against the raw waterline
 * out of the hydrography is comparing two different spaces — which is
 * how this probe first reported the carve thirty-four metres wrong when
 * it was off by exactly the dial's 1.5.
 */
console.log(`Waita Reservoir, waterline ${(WAITA.level / 100).toFixed(1)} m raw`);
if (middle.surface === null) fail('the centre of Waita Reservoir is not in a lake');
else {
  const deep = (middle.surface - middle.ground) / 100;
  console.log(`  surface ${(middle.surface / 100).toFixed(2)} m, `
    + `bed ${(middle.ground / 100).toFixed(2)} m, depth ${deep.toFixed(2)} m`);
  if (deep <= 0) fail(`the bed is at or above the surface (${deep.toFixed(2)} m)`);
  if (deep > 6) fail(`${deep.toFixed(1)} m of water — the cut is far too deep`);
}
console.log(`  lake surfaces drawn nearby: ${middle.lakes}`);
if (middle.lakes < 1) fail('no lake surface was built for the biggest lake on the island');

/** And on the bank, looking across it. */
await page.evaluate((at) => window.__island.putAt(at.wx, at.wz, Math.PI), BANK);
await page.waitForFunction(
  (was) => window.__island.simTime() > was + 0.6,
  await page.evaluate(() => window.__island.simTime()), { timeout: 300000 },
);
await page.screenshot({ path: 'lake-shore.png' });
const { width, height, data } = readPng('lake-shore.png');
let teal = 0;
let lit = 0;
for (let i = 0; i < data.length; i += 4) {
  const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
  // Lake water is blue-green: blue over red, green over red too.
  if (b > r + 10 && g > r + 4 && b > 35) teal++;
  if (r + g + b > 60) lit++;
}
const total = width * height;
console.log(`  lake-shore.png  water ${(100 * teal / total).toFixed(1)}%, `
  + `lit ${(100 * lit / total).toFixed(0)}%`);
if (lit < total * 0.5) fail('the frame is mostly black — nothing rendered');
if (teal < total * 0.02) fail('no lake water visible from its own bank');

if (!process.exitCode) console.log('\nprobe:lakes passed');
await browser.close();
