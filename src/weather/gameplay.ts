/**
 * THE ONE BRIDGE — real meteorology in, safe game numbers out.
 *
 * This file is a wall, and it is here on purpose. Everything upstream
 * is the real atmosphere in real units. Everything downstream is the
 * game. Nothing may cross without passing through here.
 *
 * Why it matters more than usual for this game: the Queen is five and a
 * half millimetres long. A perfectly ordinary Kauaʻi trade wind is
 * 20 mph. Hand that number to a physics system that thinks in her body
 * lengths and she is doing nine metres a second sideways — a hundred
 * and sixty of herself every second, permanently, in fair weather. The
 * only sane arrangement is that raw values never reach her at all: the
 * game sees `windStrength: 0.64`, a dimensionless dial someone can tune
 * by feel on a phone, and the fact that it came from 20 mph is the
 * provider's business.
 *
 * Weather v1 is mostly LOOK. These numbers drive the sky, the light,
 * the rain and how far she can see. Any influence on how she moves
 * should stay mild until there is a reason for it to be otherwise.
 */
import { UNITS_PER_METRE } from '../world/kauai';
import type { Conditions } from './conditions';

/**
 * THE SMALLEST PRECIPITATION A WET WMO CODE MAY IMPLY, in mm/h.
 *
 * The panel said DRIZZLE and, underneath it, "Rain: none", with nothing
 * falling. Both halves were honest: the code genuinely was drizzle, and
 * drizzle genuinely is not counted as rain. The contradiction was in
 * showing them together.
 *
 * Reading the TOTAL precipitation fixes almost all of it. What is left
 * is that a real drizzle can still round to 0.0 mm/h at the provider,
 * and can be interpolated toward zero between stations — so the code
 * says wet and the number says nothing at all. Where that happens the
 * description wins by a hair: just enough falling to be seen, and no
 * more.
 *
 * These are NOT invented rainfall. A drizzle floor of 0.08 mm/h is
 * below what most gauges resolve, which is exactly why the provider
 * reported zero. The point is only that the world must never say one
 * thing and show another.
 */
const CODE_FLOOR: ReadonlyArray<{ from: number; floor: number }> = [
  { from: 95, floor: 1.2 }, // thunderstorm
  { from: 80, floor: 0.5 }, // showers
  { from: 71, floor: 0.3 }, // snow
  { from: 61, floor: 0.4 }, // rain
  { from: 51, floor: 0.08 }, // drizzle
];

/**
 * THE ONE THRESHOLD FOR "IS ANYTHING FALLING", in mm/h.
 *
 * Shared by the words and by the drops, and it has to be, because the
 * bug this whole section exists to fix is those two answering
 * differently. A test sweeps every code against every intensity and
 * checks that a wet description and a visible drop always agree; it
 * failed the first time round, on a hundredth of a millimetre under a
 * fog code — words dry, drops falling. One constant, both readers.
 */
export const VISIBLE_PRECIP = 0.05;

/** The least that can be falling, given what the code claims. */
export function floorFor(code: number): number {
  for (const band of CODE_FLOOR) if (code >= band.from) return band.floor;
  return 0;
}

/**
 * What is VISIBLY falling — the number the drops are drawn from.
 *
 * Two directions, both needed. A wet code with no measurable total is
 * lifted to its floor, so drizzle drizzles. A measurable total under a
 * dry code is left alone and believed, so rain that is actually
 * falling is drawn whatever a stale code says about it.
 */
export function fallingNow(now: Conditions): number {
  const falling = Math.max(Math.max(0, now.precipitation), floorFor(now.code));
  return falling < VISIBLE_PRECIP ? 0 : falling;
}

export interface GameWeather {
  /** 0–1. A dial, not a speed. Nothing may treat this as km/h. */
  readonly windStrength: number;
  /** 0–1, the peaks rather than the average. */
  readonly gustStrength: number;
  /**
   * WORLD RADIANS, the direction the wind BLOWS TOWARD — a heading in
   * the same convention as hers, so `(sin h, cos h)` is its travel.
   */
  readonly windHeading: number;
  /** 0–1. Particle density and the sound of it. */
  readonly rainfall: number;
  /** What is visibly falling, MILLIMETRES PER HOUR, after reconciling. */
  readonly precipitation: number;
  /** 0–1. */
  readonly cloudiness: number;
  /** 0–1. How much the light is taken out of the day. */
  readonly gloom: number;
  /** WORLD UNITS she can see. Drives the fog and nothing else. */
  readonly sight: number;
  /** 0–1 across the range this island actually offers. */
  readonly warmth: number;
  /** 0–1. Humidity and rain together; the wet-ground feel later. */
  readonly damp: number;
  /**
   * THE WIND AS A PHYSICAL VELOCITY, metres per second.
   *
   * Separate from `windStrength` on purpose and not a replacement for
   * it. The dial is for looks — how hard the rain slants, how much the
   * grass would bend. This is for arithmetic, and it has units.
   */
  readonly windMps: number;
  /**
   * The same wind as a WORLD VELOCITY, units per second, pointing the
   * way the air is travelling.
   *
   * One world unit is a centimetre, so this is the m/s figure times a
   * hundred. It is added to her AIR velocity to get her velocity over
   * the ground, which is the whole of the wind model:
   *
   *   ground = air + wind
   *
   * and it is why a queen at full power into a stronger wind flies
   * forwards through the air while travelling backwards over Kauaʻi.
   */
  readonly windVelocity: { readonly x: number; readonly z: number };
}

/**
 * The wind speed that reads as "full", in km/h.
 *
 * GAME TUNING, not a measurement. Fifty puts a 20 mph trade wind — the
 * island's ordinary afternoon — at about two-thirds of the dial, and
 * leaves headroom for the genuinely rough days without ever pinning.
 */
