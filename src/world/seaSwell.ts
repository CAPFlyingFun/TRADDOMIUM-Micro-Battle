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
 * cm/s^2 like everything else here), so the nine-metre swell
 * genuinely outruns the shorter wind sea. At her scale a nine-
 * centimetre amplitude is a rolling hill nine body lengths high, and
 * shoaled at the shore it is nearer twenty-five.
 *
 * THE SHORE IS WHERE THEY GROW, not where they die — see the
 * shoaling block below. Only the last few centimetres of swash flatten
 * out, so the feathered waterline is untouched, and a trough is kept
 * off the bed by KEEL.
 */

/** Gravity, in the world's own units — centimetres per second squared. */
const G = 981;

/**
 * SHOALING — waves GROW toward the shore, they do not fade away.
 *
 * The first two cuts of this file faded amplitude to nothing in
 * shallow water, to protect the beach. That is backwards, and Joshua
 * caught it twice: "the ocean goes up and down but visually it's
 * still flat", then "offshore is smaller waves... as the waves get
 * closer to shore they visually get taller and more obvious." He is
 * describing shoaling, which is what real water does — a wave slows
 * over a rising bottom, its energy packs into a shorter, taller form,
 * and it steepens until it breaks.
 *
 * Green's law gives the height as depth^(-1/4). REFERENCE_DEPTH is
 * where the table's amplitudes are the honest ones; shallower water
 * multiplies them, capped at SHOAL_CAP so the arithmetic cannot run
 * away over a reef. Only in the last few centimetres — the swash,
 * where the foam takes over — does a taper bring the surface back to
 * flat, so the feathered waterline stays exactly where it was.
 *
 * WHY IT MATTERS VISUALLY: a wave reads by its SLOPE, not its height.
 * Amplitude times wavenumber is that slope, and offshore this table
 * is about 4 degrees — invisible at the grazing angle an ant sees.
 * Shoaled at the shore it is nearer fifteen, which is a wave you can
 * watch coming.
 */
export const REFERENCE_DEPTH = 700;
export const SHOAL_CAP = 2.2;
/** Below this the swash flattens the surface; above it, full shoaling. */
export const SWASH_LO = 6;
export const SWASH_HI = 34;
/**
 * A trough may not cut below the bed — it stops this far above it.
 * Without this a shoaled wave in shallow water drives the sheet
 * through the sand, which is both wrong and a z-fight.
 */
export const KEEL = 4;

/**
 * How much this depth multiplies the table's amplitudes. The GLSL in
 * shoalChunk() computes exactly this; if one changes the other must.
 */
export function shoalAt(depth: number): number {
  const grown = Math.pow(REFERENCE_DEPTH / Math.max(depth, 30), 0.25);
  const capped = Math.min(SHOAL_CAP, Math.max(1, grown));
  const t = Math.min(1, Math.max(0, (depth - SWASH_LO) / (SWASH_HI - SWASH_LO)));
  return capped * (t * t * (3 - 2 * t));
}

/** The same, as GLSL, from a `depth` in scope into `shoal`. */
export function shoalChunk(): string {
  return `
          float shoal = clamp(pow(${REFERENCE_DEPTH.toFixed(1)} / max(depth, 30.0), 0.25), 1.0, ${SHOAL_CAP.toFixed(2)})
            * smoothstep(${SWASH_LO.toFixed(1)}, ${SWASH_HI.toFixed(1)}, depth);`;
}

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
  // STEEPNESS IS WHAT YOU SEE, and the first three cuts of this table
  // had none: 13 cm of amplitude spread over nine metres is a slope of
  // three degrees, which at an ant's grazing view is a flat sheet that
  // nonetheless carries her up and down — "I am above and below the
  // surface, haha." These are short and tall enough to READ: about
  // twelve degrees of face offshore, and half again as steep once
  // shoaling has hold of them at the shore.
  wave(360, 16, 245), // the swell: 3.6 m, 32 cm crest-to-trough, T 1.5 s
  wave(210, 6, 222),  // wind sea: 2.1 m, 12 cm, T 1.1 s
];

/** The most the surface can ever leave sea level, either way. */
export const SWELL_REACH = WAVES.reduce((sum, w) => sum + w.amp, 0) * SHOAL_CAP;

/**
 * The primary swell's angular frequency — the BEAT of the sea. The
 * breaking surf (waterLook.ts) marches its foam fronts shoreward on
 * this clock, so the rhythm at the beach is the rhythm of the very
 * waves that died at the fade band to become that surf.
 */
export const SWELL_BEAT = WAVES[0].omega;

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

/**
 * How far the sea surface stands from y = 0 at this spot, NOW (the
 * module clock), over a column `depth` deep. Positive is a crest.
 */
export function seaSwellAt(wx: number, wz: number, depth: number): number {
  const shoal = shoalAt(depth);
  if (shoal <= 0) return 0;
  let y = 0;
  for (const w of WAVES) {
    y += w.amp * Math.cos((wx * w.dx + wz * w.dz) * w.k - w.omega * clock);
  }
  // A trough cannot cut below the bed it is running over.
  return Math.max(y * shoal, -Math.max(0, depth - KEEL));
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
