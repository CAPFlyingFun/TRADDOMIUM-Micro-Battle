/**
 * The stress test's arithmetic, played out under node against a
 * pretend phone: a rolling average over TIME, a warm-up nothing is
 * recorded during, a seeded draw arriving at a RAMPING rate, each
 * threshold recorded once at the count that reached it — with the rate
 * that count is good to — and a run that ends on the hold below the last
 * threshold rather than on one bad frame.
 *
 * The phone is a function from creature count to frame rate, so a whole
 * six-minute run is a few thousand loop iterations here.
 *
 * Since 2026-09-10 the pretend phone also has a pretend RENDERER: a
 * `StressSample` per frame saying how many bodies it drew as rigs and how
 * many as impostors, and what the drawing and the sim cost. `drive` hands
 * one in only when a test gives it a sampler, because the OTHER half of
 * the census contract is that a run nobody measured prints no census at
 * all rather than a column of zeroes.
 *
 * Since the rate began to ramp (2026-09-10) a frame may owe SEVERAL
 * creatures, so `drive` collects an array from every frame rather than a
 * species or a null — and a test that only ever read the first would
 * quietly measure a slower run than the one that ran.
 */
import { describe, expect, it } from 'vitest';
import type { CreatureId } from '../src/creatures/species';
import {
  BREAK_HOLD_S, MAX_CREATURES, MAX_RUN_S, RAMP_EVERY_S, RECOVERY_S, RollingFps, SETTLE_S, SPAWN_EVERY_S, STRESS_SEED,
  StressTest, THRESHOLDS, WINDOW_S, crossingSlack, stressBlock, stressOwedBy, stressRatePerS, stressReport,
  type StressConditions, type StressSample,
} from '../src/lab/stressTest';
import {
  nextStressPool, stressPoolLabel, stressPoolWords, type StressPool,
} from '../src/lab/labTool';

const FIVE: readonly CreatureId[] = ['queen', 'worker', 'earthworm', 'aphid', 'housefly'] as CreatureId[];

const CONDITIONS: StressConditions = {
  stamp: '2026-09-10T00:00:00Z', build: 'test', viewport: '932 × 430', rigs: 'all', rung: 'medium',
  predation: 'OFF', camera: 'free, bench viewpoint', pool: 'all five, mixed',
};

/** What the pretend renderer reports for a bench holding `creatures` bodies. */
type Sampler = (creatures: number) => StressSample;

/**
 * Run frames until `until` says stop, at whatever frame rate the pretend
 * phone gives for the creatures now alive. Every species handed back is
 * counted, as the scene must place every one it is given.
 *
 * With no `sampler` the run is driven exactly as it was before the census
 * existed — `frame` is called with one argument — which is the case the
 * null half of the contract is about.
 */
function drive(
  test: StressTest,
  phone: (creatures: number) => number,
  until: (seconds: number) => boolean,
  sampler?: Sampler,
): { spawned: CreatureId[]; seconds: number } {
  const spawned: CreatureId[] = [];
  let seconds = 0;
  for (let i = 0; i < 200_000 && !until(seconds); i += 1) {
    const dt = 1 / Math.max(0.5, phone(spawned.length));
    // The sample is read BEFORE the frame, from the bench as it stands:
    // a threshold is recorded against the count that reached it, and the
    // creature this frame places has not been drawn yet.
    const owed = sampler === undefined ? test.frame(dt) : test.frame(dt, sampler(spawned.length));
    seconds += dt;
    // Every one of them, not the first: the caller's half of the contract.
    for (const species of owed) spawned.push(species);
  }
  return { spawned, seconds };
}

/**
 * A pretend renderer with a rig pool of `cap`: everything past it draws
 * as an impostor, at a fixed cost, and every body is drawn one way or
 * the other — `notDrawn` is zero because this renderer hides nothing.
 * The one that does is `hidingSamplerOf`, below.
 */
function samplerOf(cap: number, drawMs = 4, aiMs = 2): Sampler {
  return (n) => ({ rigs: Math.min(n, cap), impostors: Math.max(0, n - cap), notDrawn: 0, drawMs, aiMs });
}

/**
 * The renderer the accounting is actually about: one body in every
 * `every` is underground with no cutaway open and is not drawn at all,
 * the rest split over a rig pool of `cap`. The three still add up to the
 * crowd, which is the identity the report prints.
 */
function hidingSamplerOf(cap: number, every: number): Sampler {
  return (n) => {
    const notDrawn = Math.floor(n / every);
    const shown = n - notDrawn;
    return { rigs: Math.min(shown, cap), impostors: Math.max(0, shown - cap), notDrawn, drawMs: 4, aiMs: 2 };
  };
}

/** A phone that holds 60 fps until `knee` creatures, then falls off linearly to 5 fps at `floor`. */
function phoneOf(knee: number, floor: number): (n: number) => number {
  return (n) => {
    if (n <= knee) return 60;
    if (n >= floor) return 5;
    return 60 - ((n - knee) / (floor - knee)) * 55;
  };
}

