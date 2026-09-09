/**
 * The legs: pure integrators that turn at a rate, never overshoot, keep
 * a worm in its band, a fly under its ceiling and over the FLOOR — the
 * ground, or the water standing on it — an aphid on its stem, and never
 * write a NaN.
 */
import { describe, expect, it } from 'vitest';
import { APHID, EARTHWORM, HOUSEFLY, QUEEN, WORKER, newCreature, unitsOfMm, type CreatureState, type CreatureWorld } from '../src/creatures';
import { wrapHeading } from '../src/creatures/heading';
import { DROP_MM_S, arrived, burrow, floorAt, fly, isAirborne, isMoving, move, paceOf, walk } from '../src/creatures/locomotion';
import { distance, world, type WorldPoint } from '../src/world/coords';
import type { WaterQuery } from '../src/world/ecology/resources';
import { SEA_HABITAT } from '../src/world/habitat';
import { SEA_LEVEL } from '../src/world/heightfield';

const slope = (at: WorldPoint): number => 100 + at.wx * 0.05 + Math.sin(at.wz / 50) * 3;

/** A world of one ground function and, when a test stands something on water, one water. Null water: none known. */
function fakeWorld(ground: (at: WorldPoint) => number = slope, water: WaterQuery | null = null): CreatureWorld {
  return {
    groundAt: ground,
    normalAt: () => ({ nx: 0, ny: 1, nz: 0 }),
    habitatAt: () => SEA_HABITAT,
    plantsOf: () => null,
    resourcesOf: () => null,
    water,
    weather: () => null,
    disturbances: () => [],
  };
}

/** Water that is the same everywhere: the sea, a pond `depth` deep, or dry ground under a water that knows it. */
const SEA: WaterQuery = { freshDepthAt: () => 0, isSeaAt: () => true, nearestWater: () => null };
const pond = (depth: number): WaterQuery => ({ freshDepthAt: () => depth, isSeaAt: () => false, nearestWater: () => null });
const DRY: WaterQuery = { freshDepthAt: () => 0, isSeaAt: () => false, nearestWater: () => null };

function creature(species: typeof EARTHWORM, at: WorldPoint, height: number, heading = 0): CreatureState {
  return newCreature({ id: `${species.id}:0,0:0`, species: species.id, cellKey: '0,0', at, height, heading, phase: 0 });
}

/** The same creature, at a length it was drawn with rather than the one the table cites. */
function sized(species: typeof EARTHWORM, at: WorldPoint, height: number, lengthMm: number, heading = 0): CreatureState {
  return newCreature({ id: `${species.id}:0,0:1`, species: species.id, cellKey: '0,0', at, height, heading, phase: 0, lengthMm });
}

function finite(c: CreatureState): void {
  for (const v of [c.at.wx, c.at.wz, c.height, c.heading, c.pitch, c.targetHeight]) expect(Number.isFinite(v)).toBe(true);
}

