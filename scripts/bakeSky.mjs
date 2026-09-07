/**
 * BAKE THE SKY TO THE QUALITY LADDER — four HDR skies become the dome's
 * equirectangular maps, one file per rung per sky, and one generated
 * module that says what was measured.
 *
 *     npm run bake:sky
 *
 * Reads `art/sky/`, writes `public/sky/` and the generated module
 * `src/assets/skyManifest.ts`. Paths resolve from this file, not the
 * working directory, so the command gives the same answer from anywhere.
 *
 * WHY THIS EXISTS. Joshua, 2026-09-07: "real weather synced, but just
 * would need the visuals for like sunny/clear, partly cloudy, etc… with
 * a skybox HDRI… we did have a few in TCS island to grab." The four he
 * means are Poly Haven's CC0 pure skies, copied from that project into
 * `art/sky/`: a noon sky, a low-sun sky with cloud, a dusk and a night.
 * `src/sky/SkyView.ts` draws them on a dome and cross-fades between them
 * as the real sun over Kauaʻi rises and sets; `src/sky/skyLook.ts`
 * decides which two and how much.
 *
 * WHAT A `.hdr` IS AND WHY IT IS DECODED HERE. Radiance RGBE: a text
 * header, a resolution line (`-Y h +X w`, top row first), then one
 * run-length-encoded scanline per row — four bytes a pixel, a shared
 * exponent, so the sun can be a hundred thousand times the sky and still
 * fit in a byte. Nothing in a browser or in sharp reads it; the decoder
 * below is forty lines and is the whole of the format this project
 * needs. Old-style RLE (a pre-1990s variant) is refused with a message
 * rather than half-supported: no file Poly Haven ships uses it.
 *
 * THE GAME NEVER SEES HDR. A phone's GPU does not want a float sky
 * (four times the bytes of an 8-bit one, and half-float filtering is
 * not free on older mobile chips), and `three` would tone-map it per
 * fragment every frame. So the tone-map is done ONCE, here, and what
 * ships is ordinary 8-bit sRGB. The curve is ACES (Narkowicz's 2015
 * fit) — chosen over Reinhard because a sun disc under ACES desaturates
 * to WHITE as it saturates, where per-channel Reinhard leaves it the
 * colour of whichever channel clipped last. A yellow-ringed sun is the
 * Reinhard look, and it is not what a sun looks like.
 *
 * THE EXPOSURE IS PER IMAGE, AND IT IS A RULE, NOT A GUESS. Each sky is
 * exposed so that the MEDIAN luminance of its upper hemisphere lands on
 * a stated key value (below, `KEY`): a mid-tone for the day skies, a
 * deep one for dusk, a near-black one for night. A single exposure for
 * all four would render the night sky black — its median radiance is a
 * thousandth of noon's — and an auto-exposure that pinned every image
 * to the same key would render the night as bright as the day, which is
 * what a phone camera does and what a sky must not. The keys are GAME
 * TUNING; the medians and the exposures they produce are measured and
 * written into the manifest, so "why is the dusk this dark" has a
 * number to argue with. Whatever the key, the sun disc saturates: the
 * manifest also records how much of each image clipped, so a key that
 * whited out a whole aureole would show up as a number.
 *
 * THE SUN IS MEASURED, NOT ASSUMED. The dome has to put the baked sun
 * where the real sun is, and each photograph has its sun wherever the
 * photographer's tripod faced. So the bake finds the sun — the brightest
 * thing with some extent above the horizon; `findSun` says how — and
 * takes its luminance-weighted centroid, circular in the column since the
 * left edge of an equirect is the right edge — and writes the column as
 * a fraction of the width and the row as an elevation. At runtime the
 * dome rotates each image about +y by (the real sun's bearing − that
 * fraction × 2π). For the night sky the "sun" is whatever is brightest
 * (the moon, a planet); rotating it to the sun's bearing puts the glow
 * on the sun's side of the sky, which is where twilight's glow belongs
 * anyway.
 *
 * WEBP, LOSSY, COLOUR. The ocean's foam already ships as lossy WebP
 * (`bakeTextures.mjs`, the `colour` kind) so this adds no decoder to
 * the phone, and at the same quality WebP is about a third smaller
 * than JPEG on smooth gradients, which is all a sky is. Lossy is fine
 * where lossless was mandatory for the ripple normal map: the eye reads
 * a sky's colour, not its direction. `smartSubsample` is on because
 * 4:2:0 chroma on a pure gradient is where banding shows.
 *
 * ENCODED BY SHARP, NOT BY CHROMIUM — and the difference from
 * `bakeTextures.mjs` is stated rather than left for the next reader to
 * wonder about. That bake encodes through headless Chromium so as to
 * add no dependency, and notes that `sharp` is present only as a
 * transitive dependency of wrangler. This bake has already decoded the
 * image itself into a raw float buffer; Chromium could only take that
 * back through an 8-bit ImageData and a canvas, which is a second
 * quantisation for no gain, and in the environment this was first run
 * in Playwright's browser was not installed at all. The risk is the one
 * that file names: a wrangler upgrade that drops sharp breaks this bake
 * — and only this bake. The baked files are committed under
 * `public/sky/`; the game never depends on sharp.
 *
 * NOTHING IS UPSCALED. The masters are 2048 × 1024, which is exactly
 * the ladder's top rung, so every rung is baked; a smaller master would
 * bake only the rungs it reaches, exactly as the textures do.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.join(ROOT, 'art', 'sky');
const OUT_DIR = path.join(ROOT, 'public', 'sky');
const LADDER = path.join(ROOT, 'src', 'assets', 'textureQuality.ts');
const MANIFEST = path.join(ROOT, 'src', 'assets', 'skyManifest.ts');

/** Where the game asks for these, relative to the site root. */
const URL_DIR = 'sky';

