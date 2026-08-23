import { describe, expect, it } from 'vitest';
import {
  BREAKS_AT, GRAVITY, OUT_OF_DEPTH, SEAWARD, shoreward, surfAt,
} from '../src/world/surf';
import { liveStat } from '../src/ant/castes';
import { MM_PER_UNIT } from '../src/ant/queenModel';
import { FLOW, SWELL, WAVES, seaFlowAt, seaHeightAt } from '../src/world/swell';
import { UNITS_PER_METRE } from '../src/world/kauai';

/**
 * A QUEEN, IN WORLD UNITS. `bodyLength` is millimetres and a world unit
 * is a centimetre, so an adult's 10 mm is ONE unit — not eleven, which
 * is what the first version of this file assumed and is eleven times
 * her own length of water before she noticed getting wet.
 */
const QUEEN = liveStat('bodyLength') / MM_PER_UNIT;
const DRAFT = QUEEN;
/** Her top speed over the ground, measured in the flight probe. */
const HER_PACE = 25;

/** Uphill toward −z, which is the beach in these tests. */
const BEACH = { x: 0, z: -1 };

describe('the water under the wave', () => {
  it('is the elevation times the frequency, and nothing else', () => {
    // The whole claim: the flow is not a second model with its own
    // constants, it is `u = omega x eta` read off the same table. If
    // these two ever part company the water flows one way while the
    // wave carrying it goes another.
    for (const t of [0, 3.7, 41.25]) {
      for (const [x, z] of [[0, 0], [4_321, -9_876], [1_200_000, 640_000]]) {
        let byHand = { x: 0, z: 0 };
        for (const wave of WAVES) {
          const k = (2 * Math.PI) / wave.length;
          const rise = wave.height
            * Math.sin(k * (wave.dx * x + wave.dz * z) - wave.speed * t);
          byHand = {
            x: byHand.x + wave.speed * rise * wave.dx,
            z: byHand.z + wave.speed * rise * wave.dz,
          };
        }
        const flow = seaFlowAt(x, z, t);
        expect(flow.x).toBeCloseTo(byHand.x, 9);
        expect(flow.z).toBeCloseTo(byHand.z, 9);
      }
    }
  });

  it('outruns her before a wave has even broken', () => {
    // Open water, peak orbital flow, against a queen at full sprint.
    expect(FLOW).toBeGreaterThan(HER_PACE * 1.8);
    expect(FLOW / UNITS_PER_METRE).toBeLessThan(1);
  });

  it('never exceeds what the waves could possibly carry', () => {
    let fastest = 0;
    for (let t = 0; t < 30; t += 0.31) {
      for (let x = -50_000; x <= 50_000; x += 617) {
        const flow = seaFlowAt(x, -x * 0.4, t);
        fastest = Math.max(fastest, Math.hypot(flow.x, flow.z));
      }
    }
    expect(fastest).toBeLessThanOrEqual(FLOW + 1e-9);
    expect(fastest).toBeGreaterThan(FLOW * 0.7);
  });
});

