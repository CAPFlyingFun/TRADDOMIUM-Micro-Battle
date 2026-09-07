/**
 * THE NIGHT, PHOTOGRAPHED FOUR WAYS — and measured, so a lighting change
 * can be diffed rather than eyeballed.
 *
 * Joshua, 2026-09-07, from the phone at night in the rain, four shots:
 * a shoreline seen along a dark slope with the sea beside it; the same
 * coast at the angle where a thin bright rim ran along the water's edge;
 * the eye under a live wave; and land at night in rain, grass against the
 * sky. His brief: "reproduce views similar to the four attached
 * screenshots… compare before and after… measure mean fps, 95th low,
 * ocean CPU mean/peak." The readers found that the rim was the
 * UNDERWATER fog colour — the eye was under a crest at capture — so the
 * rim shot and the underwater shot are one family, and this probe treats
 * them as one: the fix that darkens the one darkens the other.
 *
 * WHAT IT DOES. It stands the camera at four poses under a held night
 * (`?sky=rain&hour=4.6667`: 04:40 HST, the sun about −24°, the hour
 * Joshua's shots were nearest to), waits for the HUD to settle, takes a
 * 932×430 shot of each at DPR 1 with the stat sheet FOLDED the way his
 * were, reads the frame back as numbers, and then shoots (A) and (D)
 * again at a clear noon (`?sky=clear&hour=12`) to prove the day is
 * untouched. Everything is printed as a table at the end. Run it BEFORE a
 * lighting change and AFTER it and diff the two tables and the eight
 * shots: that diff is the deliverable, which is why a bar that the
 * current build fails prints FAIL and keeps going rather than stopping
 * the run — this probe measures a change that lands in the same
 * milestone as the probe itself.
 *
 * THE FOUR POSES, in the HUD's own numbers (world units; this scene
 * never rebases the origin, so a pose can be recreated with `probe:shot`
 * — and since `--sky=` and `--hour=` are forwarded there, in one
 * command). All on ONE coast, the north-shore beach `probe:ecology`
 * stands on: the survey there runs east–west, +4 cm at the site, −0.37 m
 * twenty metres north, −1.75 m a hundred metres north, and flat to
 * within 20 cm for two hundred metres either way along the shore, so the
 * water's edge is at the site itself and the sea is NORTH (−z is north,
 * `world/dem.ts`).
 *
 *   THE WATER'S EDGE IS NOT WHERE THE SURVEY'S 0 m IS, and it moves. The
 *   sand climbs 2 cm a metre (HD tile F2 and the coarse survey agree,
 *   and the HUD's ABOVE line confirmed the seabed at C), so half a
 *   metre of surface is 25 m of beach. Three shots of this coast put
 *   the DRAWN waterline 23, 24 and 40 m north of the survey's 0 m line
 *   (z = −1 968 000): the sea's surface at the shore sits below the
 *   survey's datum by about half a metre on average and the swell walks
 *   the edge tens of metres about that. The first run stood 10 m inland
 *   facing 20 — the brief's first choice — and the edge lay 40 m off,
 *   at 25% of the height, above the band; the third stood 7 m inland
 *   facing 45 and the band held sand. No single pose holds a moving
 *   edge in a fixed band, so A and B stand IN the intertidal strip, on
 *   sand the survey puts 20–30 cm under the datum, where the band
 *   covers the 20–40 m the edge was seen in; each run's shot is of
 *   whatever phase the sea was in. And neither stands ON the edge: a
 *   line through the camera's own foot projects to a vertical through
 *   its vanishing point and reads as nothing.
 *
 *   (A) night shoreline along the coast: 10 m north of the survey line,
 *       the eye 3 m over the TRUE ground, pitch −10, facing 60 — the
 *       coast (bearing 90) recedes 30° right of centre and the sea fills
 *       the left of the frame, as in his shot. At a 60° vertical field
 *       the 40–60% band covers 10.5 m to 43 m ahead at that pitch, which
 *       at this facing is 5–21 m to the camera's left: 15–31 m north of
 *       the survey line.
 *   (B) the rim angle: 15 m north of the survey line, 3 m up, pitch
 *       −18, facing 45, so the coast runs to the right — the vanishing
 *       point is 45° right of centre, near the border. The band covers
 *       6.7 m to 14 m ahead at that pitch, 4.7–9.9 m to the left of the
 *       camera: 20–25 m north of the survey line, the middle of where
 *       the edge was seen. (Facing 200, the brief's other candidate,
 *       looks up the sand with the sea behind the camera.)
 *   (C) underwater: 100 m north of the edge, the eye 0.6 m BELOW mean
 *       sea level, pitch 0, facing the beach, so the live swell passes
 *       over the eye. A HUNDRED metres and not the brief's sixty: the
 *       coarse seabed is −1.16 m at sixty and the scene lifts a resumed
 *       camera it finds within 50 cm of the ground by 30 m
 *       (`RESUME_MARGIN`); at a hundred the bed is −1.75 m and the eye
 *       has a metre of margin against the HD tile disagreeing with the
 *       survey. No ground correction here — the ground is the seabed —
 *       and the pose check fails by name if the camera was lifted.
 *   (D) night land in rain: `probe:objects`' grassland on the Kekaha
 *       plain, the eye 1 m up, pitch +8, facing 40, grass against sky.
 *
 * THE MEASURES, off the screenshot through the shared `probePng.mjs`
 * (the composited page; the WebGL canvas may not keep its buffer),
 * with the DOM furniture masked out by its measured boxes — the folded
 * stat sheet, PAUSE, and the stick's circle. Luminance is Rec. 709,
 * 0–255. Every bar is a number a night should satisfy and a lit
 * underwater fog does not:
 *
 *   RIM (A, B): the 99th-percentile luminance inside the band 40–60% of
 *   the frame's height, where the coast lies in these poses. The bar is
 *   RIM_MAX = 60. The shallow underwater fog is (23, 89, 107), luminance
 *   76: a rim of that colour fails, and so does anything brighter,
 *   while a night sea and a wet sand both sit well under it.
 *
 *   TWO RIM NUMBERS, BECAUSE OF THE RAIN. The rain is drawn as streaks
 *   (`sky/RainView.ts`: 2.5 px thick at a distance and point sprites up
 *   to 96 px across near the eye, v0's pale drop colour, no toggle of
 *   their own — they are the `weather` layer's, with the night dome and
 *   the fog) and at night they are the brightest thing in any band: the
 *   first run read a raw p99 of 144 on a coast whose sea and sand were
 *   under 55. A horizontal erosion was the first answer and the near
 *   sprites walked through it (114 on B). So the band is read twice —
 *   raw, which is the brief's number and the ceiling, and as the
 *   per-pixel MINIMUM over RAIN_CAPTURES captures RAIN_GAP_FRAMES
 *   apart. The world steps `SIM_DT_CAP` (0.1 s) a frame however slowly
 *   SwiftShader draws it, so one frame on a drop falling at 6.5 m/s is
 *   0.65 m — nine times its 7 cm smear — and every streak is somewhere
 *   else in the next capture, while the sea, the sand and a rim along
 *   the water's edge are where they were (the edge itself moves under
 *   a pixel at 15 m in a tenth of a second). What is bright in all three
 *   is a fixture; what is bright in one is rain. The bar is judged on
 *   the minimum. The limit is stated rather than hidden: a rim that
 *   runs faster than its own width in a fifth of a second reads low in
 *   the minimum, so the raw number stays beside it as the ceiling.
 *
 *   UNDERWATER (C): the median colour of the central 40% × 30% of the
 *   frame must not be the noon horizon (#9db6c6 — the sky the fog and
 *   background are set to when nothing darker has taken them), by more
 *   than HORIZON_APART = 24 on some channel, and its luminance must be
 *   under UNDERWATER_MAX = 80: the shallow fog's own 76 with a little
 *   room, so a fog that ignores the night fails on the number and not
 *   on a rounding.
 *
 *   NIGHT LAND (D): the median luminance of the lower half must be under
 *   NIGHT_GROUND_MAX = 12 (night stays dark), and the median of the top
 *   quarter — the sky — must exceed the ground's by SILHOUETTE_MIN = 2,
 *   so the grass reads as silhouettes against something rather than as
 *   black on black.
 *
 * WHAT IT EXPECTS OF THE SCENE (the contract, so a missing half fails by
 * name rather than by timeout): `?sky=` and `?hour=` read in
 * `app/registerScenes.ts` as overrides; the perf HUD's `data-field`
 * lines — `mean-fps`, `low-fps`, `sea-mean`, `sea-peak`, `sea-detail`,
 * `sea-tex`, `fresh-cost`, `veg-cost`, `weather-sky`, `weather-rain`,
 * `weather-clock` (`04:40 · sun −24° · sim`), `camera-position`,
 * `camera-facing`, `camera-above`; a `data-action="hud-collapse"` button
 * and a `data-field="summary"` row; a `data-control="stick"` ring.
 *
 * THE FRAME RATE IS SWIFTSHADER'S AND IS NOT A PHONE'S. It is printed
 * because the brief asks for it beside the pixel measures and because a
 * change in the RATIO between the views is worth seeing; never tune to
 * it (CLAUDE.md). The sea's CPU milliseconds are the ocean's own timers
 * and are portable.
 *
 * EXIT CODES: 1 on a hang, a missing HUD field, a pose the scene refused
 * or a console error — the run could not measure what it set out to;
 * 2 when every view was measured and shot and at least one pixel bar
 * reads FAIL; 0 otherwise. Shots are written before any verdict.
 *
 * Usage:
 *
 *   npm run build
 *   npm run probe:lighting
 *
 * Shots land in `shots/lighting-<view>.png` (gitignored).
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { stubWeather } from './probeWeather.mjs';
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
/** The most WALL-CLOCK time to wait for the frame-rate and sea lines to stop moving, how often to look, and how many identical reads count as settled. */
const SETTLE_MS = 60_000;
const POLL_FRAMES = 10;
const STABLE_READS = 3;
/** Frames to let the folded sheet paint before the shot. */
const FOLD_FRAMES = 3;
/**
 * How long a screenshot may take. Playwright's default is 30 s and a
 * capture waits for a composited frame; under SwiftShader a frame is
 * most of a second and a tile landing or the objects priming can hold
 * one for far longer — the second run of this probe lost a whole view,
 * and with it the run, to that default.
 */
