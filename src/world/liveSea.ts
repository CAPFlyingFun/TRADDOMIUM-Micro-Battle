/**
 * THE PROCEDURAL SEA, PLUGGED IN — behind a dev flag.
 *
 * Stage A read the buoy into a regime; Stage B grew a deterministic
 * irregular wave field inside it. This is the adapter that lets that
 * field BE the ocean: it converts the field's components into
 * seaSwell's table and installs them, at which point every consumer of
 * the sea follows at once — the vertex shader's baked chunk, the CPU
 * height query the queen floats on, the orbital current, the surf's
 * breaker depth, the camera's water query and the underwater test.
 * That is the one-authoritative-sea rule holding: there is no path by
 * which the water she is drawn on and the water she floats on can be
 * different water.
 *
 * OFF BY DEFAULT. The built-in two-wave table is what ships and what
 * `?sea=` has to be asked for to replace. Nothing here runs unless the
 * flag is set.
 *
 * UNITS ARE THE WHOLE JOB. waveField works in SI because the buoy and
 * the dispersion relation do; the game runs at one unit to the
 * centimetre with g = 981. Amplitude and wavelength scale by a hundred
 * and OMEGA DOES NOT — sqrt(9.81 * k_m) and sqrt(981 * k_cm) are the
 * same number, which tests/waveField.test.ts asserts precisely so this
 * conversion cannot quietly change how fast the sea moves.
 *
 * NO NETWORK. Stage C runs off the regime's own fallback — the
 * observation baked into TYPICAL_SEA, which is the real 51208 reading
 * from 2026-08-28. Live fetching is Stage F.
 */
import {
  TYPICAL_SEA, toSeaRegime, type SeaObservation, type SeaRegime,
} from '../weather/seaState';
import {
  amplitudeAt, generateWaveField, type WaveField,
} from '../weather/waveField';
import { setSwellPeak, setWaveTable, swellTime, type Wave } from './seaSwell';
import { UNITS_PER_METRE } from './kauai';

/** Which sea the game is running. */
export type SeaMode = 'fixed' | 'procedural';

/**
 * HOW MUCH OF THE ANT-SCALE CHOP REACHES HER, and why it starts low.
 *
 * The meso waves are the accepted LOOK and they are also the rapid
 * bobbing Joshua asked to be rid of — the same centimetres doing both
 * jobs. Their acceleration is what reads as a washing machine: the
 * shipped 1.5 s wave peaks at 2.74 m/s^2 against the macro swell's
 * 0.51, so at full scale the chop would still own the ride no matter
 * how good the macro is.
 *
 * A third is the conservative opening bid: it puts the two scales
 * within reach of each other so the slow swell leads, while leaving
 * the short waves visible. It is a DIAL, not a decision — the whole
 * point of Stage C is that Joshua judges this number on a phone.
 */
export const DEFAULT_MESO_SCALE = 0.35;

/** A fixed seed until the world has one of its own to offer. */
export const SEA_WORLD_SEED = 20260829;

export interface LiveSeaOptions {
  readonly mesoScale?: number;
  /** Drop the macro scale entirely — for isolating the local chop. */
  readonly macro?: boolean;
  /** Drop the meso scale entirely — the "macro only" comparison. */
  readonly meso?: boolean;
  readonly worldSeed?: number;
  /** Epoch ms, for the regime's freshness. Defaults to now. */
  readonly nowMs?: number;
  /** The buoy reading to grow from. Null or absent uses TYPICAL_SEA. */
  readonly observation?: SeaObservation | null;
}

/**
 * HOW LONG THE PACIFIC TAKES TO CHANGE ITS MIND, in simulated seconds.
 *
 * A buoy reading arrives every half hour and can differ from the last
 * one — a swell backs a few degrees, a period lengthens, a front
 * raises the height. None of that happens to a real ocean in an
 * instant, and none of it may happen to this one: an XML document
 * landing must not rotate every heading, stretch every wavelength or
 * step the height, and it certainly must not reset a phase.
 *
 * So the old field does not stop when the new one starts. Both run,
 * and their amplitudes cross over — FOUR MINUTES of it, which is slow
 * enough that the change is something you notice having happened
 * rather than something you see happen, and short enough that a sea
 * arriving on a half-hour cadence is settled long before the next.
 */
export const BLEND_SECONDS = 240;

