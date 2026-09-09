/**
 * The predation policy (Joshua's brief, §25): OFF never attacks, NORMAL
 * lets hunger and temperament decide with prey as the last resort,
 * FORCE lets a hungry predator take any legal prey in reach; what is
 * legal prey is the species entry's, and the table as shipped names
 * none — the aphid is nobody's; a species whose medium has no `attack`
 * word never chooses it, under any policy, in any state, whatever a
 * prey list forced onto it says; an attack is re-aimed as the prey
 * moves and ends where it is reached; and OFF mid-attack breaks it off.
 */
import { describe, expect, it } from 'vitest';
import {
  APHID, BEHAVIOURS_BY_MEDIUM, CREATURE_IDS, CREATURE_SPECIES, HOUSEFLY, LAB_CREATURE_IDS, QUEEN, WORKER, newCreature, unitsOfMm,
  type Behaviour, type CreatureId, type CreaturePolicy, type CreatureSpecies, type CreatureState, type CreatureWeather, type CreatureWorld,
  type Disturbance,
} from '../src/creatures';
import { creatureById, isPredator, nearestPrey, predationOf, preyOf, senseAlarm, think, thinkDue, tickNeeds } from '../src/creatures/intent';
import { move, paceOf } from '../src/creatures/locomotion';
import { distance, world, type WorldPoint } from '../src/world/coords';
import type { CellResources, PlantSource, ResourceSite, WaterQuery } from '../src/world/ecology/resources';
import type { Habitat, HabitatKind } from '../src/world/habitat';
import { CELL_SPAN } from '../src/world/objects/cells';
import { mulberry32 } from '../src/world/random';

const GROUND = 200;

function habitat(kind: HabitatKind, elevation: number): Habitat {
  return {
    kind, forest: 0, grass: 1, shrub: 0, bare: 0, wet: 0, lake: 0, coast: 0, exposure: 0,
    elevation, slopeDegrees: 0, coastDistance: 10_000, channel: false, rainfallMmYear: null,
  };
}

interface Fake extends CreatureWorld {
  sky: CreatureWeather | null;
  list: Disturbance[];
  sites: ResourceSite[];
  plants: PlantSource[];
  others: CreatureState[];
  policy?: CreaturePolicy;
}

const DRY: WaterQuery = { freshDepthAt: () => 0, isSeaAt: () => false, nearestWater: () => null };

function fakeWorld(policy?: CreaturePolicy): Fake {
  const w: Fake = {
    sky: null,
    list: [],
    sites: [],
    plants: [],
    others: [],
    policy,
    groundAt: () => GROUND,
    normalAt: () => ({ nx: 0, ny: 1, nz: 0 }),
    habitatAt: () => habitat('grassland', GROUND),
    plantsOf: () => w.plants,
    resourcesOf: (cx, cz): CellResources | null => {
      const sites = w.sites.filter((s) => Math.floor(s.at.wx / CELL_SPAN) === cx && Math.floor(s.at.wz / CELL_SPAN) === cz);
      return { cx, cz, sites };
    },
    water: DRY,
    weather: () => w.sky,
    disturbances: () => w.list,
    creatures: () => w.others,
  };
  return w;
}

/** A species with a prey list forced onto it — what the table does not ship for anyone, so the tests must. */
function hunter(species: CreatureSpecies, prey: readonly CreatureId[], temperament = species.temperament): CreatureSpecies {
  return { ...species, temperament, prey } as CreatureSpecies;
}

function spawn(species: CreatureSpecies, at: WorldPoint, hunger = 0.1, behaviour?: Behaviour, n = 1): CreatureState {
  const height = species.burrow !== null ? GROUND - unitsOfMm(species.burrow.underMm) : GROUND;
  const c = newCreature({
    id: `${species.id}:0,0:${n}`, species: species.id, cellKey: '0,0', at, height, heading: 0.4, phase: 0.3,
    behaviour: behaviour ?? (species.burrow !== null ? 'burrow' : 'idle'), hunger, fatigue: 0.1,
  });
  c.sinceThink = c.phase * species.thinkS;
  return c;
}

/** Run the word out so the next think decides afresh. */
function decided(c: CreatureState): CreatureState {
  c.behaviourS = 10;
  c.behaviourUntilS = 1;
  return c;
}

