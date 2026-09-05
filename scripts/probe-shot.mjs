/**
 * RECREATE A SHOT FROM THE PHONE.
 *
 * Joshua, 2026-09-05: "You can use the stats to recreate the shots to see
 * if it's fixed before pushing." The perf HUD prints where the camera is
 * and which way it faces, so a screenshot he sends is a reproducible
 * state — if there is a way to put the camera back there. This is that
 * way.
 *
 * HOW IT PLACES THE CAMERA, and why not by flying. It seeds slot 1 with a
 * SAVE at the pose and then presses RESUME, so the camera arrives through
 * the same restore path a returning player uses. Flying there would take
 * minutes at 30 m/s and would land somewhere near the pose rather than at
 * it; teleporting through a back door would be a path no player has, and
 * so a program this probe alone can reach.
 *
 * THE COORDINATES ARE THE HUD'S OWN, unchanged. It prints the camera's
 * RENDER position, and the Performance World never rebases the floating
 * origin (only the Network Lab does), so render equals world there and
 * the numbers can be used as read. If that ever stops being true this
 * probe starts lying, so it CHECKS: after arriving it reads the HUD back
 * and fails if the camera is not where it was asked to be.
 *
 * Usage:
 *
 *   npm run build
 *   npm run probe:shot -- --x=-2182444.3 --y=3442.3 --z=-477632.6 --facing=12 --pitch=-0.2 --name=washboard
 *
 * Shots land in `shots/<name>.png` (gitignored). Run it before a change
 * and after it, and compare the two.
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

/** The save document slot 1 lives in — `session/SoloSlots.soloSlotKey(1)`. */
const SAVE_KEY = 'traddomium.v1.solo-save';
/** `session/SoloSave.SOLO_SAVE_VERSION`. A save of another version is refused. */
const SAVE_VERSION = 2;
/**
 * `perf/perfTool.PERF_WORLD_MAP_ID`. A pose restored into the wrong world
 * is refused outright — the save reads as defaults and the menu never
 * offers RESUME, which is what happened when this said "perf-world".
 * These three literals are pinned against the real exports by
 * tests/probeShotConstants.test.ts, because a probe that disagrees with
 * the app fails in a way that looks like the app being broken.
 */
const MAP_ID = 'perf-empty';

/** How close the camera must land to the pose asked for, in world units. */
const ARRIVED_WITHIN = 50;

let failures = 0;
const log = (message) => console.log(`[probe:shot] ${message}`);
const fail = (message) => {
  failures += 1;
  console.error(`[probe:shot] FAIL: ${message}`);
};

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

/**
 * The HUD prints a COMPASS BEARING; the save holds a camera YAW.
 *
 * `world/coords.compassBearing` is `(180 - degrees(heading))`, and
 * `perf/FreeFlyCamera.headingOfYaw` is `yaw + PI`. Undo both, in that
 * order, or the recreated shot faces the opposite way and looks like a
 * different bug.
 */
function yawForBearing(bearing) {
  const headingDeg = ((180 - bearing) % 360 + 360) % 360;
  const heading = (headingDeg * Math.PI) / 180;
  return heading - Math.PI;
}

/**
 * The Chromium this environment actually has.
 *
 * Same rule the other probes follow: never run `playwright install` from
 * a probe. PLAYWRIGHT_BROWSERS_PATH points at a preinstalled browser here
 * and Playwright default path may name a build that was never fetched.
 */
function chromiumPath() {
  const override = process.env.PLAYWRIGHT_CHROMIUM;
  if (override) {
    if (existsSync(override)) return override;
    throw new Error(`PLAYWRIGHT_CHROMIUM=${override} does not exist`);
  }
  if (existsSync(chromium.executablePath())) return undefined;
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const linked = browsers ? path.join(browsers, "chromium") : null;
  if (linked && existsSync(linked)) return linked;
  throw new Error("no Chromium found; this probe never runs `playwright install`");
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

async function cameraAt(page) {
  const hit = /x (-?[\d.]+) y (-?[\d.]+) z (-?[\d.]+)/.exec(await uiText(page));
  if (!hit) return null;
  return { x: Number(hit[1]), y: Number(hit[2]), z: Number(hit[3]) };
}

async function main() {
  if (!existsSync(DIST_INDEX)) {
    fail('dist/index.html is missing. Run `npm run build` first.');
    process.exitCode = 1;
    return;
  }
  const want = {
    x: Number(arg('x', '-2182444.3')),
    y: Number(arg('y', '3442.3')),
    z: Number(arg('z', '-477632.6')),
    bearing: Number(arg('facing', '12')),
    pitch: Number(arg('pitch', '-0.2')),
  };
  const name = arg('name', 'shot');
  const frames = Number(arg('frames', '30'));
  if (!Number.isFinite(want.x) || !Number.isFinite(want.y) || !Number.isFinite(want.z)) {
    fail('--x, --y and --z must be numbers, as printed by the HUD');
    process.exitCode = 1;
    return;
  }

  mkdirSync(SHOTS, { recursive: true });
  let server = null;
  let browser = null;
  try {
    server = await preview({ preview: { port: 4186, strictPort: true }, logLevel: 'silent' });
    const url = server.resolvedUrls.local[0];
    browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (error) => fail(`uncaught page error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') fail(`console error: ${message.text()}`);
    });

    // The save has to exist before the app reads it, so the page is
    // opened once for its origin, seeded, and reloaded.
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(({ key, save }) => window.localStorage.setItem(key, JSON.stringify(save)), {
      key: SAVE_KEY,
      save: {
        version: SAVE_VERSION,
        savedAt: '2026-01-01T00:00:00.000Z',
        mapId: MAP_ID,
        camera: {
          at: { wx: want.x, wz: want.z },
          height: want.y,
          yaw: yawForBearing(want.bearing),
          pitch: want.pitch,
        },
      },
    });
    await page.reload({ waitUntil: 'load' });

    log(`resuming at x ${want.x} y ${want.y} z ${want.z}, facing ${want.bearing}°, pitch ${want.pitch}`);
    await page.waitForSelector('[data-action="resume"]', { timeout: TIMEOUT.menu });
    await page.click('[data-action="resume"]', { timeout: TIMEOUT.menu });
    await page.waitForSelector('[data-action="pause"]', { timeout: TIMEOUT.world });
    await runFrames(page, frames);

    // ARRIVED WHERE IT WAS ASKED TO? The whole probe rests on render
    // position equalling world position in this scene. If the world ever
    // starts rebasing its origin, the save's world pose and the HUD's
    // render readout stop agreeing and every shot after that is of
    // somewhere else — silently, and while still looking like the sea.
    const at = await cameraAt(page);
    if (at === null) {
      fail('the HUD printed no camera position, so the pose could not be confirmed');
    } else {
      const off = Math.hypot(at.x - want.x, at.z - want.z);
      if (off > ARRIVED_WITHIN) {
        fail(`asked for x ${want.x} z ${want.z} and arrived at x ${at.x} z ${at.z} — ${off.toFixed(0)} units away. `
          + 'Render position is no longer world position here; this probe cannot place a camera by HUD numbers any more.');
      } else {
        log(`arrived within ${off.toFixed(1)} units of the pose asked for`);
      }
    }

    const file = path.join(SHOTS, `${name}.png`);
    await page.screenshot({ path: file });
    log(`saved ${path.relative(ROOT, file)}`);
    log(`HUD reads: ${(await uiText(page)).slice(0, 220)}`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await browser?.close();
    await server?.close();
  }
  if (failures === 0) log('shot taken');
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
