/**
 * The brain: every word it chooses is its medium's; the worm surfaces
 * for rain, night and litter and flees down; the aphid never leaves its
 * host; the fly never aims at the sea, is grounded by rain, is drawn to
 * a resource and takes off from a disturbance; needs climb and come
 * back; an alarm is noticed between thinks; and a thousand seconds of
 * any of them is finite.
 */
import { describe, expect, it } from 'vitest';
import {
  APHID, BEHAVIOURS_BY_MEDIUM, CREATURE_IDS, CREATURE_SPECIES, EARTHWORM, HOUSEFLY, newCreature, unitsOfMm,
  type CreatureSpecies, type CreatureState, type CreatureWeather, type CreatureWorld, type Disturbance,
} from '../src/creatures';
import {
  ALARM_FLEES_AT, HOST_WALK_LENGTHS, RAINING_MM_HR, hostPlantOf, isLand, nearestSite, senseAlarm, think, thinkDue, tickNeeds,
} from '../src/creatures/intent';
import { isAirborne, move } from '../src/creatures/locomotion';
import { HOST_FLEE_LENGTHS } from '../src/creatures/intent';
import { distance, world, type WorldPoint } from '../src/world/coords';
import type { CellResources, PlantSource, ResourceSite } from '../src/world/ecology/resources';
import { SEA_HABITAT, type Habitat, type HabitatKind } from '../src/world/habitat';
import { CELL_SPAN } from '../src/world/objects/cells';
import { mulberry32 } from '../src/world/random';

function habitat(kind: HabitatKind, elevation: number): Habitat {
  return {
    kind, forest: 0, grass: 0, shrub: 0, bare: 0, wet: 0, lake: 0, coast: 0, exposure: 0,
    elevation, slopeDegrees: 0, coastDistance: 10_000, channel: false, rainfallMmYear: null,
  };
}

/** Land west of the line, sea east of it. */
const SEA_EAST_OF = 2000;
const ground = (at: WorldPoint): number => (at.wx < SEA_EAST_OF ? 200 + Math.sin(at.wx / 300) * 10 + Math.cos(at.wz / 400) * 8 : -100);

interface Fake extends CreatureWorld {
  sky: CreatureWeather | null;
  list: Disturbance[];
  sites: ResourceSite[];
  plants: PlantSource[];
}

function fakeWorld(): Fake {
  const w: Fake = {
    sky: null,
    list: [],
    sites: [],
    plants: [],
    groundAt: ground,
    normalAt: () => ({ nx: 0, ny: 1, nz: 0 }),
    habitatAt: (at) => (at.wx < SEA_EAST_OF ? habitat('shrubland', ground(at)) : SEA_HABITAT),
    plantsOf: () => w.plants,
    resourcesOf: (cx, cz): CellResources | null => {
      const sites = w.sites.filter((s) => Math.floor(s.at.wx / CELL_SPAN) === cx && Math.floor(s.at.wz / CELL_SPAN) === cz);
      return { cx, cz, sites };
    },
    water: { freshDepthAt: () => 0, isSeaAt: (at) => at.wx >= SEA_EAST_OF },
    weather: () => w.sky,
    disturbances: () => w.list,
  };
  return w;
}

function spawn(species: CreatureSpecies, at: WorldPoint, hostId: string | null = null, phase = 0.3): CreatureState {
  const g = ground(at);
  const height = species.burrow !== null ? g - unitsOfMm(species.burrow.underMm) : hostId !== null ? g + 10 : g;
  const c = newCreature({
    id: `${species.id}:0,0:1`, species: species.id, cellKey: '0,0', at, height, heading: 0.4, phase,
    behaviour: species.burrow !== null ? 'burrow' : 'idle', hostId, hunger: 0.1, fatigue: 0.1,
  });
  c.sinceThink = c.phase * species.thinkS;
  return c;
}