describe('walking', () => {
  it('turns toward the target at no more than turnRadS a second, advances at the pace, arrives and stops', () => {
    const w = fakeWorld(() => 0);
    const c = creature(HOUSEFLY, world(0, 0), 0, 0);
    c.behaviour = 'wander';
    c.target = world(-30, 0); // west: heading -π/2
    const dt = 1 / 60;
    let lastHeading = c.heading;
    let travelled = 0;
    for (let i = 0; i < 60 * 5; i += 1) {
      travelled += walk(c, HOUSEFLY, w, dt);
      const turned = Math.abs(wrapHeading(c.heading - lastHeading));
      expect(turned).toBeLessThanOrEqual(HOUSEFLY.pace.turnRadS * dt + 1e-9);
      lastHeading = c.heading;
      finite(c);
    }
    // It drifted a little south while it came about, so the last bearing to the target is a shade south of west.
    expect(c.heading).toBeCloseTo(-Math.PI / 2, 1);
    expect(arrived(c, HOUSEFLY)).toBe(false);
    // A fly walks 15 mm/s: 1.5 units a second, 7.5 in five seconds, and no more.
    expect(travelled).toBeCloseTo(unitsOfMm(HOUSEFLY.pace.wanderMmS) * 5, 6);
    for (let i = 0; i < 60 * 20; i += 1) walk(c, HOUSEFLY, w, dt);
    expect(arrived(c, HOUSEFLY)).toBe(true);
    expect(distance(c.at, c.target!)).toBe(0);
    const before = c.at;
    walk(c, HOUSEFLY, w, dt);
    expect(c.at).toBe(before);
  });

  it('a fleeing walker goes at the flee pace; an idle one does not move; feeding moves only toward its food', () => {
    const w = fakeWorld(() => 0);
    const c = creature(APHID, world(0, 0), 0);
    c.behaviour = 'flee';
    c.target = world(0, 100);
    expect(paceOf(c, APHID)).toBeCloseTo(unitsOfMm(APHID.pace.fleeMmS), 12);
    expect(walk(c, APHID, w, 1)).toBeCloseTo(unitsOfMm(APHID.pace.fleeMmS), 9);
    c.behaviour = 'idle';
    expect(walk(c, APHID, w, 1)).toBe(0);
    c.behaviour = 'feed';
    c.target = null;
    expect(paceOf(c, APHID)).toBe(0);
    c.target = world(0, 100);
    expect(paceOf(c, APHID)).toBeCloseTo(unitsOfMm(APHID.pace.wanderMmS), 12);
  });

  it('a ground walker stands on the ground; a plant walker eases up its stem and never below the ground', () => {
    const w = fakeWorld();
    const f = creature(HOUSEFLY, world(10, 10), 0);
    f.behaviour = 'idle';
    walk(f, HOUSEFLY, w, 0.1);
    expect(f.height).toBeCloseTo(slope(f.at), 12);
    const a = creature(APHID, world(10, 10), slope(world(10, 10)));
    a.behaviour = 'wander';
    a.targetHeight = slope(world(10, 10)) + 5;
    let last = a.height;
    // An aphid climbs at its walking pace, 0.6 mm/s: five units is eighty-three seconds.
    for (let i = 0; i < 1000; i += 1) {
      walk(a, APHID, w, 0.1);
      expect(a.height).toBeGreaterThanOrEqual(slope(a.at) - 1e-9);
      expect(a.height - last).toBeLessThanOrEqual(unitsOfMm(APHID.pace.wanderMmS) * 0.1 + 1e-9);
      last = a.height;
    }
    expect(a.height).toBeCloseTo(slope(world(10, 10)) + 5, 9);
    a.targetHeight = -1000;
    for (let i = 0; i < 1000; i += 1) walk(a, APHID, w, 0.1);
    expect(a.height).toBeCloseTo(slope(a.at), 9);
  });
});

describe('burrowing', () => {
  const under = unitsOfMm(EARTHWORM.burrow!.underMm);
  const half = unitsOfMm(EARTHWORM.burrow!.boreMm) / 2;

  it('keeps the worm in the band under a slope while it burrows, and drops it to the bottom when it flees', () => {
    const w = fakeWorld();
    const c = creature(EARTHWORM, world(0, 0), slope(world(0, 0)) - under, Math.PI / 2);
    c.behaviour = 'burrow';
    c.target = world(500, 0); // uphill: the ground rises 25 units over the trip
    c.targetHeight = slope(world(0, 0)) - under / 2;
    for (let i = 0; i < 60 * 60; i += 1) {
      burrow(c, EARTHWORM, w, 1 / 60);
      const g = slope(c.at);
      expect(c.height).toBeLessThanOrEqual(g - half + 1e-9);
      expect(c.height).toBeGreaterThanOrEqual(g - under - 1e-9);
      finite(c);
    }
    // The cited worm travels at 15 mm/s: ninety units east in a minute, no more, no less.
    expect(c.at.wx).toBeCloseTo(unitsOfMm(EARTHWORM.pace.wanderMmS) * 60, 6);
    c.behaviour = 'flee';
    for (let i = 0; i < 60 * 10; i += 1) burrow(c, EARTHWORM, w, 1 / 60);
    expect(c.height).toBeCloseTo(slope(c.at) - under, 6);
  });

  it('surfacing eases it up to the ground and never above; feeding lies on the ground too; the pitch says which way', () => {
    const w = fakeWorld();
    const c = creature(EARTHWORM, world(0, 0), slope(world(0, 0)) - under);
    c.behaviour = 'surface';
    let rising = 0;
    for (let i = 0; i < 60 * 10; i += 1) {
      burrow(c, EARTHWORM, w, 1 / 60);
      expect(c.height).toBeLessThanOrEqual(slope(c.at) + 1e-9);
      if (c.pitch > 0) rising += 1;
    }
    expect(rising).toBeGreaterThan(0);
    expect(c.height).toBeCloseTo(slope(c.at), 6);
    c.behaviour = 'feed';
    burrow(c, EARTHWORM, w, 1);
    expect(c.height).toBeCloseTo(slope(c.at), 6);
    c.behaviour = 'burrow';
    c.target = null;
    burrow(c, EARTHWORM, w, 1);
    expect(c.height).toBeLessThanOrEqual(slope(c.at) - half + 1e-9);
    expect(c.pitch).toBeLessThan(0);
  });
});

