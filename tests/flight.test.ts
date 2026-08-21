/**
 * Written against FLIGHT.md's own probe list and invariants, so the
 * tests say what the DESIGN says rather than what the code happens to
 * do. Where a number here disagrees with the module, the design wins.
 */
import { describe, expect, it } from 'vitest';
import { afterEach } from 'vitest';
import {
  BEST_GLIDE_RATIO, BEST_GLIDE_SPEED, CRUISE_SPEED, Flight, FLIGHT_TURN_RATE,
  glideRatio, MAX_BANK, MAX_DIVE_SPEED, MAX_POWERED_SPEED, setFlightScale,
  SIDESTEP_SHARE, STALL_SPEED, TAKEOFF_COST, TAKEOFF_SPEED, THRUST,
  TURN_SHARE, type FlightDemand,
} from '../src/ant/flight';
import { PACE_SPEED, SPEED_EASE } from '../src/ant/pace';
import { REARM_AT, Stamina } from '../src/ant/stamina';

const neutral: FlightDemand = { push: 0, side: 0, climb: false, descend: false };
const forward: FlightDemand = { ...neutral, push: 1 };
const climbing: FlightDemand = { ...forward, climb: true };
const diving: FlightDemand = { ...neutral, descend: true };

afterEach(() => setFlightScale(1));

