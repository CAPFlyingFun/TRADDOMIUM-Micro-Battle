/**
 * THE ISLAND AS SHE ACTUALLY SEES IT — the map, drawn with the ground.
 *
 * `islandMap.ts` paints Kauaʻi from six flat elevation colours and a
 * hillshade, which is a fine chart and does not look like anywhere.
 * Joshua, 2026-08-31: "Needs to look like when you pick the spawn
 * location… Maybe render a smaller HD version of the island with actual
 * textures for better quality."
 *
 * So this bakes the same island out of the SAME SEVEN GROUND TEXTURES
 * the terrain is made of — reef, sand, grass, jungle, cliff, mountain,
 * snow. Not colours sampled from them and not an approximation of them:
 * the images themselves, tiled and blended across the bands, so the
 * green she is flying over and the green on the map came out of one
 * file.
 *
 * IT COSTS LESS THAN THE FLAT ONE IT REPLACES, which is the part worth
 * knowing. `bakeIsland` asks `terrainHeight` three times for every land
 * pixel — once for the pixel and twice more for the two neighbours the
 * hillshade needs — so a 768 square is 1,163,976 calls. Sampling the
 * heights ONCE into an array and taking the shade from the neighbours
 * already in it is one call per pixel, and one call per pixel at 1024
 * is 1,048,576. More resolution, real texture, fewer samples.
 *
 * A WORD ABOUT THE TILING SCALE, because it is a deliberate lie. A
 * ground texture repeats every 32 world units — a third of a metre —
 * and one pixel of this map covers 54.7 metres. Tiling at true scale
 * would be white noise. So they are tiled at a size chosen to READ
 * rather than to measure: about three and a half kilometres a repeat,
 * which gives the jungle its mottle and the cliffs their grain at the
 * scale a map is actually looked at. The BANDS are true; the weave
 * inside them is texture in the ordinary sense of the word.
 *
 * THE TEXTURES ARE ALREADY PAID FOR. `terrainMaterial` fetches these
 * same seven files to build the ground, so by the time anything here
 * runs they are in the browser's cache and this costs a decode rather
 * than a download. If they are missing — a cold cache, a failed fetch,
 * the spawn picker before a scene exists — this hands back nothing and
 * the caller falls back to the flat chart. A map is never worth failing
 * a run over.
 */
import { terrainHeight, ISLAND_SPAN } from '../world/heightfield';
import { UNITS_PER_METRE } from '../world/kauai';

/**
 * Pixels a side. 1024 rather than islandMap's 768 for one reason: the
 * coarse height grid is 1025 samples across, so this is the first size
 * at which the map stops being coarser than the data underneath it.
 * 72.9 metres a pixel becomes 54.7, which is the grid's own spacing.
 */
export const RELIEF_SIZE = 1024;

/** How much of the map one repeat of a ground texture covers, in pixels. */
const WEAVE = 160;

/**
 * How much of the weave survives, against the texture's own mean.
 *
 * THE FIRST ATTEMPT TILED THEM STRAIGHT AND IT WAS WRONG, visibly. A
 * ground map is grass blades at a third of a metre and one pixel here
 * covers fifty-four, so drawing the blades at map scale is not detail —
 * it is dither, and the first probe frame came back speckled like a
 * bad JPEG. The honest average of a texture over 54 metres IS its
 * average colour, which is what the flat chart already had.
 *
 * So the texture is used for what it can honestly carry at this scale:
 * a slow mottle of the real thing over its own true colour. A third of
 * the weave, over two thirds mean, reads as ground rather than as
 * noise — and the colour is the ground's actual colour rather than a
 * palette somebody chose.
 */
const WEAVE_MIX = 0.34;

/**
 * Milliseconds of work between yields.
 *
 * A TIME BUDGET RATHER THAN A ROW COUNT, and the first version got this
 * wrong in a way worth writing down. Yielding every sixteen rows to
 * `requestAnimationFrame` ties the bake to the FRAME RATE: sixty-four
 * yields is about a second at sixty frames and over a minute at the
 * frame and a half a second the headless renderer manages, so the probe
 * waited four minutes and never saw a map. A budget does the same work
 * per slice whatever the renderer is doing.
 *
 * Ten milliseconds is under one frame at sixty, so a slice cannot be
 * the thing that drops one.
 */
const SLICE = 10;

/**
 * Hand the thread back, without waiting for a frame.
 *
 * A macrotask rather than `requestAnimationFrame`, for the reason
 * above: this must not run at the renderer's pace. The browser is free
 * to paint between two of these, which is all that was ever wanted.
 */
function breathe(): Promise<void> {
  return new Promise((go) => { setTimeout(go, 0); });
}

/** The size each band image is cut down to before it is read. */
const SWATCH = 256;

