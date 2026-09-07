/**
 * THE WEATHER, DECIDED BY NOBODY — a seeded model that thickens cloud,
 * lets a shower pass over and clears again, forever, from one number.
 *
 * `weather.ts` is the seam: it says what the weather IS. This is the
 * thing that DECIDES it, and it is the first implementation of that
 * file's `WeatherSource`. Everything downstream — the water solver's
 * catchment feed, a rain renderer, the sky's colour — reads the seam
 * and never this.
 *
 * IT IS SEEDED AND IT HAS NO CLOCK OF ITS OWN. Same seed and the same
 * sequence of `advance(dt)` calls gives the same weather, on every
 * device, in every replay, forever. That is not neatness: this project
 * debugs from photographs of a phone, and a world that cannot be
 * replayed cannot be debugged from one. `Math.random` appears nowhere
 * below, and neither does `Date` — somebody else owns time and hands it
 * in, exactly as `weather.ts` says.
 *
 * WHAT v0 DID AND WHY IT IS NOT COPIED. v0's offline model
 * (`weather/simulated.ts`) was `simulate(where, atMs)`: two out-of-phase
 * sines over the WALL CLOCK, sampled per position. Its orographic
 * geography was right and is honoured below; its shape of time was not,
 * for two reasons that are both bugs rather than tastes.
 *
 *  - A function of `Date.now()` cannot be replayed. Reload the save and
 *    the weather is whatever o'clock it happens to be, so a screenshot
 *    of a flood is not reproducible and two players in one room see two
 *    skies.
 *  - Sines have no EPISODES. `rain = shower² × 9` never reaches zero on
 *    the windward side; it only gets lighter. The water solver
 *    integrates rain, so "never quite stops" is a tap left running, and
 *    the reference build's own audit is a catalogue of what standing
 *    water that nobody poured does to a game.
 *
 * So the model here is a CHAIN OF EPISODES — a dry spell, then a
 * shower, then a dry spell — with every length, every peak and every
 * gust drawn from one seeded generator, and each episode's numbers
 * reached by easing rather than by assignment.
 *
 * NOTHING STEPS. Every channel moves as `1 - exp(-dt/tau)` toward a
 * target, which is the exact solution over a slice of constant target,
 * so a phone at 60 fps and a headless probe at 1.5 fps arrive at the
 * same weather at the same SIMULATED time. `dt * rate` does not, and
 * this project has already shipped one ceiling that turned out to be a
 * property of the device's frame rate. Rain in particular must ramp:
 * downstream it is integrated into a depth, and a step change reads as
 * a bucket being tipped over the island.
 *
 * THE FORMULA ALONE WAS NOT ENOUGH, which is the part worth knowing.
 * A slice that straddled the start of a shower was measurably
 * frame-rate dependent — 0.65 of cloud between a 30 s step and a 1 s
 * step — because the error was in WHEN the target changed rather than
 * in how fast it was chased. `advance` clips its slices to episode
 * boundaries and samples the target at each slice's midpoint; that,
 * and not the exponential, is what makes the two runs agree.
 *
 * CLOUD LEADS RAIN, STRUCTURALLY, in two independent ways, because "it
 * went dark first" is most of what makes weather feel like weather:
 *
 *  1. A shower's rain pulse does not begin until `BUILD_SHARE` of the
 *     episode has passed, while its cloud target applies from the first
 *     instant. The sky is already closing before the pulse is nonzero.
 *  2. The reported rain is multiplied by a cloud GATE that is zero
 *     below broken cover. So `rainMmHr > 0` implies a broken sky, as a
 *     fact about the arithmetic rather than as a promise.
 *
 * A HARD CUT WAS TRIED FIRST for (2) — report zero rain whenever cloud
 * sits under the floor — and rejected: under a forced clear sky it
 * dropped a live 2 mm/hr shower to nothing in one frame, which is the
 * tipped bucket again with the sign reversed. The gate is continuous,
 * so the same moment is a fade.
 *
 * THE ISLAND IS THE REFERENCE AND THE NUMBERS ARE CHECKABLE. Kauaʻi's
 * rainfall gradient is one of the sharpest measured anywhere and it has
 * a simple cause: the northeast trades meet a 1,500 m wall and drop
 * their water on the windward slopes. Waiʻaleʻale averages about
 * 9,500 mm a year; Kekaha, twenty-five kilometres downwind, about 500.
 *
 *   [Giambelluca et al., "Online Rainfall Atlas of Hawaiʻi",
 *    Bull. Amer. Meteor. Soc. 94 (2013) 313-316.]
 *
 * NOT 11,500, which this file said first and which the review caught.
 * 11,500 mm (452 in) is the old long-period gauge figure people quote;
 * the atlas's 1978-2007 analysis gives about 9,500, and its statewide
 * maximum is Big Bog on Maui at roughly 10,300 — so no Kauaʻi cell in it
 * can be 11,500. v0's own `weather/simulated.ts` cites this same paper,
 * in these same words, for 9,500. CLAUDE.md's research rule is the point:
 * a number attributed to a source that does not give it is worse than an
 * uncited one, because the citation stops the next reader checking.
 *
 * `wetness` is the dial between those two ends, and the model is tuned
 * so that the rain it actually DELIVERS over a simulated year lands on
 * the atlas's number for the dial it was set to. `tests/worldWeather.
 * test.ts` asserts exactly that, which is what stops the shower tuning
 * from drifting into fiction: change a constant here and the island
 * stops matching itself.
 *
 * Every constant below says whether it is MEASURED (an atlas figure, a
 * meteorological convention, an arithmetic fact) or GAME TUNING (chosen
 * to feel like the island). Nothing here is a forecast and nothing here
 * should ever be presented as one.
 *
 * THREE SKIES ARE BUILT. `skyIsBuilt` in the contract is the single
 * source of that truth and this file defers to it rather than keeping a
 * second list: `thunderstorm`, `hail` and `hurricane` are named in the
 * union so a `switch` is exhaustive from the start, and this model will
 * not produce one, will not fake one, and REFUSES to be forced into one.
 *
 * Pure: no three, no DOM, no fetch, no clock. `src/world/` is core.
 */