/**
 * One sea, generated once and running until it is faded out.
 *
 * `born` is on the SWELL CLOCK, not the wall clock, because that is
 * the clock the surface is a function of — so a transition replays
 * identically and a slow device reaches the same ocean at the same
 * point in the game rather than at the same point in the afternoon.
 */
interface Generation {
  readonly field: WaveField;
  readonly regime: SeaRegime;
  readonly observation: SeaObservation | null;
  readonly born: number;
  /**
   * How tall THIS generation can stand, world units — its own peak
   * sum, groups included, computed once. The sea's advertised crest is
   * the crossfade of these rather than their sum, which is what stops
   * the breaking envelope stepping when a second generation joins.
   */
  readonly peak: number;
}

let field: WaveField | null = null;
let mode: SeaMode = 'fixed';
let regime: SeaRegime | null = null;
/** The sea that is running. */
let outgoing: Generation | null = null;
/** The sea that is arriving, during a transition only. */
let incoming: Generation | null = null;
/** Swell-clock second the transition began. */
let blendFrom = 0;
/** The dials the scene asked for, kept so a new generation inherits them. */
let held: LiveSeaOptions = {};

/**
 * Convert one SI component into the game's units and hand it its
 * envelope, so the sea groups on the CPU and on the GPU from one
 * function rather than two implementations of one idea.
 */
function toSeaWave(
  field_: WaveField, index: number, fade?: (seconds: number) => number,
): Wave {
  const c = field_.components[index];
  return {
    dx: c.dirX,
    dz: c.dirZ,
    k: c.k / UNITS_PER_METRE,
    omega: c.omega,
    amp: c.amplitudeM * UNITS_PER_METRE,
    // The base amplitude is already in the table; the envelope is the
    // pure multiplier around 1, so seaSwell can hold one number per
    // component and still group. During a transition the generation's
    // own crossfade rides in the same multiplier, which is what keeps
    // it a property of the SEA rather than a second system layered
    // over it — one table, one sum, one authoritative surface.
    envelope: fade
      ? (seconds: number) => (amplitudeAt(c, seconds) / c.amplitudeM) * fade(seconds)
      : (seconds: number) => amplitudeAt(c, seconds) / c.amplitudeM,
  };
}

/**
 * How far through the transition the sea is at this instant, 0 to 1.
 * Flat 0 before it starts and flat 1 after it ends, so installing the
 * combined table at the start and dropping the old one at the end are
 * both arithmetically invisible.
 */
function progress(seconds: number): number {
  if (BLEND_SECONDS <= 0) return 1;
  return Math.min(1, Math.max(0, (seconds - blendFrom) / BLEND_SECONDS));
}

/**
 * EQUAL POWER, not equal amplitude. Two fields faded linearly against
 * each other lose energy in the middle — (1-t) + t keeps the amplitude
 * but (1-t)^2 + t^2 dips to a half at the crossover, which is a sea
 * visibly going slack for two minutes and coming back. Quarter-wave
 * cosine weights keep cos^2 + sin^2 = 1, so the variance the regime
 * asked for is the variance the water has, at every instant of the
 * transition.
 */
function fadeOut(seconds: number): number {
  return Math.cos((progress(seconds) * Math.PI) / 2);
}

function fadeIn(seconds: number): number {
  return Math.sin((progress(seconds) * Math.PI) / 2);
}

/**
 * Hand seaSwell everything that is running: one generation normally,
 * both during a transition. The renderer has to rebuild when this
 * changes shape (seaSwell.waveTableVersion), which is why it happens
 * twice per observation and not once per frame.
 */
function installTable(): void {
  const table: Wave[] = [];
  if (outgoing) {
    const f = outgoing.field;
    for (let i = 0; i < f.components.length; i++) {
      table.push(toSeaWave(f, i, incoming ? fadeOut : undefined));
    }
  }
  if (incoming) {
    const f = incoming.field;
    for (let i = 0; i < f.components.length; i++) table.push(toSeaWave(f, i, fadeIn));
  }
  field = (incoming ?? outgoing)?.field ?? null;
  regime = (incoming ?? outgoing)?.regime ?? null;
  setSwellPeak(table.length > 0 ? advertisedPeak : null);
  setWaveTable(table.length > 0 ? table : null);
}

