/**
 * BAKE EVERY TEXTURE TO THE QUALITY LADDER — the step `textureQuality.ts`
 * was written in advance of.
 *
 *     npm run bake:textures
 *
 * Reads `art/textures/`, writes `public/tex/` and the generated module
 * `src/assets/textureManifest.ts`. Paths are resolved from this file, not
 * the working directory, so the command gives the same answer from
 * anywhere.
 *
 * WHY THIS EXISTS. Joshua, from his phone on 2026-09-05, naming what he
 * thinks made v0's ocean choppy: "we didn't have different texture sizes
 * and able to do lower quality resolution to help it run smoother
 * either and everything was I think 1024, but probably wasn't optimized
 * the best between CPU, and GPU". His standing preference, in his words:
 * sacrificing graphics on mobile is better than amazing graphics with
 * horrible performance. So the ocean arrives with its textures on the
 * ladder, testable at medium, low and ultra-low on his phone.
 *
 * He was nearly right about 1024. The ripple normal map is 1536 x 1536 —
 * NOT A POWER OF TWO, wrapped and mipmapped by the water shader, which
 * on a WebGL1 device costs a silent resize at load and on older mobile
 * GPUs costs wrapping and mipmapping outright. On the GPU it is 12.6 MiB
 * with its mip chain, against 1.4 MiB for the same texture at the medium
 * rung. That factor of nine is the point of this script.
 *
 * TWO ENCODINGS, AND THE CHOICE IS MEASURED RATHER THAN ASSUMED.
 *
 *   normal   WebP at quality 1.0, which in Chromium is LOSSLESS — proved
 *            by round-tripping this very texture through canvas and
 *            comparing: 0 of 262,144 pixels differed, worst channel
 *            delta 0.
 *   colour   WebP at 0.82. Ordinary lossy, because the eye is reading a
 *            brightness and not a direction.
 *
 * A NORMAL MAP MAY NOT BE ENCODED LOSSILY, and this is the reason it is
 * a per-texture KIND rather than one quality for everything. Lossy WebP
 * is always YUV 4:2:0, so the chroma planes — which is where a normal
 * map keeps x and y — are stored at half resolution. Measured on this
 * texture at 512: quality 0.92 changed 99.93% of pixels and turned the
 * decoded normals by 5.97 degrees on average and 45.8 degrees at worst.
 * Turning the quality up barely helps, because the loss is the colour
 * transform and not the quantiser: sharp's encoder at q95 still averaged
 * 6.4 degrees. A ladder whose rungs differ by RESOLUTION is a dial
 * Joshua can reason about; one that also silently rotates the normals is
 * not.
 *
 * NO NEW DEPENDENCY. The resize and the encode are done by the same
 * headless Chromium `bakeArt.mjs` already uses. `sharp` is present in
 * node_modules but only as a transitive dependency of wrangler, so
 * building on it would mean a bake that breaks on a wrangler upgrade for
 * no stated reason.
 *
 * NOTHING IS EVER UPSCALED. A rung above the master's own size is not
 * baked at all, and the manifest says so, because inventing pixels and
 * then charging the GPU four times the memory for them is the opposite
 * of what this file is for. The ripple master is 1536, so its top rung
 * is `high` (1024) and there is no `ultra-high`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.join(ROOT, 'art', 'textures');
const OUT_DIR = path.join(ROOT, 'public', 'tex');
const LADDER = path.join(ROOT, 'src', 'assets', 'textureQuality.ts');
const MANIFEST = path.join(ROOT, 'src', 'assets', 'textureManifest.ts');

/** Where the game asks for these, relative to the site root. */
const URL_DIR = 'tex';

/**
 * What to bake, and what each one IS.
 *
 * `kind` is not decoration: it picks the encoder, and picking wrong
 * rotates the normals (see the header). Add a texture here and to
 * `art/textures/`; nothing else needs editing.
 */
