/**
 * GROUND PBR FROM THE COLOUR MAPS — Joshua's Local Texture Lab, ported
 * and run over every band at once.
 *
 * THIS WRITES PREVIEWS, NOT ASSETS. The game derives the same height
 * field on the GPU at load (src/world/groundRelief.ts), because a
 * derived map is a pure function of a colour map the player already
 * downloaded and shipping it twice cost more than it was worth: seven
 * bands of normal are 14 MB lossless, and lossy is not merely
 * expensive but wrong — WebP carries R and B through the chroma path
 * and a normal map's x and y ARE its red and green, which measured 21
 * degrees of mean angular error at q92.
 *
 * What this is for is JUDGING THE DIALS AS IMAGES before judging them
 * as lighting. Keep its defaults and RELIEF_DIALS in step; when they
 * disagree, RELIEF_DIALS is what ships.
 *
 *   node scripts/bake-ground-pbr.mjs [band ...]
 *
 * The lab derives a height field from an image's luminance — a blurred
 * "large form" pass mixed with the high-frequency residue, contrasted
 * and levelled — and from that height it makes a normal, a roughness
 * and an ambient-occlusion map. Every step below is that same maths,
 * constant for constant, including the wrap-around box blur that keeps
 * a tiling texture tiling. It runs in a headless Chromium for one
 * reason: the lab is canvas code, and the surest way to get the same
 * numbers out is to run it on the same canvas.
 *
 * WHAT IT DOES NOT DO is the lab's "make edges tile smoothly" pass.
 * These seven maps already tile, and cross-fading their borders here
 * would move the derived maps off the colour maps we ship — a normal
 * that disagrees with its own texture at the seam is worse than a seam.
 *
 * Defaults are the lab's own (height contrast 125, large form 62, fine
 * detail 35, levels 4..96, normal strength 125 with +Y, roughness 78
 * varying 22, AO 55 at radius 4) and every one is overridable:
 *
 *   NORMAL_STRENGTH=180 node scripts/bake-ground-pbr.mjs cliff
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BANDS = ['reef', 'sand', 'grass', 'jungle', 'cliff', 'mountain', 'snow'];
const want = process.argv.slice(2).filter((a) => BANDS.includes(a));
const bands = want.length ? want : BANDS;

/** The lab's controls, as numbers. Env overrides each. */
const dial = {
  heightContrast: +(process.env.HEIGHT_CONTRAST ?? 125),
  largeForm: +(process.env.LARGE_FORM ?? 62),
  imageDetail: +(process.env.IMAGE_DETAIL ?? 35),
  heightLow: +(process.env.HEIGHT_LOW ?? 4),
  heightHigh: +(process.env.HEIGHT_HIGH ?? 96),
  normalStrength: +(process.env.NORMAL_STRENGTH ?? 125),
  openGL: (process.env.NORMAL_Y ?? '1') !== '0',
  roughness: +(process.env.ROUGHNESS ?? 78),
  roughVariation: +(process.env.ROUGH_VARIATION ?? 22),
  aoStrength: +(process.env.AO_STRENGTH ?? 55),
  aoRadius: +(process.env.AO_RADIUS ?? 4),
  invert: process.env.INVERT_HEIGHT === '1',
};

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
const page = await browser.newPage();

