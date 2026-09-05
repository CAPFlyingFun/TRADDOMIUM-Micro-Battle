/**
 * THE OCEAN PROBE: is there a sea, is it alive, and what does it cost?
 *
 * A screenshot is not evidence — "a blue rectangle photographs exactly
 * like an ocean" (probe-terrain, and it was right). So this drives the
 * bare URL to the world the way a player does (NEW GAME → SOLO → slot 1,
 * no query at all), points the camera at the horizon, and asks four
 * questions a painted backdrop would fail:
 *
 *  1. THE LAYERS ROW SAYS OCEAN IS BUILT. §2.9: a control that looks
 *     functional and is not is the thing this project does not ship.
 *  2. THERE IS WATER, and it is the ocean's water. Measured as the
 *     difference the LAYER makes: shoot with it on, switch it off, shoot
 *     again. What changed is the sea, by construction — no colour rule
 *     has to be invented and no palette can drift out from under it.
 *  3. IT IS ALIVE WITHOUT THE CAMERA. With the camera perfectly still,
 *     frames a second apart must differ inside the water. This is the
 *     one check a static blue plane cannot pass, and it proves the whole
 *     chain: the ONE clock is ticking, the swell reaches the vertex
 *     shader, and the ripple is scrolling. It is taken DOWN AT THE COAST
 *     and not from the spawn, because from the middle of the island
 *     every moving thing in the water is smaller than a pixel — see
 *     COAST below.
 *  4. WHAT IT COSTS. Frame rate with the sea and without it, as a ratio.
 *     THE FRAME RATE IS SWIFTSHADER'S AND IS NOT A PHONE'S — it is
 *     evidence the loop runs and a rough cost ratio, never a number to
 *     tune against (CLAUDE.md).
 *
 * Usage:
 *
 *     npm run build && npm run probe:ocean
 *
 * Shots (gitignored): `shots/ocean-horizon.png` from the island's middle,
 * `shots/ocean-off.png` from the same pose with the layer switched off —
 * the control for check 2, and what Kauaʻi looks like as a mesa — and
 * `shots/ocean-coast.png` / `ocean-coast-moved.png`, a second apart from
 * a still camera down at the water, which is check 3.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { readPng } from './probePng.mjs';
import { preview } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const SHOTS = path.join(ROOT, 'shots');
const SHOT_SEA = path.join(SHOTS, 'ocean-horizon.png');
const SHOT_OFF = path.join(SHOTS, 'ocean-off.png');
const SHOT_COAST = path.join(SHOTS, 'ocean-coast.png');
const SHOT_COAST_MOVED = path.join(SHOTS, 'ocean-coast-moved.png');

const VIEWPORT = { width: 932, height: 430 };
const SLOT_ONE = '[data-action="slot:1"]';
const CHROMIUM_ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];
const TIMEOUT = { menu: 60_000, slots: 60_000, world: 300_000 };

/**
 * Where the sea is in this view, as a fraction of the frame.
 *
 * The HUD occupies the top third and the island the bottom; the band
 * between them is where the horizon and the water sit once the camera
 * has been pitched up. Every pixel measure below is taken here, so the
 * HUD's own text cannot be mistaken for weather.
 */
const BAND = { top: 0.4, bottom: 0.72 };

/** How many frames to run for a timing sample. */
const FRAMES = 40;
/**
 * Frames to let the sea move while the camera holds still — four seconds
 * of simulation.
 *
 * SIZED FROM THE WAVE, not picked. From three hundred metres up a pixel
 * is about a third of a metre; the coarsest ripple octave scrolls at
 * 0.18 m/s, so a second of it is half a pixel and would fail on a
 * perfectly good ocean. Four seconds is 0.7 m of ripple — and, far more
 * visibly, nine metres of crest travel, because the swell runs at its own
 * celerity of 2.4 m/s.
 */
const DRIFT_FRAMES = 40;

