/**
 * THE WEATHER FIELD — twenty-two readings, and every place between them.
 *
 * Joshua, 2026-09-07, opening Phase 5: "real weather synced." The island
 * is asked at twenty-two places (`stations.ts`); the ant is somewhere
 * else. This turns the sparse readings into a value at ANY world
 * position, and it is the reason the game can say the sky over Poʻipū
 * is the sky over Poʻipū rather than the sky over Līhuʻe airport.
 *
 * NO HARD BORDERS — v0's rule, carried whole. The obvious method, the
 * four nearest stations weighted by inverse distance, has a flaw that is
 * easy to miss and impossible to unsee: the moment a fifth station
 * becomes nearer than the fourth, the set swaps. The two are equidistant
 * at that instant but their readings are not equal, so the answer
 * JUMPS. Walk the island and you cross a lattice of invisible seams
 * where the rain steps up and down. So every station within reach
 * contributes, and the weights taper to nothing instead of being cut:
 *
 *   w(d) = ((R - d) / (R * d))^2      for d < R,  else 0
 *
 * Shepard's modified form. It still goes to infinity underfoot, so a
 * station's own square metre reads exactly what the station reports,
 * and it reaches zero SMOOTHLY at the cutoff, so a station entering or
 * leaving the sum contributes nothing at the moment it does. The field
 * is continuous everywhere, which is the property the seams violated.
 *
 * WIND IS NOT A NUMBER, it is a vector, and averaging its DEGREES is
 * the other classic error: a station at 350° and one at 10° average to
 * 180°, a south wind where both stations say north. Wind is therefore
 * blended as a VELOCITY — speed and bearing made into components,
 * summed, and turned back into a speed and a bearing at the end.
 *
 * That is one step further than v0 went, and deliberately. v0 blended
 * direction as a unit vector but kept speed as a scalar, on the argument
 * that two stations blowing at each other should read as a shifty
 * breeze rather than a calm. In v1 the thing that reads the wind is a
 * VELOCITY on an ant (`WeatherNow.windX/windZ`), and the field's own
 * promise is that a place between two stations is between their
 * readings — for a vector, that is the mean vector, and opposed winds
 * do cancel between them. A shifty breeze is a gust model's job, and
 * the gust figure is still carried as a scalar for the day one exists.
 *
 * THE WMO CODE IS A LABEL, not a quantity, and cannot be averaged:
 * halfway between clear and thunderstorm is not a forecast. The nearest
 * station's code wins.
 *
 * Everything here is in WORLD coordinates. A front does not move because
 * the floating origin did. Pure: no three, no DOM, no clock — the
 * readings are handed in, already taken.
 */
import type { WorldPoint } from '../coords';
import { TYPICAL, type Conditions } from './conditions';
import type { Station } from './stations';

/**
 * How far a station's reading carries, in world units — 20 km.
 *
 * v0's number. Wide enough that anywhere on a 56 km island has several
 * stations in range (they sit 8–10 km apart), narrow enough that the far
 * coast cannot vote on this valley's rain. That contrast is the feature:
 * one side of Kauaʻi sunny while the other is soaked.
 */
export const REACH = 2_000_000;

/** Closer than this to a station and it simply IS the station: one metre. */
export const UNDERFOOT = 100;

/** One station and what it last reported. */
export interface StationReading {
  readonly station: Station;
  readonly conditions: Conditions;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export class WeatherField {
  constructor(readonly readings: readonly StationReading[]) {}

  /**
   * Pair a station list with a provider's reply, IN ORDER. A reply
   * shorter than the list is a partial field, not an error; a longer one
   * is truncated. Matching by position is the provider's contract
   * (`WeatherProvider.sample` answers "in the same order").
   */
  static of(stations: readonly Station[], conditions: readonly Conditions[]): WeatherField {
    const n = Math.min(stations.length, conditions.length);
    const readings: StationReading[] = [];
    for (let i = 0; i < n; i += 1) readings.push({ station: stations[i], conditions: conditions[i] });
    return new WeatherField(readings);
  }

  get empty(): boolean {
    return this.readings.length === 0;
  }

  /**
   * The conditions at a WORLD position.
   *
   * A field with nothing in it answers `TYPICAL` rather than throwing —
   * the rule set in `conditions.ts` is that the worst bad weather data
   * can do is make the weather boring. `LiveWeather` never builds an
   * empty field, so this is a floor, not a path.
   */
  at(point: WorldPoint): Conditions {
    const readings = this.readings;
    if (readings.length === 0) return TYPICAL;

    let total = 0;
    let temperature = 0;
    let humidity = 0;
    let precipitation = 0;
    let rain = 0;
    let showers = 0;
    let cloud = 0;
    let windGust = 0;
    let visibility = 0;
    // The wind as a velocity in the METEOROLOGICAL frame: components of
    // the direction it comes FROM, scaled by speed, km/h. No world axis
    // is named here on purpose — the one conversion to the ground plane
    // is `toWeatherNow`'s, and it is pinned against the stations.
    let fromX = 0;
    let fromY = 0;

    let nearest = readings[0];
    let nearestApart = Infinity;
    let inRange = 0;

    for (const reading of readings) {
      const at = reading.station.at;
      const apart = Math.hypot(point.wx - at.wx, point.wz - at.wz);
      if (apart < nearestApart) {
        nearestApart = apart;
        nearest = reading;
      }
      if (apart <= UNDERFOOT) return reading.conditions;
      if (apart >= REACH) continue;

      const taper = (REACH - apart) / (REACH * apart);
      const weight = taper * taper;
      inRange += 1;
      total += weight;

      const c = reading.conditions;
      temperature += c.temperature * weight;
      humidity += c.humidity * weight;
      precipitation += c.precipitation * weight;
      rain += c.rain * weight;
      showers += c.showers * weight;
      cloud += c.cloud * weight;
      windGust += c.windGust * weight;
      visibility += c.visibility * weight;

      const from = c.windFrom * DEG_TO_RAD;
      fromX += Math.sin(from) * c.windSpeed * weight;
      fromY += Math.cos(from) * c.windSpeed * weight;
    }

    // Out past every station — well offshore. The nearest coast's
    // weather is the honest answer, and it keeps the field total rather
    // than leaving a hole in it.
    if (inRange === 0 || total === 0) return nearest.conditions;

    const meanFromX = fromX / total;
    const meanFromY = fromY / total;
    const windSpeed = Math.hypot(meanFromX, meanFromY);
    // Into [0, 360) the robust way: `if (x < 0) x += 360` hands back
    // exactly 360 for a -1e-15, which a test found on the first run.
    const windFrom = (((Math.atan2(meanFromX, meanFromY) * RAD_TO_DEG) % 360) + 360) % 360;

    return Object.freeze({
      temperature: temperature / total,
      humidity: humidity / total,
      precipitation: precipitation / total,
      rain: rain / total,
      showers: showers / total,
      cloud: cloud / total,
      windSpeed,
      windFrom,
      windGust: windGust / total,
      visibility: visibility / total,
      code: nearest.conditions.code,
    });
  }
}