describe('what the sea does to a queen standing in it', () => {
  it('does nothing at all on dry land', () => {
    // Ground a metre above the highest crest there can be.
    const dry = surfAt(0, 0, 4, SWELL + 100, BEACH, DRAFT);
    expect(dry).toEqual({ depth: 0, grip: 0, x: 0, z: 0 });
  });

  it('barely notices a film thinner than she is', () => {
    // Wet feet are not a shipwreck. Found by picking a moment when the
    // surface is above zero and standing just under it.
    let shallow = null;
    for (let t = 0; t < 20 && !shallow; t += 0.05) {
      const surface = seaHeightAt(0, 0, t);
      if (surface > 2) shallow = surfAt(0, 0, t, surface - QUEEN * 0.25, BEACH, DRAFT);
    }
    expect(shallow).not.toBeNull();
    // A quarter of her depth has well under a quarter of her: the pull
    // is eased, because the widest part of her is in the middle.
    expect((shallow as { grip: number }).grip).toBeLessThan(0.25 * 0.7);
  });

  it('has her completely once the water is a body length deep', () => {
    let deep = null;
    for (let t = 0; t < 20 && !deep; t += 0.05) {
      const surface = seaHeightAt(0, 0, t);
      if (surface > DRAFT + 5) deep = surfAt(0, 0, t, surface - DRAFT * 2, BEACH, DRAFT);
    }
    expect((deep as { grip: number }).grip).toBe(1);
  });

  it('runs up the beach at the speed a broken wave runs', () => {
    // √(g·d), the shallow-water bore. Not a tuned number: the same
    // square root that governs a tsunami and a bath.
    const depth = 30;
    let fastest = 0;
    for (let t = 0; t < 20; t += 0.02) {
      const surface = seaHeightAt(0, 0, t);
      if (surface < depth) continue;
      const surf = surfAt(0, 0, t, surface - depth, BEACH, DRAFT);
      fastest = Math.max(fastest, Math.hypot(surf.x, surf.z));
    }
    // Within reach of √(981 × 30) ≈ 171, and several times her pace.
    expect(fastest).toBeGreaterThan(HER_PACE * 3);
    expect(fastest).toBeLessThanOrEqual(Math.sqrt(GRAVITY * depth) + FLOW);
  });

  it('pushes her UP the beach more than it drags her down it', () => {
    // THE SURVIVAL INVARIANT, as arithmetic. There is no swimming yet,
    // so water that could tow her out to sea would be a way to lose a
    // queen with no way back. A broken wave really does run up faster
    // than it drains, and here that is also the safety rail.
    let up = 0;
    let down = 0;
    for (let t = 0; t < 60; t += 0.01) {
      const surface = seaHeightAt(0, 0, t);
      const depth = 25;
      if (surface < depth) continue;
      const surf = surfAt(0, 0, t, surface - depth, BEACH, DRAFT);
      // BEACH points toward −z, so a negative z is up the beach.
      if (surf.z < 0) up -= surf.z; else down += surf.z;
    }
    expect(up).toBeGreaterThan(down * 1.5);
  });

  it('hands over from orbit to bore as the water shallows', () => {
    // Deep: pure orbital, so the flow follows the waves' own directions
    // and has no particular relationship to the beach. Shallow: the
    // bore owns it and it runs along the slope.
    const t = 7.3;
    const surface = seaHeightAt(0, 0, t);
    const deep = surfAt(0, 0, t, surface - BREAKS_AT * 6, BEACH, DRAFT);
    const shoal = surfAt(0, 0, t, surface - BREAKS_AT * 0.2, BEACH, DRAFT);
    const orbit = seaFlowAt(0, 0, t);
    expect(deep.x).toBeCloseTo(orbit.x, 6);
    expect(deep.z).toBeCloseTo(orbit.z, 6);
    // In the shallows the across-beach component is squeezed out.
    expect(Math.abs(shoal.x)).toBeLessThan(Math.abs(deep.x) + 1e-9);
  });

  it('scales the backwash by exactly what it says it does', () => {
    // A constant that quietly stopped being applied would leave the sea
    // able to tow her out, and nothing else would look different.
    // In a TROUGH, with the ground below it so there is still water
    // there — the ground has to be under the surface or there is no sea
    // at all, which is how this test first measured a flat zero.
    //
    // And in water she can STAND IN: past OUT_OF_DEPTH the rail above
    // removes the seaward component entirely, so asking about the
    // backwash there measures the rail rather than the constant. (It
    // measured a flat zero a second time for exactly that reason.)
    const depth = OUT_OF_DEPTH * QUEEN * 0.6;
    let seaward = 0;
    let shoreward2 = 0;
    for (let t = 0; t < 40; t += 0.01) {
      const surface = seaHeightAt(0, 0, t);
      const surf = surfAt(0, 0, t, surface - depth, BEACH, DRAFT);
      // BEACH points toward −z, so +z is back out to sea.
      if (surface < -5) seaward = Math.max(seaward, surf.z);
      if (surface > 5) shoreward2 = Math.max(shoreward2, -surf.z);
    }
    expect(seaward).toBeGreaterThan(0);
    expect(shoreward2).toBeGreaterThan(0);
    // The whole point of the constant, read straight off the numbers.
    expect(seaward).toBeLessThan(shoreward2 * (SEAWARD + 0.25));
  });
});

