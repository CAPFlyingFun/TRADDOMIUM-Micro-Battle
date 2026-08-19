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

/**
 * One world unit is roughly a centimetre — the player ant is about 1.4
 * units nose to gaster. So this island runs ~10 m across with hills the
 * better part of a metre high: minutes of walking to cross, not
 * seconds, which is the "huge tiny world" the design asks for.
 *
 * Growing it much beyond this wants a streaming/LOD pass, because the
 * terrain is still drawn as one flat grid (see IslandScene).
 */
export const DEFAULT_ISLAND: IslandParams = {
  radius: 500,
  peak: 90,
  roughness: 25,
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

/**
 * Octaves, expressed as cycles ACROSS THE ISLAND rather than in world
 * units, so the landform keeps its proportions at any radius. Resizing
 * the island can therefore never turn the hills into gravel.
 *
 * Frequency f means a wavelength of radius/f, so the finest octave here
 * still spans tens of world units — comfortably wider than a terrain
 * mesh quad, which keeps the drawn surface close to the true one.
 */
const OCTAVES = [
  { freq: 2.3, amp: 1 }, // broad landforms: a couple of hills and a valley
  { freq: 5.9, amp: 0.42 }, // ridges and shoulders
  { freq: 14.6, amp: 0.16 }, // local relief underfoot
];
const AMP_TOTAL = OCTAVES.reduce((sum, o) => sum + o.amp, 0);

/** Summed octaves centred on 0, in [-1, 1]. */
function terrainNoise(x: number, y: number, params: IslandParams): number {
  let sum = 0;
  for (let i = 0; i < OCTAVES.length; i++) {
    const { freq, amp } = OCTAVES[i];
    const s = freq / params.radius;
    sum += (valueNoise(x * s, y * s, params.seed + i) * 2 - 1) * amp;
  }
  return sum / AMP_TOTAL;
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
  // Noise fades out over the last stretch before the rim, so it cannot
  // lift the coastline back out of the water and scatter the island
  // into an archipelago. Confining the fade to that band matters: taper
  // it across the whole radius and the entire outer half of the island
  // flattens into bare dome, which is a long walk over nothing.
  const rimFade = Math.min(1, Math.max(0, (1 - d) / 0.18));
  const noise = terrainNoise(x, z, params) * params.roughness * rimFade;
  return dome + noise;
}

/**
 * Fine surface variation in [-1, 1], for SHADING ONLY — the walker must
 * not read this, so tinting the ground can never move where she stands.
 */
export function groundDetail(
  x: number,
  z: number,
  params: IslandParams = DEFAULT_ISLAND,
): number {
  const s = 30 / params.radius;
  return valueNoise(x * s, z * s, params.seed + 91) * 2 - 1;
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
