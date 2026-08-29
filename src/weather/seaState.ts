/**
 * WHAT THE SEA IS LIKE TODAY — the regime, not the waves.
 *
 * This is the sea's half of the pattern the WIND already follows, and
 * the parallel is deliberate (Joshua: "the ocean should work like TMB's
 * procedural wind simulation"). A station reports a SUSTAINED speed and
 * a GUST, and windField.ts turns those two numbers into air that
 * breathes — it does not blow at exactly the reported speed forever.
 * NDBC reports a significant height, a dominant period, an average
 * period and a mean direction, and those four are statistics of an
 * irregular sea in exactly the same way.
 *
 * SO THERE ARE TWO LAYERS, and keeping them apart is the whole design:
 *
 *   SeaObservation   what the buoy measured. Facts, with a timestamp.
 *   SeaRegime        what today's sea is LIKE — the envelope a
 *                    procedural wave field is generated inside.
 *
 * A later stage adds the third layer, the wave field itself: actual
 * travelling components with coherent amplitude, wavelength, period,
 * direction and phase, whose statistics orbit this regime. Nothing in
 * this file generates a wave, and nothing here touches seaSwell — the
 * ocean the game currently draws is untouched by Stage A.
 *
 * WHY THE REGIME EXISTS AT ALL rather than handing the observation
 * straight to a generator: a new reading must never reach individual
 * waves. When the buoy updates, the REGIME moves — slowly — and the
 * field follows it. Nothing in the Pacific changes gear because an XML
 * document arrived.
 *
 * NDBC'S NUMBERS ARE STATISTICS, and the most expensive mistake
 * available here is forgetting it:
 *
 *   WVHT  significant wave height, defined from the VARIANCE of the
 *         whole irregular field (Hs = 4*sqrt(m0)). It is not the height
 *         of every wave, not the maximum, and not one sinusoid's
 *         crest-to-trough. A single sinusoid of amplitude A has
 *         variance A^2/2, so its energy-equivalent is Hs = 2.83*A —
 *         which means A = Hs/2 overstates the sea by 41%.
 *   DPD   the spectral PEAK period. Not the period of every wave.
 *   APD   the MEAN period of the same spectrum. Emphatically not a
 *         second, independent wave: DPD and APD describe one sea, and
 *         giving each its own full-energy component double-counts it.
 *         Their RATIO is the useful thing — it says how broad the sea
 *         is around its peak.
 *   MWD   the mean direction waves arrive FROM. Real seas spread
 *         either side of it.
 */
import type { GeoPoint } from '../world/geo';

/**
 * One NDBC wave observation, normalised to metres, seconds and degrees.
 *
 * Whatever the feed reported in — the RSS gives feet for height and
 * Fahrenheit for temperature — is converted at the parser boundary, so
 * nothing downstream ever has to ask which units it is holding.
 */
export interface SeaObservation {
  /** NDBC station id, e.g. `51208`. */
  readonly station: string;
  /** Epoch ms of the OBSERVATION, not of the fetch. */
  readonly observedAt: number;
  /** WVHT, metres. The whole field's energy, as a height. */
  readonly significantWaveHeightM: number;
  /** DPD, seconds. The spectral peak. */
  readonly dominantPeriodS: number;
  /** APD, seconds. The spectral mean. */
  readonly averagePeriodS: number;
  /** MWD, degrees true, the direction the waves come FROM. */
  readonly meanFromDeg: number;
  readonly waterTempC?: number;
  readonly at?: GeoPoint;
}

/**
 * One partition of a measured spectrum — a swell train or a wind sea.
 *
 * NOT PARSED YET, AND DELIBERATELY SO. NDBC's `.spec` file carries
 * `SwH/SwP/SwD` and `WWH/WWP/WWD`, which is exactly the swell versus
 * wind-sea split this model would rather have than infer. The type
 * exists so the regime can accept it without a rewrite; the values are
 * not invented in the meantime.
 */
export interface WavePartition {
  readonly heightM: number;
  readonly periodS: number;
  /** Degrees true, the direction this partition comes FROM. */
  readonly fromDeg: number;
}

/** An observation that also carries NDBC's own spectral partition. */
export interface PartitionedSeaObservation extends SeaObservation {
  readonly swell?: WavePartition;
  readonly windWave?: WavePartition;
}

/** Where the sea state in force came from. Mirrors WeatherSource. */
export type SeaSource = 'live' | 'cached' | 'fallback';

