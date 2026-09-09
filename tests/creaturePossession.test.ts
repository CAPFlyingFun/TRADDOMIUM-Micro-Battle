/**
 * Possession: the ledger names a creature and the simulation obeys — the
 * body is full tier, the brain is silent, the player's demand moves it
 * through the one integrator, its senses still run, and release hands it
 * back where it stands with the same id and the same needs. The player's
 * helpers in `demand.ts` — `wordFor` and `playerDemand` — are legal for
 * every species at every corner of the intent.
 */
import { describe, expect, it } from 'vitest';
import { playerId } from '../src/actor/PlayerId';
import { NEUTRAL_INTENT, type Intent } from '../src/input/Intent';
import {
  APHID, BLOCK, CREATURE_SPECIES, ControlLedger, CreatureSim, EARTHWORM, HOUSEFLY, LAB_CREATURE_IDS, LAB_PLANTS, LAB_SEED, LAB_SITES,
  LITTER_CORNER, PROTEIN_SPOT, QUEEN, WORKER, behaviourAllowedFor, createLabWorld, labSpawns, newCreature, newMutableIntent,
  paceRatio, playerDemand, sizeRatio, unitsOfMm, wordFor,
  type Behaviour, type CreatureId, type CreatureSpecies, type CreatureState, type LabWorld, type NewCreatureOptions,
} from '../src/creatures';
import { distance, world, type WorldPoint } from '../src/world/coords';
import type { WaterQuery } from '../src/world/ecology/resources';

const A = playerId('player-a');
const B = playerId('player-b');
const FOCUS = world(0, 0);
const DT = 1 / 60;
const LAB_SPECIES: readonly CreatureSpecies[] = LAB_CREATURE_IDS.map((id) => CREATURE_SPECIES[id]);

interface Lab {
  readonly world: LabWorld;
  readonly control: ControlLedger;
  readonly sim: CreatureSim;
  readonly by: Map<CreatureId, CreatureState>;
  /** What the local player wants: set it, and every possessed body gets it on the next update. */
  intent: Intent;
  /** A clock for the cost line, ticking a hundredth of a millisecond a read. */
  ticks: number;
}

/** The Lab: the five placed over the metre box, nothing generated, the ledger and the local player's intent handed in. */
function lab(only?: readonly CreatureId[], labWorld: LabWorld = createLabWorld()): Lab {
  const control = new ControlLedger();
  const out: Lab = {
    world: labWorld, control, by: new Map(), intent: NEUTRAL_INTENT, ticks: 0,
    sim: new CreatureSim({
      world: labWorld, seed: LAB_SEED, populate: false, species: LAB_SPECIES, control, rung: 'medium',
      intentOf: () => out.intent,
      now: () => (out.ticks += 0.01),
    }),
  };
  for (const spawn of labSpawns()) {
    if (only !== undefined && !only.includes(spawn.species)) continue;
    out.by.set(spawn.species, out.sim.spawn(spawn));
  }
  return out;
}

/** Run `seconds` of simulation at sixty hertz around the box's middle, calling `each` after every frame. */
function run(l: Lab, seconds: number, each?: (frame: number) => void): void {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i += 1) {
    l.world.advance(DT);
    l.sim.update(FOCUS, DT);
    if (each) each(i);
  }
}

const FORWARD: Intent = { forward: 1, strafe: 0, turn: 0, sprint: false };

/** The furthest a body of this species can move on the plane in one frame, or snap to a target: the no-teleport bound. */
function planeBound(c: CreatureState, species: CreatureSpecies): number {
  const fastest = Math.max(species.pace.fleeMmS * paceRatio(c, species), species.flight === null ? 0 : species.flight.burstMmS);
  const body = sizeRatio(c, species) * unitsOfMm(species.lengthMm);
  return Math.max(unitsOfMm(fastest) * DT, 0.25 * body) + 1e-6;
}

function totalPossessed(sim: CreatureSim): number {
  let n = 0;
  for (const id of LAB_CREATURE_IDS) n += sim.counts(id).possessed;
  return n;
}

