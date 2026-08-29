/**
 * THE ACTUAL WAVES — a deterministic irregular sea, generated inside a
 * regime.
 *
 * Stage A turned what the buoy measured into a SeaRegime: an envelope
 * saying how much energy today's sea carries, where its period and
 * heading sit, how broadly it spreads and how hard it groups. This is
 * the layer that turns that envelope into water — a small set of real
 * travelling components with coherent amplitude, wavelength, period,
 * direction and phase, whose statistics orbit the regime rather than
 * repeating it.
 *
 * WHAT THIS IS NOT. It is not a Perlin heightfield: noise never touches
 * the surface directly, because a sea made of noise has no crests that
 * travel and nothing for an orbital current or a breaker to be derived
 * from. Every wave here propagates. Noise only MODULATES how much
 * energy each component is carrying, slowly, which is what makes sets.
 *
 * OFFLINE. Nothing imports this yet. It does not know seaSwell exists,
 * it draws nothing, and it floats nobody; Stage C is where a field like
 * this reaches the ocean. `surfaceAt` and `varianceAt` are here as the
 * reference evaluation the tests measure and the port will follow.
 *
 * UNITS ARE SI — metres, seconds, radians — because the regime is SI
 * and so is the dispersion relation. The game runs in centimetres, and
 * the conversion is one multiply at the boundary: omega comes out
 * IDENTICAL either way, because sqrt(9.81 * 2pi/L_m) and
 * sqrt(981 * 2pi/L_cm) are the same number. There is a test for that,
 * because it is the sort of thing that is obvious until it is wrong.
 *
 * THE IRREGULARITY IS NOT BOUGHT WITH COMPONENT COUNT. Five waves is
 * the whole budget: every component costs a sine in the vertex shader
 * across fifty-eight thousand vertices, a term in every CPU height
 * query, and a term in the orbital current. What makes this sea look
 * irregular instead of repeating is that its components have DIFFERENT
 * PERIODS — so they beat against each other and drift in and out of
 * phase over tens of seconds, which is where real wave sets come from —
 * plus spread headings, stable random phases, and a slow envelope on
 * top. Doubling the count would buy less than the period spread does.
 */
import { noise2 } from './windField';
import { significantFor, wrapDeg, type SeaRegime } from './seaState';

/** Gravity in SI, for the dispersion relation. */
export const G_SI = 9.81;

/**
 * HOW MANY WAVES THE SEA IS ALLOWED, and it is a mobile budget rather
 * than an aesthetic one. Today's shipped ocean draws two.
 */
export const MACRO_COUNT = 3;
export const MESO_COUNT = 2;

/**
 * How far the macro periods spread either side of the dominant one, as
 * a fraction of it, at a narrow sea and at a broad one.
 *
 * A clean swell arrives within a few per cent of its peak period; a
 * confused wind sea is far looser. The regime's `periodSpread` picks
 * between these.
 */
export const NARROW_PERIOD_SPREAD = 0.06;
export const BROAD_PERIOD_SPREAD = 0.22;

/**
 * How sharply energy falls away from the dominant period, in units of
 * the normalised offset. Small is a peaky sea; this leaves roughly half
 * the macro energy on the component nearest the peak, which is what
 * "dominant period" ought to mean.
 */
export const PEAK_SIGMA = 0.6;

/**
 * The most a wave group may swell or drop the energy of a component,
 * at maximum grouping. Scaled by the regime's `grouping`, so narrow
 * seas — the ones that really do arrive in sets of three — group hardest.
 *
 * BOUNDED ON PURPOSE. An unbounded envelope on a noise function is how
 * a game grows an accidental rogue wave.
 */
export const MAX_GROUP_DEPTH = 0.45;

/** Seconds for the group envelope to cross one cell of noise. */
export const GROUP_SECONDS = 60;

