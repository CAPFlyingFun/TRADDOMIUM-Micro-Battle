/**
 * THE WORLD OBJECTS, MEASURED: does Kauaʻi actually produce different
 * worlds at different places, and what does each cost?
 *
 * Joshua, 2026-09-06: "A beach full of inland forest trees is a failure
 * even if FPS is excellent. A rocky ridge covered in identical lawn
 * grass is a failure." So this probe stands the camera at four real
 * places — a beach on Hanalei Bay, the Kekaha plain, the Wailua forest,
 * a Waimea Canyon wall — reads the counts the HUD prints there, and
 * FAILS if the mixes do not differ the way the island says they should.
 * Then it climbs the detail ladder on the plain and prints what each
 * rung draws and what the frame costs with the layer on and off.
 *
 * THE SITES ARE CELL CENTRES THE HABITAT MAP CHOSE, not typed lat/lons:
 * `tests/worldHabitat.test.ts` searches for them the same way. The
 * numbers here are world units the HUD prints as-is (this scene never
 * rebases the origin), so a shot can be recreated with `probe:shot`.
 *
 * THE FRAME TIMES ARE SWIFTSHADER'S, NOT A PHONE'S. The headless
 * renderer runs at a frame or two a second; what the ladder shows is
 * whether the cost MOVES with the count, not what it is. Joshua's phone
 * is the instrument for the number (CLAUDE.md).
 *
 * Usage:
 *
 *   npm run build
 *   npm run probe:objects
 *
 * Shots land in `shots/objects-<site>.png` and `shots/objects-<rung>.png`.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

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

/** Frames to let the FRAME readout fill after arriving, and the most to wait for the bubble's queue to drain. */
const SETTLE_FRAMES = 30;
const DRAIN_FRAMES = 240;
/**
 * How far above the TRUE ground the camera should stand, and how far off
 * that it may be before the pose is corrected and the arrival repeated.
 * The sites' `ground` is the coarse survey's; the streamed tiles put the
 * real ground metres from it, and a camera thirty metres over a lawn is
 * past the grass's reach — which the first run of this probe measured as
 * "grass 0" on the beach and mistook for the habitat.
 */
const EYE_ABOVE_GROUND = 300;
const EYE_TOLERANCE = 60;

/**
 * Four places, chosen by what the habitat map calls them. `ground` is the
 * coarse survey's height there; the camera stands three metres above it
 * and looks down a little, so the shot has both the ground under the
 * camera and the bubble's edge in it.
 */
const SITES = [
  { name: 'beach', x: 413_600, z: -1_783_200, ground: 57, facing: 200, want: 'beach' },
  { name: 'grassland', x: -1_754_400, z: 738_400, ground: 16_839, facing: 40, want: 'grass' },
  { name: 'forest', x: 1_559_200, z: -2_400, ground: 12_501, facing: 300, want: 'fores' },
  { name: 'rocky', x: -1_215_200, z: -143_200, ground: 79_876, facing: 120, want: 'rocky' },
];
const PITCH = -18;

const RUNGS = ['ultra-low', 'low', 'medium', 'high'];