/**
 * THE ENVELOPE A PROCEDURAL SEA IS GENERATED INSIDE.
 *
 * Every field is a property of the SEA, never of a wave: a centre, a
 * spread, an energy budget. A generator reading this should be able to
 * produce a different-but-equally-valid wave field from the same
 * regime given a different seed.
 */
export interface SeaRegime {
  /**
   * The MACRO energy budget, as a variance in m^2 — the m0 of
   * `Hs = 4*sqrt(m0)`.
   *
   * ALL of the measured energy belongs to the macro scale. The
   * ant-scale meso waves TMB already draws are additional local
   * character at frequencies well above anything a 0.5 Hz buoy
   * resolves, so they are NOT subtracted from this budget. (An earlier
   * proposal did subtract them; Joshua corrected it, and he is right —
   * the buoy is not measuring centimetre chop.)
   */
  readonly varianceM2: number;
  /** The same budget expressed as the height NDBC would report. */
  readonly significantHeightM: number;
  /** Centre of the period distribution, seconds — from DPD. */
  readonly dominantPeriodS: number;
  /** The spectral mean, kept so the spread can be re-derived. */
  readonly averagePeriodS: number;
  /**
   * How broadly the field should spread around the dominant period,
   * 0 (a clean narrow swell) to 1 (a broad confused wind sea).
   *
   * DERIVED FROM APD/DPD, which is a real bandwidth proxy: a JONSWAP
   * peak sits near 0.83 and a fully developed Pierson–Moskowitz sea
   * near 0.77, while a narrow swell climbs toward 0.9. The mapping
   * from that ratio to a 0..1 spread is GAME TUNING, not oceanography,
   * and is written as constants below so it can be argued with.
   */
  readonly periodSpread: number;
  /** Centre of PROPAGATION, degrees — MWD turned around. */
  readonly towardDeg: number;
  /**
   * How far components may fan either side of `towardDeg`, degrees.
   * Real seas are directional: swell arrives tight, wind sea fans
   * wide. Tied to the same bandwidth proxy, and also tuning.
   */
  readonly directionSpreadDeg: number;
  /**
   * How strongly the sea should arrive in SETS, 0 to 1.
   *
   * Narrow seas group hardest — a clean swell is the one that comes in
   * sets of three — so this runs opposite to the spread.
   */
  readonly grouping: number;
  /** The deterministic seed a generator must use. See `seaSeed`. */
  readonly seed: number;
  readonly source: SeaSource;
  /** Epoch ms of the observation behind this, or null for a fallback. */
  readonly observedAt: number | null;
}

/** Feet to metres, for NDBC's imperial RSS rendering. */
export const FEET_TO_M = 0.3048;

/**
 * How often the feed is worth asking. The RSS advertises `<ttl>30</ttl>`
 * and 51208 reports on roughly that cadence, so anything faster is
 * politeness spent for nothing.
 */
export const SEA_REFRESH_MS = 30 * 60 * 1000;

/**
 * How long a stored observation may still speak for the sea.
 *
 * A sea state is a slow thing — six hours either side of a reading the
 * swell is usually recognisably the same — so a cached observation is
 * a far better answer than a default one. Past this it is history.
 */
export const SEA_CACHE_GOOD_MS = 6 * 60 * 60 * 1000;

/** The APD/DPD ratio at which the sea counts as broad, and as narrow. */
export const BROAD_RATIO = 0.72;
export const NARROW_RATIO = 0.92;

/** Directional fan at a narrow swell and at a broad wind sea, degrees. */
export const NARROW_SPREAD_DEG = 8;
export const BROAD_SPREAD_DEG = 28;

/**
 * THE SEA WHEN THERE IS NO SEA — a deterministic fallback, the same
 * role `TYPICAL` plays for the weather.
 *
 * These are the 51208 numbers from 2026-08-28, which is a
 * representative Kauaʻi summer trade sea: a moderate short-period swell
 * out of the east. It is one sample rather than a climatology, and if
 * more are collected this should be revisited — but a real reading is
 * a better default than an invented one, and running the fallback
 * through the very same conversion means the offline sea and the live
 * sea can never take different code paths.
 */
