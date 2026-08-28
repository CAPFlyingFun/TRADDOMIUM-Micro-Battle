/**
 * Slice Joshua's 4x4 action-button sheet into public/buttons/*.png.
 *
 *   node scripts/slice-buttons.mjs <sheet.png>
 *
 * The sheet is a transparent-background RGBA PNG of gold coin buttons,
 * 4 columns by 4 rows, read row-major into the names below. Decoded
 * and re-encoded through a headless canvas (the repo carries no image
 * library, and the browser is already here for the probes); a data URI
 * keeps the canvas untainted. Alpha is preserved, and each tile's
 * corner alpha is reported so a sheet that turns out NOT to be
 * transparent announces itself instead of shipping a black square.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const NAMES = [
  'fly', 'dive', 'drink', 'eat',
  'attack', 'sting', 'dig', 'build',
  'scout', 'nest', 'pickup', 'drop',
  'call', 'map', 'rest', 'menu',
];

const sheet = process.argv[2];
if (!sheet) throw new Error('usage: node scripts/slice-buttons.mjs <sheet.png>');
const data = `data:image/png;base64,${readFileSync(sheet).toString('base64')}`;

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
const page = await browser.newPage();
const tiles = await page.evaluate(async (uri) => {
  const img = new Image();
  img.src = uri;
  await img.decode();
  const tw = img.width / 4;
  const th = img.height / 4;
  const out = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const c = document.createElement('canvas');
      c.width = tw; c.height = th;
      const g = c.getContext('2d');
      g.drawImage(img, col * tw, row * th, tw, th, 0, 0, tw, th);
      const corner = g.getImageData(2, 2, 1, 1).data[3];
      out.push({ png: c.toDataURL('image/png').split(',')[1], corner });
    }
  }
  return { tiles: out, tw, th };
}, data);
await browser.close();

mkdirSync('public/buttons', { recursive: true });
tiles.tiles.forEach((tile, i) => {
  writeFileSync(`public/buttons/${NAMES[i]}.png`, Buffer.from(tile.png, 'base64'));
  console.log(
    `${NAMES[i].padEnd(7)} ${tiles.tw}x${tiles.th}  corner alpha ${tile.corner}`,
  );
});
