/**
 * THE ONE INTEGRATOR, held to the legs it replaced and opened to a
 * player.
 *
 * The first half of this file is a VERBATIM copy of `locomotion.ts` as
 * it stood before the Creature Lab (alpha.37): `stepToward`, `approach`,
 * `walk`, `burrow`, `fly` and `move`, with the only edit being the name
 * prefix `old`. The identity test runs an animal of each medium — a
 * walker on its stem, a burrower under a slope, a flier over a pond
 * and the sea, and the Lab's worker on the ground — through the same
 * thinks with the same seeded draws for ten minutes, once on the old
 * legs and once through `applyDemand(demandOf())`, and holds every
 * frame's position and height to a millionth of a unit. That is the
 * proof that "the AI must not move differently" (the Lab brief, §3).
 *
 * The second half is what a player gets from the same integrator:
 * fractions, sidesteps, reverses, a vertical that burrows, surfaces,
 * climbs and descends inside the medium's band, a sprint at the flee or
 * the burst pace, and the guards.
 */
import { describe, expect, it } from 'vitest';
import { NEUTRAL_INTENT, type Intent } from '../src/input/Intent';
import {
  APHID, EARTHWORM, HOUSEFLY, QUEEN, WORKER, newCreature, paceRatio, sizeRatio, unitsOfMm,
  type CreatureSpecies, type CreatureState, type CreatureWorld, type Disturbance,
} from '../src/creatures';
import { applyDemand, demandOf, locomotionOf } from '../src/creatures/demand';
import { ahead, headingToward, turnToward, wrapHeading } from '../src/creatures/heading';
import { senseAlarm, think, thinkDue, tickNeeds } from '../src/creatures/intent';
import { DROP_MM_S, floorAt, isAirborne, move, paceOf } from '../src/creatures/locomotion';
import { distance, world, type WorldPoint } from '../src/world/coords';
import type { CellResources, PlantSource, ResourceSite, WaterQuery } from '../src/world/ecology/resources';
import { SEA_HABITAT, type Habitat, type HabitatKind } from '../src/world/habitat';
import { SEA_LEVEL } from '../src/world/heightfield';
import { CELL_SPAN } from '../src/world/objects/cells';
import { mulberry32 } from '../src/world/random';

// ---------------------------------------------------------------------------
/**
 * THE RESEARCH'S APHID FEEDS FOR HOURS (feedS 15-60 min, Walker 2024;
 * Garzo 2002), so a ten-minute soak of the table's animal is a still
 * animal — correct, and useless for a test of walking. This one feeds
 * for seconds so the walks happen inside the soak; nothing else differs.
 */
const BRIEF_APHID: CreatureSpecies = { ...APHID, needs: { ...APHID.needs, feedS: [30, 120] as readonly [number, number] } };

// The old legs, verbatim (alpha.37 `src/creatures/locomotion.ts`)
// ---------------------------------------------------------------------------

const ARRIVE_LENGTHS = 0.25;

function oldPaceOf(state: CreatureState, species: CreatureSpecies): number {
  const ratio = sizeRatio(state, species);
  switch (state.behaviour) {
    case 'flee':
      return ratio * unitsOfMm(species.pace.fleeMmS);
    case 'wander':
    case 'burrow':
      return ratio * unitsOfMm(species.pace.wanderMmS);
    case 'feed':
      return state.target === null ? 0 : ratio * unitsOfMm(species.pace.wanderMmS);
    default:
      return 0;
  }
}

function oldFloorAt(w: CreatureWorld, at: WorldPoint): number {
  const ground = w.groundAt(at);
  if (!Number.isFinite(ground)) return ground;
  const water = w.water;
  const sea = water !== null ? water.isSeaAt(at) : ground < SEA_LEVEL;
  if (sea) return Math.max(ground, SEA_LEVEL);
  const depth = water === null ? 0 : water.freshDepthAt(at);
  return depth > 0 ? ground + depth : ground;
}

function oldBodyLength(state: CreatureState, species: CreatureSpecies): number {
  return sizeRatio(state, species) * unitsOfMm(species.lengthMm);
}