describe('flying', () => {
  const ceiling = unitsOfMm(HOUSEFLY.flight!.ceilingMm);

  it('climbs on takeoff, holds the cruise band over the ground, never passes the ceiling, and lands on the ground', () => {
    const w = fakeWorld();
    const start = world(0, 0);
    const c = creature(HOUSEFLY, start, slope(start));
    c.behaviour = 'takeoff';
    c.target = world(400, 300);
    c.targetHeight = slope(start) + 10_000; // asks for far above the ceiling
    let climbing = 0;
    for (let i = 0; i < 60 * 3; i += 1) {
      fly(c, HOUSEFLY, w, 1 / 60);
      const g = slope(c.at);
      expect(c.height).toBeGreaterThanOrEqual(g - 1e-9);
      expect(c.height).toBeLessThanOrEqual(g + ceiling + 1e-9);
      if (c.pitch > 0) climbing += 1;
      finite(c);
    }
    expect(climbing).toBeGreaterThan(0);
    // Held inside the cruise band, not at the ceiling it asked for.
    expect(c.height - slope(c.at)).toBeCloseTo(unitsOfMm(HOUSEFLY.flight!.cruiseMm[1]), 3);
    c.behaviour = 'hover';
    const held = c.at;
    fly(c, HOUSEFLY, w, 1);
    expect(c.at).toBe(held);
    c.behaviour = 'land';
    let descending = 0;
    for (let i = 0; i < 60 * 3; i += 1) {
      fly(c, HOUSEFLY, w, 1 / 60);
      if (c.pitch < 0) descending += 1;
    }
    expect(descending).toBeGreaterThan(0);
    expect(c.height).toBeCloseTo(slope(c.at), 6);
    expect(arrived(c, HOUSEFLY)).toBe(true);
  });

  it('cruises at the flight pace on the plane, not the walking pace', () => {
    const w = fakeWorld(() => 0);
    const c = creature(HOUSEFLY, world(0, 0), 30);
    c.behaviour = 'fly';
    c.target = world(0, 10_000);
    expect(fly(c, HOUSEFLY, w, 0.1)).toBeCloseTo(unitsOfMm(HOUSEFLY.flight!.cruiseMmS) * 0.1, 9);
  });
});