/** Every file below is this licence. Poly Haven publishes all its assets CC0 1.0. */
const LICENCE = 'Poly Haven, CC0';

/**
 * The four skies, and what each one IS to the game.
 *
 * `key` is the exposure rule: the linear luminance the image's
 * upper-hemisphere MEDIAN is exposed to before the ACES curve. GAME
 * TUNING, and the reason for each number is beside it. ACES maps 0.18
 * to about 0.27 linear, 55% in sRGB — a mid-tone — so the day keys sit
 * a little either side of that; the dusk is exposed a stop and a half
 * under, and the night is exposed so its median is near black while
 * anything a hundred times brighter (the stars, the moon) still shows.
 */
const IMAGES = [
  {
    id: 'clear',
    source: 'kloppenheim_05_puresky_2k.hdr',
    key: 0.20,
    note: 'Noon, a high sun and a few thin clouds: the sky of a trade-wind afternoon.',
  },
  {
    id: 'partly',
    source: 'kloppenheim_06_puresky_2k.hdr',
    key: 0.15,
    note: 'A low sun behind broken cloud: what the day sky becomes as cover builds.',
  },
  {
    id: 'dusk',
    source: 'qwantani_dusk_2_puresky_2k.hdr',
    key: 0.16,
    note: 'Dusk, the sun just under the horizon and the warmth going out of the sky.',
  },
  {
    id: 'night',
    source: 'qwantani_night_puresky_2k.hdr',
    key: 0.012,
    note: 'Night: stars, the Milky Way, and enough glow to tell the horizon from the ground.',
  },
];

/** Lossy WebP, colour: the foam's setting, with chroma kept honest on gradients. */
const ENCODING = { quality: 85, smartSubsample: true, effort: 6 };

/**
 * The rungs, READ FROM THE DECISION rather than copied beside it — the
 * same parse `bakeTextures.mjs` does, for the same reason: a second list
 * here would be a second answer.
 */