const TEXTURES = [
  {
    name: 'water-normal',
    source: 'water-normal.png',
    kind: 'normal',
    note: 'The ripple normal map. The ocean shader samples it four times at four scales, twice over, so it is the most-read texture in the game.',
  },
  {
    name: 'surf-foam',
    source: 'surf-foam.jpg',
    kind: 'colour',
    note: 'Foam, read as a brightness where the wave has broken.',
  },
];

/** Encoder settings per kind. See the header for why these two and not one. */
const ENCODING = {
  // 1.0 is Chromium's lossless path. Verified by round trip, not assumed.
  normal: { quality: 1, lossless: true },
  colour: { quality: 0.82, lossless: false },
};

/**
 * The rungs, READ FROM THE DECISION rather than copied beside it.
 *
 * `textureQuality.ts` is where the ladder is decided and argued; a second
 * list here would be a second answer, and the two would part company on
 * the day somebody adds a rung. The parse is deliberately narrow and
 * fails loudly: a ladder this cannot read is a ladder that changed shape,
 * and that is a thing to look at, not to work around.
 */
function readLadder() {
  const source = readFileSync(LADDER, 'utf8');
  const block = /export const TEXTURE_QUALITY[\s\S]*?\n\}\);/.exec(source);
  if (!block) throw new Error(`bake:textures: no TEXTURE_QUALITY in ${path.relative(ROOT, LADDER)}`);
  const rungs = [];
  const entry = /tier:\s*'([a-z-]+)',\s*\n\s*size:\s*(\d+),/g;
  for (let hit = entry.exec(block[0]); hit !== null; hit = entry.exec(block[0])) {
    rungs.push({ tier: hit[1], size: Number(hit[2]) });
  }
  if (rungs.length < 2) {
    throw new Error(`bake:textures: read ${rungs.length} rungs from the ladder; it must have changed shape`);
  }
  for (const rung of rungs) {
    if (!Number.isInteger(Math.log2(rung.size))) {
      throw new Error(`bake:textures: rung ${rung.tier} is ${rung.size}, not a power of two`);
    }
  }
  return rungs.sort((a, b) => a.size - b.size);
}

/**
 * Resize and encode, in the browser, one master to many rungs.
 *
 * ONE DECODE, MANY WRITES: the master is decoded once and drawn down to
 * each rung from the SAME source image, never from the previous rung.
 * Chaining halvings would compound the resampling error, and the coarse
 * rungs are exactly where that shows.
 */
async function bakeOne(page, { source, kind }, rungs) {
  const bytes = readFileSync(path.join(SOURCE_DIR, source));
  const mime = source.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
  return page.evaluate(async ({ dataUrl, sizes, encoding }) => {
    const img = new Image();
    await new Promise((ok, no) => {
      img.onload = ok;
      img.onerror = () => no(new Error('the master would not decode'));
      img.src = dataUrl;
    });
    const master = { width: img.naturalWidth, height: img.naturalHeight };
    const baked = [];
    for (const size of sizes) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, size, size);
      const url = canvas.toDataURL('image/webp', encoding.quality);
      if (!url.startsWith('data:image/webp')) throw new Error('this browser did not encode WebP');
      baked.push({ size, base64: url.slice(url.indexOf(',') + 1) });
    }
    return { master, baked };
  }, { dataUrl, sizes: rungs.map((r) => r.size), encoding: ENCODING[kind] });
}

/**
 * Prove the lossless claim on the real artwork, every run, rather than
 * once in a scratch file nobody keeps.
 *
 * A future Chromium that quietly made quality 1.0 lossy would rotate
 * every ripple normal by six degrees and nothing would fail — the water
 * would just look slightly wrong on a device nobody was measuring. This
 * costs one round trip per normal map and removes that whole class.
 */