describe('possession authority', () => {
  it('the ledger names a creature and the sim obeys: full tier, counted, driven by the player\'s demand — and the ledger is never written', () => {
    const l = lab();
    const queen = l.by.get('queen')!;
    expect(l.sim.creature(queen.id)).toBe(queen);
    expect(l.sim.creature('nobody')).toBeNull();
    run(l, 0.5);
    expect(totalPossessed(l.sim)).toBe(0);
    expect(l.sim.creatures()).toHaveLength(5);

    l.control.possess(queen.id, A);
    const records = l.control.records();
    l.intent = FORWARD;
    const start = queen.at;
    const heading = queen.heading;
    run(l, 2);
    expect(l.sim.counts('queen').possessed).toBe(1);
    expect(l.sim.counts('queen').byTier.full).toBe(1);
    expect(queen.tier).toBe('full');
    expect(l.sim.counts('worker').possessed).toBe(0);
    expect(totalPossessed(l.sim)).toBe(1);
    // Two seconds of a plain forward at her own walking pace, straight along the heading she was possessed at.
    const pace = paceRatio(queen, QUEEN) * unitsOfMm(QUEEN.pace.wanderMmS);
    expect(distance(queen.at, start)).toBeCloseTo(pace * 2, 6);
    expect(queen.heading).toBe(heading);
    expect(queen.behaviour).toBe('wander');
    // The cost line carries the player's share.
    expect(l.sim.cost().demanded).toBe(1);
    expect(l.sim.cost().demandMs).toBeGreaterThan(0);
    expect(l.sim.cost().moveMs).toBeGreaterThanOrEqual(0);
    // The book is the session's: the sim read it and wrote nothing.
    expect(l.control.records()).toEqual(records);
    expect(l.control.controllerOf(queen.id)).toBe(A);
  });

  it('with no ledger, or an empty one (observer mode), every body gets its brain', () => {
    const noLedger = new CreatureSim({ world: createLabWorld(), seed: LAB_SEED, populate: false, species: LAB_SPECIES });
    for (const spawn of labSpawns()) noLedger.spawn(spawn);
    let thoughts = 0;
    for (let i = 0; i < 120; i += 1) {
      noLedger.update(FOCUS, DT);
      thoughts += noLedger.cost().thoughts;
    }
    expect(thoughts).toBeGreaterThan(5 * 2);
    expect(noLedger.cost().demanded).toBe(0);
    for (const id of LAB_CREATURE_IDS) expect(noLedger.counts(id).possessed).toBe(0);

    const l = lab();
    let observed = 0;
    run(l, 2, () => { observed += l.sim.cost().thoughts; });
    expect(observed).toBeGreaterThan(5 * 4);
    expect(totalPossessed(l.sim)).toBe(0);
  });

  it('a claim on an id the sim does not hold breaks nothing, and is honoured the moment that creature is placed', () => {
    const l = lab(['queen']);
    const [, workerSpawn] = labSpawns();
    l.control.possess(workerSpawn.id, A);
    run(l, 0.5);
    expect(totalPossessed(l.sim)).toBe(0);
    expect(l.sim.cost().demanded).toBe(0);
    const worker = l.sim.spawn(workerSpawn);
    l.intent = FORWARD;
    const start = worker.at;
    run(l, 1);
    expect(l.sim.counts('worker').possessed).toBe(1);
    expect(worker.tier).toBe('full');
    expect(distance(worker.at, start)).toBeGreaterThan(0);
    expect(worker.target).toBeNull();
  });
});

describe('the AI is suspended while possessed', () => {
  it('think is not called, the target stays null and the body goes where the intent says, for ten seconds', () => {
    const l = lab(['worker']);
    const worker = l.by.get('worker')!;
    run(l, 1);
    l.control.possess(worker.id, A);
    l.intent = FORWARD;
    const start = worker.at;
    const heading = worker.heading;
    const hunger = worker.hunger;
    let thoughts = 0;
    run(l, 10, () => {
      thoughts += l.sim.cost().thoughts;
      expect(worker.target).toBeNull();
      expect(worker.behaviour).toBe('wander');
      expect(l.sim.cost().demanded).toBe(1);
    });
    expect(thoughts).toBe(0);
    const pace = paceRatio(worker, WORKER) * unitsOfMm(WORKER.pace.wanderMmS);
    expect(distance(worker.at, start)).toBeCloseTo(pace * 10, 5);
    expect(worker.heading).toBe(heading);
    // The needs kept ticking: a walking ant gets hungrier, as it does for the AI.
    expect(worker.hunger).toBeGreaterThan(hunger);
    expect(worker.fatigue).toBeGreaterThan(0.1);
  });

  it('no simultaneous write: alarmed by a disturbance on top of her, a possessed queen keeps her alarm and NOT the brain\'s stand or its away point', () => {
    const l = lab(['queen']);
    const queen = l.by.get('queen')!;
    l.control.possess(queen.id, A);
    l.intent = FORWARD;
    run(l, 0.5);
    l.world.setCameraDisturbance({ at: queen.at, height: queen.height, radius: 5 });
    const words = new Set<Behaviour>();
    run(l, 10, () => {
      expect(queen.target).toBeNull();
      words.add(queen.behaviour);
      l.world.setCameraDisturbance({ at: queen.at, height: queen.height, radius: 5 });
    });
    expect(queen.alarm).toBeGreaterThan(0.9);
    // The word is the demand's, never the brain's answer to the alarm.
    expect(words.has('defend')).toBe(false);
    expect(words.has('flee')).toBe(false);
    expect([...words]).toEqual(['wander']);
    expect(l.sim.cost().thoughts).toBe(0);
  });

  it('a possessed worm still senses the flood — the alarm rises — and is not moved by it', () => {
    let bank: number | null = null;
    const base = createLabWorld();
    const water: WaterQuery = {
      freshDepthAt: (at) => (bank !== null && at.wx >= bank ? 10 : base.water.freshDepthAt(at)),
      isSeaAt: () => false,
      nearestWater: (at, radius) => {
        if (bank === null) return null;
        const d = Math.abs(at.wx - bank);
        return d < radius ? { at: world(bank, at.wz), distance: d } : null;
      },
    };
    const flooded: LabWorld = { ...base, water };
    const l = lab(['earthworm'], flooded);
    const worm = l.by.get('earthworm')!;
    l.control.possess(worm.id, A);
    run(l, 2);
    expect(worm.alarm).toBe(0);
    const at = worm.at;
    const height = worm.height;
    // The water comes from thirty metres east at three metres a second, as the island test floods a bank.
    bank = worm.at.wx + 3000;
    run(l, 3, () => {
      bank! -= 5;
      expect(worm.target).toBeNull();
    });
    expect(worm.waterEdge).toBeGreaterThanOrEqual(0);
    expect(worm.alarm).toBeGreaterThan(0);
    expect(worm.at).toBe(at);
    expect(worm.height).toBe(height);
    expect(l.sim.cost().thoughts).toBe(0);

    // The same flood on a worm nobody holds: its brain flees it.
    const free = lab(['earthworm'], flooded);
    const wild = free.by.get('earthworm')!;
    bank = null;
    run(free, 2);
    const from = wild.at;
    bank = wild.at.wx + 3000;
    run(free, 3, () => { bank! -= 5; });
    expect(wild.alarm).toBeGreaterThan(0);
    expect(wild.behaviour).toBe('flee');
    expect(distance(wild.at, from)).toBeGreaterThan(0);
  });
});