/**
 * WHERE EACH COMPONENT READS ITS ENVELOPE, and why the rows are odd
 * numbers.
 *
 * windField.ts paid for this lesson: Perlin noise is identically zero
 * along whole lattice rows, so a signal sampled on an integer row
 * collapses to a slice through the gradients' x-components alone and
 * two such signals agree far more often than two independent ones
 * should. Its answer was to sit at 0.5 and 100.5; this does the same
 * and strides between components by the golden ratio, whose multiples
 * never repeat and spread as evenly through each cell as any sequence
 * can.
 *
 * The OTHER half of that lesson — that sampling once per whole cell
 * from a clock starting at zero reads zero forever — does not apply
 * here, because the envelope is evaluated continuously rather than
 * picked on a timer. The rows still matter; the stride is inherited
 * because it is free and because the next person to add a signal
 * should find the pattern already in use.
 */
export const GOLDEN = 2 / (1 + Math.sqrt(5));
const ROW_BASE = 0.5;
const ROW_STRIDE = GOLDEN * 100;

/**
 * THE MESO SEA'S OWN ENERGY, as a significant height in metres.
 *
 * NOT drawn from the buoy's budget. A 0.5 Hz Waverider cannot see
 * centimetre chop, so the ant-scale waves TMB already draws are
 * additional local character rather than a slice of what NDBC
 * measured. This number is the accepted look's own energy, worked back
 * from the shipped table — amplitudes 0.16 m and 0.06 m give a
 * variance of 0.0146 m^2, which is a significant height of 0.483 m.
 *
 * Whether the queen should keep feeling all of it is a Stage C
 * question (Joshua: the LOOK is accepted, the rapid bobbing is not),
 * which is what `mesoScale` is for.
 */
export const MESO_SIGNIFICANT_M = 0.483;
/** The centre period of the local chop — the shipped 3.6 m wave. */
export const MESO_PERIOD_S = 1.518;
/** Local chop is always broad; it is wind ruffle, not swell. */
export const MESO_PERIOD_SPREAD = 0.25;
export const MESO_SPREAD_DEG = 34;

/** One travelling wave. Everything a renderer or a query needs. */
export interface WaveComponent {
  /** Metres. The BASE amplitude, before the group envelope. */
  readonly amplitudeM: number;
  readonly periodS: number;
  readonly wavelengthM: number;
  /** Radians per metre. */
  readonly k: number;
  /** Radians per second. */
  readonly omega: number;
  /** Degrees, the direction it TRAVELS (TMB's convention). */
  readonly towardDeg: number;
  /** Unit propagation vector, in the world's x/z. */
  readonly dirX: number;
  readonly dirZ: number;
  /** Radians. Stable for the life of the component. */
  readonly phase: number;
  readonly scale: 'macro' | 'meso';
  /** The noise row this component's group envelope reads. */
  readonly noiseRow: number;
  /** How deep its envelope swings, 0 to MAX_GROUP_DEPTH. */
  readonly groupDepth: number;
}

export interface WaveField {
  readonly components: readonly WaveComponent[];
  readonly seed: number;
  /**
   * WHICH GENERATION THIS IS. A new observation grows a new field
   * rather than editing this one, and the two are meant to overlap —
   * the old fading out as the new fades in — so that the Pacific never
   * changes gear because an XML document arrived. Stage B carries the
   * identity that makes that possible and does NOT implement the
   * crossfade.
   */
  readonly generation: number;
  /** Simulated seconds at which this field was generated. */
  readonly bornAt: number;
  /** The macro budget it was built to, m^2. */
  readonly macroVarianceM2: number;
  readonly mesoVarianceM2: number;
  /** The furthest the surface can stand from mean, metres. */
  readonly maxReachM: number;
}

export interface WaveFieldOptions {
  readonly macroCount?: number;
  readonly mesoCount?: number;
  /** Scales the local chop's amplitude. Stage C's dial. */
  readonly mesoScale?: number;
  readonly generation?: number;
  readonly bornAt?: number;
}

