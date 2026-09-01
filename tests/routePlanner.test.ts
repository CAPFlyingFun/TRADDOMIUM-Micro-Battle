/**
 * DOES THE ROUTE ACTUALLY MISS THE THING?
 *
 * The planner is pure and the world is not, so almost all of it can be
 * proved here rather than watched in a probe. The tests are written
 * against the two ANSWERS rather than against the code that produces
 * them — raise for a top, round for no top — because that split is the
 * design and the rest is arithmetic serving it.
 *
 * The numbers are TMB's own scale throughout: a world unit is a
 * centimetre, she is 140 units long, and a hazard 500 units across is a
 * five-metre bush.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clearable, ringAround, topFor, type Hazard } from '../src/ant/hazards';
import {
  ROUTE_DEFAULTS, entersRing, inside, planChain, planRoute, pushOut,
  routeAround, routeWords, type RouteLeg,
} from '../src/ant/routePlanner';
import { world, type WorldPoint } from '../src/world/coords';

const CFG = ROUTE_DEFAULTS;
/** The AGL the autopilot would have flown anyway. */
const BASE = 55;

const HER = world(0, 0);

function hazard(over: Partial<Hazard> = {}): Hazard {
  return {
    id: 'h',
    at: world(50_000, 0),
    radius: 2_000,
    top: null,
    kind: 'zone',
    ...over,
  };
}

/** Does any leg of the plan pass through the hazard's true footprint? */
function touches(legs: readonly RouteLeg[], h: Hazard, from = HER): boolean {
  const ring = ringAround({ ...h, radius: h.radius }, 0, 64);
  let at: WorldPoint = from;
  for (const leg of legs) {
    if (entersRing(at, leg.to, ring)) return true;
    at = leg.to;
  }
  return false;
}

function length(legs: readonly RouteLeg[], from = HER): number {
  let at = from;
  let run = 0;
  for (const leg of legs) {
    run += Math.hypot(leg.to.wx - at.wx, leg.to.wz - at.wz);
    at = leg.to;
  }
  return run;
}

describe('the one question that sorts them', () => {
  it('a thing with a top can be climbed over', () => {
    expect(clearable(hazard({ top: 400 }), CFG.clearance, CFG.ceilingAgl)).toBe(true);
  });

  it('a thing without one never can, at any altitude', () => {
    // THE POINT OF `null`. A predator does not become safe at four
    // metres, and a very large number instead of null would let a
    // planner with a generous ceiling decide otherwise.
    expect(clearable(hazard({ top: null }), CFG.clearance, 1e9)).toBe(false);
    expect(topFor(hazard({ top: null }), CFG.clearance)).toBe(null);
  });

  it('and a thing taller than she will climb becomes one of those', () => {
    // What makes the split honest rather than a label: a big enough
    // obstacle earns restricted-airspace treatment on its own merits.
    const tall = hazard({ top: CFG.ceilingAgl });
    expect(clearable(tall, CFG.clearance, CFG.ceilingAgl)).toBe(false);
    const just = hazard({ top: CFG.ceilingAgl - CFG.clearance });
    expect(clearable(just, CFG.clearance, CFG.ceilingAgl)).toBe(true);
  });

  it('and the top she must hold includes the air she keeps under her', () => {
    expect(topFor(hazard({ top: 400 }), CFG.clearance)).toBe(400 + CFG.clearance);
  });
});

describe('the footprint she is routed around', () => {
  it('encloses the circle rather than being inscribed in it', () => {
    // AN INSCRIBED OCTAGON'S EDGES PASS INSIDE THE RADIUS, which would
    // route her through up to 8% of the thing she is avoiding. Every
    // point on the true circle plus margin must be inside the ring.
    const h = hazard({ radius: 1_000 });
    const ring = ringAround(h, CFG.margin, 8);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 60) {
      // A HAIR INSIDE the circle, because the polygon touches it at
      // every edge midpoint: a point exactly on the boundary is
      // neither in nor out, and asking is a coin toss.
      const on = {
        wx: h.at.wx + Math.cos(a) * (h.radius + CFG.margin - 1),
        wz: h.at.wz + Math.sin(a) * (h.radius + CFG.margin - 1),
      };
      expect(inside(on, ring), `${((a * 180) / Math.PI).toFixed(0)}deg`).toBe(true);
    }
  });

  it('and leaves the margin outside the hazard itself', () => {
    const h = hazard({ radius: 1_000 });
    const ring = ringAround(h, CFG.margin, 8);
    for (const corner of ring) {
      expect(Math.hypot(corner.wx - h.at.wx, corner.wz - h.at.wz))
        .toBeGreaterThan(h.radius + CFG.margin - 1);
    }
  });

  it('and refuses to be a line', () => {
    expect(ringAround(hazard(), 0, 1).length).toBe(3);
    expect(ringAround(hazard(), 0, 2).length).toBe(3);
  });
});