/** One simulation step of a single creature, the way the simulation does it. Returns whether it thought. */
function step(c: CreatureState, species: CreatureSpecies, w: Fake, rand: () => number, dt: number, host?: PlantSource | null): boolean {
  tickNeeds(c, species, dt);
  senseAlarm(c, species, w.list);
  let thought = false;
  if (thinkDue(c, species)) {
    think(c, species, w, rand, w.sky, host);
    thought = true;
  }
  move(c, species, w, dt);
  return thought;
}

function finite(c: CreatureState): void {
  for (const v of [c.at.wx, c.at.wz, c.height, c.heading, c.pitch, c.targetHeight, c.hunger, c.fatigue, c.alarm, c.behaviourS, c.behaviourUntilS, c.sinceThink]) {
    expect(Number.isFinite(v)).toBe(true);
  }
  if (c.target !== null) expect(Number.isFinite(c.target.wx) && Number.isFinite(c.target.wz)).toBe(true);
}

const SHRUB: PlantSource = { family: 'shrub', at: world(500, 500), size: 40, id: 'shrub:0,0:3', variant: 0 };

describe('the vocabulary and a thousand seconds', () => {
  it('every species, fuzzed for 1,000 s with a seeded rand, uses only its medium words and changes behaviour without a disturbance', () => {
    for (const id of CREATURE_IDS) {
      const species = CREATURE_SPECIES[id];
      const w = fakeWorld();
      w.plants = [SHRUB];
      const rand = mulberry32(id.length * 977 + 3);
      const c = spawn(species, world(500, 500), species.population.hosts !== null ? SHRUB.id : null);
      const seen = new Set<string>();
      const dt = 1 / 30;
      // An act is a new word or a new target: a worm's fresh heading is an act, though the word stays `burrow`.
      let acts = 0;
      let lastWord = c.behaviour;
      let lastTarget = c.target;
      const wrongWords: string[] = [];
      let nonFinite = 0;
      for (let i = 0; i < 1000 * 30; i += 1) {
        step(c, species, w, rand, dt, species.population.hosts !== null ? SHRUB : null);
        if (!BEHAVIOURS_BY_MEDIUM[species.medium].includes(c.behaviour)) wrongWords.push(c.behaviour);
        if (i < 150 * 30 && (c.behaviour !== lastWord || c.target !== lastTarget)) acts += 1;
        lastWord = c.behaviour;
        lastTarget = c.target;
        seen.add(c.behaviour);
        if (![c.at.wx, c.at.wz, c.height, c.heading, c.pitch, c.targetHeight, c.hunger, c.fatigue, c.alarm].every(Number.isFinite)) nonFinite += 1;
      }
      expect(wrongWords, id).toEqual([]);
      expect(nonFinite, id).toBe(0);
      expect(acts, `${id} did nothing in its first two and a half minutes`).toBeGreaterThanOrEqual(2);
      expect(seen.size, id).toBeGreaterThanOrEqual(3);
      finite(c);
    }
  }, 60_000);
});

