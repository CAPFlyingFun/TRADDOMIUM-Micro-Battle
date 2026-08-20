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
export const SAMPLES = 1025;

/** World units spanned by the whole grid (56 km of Kauai at 1:1000). */
export const SPAN = 5600;

/** Distance between neighbouring samples, in world units. */
export const STEP = SPAN / (SAMPLES - 1);

/**
 * Decimetres of real elevation to world units. One real metre is one
 * in-world millimetre at 1:1000, and a world unit is ten millimetres,
 * so a decimetre of real height is a hundredth of a world unit.
 */
export const HEIGHT_SCALE = 0.01;

/** The bake's nodata marker; only ~70 samples carry it. */
const NODATA = -32768;

/** Deepest the seabed is allowed to reach, in world units. */
const SEA_FLOOR = -60;

export type HeightGrid = Int16Array;

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
export async function loadGrid(): Promise<HeightGrid> {
  const url = `${import.meta.env.BASE_URL}kauai-1025.bin`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`kauai grid ${url} failed: ${response.status}`);
  }
  return decodeGrid(await response.arrayBuffer());
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