const SHOT_TIMEOUT_MS = 180_000;

/**
 * How close the camera must land to the pose asked for, in world units
 * and in degrees of tilt (the HUD rounds to whole ones) — `probe:shot`'s
 * own bars.
 */
const ARRIVED_WITHIN = 50;
const TILTED_WITHIN = 1.5;
/**
 * How far off the asked eye height a LAND pose may stand before it is
 * corrected from the HUD's ABOVE line and arrived at again — a fifth of
 * the height, so 60 cm on a 3 m eye and 20 cm on a 1 m one. The site's
 * `ground` is the coarse survey's; the streamed tiles put the real one
 * metres from it (`probe:objects` found this).
 */
const EYE_TOLERANCE_SHARE = 0.2;
const ARRIVAL_TRIES = 3;

/** The two skies held. 04:40 HST puts the sun about −24° on the day of the brief; the season moves it a little. */
const NIGHT = { sky: 'rain', hour: 4 + 40 / 60 };
const NOON = { sky: 'clear', hour: 12 };

/** The north-shore beach `probe:ecology` stands on: the survey's 0 m line, sea to the north; the sand 2 cm a metre above it southward. */
const EDGE = { x: 808_000, z: -1_968_000, ground: 4 };
/** Where A and B stand: in the intertidal strip north of the survey line (−z is north), and the survey's sand there. */
const SHORE_A = { x: EDGE.x, z: EDGE.z - 1_000, ground: -20 };
const SHORE_B = { x: EDGE.x, z: EDGE.z - 1_500, ground: -30 };
/** `probe:objects`' grassland on the Kekaha plain. */
const PLAIN = { x: -1_754_400, z: 738_400, ground: 16_839 };

