/**
 * INSTALL AN AUTHORED PBR SET AS A BAND.
 *
 *   node scripts/install-pbr-band.mjs <band> <folder>
 *
 * For a band that has real scanned maps, those beat anything derived
 * from the colour: measured against Ground054's own normal, a normal
 * derived from its displacement map could not get below 16.7 degrees of
 * error, on a map carrying only 15.5 degrees of tilt in the first place
 * — no better than guessing flat. Where a set exists, ship it.
 *
 * RESOLUTION IS PRESERVED EXACTLY; only the encoding changes (Joshua:
 * "do not change the pixels, but if you can just compress keeping the
 * same texture resolution"). The normal goes to WebP rather than a
 * smaller JPEG because chroma subsampling lands squarely on a normal
 * map's x and y — 4.6 degrees against JPEG's 5.2 at the same size.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const [band, folder] = process.argv.slice(2);
if (!band || !folder) { console.error('usage: install-pbr-band.mjs <band> <folder>'); process.exit(1); }

/**
 * Needles are tried IN ORDER, and the first that matches anything wins.
 * Matching "the first file that matches any needle" instead picked
 * NormalDX over NormalGL purely on directory order — and DX carries an
 * inverted green channel, so every grain of sand would have lit as a
 * pit. Priority belongs to the needle, not the readdir.
 */
const find = (...needles) => {
  const files = readdirSync(folder).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));
  for (const needle of needles) {
    const hit = files.find((f) => f.toLowerCase().includes(needle));
    if (hit) return `${folder}/${hit}`;
  }
  return null;
};
const sources = {
  colour: find('_color', 'basecolor', 'albedo'),
  normal: find('normalgl', '_normal'),
  rough: find('roughness'),
  ao: find('ambientocclusion', '_ao'),
};
for (const [k, v] of Object.entries(sources)) console.log(`${k.padEnd(7)} ${v ?? '(none)'}`);

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
try {
  const page = await browser.newPage();
  const uri = (f) => `data:image/${f.toLowerCase().endsWith('png') ? 'png' : 'jpeg'};base64,`
    + readFileSync(f).toString('base64');

  const jobs = [
    ['colour', sources.colour, `public/kauai-tex/${band}.jpg`, 'image/jpeg', 0.90, false],
    ['normal', sources.normal, `public/kauai-tex/${band}-normal.webp`, 'image/webp', 0.94, false],
    ['rough', sources.rough, `public/kauai-tex/${band}-rough.webp`, 'image/webp', 0.90, true],
    ['ao', sources.ao, `public/kauai-tex/${band}-ao.webp`, 'image/webp', 0.90, true],
  ];
  for (const [name, src, dest, type, quality, grey] of jobs) {
    if (!src || !existsSync(src)) { console.log(`${name.padEnd(7)} SKIPPED`); continue; }
    const data = await page.evaluate(async ({ uri, type, quality, grey }) => {
      const img = new Image(); img.src = uri; await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;   // never resampled
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      if (grey) {
        // One channel carried three ways costs nothing to encode and
        // keeps the decode trivially readable as .r in the shader.
        const id = x.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < id.data.length; i += 4) {
          id.data[i + 1] = id.data[i + 2] = id.data[i];
        }
        x.putImageData(id, 0, 0);
      }
      return { size: c.width, url: c.toDataURL(type, quality) };
    }, { uri: uri(src), type, quality, grey });
    const bytes = Buffer.from(data.url.split(',')[1], 'base64');
    writeFileSync(dest, bytes);
    const was = readFileSync(src).length;
    console.log(`${name.padEnd(7)} ${data.size}² ${(was/1024).toFixed(0)}k -> `
      + `${(bytes.length/1024).toFixed(0)}k  ${dest}`);
  }
} finally { await browser.close(); }
