/**
 * Written against FLIGHT.md's own probe list and invariants, so the
 * tests say what the DESIGN says rather than what the code happens to
 * do. Where a number here disagrees with the module, the design wins.
 */
import { describe, expect, it } from 'vitest';
import {
  BEST_GLIDE_RATIO, BEST_GLIDE_SPEED, CRUISE_SPEED, Flight, glideRatio,
  MAX_DIVE_SPEED, STALL_SPEED, TAKEOFF_COST, TAKEOFF_SPEED,
  type FlightDemand,
} from '../src/ant/flight';
import { PACE_SPEED, SPEED_EASE } from '../src/ant/pace';
import { REARM_AT, Stamina } from '../src/ant/stamina';

const neutral: FlightDemand = { push: 0, side: 0, climb: false, descend: false };
const forward: FlightDemand = { ...neutral, push: 1 };
const climbing: FlightDemand = { ...forward, climb: true };
const diving: FlightDemand = { ...neutral, descend: true };

/** Get her airborne and up to a given airspeed. */
function flying(speed = CRUISE_SPEED): Flight {
  const f = new Flight();
  f.takeOff(TAKEOFF_SPEED, 1, 1, 0);
  for (let i = 0; i < 600 && (f.airspeed < speed || f.where === 'takeoff'); i++) {
    f.update(forward, 1, false, 1 / 60);
  }
  return f;
}

describe('takeoff', () => {
  it('is reachable at a WALK, which the ease nearly made impossible', () => {
    // The threshold was set to exactly full walk speed. Her ground
    // speed eases onto the pace ceiling exponentially, so it APPROACHES
    // 7 and never arrives — a walk could never take off, only a run.
    // The design is explicit that a proper walk must be enough.
    //
    // So this measures the real ease rather than comparing constants:
    // a second of walking from a standstill has to clear the bar.
    expect(TAKEOFF_SPEED).toBeLessThan(PACE_SPEED.walk);
    let speed = 0;
    for (let i = 0; i < 60; i++) {
      speed += (PACE_SPEED.walk - speed) * (1 - Math.exp(-SPEED_EASE / 60));
    }
    expect(speed).toBeGreaterThan(TAKEOFF_SPEED);
  });

  it('is out of reach at a crawl, as the design intends', () => {
    expect(PACE_SPEED.crawl).toBeLessThan(TAKEOFF_SPEED);
  });

  it('needs ACTUAL speed, not the pace she picked', () => {
    // The design is explicit: Run selected but barely moving must not
    // offer a takeoff, and a real walk that reaches the threshold must.
    const f = new Flight();
    expect(f.canTakeOff(TAKEOFF_SPEED - 0.1, 1)).toBe(false);
    expect(f.canTakeOff(TAKEOFF_SPEED, 1)).toBe(true);
  });

  it('is refused when there is nothing to pay with', () => {
    const f = new Flight();
    expect(f.canTakeOff(TAKEOFF_SPEED * 2, TAKEOFF_COST / 2)).toBe(false);
    expect(f.takeOff(TAKEOFF_SPEED * 2, TAKEOFF_COST / 2, 1, 0)).toBe(0);
    expect(f.aloft).toBe(false);
  });

  it('keeps her momentum instead of teleporting her upward', () => {
    const f = new Flight();
    const ran = 14;
    expect(f.takeOff(ran, 1, 1, 0)).toBe(TAKEOFF_COST);
    expect(f.airspeed).toBeGreaterThan(ran);
    // Off the ground, but only just: no launch.
    expect(f.height).toBeLessThan(1);
  });

  it('becomes ordinary flight once she is properly up', () => {
    const f = new Flight();
    f.takeOff(TAKEOFF_SPEED * 2, 1, 1, 0);
    expect(f.where).toBe('takeoff');
    for (let i = 0; i < 120; i++) f.update(forward, 1, false, 1 / 60);
    expect(f.where).not.toBe('takeoff');
    expect(f.aloft).toBe(true);
  });
});