/**
 * The views. `above` is an eye height over the TRUE ground, corrected on
 * arrival; `height` is an absolute eye height used as given (the
 * underwater pose, whose ground is the seabed). `check` names the pixel
 * bar the view is held to; the noon views are printed and not judged.
 */
const VIEWS = [
  { name: 'a-shoreline-night', view: 'A', ...SHORE_A, above: 300, facing: 60, pitch: -10, ...NIGHT, check: 'rim' },
  { name: 'b-rim-night', view: 'B', ...SHORE_B, above: 300, facing: 45, pitch: -18, ...NIGHT, check: 'rim' },
  { name: 'c-underwater-night', view: 'C', x: EDGE.x, z: EDGE.z - 10_000, height: -60, facing: 180, pitch: 0, ...NIGHT, check: 'underwater' },
  { name: 'd-land-rain-night', view: 'D', x: PLAIN.x, z: PLAIN.z, ground: PLAIN.ground, above: 100, facing: 40, pitch: 8, ...NIGHT, check: 'land' },
  { name: 'a-shoreline-noon', view: 'A', ...SHORE_A, above: 300, facing: 60, pitch: -10, ...NOON, check: 'rim-print' },
  { name: 'd-land-noon', view: 'D', x: PLAIN.x, z: PLAIN.z, ground: PLAIN.ground, above: 100, facing: 40, pitch: 8, ...NOON, check: 'land-print' },
];

/** The bars, all in 0–255 luminance or channel units; see the header for where each number comes from. */
const RIM_MAX = 60;
const UNDERWATER_MAX = 80;
const HORIZON_APART = 24;
const NIGHT_GROUND_MAX = 12;
const SILHOUETTE_MIN = 2;
/** The captures the rim band's minimum is taken over, and the frames between them; see RIM in the header. */
const RAIN_CAPTURES = 3;
const RAIN_GAP_FRAMES = 1;
/** The noon horizon the fog and background fall back to: `PerformanceWorldScene`'s HORIZON #9db6c6. */
const NOON_HORIZON = { r: 0x9d, g: 0xb6, b: 0xc6 };

