/**
 * THE SKY, PHOTOGRAPHED: does Kauaʻi's weather actually reach the frame?
 *
 * Phase 5 makes the `weather` layer real — an HDRI dome, the sun, the fog
 * and the rain, driven by the island's real weather with a seeded model
 * behind it. The HUD says what the sky is doing; this probe checks that
 * the PICTURE agrees. It stands the camera at Joshua's own west-coast
 * spot, holds the sky and the clock through the address bar, and reads
 * the frame back as numbers: the mean luminance and the mean colour of
 * the top quarter of the view, which is sky. Five conditions, and what
 * a photograph of a sky can actually promise is the assertion: night is
 * darkest of all; rain is darker than clear and darker than cloud; the
 * five looks are five DIFFERENT looks; and dusk is WARMER than noon
 * while noon is BLUE. Not "clear noon is brightest": the first cut said
 * so and the pictures said otherwise — a clear blue zenith photographs
 * darker than a bank of white cloud, and this dusk image is bright at
 * the horizon, which is what a dusk is. A dome that ignored the weather,
 * a sun that ignored the clock, a fog that ignored the rain: each of
 * them flattens one of those differences, and the probe fails on it.
 *
 * WHAT IT EXPECTS OF THE SCENE (the contract, so a missing half fails by
 * name rather than by timeout):
 *
 *   - `?sky=clear|cloudy|rain` holds the SIMULATED weather at that sky,
 *     and `?hour=0..24` holds the island's clock at that HST hour, both
 *     read in `app/registerScenes.ts` the way `?tier=` is. Overrides,
 *     never settings: nothing is stored.
 *   - The perf HUD prints three lines, `data-field="weather-sky"` reading
 *     `sky <word> <cloud>% · <live|cached|sim>` and
 *     `data-field="weather-clock"` reading
 *     `rain <mm/h> mm/h · <HH:MM> · sun <deg>°`. A held sky reads `sim`
 *     — the honesty rule — and the probe fails on `live` under `?sky=`.
 *   - The LAYERS column has a `data-action="layer:weather"` checkbox that
 *     is built and on when the world opens; switching it off stops the
 *     DRAWING and not the model, so the sky line keeps answering while
 *     the frame changes.
 *
 * THE LUMINANCE IS READ OFF THE SCREENSHOT, not the WebGL canvas. The
 * renderer may not keep its drawing buffer, and `toDataURL` on a canvas
 * that does not is a black square; Playwright's screenshot is the
 * composited page and carries the frame regardless — `probe-ocean` and
 * `probe-terrain` read theirs the same way, through the shared
 * `probePng.mjs`. The stat sheet and PAUSE sit in the top quarter too,
 * so their boxes are measured on the page and left out of the sample.
 *
 * THE SUN'S HEIGHT AT A GIVEN HOUR DEPENDS ON THE SEASON — `?hour=` holds
 * today's date at that hour, deliberately, so a run in December shows
 * December's noon. The bars on the sun's elevation are therefore wide
 * (noon over 35°, dusk under 15°, night under −10°) and the bars on
 * luminance are RELATIVE, except the one absolute that means "night":
 * under 0.15.
 *
 * SWIFTSHADER, NOT A PHONE: a frame or two a second, so the run is
 * minutes long and the frame times mean nothing. The order of the
 * luminances is what is measured, not the cost.
 *
 * Usage:
 *
 *   npm run build
 *   npm run probe:sky
 *
 * Shots land in `shots/sky-<condition>.png` and `shots/sky-off.png`.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { stubWeather } from './probeWeather.mjs';
import { preview } from 'vite';
import { readPng } from './probePng.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const SHOTS = path.join(ROOT, 'shots');

const VIEWPORT = { width: 932, height: 430 };
const CHROMIUM_ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];
const TIMEOUT = { menu: 60_000, world: 300_000 };

/** The same three literals `probe-shot.mjs` carries, pinned by tests/probeShotConstants.test.ts. */
const SAVE_KEY = 'traddomium.v1.solo-save';
const SAVE_VERSION = 2;
const MAP_ID = 'perf-empty';

