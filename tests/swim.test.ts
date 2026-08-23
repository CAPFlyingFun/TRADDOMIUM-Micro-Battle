/**
 * WATER AT ANT SCALE.
 *
 * Two reports in one: stepping into a river went from nothing to fully
 * swept in a tenth of a second, and an ant should be able to stand on
 * water in the first place. They turn out to be the same missing
 * thing — nothing in the game knew how much of her the water had.
 */
import { describe, expect, it } from 'vitest';
import {
  AFLOAT_AT, ANKLE, BREAK_THROUGH, CAPILLARY, SKATE_BACK, Swim, UNDER_FOR,
} from '../src/ant/swim';

/** An adult queen: 10 mm, and a world unit is a centimetre. */
const BODY = 1;
const TICK = 1 / 60;

/** Hold her in water `deep` units deep for `seconds` and report. */
function soak(deep: number, reserve: number, seconds = 1, dived = false) {
  const swim = new Swim();
  let out = swim.update(null, BODY, reserve, false, TICK);
  for (let t = 0; t < seconds; t += TICK) {
    out = swim.update({ level: deep, bed: 0 }, BODY, reserve, dived, TICK);
  }
  return { out, swim };
}

describe('the onramp that was missing', () => {
  it('gives the current nothing at all in a puddle', () => {
    expect(soak(BODY * ANKLE * 0.5, 1).out.grip).toBe(0);
  });

  it('ramps its grip across the shallows instead of snapping to full', () => {
    // THE BUG. The old ramp ran over one body length — a centimetre —
    // against channels one to two hundred deep, so the first step in
    // was already the whole current.
    const shallow = soak(BODY * 0.4, 1).out.grip;
    const mid = soak(BODY * 0.9, 1).out.grip;
    const deep = soak(BODY * 1.5, 1).out.grip;
    expect(shallow).toBeGreaterThan(0);
    expect(shallow).toBeLessThan(mid);
    expect(mid).toBeLessThan(deep);
    expect(deep).toBeLessThan(1);
  });

  it('and she is still wading, on her feet, the whole way', () => {
    expect(soak(BODY * (AFLOAT_AT - 0.1), 1).out.state).toBe('wading');
    expect(soak(BODY * (AFLOAT_AT - 0.1), 1).out.ride).toBe(0);
  });
});

describe('standing on the water', () => {
  it('holds her up while she has the reserve for it', () => {
    const { out } = soak(BODY * 6, 1);
    expect(out.state).toBe('skating');
    // On TOP of it: she rides the whole depth.
    expect(out.ride).toBeCloseTo(BODY * 6, 6);
  });

  it('takes less of the current than swimming does', () => {
    expect(soak(BODY * 6, 1).out.grip)
      .toBeLessThan(soak(BODY * 6, 0.2).out.grip);
  });

  it('costs her something, which is the whole tension', () => {
    expect(soak(BODY * 6, 1).out.cost).toBeGreaterThan(0);
  });

  it('lets her through when she is halfway spent', () => {
    expect(soak(BODY * 6, BREAK_THROUGH - 0.01).out.state).toBe('swimming');
  });

  it('and will not flicker at the boundary', () => {
    // Broken through, she has to earn well clear of the threshold to
    // get back on top — otherwise a reserve hovering at a half would
    // switch states several times a second.
    const swim = new Swim();
    const water = { level: BODY * 6, bed: 0 };
    swim.update(water, BODY, 0.2, false, TICK);
    expect(swim.afloat.state).toBe('swimming');
    swim.update(water, BODY, BREAK_THROUGH + 0.02, false, TICK);
    expect(swim.afloat.state).toBe('swimming');
    swim.update(water, BODY, SKATE_BACK + 0.01, false, TICK);
    expect(swim.afloat.state).toBe('skating');
  });
});

describe('going under, and coming back up', () => {
  it('sinks her while she is driving down', () => {
    const { out } = soak(BODY * 8, 1, 1, true);
    expect(out.state).toBe('under');
    expect(out.ride).toBeLessThan(BODY * 8);
  });

  it('floats her back up like a cork when she stops', () => {
    const swim = new Swim();
    const water = { level: BODY * 8, bed: 0 };
    for (let t = 0; t < 1; t += TICK) swim.update(water, BODY, 1, true, TICK);
    const sunk = swim.afloat.ride;
    for (let t = 0; t < 2; t += TICK) swim.update(water, BODY, 1, false, TICK);
    expect(swim.afloat.ride).toBeGreaterThan(sunk);
    expect(swim.afloat.state).not.toBe('under');
  });

  it('and buoyancy wins even if she keeps holding it down', () => {
    // She is a cork with legs. Holding the lever buys UNDER_FOR and
    // not a second more — game tuning, and the file says so.
    const swim = new Swim();
    const water = { level: BODY * 8, bed: 0 };
    for (let t = 0; t < UNDER_FOR + 1; t += TICK) {
      swim.update(water, BODY, 1, true, TICK);
    }
    expect(swim.afloat.state).not.toBe('under');
  });
});

describe('the one measured number', () => {
  it("is water's capillary length, and she straddles it", () => {
    // 2.7 mm: sqrt(surface tension / density x gravity). Above it
    // weight beats surface tension. A founding queen is 5.5 mm and an
    // adult 10, so she is the same order as the thing that decides —
    // which is why an ant stands on a pond and a mouse does not.
    expect(CAPILLARY).toBeCloseTo(0.27, 6);
    expect(BODY / CAPILLARY).toBeLessThan(10);
    expect(BODY / CAPILLARY).toBeGreaterThan(1);
  });
});

describe('nothing here can drown her', () => {
  it('never reports a state she cannot leave', () => {
    // The survival invariant: a bar may only move if there is a way to
    // move it back, and there is no way back from drowned. Spent and
    // in deep water she swims, badly, and stays alive.
    const { out } = soak(BODY * 20, 0, 6);
    expect(['swimming', 'under']).toContain(out.state);
    expect(out.pace).toBeGreaterThan(0);
  });
});