/** The regions, as fractions of the frame. */
const RIM_BAND = { y0: 0.4, y1: 0.6 };
const CENTRE = { x0: 0.3, x1: 0.7, y0: 0.35, y1: 0.65 };
const SKY_REGION = { y0: 0, y1: 0.25 };
const GROUND_REGION = { y0: 0.5, y1: 1 };

/** Every line the probe reads, by its `data-field` name. */
const FIELDS = [
  'mean-fps', 'low-fps', 'sim-dt', 'sea-mean', 'sea-peak', 'sea-detail', 'sea-tex', 'fresh-cost', 'veg-cost',
  'weather-sky', 'weather-rain', 'weather-clock', 'camera-position', 'camera-facing', 'camera-above',
];
/** The two that must hold still for the view to count as settled. */
const SETTLE_FIELDS = ['mean-fps', 'sea-mean'];

let failures = 0;
let pixelFailures = 0;
const log = (message) => console.log(`[probe:lighting] ${message}`);
const fail = (message) => {
  failures += 1;
  console.error(`[probe:lighting] FAIL: ${message}`);
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

/** Every field as its words: null for a line the HUD never built. */
const readFields = (page) => page.evaluate((names) => {
  const out = {};
  for (const name of names) {
    const el = document.querySelector(`[data-field="${name}"]`);
    out[name] = el instanceof HTMLElement ? (el.textContent ?? '') : null;
  }
  return out;
}, FIELDS);

/**
 * Fold or unfold the stat sheet through its own button. Folded, the HUD
 * writes only its one-line summary and NOT the columns (`PerfHud.update`),
 * so every read happens unfolded and only the shot is taken folded — and
 * the fold is a saved setting, so it is undone after the shot rather
 * than carried into the next arrival, where it would leave the columns
 * reading whatever they last said.
 */
const setFolded = (page, folded) => page.evaluate((want) => {
  const button = document.querySelector('[data-action="hud-collapse"]');
  const summary = document.querySelector('[data-field="summary"]');
  if (!(button instanceof HTMLButtonElement) || !(summary instanceof HTMLElement)) return null;
  if (!summary.hidden !== want) button.click();
  return !summary.hidden === want;
}, folded);

/** The furniture to leave out of a measure, as measured on the page: boxes, and the stick as a circle. */
const furniture = (page) => page.evaluate(() => {
  const box = (selector) => {
    const el = document.querySelector(selector);
    if (!(el instanceof HTMLElement) || el.hidden) return null;
    const r = el.getBoundingClientRect();
    return r.width === 0 || r.height === 0 ? null : { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
  };
  const stick = box('[data-control="stick"]');
  return {
    rects: [box('[data-role="perf-hud"]'), box('[data-action="pause"]')].filter((b) => b !== null),
    // The ring's box is its circle; a few pixels of slack for the nub and the border.
    circles: stick === null ? [] : [{ cx: (stick.x0 + stick.x1) / 2, cy: (stick.y0 + stick.y1) / 2, r: Math.max(stick.x1 - stick.x0, stick.y1 - stick.y0) / 2 + 4 }],
  };
});

const covered = (masks, x, y) =>
  masks.rects.some((m) => x >= m.x0 && x < m.x1 && y >= m.y0 && y < m.y1)
  || masks.circles.some((c) => (x - c.cx) ** 2 + (y - c.cy) ** 2 <= c.r * c.r);

const luminanceAt = (png, x, y) => {
  const i = (y * png.width + x) * 4;
  return 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
};

/**
 * Histograms of a region — luminance and the three channels, 256 bins
 * each — with the furniture left out. Every pixel, since a region is at
 * most a quarter of a 932×430 frame. With `later` (more captures of the
 * same pose, frames apart), the luminance is the darkest the pixel was
 * across all of them, which is how the rain is taken out of the rim
 * band; the channels are always read off the first.
 */
function sample(png, region, masks, later = []) {
  const x0 = Math.floor(png.width * (region.x0 ?? 0));
  const x1 = Math.floor(png.width * (region.x1 ?? 1));
  const y0 = Math.floor(png.height * region.y0);
  const y1 = Math.floor(png.height * region.y1);
  const lum = new Uint32Array(256);
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (covered(masks, x, y)) continue;
      const i = (y * png.width + x) * 4;
      let l = luminanceAt(png, x, y);
      for (const frame of later) {
        if (frame.width === png.width && frame.height === png.height) l = Math.min(l, luminanceAt(frame, x, y));
      }
      lum[Math.min(255, Math.round(l))] += 1;
      r[png.data[i]] += 1;
      g[png.data[i + 1]] += 1;
      b[png.data[i + 2]] += 1;
      count += 1;
    }
  }
  return { lum, r, g, b, count, of: (y1 - y0) * (x1 - x0) };
}