/** Frames to let the frame settle after arriving, and the most to wait for the held sky to reach the HUD. */
const SETTLE_FRAMES = 30;
const SKY_WAIT_FRAMES = 240;
/**
 * How far above the TRUE ground the camera stands, and how far off that
 * it may be before the pose is corrected and the arrival repeated — the
 * same rule as `probe-objects`, for the same reason: the site's `ground`
 * is the coarse survey's, and the streamed tiles put the real one metres
 * from it. Corrected once, on the first arrival, and reused: the ground
 * does not move with the weather.
 */
const EYE_ABOVE_GROUND = 300;
const EYE_TOLERANCE = 60;

/**
 * Joshua's own spot, from his phone's HUD (2026-09-06): the west coast
 * above Polihale, facing south-west over the sea. Tilted a little UP, so
 * the top quarter of the frame is sky and not the ridge behind it.
 */
const SITE = { name: 'westcoast', x: -2_166_190, z: -476_214, ground: 760, facing: 215 };
const PITCH = 5;

/**
 * The five conditions. Clear noon goes LAST so the layer-off check can
 * follow it without another arrival — a reload resets the toggle, so the
 * order the others run in changes nothing they measure.
 */
const CONDITIONS = [
  { name: 'cloudy-noon', sky: 'cloudy', hour: 12 },
  { name: 'rain-noon', sky: 'rain', hour: 12 },
  { name: 'clear-dusk', sky: 'clear', hour: 18.5 },
  { name: 'clear-night', sky: 'clear', hour: 1 },
  { name: 'clear-noon', sky: 'clear', hour: 12 },
];

/** Night, as a mean luminance of the sky: below this it is dark. */
const NIGHT_CEILING = 0.15;
/** How far apart two skies must be, in mean luminance or in warmth (red minus blue), to count as different looks. */
const DISTINCT_MIN = 0.03;
/** How much the sky's luminance must move when the weather layer is switched off. */
const OFF_CHANGE_MIN = 0.01;
/** The sun's elevation bars, degrees, wide enough for any season — see the header. */
const SUN = { noonAbove: 35, duskBelow: 15, nightBelow: -10 };

let failures = 0;
const log = (message) => console.log(`[probe:sky] ${message}`);
const fail = (message) => {
  failures += 1;
  console.error(`[probe:sky] FAIL: ${message}`);
};

function yawForBearing(bearing) {
  const headingDeg = ((180 - bearing) % 360 + 360) % 360;
  return (headingDeg * Math.PI) / 180 - Math.PI;
}

function chromiumPath() {
  const override = process.env.PLAYWRIGHT_CHROMIUM;
  if (override) {
    if (existsSync(override)) return override;
    throw new Error(`PLAYWRIGHT_CHROMIUM=${override} does not exist`);
  }
  if (existsSync(chromium.executablePath())) return undefined;
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const linked = browsers ? path.join(browsers, 'chromium') : null;
  if (linked && existsSync(linked)) return linked;
  throw new Error('no Chromium found; this probe never runs `playwright install`');
}