function step(c: CreatureState, species: CreatureSpecies, w: Fake, rand: () => number, dt: number): boolean {
  tickNeeds(c, species, dt);
  senseAlarm(c, species, w.list);
  let thought = false;
  if (thinkDue(c, species)) {
    think(c, species, w, rand, w.sky, null);
    thought = true;
  }
  move(c, species, w, dt);
  return thought;
}

const POLICIES: readonly (CreaturePolicy | undefined)[] = [undefined, { predation: 'off' }, { predation: 'normal' }, { predation: 'force' }];

describe('the policy and the prey list', () => {
  it('predationOf reads the world\'s option and is normal where there is none', () => {
    expect(predationOf(fakeWorld())).toBe('normal');
    expect(predationOf(fakeWorld({ predation: 'off' }))).toBe('off');
    expect(predationOf(fakeWorld({ predation: 'force' }))).toBe('force');
  });

  it('the table as shipped names no prey for anyone — the aphid is nobody\'s — so no entry is a predator', () => {
    for (const id of LAB_CREATURE_IDS) {
      const species = CREATURE_SPECIES[id];
      expect(preyOf(species), id).toEqual([]);
      expect(preyOf(species), id).not.toContain('aphid');
      expect(isPredator(species), id).toBe(false);
    }
    // A prey list makes a predator only of a species whose medium has the word.
    expect(isPredator(hunter(WORKER, ['housefly']))).toBe(true);
    expect(isPredator(hunter(QUEEN, ['housefly']))).toBe(true);
    expect(isPredator(hunter(HOUSEFLY, ['aphid']))).toBe(false);
    expect(isPredator(hunter(APHID, ['worker']))).toBe(false);
  });

  it('nearestPrey and creatureById read the world\'s creatures, never itself, only the listed species, inside the radius', () => {
    const w = fakeWorld();
    const k = spawn(hunter(WORKER, ['housefly']), world(500, 500));
    const fly = spawn(HOUSEFLY, world(503, 500), 0.1, 'idle', 2);
    const far = spawn(HOUSEFLY, world(540, 500), 0.1, 'idle', 3);
    const aphid = spawn(APHID, world(501, 500), 0.1, 'idle', 4);
    w.others = [k, aphid, far, fly];
    expect(nearestPrey(k, hunter(WORKER, ['housefly']), w, 5)).toBe(fly);
    expect(nearestPrey(k, hunter(WORKER, ['housefly']), w, 2)).toBeNull();
    expect(nearestPrey(k, hunter(WORKER, ['worker']), w, 5)).toBeNull();
    expect(nearestPrey(k, WORKER, w, 5)).toBeNull();
    expect(creatureById(w, fly.id)).toBe(fly);
    expect(creatureById(w, 'nobody')).toBeNull();
    const blind = fakeWorld();
    delete (blind as { creatures?: unknown }).creatures;
    expect(nearestPrey(k, hunter(WORKER, ['housefly']), blind, 5)).toBeNull();
    expect(creatureById(blind, fly.id)).toBeNull();
  });
});

describe('non-predators never choose attack', () => {
  it('every non-ground species × every word of its medium × every policy, starving, with a worker adjacent and a prey list forced onto it: never `attack`', () => {
    for (const id of CREATURE_IDS) {
      const forced = hunter(CREATURE_SPECIES[id], ['worker', 'queen', 'aphid', 'housefly', 'earthworm']);
      for (const policy of POLICIES) {
        for (const word of BEHAVIOURS_BY_MEDIUM[forced.medium]) {
          const w = fakeWorld(policy);
          const c = decided(spawn(forced, world(500, 500), 1, word));
          const worker = spawn(WORKER, world(500.5, 500), 0.1, 'idle', 2);
          w.others = [c, worker];
          think(c, forced, w, () => 0.5, null, null);
          expect(c.behaviour, `${id} in ${word} under ${policy?.predation ?? 'absent'}`).not.toBe('attack');
          expect(BEHAVIOURS_BY_MEDIUM[forced.medium], `${id} in ${word}`).toContain(c.behaviour);
        }
      }
    }
  });
});