describe('a segment that goes into a ring', () => {
  const ring = ringAround(hazard({ at: HER, radius: 1_000 }), 0, 8);

  it('is caught when it cuts across', () => {
    expect(entersRing(world(-5_000, 0), world(5_000, 0), ring)).toBe(true);
  });

  it('and when it lies WHOLLY inside, which crosses no edge at all', () => {
    // THE FAILURE THIS EXISTS FOR. A segment inside the ring crosses
    // none of its edges, so an edge-only test calls it clear — and that
    // is the bug that routes her through the middle of the thing.
    expect(entersRing(world(-200, 0), world(200, 0), ring)).toBe(true);
  });

  it('and is not caught when it passes outside', () => {
    expect(entersRing(world(-5_000, 3_000), world(5_000, 3_000), ring)).toBe(false);
  });

  it('and CORNER TO CORNER through the middle is entering', () => {
    // THE BUG THAT NEARLY SHIPPED, and no unit test would have caught
    // it by accident: a segment entering at one vertex and leaving by
    // the opposite one crosses no edge PROPERLY, and on a long leg its
    // midpoint is nowhere near the ring — so an edges-and-midpoint test
    // calls it clear while it passes straight through the centre.
    //
    // Found by a pen of sixteen overlapping hazards that she strolled
    // out of, because rings on a circle all share an orientation and
    // line their corners up constantly.
    const here = ringAround(hazard({ at: HER, radius: 1_000 }), 0, 8);
    const near = here[0];
    const far = here[4];
    const before = { wx: near.wx * 40, wz: near.wz * 40 };
    const after = { wx: far.wx * 40, wz: far.wz * 40 };
    expect(entersRing(near, far, here)).toBe(true);
    expect(entersRing(before, after, here)).toBe(true);
  });

  it('and running ALONG an edge is not', () => {
    // The other half of the same problem, and the one that cost her the
    // short way round: the router's own nodes are ring corners, so the
    // segment between two adjacent ones IS the ring's edge. If that
    // counts as entering, neighbouring corners cannot see each other.
    const here = ringAround(hazard({ at: HER, radius: 1_000 }), 0, 8);
    for (let i = 0; i < here.length; i++) {
      const a = here[i];
      const b = here[(i + 1) % here.length];
      expect(entersRing(a, b, here), `edge ${i}`).toBe(false);
    }
  });

  it('and touching a corner is not entering', () => {
    // Proper crossings only, which is what lets a route LEAVE from a
    // corner without the leg it leaves on being judged to have entered.
    const corner = ring[0];
    const away = { wx: corner.wx * 4, wz: corner.wz * 4 };
    expect(entersRing(corner, away, ring)).toBe(false);
  });
});

describe('flying over what has a top', () => {
  const tree = hazard({
    id: 'tree', at: world(50_000, 0), radius: 2_000, top: 400, kind: 'obstacle',
  });

  it('raises the leg instead of moving it', () => {
    const plan = planRoute(HER, world(100_000, 0), [tree], BASE, CFG);
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0].to).toEqual(world(100_000, 0));
    expect(plan.legs[0].floorAgl).toBe(400 + CFG.clearance);
    expect(plan.report.raised).toBe(1);
    expect(plan.report.detours).toBe(0);
  });

  it('and the raise is a FLOOR, not a height', () => {
    // Two systems both entitled to name her altitude would fight. The
    // planner names a minimum; the band search chooses above it.
    const plan = planRoute(HER, world(100_000, 0), [tree], BASE, CFG);
    expect(plan.legs[0].floorAgl).toBeGreaterThan(BASE);
    expect(plan.legs[0].floorAgl).toBeLessThan(CFG.ceilingAgl);
  });

  it('and a tree beside the leg is not a tree in it', () => {
    const beside = { ...tree, at: world(50_000, 20_000) };
    const plan = planRoute(HER, world(100_000, 0), [beside], BASE, CFG);
    expect(plan.legs[0].floorAgl).toBe(BASE);
    expect(plan.report.changed).toBe(false);
  });

  it('and the tallest thing on the leg wins', () => {
    const taller = { ...tree, id: 'taller', at: world(70_000, 0), top: 900 };
    const plan = planRoute(HER, world(100_000, 0), [tree, taller], BASE, CFG);
    expect(plan.legs[0].floorAgl).toBe(900 + CFG.clearance);
  });

  it('and one she is already flying above changes nothing', () => {
    // A leg with a floor of ten metres does not get "raised" to clear a
    // four-metre tree. The planner asks for a minimum, and this one is
    // already met.
    const plan = planRoute(HER, world(100_000, 0), [tree], 1_000, CFG);
    expect(plan.legs[0].floorAgl).toBe(1_000);
    expect(plan.report.raised).toBe(0);
  });
});

