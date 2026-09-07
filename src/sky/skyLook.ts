/**
 * WHAT THE SKY LOOKS LIKE — from the weather and the sun, one value the
 * dome, the lights and the fog all read.
 *
 * Joshua, 2026-09-07: "real weather synced, but just would need the
 * visuals for like sunny/clear, partly cloudy, etc… with a skybox HDRI".
 * `world/weather` says what the weather IS and `world/weather/solar`
 * says where the sun IS; this says what that LOOKS like: which two of
 * the four baked skies to show and how far between them, where the key
 * light comes from and how strong and how warm, how bright the sky's
 * own light is, how far the air lets you see, and what colour the
 * horizon is — which is the one colour the background, the fog and the
 * dome's rim must all agree on, or the horizon shows a line.
 *
 * PURE, AND EVERYTHING IN IT IS CONTINUOUS. No three, no DOM, no
 * clock: a weather reading and a sun position in, plain numbers out,
 * so every rule below is testable without a canvas. And every number
 * is a piecewise-linear function of the sun's elevation and the cloud
 * cover, so nothing here can SNAP — the sun moves about thirteen
 * degrees an hour over Kauaʻi and the cloud eases over minutes, and a
 * sky that jumped between frames would be the first thing a phone
 * screenshot showed. `tests/skyLook.test.ts` sweeps the sun through the
 * whole day and holds every band edge to that.
 *
 * ─── which sky ────────────────────────────────────────────────────────
 *
 * Four images (`assets/skyManifest.ts`): `clear` (noon), `partly` (a
 * low sun and broken cloud), `dusk` and `night`. The dome takes TWO at
 * a time and a mix between them, so the day is a chain of cross-fades
 * on the sun's elevation, and each fade is wide enough that the mix
 * never moves more than 0.05 per degree:
 *
 *   below −24°          night
 *   −24° … −2°          night → dusk     (centred on −13°, nautical twilight,
 *                                          where the last of the glow goes)
 *   −2° … +20°          dusk → clear     (centred on +9°, where the sun is
 *                                          low enough that its light is gold)
 *   above +20°          clear → partly, by CLOUD: 0 below 0.3 cover, 1
 *                       above 0.5, ramped in over +20° … +40° so the
 *                       hand-over from the dusk fade is seamless
 *
 * The widths are the continuity requirement made into degrees: twenty-
 * two degrees is an hour and a half of real sun, which is also about
 * what a twilight takes. Real twilight runs from sunset to −18°, so the
 * bands are not far from the sky's own. That the cloud fade is not
 * available below +20° (two texture slots, three images in play) is the
 * one thing this arrangement gives up, and it is written down here
 * rather than left to be found: below that height, cover shows as
 * dimming and a grey horizon, which is most of what cover looks like.
 *
 * ─── the light ────────────────────────────────────────────────────────
 *
 * Three palettes — day, low sun, night — blended by the same elevation
 * bands, then the WEATHER applied on top. v0's rule for that
 * (`legacy/v0-main:src/weather/sky.ts`) is carried whole: overcast is
 * DIFFUSE, not merely dimmer. The sun goes away and the sky itself
 * becomes the source, so the directional light FALLS and the hemisphere
 * light RISES. Dimming both is how overcast ends up looking like dusk,
 * and a test holds the two apart. Rain adds to the same gloom. The
 * dome image is dimmed under cover — a photograph of a clear sky at a
 * fraction of its brightness reads as cloud coming over — while the
 * horizon goes to v0's flat grey.
 *
 * The clear-noon numbers are the ones the terrain was ACCEPTED under
 * (`perf/PerformanceWorldScene.ts`: 1.15 on the sun at 0xfff4e0, 1.0 on
 * the hemisphere, HORIZON #9db6c6 on the sky and fog, #4a4335 bounced
 * from the ground), so a clear noon renders exactly the island Joshua
 * already signed off. Everything else is GAME TUNING relative to that.
 *
 * ─── the air ──────────────────────────────────────────────────────────
 *
 * Fog density comes from the reported visibility and from nothing else
 * — v0's rule, and the reason a clear day on Kauaʻi shows the
 * twenty-four kilometres of coastline it really shows. "Visibility" in
 * meteorology is where a dark object reaches 5% contrast, and an
 * exponential-squared fog leaves exp(−(ρd)²) of a surface at distance
 * d, so ρ = √(−ln 0.05) / sight. `SkyView` turns that density into the
 * scene's linear fog with the same 5% distance (the conversion is
 * stated there). Rain and cloud reach the fog only through the
 * visibility the weather reports, which is the honest route: the number
 * on the HUD and the haze on the screen are then the same number.
 */