import { skyIsBuilt, type Sky, type WeatherNow, type WeatherSource, visibilityFor } from './weather';
// The seeded sequence comes from the island's ONE source of stable numbers
// (`world/random.ts`). This file used to carry a private copy of mulberry32
// because `world/` may not import `net/`; the copy `world/` is allowed to
// have now exists, and the weather draws from it like everything that grows.
import { mulberry32 } from '../random';

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------


/**
 * 0..1, and NaN-safe.
 *
 * `Math.min(1, Math.max(0, NaN))` is NaN, which would leak a
 * non-finite cloud into every reader. Nothing below can produce a NaN,
 * but "nothing can" is what every division by zero was called before it
 * happened, and the cost of being certain is one comparison.
 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// ---------------------------------------------------------------------------
// The island's own numbers — MEASURED
// ---------------------------------------------------------------------------

/** Mean hours in a calendar year: 365.25 x 24. ARITHMETIC. */
const HOURS_PER_YEAR = 8766;

/** Waiʻaleʻale's annual mean, millimetres. MEASURED (Rainfall Atlas). */
export const SUMMIT_MM_YEAR = 9_500;
/** Kekaha, on the lee coast, annual mean, millimetres. MEASURED. */
export const LEE_MM_YEAR = 500;

/** Waiʻaleʻale as a SUSTAINED rate: 1.312 mm/hr. ARITHMETIC. */
export const SUMMIT_MEAN_MM_HR = SUMMIT_MM_YEAR / HOURS_PER_YEAR;
/** Kekaha as a sustained rate: 0.057 mm/hr. ARITHMETIC. */
export const LEE_MEAN_MM_HR = LEE_MM_YEAR / HOURS_PER_YEAR;

/**
 * The rain classification everyone quotes, millimetres an hour.
 * MEASURED convention, not tuning — they are here so that a peak drawn
 * below can be argued with in words rather than in numbers.
 */
export const RAIN_LIGHT_MM_HR = 2.5;
export const RAIN_HEAVY_MM_HR = 10;
export const RAIN_DOWNPOUR_MM_HR = 50;

/**
 * How wet a place is, on a dial from Kekaha (0) to the summit bog (1).
 *
 * LOGARITHMIC IN THE ATLAS'S NUMBER, not linear, because the gradient is
 * a factor of TWENTY-THREE across twenty-five kilometres. Linear would
 * put Līhuʻe — 1,300 mm a year, the island's own airport, hardly a
 * desert — at 0.07, squashing everywhere a player will actually stand
 * into the bottom twelfth of the dial. On the log scale Līhuʻe is 0.30
 * and the dial is usable along its whole length.
 */
export function wetnessForAnnualMm(millimetres: number): number {
  if (!Number.isFinite(millimetres) || millimetres <= 0) return 0;
  return clamp01(Math.log(millimetres / LEE_MM_YEAR) / Math.log(SUMMIT_MM_YEAR / LEE_MM_YEAR));
}

/**
 * Real places on the real island, as dial settings.
 *
 * The annual totals are MEASURED (Rainfall Atlas); turning them into a
 * dial is this file's arithmetic, so the two are kept side by side and
 * derived rather than guessed. A default of Līhuʻe: it is where the
 * island's weather is officially observed, and it is neither of the
 * extremes.
 */
export const KAUAI_MM_YEAR = Object.freeze({
  waialeale: SUMMIT_MM_YEAR,
  hanalei: 2_000,
  lihue: 1_300,
  poipu: 900,
  kekaha: LEE_MM_YEAR,
});

/** The long-run mean this dial should deliver, mm/hr. Log-interpolated. */
export function meanRainForWetness(wetness: number): number {
  const w = clamp01(wetness);
  return LEE_MEAN_MM_HR * Math.pow(SUMMIT_MEAN_MM_HR / LEE_MEAN_MM_HR, w);
}

// ---------------------------------------------------------------------------
// What counts as cloudy, and what counts as rain — MEASURED conventions
// ---------------------------------------------------------------------------