/**
 * THE SAME SEVEN WEIGHTS THE GROUND ITSELF USES, in metres.
 *
 * The first version of this asked `heightfield.bandFor` which band a
 * height was in, and that was wrong twice. `bandFor` is a SIX-step
 * chart abstraction — seabed, reef, sand, lowland, jungle, cliff, peak
 * — and the ground is made of SEVEN textures blended by smooth weights.
 * It has no `mountain` at all, so everything over 1,150 m came out
 * white, and every band met its neighbour on a hard line the terrain
 * feathers over tens of metres.
 *
 * So these are the terrain's own numbers, from `EDGES` in
 * terrainMaterial.ts, in the same order and with the same feathers. A
 * test reads that GLSL out of the source and fails if the two ever
 * disagree — one table, two consumers, and no way to change the ground
 * without the map following.
 */
export const BAND_EDGES: ReadonlyArray<{
  readonly name: string;
  readonly lo: number;
  readonly hi: number;
  readonly feather: number;
}> = [
  // reef is `1 - smoothstep(-3.5, 0.5)`: everything below the shore.
  { name: 'reef', lo: -1e9, hi: -1.5, feather: 2 },
  { name: 'sand', lo: -0.5, hi: 12, feather: 3.5 },
  { name: 'grass', lo: 10, hi: 220, feather: 14 },
  { name: 'jungle', lo: 200, hi: 700, feather: 40 },
  { name: 'cliff', lo: 660, hi: 1000, feather: 60 },
  { name: 'mountain', lo: 950, hi: 1280, feather: 80 },
  // snow is `smoothstep(1200, 1450)`: everything above, and no ceiling.
  { name: 'snow', lo: 1325, hi: 1e9, feather: 125 },
];

/** The seven ground maps, named exactly as `public/kauai-tex` holds them. */
const FILES: readonly string[] = BAND_EDGES.map((b) => b.name);

/** GLSL's smoothstep, so the two curves are the same curve. */
function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/**
 * How much of each band is showing at this height, in METRES.
 *
 * The shader's own `span`, and normalised: the weights are hand-tuned
 * overlaps rather than a partition, so they do not sum to one and a
 * blend that assumed they did would darken every seam. Below every
 * band — which happens under the sea floor — it is all reef.
 *
 * Pure and exported so the blend can be tested without a canvas; this
 * repo's test run has no DOM, and a rule that cannot be tested is one
 * that quietly stops holding.
 */