/** The value at a fraction of a histogram's mass: 0.5 is the median, 0.99 the 99th percentile. NaN for an empty one. */
function percentile(histogram, fraction) {
  let total = 0;
  for (const n of histogram) total += n;
  if (total === 0) return NaN;
  const want = Math.max(1, Math.ceil(total * fraction));
  let seen = 0;
  for (let v = 0; v < 256; v += 1) {
    seen += histogram[v];
    if (seen >= want) return v;
  }
  return 255;
}

/** `mean     52.3 fps` → 52.3; null while the HUD has no frames or the line is not in shape. */
const fps = (line, word) => {
  const hit = new RegExp(`${word}\\s+([\\d.]+) fps`).exec(line ?? '');
  return hit === null ? null : Number(hit[1]);
};
const ms = (line, word) => {
  const hit = new RegExp(`${word} ([\\d.]+) ms`).exec(line ?? '');
  return hit === null ? null : Number(hit[1]);
};

/**
 * `04:40 · sun −24° · sim` as a record, or null. Keyed on the words and
 * the clock's shape rather than the separators, as `probe:sky` reads it;
 * the sun's minus is accepted as a proper minus or a hyphen.
 */
function parseClock(line) {
  const clock = /\b(\d\d):(\d\d)\b/.exec(line ?? '');
  const sun = /sun (−|-)?(\d+)°/.exec(line ?? '');
  const source = /(live|cached|sim)\s*$/.exec(line ?? '');
  if (clock === null || sun === null || source === null) return null;
  return {
    clock: `${clock[1]}:${clock[2]}`,
    minutes: Number(clock[1]) * 60 + Number(clock[2]),
    sunDeg: (sun[1] === undefined ? 1 : -1) * Number(sun[2]),
    source: source[1],
  };
}

/** `sky rain 96%` as a record, or null. */
function parseSky(line) {
  const hit = /^sky (\S+) (\d+)%/.exec(line ?? '');
  return hit === null ? null : { sky: hit[1], cloud: Number(hit[2]) };
}

/** The HST hour the address bar asks for, as minutes past midnight, the way `worldClock` holds it. */
const heldMinutes = (hour) => Math.floor(hour) * 60 + Math.round((hour % 1) * 60);
const clockWords = (hour) => `${String(Math.floor(heldMinutes(hour) / 60)).padStart(2, '0')}:${String(heldMinutes(hour) % 60).padStart(2, '0')}`;

/** Open the world through RESUME at a seeded pose under the held sky and hour — the returning player's own path. */
async function resumeAt(page, url, view, height) {
  const query = `sky=${encodeURIComponent(view.sky)}&hour=${encodeURIComponent(String(view.hour))}`;
  const opened = `${url}${url.includes('?') ? '&' : '?'}${query}`;
  await page.goto(opened, { waitUntil: 'load' });
  await page.evaluate(({ key, save }) => window.localStorage.setItem(key, JSON.stringify(save)), {
    key: SAVE_KEY,
    save: {
      version: SAVE_VERSION,
      savedAt: '2026-01-01T00:00:00.000Z',
      mapId: MAP_ID,
      camera: {
        at: { wx: view.x, wz: view.z },
        height,
        yaw: yawForBearing(view.facing),
        pitch: (view.pitch * Math.PI) / 180,
      },
    },
  });
  await page.goto(opened, { waitUntil: 'load' });
  await page.waitForSelector('[data-action="resume"]', { timeout: TIMEOUT.menu });
  await page.click('[data-action="resume"]', { timeout: TIMEOUT.menu });
  await page.waitForSelector('[data-action="pause"]', { timeout: TIMEOUT.world });
  // Unfolded before anything is read: a fold left behind by an earlier
  // shot would come back as a saved setting, with the columns unwritten.
  if ((await setFolded(page, false)) === null) fail(`${view.name}: the HUD has no fold button or no summary row`);
  await runFrames(page, SETTLE_FRAMES);
  return readFields(page);
}

/** The camera's pose off the HUD's own lines, or null. */
function poseOf(fields) {
  const at = /x (-?[\d.]+)\s+y (-?[\d.]+)\s+z (-?[\d.]+)/.exec(fields['camera-position'] ?? '');
  const tilt = /pitch (-?[\d.]+)°/.exec(fields['camera-facing'] ?? '');
  const above = /above (-?[\d.]+) m/.exec(fields['camera-above'] ?? '');
  if (at === null) return null;
  return {
    x: Number(at[1]), y: Number(at[2]), z: Number(at[3]),
    pitch: tilt === null ? null : Number(tilt[1]),
    aboveM: above === null ? null : Number(above[1]),
  };
}

/** Eye heights already corrected against the true ground, by site and asked height, so the noon pass arrives once. */
const corrected = new Map();