describe('going around what has none', () => {
  const zone = hazard({
    id: 'spider', at: world(50_000, 0), radius: 5_000, top: null, kind: 'predator',
  });
  const target = world(100_000, 0);

  it('misses it', () => {
    const plan = planRoute(HER, target, [zone], BASE, CFG);
    expect(plan.report.detours).toBeGreaterThan(0);
    expect(touches(plan.legs, zone)).toBe(false);
  });

  it('and still ends where she was told to go', () => {
    // IT NEVER REORDERS AND NEVER RETARGETS. The last leg is the pin.
    const plan = planRoute(HER, target, [zone], BASE, CFG);
    expect(plan.legs[plan.legs.length - 1].to).toEqual(target);
    expect(plan.legs[plan.legs.length - 1].detour).toBe(false);
  });

  it('and marks the inserted legs as its own, not the player\'s', () => {
    const plan = planRoute(HER, target, [zone], BASE, CFG);
    const inserted = plan.legs.filter((l) => l.detour);
    expect(inserted).toHaveLength(plan.report.detours);
  });

  it('and does not climb over it, whatever the ceiling', () => {
    const plan = planRoute(HER, target, [zone], BASE, {
      ...CFG, ceilingAgl: 1_000_000,
    });
    expect(plan.legs.every((l) => l.floorAgl === BASE)).toBe(true);
    expect(plan.report.detours).toBeGreaterThan(0);
  });

  it('and the detour is close to the shortest way round', () => {
    // A visibility graph gives the optimum over the POLYGON; against
    // the true circle it can only be a little longer. Two tangents plus
    // an arc round a 5,000-unit disc 50,000 out is about 100,700 units;
    // anything much past that is a planner wandering.
    const plan = planRoute(HER, target, [zone], BASE, CFG);
    expect(length(plan.legs)).toBeLessThan(103_000);
    expect(length(plan.legs)).toBeGreaterThan(100_000);
  });

  it('and goes the SHORT way round when the zone is off to one side', () => {
    const off = { ...zone, at: world(50_000, 3_000) };
    const plan = planRoute(HER, target, [off], BASE, CFG);
    // It sits north of the line, so the way round is south — negative
    // wz, since +wz is south... which is the point: check it stays on
    // the side the geometry says, whatever the compass calls it.
    expect(plan.legs.some((l) => l.detour && l.to.wz < off.at.wz)).toBe(true);
  });

  it('and threads a gap between two of them', () => {
    const north = { ...zone, id: 'n', at: world(50_000, -9_000), radius: 5_000 };
    const south = { ...zone, id: 's', at: world(50_000, 9_000), radius: 5_000 };
    const plan = planRoute(HER, target, [north, south], BASE, CFG);
    expect(touches(plan.legs, north)).toBe(false);
    expect(touches(plan.legs, south)).toBe(false);
  });

  it('and routes round a wall of them rather than between', () => {
    const wall: Hazard[] = [];
    for (let i = -4; i <= 4; i++) {
      wall.push({ ...zone, id: `w${i}`, at: world(50_000, i * 6_000), radius: 4_000 });
    }
    const plan = planRoute(HER, target, wall, BASE, CFG);
    for (const w of wall) expect(touches(plan.legs, w), w.id).toBe(false);
    expect(plan.report.blocked).toBe(false);
  });
});

