/**
 * TURN THE ARTWORK INTO ASSETS THE GAME CAN AFFORD, AND FIND THE BAR.
 *
 * Joshua's splash arrives as a 4.7 MB PNG with the loading bar's
 * interior CUT OUT — a transparent rectangle in the middle of the
 * forest. That cutout is the whole architecture: the picture is not a
 * backdrop with a bar drawn near it, it is the FRONT layer of a
 * three-layer sandwich, and the bar is whatever shows through the hole.
 *
 *     front   the splash, with a hole in it        <- this file
 *     middle  a plain rectangle that changes width
 *     back    a plain dark rectangle
 *
 * Nothing underneath has to be the right shape, because the hole
 * decides the shape. It is the trick Joshua uses in GameMaker and it is
 * the reason this stopped being fiddly.
 *
 * So the bake does two jobs: make the picture small enough to be the
 * first thing on screen (4.7 MB is not), and MEASURE THE HOLE, writing
 * it out as a module the screens import. Re-cut the art and the numbers
 * follow it — nobody has to remember to update a percentage.
 *
 *     npm run bake:art
 *
 * Reads art/, writes public/ and src/ui/splash/splashFrame.ts. Paths are
 * resolved from this file, not the working directory, so the command
 * gives the same answer from anywhere.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const FRAME_MODULE = path.join(ROOT, 'src', 'ui', 'splash', 'splashFrame.ts');

/**
 * The splash masters, one per orientation, each with the loading bar's
 * interior cut out. The game is landscape, but the boot screen appears
 * before anyone has been asked to turn the phone — so the picture that
 * greets a portrait phone has to be composed for one.
 */
const SPLASHES = [
  // CUT OUT: the bar's interior is missing from the artwork, so the
  // fill shows through it and the picture is the front layer.
  {
    key: 'LANDSCAPE', kind: 'cutout',
    source: 'art/splash-cutout.png', out: 'splash.webp', width: 1600,
  },
  // DRAWN: a plain picture, and the bar is built in CSS on top of it.
  // Simpler to re-art — there is nothing to cut and nothing to line up
  // — and it is the only way to keep the bar off the crop on a tall
  // phone, since a drawn bar can be sized against the SCREEN while the
  // picture is sized against itself. `bar` is measured from where the
  // wordmark actually ends, not typed: gap below it, then thickness,
  // both as fractions of the picture's height.
  {
    key: 'PORTRAIT', kind: 'drawn',
    source: 'art/splash-portrait-source.jpg', out: 'splash-portrait.webp', width: 1080,
    bar: { gap: 0.052, height: 0.012, left: 0.12, right: 0.88 },
  },
];
const ICON = 'art/icon-source.png';

/** The forest floor at the edge of the icon art, carried out to the corners of the maskable one. */
const FOREST = '#0d1408';

/**
 * Where this machine keeps a Chromium when Playwright's own pinned
 * revision is not installed. Never `playwright install`: the browser is
 * preinstalled here, and a bake that downloads one is a bake that runs
 * differently on the next machine.
 */
const FALLBACK_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/**
 * Same order as scripts/probe-boot.mjs: an explicit override, Playwright's
 * pinned path when it exists, the known fallback, then the `chromium`
 * link under PLAYWRIGHT_BROWSERS_PATH. Anything else is a clear failure.
 */
function chromiumPath() {
  const override = process.env.PLAYWRIGHT_CHROMIUM;
  if (override) {
    if (existsSync(override)) return override;
    throw new Error(`PLAYWRIGHT_CHROMIUM=${override} does not exist`);
  }
  if (existsSync(chromium.executablePath())) return undefined;
  if (existsSync(FALLBACK_CHROMIUM)) return FALLBACK_CHROMIUM;
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const linked = browsers ? path.join(browsers, 'chromium') : null;
  if (linked && existsSync(linked)) return linked;
  throw new Error(
    `no Chromium found: Playwright expects ${chromium.executablePath()}, ${FALLBACK_CHROMIUM} is absent, ` +
      `${linked ?? 'PLAYWRIGHT_BROWSERS_PATH is unset'} too. Point PLAYWRIGHT_CHROMIUM at a chrome binary.`,
  );
}

