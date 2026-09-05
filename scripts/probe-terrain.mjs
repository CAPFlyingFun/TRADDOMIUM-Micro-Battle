/**
 * THE TERRAIN PROBE: is Kauaʻi actually on the screen, and what did it
 * cost to put it there?
 *
 * A screenshot is not evidence on its own — a blue rectangle photographs
 * exactly like an ocean. So this drives the bare URL to the world the way
 * a player does (NEW GAME → SOLO → slot 1, no `?scene=`, no query at all)
 * and then asks the PIXELS four questions the empty world would fail:
 *
 *  1. THE LAYERS ROW SAYS TERRAIN IS BUILT. §2.9: a control that looks
 *     functional and is not is the thing this project does not ship.
 *  2. THE GROUND IS NOT THE SKY. The horizon colour is one known value;
 *     if most of the lower screen is still that colour, nothing was
 *     drawn and the check says so instead of saving a pretty picture.
 *  3. IT HAS SHAPE. A flat fill is what a broken heightfield looks like.
 *     The measure is LOCAL STRUCTURE — the mean brightness step between
 *     neighbouring pixels — see `reliefStructure` for the two measures
 *     that were tried before it and what was wrong with each.
 *  4. IT MOVES WITH THE CAMERA. Flying and re-photographing must change
 *     the picture, or what is drawn is a skybox rather than a world.
 *
 * It also reports the frame rate and the resident tile count. THE FRAME
 * RATE IS SWIFTSHADER'S AND IS NOT A PHONE'S — it is evidence the loop
 * runs, never a number to tune against (CLAUDE.md).
 *
 * Usage:
 *
 *     npm run build && npm run probe:terrain
 *
 * Shots (gitignored): `shots/terrain-first.png` on arrival,
 * `shots/terrain-flown.png` after flying, `shots/terrain-off.png` with
 * the layer switched off — which is what the empty world looks like, and
 * is the control for check 2.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { preview } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const SHOTS = path.join(ROOT, 'shots');
const SHOT_FIRST = path.join(SHOTS, 'terrain-first.png');
const SHOT_FLOWN = path.join(SHOTS, 'terrain-flown.png');
const SHOT_OFF = path.join(SHOTS, 'terrain-off.png');

const VIEWPORT = { width: 932, height: 430 };
const SLOT_ONE = '[data-action="slot:1"]';
const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'];

/** `HORIZON` in PerformanceWorldScene.ts — the colour the sky and the fog are. */
const HORIZON = { r: 0x9d, g: 0xb6, b: 0xc6 };
/** How far a pixel must be from the horizon colour to count as something drawn. */
const NOT_SKY = 18;

const TIMEOUT = { menu: 60_000, slots: 15_000, world: 120_000, frames: 180_000 };
const FRAMES = 40;

const failures = [];
const consoleErrors = [];
const pageErrors = [];
const log = (m) => console.log(`[probe:terrain] ${m}`);
const fail = (m) => {
  failures.push(m);
  console.error(`[probe:terrain] FAIL: ${m}`);
};

