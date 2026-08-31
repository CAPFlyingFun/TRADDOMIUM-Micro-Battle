/**
 * THE AUTOPILOT IS A PILOT, NOT A CHEAT.
 *
 * Phase 2's whole claim is that she gets to a waypoint the same way a
 * player would: by holding the stick. So most of what is worth testing
 * is about the difference between commanding and taking — that she
 * turns the right way, that she crabs into a wind rather than pointing
 * through it, that she gives up honestly when the air is faster than
 * she is, and that nothing in the file ever writes a position.
 *
 * All of it runs without a renderer. The autopilot takes a `terrainAt`
 * function rather than a heightfield, so a test can hand it a hill made
 * of arithmetic and know exactly what the answer should be.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  Autopilot, bandsFor, bearingTo, captured, progressIn, rangeTo, speedFor,
  tookOver, turnFor, type NavSense,
} from '../src/ant/autopilot';
import { AUTOPILOT_DEFAULTS, autopilotConfig } from '../src/ant/autopilotConfig';
import { groundVelocity, trackOf, type Drift } from '../src/ant/telemetry';
import { CRUISE_SPEED, MAX_POWERED_SPEED, STALL_SPEED } from '../src/ant/flight';
import { bearingFromHeading } from '../src/ui/compassMath';
import { world } from '../src/world/coords';

const CFG = AUTOPILOT_DEFAULTS;
const HER = world(0, 0);
/** Flat ground at sea level, unless a test says otherwise. */
const SEA = () => 0;

/** Heading in radians for a compass bearing — the repo's own relation. */
function headingFor(bearing: number): number {
  return Math.PI - (bearing * Math.PI) / 180;
}

function sense(over: Partial<NavSense> = {}): NavSense {
  const heading = over.heading ?? headingFor(0);
  const airspeed = over.airspeed ?? CRUISE_SPEED;
  const drift = over.drift ?? groundVelocity(airspeed, heading, null);
  return {
    at: HER,
    altitude: 100_000,
    ground: 0,
    heading,
    airspeed,
    drift,
    track: over.track ?? trackOf(drift, 0),
    climbing: 0,
    aloft: true,
    terrainAt: SEA,
    // Still air unless a test says otherwise, at every height.
    windAt: () => null,
    ...over,
  };
}

/** Fly the controller for a while against a fixed world. */
function run(ap: Autopilot, s: NavSense, seconds: number, step = 1 / 30) {
  let last = ap.update(step, s);
  for (let t = step; t < seconds; t += step) last = ap.update(step, s);
  return last;
}

describe('which way she turns', () => {
  it('flies straight at a target dead ahead', () => {
    // North is bearing 0, and she is tracking north.
    const ap = new Autopilot();
    ap.engage(world(0, -1_000_000));
    const now = ap.update(1 / 30, sense({ track: 0 }));
    expect(now.error).toBeCloseTo(0, 6);
    expect(now.demand.side).toBe(0);
    expect(now.state).toBe('cruise');
  });

  it('turns RIGHT for a target to the right', () => {
    // Tracking north, pin due east: wanted 90, error +90.
    const ap = new Autopilot();
    ap.engage(world(1_000_000, 0));
    const now = ap.update(1 / 30, sense({ track: 0 }));
    expect(now.wanted).toBeCloseTo(90, 6);
    expect(now.error).toBeCloseTo(90, 6);
    // Positive side is a right turn: Flight.steer does
    // `facing -= rate * side * dt` and a bearing is `PI - heading`, so
    // the two signs cancel.
    expect(now.demand.side).toBeGreaterThan(0);
  });

  it('turns LEFT for a target to the left', () => {
    const ap = new Autopilot();
    ap.engage(world(-1_000_000, 0));
    const now = ap.update(1 / 30, sense({ track: 0 }));
    expect(now.wanted).toBeCloseTo(270, 6);
    expect(now.error).toBeCloseTo(-90, 6);
    expect(now.demand.side).toBeLessThan(0);
  });

  it('and takes the short way round rather than the long one', () => {
    // Tracking 350, pin at 010. Twenty degrees right, not 340 left.
    const ap = new Autopilot();
    ap.engage(world(174_000, -985_000));    // bearing ~10
    const now = ap.update(1 / 30, sense({ track: 350 }));
    expect(now.error).toBeGreaterThan(0);
    expect(now.error).toBeLessThan(45);
  });
});