describe('the floor under a flier', () => {
  const ceiling = unitsOfMm(HOUSEFLY.flight!.ceilingMm);
  const lo = unitsOfMm(HOUSEFLY.flight!.cruiseMm[0]);
  const hi = unitsOfMm(HOUSEFLY.flight!.cruiseMm[1]);

  it('is mean sea level over the sea, the ground plus the depth over fresh water, and the ground on dry land', () => {
    const at = world(10, 10);
    // A two-metre sea: the bed is not the floor, the mean surface is.
    expect(floorAt(fakeWorld(() => -200, SEA), at)).toBe(SEA_LEVEL);
    // A beach the query calls sea because the swell reaches it is still a beach: the ground wins where it is higher.
    expect(floorAt(fakeWorld(() => 5, SEA), at)).toBe(5);
    // A thirty-centimetre pond on ground a metre up: the floor is the pond's surface.
    expect(floorAt(fakeWorld(() => 100, pond(30)), at)).toBe(130);
    expect(floorAt(fakeWorld(() => 100, DRY), at)).toBe(100);
    // With no water known, a bed below mean sea level is the sea — the water query's own rule — and dry ground is dry.
    expect(floorAt(fakeWorld(() => -50), at)).toBe(SEA_LEVEL);
    expect(floorAt(fakeWorld(() => 100), at)).toBe(100);
    // A ground the world cannot price is handed back as it is, so a caller that guards the ground guards the floor.
    expect(Number.isNaN(floorAt(fakeWorld(() => NaN, pond(30)), at))).toBe(true);
    // A depth that is not a depth adds nothing: the answer is never NaN where the ground was not.
    expect(floorAt(fakeWorld(() => 100, pond(NaN)), at)).toBe(100);
    expect(floorAt(fakeWorld(() => 100, pond(-5)), at)).toBe(100);
  });

  it('a fly over a two-metre sea flies in its band over the water, never between the bed and the surface, and lands on the water', () => {
    const w = fakeWorld(() => -200, SEA);
    // Starting on the seabed — where alpha.35 held it — it is over the surface from the first frame.
    const c = creature(HOUSEFLY, world(0, 0), -200);
    c.behaviour = 'fly';
    c.target = world(0, 100_000);
    c.targetHeight = 10_000;
    for (let i = 0; i < 60 * 5; i += 1) {
      fly(c, HOUSEFLY, w, 1 / 60);
      expect(c.height).toBeGreaterThanOrEqual(SEA_LEVEL - 1e-9);
      expect(c.height).toBeLessThanOrEqual(SEA_LEVEL + ceiling + 1e-9);
      finite(c);
    }
    expect(c.height).toBeGreaterThanOrEqual(SEA_LEVEL + lo - 1e-9);
    expect(c.height).toBeCloseTo(SEA_LEVEL + hi, 6);
    // Asked for no height in particular, it settles at the bottom of the band — twelve centimetres over the sea, not the bed.
    c.targetHeight = NaN;
    for (let i = 0; i < 60 * 5; i += 1) fly(c, HOUSEFLY, w, 1 / 60);
    expect(c.height).toBeCloseTo(SEA_LEVEL + lo, 6);
    // Told to land over the sea, it comes down to the water and no further.
    c.behaviour = 'land';
    for (let i = 0; i < 60 * 5; i += 1) fly(c, HOUSEFLY, w, 1 / 60);
    expect(c.height).toBeCloseTo(SEA_LEVEL, 6);
  });

  it('the same over a thirty-centimetre pond: the band hangs from the pond\'s surface, not its bed', () => {
    const depth = 30;
    const w = fakeWorld(slope, pond(depth));
    const start = world(0, 0);
    const surface = (at: WorldPoint): number => slope(at) + depth;
    // On the bed, as a fly that aimed at the puddle was.
    const c = creature(HOUSEFLY, start, slope(start));
    c.behaviour = 'fly';
    c.target = world(400, 300);
    c.targetHeight = slope(start) + 10_000;
    for (let i = 0; i < 60 * 3; i += 1) {
      fly(c, HOUSEFLY, w, 1 / 60);
      expect(c.height).toBeGreaterThanOrEqual(surface(c.at) - 1e-9);
      expect(c.height).toBeLessThanOrEqual(surface(c.at) + ceiling + 1e-9);
      finite(c);
    }
    expect(c.height - surface(c.at)).toBeCloseTo(hi, 3);
    c.behaviour = 'land';
    for (let i = 0; i < 60 * 3; i += 1) fly(c, HOUSEFLY, w, 1 / 60);
    expect(c.height).toBeCloseTo(surface(c.at), 6);
  });

  it('a walker and a burrower keep the ground: an aphid is not a boat, and a worm\'s band is under the bed', () => {
    const w = fakeWorld(() => 100, pond(30));
    const a = creature(APHID, world(0, 0), 100);
    a.behaviour = 'idle';
    walk(a, APHID, w, 0.1);
    expect(a.height).toBe(100);
    const f = creature(HOUSEFLY, world(0, 0), 100);
    f.behaviour = 'idle';
    walk(f, HOUSEFLY, w, 0.1);
    expect(f.height).toBe(100);
    const worm = creature(EARTHWORM, world(0, 0), 100 - unitsOfMm(EARTHWORM.burrow!.underMm));
    worm.behaviour = 'burrow';
    burrow(worm, EARTHWORM, w, 1);
    expect(worm.height).toBeLessThanOrEqual(100 - unitsOfMm(EARTHWORM.burrow!.boreMm) / 2 + 1e-9);
  });
});