describe('RollingFps: frames over the seconds they took', () => {
  it('is not full until the window holds its seconds, and then reads frames ÷ time', () => {
    const w = new RollingFps(5);
    expect(w.full()).toBe(false);
    expect(w.fps()).toBe(0);
    for (let i = 0; i < 60 * 4; i += 1) w.add(1 / 60);
    expect(w.full()).toBe(false);
    for (let i = 0; i < 60; i += 1) w.add(1 / 60);
    expect(w.full()).toBe(true);
    expect(w.fps()).toBeCloseTo(60, 6);
    expect(w.frameMs()).toBeCloseTo(1000 / 60, 6);
    // Three hundred sixtieths sum to 4.999999999999988, which is why `full`
    // carries an epsilon: the window covers its seconds and at most one frame more.
    expect(w.seconds()).toBeGreaterThan(5 - 1e-9);
    expect(w.seconds()).toBeLessThan(5 + 1 / 60 + 1e-9);
  });

  it('holds SECONDS and not a frame count: a slow phone does not get a longer window', () => {
    const w = new RollingFps(5);
    for (let i = 0; i < 500; i += 1) w.add(1 / 10);
    expect(w.frames()).toBeLessThanOrEqual(51);
    expect(w.fps()).toBeCloseTo(10, 6);
  });

  it('forgets the old rate: five seconds after a drop, the average IS the new rate', () => {
    const w = new RollingFps(5);
    for (let i = 0; i < 600; i += 1) w.add(1 / 60);
    // One window's worth of the new rate still holds the oldest fast frame — the
    // window covers AT LEAST five seconds, so it reads a shade high.
    for (let i = 0; i < 50; i += 1) w.add(1 / 10);
    expect(w.fps()).toBeCloseTo(10, 0);
    // A second window later nothing of the old rate is left.
    for (let i = 0; i < 50; i += 1) w.add(1 / 10);
    expect(w.fps()).toBeCloseTo(10, 6);
  });

  it('lets one stall be the whole window rather than dropping it', () => {
    const w = new RollingFps(5);
    for (let i = 0; i < 600; i += 1) w.add(1 / 60);
    w.add(9);
    expect(w.frames()).toBe(1);
    expect(w.fps()).toBeCloseTo(1 / 9, 9);
  });

  it('is not moved by a frame time that is not one', () => {
    const w = new RollingFps(5);
    w.add(0);
    w.add(-1);
    w.add(Number.NaN);
    w.add(Number.POSITIVE_INFINITY);
    expect(w.frames()).toBe(0);
    expect(w.fps()).toBe(0);
  });
});

describe('the run: warm-up, one a second, and a seeded draw', () => {
  it('spawns nothing until the settle has passed AND the window is full, then one a second', () => {
    const test = new StressTest({ species: FIVE });
    test.start();
    // The settle plus all but a tenth of the window: nothing is placed yet.
    const early = drive(test, () => 60, (s) => s >= SETTLE_S + WINDOW_S - 0.1);
    expect(early.spawned).toEqual([]);
    expect(test.readout().phase).toBe('warmup');
    // Ten more seconds: one a second, give or take the frame the clock lands on.
    const later = drive(test, () => 60, (s) => s >= 10);
    expect(test.readout().phase).toBe('spawning');
    expect(later.spawned.length).toBeGreaterThanOrEqual(9);
    expect(later.spawned.length).toBeLessThanOrEqual(11);
    expect(test.readout().creatures).toBe(later.spawned.length);
  });

  it('draws the same species in the same order every run: RUN AGAIN is the same test', () => {
    const runOne = new StressTest({ species: FIVE });
    runOne.start();
    const one = drive(runOne, phoneOf(20, 60), () => runOne.finished);

    const runTwo = new StressTest({ species: FIVE });
    runTwo.start();
    const two = drive(runTwo, phoneOf(20, 60), () => runTwo.finished);

    expect(two.spawned).toEqual(one.spawned);
    expect(runTwo.result().crossings).toEqual(runOne.result().crossings);
    expect(one.spawned.length).toBeGreaterThan(20);
    // And every species was drawn: a "random insect" that only ever picked one would not be a mix.
    expect(new Set(one.spawned).size).toBe(FIVE.length);
  });

  it('a different seed is a different sequence', () => {
    const a = new StressTest({ species: FIVE, seed: STRESS_SEED });
    const b = new StressTest({ species: FIVE, seed: STRESS_SEED + 1 });
    a.start();
    b.start();
    const one = drive(a, () => 60, (s) => s >= 40);
    const two = drive(b, () => 60, (s) => s >= 40);
    expect(two.spawned).not.toEqual(one.spawned);
  });

  it('counts by species, and the counts add up to the total', () => {
    const test = new StressTest({ species: FIVE });
    test.start();
    const run = drive(test, phoneOf(15, 50), () => test.finished);
    const result = test.result();
    const summed = Object.values(result.bySpecies).reduce((a, b) => a + b, 0);
    expect(summed).toBe(result.creatures);
    expect(result.creatures).toBe(run.spawned.length);
  });
});

/** Seconds this run has spent SPAWNING: its own clock, less the window it filled first. */
function spawningSeconds(test: StressTest): number {
  return Math.max(0, test.readout().elapsedS - WINDOW_S);
}

