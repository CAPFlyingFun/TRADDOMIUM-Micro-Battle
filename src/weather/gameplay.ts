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
  const rainfall = clamp01(Math.sqrt(Math.max(0, now.rain) / RAIN_FULL));
  const cloudiness = clamp01(now.cloud / 100);

  return {
    windStrength: clamp01(now.windSpeed / WIND_FULL),
    gustStrength: clamp01(now.windGust / WIND_FULL),
    // Wind blows AWAY from where it came from — a "north wind" travels
    // south. Half a turn, and the reason this is spelled out rather
    // than folded into the maths is that getting it wrong blows the
    // whole island backwards in a way nobody notices for weeks.
    windHeading: headingFromBearing(now.windFrom + 180),
    rainfall,
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
