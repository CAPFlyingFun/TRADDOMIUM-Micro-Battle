import { describe, expect, it, afterEach } from 'vitest';
import {
  AUTO_AIRSPEED, BEST_GLIDE_SPEED, Flight, LAUNCH_RATE, LAUNCH_SECONDS,
  MAX_POWERED_SPEED, setFlightScale, SPRINT_AIRSPEED, STALL_SPEED,
  TAKEOFF_SPEED, type FlightDemand,
} from '../src/ant/flight';

afterEach(() => setFlightScale(1));
// A queen leaving the ground is pushing forward. Flown on neutral she
// has no thrust, stalls within half a second and sinks — which is the
// model being right, not the ramp being wrong.
const forward: FlightDemand = { push: 1, side: 0, lift: 0 };

/**
 * FOUR ROWS, FOUR QUARTERS.
 *
 * The pace lever has always had four cells and the air only ever had
 * three speeds, because sprint is a toggle beside the pace rather than
 * a fourth pace. The top row lit while the ceiling stayed on the row
 * underneath it, so a queen at maximum flew at CRUISE_SPEED — 40 of a
 * possible 70, which the power readout rounded to its 60% notch.
 */
describe('the pace ladder in the air', () => {
  it('gives each row its own quarter of full power', () => {
    expect(AUTO_AIRSPEED.crawl).toBeCloseTo(17.5, 6);
    expect(AUTO_AIRSPEED.walk).toBeCloseTo(35, 6);
    expect(AUTO_AIRSPEED.run).toBeCloseTo(52.5, 6);
    expect(SPRINT_AIRSPEED).toBeCloseTo(70, 6);
  });

  it('reaches the model maximum on the top row, and only there', () => {
    expect(SPRINT_AIRSPEED).toBe(MAX_POWERED_SPEED);
    for (const row of Object.values(AUTO_AIRSPEED)) {
      expect(row).toBeLessThan(MAX_POWERED_SPEED);
    }
  });

  it('rises strictly, so a higher row is always more speed', () => {
    const ladder = [AUTO_AIRSPEED.crawl, AUTO_AIRSPEED.walk,
      AUTO_AIRSPEED.run, SPRINT_AIRSPEED];
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
    }
  });

  it('puts the bottom rung where it descends by its own nature', () => {
    // Above the stall, so she is still flying; below best glide, so she
    // cannot hold her height. CRAWL/DESCEND means what it says.
    expect(AUTO_AIRSPEED.crawl).toBeGreaterThan(STALL_SPEED);
    expect(AUTO_AIRSPEED.crawl).toBeLessThan(BEST_GLIDE_SPEED);
  });
});

/**
 * THE WINGS TAKE HER WEIGHT; THEY DO NOT THROW HER.
 *
 * takeOff used to hand her half the climb rate on its first frame —
 * eight centimetres a second, from nothing, in nothing. (Joshua: "as
 * soon as I lift off from the ground I shoot up to +10cm in less than
 * 0.1s ... doesn't feel like it at ground level".)
 */
describe('leaving the ground', () => {
  /** Take off and step for `seconds`, returning height and rate. */
  function launch(seconds: number): { above: number; rise: number } {
    const f = new Flight();
    f.takeOff(TAKEOFF_SPEED, 1, 0);
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) f.update(forward, 1, false, 1 / 60, 0);
    return { above: f.height, rise: f.climbing };
  }

  it('is barely off the ground after a tenth of a second', () => {
    // The old behaviour put 8 cm/s on the very first frame, which
    // reached 10 cm in well under a second and read as a launch.
    const early = launch(0.1);
    expect(early.above).toBeLessThan(1);
    expect(early.rise).toBeLessThan(LAUNCH_RATE * 0.1);
  });

  it('reaches about ten centimetres at one second', () => {
    // The mean of a smoothstep is exactly a half, so the height at one
    // second is LAUNCH_RATE x 0.5 x 1.
    const one = launch(LAUNCH_SECONDS);
    expect(one.above).toBeGreaterThan(7);
    expect(one.above).toBeLessThan(13);
  });

  it('accelerates into the climb rather than starting at speed', () => {
    const a = launch(0.25);
    const b = launch(0.5);
    const c = launch(1);
    // 20 x smoothstep: 3.1 at a quarter, 10 at a half, 20 at one.
    expect(a.rise).toBeCloseTo(LAUNCH_RATE * 0.15625, 0);
    expect(b.rise).toBeCloseTo(LAUNCH_RATE * 0.5, 0);
    expect(a.rise).toBeLessThan(b.rise);
    expect(b.rise).toBeLessThan(c.rise);
  });

  it('is still climbing once the ramp has opened', () => {
    const done = launch(LAUNCH_SECONDS + 0.5);
    expect(done.above).toBeGreaterThan(launch(LAUNCH_SECONDS).above);
  });
});