/** Get her airborne and up to a given airspeed. */
function flying(speed = CRUISE_SPEED): Flight {
  const f = new Flight();
  f.takeOff(TAKEOFF_SPEED, 1, 0);
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
    expect(f.takeOff(TAKEOFF_SPEED * 2, TAKEOFF_COST / 2, 0)).toBe(0);
    expect(f.aloft).toBe(false);
  });

  it('keeps her momentum instead of teleporting her upward', () => {
    const f = new Flight();
    const ran = 14;
    expect(f.takeOff(ran, 1, 0)).toBe(TAKEOFF_COST);
    expect(f.airspeed).toBeGreaterThan(ran);
    // Off the ground, but only just: no launch.
    expect(f.height).toBeLessThan(1);
  });

  it('becomes ordinary flight once she is properly up', () => {
    const f = new Flight();
    f.takeOff(TAKEOFF_SPEED * 2, 1, 0);
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

describe('the speed dial', () => {
  /** Seconds of full stick to reach a fraction of the top speed. */
  const timeToSpeed = (fraction: number) => {
    const f = new Flight();
    f.takeOff(TAKEOFF_SPEED, 1, 0);
    const target = MAX_POWERED_SPEED * flightScaleNow() * fraction;
    for (let i = 0; i < 6000; i++) {
      f.update(forward, 1, false, 1 / 120);
      if (f.airspeed >= target) return i / 120;
    }
    return Infinity;
  };
  const flightScaleNow = () => {
    // Read the scale back through the model rather than tracking it
    // here, so the test cannot disagree with what was actually set.
    const f = new Flight();
    f.takeOff(TAKEOFF_SPEED, 1, 0);
    for (let i = 0; i < 4000; i++) f.update(forward, 1, false, 1 / 120);
    return f.airspeed / MAX_POWERED_SPEED;
  };

  it('changes the tempo without changing the shape', () => {
    // Scaling speeds AND accelerations together means the time to reach
    // full speed is the same at every setting. A dial that moved the
    // top speed alone would quietly retune the acceleration too, which
    // is the exact feel being tuned.
    setFlightScale(1);
    const normal = timeToSpeed(0.9);
    setFlightScale(2);
    const quick = timeToSpeed(0.9);
    setFlightScale(0.5);
    const slow = timeToSpeed(0.9);
    // Within a sixth of each other rather than identical: the takeoff
    // speed deliberately does NOT scale, so at a high setting she
    // starts from proportionally less and takes a little longer to
    // reach the same fraction of a higher top speed. That is the dial
    // being right, not the tempo drifting.
    for (const [name, at] of [['fast', quick], ['slow', slow]] as const) {
      expect(Math.abs(at - normal) / normal, `${name}: ${at.toFixed(2)}s vs ${normal.toFixed(2)}s`)
        .toBeLessThan(0.17);
    }
  });

  it('actually moves the top speed', () => {
    setFlightScale(2);
    expect(flightScaleNow()).toBeCloseTo(2, 1);
    setFlightScale(0.5);
    expect(flightScaleNow()).toBeCloseTo(0.5, 1);
  });

  it('leaves the glide ratio alone — a shape, not a speed', () => {
    setFlightScale(1);
    const best = glideRatio(BEST_GLIDE_SPEED);
    setFlightScale(2);
    expect(glideRatio(BEST_GLIDE_SPEED * 2)).toBeCloseTo(best, 6);
    setFlightScale(0.4);
    expect(glideRatio(BEST_GLIDE_SPEED * 0.4)).toBeCloseTo(best, 6);
  });

  it('leaves the takeoff threshold alone — that is a GROUND speed', () => {
    const f = new Flight();
    setFlightScale(2);
    expect(f.canTakeOff(TAKEOFF_SPEED, 1)).toBe(true);
    expect(f.canTakeOff(TAKEOFF_SPEED - 0.1, 1)).toBe(false);
  });
});

describe('acceleration', () => {
  it('builds speed rather than arriving at it', () => {
    // Thrust was 34, which took her from a walk to top speed in about
    // two seconds and read as a missile launch. This is the check that
    // says how long it should take, so a future retune has to argue
    // with a number rather than with a memory.
    const f = new Flight();
    f.takeOff(TAKEOFF_SPEED, 1, 0);
    let seconds = Infinity;
    for (let i = 0; i < 3000; i++) {
      f.update(forward, 1, false, 1 / 120);
      if (f.airspeed >= MAX_POWERED_SPEED * 0.9) { seconds = i / 120; break; }
    }
    expect(seconds).toBeGreaterThan(3);
    expect(seconds).toBeLessThan(12);
    expect(THRUST).toBeLessThan(20);
  });
});

describe('the coordinated turn', () => {
  const rightStick: FlightDemand = { ...neutral, push: 1, side: 1 };

  it('banks into the turn, up to thirty degrees', () => {
    const f = flying();
    for (let i = 0; i < 120; i++) f.update(rightStick, 1, false, 1 / 60);
    expect(f.roll).toBeCloseTo(MAX_BANK, 2);
    expect((MAX_BANK * 180) / Math.PI).toBeCloseTo(30, 6);
  });

  it('levels out when the stick centres', () => {
    // Half of what makes it feel like a wing rather than a cursor.
    const f = flying();
    for (let i = 0; i < 120; i++) f.update(rightStick, 1, false, 1 / 60);
    expect(Math.abs(f.roll)).toBeGreaterThan(0.4);
    for (let i = 0; i < 180; i++) f.update(forward, 1, false, 1 / 60);
    expect(Math.abs(f.roll)).toBeLessThan(0.02);
  });

  it('actually turns her, rather than sliding her sideways', () => {
    const f = flying();
    const was = f.heading;
    for (let i = 0; i < 60; i++) f.update(rightStick, 1, false, 1 / 60);
    // A second of full stick at the 70% share.
    expect(Math.abs(f.heading - was)).toBeCloseTo(FLIGHT_TURN_RATE * TURN_SHARE, 2);
  });

  it('turns the same way it slips — the sign bug that reached the device', () => {
    // My first version had these opposite: a positive heading turns her
    // toward +X while the slip term pushes toward -X, so the stick
    // steered her the wrong way while the 30% sidestep fought the turn
    // it was supposed to be part of. Sign conventions are exactly the
    // thing to assert as a RELATIONSHIP rather than as a number, since
    // asserting the number is how the wrong one got a passing test.
    const f = flying();
    const was = f.heading;
    const step = f.update(rightStick, 1, false, 1 / 60);
    const turnedToward = Math.sign(f.heading - was);
    // `across` is applied along (facing - PI/2), which is the opposite
    // sense to a rising heading — hence the negation here.
    const slippedToward = -Math.sign(step.across);
    expect(turnedToward).toBe(slippedToward);
  });

  it('splits a lateral input 70 turn / 30 slip', () => {
    const f = flying();
    const step = f.update(rightStick, 1, false, 1 / 60);
    expect(step.across / step.ahead).toBeCloseTo(SIDESTEP_SHARE, 6);
    expect(TURN_SHARE + SIDESTEP_SHARE).toBeCloseTo(1, 6);
  });

  it('banks and turns the other way for the other way', () => {
    const f = flying();
    const was = f.heading;
    const right = flying();
    for (let i = 0; i < 60; i++) right.update(rightStick, 1, false, 1 / 60);
    for (let i = 0; i < 60; i++) {
      f.update({ ...neutral, push: 1, side: -1 }, 1, false, 1 / 60);
    }
    // Mirrored, whichever way the engine's signs happen to run.
    expect(Math.sign(f.heading - was)).toBe(-Math.sign(right.heading - was));
    expect(f.roll).toBeLessThan(0);
  });

  it('keeps her heading when the camera is not touching it', () => {
    // The point of flying where she is pointed: nothing outside the
    // stick may turn her, so the player can look around freely.
    const f = flying();
    const held = f.heading;
    for (let i = 0; i < 300; i++) f.update(forward, 1, false, 1 / 60);
    expect(f.heading).toBe(held);
  });

  it('takes the heading she was running on, and does not turn her', () => {
    const f = new Flight();
    f.takeOff(TAKEOFF_SPEED, 1, 1.234);
    expect(f.heading).toBe(1.234);
    expect(f.roll).toBe(0);
  });

  it('pitches her nose with what she is doing vertically', () => {
    const f = flying();
    for (let i = 0; i < 60; i++) f.update({ ...neutral, climb: true }, 1, false, 1 / 60);
    const up = f.pitch;
    for (let i = 0; i < 60; i++) f.update(diving, 1, false, 1 / 60);
    expect(f.pitch).toBeLessThan(up);
  });
});
