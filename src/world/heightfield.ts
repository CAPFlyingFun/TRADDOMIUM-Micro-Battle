/**
 * THE GROUND — one answer to "how high is it here", for everyone.
 *
 * The island mesh, the walking ant, the camera's floor clamp and the
 * tests all come through this module, so the island you see and the
 * island you walk can never drift apart.
 *
 * Underneath is real Kauai (see `kauai.ts`). On top of it sits a little
 * procedural relief, because the baked grid samples every 5.47 units
 * and interpolates dead smooth between them, which at ant scale reads
 * as polished stone. That relief is deliberately kept at wavelengths
 * the terrain mesh can actually draw — put finer bumps in the height
 * and the ant walks a surface the mesh never shows, so she floats.
 *
 * Heights are world units with the waterline at 0.
 */
import {
  heightAt, SPAN, STEP, type HeightGrid,
} from './kauai';

/** Wavelength of the added relief, in world units. */
const RELIEF_WAVELENGTH = 64;

/** How tall that relief gets, in world units. */
const RELIEF_HEIGHT = 1.1;

/** Wavelength of the shading mottle, in world units. */
const DETAIL_WAVELENGTH = 19;

let grid: HeightGrid | null = null;

/** Hand the module the loaded island. Everything below stays flat until then. */
export function useGrid(loaded: HeightGrid): void {
  grid = loaded;
}

export function hasGrid(): boolean {
  return grid !== null;
}

/** Integer-lattice hash to [0, 1). Deterministic across platforms. */
function latticeHash(ix: number, iy: number, salt: number): number {
  let h = (ix * 374761393 + iy * 668265263 + salt * 144665461) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [0, 1): bilinear blend of lattice hashes. */
function valueNoise(x: number, y: number, salt: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = latticeHash(ix, iy, salt);
  const b = latticeHash(ix + 1, iy, salt);
  const c = latticeHash(ix, iy + 1, salt);
  const d = latticeHash(ix + 1, iy + 1, salt);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

/**
 * Ground height at (x, z): real Kauai plus a touch of relief, which
 * fades out below the waterline so it cannot pimple the sea.
 */
export function groundHeight(x: number, z: number): number {
  if (!grid) return 0;
  const base = heightAt(grid, x, z);
  if (base <= 0) return base;
  const s = 1 / RELIEF_WAVELENGTH;
  const relief = (valueNoise(x * s, z * s, 17) * 2 - 1) * RELIEF_HEIGHT;
  // Ease the relief in over the first metre of land so the beach still
  // meets the water cleanly.
  const shore = Math.min(1, base / 10);
  return base + relief * shore;
}

/**
 * Fine surface variation in [-1, 1] for SHADING ONLY. The walker never
 * reads this, so tinting the ground can never move where she stands.
 */
export function groundDetail(x: number, z: number): number {
  const s = 1 / DETAIL_WAVELENGTH;
  return valueNoise(x * s, z * s, 91) * 2 - 1;
}

/** Elevation bands the island mesh paints with. */
export type Band = 'seabed' | 'reef' | 'sand' | 'lowland' | 'jungle' | 'cliff' | 'peak';

/**
 * Bands are keyed to REAL Kauai elevations, converted through the
 * 1:1000 scale, so the island wears the biomes the actual place does.
 * One real metre is a tenth of a world unit.
 */
const M = 0.1;
const BAND_STEPS: Array<{ upTo: number; band: Band }> = [
  { upTo: -8 * M, band: 'seabed' },
  { upTo: 0, band: 'reef' },
  { upTo: 12 * M, band: 'sand' },
  { upTo: 220 * M, band: 'lowland' },
  { upTo: 700 * M, band: 'jungle' },
  { upTo: 1150 * M, band: 'cliff' },
];

export function bandFor(height: number): Band {
  for (const step of BAND_STEPS) {
    if (height <= step.upTo) return step.band;
  }
  return 'peak';
}

/** The island's full extent in world units, for scene setup. */
export const ISLAND_SPAN = SPAN;

/** Spacing of the underlying elevation samples, in world units. */
export const SAMPLE_STEP = STEP;
