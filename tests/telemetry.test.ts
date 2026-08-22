import { describe, expect, it } from 'vitest';
import {
  CLEARANCE, Eased, FAR_STEP, LOOK_AHEAD, NEAR_RANGE, NEAR_STEP,
  TOUCHDOWN_RANGE, driftOf, groundVelocity, predict, touchdown, trackOf,
} from '../src/ant/telemetry';
import { bearingFromHeading } from '../src/ui/compassMath';

/** A heading in radians from a compass bearing. Travel is (sin, cos). */
const facing = (bearing: number): number => (Math.PI * (180 - bearing)) / 180;

/** A wind of `speed` cm/s travelling TOWARD the given bearing. */
function blowing(speed: number, toward: number) {
  const h = facing(toward);
  return { x: Math.sin(h) * speed, z: Math.cos(h) * speed };
}

/** Flat ground at a given elevation. */
const flat = (at: number) => () => at;

describe('the wind triangle', () => {
  it('A — no wind: she goes where she points, at what she flies', () => {
    const ground = groundVelocity(70, facing(0), null);
    expect(Math.hypot(ground.x, ground.z)).toBeCloseTo(70, 6);
    const track = trackOf(ground, 0);
    expect(track).toBeCloseTo(0, 4);
    expect(driftOf(track, facing(0))).toBeCloseTo(0, 4);
  });

  it('B — headwind: airspeed unchanged, ground speed eaten, no drift', () => {
    // 0.70 m/s north into 0.40 m/s from the north.
    const ground = groundVelocity(70, facing(0), blowing(40, 180));
    expect(Math.hypot(ground.x, ground.z)).toBeCloseTo(30, 4);
    const track = trackOf(ground, 0);
    expect(track).toBeCloseTo(0, 3);
    expect(driftOf(track, facing(0))).toBeCloseTo(0, 3);
  });

  it('C — headwind equal to airspeed: she stops, and track is HELD not NaN', () => {
    const ground = groundVelocity(70, facing(0), blowing(70, 180));
    expect(Math.hypot(ground.x, ground.z)).toBeLessThan(1e-9);
    // The direction of a zero vector does not exist. The last real one
    // stands rather than snapping to due north and swinging on a gust.
    const track = trackOf(ground, 123);
    expect(Number.isFinite(track)).toBe(true);
    expect(track).toBe(123);
  });

  it('D — losing to the wind: still pointing north, going south', () => {
    const ground = groundVelocity(70, facing(0), blowing(100, 180));
    expect(Math.hypot(ground.x, ground.z)).toBeCloseTo(30, 4);
    const track = trackOf(ground, 0);
    expect(track).toBeCloseTo(180, 3);
    // Her nose has not moved. That is the entire point of the model.
    expect(bearingFromHeading(facing(0))).toBeCloseTo(0, 4);
  });

  it('E — pure crosswind: 45 degrees of drift and a faster crossing', () => {
    // Flying north at 70, wind of 70 travelling west.
    const ground = groundVelocity(70, facing(0), blowing(70, 270));
    expect(Math.hypot(ground.x, ground.z)).toBeCloseTo(98.99, 1);
    const track = trackOf(ground, 0);
    expect(track).toBeCloseTo(315, 3);
    expect(driftOf(track, facing(0))).toBeCloseTo(-45, 3);
  });

  it('crosswind drift reads the other way round too', () => {
    const ground = groundVelocity(70, facing(0), blowing(70, 90));
    expect(trackOf(ground, 0)).toBeCloseTo(45, 3);
    expect(driftOf(trackOf(ground, 0), facing(0))).toBeCloseTo(45, 3);
  });

  it('takes no wind at all as no wind', () => {
    const a = groundVelocity(70, facing(90), null);
    const b = groundVelocity(70, facing(90), { x: 0, z: 0 });
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.z).toBeCloseTo(b.z, 9);
  });
});