describe('the deadband, which is what stops the wag', () => {
  it('commands nothing at all inside it', () => {
    for (const error of [0, 1, 2.9, -2.9]) {
      expect(turnFor(error, CFG)).toBe(0);
    }
  });

  it('comes off zero smoothly rather than stepping', () => {
    // Measured from the EDGE of the deadband: a hair past it is a hair
    // of stick, not a finite jump.
    const nudge = turnFor(CFG.trackDeadband + 0.01, CFG);
    expect(nudge).toBeGreaterThan(0);
    expect(nudge).toBeLessThan(CFG.maxTurn / 100);
  });

  it('saturates rather than growing without limit', () => {
    expect(turnFor(CFG.trackFullScale, CFG)).toBeCloseTo(CFG.maxTurn, 6);
    expect(turnFor(179, CFG)).toBeCloseTo(CFG.maxTurn, 6);
    expect(Math.abs(turnFor(-179, CFG))).toBeCloseTo(CFG.maxTurn, 6);
  });

  it('and never asks for more stick than a player has', () => {
    for (let e = -180; e <= 180; e += 3) {
      expect(Math.abs(turnFor(e, CFG))).toBeLessThanOrEqual(1);
      expect(Math.abs(turnFor(e, CFG))).toBeLessThanOrEqual(CFG.maxTurn);
    }
  });
});

describe('wind, which is the whole reason it flies a track', () => {
  it('crabs into a crosswind instead of pointing at the pin', () => {
    // Pin due north. A hard easterly pushes her track west of north,
    // so the controller must ask for a RIGHT turn even though her nose
    // is already pointing straight at it.
    const ap = new Autopilot();
    ap.engage(world(0, -2_000_000));
    const heading = headingFor(0);                       // nose due north
    const wind = { x: -18, z: 0 };                       // blowing west
    const drift = groundVelocity(CRUISE_SPEED, heading, wind);
    const track = trackOf(drift, 0);
    expect(track).toBeGreaterThan(180);                  // pushed west of north
    const now = ap.update(1 / 30, sense({ heading, drift, track }));
    // Her HEADING error would be zero. Her TRACK error is not.
    expect(bearingFromHeading(heading)).toBeCloseTo(0, 6);
    expect(Math.abs(now.error)).toBeGreaterThan(CFG.trackDeadband);
    expect(now.demand.side).toBeGreaterThan(0);
  });

  it('does not invent thrust to beat a wind it cannot beat', () => {
    // A gale faster than she flies. The commanded airspeed must stay
    // inside the model's own envelope however hopeless the geometry.
    const ap = new Autopilot();
    ap.engage(world(0, -3_000_000));
    const heading = headingFor(0);
    const drift = groundVelocity(CRUISE_SPEED, heading, { x: 0, z: 140 });
    const now = ap.update(1 / 30, sense({ heading, drift, track: trackOf(drift, 0) }));
    expect(now.demand.hold ?? 0).toBeLessThanOrEqual(MAX_POWERED_SPEED);
    expect(now.target).toBeLessThanOrEqual(MAX_POWERED_SPEED);
  });

  it('and calls it BLOCKED when the range stops closing', () => {
    // Held exactly still over the ground: airspeed forward, wind equal
    // and opposite. She is flying hard and getting nowhere.
    const ap = new Autopilot();
    ap.engage(world(0, -3_000_000));
    const heading = headingFor(0);
    const drift = { x: 0, z: 0 };
    const now = run(ap, sense({ heading, drift, track: 0 }), CFG.patience + 1);
    expect(now.state).toBe('blocked');
    expect(now.blocked).toBe('no_progress');
  });

  it('but is patient enough to let her come round onto track first', () => {
    // Several seconds of not closing is normal on an acquire turn.
    const ap = new Autopilot();
    ap.engage(world(0, -3_000_000));
    const now = run(ap, sense({ drift: { x: 0, z: 0 }, track: 0 }), CFG.patience - 2);
    expect(now.state).not.toBe('blocked');
  });

  it('and keeps flying while blocked rather than dropping the controls', () => {
    // BLOCKED is a report, not a shutdown. Letting go to announce a
    // problem would turn a slow arrival into a crash.
    const ap = new Autopilot();
    ap.engage(world(1_000_000, 0));
    const now = run(ap, sense({ drift: { x: 0, z: 0 }, track: 0 }), CFG.patience + 1);
    expect(now.state).toBe('blocked');
    expect(now.demand.side).not.toBe(0);
    expect(now.demand.hold ?? 0).toBeGreaterThan(0);
  });
});

