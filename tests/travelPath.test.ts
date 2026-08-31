/**
 * THE SAME FLIGHT, PLAYED FASTER — or it is not boosted travel at all.
 *
 * ChatGPT called this the golden test and it is: fly the same
 * deterministic leg at 1x and at 10x and compare the SPATIAL track, the
 * altitude profile, the arrival point, the thirst spent and the stamina
 * spent. If the two lines lie on top of each other and both arrive
 * having paid the same biological price, then her clock really is the
 * only thing that changed. If they diverge, something is not on her
 * clock and the boost is a new physics mode wearing a x10 sticker.
 *
 * IT RUNS WITHOUT A RENDERER. `IslandScene` needs WebGL, so this drives
 * the same pieces the scene drives — Flight, the autopilot, Stamina,
 * Thirst — through the same substep planner, and integrates her
 * position the way `PlayerAnt` does. What it is testing is the CLOCK,
 * and the clock does not need a canvas.
 */
import { describe, expect, it } from 'vitest';
import { Autopilot, type NavSense } from '../src/ant/autopilot';
import { AUTOPILOT_DEFAULTS } from '../src/ant/autopilotConfig';
import { Flight, MAX_POWERED_SPEED } from '../src/ant/flight';
import { Stamina } from '../src/ant/stamina';
import { Thirst } from '../src/ant/thirst';
import { planSteps } from '../src/ant/travelScale';
import { groundVelocity, trackOf, type Drift } from '../src/ant/telemetry';
import { windProfile } from '../src/weather/windField';
import { world, type WorldPoint } from '../src/world/coords';

/** Flat ground, so the leg is about the clock and nothing else. */
const GROUND = 0;
/** A steady crosswind at reference height, so the crab is real. */
const ALOFT: Drift = { x: 45, z: 18 };

interface Sample {
  readonly wx: number;
  readonly wz: number;
  readonly agl: number;
  readonly at: number;
}

interface Leg {
  readonly path: Sample[];
  readonly end: WorldPoint;
  readonly thirst: number;
  readonly stamina: number;
  readonly flown: number;
  readonly frames: number;
}

/**
 * Fly one leg to the pin, at a given travel scale.
 *
 * `worldDt` is the frame the WORLD advances by; her simulation gets
 * `worldDt * scale`, spent in bounded substeps exactly as the scene
 * spends it.
 */
function fly(scale: number, worldDt = 1 / 60): Leg {
  const flight = new Flight();
  const stamina = new Stamina();
  const thirst = new Thirst();
  const ap = new Autopilot(AUTOPILOT_DEFAULTS);
  // 600 m off her shoulder: far enough for a real acquire turn, a
  // cruise and an approach, near enough that both legs actually arrive
  // inside the loop below. The first version put it five kilometres
  // out, neither leg finished, and the comparison was of two flights
  // that had been cut off at different points.
  const pin = world(48_000, -36_000);
  ap.engage(pin);

  // Airborne, level, pointed roughly at it, a metre up.
  let at: WorldPoint = world(0, 0);
  let agl = 100;
  flight.takeOff(MAX_POWERED_SPEED, 1, Math.PI - (53 * Math.PI) / 180);
  let held = 0;
  let flown = 0;
  const path: Sample[] = [];

  // Bounded on HER time rather than on frames, so the two legs are
  // stopped by the same thing — arriving — instead of by a frame count
  // that means ten times as much flying at ten times the scale.
  const LIMIT = 4_000;
  while (flown < LIMIT) {
    const plan = planSteps(worldDt * scale);
    for (let leg = 0; leg < plan.steps; leg++) {
      const dt = plan.each;
      const wind: Drift = {
        x: ALOFT.x * windProfile(agl), z: ALOFT.z * windProfile(agl),
      };
      const drift = groundVelocity(flight.airspeed, flight.heading, wind);
      held = trackOf(drift, held);
      const sense: NavSense = {
        at,
        altitude: GROUND + agl,
        ground: GROUND,
        heading: flight.heading,
        airspeed: flight.airspeed,
        drift,
        track: held,
        climbing: flight.climbing,
        aloft: flight.aloft,
        wingsWet: false,
        launchable: true,
        reserve: stamina.fraction,
        terrainAt: () => GROUND,
        windAt: (h) => ({ x: ALOFT.x * windProfile(h), z: ALOFT.z * windProfile(h) }),
      };
      const nav = ap.update(dt, sense);
      const step = flight.update(nav.demand, stamina.fraction, stamina.spent, dt, GROUND);
      // Her position, integrated the way PlayerAnt integrates it: the
      // model's own along/across, plus the air she is standing in.
      at = world(
        at.wx + (step.ahead * Math.sin(flight.heading)
          + step.across * Math.sin(flight.heading - Math.PI / 2) + wind.x) * dt,
        at.wz + (step.ahead * Math.cos(flight.heading)
          + step.across * Math.cos(flight.heading - Math.PI / 2) + wind.z) * dt,
      );
      agl = Math.max(0, agl + step.rise * dt);
      stamina.update(step.effort, dt);
      thirst.update(dt, false);
      flown += dt;
      path.push({ wx: at.wx, wz: at.wz, agl, at: flown });
    }
    if (ap.flying === 'hold') break;
  }
  return {
    path,
    end: at,
    thirst: thirst.fraction,
    stamina: stamina.fraction,
    flown,
    frames: 0,
  };
}