import type { SkyImageId } from '../assets/skyManifest';
import type { SunPosition } from '../world/weather/solar';
import type { WeatherNow } from '../world/weather/weather';

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface SkyLook {
  /** The sky the dome shows, and the one it is fading toward. */
  readonly image: SkyImageId;
  /** 0..1 toward `nextImage`. */
  readonly mix: number;
  readonly nextImage: SkyImageId;
  /** The real sun's bearing, radians clockwise from north — what the dome rotates each image to. */
  readonly sunAzimuth: number;
  /**
   * Where the KEY LIGHT comes from, radians above the horizon: the
   * sun's elevation, held at or above `LIGHT_FLOOR` so that after
   * sunset the light is the twilight glow above the horizon rather
   * than a lamp under the ground.
   */
  readonly sunElevation: number;
  /** The directional light. */
  readonly sunIntensity: number;
  /** sRGB, 0..1 — the convention every colour in the scene is written in. */
  readonly sunColour: Rgb;
  /** The hemisphere light: the sky's own colour from above, the ground's bounce from below. */
  readonly hemisphereSky: Rgb;
  readonly hemisphereGround: Rgb;
  readonly hemisphereIntensity: number;
  /** FogExp2 density, per world unit: √(−ln 0.05) / sight. */
  readonly fogDensity: number;
  /** Background, fog and the dome's rim. One colour, or the horizon shows a line. */
  readonly horizon: Rgb;
  /** Multiplier on the dome image: 1 in clear air, less under cover and rain. */
  readonly dimming: number;
}

/** √(−ln 0.05) — the 5%-contrast convention, once, here. */
export const FOG_TAIL = Math.sqrt(-Math.log(0.05));

/** 100 world units to the metre, as everywhere: one unit is a centimetre. */
const M = 100;

const DEG = Math.PI / 180;

/* ─── the bands, in degrees of sun elevation ─────────────────────────── */

/** Below this it is night. */
export const NIGHT_BELOW_DEG = -24;
/** The night → dusk fade ends, and the dusk → day fade begins, here: the sun has just set. */
export const DUSK_AT_DEG = -2;
/** Above this the day skies have taken over from dusk. */
export const DAY_ABOVE_DEG = 20;
/** The cloud cross-fade between the two day skies is fully available from here up. */
export const CLOUD_FADE_FULL_DEG = 40;
/** Cloud cover at which the day sky starts toward `partly`, and where it has fully arrived. */
export const PARTLY_FROM_CLOUD = 0.3;
export const PARTLY_AT_CLOUD = 0.5;
/** The key light never comes from below this: after sunset it is the glow above the horizon. */
export const LIGHT_FLOOR = 6 * DEG;

/* ─── the palettes (sRGB), GAME TUNING ───────────────────────────────── */

/** The shipped clear-noon sky and fog: `PerformanceWorldScene`'s HORIZON #9db6c6. */
export const HORIZON_CLEAR: Rgb = Object.freeze({ r: 0.616, g: 0.714, b: 0.776 });
/** What the ground bounces into the shaded side of a hill: the scene's #4a4335. */
export const GROUND_BOUNCE: Rgb = Object.freeze({ r: 0.290, g: 0.263, b: 0.208 });
/** The shipped sun: 0xfff4e0, a golden white. */
export const SUN_WARM: Rgb = Object.freeze({ r: 1.0, g: 0.957, b: 0.878 });
/** v0's flat white-grey ceiling, and the bottom of a shower. Never black. */
export const HORIZON_DULL: Rgb = Object.freeze({ r: 0.596, g: 0.635, b: 0.671 });
export const HORIZON_STORM: Rgb = Object.freeze({ r: 0.310, g: 0.337, b: 0.376 });
/** Overcast light has no colour of its own. */
const SUN_GREY: Rgb = Object.freeze({ r: 0.82, g: 0.84, b: 0.86 });

interface Palette {
  readonly sun: number;
  readonly sunColour: Rgb;
  readonly hemisphere: number;
  readonly ground: Rgb;
  readonly horizon: Rgb;
}

/** Noon, clear: the accepted island. */
const DAY: Palette = {
  sun: 1.15,
  sunColour: SUN_WARM,
  hemisphere: 1.0,
  ground: GROUND_BOUNCE,
  horizon: HORIZON_CLEAR,
};

/** The sun on the horizon: gold light, a warm rim, a darker bounce. */
const LOW_SUN: Palette = {
  sun: 0.5,
  sunColour: { r: 1.0, g: 0.72, b: 0.46 },
  hemisphere: 0.55,
  ground: { r: 0.24, g: 0.20, b: 0.18 },
  horizon: { r: 0.86, g: 0.62, b: 0.46 },
};

/** Night: a dim blue-grey key (moon and skyglow), a blue-grey bounce, a near-black blue rim. */
const NIGHT: Palette = {
  sun: 0.06,
  sunColour: { r: 0.58, g: 0.66, b: 0.85 },
  hemisphere: 0.14,
  ground: { r: 0.09, g: 0.10, b: 0.14 },
  horizon: { r: 0.03, g: 0.04, b: 0.07 },
};