describe('the arrival profile', () => {
  it('holds cruise while the pin is far away', () => {
    expect(speedFor(5_000_000, CFG)).toBe(CFG.cruise);
    expect(speedFor(100_000, CFG)).toBe(CFG.cruise);
  });

  it('slows smoothly as the range closes, with no step anywhere', () => {
    // Down to the capture radius and no further: `sqrt` is vertical at
    // zero, and she is captured a long way before she gets there.
    let last = speedFor(20_000, CFG);
    for (let range = 20_000; range >= CFG.capture; range -= 10) {
      const now = speedFor(range, CFG);
      expect(now).toBeLessThanOrEqual(last + 1e-9);
      // Nothing jumps. The curve is steepest right at the capture
      // radius, where `d/dr sqrt(2ar)` is about 0.06 a unit — so ten
      // units of range is well under one unit of speed, everywhere.
      expect(last - now, `${range}`).toBeLessThan(1);
      last = now;
    }
  });

  it('never asks her to fly slower than she can', () => {
    for (const range of [0, 1, 50, 180, 400]) {
      expect(speedFor(range, CFG)).toBeGreaterThanOrEqual(CFG.slowest);
      expect(speedFor(range, CFG)).toBeGreaterThan(STALL_SPEED);
    }
  });

  it('and the commanded speed falls as she actually approaches', () => {
    const ap = new Autopilot();
    const pin = world(0, -30_000);
    ap.engage(pin);
    const far = ap.update(1 / 30, sense({ at: world(0, -29_000), track: 0 }));
    const near = ap.update(1 / 30, sense({ at: world(0, -29_600), track: 0 }));
    expect(near.target).toBeLessThan(far.target);
  });
});

describe('capture, and the orbit it prevents', () => {
  it('takes hold inside the capture radius', () => {
    expect(captured(CFG.capture - 1, false, CFG)).toBe(true);
    expect(captured(CFG.capture + 1, false, CFG)).toBe(false);
  });

  it('and does not let go for a metre of wind', () => {
    // THE HYSTERESIS. One radius means a nudge outside it turns her
    // back, she overshoots, and the loop is a circle round the pin for
    // ever. Letting go needs more than taking hold did.
    expect(captured(CFG.capture + 1, true, CFG)).toBe(true);
    expect(captured(CFG.release - 1, true, CFG)).toBe(true);
    expect(captured(CFG.release + 1, true, CFG)).toBe(false);
    expect(CFG.release).toBeGreaterThan(CFG.capture);
  });

  it('enters HOLD on arrival and stops steering', () => {
    const ap = new Autopilot();
    ap.engage(world(0, -100));
    const now = ap.update(1 / 30, sense({ track: 0 }));
    expect(now.state).toBe('hold');
    expect(now.demand.side).toBe(0);
    expect(now.demand.push).toBe(0);
  });

  it('and does not immediately uncapture on a small drift', () => {
    const ap = new Autopilot();
    const pin = world(0, 0);
    ap.engage(pin);
    ap.update(1 / 30, sense({ at: world(0, -CFG.capture + 10), track: 0 }));
    const nudged = ap.update(1 / 30, sense({
      at: world(0, -CFG.capture - 40), track: 0,
    }));
    expect(nudged.state).toBe('hold');
  });
});