/**
 * Where `clear` becomes `cloudy`: three eighths of the sky.
 *
 * MEASURED convention. Aviation reports cloud in OKTAS — FEW is one to
 * two eighths, SCATTERED three to four, BROKEN five to seven, OVERCAST
 * eight — and SCT is where an observer stops calling a sky clear. A
 * hand-picked 0.4 would have meant the same thing while being
 * unarguable-with; this one has a reason.
 */
export const CLOUDY_FLOOR = 3 / 8;

/**
 * No rain falls out of a sky thinner than BROKEN — five eighths.
 *
 * MEASURED convention for the threshold, GAME TUNING for using it as a
 * gate. `RAIN_CLOUD_FULL` is where the gate is fully open; between the
 * two the reported rain is scaled, so a shower fades in behind the cloud
 * that brought it and fades out with it. Continuous on purpose: see the
 * header on the hard cut that was tried first.
 */
export const RAIN_CLOUD_FLOOR = 5 / 8;
const RAIN_CLOUD_FULL = 0.9;

/**
 * Below this, it is not raining — it is damp air. Millimetres an hour.
 *
 * MEASURED-ish: a "trace" in surface observation is under 0.1 mm, and
 * 0.05 mm/hr is a hundredth of light rain. It exists because exponential
 * decay never reaches zero: without a floor the last shower of the
 * session would leave the sky reading `rain` for the rest of time at
 * 1e-40 mm/hr, and the honesty rule is not satisfied by a number that is
 * technically positive. The step it introduces is 1.4e-6 world units per
 * second of depth, which is nothing being tipped over anything.
 */
export const RAIN_VISIBLE_MM_HR = 0.05;

// ---------------------------------------------------------------------------
// The shape of a shower — GAME TUNING, checked against the atlas
// ---------------------------------------------------------------------------

const MINUTE = 60;

/**
 * A shower runs 3 to 25 minutes, biased short. GAME TUNING.
 *
 * Hawaiian showers are famously brief — the reason a rainbow is the
 * island's postcard is that the rain stops while the sun is still out.
 * `SHOWER_SHAPE` squares a uniform draw, so the mean is 10.3 minutes and
 * the long ones are rare rather than half of them.
 */
const SHOWER_MIN_S = 3 * MINUTE;
const SHOWER_MAX_S = 25 * MINUTE;
const SHOWER_SHAPE = 2;

/**
 * The first fifth of a shower is CLOUD ONLY — the rain pulse is zero
 * through it. GAME TUNING, and the structural half of "it went dark
 * first": on a mean shower that is two minutes of thickening sky before
 * the first drop, and it does not depend on where on the island you are
 * standing, which the cloud gate alone would.
 */
const BUILD_SHARE = 0.2;

/**
 * A shower's peak rate, millimetres an hour, before the wetness scale.
 * GAME TUNING against the MEASURED classification above: the floor is a
 * drizzle, the ceiling is just under a tropical downpour, and the fourth
 * power of a uniform draw makes the mean 9.96 — a heavy shower — while
 * leaving the 40 mm/hr ones genuinely uncommon.
 */
const PEAK_MIN_MM_HR = 1.2;
const PEAK_MAX_MM_HR = 45;
const PEAK_SHAPE = 4;
/** Mean of `u^PEAK_SHAPE` over a uniform u. ARITHMETIC: 1/(n+1). */
const PEAK_DRAW_MEAN = 1 / (PEAK_SHAPE + 1);
/** The mean peak a dial of 1 draws, mm/hr. ARITHMETIC from the three above. */
const MEAN_PEAK_MM_HR = PEAK_MIN_MM_HR + (PEAK_MAX_MM_HR - PEAK_MIN_MM_HR) * PEAK_DRAW_MEAN;

/**
 * The lee coast gets weaker showers as well as rarer ones. GAME TUNING:
 * a Kona storm can hammer the west side, so this is 0.4 rather than
 * something near zero, and the rest of the twenty-three-fold difference
 * is carried by how OFTEN it rains, which is the honest half.
 */
const PEAK_SCALE_LEE = 0.4;

/**
 * Mean of the rain pulse over a whole shower episode, as a fraction of
 * its peak. ARITHMETIC: a raised cosine averages a half, over the
 * `1 - BUILD_SHARE` of the episode it occupies.
 */
const PULSE_MEAN = 0.5 * (1 - BUILD_SHARE);

/**
 * What fraction of the pulse's mean actually reaches the output.
 *
 * MEASURED, and it is the number that settles the duty cycle. Easing lag
 * and the cloud gate both shave the delivered rain below the target's
 * mean, and neither has a closed form worth deriving.
 *
 * MEASURED over three simulated years at each of the five places in
 * `KAUAI_MM_YEAR`: at 0.891 the delivered year comes out at 1.021,
 * 1.012, 0.999, 0.979 and 0.978 of each place's atlas total, summit to
 * lee. One constant is enough because that spread is 4%, and it is only
 * 4% because cloud builds on the shower's own lead-in rather than on a
 * fixed tau — see `CLOUD_BUILD_SHARE_OF_LEAD` for the 30% spread this
 * replaced, and why a per-dial correction curve was the wrong fix.
 *
 * It is a CORRECTION, not a knob: change a tau or the gate and this
 * number moves, the yearly totals stop matching the atlas, and
 * `worldWeather.test.ts` says so.
 */