/** v0's diffuse rule, as ratios: under full cover the sun falls to this much of itself and the sky rises to this much. */
export const SUN_UNDER_COVER = 0.35 / 2.3;
export const HEMISPHERE_UNDER_COVER = 1.25 / 0.85;
/** How much of the dome image full cover takes away. */
export const DIMMING_UNDER_COVER = 0.55;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 0 at `from`, 1 at `to`, straight between. */
const ramp = (x: number, from: number, to: number): number => clamp01((x - from) / (to - from));

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

function scaleRgb(a: Rgb, k: number): Rgb {
  return { r: a.r * k, g: a.g * k, b: a.b * k };
}

/**
 * How much overcast and rain together take the sun away, 0..1.
 *
 * Cover begins to count above 0.5 and is total at 0.9 — "overcast" in
 * the brief is cloud > 0.7, which lands at a half here. Rain counts on
 * its own curve (a 2.5 mm/hr drizzle is about 0.46, a 10 mm/hr shower
 * 0.9) because the water model can rain under a sky that has not
 * closed. The two combine as an OR, so neither can lift the other.
 */
export function gloomOf(now: WeatherNow): number {
  const cover = ramp(now.cloud, 0.5, 0.9);
  const rain = 1 - Math.exp(-Math.max(0, now.rainMmHr) / 4);
  return 1 - (1 - cover) * (1 - rain);
}

/** The cloud cross-fade between the two day skies, 0 clear to 1 partly. */
export function cloudMixOf(cloud: number): number {
  return ramp(cloud, PARTLY_FROM_CLOUD, PARTLY_AT_CLOUD);
}

export function skyLook(now: WeatherNow, sun: SunPosition): SkyLook {
  const elevationDeg = sun.elevation / DEG;

  // WHICH SKIES. One chain of fades on elevation; the day's cloud fade
  // ramps in above the last of them so the hand-over is seamless.
  let image: SkyImageId;
  let nextImage: SkyImageId;
  let mix: number;
  if (elevationDeg < DUSK_AT_DEG) {
    image = 'night';
    nextImage = 'dusk';
    mix = ramp(elevationDeg, NIGHT_BELOW_DEG, DUSK_AT_DEG);
  } else if (elevationDeg < DAY_ABOVE_DEG) {
    image = 'dusk';
    nextImage = 'clear';
    mix = ramp(elevationDeg, DUSK_AT_DEG, DAY_ABOVE_DEG);
  } else {
    image = 'clear';
    nextImage = 'partly';
    mix = cloudMixOf(now.cloud) * ramp(elevationDeg, DAY_ABOVE_DEG, CLOUD_FADE_FULL_DEG);
  }

  // THE PALETTE, on the same bands: night below, day above, low sun between.
  const night = 1 - ramp(elevationDeg, NIGHT_BELOW_DEG, DUSK_AT_DEG);
  const day = ramp(elevationDeg, DUSK_AT_DEG, DAY_ABOVE_DEG);
  const low = 1 - night - day;
  const blend = (pick: (p: Palette) => number): number => pick(NIGHT) * night + pick(LOW_SUN) * low + pick(DAY) * day;
  const blendRgb = (pick: (p: Palette) => Rgb): Rgb => {
    const n = pick(NIGHT);
    const l = pick(LOW_SUN);
    const d = pick(DAY);
    return { r: n.r * night + l.r * low + d.r * day, g: n.g * night + l.g * low + d.g * day, b: n.b * night + l.b * low + d.b * day };
  };

  // THE WEATHER ON TOP: diffuse, not dark.
  const gloom = gloomOf(now);
  const sunIntensity = blend((p) => p.sun) * (1 - gloom * (1 - SUN_UNDER_COVER));
  const hemisphereIntensity = blend((p) => p.hemisphere) * (1 + gloom * (HEMISPHERE_UNDER_COVER - 1));
  const sunColour = mixRgb(blendRgb((p) => p.sunColour), SUN_GREY, gloom);
  // The grey ceiling is v0's, scaled to how bright this hour is, so an
  // overcast night is a dark grey and not a lit one. Rain takes the grey
  // down toward the bottom of a shower.
  const brightness = blend((p) => p.hemisphere) / DAY.hemisphere;
  const rainGloom = 1 - Math.exp(-Math.max(0, now.rainMmHr) / 4);
  const grey = scaleRgb(mixRgb(HORIZON_DULL, HORIZON_STORM, rainGloom), brightness);
  const horizon = mixRgb(blendRgb((p) => p.horizon), grey, gloom);

  return {
    image,
    mix,
    nextImage,
    sunAzimuth: sun.azimuth,
    sunElevation: Math.max(LIGHT_FLOOR, sun.elevation),
    sunIntensity,
    sunColour,
    hemisphereSky: horizon,
    hemisphereGround: blendRgb((p) => p.ground),
    hemisphereIntensity,
    fogDensity: FOG_TAIL / Math.max(1, now.visibilityM * M),
    horizon,
    dimming: 1 - DIMMING_UNDER_COVER * gloom,
  };
}

/** How far you can see under a given density, world units — the fit, run backwards. */
export function sightFor(density: number): number {
  return FOG_TAIL / Math.max(1e-12, density);
}