function readLadder() {
  const source = readFileSync(LADDER, 'utf8');
  const block = /export const TEXTURE_QUALITY[\s\S]*?\n\}\);/.exec(source);
  if (!block) throw new Error(`bake:sky: no TEXTURE_QUALITY in ${path.relative(ROOT, LADDER)}`);
  const rungs = [];
  const entry = /tier:\s*'([a-z-]+)',\s*\n\s*size:\s*(\d+),/g;
  for (let hit = entry.exec(block[0]); hit !== null; hit = entry.exec(block[0])) {
    rungs.push({ tier: hit[1], size: Number(hit[2]) });
  }
  if (rungs.length < 2) throw new Error(`bake:sky: read ${rungs.length} rungs from the ladder; it must have changed shape`);
  for (const rung of rungs) {
    if (!Number.isInteger(Math.log2(rung.size))) throw new Error(`bake:sky: rung ${rung.tier} is ${rung.size}, not a power of two`);
  }
  return rungs.sort((a, b) => a.size - b.size);
}

/* ─── Radiance RGBE ────────────────────────────────────────────────── */

/**
 * Decode a `.hdr` into linear float RGB, top row first.
 *
 * Returns `{ width, height, rgb }` with `rgb` a Float32Array of
 * width × height × 3. Radiance's own conversion: a mantissa byte c with
 * shared exponent e is (c + 0.5) × 2^(e − 136); an exponent of zero is
 * black.
 */
function decodeRgbe(bytes) {
  let at = 0;
  const line = () => {
    const start = at;
    while (at < bytes.length && bytes[at] !== 0x0a) at += 1;
    const text = bytes.toString('latin1', start, at);
    at += 1;
    return text;
  };
  const magic = line();
  if (!magic.startsWith('#?')) throw new Error('not a Radiance file: no #? signature');
  let format = null;
  for (let header = line(); header !== ''; header = line()) {
    if (header.startsWith('FORMAT=')) format = header.slice('FORMAT='.length);
    if (at >= bytes.length) throw new Error('header never ended');
  }
  if (format !== '32-bit_rle_rgbe') throw new Error(`unsupported FORMAT ${format ?? '(none)'}`);
  const resolution = /^-Y (\d+) \+X (\d+)$/.exec(line());
  if (!resolution) throw new Error('only the standard -Y h +X w orientation is supported');
  const height = Number(resolution[1]);
  const width = Number(resolution[2]);

  const rgb = new Float32Array(width * height * 3);
  const scanline = new Uint8Array(width * 4);
  for (let row = 0; row < height; row += 1) {
    const flat = width < 8 || width > 0x7fff || bytes[at] !== 2 || bytes[at + 1] !== 2 || (bytes[at + 2] & 0x80) !== 0;
    if (flat) {
      // Uncompressed pixels. An old-style RLE marker would be (1,1,1,n);
      // it is refused rather than mis-decoded as flat data.
      if (bytes[at] === 1 && bytes[at + 1] === 1 && bytes[at + 2] === 1) throw new Error('old-style RLE is not supported');
      for (let i = 0; i < width * 4; i += 1) scanline[i] = bytes[at + i];
      at += width * 4;
    } else {
      const declared = (bytes[at + 2] << 8) | bytes[at + 3];
      if (declared !== width) throw new Error(`scanline ${row} declares width ${declared}, file says ${width}`);
      at += 4;
      // New-style RLE: each of the four channels in turn, as runs
      // (count > 128: repeat the next byte count − 128 times) and
      // literals (count ≤ 128: copy count bytes).
      for (let channel = 0; channel < 4; channel += 1) {
        let x = 0;
        while (x < width) {
          let count = bytes[at];
          at += 1;
          if (count > 128) {
            count -= 128;
            const value = bytes[at];
            at += 1;
            if (x + count > width) throw new Error(`run overflows scanline ${row}`);
            for (let i = 0; i < count; i += 1) scanline[(x + i) * 4 + channel] = value;
          } else {
            if (x + count > width) throw new Error(`literal overflows scanline ${row}`);
            for (let i = 0; i < count; i += 1) scanline[(x + i) * 4 + channel] = bytes[at + i];
            at += count;
          }
          x += count;
        }
      }
    }
    const base = row * width * 3;
    for (let x = 0; x < width; x += 1) {
      const e = scanline[x * 4 + 3];
      if (e === 0) continue;
      const scale = 2 ** (e - 136);
      rgb[base + x * 3] = (scanline[x * 4] + 0.5) * scale;
      rgb[base + x * 3 + 1] = (scanline[x * 4 + 1] + 0.5) * scale;
      rgb[base + x * 3 + 2] = (scanline[x * 4 + 2] + 0.5) * scale;
    }
  }
  return { width, height, rgb };
}

