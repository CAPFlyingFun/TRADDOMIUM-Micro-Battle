/**
 * THE SKY DOES NOT SNAP — easing what the field reports.
 *
 * Two things make the raw field jump, and one blend handles both. v0's
 * reasoning, carried whole into Phase 5 ("real weather synced").
 *
 * THE REFRESH. Live readings arrive every twelve minutes
 * (`liveWeather.ts`). Apply them the instant they land and the sky
 * changes from 30% cloud to 90% between one frame and the next, which
 * no weather has ever done and which reads as a bug.
 *
 * THE WALK. The ant also moves through the field, and while the field
 * is mathematically continuous (`field.ts`), crossing a rain boundary at
 * speed still crosses it faster than rain arrives in life.
 *
 * Easing toward the field's answer covers both without knowing which is
 * which: the target simply is "the weather where she is now", and the
 * shown value chases it. Standing still it converges and the blend is
 * invisible; when a refresh moves the target it takes minutes; when she
 * moves fast it lags slightly, which is what walking into a shower
 * feels like.
 *
 * EACH VARIABLE HAS ITS OWN PACE, because they do in life. Gusts change
 * in seconds, rain starts over tens of seconds, cloud takes minutes, and
 * the temperature of an ocean-facing island takes longer than any of
 * them. The table is v0's, untouched.
 *
 * IT RUNS ON SIMULATION SECONDS, NOT THE WALL CLOCK. The maths is
 * `1 - exp(-dt/tau)`, not `dt * rate`, so a phone at 30 fps and the
 * headless probe at a frame and a half a second reach the same place at
 * the same SIMULATED time — and a paused game, handing in a dt of zero,
 * freezes the sky where it is. The naive form does not, and this
 * project has already shipped one bug where a ceiling turned out to be
 * a property of the device's frame rate rather than of the design.
 *
 * THE WIND'S DIRECTION IS EASED AS AN ANGLE ALONG THE SHORTEST ARC, and
 * that is the one place this departs from v0. v0 eased the direction's
 * unit vector by components and read the angle back with `atan2`, to
 * keep a wind backing from 350° to 10° from sweeping through south.
 * That does go the short way — but lerping components and re-reading
 * the angle is not the solution of any linear equation in the angle, so
 * sixty steps of a second and one step of a minute land in different
 * places. MEASURED at 0.09° apart over one minute, on the first run of
 * the test that asks for identity. Easing the angle itself, with the
 * gap first wrapped into (-180°, 180°], is exactly additive across
 * steps AND takes the short way, so it keeps v0's reason and gains the
 * frame-rate independence the rest of the table already had.
 *
 * Pure: no three, no DOM, no clock. `advance(dt)` is handed its time.
 */
import { TYPICAL, type Conditions } from './conditions';

/**
 * Seconds for each value to close about 63% of a gap. v0's numbers.
 * GAME TUNING shaped by how fast each thing changes in life, not a
 * measurement of anything.
 */
export const TAU = Object.freeze({
  temperature: 300,
  humidity: 240,
  rain: 35,
  cloud: 150,
  windSpeed: 40,
  windFrom: 60,
  windGust: 12,
  visibility: 120,
});

function ease(from: number, to: number, tau: number, dt: number): number {
  return from + (to - from) * (1 - Math.exp(-dt / tau));
}

/** Degrees into [0, 360), robustly: `if (x < 0) x += 360` gives 360 for a -1e-15. */
function wrap360(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** The signed short-way gap from one bearing to another, in (-180, 180]. */
function shortestArc(from: number, to: number): number {
  const gap = wrap360(to - from);
  return gap > 180 ? gap - 360 : gap;
}

export class WeatherBlend {
  private shown: Conditions | null = null;
  private wanted: Conditions | null = null;

  /** What the player is currently in. Null until the first `aim` or `set`. */
  get current(): Conditions | null {
    return this.shown;
  }

  /** Where the shown value is heading. Null until the first `aim` or `set`. */
  get target(): Conditions | null {
    return this.wanted;
  }

  get started(): boolean {
    return this.shown !== null;
  }

  /** Arrive already in it — spawning should not fade the sky in. */
  set(to: Conditions): void {
    this.shown = Object.freeze({ ...to });
    this.wanted = this.shown;
  }

  /**
   * Point the blend at new conditions; `advance` chases them.
   *
   * The first aim SETS rather than eases: there is nothing to ease
   * from, and starting at zero would spawn her in a freezing, airless,
   * perfectly clear world that then warmed up over five minutes.
   */
  aim(to: Conditions): void {
    if (this.shown === null) {
      this.set(to);
      return;
    }
    this.wanted = Object.freeze({ ...to });
  }

  /**
   * Move the shown value toward the target by `dt` SIMULATED seconds and
   * return it.
   *
   * A `dt` that is zero, negative or not a number passes no time — a
   * paused game hands in zero and the sky must hold. Before anything has
   * been aimed at there is nothing to show; `TYPICAL` is returned and the
   * blend stays unstarted, so the first real aim still arrives in place.
   */
  advance(dt: number): Conditions {
    const from = this.shown;
    const to = this.wanted;
    if (from === null || to === null) return TYPICAL;
    if (!Number.isFinite(dt) || dt <= 0) return from;

    // Direction is eased along the SHORTEST ARC. Easing the raw degrees
    // would send a wind backing from 350° to 10° the long way round the
    // compass, sweeping through south on its way to a twenty-degree
    // shift; wrapping the gap first keeps it a twenty-degree shift.
    const windFrom = wrap360(ease(0, shortestArc(from.windFrom, to.windFrom), TAU.windFrom, dt) + from.windFrom);

    this.shown = Object.freeze({
      temperature: ease(from.temperature, to.temperature, TAU.temperature, dt),
      humidity: ease(from.humidity, to.humidity, TAU.humidity, dt),
      // All three precipitation figures move on the rain clock: they
      // are the same weather counted three ways and must not drift out
      // of step with one another.
      precipitation: ease(from.precipitation, to.precipitation, TAU.rain, dt),
      rain: ease(from.rain, to.rain, TAU.rain, dt),
      showers: ease(from.showers, to.showers, TAU.rain, dt),
      cloud: ease(from.cloud, to.cloud, TAU.cloud, dt),
      windSpeed: ease(from.windSpeed, to.windSpeed, TAU.windSpeed, dt),
      windFrom,
      windGust: ease(from.windGust, to.windGust, TAU.windGust, dt),
      visibility: ease(from.visibility, to.visibility, TAU.visibility, dt),
      // A label, not a quantity: it changes when it changes.
      code: to.code,
    });
    return this.shown;
  }
}
