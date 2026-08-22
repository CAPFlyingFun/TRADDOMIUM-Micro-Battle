import { describe, expect, it } from 'vitest';
import {
  CLEARANCE, Eased, LOOK_AHEAD, driftOf, groundVelocity, predict,
  terrainIntercept, trackOf,
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
    // clearance she is allowed.
    const ground = groundVelocity(70, facing(0), null);
    const hit = terrainIntercept(here, ground, -40, flat(100));
    expect(hit).not.toBeNull();
    const plain = (500 - 100 - CLEARANCE) / 40;
    expect((hit as { after: number }).after).toBeGreaterThanOrEqual(plain - 0.1);
    expect((hit as { after: number }).after).toBeLessThanOrEqual(plain + 0.1);
  });

  it('F — level flight into rising ground still finds the hill', () => {
    // NOT SOLVABLE BY FLAT MATHS. She is not descending at all; the
    // island is coming up to meet her, and that is exactly the warning
    // worth having.
    const ground = groundVelocity(100, facing(0), null);
    // Ground climbing one unit for every unit travelled north.
    const hill = (_wx: number, wz: number) => 400 + Math.max(0, -wz);
    const hit = terrainIntercept(here, ground, 0, hill);
    expect(hit).not.toBeNull();
    const found = hit as { after: number; agl: number };
    // She flies north at 100; the ground starts 100 below and gains on
    // her at 100 a second, so it reaches her at about a second.
    expect(found.after).toBeGreaterThan(0.8);
    expect(found.after).toBeLessThan(1.2);
    expect(found.agl).toBeLessThanOrEqual(CLEARANCE);
  });

  it('finds a ridge sooner than flat ground under the same descent', () => {
    const ground = groundVelocity(70, facing(0), null);
    const overFlat = terrainIntercept(here, ground, -40, flat(100));
    const ridge = (_wx: number, wz: number) => 100 + Math.max(0, -wz) * 1.5;
    const overRidge = terrainIntercept(here, ground, -40, ridge);
    expect(overRidge).not.toBeNull();
    expect((overRidge as { after: number }).after)
      .toBeLessThan((overFlat as { after: number }).after);
  });

  it('says nothing when the island stays out of her way', () => {
    const ground = groundVelocity(70, facing(0), null);
    expect(terrainIntercept(here, ground, 0, flat(0))).toBeNull();
    // Climbing away from it, certainly not.
    expect(terrainIntercept(here, ground, 30, flat(100))).toBeNull();
  });

  it('does not hunt forever for a queen who is not going anywhere', () => {
    expect(terrainIntercept(here, { x: 0, z: 0 }, 0, flat(0))).toBeNull();
  });

  it('finds the ground under a queen dropping straight down', () => {
    const hit = terrainIntercept(here, { x: 0, z: 0 }, -100, flat(100));
    expect(hit).not.toBeNull();
    expect((hit as { after: number }).after).toBeCloseTo(4, 0);
  });

  it('costs a bounded number of terrain lookups', () => {
    // A phone pays for every one of these, every frame.
    let asked = 0;
    const counted = () => { asked++; return -10_000; };
    terrainIntercept(here, groundVelocity(70, facing(0), null), 0, counted);
    expect(asked).toBeLessThanOrEqual(Math.ceil(10 / 0.1) + 1);
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
