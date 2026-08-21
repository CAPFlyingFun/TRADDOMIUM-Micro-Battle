/**
 * THE WEATHER FIELD — twenty-two readings, and every place between them.
 *
 * Stations are points; the Queen is somewhere else. This turns the
 * sparse readings into a value at ANY global position on the island.
 *
 * NO HARD BORDERS. The obvious method — take the four nearest stations
 * and weight them by inverse distance — has a flaw that is easy to miss
 * and impossible to unsee: the moment a fifth station becomes nearer
 * than the fourth, the set swaps. The two are equidistant at that
 * instant but their readings are not equal, so the answer JUMPS. Walk
 * the island and you would cross a lattice of invisible seams where the
 * rain steps up and down.
 *
 * So the weights taper to nothing instead of being cut off:
 *
 *   w(d) = ((R - d) / (R * d))^2      for d < R,  else 0
 *
 * Shepard's modified form. It still goes to infinity underfoot, so a
 * station's own square metre reads exactly what the station reports,
 * and it reaches zero SMOOTHLY at the cutoff, so a station entering or
 * leaving the calculation contributes nothing at the moment it does.
 * The field is continuous everywhere, which is the property the seams
 * were violating.
 *
 * WIND IS NOT A NUMBER, it is a vector, and averaging its DEGREES is
 * the other classic error: a station at 350° and one at 10° average to
 * 180°, giving a south wind where both stations say north. Direction is
 * therefore blended as components. Speed is blended as a scalar
 * alongside it, because two stations blowing at each other would
 * vector-cancel to a dead calm that neither of them is reporting —
 * opposed winds mean a shifty local breeze, not still air.
 *
 * Everything here is in GLOBAL coordinates. A front does not move
 * because the floating origin did.
 */
import type { WorldPoint } from '../world/coords';
import type { Conditions, WeatherSample, WeatherSource } from './conditions';

/**
 * How far a station's reading carries, in world units — 20 km.
 *
 * Wide enough that anywhere on a 56 km island has several stations in
 * range (they sit 8–10 km apart), narrow enough that the far coast
 * cannot vote on this valley's rain. That contrast is the feature: one
 * side of Kauaʻi sunny while the other side is soaked.
 */
export const REACH = 2_000_000;

/** Closer than this to a station and it simply IS the station. */
const UNDERFOOT = 100; // one metre

export class WeatherField {
  constructor(
    readonly samples: readonly WeatherSample[],
    readonly source: WeatherSource,
    /** Epoch milliseconds the readings were taken. */
    readonly taken: number,
  ) {}

  get empty(): boolean {
    return this.samples.length === 0;
  }

  /** The conditions at a GLOBAL position. */
  at(point: WorldPoint): Conditions {
    if (this.samples.length === 0) {
      throw new Error('weather field has no samples');
    }

    let total = 0;
    let temperature = 0;
    let humidity = 0;
    let rain = 0;
    let cloud = 0;
    let windSpeed = 0;
    let windGust = 0;
    let visibility = 0;
    let windX = 0;
    let windY = 0;

    // The nearest station wins the weather CODE, which is a label and
    // cannot be averaged: halfway between clear and thunderstorm is
    // not a real forecast.
    let nearest = this.samples[0];
    let nearestApart = Infinity;
    let inRange = 0;

    for (const sample of this.samples) {
      const apart = Math.hypot(
        point.wx - sample.at.wx,
        point.wz - sample.at.wz,
      );
      if (apart < nearestApart) {
        nearestApart = apart;
        nearest = sample;
      }
      if (apart <= UNDERFOOT) return sample.conditions;
      if (apart >= REACH) continue;

      const taper = (REACH - apart) / (REACH * apart);
      const weight = taper * taper;
      inRange += 1;
      total += weight;

      const c = sample.conditions;
      temperature += c.temperature * weight;
      humidity += c.humidity * weight;
      rain += c.rain * weight;
      cloud += c.cloud * weight;
      windSpeed += c.windSpeed * weight;
      windGust += c.windGust * weight;
      visibility += c.visibility * weight;

      const radians = (c.windFrom * Math.PI) / 180;
      windX += Math.sin(radians) * weight;
      windY += Math.cos(radians) * weight;
    }

    // Out past every station — she has flown well offshore. The nearest
    // coast's weather is the honest answer, and it keeps the field
    // total rather than leaving a hole in it.
    if (inRange === 0 || total === 0) return nearest.conditions;

    let windFrom = (Math.atan2(windX, windY) * 180) / Math.PI;
    if (windFrom < 0) windFrom += 360;

    return {
      temperature: temperature / total,
      humidity: humidity / total,
      rain: rain / total,
      cloud: cloud / total,
      windSpeed: windSpeed / total,
      windFrom,
      windGust: windGust / total,
      visibility: visibility / total,
      code: nearest.conditions.code,
    };
  }

  /** How old the readings are, in seconds, against a supplied clock. */
  ageSeconds(now: number): number {
    return Math.max(0, (now - this.taken) / 1000);
  }
}
