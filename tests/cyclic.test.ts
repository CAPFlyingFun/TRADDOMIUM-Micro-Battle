/**
 * SHE TIPS THE WAY SHE IS GOING.
 *
 * She had roll and no stick-driven pitch, which made her bank into
 * turns and then accelerate flat. A helicopter points its lift where
 * it wants to go; so does a flying insect, for the same reason.
 *
 * All of this is ATTITUDE — what she is drawn like. The assertions are
 * therefore about `pitch` and never about `airspeed`: tipping her must
 * not move her, or the visual has quietly become a second engine.
 */
import { describe, expect, it } from 'vitest';
import {
  Flight, MAX_PITCH, MAX_TILT, TILT_DOWN, type FlightDemand,
} from '../src/ant/flight';

const STILL: FlightDemand = { push: 0, side: 0, lift: 0 };

/** Fly her for a while on one stick position and report her attitude. */
function attitude(demand: Partial<FlightDemand>, seconds = 2): number {
  const flight = new Flight();
  flight.takeOff(60, 1, 0);
  for (let t = 0; t < seconds; t += 1 / 60) {
    flight.update({ ...STILL, ...demand }, 1, false, 1 / 60, 0);
  }
  return flight.pitch;
}

describe('the cyclic', () => {
  it('drops her nose when she is asked for speed', () => {
    expect(attitude({ push: 1 })).toBeLessThan(0);
  });

  it('raises it when she is asked to slow', () => {
    // The brake. Not reverse — ants do not fly tail-first, and thrust()
    // refuses to; this is the attitude that goes with shedding speed.
    expect(attitude({ push: -1 })).toBeGreaterThan(0);
  });

  it('tips further for more stick', () => {
    expect(attitude({ push: 1 })).toBeLessThan(attitude({ push: 0.4 }));
  });

  it('drops the nose further than it raises it', () => {
    // NOT SYMMETRY, AND ON PURPOSE. Flown on the device the brake read
    // clearly and the acceleration barely did: slowing is a flare, a
    // held attitude showing the whole underside to a camera sitting
    // behind her, while speeding up points the nose away and
    // foreshortening eats it. Half as much again to look the same.
    const down = Math.abs(attitude({ push: 1 }));
    const up = Math.abs(attitude({ push: -1 }));
    expect(down / up).toBeCloseTo(TILT_DOWN, 1);
  });

  it('reaches about the tilt it promises, and lets go again', () => {
    const flight = new Flight();
    flight.takeOff(60, 1, 0);
    for (let t = 0; t < 3; t += 1 / 60) {
      flight.update({ ...STILL, push: 1 }, 1, false, 1 / 60, 0);
    }
    const level = flight.climbing * 0.012;
    expect(flight.pitch - level).toBeCloseTo(-MAX_TILT * TILT_DOWN, 2);

    // Centre the stick and she comes back to whatever her climb says.
    for (let t = 0; t < 3; t += 1 / 60) flight.update(STILL, 1, false, 1 / 60, 0);
    expect(flight.pitch - flight.climbing * 0.012).toBeCloseTo(0, 2);
  });

  it('flies level under Auto, which is holding a speed, not gaining one', () => {
    const flight = new Flight();
    flight.takeOff(60, 1, 0);
    for (let t = 0; t < 3; t += 1 / 60) {
      flight.update({ ...STILL, hold: 40 }, 1, false, 1 / 60, 0);
    }
    expect(flight.pitch - flight.climbing * 0.012).toBeCloseTo(0, 3);
  });

  it('is never drawn standing on its nose', () => {
    // The climb term is unbounded by construction, so the clamp is the
    // only thing between a long dive and a model pointed at the floor.
    const flight = new Flight();
    flight.takeOff(60, 1, 0);
    for (let t = 0; t < 40; t += 1 / 60) {
      flight.update({ ...STILL, push: 1, lift: -1 }, 1, false, 1 / 60, 0);
    }
    expect(Math.abs(flight.pitch)).toBeLessThanOrEqual(MAX_PITCH + 1e-9);
  });

  it('does not become a second engine', () => {
    // Attitude is drawn, not flown. Pulling back must SLOW her, and
    // the nose-up that goes with it must not add anything back.
    const flight = new Flight();
    flight.takeOff(60, 1, 0);
    const from = flight.airspeed;
    for (let t = 0; t < 1; t += 1 / 60) {
      flight.update({ ...STILL, push: -1 }, 1, false, 1 / 60, 0);
    }
    expect(flight.airspeed).toBeLessThan(from);
    expect(flight.airspeed).toBeGreaterThanOrEqual(0);
  });
});