describe('the clocks and the alarm', () => {
  it('hunger climbs while not feeding and returns to nothing over the feed; fatigue climbs while moving and returns over the rest', () => {
    const c = spawn(HOUSEFLY, world(100, 100));
    c.behaviour = 'fly';
    c.hunger = 0;
    c.fatigue = 0;
    tickNeeds(c, HOUSEFLY, 10);
    expect(c.hunger).toBeCloseTo(10 * HOUSEFLY.needs.hungerPerS, 9);
    expect(c.fatigue).toBeCloseTo(10 * HOUSEFLY.needs.fatiguePerS, 9);
    c.behaviour = 'feed';
    c.behaviourUntilS = 10;
    c.hunger = 1;
    tickNeeds(c, HOUSEFLY, 5);
    expect(c.hunger).toBeCloseTo(0.5, 9);
    tickNeeds(c, HOUSEFLY, 50);
    expect(c.hunger).toBe(0);
    c.behaviour = 'rest';
    c.behaviourUntilS = 20;
    c.fatigue = 1;
    tickNeeds(c, HOUSEFLY, 10);
    expect(c.fatigue).toBeCloseTo(0.5, 9);
    c.behaviour = 'idle';
    const f = c.fatigue;
    tickNeeds(c, HOUSEFLY, 10);
    expect(c.fatigue).toBe(f);
  });

  it('thinkDue fires once per thinkS, honours the phase, and a long step earns one thought', () => {
    const c = spawn(HOUSEFLY, world(100, 100), null, 0.5);
    let thoughts = 0;
    for (let i = 0; i < 600; i += 1) {
      tickNeeds(c, HOUSEFLY, 1 / 60);
      if (thinkDue(c, HOUSEFLY)) thoughts += 1;
    }
    expect(Math.abs(thoughts - 10 / HOUSEFLY.thinkS)).toBeLessThanOrEqual(1);
    const late = spawn(HOUSEFLY, world(100, 100), null, 0.9);
    const early = spawn(HOUSEFLY, world(100, 100), null, 0.1);
    tickNeeds(late, HOUSEFLY, HOUSEFLY.thinkS * 0.2);
    tickNeeds(early, HOUSEFLY, HOUSEFLY.thinkS * 0.2);
    expect(thinkDue(late, HOUSEFLY)).toBe(true);
    expect(thinkDue(early, HOUSEFLY)).toBe(false);
    tickNeeds(early, HOUSEFLY, 5);
    expect(thinkDue(early, HOUSEFLY)).toBe(true);
    expect(thinkDue(early, HOUSEFLY)).toBe(true);
    expect(thinkDue(early, HOUSEFLY)).toBe(false);
  });

  it('a disturbance inside alarmMm plus its radius raises the alarm to 1, sets the away point once, and the alarm decays over alarmS', () => {
    const c = spawn(EARTHWORM, world(100, 100));
    const reach = unitsOfMm(EARTHWORM.senses.alarmMm);
    expect(senseAlarm(c, EARTHWORM, [{ at: world(100 + reach + 5, 100), height: c.height, radius: 0 }])).toBe(false);
    expect(c.alarm).toBe(0);
    expect(senseAlarm(c, EARTHWORM, [{ at: world(100 + reach + 5, 100), height: c.height, radius: 6 }])).toBe(true);
    expect(c.alarm).toBe(1);
    expect(c.target).not.toBeNull();
    expect(c.target!.wx).toBeLessThan(100); // away: west of the worm, the camera being east
    expect(c.sinceThink).toBe(EARTHWORM.thinkS); // the next think is now
    const away = c.target;
    expect(senseAlarm(c, EARTHWORM, [{ at: world(100 + reach + 5, 100), height: c.height, radius: 6 }])).toBe(false);
    expect(c.target).toBe(away);
    // A camera high overhead is not on top of it: the distance is three-dimensional.
    const calm = spawn(EARTHWORM, world(100, 100));
    expect(senseAlarm(calm, EARTHWORM, [{ at: world(100, 100), height: c.height + reach * 2, radius: 0 }])).toBe(false);
    tickNeeds(c, EARTHWORM, EARTHWORM.senses.alarmS / 2);
    expect(c.alarm).toBeCloseTo(0.5, 9);
    tickNeeds(c, EARTHWORM, EARTHWORM.senses.alarmS);
    expect(c.alarm).toBe(0);
  });
});

