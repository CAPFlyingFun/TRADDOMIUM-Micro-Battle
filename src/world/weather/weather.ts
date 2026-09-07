/**
 * WHAT THE SKY IS DOING — the one value everything else reads.
 *
 * Joshua, 2026-09-06, opening Phase 4: "I am thinking we should add at
 * least since tied to it the 'rain weather'… and have other weather
 * elements like sunny, cloudy, thunderstorm, wind, hail, hurricane,
 * etc…. Maybe start with sunny, cloudy, and raining for testing."
 *
 * THIS FILE IS THE SEAM AND NOT THE SYSTEM. It exists before either side
 * of it, on purpose: the water solver needs rain in millimetres an hour,
 * the sky needs cloud cover, and a later storm needs wind — and if those
 * three were invented independently by whoever got there first there
 * would be three answers to what the weather is. Phase 0's lesson,
 * written down in CLAUDE.md: contracts land first and serially, leaves
 * come after.
 *
 * IT IS SIZED FOR THE WHOLE LIST, not for the three that ship first.
 * `Sky` gains members; nothing else has to change shape. Hail is rain
 * that stings, a hurricane is wind and rain at once, a thunderstorm adds
 * a strike channel — all of them are more of these numbers rather than
 * new kinds of number. A caller that reads `rainMmHr` keeps working when
 * hail arrives, which is the test of whether a seam was drawn in the
 * right place.
 *
 * RAIN IS A RATE, IN MILLIMETRES AN HOUR, because that is the unit
 * rainfall is measured and forecast in, and because the water solver's
 * catchment feed is a depth per second that has to come from somewhere
 * real. Kauaʻi is the wettest place on earth by some measures —
 * Waiʻaleʻale averages about 11,500 mm a year — so the numbers here have
 * a real island to be checked against rather than being invented.
 *
 * Pure: no three, no DOM, no clock of its own. Somebody else owns time
 * and hands it in; this describes a moment.
 */

/**
 * The sky's headline state.
 *
 * The three that ship first are the three Joshua named for testing. The
 * rest are listed HERE rather than added later so that a `switch` over
 * this type is exhaustive from the start and the compiler names every
 * place a new sky has to be considered — which is the whole benefit of
 * writing the union down before the systems that read it.
 */
export type Sky =
  | 'clear'
  | 'cloudy'
  | 'rain'
  | 'thunderstorm'
  | 'hail'
  | 'hurricane';

/** The three that are BUILT. Anything else is named but not yet driven. */
export const BUILT_SKIES: readonly Sky[] = Object.freeze(['clear', 'cloudy', 'rain']);

/**
 * Whether the game currently implements a sky, as opposed to merely
 * having a name for it.
 *
 * The honesty rule (CLAUDE.md): an unavailable state must never look
 * functional. A weather picker may list `hurricane`; it may not offer it
 * as though selecting it would do something.
 */
export function skyIsBuilt(sky: Sky): boolean {
  return BUILT_SKIES.includes(sky);
}

/** Whether a string names a BUILT sky — the guard the address bar's `?sky=` goes through. */
export function isBuiltSky(name: unknown): name is Sky {
  return typeof name === 'string' && (BUILT_SKIES as readonly string[]).includes(name);
}

/**
 * The weather at one moment, everywhere. One value, read by many.
 *
 * NOT A FORECAST AND NOT A FIELD. Kauaʻi genuinely has different weather
 * on its two sides — the Napali coast is dry while Waiʻaleʻale is in
 * cloud — and a later pass may make this vary with position. It does not
 * yet, and pretending otherwise by taking a `WorldPoint` it ignored
 * would be a lie in the signature. When it does vary, the sampler takes
 * a point and returns this same shape.
 */
