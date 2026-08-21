import { describe, expect, it } from 'vitest';
import { WeatherBlend, TAU } from '../src/weather/blend';
import { TYPICAL, type Conditions } from '../src/weather/conditions';

const clear: Conditions = {
  ...TYPICAL, cloud: 5, rain: 0, code: 0, visibility: 24_000, temperature: 28,
};
const storm: Conditions = {
  ...TYPICAL, cloud: 95, rain: 6, code: 95, visibility: 900, temperature: 22,
};

/** Run `seconds` of simulated time at a chosen frame rate. */
function run(blend: WeatherBlend, to: Conditions, seconds: number, fps: number) {
  const dt = 1 / fps;
  for (let t = 0; t < seconds - 1e-9; t += dt) blend.update(to, dt);
  return blend.current as Conditions;
}

describe('easing the weather', () => {
  it('starts in the weather rather than fading into it', () => {
    const blend = new WeatherBlend();
    expect(blend.started).toBe(false);
    const first = blend.update(storm, 1 / 60);
    expect(first.cloud).toBeCloseTo(storm.cloud, 6);
    expect(first.temperature).toBeCloseTo(storm.temperature, 6);
  });

  it('does not snap when the reading changes', () => {
    const blend = new WeatherBlend();
    blend.set(clear);
    const after = blend.update(storm, 1 / 60);
    expect(after.cloud).toBeGreaterThan(clear.cloud);
    expect(after.cloud).toBeLessThan(clear.cloud + 1);
  });

  it('closes about two thirds of the gap in one time constant', () => {
    const blend = new WeatherBlend();
    blend.set(clear);
    const after = run(blend, storm, TAU.cloud, 60);
    const closed = (after.cloud - clear.cloud) / (storm.cloud - clear.cloud);
    expect(closed).toBeGreaterThan(0.60);
    expect(closed).toBeLessThan(0.66);
  });

  it('gets there eventually', () => {
    const blend = new WeatherBlend();
    blend.set(clear);
    const after = run(blend, storm, TAU.cloud * 8, 30);
    expect(after.cloud).toBeCloseTo(storm.cloud, 1);
    expect(after.rain).toBeCloseTo(storm.rain, 2);
    // Relative, because visibility is a number in the thousands and
    // an absolute tolerance on it would be a tolerance on its units.
    expect(Math.abs(after.visibility - storm.visibility) / storm.visibility)
      .toBeLessThan(0.005);
  });

  it('rain arrives sooner than cloud, and warmth last of all', () => {
    expect(TAU.rain).toBeLessThan(TAU.cloud);
    expect(TAU.cloud).toBeLessThan(TAU.temperature);
    expect(TAU.windGust).toBeLessThan(TAU.windSpeed);
  });

  /**
   * The bug this project already shipped once, in the jump ceiling: a
   * per-frame rate makes the answer a property of the DEVICE. Five
   * frame rates, one simulated minute, one weather.
   */
  it('reaches the same weather at every frame rate', () => {
    const reached = [120, 60, 30, 10, 4].map((fps) => {
      const blend = new WeatherBlend();
      blend.set(clear);
      return run(blend, storm, 120, fps).cloud;
    });
    const spread = Math.max(...reached) - Math.min(...reached);
    expect(spread).toBeLessThan(0.5);
  });

  it('backs the wind the short way round the compass', () => {
    const blend = new WeatherBlend();
    blend.set({ ...TYPICAL, windFrom: 350 });
    // Every step of the way from 350 to 10 must stay near north.
    for (let i = 0; i < 600; i += 1) {
      const now = blend.update({ ...TYPICAL, windFrom: 10 }, 1 / 10);
      const offNorth = Math.min(now.windFrom, 360 - now.windFrom);
      expect(offNorth).toBeLessThan(15);
    }
  });

  it('changes the weather code at once, because it is a label', () => {
    const blend = new WeatherBlend();
    blend.set(clear);
    expect(blend.update(storm, 1 / 60).code).toBe(95);
  });

  it('holds still when nothing is changing', () => {
    const blend = new WeatherBlend();
    blend.set(storm);
    const after = run(blend, storm, 600, 60);
    expect(after.cloud).toBeCloseTo(storm.cloud, 6);
    expect(after.windFrom).toBeCloseTo(storm.windFrom, 4);
  });
});