export const WIND_FULL = 50;

/** Rain that reads as "full", in mm/h. A hard tropical shower. */
export const RAIN_FULL = 8;

/** The coldest and warmest this island gets, in °C. */
const COLD = 15;
const HOT = 32;

/**
 * How far she can see, at the extremes, in world units.
 *
 * The floor is not zero: whiteout is a weather effect, being unable to
 * see your own feet is a broken game. The ceiling is a clear day's
 * 24 km, which is most of the way across Kauaʻi and lets the mountains
 * and the coastline do their job as landmarks.
 */
const SIGHT_MIN = 60 * UNITS_PER_METRE;
const SIGHT_MAX = 24_000 * UNITS_PER_METRE;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * A compass bearing to a world heading.
 *
 * North is −Z and east is +X, while a bearing counts clockwise from
 * north; a heading `h` travels along `(sin h, cos h)`. Those reconcile
 * to `h = π − bearing`, which is worth deriving once here rather than
 * guessing a sign in four places. (It also means a wind's travel
 * heading is simply the negative of the direction it came from, but the
 * derivation is the part that survives someone changing a convention.)
 */
export function headingFromBearing(degrees: number): number {
  const bearing = (degrees * Math.PI) / 180;
  let heading = Math.PI - bearing;
  while (heading > Math.PI) heading -= Math.PI * 2;
  while (heading < -Math.PI) heading += Math.PI * 2;
  return heading;
}

export function toGameWeather(now: Conditions): GameWeather {
  const precipitation = fallingNow(now);
  const rainfall = clamp01(Math.sqrt(precipitation / RAIN_FULL));
  const cloudiness = clamp01(now.cloud / 100);
  const windHeading = headingFromBearing(now.windFrom + 180);
  const windMps = Math.max(0, now.windSpeed) / 3.6;
  const windUnits = windMps * UNITS_PER_METRE;

  return {
    windStrength: clamp01(now.windSpeed / WIND_FULL),
    gustStrength: clamp01(now.windGust / WIND_FULL),
    // Wind blows AWAY from where it came from — a "north wind" travels
    // south. Half a turn, and the reason this is spelled out rather
    // than folded into the maths is that getting it wrong blows the
    // whole island backwards in a way nobody notices for weeks.
    windHeading,
    windMps,
    // A heading travels along (sin, cos) in this world, same convention
    // as hers, so the wind vector is built the same way her own is.
    windVelocity: {
      x: Math.sin(windHeading) * windUnits,
      z: Math.cos(windHeading) * windUnits,
    },
    rainfall,
    precipitation,
    cloudiness,
    // Overcast takes most of the light; rain takes a little more. It
    // never reaches 1: this is a dimmer, and a game you cannot see is
    // not a weather effect.
    gloom: clamp01(cloudiness * 0.72 + rainfall * 0.22),
    sight: Math.max(
      SIGHT_MIN,
      Math.min(SIGHT_MAX, Math.max(0, now.visibility) * UNITS_PER_METRE),
    ),
    warmth: clamp01((now.temperature - COLD) / (HOT - COLD)),
    damp: clamp01(Math.max((now.humidity - 40) / 60, rainfall)),
  };
}

/**
 * What to CALL the weather, given both halves.
 *
 * The code is the better describer when it has anything to say, since
 * it distinguishes drizzle from rain from a squall. But a code can be
 * stale or dry while water is measurably falling, and "Clear" over
 * visible rain is the same contradiction the other way round — so
 * precipitation gets the last word on whether it is wet at all.
 */
export function describeWeather(code: number, precipitation: number): string {
  if (floorFor(code) > 0 || precipitation < VISIBLE_PRECIP) return describe(code);
  return precipitation >= 2.5 ? 'Rain'
    : precipitation >= 0.5 ? 'Light rain' : 'Drizzle';
}

/** Metres per second, which is the unit flight arithmetic wants. */
export function mps(kmh: number): number {
  return kmh / 3.6;
}

/** WMO present-weather code to something a player can read. */
export function describe(code: number): string {
  if (code >= 95) return 'Thunderstorms';
  if (code >= 80) return 'Showers';
  if (code >= 71) return 'Snow'; // Waiʻaleʻale, once in a lifetime.
  if (code >= 61) return 'Rain';
  if (code >= 51) return 'Drizzle';
  if (code >= 45) return 'Fog';
  if (code === 3) return 'Overcast';
  if (code === 2) return 'Partly cloudy';
  if (code === 1) return 'Mostly clear';
  return 'Clear';
}

/** The glyph, reconciled the same way the description is. */
export function glyphFor(code: number, precipitation: number): string {
  if (floorFor(code) > 0 || precipitation < VISIBLE_PRECIP) return glyph(code);
  return precipitation >= 0.5 ? '🌧️' : '🌦️';
}

/** The little glyph the HUD chip wears. */
export function glyph(code: number): string {
  if (code >= 95) return '⛈️';
  if (code >= 80) return '🌦️';
  if (code >= 51) return '🌧️';
  if (code >= 45) return '🌫️';
  if (code === 3) return '☁️';
  if (code >= 1) return '🌤️';
  return '☀️';
}

/** Because Joshua reads the weather in Fahrenheit and miles per hour. */
export function fahrenheit(celsius: number): number {
  return celsius * 1.8 + 32;
}

export function mph(kmh: number): number {
  return kmh / 1.609344;
}

/** ENE, SSW — the eight-and-a-halfth of a compass people actually say. */
export function compass(degrees: number): string {
  const points = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ];
  const index = Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16;
  return points[index];
}