// TWO DELIBERATE DEPARTURES from alpha.37's legs, both asked for by the
// Lab's brain and carried into the old copy so the identity still proves
// the integrator: a flier turns at `flight.turnRadSAir` in the air, and a
// worm DIGGING ('burrow') crawls at its pace over `burrow.digDiscount`.
function oldTurnRate(species: CreatureSpecies, airborne: boolean): number {
  return airborne && species.flight !== null ? species.flight.turnRadSAir : species.pace.turnRadS;
}
function oldDigFactor(state: CreatureState, species: CreatureSpecies): number {
  if (species.burrow === null || state.behaviour !== 'burrow') return 1;
  const d = species.burrow.digDiscount;
  return d !== undefined && d >= 1 ? 1 / d : 1;
}

function oldStepToward(state: CreatureState, species: CreatureSpecies, pace: number, dt: number, turnRadS = species.pace.turnRadS): number {
  const target = state.target;
  const maxTurn = turnRadS * dt;
  if (target === null) {
    if (!(pace > 0)) return 0;
    const step = pace * dt;
    state.at = ahead(state.at, state.heading, step);
    return step;
  }
  if (!Number.isFinite(target.wx) || !Number.isFinite(target.wz)) return 0;
  const remaining = distance(state.at, target);
  state.heading = turnToward(state.heading, headingToward(state.at, target), maxTurn);
  if (!(pace > 0) || remaining <= 0) return 0;
  const step = pace * dt;
  const arriveWithin = Math.max(step, ARRIVE_LENGTHS * oldBodyLength(state, species));
  if (remaining <= arriveWithin) {
    state.at = target;
    return remaining;
  }
  state.at = ahead(state.at, state.heading, step);
  return step;
}

function oldApproach(value: number, wanted: number, maxStep: number): number {
  const gap = wanted - value;
  if (!(maxStep > 0)) return value;
  if (Math.abs(gap) <= maxStep) return wanted;
  return value + (gap > 0 ? maxStep : -maxStep);
}

function oldPitchOf(dHeight: number, dPlane: number): number {
  if (dHeight === 0) return 0;
  if (dPlane <= 0) return dHeight > 0 ? Math.PI / 2 : -Math.PI / 2;
  return Math.atan2(dHeight, dPlane);
}

function oldWalk(state: CreatureState, species: CreatureSpecies, w: CreatureWorld, dt: number): number {
  if (!(dt > 0) || !Number.isFinite(dt)) return 0;
  const moved = oldStepToward(state, species, oldPaceOf(state, species), dt);
  const ground = w.groundAt(state.at);
  if (!Number.isFinite(ground)) return moved;
  const before = state.height;
  if (species.medium === 'plant') {
    const wanted = Number.isFinite(state.targetHeight) ? Math.max(ground, state.targetHeight) : ground;
    const fleeing = state.behaviour === 'flee';
    const mmS = fleeing && wanted < state.height
      ? DROP_MM_S
      : sizeRatio(state, species) * (fleeing ? species.pace.fleeMmS : species.pace.wanderMmS);
    state.height = Math.max(ground, oldApproach(state.height, wanted, unitsOfMm(mmS) * dt));
  } else {
    state.height = ground;
  }
  state.pitch = oldPitchOf(state.height - before, moved);
  return moved;
}

function oldBurrow(state: CreatureState, species: CreatureSpecies, w: CreatureWorld, dt: number): number {
  if (!(dt > 0) || !Number.isFinite(dt)) return 0;
  const spec = species.burrow;
  if (spec === null) return oldWalk(state, species, w, dt);
  const moved = oldStepToward(state, species, oldDigFactor(state, species) * oldPaceOf(state, species), dt);
  const ground = w.groundAt(state.at);
  if (!Number.isFinite(ground)) return moved;
  const bottom = ground - unitsOfMm(spec.underMm);
  const top = ground - unitsOfMm(spec.boreMm) / 2;
  const up = state.behaviour === 'surface' || state.behaviour === 'feed';
  let wanted: number;
  if (up) wanted = ground;
  else if (state.behaviour === 'flee') wanted = bottom;
  else wanted = Number.isFinite(state.targetHeight) ? Math.min(top, Math.max(bottom, state.targetHeight)) : (top + bottom) / 2;
  const rate = sizeRatio(state, species) * unitsOfMm(state.behaviour === 'flee' ? species.pace.fleeMmS : species.pace.wanderMmS) * dt;
  const before = state.height;
  let height = oldApproach(state.height, wanted, rate);
  height = up ? Math.min(ground, height) : Math.min(top, Math.max(bottom, height));
  state.height = height;
  state.pitch = oldPitchOf(height - before, moved);
  return moved;
}

