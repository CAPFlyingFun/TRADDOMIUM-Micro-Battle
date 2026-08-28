/**
 * Slice Joshua's 4x4 action-button sheet into public/buttons/*.png.
 *
 *   node scripts/slice-buttons.mjs <sheet.png>
 *
 * The sheet is a transparent-background RGBA PNG of gold coin buttons,
 * 4 columns by 4 rows, read row-major into the names below.
 *
 * THE COINS ARE FOUND, NOT ASSUMED. The first cut of this script took
 * blind quarters and the MENU coin came out with its crown clipped —
 * the art does not sit exactly on the grid. So the sheet's ALPHA is
 * segmented instead: connected opaque blobs on a downsampled copy,
 * the sixteen largest kept, sorted into grid order by centroid, and
 * each cropped from the full-resolution sheet by its own bounding box
 * (squared up and padded). Wherever a coin actually sits, it arrives
 * whole.
 *
 * Decoded and re-encoded through a headless canvas (the repo carries
 * no image library, and the browser is already here for the probes);
 * a data URI keeps the canvas untainted.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const NAMES = [
  'fly', 'dive', 'drink', 'eat',
  'attack', 'sting', 'dig', 'build',
  'scout', 'nest', 'pickup', 'drop',
  'call', 'map', 'rest', 'menu',
];
/** Transparent breathing room added around each coin's bounding box. */
const PAD = 6;

const sheet = process.argv[2];
if (!sheet) throw new Error('usage: node scripts/slice-buttons.mjs <sheet.png>');
const data = `data:image/png;base64,${readFileSync(sheet).toString('base64')}`;

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
const page = await browser.newPage();
const result = await page.evaluate(async ({ uri, pad, count }) => {
  const img = new Image();
  img.src = uri;
  await img.decode();

  // Segment on a quarter-scale copy — plenty for blob-finding, and
  // sixteen times fewer pixels to walk.
  const SCALE = 4;
  const sw = Math.floor(img.width / SCALE);
  const sh = Math.floor(img.height / SCALE);
  const small = document.createElement('canvas');
  small.width = sw; small.height = sh;
  const sg = small.getContext('2d');
  sg.drawImage(img, 0, 0, sw, sh);
  const alpha = sg.getImageData(0, 0, sw, sh).data;
  const solid = (x, y) => alpha[(y * sw + x) * 4 + 3] > 16;

  // Connected components, 4-neighbour, iterative BFS.
  const seen = new Uint8Array(sw * sh);
  const blobs = [];
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (seen[y * sw + x] || !solid(x, y)) continue;
      let minX = x, maxX = x, minY = y, maxY = y, size = 0;
      const queue = [[x, y]];
      seen[y * sw + x] = 1;
      while (queue.length) {
        const [cx, cy] = queue.pop();
        size++;
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
          if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue;
          if (seen[ny * sw + nx] || !solid(nx, ny)) continue;
          seen[ny * sw + nx] = 1;
          queue.push([nx, ny]);
        }
      }
      blobs.push({ minX, maxX, minY, maxY, size });
    }
  }

  // The sixteen coins are the sixteen big blobs; dust (JPEG-edge
  // specks, stray glints) is whatever is left. Grid order = centroid
  // rows then columns.
  blobs.sort((a, b) => b.size - a.size);
  const coins = blobs.slice(0, count).map((b) => ({
    ...b,
    cx: (b.minX + b.maxX) / 2,
    cy: (b.minY + b.maxY) / 2,
  }));
  const rowSpan = sh / 4;
  coins.sort((a, b) => {
    const ra = Math.floor(a.cy / rowSpan);
    const rb = Math.floor(b.cy / rowSpan);
    return ra !== rb ? ra - rb : a.cx - b.cx;
  });

  // Crop each from FULL resolution: bbox scaled back up, squared to
  // the longer side, padded, clamped to the sheet.
  return coins.map((b) => {
    const x0 = b.minX * SCALE, x1 = (b.maxX + 1) * SCALE;
    const y0 = b.minY * SCALE, y1 = (b.maxY + 1) * SCALE;
    const side = Math.max(x1 - x0, y1 - y0) + pad * 2;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const left = Math.max(0, Math.min(img.width - side, Math.round(cx - side / 2)));
    const top = Math.max(0, Math.min(img.height - side, Math.round(cy - side / 2)));
    const c = document.createElement('canvas');
    c.width = side; c.height = side;
    c.getContext('2d').drawImage(img, left, top, side, side, 0, 0, side, side);
    return { png: c.toDataURL('image/png').split(',')[1], side, left, top };
  });
}, { uri: data, pad: PAD, count: NAMES.length });
await browser.close();

if (result.length !== NAMES.length) {
  throw new Error(`found ${result.length} coins, expected ${NAMES.length}`);
}
mkdirSync('public/buttons', { recursive: true });
result.forEach((tile, i) => {
  writeFileSync(`public/buttons/${NAMES[i]}.png`, Buffer.from(tile.png, 'base64'));
  console.log(`${NAMES[i].padEnd(7)} ${tile.side}px @ ${tile.left},${tile.top}`);
});
