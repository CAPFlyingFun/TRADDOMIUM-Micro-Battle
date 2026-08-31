/**
 * HER CLOCK, AND THE ONE THING IT MUST NOT DO.
 *
 * Boosted travel is "the same flight, played faster". That claim is
 * only true if her simulation is still stepped at ordinary resolution —
 * a single dt ten times as long is the same arithmetic and a completely
 * different flight, because she would turn in chunky increments,
 * overshoot bands, cross a waterline between samples and blow through a
 * waypoint capture.
 *
 * TMB clamps a slow frame at a tenth of a second, so the worst case is
 * not hypothetical: a bad phone frame times ten is a ONE SECOND physics
 * step. Most of what is below is about that number.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_STEP, MAX_SUBSTEPS, MAX_TRAVEL, RAMP_SECONDS, TravelScale, planSteps,
} from '../src/ant/travelScale';

describe('cutting her time into steps', () => {
  it('leaves an ordinary frame alone', () => {
    const plan = planSteps(1 / 60);
    expect(plan.steps).toBe(1);
    expect(plan.each).toBeCloseTo(1 / 60, 9);
  });

  it('never hands the flight model a step coarser than a normal frame', () => {
    // THE WHOLE POINT. Boosted travel must not sample the world more
    // crudely than unboosted flight does.
    for (const budget of [0.1, 0.167, 0.5, 1, 1 / 30 + 1e-9]) {
      expect(planSteps(budget).each, `${budget}`).toBeLessThanOrEqual(MAX_STEP + 1e-9);
    }
  });

  it('and the worst phone frame at full boost is not a one-second leap', () => {
    // 0.1 s is the clamp IslandScene already applies. Ten times that is
    // the number this whole mechanism exists to refuse.
    const plan = planSteps(0.1 * MAX_TRAVEL);
    expect(plan.budget).toBeCloseTo(1, 9);
    expect(plan.each).toBeLessThanOrEqual(MAX_STEP);
    expect(plan.steps).toBeGreaterThanOrEqual(30);
  });

  it('spends exactly the budget, no more and no less', () => {
    for (const budget of [0, 0.001, 1 / 60, 0.167, 1, 3.5]) {
      const plan = planSteps(budget);
      expect(plan.steps * plan.each, `${budget}`).toBeCloseTo(plan.budget, 9);
      expect(plan.budget).toBeCloseTo(budget, 9);
    }
  });

  it('makes every step the same length', () => {
    // Rather than a full-size run and a short remainder: a short final
    // step is a differently-sized integration, and the point of this is
    // that they are all the same.
    const plan = planSteps(0.25);
    expect(plan.each * plan.steps).toBeCloseTo(0.25, 9);
    expect(plan.each).toBeLessThanOrEqual(MAX_STEP);
  });

  it('always takes at least one step, even at a standstill', () => {
    expect(planSteps(0).steps).toBe(1);
    expect(planSteps(-1).steps).toBe(1);
    expect(planSteps(-1).budget).toBe(0);
  });

  it('and refuses to loop without bound on a frame nobody expected', () => {
    const plan = planSteps(600);
    expect(plan.steps).toBe(MAX_SUBSTEPS);
  });
});

describe('the ramp', () => {
  const run = (t: TravelScale, seconds: number, dt = 1 / 60): void => {
    for (let i = 0; i < Math.round(seconds / dt); i++) t.update(dt);
  };

  it('starts at real time', () => {
    const t = new TravelScale();
    expect(t.scale).toBe(1);
    expect(t.boosted).toBe(false);
  });

  it('takes about five seconds to spool up', () => {
    const t = new TravelScale();
    t.ask(true);
    run(t, RAMP_SECONDS / 2);
    expect(t.scale).toBeGreaterThan(4);
    expect(t.scale).toBeLessThan(7);
    run(t, RAMP_SECONDS / 2 + 0.2);
    expect(t.scale).toBeCloseTo(MAX_TRAVEL, 5);
  });

  it('and about five seconds to come back down', () => {
    const t = new TravelScale();
    t.ask(true);
    run(t, RAMP_SECONDS + 1);
    t.ask(false);
    run(t, RAMP_SECONDS / 2);
    expect(t.scale).toBeLessThan(7);
    expect(t.scale).toBeGreaterThan(1);
    run(t, RAMP_SECONDS / 2 + 0.2);
    expect(t.scale).toBe(1);
  });

  it('ramps on the WORLD clock, so a slow frame does not spool faster', () => {
    const fast = new TravelScale();
    const slow = new TravelScale();
    fast.ask(true);
    slow.ask(true);
    run(fast, 2, 1 / 120);
    run(slow, 2, 1 / 15);
    expect(fast.scale).toBeCloseTo(slow.scale, 1);
  });

  it('never overshoots either end', () => {
    const t = new TravelScale();
    t.ask(true);
    run(t, 30);
    expect(t.scale).toBe(MAX_TRAVEL);
    t.ask(false);
    run(t, 30);
    expect(t.scale).toBe(1);
  });
});

describe('the streaming brake', () => {
  const run = (t: TravelScale, seconds: number, dt = 1 / 60): void => {
    for (let i = 0; i < Math.round(seconds / dt); i++) t.update(dt);
  };

  it('holds her back when the terrain ahead is not ready', () => {
    // She must never accelerate into ground the game cannot answer
    // questions about. At full boost she crosses seven metres a second,
    // so terrain that had minutes now has seconds.
    const t = new TravelScale();
    t.ask(true);
    run(t, RAMP_SECONDS + 1);
    expect(t.scale).toBe(MAX_TRAVEL);
    t.capAt(3);
    run(t, RAMP_SECONDS + 1);
    expect(t.scale).toBeCloseTo(3, 5);
  });

  it('and lets her back up as coverage catches up', () => {
    const t = new TravelScale();
    t.ask(true);
    t.capAt(2);
    run(t, RAMP_SECONDS + 1);
    expect(t.scale).toBeCloseTo(2, 5);
    t.capAt(MAX_TRAVEL);
    run(t, RAMP_SECONDS + 1);
    expect(t.scale).toBe(MAX_TRAVEL);
  });

  it('eases rather than dropping, so it reads as speed and not a stutter', () => {
    const t = new TravelScale();
    t.ask(true);
    run(t, RAMP_SECONDS + 1);
    t.capAt(1);
    t.update(1 / 60);
    // One frame later she is barely slower, not stopped dead.
    expect(t.scale).toBeGreaterThan(MAX_TRAVEL - 1);
  });

  it('and the cap can never push her past the maximum or below real time', () => {
    const t = new TravelScale();
    t.ask(true);
    t.capAt(1000);
    run(t, RAMP_SECONDS + 1);
    expect(t.scale).toBe(MAX_TRAVEL);
    t.capAt(-5);
    run(t, RAMP_SECONDS + 1);
    expect(t.scale).toBe(1);
  });
});

describe('what the plan is spent on', () => {
  it('gives her ten seconds for the world\'s one, once spooled', () => {
    const t = new TravelScale();
    t.ask(true);
    for (let i = 0; i < 600; i++) t.update(1 / 60);
    const plan = t.update(1 / 60);
    expect(plan.budget).toBeCloseTo(MAX_TRAVEL / 60, 6);
  });

  it('and exactly the world\'s own time when it is not boosting', () => {
    const t = new TravelScale();
    const plan = t.update(1 / 60);
    expect(plan.budget).toBeCloseTo(1 / 60, 9);
    expect(plan.steps).toBe(1);
  });
});