/**
 * THE TRIP TO THE COAST, and why the probe takes it.
 *
 * The camera starts 1.5 km above the middle of Kauaʻi, twenty kilometres
 * from the nearest water. From there the sea is real and visible and
 * CANNOT BE SEEN TO MOVE: the swell is 3.6 m from crest to crest and the
 * finest ripple octave tiles at 45 cm, so at seventy kilometres of view
 * distance every moving thing in the water is far below one pixel. A
 * motion check taken there would fail on a perfect ocean.
 *
 * So the probe flies. The free-fly camera's speed rides its height above
 * ground (`SPEED_PER_ALTITUDE`), which makes the trip cheap in the only
 * currency that matters here — frames — because climbing first buys
 * speed: at 30 km up the camera covers the twenty-four kilometres to the
 * west coast in a couple of hundred frames.
 */
const COAST = {
  /**
   * Fly west until the camera is this far out along -x.
   *
   * The west coast on this line is near -2,470,000, so this is a little
   * beyond it: over water, with the shore behind.
   */
  reachX: -2_620_000,
  /** Frames per steering chunk, between position reads. */
  chunk: 40,
  /** …and a ceiling on the whole flight, so a stuck probe still reports. */
  flyBudget: 1_800,
  /**
   * The cruise band, world units above sea level.
   *
   * FLOWN AS A BAND rather than a heading, because neither extreme
   * works and both were tried. Forward alone sinks — the view is pitched
   * a little down and the camera arrived 821 m UNDER the sea. Forward
   * plus a held climb arrives at 26 km, and coming down from there costs
   * more frames than the crossing did. So the flight holds a height:
   * high enough that the height-derived speed covers the twenty-six
   * kilometres in about eight hundred frames, low enough that the
   * descent afterwards is a few hundred more.
   */
  cruiseLo: 500_000,
  cruiseHi: 900_000,
  /**
   * Come down to inside this band, in world units above sea level.
   *
   * SIXTY METRES, and it has to be that low. At five hundred metres the
   * sea is drawn and is perfectly SMOOTH — the near sheet is 168 m across
   * and falls outside a forward-pitched frame, and the far sheet's cell
   * is over a kilometre wide, so its ripple map tiles a hundred and fifty
   * times inside one cell and the mip chain averages it to a flat wash.
   * Nothing there moves, correctly. The moving water is the near sheet,
   * and it fills the view only from close above it.
   *
   * A CEILING AND A FLOOR, because the descent is fast and unbounded: the
   * rate is the height above the SEABED, which off Kauaʻi is four
   * kilometres down, so the camera falls at about 1,900 units a frame all
   * the way to the surface and a forty-frame chunk would go straight
   * through it. The chunk shrinks as the surface approaches.
   */
  dropTo: 6_000,
  dropFloor: 1_500,
  dropBudget: 900,
};

/**
 * WHY THIS PROBE IS THE SLOW ONE — about ten minutes, most of it flying.
 *
 * The motion check has to be taken from over the water and the camera
 * starts twenty-four kilometres inland, and the free-fly camera's speed
 * is its height above ground: high and fast, or low and slow, never
 * both. There is no shortcut and there should not be one — a query
 * parameter that teleported a probe to the sea would be measuring a
 * route no player can take.
 */

let failures = 0;
const log = (m) => console.log(`[probe:ocean] ${m}`);
const fail = (m) => {
  failures += 1;
  console.error(`[probe:ocean] FAIL: ${m}`);
};

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

async function shoot(page, file) {
  return readPng(await page.screenshot({ path: file }));
}

/** How many sampled pixels differ between two shots, inside the sea band. */
function changedInBand(a, b, threshold = 6) {
  if (a.width !== b.width || a.height !== b.height) return { changed: 0, sampled: 0 };
  let changed = 0;
  let sampled = 0;
  const y0 = Math.floor(a.height * BAND.top);
  const y1 = Math.floor(a.height * BAND.bottom);
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < a.width; x += 2) {
      const i = (a.width * y + x) * 4;
      sampled += 1;
      const d = Math.max(
        Math.abs(a.data[i] - b.data[i]),
        Math.abs(a.data[i + 1] - b.data[i + 1]),
        Math.abs(a.data[i + 2] - b.data[i + 2]),
      );
      if (d > threshold) changed += 1;
    }
  }
  return { changed, sampled };
}

