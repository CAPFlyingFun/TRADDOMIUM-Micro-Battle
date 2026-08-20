/**
 * GROUND GRAIN — the detail that makes movement readable.
 *
 * The island was one flat green, and a flat surface gives the eye
 * nothing to measure motion against: at ant scale you should see soil
 * grain and leaf litter streaming past, and without it a sprint and a
 * crawl look identical. That reads as dull controls when the controls
 * are fine.
 *
 * So this bakes a seamless multi-octave noise tile at boot and the
 * terrain wears it at centimetre scale. No asset to ship, no fetch to
 * wait on, and the fine octaves supply optical flow while the coarse
 * ones break up the repeat.
 */

/** How many world units one tile of the grain covers. */
export const GROUND_TILE = 32;

const SIZE = 512;
/** Lattice cells for each octave, coarsest first. */
const OCTAVES = [4, 8, 16, 48, 128];

function hash(i: number, j: number, seed: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smoothstep, so the lattice does not show as diamonds. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * One octave of value noise over the unit square, wrapping exactly at
 * the edges. The wrap is what makes the tile seamless: the lattice
 * index is taken modulo the cell count, so x = 1 reads the same corner
 * as x = 0.
 */
export function octave(x: number, y: number, cells: number, seed: number): number {
  const gx = x * cells;
  const gy = y * cells;
  const i = Math.floor(gx);
  const j = Math.floor(gy);
  const fx = ease(gx - i);
  const fy = ease(gy - j);
  const wrap = (n: number) => ((n % cells) + cells) % cells;
  const i0 = wrap(i);
  const j0 = wrap(j);
  const i1 = wrap(i + 1);
  const j1 = wrap(j + 1);

  const top = hash(i0, j0, seed) * (1 - fx) + hash(i1, j0, seed) * fx;
  const bottom = hash(i0, j1, seed) * (1 - fx) + hash(i1, j1, seed) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Fractal value noise over the unit square, seamless at the edges. */
export function grain(x: number, y: number, seed = 1): number {
  let total = 0;
  let amplitude = 1;
  let sum = 0;
  for (const cells of OCTAVES) {
    total += octave(x, y, cells, seed + cells) * amplitude;
    sum += amplitude;
    amplitude *= 0.55;
  }
  return total / sum;
}

/**
 * Paint the tile into RGBA bytes.
 *
 * Kept separate from anything three.js so the arithmetic can be tested
 * without a WebGL context — the seam is the thing worth pinning, and a
 * seam only shows up on a real device once the grain is already wrong.
 */
export function bakeGrain(size = SIZE): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Brightness carries the grain; a second, unrelated field shifts
      // it warm or cool so the ground reads as soil and leaf rather
      // than as grey noise over green.
      const light = 0.74 + grain(u, v, 1) * 0.5;
      const warmth = (grain(u, v, 97) - 0.5) * 0.16;
      const at = (y * size + x) * 4;
      pixels[at] = Math.min(255, Math.round(255 * light * (1 + warmth)));
      pixels[at + 1] = Math.min(255, Math.round(255 * light));
      pixels[at + 2] = Math.min(255, Math.round(255 * light * (1 - warmth)));
      pixels[at + 3] = 255;
    }
  }
  return pixels;
}

export const GRAIN_SIZE = SIZE;