const DELIVERY = 0.891;

/**
 * A rail, not a tuning. GAME TUNING: no dial should ask for rain more
 * than 60% of the hours in a year, and a wetness outside 0..1 is clamped
 * before it gets here, so this can only fire if a constant above is
 * edited into nonsense — in which case a shower schedule with a negative
 * dry spell is a worse way to find out.
 */
const DUTY_MAX = 0.6;

// ---------------------------------------------------------------------------
// Cloud between showers — GAME TUNING
// ---------------------------------------------------------------------------

/**
 * How much cloud a dry spell keeps.
 *
 * The summit is IN cloud most of the year — that is why it is a bog and
 * why it collects 11,500 mm — so a dry spell there is 0.6, comfortably
 * `cloudy`, and the model will essentially never report `clear` at a
 * dial of 1. That is the island being honest rather than the model being
 * broken. The lee coast's 0.06 is a blue sky with a few trade cumulus.
 */
const CLOUD_DRY_LEE = 0.06;
const CLOUD_DRY_SUMMIT = 0.6;
/** Episode-to-episode variation either side of the dry level. */
const CLOUD_DRY_SPREAD = 0.18;
/** A shower's ceiling: broken to overcast, never less. */
const CLOUD_WET_MIN = 0.8;
const CLOUD_WET_MAX = 1;

// ---------------------------------------------------------------------------
// Wind — MEASURED direction, GAME TUNING speed
// ---------------------------------------------------------------------------

/**
 * The trades come from the ENE, near enough all year — MEASURED, and the
 * same 65 degrees v0 used, from the same cause: it is why one side of
 * this island is a rainforest and the other is a beach.
 *
 * DEGREES THE WIND COMES FROM, meteorology's convention, converted once
 * below into a direction of TRAVEL. A "north wind" arrives from the
 * north and blows south, and getting that backwards is the classic way
 * to have a world blowing the wrong way; the contract stores a VECTOR
 * precisely so this conversion happens once, here.
 */
const TRADE_BEARING_DEG = 65;
/** How far the trades wander either side of ENE. GAME TUNING. */
const TRADE_WANDER_DEG = 30;

/** Trade-wind speeds at the ten-metre reference height, km/h. MEASURED range. */
const WIND_CALM_KMH = 12;
const WIND_FRESH_KMH = 28;
/** A shower brings its own wind. GAME TUNING. */
const WIND_SHOWER_GAIN = 1.35;

/**
 * Kilometres an hour to world units a second. ARITHMETIC: a world unit
 * is a centimetre, so 1 km/h is 100,000 cm / 3,600 s = 27.78.
 *
 * READ THE NUMBER THIS PRODUCES BEFORE ADDING IT TO ANYTHING. A 20 km/h
 * trade wind is 556 world units a second and an adult worker's top pace
 * over the ground is about 12. This is the wind at the TEN-METRE
 * reference height, which is what "wind speed" means everywhere it is
 * measured; the flow inside the first centimetre of a vegetated surface
 * is a small fraction of it, and applying that reduction is the job of
 * whoever is being blown about, not of the sky. v0 wrote the same
 * warning in `weather/gameplay.ts` and it is worth repeating: she is
 * five and a half millimetres long and would be in the next valley.
 */
export const KMH_TO_UNITS_PER_SECOND = 100_000 / 3600;
/**
 * The height the wind is reported at, world units — ten metres, the
 * meteorological reference. Exported so the reduction to ant height is
 * something a caller can do honestly rather than guess at.
 */
export const WIND_REFERENCE_HEIGHT = 1000;

const DEG_TO_RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// How fast each channel moves — GAME TUNING, carried from v0's blend
// ---------------------------------------------------------------------------

/**
 * Seconds for each channel to close 63% of a gap. Cloud takes minutes,
 * rain starts over tens of seconds, wind shifts in under a minute.
 *
 * THE ORDERING IS v0's; TWO OF THE THREE NUMBERS ARE NOT, and this
 * comment used to claim otherwise. v0's `weather/blend.ts` has
 * `{ rain: 35, cloud: 150, windSpeed: 40 }`; only the wind carried
 * across unchanged. Cloud is 180 here and rain 45, both raised for the
 * gate behaviour described below, and both GAME TUNING rather than
 * anything measured. The review caught the mislabelling, which matters
 * more than the numbers do: a comment that asserts provenance a value
 * does not have is how the next agent stops re-deriving it.
 *
 * CLOUD IS SLOWER THAN RAIN ON PURPOSE and it is not only cosmetic: it
 * is what leaves the cloud gate open behind a departing shower instead
 * of slamming it, so a shower's tail fades on its own timescale.
 */
const CLOUD_CLEARING_TAU_S = 180;
const RAIN_TAU_S = 45;
const WIND_TAU_S = 40;

