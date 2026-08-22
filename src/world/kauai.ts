/**
 * KAUAI FOR ANTS — the island is a real place, not a noise dome.
 *
 * Beyond Extinction ships Kauai as an 8x8 board of Terrarium RGB height
 * tiles baked from USGS elevation data. `scripts/bakeKauai.py` decodes
 * those into one 1025-square grid of little-endian int16 DECIMETRES of
 * real elevation, which is `public/kauai-1025.bin` (2.1 MB). This module
 * loads that grid and answers "how high is the ground here".
 *
 * SCALE. The ant world runs the island at 1:1000, and one world unit is
 * about a centimetre — the player ant is ~1.4 units nose to gaster. So
 * real Kauai's 56 km becomes 56 m of world (5600 units), and its
 * 1592 m summit becomes 1.59 m (159 units). To an ant that is a
 * continent four thousand body-lengths across with a mountain over a
 * hundred body-lengths tall.
 *
 * Samples land every 5.47 units, so the grid alone is smooth at nose
 * level; `heightfield.ts` layers coarse detail on top for that, and the
 * eventual streamed fine window is what will carry true ground texture.
 */

/** Samples per side of the baked grid. */
import { pullBuffer } from './fetchBytes';

export const SAMPLES = 1025;

/**
 * World units spanned by the whole grid — 56 km of Kauai at TRUE SCALE.
 *
 * A world unit is a centimetre, and it is a centimetre to the terrain
 * as well as to the ant now. It was not: the island ran at 1:1000, so a
 * unit meant 1 cm to her and 10 m to the ground, and the two were using
 * rulers a thousand apart. That is why flight read as a missile — she
 * crossed the whole island in eighty seconds — and why the world felt
 * like a tabletop model, because it was one.
 *
 * 56 km is 5,600,000 centimetres, so that is the number. At her 0.7 m/s
 * top flight speed a straight crossing is about 22 hours; walking it is
 * nine days. That is the point rather than a problem: an expedition to
 * the far side of the island should be an expedition.
 *
 * TWO CONSEQUENCES, both handled elsewhere and both worth knowing:
 *
 * 1. float32 spacing at 5.6 million is 0.25 units — a quarter of her
 *    body length — so nothing may be handed to the GPU in absolute
 *    world coordinates. See origin.ts. JavaScript numbers are float64,
 *    where the spacing at this range is 1e-9 units, so the LOGICAL
 *    world costs nothing; only the render needs rebasing.
 *
 * 2. The baked grid is 1025 samples across all of it, which is one
 *    sample per 5,469 units. It carries the island's shape and nothing
 *    at ant scale. Everything finer is synthesised — see heightfield.
 */
export const SPAN = 5_600_000;

/** Distance between neighbouring samples, in world units. */
export const STEP = SPAN / (SAMPLES - 1);

/**
 * World units to a real metre. A unit is a centimetre, so a hundred.
 *
 * Named because it is the ONE number that defines the scale, and
 * because two tests silently encoded it as a literal and broke when it
 * moved. Anything converting between the world and real measurements
 * should go through this rather than through arithmetic on
 * HEIGHT_SCALE, which is a different question.
 */
export const UNITS_PER_METRE = 100;

/**
 * Decimetres of real elevation to world units. At true scale a world
 * unit IS a centimetre, so a decimetre of real height is ten of them —
 * a thousand times what it was, exactly as the horizontal span grew.
 * Scaling one without the other would flatten or spike the island.
 */
export const HEIGHT_SCALE = 10;

/** The bake's nodata marker; only ~70 samples carry it. */
const NODATA = -32768;

/** Deepest the seabed is allowed to reach, in world units. */
const SEA_FLOOR = -60_000;

export type HeightGrid = Int16Array;

/**
 * A blurred copy of the grid — the smoothing dial's other end.
 *
 * The same five-tap kernel StormTracker uses on its storm terrain:
 * the centre counted twice against its four neighbours. Run it a few
 * times rather than once with a wider kernel, because repeated small
 * passes approach a Gaussian and a wide box does not.
 *
 * Blurring the DATA is a different lever from scaling the height. A
 * height scale makes every crease shallower in proportion — a 67 degree
 * fold at half height is still a 34 degree fold. Blurring removes the
 * fold. That is why the two want separate dials.
 *
 * The sea is blurred along with the land on purpose. Holding the
 * coastline fixed would leave a sharp step exactly where the smoothing
 * is meant to be gentlest, which is the shore.
 */
export function blurGrid(grid: HeightGrid, passes: number): HeightGrid {
  let from: HeightGrid = grid;
  let to: HeightGrid = new Int16Array(grid.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let r = 0; r < SAMPLES; r++) {
      for (let c = 0; c < SAMPLES; c++) {
        const i = r * SAMPLES + c;
        const up = r > 0 ? from[i - SAMPLES] : from[i];
        const down = r < SAMPLES - 1 ? from[i + SAMPLES] : from[i];
        const left = c > 0 ? from[i - 1] : from[i];
        const right = c < SAMPLES - 1 ? from[i + 1] : from[i];
        to[i] = Math.round((from[i] * 2 + up + down + left + right) / 6);
      }
    }
    // Never write back over the caller's grid: the raw one is still
    // the other end of the blend.
    const swap: HeightGrid = from === grid ? new Int16Array(grid.length) : from;
    from = to;
    to = swap;
  }
  return from;
}

