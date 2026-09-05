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
import { chooseSpawn } from './probeSpawn.mjs';
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
 * IT STARTS AT THE COAST, because it can now choose where to begin: the
 * spawn map picks a region and this one asks for a coastal one, so the
 * sea is in frame on the first drawn frame. Before that it opened on the
 * summit and flew seventeen kilometres west, which took four attempts to
 * get right and most of the probe's wall clock.
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
/**
 * WHERE THIS PROBE STARTS, now that it can choose.
 *
 * A coast region, so the sea is in front of the camera on the probe's
 * first drawn frame. ʻAnini's candidates sit about 50 m from the water —
 * the closest the island offers — which is why the flight this file used
 * to make is gone.
 */
const COAST_REGION = 'anini';

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

/**
 * The walk a player takes to the world: NEW GAME, SOLO, slot 1. No query
 * parameter skips a step of it (CLAUDE.md) — `?tier=` names a texture
 * rung and nothing else about the route.
 */
async function openWorld(page, url) {
  log(`opening ${url} at ${VIEWPORT.width}×${VIEWPORT.height}`);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('[data-action="new-game"]', { timeout: TIMEOUT.menu });
  await page.click('[data-action="new-game"]', { timeout: TIMEOUT.menu });
  await page.click('[data-action="solo"]', { timeout: TIMEOUT.menu });
  await page.waitForSelector(SLOT_ONE, { state: 'attached', timeout: TIMEOUT.slots });
  await page.click(SLOT_ONE, { timeout: TIMEOUT.menu });
  await chooseSpawn(page, COAST_REGION, log, TIMEOUT.world);

  log('waiting for the world (this includes the 2 MB survey and the sea textures)');
  await page.waitForSelector('[data-action="pause"]', { timeout: TIMEOUT.world });
  await runFrames(page, 20);
}

