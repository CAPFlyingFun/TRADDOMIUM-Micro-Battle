/**
 * THE SKY, THE LIGHT AND THE AIR — what the weather looks like.
 *
 * FOG IS A WEATHER EFFECT NOW. It used to be a hiding place: enough
 * haze to cover where the streamed cells stopped, applied at one fixed
 * density in all conditions. That is the wrong job for it. A clear day
 * on Kauaʻi shows you twenty-four kilometres of coastline and mountain,
 * and those are the only landmarks a five-millimetre animal has; taking
 * them away permanently to hide a seam costs far more than the seam
 * did. So the density now comes from the reported visibility, and the
 * clear-weather case is genuinely clear.
 *
 * THE ARITHMETIC. `FogExp2` leaves `exp(-(d·ρ)²)` of a surface showing
 * at distance d. "Visibility" in meteorology is where a dark object
 * becomes indistinguishable, conventionally at 5% contrast, so
 *
 *   ρ = √(−ln 0.05) / sight  =  1.7308 / sight
 *
 * which means the number the provider reports lands where the provider
 * means it, rather than being a hand-tuned constant that happens to
 * look about right.
 *
 * The palette is separate from the fit above and is GAME TUNING: three
 * skies — a clear one, an overcast one and a storm — with `gloom`
 * moving between them. Overcast light also gets DIFFUSE, not merely
 * dimmer: the sun goes away and the sky itself becomes the source,
 * which is why the hemisphere light rises while the directional falls.
 * Dimming both is how overcast ends up looking like dusk.
 *
 * Pure functions, so the numbers can be tested without a canvas.
 */
import type { GameWeather } from './gameplay';

/** √(−ln 0.05) — the 5%-contrast convention, once, here. */
export const FOG_TAIL = Math.sqrt(-Math.log(0.05));

export interface Rgb { readonly r: number; readonly g: number; readonly b: number }

/** A bright trade-wind afternoon. The colour the game shipped with. */
export const CLEAR_SKY: Rgb = { r: 0.612, g: 0.784, b: 0.910 }; // 0x9cc8e8
/** Flat white-grey, the island's usual ceiling. */
export const DULL_SKY: Rgb = { r: 0.596, g: 0.635, b: 0.671 };
/** The bottom of a shower. Still a colour, never black. */
export const STORM_SKY: Rgb = { r: 0.310, g: 0.337, b: 0.376 };

export interface SkyLook {
  /** FogExp2 density. */
  readonly density: number;
  /** Background and fog, which must match or the horizon shows a line. */
  readonly sky: Rgb;
  /** Directional light, the sun. */
  readonly sun: number;
  /** Hemisphere light, the sky itself. */
  readonly ambient: number;
  /** How warm the sunlight is, 0 grey to 1 the shipped golden white. */
  readonly warmth: number;
}

const SUN_CLEAR = 2.3;
const SUN_OVERCAST = 0.35;
const AMBIENT_CLEAR = 0.85;
const AMBIENT_OVERCAST = 1.25;

function mix(from: Rgb, to: Rgb, t: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  };
}

export function skyLook(now: GameWeather): SkyLook {
  const gloom = Math.max(0, Math.min(1, now.gloom));
  // Two legs rather than one: clear to overcast is a change of colour,
  // overcast to storm is a change of brightness, and one straight lerp
  // between the ends passes through neither convincingly.
  const sky = gloom <= 0.6
    ? mix(CLEAR_SKY, DULL_SKY, gloom / 0.6)
    : mix(DULL_SKY, STORM_SKY, (gloom - 0.6) / 0.4);

  return {
    density: FOG_TAIL / Math.max(1, now.sight),
    sky,
    sun: SUN_CLEAR + (SUN_OVERCAST - SUN_CLEAR) * gloom,
    ambient: AMBIENT_CLEAR + (AMBIENT_OVERCAST - AMBIENT_CLEAR) * gloom,
    warmth: 1 - gloom,
  };
}

/** How far you can see under a given density — the fit, run backwards. */
export function sightFor(density: number): number {
  return FOG_TAIL / Math.max(1e-12, density);
}
