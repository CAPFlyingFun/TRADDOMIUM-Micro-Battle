/**
 * THE WEATHER HAS TO BE THE SAME WEATHER TWICE.
 *
 * `SkyModel` is a stochastic process, and the whole reason it is seeded
 * rather than random is that this project debugs from photographs of a
 * phone. So the first test here is not about rain at all: it is that the
 * same seed and the same dts give byte-identical weather, forever. If
 * that assertion ever fails, a screenshot stops being evidence.
 *
 * THE REST ARE INVARIANTS, NOT SNAPSHOTS. Nothing below pins a
 * particular shower at a particular second — that would fail on every
 * tuning change and teach the next agent to update the expected numbers
 * rather than to think. What they pin is the set of promises the module
 * makes to everything downstream:
 *
 *   - rain never falls out of a sky that is not raining
 *   - rain is never negative, never NaN, for ANY dt a caller can name
 *   - cloud is a 0..1 number
 *   - the cloud thickens BEFORE the first drop
 *   - rain ramps; it does not switch on
 *   - a forced sky is honoured, is released, and costs the world's own
 *     weather nothing while it is held
 *   - a sky the game has not built is never produced and cannot be forced
 *
 * AND ONE THAT IS A SNAPSHOT OF THE REAL ISLAND, on purpose: the rain
 * the model DELIVERS over a simulated year has to add up to what the
 * Rainfall Atlas measured at the dial it was set to. That is the test
 * that stops the shower tuning drifting into fiction — the peaks, the
 * durations, the gate and the taus can all be re-tuned, but if the year
 * stops matching Kauaʻi the model has stopped modelling Kauaʻi.
 *
 * Everything runs on plain arithmetic with no clock and no canvas, which
 * is what `src/world/` being core buys.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILT_SKIES,
  rainToUnitsPerSecond,
  skyIsBuilt,
  type Sky,
  type WeatherNow,
} from '../src/world/weather/weather';
import {
  CLOUDY_FLOOR,
  DEFAULT_SEED,
  KAUAI_MM_YEAR,
  KMH_TO_UNITS_PER_SECOND,
  LEE_MM_YEAR,
  RAIN_CLOUD_FLOOR,
  RAIN_VISIBLE_MM_HR,
  SkyModel,
  SUMMIT_MM_YEAR,
  meanRainForWetness,
  wetnessForAnnualMm,
} from '../src/world/weather/skyModel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOUR_S = 3600;
const DAY_S = 24 * HOUR_S;
/** 365.25 x 24, the same year the model divides the atlas by. */
const YEAR_HOURS = 8766;

const SUMMIT = wetnessForAnnualMm(KAUAI_MM_YEAR.waialeale);
const LIHUE = wetnessForAnnualMm(KAUAI_MM_YEAR.lihue);
const KEKAHA = wetnessForAnnualMm(KAUAI_MM_YEAR.kekaha);

/**
 * A varied but perfectly repeatable dt sequence, in seconds.
 *
 * Varied because a model that is only ever stepped by exactly 1/60 s can
 * hide a frame-rate dependence; repeatable because the determinism test
 * has to hand both models the SAME irregular clock or it is testing
 * nothing.
 */
function jitteredDt(i: number): number {
  return 0.008 + ((i * 7919) % 97) / 1000;
}

/** Walk a model at a fixed dt and hand every reading to `visit`. */
function run(model: SkyModel, steps: number, dt: number, visit: (now: WeatherNow) => void): void {
  for (let i = 0; i < steps; i += 1) visit(model.advance(dt));
}

/**
 * The mean rainfall the model actually delivers over `hours`, mm/hr.
 *
 * Sampled every two simulated minutes, which is fair for a process whose
 * episodes are ten minutes long, and cheap enough to run a whole year in
 * a unit test.
 */
