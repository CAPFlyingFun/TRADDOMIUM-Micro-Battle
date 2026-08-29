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

import { groundHeight } from './heightfield';

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
 * WATER CANNOT HOLD A WAVE TALLER THAN ITSELF.
 *
 * Green's law above is only half the shore. It grows a wave as the
 * bottom rises and has no opinion about whether the water it is
 * growing in could physically carry the result — so left alone it
 * produced, measured at Stage C, a crest standing 1.85 m over half a
 * metre of water. That is not a big wave, it is an impossible one.
 *
 * The classic breaker index closes it: a wave breaks when its HEIGHT
 * approaches about 0.78 of the depth (McCowan's solitary-wave limit,
 * near enough for a beach and the number every surf-zone model starts
 * from). Height is twice amplitude, so the surface may stand at most
 * 0.39 of the depth from mean — and in the saturated inner surf zone
 * real waves sit ON that line rather than under it, which is why the
 * envelope asymptotes to it instead of stopping short.
 *
 * WHY IT IS SMOOTH. A hard `min` of the two is a crease: the whole
 * shoreline would carry a ring at the depth where the branch flips,
 * and a queen crossing it would see the sea change slope in a step.
 * This is a soft minimum instead —
 *
 *     shoal = green * limit / (green^n + limit^n)^(1/n)
 *
 * — which is smooth everywhere, never exceeds either input, and at
 * n = 4 is within 1.5% of Green's law until the limit is close.
 * Offshore, where the limit is forty times the wave, the departure is
 * one part in ten million: the deep sea is not touched.
 *
 * A FUNCTION OF STILL-WATER DEPTH, deliberately. If the limit read the
 * live column — the bed plus the wave standing on it — it would
 * modulate itself at wave rate and the sea would breathe. The bed does
 * not move within a frame, so neither does the envelope.
 */
export const BREAKER_INDEX = 0.78;
/** The same limit as an AMPLITUDE — half the height. */
export const BREAKER_AMPLITUDE = BREAKER_INDEX / 2;
/** How sharply the envelope turns onto the limit. Higher is tighter. */
export const BREAK_SOFTNESS = 4;

/**
 * Green's law alone — what the shoaling WANTS, before the water gets
 * a say. Kept public because "how much of the wave the depth took
 * away" is the surf zone's own definition (see `brokenAt`), and it
 * cannot be read off the capped answer by itself.
 */
export function greenShoalAt(depth: number): number {
  const grown = Math.pow(REFERENCE_DEPTH / Math.max(depth, 30), 0.25);
  const capped = Math.min(SHOAL_CAP, Math.max(1, grown));
  const t = Math.min(1, Math.max(0, (depth - SWASH_LO) / (SWASH_HI - SWASH_LO)));
  return capped * (t * t * (3 - 2 * t));
}

/** The tallest the surface may stand here, world units from mean. */
export function breakerAmplitudeAt(depth: number): number {
  return BREAKER_AMPLITUDE * Math.max(0, depth);
}

/** Soft minimum — see the comment above BREAKER_INDEX. */
function softMin(a: number, b: number): number {
  const n = BREAK_SOFTNESS;
  const sum = Math.pow(a, n) + Math.pow(b, n);
  if (sum <= 0) return 0;
  return (a * b) / Math.pow(sum, 1 / n);
}

/**
 * How much this depth multiplies the table's amplitudes — Green's law
 * grown into the depth limit. The GLSL in shoalChunk() computes
 * exactly this; if one changes the other must, and
 * tests/breaker.test.ts holds them together across the whole shore.
 */
export function shoalAt(depth: number): number {
  const green = greenShoalAt(depth);
  if (green <= 0) return 0;
  const peak = swellAmplitude();
  if (peak <= 0) return green;
  // The limit expressed in the same units as `green`: the multiplier
  // that would put the table exactly on the breaking line.
  return softMin(green, breakerAmplitudeAt(depth) / peak);
}