/**
 * CLOUD BUILDS FASTER THAN IT CLEARS, and the building tau is a fraction
 * of the shower's OWN lead-in rather than a fixed number of seconds.
 *
 * PHYSICALLY: a convective tower goes up in minutes and the deck it
 * leaves behind takes far longer to erode, and a bigger cell announces
 * itself over a longer lead than a passing three-minute shower does.
 *
 * MEASURED, and this is the number that settled it. With one fixed
 * 180 s tau in both directions the model delivered 1.030 of the atlas
 * total at the summit and 0.795 at Kekaha — a 30% spread across the
 * dial, from a single cause: the cloud gate is defined on ABSOLUTE
 * cover, and the summit's dry spells already sit at 0.6, a hair under
 * the gate, while the lee coast's sit at 0.06 and cannot climb through
 * it until half the shower has gone by. A per-dial correction curve
 * would have hidden that; raising the build rate removes it. A quarter
 * of the lead-in closes 98% of the gap, so the gate is open before the
 * first drop at EVERY dial.
 *
 * The clamp keeps it sane at the extremes: a three-minute shower would
 * otherwise build its cloud in nine seconds, and a fourteen-hour lee
 * dry spell would take an hour to thicken.
 */
const CLOUD_BUILD_SHARE_OF_LEAD = 0.25;
const CLOUD_BUILD_TAU_MIN_S = 15;
const CLOUD_BUILD_TAU_MAX_S = 120;

// ---------------------------------------------------------------------------
// How much time one call may pass
// ---------------------------------------------------------------------------

/**
 * The model integrates in slices of at most half a minute.
 *
 * `1 - exp(-dt/tau)` is EXACT over a slice whose target is constant, so
 * the only error is the target moving inside a slice — and the target
 * moves on the shape of a shower, ten minutes long. Thirty seconds
 * resolves the shortest shower the model can draw into six pieces, and
 * an ordinary frame is one slice with a branch taken once.
 */
const MAX_SLICE_S = 30;

/**
 * Below this many seconds there is no slice worth taking: it is float
 * residue from subtracting slices off a total, or an episode boundary
 * the model is already standing on. A microsecond of weather changes
 * nothing and looping on one changes nothing forever.
 */
const SLICE_EPSILON_S = 1e-6;

/**
 * The most weather one call may conjure: four hours.
 *
 * No frame covers four hours. A call that hands in more has lost track
 * of time — a tab restored from the background, a debugger resumed, a
 * clock read as milliseconds — and grinding a year of showers to draw
 * one frame is not what it meant. Capping keeps the loop bounded (at
 * most 480 slices) and keeps `advance` finite for any `dt` a caller can
 * name, including `Infinity`. A save that genuinely wants to skip a day
 * re-seeds; it does not ask the sky to catch up.
 */
const MAX_ADVANCE_S = 4 * 3600;

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/** One dry spell or one shower, with every number it needs, drawn once. */
interface Episode {
  readonly wet: boolean;
  readonly seconds: number;
  readonly peakMmHr: number;
  readonly cloud: number;
  readonly windKmh: number;
  readonly bearingDeg: number;
}

/** Where the four eased channels are heading this instant. */
interface Targets {
  readonly rainMmHr: number;
  readonly cloud: number;
  readonly windKmh: number;
  readonly bearingDeg: number;
}

export interface SkyModelOptions {
  /**
   * The seed. Same seed, same weather, forever — so it belongs with the
   * save, and a bug report can carry it.
   */
  readonly seed?: number;
  /**
   * Where on the island's rainfall gradient this world sits, 0 (Kekaha)
   * to 1 (Waiʻaleʻale). `wetnessForAnnualMm` turns an atlas figure into
   * one; `KAUAI_MM_YEAR` names five real places.
   */
  readonly wetness?: number;
}

/** Līhuʻe: neither extreme, and where the island's weather is observed. */
const DEFAULT_WETNESS = wetnessForAnnualMm(KAUAI_MM_YEAR.lihue);
/** Any value would do; a named one means a bug report can say "the default seed". */
export const DEFAULT_SEED = 0x4b41_5541; // "KAUA"

/**
 * The weather, deciding itself.
 *
 * ONE INSTANCE PER WORLD, owned by whoever owns the frame loop, which
 * hands it a `dt` and hands `now()` to everything else as a
 * `WeatherSource`. It owns its own state and nothing else's.
 *
 * `wetness` IS FIXED AT CONSTRUCTION AND DELIBERATELY NOT SETTABLE. The
 * contract is explicit that this is not a field yet — one weather,
 * everywhere — and a dial that moved with the player while the episode
 * schedule stayed global would be the worst half of a field: walk
 * uphill and the shower intensifies with no cloud arriving to explain
 * it. When the field is built, the sampler takes a `WorldPoint`, returns
 * this same shape, and this dial is what it drives.
 */