describe('release hands the body back', () => {
  it('the next update thinks, a target appears, and the position is continuous — needs and id untouched', () => {
    const l = lab(['earthworm']);
    const worm = l.by.get('earthworm')!;
    run(l, 1);
    l.control.possess(worm.id, A);
    l.intent = FORWARD;
    run(l, 5);
    const hunger = worm.hunger;
    const fatigue = worm.fatigue;
    const alarm = worm.alarm;
    const at = worm.at;
    const height = worm.height;
    expect(l.control.release(A)).toBe(worm.id);
    l.intent = NEUTRAL_INTENT;
    // The very next update: one thought, from where it stands.
    l.sim.update(FOCUS, DT);
    expect(l.sim.cost().thoughts).toBe(1);
    expect(l.sim.cost().demanded).toBe(0);
    expect(l.sim.counts('earthworm').possessed).toBe(0);
    expect(l.sim.creature(worm.id)).toBe(worm);
    expect(distance(worm.at, at)).toBeLessThanOrEqual(planeBound(worm, EARTHWORM));
    expect(Math.abs(worm.height - height)).toBeLessThan(1);
    // Needs are the body's and travel with it: nothing was reset to the spawn's values.
    expect(worm.hunger).toBeCloseTo(hunger, 2);
    expect(worm.fatigue).toBeCloseTo(fatigue, 2);
    expect(worm.alarm).toBeCloseTo(alarm, 2);
    let targeted = false;
    let last = worm.at;
    run(l, 10, () => {
      if (worm.target !== null) targeted = true;
      expect(distance(worm.at, last)).toBeLessThanOrEqual(planeBound(worm, EARTHWORM));
      last = worm.at;
    });
    expect(targeted).toBe(true);
  });

  it('a swap releases the first as it takes the second; clear releases everyone; a released fly stays in the air until its brain lands it', () => {
    const l = lab();
    const worker = l.by.get('worker')!;
    const fly = l.by.get('housefly')!;
    run(l, 1);
    l.control.possess(worker.id, A);
    l.intent = FORWARD;
    run(l, 1);
    expect(l.sim.counts('worker').possessed).toBe(1);
    // Fly it: take off, then a second of forward in the air.
    l.control.possess(fly.id, A);
    l.intent = { forward: 0, strafe: 0, turn: 0, sprint: false, vertical: 1 };
    run(l, 0.5);
    expect(l.sim.counts('worker').possessed).toBe(0);
    expect(l.sim.counts('housefly').possessed).toBe(1);
    expect(worker.target).toBeNull();
    const ground = l.world.groundAt(fly.at);
    expect(fly.height).toBeGreaterThan(ground + 1);
    expect(['takeoff', 'fly']).toContain(fly.behaviour);
    l.intent = FORWARD;
    run(l, 1);
    expect(fly.behaviour).toBe('fly');
    const aloft = fly.height;
    l.control.clear();
    l.sim.update(FOCUS, DT);
    expect(totalPossessed(l.sim)).toBe(0);
    // Handed back in the air: nothing drops it to the ground in a frame, and
    // the brain — which thought on this very update — took it over in an
    // air word with a height of its own choosing, not the player's.
    expect(Math.abs(fly.height - aloft)).toBeLessThan(unitsOfMm(HOUSEFLY.flight!.climbMmS) * DT + 1e-6);
    expect(['fly', 'hover', 'land']).toContain(fly.behaviour);
    expect(Number.isFinite(fly.targetHeight)).toBe(true);
    expect(fly.sinceThink).toBeLessThan(HOUSEFLY.thinkS);
    let thoughts = 0;
    run(l, 3, () => { thoughts += l.sim.cost().thoughts; });
    expect(thoughts).toBeGreaterThan(5);
  });
});