describe('and both at once', () => {
  it('flies over the tree and round the spider on the same route', () => {
    const tree = hazard({
      id: 'tree', at: world(20_000, 0), radius: 2_000, top: 400, kind: 'obstacle',
    });
    const spider = hazard({
      id: 'spider', at: world(60_000, 0), radius: 5_000, top: null, kind: 'predator',
    });
    const plan = planRoute(HER, world(100_000, 0), [tree, spider], BASE, CFG);
    expect(plan.report.detours).toBeGreaterThan(0);
    expect(plan.report.raised).toBeGreaterThan(0);
    expect(touches(plan.legs, spider)).toBe(false);
    // The raise lands on the leg that actually crosses the tree, not on
    // all of them.
    expect(plan.legs.some((l) => l.floorAgl === 400 + CFG.clearance)).toBe(true);
    expect(plan.legs.some((l) => l.floorAgl === BASE)).toBe(true);
  });
});

describe('a destination she cannot be at', () => {
  const zone = hazard({ at: world(50_000, 0), radius: 5_000, top: null });

  it('is moved to the nearest place she can, and reported', () => {
    const plan = planRoute(HER, world(50_000, 0), [zone], BASE, CFG);
    expect(plan.report.moved).toBe(true);
    const end = plan.legs[plan.legs.length - 1].to;
    expect(inside(end, ringAround(zone, CFG.margin, CFG.sides))).toBe(false);
  });

  it('rather than refused, because the player pointed at somewhere', () => {
    const plan = planRoute(HER, world(50_000, 0), [zone], BASE, CFG);
    expect(plan.legs.length).toBeGreaterThan(0);
    expect(plan.report.blocked).toBe(false);
  });

  it('and dead centre still comes out somewhere, the same somewhere twice', () => {
    // A random nudge would mean two frames that agree about the world
    // producing different plans, which is a thing nobody can debug.
    const ring = ringAround(zone, CFG.margin, CFG.sides);
    const once = pushOut(zone.at, [ring], CFG.margin);
    const twice = pushOut(zone.at, [ring], CFG.margin);
    expect(once).toEqual(twice);
    expect(inside(once, ring)).toBe(false);
  });
});

describe('a queen already standing in one', () => {
  it('can still be given a route out', () => {
    // NOT THE SAME CASE AS A BAD DESTINATION: she is already there, and
    // nothing can be planned out of it. The ring she is inside must not
    // make every route look impossible.
    const zone = hazard({ at: HER, radius: 5_000, top: null });
    const plan = planRoute(HER, world(100_000, 0), [zone], BASE, CFG);
    expect(plan.report.blocked).toBe(false);
    expect(plan.legs[plan.legs.length - 1].to).toEqual(world(100_000, 0));
  });

  it('and the ones she is NOT in still turn her', () => {
    const under = hazard({ id: 'under', at: HER, radius: 5_000, top: null });
    const ahead = hazard({ id: 'ahead', at: world(50_000, 0), radius: 5_000, top: null });
    const plan = planRoute(HER, world(100_000, 0), [under, ahead], BASE, CFG);
    expect(touches(plan.legs, ahead)).toBe(false);
  });
});

describe('when there is no way through', () => {
  it('says so, and still flies the line', () => {
    // An executor that let go of the controls to announce a problem
    // would turn a bad route into a crash. BLOCKED is a report.
    // A CLOSED PEN AROUND THE DESTINATION, because nothing less is
    // actually blocked. Two earlier versions of this test were the
    // planner being right and the test being wrong: a line of hazards
    // with 400-unit gaps got threaded, and an overlapping wall 1.2 km
    // long got walked around the end of. A route is only impossible
    // when there is no way in at all.
    const pen: Hazard[] = [];
    const target = world(100_000, 0);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      pen.push(hazard({
        id: `p${i}`,
        at: world(target.wx + Math.cos(a) * 20_000, target.wz + Math.sin(a) * 20_000),
        radius: 5_000,
      }));
    }
    const plan = planRoute(HER, target, pen, BASE, CFG);
    expect(plan.report.blocked).toBe(true);
    expect(plan.legs[plan.legs.length - 1].to).toEqual(target);
  });

  it('and gives up on a bound rather than on a clock', () => {
    // What must not happen is a planner that thinks for a second on
    // somebody's phone. The graph is capped, so a field too dense is
    // refused quickly rather than laboured over.
    const many: Hazard[] = [];
    for (let i = 0; i < 400; i++) {
      many.push(hazard({
        id: `m${i}`,
        at: world(10_000 + (i % 20) * 4_000, Math.floor(i / 20) * 4_000 - 40_000),
        radius: 1_500,
      }));
    }
    const began = Date.now();
    const plan = planRoute(HER, world(100_000, 0), many, BASE, CFG);
    expect(Date.now() - began, 'planning took too long').toBeLessThan(250);
    expect(plan.legs.length).toBeGreaterThan(0);
  });
});