const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });

const asDataUrl = (rel) => {
  const kind = rel.endsWith('.jpg') || rel.endsWith('.jpeg') ? 'jpeg' : 'png';
  return `data:image/${kind};base64,${readFileSync(path.join(ROOT, rel)).toString('base64')}`;
};

/**
 * Redraw one source at a target size.
 *
 * `cover` fills the frame and crops the overflow. `pad` shrinks the
 * whole picture inside the frame instead, which is what a maskable icon
 * needs — Android crops icons to a circle, and the wordmark runs the
 * full width of the square art, so an uncropped draw loses the T and
 * the M. Alpha is preserved unless a `ground` is given to flatten onto.
 */
async function bake({ source, out, width, height, type, quality, pad = 0, ground, scrub }) {
  const encoded = await page.evaluate(async (job) => {
    const img = new Image();
    img.src = job.src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = job.width;
    canvas.height = job.height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    if (job.ground) {
      ctx.fillStyle = job.ground;
      ctx.fillRect(0, 0, job.width, job.height);
    }
    const box = { w: job.width * (1 - job.pad * 2), h: job.height * (1 - job.pad * 2) };
    const scale = Math.max(box.w / img.width, box.h / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (job.width - w) / 2, (job.height - h) / 2, w, h);

    // SCRUB THE HOLE. An editor leaves things behind: this art came
    // with a four-pixel column of ten-per-cent alpha across the middle
    // of the bar, which would have drawn a faint dark hairline over the
    // fill for the life of the game. Rather than notice it by eye every
    // time the art is re-cut, the hole is simply re-erased — inset by a
    // couple of pixels so the antialiased rim the artist drew survives.
    if (job.scrub) {
      const s = job.scrub;
      const x0 = s.left * job.width;
      const x1 = s.right * job.width;
      const y0 = s.top * job.height;
      const y1 = s.bottom * job.height;
      const inset = 2;
      const r = Math.max(0, (y1 - y0) / 2 - inset);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.roundRect(x0 + inset, y0 + inset, (x1 - x0) - inset * 2, (y1 - y0) - inset * 2, r);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    return canvas.toDataURL(job.type, job.quality);
  }, { src: asDataUrl(source), width, height, type, quality, pad, ground, scrub });

  const bytes = Buffer.from(encoded.split(',')[1], 'base64');
  writeFileSync(path.join(PUBLIC, out), bytes);
  console.log(
    `  public/${out.padEnd(24)} ${String(width).padStart(4)}x${String(height).padEnd(4)}  ` +
      `${String((bytes.length / 1024).toFixed(0)).padStart(4)} KB`,
  );
}

/**
 * FIND THE HOLE, rather than being told where it is.
 *
 * Every pixel the artist erased is fully transparent, so the window is
 * simply the bounding box of alpha. No heuristics, no thresholds on
 * colour, nothing to go wrong when the art changes.
 */
async function findWindow(source) {
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    let x0 = Infinity; let x1 = -1; let y0 = Infinity; let y1 = -1; let clear = 0;
    for (let y = 0; y < img.height; y++) {
      for (let px = 0; px < img.width; px++) {
        if (d[(y * img.width + px) * 4 + 3] < 16) {
          clear++;
          if (px < x0) x0 = px;
          if (px > x1) x1 = px;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    return {
      width: img.width,
      height: img.height,
      clear,
      left: x0 / img.width,
      right: (x1 + 1) / img.width,
      top: y0 / img.height,
      bottom: (y1 + 1) / img.height,
    };
  }, asDataUrl(source));
}

/**
 * FIND WHERE THE WORDMARK ENDS, so a drawn bar can be put below it.
 *
 * The subtitle is near-white and neutral; everything else down there is
 * warm — lit path, moss, soil — so one test separates them. Measured
 * rather than typed because "just under the logo" is the whole design
 * intent, and it should survive the art being re-rendered an inch
 * further up.
 */
async function findLogoBottom(source) {
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    let bottom = -1;
    for (let y = Math.floor(img.height * 0.35); y < Math.floor(img.height * 0.85); y++) {
      let white = 0;
      for (let px = Math.floor(img.width * 0.12); px < Math.floor(img.width * 0.88); px++) {
        const i = (y * img.width + px) * 4;
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        if (r > 210 && g > 210 && b > 200 && Math.abs(r - b) < 42) white++;
      }
      if (white >= 10) bottom = y;
    }
    if (bottom < 0) return null;
    return { bottom: bottom / img.height, width: img.width, height: img.height };
  }, asDataUrl(source));
}