describe('the dispatch and the guards', () => {
  it('moves each medium by its own rule and names the airborne and moving words', () => {
    const w = fakeWorld(() => 0);
    const worm = creature(EARTHWORM, world(0, 0), -1.2);
    worm.behaviour = 'burrow';
    worm.target = world(100, 0);
    expect(move(worm, EARTHWORM, w, 1)).toBeCloseTo(unitsOfMm(EARTHWORM.pace.wanderMmS), 9);
    expect(worm.height).toBeLessThan(0);
    const flyer = creature(HOUSEFLY, world(0, 0), 0);
    flyer.behaviour = 'fly';
    flyer.target = world(1000, 0);
    flyer.targetHeight = 30;
    expect(move(flyer, HOUSEFLY, w, 0.01)).toBeCloseTo(unitsOfMm(HOUSEFLY.flight!.cruiseMmS) * 0.01, 9);
    flyer.behaviour = 'idle';
    expect(move(flyer, HOUSEFLY, w, 1)).toBe(0);
    expect(isAirborne('hover')).toBe(true);
    expect(isAirborne('flee')).toBe(false);
    expect(isMoving('rest')).toBe(false);
    expect(isMoving('surface')).toBe(true);
  });

  it('a dt that is zero, negative, NaN or infinite moves nothing; a NaN ground leaves the height alone; nothing is ever NaN', () => {
    const w = fakeWorld(() => NaN);
    const c = creature(HOUSEFLY, world(5, 5), 7);
    c.behaviour = 'fly';
    c.target = world(50, 50);
    const at = c.at;
    for (const dt of [0, -1, NaN, Infinity, -Infinity]) {
      expect(move(c, HOUSEFLY, w, dt)).toBe(0);
      expect(c.at).toBe(at);
      expect(c.height).toBe(7);
    }
    move(c, HOUSEFLY, w, 0.1);
    expect(c.at).not.toBe(at);
    expect(c.height).toBe(7);
    finite(c);
    // A target that is not a number is refused, not chased.
    c.target = world(NaN, 0);
    const here = c.at;
    move(c, HOUSEFLY, w, 0.1);
    expect(c.at).toBe(here);
    finite(c);
  });
});

describe("a pace is the individual's", () => {
  it('a worm twice the cited length burrows twice as far in a second; one made without a length is the table\'s animal', () => {
    const w = fakeWorld(() => 0);
    const cited = sized(EARTHWORM, world(0, 0), -1.2, EARTHWORM.lengthMm);
    const big = sized(EARTHWORM, world(0, 0), -1.2, EARTHWORM.lengthMm * 2);
    const plain = creature(EARTHWORM, world(0, 0), -1.2);
    for (const c of [cited, big, plain]) {
      c.behaviour = 'burrow';
      c.target = world(100_000, 0);
    }
    expect(paceOf(cited, EARTHWORM)).toBeCloseTo(unitsOfMm(EARTHWORM.pace.wanderMmS), 12);
    expect(paceOf(big, EARTHWORM)).toBeCloseTo(2 * paceOf(cited, EARTHWORM), 12);
    const one = burrow(cited, EARTHWORM, w, 1);
    expect(burrow(big, EARTHWORM, w, 1)).toBeCloseTo(2 * one, 9);
    expect(burrow(plain, EARTHWORM, w, 1)).toBeCloseTo(one, 12);
    // The band it travels in is the SPECIES' — a big worm is faster, not deeper.
    expect(big.height).toBeCloseTo(cited.height, 9);
  });

  it('a flee scales with the body, and so does the quarter-body an arrival is measured in', () => {
    const w = fakeWorld(() => 0);
    const small = sized(APHID, world(0, 0), 0, APHID.lengthRangeMm[0]);
    const large = sized(APHID, world(0, 0), 0, APHID.lengthRangeMm[1]);
    for (const c of [small, large]) {
      c.behaviour = 'flee';
      c.target = world(0, 1000);
    }
    const ratio = APHID.lengthRangeMm[1] / APHID.lengthRangeMm[0];
    expect(paceOf(large, APHID) / paceOf(small, APHID)).toBeCloseTo(ratio, 12);
    expect(walk(large, APHID, w, 1) / walk(small, APHID, w, 1)).toBeCloseTo(ratio, 9);
    // ARRIVE_LENGTHS is a quarter of a body: 3.75 units for a 150 mm worm, 7.5 for a 300 mm one.
    const nearTarget = (lengthMm: number): CreatureState => {
      const c = sized(EARTHWORM, world(0, 0), 0, lengthMm);
      c.target = world(0, 5);
      return c;
    };
    expect(arrived(nearTarget(EARTHWORM.lengthMm), EARTHWORM)).toBe(false);
    expect(arrived(nearTarget(EARTHWORM.lengthMm * 2), EARTHWORM)).toBe(true);
  });

  it('a fall is gravity\'s at any size: two aphids of different lengths drop off a stem at the same rate', () => {
    const w = fakeWorld(() => 0);
    const small = sized(APHID, world(0, 0), 50, APHID.lengthRangeMm[0]);
    const large = sized(APHID, world(0, 0), 50, APHID.lengthRangeMm[1]);
    for (const c of [small, large]) {
      c.behaviour = 'flee';
      c.target = null;
      c.targetHeight = 0;
      walk(c, APHID, w, 0.01);
    }
    expect(large.height).toBeCloseTo(small.height, 12);
    expect(50 - small.height).toBeCloseTo(unitsOfMm(DROP_MM_S) * 0.01, 9);
  });
});

