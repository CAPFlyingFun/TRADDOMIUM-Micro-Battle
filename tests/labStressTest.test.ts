/**
 * The stress test's arithmetic, played out under node against a
 * pretend phone: a rolling average over TIME, a warm-up nothing is
 * recorded during, one creature a second from a seeded draw, each
 * threshold recorded once at the count that reached it, and a run that
 * ends on the hold below the last threshold rather than on one bad
 * frame.
 *
 * The phone is a function from creature count to frame rate, so a whole
 * six-minute run is a few thousand loop iterations here.
 */
import { describe, expect, it } from 'vitest';
import type { CreatureId } from '../src/creatures/species';
import {
  BREAK_HOLD_S, MAX_CREATURES, RECOVERY_S, RollingFps, SETTLE_S, SPAWN_EVERY_S, STRESS_SEED, StressTest, THRESHOLDS,
  WINDOW_S, stressReport, type StressConditions,
} from '../src/lab/stressTest';

const FIVE: readonly CreatureId[] = ['queen', 'worker', 'earthworm', 'aphid', 'housefly'] as CreatureId[];

const CONDITIONS: StressConditions = {
  stamp: '2026-09-10T00:00:00Z', build: 'test', viewport: '932 × 430', rigs: 'all', rung: 'medium',
  predation: 'OFF', camera: 'free, bench viewpoint',
};

/**
 * Run frames until `until` says stop, at whatever frame rate the pretend
 * phone gives for the creatures now alive. Every species handed back is
 * counted, as the scene must place every one it is given.
 */
function drive(
  test: StressTest,
  phone: (creatures: number) => number,
  until: (seconds: number) => boolean,
): { spawned: CreatureId[]; seconds: number } {
  const spawned: CreatureId[] = [];
  let seconds = 0;
  for (let i = 0; i < 200_000 && !until(seconds); i += 1) {
    const dt = 1 / Math.max(0.5, phone(spawned.length));
    const species = test.frame(dt);
    seconds += dt;
    if (species !== null) spawned.push(species);
  }
  return { spawned, seconds };
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
  it('spawns nothing until the settle has passed AND the window is full, then one every second', () => {
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
      const species = test.frame(dt);
      seconds += dt;
      if (species !== null) spawned.push(species);
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
      const species = test.frame(dt);
      seconds += dt;
      if (species !== null) spawnedTotal += 1;
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

  it('the default ceiling is the one the header names, and a full run stays inside it', () => {
    expect(MAX_CREATURES).toBe(400);
    expect(SPAWN_EVERY_S).toBe(1);
    expect(BREAK_HOLD_S).toBe(5);
    expect(RECOVERY_S).toBe(10);
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
});