/**
 * Read the baked grid from an ArrayBuffer. Kept separate from fetching
 * so tests can feed it bytes straight off disk.
 */
export function decodeGrid(buffer: ArrayBuffer): HeightGrid {
  const expected = SAMPLES * SAMPLES * 2;
  if (buffer.byteLength !== expected) {
    throw new Error(
      `kauai grid is ${buffer.byteLength} bytes, expected ${expected}`,
    );
  }
  return new Int16Array(buffer);
}

/** Fetch and decode the baked grid that ships with the build. */
export async function loadGrid(
  /** Bytes as they land, for the boot screen's bar. */
  onProgress?: (done: number, total: number) => void,
): Promise<HeightGrid> {
  const url = `${import.meta.env.BASE_URL}kauai-1025.bin`;
  // THE SIZE IS KNOWN, so it is not asked for. `Content-Length` counts
  // what came down the WIRE, and a page host gzips a file of 16-bit
  // integers to about five sixths — so the bar was told 1.7 MB and then
  // handed 2.0 MB of decompressed bytes, and counted past its own
  // maximum. This is the number `decodeGrid` already insists on below,
  // which makes it the honest total and removes the server from the
  // question entirely.
  const total = SAMPLES * SAMPLES * 2;
  onProgress?.(0, total);
  const buffer = await pullBuffer(
    url,
    () => {},
    (done) => onProgress?.(Math.min(done, total), total),
  );
  return decodeGrid(buffer);
}

/** One raw sample as world height, with nodata and the abyss handled. */
function sampleAt(grid: HeightGrid, col: number, row: number): number {
  const c = col < 0 ? 0 : col > SAMPLES - 1 ? SAMPLES - 1 : col;
  const r = row < 0 ? 0 : row > SAMPLES - 1 ? SAMPLES - 1 : row;
  const raw = grid[r * SAMPLES + c];
  if (raw === NODATA) return SEA_FLOOR;
  const h = raw * HEIGHT_SCALE;
  return h < SEA_FLOOR ? SEA_FLOOR : h;
}

/**
 * Bilinear ground height at a world position, with the island centred
 * on the origin. Outside the grid the edge sample is held, which is
 * open ocean on every side.
 */
export function heightAt(grid: HeightGrid, x: number, z: number): number {
  const gx = (x + SPAN / 2) / STEP;
  const gz = (z + SPAN / 2) / STEP;
  const c = Math.floor(gx);
  const r = Math.floor(gz);
  const fx = gx - c;
  const fz = gz - r;
  const h00 = sampleAt(grid, c, r);
  const h10 = sampleAt(grid, c + 1, r);
  const h01 = sampleAt(grid, c, r + 1);
  const h11 = sampleAt(grid, c + 1, r + 1);
  const top = h00 + (h10 - h00) * fx;
  const bottom = h01 + (h11 - h01) * fx;
  return top + (bottom - top) * fz;
}

/**
 * Find somewhere on dry land to start, by scanning the grid rather
 * than trusting a hand-typed coordinate a re-bake could drop into the
 * sea.
 *
 * LEVEL ground is the whole point. Kauai is a genuinely steep island —
 * Waimea and the Na Pali coast are near-vertical — and a chase camera
 * sat behind an ant on a mountainside ends up inside the mountain,
 * clamped to the dirt and staring at a wall. So this scores flatness
 * and takes the calmest ground in the elevation band.
 */
export function findLandfall(
  grid: HeightGrid,
  minHeight: number,
  maxHeight: number,
): { x: number; z: number } {
  let best = { x: 0, z: 0 };
  let bestScore = -Infinity;
  const reach = 8;
  // Coarse scan; every 8th sample is plenty to find a good shoulder.
  for (let r = reach; r < SAMPLES - reach; r += reach) {
    for (let c = reach; c < SAMPLES - reach; c += reach) {
      const h = sampleAt(grid, c, r);
      if (h < minHeight || h > maxHeight) continue;
      const relief = Math.abs(h - sampleAt(grid, c + reach, r))
        + Math.abs(h - sampleAt(grid, c - reach, r))
        + Math.abs(h - sampleAt(grid, c, r + reach))
        + Math.abs(h - sampleAt(grid, c, r - reach));
      // Flattest wins; height within the band is a mild tiebreak only.
      const score = -relief - Math.abs(h - (minHeight + maxHeight) / 2) * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = { x: c * STEP - SPAN / 2, z: r * STEP - SPAN / 2 };
      }
    }
  }
  return best;
}

/**
 * How steep it is at a world position, as rise over run. Used to check
 * that somewhere is fit to stand and film from.
 */
export function slopeAt(grid: HeightGrid, x: number, z: number): number {
  const e = STEP;
  const dx = (heightAt(grid, x + e, z) - heightAt(grid, x - e, z)) / (2 * e);
  const dz = (heightAt(grid, x, z + e) - heightAt(grid, x, z - e)) / (2 * e);
  return Math.hypot(dx, dz);
}
