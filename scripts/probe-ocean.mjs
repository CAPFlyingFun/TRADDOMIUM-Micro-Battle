/**
 * DOES THE SEA COMPILE, AND IS IT A SEA?
 *
 * A shader injected through `onBeforeCompile` that fails to build does
 * not throw. three logs it and carries on, so the symptom of a broken
 * ocean is an ocean that looks exactly like the flat plate it replaced
 * — which is why this reads the WebGL log before it reads anything
 * else, and why the two checks after it measure the water rather than
 * admiring it.
 *
 * IT ALSO CHECKS THE ONE THING UNIT TESTS CANNOT: that the swell the
 * CPU answers with is the swell the page is running. The height at a
 * world position is read out of the live scene through `seaAt`, which
 * evaluates the same function the vertex shader was generated from.
 *
 * READ THE PNG, NOT THE CANVAS. Drawing a WebGL canvas into a 2D one
 * after the frame has been presented gives a blank image — the drawing
 * buffer is gone unless `preserveDrawingBuffer` is on, which costs
 * every frame for the sake of a probe. Playwright's own screenshot
 * composites properly, so the pixels are measured from the file. (The
 * first version of this probe reported a black screen and a working
 * scene at the same time.)
 *
 *   npm run probe:ocean      writes ocean-shore.png and ocean-bluff.png
 */
import { chromium } from 'playwright';
import { readPng } from './readPng.mjs';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';

/**
 * Two south-coast vantage points, found by scanning the height grid for
 * land close to open sea. Hard-coded because a probe that hunts for the
 * shore is a probe that can fail for two different reasons.
 *
 * BOTH ARE WELL ABOVE THE WATERLINE, and the first attempt was not.
 * A beach ten centimetres above sea level is INSIDE a swell whose
 * crests reach fifty-six, so the camera — four centimetres above a
 * queen two centimetres long — was under the surface looking up at the
 * turquoise underside of the sea. Correct behaviour, useless picture.
 * Three and a half metres is comfortably dry; twenty-five looks down
 * the coast at the reef.
 */
const SHORE = { wx: 1_017_188, wz: 2_078_125 };   // 3.5 m, one cell from the sea
const BLUFF = { wx: 1_028_125, wz: 2_028_906 };   // 26.8 m, above the reef

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });

const shouts = [];
page.on('console', (m) => { if (m.type() === 'error') shouts.push(m.text()); });
page.on('pageerror', (e) => shouts.push(e.message.split('\n')[0]));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());

const fail = (why) => { console.log(`probe:ocean FAILED — ${why}`); process.exitCode = 1; };

await page.goto(`${url}?scene=island`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 180000 });
await page.waitForFunction(() => window.__island.simTime() > 1.2, null, { timeout: 300000 });

const broken = shouts.filter((s) => /shader|glsl|program|compile|uniform/i.test(s));
if (broken.length) fail(`the shader did not compile:\n    ${broken[0].slice(0, 500)}`);

/** THE SWELL, read out of the running page. */
const swell = await page.evaluate(() => {
  const t = window.__island.simTime();
  const read = (x, z) => window.__island.seaAt(x, z);
  return {
    t,
    here: read(1_011_719, 2_093_594),
    far: read(-2_100_000, 800_000),
    centre: read(0, 0),
  };
});
const heights = [swell.here, swell.far, swell.centre];
if (heights.some((h) => !Number.isFinite(h))) fail(`the sea reads ${heights}`);
if (heights.every((h) => Math.abs(h) < 0.5)) fail('the sea is flat everywhere');
console.log(`sea height at t=${swell.t.toFixed(1)}s: `
  + heights.map((h) => `${h.toFixed(1)}`).join(', ') + ' cm');

/**
 * IT HAS TO MOVE. A frozen swell is a very convincing sheet of ice.
 *
 * Several places, not one: a single sample can sit on a crest or a
 * trough where the surface is momentarily stationary, and then the
 * check passes or fails on where it happened to look. (It did.)
 */
const WATCH = [[0, 0], [1_011_719, 2_093_594], [-900_000, 200_000], [340_000, -1_200_000]];
const readAll = () => page.evaluate(
  (spots) => spots.map(([x, z]) => window.__island.seaAt(x, z)), WATCH,
);
const before = await readAll();
await page.waitForFunction(
  (was) => window.__island.simTime() > was + 0.8,
  swell.t, { timeout: 300000 },
);
const after = await readAll();
const moved = before.map((h, i) => Math.abs(after[i] - h));
console.log('  a second later, four places moved by '
  + `${moved.map((m) => m.toFixed(1)).join(', ')} cm`);
if (Math.max(...moved) < 1) fail('the swell is not running');

/** And is there water on the screen, of a water colour? */
async function shoot(at, name, heading) {
  await page.evaluate(
    ({ wx, wz, h }) => window.__island.putAt(wx, wz, h), { ...at, h: heading },
  );
  await page.waitForFunction(
    (was) => window.__island.simTime() > was + 0.5,
    await page.evaluate(() => window.__island.simTime()), { timeout: 300000 },
  );
  await page.screenshot({ path: name });
  const { width, height, data: pixels } = readPng(name);
  let blue = 0;
  let lit = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
    if (b > r + 14 && b > 45) blue++;
    if (r + g + b > 60) lit++;
  }
  const total = width * height;
  console.log(`  ${name}  blue ${(100 * blue / total).toFixed(1)}%, `
    + `lit ${(100 * lit / total).toFixed(0)}%`);
  if (lit < total * 0.5) fail(`${name} is mostly black — nothing rendered`);
  return blue / total;
}

// LOOKING OUT TO SEA, which on this coast is +z: travel in this world
// is (sin, cos) of the heading, so heading 0 faces +z and the chase
// camera behind her looks the same way. Facing her inland instead is
// how this probe first reported an ocean that was not there.
const fromBeach = await shoot(SHORE, 'ocean-shore.png', 0);
const fromBluff = await shoot(BLUFF, 'ocean-bluff.png', 0);
// A modest bar on purpose. Her eye is four centimetres up, so from a
// beach the sea is a band above the sand rather than half the frame.
if (fromBeach < 0.02) fail('no sea visible from a beach');
if (fromBluff < 0.05) fail('no sea visible from a bluff above the reef');

if (!process.exitCode) console.log('\nprobe:ocean passed');
await browser.close();