describe("a pace is the species' law, a body is its length (the Lab's ants)", () => {
  it('a worker twice the cited length walks 2^0.75 as far in a second, and stops twice as far from its target', () => {
    const w = fakeWorld(() => 0);
    const cited = sized(WORKER, world(0, 0), 0, WORKER.lengthMm);
    const big = sized(WORKER, world(0, 0), 0, WORKER.lengthMm * 2);
    for (const c of [cited, big]) {
      c.behaviour = 'wander';
      c.target = world(100_000, 0);
    }
    expect(paceOf(cited, WORKER)).toBeCloseTo(unitsOfMm(WORKER.pace.wanderMmS), 12);
    expect(paceOf(big, WORKER) / paceOf(cited, WORKER)).toBeCloseTo(Math.pow(2, 0.75), 12);
    const one = walk(cited, WORKER, w, 1);
    expect(walk(big, WORKER, w, 1) / one).toBeCloseTo(Math.pow(2, 0.75), 9);
    // A ground walker stands on the ground, whatever its size.
    expect(cited.height).toBe(0);
    expect(big.height).toBe(0);
    // The arrive radius is a quarter of the BODY: linear in the length, not in the pace law.
    const nearTarget = (lengthMm: number): CreatureState => {
      const c = sized(WORKER, world(0, 0), 0, lengthMm);
      c.target = world(0, 0.1);
      return c;
    };
    expect(arrived(nearTarget(WORKER.lengthMm), WORKER)).toBe(false);
    expect(arrived(nearTarget(WORKER.lengthMm * 2), WORKER)).toBe(true);
  });

  it('the winged queen flies by the fly rule when her word is airborne, and walks on the ground when it is not; the fly\'s own path is unchanged', () => {
    const w = fakeWorld();
    const start = world(0, 0);
    const q = creature(QUEEN, start, slope(start));
    q.behaviour = 'takeoff';
    q.target = world(400, 300);
    q.targetHeight = slope(start) + 10_000;
    const ceiling = unitsOfMm(QUEEN.flight!.ceilingMm);
    for (let i = 0; i < 60 * 5; i += 1) {
      move(q, QUEEN, w, 1 / 60);
      const g = slope(q.at);
      expect(q.height).toBeGreaterThanOrEqual(g - 1e-9);
      expect(q.height).toBeLessThanOrEqual(g + ceiling + 1e-9);
      finite(q);
    }
    expect(q.height - slope(q.at)).toBeCloseTo(unitsOfMm(QUEEN.flight!.cruiseMm[1]), 3);
    q.behaviour = 'land';
    for (let i = 0; i < 60 * 5; i += 1) move(q, QUEEN, w, 1 / 60);
    expect(q.height).toBeCloseTo(slope(q.at), 6);
    q.behaviour = 'wander';
    q.target = world(-400, 300);
    expect(move(q, QUEEN, w, 1)).toBeCloseTo(unitsOfMm(QUEEN.pace.wanderMmS), 9);
    expect(q.height).toBeCloseTo(slope(q.at), 12);
    expect(isMoving('defend')).toBe(false);
    expect(isMoving('attack')).toBe(true);
    expect(isAirborne('defend')).toBe(false);
  });
});