/**
 * Arrive at a view. A land pose stands `above` the TRUE ground: arrive at
 * the coarse guess, read the HUD's ABOVE line, correct and arrive again
 * if it is off. The underwater pose uses its `height` as given, once,
 * and is checked for having been lifted. Returns the fields as last
 * read, or null when the pose could not be confirmed.
 */
async function arriveAt(page, url, view) {
  const key = `${view.x},${view.z}:${view.above ?? view.height}`;
  const fixed = view.height !== undefined;
  let height = fixed ? view.height : (corrected.get(key) ?? view.ground + view.above);
  const tries = fixed || corrected.has(key) ? 1 : ARRIVAL_TRIES;
  let fields = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    fields = await resumeAt(page, url, view, height);
    const pose = poseOf(fields);
    if (pose === null) { fail(`${view.name}: the HUD printed no camera position, so the pose could not be confirmed`); return null; }
    const off = Math.hypot(pose.x - view.x, pose.z - view.z);
    if (off > ARRIVED_WITHIN) { fail(`${view.name}: asked for x ${view.x} z ${view.z}, arrived ${off.toFixed(0)} units away`); return null; }
    if (pose.pitch === null) fail(`${view.name}: the HUD printed no pitch`);
    else if (Math.abs(pose.pitch - view.pitch) > TILTED_WITHIN) fail(`${view.name}: asked for pitch ${view.pitch}° and arrived at ${pose.pitch}°`);
    if (fixed) {
      // The one pose the scene might refuse: a save under the sea is a
      // save the ground check lifts by 30 m if the seabed is too close.
      if (Math.abs(pose.y - view.height) > ARRIVED_WITHIN) {
        fail(`${view.name}: asked for y ${view.height} (${(-view.height / 100).toFixed(1)} m under sea level) and the scene put the camera at y ${pose.y} — it was lifted clear of the seabed; stand it further out`);
        return null;
      }
      log(`${view.name}: eye at y ${pose.y} (${(-pose.y / 100).toFixed(2)} m under sea level), ${pose.aboveM ?? '?'} m over the seabed`);
      return fields;
    }
    if (pose.aboveM === null) { fail(`${view.name}: the HUD prints no ABOVE line, so the camera cannot be stood on the ground`); return null; }
    const error = pose.aboveM * 100 - view.above;
    if (Math.abs(error) <= view.above * EYE_TOLERANCE_SHARE) { corrected.set(key, height); return fields; }
    if (corrected.has(key)) { fail(`${view.name}: the corrected height stands ${pose.aboveM} m over the ground, not ${view.above / 100} m`); return fields; }
    // Correct from the camera's own y: the true ground is y minus what the
    // HUD says is above it (a lifted camera would overshoot otherwise).
    height = pose.y - pose.aboveM * 100 + view.above;
    log(`${view.name}: ${pose.aboveM} m over the ground on attempt ${attempt + 1}; correcting to y ${height.toFixed(0)}`);
  }
  fail(`${view.name}: could not stand the camera ${view.above / 100} m over the ground in ${ARRIVAL_TRIES} tries`);
  return fields;
}

/** Wait for the sky line to name the held sky and the clock line to say `sim`. */
async function waitForSky(page, view) {
  let fields = await readFields(page);
  for (let waited = 0; waited < SKY_WAIT_FRAMES; waited += POLL_FRAMES) {
    const sky = parseSky(fields['weather-sky']);
    const clock = parseClock(fields['weather-clock']);
    if (sky !== null && sky.sky === view.sky && clock !== null && clock.source === 'sim') return fields;
    await runFrames(page, POLL_FRAMES);
    fields = await readFields(page);
  }
  return fields;
}

/** Poll until the frame-rate and sea lines read the same STABLE_READS times running, or SETTLE_MS have passed. */
async function settle(page) {
  const started = Date.now();
  let fields = await readFields(page);
  let last = null;
  let same = 0;
  for (;;) {
    const key = SETTLE_FIELDS.map((name) => fields[name]).join('|');
    if (key === last) same += 1;
    else { last = key; same = 0; }
    if (same >= STABLE_READS - 1) return { fields, timedOut: false };
    if (Date.now() - started >= SETTLE_MS) return { fields, timedOut: true };
    await runFrames(page, POLL_FRAMES);
    fields = await readFields(page);
  }
}

