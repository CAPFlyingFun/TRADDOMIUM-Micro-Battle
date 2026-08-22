import { describe, expect, it } from 'vitest';
import {
  DIRECTION_ROW, FULL_WIND_METRES, LiveWind, PICK_SECONDS, SPEED_ROW,
  VEER_DEGREES, noise2, windProfile,
} from '../src/weather/windField';
import { UNITS_PER_METRE } from '../src/world/kauai';

const M = UNITS_PER_METRE;

/** A roll that never gusts, so ordinary air can be measured on its own. */
const calm = () => 1;
/** A roll that always gusts. */
const gusty = () => 0;

/** Run the wind for `seconds` at a fixed frame rate, collecting samples. */
function run(
  wind: LiveWind, seconds: number, fps: number, sustained: number, gust: number,
): { speedMps: number; veerDegrees: number }[] {
  const dt = 1 / fps;
  const out = [];
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    out.push({ ...wind.update(sustained, gust, dt) });
  }
  return out;
}

describe('the wind profile with height', () => {
  it('leaves the ground alone', () => {
    // The whole point. A queen standing in the grass is in still air,
    // and so is one who has just cleared it by a millimetre.
    expect(windProfile(0)).toBe(0);
    expect(windProfile(0.01)).toBeLessThan(0.0001);
  });

  it('gives half the wind at five metres, all of it at ten', () => {
    expect(windProfile(5 * M)).toBeCloseTo(0.5, 6);
    expect(windProfile(FULL_WIND_METRES * M)).toBe(1);
  });

  it('never gives more than the reported wind, however high she gets', () => {
    expect(windProfile(50 * M)).toBe(1);
    expect(windProfile(1e9)).toBe(1);
  });

  it('only ever increases with height', () => {
    let last = -1;
    for (let cm = 0; cm <= 1200 * 100; cm += 137) {
      const now = windProfile(cm);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it('treats a negative height as the ground', () => {
    expect(windProfile(-500)).toBe(0);
  });
});

describe('the noise the model runs on', () => {
  it('stays inside its nominal range', () => {
    for (let i = 0; i < 2000; i++) {
      const n = noise2(i * 0.137, 100);
      expect(Math.abs(n)).toBeLessThanOrEqual(1);
    }
  });

  it('is smooth — no jumps between neighbouring samples', () => {
    let prev = noise2(0, 0);
    for (let x = 0.01; x < 40; x += 0.01) {
      const now = noise2(x, 0);
      expect(Math.abs(now - prev)).toBeLessThan(0.06);
      prev = now;
    }
  });

  it('is degenerate on the whole-number rows, which is why they are not used', () => {
    // Worth pinning rather than just avoiding. On an integer row the
    // vertical fade is zero, so the field collapses to a slice through
    // the gradients' x-components alone — and a quarter of those are
    // zero, so the row reads exactly 0 across whole cells and two
    // different rows agree far more often than two signals should.
    let same = 0;
    for (let i = 0; i < 200; i++) {
      const x = i * 0.2;
      if (Math.abs(noise2(x, 0) - noise2(x, 100)) < 1e-6) same++;
    }
    expect(same).toBeGreaterThan(20);
  });

  it('is zero at every lattice point — the trap this model had to dodge', () => {
    for (let i = 0; i < 50; i++) expect(Math.abs(noise2(i, 100))).toBe(0);
  });

  it('is not the same wave on the two rows the model actually reads', () => {
    // Speed and direction must not move in lockstep, or every gust
    // would veer exactly the same way and it would read as one signal.
    let same = 0;
    for (let i = 0; i < 400; i++) {
      const x = i * 0.137;
      if (Math.abs(noise2(x, SPEED_ROW) - noise2(x, DIRECTION_ROW)) < 1e-6) same++;
    }
    expect(same).toBe(0);
  });
});

describe('the live wind', () => {
  it('starts at the reported speed rather than jumping to a target', () => {
    const wind = new LiveWind(calm);
    const first = wind.update(5, 8, 1 / 60);
    expect(first.speedMps).toBeCloseTo(5, 1);
    expect(Math.abs(first.veerDegrees)).toBeLessThan(0.5);
  });

  it('stays inside the band the two reported numbers define', () => {
    // Half the sustained at the floor, a tenth over the gust at the
    // ceiling. Nothing the model does may leave it.
    for (const roll of [calm, gusty, Math.random]) {
      const wind = new LiveWind(roll);
      for (const s of run(wind, 600, 30, 6, 11)) {
        expect(s.speedMps).toBeGreaterThanOrEqual(6 * 0.5 - 1e-9);
        expect(s.speedMps).toBeLessThanOrEqual(11 * 1.1 + 1e-9);
      }
    }
  });

  it('spends most of its time near the reported sustained speed', () => {
    // The bias exponent's whole job. A 6-gusting-11 day must not read
    // as a steady 8.5, which is what unbiased noise in the band gives.
    const wind = new LiveWind(calm);
    const samples = run(wind, 1200, 20, 6, 11);
    const near = samples.filter((s) => Math.abs(s.speedMps - 6) < 2).length;
    expect(near / samples.length).toBeGreaterThan(0.6);
  });

  it('does not report a windier day than the station did', () => {
    // THE reason ordinary air is centred rather than spread across the
    // whole band. A sustained speed is an average; simulate it and the
    // average has to come back. StormTracker's lopsided band returns
    // 7.11 for a reported 6 before gusts are even counted — fine for a
    // needle, a fifth too much force on a queen.
    const wind = new LiveWind(Math.random);
    const samples = run(wind, 1800, 20, 6, 11);
    const mean = samples.reduce((a, s) => a + s.speedMps, 0) / samples.length;
    // Gusts legitimately lift it a little above the sustained figure.
    expect(mean).toBeGreaterThan(6);
    expect(mean).toBeLessThan(6.8);
  });

  it('keeps the average honest at every wind speed', () => {
    for (const [sustained, gust] of [[2, 4], [6, 11], [14, 22], [25, 40]]) {
      const samples = run(new LiveWind(Math.random), 3000, 10, sustained, gust);
      const mean = samples.reduce((a, s) => a + s.speedMps, 0) / samples.length;
      expect(mean / sustained).toBeGreaterThan(0.98);
      expect(mean / sustained).toBeLessThan(1.15);
    }
  });

  it('reaches the gust when the gust roll comes up, and not otherwise', () => {
    const near = (roll: () => number) => {
      const top = Math.max(...run(new LiveWind(roll), 120, 20, 6, 11)
        .map((s) => s.speedMps));
      return top;
    };
    // Always gusting: the air gets up to the gust figure and past it.
    expect(near(gusty)).toBeGreaterThan(11);
    // Never gusting: it does not.
    expect(near(calm)).toBeLessThan(11);
  });

  it('holds still on a day with no wind at all', () => {
    const wind = new LiveWind(Math.random);
    for (const s of run(wind, 120, 30, 0, 0)) {
      expect(s.speedMps).toBe(0);
    }
  });

  it('treats a day with no reported gust as simply steady', () => {
    // No gust reported means gust equals sustained, so the band is
    // ordinary air alone — 3..9, symmetric about the reported 6.
    const wind = new LiveWind(calm);
    const samples = run(wind, 300, 20, 6, 6);
    for (const s of samples) {
      expect(s.speedMps).toBeGreaterThanOrEqual(3 - 1e-9);
      expect(s.speedMps).toBeLessThanOrEqual(9 + 1e-9);
    }
    // And it does actually move, rather than sitting on the number.
    const spread = Math.max(...samples.map((s) => s.speedMps))
      - Math.min(...samples.map((s) => s.speedMps));
    expect(spread).toBeGreaterThan(0.2);
  });

  it('veers within its stated bound, both ways', () => {
    const wind = new LiveWind(calm);
    const samples = run(wind, 1200, 20, 6, 11);
    const veers = samples.map((s) => s.veerDegrees);
    for (const v of veers) expect(Math.abs(v)).toBeLessThanOrEqual(VEER_DEGREES);
    // It wanders both sides of the reported bearing rather than
    // drifting off in one direction forever.
    expect(Math.min(...veers)).toBeLessThan(-0.5);
    expect(Math.max(...veers)).toBeGreaterThan(0.5);
  });

  it('never jumps — the air eases between targets', () => {
    const wind = new LiveWind(gusty);
    const dt = 1 / 60;
    let prev = wind.update(6, 11, dt).speedMps;
    for (let i = 0; i < 60 * 300; i++) {
      const now = wind.update(6, 11, dt).speedMps;
      // A whole band crossed in five seconds is 1.2 m/s per frame at
      // 60fps; anything near that is a step, not a gust.
      expect(Math.abs(now - prev)).toBeLessThan(0.1);
      prev = now;
    }
  });

  it('runs at the same pace whatever the frame rate', () => {
    // Two instances, same simulated time, wildly different frame
    // budgets. A phone dropping to 20fps must not get a different day.
    const fast = run(new LiveWind(calm), 200, 120, 6, 11);
    const slow = run(new LiveWind(calm), 200, 15, 6, 11);
    expect(fast[fast.length - 1].speedMps)
      .toBeCloseTo(slow[slow.length - 1].speedMps, 2);
    expect(fast[fast.length - 1].veerDegrees)
      .toBeCloseTo(slow[slow.length - 1].veerDegrees, 2);
  });

  it('picks a new target every five seconds', () => {
    // Measured rather than asserted from the constant: count the
    // moments the speed changes direction over a long calm run and
    // check they are spaced like the pick interval, not faster.
    const seconds = 600;
    const samples = run(new LiveWind(calm), seconds, 20, 6, 11);
    let turns = 0;
    for (let i = 2; i < samples.length; i++) {
      const a = samples[i - 1].speedMps - samples[i - 2].speedMps;
      const b = samples[i].speedMps - samples[i - 1].speedMps;
      if (a > 0 !== b > 0 && Math.abs(a) > 1e-6 && Math.abs(b) > 1e-6) turns++;
    }
    // At most one reversal per pick, and rather fewer in practice
    // because consecutive targets often continue the same way.
    expect(turns).toBeLessThanOrEqual(seconds / PICK_SECONDS);
    expect(turns).toBeGreaterThan(5);
  });

  it('eases on from where it is when a fresh observation arrives', () => {
    // A METAR refresh is not allowed to be visible as a step.
    const wind = new LiveWind(calm);
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 7; i++) wind.update(6, 11, dt);
    const before = wind.sample.speedMps;
    const after = wind.update(14, 22, dt).speedMps;
    expect(Math.abs(after - before)).toBeLessThan(0.1);
  });

  it('does get to the new weather, given a little time', () => {
    const wind = new LiveWind(calm);
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 30; i++) wind.update(6, 11, dt);
    for (let i = 0; i < 60 * 60; i++) wind.update(20, 26, dt);
    expect(wind.sample.speedMps).toBeGreaterThan(11);
  });

  it('survives a long spell in the background without hanging', () => {
    const wind = new LiveWind(Math.random);
    wind.update(6, 11, 1 / 60);
    const started = Date.now();
    const s = wind.update(6, 11, 3600);
    expect(Date.now() - started).toBeLessThan(200);
    expect(s.speedMps).toBeGreaterThanOrEqual(3);
    expect(s.speedMps).toBeLessThanOrEqual(11 * 1.1);
  });

  it('ignores a negative frame time rather than running backwards', () => {
    const wind = new LiveWind(calm);
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 3; i++) wind.update(6, 11, dt);
    const held = wind.update(6, 11, -5).speedMps;
    expect(held).toBeCloseTo(wind.sample.speedMps, 10);
  });

  it('goes back to still air on reset', () => {
    const wind = new LiveWind(calm);
    for (let i = 0; i < 600; i++) wind.update(6, 11, 1 / 60);
    wind.reset();
    expect(wind.sample.speedMps).toBe(0);
    // And starts again from the reported speed, not mid-gust.
    expect(wind.update(6, 11, 1 / 60).speedMps).toBeCloseTo(6, 1);
  });
});

describe('height and breath together', () => {
  it('is still air at her feet however hard it is blowing aloft', () => {
    const wind = new LiveWind(gusty);
    for (let i = 0; i < 600; i++) wind.update(12, 20, 1 / 60);
    expect(wind.sample.speedMps * windProfile(0)).toBe(0);
  });

  it('gives a queen a metre up a small fraction of a gale', () => {
    const wind = new LiveWind(gusty);
    for (let i = 0; i < 600; i++) wind.update(12, 20, 1 / 60);
    const felt = wind.sample.speedMps * windProfile(1 * M);
    expect(felt).toBeLessThan(1);
    expect(felt).toBeGreaterThan(0);
  });
});