const runFrames = (page, count) => page.evaluate((n) => new Promise((done) => {
  let left = n;
  const step = () => {
    left -= 1;
    if (left <= 0) done();
    else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}), count);

const uiText = (page) => page.evaluate(
  () => ((document.getElementById('ui') ?? document.body).innerText ?? '').replace(/\s+/g, ' '),
);

/** The two weather lines by their `data-field` names; null for a line the HUD never built. */
const weatherLines = (page) => page.evaluate(() => {
  const read = (name) => {
    const el = document.querySelector(`[data-field="${name}"]`);
    return el instanceof HTMLElement ? (el.textContent ?? '') : null;
  };
  // Rain and the clock are two lines since the clock moved to the CAMERA
  // column; the parser is word-keyed, so they are read as one string.
  return { sky: read('weather-sky'), clock: `${read('weather-rain') ?? ''} ${read('weather-clock') ?? ''}`.trim() };
});

/** `sky clear 12% · sim` as a record, or null when the line is not in that shape. */
function parseSky(line, clockLine = '') {
  // The source word lives on the clock line (the CAMERA column) so the
  // FRAME column stays no wider than it was; it is read from either.
  const hit = /^sky (\S+) (\d+)%(?: · (live|cached|sim))?$/.exec(line ?? '');
  const source = hit?.[3] ?? /(live|cached|sim)\s*$/.exec(clockLine ?? '')?.[1] ?? null;
  return hit === null || source === null ? null : { sky: hit[1], cloud: Number(hit[2]), source };
}

/**
 * `rain 0.0 mm/h · 14:32 · sun 61°` as a record. Keyed on the three
 * words and the clock's shape rather than on the separators, so the
 * line can be shortened for width without the probe stopping reading
 * it. The sun's minus is accepted as either a hyphen or a proper minus.
 */
function parseClock(line) {
  const rain = /rain (-?[\d.]+)/.exec(line ?? '');
  const clock = /\b(\d\d):(\d\d)\b/.exec(line ?? '');
  const sun = /sun (−|-)?(\d+)°/.exec(line ?? '');
  if (rain === null || clock === null || sun === null) return null;
  return {
    rainMmHr: Number(rain[1]),
    clock: `${clock[1]}:${clock[2]}`,
    minutes: Number(clock[1]) * 60 + Number(clock[2]),
    sunDeg: (sun[1] === undefined ? 1 : -1) * Number(sun[2]),
  };
}

/** The HST hour the address bar asks for, as minutes past midnight, the way `worldClock` holds it. */
const heldMinutes = (hour) => Math.floor(hour) * 60 + Math.round((hour % 1) * 60);
const clockWords = (hour) => `${String(Math.floor(heldMinutes(hour) / 60)).padStart(2, '0')}:${String(heldMinutes(hour) % 60).padStart(2, '0')}`;

/**
 * The mean luminance (Rec. 709) of the top quarter of the frame, with
 * the DOM furniture that sits there — the stat sheet and PAUSE — masked
 * out by their measured boxes. Sampled every second column, like the
 * other pixel probes. `sampled` says how much sky was actually read, so
 * a furniture box that ate the quarter fails rather than averaging
 * itself.
 */
async function skySample(page, file) {
  const png = readPng(await page.screenshot({ path: file }));
  const masks = await page.evaluate(() => Array.from(document.querySelectorAll('[data-role="perf-hud"], [data-action="pause"]'))
    .filter((el) => el instanceof HTMLElement && !el.hidden)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
    }));
  const rows = Math.floor(png.height / 4);
  let sum = 0;
  let sampled = 0;
  let red = 0;
  let blue = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < png.width; x += 2) {
      if (masks.some((m) => x >= m.x0 && x < m.x1 && y >= m.y0 && y < m.y1)) continue;
      const i = (y * png.width + x) * 4;
      sum += (0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]) / 255;
      red += png.data[i] / 255;
      blue += png.data[i + 2] / 255;
      sampled += 1;
    }
  }
  const quarter = rows * Math.ceil(png.width / 2);
  // The HUD is most of the top quarter at the design canvas; what is
  // left beside it is still thousands of pixels of sky, which is plenty
  // for a mean. The bar is a floor, not a fraction.
  if (sampled < 2_000) fail(`only ${sampled} of ${quarter} pixels in the top quarter were sky; the HUD and PAUSE cover the rest`);
  if (sampled === 0) return { luminance: NaN, warmth: NaN };
  // Warmth: red minus blue of the mean colour. Positive is a sunset, negative a blue sky.
  return { luminance: sum / sampled, warmth: (red - blue) / sampled };
}

/** The luminance alone, for the one check that only wants a number. */
async function skyLuminance(page, file) {
  return (await skySample(page, file)).luminance;
}