describe('terrain, reactively', () => {
  /** A wall of ground north of the origin. */
  // Close enough to be INSIDE the lookahead. At cruise she covers 100
  // units in the 2.5 s this looks, so a ridge at 50,000 would never be
  // seen — which is what the first version of this test got wrong.
  const ridge = (_wx: number, wz: number): number => (wz < -50 ? 90_000 : 0);

  it('commands a climb when the ground ahead comes up', () => {
    const ap = new Autopilot();
    ap.engage(world(0, -2_000_000));
    const heading = headingFor(0);
    const drift = groundVelocity(CRUISE_SPEED, heading, null);
    // Twenty centimetres of air over the ridge — inside the 55 cm
    // floor, so the lookahead has to push her up.
    const now = ap.update(1 / 30, sense({
      heading, drift, track: 0, altitude: 90_020, terrainAt: ridge,
    }));
    expect(now.ahead).not.toBeNull();
    expect(now.ahead!).toBeLessThan(CFG.floorAgl);
    expect(now.demand.lift).toBeGreaterThan(0);
  });

  it('and holds the floor rather than an altitude above the sea', () => {
    // AGL, never MSL. Fifty metres up a hillside and three hundred over
    // a valley is the same number in MSL and a completely different
    // flight. `sense.ground` is the DRAWN floor the scene hands over —
    // terrain, or the water's own surface — so this is AWL over a lake
    // without knowing it is looking at one.
    const src = readFileSync('src/ant/autopilot.ts', 'utf8');
    expect(src).toContain('sense.altitude - sense.ground');
    // Comments stripped: the header SAYS "never in MSL", which is the
    // opposite of using it.
    const body = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(body).not.toMatch(/\bmsl\b/i);
  });

  it('and does not climb over ground that is going away', () => {
    const ap = new Autopilot();
    ap.engage(world(0, -2_000_000));
    const heading = headingFor(0);
    const drift = groundVelocity(CRUISE_SPEED, heading, null);
    const now = ap.update(1 / 30, sense({
      heading, drift, track: 0, altitude: 200_000, terrainAt: SEA,
    }));
    expect(now.demand.lift).toBe(0);
  });

  it('looks further ahead the faster she is crossing the ground', () => {
    // Time, not distance: useless at a sprint and wasteful at a hover
    // if it were fixed.
    const slow = new Autopilot();
    slow.engage(world(0, -2_000_000));
    const crawl = slow.update(1 / 30, sense({
      drift: { x: 0, z: -4 }, track: 0, altitude: 500_000, terrainAt: ridge,
    }));
    const fast = new Autopilot();
    fast.engage(world(0, -2_000_000));
    const dash = fast.update(1 / 30, sense({
      drift: { x: 0, z: -60 }, track: 0, altitude: 500_000, terrainAt: ridge,
    }));
    // The fast one sees the ridge; the slow one is still over flat sea.
    expect(dash.ahead).toBeLessThan(crawl.ahead!);
  });

  it('reports a climb it cannot make as terrain rather than as no progress', () => {
    const ap = new Autopilot();
    ap.engage(world(0, -3_000_000));
    // Flying EAST at a pin due north: she is moving, so there is an
    // "ahead" to look at, and the range to the pin barely changes.
    const wall = (): number => 10_000_000;
    const now = run(ap, sense({
      drift: { x: 30, z: 0 }, track: 90, altitude: 1_000, terrainAt: wall, climbing: 0,
    }), CFG.patience + 1);
    expect(now.state).toBe('blocked');
    expect(now.blocked).toBe('terrain');
  });
});