describe('the worm', () => {
  const rain: CreatureWeather = { rainMmHr: RAINING_MM_HR * 2, windX: 0, windZ: 0, night: false };
  const night: CreatureWeather = { rainMmHr: 0, windX: 0, windZ: 0, night: true };

  it('surfaces when it rains and stays up while it does; surfaces at night; burrows in a dry day', () => {
    for (const sky of [rain, night]) {
      const w = fakeWorld();
      w.sky = sky;
      const rand = mulberry32(11);
      const c = spawn(EARTHWORM, world(400, 400));
      let up = 0;
      for (let i = 0; i < 30 * 120; i += 1) {
        step(c, EARTHWORM, w, rand, 1 / 30);
        if (c.behaviour === 'surface' || c.behaviour === 'feed') up += 1;
      }
      expect(up).toBeGreaterThan(30 * 100);
      expect(c.height).toBeCloseTo(ground(c.at), 3);
    }
    const w = fakeWorld();
    const rand = mulberry32(12);
    const c = spawn(EARTHWORM, world(400, 400));
    let under = 0;
    for (let i = 0; i < 30 * 60; i += 1) {
      step(c, EARTHWORM, w, rand, 1 / 30);
      if (c.behaviour === 'burrow') under += 1;
      expect(c.height).toBeLessThanOrEqual(ground(c.at));
    }
    expect(under).toBeGreaterThan(30 * 40);
  });

  it('picks a new heading every headingS, turned by no more than `turn` of a half-turn', () => {
    const w = fakeWorld();
    const rand = mulberry32(5);
    const c = spawn(EARTHWORM, world(400, 400));
    const headings: number[] = [];
    let last = -1;
    for (let i = 0; i < 30 * 400; i += 1) {
      step(c, EARTHWORM, w, rand, 1 / 30);
      if (c.behaviour === 'burrow' && c.behaviourS < last) {
        headings.push(c.target === null ? c.heading : Math.atan2(c.target.wx - c.at.wx, c.target.wz - c.at.wz));
      }
      last = c.behaviourS;
    }
    expect(headings.length).toBeGreaterThanOrEqual(4);
    expect(headings.length).toBeLessThanOrEqual(400 / EARTHWORM.burrow!.headingS[0] + 2);
  });

  it('hungry with litter within sight, it surfaces and feeds at the litter; hungry with none, it burrows on', () => {
    const w = fakeWorld();
    const litter: ResourceSite = { id: 'litter:0,0:9', kind: 'litter', at: world(403, 402), above: 0, amount: 1, ownerId: null };
    w.sites = [litter];
    const rand = mulberry32(21);
    const c = spawn(EARTHWORM, world(400, 400));
    c.hunger = 0.95;
    let fed = false;
    for (let i = 0; i < 30 * 200 && !fed; i += 1) {
      step(c, EARTHWORM, w, rand, 1 / 30);
      if (c.behaviour === 'feed') {
        fed = true;
        expect(c.hostId).toBe(litter.id);
        expect(c.target).toBe(litter.at);
      }
    }
    expect(fed).toBe(true);
    expect(nearestSite(w, world(400, 400), ['litter'], unitsOfMm(EARTHWORM.senses.sightMm))).toBe(litter);
    expect(nearestSite(w, world(400, 400), ['nectar'], unitsOfMm(EARTHWORM.senses.sightMm))).toBeNull();
    expect(nearestSite(w, world(400, 400), ['litter'], 1)).toBeNull();
  });

  it('flees a disturbance within one think: down to the bottom of the band and away from it', () => {
    const w = fakeWorld();
    const rand = mulberry32(3);
    const c = spawn(EARTHWORM, world(400, 400));
    for (let i = 0; i < 30 * 5; i += 1) step(c, EARTHWORM, w, rand, 1 / 30);
    const before = c.at;
    w.list = [{ at: world(before.wx + 2, before.wz), height: c.height, radius: 0 }];
    let thoughts = 0;
    while (thoughts < 1) if (step(c, EARTHWORM, w, rand, 1 / 30)) thoughts += 1;
    expect(c.behaviour).toBe('flee');
    expect(c.alarm).toBeGreaterThanOrEqual(ALARM_FLEES_AT);
    expect(c.target!.wx).toBeLessThan(before.wx);
    for (let i = 0; i < 30 * 3; i += 1) step(c, EARTHWORM, w, rand, 1 / 30);
    expect(c.at.wx).toBeLessThan(before.wx);
    expect(c.height).toBeCloseTo(ground(c.at) - unitsOfMm(EARTHWORM.burrow!.underMm), 3);
    w.list = [];
    for (let i = 0; i < 30 * 30; i += 1) step(c, EARTHWORM, w, rand, 1 / 30);
    expect(c.behaviour).not.toBe('flee');
  });
});