/**
 * HOW MUCH OF THE WAVE THE DEPTH TOOK, 0 to 1 — the surf zone's own
 * measure of itself.
 *
 * Nought where the water is deep enough to carry the whole wave, one
 * where the depth is holding nearly all of it down. The energy the
 * envelope removes has not vanished; it is what surf.ts spends as a
 * shoreward bore, so the same number that flattens the geometry is the
 * number that drives the surge.
 */
export function brokenAt(depth: number): number {
  const green = greenShoalAt(depth);
  if (green <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - shoalAt(depth) / green));
}

/**
 * The same, as GLSL, from a `depth` in scope into `shoal`.
 *
 * The peak amplitude is BAKED rather than sent as a uniform because it
 * cannot change within a generation: wave groups move each component's
 * live amplitude (that is `uWaveAmp`), but the envelope this cap is
 * built from is the generation's own peak, and a new generation
 * rebuilds the material anyway.
 */
export function shoalChunk(): string {
  const peak = Math.max(swellAmplitude(), 1e-6);
  const n = BREAK_SOFTNESS.toFixed(1);
  return `
          float green = clamp(pow(${REFERENCE_DEPTH.toFixed(1)} / max(depth, 30.0), 0.25), 1.0, ${SHOAL_CAP.toFixed(2)})
            * smoothstep(${SWASH_LO.toFixed(1)}, ${SWASH_HI.toFixed(1)}, depth);
          // Water cannot hold a wave taller than itself — see seaSwell.ts.
          float breakLimit = ${BREAKER_AMPLITUDE.toFixed(4)} * max(depth, 0.0) / ${peak.toFixed(4)};
          float softSum = pow(green, ${n}) + pow(breakLimit, ${n});
          float shoal = softSum > 0.0
            ? green * breakLimit * pow(softSum, ${(-1 / BREAK_SOFTNESS).toFixed(4)})
            : 0.0;`;
}