describe('the ramp: one more a second every ten seconds of SPAWNING', () => {
  it('is one a second for the first ten, two for the next ten, and 5k(k+1) after k brackets', () => {
    const test = new StressTest({ species: FIVE });
    test.start();
    drive(test, () => 60, () => test.readout().phase === 'spawning');
    for (const k of [1, 2, 3, 4]) {
      drive(test, () => 60, () => spawningSeconds(test) >= k * RAMP_EVERY_S);
      expect(test.rate()).toBe(k + 1);
      // Joshua's arithmetic, 10 × (1 + 2 + … + k), give or take the frame
      // the drive's own clock stops on.
      const owed = 5 * k * (k + 1);
      expect(stressOwedBy(k * RAMP_EVERY_S)).toBe(owed);
      expect(test.readout().creatures).toBeGreaterThanOrEqual(owed - 1);
      expect(test.readout().creatures).toBeLessThanOrEqual(owed + 1);
    }
  });

  it('reads the ramp off the SPAWNING clock, so the settle and the window fill cost nothing', () => {
    const test = new StressTest({ species: FIVE });
    test.start();
    // A rebuild frame, the settle, and the whole window fill first: by the
    // time the first body is placed the run's clock already reads five.
    test.frame(0.9);
    drive(test, () => 60, () => test.readout().phase === 'spawning');
    // Five seconds of window fill, to a float's precision.
    expect(test.readout().elapsedS).toBeGreaterThan(WINDOW_S - 0.1);
    expect(test.rate()).toBe(1);
    // Nine more seconds of spawning. The run's clock now reads fourteen,
    // which IS the second bracket if the ramp is read off the wrong one.
    drive(test, () => 60, () => spawningSeconds(test) >= 9);
    expect(test.readout().elapsedS).toBeGreaterThan(RAMP_EVERY_S + 3);
    expect(test.rate()).toBe(1);
    expect(test.readout().creatures).toBeLessThanOrEqual(11);
    // And the step lands on the spawning clock's ten, not the run's.
    drive(test, () => 60, () => spawningSeconds(test) >= RAMP_EVERY_S + 0.5);
    expect(test.rate()).toBe(2);
  });

  it("carries the clock's remainder across a rate change: no spawn dropped, none doubled", () => {
    // The frame a bracket turns on is the risk: a clock set back to zero
    // there loses whatever was already owed, and one restarted at the new
    // interval pays it twice.
    const test = new StressTest({ species: FIVE });
    test.start();
    drive(test, () => 60, () => test.readout().phase === 'spawning');
    drive(test, () => 60, () => spawningSeconds(test) >= RAMP_EVERY_S - 0.5);
    const before = test.readout().creatures;
    drive(test, () => 60, () => spawningSeconds(test) >= RAMP_EVERY_S + 0.5);
    // Half a second at one a second and half at two: one body, or the two
    // the boundary itself can land on — never none, never three.
    expect(test.readout().creatures - before).toBeGreaterThanOrEqual(1);
    expect(test.readout().creatures - before).toBeLessThanOrEqual(2);
  });

  it('owes SEVERAL creatures in one call when a frame is long and the rate is high', () => {
    // Eleven frames a second — above the last threshold, so the run keeps
    // going — for the whole of the thirty-ninth bracket.
    const test = new StressTest({ species: FIVE });
    test.start();
    drive(test, () => 11, () => spawningSeconds(test) >= 39 * RAMP_EVERY_S + 1);
    expect(test.rate()).toBe(40);
    const before = test.readout().creatures;
    // A 200 ms hitch at forty a second owes eight — nine when the clock's
    // remainder was nearly due — and the caller is handed all of them.
    const owed = test.frame(0.2);
    expect(owed.length).toBeGreaterThanOrEqual(8);
    expect(owed.length).toBeLessThanOrEqual(9);
    expect(test.readout().creatures).toBe(before + owed.length);
  });

  it('hands back ONE array, emptied by the next frame: place them now', () => {
    const test = new StressTest({ species: FIVE });
    test.start();
    drive(test, () => 60, () => test.readout().phase === 'spawning');
    const owed = test.frame(3);
    expect(owed.length).toBe(3);
    const kept = owed;
    test.frame(1 / 60);
    // The same array, not a copy: a caller that stashed it would be
    // holding a window onto the next frame's answer instead of its own.
    expect(kept).toBe(owed);
    expect(kept.length).toBeLessThan(3);
  });

  it('records the rate in force at each crossing, and the report prints it with the ±', () => {
    // Sixty frames a second until two hundred bodies, five at nine
    // hundred: by the time anything is crossed the ramp is well past one
    // a second, which is the case a bare count would misrepresent.
    const test = new StressTest({ species: FIVE });
    test.start();
    drive(test, phoneOf(200, 900), () => test.finished, samplerOf(13));
    const result = test.result();
    expect(result.crossings.length).toBe(THRESHOLDS.length);
    let last = 0;
    for (const c of result.crossings) {
      expect(Number.isInteger(c.rate)).toBe(true);
      expect(c.rate).toBeGreaterThan(1);
      // The rate only ever climbs, so the ± only ever widens.
      expect(c.rate).toBeGreaterThanOrEqual(last);
      expect(crossingSlack(c.rate, WINDOW_S)).toBe(WINDOW_S * c.rate);
      last = c.rate;
    }
    const thirty = result.crossings.find((c) => c.fps === 30)!;
    const text = stressReport(result, CONDITIONS);
    expect(text).toContain(`SUSTAINED AT 30+ FPS: ${thirty.creatures} creatures  (± ${crossingSlack(thirty.rate)}, arriving at ${thirty.rate}/s)`);
    for (const c of result.crossings) {
      expect(text).toMatch(new RegExp(`below ${c.fps} fps {6}${c.creatures} +\\(\\d+ s\\) +± ${crossingSlack(c.rate)} +at ${c.rate}/s`));
    }
    expect(text).toContain(`Each count is good to about ± one ${WINDOW_S} s window of arrivals at the rate`);
    expect(text).toContain('At 1/s that is ± 5; at 40/s, ± 200.');
    // And the conditions say the sequence is still the same one every run.
    expect(text).toContain(`+1/s every ${RAMP_EVERY_S} s of spawning`);
    expect(text).toContain('RUN AGAIN repeats this exact sequence');
  });

  it('says the rate on the live panel while it is spawning, and not once it has stopped', () => {
    const test = new StressTest({ species: FIVE, maxCreatures: 40 });
    test.start();
    drive(test, () => 60, (s) => s >= SETTLE_S + WINDOW_S + 11);
    expect(test.readout().phase).toBe('spawning');
    expect(stressBlock(test.readout())).toContain('rate      2/s');
    drive(test, () => 60, () => test.finished);
    expect(stressBlock(test.readout())).not.toContain('rate      ');
  });

  it('owes the integral of the rate, so a bracket\'s turn costs nothing', () => {
    // The clock-and-remainder shape this replaced paid one extra creature
    // every time a bracket turned, always in the same direction.
    for (const k of [0, 1, 2, 5, 39]) expect(stressOwedBy(k * RAMP_EVERY_S)).toBe(5 * k * (k + 1));
    // Half-way through the third bracket: two whole brackets, then 3/s.
    expect(stressOwedBy(2 * RAMP_EVERY_S + 5)).toBe(30 + 15);
    // A slower base run owes proportionally fewer, and nothing is owed
    // before the clock starts or off a clock that is not one.
    expect(stressOwedBy(RAMP_EVERY_S, 2)).toBe(5);
    expect(stressOwedBy(0)).toBe(0);
    expect(stressOwedBy(-1)).toBe(0);
    expect(stressOwedBy(Number.NaN)).toBe(0);
  });

  it('a rate is a rate whatever base a caller asked for', () => {
    expect(stressRatePerS(0)).toBe(1);
    expect(stressRatePerS(RAMP_EVERY_S - 0.001)).toBe(1);
    expect(stressRatePerS(RAMP_EVERY_S)).toBe(2);
    expect(stressRatePerS(39 * RAMP_EVERY_S)).toBe(40);
    // A run driven at one every two seconds ramps to one a second, not two.
    expect(stressRatePerS(RAMP_EVERY_S, 2)).toBe(1);
    // Nothing is a rate before the clock has started, or off a clock that is not one.
    expect(stressRatePerS(-5)).toBe(1);
    expect(stressRatePerS(Number.NaN)).toBe(1);
    expect(crossingSlack(0)).toBe(0);
    expect(crossingSlack(40)).toBe(200);
  });
});