function deliveredMeanMmHr(model: SkyModel, hours: number): number {
  const dt = 120;
  const steps = Math.round((hours * HOUR_S) / dt);
  let total = 0;
  for (let i = 0; i < steps; i += 1) total += model.advance(dt).rainMmHr;
  return total / steps;
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('the same seed is the same weather', () => {
  it('gives two models the identical sequence over thousands of irregular steps', () => {
    // If this fails, a seed in a bug report means nothing, a save cannot
    // reproduce the sky it was taken under, and two players in one room
    // are standing in two different storms.
    const a = new SkyModel({ seed: 7, wetness: SUMMIT });
    const b = new SkyModel({ seed: 7, wetness: SUMMIT });

    for (let i = 0; i < 20_000; i += 1) {
      const dt = jitteredDt(i);
      expect(a.advance(dt)).toEqual(b.advance(dt));
    }
  });

  it('gives different seeds different weather', () => {
    // The other half: if this passed with identical output the seed
    // would be decorative and every world would have the same year.
    const a = new SkyModel({ seed: 1, wetness: SUMMIT });
    const b = new SkyModel({ seed: 2, wetness: SUMMIT });

    let differed = false;
    for (let i = 0; i < 5_000 && !differed; i += 1) {
      const left = a.advance(60);
      const right = b.advance(60);
      if (left.rainMmHr !== right.rainMmHr || left.cloud !== right.cloud) differed = true;
    }
    expect(differed).toBe(true);
  });

  it('reaches the same weather whether stepped once or thirty times', () => {
    // FRAME-RATE INDEPENDENCE, which is why the easing is
    // `1 - exp(-dt/tau)` and not `dt * rate`. A phone at 60 fps and the
    // headless probe at 1.5 fps must be in the same weather at the same
    // SIMULATED time; if they are not, every per-second number
    // downstream is a property of the device, and this project has
    // shipped that bug before.
    //
    // IT WAS NOT ALWAYS THIS CLOSE, and the history is the point of the
    // test. Before `advance` clipped its slices to episode boundaries,
    // this same measurement read 0.65 of cloud apart at the worst
    // moment — a whole slice out of phase during a build, which is a
    // blue sky on one machine and an overcast one on the other at the
    // same simulated second. The easing formula alone did not save it;
    // not straddling a boundary did.
    let cloudDrift = 0;
    let rainDrift = 0;
    let peakRain = 0;

    for (const seed of [11, 12]) {
      const coarse = new SkyModel({ seed, wetness: LIHUE });
      const fine = new SkyModel({ seed, wetness: LIHUE });
      // Twelve simulated hours a seed, sampled every thirty seconds.
      for (let i = 0; i < 1_440; i += 1) {
        coarse.advance(30);
        for (let k = 0; k < 30; k += 1) fine.advance(1);
        cloudDrift = Math.max(cloudDrift, Math.abs(coarse.now().cloud - fine.now().cloud));
        rainDrift = Math.max(rainDrift, Math.abs(coarse.now().rainMmHr - fine.now().rainMmHr));
        peakRain = Math.max(peakRain, coarse.now().rainMmHr, fine.now().rainMmHr);
      }
    }

    // Cloud is IDENTICAL, not merely close: a shower's cloud target does
    // not move across its episode, and `1 - exp(-dt/tau)` is the exact
    // solution for a target that does not move, so slicing the same span
    // differently cannot change where it lands. MEASURED at 4.8e-15,
    // which is what adding the same seconds in a different order costs.
    expect(cloudDrift).toBeLessThan(1e-9);

    // Rain does move across an episode — that is what a passing shower
    // IS — so sampling its raised cosine 30 s apart instead of 1 s apart
    // is a real difference. MEASURED at 0.54 mm/hr against peaks of 20,
    // and the bound is a twentieth of the peak the run actually saw.
    expect(peakRain).toBeGreaterThan(1);
    expect(rainDrift).toBeLessThan(0.05 * peakRain);
  });
});

// ---------------------------------------------------------------------------
// The promises made to everything downstream
// ---------------------------------------------------------------------------

describe('rain and the sky agree', () => {
  it('never reports rain under a sky that is not raining', () => {
    // The brief's own line. A renderer that draws drops when `sky` says
    // rain, and a solver that integrates `rainMmHr`, would otherwise
    // disagree about whether it is raining — which is the two-answers
    // disease this whole phase is arranged against.
    for (const wetness of [SUMMIT, LIHUE, KEKAHA]) {
      const model = new SkyModel({ seed: 42, wetness });
      run(model, 20_000, 60, (now) => {
        if (now.rainMmHr > 0) expect(now.sky).toBe('rain');
        if (now.sky === 'rain') expect(now.rainMmHr).toBeGreaterThan(0);
      });
    }
  });

  it('never lets rain fall out of a sky thinner than broken cover', () => {
    // The cloud gate, stated as an invariant. If this fails, rain is
    // arriving from a blue sky and the light will not match the drops.
    const model = new SkyModel({ seed: 3, wetness: SUMMIT });
    run(model, 20_000, 45, (now) => {
      if (now.rainMmHr > 0) expect(now.cloud).toBeGreaterThanOrEqual(RAIN_CLOUD_FLOOR);
    });
  });

  it('calls a thick sky cloudy and a thin one clear', () => {
    // `sky` is derived from `cloud` every frame rather than latched, so
    // the label can never disagree with the number the renderer reads.
    const model = new SkyModel({ seed: 5, wetness: LIHUE });
    run(model, 20_000, 60, (now) => {
      if (now.sky === 'clear') expect(now.cloud).toBeLessThan(CLOUDY_FLOOR);
      if (now.sky === 'cloudy') expect(now.cloud).toBeGreaterThanOrEqual(CLOUDY_FLOOR);
    });
  });
});

describe('the numbers stay numbers', () => {
  it('keeps rain finite and non-negative for every dt a caller can name', () => {
    // Including the ones a caller should not: a background tab resumed
    // after an hour, a clock read as milliseconds, a NaN out of a
    // division nobody checked. None of them may produce a NaN depth for
    // the water solver to integrate forever.
    const absurd = [
      0, -0, -1, -1e9, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
      1e-12, 1e-3, 1 / 60, 1, 60, DAY_S, 365 * DAY_S, 1e300, Number.MAX_VALUE,
    ];
    const model = new SkyModel({ seed: 9, wetness: SUMMIT });

    for (const dt of absurd) {
      const now = model.advance(dt);
      expect(Number.isFinite(now.rainMmHr)).toBe(true);
      expect(now.rainMmHr).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(now.cloud)).toBe(true);
      expect(Number.isFinite(now.windX)).toBe(true);
      expect(Number.isFinite(now.windZ)).toBe(true);
      // And the contract's own converter, since this is what the water
      // solver actually adds to a cell.
      const perSecond = rainToUnitsPerSecond(now.rainMmHr);
      expect(Number.isFinite(perSecond)).toBe(true);
      expect(perSecond).toBeGreaterThanOrEqual(0);
    }
  });

  it('passes no time at all on a zero, negative or non-numeric dt', () => {
    // A clock that stands still or runs backwards is a bug upstream, and
    // rewinding the weather to hide it would cost the replay guarantee.
    const model = new SkyModel({ seed: 13, wetness: LIHUE });
    model.advance(500);
    const before = model.now();
    for (const dt of [0, -1, -1e6, Number.NaN]) expect(model.advance(dt)).toEqual(before);
    expect(model.now()).toEqual(before);
  });

  it('keeps cloud inside 0..1 across a simulated month', () => {
    // Everything that lights the world multiplies by this. A cloud of
    // 1.4 is a negative sun somewhere downstream.
    for (const wetness of [0, KEKAHA, LIHUE, SUMMIT, 1]) {
      const model = new SkyModel({ seed: 21, wetness });
      run(model, 30 * 24 * 2, 1800, (now) => {
        expect(now.cloud).toBeGreaterThanOrEqual(0);
        expect(now.cloud).toBeLessThanOrEqual(1);
      });
    }
  });
});