export class SkyModel implements WeatherSource {
  private readonly rng: () => number;
  private readonly wet: number;
  /** Cloud a dry spell settles at, for this dial. */
  private readonly dryCloud: number;
  /** Peak multiplier for this dial. */
  private readonly peakScale: number;
  /** Dry seconds per wet second, from the duty cycle the atlas asks for. */
  private readonly dryFactor: number;

  private episode: Episode;
  private episodeElapsed: number;
  private cloudNow: number;
  /** UNGATED and UNFLOORED, mm/hr. The gate and the floor are the report's. */
  private rainNow = 0;
  private windXNow: number;
  private windZNow: number;
  private forced: Sky | null = null;
  private reading: WeatherNow;

  constructor(options: SkyModelOptions = {}) {
    const seed = Number.isFinite(options.seed) ? (options.seed as number) : DEFAULT_SEED;
    this.rng = mulberry32(seed >>> 0);
    this.wet = Number.isFinite(options.wetness) ? clamp01(options.wetness as number) : DEFAULT_WETNESS;

    this.dryCloud = CLOUD_DRY_LEE + (CLOUD_DRY_SUMMIT - CLOUD_DRY_LEE) * this.wet;
    this.peakScale = PEAK_SCALE_LEE + (1 - PEAK_SCALE_LEE) * this.wet;

    // The duty cycle is DERIVED from the atlas, not chosen: how much of
    // the time it must rain for a mean shower to add up to this place's
    // year. Everything on the right is a constant or a dial, so the
    // yearly total is a consequence of the tuning rather than a hope.
    const perShower = PULSE_MEAN * MEAN_PEAK_MM_HR * this.peakScale * DELIVERY;
    const duty = Math.min(DUTY_MAX, meanRainForWetness(this.wet) / perShower);
    this.dryFactor = (1 - duty) / duty;

    // Start in a dry spell, at a random point INSIDE it: opening every
    // world at the same phase would make "how long until the first
    // shower" a property of the model rather than of the seed.
    this.episode = this.nextEpisode(false);
    this.episodeElapsed = this.rng() * this.episode.seconds;

    // ARRIVE ALREADY IN IT. v0's blend learned this the hard way: easing
    // from zero spawns her in an airless, perfectly clear world that
    // then clouds over for five minutes. The first state IS the target.
    this.cloudNow = this.episode.cloud;
    const speed = this.episode.windKmh * KMH_TO_UNITS_PER_SECOND;
    const bearing = this.episode.bearingDeg * DEG_TO_RAD;
    this.windXNow = -speed * Math.sin(bearing);
    this.windZNow = speed * Math.cos(bearing);

    this.reading = this.read();
  }

  /** The weather this instant. The `WeatherSource` door. */
  now(): WeatherNow {
    return this.reading;
  }

  /** The dial this world was built at, 0 lee to 1 summit. */
  get wetness(): number {
    return this.wet;
  }

  /**
   * The sky being FORCED, or null when the weather is its own.
   *
   * A getter and not a field on `WeatherNow`: a reader of the weather
   * should not be able to tell, and behave differently, when a developer
   * is holding the sky open. Only whoever is doing the forcing needs to
   * know, and this is how they ask.
   */
  get forcedSky(): Sky | null {
    return this.forced;
  }

  /**
   * Hold the sky at one state, or hand it back.
   *
   * AN OVERRIDE, AND OBVIOUSLY ONE. Three things make it that rather
   * than a setting that quietly persists:
   *
   *  - The weather NEVER STOPS UNDERNEATH. Episodes keep being drawn on
   *    the same seeded schedule while the override is on, so releasing
   *    returns to where the world's own weather got to, not to where it
   *    was when the override started. A held sky costs the schedule
   *    nothing, which `worldWeather.test.ts` proves by re-converging a
   *    forced-and-released model onto an untouched twin.
   *  - It sets a DESTINATION, not a value. Forced rain ramps in over the
   *    same tau real rain does; the sky does not read `rain` the instant
   *    the button is pressed, because a bucket tipping is the one thing
   *    this whole file is arranged to avoid.
   *  - It is not stored anywhere and nothing serialises it.
   *
   * Returns whether the sky was accepted. An UNBUILT sky is REFUSED and
   * the override is left exactly as it was: `hail` is a name in a union,
   * and honouring it would be the model producing weather it does not
   * have — the honesty rule, in the one place a caller could break it.
   * A dev tool asks `skyIsBuilt` to decide what to draw as available;
   * this is the second line, for when it does not.
   */
  force(sky: Sky | null): boolean {
    if (sky === null) {
      this.forced = null;
      return true;
    }
    if (!skyIsBuilt(sky)) return false;
    this.forced = sky;
    return true;
  }

  /** Let the weather be its own again. `force(null)`, said out loud. */
  release(): void {
    this.forced = null;
  }