/** Open the world through RESUME at the seeded pose under `?sky=&hour=` — the returning player's own path. */
async function resumeAt(page, url, condition, height) {
  const query = `sky=${encodeURIComponent(condition.sky)}&hour=${encodeURIComponent(String(condition.hour))}`;
  const opened = `${url}${url.includes('?') ? '&' : '?'}${query}`;
  await page.goto(opened, { waitUntil: 'load' });
  await page.evaluate(({ key, save }) => window.localStorage.setItem(key, JSON.stringify(save)), {
    key: SAVE_KEY,
    save: {
      version: SAVE_VERSION,
      savedAt: '2026-01-01T00:00:00.000Z',
      mapId: MAP_ID,
      camera: {
        at: { wx: SITE.x, wz: SITE.z },
        height,
        yaw: yawForBearing(SITE.facing),
        pitch: (PITCH * Math.PI) / 180,
      },
    },
  });
  await page.goto(opened, { waitUntil: 'load' });
  await page.waitForSelector('[data-action="resume"]', { timeout: TIMEOUT.menu });
  await page.click('[data-action="resume"]', { timeout: TIMEOUT.menu });
  await page.waitForSelector('[data-action="pause"]', { timeout: TIMEOUT.world });
  await runFrames(page, SETTLE_FRAMES);
  return uiText(page);
}

/** The eye height once the true ground has been read; null until the first arrival settles it. */
let eyeHeight = null;

/**
 * Arrive at the site under a condition, standing the camera three metres
 * over the TRUE ground: on the first arrival read the HUD's ABOVE line
 * and correct if it is off, then keep that height for every later one.
 */
async function arriveAt(page, url, condition) {
  let height = eyeHeight ?? SITE.ground + EYE_ABOVE_GROUND;
  let text = '';
  const tries = eyeHeight === null ? 3 : 1;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    text = await resumeAt(page, url, condition, height);
    const at = /x (-?[\d.]+) y (-?[\d.]+) z (-?[\d.]+)/.exec(text);
    if (!at) { fail(`${condition.name}: the HUD printed no camera position`); return text; }
    const off = Math.hypot(Number(at[1]) - SITE.x, Number(at[3]) - SITE.z);
    if (off > 50) { fail(`${condition.name}: asked for x ${SITE.x} z ${SITE.z}, arrived ${off.toFixed(0)} units away`); return text; }
    if (eyeHeight !== null) return text;
    const above = /above (-?[\d.]+) m/.exec(text);
    if (above === null) { fail(`${condition.name}: the HUD prints no ABOVE line, so the camera cannot be stood on the ground`); return text; }
    const error = Number(above[1]) * 100 - EYE_ABOVE_GROUND;
    if (Math.abs(error) <= EYE_TOLERANCE) { eyeHeight = height; return text; }
    const trueGround = Number(at[2]) - Number(above[1]) * 100;
    height = trueGround + EYE_ABOVE_GROUND;
    log(`${above[1]} m over the ground on attempt ${attempt + 1}; correcting to y ${height.toFixed(0)}`);
  }
  fail(`could not stand the camera ${EYE_ABOVE_GROUND / 100} m over the ground in three tries`);
  eyeHeight = height;
  return text;
}

/**
 * Wait for the sky line to name the held sky and say `sim`. Returns the
 * lines as last read and the parsed sky line, and leaves it to the
 * caller to say WHICH half is missing — the line, the sky or the word.
 */
async function waitForSky(page, sky) {
  let lines = { sky: null, clock: null };
  for (let waited = 0; waited < SKY_WAIT_FRAMES; waited += 10) {
    lines = await weatherLines(page);
    const parsed = parseSky(lines.sky, lines.clock);
    if (parsed !== null && parsed.sky === sky && parsed.source === 'sim') return { lines, parsed };
    await runFrames(page, 10);
  }
  return { lines, parsed: parseSky(lines.sky, lines.clock) };
}