/* ─── measurement ──────────────────────────────────────────────────── */

const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The box the sun finder averages over, in master pixels: 16 px is 2.8° at 2048 wide. */
const SUN_BOX = 16;
/** Cells scoring within this fraction of the best cell are the sun; the rest is sky. */
const SUN_CORE = 0.75;

/**
 * Where the sun is in the picture.
 *
 * The best-scoring CELL in the upper 55% of rows — down to about 9°
 * below the horizon, so a sun that has just set still counts — with
 * every cell within `SUN_CORE` of that score included, weighted by
 * luminance. Cells, not pixels: the image is walked in `SUN_BOX`
 * squares and each is scored on both its mean and its brightest pixel,
 * so that what wins is a bright thing with SOME extent — a sun disc
 * with its aureole, a moon and its glow — and neither a lone star nor a
 * broad lit cloud. What the eye locks to is what the dome rotates by.
 *
 * The column is averaged on the circle so a sun straddling the seam
 * does not come out in the middle of the image.
 */
function findSun({ width, height, rgb }) {
  const cols = Math.floor(width / SUN_BOX);
  const rows = Math.floor((height * 0.55) / SUN_BOX);
  // Per cell: the mean over the box, and the brightest pixel in it. The
  // SCORE is their product. A star has a huge pixel and a tiny mean; a
  // lit cloud bank has a fair mean and no bright pixel; a sun disc, an
  // aureole or a moon glow has both. Measured on the four masters: the
  // mean alone locked the `partly` sky to its cloud bank fourteen
  // degrees off the disc, and the pixel alone locked the night to a
  // three-pixel star at the zenith.
  const means = new Float64Array(cols * rows);
  const scores = new Float64Array(cols * rows);
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      let sum = 0;
      let top = 0;
      for (let y = cy * SUN_BOX; y < (cy + 1) * SUN_BOX; y += 1) {
        for (let x = cx * SUN_BOX; x < (cx + 1) * SUN_BOX; x += 1) {
          const i = (y * width + x) * 3;
          const l = luminance(rgb[i], rgb[i + 1], rgb[i + 2]);
          sum += l;
          if (l > top) top = l;
        }
      }
      means[cy * cols + cx] = sum / (SUN_BOX * SUN_BOX);
      scores[cy * cols + cx] = (sum / (SUN_BOX * SUN_BOX)) * top;
    }
  }
  let peak = 0;
  for (let i = 0; i < scores.length; i += 1) if (scores[i] > peak) peak = scores[i];
  const threshold = peak * SUN_CORE;
  let sinSum = 0;
  let cosSum = 0;
  let rowSum = 0;
  let weight = 0;
  let count = 0;
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      if (scores[cy * cols + cx] < threshold) continue;
      const l = means[cy * cols + cx];
      const angle = ((cx + 0.5) / cols) * Math.PI * 2;
      sinSum += Math.sin(angle) * l;
      cosSum += Math.cos(angle) * l;
      rowSum += (cy + 0.5) * SUN_BOX * l;
      weight += l;
      count += 1;
    }
  }
  let azimuth = Math.atan2(sinSum, cosSum) / (Math.PI * 2);
  if (azimuth < 0) azimuth += 1;
  const rowCentre = rowSum / weight;
  // Row 0 is the zenith, row h/2 the horizon: elevation from the row.
  const elevationDeg = (0.5 - rowCentre / height) * 180;
  return { azimuth, elevationDeg, peak: Math.sqrt(peak), cells: count };
}