  /**
   * Move the weather on by `dt` SECONDS and return the new reading.
   *
   * A `dt` that is zero, negative or not a number passes no time and
   * returns the current reading unchanged — a clock that stands still or
   * runs backwards is a bug upstream, and rewinding the weather would
   * cost the replay guarantee to hide it. Anything beyond `MAX_ADVANCE_S`
   * advances by that much and no further; see the constant.
   */
  advance(dt: number): WeatherNow {
    if (!Number.isFinite(dt) || dt <= 0) return this.reading;

    let left = Math.min(dt, MAX_ADVANCE_S);
    while (left > SLICE_EPSILON_S) {
      let slice = left < MAX_SLICE_S ? left : MAX_SLICE_S;

      // A SLICE NEVER STRADDLES AN EPISODE BOUNDARY, and this is the
      // line that makes the frame-rate independence real rather than
      // merely claimed. A slice that started in a dry spell and ended
      // inside the shower after it ran the shower's cloud target over
      // the WHOLE slice, including the part that was still dry — so a
      // 30 s step and thirty 1 s steps came out of phase by up to a
      // whole slice during a build. MEASURED at 0.65 of cloud apart at
      // the worst moment, which is a blue sky on one machine and an
      // overcast one on the other at the same simulated second. The
      // exponential easing did not save it and could not: the error was
      // in WHEN the target changed, not in how fast it was chased.
      // Clipping costs one comparison and takes the disagreement to
      // 4.8e-15, which is float noise.
      const toBoundary = this.episode.seconds - this.episodeElapsed;
      if (toBoundary > SLICE_EPSILON_S && toBoundary < slice) slice = toBoundary;
      this.step(slice);
      left -= slice;
    }
    this.reading = this.read();
    return this.reading;
  }

  // -------------------------------------------------------------------------

  /**
   * One episode, six draws, ALWAYS IN THE SAME ORDER AND ALWAYS ALL SIX.
   *
   * Fixed width matters: if a dry spell consumed fewer draws than a
   * shower, the stream's position would depend on the history of wet and
   * dry, and a change to one branch would move every episode after it.
   * Six draws an episode means the schedule is a function of the seed
   * and the episode INDEX, which is the property that makes a seed worth
   * putting in a bug report.
   */
  private nextEpisode(wet: boolean): Episode {
    const r = this.rng;
    const showerSeconds = SHOWER_MIN_S + (SHOWER_MAX_S - SHOWER_MIN_S) * Math.pow(r(), SHOWER_SHAPE);
    const peakMmHr = (PEAK_MIN_MM_HR + (PEAK_MAX_MM_HR - PEAK_MIN_MM_HR) * Math.pow(r(), PEAK_SHAPE)) * this.peakScale;
    const cloudDraw = r();
    const windDraw = r();
    const bearingDraw = r();
    // Multiplicative jitter with a mean of exactly 1, so the dry spells
    // vary without moving the duty cycle the atlas fixed.
    const dryJitter = 0.5 + r();

    return {
      wet,
      seconds: wet ? showerSeconds : showerSeconds * this.dryFactor * dryJitter,
      peakMmHr,
      cloud: wet
        ? CLOUD_WET_MIN + (CLOUD_WET_MAX - CLOUD_WET_MIN) * cloudDraw
        : clamp01(this.dryCloud + (cloudDraw - 0.5) * 2 * CLOUD_DRY_SPREAD),
      windKmh: (WIND_CALM_KMH + (WIND_FRESH_KMH - WIND_CALM_KMH) * windDraw) * (wet ? WIND_SHOWER_GAIN : 1),
      bearingDeg: TRADE_BEARING_DEG + (bearingDraw - 0.5) * 2 * TRADE_WANDER_DEG,
    };
  }

  /** Where the natural weather is heading, `elapsed` seconds into the episode. */
  private naturalTargets(elapsed: number): Targets {
    const e = this.episode;
    let rainMmHr = 0;
    if (e.wet) {
      const p = Math.min(1, elapsed / e.seconds);
      if (p > BUILD_SHARE) {
        // A raised cosine: zero at both ends, peak in the middle. A
        // shower that started and stopped at its peak would be a pair
        // of steps with a plateau between them.
        const q = (p - BUILD_SHARE) / (1 - BUILD_SHARE);
        rainMmHr = e.peakMmHr * (0.5 - 0.5 * Math.cos(2 * Math.PI * q));
      }
    }
    return { rainMmHr, cloud: e.cloud, windKmh: e.windKmh, bearingDeg: e.bearingDeg };
  }

  /**
   * Where a HELD sky is heading. The wind is left to the real weather:
   * forcing a sky is a statement about the sky, and inventing a calm to
   * go with it would be the override quietly becoming a whole
   * alternative world.
   */
  private forcedTargets(sky: Sky, natural: Targets): Targets {
    // CLOUDY SITS DELIBERATELY UNDER THE RAIN GATE. A sky forced to
    // `cloudy` must be a sky that cannot rain, or a shower already in
    // progress would keep falling through it for a minute or two and the
    // label would read `rain` while a developer held the sky at
    // `cloudy`. 0.58 is comfortably past CLOUDY_FLOOR and short of
    // RAIN_CLOUD_FLOOR, so the gate is shut and the word is honest.
    const cloud = sky === 'clear' ? 0.04 : sky === 'cloudy' ? 0.58 : 0.92;
    // A solid, unmistakable, HEAVY shower — the thing a rain renderer or
    // a water solver wants to be tested against, and a rate the island
    // genuinely produces (see RAIN_HEAVY_MM_HR).
    const rainMmHr = sky === 'rain' ? RAIN_HEAVY_MM_HR : 0;
    return { rainMmHr, cloud, windKmh: natural.windKmh, bearingDeg: natural.bearingDeg };
  }