const runFrames = (page, count) => page.evaluate((n) => new Promise((done) => {
  const started = performance.now();
  let left = n;
  const step = () => {
    left -= 1;
    if (left <= 0) done(performance.now() - started);
    else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}), count);

const uiText = (page) => page.evaluate(
  () => ((document.getElementById('ui') ?? document.body).innerText ?? '').replace(/\s+/g, ' '),
);

/** Where the camera says it is, from the HUD's own readout. */
async function cameraAt(page) {
  const hit = /x (-?[\d.]+) y (-?[\d.]+) z (-?[\d.]+)/.exec(await uiText(page));
  if (!hit) return null;
  return { x: Number(hit[1]), y: Number(hit[2]), z: Number(hit[3]) };
}

/** Hold a key for a run of frames. */
async function hold(page, key, frames) {
  await page.keyboard.down(key);
  await runFrames(page, frames);
  await page.keyboard.up(key);
}

/** Rotate the view without moving: a drag turns and pitches, it does not fly. */
async function look(page, dx, dy) {
  await page.mouse.move(466, 215);
  await page.mouse.down();
  await page.mouse.move(466 + dx, 215 + dy, { steps: 10 });
  await page.mouse.up();
  await runFrames(page, 8);
}

async function drive(page, url) {
  log(`opening the bare URL ${url} at ${VIEWPORT.width}×${VIEWPORT.height}`);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('[data-action="new-game"]', { timeout: TIMEOUT.menu });
  await page.click('[data-action="new-game"]', { timeout: TIMEOUT.menu });
  await page.click('[data-action="solo"]', { timeout: TIMEOUT.menu });
  await page.waitForSelector(SLOT_ONE, { state: 'attached', timeout: TIMEOUT.slots });
  await page.click(SLOT_ONE, { timeout: TIMEOUT.menu });

  log('waiting for the world (this includes the 2 MB survey and the sea textures)');
  await page.waitForSelector('[data-action="pause"]', { timeout: TIMEOUT.world });
  await runFrames(page, 20);

  // 1. The layers row.
  const text = await uiText(page);
  if (!/ocean/i.test(text)) fail(`the HUD never names an ocean layer. UI reads: "${text.slice(0, 200)}"`);
  else if (/ocean[^a-z]{0,4}not built/i.test(text)) fail('the HUD still reads "not built" for ocean');
  else log('the HUD lists ocean as a built layer');

  // Point at the horizon. The camera starts 1.5 km above the island's
  // middle looking slightly down, which is all island; the sea is the
  // ring around it and needs the view lifted to be in frame at all.
  log('pitching up to put the horizon in frame');
  await look(page, 0, -90);
  const withSea = await runFrames(page, FRAMES);
  const seaFps = FRAMES / (withSea / 1000);
  log(`${FRAMES} frames in ${Math.round(withSea)} ms — ${seaFps.toFixed(1)} fps with the sea (SwiftShader, NOT a phone)`);
  const sea = await shoot(page, SHOT_SEA);

  // ── THE TRIP TO THE COAST ────────────────────────────────────────
  //
  // Everything above was measured from the middle of the island, where
  // the sea is a distant band. The motion check needs to be near it.
  log('flying west to the coast — the long part, see COAST above');
  // Forward, holding the cruise band: see COAST.cruiseLo above for the
  // two ways of not doing this and what each of them cost.
  let flown = 0;
  let at = await cameraAt(page);
  while (at !== null && at.x > COAST.reachX && flown < COAST.flyBudget) {
    const climb = at.y < COAST.cruiseLo;
    const drop = at.y > COAST.cruiseHi;
    await page.keyboard.down('KeyW');
    if (climb) await page.keyboard.down('Space');
    if (drop) await page.keyboard.down('KeyQ');
    await runFrames(page, COAST.chunk);
    if (drop) await page.keyboard.up('KeyQ');
    if (climb) await page.keyboard.up('Space');
    await page.keyboard.up('KeyW');
    flown += COAST.chunk;
    at = await cameraAt(page);
  }
  log(`flew ${flown} frames; the camera is at x ${at?.x.toFixed(0)} y ${at?.y.toFixed(0)}`);
  if (at !== null && at.x > COAST.reachX) {
    fail(`the flight ran out of budget at x ${at.x.toFixed(0)}, short of the water at ${COAST.reachX}`);
    return;
  }

  let dropped = 0;
  while (at !== null && at.y > COAST.dropTo && dropped < COAST.dropBudget) {
    // The chunk shrinks as the surface approaches, because the descent
    // RATE does not: it is set by the height above the seabed, four
    // kilometres below, so it hardly slows at all on the way down. A
    // fixed chunk goes through the surface and photographs the sea floor
    // from underneath.
    const chunk = at.y > 200_000 ? COAST.chunk : at.y > 60_000 ? 8 : 2;
    await hold(page, 'KeyQ', chunk);
    dropped += chunk;
    at = await cameraAt(page);
    if (at !== null && at.y < COAST.dropFloor) break;
  }
  log(`descended ${dropped} frames; the camera is at y ${at?.y.toFixed(0)}`);
  if (at !== null && at.y <= 0) fail(`the camera ended at y ${at.y.toFixed(0)} — under the sea, not over it`);
  // Tip the view down so the water fills the frame rather than the sky.
  await look(page, 0, 55);
  await runFrames(page, 12);
  const coast = await shoot(page, SHOT_COAST);

  // 3. ALIVE WITHOUT THE CAMERA — the check a static blue plane cannot
  // pass, taken where the water is actually resolvable.
  log('holding the camera still at the coast, letting the sea move');
  await runFrames(page, DRIFT_FRAMES);
  const coastMoved = await shoot(page, SHOT_COAST_MOVED);
  const alive = changedInBand(coast, coastMoved);
  const alivePct = (100 * alive.changed) / alive.sampled;
  log(`${alive.changed} of ${alive.sampled} sampled pixels changed with the camera still (${alivePct.toFixed(1)}%)`);
  if (alive.changed < 200) {
    fail(`only ${alive.changed} pixels changed with the camera still at the coast; the sea is not moving`);
  }

  // 2. The control: switch the layer off and see what leaves.
  const toggle = page.locator('[data-layer="ocean"] input, [data-action="layer:ocean"]').first();
  if ((await toggle.count()) === 0) {
    fail('no ocean toggle control found in the HUD; the layer cannot be measured');
    return;
  }
  await toggle.click({ timeout: 10_000 }).catch(() => {});
  const withoutSea = await runFrames(page, FRAMES);
  const drySeaFps = FRAMES / (withoutSea / 1000);
  const off = await shoot(page, SHOT_OFF);
  const gone = changedInBand(sea, off);
  const gonePct = (100 * gone.changed) / gone.sampled;
  log(`${gone.changed} of ${gone.sampled} sampled pixels changed when the ocean was switched off (${gonePct.toFixed(1)}%)`);
  // The island fills the lower band in this view, so the sea is a
  // minority of it — but a tenth of the band is a great deal of water
  // and far more than a rounding difference between two frames.
  if (gonePct < 10) {
    fail(`switching the ocean off changed only ${gonePct.toFixed(1)}% of the band; there was no sea to remove`);
  }

  // 4. What it cost.
  log(`${drySeaFps.toFixed(1)} fps without the sea against ${seaFps.toFixed(1)} with it `
    + `— the sea is ${(drySeaFps / seaFps).toFixed(2)}x of the frame under SwiftShader`);
  log('(SwiftShader is a software rasteriser: this ratio is a smell test, not a phone measurement)');
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
    server = await preview({ preview: { port: 4184, strictPort: true }, logLevel: 'silent' });
    const url = server.resolvedUrls.local[0];
    log(`serving dist/ at ${url}`);
    browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => fail(`uncaught page error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') fail(`console error: ${message.text()}`);
    });
    await drive(page, url);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await browser?.close();
    await server?.close();
  }
  if (failures === 0) log('every check passed');
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
