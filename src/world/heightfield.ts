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
import { hdHeightAt } from './kauaiHd';
import { riverCut } from './riverBed';
import {
  blurGrid, cellSlope, heightAt, SPAN, STEP, UNITS_PER_METRE, type HeightGrid,
} from './kauai';

/**
 * THE SYNTHESISED GROUND.
 *
 * At true scale the baked grid is 1025 samples across 5.6 million
 * units — one sample every 5,469 units, or 55 metres of real Kauai.
 * That carries the island: its coastline, its valleys, its mountains,
 * every slope at the angle the real place has. What it cannot carry is
 * anything an ant could see. Bilinear interpolation between samples
 * 55 metres apart is a polished ramp.
 *
 * So the landforms are REAL and the surface is INVENTED, and the two
 * meet at the resolution the data runs out. These octaves cover from
 * twenty metres down to about a quarter of a metre, each roughly a
 * third the wavelength and a third the height of the one before —
 * self-affine, which is how ground actually behaves across scales.
 *
 * Nothing finer than 27 units, because the terrain lattice is 8 and an
 * octave near the sampling limit aliases into exactly the random hard
 * edges this game already spent a release removing.
 */
const OCTAVES: ReadonlyArray<readonly [wavelength: number, height: number]> = [
  [2048, 60],
  [700, 22],
  [240, 8],
  [80, 3],
  [27, 1.1],
];

/**
 * Where the procedural relief starts giving way, as a gradient.
 *
 * Half — a 27° slope. Gentle hills keep all their texture; anything
 * approaching a wall loses it in proportion.
 */
const STEEP_FROM = 0.5;
/** And where it has given up all it is going to. A 63° face. */
const STEEP_TO = 2;
/** What a sheer face keeps. Bare rock is not glass. */
const CLIFF_KEEPS = 0.34;

/** Wavelength of the shading mottle, in world units. */
const DETAIL_WAVELENGTH = 190;

let grid: HeightGrid | null = null;
/**
 * The same island, blurred. Baked once at load so the smoothing dial
 * is a blend between two grids rather than a blur per frame.
 */
let softGrid: HeightGrid | null = null;
/** 0 is real Kauai, 1 is the blurred copy. */
let smoothing = 0;

/** Hand the module the loaded island. Everything below stays flat until then. */
export function useGrid(loaded: HeightGrid): void {
  grid = loaded;
  softGrid = blurGrid(loaded, SMOOTH_PASSES);
}

/**
 * Blur passes at the dial's far end. Measured against the worst crease
 * within 400 units of the spawn, which starts at 66.8 degrees:
 *
 *    4 passes -> 35.3 deg, ground moves up to 5.77u
 *   10 passes -> 23.2 deg, up to 8.29u
 *   18 passes -> 16.6 deg, up to 10.19u
 *
 * Ten, because the returns fall off after it — eight more passes buy
 * another seven degrees and cost two more units of drift. It only has
 * to be the FURTHEST anyone would want; the dial picks how much of it.
 */
export const SMOOTH_PASSES = 10;

/**
 * TERRAIN SMOOTHING — 0 for real Kauai, 1 for the blurred copy.
 *
 * A different lever from the height dial and they are both worth
 * having. Scaling the height makes every crease shallower in
 * proportion: a 67 degree fold at half height is still 34 degrees.
 * Blurring removes the fold and leaves the island its size.
 *
 * Unlike the height scale, this CANNOT be a transform on the meshes —
 * a blur mixes neighbours, so the geometry has to be rebuilt. That is
 * why it lands on release rather than during a drag.
 */
export function setSmoothing(amount: number): void {
  smoothing = Math.min(1, Math.max(0, amount));
}