function oldFly(state: CreatureState, species: CreatureSpecies, w: CreatureWorld, dt: number): number {
  if (!(dt > 0) || !Number.isFinite(dt)) return 0;
  const spec = species.flight;
  if (spec === null) return oldWalk(state, species, w, dt);
  const cruise = unitsOfMm(spec.cruiseMmS);
  const climb = unitsOfMm(spec.climbMmS);
  const pace = state.behaviour === 'hover' ? 0 : cruise;
  const moved = oldStepToward(state, species, pace, dt, oldTurnRate(species, true));
  const floor = oldFloorAt(w, state.at);
  if (!Number.isFinite(floor)) return moved;
  const ceiling = floor + unitsOfMm(spec.ceilingMm);
  const lo = Math.min(ceiling, floor + unitsOfMm(spec.cruiseMm[0]));
  const hi = Math.min(ceiling, floor + unitsOfMm(spec.cruiseMm[1]));
  let wanted: number;
  if (state.behaviour === 'land') wanted = floor;
  else wanted = Number.isFinite(state.targetHeight) ? Math.min(hi, Math.max(lo, state.targetHeight)) : lo;
  const before = state.height;
  const height = Math.min(ceiling, Math.max(floor, oldApproach(state.height, wanted, climb * dt)));
  state.height = height;
  state.pitch = oldPitchOf(height - before, moved);
  return moved;
}

function oldMove(state: CreatureState, species: CreatureSpecies, w: CreatureWorld, dt: number): number {
  if (!(dt > 0) || !Number.isFinite(dt)) return 0;
  if (species.medium === 'soil') return oldBurrow(state, species, w, dt);
  if (species.medium === 'air' && isAirborne(state.behaviour)) return oldFly(state, species, w, dt);
  return oldWalk(state, species, w, dt);
}

// ---------------------------------------------------------------------------
// A world with a slope, a pond, the sea, plants and food
// ---------------------------------------------------------------------------

function habitat(kind: HabitatKind, elevation: number): Habitat {
  return {
    kind, forest: 0, grass: 0, shrub: 0, bare: 0, wet: 0, lake: 0, coast: 0, exposure: 0,
    elevation, slopeDegrees: 0, coastDistance: 10_000, channel: false, rainfallMmYear: null,
  };
}

const SEA_EAST_OF = 2400;
const ground = (at: WorldPoint): number => (at.wx < SEA_EAST_OF ? 200 + at.wx * 0.04 + Math.sin(at.wz / 60) * 6 + Math.cos(at.wx / 45) * 4 : -100);
const POND = Object.freeze({ x0: 900, x1: 1300, z0: 300, z1: 700 });
const inPond = (at: WorldPoint): boolean => at.wx >= POND.x0 && at.wx < POND.x1 && at.wz >= POND.z0 && at.wz < POND.z1;
const WATER: WaterQuery = {
  freshDepthAt: (at) => (inPond(at) ? 25 : 0),
  isSeaAt: (at) => at.wx >= SEA_EAST_OF,
  nearestWater: () => null,
};
const SHRUB: PlantSource = { family: 'shrub', at: world(500, 500), size: 40, id: 'shrub:0,0:3', variant: 0 };
const SITES: ResourceSite[] = [
  { id: 'litter:0,0:9', kind: 'litter', at: world(560, 470), above: 0, amount: 1, ownerId: null },
  { id: 'flower:0,0:2', kind: 'nectar', at: world(640, 610), above: 5, amount: 3, ownerId: 'flower:0,0:2' },
  { id: 'sap:0,0:4', kind: 'sap', at: world(430, 620), above: 8, amount: 3, ownerId: 'tree:0,0:4' },
];

interface Fake extends CreatureWorld {
  list: Disturbance[];
}

function fakeWorld(): Fake {
  const w: Fake = {
    list: [],
    groundAt: ground,
    normalAt: () => ({ nx: 0, ny: 1, nz: 0 }),
    habitatAt: (at) => (at.wx < SEA_EAST_OF ? habitat('shrubland', ground(at)) : SEA_HABITAT),
    plantsOf: () => [SHRUB],
    resourcesOf: (cx, cz): CellResources => ({
      cx, cz, sites: SITES.filter((s) => Math.floor(s.at.wx / CELL_SPAN) === cx && Math.floor(s.at.wz / CELL_SPAN) === cz),
    }),
    water: WATER,
    weather: () => null,
    disturbances: () => w.list,
  };
  return w;
}

