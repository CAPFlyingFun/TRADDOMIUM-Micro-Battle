/**
 * WHAT THE WEATHER IS — the numbers, and the units they are in.
 *
 * One record, used everywhere: what a station reports, what the field
 * interpolates, what the blend eases toward, what the cache stores.
 * Every value here is REAL-WORLD measurement in metric SI-ish units,
 * straight from the provider and unmassaged. Nothing in this file has
 * an opinion about the game.
 *
 * That separation is deliberate and it is the whole architecture: real
 * data lives in `Conditions`, gameplay lives in `GameWeather`, and
 * `gameplay.ts` is the only bridge between them. A 20 mph trade wind
 * must never reach the Queen as "20" of anything, because she is five
 * and a half millimetres long and would be in the next valley.
 */
import type { GeoPoint } from '../world/geo';
import type { WorldPoint } from '../world/coords';

export interface Conditions {
  /** Degrees CELSIUS, two metres up. */
  readonly temperature: number;
  /** Relative humidity, 0–100 PERCENT. */
  readonly humidity: number;
  /** Rainfall, MILLIMETRES PER HOUR. */
  readonly rain: number;
  /** Cloud cover, 0–100 PERCENT. */
  readonly cloud: number;
  /** Wind at ten metres, KILOMETRES PER HOUR. */
  readonly windSpeed: number;
  /**
   * DEGREES the wind comes FROM, clockwise from true north.
   *
   * Meteorology's convention, and a classic way to get the world
   * blowing backwards: a "north wind" arrives from the north and
   * travels south. The one conversion to a direction of TRAVEL lives in
   * `gameplay.ts` and is tested there.
   */
  readonly windFrom: number;
  /** Gusts, KILOMETRES PER HOUR. */
  readonly windGust: number;
  /** How far you can see, METRES. */
  readonly visibility: number;
  /**
   * WMO present-weather code — 0 clear, 3 overcast, 61 rain, 95 storm.
   *
   * The one value here that is a LABEL rather than a quantity, which
   * is why interpolation cannot average it and takes the nearest
   * station's instead.
   */
  readonly code: number;
}

/** One station's reading, tied to a real place and a world location. */
export interface WeatherSample {
  readonly id: string;
  readonly name: string;
  readonly where: GeoPoint;
  /** GLOBAL. Where this reading belongs on the island, forever. */
  readonly at: WorldPoint;
  readonly conditions: Conditions;
}

/** Where a field's numbers came from. The player is told which. */
export type WeatherSource = 'live' | 'cached' | 'simulated';

/**
 * Somewhere weather can be fetched from.
 *
 * Open-Meteo is the only implementation today. The interface exists so
 * that a NOAA station feed or a radar provider can be added later
 * without the field, the blend, the HUD or the spawn map noticing.
 */
export interface WeatherProvider {
  readonly id: string;
  fetch(points: readonly GeoPoint[]): Promise<readonly Conditions[]>;
}

/** A plausible warm, damp, breezy Kauaʻi afternoon. Used as a floor. */
export const TYPICAL: Conditions = {
  temperature: 25,
  humidity: 74,
  rain: 0,
  cloud: 45,
  windSpeed: 20,
  windFrom: 65, // ENE — the trades, which blow here most of the year.
  windGust: 30,
  visibility: 24_000,
  code: 2,
};
