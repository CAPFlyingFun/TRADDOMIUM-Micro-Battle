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
 *   node scripts/bakeArt.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const CUTOUT = 'art/splash-cutout.png';   // the master: the art, with the hole
const ICON = 'art/icon-source.png';

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });

const asDataUrl = (path) =>
  `data:image/png;base64,${readFileSync(path).toString('base64')}`;

/**
 * Redraw one source at a target size.
 *
 * `cover` fills the frame and crops the overflow. `pad` shrinks the
 * whole picture inside the frame instead, which is what a maskable icon
 * needs — Android crops icons to a circle, and the wordmark runs the
 * full width of the square art, so an uncropped draw loses the T and
 * the M. Alpha is preserved unless a `ground` is given to flatten onto.
 */
async function bake({ source, out, width, height, type, quality, pad = 0, ground }) {
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
    return canvas.toDataURL(job.type, job.quality);
  }, { src: asDataUrl(source), width, height, type, quality, pad, ground });

  const bytes = Buffer.from(encoded.split(',')[1], 'base64');
  writeFileSync(out, bytes);
  console.log(`  ${out.padEnd(32)} ${String(width).padStart(4)}x${String(height).padEnd(4)}  ${String((bytes.length / 1024).toFixed(0)).padStart(4)} KB`);
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

console.log('the hole in the picture');
const win = await findWindow(CUTOUT);
if (!win) throw new Error(`${CUTOUT} has no transparent window cut in it`);
const boxed = (win.right - win.left) * win.width * (win.bottom - win.top) * win.height;
const solidness = win.clear / boxed;
console.log(`  x ${(win.left * 100).toFixed(2)}% to ${(win.right * 100).toFixed(2)}%`);
console.log(`  y ${(win.top * 100).toFixed(2)}% to ${(win.bottom * 100).toFixed(2)}%`);
console.log(`  ${win.clear} clear pixels, ${(solidness * 100).toFixed(1)}% of that box`);
// A window with ragged edges would still give a bounding box, and the
// fill would then show outside the shape the artist drew. Say so.
if (solidness < 0.92) {
  console.log('  WARNING: the cutout is not a clean rectangle — the fill may show past it');
}

const SPLASH_W = 1600;
const SPLASH_H = Math.round(SPLASH_W * (win.height / win.width));
const ratio = SPLASH_W / SPLASH_H;

console.log('\nsplash');
// The FRONT layer, alpha and all. WebP because a photograph with an
// alpha channel is a PNG the size of the whole rest of the game, and
// every browser that can run three.js has read WebP since 2020.
await bake({
  source: CUTOUT, out: 'public/splash.webp',
  width: SPLASH_W, height: SPLASH_H, type: 'image/webp', quality: 0.82,
});
console.log('\nicons');
const FOREST = '#0d1408';
// 192 stays PNG: it is small either way and every launcher takes it.
await bake({ source: ICON, out: 'public/icon-192.png', width: 192, height: 192, type: 'image/png' });
// iOS reads this one and will not take a WebP.
await bake({ source: ICON, out: 'public/apple-touch-icon.png', width: 180, height: 180, type: 'image/png' });
// At 512 the artwork is a photograph, and PNG charges half a megabyte
// for one. WebP is a fifth of that for the same picture.
await bake({ source: ICON, out: 'public/icon-512.webp', width: 512, height: 512, type: 'image/webp', quality: 0.9 });
// Android crops a maskable icon to a circle and only guarantees the
// middle 80%. The wordmark reaches both edges of the square, so it is
// drawn inset with the forest floor carried out to the corners.
await bake({
  source: ICON, out: 'public/icon-maskable-512.webp',
  width: 512, height: 512, type: 'image/webp', quality: 0.9, pad: 0.11, ground: FOREST,
});

writeFileSync('src/ui/splashFrame.ts', `/**
 * WHERE THE HOLE IS, AND WHAT SHAPE THE PICTURE IS.
 *
 * GENERATED by scripts/bakeArt.mjs — do not edit by hand.
 *
 * The splash is the FRONT layer of the bar: a picture with the bar's
 * interior cut out of it. The progress fill goes behind, and only the
 * part of it framed by this hole is ever seen. These fractions are
 * measured off the artwork's alpha channel at bake time, so re-cutting
 * the art moves them with it.
 */
export const SPLASH_WINDOW = {
  left: ${win.left.toFixed(5)},
  right: ${win.right.toFixed(5)},
  top: ${win.top.toFixed(5)},
  bottom: ${win.bottom.toFixed(5)},
} as const;

/** The picture's own shape, so the box it sits in matches it exactly. */
export const SPLASH_RATIO = ${ratio.toFixed(5)};
`);
console.log('\n  src/ui/splashFrame.ts written');

await browser.close();