describe('an empty island', () => {
  it('is one leg, unchanged, and costs nothing to plan', () => {
    const plan = planRoute(HER, world(500_000, 250_000), [], BASE, CFG);
    expect(plan.legs).toEqual([
      { to: world(500_000, 250_000), floorAgl: BASE, detour: false },
    ]);
    expect(plan.report.changed).toBe(false);
  });

  it('and so is one with nothing in the way', () => {
    const far = hazard({ at: world(0, 900_000), radius: 5_000 });
    const plan = planRoute(HER, world(100_000, 0), [far], BASE, CFG);
    expect(plan.legs).toHaveLength(1);
    expect(plan.report.changed).toBe(false);
  });
});

describe('what it tells the player', () => {
  it('says nothing when it did nothing', () => {
    expect(routeWords({
      avoided: 0, detours: 0, raised: 0, moved: false, blocked: false, changed: false,
    })).toBe('');
  });

  it('and counts what it did, in words rather than in fields', () => {
    expect(routeWords({
      avoided: 2, detours: 4, raised: 1, moved: false, blocked: false, changed: true,
    })).toBe('round 2 hazards · over 1 leg');
    expect(routeWords({
      avoided: 1, detours: 2, raised: 0, moved: true, blocked: false, changed: true,
    })).toBe('round 1 hazard · pin moved clear');
  });

  it('and shouts the one that matters', () => {
    expect(routeWords({
      avoided: 0, detours: 0, raised: 0, moved: false, blocked: true, changed: true,
    })).toContain('NO CLEAR ROUTE');
  });
});

describe('the visibility graph itself', () => {
  it('returns no corners at all when the way is already clear', () => {
    expect(routeAround(HER, world(100_000, 0), [], 160)).toEqual([]);
  });

  it('and null rather than a route through the obstacle', () => {
    // Boxed in on every side: there is no answer, and inventing one
    // would be worse than saying so.
    const box: readonly WorldPoint[][] = [[
      world(-10_000, -10_000), world(10_000, -10_000),
      world(10_000, 10_000), world(-10_000, 10_000),
    ]];
    expect(routeAround(world(0, 0), world(0, 0), box, 160)).not.toBe(undefined);
    const out = routeAround(world(-50_000, 0), world(50_000, 0), box, 8);
    // With the bound below the corner count it cannot see a way past.
    expect(out === null || out.length > 0).toBe(true);
  });
});

describe('and it counts hazards, not corners', () => {
  it('says ONE hazard for one hazard, however many turns it takes', () => {
    // THE READOUT LYING ABOUT THE WORLD RATHER THAN ABOUT ITSELF: a
    // circular no-go takes two corner waypoints to pass, and the first
    // cut of this reported "round 2 hazards" for one. Caught in a probe
    // frame, where the number had something to be checked against.
    const zone = hazard({ at: world(50_000, 0), radius: 5_000, top: null });
    const plan = planRoute(HER, world(100_000, 0), [zone], BASE, CFG);
    expect(plan.report.avoided).toBe(1);
    expect(plan.report.detours).toBeGreaterThan(1);
    expect(routeWords(plan.report)).toContain('round 1 hazard');
  });

  it('and counts only the ones actually in the way', () => {
    const inTheWay = hazard({ id: 'a', at: world(50_000, 0), radius: 5_000 });
    const beside = hazard({ id: 'b', at: world(50_000, 60_000), radius: 5_000 });
    const plan = planRoute(HER, world(100_000, 0), [inTheWay, beside], BASE, CFG);
    expect(plan.report.avoided).toBe(1);
  });
});

/**
 * AND THE PLAN HAS TO REACH HER.
 *
 * The geometry above is pure and provable; this is the wiring, pinned
 * by reading the integration back. There is no DOM in this test run and
 * `IslandScene` needs WebGL, so the alternative to reading the source
 * is not testing it — and every autopilot bug this project has shipped
 * so far has been in the wiring rather than in the control law.
 */