describe('the short look-ahead', () => {
  const here = { wx: 1_000_000, wz: -2_000_000, altitude: 550 };

  it('carries her along the GROUND track, not along her nose', () => {
    // Pointing north, blown hard west: the prediction must land to the
    // west, which is the whole reason it is not drawn off her heading.
    const ground = groundVelocity(70, facing(0), blowing(70, 270));
    const soon = predict(here, ground, 0, LOOK_AHEAD, flat(500));
    expect(soon.wx).toBeLessThan(here.wx);
    expect(soon.wz).toBeLessThan(here.wz);
    expect(soon.range).toBeCloseTo(98.99 * LOOK_AHEAD, 0);
  });

  it('reports clearance against the terrain it actually sampled', () => {
    const ground = groundVelocity(70, facing(0), null);
    const soon = predict(here, ground, -20, LOOK_AHEAD, flat(500));
    // 550 dropping 20 a second for two seconds, over ground at 500.
    expect(soon.altitude).toBeCloseTo(510, 6);
    expect(soon.agl).toBeCloseTo(10, 6);
  });

  it('works on million-unit island coordinates without losing precision', () => {
    const far = { wx: 2_700_000.5, wz: -2_700_000.25, altitude: 900 };
    const soon = predict(far, { x: 12.5, z: -7.25 }, 0, 2, flat(0));
    expect(soon.wx).toBeCloseTo(2_700_025.5, 6);
    expect(soon.wz).toBeCloseTo(-2_700_014.75, 6);
  });
});

describe('walking the path into the terrain', () => {
  const here = { wx: 0, wz: 0, altitude: 500 };

  it('G — descending over flat ground, when basic arithmetic says', () => {
    // 400 above the ground, sinking 40 a second: ten seconds, less the
    // clearance she is allowed. Bisected rather than stepped now, so
    // this is held to two decimals where it used to want a tenth.
    const ground = groundVelocity(70, facing(0), null);
    const hit = touchdown(here, ground, -40, flat(100));
    expect(hit).not.toBeNull();
    expect((hit as { after: number }).after).toBeCloseTo((500 - 100 - CLEARANCE) / 40, 2);
  });

  it('JOSHUA’S WORKED EXAMPLE, in his own numbers', () => {
    // "Current altitude 3000, ground altitude 20, difference 2800.
    //  Ground speed 60 mph — a mile a minute. Descending 300 fpm, with
    //  2800 to lose: 2800/300 = 9.333 minutes = 560 seconds. At a mile
    //  a minute that is exactly 9.333 miles ahead of the ant."
    //
    // Read in feet and feet-per-second, which the solver neither knows
    // nor needs to: it is a root find along a line and carries whatever
    // unit it is handed. 300 fpm is 5 a second; 60 mph is 88.
    const from = { wx: 0, wz: 0, altitude: 2820 };
    const ground = { x: 88, z: 0 };
    const hit = touchdown(from, ground, -5, flat(20), 60_000);
    expect(hit).not.toBeNull();
    const found = hit as { after: number; range: number };

    // His arithmetic, less the clearance she is allowed to keep.
    const toLose = 2820 - 20 - CLEARANCE;
    expect(found.after).toBeCloseTo(toLose / 5, 1);
    expect(found.range).toBeCloseTo((toLose / 5) * 88, 0);
    // And in his terms: nine and a third minutes, nine and a third
    // miles, to within the four feet of clearance.
    expect(found.after / 60).toBeCloseTo(9.333, 1);
    expect(found.range / 5280).toBeCloseTo(9.333, 1);
  });

  it('F — level flight into rising ground still finds the hill', () => {
    // NOT SOLVABLE BY FLAT MATHS, and the case that makes "what if she
    // is exactly level" a non-question: she is not descending at all;
    // the island is coming up to meet her.
    const ground = groundVelocity(100, facing(0), null);
    const hill = (_wx: number, wz: number) => 400 + Math.max(0, -wz);
    const hit = touchdown(here, ground, 0, hill);
    expect(hit).not.toBeNull();
    const found = hit as { after: number; agl: number };
    expect(found.after).toBeGreaterThan(0.8);
    expect(found.after).toBeLessThan(1.2);
    expect(found.agl).toBeLessThanOrEqual(CLEARANCE + 1e-3);
  });

  it('finds a ridge sooner than flat ground under the same descent', () => {
    const ground = groundVelocity(70, facing(0), null);
    const overFlat = touchdown(here, ground, -40, flat(100));
    const ridge = (_wx: number, wz: number) => 100 + Math.max(0, -wz) * 1.5;
    const overRidge = touchdown(here, ground, -40, ridge);
    expect(overRidge).not.toBeNull();
    expect((overRidge as { after: number }).after)
      .toBeLessThan((overFlat as { after: number }).after);
  });

  it('says nothing when the island stays out of her way', () => {
    // Level over open water is the one genuinely level answer: no
    // touchdown, honestly, rather than one invented at infinity.
    const ground = groundVelocity(70, facing(0), null);
    expect(touchdown(here, ground, 0, flat(0))).toBeNull();
    expect(touchdown(here, ground, 30, flat(100))).toBeNull();
  });

  it('reaches far past the near march for a shallow descent', () => {
    // The whole reason the horizon is a DISTANCE. Losing a hundredth of
    // a unit for every unit travelled, from 400 up, lands her 39,600
    // out — twice past the fine-stepped near range and still well
    // inside the horizon, where a ten-second time horizon would have
    // reported nothing at all.
    const ground = { x: 100, z: 0 };
    const hit = touchdown(here, ground, -1, flat(100));
    expect(hit).not.toBeNull();
    const found = hit as { range: number };
    expect(found.range).toBeGreaterThan(NEAR_RANGE);
    expect(found.range).toBeCloseTo((500 - 100 - CLEARANCE) * 100, 0);
  });

  it('gives up rather than marking ground it is not drawing', () => {
    // Past the horizon there is no terrain tier under the marker, so a
    // marker there would be a claim about scenery that is not rendered.
    const ground = { x: 100, z: 0 };
    const gentle = -(500 - 100 - CLEARANCE) / (TOUCHDOWN_RANGE / 100) / 2;
    expect(touchdown(here, ground, gentle, flat(100))).toBeNull();
  });

  it('does not hunt forever for a queen who is not going anywhere', () => {
    expect(touchdown(here, { x: 0, z: 0 }, 0, flat(0))).toBeNull();
  });

  it('finds the ground under a queen dropping straight down', () => {
    const hit = touchdown(here, { x: 0, z: 0 }, -100, flat(100));
    expect(hit).not.toBeNull();
    const found = hit as { after: number; range: number };
    expect(found.after).toBeCloseTo((500 - 100 - CLEARANCE) / 100, 6);
    expect(found.range).toBe(0);
  });

  it('refuses to mark a touchdown behind her when she is already in it', () => {
    expect(touchdown(here, { x: 100, z: 0 }, -10, flat(600))).toBeNull();
  });

  it('costs a bounded number of terrain lookups', () => {
    // A phone pays for every one of these, every frame. Worst case is
    // both marches run to their ends and find nothing.
    let asked = 0;
    const counted = () => { asked++; return -10_000; };
    touchdown(here, groundVelocity(70, facing(0), null), 0, counted);
    const march = NEAR_RANGE / NEAR_STEP + (TOUCHDOWN_RANGE - NEAR_RANGE) / FAR_STEP;
    expect(asked).toBeLessThanOrEqual(march + 2);
    expect(asked).toBeGreaterThan(march / 2);
  });
});

