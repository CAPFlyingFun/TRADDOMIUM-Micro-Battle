/**
 * THE SKY DOES NOT SNAP — easing what the field reports.
 *
 * Two things make the raw field jump, and one blend handles both.
 *
 * THE REFRESH. Live readings arrive every quarter of an hour. Apply
 * them the instant they land and the sky changes from 30% cloud to 90%
 * between one frame and the next, which no weather has ever done and
 * which reads as a bug.
 *
 * THE WALK. She also moves through the field, and while the field is
 * mathematically continuous, flying fast across a rain boundary still
 * crosses it faster than rain arrives in life.
 *
 * Easing toward the field's answer covers both without knowing which is
 * which: the target simply is "the weather where she is now", and the
 * shown value chases it. When she stands still it converges and the
 * blend is invisible; when a refresh moves the target it takes minutes;
 * when she flies it lags slightly, which is exactly what walking into a
 * shower feels like.
 *
 * EACH VARIABLE HAS ITS OWN PACE, because they do in life. Gusts change
 * in seconds, rain starts over tens of seconds, cloud takes minutes, and
 * the temperature of an ocean-facing island takes far longer than any
 * of them.
 *
 * The maths is `1 - exp(-dt/tau)`, not `dt * rate`, so a phone at 30 fps
 * and a headless probe at 4 fps reach the same place at the same
 * SIMULATED time. The naive form does not, and this project has already
 * shipped one bug where a ceiling turned out to be a property of the
 * device's frame rate rather than of the design.
 */
import type { Conditions } from './conditions';

/** Seconds for each value to close about 63% of a gap. */
export const TAU = {
  temperature: 300,
  humidity: 240,
  rain: 35,
  cloud: 150,
  windSpeed: 40,
  windFrom: 60,
  windGust: 12,
  visibility: 120,
} as const;

function ease(from: number, to: number, tau: number, dt: number): number {
  return from + (to - from) * (1 - Math.exp(-dt / tau));
}

export class WeatherBlend {
  private shown: Conditions | null = null;

  /** What the player is currently in. Null until the first reading. */
  get current(): Conditions | null {
    return this.shown;
  }

  get started(): boolean {
    return this.shown !== null;
  }

  /** Arrive already in it — spawning should not fade the sky in. */
  set(to: Conditions): void {
    this.shown = { ...to };
  }

  /**
   * Move toward `to` by one frame's worth.
   *
   * The first call SETS rather than eases: there is nothing to ease
   * from, and starting at zero would spawn her in a freezing, airless,
   * perfectly clear world that then warmed up over five minutes.
   */
  update(to: Conditions, dt: number): Conditions {
    const from = this.shown;
    if (from === null || dt <= 0) {
      if (from === null) this.set(to);
      return this.shown as Conditions;
    }

    // Direction is eased as a VECTOR. Easing the degrees would send a
    // wind backing from 350° to 10° the long way round the compass,
    // sweeping through south on its way to a twenty-degree shift.
    const fromRad = (from.windFrom * Math.PI) / 180;
    const toRad = (to.windFrom * Math.PI) / 180;
    const k = 1 - Math.exp(-dt / TAU.windFrom);
    const x = Math.sin(fromRad) + (Math.sin(toRad) - Math.sin(fromRad)) * k;
    const y = Math.cos(fromRad) + (Math.cos(toRad) - Math.cos(fromRad)) * k;
    let windFrom = (Math.atan2(x, y) * 180) / Math.PI;
    if (windFrom < 0) windFrom += 360;

    this.shown = {
      temperature: ease(from.temperature, to.temperature, TAU.temperature, dt),
      humidity: ease(from.humidity, to.humidity, TAU.humidity, dt),
      rain: ease(from.rain, to.rain, TAU.rain, dt),
      cloud: ease(from.cloud, to.cloud, TAU.cloud, dt),
      windSpeed: ease(from.windSpeed, to.windSpeed, TAU.windSpeed, dt),
      windFrom,
      windGust: ease(from.windGust, to.windGust, TAU.windGust, dt),
      visibility: ease(from.visibility, to.visibility, TAU.visibility, dt),
      // A label, not a quantity: it changes when it changes.
      code: to.code,
    };
    return this.shown;
  }
}