export interface Wave {
  /** Unit propagation direction. */
  readonly dx: number;
  readonly dz: number;
  /** Wavenumber, 2 pi over wavelength. */
  readonly k: number;
  /** Angular frequency — sqrt(G k), deep-water dispersion. */
  readonly omega: number;
  /** Amplitude (half the wave height), world units. The BASE — see
   *  `envelope`, which is what actually reaches the water. */
  readonly amp: number;
  /**
   * The slow swell and lull of this component's energy, around 1.
   *
   * A procedural sea arrives in SETS, and that is a modulation of
   * amplitude over tens of seconds rather than a different wave. The
   * built-in table has none; a generated field brings one per
   * component. Read once a frame by tickSwell, never per sample, so
   * every consumer of the sea sees the same amplitude in the same
   * frame.
   */
  readonly envelope?: (seconds: number) => number;
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
const DEFAULT_WAVES: readonly Wave[] = [
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

/**
 * The table's own amplitude sum, BEFORE any shoaling — half the wave
 * height out where the amplitudes are honest (REFERENCE_DEPTH).
 *
 * CACHED, because `shoalAt` asks for it and `shoalAt` is asked per
 * lattice corner per query. Computing it means sampling every
 * component's envelope for its peak, which is fine once a generation
 * and ruinous several thousand times a frame.
 */
export function swellAmplitude(): number {
  return peakSum;
}

/** The most the surface can ever leave sea level, either way. */
export function swellReach(): number {
  return swellAmplitude() * SHOAL_CAP;
}

/**
 * THE SEA'S OWN PERIOD, energy-weighted — seconds.
 *
 * Anything sized in "how long can a wave hold something under" is a
 * fraction of THIS, not a constant. The camera's patience and the
 * underwater tint's hysteresis were both swept against a 1.5 s sea and
 * would fire on every crest of a 6 s one; expressed as beats of the
 * sea actually running, they follow it instead.
 *
 * Weighted by A^2 because that is energy, which is what makes a wave
 * the one you notice. The shipped table comes out at 1.47 s, which is
 * the number those constants were swept against.
 */
export function swellPeriod(): number {
  return meanPeriod;
}

/**
 * WHERE HEAVE ENDS AND CHOP BEGINS — the corner of the camera's
 * spectral filter, in seconds of period.
 *
 * THREE SECONDS, and it is not picked. It is the geometric mean of the
 * two periods this game's sea is designed around: the 6 s dominant
 * swell the buoy reports, and the 1.518 s chop TMB has always drawn
 * (MESO_PERIOD_S). sqrt(6 * 1.518) = 3.02. The generated field leaves
 * an empty gap between those populations — nothing lands between
 * 1.84 s and 5.43 s — and the corner sits in the middle of it, so the
 * split does not need the generator's macro/meso LABEL to reproduce
 * the generator's macro/meso SPLIT.
 *
 * THIRD ORDER, and that is not picked either: it is the least order
 * that passes every macro component above 95% while holding every
 * meso component below 25%. Second order leaves the 1.84 s chop at
 * 35%, which is still bobbing.
 */
export const HEAVE_CORNER_S = 3;
export const HEAVE_ORDER = 3;

/**
 * How much of a component of this frequency the camera should follow.
 *
 * A Butterworth-shaped low pass — but evaluated PER COMPONENT against
 * the table, not run over the signal in time. That distinction is the
 * whole of Stage E: a temporal filter of the same shape lags by up to
 * a quarter period, which on a 6 s swell is a second and a half of
 * camera sitting in the last trough while the next crest arrives. A
 * spectral one has NO phase at all — every component is evaluated at
 * the same instant, from the same clock, off the same table — so the
 * reference is exactly in step with the sea it came from.
 */
export function heaveGain(omega: number): number {
  const period = (2 * Math.PI) / Math.max(omega, 1e-9);
  const ratio = HEAVE_CORNER_S / period;
  return 1 / Math.sqrt(1 + Math.pow(ratio, 2 * HEAVE_ORDER));
}

/**
 * THE TABLE IN FORCE, and the fact that it can be replaced.
 *
 * The built-in two waves are the sea TMB has always drawn and remain
 * the default; a procedural field (weather/waveField.ts, by way of
 * world/liveSea.ts) can stand in behind a dev flag. EVERYTHING that
 * asks the sea a question comes through this module — the vertex
 * shader's baked chunk, the CPU height query the queen floats on, the
 * orbital current, the surf's breaker depth, the camera's water query
 * and the underwater test — so swapping the table here swaps the
 * whole ocean at once, and there is no way to end up with a rendered
 * sea and a gameplay sea that disagree.
 */
let waves: readonly Wave[] = DEFAULT_WAVES;

/**
 * The live amplitude of each component, this frame — base times its
 * envelope. Recomputed once per tick rather than per sample, because a
 * height query that re-evaluated the envelope would be answering about
 * a slightly different sea every time it was asked.
 */
let liveAmp: number[] = DEFAULT_WAVES.map((w) => w.amp);

/**
 * What the shader reads instead of a baked amplitude literal.
 *
 * The wavenumber, frequency and heading of a component do not change
 * within a generation and stay baked; the AMPLITUDE does, because that
 * is where wave groups live. One array, shared by both ocean sheets,
 * filled from the very numbers `liveAmp` hands the CPU.
 */
export const SWELL_AMP_UNIFORM: { value: number[] } = {
  value: DEFAULT_WAVES.map((w) => w.amp),
};

/** The largest an envelope can make a component, for reach maths. */
function peakEnvelope(w: Wave): number {
  if (!w.envelope) return 1;
  let peak = 1;
  // Sampled rather than assumed: the envelope is somebody else's
  // function and its bound is not this module's to know.
  for (let i = 0; i < 240; i++) peak = Math.max(peak, w.envelope(i * 7.3));
  return peak;
}

/**
 * Swap the sea. Null restores the built-in table.
 *
 * The SHADER does not follow on its own — its chunk is baked at
 * compile time — so whoever calls this must rebuild the water for the
 * geometry to agree with the physics. Ocean is disposed and recreated
 * for exactly that reason (see IslandScene.rebuildOcean).
 */
export function setWaveTable(table: readonly Wave[] | null): void {
  waves = table && table.length > 0 ? table : DEFAULT_WAVES;
  liveAmp = waves.map((w) => w.amp);
  SWELL_AMP_UNIFORM.value = liveAmp.slice();
  // The generation's peak, measured once. It is what the depth limit
  // is written against, so it must not wander within a generation —
  // an envelope that moved the cap would move the whole shoreline
  // with it, at group rate.
  peakSum = waves.reduce((sum, w) => sum + w.amp * peakEnvelope(w), 0);
  heaveGains = waves.map((w) => heaveGain(w.omega));
  const energy = waves.reduce((sum, w) => sum + w.amp * w.amp, 0);
  meanPeriod = energy > 0
    ? waves.reduce((sum, w) => sum + w.amp * w.amp * ((2 * Math.PI) / w.omega), 0) / energy
    : 1;
  refreshAmplitudes();
}

/** @see swellAmplitude. Set only by setWaveTable. */
let peakSum = DEFAULT_WAVES.reduce((sum, w) => sum + w.amp, 0);
/** @see heaveGain — one per component, recomputed with the table. */
let heaveGains: number[] = DEFAULT_WAVES.map((w) => heaveGain(w.omega));
/** @see swellPeriod. */
let meanPeriod = DEFAULT_WAVES.reduce((s2, w) => s2 + w.amp * w.amp
  * ((2 * Math.PI) / w.omega), 0)
  / DEFAULT_WAVES.reduce((s2, w) => s2 + w.amp * w.amp, 0);

/** The table in force, for probes and reports. */
export function activeWaves(): readonly Wave[] {
  return waves;
}

/** Whether the sea is the built-in one. */
export function isDefaultSea(): boolean {
  return waves === DEFAULT_WAVES;
}

/** Recompute every component's live amplitude for the current clock. */
function refreshAmplitudes(): void {
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    liveAmp[i] = w.envelope ? w.amp * w.envelope(clock) : w.amp;
    SWELL_AMP_UNIFORM.value[i] = liveAmp[i];
  }
}

/**
 * The primary swell's angular frequency — the BEAT of the sea. The
 * breaking surf (waterLook.ts) marches its foam fronts shoreward on
 * this clock, so the rhythm at the beach is the rhythm of the very
 * waves that died at the fade band to become that surf.
 */
export function swellBeat(): number {
  return waves[0].omega;
}

/**
 * ONE CLOCK. The scene advances it once a frame; the renderer's
 * uniform is set FROM it; every query reads it. Two copies of "now"
 * would be the old two-answers disease wearing a watch.
 */
let clock = 0;

/** Advance the sea by a frame. Returns the new time for the uniform. */
export function tickSwell(dt: number): number {
  clock += dt;
  // ONCE A FRAME, for everybody. A height query that re-evaluated the
  // envelope per sample would answer about a slightly different sea
  // each time it was asked, and the renderer, the queen and the surf
  // would quietly disagree within a single frame.
  refreshAmplitudes();
  return clock;
}

/** The sea's current time — what tickSwell last returned. */
export function swellTime(): number {
  return clock;
}

/**
 * Reset with the scene, so a fresh run starts a fresh sea — clock,
 * mesh AND table. This is the full clean slate: the shipped two-wave
 * ocean is back afterwards, which is what stops one test (or one
 * scene) leaking a generated sea into the next.
 */
export function resetSwell(): void {
  clock = 0;
  lattice = null;
  setWaveTable(null);
}

/**
 * THE CLOCK AND THE MESH ONLY — the table stands.
 *
 * A rebuilt ocean mesh needs the shared clock at zero and the old
 * lattice forgotten; it has NO opinion about which waves are running,
 * because WHICH SEA is a scene decision and the mesh is only what
 * draws it. Ocean used to call the full reset here, and the result
 * was that installing a generated table and then rebuilding the water
 * so the shader could follow it put the shipped table straight back —
 * `?sea=procedural` reported itself as on while the ocean underneath
 * was still the old two waves.
 */
export function restartSwellClock(): void {
  clock = 0;
  lattice = null;
  refreshAmplitudes();
}

/**
 * The analytic surface at a point — the maths, before any mesh.
 *
 * @param gains an optional per-component weight. Null is THE SEA: every
 *   component at full weight, keel clamp and all, and the only answer
 *   any physics may use. A weight array asks for a SPECTRAL SLICE of
 *   that same sum — same table, same clock, same shoaling, same
 *   instant — which is what the camera's heave reference is made of.
 *   A slice is not a surface and does not get the keel clamp: the keel
 *   is a floor on where the water may be, and a slice is not where the
 *   water is. (Stage D's depth envelope made the clamp inert in any
 *   case; it has not fired since v0.0.105.)
 */
function rawSwell(
  wx: number, wz: number, depth: number, gains: number[] | null = null,
): number {
  const shoal = shoalAt(depth);
  if (shoal <= 0) return 0;
  let y = 0;
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    const a = gains ? liveAmp[i] * gains[i] : liveAmp[i];
    y += a * Math.cos((wx * w.dx + wz * w.dz) * w.k - w.omega * clock);
  }
  if (gains) return y * shoal;
  // A trough cannot cut below the bed it is running over.
  return Math.max(y * shoal, -Math.max(0, depth - KEEL));
}