function chromiumPath() {
  const override = process.env.PLAYWRIGHT_CHROMIUM;
  if (override) {
    if (existsSync(override)) return override;
    throw new Error(`PLAYWRIGHT_CHROMIUM=${override} does not exist`);
  }
  const pinned = chromium.executablePath();
  if (existsSync(pinned)) return undefined;
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const linked = browsers ? path.join(browsers, 'chromium') : null;
  if (linked && existsSync(linked)) return linked;
  throw new Error('no Chromium found; this probe never runs `playwright install`');
}

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms / 1000} s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function runFrames(page, count) {
  const run = page.evaluate(
    (n) =>
      new Promise((resolve) => {
        const started = performance.now();
        let seen = 0;
        const step = () => {
          seen += 1;
          if (seen >= n) resolve(performance.now() - started);
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    count,
  );
  return withTimeout(run, TIMEOUT.frames, `${count} animation frames`);
}

const uiText = async (page) => {
  const t = await page.evaluate(() => (document.getElementById('ui') ?? document.body).innerText);
  return t.replace(/\s+/g, ' ').trim();
};

/**
 * A PNG reader, inline rather than a dependency.
 *
 * Playwright's screenshots are 8-bit RGBA, non-interlaced, which is the
 * one case worth handling; anything else throws rather than guessing.
 * Node brings the zlib, so what is left is walking the IDAT bytes and
 * undoing the five filters — thirty lines, against adding a package to
 * the build for a probe.
 */
function readPng(buffer) {
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  const idat = [];
  let at = 8; // the signature
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('ascii', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colourType = body[9];
      if (body[12] !== 0) throw new Error('interlaced PNG: this reader does not handle one');
    } else if (type === 'IDAT') idat.push(Buffer.from(body));
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (bitDepth !== 8 || (colourType !== 6 && colourType !== 2)) {
    throw new Error(`PNG is depth ${bitDepth} type ${colourType}; this reader handles 8-bit RGB/RGBA`);
  }
  const channels = colourType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let value = row[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = value & 0xff;
    }
    prev = row;
    for (let x = 0; x < width; x += 1) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      out[to] = row[from];
      out[to + 1] = row[from + 1];
      out[to + 2] = row[from + 2];
      out[to + 3] = channels === 4 ? row[from + 3] : 255;
    }
  }
  return { width, height, data: out };
}

async function shoot(page, file) {
  mkdirSync(SHOTS, { recursive: true });
  const buffer = await page.screenshot({ path: file });
  return readPng(buffer);
}

/** How far a pixel is from the horizon colour, as a plain channel distance. */
const fromSky = (png, x, y) => {
  const i = (png.width * y + x) * 4;
  return Math.max(
    Math.abs(png.data[i] - HORIZON.r),
    Math.abs(png.data[i + 1] - HORIZON.g),
    Math.abs(png.data[i + 2] - HORIZON.b),
  );
};

/** The fraction of the lower half of the picture that is not the sky colour. */
function groundFraction(png) {
  let drawn = 0;
  let total = 0;
  for (let y = Math.floor(png.height / 2); y < png.height; y += 2) {
    for (let x = 0; x < png.width; x += 2) {
      total += 1;
      if (fromSky(png, x, y) > NOT_SKY) drawn += 1;
    }
  }
  return total === 0 ? 0 : drawn / total;
}

/**
 * How much the brightness varies down a vertical scan, as a standard
 * deviation in 0..255. A flat fill is near zero however colourful it is;
 * ground with shape in it is not.
 */
/**
 * How much LOCAL STRUCTURE the lower frame has: the mean absolute
 * brightness step between neighbouring pixels.
 *
 * This is the third measure tried, and the first that is about the thing
 * being asked. A flat fill has no local variation whatever its colour or
 * brightness; ground with ridges, valleys and one-sided lighting does,
 * and keeps doing so when the whole picture gets darker, lighter or
 * hazier. The two that came before both measured the wrong thing:
 *
 *  - distinct quantised colours down the middle column: called a real lit
 *    hillside flat, because a smooth gradient of one hue is exactly what
 *    a hillside looks like;
 *  - the standard deviation of brightness across the frame: a number with
 *    no natural threshold, which moved from 6.0 to 5.3 on a lighting
 *    change that made the picture strictly better. A check calibrated to
 *    one screenshot fails for reasons that are not defects.
 */
function reliefStructure(png) {
  let sum = 0;
  let n = 0;
  const lum = (x, y) => {
    const i = (png.width * y + x) * 4;
    return png.data[i] * 0.3 + png.data[i + 1] * 0.59 + png.data[i + 2] * 0.11;
  };
  for (let y = Math.floor(png.height * 0.45); y < png.height - 1; y += 2) {
    for (let x = 0; x < png.width - 2; x += 2) {
      sum += Math.abs(lum(x, y) - lum(x + 2, y)) + Math.abs(lum(x, y) - lum(x, y + 1));
      n += 2;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/** Pixels that are EXACTLY the horizon colour below the horizon: seams the sky leaks through. */
function skyLeaks(png) {
  let leaks = 0;
  for (let y = Math.floor(png.height * 0.62); y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const i = (png.width * y + x) * 4;
      if (png.data[i] === HORIZON.r && png.data[i + 1] === HORIZON.g && png.data[i + 2] === HORIZON.b) leaks += 1;
    }
  }
  return leaks;
}

/** How many pixels of two shots differ at all. */
function changed(a, b) {
  if (a.width !== b.width || a.height !== b.height) return Infinity;
  let n = 0;
  for (let y = 0; y < a.height; y += 2) {
    for (let x = 0; x < a.width; x += 2) {
      const i = (a.width * y + x) * 4;
      if (Math.abs(a.data[i] - b.data[i]) > 6 || Math.abs(a.data[i + 2] - b.data[i + 2]) > 6) n += 1;
    }
  }
  return n;
}

async function drive(page, url) {
  log(`opening the bare URL ${url} at ${VIEWPORT.width}×${VIEWPORT.height}`);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('[data-action="new-game"]', { timeout: TIMEOUT.menu });
  await page.click('[data-action="new-game"]', { timeout: TIMEOUT.menu });
  await page.click('[data-action="solo"]', { timeout: TIMEOUT.menu });
  await page.waitForSelector(SLOT_ONE, { state: 'attached', timeout: TIMEOUT.slots });
  await page.click(SLOT_ONE, { timeout: TIMEOUT.menu });

  log('waiting for the world (this includes the 2 MB survey)');
  await page.waitForSelector('[data-action="pause"]', { timeout: TIMEOUT.world });
  const ms = await runFrames(page, FRAMES);
  log(`${FRAMES} frames in ${Math.round(ms)} ms — ${(FRAMES / (ms / 1000)).toFixed(1)} fps under SwiftShader (NOT a phone)`);

  const text = await uiText(page);
  // 1. The layers row.
  if (!/terrain/i.test(text)) fail(`the HUD never names a terrain layer. UI reads: "${text}"`);
  else if (/terrain[^a-z]{0,4}not built/i.test(text)) fail('the HUD still reads "not built" for terrain');
  else log('the HUD lists terrain as a built layer');

  const first = await shoot(page, SHOT_FIRST);

  // 2. Is anything there?
  const ground = groundFraction(first);
  log(`${(ground * 100).toFixed(1)}% of the lower screen is not the sky colour`);
  if (ground < 0.5) fail(`only ${(ground * 100).toFixed(1)}% of the lower screen is drawn; the ground is missing`);

  // 3. Is it relief, or a flat fill?
  const structure = reliefStructure(first);
  log(`local brightness steps average ${structure.toFixed(2)} across the lower frame`);
  // CALIBRATED AGAINST BOTH POPULATIONS, not tucked under one reading:
  // the island measures 0.43-0.46 and the same frame with the layer
  // switched off — a genuinely flat fill — measures 0.000. The threshold
  // sits between them with room on each side, so it fails when the ground
  // stops having shape and not when the light changes.
  if (structure < 0.15) fail(`local brightness steps average only ${structure.toFixed(2)}; that is a flat fill, not terrain`);

  // 3b. THE SEAMS. Where a fine ring meets a coarse one the two edges must
  // coincide exactly; a T-junction left open is a hairline of sky, and the
  // sky's colour is a value nothing else in the picture has. Measured in
  // the bottom third, which is ground in this view whatever the terrain does.
  const leaks = skyLeaks(first);
  log(`${leaks} pixels of exact horizon colour in the lower third`);
  if (leaks > 0) fail(`${leaks} pixels of sky are showing through the ground; a ring seam is open`);

  // 4. Does it move with the camera?
  log('flying, then re-photographing');
  await page.mouse.move(466, 215);
  await page.mouse.down();
  await page.mouse.move(700, 150, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.down('w');
  await runFrames(page, 20);
  await page.keyboard.up('w');
  await runFrames(page, 10);
  const flown = await shoot(page, SHOT_FLOWN);
  const moved = changed(first, flown);
  log(`${moved} sampled pixels changed after flying`);
  if (moved < 500) fail(`only ${moved} pixels changed after flying; the ground is not moving with the camera`);

  // The control: switch the layer off and the sky should come back.
  const toggle = page.locator('[data-layer="terrain"] input, [data-action="layer:terrain"]').first();
  if ((await toggle.count()) > 0) {
    await toggle.click({ timeout: 10_000 }).catch(() => {});
    await runFrames(page, 10);
    const off = await shoot(page, SHOT_OFF);
    const offGround = groundFraction(off);
    log(`with the layer off, ${(offGround * 100).toFixed(1)}% of the lower screen is drawn`);
    if (offGround >= ground) fail('switching the terrain layer off drew no less than switching it on');
  } else {
    log('no terrain toggle control found in the HUD; skipping the off-control');
  }
}

async function main() {
  if (!existsSync(DIST_INDEX)) {
    fail('dist/index.html is missing. Run `npm run build` first.');
    process.exitCode = 1;
    return;
  }
  let server = null;
  let browser = null;
  try {
    server = await preview({
      root: ROOT,
      logLevel: 'silent',
      preview: { host: '127.0.0.1', port: 4183, strictPort: false, open: false },
    });
    const url = server.resolvedUrls?.local[0];
    if (!url) throw new Error('vite preview started but reported no local URL');
    log(`serving dist/ at ${url}`);
    browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
    const page = await browser.newPage({ viewport: VIEWPORT });
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    try {
      await drive(page, url);
    } finally {
      if (!existsSync(SHOT_FIRST)) await shoot(page, SHOT_FIRST).catch(() => {});
    }
  } catch (error) {
    fail(`unexpected: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  } finally {
    await browser?.close();
    await server?.close();
  }
  if (consoleErrors.length) fail(`${consoleErrors.length} console error(s):\n${consoleErrors.map((e) => `    ${e}`).join('\n')}`);
  if (pageErrors.length) fail(`${pageErrors.length} uncaught page error(s):\n${pageErrors.map((e) => `    ${e}`).join('\n')}`);
  if (failures.length) {
    console.error(`[probe:terrain] ${failures.length} failure(s)`);
    process.exitCode = 1;
  } else {
    log('every check passed');
  }
}

await main();