/** Read one condition: arrive, wait for the held sky, read both lines, shoot, measure. Null when the HUD gave nothing to read. */
async function readCondition(page, url, condition) {
  await arriveAt(page, url, condition);
  const { lines, parsed } = await waitForSky(page, condition.sky);
  if (lines.sky === null) {
    fail(`${condition.name}: the weather hook is not wired — the HUD has no data-field="weather-sky" line`);
    return null;
  }
  if (parsed === null) {
    fail(`${condition.name}: the sky line reads "${lines.sky}", which is not "sky <word> <n>% · <live|cached|sim>"`);
    return null;
  }
  if (parsed.sky !== condition.sky) fail(`${condition.name}: ?sky=${condition.sky} was not honoured — the HUD reads "${lines.sky}"`);
  if (parsed.source !== 'sim') fail(`${condition.name}: a held sky must say sim, and the HUD reads "${lines.sky}" — a simulated sky is passing for the island's`);
  const clock = parseClock(lines.clock);
  if (clock === null) {
    fail(`${condition.name}: the clock line reads "${lines.clock}", which is not "rain <n> mm/h · HH:MM · sun <deg>°"`);
    return null;
  }
  const want = heldMinutes(condition.hour);
  if (clock.minutes !== want) fail(`${condition.name}: ?hour=${condition.hour} should read ${clockWords(condition.hour)} and the HUD reads ${clock.clock}`);
  const file = path.join(SHOTS, `sky-${condition.name}.png`);
  const { luminance, warmth } = await skySample(page, file);
  log(`${condition.name.padEnd(11)} ${lines.sky}  |  ${lines.clock}  |  sky luminance ${luminance.toFixed(3)} warmth ${warmth >= 0 ? '+' : ''}${warmth.toFixed(3)}`);
  log(`saved ${path.relative(ROOT, file)}`);
  return { ...parsed, ...clock, luminance, warmth, lines };
}