export interface WeatherNow {
  readonly sky: Sky;
  /**
   * Rainfall rate in MILLIMETRES AN HOUR. Zero when it is not raining.
   *
   * The water solver's only input from the weather. Real reference
   * points, so the numbers can be argued with: light rain is about 2.5,
   * heavy rain 10, a tropical downpour 50 and up. Kauaʻi's summit
   * averages 11,500 mm a YEAR, which is 1.3 mm/hr sustained — so a
   * number like 10 is a real shower and not a flood.
   */
  readonly rainMmHr: number;
  /**
   * Cloud cover, 0 clear to 1 overcast. Drives the light and the sky
   * colour, and is NOT derived from `sky`: a shower can pass under a
   * mostly-clear sky, and cloud thickens before the first drop falls.
   */
  readonly cloud: number;
  /**
   * Wind, world units per second, as a vector on the ground plane.
   *
   * A vector rather than a speed and a bearing, because everything that
   * reads it — a drifting ant, rain slanting, a later hurricane — wants
   * to add it to a velocity, and every conversion between the two forms
   * is a chance to get the compass backwards. `world/coords` already
   * owns bearings for the one place that shows one to a player.
   */
  readonly windX: number;
  readonly windZ: number;
  /**
   * How far a dark object can be told from the air, in METRES — what a
   * forecast reports as visibility. Drives the fog: v0's rule, carried
   * into Phase 5, is that fog density comes from this number and not
   * from a hand-tuned constant, so a clear day on Kauaʻi shows the
   * twenty-four kilometres of coastline it really shows. 24,000 is the
   * clear-air ceiling the providers report.
   */
  readonly visibilityM: number;
  /**
   * Where this reading came from — the honesty rule (CLAUDE.md) for the
   * HUD: a sky drawn from a simulation may not say it is the island's
   * weather. `live` is a reading fetched this session, `cached` one
   * kept from an earlier one and still young enough to describe the
   * sky, `simulated` the seeded model.
   */
  readonly source: WeatherSourceKind;
}

export type WeatherSourceKind = 'live' | 'cached' | 'simulated';

/** Clear air, as the providers report it: 24 km. */
export const CLEAR_VISIBILITY_M = 24_000;

/**
 * What the air lets you see through when nobody has reported it — the
 * simulated model's visibility. GAME TUNING shaped by the weather it
 * stands in: clear air is the 24 km ceiling, an overcast sky takes it
 * to about 16 km (haze under cloud), and rain closes it as the rate
 * climbs — a 10 mm/hr shower to about 5 km, a 50 mm/hr downpour to
 * under 2 — and never below 500 m, because a game you cannot see is
 * not a weather effect.
 */
export function visibilityFor(rainMmHr: number, cloud: number): number {
  const haze = 1 - 0.33 * Math.min(1, Math.max(0, cloud));
  const rain = 1 / (1 + Math.max(0, rainMmHr) / 2.5);
  return Math.max(500, CLEAR_VISIBILITY_M * haze * rain);
}

/** Fair weather: the state a world starts in and returns to. */
export const FAIR: WeatherNow = Object.freeze({
  sky: 'clear' as Sky,
  rainMmHr: 0,
  cloud: 0.1,
  windX: 0,
  windZ: 0,
  visibilityM: CLEAR_VISIBILITY_M,
  source: 'simulated' as WeatherSourceKind,
});

/**
 * Somewhere to read the weather from, without learning who decides it.
 *
 * The scene holds one of these. Today it is a hand-driven state for
 * testing; tomorrow it is a live feed or a simulation, and nothing that
 * reads weather has to notice.
 */
export interface WeatherSource {
  now(): WeatherNow;
}

/**
 * A rate in millimetres an hour as a DEPTH IN WORLD UNITS PER SECOND,
 * which is what a water solver adds to a cell.
 *
 * One millimetre is a tenth of a world unit (a unit is a centimetre), and
 * an hour is 3,600 seconds. So the conversion is mm/hr x 0.1 / 3600.
 *
 * IT LIVES HERE, WITH THE UNIT IT CONVERTS FROM. The solver should not
 * have to know what a millimetre is, and two copies of this arithmetic
 * would be two answers to how hard it is raining.
 */
export function rainToUnitsPerSecond(mmHr: number): number {
  return Number.isFinite(mmHr) && mmHr > 0 ? (mmHr * 0.1) / 3600 : 0;
}
