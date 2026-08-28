/**
 * THE SEA'S SWELL — one mathematical surface everybody asks.
 *
 * The ocean stops being a plane at y = 0 and becomes a sum of
 * travelling waves. The WHOLE design is that there is exactly ONE
 * answer to "how high is the sea here, now": this module. The
 * renderer displaces the near ocean sheet with the same wave table
 * (swellChunk() bakes it into the vertex shader as literals), the
 * water query adds it to the sea's depth so floating, landing,
 * diving, breath and the underwater look all ride the same surface,
 * and the tests read it directly. The old build's disease — renderer
 * says the water is HERE, gameplay says THERE — cannot start if
 * there is only one place an answer can come from.
 *
 * VERTICAL ONLY, deliberately. True Gerstner waves also displace
 * horizontally, sharpening crests — and making "height at (x, z)"
 * answerable only by iteration. At our steepnesses (centimetres of
 * amplitude over metres of wavelength) the sharpening is nearly
 * invisible, and an exact, cheap shared query is worth more than a
 * slightly pointier crest. The centimetre-scale chop that IS pointy
 * lives in the ripple texture (waterLook.ts), not in geometry.
 *
 * REAL DISPERSION AT ANT SCALE. Each wave runs at the deep-water
 * speed physics gives its wavelength (omega = sqrt(g * k), g in
 * cm/s^2 like everything else here), so the twelve-metre swell
 * genuinely outruns the six-metre wind sea. At her scale a
 * seven-centimetre amplitude is a rolling hill seven body lengths
 * high — moderate real water is already dramatic, which is why the
 * numbers are modest.
 *
 * THE SHORE IS EXEMPT. Amplitude fades with the water column
 * (DEPTH_LO..DEPTH_HI): waves die before the beach so the feathered
 * waterline the shoreline fought for is untouched, and no trough can
 * ground on a shelf shallower than the swell is tall. Breaking surf,
 * when it comes, is a different mechanism and a later pass.
 */

/** Gravity, in the world's own units — centimetres per second squared. */
const G = 981;

/**
 * Where the swell starts feeling the bottom and gives up, in depth.
 * Pulled IN at v0.0.80: the first band (50..250) kept the whole of a
 * knee-deep reef flat glassy — exactly where Joshua went swimming —
 * and "the ocean goes up and down but visually it's still flat" was
 * this fade doing its job too widely. Waves now live from shin-deep
 * water out, and the reach still fits the column with room to spare
 * (see the trough test).
 */
export const DEPTH_LO = 20;
export const DEPTH_HI = 120;

interface Wave {
  /** Unit propagation direction. */
  readonly dx: number;
  readonly dz: number;
  /** Wavenumber, 2 pi over wavelength. */
  readonly k: number;
  /** Angular frequency — sqrt(G k), deep-water dispersion. */
  readonly omega: number;
  /** Amplitude (half the wave height), world units. */
  readonly amp: number;
}

function wave(lambda: number, amp: number, towardDeg: number): Wave {
  const rad = (towardDeg * Math.PI) / 180;
  const k = (2 * Math.PI) / lambda;
  return {
    dx: Math.sin(rad),
    dz: -Math.cos(rad), // compass: 0 deg is -z (north), 90 is +x (east)
    k,
    omega: Math.sqrt(G * k),
    amp,
  };
}

/**
 * The wave table. Two components — geometry can afford no more at the
 * near sheet's vertex spacing (150 units; anything much shorter than
 * ~6 m aliases into mush), and the finer sea state is already carried
 * by the ripple texture. Headings put the swell out of the ENE trades
 * the weather chip keeps reporting, running toward the west-southwest.
 */
const WAVES: readonly Wave[] = [
  wave(1200, 7, 245), // the swell: 12 m, 14 cm trough-to-crest, T 2.8 s
  wave(640, 3, 222),  // wind sea: 6.4 m, 6 cm, T 2.0 s
];

/** The most the surface can ever leave sea level, either way. */
export const SWELL_REACH = WAVES.reduce((sum, w) => sum + w.amp, 0);

/**
 * ONE CLOCK. The scene advances it once a frame; the renderer's
 * uniform is set FROM it; every query reads it. Two copies of "now"
 * would be the old two-answers disease wearing a watch.
 */
let clock = 0;

/** Advance the sea by a frame. Returns the new time for the uniform. */
export function tickSwell(dt: number): number {
  clock += dt;
  return clock;
}

/** The sea's current time — what tickSwell last returned. */
export function swellTime(): number {
  return clock;
}

/** Reset with the scene, so a fresh run starts a fresh sea. */
export function resetSwell(): void {
  clock = 0;
}

/** Smoothstep, the shader's, so both sides fade identically. */
function smooth(lo: number, hi: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/**
 * How far the sea surface stands from y = 0 at this spot, NOW (the
 * module clock), over a column `depth` deep. Positive is a crest.
 */
export function seaSwellAt(wx: number, wz: number, depth: number): number {
  const fade = smooth(DEPTH_LO, DEPTH_HI, depth);
  if (fade <= 0) return 0;
  let y = 0;
  for (const w of WAVES) {
    y += w.amp * Math.cos((wx * w.dx + wz * w.dz) * w.k - w.omega * clock);
  }
  return y * fade;
}

/**
 * The same waves as GLSL, for the near ocean sheet's vertex shader.
 * Emits code that accumulates height into `sw` and the height
 * GRADIENT into `swSlope` (for the lighting normal), from `worldXZ`
 * and `uTime` — the caller provides both names in scope. Literals are
 * baked from the very table the CPU sums, which is the whole point.
 */
export function swellChunk(): string {
  return WAVES.map((w, i) => `
          float ph${i} = (worldXZ.x * ${w.dx.toFixed(6)} + worldXZ.y * ${w.dz.toFixed(6)}) * ${w.k.toFixed(8)} - ${w.omega.toFixed(6)} * uTime;
          sw += ${w.amp.toFixed(2)} * cos(ph${i});
          swSlope += vec2(${w.dx.toFixed(6)}, ${w.dz.toFixed(6)}) * (-${(w.amp * w.k).toFixed(6)} * sin(ph${i}));`).join('');
}