/**
 * Count pixels well inside the hole that are not fully transparent.
 *
 * Only reported, not acted on beyond the scrub in `bake` — but reported
 * loudly, because a leftover here is invisible in a paint program and
 * very visible over a bright fill.
 */
async function findSmudge(source, win) {
  return page.evaluate(async (job) => {
    const img = new Image();
    img.src = job.src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    const x0 = Math.round(job.win.left * img.width);
    const x1 = Math.round(job.win.right * img.width);
    const y0 = Math.round(job.win.top * img.height);
    const y1 = Math.round(job.win.bottom * img.height);
    // Well inside: past the rounded ends and clear of the rim.
    const inset = Math.round((y1 - y0) / 2) + 2;
    let dirty = 0;
    for (let y = y0 + 4; y <= y1 - 4; y++) {
      for (let px = x0 + inset; px <= x1 - inset; px++) {
        if (d[(y * img.width + px) * 4 + 3] > 2) dirty++;
      }
    }
    return dirty;
  }, { src: asDataUrl(source), win });
}

mkdirSync(PUBLIC, { recursive: true });

const cuts = [];
for (const splash of SPLASHES) {
  console.log(`${splash.out} — ${splash.kind}`);
  let win;
  let shape;

  if (splash.kind === 'cutout') {
    win = await findWindow(splash.source);
    if (!win) throw new Error(`${splash.source} has no transparent window cut in it`);
    shape = { width: win.width, height: win.height };
    const boxed = (win.right - win.left) * win.width * (win.bottom - win.top) * win.height;
    console.log(`  hole x ${(win.left * 100).toFixed(2)}% to ${(win.right * 100).toFixed(2)}%`);
    console.log(`  hole y ${(win.top * 100).toFixed(2)}% to ${(win.bottom * 100).toFixed(2)}%`);
    console.log(`  ${win.clear} clear pixels, ${((win.clear / boxed) * 100).toFixed(1)}% of that box`);
    // A stadium end costs a few per cent; much more than that and the
    // cutout is ragged, and the fill would show outside the drawn shape.
    if (win.clear / boxed < 0.85) {
      console.log('  WARNING: ragged cutout — the fill may show past the drawn shape');
    }
    const smudge = await findSmudge(splash.source, win);
    if (smudge > 0) {
      console.log(`  ${smudge} half-clear pixels inside the hole — scrubbing them out`);
    }
  } else {
    const logo = await findLogoBottom(splash.source);
    if (!logo) throw new Error(`${splash.source} — could not find where the wordmark ends`);
    shape = { width: logo.width, height: logo.height };
    const top = logo.bottom + splash.bar.gap;
    win = {
      left: splash.bar.left, right: splash.bar.right,
      top, bottom: top + splash.bar.height,
      width: logo.width, height: logo.height,
    };
    console.log(`  wordmark ends at ${(logo.bottom * 100).toFixed(2)}%`);
    console.log(`  bar y ${(win.top * 100).toFixed(2)}% to ${(win.bottom * 100).toFixed(2)}%`);
    if (win.bottom > 0.94) {
      console.log('  WARNING: the bar is very near the bottom of the picture');
    }
  }

  const height = Math.round(splash.width * (shape.height / shape.width));
  // WebP because a photograph with an alpha channel is a PNG the size
  // of the rest of the game, and every browser that can run three.js
  // has read WebP since 2020. Only a cut-out one needs its hole
  // re-erased; there is no hole in a drawn one to keep clean.
  await bake({
    source: splash.source, out: splash.out,
    width: splash.width, height, type: 'image/webp', quality: 0.82,
    scrub: splash.kind === 'cutout' ? win : undefined,
  });
  cuts.push({ ...splash, win, ratio: splash.width / height });
}