export const TYPICAL_SEA: SeaObservation = {
  station: '51208',
  observedAt: 0,
  significantWaveHeightM: 1.3,
  dominantPeriodS: 6,
  averagePeriodS: 4.8,
  meanFromDeg: 81,
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Degrees, wrapped into [0, 360). */
export function wrapDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * NDBC REPORTS WHERE WAVES COME FROM; TMB'S WAVE TABLE TAKES WHERE THEY
 * GO. Half a turn apart, and getting it wrong sends the whole sea back
 * out to the horizon — which is why this is a named function with a
 * test rather than a `+ 180` somewhere in a constructor.
 */
export function towardFrom(fromDeg: number): number {
  return wrapDeg(fromDeg + 180);
}

/**
 * The amplitude a SINGLE sinusoid needs to carry a given significant
 * height's energy: `A = Hs / (2*sqrt(2))`, from `Hs = 4*sqrt(A^2/2)`.
 *
 * Not Hs/2. That is the significant WAVE's amplitude — a statistic of
 * the highest third — and using it for one component puts 41% too much
 * energy in the sea.
 */
export function energyAmplitude(significantHeightM: number): number {
  return significantHeightM / (2 * Math.SQRT2);
}

/** The variance a significant height stands for: m0 = (Hs/4)^2. */
export function varianceFor(significantHeightM: number): number {
  const m0 = significantHeightM / 4;
  return m0 * m0;
}

/** And back again, for checking a generated field against its budget. */
export function significantFor(varianceM2: number): number {
  return 4 * Math.sqrt(Math.max(0, varianceM2));
}

/**
 * A DETERMINISTIC SEED FROM WHAT THE SEA IS.
 *
 * Same world, same station, same observation — same ocean, on every
 * device, in every replay, in every screenshot. That is what makes a
 * procedural sea debuggable rather than merely lively, and it is why
 * the generator must never reach for `Math.random`.
 *
 * The observation TIME is in the hash on purpose: a new reading should
 * grow a genuinely different wave field rather than the same one
 * stretched. Making that new field arrive gently is the transition's
 * job, not the seed's.
 *
 * FNV-1a over the printed inputs, in the codebase's own `Math.imul`
 * idiom (see GroundCover, groundTexture). 32-bit unsigned.
 */
export function seaSeed(
  worldSeed: number, station: string, observedAt: number,
): number {
  const text = `${worldSeed}|${station}|${observedAt}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Which of live / cached / fallback an observation counts as, given
 * the clock. Freshness is about the OBSERVATION's age, not the
 * fetch's: a reading downloaded a second ago that the buoy took nine
 * hours ago is not live.
 */
export function sourceFor(
  observation: SeaObservation | null, nowMs: number,
): SeaSource {
  if (!observation) return 'fallback';
  const age = nowMs - observation.observedAt;
  if (age < 0) return 'live'; // clock skew; a future stamp is not stale
  if (age <= SEA_REFRESH_MS * 2) return 'live';
  if (age <= SEA_CACHE_GOOD_MS) return 'cached';
  return 'fallback';
}

/**
 * OBSERVATION IN, ENVELOPE OUT — pure, so a test can state the whole
 * of it and a replay can reproduce it.
 *
 * @param observation what the buoy said, or null for the default sea.
 * @param worldSeed the world's own seed, so two worlds with the same
 *   weather still get different oceans.
 * @param nowMs the clock, for deciding live / cached / fallback.
 */
export function toSeaRegime(
  observation: SeaObservation | null,
  worldSeed: number,
  nowMs: number,
): SeaRegime {
  const source = sourceFor(observation, nowMs);
  const used = source === 'fallback' ? TYPICAL_SEA : observation as SeaObservation;
  const Hs = Math.max(0, used.significantWaveHeightM);
  const dominant = Math.max(0.1, used.dominantPeriodS);
  // APD cannot exceed DPD in a real spectrum — the mean of a
  // distribution does not sit past its peak — so a feed that says
  // otherwise is clamped rather than believed.
  const average = clamp(used.averagePeriodS, 0.1, dominant);
  const ratio = average / dominant;
  const spread = clamp(
    (NARROW_RATIO - ratio) / (NARROW_RATIO - BROAD_RATIO), 0, 1,
  );
  return {
    varianceM2: varianceFor(Hs),
    significantHeightM: Hs,
    dominantPeriodS: dominant,
    averagePeriodS: average,
    periodSpread: spread,
    towardDeg: towardFrom(used.meanFromDeg),
    directionSpreadDeg:
      NARROW_SPREAD_DEG + (BROAD_SPREAD_DEG - NARROW_SPREAD_DEG) * spread,
    grouping: 1 - spread,
    seed: seaSeed(worldSeed, used.station, used.observedAt),
    source,
    observedAt: source === 'fallback' ? null : used.observedAt,
  };
}