for (const band of bands) {
  const src = `public/kauai-tex/${band}.jpg`;
  if (!existsSync(src)) {
    console.log(`${band.padEnd(9)} SKIPPED (no ${src})`);
    continue;
  }
  const uri = `data:image/jpeg;base64,${readFileSync(src).toString('base64')}`;
  const maps = await page.evaluate(async ({ uri, dial }) => {
    const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;

    const img = new Image();
    img.src = uri;
    await img.decode();
    const size = img.naturalWidth;            // full resolution, as shipped
    const canvasOf = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      return c;
    };
    const base = canvasOf();
    base.getContext('2d').drawImage(img, 0, 0);

    // --- the lab's wrap-around box blur -------------------------------
    const boxBlurGray = (gray, w, h, radius) => {
      if (radius <= 0) return new Float32Array(gray);
      const tmp = new Float32Array(w * h);
      const out = new Float32Array(w * h);
      const r = Math.max(1, Math.floor(radius));
      for (let y = 0; y < h; y++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += gray[y * w + ((k + w) % w)];
        for (let x = 0; x < w; x++) {
          tmp[y * w + x] = sum / (r * 2 + 1);
          sum -= gray[y * w + ((x - r + w) % w)];
          sum += gray[y * w + ((x + r + 1) % w)];
        }
      }
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += tmp[((k + h) % h) * w + x];
        for (let y = 0; y < h; y++) {
          out[y * w + x] = sum / (r * 2 + 1);
          sum -= tmp[((y - r + h) % h) * w + x];
          sum += tmp[((y + r + 1) % h) * w + x];
        }
      }
      return out;
    };

    // --- height from luminance ---------------------------------------
    const d = base.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, size, size).data;
    const lum = new Float32Array(size * size);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      lum[j] = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255;
    }
    const broad = boxBlurGray(lum, size, size, Math.max(2, Math.round(size / 128)));
    const lf = dial.largeForm / 100;
    const det = dial.imageDetail / 100;
    const contrast = dial.heightContrast / 100;
    const raw = new Float32Array(size * size);
    for (let i = 0; i < raw.length; i++) {
      const high = lum[i] - broad[i];
      let v = lerp(lum[i], broad[i], lf * 0.72) + high * det * 1.3;
      v = (v - 0.5) * contrast + 0.5;
      if (dial.invert) v = 1 - v;
      raw[i] = clamp(v);
    }
    const low = dial.heightLow / 100;
    const high = Math.max(low + 0.001, dial.heightHigh / 100);
    const height = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) height[i] = clamp((raw[i] - low) / (high - low));

    const grey = (arr) => {
      const c = canvasOf();
      const ctx = c.getContext('2d');
      const id = ctx.createImageData(size, size);
      for (let i = 0; i < arr.length; i++) {
        const v = Math.round(clamp(arr[i]) * 255);
        const j = i * 4;
        id.data[j] = id.data[j + 1] = id.data[j + 2] = v;
        id.data[j + 3] = 255;
      }
      ctx.putImageData(id, 0, 0);
      return c;
    };

    // --- normal ------------------------------------------------------
    const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
    const nrm = canvasOf();
    {
      const ctx = nrm.getContext('2d');
      const id = ctx.createImageData(size, size);
      const strength = dial.normalStrength / 100;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = (at(x + 1, y) - at(x - 1, y)) * strength * 2.2;
          const dy = (at(x, y + 1) - at(x, y - 1)) * strength * 2.2;
          let nx = -dx;
          let ny = dial.openGL ? -dy : dy;
          let nz = 1;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len; ny /= len; nz /= len;
          const j = (y * size + x) * 4;
          id.data[j] = (nx * 0.5 + 0.5) * 255;
          id.data[j + 1] = (ny * 0.5 + 0.5) * 255;
          id.data[j + 2] = (nz * 0.5 + 0.5) * 255;
          id.data[j + 3] = 255;
        }
      }
      ctx.putImageData(id, 0, 0);
    }

    // --- roughness ---------------------------------------------------
    const rgh = (() => {
      const avg = dial.roughness / 100;
      const variation = dial.roughVariation / 100;
      const arr = new Float32Array(height.length);
      for (let i = 0; i < height.length; i++) {
        arr[i] = clamp(avg + (height[i] - 0.5) * variation * 0.55);
      }
      return grey(arr);
    })();

    // --- ambient occlusion -------------------------------------------
    const ao = (() => {
      const blur = boxBlurGray(height, size, size, dial.aoRadius);
      const strength = dial.aoStrength / 100;
      const arr = new Float32Array(height.length);
      for (let i = 0; i < height.length; i++) {
        const cavity = Math.max(0, blur[i] - height[i]);
        arr[i] = clamp(1 - cavity * strength * 5.5);
      }
      return grey(arr);
    })();

    // Report the height field's spread — a flat map makes a flat normal,
    // and it is worth knowing which bands had anything to give.
    let min = 1;
    let max = 0;
    let sum = 0;
    for (const v of height) { if (v < min) min = v; if (v > max) max = v; sum += v; }
    const mean = sum / height.length;
    let sq = 0;
    for (const v of height) sq += (v - mean) * (v - mean);

    return {
      size,
      spread: Math.sqrt(sq / height.length),
      min,
      max,
      height: grey(height).toDataURL('image/png').split(',')[1],
      normal: nrm.toDataURL('image/png').split(',')[1],
      rough: rgh.toDataURL('image/png').split(',')[1],
      ao: ao.toDataURL('image/png').split(',')[1],
    };
  }, { uri, dial });

  const sizes = [];
  for (const map of ['height', 'normal', 'rough', 'ao']) {
    const bytes = Buffer.from(maps[map], 'base64');
    writeFileSync(`art/ground-pbr/${band}-${map}.png`, bytes);
    sizes.push(`${map} ${(bytes.length / 1024).toFixed(0)}k`);
  }
  console.log(
    `${band.padEnd(9)} ${maps.size}² spread ${maps.spread.toFixed(3)}`
    + ` range ${maps.min.toFixed(2)}-${maps.max.toFixed(2)}  ${sizes.join('  ')}`,
  );
}
await browser.close();
