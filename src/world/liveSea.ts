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
  TYPICAL_SEA, toSeaRegime, type SeaRegime,
} from '../weather/seaState';
import {
  amplitudeAt, generateWaveField, type WaveField,
} from '../weather/waveField';
import { setWaveTable, type Wave } from './seaSwell';
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
}

let field: WaveField | null = null;
let mode: SeaMode = 'fixed';
let regime: SeaRegime | null = null;

/**
 * Convert one SI component into the game's units and hand it its
 * envelope, so the sea groups on the CPU and on the GPU from one
 * function rather than two implementations of one idea.
 */
function toSeaWave(field_: WaveField, index: number): Wave {
  const c = field_.components[index];
  return {
    dx: c.dirX,
    dz: c.dirZ,
    k: c.k / UNITS_PER_METRE,
    omega: c.omega,
    amp: c.amplitudeM * UNITS_PER_METRE,
    // The base amplitude is already in the table; the envelope is the
    // pure multiplier around 1, so seaSwell can hold one number per
    // component and still group.
    envelope: (seconds: number) => amplitudeAt(c, seconds) / c.amplitudeM,
  };
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
  const wantMacro = options.macro ?? true;
  const wantMeso = options.meso ?? true;
  const mesoScale = wantMeso ? (options.mesoScale ?? DEFAULT_MESO_SCALE) : 0;
  // No observation yet — Stage F brings the network. The regime's
  // fallback IS the real 51208 reading, so this is a genuine sea state
  // rather than an invented one.
  regime = toSeaRegime(
    null, options.worldSeed ?? SEA_WORLD_SEED, options.nowMs ?? Date.now(),
  );
  const built = generateWaveField(regime, {
    mesoScale,
    macroCount: wantMacro ? undefined : 0,
  });
  field = built;
  mode = 'procedural';
  setWaveTable(built.components.map((_, i) => toSeaWave(built, i)));
  return built;
}

/** Put the built-in sea back. The caller must rebuild the water. */
export function useFixedSea(): void {
  field = null;
  regime = null;
  mode = 'fixed';
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

/** What TYPICAL_SEA says, for a report that has to name its source. */
export const SEA_SOURCE_NOTE =
  `fixture regime (NDBC ${TYPICAL_SEA.station}, Hs ${TYPICAL_SEA.significantWaveHeightM} m,`
  + ` DPD ${TYPICAL_SEA.dominantPeriodS} s, MWD ${TYPICAL_SEA.meanFromDeg} FROM)`;