/**
 * THE WATER'S OWN HORIZONTAL MOTION, from the very same waves.
 *
 * A wave is not a river: the water in it does not travel with the
 * crest, it goes round in a circle and comes back. At the SURFACE of a
 * deep-water wave that circle's horizontal component is `omega * eta` —
 * the wave's angular speed times how high the surface is standing at
 * that instant — running along the wave's own direction. So the flow is
 * forward under a crest, backward under a trough, and nets to nothing
 * over a cycle, which is exactly what floating in a swell feels like.
 *
 * IT IS THE SAME TABLE `seaSwellAt` SUMS, and that is the whole reason
 * this lives here rather than in surf.ts. A current computed from a
 * second copy of the waves would push her one way while the surface she
 * is riding went the other, which is the two-answers disease this
 * module exists to prevent.
 *
 * SHOALED WITH THE HEIGHT. Green's law grows the amplitude toward the
 * shore and the orbital speed grows with it, which is why the water
 * starts to really shove in the shallows.
 *
 * @param depth the water column here — the same argument the height
 *   query takes, and used for the same shoaling.
 */
export function seaOrbitalAt(
  wx: number, wz: number, depth: number,
): { x: number; z: number } {
  const shoal = shoalAt(depth);
  if (shoal <= 0) return { x: 0, z: 0 };
  let x = 0;
  let z = 0;
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    const eta = liveAmp[i] * Math.cos((wx * w.dx + wz * w.dz) * w.k - w.omega * clock);
    const u = w.omega * eta * shoal;
    x += u * w.dx;
    z += u * w.dz;
  }
  return { x, z };
}

