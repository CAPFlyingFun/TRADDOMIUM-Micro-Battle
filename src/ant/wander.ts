/**
 * SHE DOES NOT HOLD A PERFECTLY FIXED ALTITUDE, because nothing does.
 *
 * Powered flight eases her vertical rate to exactly zero, which is a
 * clean model and a dead one: an autopilot holding a cruise altitude
 * still breathes a few feet, and an insect in real air — thermals off a
 * sunlit rock, the wake of a leaf, her own wingbeat — breathes rather
 * more than that in proportion to her size. Joshua asked for it and he
 * is right that it belongs.
 *
 * IT IS A DISTURBANCE, NOT A DRIFT. The distinction is the whole design
 * of this file. A random walk added to her rate would integrate into an
 * unbounded altitude error: leave her alone for a minute and she is
 * somewhere else vertically, which is a bug wearing realism's coat.
 * What this returns is the EXACT DERIVATIVE of a bounded function, so
 * her altitude is that function plus a constant and cannot leave the
 * band no matter how long she flies.
 *
 *   offset(t) = A · Σ wᵢ sin(2π t / Tᵢ + φᵢ)      with Σ wᵢ = 1
 *   rate(t)   = A · Σ wᵢ (2π / Tᵢ) cos(2π t / Tᵢ + φᵢ)
 *
 * Sines rather than the Perlin noise Joshua suggested for exactly that
 * reason: value noise differentiated by finite difference is bounded
 * only approximately and only if you are careful about the step, and
 * three incommensurate periods already read as unpatterned over any
 * span a player watches. The periods share no small common multiple, so
 * the sum does not repeat for hours.
 *
 * Deterministic — no `Math.random`, fixed phases — so a test can state
 * the bound and a probe replays the same air twice.
 */

/**
 * How far she may wander, world units. Three millimetres, Joshua's
 * number, and it holds up at both ends of the scale it has to serve:
 * against a thirteen-metre cruise it is invisible, which is correct,
 * and against a queen two centimetres long hovering a hand's breadth
 * off the soil it is a visible, gentle bob.
 */
export const WANDER = 0.3;

/**
 * Slow on purpose.
 *
 * The peak RATE is the amplitude times the weighted mean angular
 * frequency, so short periods here would show up as a twitching
 * vertical-speed readout rather than as motion. At these three the peak
 * is about 0.26 units a second — a VSI breathing a quarter of a
 * centimetre a second, which is what a calm day looks like.
 */
const WAVES = [
  { period: 5.5, weight: 0.5, phase: 0.0 },
  { period: 8.7, weight: 0.3, phase: 2.4 },
  { period: 14.3, weight: 0.2, phase: 4.1 },
] as const;

/** The largest rate this can ever return, for tests and for tuning. */
export const WANDER_RATE = WANDER * WAVES.reduce(
  (sum, wave) => sum + (wave.weight * 2 * Math.PI) / wave.period, 0,
);

export class Wander {
  private clock = 0;

  constructor(private readonly amplitude = WANDER) {}

  /** Advance the air and report her vertical rate from it. */
  advance(dt: number): number {
    this.clock += Math.max(0, dt);
    return this.rate;
  }

  /** The rate right now, world units per second. */
  get rate(): number {
    let sum = 0;
    for (const wave of WAVES) {
      const turn = (2 * Math.PI) / wave.period;
      sum += wave.weight * turn * Math.cos(turn * this.clock + wave.phase);
    }
    return this.amplitude * sum;
  }

  /**
   * How far off her held altitude the air has carried her — the
   * integral of `rate`, in closed form rather than accumulated, which
   * is why it is provably inside ±amplitude.
   */
  get offset(): number {
    let sum = 0;
    for (const wave of WAVES) {
      const turn = (2 * Math.PI) / wave.period;
      sum += wave.weight * Math.sin(turn * this.clock + wave.phase);
    }
    return this.amplitude * sum;
  }

  /** A fresh flight starts in fresh air. */
  reset(): void {
    this.clock = 0;
  }
}
