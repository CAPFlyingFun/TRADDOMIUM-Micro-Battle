/**
 * The legs: pure integrators that turn at a rate, never overshoot, keep
 * a worm in its band, a fly under its ceiling and over the ground, an
 * aphid on its stem — and never write a NaN.
 */
import { describe, expect, it } from 'vitest';
import { APHID, EARTHWORM, HOUSEFLY, newCreature, unitsOfMm, type CreatureState, type CreatureWorld } from '../src/creatures';
import { wrapHeading } from '../src/creatures/heading';
import { arrived, burrow, fly, isAirborne, isMoving, move, paceOf, walk } from '../src/creatures/locomotion';
import { distance, world, type WorldPoint } from '../src/world/coords';
import { SEA_HABITAT } from '../src/world/habitat';

const slope = (at: WorldPoint): number => 100 + at.wx * 0.05 + Math.sin(at.wz / 50) * 3;

function fakeWorld(ground: (at: WorldPoint) => number = slope): CreatureWorld {
  return {
    groundAt: ground,
    normalAt: () => ({ nx: 0, ny: 1, nz: 0 }),
    habitatAt: () => SEA_HABITAT,
    plantsOf: () => null,
    resourcesOf: () => null,
    water: null,
    weather: () => null,
    disturbances: () => [],
  };
}

function creature(species: typeof EARTHWORM, at: WorldPoint, height: number, heading = 0): CreatureState {
  return newCreature({ id: `${species.id}:0,0:0`, species: species.id, cellKey: '0,0', at, height, heading, phase: 0 });
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
    // 3 mm/s for a minute: eighteen units east, no more, no less.
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