async function proveLossless(page, source) {
  const bytes = readFileSync(path.join(SOURCE_DIR, source));
  const mime = source.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
  return page.evaluate(async ({ dataUrl, size }) => {
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = dataUrl; });
    const a = document.createElement('canvas');
    a.width = size; a.height = size;
    const ga = a.getContext('2d', { willReadFrequently: true });
    ga.imageSmoothingEnabled = true;
    ga.imageSmoothingQuality = 'high';
    ga.drawImage(img, 0, 0, size, size);
    const before = ga.getImageData(0, 0, size, size).data;

    const back = new Image();
    await new Promise((ok, no) => {
      back.onload = ok; back.onerror = no; back.src = a.toDataURL('image/webp', 1);
    });
    const b = document.createElement('canvas');
    b.width = size; b.height = size;
    const gb = b.getContext('2d', { willReadFrequently: true });
    gb.drawImage(back, 0, 0);
    const after = gb.getImageData(0, 0, size, size).data;

    let differing = 0;
    for (let i = 0; i < before.length; i += 1) if (before[i] !== after[i]) differing += 1;
    return { differing, channels: before.length };
  }, { dataUrl, size: 256 });
}

const kib = (bytes) => `${(bytes / 1024).toFixed(0)} KiB`;

function writeManifest(entries, rungs) {
  const lines = entries.map((entry) => {
    const sizes = entry.baked.map((b) => b.size).join(', ');
    return `  {
    /** ${entry.note} */
    name: '${entry.name}',
    kind: '${entry.kind}',
    /** The master's own size. Nothing above this was baked. */
    masterSize: ${entry.masterSize},
    /** The rungs that exist on disk, coarsest first. */
    sizes: Object.freeze([${sizes}]),
  },`;
  }).join('\n');

  const table = entries.map((entry) => {
    const cells = entry.baked.map((b) => `${b.size}: ${kib(b.bytes)}`).join(', ');
    return ` *   ${entry.name.padEnd(14)} master ${entry.masterSize}, ${cells}`;
  }).join('\n');

  writeMachineFile(MANIFEST, `/**
 * WHAT IS ACTUALLY ON DISK — generated by \`npm run bake:textures\`.
 *
 * DO NOT EDIT. Re-run the bake.
 *
 * The ladder (\`textureQuality.ts\`) is the DECISION: five rungs and what
 * each is for. This is the FACT: which textures were baked, at which of
 * those rungs, from a master of what size. They are not the same list and
 * must not be assumed to be — a master smaller than a rung is not baked
 * to that rung, because upscaling invents pixels and then charges the GPU
 * four times the memory for them.
 *
 * So a loader asks \`textureUrl\`, which walks DOWN from the tier the
 * player chose to the best rung this texture actually has. Nothing builds
 * a path by hand.
 *
${table}
 *
 * Rungs the bake was offered: ${rungs.map((r) => r.size).join(', ')}.
 */
import { TEXTURE_QUALITY, type TextureTier } from './textureQuality';

/** How a texture must be encoded — see \`scripts/bakeTextures.mjs\`. */
export type TextureKind = 'normal' | 'colour';

export type TextureName = ${entries.map((e) => `'${e.name}'`).join(' | ')};

export interface BakedTexture {
  readonly name: TextureName;
  readonly kind: TextureKind;
  /** The master's own size. Nothing above this is baked. */
  readonly masterSize: number;
  /** The rungs that exist on disk, coarsest first. */
  readonly sizes: readonly number[];
}

/** Where the baked files live, relative to the site root. */
export const TEXTURE_DIR = '${URL_DIR}';

const BAKED: readonly BakedTexture[] = [
${lines}
];

export const BAKED_TEXTURES: readonly BakedTexture[] = Object.freeze(BAKED.map((t) => Object.freeze(t)));

export function bakedTexture(name: TextureName): BakedTexture {
  const found = BAKED_TEXTURES.find((t) => t.name === name);
  if (!found) throw new Error(\`no baked texture named \${name}\`);
  return found;
}

/**
 * The size this texture actually has for a tier: the tier's rung, or the
 * largest smaller one when the master could not reach it.
 *
 * CLAMPS DOWN, NEVER UP, and never throws. A player on ULTRA HIGH must
 * not get a missing texture because one master happened to be 1536
 * across; they get the best that exists, which is what "high" means for
 * that texture.
 *
 * The downward direction is guaranteed rather than hoped for: the bake
 * refuses a master smaller than the COARSEST rung, so \`sizes[0]\` is
 * always that rung and every tier's size is at least it.
 */
export function textureSizeFor(name: TextureName, tier: TextureTier): number {
  const { sizes } = bakedTexture(name);
  const want = TEXTURE_QUALITY[tier].size;
  let best = sizes[0];
  for (const size of sizes) if (size <= want && size > best) best = size;
  return best;
}

/** The URL to load, built in one place so nothing spells a path by hand. */
export function textureUrl(name: TextureName, tier: TextureTier, base = '/'): string {
  return \`\${base}\${TEXTURE_DIR}/\${name}.\${textureSizeFor(name, tier)}.webp\`;
}
`);
}