describe('the ants under each policy', () => {
  const PREYS_ON_FLIES = hunter(WORKER, ['housefly']);

  it('OFF: a starving worker with legal prey adjacent never attacks in a minute — and still defends a disturbance on it', () => {
    const w = fakeWorld({ predation: 'off' });
    const rand = mulberry32(71);
    const k = spawn(PREYS_ON_FLIES, world(500, 500), 0.95);
    const fly = spawn(HOUSEFLY, world(501, 500), 0.1, 'idle', 2);
    fly.behaviourUntilS = 1000;
    w.others = [k, fly];
    let attacks = 0;
    for (let i = 0; i < 30 * 60; i += 1) {
      step(k, PREYS_ON_FLIES, w, rand, 1 / 30);
      if (k.behaviour === 'attack') attacks += 1;
    }
    expect(attacks).toBe(0);
    w.list = [{ at: world(k.at.wx + 0.1, k.at.wz), height: k.height, radius: 0, source: 'tool' }];
    let thoughts = 0;
    while (thoughts < 1) if (step(k, PREYS_ON_FLIES, w, rand, 1 / 30)) thoughts += 1;
    expect(k.behaviour).toBe('defend');
  });

  it('NORMAL: a hungry defensive worker with no food in sight attacks prey in sight; with food in sight it goes to the food; not hungry, or skittish, it never does', () => {
    const w = fakeWorld({ predation: 'normal' });
    const fly = spawn(HOUSEFLY, world(503, 500), 0.1, 'idle', 2);
    const k = decided(spawn(PREYS_ON_FLIES, world(500, 500), 0.7));
    w.others = [k, fly];
    think(k, PREYS_ON_FLIES, w, () => 0.5, null, null);
    expect(k.behaviour).toBe('attack');
    expect(k.hostId).toBe(fly.id);
    expect(k.target).toBe(fly.at);
    // The absent policy is normal.
    const island = fakeWorld();
    const k2 = decided(spawn(PREYS_ON_FLIES, world(500, 500), 0.7));
    island.others = [k2, fly];
    think(k2, PREYS_ON_FLIES, island, () => 0.5, null, null);
    expect(k2.behaviour).toBe('attack');
    // Food in sight: the food, not the fly.
    const fed = fakeWorld({ predation: 'normal' });
    fed.sites = [{ id: 'nectar:0,0:1', kind: 'nectar', at: world(500, 504), above: 0, amount: 1, ownerId: null }];
    const k3 = decided(spawn(PREYS_ON_FLIES, world(500, 500), 0.7));
    fed.others = [k3, fly];
    think(k3, PREYS_ON_FLIES, fed, () => 0.5, null, null);
    expect(k3.behaviour).toBe('wander');
    expect(k3.hostId).toBe('nectar:0,0:1');
    // Not hungry: no attack.
    const k4 = decided(spawn(PREYS_ON_FLIES, world(500, 500), 0.1));
    w.others = [k4, fly];
    think(k4, PREYS_ON_FLIES, w, () => 0.5, null, null);
    expect(k4.behaviour).not.toBe('attack');
    // A skittish worker hunts nothing under NORMAL, however hungry.
    const timid = hunter(WORKER, ['housefly'], 'skittish');
    const k5 = decided(spawn(timid, world(500, 500), 0.95));
    w.others = [k5, fly];
    think(k5, timid, w, () => 0.5, null, null);
    expect(k5.behaviour).not.toBe('attack');
    // Out of sight (50 mm is five units): nothing to attack.
    const k6 = decided(spawn(PREYS_ON_FLIES, world(500, 500), 0.95));
    w.others = [k6, spawn(HOUSEFLY, world(510, 500), 0.1, 'idle', 3)];
    think(k6, PREYS_ON_FLIES, w, () => 0.5, null, null);
    expect(k6.behaviour).not.toBe('attack');
  });

  it('FORCE: a hungry predator attacks legal prey in reach, food in sight or not, skittish or not; the attack is the burst, re-aimed as the prey moves, and ends idle when it is reached', () => {
    const w = fakeWorld({ predation: 'force' });
    w.sites = [{ id: 'nectar:0,0:1', kind: 'nectar', at: world(500, 501), above: 0, amount: 1, ownerId: null }];
    const timid = hunter(WORKER, ['housefly'], 'skittish');
    const rand = mulberry32(72);
    const k = decided(spawn(timid, world(500, 500), 0.7));
    const fly = spawn(HOUSEFLY, world(504, 500), 0.1, 'idle', 2);
    w.others = [k, fly];
    think(k, timid, w, () => 0.5, null, null);
    expect(k.behaviour).toBe('attack');
    expect(k.hostId).toBe(fly.id);
    expect(k.target).toBe(fly.at);
    expect(paceOf(k, timid)).toBeCloseTo(unitsOfMm(WORKER.pace.fleeMmS), 9);
    // The prey moves: the next think re-aims.
    fly.at = world(504, 502);
    let thoughts = 0;
    while (thoughts < 1) if (step(k, timid, w, rand, 1 / 30)) thoughts += 1;
    expect(k.behaviour).toBe('attack');
    expect(k.target).toBe(fly.at);
    // It closes at the burst and, reached, stands down: the bite is a later milestone.
    let ended = false;
    for (let i = 0; i < 30 * 20 && !ended; i += 1) {
      step(k, timid, w, rand, 1 / 30);
      if (k.behaviour !== 'attack') ended = true;
    }
    expect(ended).toBe(true);
    expect(k.behaviour).toBe('idle');
    expect(k.hostId).toBeNull();
    expect(distance(k.at, fly.at)).toBeLessThanOrEqual(unitsOfMm(WORKER.lengthMm) + 1e-6);
    // Not hungry: FORCE still wants a hungry predator.
    const full = decided(spawn(timid, world(500, 500), 0.1));
    w.others = [full, fly];
    think(full, timid, w, () => 0.5, null, null);
    expect(full.behaviour).not.toBe('attack');
    // The queen, predator-capable by her medium, does the same under FORCE with a list — and never under OFF.
    const q = decided(spawn(hunter(QUEEN, ['housefly']), world(500, 500), 0.7));
    w.others = [q, spawn(HOUSEFLY, world(506, 500), 0.1, 'idle', 3)];
    think(q, hunter(QUEEN, ['housefly']), w, () => 0.5, null, null);
    expect(q.behaviour).toBe('attack');
    const off = fakeWorld({ predation: 'off' });
    const q2 = decided(spawn(hunter(QUEEN, ['housefly']), world(500, 500), 0.7));
    off.others = [q2, spawn(HOUSEFLY, world(506, 500), 0.1, 'idle', 3)];
    think(q2, hunter(QUEEN, ['housefly']), off, () => 0.5, null, null);
    expect(q2.behaviour).not.toBe('attack');
  });

  it('OFF mid-attack breaks it off; prey out of sight breaks it off; the table\'s own worker under FORCE attacks nothing', () => {
    const mutable = fakeWorld({ predation: 'force' });
    const k = decided(spawn(PREYS_ON_FLIES, world(500, 500), 0.7));
    const fly = spawn(HOUSEFLY, world(504, 500), 0.1, 'idle', 2);
    mutable.others = [k, fly];
    think(k, PREYS_ON_FLIES, mutable, () => 0.5, null, null);
    expect(k.behaviour).toBe('attack');
    mutable.policy = { predation: 'off' };
    think(k, PREYS_ON_FLIES, mutable, () => 0.5, null, null);
    expect(k.behaviour).toBe('idle');
    expect(k.hostId).toBeNull();
    // Prey that flew out of sight.
    const w = fakeWorld({ predation: 'force' });
    const k2 = decided(spawn(PREYS_ON_FLIES, world(500, 500), 0.7));
    const fly2 = spawn(HOUSEFLY, world(504, 500), 0.1, 'idle', 3);
    w.others = [k2, fly2];
    think(k2, PREYS_ON_FLIES, w, () => 0.5, null, null);
    expect(k2.behaviour).toBe('attack');
    fly2.at = world(540, 500);
    think(k2, PREYS_ON_FLIES, w, () => 0.5, null, null);
    expect(k2.behaviour).toBe('idle');
    // The shipped worker, hungry, everyone in reach, FORCE: nothing is prey, nothing is attacked.
    const lab = fakeWorld({ predation: 'force' });
    const rand = mulberry32(73);
    const shipped = spawn(WORKER, world(500, 500), 0.95);
    lab.others = [
      shipped,
      spawn(QUEEN, world(501, 500), 0.1, 'idle', 2),
      spawn(HOUSEFLY, world(500, 501), 0.1, 'idle', 3),
      spawn(APHID, world(499, 500), 0.1, 'idle', 4),
      spawn(CREATURE_SPECIES.earthworm, world(500, 499), 0.1, 'burrow', 5),
    ];
    let attacks = 0;
    for (let i = 0; i < 30 * 60; i += 1) {
      step(shipped, WORKER, lab, rand, 1 / 30);
      if (shipped.behaviour === 'attack') attacks += 1;
    }
    expect(attacks).toBe(0);
  });
});