/** The median luminance of the upper hemisphere: the number the exposure rule keys on. */
function medianSkyLuminance({ width, height, rgb }) {
  const rows = Math.floor(height / 2);
  const samples = new Float32Array(rows * width);
  for (let i = 0; i < rows * width; i += 1) samples[i] = luminance(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
  samples.sort();
  return samples[Math.floor(samples.length / 2)];
}

/* ─── tone mapping ─────────────────────────────────────────────────── */

/** Narkowicz's ACES fit (2015): x in linear scene radiance, out 0..1 display-linear. */
function aces(x) {
  const y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return y < 0 ? 0 : y > 1 ? 1 : y;
}

/** Linear to the sRGB transfer, 0..1. */
function srgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/**
 * Expose, curve and encode to 8-bit sRGB. Returns the buffer and how
 * much of the image saturated — the fraction of pixels whose luminance
 * after the curve is at or above 0.98, which is the sun disc and any
 * aureole the key let it take with it.
 */
function toneMap({ width, height, rgb }, exposure) {
  const out = Buffer.alloc(width * height * 3);
  let clipped = 0;
  for (let i = 0; i < width * height; i += 1) {
    const r = aces(rgb[i * 3] * exposure);
    const g = aces(rgb[i * 3 + 1] * exposure);
    const b = aces(rgb[i * 3 + 2] * exposure);
    if (luminance(r, g, b) >= 0.98) clipped += 1;
    out[i * 3] = Math.round(srgb(r) * 255);
    out[i * 3 + 1] = Math.round(srgb(g) * 255);
    out[i * 3 + 2] = Math.round(srgb(b) * 255);
  }
  return { pixels: out, clipFraction: clipped / (width * height) };
}

/* ─── output ───────────────────────────────────────────────────────── */

const kib = (bytes) => `${(bytes / 1024).toFixed(0)} KiB`;
const deg = (radians) => `${(radians * 180 / Math.PI).toFixed(1)}°`;

function writeManifest(entries, rungs) {
  const lines = entries.map((entry) => `  {
    /** ${entry.note} */
    id: '${entry.id}',
    source: '${entry.source}',
    /** The master's width. Nothing above this was baked. */
    masterWidth: ${entry.masterWidth},
    /** The widths that exist on disk, coarsest first. Height is always half. */
    widths: Object.freeze([${entry.baked.map((b) => b.width).join(', ')}]),
    /** The brightest thing above the horizon, as a fraction of the width 0..1 — measured at bake. */
    sunAzimuth: ${entry.sun.azimuth.toFixed(5)},
    /** Its elevation, radians above the horizon — measured at bake. */
    sunElevation: ${(entry.sun.elevationDeg * Math.PI / 180).toFixed(5)},
    /** The exposure the sky was baked at: the key (${entry.key}) over the measured median (${entry.median.toExponential(3)}). */
    exposure: ${entry.exposure.toPrecision(5)},
    /** Fraction of pixels that saturated under the curve — the sun disc, and what it took with it. */
    clipped: ${entry.clipFraction.toExponential(3)},
  },`).join('\n');

  const table = entries.map((entry) => {
    const cells = entry.baked.map((b) => `${b.width}: ${kib(b.bytes)}`).join(', ');
    return ` *   ${entry.id.padEnd(7)} sun az ${entry.sun.azimuth.toFixed(3)} el ${entry.sun.elevationDeg.toFixed(1).padStart(5)}°  exposure ${entry.exposure.toPrecision(4).padStart(9)}  clipped ${(entry.clipFraction * 100).toFixed(3)}%\n *           ${cells}`;
  }).join('\n');

  const perTier = rungs.map((rung) => {
    const wire = entries.reduce((sum, e) => sum + (e.baked.find((b) => b.width === rung.size)?.bytes ?? 0), 0);
    const gpu = rung.size * (rung.size / 2) * 4;
    return ` *   ${rung.tier.padEnd(10)} ${String(rung.size).padStart(4)} × ${String(rung.size / 2).padStart(4)}   all four on the wire ${kib(wire).padStart(9)}   one on the GPU ${kib(gpu).padStart(9)}   two resident ${kib(gpu * 2).padStart(9)}`;
  }).join('\n');

  const body = `/**
 * WHAT IS ACTUALLY ON DISK — generated by \`npm run bake:sky\`.
 *
 * DO NOT EDIT. Re-run the bake.
 *
 * The four skies the dome cross-fades between (\`src/sky/SkyView.ts\`),
 * each baked once per rung of the texture ladder (\`textureQuality.ts\`)
 * as an equirectangular, lossy, sRGB WebP — width the rung's size,
 * height half of it. What was MEASURED at bake time is written here
 * beside what was chosen, so a runtime can rotate each image to put its
 * baked sun where the real sun is, and so the exposure a sky was given
 * is a number rather than a memory.
 *
${table}
 *
 * What a tier costs. Wire bytes are all four files; a phone loads at
 * most the two the current look reads (\`SkyView\` releases the rest),
 * and the dome samples with no mip chain — it is only ever magnified —
 * so a resident image is width × height × 4 bytes and no more:
 *
${perTier}
 *
 * Rungs the bake was offered: ${rungs.map((r) => r.size).join(', ')}.
 *
 * LICENSES. Every image here is ${LICENCE} (Creative Commons Zero,
 * https://polyhaven.com/license): no attribution required, none
 * withheld — the masters are named by their Poly Haven ids in
 * \`art/sky/\`. Decoded, exposed (ACES) and encoded by
 * \`scripts/bakeSky.mjs\`.
 */
import { TEXTURE_QUALITY, type TextureTier } from './textureQuality';

/** The four skies, by what the sky LOOKS like — \`skyLook.ts\` chooses among them. */
export type SkyImageId = ${entries.map((e) => `'${e.id}'`).join(' | ')};

export const SKY_IMAGE_IDS: readonly SkyImageId[] = Object.freeze([${entries.map((e) => `'${e.id}'`).join(', ')}]);

export interface BakedSky {
  readonly id: SkyImageId;
  /** The master's file name under \`art/sky/\`. */
  readonly source: string;
  /** The master's width. Nothing above this is baked. */
  readonly masterWidth: number;
  /** The widths that exist on disk, coarsest first. Height is always half the width. */
  readonly widths: readonly number[];
  /** Where the sun (the brightest thing above the horizon) is: a fraction of the width, 0..1, measured at bake. */
  readonly sunAzimuth: number;
  /** Its elevation, radians above the horizon, measured at bake. */
  readonly sunElevation: number;
  /** The linear exposure multiplier the image was tone-mapped at. */
  readonly exposure: number;
  /** The fraction of pixels that saturated under the curve. */
  readonly clipped: number;
}

/** Where the baked files live, relative to the site root. */
export const SKY_DIR = '${URL_DIR}';

/** The licence every file in \`public/${URL_DIR}/\` carries. */
export const SKY_LICENCE = '${LICENCE}';

const BAKED: readonly BakedSky[] = [
${lines}
];

export const BAKED_SKIES: readonly BakedSky[] = Object.freeze(BAKED.map((s) => Object.freeze(s)));

export function bakedSky(id: SkyImageId): BakedSky {
  const found = BAKED_SKIES.find((s) => s.id === id);
  if (!found) throw new Error(\`no baked sky named \${id}\`);
  return found;
}

/**
 * The width this sky actually has for a tier: the tier's rung, or the
 * largest smaller one when the master could not reach it. Clamps DOWN,
 * never up, and never throws — exactly \`textureManifest.textureSizeFor\`.
 */
export function skyWidthFor(id: SkyImageId, tier: TextureTier): number {
  const { widths } = bakedSky(id);
  const want = TEXTURE_QUALITY[tier].size;
  let best = widths[0];
  for (const width of widths) if (width <= want && width > best) best = width;
  return best;
}

/** The URL to load, built in one place so nothing spells a path by hand. */
export function skyUrl(id: SkyImageId, tier: TextureTier, base = '/'): string {
  return \`\${base}\${SKY_DIR}/\${id}-\${skyWidthFor(id, tier)}.webp\`;
}
`;
  mkdirSync(path.dirname(MANIFEST), { recursive: true });
  writeFileSync(MANIFEST, body, 'utf8');
}

async function run() {
  if (!existsSync(SOURCE_DIR)) throw new Error(`bake:sky: no ${path.relative(ROOT, SOURCE_DIR)}`);
  const rungs = readLadder();
  console.log(`ladder: ${rungs.map((r) => `${r.tier} ${r.size}`).join(', ')}`);

  // A stale rung left behind by a shrunk master would be served forever.
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const entries = [];
  for (const image of IMAGES) {
    const file = path.join(SOURCE_DIR, image.source);
    if (!existsSync(file)) throw new Error(`bake:sky: no master ${path.relative(ROOT, file)}`);
    const hdr = decodeRgbe(readFileSync(file));
    if (hdr.width !== hdr.height * 2) throw new Error(`bake:sky: ${image.source} is ${hdr.width}x${hdr.height}, not equirectangular 2:1`);

    const sun = findSun(hdr);
    const median = medianSkyLuminance(hdr);
    const exposure = image.key / median;
    const { pixels, clipFraction } = toneMap(hdr, exposure);
    console.log(
      `  ${image.id}: ${hdr.width}x${hdr.height}, sky median ${median.toExponential(3)}, peak ${sun.peak.toExponential(3)}, `
      + `exposure ${exposure.toPrecision(4)}, clipped ${(clipFraction * 100).toFixed(3)}%, `
      + `sun at az ${sun.azimuth.toFixed(4)} (${deg(sun.azimuth * Math.PI * 2)}) el ${sun.elevationDeg.toFixed(1)}° from ${sun.cells} cells`,
    );

    // Never upscale: only the rungs the master reaches.
    const wanted = rungs.filter((r) => r.size <= hdr.width);
    if (wanted.length === 0) throw new Error(`bake:sky: ${image.source} is ${hdr.width} across, below every rung`);
    const master = sharp(pixels, { raw: { width: hdr.width, height: hdr.height, channels: 3 } });
    const baked = [];
    for (const rung of wanted) {
      // From the SAME tone-mapped master each time, never from the previous rung.
      const out = await master
        .clone()
        .resize(rung.size, rung.size / 2, { kernel: 'lanczos3', fit: 'fill' })
        .webp(ENCODING)
        .toBuffer();
      writeFileSync(path.join(OUT_DIR, `${image.id}-${rung.size}.webp`), out);
      baked.push({ width: rung.size, bytes: out.length });
    }
    const dropped = rungs.filter((r) => r.size > hdr.width);
    const skipped = dropped.length > 0 ? `  (no ${dropped.map((r) => r.size).join('/')}: master is ${hdr.width})` : '';
    console.log(`    ${baked.map((b) => `${b.width}=${kib(b.bytes)}`).join(' ')}${skipped}`);
    entries.push({ ...image, masterWidth: hdr.width, sun, median, exposure, clipFraction, baked });
  }

  writeManifest(entries, rungs);
  const total = readdirSync(OUT_DIR).reduce((sum, f) => sum + statSync(path.join(OUT_DIR, f)).size, 0);
  console.log(`wrote ${readdirSync(OUT_DIR).length} files to public/${URL_DIR}/ (${kib(total)}) and src/assets/skyManifest.ts`);
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