async function main() {
  if (!existsSync(DIST_INDEX)) {
    fail('dist/index.html is missing. Run `npm run build` first.');
    process.exitCode = 1;
    return;
  }
  mkdirSync(SHOTS, { recursive: true });
  let server = null;
  let browser = null;
  try {
    server = await preview({ preview: { port: 4188, strictPort: true }, logLevel: 'silent' });
    const url = server.resolvedUrls.local[0];
    browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await stubWeather(page);
    page.on('pageerror', (error) => fail(`uncaught page error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') fail(`console error: ${message.text()}`);
    });

    // ── FIVE SKIES, ONE PLACE ───────────────────────────────────────
    const read = {};
    for (const condition of CONDITIONS) {
      const result = await readCondition(page, url, condition);
      if (result !== null) read[condition.name] = result;
    }

    // ── THE ORDER: what the weather and the clock must do to the frame ─
    const noon = read['clear-noon'];
    const cloudy = read['cloudy-noon'];
    const rain = read['rain-noon'];
    const dusk = read['clear-dusk'];
    const night = read['clear-night'];
    if (noon && cloudy && rain && dusk && night) {
      const all = Object.entries(read).map(([name, r]) => [name, r.luminance]);
      const darkest = all.reduce((a, b) => (b[1] < a[1] ? b : a));
      if (darkest[0] !== 'clear-night') fail(`night (${night.luminance.toFixed(3)}) is not the darkest sky; ${darkest[0]} is (${darkest[1].toFixed(3)})`);
      if (!(night.luminance < NIGHT_CEILING)) fail(`night is not dark: sky luminance ${night.luminance.toFixed(3)}, ceiling ${NIGHT_CEILING}`);
      if (!(rain.luminance < noon.luminance)) fail(`rain does not darken the sky: rain ${rain.luminance.toFixed(3)} against clear ${noon.luminance.toFixed(3)}`);
      if (!(rain.luminance < cloudy.luminance)) fail(`rain does not darken the sky past cloud: rain ${rain.luminance.toFixed(3)} against cloudy ${cloudy.luminance.toFixed(3)}`);
      // Five looks, five different looks: every pair apart in luminance or in warmth.
      for (let a = 0; a < all.length; a += 1) {
        for (let b = a + 1; b < all.length; b += 1) {
          const [na, la] = all[a];
          const [nb, lb] = all[b];
          const apart = Math.abs(la - lb) > DISTINCT_MIN || Math.abs(read[na].warmth - read[nb].warmth) > DISTINCT_MIN;
          if (!apart) fail(`${na} and ${nb} draw the same sky: luminance ${la.toFixed(3)} / ${lb.toFixed(3)}, warmth ${read[na].warmth.toFixed(3)} / ${read[nb].warmth.toFixed(3)}`);
        }
      }
      // The colour of the hour: noon is blue, dusk is warmer than noon.
      if (!(noon.warmth < 0)) fail(`the noon sky is not blue: red minus blue ${noon.warmth.toFixed(3)}`);
      if (!(dusk.warmth > noon.warmth + DISTINCT_MIN)) fail(`dusk is not warmer than noon: ${dusk.warmth.toFixed(3)} against ${noon.warmth.toFixed(3)}`);
      // The sun, by the clock: the astronomy the light follows.
      if (!(noon.sunDeg > SUN.noonAbove)) fail(`the noon sun stands at ${noon.sunDeg}°, under ${SUN.noonAbove}°`);
      if (!(dusk.sunDeg < SUN.duskBelow)) fail(`the dusk sun stands at ${dusk.sunDeg}°, not under ${SUN.duskBelow}°`);
      if (!(night.sunDeg < SUN.nightBelow)) fail(`the night sun stands at ${night.sunDeg}°, not under ${SUN.nightBelow}°`);
      // And the weather, by the words: rain rains, a clear sky does not, cloud thickens in that order.
      if (!(rain.rainMmHr > 0)) fail(`?sky=rain and the HUD reads rain ${rain.rainMmHr} mm/h`);
      if (!(noon.rainMmHr === 0)) fail(`?sky=clear and the HUD reads rain ${noon.rainMmHr} mm/h`);
      if (!(noon.cloud < cloudy.cloud && cloudy.cloud <= rain.cloud)) fail(`cloud cover does not climb clear→cloudy→rain: ${noon.cloud}% → ${cloudy.cloud}% → ${rain.cloud}%`);
      log('the sky follows the weather and the clock, in order');
    }

    // ── THE LAYER OFF: the drawing stops, the model does not ────────
    // The page is on clear noon. The row must be built and on; switched
    // off the way the HUD listens — a `change` event, since Playwright's
    // own click waits for an idle SwiftShader frame that never comes.
    if (noon) {
      const state = await page.evaluate(() => {
        const box = document.querySelector('[data-action="layer:weather"]');
        return box instanceof HTMLInputElement ? { disabled: box.disabled, checked: box.checked } : null;
      });
      if (state === null) fail('the LAYERS column has no weather row');
      else if (state.disabled) fail('the weather layer reads "not built": BUILT_LAYERS does not name it, or the scene built no sky');
      else if (!state.checked) fail('the weather layer is not on when the world opens');
      else {
        await page.evaluate(() => {
          const box = document.querySelector('[data-action="layer:weather"]');
          if (!(box instanceof HTMLInputElement)) return;
          box.checked = false;
          box.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await runFrames(page, SETTLE_FRAMES);
        const stayedOff = await page.evaluate(() => {
          const box = document.querySelector('[data-action="layer:weather"]');
          return box instanceof HTMLInputElement ? !box.checked : null;
        });
        if (stayedOff !== true) fail('the weather checkbox did not stay off; the scene refused the toggle');
        const lines = await weatherLines(page);
        const parsed = parseSky(lines.sky, lines.clock);
        if (parsed === null || parsed.sky !== 'clear' || parsed.source !== 'sim') {
          fail(`with the layer off the sky line should still answer "sky clear … · sim" and reads "${lines.sky}" — the toggle stopped the model, not the drawing`);
        }
        const file = path.join(SHOTS, 'sky-off.png');
        const off = await skyLuminance(page, file);
        const moved = Math.abs(off - noon.luminance);
        log(`weather off: ${lines.sky}  |  sky luminance ${off.toFixed(3)} (was ${noon.luminance.toFixed(3)} with it on)`);
        log(`saved ${path.relative(ROOT, file)}`);
        if (!(moved > OFF_CHANGE_MIN)) fail(`switching the weather layer off moved the sky's luminance by ${moved.toFixed(3)}; there was no sky to remove`);
      }
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await browser?.close();
    await server?.close();
  }
  if (failures === 0) log('PASS: five skies in order, the clock held, the layer toggles.');
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
