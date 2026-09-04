import { readFileSync } from 'node:fs';
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

describe('a takeoff keeps the height she already had', () => {
  /**
   * Joshua, v0.0.161: "I was able to fly off the tree the last update
   * not this one."
   *
   * All three doors out of `grounded` — takeOff, launch and the drone
   * liftOff — set her clearance to a flat 0.01, on the unexamined
   * assumption that leaving the ground means being ON the ground. It
   * held for as long as the ground was the only thing she could stand
   * on. A queen three metres up a trunk taking off was put on the
   * grass in one frame, which is not a flight bug so much as the
   * flight model being told a lie about where she was.
   */
  it('a ground takeoff still starts a centimetre up', () => {
    const flight = new Flight();
    expect(flight.takeOff(TAKEOFF_SPEED, 1, 0, 0)).toBeGreaterThan(0);
    expect(flight.height).toBeCloseTo(0.01, 6);
  });

  it('a takeoff from three metres up a trunk starts three metres up', () => {
    const flight = new Flight();
    expect(flight.takeOff(TAKEOFF_SPEED, 1, 0, 300)).toBeGreaterThan(0);
    expect(flight.height).toBeCloseTo(300, 6);
  });

  it('and so does a water launch and a drone lift', () => {
    const wet = new Flight();
    expect(wet.launch(1, 0, 250)).toBeGreaterThan(0);
    expect(wet.height).toBeCloseTo(250, 6);

    const drone = new Flight();
    expect(drone.liftOff(1, 0, false, 250)).toBeGreaterThan(0);
    expect(drone.height).toBeCloseTo(250, 6);
  });

  it('never starts her BELOW the floor, whatever it is handed', () => {
    const flight = new Flight();
    flight.takeOff(TAKEOFF_SPEED, 1, 0, -50);
    expect(flight.height).toBeCloseTo(0.01, 6);
  });
});

describe('and the scene actually hands her clearance over', () => {
  /**
   * A SOURCE PIN. The tests above prove the flight model honours the
   * height it is given; they say nothing about whether anything gives
   * it one, and a default of 0 would sail through every one of them.
   * That gap — a true statement about a helper beside a call site that
   * does not use it — is the shape of three broken builds this week.
   */
  it('passes her clearance to every door out of grounded', () => {
    const scene = readFileSync('src/scenes/IslandScene.ts', 'utf8');
    expect(scene).toContain('private clearance(): number {');
    expect(scene).toContain('this.ant.height - this.holdFloor');
    // All three doors, each with the clearance on the end.
    expect(scene).toMatch(/flight\.launch\([^)]*this\.clearance\(\)/s);
    expect(scene).toMatch(/flight\.takeOff\([^)]*this\.clearance\(\)/s);
    expect(scene).toMatch(/flight\.liftOff\([^)]*this\.clearance\(\)/s);
  });
});