/**
 * THE MESH THE RENDERER ACTUALLY DRAWS, not the curve behind it.
 *
 * The near ocean sheet is a LATTICE. Its vertices sit on the analytic
 * curve, and every pixel between them is a straight line across the
 * cell — so the drawn surface is a piecewise-bilinear approximation
 * that misses each crest and fills in each trough. With a 3.6 m wave
 * on a 70 cm lattice that is five samples a wavelength, and the gap
 * between the chord and the arc reaches nine centimetres in shoaled
 * water. Nine centimetres is nothing to a person and NINE BODY
 * LENGTHS to her: floating on the analytic curve while the sheet is
 * drawn on the chords is exactly why she "seems too low in the wave",
 * sunk into a trough the mesh never dug.
 *
 * So gameplay samples the CHORDS too. The lattice is registered by
 * Ocean as it anchors, the four surrounding vertices are evaluated
 * exactly as the vertex shader evaluates them — including each
 * corner's own water column, which is what the `depth` attribute
 * carries — and the result is bilinear between them. Renderer and
 * gameplay now agree to the millimetre rather than to the model.
 *
 * With no lattice registered (the unit tests, any headless caller)
 * this is the analytic curve, which is the honest answer when nothing
 * is being drawn.
 */
let lattice: { ox: number; oz: number; cell: number } | null = null;

/** Ocean tells the sea which mesh is drawing it. */
export function setSwellLattice(ox: number, oz: number, cell: number): void {
  lattice = { ox, oz, cell };
}

