/**
 * The island heightfield — a pure, deterministic height function.
 *
 * TRADDOMIUM's first world is a small island: a soft dome that falls away
 * into water on every side, roughened by a couple of octaves of value
 * noise so the surface reads as terrain rather than a bump. Everything
 * that needs the ground (the mesh builder, the walker, tests) samples
 * this one function, so the visual island and the walkable island can
 * never disagree.
 *
 * All heights are in world units where the waterline sits at 0.
 */

export interface IslandParams {
  /** Distance from the centre at which the land dips under the water. */
  radius: number;
  /** Height of the smooth dome at the island's centre. */
  peak: number;
  /** Amplitude of the noise roughening the dome. */
  roughness: number;
  /** Seed for the noise field; same seed, same island. */
  seed: number;
}

export const DEFAULT_ISLAND: IslandParams = {
  radius: 40,
  peak: 7,
  roughness: 1.6,
  seed: 7,
};

/** Integer-lattice hash → [0, 1). Deterministic across platforms. */
function latticeHash(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 144665461) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** One octave of value noise: bilinear blend of lattice hashes. */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = latticeHash(ix, iy, seed);
  const b = latticeHash(ix + 1, iy, seed);
  const c = latticeHash(ix, iy + 1, seed);
  const d = latticeHash(ix + 1, iy + 1, seed);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

/** Two octaves centred on 0, in [-1, 1]. */
function terrainNoise(x: number, y: number, seed: number): number {
  const coarse = valueNoise(x * 0.08, y * 0.08, seed);
  const fine = valueNoise(x * 0.23, y * 0.23, seed + 1);
  return (coarse * 0.72 + fine * 0.28) * 2 - 1;
}

/**
 * Ground height at (x, z). Positive is dry land, negative is seabed.
 * Beyond ~1.4x the radius the seabed keeps falling so the horizon
 * never shows a shelf poking out of the water.
 */
export function groundHeight(
  x: number,
  z: number,
  params: IslandParams = DEFAULT_ISLAND,
): number {
  const d = Math.hypot(x, z) / params.radius;
  // Dome: peak at the centre, exactly 0 at d = 1, negative beyond.
  const dome = params.peak * (1 - d * d);
  // Noise fades to nothing at the rim so it cannot lift the coastline
  // back out of the water and turn the island into an archipelago.
  const rimFade = Math.max(0, 1 - d);
  const noise = terrainNoise(x, z, params.seed) * params.roughness * rimFade;
  return dome + noise;
}

/** Elevation bands the island mesh paints with. */
export type Band = 'seabed' | 'sand' | 'grass' | 'forest' | 'rock';

/**
 * Which band a given height belongs to. Thresholds are fractions of the
 * island's peak so re-tuning the peak keeps the bands proportioned.
 */
export function bandFor(height: number, params: IslandParams = DEFAULT_ISLAND): Band {
  if (height <= 0) return 'seabed';
  const t = height / params.peak;
  if (t < 0.1) return 'sand';
  if (t < 0.45) return 'grass';
  if (t < 0.8) return 'forest';
  return 'rock';
}