describe('the settle: the rebuild frame is not part of the measurement', () => {
  it('throws away the first second, so a 900 ms rebuild frame cannot reach the window', () => {
    // What RUN AGAIN actually looks like on a phone: one long frame while the
    // bench is cleared and the rigs re-sized, then sixty a second. Without the
    // settle those 900 ms sit inside the first five-second window, drag it to
    // about 51 fps, and the run records "below 45" at ZERO creatures.
    const test = new StressTest({ species: FIVE, maxCreatures: 8 });
    test.start();
    test.frame(0.9);
    drive(test, () => 60, () => test.finished);
    const result = test.result();
    expect(result.crossings).toEqual([]);
    expect(result.averageFps).toBeCloseTo(60, 1);
    // The long frame is not the run's worst frame, because it is not the run's.
    expect(result.worstFrameMs).toBeLessThan(100);
  });

  it('does not put the settle on the run\'s clock', () => {
    const test = new StressTest({ species: FIVE, maxCreatures: 4 });
    test.start();
    // Two seconds of settling frames — more than SETTLE_S, so some are measured.
    drive(test, () => 60, (s) => s >= 2);
    expect(test.readout().elapsedS).toBeGreaterThan(2 - SETTLE_S - 0.1);
    expect(test.readout().elapsedS).toBeLessThan(2 - SETTLE_S + 0.1);
  });

  it('a run STOPPED inside its own settle still reaches its report', () => {
    const test = new StressTest({ species: FIVE });
    test.start();
    test.frame(0.2);
    test.stop();
    expect(test.readout().phase).toBe('recovery');
    drive(test, () => 60, () => test.finished);
    expect(test.result().ending).toBe('stopped');
    expect(test.result().creatures).toBe(0);
  });
});

describe('the thresholds', () => {
  it('records each one once, in order, at the count that first fell through it', () => {
    const test = new StressTest({ species: FIVE });
    test.start();
    drive(test, phoneOf(10, 60), () => test.finished);
    const crossings = test.result().crossings;
    expect(crossings.map((c) => c.fps)).toEqual([...THRESHOLDS]);
    // Falling monotonically, each threshold is reached at a higher count than the last.
    for (let i = 1; i < crossings.length; i += 1) {
      expect(crossings[i].creatures).toBeGreaterThanOrEqual(crossings[i - 1].creatures);
      expect(crossings[i].atS).toBeGreaterThanOrEqual(crossings[i - 1].atS);
    }
    // The 30 fps count is the number Joshua asked for; on this phone it is around the knee.
    const thirty = crossings.find((c) => c.fps === 30);
    expect(thirty?.creatures).toBeGreaterThan(10);
  });

  it('records every threshold a cliff falls past, within a few creatures of each other', () => {
    // 60 fps to 6 fps the moment the twentieth creature lands.
    const test = new StressTest({ species: FIVE });
    test.start();
    drive(test, (n) => (n < 20 ? 60 : 6), () => test.finished);
    const crossings = test.result().crossings;
    expect(crossings.map((c) => c.fps)).toEqual([...THRESHOLDS]);
    for (const c of crossings) expect(c.creatures).toBeGreaterThanOrEqual(20);
    // A cliff in the frame RATE is a ramp in the five-second AVERAGE — which is
    // the whole reason Joshua asked for an average — so the four counts cluster
    // within the handful of creatures that land while the window is emptying,
    // rather than landing on one number. A gradual phone spreads them much wider.
    const counts = crossings.map((c) => c.creatures);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(8);
  });

  it('never reached is said so, not left as a zero', () => {
    const test = new StressTest({ species: FIVE, maxCreatures: 30 });
    test.start();
    drive(test, () => 60, () => test.finished);
    const result = test.result();
    expect(result.crossings).toEqual([]);
    expect(result.ending).toBe('ceiling');
    const text = stressReport(result, CONDITIONS);
    expect(text).toContain('below 45 fps      never reached');
    expect(text).toContain('never fell below 30 fps');
  });
});

