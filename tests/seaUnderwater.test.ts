/**
 * THE UNDERWATER LOOK — the numbers, and the two ways it could lie.
 *
 * Joshua, 2026-09-06: "need to add the underwater fog." What is easy to
 * get wrong here is not the arithmetic; it is the two edges. A look that
 * came on ABOVE the water would fog the air, and a look that blended its
 * distances linearly would spend its whole ramp in numbers that are
 * still effectively no fog and then arrive in one frame — which is the
 * glitch the ramp exists to prevent, wearing the ramp as a disguise.
 */
import { describe, expect, it } from 'vitest';
import {
  EFOLD, LIGHT_DEEP, SIGHT_DEEP, SIGHT_SHALLOW, SURFACE_RAMP, blendSight, underwaterLook,
} from '../src/sea/underwaterLook';

describe('the underwater look', () => {
  it('is ABSENT above the water, which is the whole edge case', () => {
    // Null is not "no fog": it is the caller's cue to put the air back.
    // A look that returned a zero-strength water look instead would have
    // every caller blending toward green while standing on a beach.
    expect(underwaterLook(0)).toBeNull();
    expect(underwaterLook(-1)).toBeNull();
    expect(underwaterLook(-10_000)).toBeNull();
    // And NaN is above, not below: a surface query that failed must not
    // flood the world.
    expect(underwaterLook(Number.NaN)).toBeNull();
    expect(underwaterLook(1)).not.toBeNull();
  });

  it('comes on across the ramp and not before or after it', () => {
    const at = (d: number): number => underwaterLook(d)?.strength ?? 0;
    expect(at(0.01)).toBeGreaterThan(0);
    expect(at(SURFACE_RAMP / 2)).toBeCloseTo(0.5, 6);
    expect(at(SURFACE_RAMP)).toBe(1);
    // It STAYS on. A strength that kept climbing would be a caller
    // extrapolating past the colour it was given.
    expect(at(SURFACE_RAMP * 100)).toBe(1);
  });

  it('darkens and closes in with depth, exponentially', () => {
    const shallow = underwaterLook(1);
    const efold = underwaterLook(EFOLD);
    const deep = underwaterLook(EFOLD * 10);
    expect(shallow).not.toBeNull();
    if (shallow === null || efold === null || deep === null) return;
    // Just under the surface it is the shallow look, near enough — a
    // centimetre down is 0.08% of the way to the deep one, so this is a
    // ratio rather than an absolute.
    expect(shallow.sight).toBeLessThanOrEqual(SIGHT_SHALLOW);
    expect(shallow.sight).toBeGreaterThan(SIGHT_SHALLOW * 0.999);
    // One e-fold is 63% of the way, which is what "e-folding" means and
    // is the claim the comment in the source makes.
    const way = (SIGHT_SHALLOW - efold.sight) / (SIGHT_SHALLOW - SIGHT_DEEP);
    expect(way).toBeCloseTo(1 - Math.exp(-1), 3);
    // And it never overshoots the deep end however far down she goes.
    expect(deep.sight).toBeGreaterThanOrEqual(SIGHT_DEEP);
    expect(deep.sight).toBeLessThan(SIGHT_DEEP * 1.001);
    // Depth eats the long wavelengths first: what is left at the bottom
    // is blue. Red must fall furthest, blue least.
    expect(deep.r).toBeLessThan(shallow.r);
    expect(deep.b / shallow.b).toBeGreaterThan(deep.r / shallow.r);
    for (const c of [deep.r, deep.g, deep.b, shallow.r, shallow.g, shallow.b]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('sees LESS under water than in air, which is the point of it', () => {
    // The air's fog closes at kilometres. If the deep end were not far
    // inside that, the fog would be a colour change and nothing else.
    expect(SIGHT_SHALLOW).toBeLessThan(10_000);
    expect(SIGHT_DEEP).toBeLessThan(SIGHT_SHALLOW / 2);
  });

  it('BLENDS DISTANCES BY RATIO, because linearly the ramp does nothing', () => {
    const air = 400_000;
    const water = 3_000;
    expect(blendSight(air, water, 0)).toBeCloseTo(air, 6);
    expect(blendSight(air, water, 1)).toBeCloseTo(water, 6);
    // THE CLAIM: halfway along the ramp is the geometric mean, not the
    // arithmetic one. Linearly, half of 400,000 and 3,000 is 201,500 —
    // still 67 times further than the water ever lets you see, so at the
    // ramp's midpoint the fog would not have visibly started at all and
    // the whole transition would land in its last few percent.
    const half = blendSight(air, water, 0.5);
    expect(half).toBeCloseTo(Math.sqrt(air * water), 3);
    expect(half).toBeLessThan((air + water) / 5);
    // Six times nearer than the linear blend would have put it, which is
    // the difference between a ramp that does something and one that
    // does not.
    expect(half * 5).toBeLessThan((air + water) / 2);
    // Monotone, or the fog would open up part way into the water.
    let last = Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const d = blendSight(air, water, t);
      expect(d).toBeLessThanOrEqual(last + 1e-6);
      last = d;
    }
    // Out-of-range strengths are clamped rather than extrapolated: a
    // negative would push the fog FURTHER than the air's.
    expect(blendSight(air, water, -1)).toBeCloseTo(air, 6);
    expect(blendSight(air, water, 2)).toBeCloseTo(water, 6);
    // A degenerate air distance is not a reason to open the fog back up.
    expect(blendSight(0, water, 0.5)).toBe(water);
  });

  it('lets less of the air’s light down with depth, on the sight’s own curve, never below the floor', () => {
    // The seabed was lit as if in air — full sun on the sand under six
    // metres of water — because the fog is a colour and nothing was a
    // brightness. `light` is the factor the scene multiplies its sun
    // and sky light by, and it has four edges to get right.
    //
    // ABSENT above the water: the look is null there, so there is no
    // factor to blend toward and the caller puts the air's lights back.
    expect(underwaterLook(0)).toBeNull();
    expect(underwaterLook(-1)).toBeNull();
    // ALL OF IT at the surface: the eye a hundredth of a millimetre
    // under sees the sun the eye above it does.
    const surface = underwaterLook(0.001);
    expect(surface).not.toBeNull();
    if (surface === null) return;
    expect(Math.abs(surface.light - 1)).toBeLessThan(1e-6);
    expect(surface.light).toBeLessThanOrEqual(1);
    // MONOTONE down, and never under the floor however deep she goes: a
    // light that came back up would be the sun switching on at depth.
    let last = 1;
    for (let d = 0; d <= EFOLD * 20; d += EFOLD / 8) {
      const look = underwaterLook(d + 1e-9);
      expect(look).not.toBeNull();
      if (look === null) return;
      expect(look.light, `light at ${d}`).toBeLessThanOrEqual(last + 1e-12);
      expect(look.light, `light at ${d}`).toBeGreaterThanOrEqual(LIGHT_DEEP);
      last = look.light;
    }
    // THE FLOOR, reached: at twenty e-folds it is the deep value, near
    // enough, and a floor rather than black because the fog already
    // takes the far end to the deep colour.
    expect(last).toBeLessThan(LIGHT_DEEP * 1.001);
    expect(LIGHT_DEEP).toBeGreaterThan(0);
    expect(LIGHT_DEEP).toBeLessThan(1);
    // THE SAME CURVE THE SIGHT USES, so the water darkens and closes in
    // together rather than on two clocks: the fraction of the way to the
    // floor equals the fraction of the way to the deep sight, everywhere.
    for (const d of [1, EFOLD / 3, EFOLD, EFOLD * 2.5, EFOLD * 6]) {
      const look = underwaterLook(d);
      if (look === null) return;
      const lightWay = (1 - look.light) / (1 - LIGHT_DEEP);
      const sightWay = (SIGHT_SHALLOW - look.sight) / (SIGHT_SHALLOW - SIGHT_DEEP);
      expect(lightWay, `at ${d}`).toBeCloseTo(sightWay, 9);
    }
    // And one e-fold is 63% of the way, which is what the constant's
    // name promises for the light as much as for the sight.
    const efold = underwaterLook(EFOLD);
    if (efold === null) return;
    expect((1 - efold.light) / (1 - LIGHT_DEEP)).toBeCloseTo(1 - Math.exp(-1), 3);
  });
});
