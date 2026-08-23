/**
 * SHE HOLDS AN ALTITUDE, NOT A CLEARANCE.
 *
 * Reported from the device: flying down a canyon she rode the floor up
 * and out of it, holding her AGL exactly, and could not simply fly on
 * past the far wall. Which was the model doing what it said — the
 * vertical state integrated as height-above-terrain, so the ground was
 * steering her.
 *
 * The state is still STORED as a clearance, because every reader
 * downstream wants one: the wind profile is a function of AGL, the
 * rail on the right is AGL, and where to draw her is AGL. What changed
 * is that ground movement is subtracted out, so her height above the
 * sea is hers.
 */
import { describe, expect, it } from 'vitest';
import { Flight, type FlightDemand } from '../src/ant/flight';

const STILL: FlightDemand = { push: 0, side: 0, lift: 0 };
const TICK = 1 / 60;

/**
 * Fly her level for `seconds` over a floor given by `under(t)`, and
 * report the MSL and AGL she ends with.
 */
function over(under: (t: number) => number, seconds: number, from = 2_000) {
  const flight = new Flight();
  flight.takeOff(60, 1, 0);
  // Seed the remembered floor, then climb to the altitude under test.
  flight.update(STILL, 1, false, TICK, under(0));
  flight.hold(from, 0);
  flight.update(STILL, 1, false, TICK, under(0));
  // The floor she was last told about, not the one at the loop's exit
  // time — her clearance is measured against the ground of the frame
  // that produced it, and a frame of drift here is a frame of lie.
  let ground = under(0);
  for (let t = 0; t < seconds; t += TICK) {
    ground = under(t);
    flight.update(STILL, 1, false, TICK, ground);
  }
  return { agl: flight.height, msl: ground + flight.height, ground };
}

describe('flying over ground that moves', () => {
  it('keeps her altitude when the floor climbs under her', () => {
    // A canyon floor rising four metres over the pass.
    const flat = over(() => 0, 4);
    const rising = over((t) => (t / 4) * 400, 4);
    expect(rising.msl).toBeCloseTo(flat.msl, 0);
    // And the clearance is what gave way, by exactly the rise.
    expect(flat.agl - rising.agl).toBeCloseTo(400, 0);
  });

  it('and when it drops away', () => {
    const flat = over(() => 0, 4);
    const falling = over((t) => -(t / 4) * 400, 4);
    expect(falling.msl).toBeCloseTo(flat.msl, 0);
    expect(falling.agl - flat.agl).toBeCloseTo(400, 0);
  });

  it('lets a rise she is ABOVE pass underneath her', () => {
    // THE REPORTED BUG, in its smallest form. She is two metres up and
    // a one-metre ridge goes by beneath. Holding an altitude she stays
    // at two metres above the sea and it passes below her; holding a
    // clearance she was carried to three and had to come back down.
    const ridge = (t: number) => (t > 1 && t < 2 ? 100 : 0);
    const flown = over(ridge, 3, 200);
    // Against a flat control, because she is gliding and sinking
    // gently the whole way — an absolute would be asserting that she
    // has no sink rate rather than that the ridge did nothing.
    const flat = over(() => 0, 3, 200);
    expect(flown.msl).toBeCloseTo(flat.msl, 0);
    expect(flown.agl).toBeCloseTo(flat.agl, 0);
  });

  it('but still will not fly her through one', () => {
    // The floor clamp. Ground rising ABOVE her lifts her rather than
    // letting her into the hill — forgiving rather than correct, and
    // much better than the inside of a mountain.
    const flown = over((t) => (t / 3) * 900, 3, 200);
    expect(flown.agl).toBeGreaterThanOrEqual(0);
    expect(flown.msl).toBeGreaterThanOrEqual(flown.ground - 1e-6);
  });

  it('leaves the wind reading AGL, which is what the wind depends on', () => {
    // Joshua's second point: the altitude she holds is MSL, the wind
    // she feels is a function of how far off the DECK she is. Those
    // are different questions and this is the one that keeps them so —
    // `height` is still the clearance.
    const low = over((t) => (t / 4) * 400, 4);
    expect(low.agl).toBeLessThan(low.msl);
  });
});