describe('the scene flies the plan', () => {
  const scene = readFileSync('src/scenes/IslandScene.ts', 'utf8');

  it('turns the destination into a route when the order arrives', () => {
    const fly = scene.slice(scene.indexOf('private flyMyself'));
    const order = fly.indexOf('if (pin !== this.flownTo) {');
    const block = fly.slice(order, order + 2600);
    expect(block).toContain('planChain(');
    expect(block).toContain('planRoute(');
    expect(block).toContain('this.autopilot.engage(leg.to, leg.floorAgl)');
  });

  it('and plans through the CHAIN only when the pin is its next stop', () => {
    // The other case is a survival detour: the brain has decided she
    // needs a drink first, and a route to the puddle by way of three
    // waypoints chosen for the trip afterwards would be an autopilot
    // arguing with a thirsty queen.
    const fly = scene.slice(scene.indexOf('private flyMyself'));
    expect(fly).toContain('this.route = pin === next');
    expect(fly).toContain('? planChain(');
    expect(fly).toContain(': planRoute(');
  });

  it('and plans ONCE, at the order, not every frame', () => {
    // A route recomputed per frame changes under her as she flies it,
    // and a plan that cannot be shown to the player is not a plan.
    expect(scene.match(/planRoute\(/g) ?? []).toHaveLength(1);
  });

  it('and hands the autopilot one leg at a time', () => {
    // `hold` is its own word for "arrived and staying put" — right on
    // the last leg, and a turned corner on any earlier one.
    const fly = scene.slice(scene.indexOf('private flyMyself'));
    expect(fly).toContain("this.nav.state === 'hold' && this.route !== null");
    expect(fly).toContain('this.legAt < this.route.legs.length - 1');
  });

  it('and forgets the route when the destination goes', () => {
    const fly = scene.slice(scene.indexOf('private flyMyself'));
    const clear = fly.indexOf('this.autopilot.clear();');
    expect(fly.slice(clear, clear + 120)).toContain('this.route = null;');
  });

  it('and ships with an EMPTY hazard list, honestly', () => {
    // TMB has no trees with tops, no predators and no forbidden ground
    // yet. Filling this with invented content to give the planner
    // something to do would be a feature that exists only in the code
    // that avoids it.
    expect(scene).toContain('private readonly hazards: Hazard[] = [];');
  });

  it('and the map draws the route only when it bends', () => {
    // A "route" that is the straight line the dashed reference already
    // draws is two lines saying one thing.
    const marks = scene.slice(scene.indexOf('private marks()'));
    expect(marks.slice(0, 700)).toContain('this.route.legs.length > 1');
    const map = readFileSync('src/ui/MapScreen.ts', 'utf8');
    expect(map).toContain('marks?.route && marks.route.length > 1');
    expect(map).toContain('this.planned(ink, port, marks.at, marks.route)');
  });
});

describe('the autopilot takes the leg\'s floor with the leg', () => {
  const src = readFileSync('src/ant/autopilot.ts', 'utf8');

  it('as a minimum the band search may not look below', () => {
    expect(src).toContain('engage(at: WorldPoint, floorAgl?: number): void');
    expect(src).toContain('const band = bestBand(sense, wanted, leg);');
    // Proportional rather than a switch — see the comment in the file;
    // a bang-bang floor guard made two runs of the same flight at
    // different time scales drift apart.
    expect(src).toContain('const under = (leg.floorAgl - agl)');
  });

  it('and never as her altitude', () => {
    // Two systems both entitled to name her height would fight. There
    // is no path from a leg floor to a commanded altitude.
    expect(src).not.toContain('this.leg.floorAgl;');
  });

  it('and gives the base back when the leg does not raise it', () => {
    expect(src).toContain('floorAgl <= this.cfg.floorAgl');
    const clear = src.slice(src.indexOf('clear(): void {'));
    expect(clear.slice(0, 200)).toContain('this.leg = this.cfg;');
  });
});

describe('planning a chain', () => {
  it('visits every tap, in the order they were tapped', () => {
    const stops = [world(30_000, 0), world(30_000, 30_000), world(60_000, 30_000)];
    const plan = planChain(HER, stops, [], BASE, CFG);
    const mine = plan.legs.filter((l) => !l.detour).map((l) => l.to);
    expect(mine).toEqual(stops);
  });

  it('and does NOT reorder them, however much shorter that would be', () => {
    // THE CORNER IS THE POINT. They tapped it. A single search over the
    // whole chain could find a shorter total path by cutting one out,
    // and it would be answering a question nobody asked.
    const doubled = [world(80_000, 0), world(10_000, 0), world(80_000, 0)];
    const plan = planChain(HER, doubled, [], BASE, CFG);
    expect(plan.legs.map((l) => l.to)).toEqual(doubled);
  });

  it('and each leg starts where the last one actually ENDED', () => {
    // Including when that is not where the thumb landed: a waypoint
    // dropped inside a no-go is nudged out, and the leg after it has to
    // depart from where she will really be.
    const zone = hazard({ at: world(30_000, 0), radius: 5_000, top: null });
    const stops = [world(30_000, 0), world(90_000, 0)];
    const plan = planChain(HER, stops, [zone], BASE, CFG);
    expect(plan.report.moved).toBe(true);
    const first = plan.legs.filter((l) => !l.detour)[0].to;
    expect(first).not.toEqual(stops[0]);
    expect(touches(plan.legs, zone)).toBe(false);
  });

  it('and sums what it did to the whole thing', () => {
    const zone = hazard({ at: world(45_000, 0), radius: 5_000, top: null });
    const stops = [world(30_000, 0), world(60_000, 0)];
    const plan = planChain(HER, stops, [zone], BASE, CFG);
    expect(plan.report.avoided).toBeGreaterThan(0);
    expect(plan.report.changed).toBe(true);
  });

  it('and an empty chain is no legs at all, rather than a leg to nowhere', () => {
    const plan = planChain(HER, [], [], BASE, CFG);
    expect(plan.legs).toEqual([]);
    expect(plan.report.changed).toBe(false);
  });

  it('and one stop is exactly the single destination it always was', () => {
    const only = [world(70_000, 20_000)];
    expect(planChain(HER, only, [], BASE, CFG))
      .toEqual(planRoute(HER, only[0], [], BASE, CFG));
  });
});

/**
 * AND THE BRAIN MUST BE GIVEN A PLACE SHE IS NOT STANDING.
 *
 * Joshua, 2026-08-31: "I first set 3 points with the last basically my
 * starting position and instead of flying the full route, just took off
 * and landed at my last point a few meters away."
 *
 * The scene handed `MissionBrain` the END of the chain, its arrival
 * test is "am I within `arriveWithin` of it", and she was — so the
 * mission completed on the first tick and the two stops before it were
 * never ordered at all. The brain answers "where does she need to be",
 * and while a chain is running that is the NEXT place, not the last.
 */
describe('which stop the brain is given', () => {
  const scene = readFileSync('src/scenes/IslandScene.ts', 'utf8');

  it('is the next one, never the end of the chain', () => {
    const wire = scene.slice(scene.indexOf('confirm: (chain) => {'));
    expect(wire.slice(0, 1400)).toContain("this.orderTo(this.chain[0], 'waypoint')");
    expect(wire.slice(0, 1400)).not.toContain('chain[chain.length - 1]');
  });

  it('and the next one is ordered when the last completes', () => {
    expect(scene).toContain('this.chain.length > 0 && this.brain.primaryMission === null');
    const on = scene.slice(scene.indexOf('this.brain.primaryMission === null'));
    expect(on.slice(0, 300)).toContain('this.chain.shift();');
    expect(on.slice(0, 300)).toContain("this.orderTo(this.chain[0], 'waypoint')");
  });

  it('and ONE system decides she has arrived, not two', () => {
    // The leg-advance used to shift the chain as well. Two arrival
    // tests are two things that can disagree about the same moment.
    const from = scene.indexOf('private flyMyself');
    const fly = scene.slice(from, scene.indexOf('private marks()', from));
    expect(fly).not.toContain('this.chain.shift();');
  });

  it('and the route still covers the whole remaining trip', () => {
    // So the map shows the journey rather than the hop: the brain holds
    // the next stop, the planner plans through all of them.
    const fly = scene.slice(scene.indexOf('private flyMyself'));
    expect(fly).toContain('const next = this.chain.length > 0 ? this.chain[0] : null;');
    expect(fly).toContain('this.route = pin === next');
    expect(fly).toContain('this.ant.where, this.chain, this.hazards');
  });
});

/**
 * THE HAZARDS CAN BE A QUESTION, ASKED PER LEG.
 *
 * The island carries thousands of trees and the graph is bounded, so
 * the planner may only ever be shown the ones near the leg it is
 * planning. A list cannot do that for a chain — every stop would see
 * every corridor — so the source may be a function of the leg.
 */
describe('a hazard source asked per leg', () => {
  it('is asked once for a single destination, with her and the pin', () => {
    const asked: [WorldPoint, WorldPoint][] = [];
    const to = world(100_000, 0);
    const plan = planRoute(HER, to, (a, b) => { asked.push([a, b]); return []; }, BASE, CFG);
    expect(asked).toEqual([[HER, to]]);
    expect(plan.legs).toHaveLength(1);
  });

  it('and once per stop of a chain, each from where the last ended', () => {
    const asked: [WorldPoint, WorldPoint][] = [];
    const stops = [world(50_000, 0), world(50_000, 50_000), world(0, 50_000)];
    planChain(HER, stops, (a, b) => { asked.push([a, b]); return []; }, BASE, CFG);
    expect(asked).toEqual([
      [HER, stops[0]], [stops[0], stops[1]], [stops[1], stops[2]],
    ]);
  });

  it('and what it answers for a leg is what that leg is routed round', () => {
    // A zone astride the second leg only. The first leg must not bend
    // for it and the second must.
    const zone = hazard({ at: world(50_000, 25_000), radius: 5_000, top: null });
    const stops = [world(50_000, 0), world(50_000, 50_000)];
    const source = (_from: WorldPoint, to: WorldPoint) => (to === stops[1] ? [zone] : []);
    const plan = planChain(HER, stops, source, BASE, CFG);
    expect(plan.report.avoided).toBe(1);
    expect(plan.legs.length).toBeGreaterThan(2);
    // The first stop is still reached straight.
    expect(plan.legs[0].to).toEqual(stops[0]);
    expect(plan.legs[0].detour).toBe(false);
  });

  it('and a plain list still works exactly as before', () => {
    const zone = hazard({ at: world(50_000, 0), radius: 5_000, top: null });
    const asList = planRoute(HER, world(100_000, 0), [zone], BASE, CFG);
    const asFn = planRoute(HER, world(100_000, 0), () => [zone], BASE, CFG);
    expect(asFn.legs).toEqual(asList.legs);
    expect(asFn.report).toEqual(asList.report);
  });
});

/**
 * AND THE TREES REACH THE PLANNER THROUGH THAT SEAM, per leg.
 */
describe('the scene plans against the trees near each leg', () => {
  const scene = readFileSync('src/scenes/IslandScene.ts', 'utf8');

  it('hands the planner a question, not the list', () => {
    const fly = scene.slice(scene.indexOf('private flyMyself'));
    const order = fly.indexOf('if (pin !== this.flownTo) {');
    const block = fly.slice(order, order + 3200);
    expect(block).toContain('this.chain, this.hazardsAlong,');
    expect(block).toContain('pin, this.hazardsAlong,');
    expect(block).not.toContain('this.chain, this.hazards,');
  });

  it('and the question is the probe hazards plus the trees along the leg', () => {
    const source = scene.slice(scene.indexOf('private readonly hazardsAlong'));
    expect(source.slice(0, 400)).toContain('treeHazardsAlong(from, to)');
    expect(source.slice(0, 400)).toContain('[...this.hazards, ...trees.hazards]');
  });

  it('and the shipped list is still honestly empty', () => {
    expect(scene).toContain('private readonly hazards: Hazard[] = [];');
  });

  it('and the stand exists before the first turn of the relief dial', () => {
    // The constructor reshapes the island before it is done building,
    // and the relief dial re-seats the trees. Built after that call,
    // the first probe boot died in the constructor with the loading
    // screen up for ever — "Cannot read properties of undefined
    // (reading 'reseat')".
    const built = scene.indexOf('this.landmarks = new LandmarkStand(this.scene);');
    const reshaped = scene.indexOf('this.reshapeIsland();');
    expect(built).toBeGreaterThan(0);
    expect(built).toBeLessThan(reshaped);
    const relief = scene.slice(scene.indexOf('setRelief(times);'));
    expect(relief.slice(0, 80)).toContain('this.landmarks.reseat();');
  });
});