console.log('\nicons');
// 192 stays PNG: it is small either way and every launcher takes it.
await bake({ source: ICON, out: 'icon-192.png', width: 192, height: 192, type: 'image/png' });
// iOS reads this one and will not take a WebP.
await bake({ source: ICON, out: 'apple-touch-icon.png', width: 180, height: 180, type: 'image/png' });
// At 512 the artwork is a photograph, and PNG charges half a megabyte
// for one. WebP is a fifth of that for the same picture.
await bake({ source: ICON, out: 'icon-512.webp', width: 512, height: 512, type: 'image/webp', quality: 0.9 });
// Android crops a maskable icon to a circle and only guarantees the
// middle 80%. The wordmark reaches both edges of the square, so it is
// drawn inset with the forest floor carried out to the corners.
await bake({
  source: ICON, out: 'icon-maskable-512.webp',
  width: 512, height: 512, type: 'image/webp', quality: 0.9, pad: 0.11, ground: FOREST,
});

const asConst = (cut) => `export const SPLASH_${cut.key}: SplashCut = {
  file: '${cut.out}',
  kind: '${cut.kind}',
  left: ${cut.win.left.toFixed(5)},
  right: ${cut.win.right.toFixed(5)},
  top: ${cut.win.top.toFixed(5)},
  bottom: ${cut.win.bottom.toFixed(5)},
  ratio: ${cut.ratio.toFixed(5)},
};`;

writeFileSync(FRAME_MODULE, `/**
 * WHERE THE HOLE IS, AND WHAT SHAPE EACH PICTURE IS.
 *
 * GENERATED by scripts/bakeArt.mjs (\`npm run bake:art\`) — do not edit
 * by hand.
 *
 * Two of them, because the boot screen appears before anyone has been
 * asked to turn the phone and a landscape picture on a portrait phone
 * is either letterboxed or cropped to the middle of a tree. They work
 * differently on purpose:
 *
 *   CUTOUT  the bar's interior is missing from the artwork, so the
 *           picture is the FRONT layer and the fill shows through it.
 *           The rectangle is the bounding box of the art's own alpha.
 *   DRAWN   a plain picture, with the bar built in CSS on top. The
 *           rectangle is placed from where the wordmark actually ends.
 *
 * Either way these are measured at bake time, so new art moves them.
 * Pure data: nothing here touches the DOM, so it can be read anywhere.
 */
export interface SplashCut {
  /** Filename under the base URL. */
  readonly file: string;
  /** Whether the artwork carries the bar, or the bar is drawn on it. */
  readonly kind: 'cutout' | 'drawn';
  /** The bar's rectangle, as fractions of the picture's width and height. */
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  /** Width over height, so the box it sits in matches it exactly. */
  readonly ratio: number;
}

${cuts.map(asConst).join('\n\n')}

/** The one composed for the shape the screen is now. */
export function splashFor(wide: number, tall: number): SplashCut {
  return wide >= tall ? SPLASH_LANDSCAPE : SPLASH_PORTRAIT;
}
`);
console.log(`\n  ${path.relative(ROOT, FRAME_MODULE)} written`);

await browser.close();
