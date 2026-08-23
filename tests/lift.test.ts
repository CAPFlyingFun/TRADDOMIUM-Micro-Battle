/**
 * THE LEVER, AND WHY IT REPLACED TWO BUTTONS.
 *
 * Reported from the device: caught by a rising wind in the mountains,
 * she could not get down. That was not a wind bug — it was that full
 * descent WAS 26 cm/s, a fixed number the button could not exceed, and
 * there was nothing left to press. Two booleans can only ever ask for
 * one rate.
 *
 * So the vertical demand is a signed amount, and what it is worth
 * winds up the longer it is held: a tap is a nudge, a held stop is
 * three metres a second. Both halves matter — without the ceiling she
 * still cannot escape a thermal, and without the ramp full deflection
 * throws her twenty metres in the first second.
 */
import { describe, expect, it } from 'vitest';
import {
  Flight, LIFT_MAX, LIFT_RAMP, LIFT_START, MAX_POWERED_SPEED,
  liftAuthority, powerOf, setFlightScale, type FlightDemand,
} from '../src/ant/flight';

const STILL: FlightDemand = { push: 0, side: 0, lift: 0 };
const TICK = 1 / 60;

function flown(demand: Partial<FlightDemand>, seconds: number): Flight {
  const flight = new Flight();
  flight.takeOff(60, 1, 0);
  for (let t = 0; t < seconds; t += TICK) {
    flight.update({ ...STILL, ...demand }, 1, false, TICK, 0);
  }
  return flight;
}

describe('what the lever is worth', () => {
  it('starts gentle', () => {
    expect(liftAuthority(1, 0)).toBeCloseTo(LIFT_START, 6);
  });

  it('and ends where a queen can outclimb a hill', () => {
    expect(liftAuthority(1, LIFT_RAMP)).toBeCloseTo(LIFT_MAX, 6);
    expect(liftAuthority(-1, LIFT_RAMP)).toBeCloseTo(-LIFT_MAX, 6);
  });

  it('arrives late rather than evenly', () => {
    // SQUARED on the way up: at the halfway point of the ramp she has
    // a quarter of the extra authority, not half. That is what stops
    // a shove from being a teleport.
    const half = liftAuthority(1, LIFT_RAMP / 2);
    const even = LIFT_START + (LIFT_MAX - LIFT_START) / 2;
    expect(half).toBeLessThan(even);
    expect(half).toBeCloseTo(LIFT_START + (LIFT_MAX - LIFT_START) * 0.25, 6);
  });

  it('is proportional, so a half push is half the rate', () => {
    expect(liftAuthority(0.5, LIFT_RAMP)).toBeCloseTo(LIFT_MAX / 2, 6);
  });
});

describe('flying it', () => {
  it('does not throw her skyward in the first second', () => {
    // The complaint that goes the other way, and the reason for the
    // ramp: full deflection must not be 0 to 20 m in a second.
    const flight = flown({ lift: 1 }, 1);
    expect(flight.height).toBeLessThan(100);
  });

  it('but gets her out of a thermal if she holds it', () => {
    // The reported bug. A sustained descent has to beat anything the
    // old fixed 26 cm/s could not.
    const flight = flown({ lift: -1 }, LIFT_RAMP + 2);
    expect(flight.climbing).toBeLessThan(-200);
  });

  it('lets go gradually rather than stopping dead', () => {
    const flight = flown({ lift: -1 }, LIFT_RAMP);
    const diving = flight.climbing;
    flight.update(STILL, 1, false, TICK, 0);
    expect(flight.climbing).toBeGreaterThan(diving);
    expect(flight.climbing).toBeLessThan(0);
  });

  it('starts gentle again after a change of mind', () => {
    // Hold time is signed, so reversing does not inherit the
    // authority she wound up going the other way.
    const flight = flown({ lift: -1 }, LIFT_RAMP);
    const hard = flight.climbing;
    for (let t = 0; t < 0.2; t += TICK) {
      flight.update({ ...STILL, lift: 1 }, 1, false, TICK, 0);
    }
    expect(flight.climbing).toBeGreaterThan(hard);
    expect(flight.climbing).toBeLessThan(LIFT_START);
  });
});

describe('the power readout', () => {
  it('reads the pace she is actually held to', () => {
    // THE REPORTED BUG: stuck at 100% on the lowest row. The pace
    // ceiling did not reach the stick, so every row flew the same.
    const slow = flown({ push: 1, ceiling: 20 }, 6);
    const fast = flown({ push: 1, ceiling: MAX_POWERED_SPEED }, 6);
    expect(powerOf(slow.airspeed)).toBeLessThan(powerOf(fast.airspeed));
    expect(powerOf(fast.airspeed)).toBe(100);
  });

  it('and does not saturate when the tempo dial is up', () => {
    // THE OTHER HALF OF IT. `scale` moves the real cap, so a
    // percentage against the unscaled maximum sat at 100% for two
    // thirds of the dial's range.
    try {
      setFlightScale(2);
      // Half the real cap, which lands on the 60 notch rather than a
      // 50 that does not exist — there are five of them, not ten.
      expect(powerOf(MAX_POWERED_SPEED)).toBe(60);
      expect(powerOf(MAX_POWERED_SPEED * 2)).toBe(100);
    } finally {
      setFlightScale(1);
    }
  });
});