describe('the Lab\'s brief: one player, five bodies, a hundred switches', () => {
  it('actor ids and objects are stable across 100 possess/release cycles, exactly one is held, nothing duplicates, nothing teleports', () => {
    const l = lab();
    const ids = LAB_CREATURE_IDS.map((id) => l.by.get(id)!.id);
    const objects = new Map(LAB_CREATURE_IDS.map((id) => [id, l.by.get(id)!]));
    run(l, 1);
    const positions = new Map<string, WorldPoint>();
    for (const c of l.sim.creatures()) positions.set(c.id, c.at);
    for (let i = 0; i < 100; i += 1) {
      const next = ids[i % ids.length];
      const previous = i === 0 ? null : ids[(i - 1) % ids.length];
      l.control.possess(next, A);
      l.intent = i % 3 === 0 ? FORWARD : NEUTRAL_INTENT;
      run(l, 0.2, () => {
        expect(l.sim.creatures()).toHaveLength(5);
        expect(totalPossessed(l.sim)).toBe(1);
        for (const c of l.sim.creatures()) {
          const species = CREATURE_SPECIES[c.species];
          expect(distance(c.at, positions.get(c.id)!), `${c.id} jumped`).toBeLessThanOrEqual(planeBound(c, species));
          positions.set(c.id, c.at);
        }
      });
      const held = l.sim.creature(next)!;
      expect(held).toBe(objects.get(held.species));
      expect(held.tier).toBe('full');
      expect(held.target).toBeNull();
      expect(l.sim.counts(held.species).possessed).toBe(1);
      if (previous !== null) {
        const released = l.sim.creature(previous)!;
        expect(released).toBe(objects.get(released.species));
        expect(l.sim.counts(released.species).possessed).toBe(0);
      }
    }
    for (const id of LAB_CREATURE_IDS) expect(l.sim.creature(l.by.get(id)!.id)).toBe(objects.get(id));
    expect(new Set(l.sim.creatures().map((c) => c.id)).size).toBe(5);
    // Two players may hold two bodies; the sim counts both and drives both.
    l.control.possess(ids[1], B);
    l.intent = FORWARD;
    run(l, 0.5);
    expect(totalPossessed(l.sim)).toBe(2);
    expect(l.sim.cost().demanded).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The player's helpers
// ---------------------------------------------------------------------------

const AXES = [-1, 0, 1] as const;
const FLAGS = [false, true] as const;

/** Every corner of the intent: three axes cubed, a vertical, three toggles — 648 requests. */
function corners(): Intent[] {
  const out: Intent[] = [];
  for (const forward of AXES) for (const strafe of AXES) for (const turn of AXES) for (const vertical of AXES) {
    for (const sprint of FLAGS) for (const primary of FLAGS) for (const secondary of FLAGS) {
      out.push({ forward, strafe, turn, sprint, vertical, primary, secondary });
    }
  }
  return out;
}

function creature(species: CreatureId, at: WorldPoint, height: number, extra: Partial<NewCreatureOptions> = {}): CreatureState {
  return newCreature({ id: `${species}:0,0:9`, species, cellKey: '0,0', at, height, heading: 0, phase: 0, ...extra });
}

/** The bodies each species can be in: on the ground, in the air, under it, at food, on a host, tired. */
function bodies(species: CreatureSpecies, w: LabWorld): CreatureState[] {
  const id = species.id;
  const open = world(-40, 10);
  const g = w.groundAt(open);
  const out: CreatureState[] = [creature(id, open, g), creature(id, open, g, { fatigue: 1 }), creature(id, open, g, { hunger: 1 })];
  if (species.flight !== null) {
    out.push(creature(id, open, g + 10), creature(id, open, g + 0.05), creature(id, open, g + 60));
  }
  if (species.burrow !== null) {
    out.push(creature(id, LITTER_CORNER, g - unitsOfMm(species.burrow.underMm) / 2), creature(id, LITTER_CORNER, g - unitsOfMm(species.burrow.underMm)));
    out.push(creature(id, open, g - unitsOfMm(species.burrow.boreMm) / 4));
  }
  out.push(creature(id, PROTEIN_SPOT, w.groundAt(PROTEIN_SPOT)));
  out.push(creature(id, LAB_PLANTS[1].at, w.groundAt(LAB_PLANTS[1].at)));
  out.push(creature(id, LAB_PLANTS[2].at, w.groundAt(LAB_PLANTS[2].at) + 7, { hostId: LAB_PLANTS[2].id }));
  out.push(creature(id, world(NaN, 0), NaN));
  return out;
}

describe('wordFor', () => {
  it('is a word the species may use for every species, every body and every corner of the intent', () => {
    const w = createLabWorld();
    const all = corners();
    expect(all).toHaveLength(648);
    let checked = 0;
    for (const species of LAB_SPECIES) {
      for (const body of bodies(species, w)) {
        const host = body.hostId === null ? null : LAB_PLANTS[2];
        for (const intent of all) {
          const word = wordFor(body, species, intent, w, host);
          expect(behaviourAllowedFor(species, word), `${species.id} ${word} for ${JSON.stringify(intent)}`).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(5 * 6 * 648);
  });

  it('the ground words: moving → wander, sprint → flee, a turn in place is moving, still → idle, tired and still → rest, and a vertical is ignored without wings', () => {
    const w = createLabWorld();
    const at = world(-40, 10);
    const worker = creature('worker', at, w.groundAt(at));
    expect(wordFor(worker, WORKER, FORWARD, w)).toBe('wander');
    expect(wordFor(worker, WORKER, { ...FORWARD, strafe: 1, forward: 0 }, w)).toBe('wander');
    expect(wordFor(worker, WORKER, { forward: 0, strafe: 0, turn: -1, sprint: false }, w)).toBe('wander');
    expect(wordFor(worker, WORKER, { ...FORWARD, sprint: true }, w)).toBe('flee');
    expect(wordFor(worker, WORKER, { ...NEUTRAL_INTENT, sprint: true }, w)).toBe('idle');
    expect(wordFor(worker, WORKER, NEUTRAL_INTENT, w)).toBe('idle');
    expect(wordFor(worker, WORKER, { ...NEUTRAL_INTENT, vertical: 1 }, w)).toBe('idle');
    expect(wordFor(worker, WORKER, { ...NEUTRAL_INTENT, vertical: -1 }, w)).toBe('idle');
    expect(wordFor(worker, WORKER, { ...NEUTRAL_INTENT, primary: true }, w)).toBe('idle');
    const tired = creature('worker', at, w.groundAt(at), { fatigue: WORKER.needs.restAt });
    expect(wordFor(tired, WORKER, NEUTRAL_INTENT, w)).toBe('rest');
    expect(wordFor(tired, WORKER, FORWARD, w)).toBe('wander');
  });

  it('feed: primary held, standing, at a site of a kind it eats — or on its host — and nowhere else', () => {
    const w = createLabWorld();
    const primary: Intent = { ...NEUTRAL_INTENT, primary: true };
    const carrion = LAB_SITES.find((s) => s.kind === 'carrion')!;
    const nectar = LAB_SITES.find((s) => s.kind === 'nectar')!;
    const litter = LAB_SITES.find((s) => s.kind === 'litter')!;
    expect(WORKER.needs.eats).toContain('carrion');
    const worker = creature('worker', carrion.at, w.groundAt(carrion.at));
    expect(wordFor(worker, WORKER, primary, w)).toBe('feed');
    expect(wordFor(worker, WORKER, { ...primary, forward: 1 }, w)).toBe('wander');
    const body = unitsOfMm(WORKER.lengthMm);
    const near = creature('worker', world(carrion.at.wx + body * 0.9, carrion.at.wz), w.groundAt(carrion.at));
    expect(wordFor(near, WORKER, primary, w)).toBe('feed');
    const off = creature('worker', world(carrion.at.wx + body * 1.5, carrion.at.wz), w.groundAt(carrion.at));
    expect(wordFor(off, WORKER, primary, w)).toBe('idle');
    // The queen eats sugars, not carrion: the protein spot is nothing to her, the flower is.
    expect(QUEEN.needs.eats).not.toContain('carrion');
    expect(wordFor(creature('queen', carrion.at, w.groundAt(carrion.at)), QUEEN, primary, w)).toBe('idle');
    expect(wordFor(creature('queen', nectar.at, w.groundAt(nectar.at)), QUEEN, primary, w)).toBe('feed');
    // The worm at the litter, on the surface, and the litter is a body length wide to a 15 cm animal.
    const worm = creature('earthworm', litter.at, w.groundAt(litter.at));
    expect(wordFor(worm, EARTHWORM, primary, w)).toBe('feed');
    expect(wordFor(creature('earthworm', world(0, 30), w.groundAt(world(0, 30))), EARTHWORM, primary, w)).toBe('surface');
    // The aphid on its host feeds wherever it sits on the plant; off it, nothing.
    const broadleaf = LAB_PLANTS[2];
    const aphid = creature('aphid', world(broadleaf.at.wx + 1, broadleaf.at.wz), w.groundAt(broadleaf.at) + 5, { hostId: broadleaf.id });
    expect(wordFor(aphid, APHID, primary, w, broadleaf)).toBe('feed');
    const away = creature('aphid', world(broadleaf.at.wx + broadleaf.size + 1, broadleaf.at.wz), w.groundAt(broadleaf.at), { hostId: broadleaf.id });
    expect(wordFor(away, APHID, primary, w, broadleaf)).toBe('idle');
    expect(wordFor(away, APHID, NEUTRAL_INTENT, w, broadleaf)).toBe('idle');
    // A fly on the flower's head: nectar is what it is drawn to; whether it eats it is the table's.
    const fly = creature('housefly', nectar.at, w.groundAt(nectar.at));
    expect(wordFor(fly, HOUSEFLY, primary, w)).toBe(HOUSEFLY.needs.eats.includes('nectar') ? 'feed' : 'idle');
  });

  it('the air words: vertical up on the ground → takeoff; aloft, moving → fly, still → hover, descending or secondary → land — for the fly and the winged queen, never the worker', () => {
    const w = createLabWorld();
    const at = world(-40, 10);
    const g = w.groundAt(at);
    for (const species of [HOUSEFLY, QUEEN]) {
      const id = species.id;
      const down = creature(id, at, g);
      expect(wordFor(down, species, { ...NEUTRAL_INTENT, vertical: 1 }, w)).toBe('takeoff');
      expect(wordFor(down, species, { ...FORWARD, vertical: 1 }, w)).toBe('takeoff');
      expect(wordFor(down, species, FORWARD, w)).toBe('wander');
      expect(wordFor(down, species, { ...NEUTRAL_INTENT, secondary: true }, w)).toBe('idle');
      const up = creature(id, at, g + 20);
      expect(wordFor(up, species, FORWARD, w)).toBe('fly');
      expect(wordFor(up, species, { ...NEUTRAL_INTENT, vertical: 1 }, w)).toBe('fly');
      expect(wordFor(up, species, { ...NEUTRAL_INTENT, turn: 1 }, w)).toBe('fly');
      expect(wordFor(up, species, NEUTRAL_INTENT, w)).toBe('hover');
      expect(wordFor(up, species, { ...NEUTRAL_INTENT, vertical: -1 }, w)).toBe('land');
      expect(wordFor(up, species, { ...FORWARD, vertical: -1 }, w)).toBe('land');
      expect(wordFor(up, species, { ...NEUTRAL_INTENT, secondary: true }, w)).toBe('land');
      // A hair above the ground is aloft; a body exactly on it is not.
      expect(wordFor(creature(id, at, g + 1e-6), species, NEUTRAL_INTENT, w)).toBe('hover');
      expect(wordFor(creature(id, at, g), species, NEUTRAL_INTENT, w)).toBe('idle');
    }
    // Over the puddle a fly held at the water's surface is over the water, not on it: it stays in the air's words.
    const puddle = world(-40, -40);
    const overWater = creature('housefly', puddle, w.groundAt(puddle) + w.water.freshDepthAt(puddle));
    expect(w.water.freshDepthAt(puddle)).toBeGreaterThan(0);
    expect(wordFor(overWater, HOUSEFLY, NEUTRAL_INTENT, w)).toBe('hover');
    expect(wordFor(overWater, HOUSEFLY, { ...NEUTRAL_INTENT, vertical: -1 }, w)).toBe('land');
    const worker = creature('worker', at, g + 20);
    expect(wordFor(worker, WORKER, FORWARD, w)).toBe('wander');
    expect(wordFor(worker, WORKER, { ...NEUTRAL_INTENT, vertical: 1 }, w)).toBe('idle');
  });

  it('the soil words: vertical down → burrow, up → surface; moving under → burrow; at the surface → surface, moving or not; sprint → flee; still under → idle', () => {
    const w = createLabWorld();
    const at = world(20, 20);
    const g = w.groundAt(at);
    const top = g - unitsOfMm(EARTHWORM.burrow!.boreMm) / 2;
    const under = creature('earthworm', at, g - unitsOfMm(EARTHWORM.burrow!.underMm) / 2);
    expect(wordFor(under, EARTHWORM, { ...NEUTRAL_INTENT, vertical: -1 }, w)).toBe('burrow');
    expect(wordFor(under, EARTHWORM, { ...NEUTRAL_INTENT, vertical: 1 }, w)).toBe('surface');
    expect(wordFor(under, EARTHWORM, { ...FORWARD, vertical: 1 }, w)).toBe('surface');
    expect(wordFor(under, EARTHWORM, FORWARD, w)).toBe('burrow');
    expect(wordFor(under, EARTHWORM, { ...FORWARD, strafe: 1 }, w)).toBe('burrow');
    expect(wordFor(under, EARTHWORM, { ...FORWARD, sprint: true }, w)).toBe('flee');
    expect(wordFor(under, EARTHWORM, NEUTRAL_INTENT, w)).toBe('idle');
    expect(wordFor(under, EARTHWORM, { ...NEUTRAL_INTENT, primary: true }, w)).toBe('idle');
    expect(wordFor(creature('earthworm', at, g, { fatigue: 1 }), EARTHWORM, NEUTRAL_INTENT, w)).toBe('surface');
    expect(wordFor(creature('earthworm', at, top - 1e-3, { fatigue: 1 }), EARTHWORM, NEUTRAL_INTENT, w)).toBe('rest');
    const surfaced = creature('earthworm', at, g);
    expect(wordFor(surfaced, EARTHWORM, NEUTRAL_INTENT, w)).toBe('surface');
    expect(wordFor(surfaced, EARTHWORM, FORWARD, w)).toBe('surface');
    expect(wordFor(surfaced, EARTHWORM, { ...FORWARD, sprint: true }, w)).toBe('flee');
    expect(wordFor(creature('earthworm', at, top + 1e-3), EARTHWORM, NEUTRAL_INTENT, w)).toBe('surface');
    expect(wordFor(creature('earthworm', at, top), EARTHWORM, NEUTRAL_INTENT, w)).toBe('idle');
  });

  it('the plant words: secondary → flee (the drop), whatever else is held; moving → wander; still → idle', () => {
    const w = createLabWorld();
    const broadleaf = LAB_PLANTS[2];
    const aphid = creature('aphid', broadleaf.at, w.groundAt(broadleaf.at) + 7, { hostId: broadleaf.id });
    expect(wordFor(aphid, APHID, { ...NEUTRAL_INTENT, secondary: true }, w, broadleaf)).toBe('flee');
    expect(wordFor(aphid, APHID, { ...FORWARD, secondary: true }, w, broadleaf)).toBe('flee');
    expect(wordFor(aphid, APHID, { ...NEUTRAL_INTENT, primary: true, secondary: true }, w, broadleaf)).toBe('feed');
    expect(wordFor(aphid, APHID, FORWARD, w, broadleaf)).toBe('wander');
    expect(wordFor(aphid, APHID, { ...FORWARD, sprint: true }, w, broadleaf)).toBe('flee');
    expect(wordFor(aphid, APHID, NEUTRAL_INTENT, w, broadleaf)).toBe('idle');
    expect(wordFor(aphid, APHID, { ...NEUTRAL_INTENT, vertical: 1 }, w, broadleaf)).toBe('idle');
  });

  it('a body over ground the world cannot price falls back to the word it is in, and never NaNs', () => {
    const w = createLabWorld();
    const lost = creature('housefly', world(NaN, 0), NaN, { behaviour: 'fly' });
    expect(wordFor(lost, HOUSEFLY, FORWARD, w)).toBe('fly');
    const grounded = creature('housefly', world(NaN, 0), NaN, { behaviour: 'idle' });
    expect(wordFor(grounded, HOUSEFLY, FORWARD, w)).toBe('wander');
    const worm = creature('earthworm', world(NaN, 0), NaN);
    expect(wordFor(worm, EARTHWORM, FORWARD, w)).toBe('burrow');
    expect(wordFor(worm, EARTHWORM, NEUTRAL_INTENT, w)).toBe('idle');
  });
});

describe('playerDemand', () => {
  it('copies the request through, bounded, into the one object it is given, and returns that object', () => {
    const w = createLabWorld();
    const out = newMutableIntent();
    const at = world(-40, 10);
    const worker = creature('worker', at, w.groundAt(at));
    const got = playerDemand(worker, WORKER, { forward: 2, strafe: -3, turn: NaN, sprint: true, vertical: 0.5, primary: true }, w, out);
    expect(got).toBe(out);
    expect(out).toEqual({ forward: 1, strafe: -1, turn: 0, sprint: true, vertical: 0.5, primary: true, secondary: false });
    // Reused: the next request overwrites every field, absent toggles included.
    playerDemand(worker, WORKER, { forward: 0, strafe: 0, turn: 0, sprint: false }, w, out);
    expect(out).toEqual({ forward: 0, strafe: 0, turn: 0, sprint: false, vertical: 0, primary: false, secondary: false });
  });

  it('a plant body: secondary is the drop (vertical −1); off its host with no request it comes down; on its host it holds', () => {
    const w = createLabWorld();
    const out = newMutableIntent();
    const broadleaf = LAB_PLANTS[2];
    const g = w.groundAt(broadleaf.at);
    const on = creature('aphid', broadleaf.at, g + 7, { hostId: broadleaf.id });
    expect(playerDemand(on, APHID, NEUTRAL_INTENT, w, out, broadleaf).vertical).toBe(0);
    expect(playerDemand(on, APHID, { ...NEUTRAL_INTENT, vertical: 1 }, w, out, broadleaf).vertical).toBe(1);
    expect(playerDemand(on, APHID, { ...NEUTRAL_INTENT, secondary: true }, w, out, broadleaf).vertical).toBe(-1);
    expect(playerDemand(on, APHID, { ...NEUTRAL_INTENT, secondary: true, vertical: 1 }, w, out, broadleaf).vertical).toBe(-1);
    const off = creature('aphid', world(broadleaf.at.wx + broadleaf.size + 1, broadleaf.at.wz), g + 7, { hostId: broadleaf.id });
    expect(playerDemand(off, APHID, NEUTRAL_INTENT, w, out, broadleaf).vertical).toBe(-1);
    expect(playerDemand(off, APHID, { ...NEUTRAL_INTENT, vertical: 1 }, w, out, broadleaf).vertical).toBe(1);
    // No host known: nothing to stand on but the ground.
    expect(playerDemand(on, APHID, NEUTRAL_INTENT, w, out).vertical).toBe(-1);
  });

  it('a winged body: secondary aloft is a descent; on the ground it is nothing; the worker\'s secondary is nothing anywhere', () => {
    const w = createLabWorld();
    const out = newMutableIntent();
    const at = world(-40, 10);
    const g = w.groundAt(at);
    const secondary: Intent = { ...NEUTRAL_INTENT, secondary: true };
    for (const species of [HOUSEFLY, QUEEN]) {
      expect(playerDemand(creature(species.id, at, g + 20), species, secondary, w, out).vertical).toBe(-1);
      expect(playerDemand(creature(species.id, at, g + 20), species, { ...secondary, vertical: 1 }, w, out).vertical).toBe(-1);
      expect(playerDemand(creature(species.id, at, g), species, secondary, w, out).vertical).toBe(0);
      expect(playerDemand(creature(species.id, at, g), species, { ...secondary, vertical: 1 }, w, out).vertical).toBe(1);
    }
    expect(playerDemand(creature('worker', at, g + 20), WORKER, secondary, w, out).vertical).toBe(0);
    expect(playerDemand(creature('earthworm', at, g - 1), EARTHWORM, secondary, w, out).vertical).toBe(0);
    expect(out.secondary).toBe(true);
  });

  it('through the sim: a possessed aphid drops on secondary and a possessed fly lands on it', () => {
    const l = lab(['aphid', 'housefly']);
    const aphid = l.by.get('aphid')!;
    const fly = l.by.get('housefly')!;
    run(l, 0.5);
    l.control.possess(aphid.id, A);
    const perched = aphid.height;
    const ground = l.world.groundAt(aphid.at);
    expect(perched).toBeGreaterThan(ground);
    l.intent = { ...NEUTRAL_INTENT, secondary: true };
    run(l, 0.5);
    expect(aphid.behaviour).toBe('flee');
    expect(aphid.height).toBeLessThan(perched);
    expect(aphid.height).toBeGreaterThanOrEqual(ground);
    expect(aphid.hostId).not.toBeNull();

    l.control.possess(fly.id, A);
    l.intent = { ...NEUTRAL_INTENT, vertical: 1 };
    run(l, 1);
    const flyGround = l.world.groundAt(fly.at);
    expect(fly.height).toBeGreaterThan(flyGround + 5);
    l.intent = { ...NEUTRAL_INTENT, secondary: true };
    let landed = false;
    run(l, 5, () => {
      if (fly.height <= flyGround + 1e-9) landed = true;
    });
    expect(landed).toBe(true);
    expect(fly.behaviour).toBe('idle');
  });
});

describe('the block and the box are the world\'s, not the possession\'s', () => {
  it('a possessed queen walked onto the block top stands on it — the ground rule, as it is for the AI', () => {
    const l = lab(['queen']);
    const queen = l.by.get('queen')!;
    l.control.possess(queen.id, A);
    // She spawns east of the block facing it (heading −π/2: ahead is −X).
    expect(queen.heading).toBeCloseTo(-Math.PI / 2, 9);
    l.intent = FORWARD;
    let onTop = false;
    run(l, 10, () => {
      if (Math.abs(queen.at.wx) <= BLOCK.size / 2 && Math.abs(queen.at.wz) <= BLOCK.size / 2) {
        onTop = true;
        expect(queen.height).toBe(l.world.groundAt(queen.at));
      }
    });
    expect(onTop).toBe(true);
    expect(queen.behaviour).toBe('wander');
  });
});