describe('the glide curve', () => {
  it('is flattest at the best-glide speed', () => {
    expect(glideRatio(BEST_GLIDE_SPEED)).toBeCloseTo(BEST_GLIDE_RATIO, 6);
    expect(glideRatio(BEST_GLIDE_SPEED * 0.6)).toBeLessThan(BEST_GLIDE_RATIO);
    expect(glideRatio(MAX_DIVE_SPEED)).toBeLessThan(BEST_GLIDE_RATIO);
  });

  it('collapses at very low airspeed, rather than easing off', () => {
    // The design's point: a queen who lets her airspeed decay does not
    // drift gently down, she falls out of the sky.
    expect(glideRatio(STALL_SPEED * 0.5)).toBeLessThan(1);
    expect(glideRatio(1)).toBeLessThan(0.5);
  });

  it('is smooth, with no band edges to fall off', () => {
    // Continuity, not small steps. My first version of this asserted
    // that no half-unit step changed the ratio by much, which is a
    // claim about STEEPNESS — and the curve is legitimately steep just
    // below best glide, so it failed on a healthy stretch.
    //
    // What a band edge actually looks like is a jump that stays the
    // same size however finely you sample it. So: halve the sampling
    // step and the biggest jump must halve too.
    const biggestJump = (step: number) => {
      let worst = 0;
      for (let v = 0; v + step <= MAX_DIVE_SPEED; v += step) {
        worst = Math.max(worst, Math.abs(glideRatio(v + step) - glideRatio(v)));
      }
      return worst;
    };
    const coarse = biggestJump(0.4);
    const fine = biggestJump(0.1);
    expect(fine).toBeLessThan(coarse * 0.35);
  });

  it('never promises something for nothing', () => {
    for (let v = 0; v <= MAX_DIVE_SPEED; v += 1) {
      expect(glideRatio(v), `at ${v}`).toBeGreaterThan(0);
      expect(glideRatio(v), `at ${v}`).toBeLessThanOrEqual(BEST_GLIDE_RATIO);
    }
  });
});

describe('neutral is a glide, not a hover', () => {
  it('keeps her moving after the stick is let go', () => {
    const f = flying();
    const was = f.airspeed;
    f.update(neutral, 1, false, 1 / 60);
    expect(f.airspeed).toBeGreaterThan(was * 0.9);
  });

  it('costs her height for the distance', () => {
    const f = flying();
    const high = f.height;
    for (let i = 0; i < 60; i++) f.update(neutral, 1, false, 1 / 60);
    expect(f.height).toBeLessThan(high);
    expect(f.where).toBe('glide');
  });

  it('trades roughly the ratio the curve promises', () => {
    // Fly the real thing at best glide and measure what it actually
    // does, rather than trusting the function it was built from.
    const f = flying(BEST_GLIDE_SPEED);
    let forwardUnits = 0;
    const from = f.height;
    for (let i = 0; i < 120; i++) {
      const step = f.update(neutral, 1, false, 1 / 60);
      forwardUnits += Math.hypot(step.ahead, step.across) / 60;
    }
    const dropped = from - f.height;
    expect(forwardUnits / dropped).toBeGreaterThan(BEST_GLIDE_RATIO * 0.7);
  });
});

describe('altitude is stored energy', () => {
  it('turns height into airspeed on the way down', () => {
    const f = flying(BEST_GLIDE_SPEED);
    const was = f.airspeed;
    for (let i = 0; i < 60; i++) f.update(diving, 1, false, 1 / 60);
    expect(f.airspeed).toBeGreaterThan(was);
    expect(f.climbing).toBeLessThan(0);
  });

  it('takes airspeed back on the way up', () => {
    const f = flying();
    const was = f.airspeed;
    for (let i = 0; i < 60; i++) f.update({ ...neutral, climb: true }, 1, false, 1 / 60);
    expect(f.airspeed).toBeLessThan(was);
    expect(f.climbing).toBeGreaterThan(0);
  });

  it('charges more for a climb than for a cruise', () => {
    const f = flying();
    const cruise = f.update(forward, 1, false, 1 / 60).effort;
    const climb = f.update(climbing, 1, false, 1 / 60).effort;
    expect(climb).toBeGreaterThan(cruise);
  });

  it('pays her back for gliding, and more for diving to recover', () => {
    const f = flying();
    const glide = f.update(neutral, 1, false, 1 / 60).effort;
    expect(glide).toBeLessThan(0);
    const desperate = f.update(diving, 0.05, false, 1 / 60).effort;
    expect(desperate).toBeLessThan(glide);
  });
});