let failures = 0;
const log = (message) => console.log(`[probe:objects] ${message}`);
const fail = (message) => {
  failures += 1;
  console.error(`[probe:objects] FAIL: ${message}`);
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

/** The five lines the HUD prints for the objects, as numbers. Null when the layer is not built. */
function readObjects(text) {
  const cost = /veg ([\d.]+) pk (\d+) ms/.exec(text);
  const cells = /cells (\d+)\+(\d+) ([a-z]+)/.exec(text);
  const grass = /grass (\d+)/.exec(text);
  const clutter = /twig (\d+) st (\d+)/.exec(text);
  const major = /rock (\d+) tree (\d+)/.exec(text);
  const fps = /mean\s+([\d.]+) fps/.exec(text);
  if (!cost || !cells || !grass || !clutter || !major) return null;
  return {
    meanMs: Number(cost[1]), peakMs: Number(cost[2]),
    cells: Number(cells[1]), pending: Number(cells[2]), habitat: cells[3],
    grass: Number(grass[1]), twig: Number(clutter[1]), stone: Number(clutter[2]),
    rock: Number(major[1]), tree: Number(major[2]),
    fps: fps ? Number(fps[1]) : null,
  };
}

const words = (o) => `${o.habitat.padEnd(5)} grass ${String(o.grass).padStart(5)} twig ${String(o.twig).padStart(4)} stone ${String(o.stone).padStart(3)} rock ${String(o.rock).padStart(2)} tree ${String(o.tree).padStart(3)}  cells ${o.cells}+${o.pending}  veg ${o.meanMs} ms pk ${o.peakMs}  ${o.fps === null ? '' : `${o.fps} fps`}`;

/** Open the world through RESUME at a seeded pose — the returning player's own path — and wait for the bubble. */
async function resumeAt(page, url, site, height, detail) {
  const opened = detail === '' ? url : `${url}${url.includes('?') ? '&' : '?'}detail=${encodeURIComponent(detail)}`;
  await page.goto(opened, { waitUntil: 'load' });
  await page.evaluate(({ key, save }) => window.localStorage.setItem(key, JSON.stringify(save)), {
    key: SAVE_KEY,
    save: {
      version: SAVE_VERSION,
      savedAt: '2026-01-01T00:00:00.000Z',
      mapId: MAP_ID,
      camera: {
        at: { wx: site.x, wz: site.z },
        height,
        yaw: yawForBearing(site.facing),
        pitch: (PITCH * Math.PI) / 180,
      },
    },
  });
  await page.goto(opened, { waitUntil: 'load' });
  await page.waitForSelector('[data-action="resume"]', { timeout: TIMEOUT.menu });
  await page.click('[data-action="resume"]', { timeout: TIMEOUT.menu });
  await page.waitForSelector('[data-action="pause"]', { timeout: TIMEOUT.world });
  await runFrames(page, SETTLE_FRAMES);
  // The bubble streams a few cells a frame; wait until nothing is queued.
  for (let waited = 0; waited < DRAIN_FRAMES; waited += 10) {
    const pending = /cells \d+\+(\d+)/.exec(await uiText(page));
    if (pending === null || Number(pending[1]) === 0) break;
    await runFrames(page, 10);
  }
  return uiText(page);
}

/**
 * Stand the camera three metres over the TRUE ground at a site: arrive at
 * the coarse guess, read the HUD's ABOVE line, and if it is off by more
 * than the tolerance, correct the height and arrive again.
 */
async function arriveAt(page, url, site, detail) {
  let height = site.ground + EYE_ABOVE_GROUND;
  let text = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    text = await resumeAt(page, url, site, height, detail);
    const at = /x (-?[\d.]+) y (-?[\d.]+) z (-?[\d.]+)/.exec(text);
    if (!at) { fail(`${site.name}: the HUD printed no camera position`); return text; }
    const off = Math.hypot(Number(at[1]) - site.x, Number(at[3]) - site.z);
    if (off > 50) { fail(`${site.name}: asked for x ${site.x} z ${site.z}, arrived ${off.toFixed(0)} units away`); return text; }
    const above = /above (-?[\d.]+) m/.exec(text);
    if (above === null) { fail(`${site.name}: the HUD prints no ABOVE line, so the camera cannot be stood on the ground`); return text; }
    const error = Number(above[1]) * 100 - EYE_ABOVE_GROUND;
    if (Math.abs(error) <= EYE_TOLERANCE) return text;
    // The scene lifts a camera it finds underground by 30 m; a correction
    // from THAT reading would overshoot, so correct from the camera's own
    // y instead: the true ground is y minus what the HUD says is above it.
    const trueGround = Number(at[2]) - Number(above[1]) * 100;
    height = trueGround + EYE_ABOVE_GROUND;
    log(`${site.name}: ${above[1]} m over the ground on attempt ${attempt + 1}; correcting to y ${height.toFixed(0)}`);
  }
  fail(`${site.name}: could not stand the camera ${EYE_ABOVE_GROUND / 100} m over the ground in three tries`);
  return text;
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
    server = await preview({ preview: { port: 4187, strictPort: true }, logLevel: 'silent' });
    const url = server.resolvedUrls.local[0];
    browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (error) => fail(`uncaught page error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') fail(`console error: ${message.text()}`);
    });

    // ── FOUR PLACES, ONE RUNG ───────────────────────────────────────
    const read = {};
    for (const site of SITES) {
      const text = await arriveAt(page, url, site, 'high');
      const o = readObjects(text);
      if (o === null) {
        fail(`${site.name}: the HUD prints no object lines — is the vegetation layer built?`);
        continue;
      }
      read[site.name] = o;
      log(`${site.name.padEnd(9)} ${words(o)}`);
      if (!o.habitat.startsWith(site.want)) fail(`${site.name}: the HUD names the habitat "${o.habitat}", expected "${site.want}…"`);
      if (o.pending !== 0) fail(`${site.name}: ${o.pending} cells still queued after ${DRAIN_FRAMES} frames`);
      const file = path.join(SHOTS, `objects-${site.name}.png`);
      await page.screenshot({ path: file });
      log(`saved ${path.relative(ROOT, file)}`);
    }

    // ── THE RULE: the environment determines what belongs ─────────
    const { beach, grassland, forest, rocky } = read;
    if (beach && grassland && forest && rocky) {
      if (!(grassland.grass > beach.grass * 3)) fail(`a beach (${beach.grass} blades) is nearly a lawn (${grassland.grass})`);
      if (!(grassland.grass > rocky.grass * 2)) fail(`the canyon wall (${rocky.grass} blades) is nearly a lawn (${grassland.grass})`);
      if (!(forest.tree > grassland.tree)) fail(`the forest (${forest.tree} trees) has no more trees than the plain (${grassland.tree})`);
      // The bubble is 100 m across and a beach is a 16 m strip: the count
      // includes the land behind it, so "fewer than the forest" is the
      // honest bar, not "a third".
      if (!(forest.tree > beach.tree * 1.5)) fail(`the beach (${beach.tree} trees) is nearly a forest (${forest.tree})`);
      if (!(forest.twig > grassland.twig)) fail(`the forest floor (${forest.twig} twigs) has no more litter than the plain (${grassland.twig})`);
      if (!(rocky.rock + rocky.stone > grassland.rock + grassland.stone)) fail(`the wall (${rocky.rock + rocky.stone} rocks and stones) is no rockier than the plain (${grassland.rock + grassland.stone})`);
      if (!(beach.twig + beach.stone > 0)) fail('the beach has no driftwood and no stones');
      if (beach.grass > 0 && !(beach.grass < grassland.grass)) fail('the beach is grassier than the plain');
      const caps = { grass: 25_000, twig: 2_000, stone: 500, rock: 50, tree: 100 };
      for (const [name, o] of Object.entries(read)) {
        for (const [family, cap] of Object.entries(caps)) {
          if (o[family] > cap) fail(`${name}: ${family} ${o[family]} exceeds the high cap ${cap}`);
        }
      }
      log('the four places draw four different worlds');
    }

    // ── THE LADDER, on the plain ────────────────────────────────────
    const plain = SITES[1];
    const ladder = [];
    for (const rung of RUNGS) {
      const text = await arriveAt(page, url, plain, rung);
      const o = readObjects(text);
      if (o === null) { fail(`${rung}: no object lines`); continue; }
      const rungRead = /sea detail ([a-z-]+)/.exec(text);
      if (rungRead === null || rungRead[1] !== rung) fail(`asked for --detail=${rung} and the HUD reads "${rungRead?.[1]}"`);
      ladder.push({ rung, ...o });
      log(`${rung.padEnd(10)} ${words(o)}`);
      const file = path.join(SHOTS, `objects-${rung}.png`);
      await page.screenshot({ path: file });
    }
    for (let i = 1; i < ladder.length; i += 1) {
      if (!(ladder[i].grass >= ladder[i - 1].grass)) fail(`${ladder[i].rung} draws fewer blades (${ladder[i].grass}) than ${ladder[i - 1].rung} (${ladder[i - 1].grass})`);
      if (!(ladder[i].cells >= ladder[i - 1].cells)) fail(`${ladder[i].rung} keeps fewer cells than ${ladder[i - 1].rung}`);
    }

    // ── THE LAYER OFF: the baseline the rest is measured against ───
    await arriveAt(page, url, plain, 'high');
    const withOn = readObjects(await uiText(page));
    const box = page.locator('[data-action="layer:vegetation"]');
    if (await box.isDisabled()) fail('the vegetation layer is not built');
    // Playwright's own click waits for the page to be idle between
    // pointer steps, and a SwiftShader frame is most of a second, so it
    // times out on a box that works. Flip it the way the HUD listens for
    // — the `change` event — and let the scene answer.
    const flipped = await page.evaluate(() => {
      const box = document.querySelector('[data-action="layer:vegetation"]');
      if (!(box instanceof HTMLInputElement) || box.disabled || !box.checked) return false;
      box.checked = false;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    if (!flipped) fail('the vegetation checkbox was not on to switch off');
    await runFrames(page, SETTLE_FRAMES);
    const withOff = readObjects(await uiText(page));
    if (withOn && withOff) {
      log(`vegetation on:  ${withOn.fps} fps (${withOn.grass} blades, ${withOn.tree} trees)`);
      log(`vegetation off: ${withOff.fps} fps`);
      // Off, the counts stop moving and the cost line reads the last
      // refresh; what changes is the frame, and only the phone can say by
      // how much. Here the check is that the toggle is honoured at all.
      const drawn = await page.evaluate(() => {
        const box = document.querySelector('[data-action="layer:vegetation"]');
        return box instanceof HTMLInputElement ? box.checked : null;
      });
      if (drawn !== false) fail('the vegetation checkbox did not stay off');
      const file = path.join(SHOTS, 'objects-off.png');
      await page.screenshot({ path: file });
      log(`saved ${path.relative(ROOT, file)}`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await browser?.close();
    await server?.close();
  }
  if (failures === 0) log('PASS: four habitats, four worlds; the ladder climbs; the layer toggles.');
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