export function smoothingAmount(): number {
  return smoothing;
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
/**
 * The land before any water has had its say: grid, smoothing blend,
 * relief noise, shore ease. ONE function, factored out because
 * terrainHeight and farHeight each carried a copy and copies diverge —
 * a tuning edit made to one and not the other is a visible height seam
 * at the tier boundary.
 */
/**
 * How much of the procedural relief this ground should get, 0 to 1.
 * One on the flat, CLIFF_KEEPS on a wall, smooth in between.
 */
function calm(x: number, z: number): number {
  if (!grid) return 1;
  const steep = cellSlope(grid, x, z);
  const t = Math.min(1, Math.max(0, (steep - STEEP_FROM) / (STEEP_TO - STEEP_FROM)));
  const eased = t * t * (3 - 2 * t);
  return 1 - (1 - CLIFF_KEEPS) * eased;
}

/**
 * THE ISLAND. Grid, smoothing, and the noise that makes flat ground
 * read as ground — and nothing else, for the first time in a while.
 *
 * It briefly had a river trench cut into it, so that every consumer
 * would read one surface instead of the four that had grown up around
 * the water. That was the right shape for the problem and the water it
 * was cutting for is gone; what is left is the island the grid
 * describes. Whatever water comes back should decide for itself
 * whether the ground owes it a bed.
 */
export function baseLand(x: number, z: number): number {
  if (!grid) return 0;
  // THE FINE ISLAND WHERE IT HAS ARRIVED, the coarse one everywhere
  // else. The two hold the same number at every sample they share — the
  // bake asserts it on all 1,050,625 of them — so a tile landing adds
  // detail BETWEEN samples and never moves the ground under her.
  //
  // Note which end of the dial this is: the blend below runs from THIS
  // to the blurred copy of the coarse grid, so smoothing 0 is now real
  // Kauaʻi at 13.67 m and smoothing 1 is what the island has always
  // looked like. The dial did not change meaning; its sharp end simply
  // got sixteen times more island in it.
  const fine = hdHeightAt(x, z);
  const raw = fine ?? heightAt(grid, x, z);
  // Blend the two grids rather than blurring on the fly. The soft one
  // is baked once at load, so a dial halfway along costs one extra
  // lookup and a lerp instead of a twenty-five-tap convolution.
  const base = smoothing > 0 && softGrid
    ? raw + (heightAt(softGrid, x, z) - raw) * smoothing
    : raw;
  // THE SEA GETS NO PROCEDURAL RELIEF — but it does get the river
  // bed, and that is the whole difference between a continuous surface
  // and a cliff. Returning here used to skip the carve as well, so the
  // moment a run's ground dipped under 0 m the cut stopped dead: 1.55 m
  // of bed at one sample and none at the next, two units later. Every
  // river mouth on the island wore one. A carve that can be REFUSED is
  // the fault this project has now shipped twice.
  const shaped = base <= 0
    ? base
    : shapeLand(x, z, base);
  return shaped - riverCut(x, z, shaped);
}

/** The procedural relief over the baked island, eased at both ends. */
function shapeLand(x: number, z: number, base: number): number {
  let relief = 0;
  for (let i = 0; i < OCTAVES.length; i++) {
    const [wavelength, height] = OCTAVES[i];
    const s = 1 / wavelength;
    relief += (valueNoise(x * s, z * s, 17 + i * 31) * 2 - 1) * height;
  }
  // Ease the relief in over the first stretch of land so the beach
  // still meets the water cleanly rather than in a cliff of noise.
  const shore = Math.min(1, base / 400);

  // AND EASE IT OUT AGAIN ON THE STEEP GROUND, for the same reason at
  // the other end of the island.
  //
  // The octaves are ninety-four units of noise, which is what makes
  // flat ground read as ground rather than as polished stone. On a
  // near-vertical face it is what makes the skyline a row of teeth:
  // the lattice is 8 to 32 units across, the noise is three times
  // that, and every triangle on the silhouette gets its own spike.
  // Kauaʻi has some of the steepest terrain on Earth in it, so this is
  // not a rare case — it is the Nāpali coast and every valley wall.
  //
  // Faded on the BAKED slope rather than on the finished one, because
  // asking the relief how steep it is to decide how much relief to add
  // is a loop. A cliff keeps a third of it: bare rock is not glass,
  // and taking it all away trades teeth for plastic.
  return base + relief * shore * calm(x, z);
}


/**
 * THE SURFACE SHE STANDS ON — exactly `baseLand`.
 *
 * Kept as its own name because half the codebase asks for it by that
 * name, and because the distinction it used to draw is worth a line of
 * history. This was the near mesh's private reading of the ground: it
 * subtracted a river trench that the distance tiers did not, and a mesh
 * built on one reading with a walker standing on another is the bug
 * this module exists to prevent. With the water gone there is one
 * island and nothing to reconcile.
 */
export function terrainHeight(x: number, z: number): number {
  return baseLand(x, z);
}

/**
 * THE SURFACE A DISTANCE TIER SHOULD CARRY, given how coarsely it is
 * cut. `slack` is how much ground one of its vertices stands for.
 *
 * IT IS `baseLand` AND NOTHING ELSE. This function existed to solve a
 * problem the water made: the streamed cells carved a river trench and
 * the tiers, whose triangles are 31 m across, could not hold a 7 m
 * channel — so it brought the coarse ground down to the WATERLINE
 * instead, which is the honest coarse reading of a trench too small to
 * draw. That made the tiers a different island from the one she walks
 * on, and the seam between the two stood a metre proud at the edge of
 * the streamed window.
 *
 * With the water layer removed there is no trench to find and no second
 * surface to reconcile, so every tier reads the grid directly. `slack`
 * is kept in the signature because the tiers still pass it and because
 * whatever replaces the water will need it back — the lesson it encodes
 * is not about rivers, it is about what a coarse vertex is allowed to
 * claim for the square of ground it stands for.
 */
export function farHeight(x: number, z: number, slack = 0): number {
  void slack;
  return baseLand(x, z);
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
/**
 * A terrain cell, and how finely it is drawn. The island is no longer
 * one mesh cut into eight — at 5.6 million units that is not a thing
 * that can exist — but a small grid of cells STREAMED around her.
 */
export const CELL_SPAN = 512;
export const CELL_VERTS = 65;
/** Distance between drawn vertices, in world units. */
export const NEAR_STEP = CELL_SPAN / (CELL_VERTS - 1);
/** Cells a side in the streamed window. Odd, so she is in the middle. */
export const CELLS = 9;
/** The inner cells drawn at full detail; the rest get the coarse cut. */
export const FINE_CELLS = 3;
export const COARSE_VERTS = 17;

/**
 * VERTICAL RELIEF — how tall the island is, as a multiple.
 *
 * Kauai is one of the steepest landscapes on Earth: measured off this
 * grid, the median land slope is 11.5 degrees and a third of it is over
 * 20. At human scale that reads as scenery; at ant scale the camera is
 * a centimetre off the ground and every fold is in your face. So the
 * height gets a dial.
 *
 * It is applied HERE and as a scale on the section meshes, and the two
 * cannot disagree: a triangle's height interpolates linearly between
 * its corners, so scaling the corners and scaling the result are the
 * same arithmetic. Nothing is rebuilt when it moves — the terrain is a
 * mesh with a Y scale on it, which is why the slider is instant.
 *
 * It does NOT touch `terrainHeight`. That is what the mesh is built
 * from, once, at full height; flattening is a transform on top.
 */
let relief = 1;

export function setRelief(scale: number): void {
  relief = Math.max(0.01, scale);
}

export function reliefScale(): number {
  return relief;
}

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
  // Snap to the lattice the mesh is built on. Cells are placed on
  // multiples of their own span, so every cell's vertex grid is in
  // phase with every other and one global lattice describes them all —
  // which is what lets a walker read the drawn triangle without
  // knowing which cell it belongs to.
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
    return relief
      * (tl + (corner(ix + 1, iz) - tl) * fx + (corner(ix, iz + 1) - tl) * fz);
  }
  const br = corner(ix + 1, iz + 1);
  return relief * (br
    + (corner(ix, iz + 1) - br) * (1 - fx)
    + (corner(ix + 1, iz) - br) * (1 - fz));
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
 * Bands are keyed to REAL Kauai elevations, so the island wears the
 * biomes the actual place does. One real metre is UNITS_PER_METRE world
 * units — a hundred of them at true scale.
 *
 * This constant was 0.1, which was the 1:1000 conversion, and it stayed
 * 0.1 when the world went to true scale. Every threshold was then a
 * thousandth of what it should be, so a beach at 78 units — 78
 * centimetres above the sea — wore the textures of a 780-metre
 * mountainside.
 */
const M = UNITS_PER_METRE;
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