/**
 * A small deterministic PRNG — mulberry32, in the codebase's `imul`
 * idiom. Seeded once per field, never touched again: nothing in the
 * frame loop may roll a die, or the ocean stops being reproducible.
 */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mixTo(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Deep-water wavelength for a period. The only place L comes from. */
export function wavelengthFor(periodS: number): number {
  return (G_SI * periodS * periodS) / (2 * Math.PI);
}

/**
 * STRATIFIED, NOT SCATTERED. Drawing n offsets independently clumps
 * them — three uniform draws land on the same side of the peak about a
 * quarter of the time, and a sea whose every component shares a period
 * is the repeating cosine this exists to avoid. One draw per stratum,
 * jittered inside it, spreads them and stays random.
 *
 * @returns n values across [-1, 1].
 */
function stratified(n: number, roll: () => number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5 + (roll() - 0.5) * 0.8) / n;
    out.push(u * 2 - 1);
  }
  return out;
}

/** One scale's worth of components, built to a variance budget. */
function build(
  count: number, varianceM2: number, centrePeriodS: number,
  relativeSpread: number, towardDeg: number, spreadDeg: number,
  grouping: number, scale: 'macro' | 'meso',
  roll: () => number, rowFrom: number,
): WaveComponent[] {
  if (count <= 0 || varianceM2 <= 0) return [];
  const periodOffsets = stratified(count, roll);
  // Drawn from a SECOND pass so a component's heading is not a
  // function of its period; a real sea's long waves are not all on
  // the left of the fan.
  const headingOffsets = stratified(count, roll);
  // ENERGY IS PEAKED ON THE DOMINANT PERIOD, which is what makes it
  // the dominant one. A gaussian in the normalised offset, normalised
  // so the weights sum to one and the budget is spent exactly.
  const weights = periodOffsets.map((t) => Math.exp(-0.5 * (t / PEAK_SIGMA) ** 2));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const depth = MAX_GROUP_DEPTH * Math.min(1, Math.max(0, grouping));
  return periodOffsets.map((t, i) => {
    const periodS = Math.max(0.2, centrePeriodS * (1 + t * relativeSpread));
    const wavelengthM = wavelengthFor(periodS);
    // Aim^2 / 2 summed over the set equals the budget, by construction.
    const share = weights[i] / total;
    const amplitudeM = Math.sqrt(2 * varianceM2 * share);
    const toward = wrapDeg(towardDeg + headingOffsets[i] * spreadDeg);
    const rad = (toward * Math.PI) / 180;
    return {
      amplitudeM,
      periodS,
      wavelengthM,
      k: (2 * Math.PI) / wavelengthM,
      omega: (2 * Math.PI) / periodS,
      towardDeg: toward,
      // TMB's compass: 0 is -z (north), 90 is +x (east).
      dirX: Math.sin(rad),
      dirZ: -Math.cos(rad),
      phase: roll() * Math.PI * 2,
      scale,
      noiseRow: rowFrom + i * ROW_STRIDE,
      groupDepth: depth,
    };
  });
}

/**
 * The slow swell and lull of one component's energy, around 1.
 *
 * Bounded to [1 - depth, 1 + depth] by construction, so no amount of
 * enthusiasm from the noise can produce a wave the sea state never
 * promised.
 */
export function groupEnvelope(component: WaveComponent, timeS: number): number {
  if (component.groupDepth <= 0) return 1;
  const n = noise2(timeS / GROUP_SECONDS, component.noiseRow);
  return 1 + Math.max(-1, Math.min(1, n)) * component.groupDepth;
}

/** What this component's amplitude actually is, right now. */
export function amplitudeAt(component: WaveComponent, timeS: number): number {
  return component.amplitudeM * groupEnvelope(component, timeS);
}

/**
 * THE ENVELOPE IS NORMALISED AGAINST ITSELF, which is the honest way
 * to keep a modulated sea on budget.
 *
 * Multiplying an amplitude by something averaging 1 does NOT leave the
 * energy alone: energy goes as the square, and the mean of a square is
 * above the square of the mean by exactly the variance. Left alone the
 * sea would run a few per cent heavy forever.
 *
 * Rather than guess Perlin's distribution, measure it: sample each
 * component's own envelope across a long window and divide by its RMS.
 * Deterministic (same seed, same samples, same factor), paid once at
 * generation, and exact for the curve actually in use.
 */