function spawn(species: CreatureSpecies, at: WorldPoint, lengthMm: number, hostId: string | null = null): CreatureState {
  const g = ground(at);
  const height = species.burrow !== null ? g - unitsOfMm(species.burrow.underMm) : hostId !== null ? g + 10 : g;
  const c = newCreature({
    id: `${species.id}:0,0:1`, species: species.id, cellKey: '0,0', at, height, heading: 0.4, phase: 0.3, lengthMm,
    behaviour: species.burrow !== null ? 'burrow' : 'idle', hostId, hunger: 0.5, fatigue: 0.1,
  });
  c.sinceThink = c.phase * species.thinkS;
  return c;
}

const clone = (c: CreatureState): CreatureState => JSON.parse(JSON.stringify(c)) as CreatureState;

/** One simulation step, the simulation's order: needs, alarm, think, move — with the integrator handed in. */
function step(
  c: CreatureState, species: CreatureSpecies, w: Fake, rand: () => number, dt: number,
  integrate: (s: CreatureState, sp: CreatureSpecies, wd: CreatureWorld, d: number) => number,
): number {
  tickNeeds(c, species, dt);
  senseAlarm(c, species, w.list);
  if (thinkDue(c, species)) think(c, species, w, rand, null, species.population.hosts !== null ? SHRUB : null);
  return integrate(c, species, w, dt);
}

const headingGap = (a: number, b: number): number => Math.abs(wrapHeading(a - b));

describe('the AI did not move differently', () => {
  const cases: { readonly name: string; readonly species: CreatureSpecies; readonly at: WorldPoint; readonly lengthMm: number; readonly host: string | null }[] = [
    { name: 'a walker on its stem (aphid, drawn small)', species: BRIEF_APHID, at: SHRUB.at, lengthMm: 1.8, host: SHRUB.id },
    { name: 'a burrower under a slope (earthworm, drawn long)', species: EARTHWORM, at: world(700, 400), lengthMm: 220, host: null },
    { name: 'a flier over a pond and a beach (housefly)', species: HOUSEFLY, at: world(SEA_EAST_OF - 40, 500), lengthMm: 7, host: null },
    { name: 'a walker on the ground (the Lab worker, at its cited length)', species: WORKER, at: world(600, 560), lengthMm: WORKER.lengthMm, host: null },
  ];

  for (const { name, species, at, lengthMm, host } of cases) {
    it(`${name}: 600 s of thinks and moves agree with the old legs to 1e-6 every frame`, () => {
      const wOld = fakeWorld();
      const wNew = fakeWorld();
      const seed = 4242 + species.id.length;
      const randOld = mulberry32(seed);
      const randNew = mulberry32(seed);
      const a = spawn(species, at, lengthMm, host);
      const b = clone(a);
      const dt = 1 / 60;
      let worst = 0;
      let moved = 0;
      const words = new Set<string>();
      for (let i = 0; i < 600 * 60; i += 1) {
        // A disturbance beside the animal for a second every forty-seven, so alarms, flees and defends are exercised.
        const t = i * dt;
        const poke = t % 47 < 1;
        wOld.list = poke ? [{ at: world(a.at.wx + 2, a.at.wz + 1), height: a.height, radius: 0 }] : [];
        wNew.list = poke ? [{ at: world(b.at.wx + 2, b.at.wz + 1), height: b.height, radius: 0 }] : [];
        const dOld = step(a, species, wOld, randOld, dt, oldMove);
        const dNew = step(b, species, wNew, randNew, dt, move);
        moved += dNew;
        words.add(b.behaviour);
        const gap = Math.max(Math.abs(a.at.wx - b.at.wx), Math.abs(a.at.wz - b.at.wz), Math.abs(a.height - b.height), Math.abs(dOld - dNew));
        worst = Math.max(worst, gap);
        if (gap > 1e-6 || a.behaviour !== b.behaviour || headingGap(a.heading, b.heading) > 1e-6) {
          throw new Error(`${species.id} diverged at t=${t.toFixed(3)} (${a.behaviour}/${b.behaviour}): old ${JSON.stringify(a.at)} h=${a.height} vs new ${JSON.stringify(b.at)} h=${b.height}, gap ${gap}`);
        }
      }
      expect(worst).toBeLessThanOrEqual(1e-6);
      // The soak actually moved and actually decided: not two animals standing still agreeing. (An aphid feeds most of its life and walks a body length or two.)
      expect(moved).toBeGreaterThan(unitsOfMm(species.lengthMm));
      expect(words.size).toBeGreaterThanOrEqual(2);
    }, 120_000);
  }

  it('walk, burrow and fly by name agree with the old integrators on a fixed word and target', () => {
    const w = fakeWorld();
    const worm = spawn(EARTHWORM, world(300, 300), 150);
    worm.behaviour = 'burrow';
    worm.target = world(900, 340);
    const worm2 = clone(worm);
    for (let i = 0; i < 60 * 30; i += 1) {
      oldBurrow(worm, EARTHWORM, w, 1 / 60);
      move(worm2, EARTHWORM, w, 1 / 60);
      expect(Math.abs(worm.at.wx - worm2.at.wx)).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(worm.height - worm2.height)).toBeLessThanOrEqual(1e-9);
    }
    const fly = spawn(HOUSEFLY, world(800, 500), 6.5);
    fly.behaviour = 'fly';
    fly.target = world(1400, 500); // across the pond
    fly.targetHeight = ground(fly.at) + 50;
    const fly2 = clone(fly);
    for (let i = 0; i < 60 * 6; i += 1) {
      oldFly(fly, HOUSEFLY, w, 1 / 60);
      move(fly2, HOUSEFLY, w, 1 / 60);
      expect(Math.abs(fly.at.wx - fly2.at.wx)).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(fly.height - fly2.height)).toBeLessThanOrEqual(1e-9);
    }
    expect(fly2.at.wx).toBeGreaterThan(POND.x0);
  });
});