describe('which way the land rises', () => {
  /** A plane tilting up toward −z, one unit in ten. */
  const slope = (_x: number, z: number) => -z / 10;

  it('points up the hill', () => {
    const up = shoreward(0, 0, slope);
    expect(up).not.toBeNull();
    expect((up as { z: number }).z).toBeCloseTo(-1, 6);
    expect((up as { x: number }).x).toBeCloseTo(0, 6);
  });

  it('is a unit vector, so the surge speed comes from the depth alone', () => {
    const up = shoreward(400, -900, (x, z) => x * 0.3 - z * 0.4);
    const found = up as { x: number; z: number };
    expect(Math.hypot(found.x, found.z)).toBeCloseTo(1, 6);
  });

  it('admits there is no uphill on flat ground', () => {
    // A real answer, not a failure: a wave arriving on a flat plain has
    // no preferred direction and the orbital flow is the whole story.
    expect(shoreward(0, 0, () => 500)).toBeNull();
  });

  it('measures across a stride, not a hair', () => {
    // A beach at this scale has grain on it. A gradient taken over a
    // fraction of a millimetre points at the nearest sand ripple
    // instead of at the island.
    const ripples = (x: number, z: number) => -z / 10 + Math.sin(x * 0.7) * 4;
    const wide = shoreward(0, 0, ripples, 40) as { z: number };
    const hair = shoreward(0, 0, ripples, 0.05) as { z: number };
    expect(wide.z).toBeLessThan(-0.7);
    expect(Math.abs(hair.z)).toBeLessThan(0.3);
  });
});

describe('the sea cannot take her somewhere she cannot come back from', () => {
  it('never pushes her seaward once she is out of her depth', () => {
    // A RAIL, NOT PHYSICS, and it is here because the alternative
    // guarantee is statistical. SEAWARD makes the NET drift shoreward
    // over whole wave periods, which is true and is real surf — but
    // "on average she washes up" is the wrong kind of promise for "can
    // a wave permanently end the run". This one holds every frame.
    const deep = OUT_OF_DEPTH * QUEEN * 3;
    let worst = -Infinity;
    for (let t = 0; t < 60; t += 0.01) {
      const surface = seaHeightAt(0, 0, t);
      const surf = surfAt(0, 0, t, surface - deep, BEACH, QUEEN);
      // BEACH points toward −z, so any positive z is out to sea.
      worst = Math.max(worst, surf.z);
    }
    expect(worst).toBeLessThanOrEqual(1e-9);
  });

  it('still lets the shallows wash her both ways', () => {
    // The rail must not flatten the surf. In water she can stand in,
    // the backwash is real and she gets dragged about by it.
    const wading = OUT_OF_DEPTH * QUEEN * 0.4;
    let seaward = 0;
    for (let t = 0; t < 60; t += 0.01) {
      const surface = seaHeightAt(0, 0, t);
      if (surface - (surface - wading) <= 0) continue;
      seaward = Math.max(seaward, surfAt(0, 0, t, surface - wading, BEACH, QUEEN).z);
    }
    expect(seaward).toBeGreaterThan(1);
  });

  it('leaves the shoreward push completely alone', () => {
    // A rail that also damped the surge would have quietly turned the
    // wave that is supposed to fling her up the beach into a nudge.
    const deep = OUT_OF_DEPTH * QUEEN * 3;
    let up = 0;
    for (let t = 0; t < 60; t += 0.01) {
      const surface = seaHeightAt(0, 0, t);
      up = Math.max(up, -surfAt(0, 0, t, surface - deep, BEACH, QUEEN).z);
    }
    expect(up).toBeGreaterThan(HER_PACE);
  });
});