/** The numbers a row of the table carries, parsed off the settled fields; the problems are named, not thrown. */
function numbersOf(fields, view) {
  const sky = parseSky(fields['weather-sky']);
  const clock = parseClock(fields['weather-clock']);
  const rain = /rain ([\d.]+) mm\/h/.exec(fields['weather-rain'] ?? '');
  const veg = /veg ([\d.]+) pk (\d+) ms/.exec(fields['veg-cost'] ?? '');
  const detail = /sea detail (\S+)/.exec(fields['sea-detail'] ?? '');
  const tex = /sea tex (\S+)/.exec(fields['sea-tex'] ?? '');
  if (sky === null) fail(`${view.name}: the sky line reads "${fields['weather-sky']}", not "sky <word> <n>%"`);
  else if (sky.sky !== view.sky) fail(`${view.name}: ?sky=${view.sky} was not honoured — the HUD reads "${fields['weather-sky']}"`);
  if (clock === null) fail(`${view.name}: the clock line reads "${fields['weather-clock']}", not "HH:MM · sun <deg>° · <live|cached|sim>"`);
  else {
    if (clock.source !== 'sim') fail(`${view.name}: a held sky must say sim and the clock line reads "${fields['weather-clock']}"`);
    if (clock.minutes !== heldMinutes(view.hour)) fail(`${view.name}: ?hour=${view.hour} should read ${clockWords(view.hour)} and the HUD reads ${clock.clock}`);
  }
  return {
    meanFps: fps(fields['mean-fps'], 'mean'),
    lowFps: fps(fields['low-fps'], '95th low'),
    seaMeanMs: ms(fields['sea-mean'], 'sea mean'),
    seaPeakMs: ms(fields['sea-peak'], 'sea peak'),
    freshMs: ms(fields['fresh-cost'], 'fresh'),
    vegMs: veg === null ? null : Number(veg[1]),
    vegPeakMs: veg === null ? null : Number(veg[2]),
    sky: sky?.sky ?? '—',
    cloud: sky?.cloud ?? null,
    rainMmHr: rain === null ? null : Number(rain[1]),
    clock: clock?.clock ?? '—',
    sunDeg: clock?.sunDeg ?? null,
    source: clock?.source ?? '—',
    detail: detail?.[1] ?? '—',
    tex: tex?.[1] ?? '—',
  };
}

/** The pixel measures for a view's check, and a verdict where the view is judged. `later` is the rim views' extra captures. */
function measure(png, masks, view, later) {
  const words = [];
  let verdict = null;
  const pass = (ok) => { verdict = ok ? 'PASS' : 'FAIL'; };
  if (view.check === 'rim' || view.check === 'rim-print') {
    const band = sample(png, RIM_BAND, masks);
    const rim = percentile(band.lum, 0.99);
    const rimStill = percentile(sample(png, RIM_BAND, masks, later).lum, 0.99);
    words.push(`rim p99 ${rim}/255 raw, ${rimStill}/255 rain out over ${later.length + 1} captures (${band.count} px)`);
    if (view.check === 'rim') pass(rimStill < RIM_MAX);
    return { words, verdict, rim, rimStill };
  }
  if (view.check === 'underwater') {
    const centre = sample(png, CENTRE, masks);
    const median = { r: percentile(centre.r, 0.5), g: percentile(centre.g, 0.5), b: percentile(centre.b, 0.5) };
    const lum = percentile(centre.lum, 0.5);
    const apart = Math.max(Math.abs(median.r - NOON_HORIZON.r), Math.abs(median.g - NOON_HORIZON.g), Math.abs(median.b - NOON_HORIZON.b));
    words.push(`centre median rgb(${median.r},${median.g},${median.b}) lum ${lum}/255, ${apart} from the noon horizon`);
    pass(apart > HORIZON_APART && lum < UNDERWATER_MAX);
    return { words, verdict, median, lum, apart };
  }
  const sky = percentile(sample(png, SKY_REGION, masks).lum, 0.5);
  const ground = percentile(sample(png, GROUND_REGION, masks).lum, 0.5);
  words.push(`lower-half median ${ground}/255, sky median ${sky}/255`);
  if (view.check === 'land') pass(ground < NIGHT_GROUND_MAX && sky - ground >= SILHOUETTE_MIN);
  return { words, verdict, sky, ground };
}