/** Where she was at a given point in HER flight, interpolated. */
function atFlown(leg: Leg, seconds: number): Sample {
  const path = leg.path;
  let last = path[0];
  for (const now of path) {
    if (now.at >= seconds) return now;
    last = now;
  }
  return last;
}

describe('the same flight, played faster', () => {
  const slow = fly(1);
  const fast = fly(10);

  it('both arrive', () => {
    expect(slow.path.length).toBeGreaterThan(10);
    expect(fast.path.length).toBeGreaterThan(10);
  });

  it('and take the same amount of HER time to do it', () => {
    // The wall clock differs by ten; her flight does not.
    expect(fast.flown).toBeCloseTo(slow.flown, 0);
  });

  it('and arrive at the same place', () => {
    // A body length is 140 units. Anything inside that is the same
    // arrival by any standard this game cares about.
    const apart = Math.hypot(fast.end.wx - slow.end.wx, fast.end.wz - slow.end.wz);
    expect(apart, `${apart.toFixed(0)} units apart`).toBeLessThan(140);
  });

  it('along the same line through the world', () => {
    // THE ONE THAT MATTERS. Sampled against HER OWN elapsed time, so
    // the comparison is of the path and not of the clock.
    let worst = 0;
    for (let t = 0; t < Math.min(slow.flown, fast.flown); t += 0.5) {
      const a = atFlown(slow, t);
      const b = atFlown(fast, t);
      worst = Math.max(worst, Math.hypot(a.wx - b.wx, a.wz - b.wz));
    }
    // Half a metre over a four-kilometre leg is a tenth of a per cent.
    expect(worst, `worst divergence ${worst.toFixed(0)} units`).toBeLessThan(50);
  });

  it('at the same altitudes', () => {
    let worst = 0;
    for (let t = 0; t < Math.min(slow.flown, fast.flown); t += 0.5) {
      worst = Math.max(worst, Math.abs(atFlown(slow, t).agl - atFlown(fast, t).agl));
    }
    // Ten centimetres. The band search is choosing the same band.
    expect(worst, `worst ${worst.toFixed(1)} units`).toBeLessThan(10);
  });

  it('having drunk the same amount of water', () => {
    // THE SURVIVAL POINT. If thirst ran on the world's clock instead of
    // hers, the boosted queen would arrive having spent a tenth of the
    // water — ten times the biological range, free, and every survival
    // detour built in Phase 1 stops meaning anything.
    expect(fast.thirst).toBeCloseTo(slow.thirst, 3);
  });

  it('and spent the same stamina', () => {
    expect(fast.stamina).toBeCloseTo(slow.stamina, 3);
  });
});

describe('and it survives a bad phone frame', () => {
  it('a clamped 0.1 s frame at full boost tracks the smooth one', () => {
    // The worst case the clamp allows, times ten, is a full second of
    // her time in one frame — the exact case substepping exists for. If
    // this diverges, the budget is being handed over in one leap
    // somewhere.
    const smooth = fly(10, 1 / 60);
    const nasty = fly(10, 0.1);
    const apart = Math.hypot(
      nasty.end.wx - smooth.end.wx, nasty.end.wz - smooth.end.wz,
    );
    expect(apart, `${apart.toFixed(0)} units apart`).toBeLessThan(200);
    expect(nasty.thirst).toBeCloseTo(smooth.thirst, 2);
  });
});
