/**
 * WHAT A STATION REPORTS — the numbers, and the units they are in.
 *
 * Carried from v0 (`src/weather/conditions.ts`, legacy/v0-main), where
 * the rule was: every value here is a REAL-WORLD measurement in metric
 * units, straight from the provider and unmassaged, and nothing in this
 * file has an opinion about the game. The one bridge from these to the
 * game's own `WeatherNow` is `toWeatherNow` in `liveWeather.ts`, so a
 * 20 mph trade wind never reaches an ant as "20" of anything.
 *
 * A PROVIDER IS A TYPE HERE AND A FETCH ELSEWHERE. `world/` is core and
 * reaches no network (tests/simulationCore.test.ts); the thing that
 * asks Open-Meteo lives in `assets/openMeteo.ts` and is handed in as a
 * `WeatherProvider`, the way the survey and the landcover are handed to
 * the world as hooks. A reply is untrusted input: whoever builds a
 * `Conditions` from one coerces every field and fills every gap with
 * `TYPICAL`, so the worst a bad reply can do is make the weather boring.
 */
import type { GeoPoint } from '../geo';

export interface Conditions {
  /** Degrees CELSIUS, two metres up. */
  readonly temperature: number;
  /** Relative humidity, 0–100 PERCENT. */
  readonly humidity: number;
  /**
   * TOTAL precipitation, MILLIMETRES PER HOUR — the authority on whether
   * anything is falling. Open-Meteo splits it three ways (`rain` is the
   * large-scale kind, `showers` the convective kind, `precipitation` the
   * sum including drizzle); v0 once read only `rain` and told the player
   * DRIZZLE and "Rain: none" in one breath. Anything deciding whether a
   * drop is visible reads THIS.
   */
  readonly precipitation: number;
  /** Large-scale rain alone, MILLIMETRES PER HOUR. */
  readonly rain: number;
  /** Convective showers alone, MILLIMETRES PER HOUR. */
  readonly showers: number;
  /** Cloud cover, 0–100 PERCENT. */
  readonly cloud: number;
  /** Wind at ten metres, KILOMETRES PER HOUR. */
  readonly windSpeed: number;
  /**
   * DEGREES the wind comes FROM, clockwise from true north — meteorology's
   * convention, and a classic way to blow the island backwards: a "north
   * wind" arrives from the north and travels south. The one conversion
   * to a direction of travel is `toWeatherNow`'s, and it is tested.
   */
  readonly windFrom: number;
  /** Gusts, KILOMETRES PER HOUR. */
  readonly windGust: number;
  /** How far you can see, METRES. */
  readonly visibility: number;
  /** The WMO weather code the provider reports (0 clear … 95–99 thunderstorm). */
  readonly code: number;
}

/**
 * Somewhere that answers with conditions for a list of places, in the
 * same order. Implemented outside core (`assets/openMeteo.ts`); named
 * `sample` because core may not so much as spell the network's verb.
 */
export interface WeatherProvider {
  readonly id: string;
  sample(points: readonly GeoPoint[]): Promise<readonly Conditions[]>;
}

/** A typical trade-wind afternoon on Kauaʻi: what a missing field falls back to. */
export const TYPICAL: Conditions = Object.freeze({
  temperature: 25,
  humidity: 74,
  precipitation: 0,
  rain: 0,
  showers: 0,
  cloud: 45,
  windSpeed: 20,
  windFrom: 65, // ENE — the trades, which blow here most of the year.
  windGust: 30,
  visibility: 24_000,
  code: 2,
});