describe('the aphid', () => {
  it('feeds most of the time, walks within five body lengths of its host, keeps its hostId, and stays on the plant for ten minutes', () => {
    const w = fakeWorld();
    w.plants = [SHRUB];
    const rand = mulberry32(8);
    const c = spawn(APHID, SHRUB.at, SHRUB.id);
    const body = unitsOfMm(APHID.lengthMm);
    let feeding = 0;
    let walked = 0;
    const total = 30 * 600;
    for (let i = 0; i < total; i += 1) {
      step(c, APHID, w, rand, 1 / 30, SHRUB);
      if (c.behaviour === 'feed') feeding += 1;
      if (c.behaviour === 'wander') walked += 1;
      expect(distance(c.at, SHRUB.at)).toBeLessThanOrEqual(HOST_WALK_LENGTHS * body + 1e-6);
      expect(c.hostId).toBe(SHRUB.id);
      expect(c.height).toBeGreaterThanOrEqual(ground(c.at) - 1e-9);
      expect(c.height).toBeLessThanOrEqual(ground(c.at) + SHRUB.size + 1e-9);
    }
    expect(feeding).toBeGreaterThan(total / 2);
    expect(walked).toBeGreaterThan(0);
    expect(hostPlantOf(c, w)).toBe(SHRUB);
  }, 30_000);

  it('on alarm drops to the ground and scrambles a few body lengths, then walks back to its host and feeds', () => {
    const w = fakeWorld();
    w.plants = [SHRUB];
    const rand = mulberry32(9);
    const c = spawn(APHID, SHRUB.at, SHRUB.id);
    for (let i = 0; i < 30 * 10; i += 1) step(c, APHID, w, rand, 1 / 30, SHRUB);
    const perch = c.height;
    expect(perch).toBeGreaterThan(ground(c.at));
    w.list = [{ at: world(c.at.wx, c.at.wz + 1), height: c.height, radius: 0 }];
    let thoughts = 0;
    while (thoughts < 1) if (step(c, APHID, w, rand, 1 / 30, SHRUB)) thoughts += 1;
    expect(c.behaviour).toBe('flee');
    expect(c.targetHeight).toBeCloseTo(ground(c.at), 1);
    for (let i = 0; i < 30 * 5; i += 1) step(c, APHID, w, rand, 1 / 30, SHRUB);
    expect(c.height).toBeCloseTo(ground(c.at), 3);
    // It may already have been five body lengths out on a walk when the alarm came, and it scrambles three more.
    expect(distance(c.at, SHRUB.at)).toBeLessThanOrEqual((HOST_WALK_LENGTHS + HOST_FLEE_LENGTHS + 1) * unitsOfMm(APHID.lengthMm) + 1e-6);
    expect(c.hostId).toBe(SHRUB.id);
    w.list = [];
    let returned = false;
    for (let i = 0; i < 30 * 120 && !returned; i += 1) {
      step(c, APHID, w, rand, 1 / 30, SHRUB);
      if (c.behaviour === 'feed' && c.height > ground(c.at) + 1) returned = true;
    }
    expect(returned).toBe(true);
  });

  it('without a host it feeds where it stands and never wanders', () => {
    const w = fakeWorld();
    const rand = mulberry32(10);
    const c = spawn(APHID, world(700, 700), null);
    const at = c.at;
    for (let i = 0; i < 30 * 300; i += 1) {
      step(c, APHID, w, rand, 1 / 30, null);
      expect(c.behaviour).not.toBe('wander');
    }
    expect(c.at).toBe(at);
  });
});