/** Forget it — scene teardown, and the tests' clean slate. */
export function clearSwellLattice(): void {
  lattice = null;
}

/**
 * How far the sea surface stands from y = 0 at this spot, NOW (the
 * module clock), over a column `depth` deep. Positive is a crest.
 *
 * @param depth the column here. Used directly when no mesh is
 *   registered; with one, each lattice corner uses its OWN column,
 *   because that is what the shader does.
 */
export function seaSwellAt(wx: number, wz: number, depth: number): number {
  return sampled(wx, wz, depth, null);
}

/**
 * THE SLOW HALF OF THE VERY SAME SEA — the camera's reference, and
 * nothing else's.
 *
 * NOT A SECOND SURFACE. It is `seaSwellAt` with each component scaled
 * by `heaveGain`, evaluated from the same table at the same instant
 * through the same mesh, so it cannot drift from the water it is a
 * slice of: sum the heave and the chop and you have the sea back
 * exactly. Where the water physically IS remains `seaSwellAt`, which
 * is what the renderer draws, what she floats on, what the surf and
 * the orbital current read, and what the submersion test asks.
 */
export function seaHeaveAt(wx: number, wz: number, depth: number): number {
  return sampled(wx, wz, depth, heaveGains);
}

/**
 * The FAST half — what the camera should not copy.
 *
 * The camera subtracts this from her height instead of filtering its
 * own over time. Subtraction is exact and instant: she floats exactly
 * on the surface (wading.ts seats her at depth minus draught with no
 * dynamics of its own), so taking the chop off her leaves the heave
 * she is riding plus whatever she is doing deliberately, with no lag
 * to be caught out by and nothing to re-seed.
 */
export function seaChopAt(wx: number, wz: number, depth: number): number {
  return sampled(wx, wz, depth, null) - sampled(wx, wz, depth, heaveGains);
}

/** The lattice-aware sampler behind all three. */
function sampled(
  wx: number, wz: number, depth: number, gains: number[] | null,
): number {
  if (!lattice) return rawSwell(wx, wz, depth, gains);
  const { ox, oz, cell } = lattice;
  const fx = (wx - ox) / cell;
  const fz = (wz - oz) / cell;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const corner = (cx: number, cz: number): number => {
    const x = ox + cx * cell;
    const z = oz + cz * cell;
    return rawSwell(x, z, -groundHeight(x, z), gains);
  };
  const a = corner(ix, iz);
  const b = corner(ix + 1, iz);
  const c = corner(ix, iz + 1);
  const d = corner(ix + 1, iz + 1);
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/**
 * The same waves as GLSL, for the near ocean sheet's vertex shader.
 * Emits code that accumulates height into `sw` and the height
 * GRADIENT into `swSlope` (for the lighting normal), from `worldXZ`
 * and `uTime` — the caller provides both names in scope. Literals are
 * baked from the very table the CPU sums, which is the whole point.
 */
export function swellChunk(): string {
  return waves.map((w, i) => `
          float ph${i} = (worldXZ.x * ${w.dx.toFixed(6)} + worldXZ.y * ${w.dz.toFixed(6)}) * ${w.k.toFixed(8)} - ${w.omega.toFixed(6)} * uTime;
          sw += uWaveAmp[${i}] * cos(ph${i});
          swSlope += vec2(${w.dx.toFixed(6)}, ${w.dz.toFixed(6)}) * (-uWaveAmp[${i}] * ${w.k.toFixed(8)} * sin(ph${i}));`).join('');
}

/**
 * The declaration `swellChunk`'s code needs, for whichever shader
 * stage is about to use it. Sized to the table in force, which is why
 * swapping the table means recompiling.
 */
export function swellUniformChunk(): string {
  return `uniform float uWaveAmp[${waves.length}];`;
}

/** Bind the shared amplitude array onto a compiled shader. */
export function bindSwellUniforms(
  uniforms: Record<string, { value: unknown }>,
): void {
  uniforms.uWaveAmp = SWELL_AMP_UNIFORM as { value: unknown };
}