describe('the player always wins', () => {
  it('a real push, side or lift takes the controls back', () => {
    expect(tookOver(0.5, 0, 0, CFG)).toBe(true);
    expect(tookOver(0, -0.5, 0, CFG)).toBe(true);
    expect(tookOver(0, 0, 0.9, CFG)).toBe(true);
  });

  it('but a resting thumb does not', () => {
    expect(tookOver(0, 0, 0, CFG)).toBe(false);
    expect(tookOver(0.05, 0.05, 0.02, CFG)).toBe(false);
  });

  it('and the destination survives being taken over', () => {
    // Disengaging is the player taking the stick, not changing their
    // mind. The MissionBrain still holds the pin either way.
    const ap = new Autopilot();
    const pin = world(500_000, 0);
    ap.engage(pin);
    ap.disengage();
    expect(ap.engaged).toBe(false);
    expect(ap.pin).toEqual(pin);
    ap.engage(pin);
    expect(ap.engaged).toBe(true);
  });

  it('commands nothing while it is disengaged', () => {
    const ap = new Autopilot();
    ap.engage(world(1_000_000, 0));
    ap.disengage();
    const now = ap.update(1 / 30, sense({ track: 0 }));
    expect(now.demand).toEqual({ push: 0, side: 0, lift: 0 });
  });

  it('and does nothing at all on the ground', () => {
    // Taking off costs stamina and is a decision. An autopilot does not
    // make it because a pin exists somewhere.
    const ap = new Autopilot();
    ap.engage(world(1_000_000, 0));
    const now = ap.update(1 / 30, sense({ aloft: false }));
    expect(now.demand).toEqual({ push: 0, side: 0, lift: 0 });
  });
});