describe('the ending', () => {
  it('stops spawning only after the average has held under the last threshold for the hold', () => {
    const test = new StressTest({ species: FIVE });
    test.start();
    let brokeAt = -1;
    let creaturesWhenBroke = -1;
    const spawned: CreatureId[] = [];
    let seconds = 0;
    const phone = phoneOf(10, 45);
    for (let i = 0; i < 200_000 && !test.finished; i += 1) {
      const dt = 1 / Math.max(0.5, phone(spawned.length));
      for (const species of test.frame(dt)) spawned.push(species);
      seconds += dt;
      const r = test.readout();
      if (r.phase === 'recovery' && brokeAt < 0) {
        brokeAt = seconds;
        creaturesWhenBroke = r.creatures;
      }
    }
    expect(test.result().ending).toBe('broke');
    // Nothing was spawned after the break, and the recovery ran its ten seconds.
    expect(spawned.length).toBe(creaturesWhenBroke);
    expect(seconds - brokeAt).toBeGreaterThanOrEqual(RECOVERY_S - 1);
    // The final reading is below the last threshold; the run's low is at or under it.
    const result = test.result();
    expect(result.finalFps).toBeLessThan(THRESHOLDS[THRESHOLDS.length - 1]);
    expect(result.lowestFps).toBeLessThanOrEqual(result.finalFps + 1e-9);
  });

  it('a periodic hitch does not end a run: the AVERAGE decides, not a frame', () => {
    // Sits at 12 fps — under 20, over 10 — with a 200 ms hitch every thirtieth
    // frame. That is 30 frames in 2.62 s, an average of 11.5: over the last
    // threshold, so the run goes on to the ceiling instead of "breaking".
    const test = new StressTest({ species: FIVE, maxCreatures: 40 });
    test.start();
    let i = 0;
    drive(test, () => (i++ % 30 === 0 ? 5 : 12), () => test.finished);
    expect(test.result().ending).toBe('ceiling');
    expect(test.result().crossings.map((c) => c.fps)).toEqual([45, 30, 20]);
    // And the hitch IS reported, as the worst single frame rather than as the rate.
    expect(test.result().worstFrameMs).toBeCloseTo(200, 0);
  });

  it('a recovery that lifts the frame rate is reported as the recovery, not as the break', () => {
    // The phone is slow while spawning and recovers the moment nothing new arrives.
    const test = new StressTest({ species: FIVE });
    test.start();
    let spawnedTotal = 0;
    let seconds = 0;
    for (let i = 0; i < 200_000 && !test.finished; i += 1) {
      const recovering = test.readout().phase === 'recovery';
      const dt = 1 / (recovering ? 40 : Math.max(2, 60 - spawnedTotal * 2));
      spawnedTotal += test.frame(dt).length;
      seconds += dt;
    }
    const result = test.result();
    expect(result.ending).toBe('broke');
    expect(result.finalFps).toBeLessThan(10);
    expect(result.recoveryFps).toBeGreaterThan(30);
    expect(stressReport(result, CONDITIONS)).toContain(`FPS after ${RECOVERY_S} s hold`);
  });

  it('the ceiling is not a breaking point and the report says so', () => {
    const test = new StressTest({ species: FIVE, maxCreatures: 12 });
    test.start();
    drive(test, () => 25, () => test.finished);
    const result = test.result();
    expect(result.creatures).toBe(12);
    expect(result.ending).toBe('ceiling');
    expect(stressReport(result, CONDITIONS)).toContain('NOT a breaking point');
  });

  it('STOP goes straight to the recovery and the report, and says it was stopped', () => {
    const test = new StressTest({ species: FIVE });
    test.start();
    drive(test, () => 60, (s) => s >= 12);
    test.stop();
    expect(test.readout().phase).toBe('recovery');
    drive(test, () => 60, () => test.finished);
    expect(test.result().ending).toBe('stopped');
  });

  it('the default ceiling is the one the header names, and the ramp reaches it inside the run', () => {
    expect(MAX_CREATURES).toBe(10_000);
    expect(SPAWN_EVERY_S).toBe(1);
    expect(RAMP_EVERY_S).toBe(10);
    expect(BREAK_HOLD_S).toBe(5);
    expect(RECOVERY_S).toBe(10);
    // The arithmetic the header states: 5k(k+1) after k brackets, so 44
    // whole brackets is 9,900 at 440 s of spawning and the forty-fifth
    // rate clears the last hundred in a couple of seconds. That, plus the
    // window fill, is what has to fit inside MAX_RUN_S — otherwise the
    // ceiling would be unreachable and the guard would be the clock's.
    const brackets = 44;
    expect(5 * brackets * (brackets + 1)).toBe(9_900);
    const toCeilingS = brackets * RAMP_EVERY_S + (MAX_CREATURES - 9_900) / (brackets + 1);
    expect(toCeilingS).toBeLessThan(MAX_RUN_S - WINDOW_S);
  });
});

describe('the report', () => {
  it('leads with the 30 fps count, prints every number Joshua asked for, and names the conditions', () => {
    const test = new StressTest({ species: FIVE });
    test.start();
    drive(test, phoneOf(12, 55), () => test.finished);
    const result = test.result();
    const text = stressReport(result, CONDITIONS);

    const thirty = result.crossings.find((c) => c.fps === 30);
    expect(thirty).toBeDefined();
    expect(text).toContain(`SUSTAINED AT 30+ FPS: ${thirty!.creatures} creatures`);
    expect(text).toContain(`Total insects       ${result.creatures}`);
    expect(text).toMatch(/Test duration {7}\d+\.\d s/);
    expect(text).toMatch(/Average FPS {9}\d+\.\d/);
    expect(text).toMatch(/Average frame time {2}\d+\.\d ms/);
    expect(text).toMatch(/Lowest FPS \(5 s\) {4}\d+\.\d/);
    expect(text).toMatch(/Final FPS {11}\d+\.\d/);
    expect(text).toContain('INSECTS AT EACH THRESHOLD');
    for (const want of THRESHOLDS) expect(text).toContain(`below ${String(want).padStart(2)} fps`);
    for (const id of FIVE) expect(text).toContain(id);
    expect(text).toContain('one animated skeleton per insect');
    expect(text).toContain('do not collide with or avoid one another');
    expect(text).toContain('RUN AGAIN repeats this exact sequence');
    expect(text).toContain('build      test');
  });

  it('refuses to sell a threshold crossed on an EMPTY bench as a density answer', () => {
    // A phone (or a headless SwiftShader renderer) that cannot hold 30 fps with
    // nothing on the bench records every threshold at zero creatures. The number
    // is real; what it measures is the renderer, not the crowd, and the report
    // has to say so where the headline is read rather than in a footnote.
    const test = new StressTest({ species: FIVE });
    test.start();
    drive(test, () => 3, () => test.finished);
    const result = test.result();
    expect(result.crossings.map((c) => c.creatures)).toEqual([0, 0, 0, 0]);
    const text = stressReport(result, CONDITIONS);
    expect(text).toContain('SUSTAINED AT 30+ FPS: 0 creatures — READ THE CAVEAT BELOW');
    expect(text).toContain('CAVEAT: the bench was ALREADY under 45 / 30 / 20 / 10 fps with NO');
    expect(text).toContain('This run cannot answer the density question.');
    expect(text).toContain('← empty bench');
  });

  it('prints no caveat when the thresholds were reached with insects on the bench', () => {
    const test = new StressTest({ species: FIVE });
    test.start();
    drive(test, phoneOf(12, 55), () => test.finished);
    const text = stressReport(test.result(), CONDITIONS);
    expect(text).not.toContain('CAVEAT');
    expect(text).not.toContain('empty bench');
  });

  it('says which pool the run used, since it is the biggest lever on the number', () => {
    const test = new StressTest({ species: FIVE, maxCreatures: 8 });
    test.start();
    drive(test, () => 60, () => test.finished);
    const rung = stressReport(test.result(), { ...CONDITIONS, rigs: 'rung' });
    expect(rung).toContain('RUNG (medium) — the rest draw as impostors');
  });

  it('names the species pool in the conditions, in the report\'s words and not the button\'s', () => {
    const test = new StressTest({ species: ['queen'] as CreatureId[], maxCreatures: 6 });
    test.start();
    drive(test, () => 60, () => test.finished);
    const text = stressReport(test.result(), { ...CONDITIONS, pool: stressPoolWords('queen' as CreatureId) });
    expect(text).toMatch(/\n {2}pool {7}queen only\n/);
    expect(stressReport(test.result(), CONDITIONS)).toMatch(/\n {2}pool {7}all five, mixed\n/);
  });
});