export function bandMix(metres: number): number[] {
  const out: number[] = [];
  let total = 0;
  for (const band of BAND_EDGES) {
    const on = smoothstep(band.lo - band.feather, band.lo + band.feather, metres)
      * (1 - smoothstep(band.hi - band.feather, band.hi + band.feather, metres));
    out.push(on);
    total += on;
  }
  if (total <= 1e-6) {
    out[0] = 1;
    return out;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

let relief: HTMLCanvasElement | null = null;
/** What the bake cost, milliseconds, or 0 before it has run. */
let cost = 0;
let working: Promise<HTMLCanvasElement | null> | null = null;

/**
 * What the bake cost, milliseconds — 0 until it has run.
 *
 * Recorded rather than estimated. This is a million heightfield samples
 * and seven texture decodes on whatever phone happens to be holding
 * it, and the whole argument for paying it behind the loading screen
 * rests on the number being what it is claimed to be.
 */
export function reliefCost(): number {
  return cost;
}

/** The textured island, or null while it is not built. Never blocks. */
export function reliefIsland(): HTMLCanvasElement | null {
  return relief;
}

/**
 * Build it, once. Safe to call repeatedly; the second caller gets the
 * first call's promise rather than a second bake.
 *
 * Resolves to null when the textures cannot be read, which is a
 * complete answer and not an error: the caller draws the flat chart.
 */
export function warmRelief(base = ''): Promise<HTMLCanvasElement | null> {
  if (relief) return Promise.resolve(relief);
  working ??= build(base).catch(() => null);
  return working;
}

/** For tests, and for a re-baked heightfield. */
export function forgetRelief(): void {
  relief = null;
  working = null;
}

async function build(base: string): Promise<HTMLCanvasElement | null> {
  const began = performance.now();
  const swatches = await swatchesOf(base);
  if (!swatches) return null;

  const size = RELIEF_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ink = canvas.getContext('2d');
  if (!ink) return null;
  const out = ink.createImageData(size, size);
  const step = ISLAND_SPAN / size;

  // ONE PASS FOR THE HEIGHTS. The shade needs each pixel's western and
  // northern neighbours, and asking the heightfield for them is asking
  // it the same question it has already answered. Held here instead, at
  // four bytes a pixel — a third of the samples the flat bake takes.
  //
  // AND IT IS CUT INTO SLICES, which is the part that matters more than
  // the sample count. MEASURED in the game rather than guessed: 4,785
  // ms for the whole bake, because `terrainHeight` also reads the HD
  // tiles that are resident around her — the arithmetic estimate of 428
  // ms came off a bare coarse grid and was not the thing that ships. A
  // synchronous five seconds is not a slow bake, it is a frozen game.
  // So each strip yields, and the whole thing lands a few seconds into
  // the run with the flat chart standing in until it does.
  const scratchA: number[] = [0, 0, 0];
  const scratchB: number[] = [0, 0, 0];
  const heights = new Float32Array(size * size);
  let due = performance.now() + SLICE;
  for (let y = 0; y < size; y++) {
    if (performance.now() >= due) {
      await breathe();
      due = performance.now() + SLICE;
    }
    const wz = y * step - ISLAND_SPAN / 2;
    for (let x = 0; x < size; x++) {
      heights[y * size + x] = terrainHeight(x * step - ISLAND_SPAN / 2, wz);
    }
  }

  for (let y = 0; y < size; y++) {
    if (performance.now() >= due) {
      await breathe();
      due = performance.now() + SLICE;
    }
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const here = heights[i];
      const at = i * 4;

      if (here <= 0) {
        // Water is the reef swatch, taken down toward the deep. The
        // shallows are most of what makes a tropical island legible
        // from above, so the ramp is generous near the shore.
        const deep = Math.min(1, -here / 30_000);
        const px = weave(swatches.reef, x, y, scratchA);
        out.data[at] = px[0] * (1 - deep) * 0.55 + 12 * deep;
        out.data[at + 1] = px[1] * (1 - deep) * 0.62 + 38 * deep;
        out.data[at + 2] = px[2] * (1 - deep) * 0.78 + 66 * deep;
        out.data[at + 3] = 255;
        continue;
      }

      const mix = bandMix(here / UNITS_PER_METRE);
      // Hillshade from the northwest, which is how every relief map
      // since the nineteenth century has been lit — get it wrong and
      // the eye reads the valleys as ridges.
      const west = heights[i - (x > 0 ? 1 : 0)];
      const north = heights[i - (y > 0 ? size : 0)];
      const lit = 1 + Math.max(-0.55, Math.min(0.55,
        ((here - west) + (here - north)) / 40_000));

      scratchB[0] = 0;
      scratchB[1] = 0;
      scratchB[2] = 0;
      for (let k = 0; k < BAND_EDGES.length; k++) {
        const share = mix[k];
        if (share <= 0.002) continue;
        const px = weave(swatches[BAND_EDGES[k].name], x, y, scratchA);
        scratchB[0] += px[0] * share;
        scratchB[1] += px[1] * share;
        scratchB[2] += px[2] * share;
      }
      for (let c = 0; c < 3; c++) {
        out.data[at + c] = Math.max(0, Math.min(255, scratchB[c] * lit));
      }
      out.data[at + 3] = 255;
    }
  }

  ink.putImageData(out, 0, 0);
  cost = performance.now() - began;
  relief = canvas;
  return canvas;
}

/** One tiled texel, pulled most of the way back to the texture's mean. */
function weave(swatch: Swatch, x: number, y: number, out: number[]): number[] {
  const u = Math.floor((x % WEAVE) * (SWATCH / WEAVE));
  const v = Math.floor((y % WEAVE) * (SWATCH / WEAVE));
  const at = (v * SWATCH + u) * 4;
  for (let c = 0; c < 3; c++) {
    out[c] = swatch.mean[c] + (swatch.px[at + c] - swatch.mean[c]) * WEAVE_MIX;
  }
  return out;
}

/** A ground map cut small, with the mean the weave is pulled toward. */
interface Swatch {
  readonly px: Uint8ClampedArray;
  readonly mean: readonly [number, number, number];
}

/**
 * The seven ground maps, each cut to a small square of raw bytes.
 *
 * Read through a canvas the same way `terrainMaterial.measureAverage`
 * reads them, which is also why this can work at all: they are
 * same-origin, so the readback is not tainted.
 */
async function swatchesOf(
  base: string,
): Promise<Record<string, Swatch> | null> {
  const canvas = document.createElement('canvas');
  canvas.width = SWATCH;
  canvas.height = SWATCH;
  const ink = canvas.getContext('2d', { willReadFrequently: true });
  if (!ink) return null;

  const swatches: Record<string, Swatch> = {};
  for (const name of FILES) {
    const image = await picture(`${base}kauai-tex/${name}.jpg`);
    if (!image) return null;
    ink.clearRect(0, 0, SWATCH, SWATCH);
    ink.drawImage(image, 0, 0, SWATCH, SWATCH);
    const px = ink.getImageData(0, 0, SWATCH, SWATCH).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < px.length; i += 4) {
      r += px[i];
      g += px[i + 1];
      b += px[i + 2];
    }
    const n = px.length / 4;
    swatches[name] = { px, mean: [r / n, g / n, b / n] };
  }
  return swatches;
}

function picture(url: string): Promise<HTMLImageElement | null> {
  return new Promise((settled) => {
    const image = new Image();
    image.onload = () => settled(image);
    image.onerror = () => settled(null);
    image.src = url;
  });
}