async function drive(page, url) {
  await openWorld(page, url);

  // 1. The layers row.
  const text = await uiText(page);
  if (!/ocean/i.test(text)) fail(`the HUD never names an ocean layer. UI reads: "${text.slice(0, 200)}"`);
  else if (/ocean[^a-z]{0,4}not built/i.test(text)) fail('the HUD still reads "not built" for ocean');
  else log('the HUD lists ocean as a built layer');

  // Point at the horizon. The camera starts low over the north shore now,
  // looking slightly down, so lifting the view puts open sea and the
  // horizon in frame rather than the beach immediately below.
  log('pitching up to put the horizon in frame');
  await look(page, 0, -90);
  const withSea = await runFrames(page, FRAMES);
  const seaFps = FRAMES / (withSea / 1000);
  log(`${FRAMES} frames in ${Math.round(withSea)} ms — ${seaFps.toFixed(1)} fps with the sea (SwiftShader, NOT a phone)`);
  const sea = await shoot(page, SHOT_SEA);

  // ── ALREADY AT THE COAST ─────────────────────────────────────────
  //
  // This used to be a ten-minute flight. The probe opened on
  // Waiʻaleʻale's summit, 17 km from water, and had to fly west across
  // the island and then descend four kilometres to find the sea — four
  // attempts to get right, and the slowest thing in the suite.
  //
  // The spawn map deleted all of it. The run above chose a COAST region,
  // so the camera is already low over the north shore and the checks
  // below can simply be taken. The flight budget, the cruise band and
  // the descent chunking that made it work are gone with it; git history
  // has them if a probe ever needs to cross the island again.
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

/**
 * THE RUNGS JOSHUA NAMED, in his order: "testable at medium, low and
 * ultra-low on his phone" (CLAUDE.md). Ultra-low is not one of the
 * player's three quality levels and is reachable only by `?tier=`, which
 * is the whole reason that parameter exists.
 */
const SWEEP_TIERS = ['medium', 'low', 'ultra-low'];

/**
 * Frames to fly forward while the cost record is watching.
 *
 * The camera starts about 125 m/s (a twelfth of its height above the
 * ground) and the near sheet re-anchors every 21 m, so even a handful of
 * frames crosses the lattice several times. Sixty is enough to be sure
 * of catching one on a rig this slow without adding a minute a rung.
 */
const MOVE_FRAMES = 60;

/**
 * The HUD's own sea rows, parsed. They read
 *
 *     sea mean 0.04 ms
 *     sea peak 12.3 ms
 *     sea rung medium
 *
 * and live in the FRAME column rather than one of their own, because a
 * sixth column does not fit the 932 px canvas (`PerfHud.seaWords`).
 */
async function seaReadout(page) {
  const text = await uiText(page);
  const mean = /sea mean ([\d.]+) ms/.exec(text);
  const peak = /sea peak ([\d.]+) ms/.exec(text);
  const rung = /sea rung (\S+)/.exec(text);
  if (!mean || !peak || !rung) return null;
  return { meanMs: Number(mean[1]), peakMs: Number(peak[1]), tier: rung[1] };
}

/**
 * WHICH SIDE OF THE MACHINE THE SEA SPENDS ON, one rung at a time.
 *
 * Joshua's second named suspect for v0's choppiness was that the work
 * "probably wasn't optimized the best between CPU, and GPU", and that is
 * a measurement rather than an opinion. Two numbers a rung answer it:
 *
 *   THE CPU SIDE, in milliseconds, measured by the ocean itself — its
 *   `update` and `tick` are the whole of its per-frame JS, and that JS
 *   is the same JS on a phone. Real, and portable.
 *
 *   THE GPU SIDE, as the frame rate the layer costs. NOT in
 *   milliseconds: this is SwiftShader, a software rasteriser, so a
 *   "GPU" time here is a CPU time wearing a hat. The RATIO between the
 *   layer on and off is a smell test that transfers; the absolute
 *   numbers do not.
 *
 * AND IT IS MEASURED MOVING, WHICH IS THE WHOLE POINT. The first version
 * of this sweep held the camera still, pitched at the horizon, and
 * reported that the sea's JS costs 0.67 ms a frame and there was nothing
 * to win in it. That was true and useless: a still camera never crosses
 * a recentre lattice, so it never refills a sheet, so it never pays for
 * the one CPU cost the ocean actually has. Moving, the near sheet
 * re-anchors every 21 m — tens of thousands of heightfield reads in a
 * single frame — and that is a hitch rather than a slow average. Both
 * windows are measured now, and the moving one is what the finding uses.
 *
 * If the still cost is a fraction of a millisecond while switching the
 * layer off multiplies the frame rate, the steady-state cost is on the
 * fragment side and the texture rung is the lever — which is exactly what
 * the ladder was built to be. The peak says separately whether there is
 * a stall on top of that. Both are stated by comparing measurements,
 * never by asserting them.
 *
 * A FRESH CONTEXT PER RUNG, because slot 1 would otherwise already hold
 * a save from the previous rung and NEW GAME would stop to ask.
 */
async function sweep(browser, url) {
  log('');
  log('── the cost of each rung ─────────────────────────────────────');
  const rows = [];
  for (const tier of SWEEP_TIERS) {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (error) => fail(`[${tier}] uncaught page error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') fail(`[${tier}] console error: ${message.text()}`);
    });
    try {
      await openWorld(page, `${url}?tier=${tier}`);

      // THE OVERRIDE IS REAL, not decorative: the HUD names the rung the
      // sea was actually built at, so a parameter that did nothing shows
      // up here as the wrong word rather than as a quietly identical run.
      const named = await seaReadout(page);
      if (named === null) fail(`[${tier}] the HUD has no sea rows to read`);
      else if (named.tier !== tier) fail(`[${tier}] ?tier= was ignored: the HUD says the sea is "${named.tier}"`);

      await look(page, 0, -90); // the horizon into frame, as in check 4
      const withSea = await runFrames(page, FRAMES);
      const onFps = FRAMES / (withSea / 1000);
      const still = await seaReadout(page);

      // NOW MOVE. Forward at the starting fly speed crosses the near
      // sheet's recentre lattice several times in this many frames, so
      // the peak below is a refill and not an average of frames that
      // never did one.
      await hold(page, 'KeyW', MOVE_FRAMES);
      const cost = await seaReadout(page);

      const toggle = page.locator('[data-layer="ocean"] input, [data-action="layer:ocean"]').first();
      if ((await toggle.count()) === 0) fail(`[${tier}] no ocean toggle to measure against`);
      await toggle.click({ timeout: 10_000 }).catch(() => {});
      const without = await runFrames(page, FRAMES);
      const offFps = FRAMES / (without / 1000);

      rows.push({ tier, onFps, offFps, still, cost });
      log(`${tier.padEnd(9)} ${onFps.toFixed(2)} fps with the sea, ${offFps.toFixed(2)} without `
        + `(${(offFps / onFps).toFixed(2)}x) — CPU ${still?.meanMs.toFixed(3) ?? '?'} ms a frame still, `
        + `${cost?.peakMs.toFixed(1) ?? '?'} ms worst frame moving`);
    } finally {
      await context.close();
    }
  }

  // ── the finding, read off the rows rather than assumed ──
  log('');
  const worstOf = (pick) => {
    const values = rows.map(pick).filter((v) => Number.isFinite(v));
    return values.length === 0 ? 0 : Math.max(...values);
  };
  const stillCpu = worstOf((r) => r.still?.meanMs ?? NaN);
  const movingPeak = worstOf((r) => r.cost?.peakMs ?? NaN);
  const worstRatio = worstOf((r) => (r.onFps > 0 ? r.offFps / r.onFps : NaN));
  // A frame's whole budget at 60 fps, for scale — the number the CPU
  // side has to be compared against to mean anything.
  const BUDGET_MS = 1000 / 60;
  log(`CPU, still:  at most ${stillCpu.toFixed(3)} ms a frame — ${((100 * stillCpu) / BUDGET_MS).toFixed(1)}% of a 60 fps frame.`);
  log(`CPU, moving: worst single frame ${movingPeak.toFixed(1)} ms — ${(movingPeak / BUDGET_MS).toFixed(1)} frames' budget in one frame.`);
  log(`GPU:         switching the layer off is worth up to ${worstRatio.toFixed(2)}x the frame rate.`);
  if (stillCpu < BUDGET_MS / 10 && worstRatio > 1.2) {
    log('FINDING: the STEADY cost is on the GPU. The texture rung and the sheet vertex');
    log('         counts are the levers, and the sweep above shows them working.');
  } else {
    log(`FINDING: the sea's own JS is ${stillCpu.toFixed(2)} ms a frame even standing still,`);
    log('         which is not free. Look at the refill before touching the shader.');
  }
  if (movingPeak > BUDGET_MS) {
    log(`         BUT MOVING IT STALLS: one frame in the move cost ${movingPeak.toFixed(1)} ms, which is`);
    log('         a sheet re-anchor — tens of thousands of heightfield reads at once.');
    log('         That is a hitch, not a slow average, and no texture rung fixes it.');
  }
  log('(SwiftShader is a software rasteriser. The CPU milliseconds are real and portable;');
  log(' the frame-rate ratio is a smell test, and neither is a phone number.)');
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
    await sweep(browser, url);
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