describe('the drawn census: rigs, impostors, and where the frame went', () => {
  it('records the census at the moment each threshold was crossed, not the run\'s latest', () => {
    // A rig pool of forty against a phone whose four thresholds fall at
    // roughly 22, 37, 47 and 57 creatures: the first two are crossed while
    // the pool is still filling and read no impostors at all, the last two
    // after it is full. If a crossing carried the run's LATEST sample
    // instead of its own, all four would read the same pair.
    const test = new StressTest({ species: FIVE });
    test.start();
    drive(test, phoneOf(4, 60), () => test.finished, samplerOf(40));
    const crossings = test.result().crossings;
    expect(crossings.length).toBe(THRESHOLDS.length);
    for (const c of crossings) {
      expect(c.rigs).toBe(Math.min(c.creatures, 40));
      expect(c.impostors).toBe(Math.max(0, c.creatures - 40));
    }
    expect(crossings[0].impostors).toBe(0);
    expect(crossings[crossings.length - 1].impostors).toBeGreaterThan(0);
    // They are not all the same number, which is what "at that moment" buys.
    expect(new Set(crossings.map((c) => c.impostors)).size).toBeGreaterThan(1);
    expect(crossings[0].rigs).toBeLessThan(crossings[crossings.length - 1].rigs!);
  });

  it('prints the census on every threshold line that has one', () => {
    const test = new StressTest({ species: FIVE });
    test.start();
    drive(test, phoneOf(6, 50), () => test.finished, samplerOf(8));
    const text = stressReport(test.result(), CONDITIONS);
    for (const want of THRESHOLDS) {
      expect(text).toMatch(new RegExp(`below ${want} fps {6}\\d+ +\\(\\d+ s\\) +± \\d+ +at \\d+/s +\\d+ rigs · \\d+ impostors`));
    }
  });

  it('keeps the last sample as the end of the run, and the highest as the peak', () => {
    // A renderer that lends skeletons while the pool is its own and takes
    // them back when the crowd outgrows it: rigs climb to ten, then fall to
    // two and stay there. The peak is the ten; the end is the two.
    const test = new StressTest({ species: FIVE, maxCreatures: 20 });
    test.start();
    drive(test, () => 60, () => test.finished, (n) => ({
      rigs: n <= 10 ? n : 2, impostors: n <= 10 ? 0 : n - 2, notDrawn: 0, aiMs: 1, drawMs: 3,
    }));
    const result = test.result();
    expect(result.finalRigs).toBe(2);
    expect(result.finalImpostors).toBe(18);
    expect(result.peakRigs).toBe(10);
    expect(result.peakImpostors).toBe(18);
    const text = stressReport(result, CONDITIONS);
    expect(text).toContain('DRAWN AT THE END');
    expect(text).toMatch(/\n {2}full rigs {11}2\n/);
    expect(text).toMatch(/\n {2}impostors {11}18\n/);
    expect(text).toMatch(/\n {2}peak full rigs {6}10\n/);
  });

  it('splits the frame between the creature drawing and everything else, and leaves the sim tick OUT of it', () => {
    // 60 fps flat, 4 ms of creature drawing and a 2 ms sim tick. The two
    // halves must add back to the frame: the sim's reading is already inside
    // `everything else` and is printed beside the split, not in it.
    const test = new StressTest({ species: FIVE, maxCreatures: 15 });
    test.start();
    drive(test, () => 60, () => test.finished, samplerOf(8, 4, 2));
    const result = test.result();
    expect(result.meanDrawMs).toBeCloseTo(4, 9);
    expect(result.meanAiMs).toBeCloseTo(2, 9);
    const text = stressReport(result, CONDITIONS);
    expect(text).toContain('WHERE THE FRAME WENT (mean per frame)');
    const read = (label: string): number => {
      const m = text.match(new RegExp(`${label} +([\\d.]+) ms`));
      expect(m).not.toBeNull();
      return Number(m![1]);
    };
    const drawn = read('creature drawing');
    const rest = read('everything else');
    const tick = read('sim tick');
    expect(drawn).toBeCloseTo(result.meanDrawMs!, 1);
    expect(rest).toBeCloseTo(result.averageFrameMs - result.meanDrawMs!, 1);
    expect(drawn + rest).toBeCloseTo(result.averageFrameMs, 1);
    expect(tick).toBeCloseTo(result.meanAiMs!, 1);
    // The subtraction that would have been wrong: taking the tick out too.
    expect(rest).not.toBeCloseTo(result.averageFrameMs - result.meanDrawMs! - result.meanAiMs!, 1);
    expect(text).toContain('not a per-frame cost');
  });

  it('floors `everything else` at zero rather than printing a renderer that gave time back', () => {
    // A pretend renderer claiming more drawing time than the whole frame took.
    const test = new StressTest({ species: FIVE, maxCreatures: 6 });
    test.start();
    drive(test, () => 60, () => test.finished, samplerOf(2, 500, 1));
    const text = stressReport(test.result(), CONDITIONS);
    expect(text).toMatch(/everything else +0\.0 ms/);
  });

  it('the live panel carries the split while the run is going', () => {
    const test = new StressTest({ species: FIVE });
    test.start();
    drive(test, () => 60, (s) => s >= 20, samplerOf(8));
    const r = test.readout();
    expect(r.rigs).toBe(8);
    // The sample is the bench as it stood when the frame began, so it may
    // be a creature or two behind the count — what the panel must show is
    // the SPLIT, and that the pool is full and the rest are impostors.
    expect(r.impostors).toBeGreaterThan(0);
    expect(r.rigs! + r.impostors!).toBeLessThanOrEqual(r.creatures);
    expect(stressBlock(r)).toContain(`drawn     8 rigs · ${r.impostors} impostors`);
  });

  it('discards the settle\'s samples with the settle\'s frames', () => {
    // The rebuild frame draws a bench being torn down. Counting its census
    // would put a 900 ms drawing cost in the mean of a run it is not part of.
    const test = new StressTest({ species: FIVE, maxCreatures: 5 });
    test.start();
    test.frame(0.9, { rigs: 999, impostors: 999, notDrawn: 999, aiMs: 900, drawMs: 900 });
    drive(test, () => 60, () => test.finished, samplerOf(8, 4, 2));
    const result = test.result();
    expect(result.peakRigs).toBeLessThanOrEqual(8);
    expect(result.meanDrawMs).toBeCloseTo(4, 9);
    expect(result.meanAiMs).toBeCloseTo(2, 9);
  });

  it('ignores a sample that is not a measurement rather than putting a NaN through every mean', () => {
    const test = new StressTest({ species: FIVE, maxCreatures: 5 });
    test.start();
    let n = 0;
    drive(test, () => 60, () => test.finished, () => {
      n += 1;
      return n % 3 === 0
        ? { rigs: Number.NaN, impostors: -1, notDrawn: -2, aiMs: Number.NaN, drawMs: Number.POSITIVE_INFINITY }
        : { rigs: 4, impostors: 1, notDrawn: 0, aiMs: 2, drawMs: 4 };
    });
    const result = test.result();
    expect(result.meanDrawMs).toBeCloseTo(4, 9);
    expect(result.finalRigs).toBe(4);
    expect(result.peakImpostors).toBe(1);
  });
});

