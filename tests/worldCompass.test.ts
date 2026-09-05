/**
 * CLOCKWISE ADDS.
 *
 * Joshua, from the device, 2026-09-05: "the heading 'degrees °' is
 * backwards on the display meaning going clockwise should add not
 * subtract."
 *
 * The readout was printing an actor HEADING as though it were a compass
 * BEARING. They run opposite ways — a heading is a rotation about +y and
 * grows anticlockwise, a bearing is a compass rose and grows clockwise —
 * so the number fell as the player turned right.
 *
 * IT HID BECAUSE IT WAS HALF RIGHT. `bearing = 180 - h` and `bearing = h`
 * agree wherever `h = 180 - h`, which is east and west exactly. So the
 * old readout was correct on the east-west axis and a full half-turn out
 * at north and south, and a test that happened to check east passed. One
 * of the tests below is that very case, kept and labelled, so nobody
 * "fixes" the compass back by checking the one bearing that cannot tell
 * the two apart.
 *
 * The two facts the conversion rests on are checked here against the
 * modules that own them, rather than restated: `world/dem.ts` for which
 * way is north, `actor/Transform.ts` for what a heading means.
 */
import { describe, expect, it } from 'vitest';
import { compassBearing, world } from '../src/world/coords';
import { gridColumn, gridRow, COARSE_STEP } from '../src/world/dem';
import { step } from '../src/actor/Transform';
import { wave } from '../src/world/sea/swell';
import { DEBUG_CAPSULE_TUNING } from '../src/actor/CapsuleTuning';

/** A heading, in degrees, as radians. */
const rad = (degrees: number): number => (degrees * Math.PI) / 180;

describe('the world’s compass', () => {
  it('turns CLOCKWISE as the bearing grows — the thing that was backwards', () => {
    // North, east, south, west. Each a quarter turn clockwise from the
    // last, each 90 more than the last, with no wrap in between.
    const north = compassBearing(rad(180));
    const east = compassBearing(rad(90));
    const south = compassBearing(rad(0));
    const west = compassBearing(rad(-90));
    expect([north, east, south, west]).toEqual([0, 90, 180, 270]);
  });

  it('adds when the player turns right, at every heading', () => {
    // The report, as a property rather than four samples. Turning right
    // DECREASES a heading (FreeFlyCamera: `yaw -= lookDx * turn`, and
    // headingOfYaw is a half turn, which preserves the sign), so a
    // bearing must increase for every such step.
    for (let h = -180; h < 180; h += 7) {
      const before = compassBearing(rad(h));
      const after = compassBearing(rad(h - 5)); // five degrees to the right
      // Modular difference, so the one step that crosses 359 -> 0 counts
      // as +5 rather than -355.
      const advance = ((after - before) % 360 + 360) % 360;
      expect(advance, `turning right from bearing ${before}`).toBe(5);
    }
  });

  it('is 0..359 and never 360, whatever it is handed', () => {
    for (const h of [0, Math.PI, -Math.PI, 7 * Math.PI, -12.9, 1e6]) {
      const bearing = compassBearing(h);
      expect(Number.isInteger(bearing), String(h)).toBe(true);
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
    }
    // The rounding case the wrap has to survive: a hair under due north
    // must print 0, not 360.
    expect(compassBearing(rad(180.4))).toBe(0);
    expect(compassBearing(rad(179.6))).toBe(0);
  });

  it('agrees with the old readout at east and west, and ONLY there', () => {
    // The reason the bug survived. Keeping this explicit stops a future
    // reader from checking east, seeing agreement, and reverting.
    const old = (h: number): number => (((Math.round((h * 180) / Math.PI) % 360) + 360) % 360);
    const agrees: number[] = [];
    for (let d = 0; d < 360; d += 1) {
      if (compassBearing(rad(d)) === old(rad(d))) agrees.push(d);
    }
    expect(agrees).toEqual([90, 270]);
  });
});

describe('the two facts it rests on', () => {
  it('north is -wz, per the survey’s own row order', () => {
    // `world/dem.ts`: "+wx is EAST and +wz is SOUTH". Row 0 is north, so a
    // more negative wz must be a smaller row.
    expect(gridRow(-COARSE_STEP, COARSE_STEP)).toBeLessThan(gridRow(0, COARSE_STEP));
    // …and a more positive wx a larger column, because column 0 is west.
    expect(gridColumn(COARSE_STEP, COARSE_STEP)).toBeGreaterThan(gridColumn(0, COARSE_STEP));
  });

  it('agrees with the SWELL’s compass, which was already right', () => {
    // The second witness, and it is shipped code rather than an argument.
    // `world/sea/swell.ts` builds a wave from a heading it runs TOWARD,
    // commented "0° is −z (north), 90° is +x (east)" — a true compass,
    // growing clockwise — and that table is the accepted v0 ocean. So the
    // convention was never in doubt; only the HUD disagreed with it.
    //
    // For every bearing, a wave sent toward it must travel the way an
    // actor with the matching heading walks.
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const w = wave(360, 10, bearing);
      // The heading whose bearing is this one: b = 180 - h, so h = 180 - b.
      const heading = rad(180 - bearing);
      expect(compassBearing(heading), `bearing ${bearing}`).toBe(bearing);
      expect(w.dx).toBeCloseTo(Math.sin(heading), 9);
      expect(w.dz).toBeCloseTo(Math.cos(heading), 9);
    }
  });

  it('a heading of zero walks SOUTH, which is why the bearing is 180', () => {
    // Not asserted from the formula — driven through the actor's own
    // integrator, so the claim is about the code that moves capsules.
    const start = { id: 'a' as never, at: world(0, 0), height: 0, heading: 0 };
    const moved = step(
      start as never,
      { turn: 0, forward: 1, strafe: 0, sprint: false },
      1,
      DEBUG_CAPSULE_TUNING,
    );
    // +wz, and +wz is south.
    expect(moved.at.wz).toBeGreaterThan(0);
    expect(Math.abs(moved.at.wx)).toBeLessThan(1e-9);
    expect(compassBearing(0)).toBe(180);
  });
});