describe('smoothing the readout and not the world', () => {
  it('starts on the first reading rather than easing up from nothing', () => {
    const eased = new Eased();
    expect(eased.push(500, 1 / 60)).toBe(500);
  });

  it('H — settles the same way at 30, 60 and 120 frames a second', () => {
    // Exactly two seconds at each rate — a `t += dt` loop stops at a
    // different total time for each, which measures the loop and not
    // the easing.
    const run = (fps: number) => {
      const eased = new Eased();
      const dt = 1 / fps;
      eased.push(0, dt);
      for (let i = 0; i < Math.round(2 * fps); i++) eased.push(100, dt);
      return eased.shown;
    };
    const slow = run(30);
    const normal = run(60);
    const fast = run(120);
    expect(slow).toBeCloseTo(normal, 1);
    expect(normal).toBeCloseTo(fast, 1);
    // And two seconds really is most of the way there.
    expect(normal).toBeGreaterThan(94);
    expect(normal).toBeLessThan(100);
  });

  it('does not let one spiky sample through', () => {
    // 30, 20, 50, 19, 20 — the flicker this exists for.
    const eased = new Eased();
    const dt = 1 / 60;
    eased.push(20, dt);
    for (const spike of [30, 20, 50, 19, 20]) eased.push(spike, dt);
    expect(eased.shown).toBeGreaterThan(19);
    expect(eased.shown).toBeLessThan(24);
  });

  it('can be told to jump, for a respawn', () => {
    const eased = new Eased();
    eased.push(10, 1 / 60);
    eased.set(900);
    expect(eased.shown).toBe(900);
  });

  it('recovers from a reading that was not a number', () => {
    const eased = new Eased();
    eased.push(Number.NaN, 1 / 60);
    expect(eased.push(42, 1 / 60)).toBe(42);
  });
});