/** Grow a generation from an observation, at the dials in force. */
function grow(
  observation: SeaObservation | null, options: LiveSeaOptions, index: number,
): Generation {
  const wantMacro = options.macro ?? true;
  const wantMeso = options.meso ?? true;
  const mesoScale = wantMeso ? (options.mesoScale ?? DEFAULT_MESO_SCALE) : 0;
  const born = swellTime();
  // NULL IS NOT AN EMPTY SEA. toSeaRegime falls back to TYPICAL_SEA,
  // which is a real 51208 reading — so "no observation" is a genuine
  // sea state rather than an invented or flat one.
  const grownRegime = toSeaRegime(
    observation, options.worldSeed ?? SEA_WORLD_SEED,
    options.nowMs ?? (observation ? observation.observedAt : Date.now()),
  );
  const grownField = generateWaveField(grownRegime, {
    mesoScale,
    macroCount: wantMacro ? undefined : 0,
    generation: index,
    bornAt: born,
  });
  // Sampled over half an hour of its own groups, once. The window is
  // the same one seaSwell uses for a single-generation table, so the
  // two answers mean the same thing.
  let peak = 0;
  for (let i = 0; i < 240; i++) {
    const at = born + i * 7.3;
    let sum = 0;
    for (const c of grownField.components) sum += amplitudeAt(c, at) * UNITS_PER_METRE;
    peak = Math.max(peak, sum);
  }
  return { field: grownField, regime: grownRegime, observation, born, peak };
}

/**
 * THE SEA'S ADVERTISED CREST while a transition is running.
 *
 * The crossfade of the two generations' own peaks, never their sum:
 * neither is at full amplitude while the other is. Equal to the single
 * generation's peak at both ends, so joining the second generation and
 * retiring the first are both continuous — which is what the depth
 * limit downstream needs, since a step here is a step in the wave
 * height everywhere the shore is shallow.
 */
function advertisedPeak(): number {
  if (!outgoing) return 0;
  if (!incoming) return outgoing.peak;
  const s = swellTime();
  return fadeOut(s) * outgoing.peak + fadeIn(s) * incoming.peak;
}

/**
 * Build today's sea and install it. Returns the field so a probe can
 * report exactly what was generated.
 *
 * THE CALLER MUST REBUILD THE WATER. The shader's chunk is baked at
 * compile time, so the geometry only follows once the ocean's
 * materials are recreated — see IslandScene.rebuildOcean.
 */
export function useProceduralSea(options: LiveSeaOptions = {}): WaveField {
  held = options;
  outgoing = grow(options.observation ?? null, options, 0);
  incoming = null;
  mode = 'procedural';
  installTable();
  return outgoing.field;
}

/**
 * A NEW BUOY READING ARRIVES — start the transition rather than the
 * new sea.
 *
 * Both generations run from here until `settleSea` retires the old
 * one. The surface at the moment this is called is arithmetically
 * unchanged, because the incoming field's crossfade is nought until
 * the clock passes this instant.
 *
 * @returns the new field, or null if there was no sea to blend FROM —
 *   in which case the caller wanted `useProceduralSea` and gets it.
 */
export function blendToObservation(
  observation: SeaObservation, options: LiveSeaOptions = held,
): WaveField {
  held = options;
  if (!outgoing || mode !== 'procedural') {
    return useProceduralSea({ ...options, observation });
  }
  // A transition already running does not get a second one layered on
  // it: the arriving sea replaces whatever was arriving, from the
  // surface as it stands now, so the fade always has one start.
  if (incoming) {
    outgoing = { ...incoming, born: swellTime() };
  }
  blendFrom = swellTime();
  incoming = grow(observation, options, (outgoing.field.generation ?? 0) + 1);
  installTable();
  return incoming.field;
}

/**
 * Retire a finished transition. Cheap, and meant to be called every
 * frame; it does something only on the frame the crossfade completes,
 * where dropping the faded-out generation costs nothing because its
 * amplitude is already zero.
 *
 * @returns true when the table changed shape, so the caller knows the
 *   water needs rebuilding.
 */
export function settleSea(): boolean {
  if (!incoming || progress(swellTime()) < 1) return false;
  outgoing = incoming;
  incoming = null;
  installTable();
  return true;
}

/** Where the transition is, or null when the sea is not in one. */
export function seaBlend(): { readonly t: number; readonly from: number;
  readonly to: number } | null {
  if (!incoming || !outgoing) return null;
  return {
    t: progress(swellTime()),
    from: outgoing.field.generation,
    to: incoming.field.generation,
  };
}

/** The observation the running sea was grown from, if any. */
export function liveObservation(): SeaObservation | null {
  return (incoming ?? outgoing)?.observation ?? null;
}

