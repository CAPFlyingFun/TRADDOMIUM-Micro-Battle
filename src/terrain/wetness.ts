/**
 * WET GROUND — what the sea and the rain do to how the ground LOOKS,
 * reduced to three numbers a frame.
 *
 * Joshua's brief (2026-09-07): a lightweight VISUAL wetness for terrain
 * the ocean touches — dry, wave-covered, recently exposed and fading
 * back — and the same for rain. Not erosion: water never edits a height,
 * and nothing in this file or in the shader it feeds can. The ground's
 * geometry is `heightAt` and stays `heightAt`; wetness is a lens over
 * the colour and a small highlight, and this module is the lens's
 * settings.
 *
 * WHY THREE NUMBERS AND NOT A MAP. The swash is a line the sea draws
 * across the island at one height: the run-up climbs the beach to about
 * the same height everywhere the swell reaches, so "how wet is this
 * ground" is nearly a function of height above mean sea level, and a
 * height is something every vertex already has. Two uniforms — where wet
 * ends and how fast it fades — say it for the whole island at once, with
 * no texture, no per-vertex write, and no refill of any ring. That is
 * what "keep it local, cheap, shader-space" buys: the terrain's frame
 * cost does not move.
 *
 * WHY THE RAIN IS EASED HERE AND NOT IN THE SHADER. Ground does not wet
 * the instant a shower starts nor dry the instant it stops; it darkens
 * over tens of seconds and pales over minutes. `easeRainWetness` is that
 * lag, in the exact-exponential form `world/weather/blend.ts` uses, so a
 * phone at 30 fps, the headless probe at a frame and a half a second and
 * a paused game all put the same wetness on the ground at the same
 * SIMULATED time.
 *
 * PURE: no three, no DOM, no clock. Handed a swell's reach and a rain
 * strength; hands back settings. `terrain/TerrainView.setWetness` is
 * where they go.
 */
import { SEA_LEVEL } from '../world/heightfield';

/** The three settings the terrain's wetness lens takes each frame. */
export interface WetnessSignals {
  /** The world height, above mean sea level, up to which the ground is wet NOW. */
  readonly shoreTop: number;
  /** The height over which wet fades to dry above `shoreTop`. World units. */
  readonly shoreFade: number;
  /** How wet the ground is from rain, 0 dry to 1 soaked. */
  readonly rain: number;
}

/**
 * The swash climbs PAST the crest. GAME TUNING from the swell's crest
 * envelope (`SeaSwell.reach()`, about 48 units on the shipped table):
 * a wave that stands 48 units above mean sea level offshore runs up the
 * beach as a sheet that keeps going after the crest has spent itself,
 * so the wet line sits above the highest crest — a quarter again here.
 * Measured beaches run up two to three crest heights on a gentle slope;
 * this is deliberately less, because the shore's fade below does the
 * rest and a wet line far above any wave reads as a tide mark that
 * never moves.
 */
export const SHORE_TOP_OF_REACH = 1.25;

/**
 * How far above the wet line the ground is still DAMP, as a multiple of
 * the reach. GAME TUNING. The wet line is not a line: the last few waves
 * reached different heights, and the sand between the highest and the
 * usual is drying at different rates. One and a half reaches — about
 * 72 units, 0.7 m, on the shipped table — is a band you notice on a
 * beach and cannot see from the cliff, which is the intent.
 */
export const SHORE_FADE_OF_REACH = 1.5;

/**
 * Seconds for rain to close about 63% of the gap toward soaked. GAME
 * TUNING shaped by how fast bare ground darkens under a shower — tens of
 * seconds, not minutes.
 */
export const WET_TAU_S = 20;

/**
 * Seconds for wet ground to close about 63% of the gap back toward dry
 * once the rain has stopped. GAME TUNING: a warm island dries a beach in
 * a few minutes and a forest floor in more; three minutes is the beach,
 * because that is what the player sees against the sea.
 */
export const DRY_TAU_S = 180;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Where the sea's wet line stands, from the swell's crest envelope.
 *
 * A reach that is not a finite positive number is treated as no swell
 * at all: the ground is wet exactly to mean sea level and dry above it,
 * with no fade — which is also what the terrain shows before the sea has
 * spoken.
 */
export function shoreWetnessOf(swellReach: number): { shoreTop: number; shoreFade: number } {
  const reach = Number.isFinite(swellReach) && swellReach > 0 ? swellReach : 0;
  return {
    shoreTop: SEA_LEVEL + reach * SHORE_TOP_OF_REACH,
    shoreFade: reach * SHORE_FADE_OF_REACH,
  };
}

/**
 * Move the rain wetness toward `rainStrength01` by `dt` SIMULATED
 * seconds and return it, 0..1.
 *
 * Rising takes `WET_TAU_S`; falling takes `DRY_TAU_S`. The form is
 * `1 - exp(-dt / tau)`, so sixty steps of a second and one step of a
 * minute land in the same place, and the value never overshoots the
 * target — which is what makes the direction, and so the tau, stable
 * for the whole approach.
 *
 * A `dt` that is zero, negative or not a number passes no time: a
 * paused game holds the ground where it is. A target that is not a
 * number is not chased. A current value that is not a number is read as
 * dry rather than poisoning every frame after it.
 */
export function easeRainWetness(current: number, rainStrength01: number, dt: number): number {
  const from = clamp01(Number.isFinite(current) ? current : 0);
  if (!Number.isFinite(dt) || dt <= 0) return from;
  if (!Number.isFinite(rainStrength01)) return from;
  const to = clamp01(rainStrength01);
  const tau = to > from ? WET_TAU_S : DRY_TAU_S;
  return clamp01(from + (to - from) * (1 - Math.exp(-dt / tau)));
}