describe('it commands, and never takes', () => {
  const src = readFileSync('src/ant/autopilot.ts', 'utf8');

  it('writes no position, no velocity and no heading', () => {
    for (const forbidden of [
      '.placeAt(', '.position', '.velocity', 'facing =', '.setYaw(',
      'wx =', 'wz =', '.takeOff(', '.land(',
    ]) {
      expect(src, `autopilot.ts contains ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('never calls into Flight at all — it only builds a demand', () => {
    // It imports the TYPE and one constant, and that is the whole
    // relationship. Flight.update stays the only thing that moves her.
    expect(src).toContain('type FlightDemand');
    expect(src).not.toMatch(/flight\.update\s*\(/i);
    expect(src).not.toMatch(/new\s+Flight\b/);
  });

  it('and holds no mission — only a point', () => {
    // The brain owns WHY. A signature naming a Mission would be the
    // first crack in that. Comments stripped, the way
    // simulationCore.test.ts does it: prose ABOUT the MissionBrain is
    // not a dependency on it, and the header says plenty.
    const body = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(body).not.toContain('Mission');
    expect(body).not.toContain('missionBrain');
  });

  it('keeps its navigation states out of Motion', () => {
    // Stage G exists because those two were once one field.
    expect(src).not.toContain("from './motion'");
    expect(src).toContain("export type NavState");
  });
});

describe('the config is data, and the brain is not', () => {
  it('merges over the defaults, DinoConfig style', () => {
    const tight = autopilotConfig({ capture: 50 });
    expect(tight.capture).toBe(50);
    expect(tight.cruise).toBe(AUTOPILOT_DEFAULTS.cruise);
  });

  it('and every dial the controller reads comes from it', () => {
    const src = readFileSync('src/ant/autopilot.ts', 'utf8');
    // No bare tuning literals in the control laws: everything is
    // `cfg.something`. A number here would be one nobody could find.
    expect(src).toContain('cfg.trackDeadband');
    expect(src).toContain('cfg.maxTurn');
    expect(src).toContain('cfg.brake');
    expect(src).toContain('cfg.capture');
    expect(src).toContain('cfg.floorAgl');
    expect(src).toContain('cfg.patience');
  });
});

describe('the geometry helpers', () => {
  it('measure range flat, because arrival is a place not a height', () => {
    expect(rangeTo(world(0, 0), world(300, 400))).toBeCloseTo(500, 6);
  });

  it('and bearings the way the rest of the repo does', () => {
    expect(bearingTo(world(0, 0), world(0, -100))).toBeCloseTo(0, 6);   // north
    expect(bearingTo(world(0, 0), world(100, 0))).toBeCloseTo(90, 6);   // east
    expect(bearingTo(world(0, 0), world(0, 100))).toBeCloseTo(180, 6);  // south
    expect(bearingTo(world(0, 0), world(-100, 0))).toBeCloseTo(270, 6); // west
  });
});

/**
 * THE SCENE'S SIDE OF THE SPLIT.
 *
 * The wiring lives in a class that needs a WebGL context, so these are
 * read off the source — the same way the map's architecture is held in
 * mapMission.test.ts, and for the same reason: these are precisely the
 * rules that rot silently.
 */
describe('how the scene lets it fly', () => {
  const scene = readFileSync('src/scenes/IslandScene.ts', 'utf8');

  it('feeds the autopilot into Flight.update and nowhere else', () => {
    // The demand is spread into the same call a thumb's demand goes to.
    expect(scene).toContain('const nav = this.flyMyself(dt, trueFloor);');
    // Indentation moved when the branch was wrapped in the substep
    // loop, so this matches the shape rather than the whitespace.
    expect(scene).toMatch(/nav \? \{\s*\n\s*\.\.\.nav\.demand,/);
  });

  it('and never lets it raise the ceiling the player chose', () => {
    // An autopilot may ask for an airspeed. It does not get to overrule
    // the pace row, any more than Auto does.
    const call = scene.slice(scene.indexOf('nav ? {'));
    expect(call.slice(0, 600)).toContain('ceiling: wants ? SPRINT_AIRSPEED');
  });

  it('reads the RAW stick for the override, not the gated one', () => {
    // THE BUG THIS PREVENTS: `handsOff` zeroes the gated stick while a
    // menu is up, so testing that one would mean opening the map counted
    // as taking the controls — and she would disengage every time
    // somebody looked at the map she was flying to.
    expect(scene).toContain('tookOver(this.rawStick.y, this.rawStick.x');
    expect(scene).toContain('this.rawStick = held;');
  });

  it('flies what the brain says to serve, detour included', () => {
    // THE BUG A DEVICE SCREENSHOT CAUGHT. This read `primaryMission`,
    // and the frame showed `AI approach_water · pri waypoint · det
    // water` — the brain had started a survival detour and the
    // autopilot flew straight past it. Deciding where she needs to go
    // is the brain's entire job, and a detour IS that decision.
    const fly = scene.slice(scene.indexOf('private flyMyself'));
    expect(fly.slice(0, 1400)).toContain('this.brain.active?.at ?? null');
  });

  it('but the MAP still draws the player\'s own pin', () => {
    // Two different questions. The gold pin is where the PLAYER said to
    // go and must not jump to a puddle and back while she drinks.
    expect(scene).toContain('primary: this.brain.primaryMission?.at ?? null');
  });

  it('and the autopilot keeps flying while a menu is open', () => {
    // In multiplayer the world does not stop. An autopilot that let go
    // because someone opened the map is not an autopilot; the hover
    // stands in only when nothing else is holding the controls.
    const fly = scene.slice(scene.indexOf('private flyMyself'));
    expect(fly.slice(0, 3200)).toContain('!this.handsOff');
  });

  it('and once the player takes over, it STAYS taken', () => {
    // THE DESIGN FLAW THIS FIXES, caught by reading the integration
    // back rather than by a failing test: the first cut re-engaged the
    // moment `tookOver` went false, which is the frame the thumb lifts.
    // The player could never fly manually while a pin existed without
    // holding the stick for ever — every nudge undone the instant they
    // let go, the autopilot fighting them rather than obeying them.
    //
    // Getting it back is a deliberate act: confirm the destination
    // again, which is what a new pin identity means.
    const fly = scene.slice(scene.indexOf('private flyMyself'));
    expect(fly).toContain('this.surrendered = true;');
    expect(fly).toContain('if (this.surrendered || pin === null');
    // And the ONLY thing that clears it is a new order.
    expect(fly).toContain('if (pin !== this.flownTo)');
    expect(fly).toContain('this.surrendered = false;');
    expect(scene.match(/this\.surrendered = false;/g) ?? []).toHaveLength(1);
  });

  it('and a lever coming home on its own is not the player flying', () => {
    // THE BUG THE FIRST END-TO-END FLIGHT FOUND, and no unit test would
    // have. The lift lever is designed to return home over a second
    // when released, and a takeoff leaves it at FULL deflection — so
    // reading its VALUE meant every frame of that second re-declared
    // "the player is flying". The autopilot could never engage after a
    // takeoff, which is the only way she gets airborne. Measured in the
    // game: engaged false, surrendered true, lever 1.0 → 0.9 → 0.8
    // while she was already climbing away hands-off.
    //
    // The lever counts only while GRIPPED. The stick is a different
    // case and is read by value: it reads its keys and its thumb live,
    // so its value really is a command.
    expect(scene).toContain('this.liftSlider.held ? this.liftSlider.lift : 0');
    expect(scene).toContain('tookOver(this.rawStick.y, this.rawStick.x, lever');
    const slider = readFileSync('src/input/LiftSlider.ts', 'utf8');
    expect(slider).toContain('get held(): boolean');
    expect(slider).toContain('return this.gripped !== null;');
  });

  it('gives it the same floor the flight model is given', () => {
    // The DRAWN surface, water included. A clearance measured against
    // the seabed under nine metres of sea is not a clearance.
    const fly = scene.slice(scene.indexOf('private flyMyself'));
    expect(fly).toContain('groundHeight(wx, wz) + (waterSpotAt(wx, wz)?.depth ?? 0)');
  });
});

/**
 * CHOOSING AN ALTITUDE, which is the navigation computer's real work.
 *
 * Joshua flew Phase 2 into a 132 cm/s gale at 4.9 m with a 40 cm/s
 * airspeed and watched Kauaʻi not get any closer. The autopilot was
 * doing exactly what it was told — hold four metres — and four metres
 * was the wrong instruction.
 *
 * ChatGPT's correction is the rule these test: 55 cm is the MINIMUM
 * CANDIDATE, not the automatic target. Price every band by the ground
 * progress it would actually buy and take the best. Down in a headwind,
 * UP in a tailwind, and never a rule that fires on the crab alone.
 */
describe('the altitude band search', () => {
  const AIRSPEED = 70;
  /** Wind blowing due SOUTH (+z), i.e. a headwind for a northbound leg. */
  const southerly = (speed: number) => ({ x: 0, z: speed });
  /** The real profile: t^2(3-2t) to full strength at ten metres. */
  const profile = (agl: number): number => {
    const t = Math.min(1, Math.max(0, agl) / 1000);
    return t * t * (3 - 2 * t);
  };
  const graded = (full: Drift) => (agl: number): Drift => ({
    x: full.x * profile(agl), z: full.z * profile(agl),
  });

  it('prices a headwind band by what it actually buys', () => {
    // Due north (bearing 0) into a southerly: the wind is pure headwind,
    // so progress is airspeed minus wind and there is no crab at all.
    const calm = progressIn(null, AIRSPEED, 0);
    expect(calm.speed).toBeCloseTo(AIRSPEED, 6);
    expect(calm.crab).toBeCloseTo(0, 6);
    const into = progressIn(southerly(30), AIRSPEED, 0);
    expect(into.speed).toBeCloseTo(AIRSPEED - 30, 6);
  });

  it('and a tailwind adds to it', () => {
    const with_ = progressIn({ x: 0, z: -30 }, AIRSPEED, 0);
    expect(with_.speed).toBeCloseTo(AIRSPEED + 30, 6);
  });

  it('and calls a crosswind bigger than her airspeed unflyable', () => {
    // No crab cancels it, so the track cannot be held at all. Minus
    // infinity rather than a small number: an unflyable band is not a
    // slow band, and averaging the two would pick it.
    const across = progressIn({ x: 200, z: 0 }, AIRSPEED, 0);
    expect(across.speed).toBe(-Infinity);
  });

  it('and reports the crab a crosswind costs', () => {
    // Half her airspeed across gives asin(0.5) = 30 degrees of crab.
    const half = progressIn({ x: AIRSPEED / 2, z: 0 }, AIRSPEED, 0);
    expect(Math.abs(half.crab)).toBeCloseTo(30, 4);
    expect(half.speed).toBeCloseTo(AIRSPEED * Math.cos(Math.PI / 6), 4);
  });

  it('DESCENDS out of a headwind it cannot beat', () => {
    // Joshua's frame, near enough: a wind far over her airspeed up high.
    const ap = new Autopilot();
    ap.engage(world(0, -3_000_000));
    const now = ap.update(1 / 30, sense({
      altitude: 490, ground: 0, airspeed: AIRSPEED, track: 0,
      drift: { x: 0, z: -10 },
      windAt: graded(southerly(273)),
    }));
    expect(now.band).toBe(CFG.floorAgl);
    expect(now.demand.lift).toBeLessThan(0);
  });

  it('CLIMBS to ride a tailwind, which a crab rule never would', () => {
    // The same geometry with the wind behind her. A rule that only ever
    // descended would throw this away.
    const ap = new Autopilot();
    ap.engage(world(0, -3_000_000));
    const now = ap.update(1 / 30, sense({
      altitude: 60, ground: 0, airspeed: AIRSPEED, track: 0,
      drift: { x: 0, z: -10 },
      windAt: graded({ x: 0, z: -120 }),
    }));
    expect(now.band).toBeGreaterThan(CFG.floorAgl);
    expect(now.demand.lift).toBeGreaterThan(0);
  });

  it('never chooses a band below the floor', () => {
    for (const wind of [southerly(300), { x: 300, z: 0 }, { x: 0, z: -300 }]) {
      const ap = new Autopilot();
      ap.engage(world(0, -3_000_000));
      const now = ap.update(1 / 30, sense({
        altitude: 400, ground: 0, airspeed: AIRSPEED, track: 0,
        drift: { x: 0, z: -10 }, windAt: graded(wind),
      }));
      expect(now.band).toBeGreaterThanOrEqual(CFG.floorAgl);
    }
    for (const band of bandsFor(CFG)) {
      expect(band).toBeGreaterThanOrEqual(CFG.floorAgl);
    }
  });

  it('and pushes her up when she is under it', () => {
    const ap = new Autopilot();
    ap.engage(world(0, -3_000_000));
    const now = ap.update(1 / 30, sense({
      altitude: 20, ground: 0, airspeed: AIRSPEED, track: 0,
      drift: { x: 0, z: -10 },
    }));
    expect(now.demand.lift).toBeGreaterThan(0);
  });

  it('does NOT descend merely because the crab is large', () => {
    // THE RULE CHATGPT STOPPED. A pure crosswind that is the same at
    // every height gives a big crab and nothing to gain by moving, so
    // she should stay where she is rather than diving on a symptom.
    const ap = new Autopilot();
    ap.engage(world(0, -3_000_000));
    const flat = { x: AIRSPEED * 0.6, z: 0 };
    const now = ap.update(1 / 30, sense({
      altitude: 800, ground: 0, airspeed: AIRSPEED, track: 0,
      drift: { x: 0, z: -10 }, windAt: () => flat,
    }));
    expect(Math.abs(now.crab)).toBeGreaterThan(30);
    expect(now.band).toBe(800);
    expect(now.demand.lift).toBeCloseTo(0, 6);
  });

  it('and flies the fastest the model gives, not a cruise setting', () => {
    // "traveling way too slow and should set for the fastest speed."
    expect(CFG.cruise).toBe(MAX_POWERED_SPEED);
    expect(CFG.cruise).toBeGreaterThan(CRUISE_SPEED);
    expect(speedFor(5_000_000, CFG)).toBe(MAX_POWERED_SPEED);
  });
});