describe('an empty reserve does not switch the wings off', () => {
  it('leaves her steerable and sinking, not falling like a brick', () => {
    const f = flying();
    for (let i = 0; i < 60; i++) f.update(forward, 0, true, 1 / 60);
    expect(f.where).toBe('exhausted');
    expect(f.aloft).toBe(true);
    expect(f.climbing).toBeLessThan(0);
    // Still moving forward under her own steam.
    expect(f.airspeed).toBeGreaterThan(0);
  });

  it('refuses to climb on an empty reserve', () => {
    const f = flying();
    for (let i = 0; i < 30; i++) f.update(climbing, 0, true, 1 / 60);
    expect(f.climbing).toBeLessThan(0);
  });

  it('still lets her dive, which is the way out', () => {
    const f = flying(BEST_GLIDE_SPEED);
    const was = f.airspeed;
    for (let i = 0; i < 60; i++) f.update(diving, 0, true, 1 / 60);
    expect(f.airspeed).toBeGreaterThan(was);
    expect(f.where).toBe('recovery');
  });
});

describe('the recovery descent', () => {
  it('gets her flying again from empty, if she has the height', () => {
    // The loop the design calls the core flight mechanic: empty, dive,
    // airspeed builds, the reserve comes back, powered flight returns.
    const stamina = new Stamina();
    stamina.spend(1);
    expect(stamina.spent).toBe(true);

    const f = flying();
    for (let i = 0; i < 60 * 60; i++) {
      const step = f.update(diving, stamina.fraction, stamina.spent, 1 / 60);
      stamina.update(step.effort, 1 / 60);
      if (!stamina.spent) break;
    }
    expect(stamina.spent).toBe(false);
    expect(stamina.fraction).toBeGreaterThanOrEqual(REARM_AT);
  });

  it('costs height to do it — altitude is the price of the rescue', () => {
    const f = flying();
    const high = f.height;
    for (let i = 0; i < 120; i++) f.update(diving, 0, true, 1 / 60);
    expect(f.height).toBeLessThan(high);
  });
});

describe('she does not fly tail-first', () => {
  it('treats a backward push as a brake', () => {
    const f = flying();
    const was = f.airspeed;
    for (let i = 0; i < 30; i++) f.update({ ...neutral, push: -1 }, 1, false, 1 / 60);
    expect(f.airspeed).toBeLessThan(was);
    expect(f.airspeed).toBeGreaterThanOrEqual(0);
  });

  it('never drives the airspeed negative', () => {
    const f = flying(STALL_SPEED);
    for (let i = 0; i < 600; i++) f.update({ ...neutral, push: -1 }, 1, false, 1 / 60);
    expect(f.airspeed).toBeGreaterThanOrEqual(0);
  });
});

describe('the ground', () => {
  it('does nothing at all until she takes off', () => {
    const f = new Flight();
    const step = f.update(climbing, 1, false, 1 / 60);
    expect(step).toEqual({ effort: 0, ahead: 0, across: 0, rise: 0 });
    expect(f.height).toBe(0);
  });

  it('comes back to rest when she lands', () => {
    const f = flying();
    f.land();
    expect(f.where).toBe('grounded');
    expect(f.height).toBe(0);
    expect(f.airspeed).toBe(0);
  });
});