/** Put the built-in sea back. The caller must rebuild the water. */
export function useFixedSea(): void {
  field = null;
  regime = null;
  outgoing = null;
  incoming = null;
  mode = 'fixed';
  setSwellPeak(null);
  setWaveTable(null);
}

/** What the sea currently is, for the probe report. */
export function seaMode(): SeaMode {
  return mode;
}

export function liveField(): WaveField | null {
  return field;
}

export function liveRegime(): SeaRegime | null {
  return regime;
}

/**
 * Read a `?sea=` query string. Returns null when the flag is absent,
 * which is the case that must leave the shipped ocean alone.
 *
 * `?sea=procedural` — the full generated sea
 * `?sea=macro`      — macro components only, no local chop
 * `?sea=meso`       — the chop alone, for isolating it
 * `?meso=0.6`       — override the chop's scale
 */
export function seaFromQuery(search: string): LiveSeaOptions | null {
  const params = new URLSearchParams(search);
  const asked = params.get('sea');
  if (!asked) return null;
  const mesoParam = Number(params.get('meso'));
  const mesoScale = Number.isFinite(mesoParam) && params.get('meso') !== null
    ? Math.max(0, mesoParam) : undefined;
  if (asked === 'macro') return { meso: false, ...(mesoScale === undefined ? {} : { mesoScale }) };
  if (asked === 'meso') return { macro: false, ...(mesoScale === undefined ? {} : { mesoScale }) };
  if (asked === 'procedural' || asked === 'live' || asked === '1') {
    return mesoScale === undefined ? {} : { mesoScale };
  }
  return null;
}

/** Reset to the shipped sea — scene teardown and the tests' slate. */
export function resetLiveSea(): void {
  useFixedSea();
}

/**
 * THE SEA, IN ONE LINE — what a dev overlay and a probe both want.
 *
 *   SEA LIVE 51208  Hs 1.3m  Tp 6.0s  Ap 4.8s  FROM 081 -> 261  age 14m
 *
 * The source word is the whole point of it. LIVE means NDBC answered;
 * CACHED means the last answer is being kept warm; FALLBACK means
 * neither, and the ocean is running on TYPICAL_SEA — which is a real
 * reading, so the sea is right even when the network is not. When a
 * transition is running it says so, because two generations are then
 * summing into one surface and a number that looks odd deserves the
 * explanation.
 */
export function seaLine(state: {
  readonly source: string; readonly station: string;
  readonly observation: SeaObservation | null; readonly ageMs: number | null;
  readonly failure?: string | null;
}): string {
  const used = state.observation;
  const bits = [`SEA ${state.source.toUpperCase()} ${state.station}`];
  if (used) {
    bits.push(`Hs ${used.significantWaveHeightM.toFixed(1)}m`);
    bits.push(`Tp ${used.dominantPeriodS.toFixed(1)}s`);
    bits.push(`Ap ${used.averagePeriodS.toFixed(1)}s`);
    const from = Math.round(used.meanFromDeg);
    bits.push(`FROM ${String(from).padStart(3, '0')}`);
    bits.push(`-> ${String(Math.round((from + 180) % 360)).padStart(3, '0')}`);
  } else {
    const fallback = liveRegime();
    if (fallback) {
      bits.push(`Hs ${fallback.significantHeightM.toFixed(1)}m`);
      bits.push(`Tp ${fallback.dominantPeriodS.toFixed(1)}s`);
    }
  }
  if (state.ageMs !== null && state.ageMs >= 0) {
    const minutes = Math.round(state.ageMs / 60_000);
    bits.push(minutes < 90 ? `age ${minutes}m` : `age ${(minutes / 60).toFixed(1)}h`);
  }
  const running = seaBlend();
  if (running) bits.push(`blend ${(running.t * 100).toFixed(0)}%`);
  const seed = liveRegime()?.seed;
  if (seed !== undefined) bits.push(`seed ${seed}`);
  const gen = (incoming ?? outgoing)?.field.generation;
  if (gen !== undefined) bits.push(`gen ${gen}`);
  if (state.failure) bits.push(`(${state.failure})`);
  return bits.join('  ');
}

/** What TYPICAL_SEA says, for a report that has to name its source. */
export const SEA_SOURCE_NOTE =
  `fixture regime (NDBC ${TYPICAL_SEA.station}, Hs ${TYPICAL_SEA.significantWaveHeightM} m,`
  + ` DPD ${TYPICAL_SEA.dominantPeriodS} s, MWD ${TYPICAL_SEA.meanFromDeg} FROM)`;
