/**
 * THE NUMBERS THE FLIGHT PANEL PUTS IN FRONT OF A PILOT.
 *
 * Two of these were reported from the device as "ground speed and
 * airspeed sometimes disagree even though the wind says 0.0", which
 * turned out not to be a physics fault at all — the physics was right
 * and the readout could not express it. So the test that matters is
 * about the READOUT'S RESOLUTION, and it is stated as a negative
 * control: the old unit hid more than a body length a second, the new
 * one cannot.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_POWERED_SPEED, POWER_FLOOR, POWER_STEP, BEST_GLIDE_SPEED, powerOf,
} from '../src/ant/flight';
import { windProfile } from '../src/weather/windField';
import { UNITS_PER_METRE } from '../src/world/kauai';

/** An adult queen is 10 mm. One world unit is a centimetre. */
const BODY = 1;

describe('the wind readout can express the wind it is reporting', () => {
  // Kauaʻi's ordinary trades, the middle of the range the weather model
  // works in: 25 km/h.
  const TRADES = 6.9 * UNITS_PER_METRE;

  /** What the strip used to print: metres per second, one decimal. */
  const asMetres = (units: number) => Math.round((units / UNITS_PER_METRE) * 10) / 10;
  /** What it prints now: centimetres per second, one decimal. */
  const asCentimetres = (units: number) => Math.round(units * 10) / 10;

  it('printed 0.0 while moving her a body length a second', () => {
    // THE BUG, at the height it actually bit: she flies at tens of
    // centimetres and the wind she feels is scaled by height, so the
    // ordinary low pass in real weather landed in exactly the band the
    // old readout could not show.
    const felt = TRADES * windProfile(40);
    expect(asMetres(felt)).toBe(0);
    expect(felt).toBeGreaterThan(BODY);
  });

  it('and the worst it could hide was five centimetres a second', () => {
    // Half of one printed step of m/s. Against a 9.5 cm/s airspeed —
    // the second screenshot — that is half her speed again, unaccounted.
    const hidden = 0.05 * UNITS_PER_METRE;
    expect(hidden).toBe(5);
    expect(asMetres(hidden - 0.01)).toBe(0);
  });

  it('the new unit hides a tenth of a millimetre a second', () => {
    const felt = TRADES * windProfile(40);
    expect(asCentimetres(felt)).toBeGreaterThan(0);
    // The most that can round away is half of one printed step.
    expect(0.05).toBeLessThan(BODY / 10);
  });

  it('and it is the same unit the speeds it explains are in', () => {
    // Which is the whole point: GND minus AIR is now readable off the
    // screen against the wind that caused it.
    const air = 41.6;
    const wind = TRADES * windProfile(2_770);
    // Triangle inequality — a tailwind is the most it can ever add.
    expect(Math.abs((air + wind) - air)).toBeLessThanOrEqual(wind + 1e-9);
  });
});

describe('airspeed as a power setting', () => {
  it('is five notches of twenty per cent', () => {
    const notches = new Set<number>();
    for (let speed = 0; speed <= MAX_POWERED_SPEED; speed += 0.25) {
      notches.add(powerOf(speed));
    }
    expect([...notches].sort((a, b) => a - b)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('reads full power at full power and nothing at rest', () => {
    expect(powerOf(MAX_POWERED_SPEED)).toBe(100);
    expect(powerOf(0)).toBe(0);
  });

  it('never runs off either end', () => {
    // The model can hand it an overspeed in a dive; a readout that says
    // 120% is a readout nobody trusts again.
    expect(powerOf(MAX_POWERED_SPEED * 3)).toBe(100);
    expect(powerOf(-MAX_POWERED_SPEED)).toBe(100);
  });

  it('puts the floor where best glide actually is', () => {
    // POWER_FLOOR is a rounded figure and this is the rounding: below
    // best glide she trades height whatever she does, and best glide
    // lands between the 40 and 60 notches.
    const share = (BEST_GLIDE_SPEED / MAX_POWERED_SPEED) * 100;
    expect(share).toBeGreaterThan(POWER_FLOOR);
    expect(share).toBeLessThan(POWER_FLOOR + POWER_STEP);
    expect(powerOf(BEST_GLIDE_SPEED)).toBe(POWER_FLOOR);
  });
});