describe('the census accounts for the whole crowd (Joshua: where did the other 55 go?)', () => {
  it('carries the not-drawn number into the report, and the three sum to what was placed', () => {
    // One body in four underground with no cutaway open, the rest split
    // over a rig pool of thirteen: 13 + 17 + 10 = 40, which is the
    // identity the block prints so a reader can check it.
    const test = new StressTest({ species: FIVE, maxCreatures: 40 });
    test.start();
    drive(test, () => 60, () => test.finished, hidingSamplerOf(13, 4));
    const result = test.result();
    expect(result.creatures).toBe(40);
    expect(result.finalRigs).toBe(13);
    expect(result.finalImpostors).toBe(17);
    expect(result.finalNotDrawn).toBe(10);
    expect(result.finalRigs! + result.finalImpostors! + result.finalNotDrawn!).toBe(result.creatures);
    const text = stressReport(result, CONDITIONS);
    expect(text).toContain('DRAWN AT THE END');
    expect(text).toMatch(/\n {2}full rigs {11}13\n/);
    expect(text).toMatch(/\n {2}impostors {11}17\n/);
    expect(text).toMatch(/\n {2}not drawn {11}10 {3}\(underground burrowers, or past a cap\)\n/);
    expect(text).toContain('\n  ---\n');
    // The total is the RENDERER's — every body it was handed — and the
    // run's own count is named beside it. Here nothing else is in the
    // room, so they agree and no "already there" line is printed.
    expect(text).toMatch(/\n {2}bodies in the room {2}40\n/);
    expect(text).toMatch(/\n {2}of those, the run's 40\n/);
    expect(text).not.toContain('already there');
    expect(text).not.toContain('MISMATCH');
    // `total placed` was the old wording, and it was the wrong number to
    // compare the renderer's three against; it is gone.
    expect(text).not.toContain('total placed');
  });

  it('names the bodies that were already in the room instead of crying bug at them', () => {
    // THE CREATURE LAB'S OWN FIVE. The run spawns into a room that is not
    // empty — the bench's queen, worker, worm, aphid and fly are standing
    // there before STRESS is pressed — so the renderer is always handed
    // five more bodies than the run placed. The first version of this
    // block called that a MISMATCH and a bug, which it is not.
    const test = new StressTest({ species: FIVE, maxCreatures: 20 });
    test.start();
    drive(test, () => 60, () => test.finished, (n) => ({
      rigs: n + 5, impostors: 0, notDrawn: 0, aiMs: 1, drawMs: 2,
    }));
    const result = test.result();
    expect(result.finalRigs).toBe(25);
    const text = stressReport(result, CONDITIONS);
    expect(text).toMatch(/\n {2}bodies in the room {2}25\n/);
    expect(text).toMatch(/\n {2}of those, the run's 20\n/);
    expect(text).toMatch(/\n {2}already there {7}5 {3}\(the bench's own animals, not spawned by this run\)\n/);
    expect(text).not.toContain('MISMATCH');
  });

  it('DOES cry bug the one way that is one: fewer bodies drawn than the run placed', () => {
    // The run cannot have spawned more than the renderer was handed. That
    // direction is a real disagreement and stays loud.
    const test = new StressTest({ species: FIVE, maxCreatures: 20 });
    test.start();
    drive(test, () => 60, () => test.finished, (n) => ({
      rigs: Math.max(0, n - 3), impostors: 0, notDrawn: 0, aiMs: 1, drawMs: 2,
    }));
    const text = stressReport(test.result(), CONDITIONS);
    expect(text).toContain('MISMATCH: the run placed 20 but only 17 reached the renderer');
    expect(text).toContain('3 bodies are unaccounted for');
  });

  it('drops a sample whose not-drawn number is not one, rather than printing the rest of it', () => {
    const test = new StressTest({ species: FIVE, maxCreatures: 5 });
    test.start();
    drive(test, () => 60, () => test.finished, () => ({
      rigs: 3, impostors: 1, notDrawn: Number.NaN, aiMs: 2, drawMs: 4,
    }));
    const result = test.result();
    expect(result.finalRigs).toBeNull();
    expect(result.finalNotDrawn).toBeNull();
    expect(result.meanDrawMs).toBeNull();
    expect(stressReport(result, CONDITIONS)).not.toContain('DRAWN AT THE END');
  });

  it('the live panel names the bodies nobody drew, beside the ones that were', () => {
    const test = new StressTest({ species: FIVE });
    test.start();
    drive(test, () => 60, (s) => s >= 20, hidingSamplerOf(8, 4));
    const r = test.readout();
    expect(r.notDrawn).toBeGreaterThan(0);
    expect(stressBlock(r)).toContain(`${r.rigs} rigs · ${r.impostors} impostors · ${r.notDrawn} not drawn`);
  });
});

describe('a run nobody measured says so, and never with a zero', () => {
  it('leaves every census number null and prints neither block nor a census on any line', () => {
    const test = new StressTest({ species: FIVE });
    test.start();
    drive(test, phoneOf(8, 45), () => test.finished);
    const result = test.result();
    expect(result.finalRigs).toBeNull();
    expect(result.finalImpostors).toBeNull();
    expect(result.peakRigs).toBeNull();
    expect(result.peakImpostors).toBeNull();
    expect(result.meanDrawMs).toBeNull();
    expect(result.meanAiMs).toBeNull();
    for (const c of result.crossings) {
      expect(c.rigs).toBeNull();
      expect(c.impostors).toBeNull();
    }
    expect(result.finalNotDrawn).toBeNull();
    const text = stressReport(result, CONDITIONS);
    expect(text).not.toContain('DRAWN AT THE END');
    expect(text).not.toContain('WHERE THE FRAME WENT');
    expect(text).not.toContain('rigs ·');
    expect(text).not.toContain('impostors');
    // Including the accounting: nobody counted, so there is nothing to
    // account for — and a `total placed` under a column of em-dashes
    // would read as a renderer that drew none of them.
    expect(text).not.toContain('not drawn');
    expect(text).not.toContain('total placed');
    expect(text).not.toContain('MISMATCH');
    // And the threshold lines are exactly what they were before the census existed.
    expect(text).toMatch(/below 30 fps {6}\d+ +\(\d+ s\) +± \d+ +at \d+\/s\n/);
  });

  it('leaves the live panel\'s census out too', () => {
    const test = new StressTest({ species: FIVE });
    test.start();
    drive(test, () => 60, (s) => s >= 20);
    const r = test.readout();
    expect(r.rigs).toBeNull();
    expect(r.impostors).toBeNull();
    expect(r.notDrawn).toBeNull();
    expect(stressBlock(r)).not.toContain('drawn');
  });
});

describe('the species pool: one animal at a time', () => {
  it('refuses a change mid-run, because the report has to describe the sequence that ran', () => {
    const test = new StressTest({ species: FIVE });
    test.start();
    drive(test, () => 60, (s) => s >= 12);
    const before = test.readout().creatures;
    expect(before).toBeGreaterThan(0);
    test.setPool(['queen'] as CreatureId[]);
    expect(test.pool).toEqual(FIVE);
    expect(test.readout().creatures).toBe(before);
    expect(test.readout().phase).toBe('spawning');
  });

  it('replaces the pool and RESETS when idle: a different pool is a different test', () => {
    const test = new StressTest({ species: FIVE, maxCreatures: 6 });
    test.start();
    drive(test, () => 60, () => test.finished);
    expect(test.result().creatures).toBe(6);
    test.setPool(['queen', 'worker'] as CreatureId[]);
    expect(test.pool).toEqual(['queen', 'worker']);
    const r = test.readout();
    expect(r.phase).toBe('idle');
    expect(r.creatures).toBe(0);
    expect(r.crossings).toEqual([]);
    expect(r.ending).toBeNull();
  });

  it('refuses an empty pool: a run with nothing to spawn never reaches a threshold', () => {
    const test = new StressTest({ species: FIVE });
    test.setPool([]);
    expect(test.pool).toEqual(FIVE);
    test.start();
    const run = drive(test, () => 60, (s) => s >= 20);
    expect(run.spawned.length).toBeGreaterThan(0);
  });

  it('a species-only run spawns only that species', () => {
    const test = new StressTest({ species: FIVE, maxCreatures: 20 });
    test.setPool(['queen'] as CreatureId[]);
    test.start();
    const run = drive(test, () => 60, () => test.finished);
    expect(run.spawned.length).toBe(20);
    expect(new Set(run.spawned)).toEqual(new Set(['queen']));
    expect(test.result().bySpecies).toEqual({ queen: 20 });
  });
});

describe('the POOL control\'s words', () => {
  it('cycles MIX → each species in turn → MIX', () => {
    const seen: StressPool[] = [];
    let pool: StressPool = 'mix';
    for (let i = 0; i < FIVE.length + 1; i += 1) {
      pool = nextStressPool(pool, FIVE);
      seen.push(pool);
    }
    expect(seen).toEqual([...FIVE, 'mix']);
  });

  it('falls back to MIX for a species this lab does not run, and for an empty list', () => {
    expect(nextStressPool('housefly' as CreatureId, ['queen', 'worker'] as CreatureId[])).toBe('mix');
    expect(nextStressPool('mix', [])).toBe('mix');
  });

  it('shortens for the button and never for the report', () => {
    expect(stressPoolLabel('mix')).toBe('POOL: MIX');
    expect(stressPoolLabel('queen' as CreatureId)).toBe('POOL: QUEEN');
    expect(stressPoolLabel('earthworm' as CreatureId)).toBe('POOL: WORM');
    expect(stressPoolWords('mix')).toBe('all five, mixed');
    expect(stressPoolWords('earthworm' as CreatureId)).toBe('earthworm only');
    // A pasted report names the real id, whatever the row had space for.
    for (const id of FIVE) expect(stressPoolWords(id)).toBe(`${id} only`);
  });
});