const NORMALISE_SAMPLES = 512;
const NORMALISE_WINDOW_S = GROUP_SECONDS * 24;

function envelopeRms(component: WaveComponent): number {
  if (component.groupDepth <= 0) return 1;
  let sum = 0;
  for (let i = 0; i < NORMALISE_SAMPLES; i++) {
    const t = (i / NORMALISE_SAMPLES) * NORMALISE_WINDOW_S;
    const e = groupEnvelope(component, t);
    sum += e * e;
  }
  return Math.sqrt(sum / NORMALISE_SAMPLES);
}

/**
 * BUILD TODAY'S SEA.
 *
 * Pure and deterministic: the same regime and options always give the
 * same field, on every device, in every replay, in every screenshot.
 * The regime carries the seed; nothing here consults a clock or a
 * global.
 */
export function generateWaveField(
  regime: SeaRegime, options: WaveFieldOptions = {},
): WaveField {
  const macroCount = options.macroCount ?? MACRO_COUNT;
  const mesoCount = options.mesoCount ?? MESO_COUNT;
  const mesoScale = Math.max(0, options.mesoScale ?? 1);
  const roll = seeded(regime.seed);

  const macroSpread = mixTo(
    NARROW_PERIOD_SPREAD, BROAD_PERIOD_SPREAD, regime.periodSpread,
  );
  const macro = build(
    macroCount, regime.varianceM2, regime.dominantPeriodS, macroSpread,
    regime.towardDeg, regime.directionSpreadDeg, regime.grouping,
    'macro', roll, ROW_BASE,
  );
  // The local chop rides the same heading — it is the same wind — but
  // fans wider and carries its own energy, which the buoy never
  // measured.
  const mesoVariance = (MESO_SIGNIFICANT_M * mesoScale / 4) ** 2;
  const meso = build(
    mesoCount, mesoVariance, MESO_PERIOD_S, MESO_PERIOD_SPREAD,
    regime.towardDeg, MESO_SPREAD_DEG, regime.grouping,
    'meso', roll, ROW_BASE + ROW_STRIDE * (macroCount + 7),
  );

  const components = [...macro, ...meso].map((c) => ({
    ...c, amplitudeM: c.amplitudeM / envelopeRms(c),
  }));
  const maxReachM = components.reduce(
    (sum, c) => sum + c.amplitudeM * (1 + c.groupDepth), 0,
  );
  return {
    components,
    seed: regime.seed,
    generation: options.generation ?? 0,
    bornAt: options.bornAt ?? 0,
    macroVarianceM2: regime.varianceM2,
    mesoVarianceM2: mesoVariance,
    maxReachM,
  };
}

/**
 * THE REFERENCE SURFACE — how high the sea stands at a point, now.
 *
 * This is the arithmetic Stage C will port into seaSwell and its
 * shader; here it exists so the tests can measure the field they just
 * generated. Metres, from a position in metres.
 */
export function surfaceAt(
  field: WaveField, xM: number, zM: number, timeS: number,
): number {
  let y = 0;
  for (const c of field.components) {
    const along = xM * c.dirX + zM * c.dirZ;
    y += amplitudeAt(c, timeS)
      * Math.cos(along * c.k - c.omega * timeS + c.phase);
  }
  return y;
}

/**
 * The variance the field is carrying at this instant — the sum of
 * A^2/2 with the envelopes applied.
 *
 * @param scale restrict to one scale, or omit for the whole sea.
 */
export function varianceAt(
  field: WaveField, timeS: number, scale?: 'macro' | 'meso',
): number {
  let sum = 0;
  for (const c of field.components) {
    if (scale && c.scale !== scale) continue;
    const a = amplitudeAt(c, timeS);
    sum += (a * a) / 2;
  }
  return sum;
}

/** The significant height the field is carrying at this instant. */
export function significantAt(
  field: WaveField, timeS: number, scale?: 'macro' | 'meso',
): number {
  return significantFor(varianceAt(field, timeS, scale));
}