// ---------------------------------------------------------------------------
// What the AI asks for, in the one shape
// ---------------------------------------------------------------------------

describe('demandOf', () => {
  it('turns toward the target, saturating at ±1, goes forward while there is a pace and a distance, and is neutral for a bad dt', () => {
    const w = fakeWorld();
    const c = spawn(HOUSEFLY, world(500, 500), 6.5);
    c.behaviour = 'wander';
    c.target = world(500 - 100, 500); // due west: a quarter turn from heading 0.4
    const far = demandOf(c, HOUSEFLY, w, 1 / 60);
    expect(far.turn).toBe(-1);
    expect(far.forward).toBe(1);
    expect(far.sprint).toBe(false);
    expect(far.primary).toBe(false);
    // A gap smaller than the turn rate allows in one frame is a fraction of it.
    const near = demandOf(c, HOUSEFLY, w, 10);
    expect(Math.abs(near.turn!)).toBeLessThan(1);
    expect(near.turn).toBeLessThan(0);
    c.behaviour = 'idle';
    expect(demandOf(c, HOUSEFLY, w, 1 / 60).forward).toBe(0);
    c.behaviour = 'flee';
    expect(demandOf(c, HOUSEFLY, w, 1 / 60).sprint).toBe(true);
    c.behaviour = 'feed';
    expect(demandOf(c, HOUSEFLY, w, 1 / 60).primary).toBe(true);
    c.target = null;
    expect(demandOf(c, HOUSEFLY, w, 1 / 60).forward).toBe(0);
    c.behaviour = 'wander';
    expect(demandOf(c, HOUSEFLY, w, 1 / 60).forward).toBe(1);
    expect(demandOf(c, HOUSEFLY, w, 1 / 60).turn).toBe(0);
    for (const dt of [0, -1, NaN, Infinity]) expect(demandOf(c, HOUSEFLY, w, dt)).toBe(NEUTRAL_INTENT);
    // A target that is not a number asks for nothing.
    c.target = world(NaN, 0);
    expect(demandOf(c, HOUSEFLY, w, 1 / 60)).toMatchObject({ forward: 0, turn: 0 });
  });

  it('asks for a vertical toward the height the medium wants: a worm down to its band, up to surface; a fly up to its band, down to land', () => {
    const w = fakeWorld();
    const worm = spawn(EARTHWORM, world(300, 300), 150);
    worm.height = ground(worm.at); // lying on the surface
    worm.behaviour = 'burrow';
    worm.target = world(600, 300);
    expect(demandOf(worm, EARTHWORM, w, 1 / 60).vertical).toBe(-1);
    worm.behaviour = 'surface';
    worm.height = ground(worm.at) - 1;
    expect(demandOf(worm, EARTHWORM, w, 1 / 60).vertical).toBe(1);
    worm.behaviour = 'flee';
    expect(demandOf(worm, EARTHWORM, w, 1 / 60).vertical).toBe(-1);
    const fly = spawn(HOUSEFLY, world(500, 500), 6.5);
    fly.behaviour = 'takeoff';
    fly.targetHeight = ground(fly.at) + 40;
    expect(demandOf(fly, HOUSEFLY, w, 1 / 60).vertical).toBe(1);
    fly.behaviour = 'land';
    fly.height = ground(fly.at) + 40;
    expect(demandOf(fly, HOUSEFLY, w, 1 / 60).vertical).toBe(-1);
    // Standing where it wants to be: no vertical at all.
    fly.behaviour = 'idle';
    fly.height = ground(fly.at);
    expect(demandOf(fly, HOUSEFLY, w, 1 / 60).vertical).toBe(0);
    // A walker on the ground has no wish about its height.
    const worker = spawn(WORKER, world(600, 560), 3);
    worker.behaviour = 'wander';
    worker.target = world(650, 560);
    worker.targetHeight = 10_000;
    expect(demandOf(worker, WORKER, w, 1 / 60).vertical).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// What a player gets from the same integrator
// ---------------------------------------------------------------------------

describe('applyDemand with a hand-made intent', () => {
  const intent = (over: Partial<Intent>): Intent => ({ ...NEUTRAL_INTENT, ...over });

  it('a fraction forward is a fraction of the pace; sprint is the flee pace; a reverse walks backward', () => {
    const w = fakeWorld();
    const c = spawn(WORKER, world(600, 560), 3);
    c.heading = 0;
    const walk = paceRatio(c, WORKER) * unitsOfMm(WORKER.pace.wanderMmS);
    const flee = paceRatio(c, WORKER) * unitsOfMm(WORKER.pace.fleeMmS);
    expect(applyDemand(c, WORKER, w, intent({ forward: 0.5 }), 1)).toBeCloseTo(walk * 0.5, 12);
    expect(c.at.wz).toBeCloseTo(560 + walk * 0.5, 9);
    expect(c.height).toBeCloseTo(ground(c.at), 12);
    expect(applyDemand(c, WORKER, w, intent({ forward: 1, sprint: true }), 1)).toBeCloseTo(flee, 12);
    const before = c.at;
    expect(applyDemand(c, WORKER, w, intent({ forward: -1 }), 1)).toBeCloseTo(walk, 12);
    expect(c.at.wz).toBeCloseTo(before.wz - walk, 9);
    // Standing still is standing still: the point is not even replaced.
    const here = c.at;
    expect(applyDemand(c, WORKER, w, NEUTRAL_INTENT, 1)).toBe(0);
    expect(c.at).toBe(here);
  });

  it('turns by the request at the species\' rate, the hard limit, and wraps', () => {
    const w = fakeWorld();
    const c = spawn(WORKER, world(600, 560), 3);
    c.heading = 3;
    applyDemand(c, WORKER, w, intent({ turn: 1 }), 0.1);
    expect(c.heading).toBeCloseTo(wrapHeading(3 + WORKER.pace.turnRadS * 0.1), 12);
    expect(c.heading).toBeLessThanOrEqual(Math.PI);
    applyDemand(c, WORKER, w, intent({ turn: -0.5 }), 0.1);
    expect(c.heading).toBeCloseTo(wrapHeading(3 + WORKER.pace.turnRadS * 0.1 - 0.5 * WORKER.pace.turnRadS * 0.1), 12);
    // An over-range or NaN turn is bounded, never a spin.
    const h = c.heading;
    applyDemand(c, WORKER, w, intent({ turn: 40 }), 0.1);
    expect(c.heading).toBeCloseTo(wrapHeading(h + WORKER.pace.turnRadS * 0.1), 12);
    const h2 = c.heading;
    applyDemand(c, WORKER, w, intent({ turn: NaN }), 0.1);
    expect(c.heading).toBe(h2);
  });

  it('a sidestep is on the unit disc and never snaps to a target; a worm has no sides', () => {
    const w = fakeWorld();
    const c = spawn(WORKER, world(600, 560), 3);
    c.heading = 0;
    const walk = paceRatio(c, WORKER) * unitsOfMm(WORKER.pace.wanderMmS);
    // Right is a quarter turn clockwise from ahead: +wx at heading 0.
    expect(applyDemand(c, WORKER, w, intent({ strafe: 1 }), 1)).toBeCloseTo(walk, 9);
    expect(c.at.wx).toBeCloseTo(600 + walk, 9);
    expect(c.at.wz).toBeCloseTo(560, 9);
    // Full ahead and full strafe is one pace, not 1.41 of them.
    expect(applyDemand(c, WORKER, w, intent({ forward: 1, strafe: 1 }), 1)).toBeCloseTo(walk, 9);
    // A target two units off would be snapped to by a plain forward; a sidestep passes it by.
    c.target = world(c.at.wx, c.at.wz + 0.2);
    const before = c.at;
    applyDemand(c, WORKER, w, intent({ forward: 1, strafe: 0.5 }), 1);
    expect(c.at).not.toBe(c.target);
    expect(distance(before, c.at)).toBeCloseTo(walk, 9);
    c.target = world(c.at.wx, c.at.wz + 0.2);
    applyDemand(c, WORKER, w, intent({ forward: 1 }), 1);
    expect(c.at).toBe(c.target);
    const worm = spawn(EARTHWORM, world(300, 300), 150);
    worm.behaviour = 'burrow';
    const at = worm.at;
    expect(applyDemand(worm, EARTHWORM, w, intent({ strafe: 1 }), 1)).toBe(0);
    expect(worm.at).toBe(at);
  });

  it('a vertical burrows and surfaces inside the word\'s band; climbs and descends a flier between the floor and the ceiling; climbs a stem; and a walker ignores it', () => {
    const w = fakeWorld();
    const worm = spawn(EARTHWORM, world(300, 300), 150);
    worm.behaviour = 'burrow';
    const under = unitsOfMm(EARTHWORM.burrow!.underMm);
    const half = unitsOfMm(EARTHWORM.burrow!.boreMm) / 2;
    const rate = paceRatio(worm, EARTHWORM) * unitsOfMm(EARTHWORM.pace.wanderMmS);
    worm.height = ground(worm.at) - under / 2;
    applyDemand(worm, EARTHWORM, w, intent({ vertical: -1 }), 0.1);
    expect(worm.height).toBeCloseTo(ground(worm.at) - under / 2 - rate * 0.1, 9);
    expect(worm.pitch).toBeLessThan(0);
    for (let i = 0; i < 100; i += 1) applyDemand(worm, EARTHWORM, w, intent({ vertical: -1 }), 0.1);
    expect(worm.height).toBeCloseTo(ground(worm.at) - under, 9);
    // Up, in the burrow word, stops half a bore under the surface: the word's band.
    for (let i = 0; i < 200; i += 1) applyDemand(worm, EARTHWORM, w, intent({ vertical: 1 }), 0.1);
    expect(worm.height).toBeCloseTo(ground(worm.at) - half, 9);
    // The surface word opens the band to the ground.
    worm.behaviour = 'surface';
    for (let i = 0; i < 20; i += 1) applyDemand(worm, EARTHWORM, w, intent({ vertical: 1 }), 0.1);
    expect(worm.height).toBeCloseTo(ground(worm.at), 9);

    const fly = spawn(HOUSEFLY, world(500, 500), 6.5);
    fly.behaviour = 'fly';
    const climb = unitsOfMm(HOUSEFLY.flight!.climbMmS);
    applyDemand(fly, HOUSEFLY, w, intent({ vertical: 1 }), 0.1);
    expect(fly.height).toBeCloseTo(ground(fly.at) + climb * 0.1, 9);
    for (let i = 0; i < 60 * 10; i += 1) applyDemand(fly, HOUSEFLY, w, intent({ vertical: 1 }), 1 / 60);
    expect(fly.height).toBeCloseTo(floorAt(w, fly.at) + unitsOfMm(HOUSEFLY.flight!.ceilingMm), 6);
    for (let i = 0; i < 60 * 10; i += 1) applyDemand(fly, HOUSEFLY, w, intent({ vertical: -1 }), 1 / 60);
    expect(fly.height).toBeCloseTo(floorAt(w, fly.at), 6);
    // Over the pond the floor is the water's surface.
    fly.at = world(1100, 500);
    applyDemand(fly, HOUSEFLY, w, intent({ vertical: -1 }), 1);
    expect(fly.height).toBeCloseTo(ground(fly.at) + 25, 9);
    // In the air, a sprint is the burst.
    fly.heading = 0;
    expect(applyDemand(fly, HOUSEFLY, w, intent({ forward: 1, sprint: true }), 0.01)).toBeCloseTo(unitsOfMm(HOUSEFLY.flight!.burstMmS) * 0.01, 9);
    expect(applyDemand(fly, HOUSEFLY, w, intent({ forward: 1 }), 0.01)).toBeCloseTo(unitsOfMm(HOUSEFLY.flight!.cruiseMmS) * 0.01, 9);

    const aphid = spawn(APHID, SHRUB.at, 2.5, SHRUB.id);
    aphid.behaviour = 'wander';
    const stem = paceRatio(aphid, APHID) * unitsOfMm(APHID.pace.wanderMmS);
    const perch = aphid.height;
    applyDemand(aphid, APHID, w, intent({ vertical: 1 }), 1);
    expect(aphid.height).toBeCloseTo(perch + stem, 9);
    // Down a stem is a climb down at its own pace — the drop is a flee's.
    applyDemand(aphid, APHID, w, intent({ vertical: -1 }), 1);
    expect(aphid.height).toBeCloseTo(perch, 9);
    aphid.behaviour = 'flee';
    applyDemand(aphid, APHID, w, intent({ vertical: -1 }), 0.001);
    expect(perch - aphid.height).toBeCloseTo(unitsOfMm(DROP_MM_S) * 0.001, 9);
    // Never below the ground.
    for (let i = 0; i < 50; i += 1) applyDemand(aphid, APHID, w, intent({ vertical: -1 }), 0.1);
    expect(aphid.height).toBeCloseTo(ground(aphid.at), 9);

    const worker = spawn(WORKER, world(600, 560), 3);
    applyDemand(worker, WORKER, w, intent({ vertical: 1 }), 1);
    expect(worker.height).toBe(ground(worker.at));
  });

  it('a winged ground body flies when its word is airborne and walks when it is not; the worker never flies', () => {
    const w = fakeWorld();
    const queen = spawn(QUEEN, world(600, 560), 8);
    expect(locomotionOf(queen, QUEEN)).toBe('walk');
    queen.behaviour = 'fly';
    expect(locomotionOf(queen, QUEEN)).toBe('fly');
    queen.heading = 0;
    expect(applyDemand(queen, QUEEN, w, intent({ forward: 1 }), 0.01)).toBeCloseTo(unitsOfMm(QUEEN.flight!.cruiseMmS) * 0.01, 9);
    const aloft = queen.height;
    applyDemand(queen, QUEEN, w, intent({ vertical: 1 }), 1);
    expect(queen.height).toBeCloseTo(aloft + unitsOfMm(QUEEN.flight!.climbMmS), 6);
    queen.behaviour = 'wander';
    applyDemand(queen, QUEEN, w, intent({ forward: 1 }), 0.01);
    expect(queen.height).toBe(ground(queen.at));
    expect(paceOf(queen, QUEEN)).toBeCloseTo(unitsOfMm(QUEEN.pace.wanderMmS), 12);
    const worker = spawn(WORKER, world(600, 560), 3);
    worker.behaviour = 'fly';
    expect(locomotionOf(worker, WORKER)).toBe('walk');
  });

  it('a bad dt moves nothing; a NaN ground leaves the height alone; the toggles move nothing', () => {
    const w = fakeWorld();
    const c = spawn(WORKER, world(600, 560), 3);
    const at = c.at;
    for (const dt of [0, -1, NaN, Infinity]) expect(applyDemand(c, WORKER, w, intent({ forward: 1, vertical: 1 }), dt)).toBe(0);
    expect(c.at).toBe(at);
    const blind: CreatureWorld = { ...w, groundAt: () => NaN };
    c.height = 77;
    applyDemand(c, WORKER, blind, intent({ forward: 1, vertical: 1 }), 0.1);
    expect(c.height).toBe(77);
    expect(applyDemand(c, WORKER, w, intent({ primary: true, secondary: true }), 1)).toBe(0);
  });
});