/** One view: arrive, hold the sky, settle, read, fold, shoot, measure, unfold. */
async function readView(page, url, view) {
  log(`── ${view.view} ${view.name}: x ${view.x} z ${view.z}, ${view.height !== undefined ? `y ${view.height}` : `${view.above / 100} m up`}, facing ${view.facing}°, pitch ${view.pitch}°, ?sky=${view.sky}&hour=${view.hour}`);
  const arrived = await arriveAt(page, url, view);
  if (arrived === null) return null;
  await waitForSky(page, view);
  const { fields, timedOut } = await settle(page);
  const missing = FIELDS.filter((name) => fields[name] === null);
  if (missing.length > 0) fail(`${view.name}: the HUD has no data-field="${missing[0]}" line (missing: ${missing.join(', ')})`);
  if (timedOut) log(`${view.name}: the frame rate was still moving after ${SETTLE_MS / 1000} s; reading it as it stands`);
  const numbers = numbersOf(fields, view);
  log(`${view.name}: ${fields['weather-sky']} · ${fields['weather-rain']} · ${fields['weather-clock']} · ${fields['sea-detail']} · ${fields['sea-tex']} · ${fields['camera-above']} · sim dt ${fields['sim-dt']}`);

  // THE SHOT, FOLDED, as his were; the furniture measured in that state.
  const folded = await setFolded(page, true);
  if (folded !== true) fail(`${view.name}: the HUD could not be folded for the shot`);
  await runFrames(page, FOLD_FRAMES);
  const masks = await furniture(page);
  const file = path.join(SHOTS, `lighting-${view.name}.png`);
  const png = readPng(await page.screenshot({ path: file, timeout: SHOT_TIMEOUT_MS }));
  log(`saved ${path.relative(ROOT, file)}`);
  // THE RAIN, TAKEN OUT BY TIME: two more captures of the same pose a
  // frame apart, unsaved, for the rim band's minimum — see the header.
  const later = [];
  if (view.check === 'rim' || view.check === 'rim-print') {
    for (let i = 1; i < RAIN_CAPTURES; i += 1) {
      await runFrames(page, RAIN_GAP_FRAMES);
      later.push(readPng(await page.screenshot({ timeout: SHOT_TIMEOUT_MS })));
    }
  }
  await setFolded(page, false);

  const measured = measure(png, masks, view, later);
  if (measured.verdict === 'FAIL') pixelFailures += 1;
  log(`${view.name}: ${measured.words.join('; ')}${measured.verdict === null ? '' : ` — ${measured.verdict}`}`);
  return { view, numbers, measured };
}

const num = (v, digits = 1) => (v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(digits));

async function main() {
  if (!existsSync(DIST_INDEX)) {
    fail('dist/index.html is missing. Run `npm run build` first.');
    process.exitCode = 1;
    return;
  }
  mkdirSync(SHOTS, { recursive: true });
  let server = null;
  let browser = null;
  const rows = [];
  try {
    server = await preview({ preview: { port: 4190, strictPort: true }, logLevel: 'silent' });
    const url = server.resolvedUrls.local[0];
    browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await stubWeather(page);
    page.on('pageerror', (error) => fail(`uncaught page error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') fail(`console error: ${message.text()}`);
    });

    // ONE VIEW'S FAILURE IS ONE ROW'S: a timeout or a refused pose is
    // named and the next view is still read and shot, so the table and
    // the other shots are written whatever happened to one of them.
    for (const view of VIEWS) {
      try {
        const row = await readView(page, url, view);
        if (row !== null) rows.push(row);
      } catch (error) {
        fail(`${view.name}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
        await setFolded(page, false).catch(() => null);
      }
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await browser?.close();
    await server?.close();
  }

  // ── THE TABLE: the before, or the after ────────────────────────────
  log('');
  log(`${'view'.padEnd(20)} ${'sun°'.padStart(5)} ${'sky'.padEnd(6)} ${'clock'.padEnd(5)} ${'mean fps'.padStart(8)} ${'low fps'.padStart(7)} ${'sea ms'.padStart(11)} ${'fresh'.padStart(6)} ${'veg ms'.padStart(6)}  measure`);
  for (const { view, numbers: n, measured: m } of rows) {
    const sun = n.sunDeg === null ? '—' : `${n.sunDeg}`;
    const sea = n.seaMeanMs === null ? '—' : `${num(n.seaMeanMs, 2)}/${num(n.seaPeakMs, 1)}`;
    log(`${view.name.padEnd(20)} ${sun.padStart(5)} ${n.sky.padEnd(6)} ${n.clock.padEnd(5)} ${num(n.meanFps).padStart(8)} ${num(n.lowFps).padStart(7)} ${sea.padStart(11)} ${num(n.freshMs).padStart(6)} ${num(n.vegMs).padStart(6)}  ${m.words.join('; ')}${m.verdict === null ? '' : ` ${m.verdict}`}`);
  }
  log(`bars: rim p99 < ${RIM_MAX}; underwater centre median > ${HORIZON_APART} from #9db6c6 and lum < ${UNDERWATER_MAX}; night ground median < ${NIGHT_GROUND_MAX} and sky − ground ≥ ${SILHOUETTE_MIN} (all /255)`);
  log('(SwiftShader frame rates are not a phone\'s; the sea milliseconds are the ocean\'s own timers and travel.)');

  if (rows.length < VIEWS.length) fail(`${VIEWS.length - rows.length} of ${VIEWS.length} views could not be measured`);
  if (failures > 0) process.exitCode = 1;
  else if (pixelFailures > 0) {
    log(`${pixelFailures} pixel bar${pixelFailures === 1 ? '' : 's'} read FAIL — every shot and number above is written; diff them against the other build`);
    process.exitCode = 2;
  } else {
    log('PASS: four night views under their bars, two noon views printed.');
    process.exitCode = 0;
  }
}

await main();