function writeMachineFile(file, body) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body, 'utf8');
}

async function run() {
  if (!existsSync(SOURCE_DIR)) throw new Error(`bake:textures: no ${path.relative(ROOT, SOURCE_DIR)}`);
  const rungs = readLadder();
  console.log(`ladder: ${rungs.map((r) => `${r.tier} ${r.size}`).join(', ')}`);

  // A stale rung left behind by a shrunk master would be served forever.
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const entries = [];
  try {
    for (const texture of TEXTURES) {
      const file = path.join(SOURCE_DIR, texture.source);
      if (!existsSync(file)) throw new Error(`bake:textures: no master ${path.relative(ROOT, file)}`);

      // Measure the master before choosing rungs: never upscale.
      const probe = await bakeOne(page, texture, [rungs[0]]);
      const masterSize = Math.min(probe.master.width, probe.master.height);
      const wanted = rungs.filter((r) => r.size <= masterSize);
      if (wanted.length === 0) {
        throw new Error(`bake:textures: ${texture.source} is ${masterSize} across, below every rung`);
      }
      if (probe.master.width !== probe.master.height) {
        console.log(`  note: ${texture.source} is ${probe.master.width}x${probe.master.height}; baking square to ${masterSize}`);
      }

      const { baked } = await bakeOne(page, texture, wanted);
      const written = baked.map(({ size, base64 }) => {
        const bytes = Buffer.from(base64, 'base64');
        writeFileSync(path.join(OUT_DIR, `${texture.name}.${size}.webp`), bytes);
        return { size, bytes: bytes.length };
      });

      if (texture.kind === 'normal') {
        const { differing, channels } = await proveLossless(page, texture.source);
        if (differing !== 0) {
          throw new Error(
            `bake:textures: ${texture.source} is a normal map and this browser's WebP at quality 1.0 is NOT lossless `
            + `(${differing} of ${channels} channel values changed). Lossy WebP is YUV 4:2:0 and rotates normals by `
            + 'about six degrees — see the header. Refusing to bake a normal map through it.',
          );
        }
        console.log(`  ${texture.name}: lossless verified, 0 of ${channels} channel values changed`);
      }

      const dropped = rungs.filter((r) => r.size > masterSize);
      const skipped = dropped.length > 0 ? `  (no ${dropped.map((r) => r.size).join('/')}: master is ${masterSize})` : '';
      console.log(`  ${texture.name} [${texture.kind}] ${written.map((w) => `${w.size}=${kib(w.bytes)}`).join(' ')}${skipped}`);
      entries.push({ ...texture, masterSize, baked: written });
    }
  } finally {
    await browser.close();
  }

  writeManifest(entries, rungs);
  const total = readdirSync(OUT_DIR).reduce((sum, f) => sum + statSync(path.join(OUT_DIR, f)).size, 0);
  console.log(`wrote ${readdirSync(OUT_DIR).length} files to public/${URL_DIR}/ (${kib(total)}) and src/assets/textureManifest.ts`);
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