describe('weather moves like weather', () => {
  it('thickens the cloud before the first drop falls', () => {
    // The brief's line, and the difference between a sky and a switch.
    // Both halves are tested: the cloud is already broken when the rain
    // arrives, and it was measurably thinner a few minutes earlier.
    const model = new SkyModel({ seed: 77, wetness: LIHUE });
    const dt = 10;
    let cloudFiveMinutesAgo = model.now().cloud;
    const history: number[] = [];
    let found = false;

    for (let i = 0; i < 40_000 && !found; i += 1) {
      const now = model.advance(dt);
      history.push(now.cloud);
      if (history.length > 30) history.shift();
      if (now.rainMmHr > 0) {
        cloudFiveMinutesAgo = history[0];
        expect(now.cloud).toBeGreaterThanOrEqual(RAIN_CLOUD_FLOOR);
        expect(now.cloud - cloudFiveMinutesAgo).toBeGreaterThan(0.02);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('ramps the rain instead of switching it on', () => {
    // A step change is a bucket being tipped: the water solver
    // integrates this rate into a DEPTH, so an instantaneous 40 mm/hr is
    // a wall of water arriving in one frame with nothing upstream of it.
    //
    // ASKED AS A FRACTION OF THE PEAK, not as an absolute rate, because
    // the question is whether the rain STEPS, and a step is 100% of the
    // peak in one second whatever the peak happens to be. An absolute
    // bound would instead be policing the tuning, and would have to be
    // rewritten every time a shower got heavier.
    //
    // MEASURED at three dials, 200,000 one-second steps each: the worst
    // one-second change is 1.16% of the heaviest rain in the same run at
    // the summit, 0.85% at Līhuʻe, 1.03% at Kekaha — call it a minute and
    // a half of building, at the steepest instant of the steepest
    // shower. The bound is 5%, which a real step clears by twentyfold.
    for (const wetness of [SUMMIT, LIHUE, KEKAHA]) {
      const model = new SkyModel({ seed: 31, wetness });
      let previous = model.now().rainMmHr;
      let worst = 0;
      let peak = 0;

      run(model, 200_000, 1, (now) => {
        worst = Math.max(worst, Math.abs(now.rainMmHr - previous));
        peak = Math.max(peak, now.rainMmHr);
        previous = now.rainMmHr;
      });

      // Not vacuous: the run has to have seen genuinely heavy rain, or a
      // ratio against its peak proves nothing.
      expect(peak).toBeGreaterThan(RAIN_VISIBLE_MM_HR * 100);
      expect(worst).toBeLessThan(0.05 * peak);
    }
  });

  it('clears, clouds over and rains within a day on the windward side', () => {
    // Weather that never changes is a backdrop. This asks for all three
    // built skies out of one seeded day, and for the rain to both start
    // and stop — a shower that never ends is v0's sine model, which
    // leaves the tap running into the solver forever.
    const model = new SkyModel({ seed: 4, wetness: LIHUE });
    const seen = new Set<Sky>();
    let started = 0;
    let stopped = 0;
    let wasRaining = false;

    run(model, DAY_S / 10, 10, (now) => {
      seen.add(now.sky);
      const raining = now.rainMmHr > 0;
      if (raining && !wasRaining) started += 1;
      if (!raining && wasRaining) stopped += 1;
      wasRaining = raining;
    });

    expect([...seen].sort()).toEqual(['clear', 'cloudy', 'rain']);
    expect(started).toBeGreaterThan(0);
    expect(stopped).toBeGreaterThan(0);
  });

  it('blows from the ENE, at trade-wind speeds, without ever sweeping the compass', () => {
    // The trades come FROM about 65 degrees, so they travel WSW: -x
    // always, and the sign never flips. A wind eased as an ANGLE rather
    // than as a vector would swing the long way round the compass on a
    // wander across north and show up here as a positive windX.
    const model = new SkyModel({ seed: 8, wetness: LIHUE });
    run(model, 20_000, 30, (now) => {
      expect(now.windX).toBeLessThan(0);
      const speed = Math.hypot(now.windX, now.windZ);
      // 8 to 45 km/h in world units a second: calm trades to a squall.
      expect(speed).toBeGreaterThan(8 * KMH_TO_UNITS_PER_SECOND);
      expect(speed).toBeLessThan(45 * KMH_TO_UNITS_PER_SECOND);
    });
  });
});

// ---------------------------------------------------------------------------
// The override
// ---------------------------------------------------------------------------

describe('forcing a sky', () => {
  it('honours a forced sky and reports that it is forced', () => {
    // The dev-tool half: ask for rain on the dry coast and get rain.
    const model = new SkyModel({ seed: 6, wetness: KEKAHA });
    expect(model.forcedSky).toBeNull();
    expect(model.force('rain')).toBe(true);
    expect(model.forcedSky).toBe('rain');

    // It RAMPS, so it is not raining the instant the button is pressed —
    // that is the point, not a defect. Ten minutes is weather time.
    run(model, 60, 10, () => {});
    expect(model.now().sky).toBe('rain');
    expect(model.now().rainMmHr).toBeGreaterThan(RAIN_VISIBLE_MM_HR);

    expect(model.force('clear')).toBe(true);
    run(model, 60, 10, () => {});
    expect(model.now().sky).toBe('clear');
    expect(model.now().rainMmHr).toBe(0);
  });

  it('holds a forced cloudy sky at a cover that cannot rain', () => {
    // A held sky must MEAN what it says. Forced `cloudy` sits under the
    // rain gate on purpose: without that, a shower already falling would
    // keep falling for a minute or two after the sky was pinned, and the
    // reading would say `rain` while the override said `cloudy` — the
    // override looking broken in exactly the way an honest label must
    // not.
    const model = new SkyModel({ seed: 17, wetness: SUMMIT });
    // Get it raining naturally first, so there is something to contradict.
    let raining = false;
    for (let i = 0; i < 40_000 && !raining; i += 1) raining = model.advance(10).rainMmHr > 0;
    expect(raining).toBe(true);

    expect(model.force('cloudy')).toBe(true);
    run(model, 120, 10, () => {});
    expect(model.now().sky).toBe('cloudy');
    expect(model.now().rainMmHr).toBe(0);
    expect(model.now().cloud).toBeGreaterThanOrEqual(CLOUDY_FLOOR);
    expect(model.now().cloud).toBeLessThan(RAIN_CLOUD_FLOOR);
  });

  it('releases, and the world it was hiding is exactly where it would have been', () => {
    // The reason this is an OVERRIDE and not a setting: the seeded
    // weather never stopped underneath. A twin that was never touched
    // and one that was held clear through a storm converge once the
    // override is dropped — so holding the sky costs the schedule
    // nothing, and a dev tool cannot silently rewrite a world's year.
    const held = new SkyModel({ seed: 99, wetness: SUMMIT });
    const twin = new SkyModel({ seed: 99, wetness: SUMMIT });

    held.force('clear');
    for (let i = 0; i < 600; i += 1) {
      held.advance(10);
      twin.advance(10);
    }
    held.release();
    expect(held.forcedSky).toBeNull();

    // Three hours to shed the difference: the slowest channel closes
    // 63% of a gap every three minutes.
    for (let i = 0; i < 1_080; i += 1) {
      held.advance(10);
      twin.advance(10);
    }

    expect(held.now().cloud).toBeCloseTo(twin.now().cloud, 9);
    expect(held.now().rainMmHr).toBeCloseTo(twin.now().rainMmHr, 9);
    expect(held.now().sky).toBe(twin.now().sky);
  });

  it('refuses a sky the game has not built, and says so', () => {
    // The honesty rule, at the one door a caller could break it through.
    // `hail` is a name in a union so a switch is exhaustive; honouring
    // it would be the model producing weather that does not exist.
    const model = new SkyModel({ seed: 2, wetness: LIHUE });
    for (const sky of ['thunderstorm', 'hail', 'hurricane'] as const) {
      expect(skyIsBuilt(sky)).toBe(false);
      expect(model.force(sky)).toBe(false);
      expect(model.forcedSky).toBeNull();
    }
    run(model, 2_000, 60, (now) => {
      expect(BUILT_SKIES).toContain(now.sky);
    });
  });

  it('leaves an existing override alone when an unbuilt sky is refused', () => {
    // A refusal must not be a release. If it were, a weather picker with
    // a hurricane button would quietly cancel the rain the developer had
    // asked for and look like the rain stopping by itself.
    const model = new SkyModel({ seed: 2, wetness: LIHUE });
    model.force('rain');
    expect(model.force('hurricane')).toBe(false);
    expect(model.forcedSky).toBe('rain');
  });
});

describe('the model only ever produces skies the game has built', () => {
  it('reports one of the three, at every dial, across a simulated month', () => {
    // If a fourth ever appears here it arrived without a renderer, a
    // sound or a water response, and the honesty rule is broken by the
    // model itself rather than by a caller.
    for (const wetness of [0, KEKAHA, LIHUE, SUMMIT, 1]) {
      const model = new SkyModel({ seed: 1234, wetness });
      run(model, 30 * 24 * 4, 900, (now) => {
        expect(skyIsBuilt(now.sky)).toBe(true);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// The island it is a model OF
// ---------------------------------------------------------------------------

describe('the dial is the Rainfall Atlas', () => {
  it('places the real places where their annual totals put them', () => {
    // If this drifts, `KAUAI_MM_YEAR` and the dial have stopped meaning
    // the same thing and every tuning argument below loses its footing.
    expect(wetnessForAnnualMm(SUMMIT_MM_YEAR)).toBeCloseTo(1, 12);
    expect(wetnessForAnnualMm(LEE_MM_YEAR)).toBeCloseTo(0, 12);
    expect(LIHUE).toBeGreaterThan(0.25);
    expect(LIHUE).toBeLessThan(0.35);
    // Log, not linear: linear would bury Līhuʻe at 0.07 and squash the
    // whole inhabited island into the bottom of the dial.
    expect(LIHUE).toBeGreaterThan((KAUAI_MM_YEAR.lihue - LEE_MM_YEAR) / (SUMMIT_MM_YEAR - LEE_MM_YEAR) * 3);
    // Nonsense in, the dry end out, rather than a NaN into the duty cycle.
    expect(wetnessForAnnualMm(Number.NaN)).toBe(0);
    expect(wetnessForAnnualMm(-5)).toBe(0);
    expect(wetnessForAnnualMm(1e9)).toBe(1);
  });

  it('delivers Waiʻaleʻale a year of Waiʻaleʻale rain', () => {
    // THE TEST THAT KEEPS THE TUNING HONEST. Peaks, durations, the gate
    // and the taus are all free to change; what may not change is that a
    // simulated year at the summit dial adds up to the 11,500 mm the
    // Rainfall Atlas measured there. Fail this and the model has stopped
    // being a model of Kauaʻi.
    const model = new SkyModel({ seed: DEFAULT_SEED, wetness: SUMMIT });
    const delivered = deliveredMeanMmHr(model, YEAR_HOURS);
    const wanted = meanRainForWetness(SUMMIT);

    expect(delivered / wanted).toBeGreaterThan(0.85);
    expect(delivered / wanted).toBeLessThan(1.15);
    // And in the units a person can check against the atlas.
    expect(delivered * YEAR_HOURS).toBeGreaterThan(0.85 * SUMMIT_MM_YEAR);
    expect(delivered * YEAR_HOURS).toBeLessThan(1.15 * SUMMIT_MM_YEAR);
  });

  it('leaves the lee coast dry', () => {
    // The other end of the gradient, and the reason the dial exists: the
    // same model, twenty-five kilometres downwind, must produce a
    // twenty-third of the rain. A model that could not do this would be
    // one weather for a whole island with two climates.
    const model = new SkyModel({ seed: DEFAULT_SEED, wetness: KEKAHA });
    const delivered = deliveredMeanMmHr(model, YEAR_HOURS);
    const wanted = meanRainForWetness(KEKAHA);

    expect(delivered / wanted).toBeGreaterThan(0.8);
    expect(delivered / wanted).toBeLessThan(1.2);
    expect(delivered).toBeLessThan(meanRainForWetness(SUMMIT) / 10);
  });
});