describe('the fly', () => {
  it('hops, hovers, lands and perches; never targets a sea point; stays between the ground and its ceiling', () => {
    const w = fakeWorld();
    const rand = mulberry32(14);
    // Born on the beach, thirty centimetres from the sea: every random hop has to be checked.
    const c = spawn(HOUSEFLY, world(SEA_EAST_OF - 30, 400));
    const seen = new Set<string>();
    const ceiling = unitsOfMm(HOUSEFLY.flight!.ceilingMm);
    const seaTargets: string[] = [];
    let atSea = 0;
    let outOfBand = 0;
    let nonFinite = 0;
    for (let i = 0; i < 30 * 1000; i += 1) {
      step(c, HOUSEFLY, w, rand, 1 / 30);
      seen.add(c.behaviour);
      if (c.target !== null && isAirborne(c.behaviour) && !isLand(w, c.target)) seaTargets.push(`${c.target.wx},${c.target.wz}`);
      if (c.at.wx >= SEA_EAST_OF) atSea += 1;
      const g = ground(c.at);
      if (c.height < g - 1e-9 || c.height > g + ceiling + 1e-9) outOfBand += 1;
      if (![c.at.wx, c.at.wz, c.height, c.heading, c.pitch, c.targetHeight].every(Number.isFinite)) nonFinite += 1;
    }
    expect(seaTargets).toEqual([]);
    expect(atSea).toBe(0);
    expect(outOfBand).toBe(0);
    expect(nonFinite).toBe(0);
    finite(c);
    for (const word of ['idle', 'takeoff', 'fly', 'hover', 'land']) expect(seen, word).toContain(word);
    expect(seen.has('flee')).toBe(false);
  }, 30_000);

  it('is grounded by rain and by night: it does not take off, and lands if it is up', () => {
    for (const sky of [{ rainMmHr: 2, windX: 0, windZ: 0, night: false }, { rainMmHr: 0, windX: 0, windZ: 0, night: true }]) {
      const w = fakeWorld();
      const rand = mulberry32(15);
      const c = spawn(HOUSEFLY, world(600, 600));
      for (let i = 0; i < 30 * 3; i += 1) step(c, HOUSEFLY, w, rand, 1 / 30);
      // It is up (or about to be): now the weather turns.
      w.sky = sky;
      let airborneAfter = 0;
      for (let i = 0; i < 30 * 120; i += 1) {
        step(c, HOUSEFLY, w, rand, 1 / 30);
        if (i > 30 * 10 && isAirborne(c.behaviour)) airborneAfter += 1;
      }
      expect(airborneAfter).toBe(0);
      expect(c.height).toBeCloseTo(ground(c.at), 3);
    }
  });

  it('hungry with a resource in sight, it flies to it and feeds there, naming the site', () => {
    const w = fakeWorld();
    const nectar: ResourceSite = { id: 'flower:0,0:2', kind: 'nectar', at: world(620, 610), above: 5, amount: 3, ownerId: 'flower:0,0:2' };
    w.sites = [nectar];
    const rand = mulberry32(16);
    const c = spawn(HOUSEFLY, world(600, 600));
    c.hunger = 0.9;
    let fed = false;
    for (let i = 0; i < 30 * 120 && !fed; i += 1) {
      step(c, HOUSEFLY, w, rand, 1 / 30);
      if (c.behaviour === 'feed') {
        fed = true;
        expect(c.hostId).toBe(nectar.id);
        expect(distance(c.at, nectar.at)).toBeLessThan(unitsOfMm(HOUSEFLY.lengthMm) * 2);
      }
    }
    expect(fed).toBe(true);
  });

  it('a disturbance within alarm range makes it take off within one think, and it flies away from it', () => {
    const w = fakeWorld();
    const rand = mulberry32(17);
    const c = spawn(HOUSEFLY, world(600, 600));
    c.behaviour = 'idle';
    c.behaviourUntilS = 100; // a long perch, so only the alarm can lift it
    c.behaviourS = 1;
    for (let i = 0; i < 30 * 2; i += 1) step(c, HOUSEFLY, w, rand, 1 / 30);
    expect(c.behaviour).toBe('idle');
    const before = c.at;
    w.list = [{ at: world(before.wx - 5, before.wz), height: c.height, radius: 0 }];
    let thoughts = 0;
    while (thoughts < 1) if (step(c, HOUSEFLY, w, rand, 1 / 30)) thoughts += 1;
    expect(['takeoff', 'fly']).toContain(c.behaviour);
    expect(c.target!.wx).toBeGreaterThan(before.wx);
    for (let i = 0; i < 30 * 2; i += 1) step(c, HOUSEFLY, w, rand, 1 / 30);
    expect(c.at.wx).toBeGreaterThan(before.wx + 10);
    expect(isAirborne(c.behaviour)).toBe(true);
  });
});
