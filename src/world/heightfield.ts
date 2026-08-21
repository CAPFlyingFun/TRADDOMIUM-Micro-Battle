/**
 * THE GROUND — one answer to "how high is it here", for everyone.
 *
 * The island mesh, the walking ant, the camera's floor clamp and the
 * tests all come through this module, so the island you see and the
 * island you walk can never drift apart.
 *
 * THEY HAD DRIFTED APART. That claim was true of the SOURCE and false
 * of the surface. `terrainHeight` is a smooth continuous function, but
 * the mesh drawn from it is flat triangles 10.94 units across — eleven
 * times the length of the ant — sampling that function only at their
 * corners. Between corners the two disagree, and measured across the
 * spawn area the drawn surface sat as much as 3.36 units ABOVE the
 * walked one. She stood correctly on a surface nobody could see, three
 * body lengths under the one they could, and clipped through it.
 *
 * So there are two heights now and the distinction is the whole point:
 *
 *   terrainHeight  the smooth source. What the mesh is BUILT from.
 *   groundHeight   the drawn triangle. What anything STANDS on.
 *
 * Everything that stands, walks, or clamps to the floor uses the
 * second, which makes the gap zero by construction rather than small
 * by luck. Raising the mesh resolution alone could not have fixed
 * this: at 513 verts a section — a quarter of a million vertices —
 * she still sank 0.06 units, and the cost is not payable on a phone.
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
 * The SOURCE surface at (x, z): real Kauai plus a touch of relief,
 * which fades out below the waterline so it cannot pimple the sea.
 *
 * This is what the terrain mesh is built from. It is not what anything
 * stands on — see `groundHeight`, which is the surface that gets drawn.
 */
export function terrainHeight(x: number, z: number): number {
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
 * THE TERRAIN LATTICE.
 *
 * The island is drawn as SECTIONS sections a side, each a grid of
 * NEAR_VERTS vertices. These live here rather than in the scene
 * because the surface anything stands on is a function of them: a
 * mesh built on one lattice and a walker standing on another is
 * exactly the bug this module now exists to prevent.
 */
export const SECTIONS = 8;
export const NEAR_VERTS = 65;
export const FAR_VERTS = 17;
const SECTION_SPAN = SPAN / SECTIONS;
/** Distance between drawn vertices, in world units. */
export const NEAR_STEP = SECTION_SPAN / (NEAR_VERTS - 1);

/**
 * Ground height at (x, z): the height of the TRIANGLE THAT IS DRAWN.
 *
 * The mesh splits each quad along the bl-tr diagonal (see the index
 * order in the scene's `buildSection`), so which of the two triangles
 * a point falls in decides its height, and the answer is a plane
 * rather than the smooth source. Reproducing that here is what puts
 * the ant on the surface the player can see.
 *
 * The lattice is the NEAR mesh's, because the section she is standing
 * in is always the near one — the far meshes only take over past
 * NEAR_RANGE, which is a thousand body lengths away.
 */
export function groundHeight(x: number, z: number): number {
  if (!grid) return 0;
  const step = NEAR_STEP;
  // Snap to the lattice the mesh is built on. Sections start at the
  // island's corner, and every section's grid is in phase with every
  // other, so one global lattice describes them all.
  const gx = (x + SPAN / 2) / step;
  const gz = (z + SPAN / 2) / step;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const corner = (cx: number, cz: number) =>
    terrainHeight(cx * step - SPAN / 2, cz * step - SPAN / 2);

  // Upper-left triangle, then the lower-right one. Each is a plane
  // through three corners, read off two edge gradients.
  if (fx + fz <= 1) {
    const tl = corner(ix, iz);
    return tl + (corner(ix + 1, iz) - tl) * fx + (corner(ix, iz + 1) - tl) * fz;
  }
  const br = corner(ix + 1, iz + 1);
  return br
    + (corner(ix, iz + 1) - br) * (1 - fx)
    + (corner(ix + 1, iz) - br) * (1 - fz);
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