  /**
   * One slice: ease every channel toward where the weather is heading in
   * the MIDDLE of it, then move the clock and roll the episode over.
   *
   * THE MIDDLE, not either end. `1 - exp(-dt/tau)` is the exact answer
   * for a target that does not move, so all the error left in a slice is
   * the target moving inside it — and sampling that at the midpoint is
   * second-order rather than first. It is what lets a 30 s slice and a
   * 1 s slice integrate the same shower; sampling at the end also
   * silently ran the NEXT episode's target over this slice, which is the
   * other half of the straddle `advance` now prevents.
   */
  private step(dt: number): void {
    const natural = this.naturalTargets(this.episodeElapsed + dt / 2);
    const target = this.forced === null ? natural : this.forcedTargets(this.forced, natural);

    // Rising and falling are different rates, and the test is the
    // MEASURED fact (is the sky thickening?) rather than a flag saying
    // which kind of episode this is — so a shower and a forced sky build
    // on one rule and there is no second code path to disagree with.
    const lead = BUILD_SHARE * this.episode.seconds * CLOUD_BUILD_SHARE_OF_LEAD;
    const tauCloud = target.cloud > this.cloudNow
      ? Math.min(CLOUD_BUILD_TAU_MAX_S, Math.max(CLOUD_BUILD_TAU_MIN_S, lead))
      : CLOUD_CLEARING_TAU_S;
    const kCloud = 1 - Math.exp(-dt / tauCloud);
    this.cloudNow += (target.cloud - this.cloudNow) * kCloud;

    const kRain = 1 - Math.exp(-dt / RAIN_TAU_S);
    this.rainNow += (target.rainMmHr - this.rainNow) * kRain;

    // EASED AS A VECTOR, never as an angle. Easing the degrees sends a
    // wind backing from 350 to 10 the long way round the compass,
    // sweeping through south to make a twenty-degree shift. v0's blend
    // has the same note over the same two lines of trigonometry.
    const speed = target.windKmh * KMH_TO_UNITS_PER_SECOND;
    const bearing = target.bearingDeg * DEG_TO_RAD;
    const kWind = 1 - Math.exp(-dt / WIND_TAU_S);
    this.windXNow += (-speed * Math.sin(bearing) - this.windXNow) * kWind;
    this.windZNow += (speed * Math.cos(bearing) - this.windZNow) * kWind;

    this.episodeElapsed += dt;
    // `while`, not `if`: `advance` clips a slice to the boundary, so
    // this normally rolls exactly one episode — but nothing in the
    // constants forbids an episode shorter than the epsilon a clipped
    // slice can leave behind, and one that was would otherwise never end.
    while (this.episodeElapsed >= this.episode.seconds) {
      this.episodeElapsed -= this.episode.seconds;
      this.episode = this.nextEpisode(!this.episode.wet);
    }
  }

  /**
   * The eased state, as the contract's shape.
   *
   * THE GATE, THE FLOOR AND THE LABEL ALL LIVE HERE, at the reporting
   * boundary, and the internal rain is left ungated so it keeps decaying
   * smoothly behind a closing sky. Together they make two claims true by
   * arithmetic rather than by discipline:
   *
   *   rainMmHr > 0  =>  cloud >= RAIN_CLOUD_FLOOR   (the gate is 0 below it)
   *   rainMmHr > 0  =>  sky === 'rain'              (the floor is the label's test)
   *
   * `sky` is DERIVED from the two continuous channels every frame rather
   * than latched, which is ARCHITECTURE's rule and also the only way the
   * label cannot disagree with the numbers underneath it. It can flicker
   * in principle, if cloud reverses within a hair of `CLOUDY_FLOOR` at
   * an episode boundary; that is a word changing, not a light, because
   * everything that renders reads `cloud` — which is exactly why the
   * contract says cloud is not derived from sky.
   */
  private read(): WeatherNow {
    const cloud = clamp01(this.cloudNow);
    const gate = clamp01((cloud - RAIN_CLOUD_FLOOR) / (RAIN_CLOUD_FULL - RAIN_CLOUD_FLOOR));
    const wet = Math.max(0, this.rainNow) * gate;
    const rainMmHr = Number.isFinite(wet) && wet >= RAIN_VISIBLE_MM_HR ? wet : 0;
    const sky: Sky = rainMmHr > 0 ? 'rain' : cloud >= CLOUDY_FLOOR ? 'cloudy' : 'clear';

    return Object.freeze({
      sky,
      rainMmHr,
      cloud,
      windX: Number.isFinite(this.windXNow) ? this.windXNow : 0,
      windZ: Number.isFinite(this.windZNow) ? this.windZNow : 0,
      visibilityM: visibilityFor(rainMmHr, cloud),
      source: 'simulated' as const,
    });
  }
}
