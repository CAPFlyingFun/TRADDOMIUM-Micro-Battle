/**
 * The simulation: cells stream in nearest first, a few a frame, and out
 * beyond the reach; the cap is a maximum and keeps the nearest; tiers
 * follow distance; thinking is throttled and phased; the only door to
 * the ground is the gate and only the worm reaches it; `dt` is taken as
 * given; a thousand seconds is finite; the state round-trips JSON.
 */
import { describe, expect, it } from 'vitest';
import {
  APHID, CREATURE_IDS, CREATURE_SPECIES, EARTHWORM, HOUSEFLY, NO_BURROW_EDITOR, unitsOfMm,
  type BurrowEditor, type CreatureId, type CreatureSpecies, type CreatureState, type CreatureWeather, type CreatureWorld,
  type Disturbance,
} from '../src/creatures';
import { CELLS_PER_UPDATE, CreatureSim, EVICT_BEYOND, KEEP_HYSTERESIS, NEAR_STEP_S } from '../src/creatures/CreatureSim';
import { distance, world, type WorldPoint } from '../src/world/coords';
import type { PlantSource } from '../src/world/ecology/resources';
import { SEA_HABITAT, type Habitat, type HabitatKind } from '../src/world/habitat';
import { CELL_SPAN, cellAt, cellOrigin, cellsWithin } from '../src/world/objects/cells';
import type { SoilPoint } from '../src/world/soilTypes';

function habitat(kind: HabitatKind, elevation: number): Habitat {
  return {
    kind, forest: 0, grass: 0, shrub: 0, bare: 0, wet: 0, lake: 0, coast: 0, exposure: 0,
    elevation, slopeDegrees: 0, coastDistance: 10_000, channel: false, rainfallMmYear: null,
  };
}

const ground = (at: WorldPoint): number => 300 + Math.sin(at.wx / 900) * 12 + Math.cos(at.wz / 700) * 9;

function shrubs(cx: number, cz: number): PlantSource[] {
  const o = cellOrigin({ cx, cz });
  const out: PlantSource[] = [];
  for (let i = 0; i < 6; i += 1) {
    out.push({ family: 'shrub', at: world(o.wx + 200 + (i % 3) * 500, o.wz + 300 + Math.floor(i / 3) * 700), size: 40, id: `shrub:${cx},${cz}:${i}`, variant: 0 });
  }
  return out;
}

interface Fake extends CreatureWorld {
  kind: HabitatKind;
  sky: CreatureWeather | null;
  list: Disturbance[];
  plantsReady: boolean;
}

function fakeWorld(kind: HabitatKind = 'shrubland'): Fake {
  const w: Fake = {
    kind,
    sky: null,
    list: [],
    plantsReady: true,
    groundAt: ground,
    normalAt: () => ({ nx: 0, ny: 1, nz: 0 }),
    habitatAt: (at) => (w.kind === 'sea' ? SEA_HABITAT : habitat(w.kind, ground(at))),
    plantsOf: (cx, cz) => (w.plantsReady ? shrubs(cx, cz) : null),
    resourcesOf: () => null,
    water: null,
    weather: () => w.sky,
    disturbances: () => w.list,
  };
  return w;
}

const FOCUS = world(5 * CELL_SPAN + 700, 3 * CELL_SPAN + 900);

/** Run the streamer until every cell in reach is generated. */
function settle(sim: CreatureSim, focus: WorldPoint, updates = 200): void {
  for (let i = 0; i < updates; i += 1) sim.update(focus, 0);
}

function finite(c: CreatureState): void {
  for (const v of [c.at.wx, c.at.wz, c.height, c.heading, c.pitch, c.targetHeight, c.hunger, c.fatigue, c.alarm, c.behaviourS, c.behaviourUntilS, c.sinceThink]) {
    if (!Number.isFinite(v)) throw new Error(`${c.id} has a non-finite field: ${JSON.stringify(c)}`);
  }
}

describe('streaming', () => {
  it('generates at most two cells an update, nearest first, until every cell in each reach is resident', () => {
    const sim = new CreatureSim({ world: fakeWorld(), seed: 3 });
    sim.update(FOCUS, 0);
    const first = CREATURE_IDS.reduce((n, id) => n + sim.cellCount(id), 0);
    expect(first).toBeLessThanOrEqual(CELLS_PER_UPDATE);
    // The focus cell was the first generated, for the first species.
    expect(sim.cellCount('earthworm')).toBe(1);
    settle(sim, FOCUS);
    for (const id of CREATURE_IDS) {
      const reach = unitsOfMm(CREATURE_SPECIES[id].population.reachM * 1000);
      expect(sim.cellCount(id), id).toBe(cellsWithin(FOCUS, reach).length);
      expect(sim.pendingCells(id)).toBe(0);
    }
    expect(sim.counts('earthworm').resident).toBeGreaterThan(0);
  });

  it('evicts cells beyond a reach and a quarter when the focus moves, and forgets nothing: the same cell comes back identical', () => {
    const sim = new CreatureSim({ world: fakeWorld(), seed: 3 });
    settle(sim, FOCUS);
    const before = sim.creatures().filter((c) => c.species === 'earthworm').map((c) => ({ id: c.id, at: c.at }));
    const reach = unitsOfMm(EARTHWORM.population.reachM * 1000);
    const far = world(FOCUS.wx + reach * (EVICT_BEYOND + 2), FOCUS.wz);
    settle(sim, far);
    const kept = sim.creatures().filter((c) => c.species === 'earthworm');
    for (const c of kept) expect(distance(c.at, far)).toBeLessThan(reach * EVICT_BEYOND + CELL_SPAN * 1.5);
    expect(sim.cellCount('earthworm')).toBe(cellsWithin(far, reach).length);
    settle(sim, FOCUS);
    const again = sim.creatures().filter((c) => c.species === 'earthworm').map((c) => ({ id: c.id, at: c.at }));
    expect(again).toEqual(before);
  });

  it('a host species waits for its cell\'s plants rather than generating an empty cell', () => {
    const w = fakeWorld();
    w.plantsReady = false;
    const sim = new CreatureSim({ world: w, seed: 3 });
    settle(sim, FOCUS);
    expect(sim.cellCount('aphid')).toBe(0);
    expect(sim.pendingCells('aphid')).toBeGreaterThan(0);
    expect(sim.cellCount('earthworm')).toBeGreaterThan(0);
    w.plantsReady = true;
    // Asked again after a second of simulated time.
    for (let i = 0; i < 300; i += 1) sim.update(FOCUS, 1 / 60);
    expect(sim.cellCount('aphid')).toBeGreaterThan(0);
    expect(sim.counts('aphid').resident).toBeGreaterThan(0);
  });

  it('a species switched off drops its residents and generates nothing; switched on again it comes back the same', () => {
    const sim = new CreatureSim({ world: fakeWorld(), seed: 3 });
    settle(sim, FOCUS);
    const ids = sim.creatures().filter((c) => c.species === 'housefly').map((c) => c.id).sort();
    expect(ids.length).toBeGreaterThan(0);
    sim.setEnabled('housefly', false);
    settle(sim, FOCUS);
    expect(sim.isEnabled('housefly')).toBe(false);
    expect(sim.counts('housefly').resident).toBe(0);
    expect(sim.generated('housefly')).toBe(0);
    expect(sim.creatures().some((c) => c.species === 'housefly')).toBe(false);
    expect(sim.creatures().some((c) => c.species === 'aphid')).toBe(true);
    sim.setEnabled('housefly', true);
    settle(sim, FOCUS);
    expect(sim.creatures().filter((c) => c.species === 'housefly').map((c) => c.id).sort()).toEqual(ids);
  });
});

describe('caps and tiers', () => {
  it('a cap is a maximum: a sparse habitat yields fewer; a dense one yields exactly the cap, the nearest', () => {
    const sparse = new CreatureSim({ world: fakeWorld('ridge'), seed: 3, rung: 'high' });
    settle(sparse, FOCUS);
    expect(sparse.counts('earthworm').cap).toBe(EARTHWORM.population.caps.high);
    expect(sparse.counts('earthworm').resident).toBeLessThan(EARTHWORM.population.caps.high);
    expect(sparse.counts('earthworm').resident).toBe(sparse.generated('earthworm'));

    const dense = new CreatureSim({ world: fakeWorld('wetland'), seed: 3, rung: 'low' });
    settle(dense, FOCUS);
    const cap = EARTHWORM.population.caps.low;
    expect(dense.generated('earthworm')).toBeGreaterThan(cap);
    expect(dense.counts('earthworm').resident).toBe(cap);
    const kept = dense.creatures().filter((c) => c.species === 'earthworm');
    expect(kept).toHaveLength(cap);
    const farthestKept = Math.max(...kept.map((c) => distance(c.at, FOCUS)));
    // The kept set is the nearest, up to the anti-flicker margin: no unkept worm is
    // nearer than the farthest kept one by more than the hysteresis. Seen through
    // the wider rung, which keeps everything.
    const keptIds = new Set(kept.map((c) => c.id));
    dense.setRung('ultra-high');
    settle(dense, FOCUS);
    const wider = dense.creatures().filter((c) => c.species === 'earthworm');
    let nearerUnkept = 0;
    for (const c of wider) if (!keptIds.has(c.id) && distance(c.at, FOCUS) < farthestKept * KEEP_HYSTERESIS) nearerUnkept += 1;
    expect(nearerUnkept).toBe(0);
    expect(wider.length).toBeGreaterThan(cap);
    expect(wider.length).toBeLessThanOrEqual(EARTHWORM.population.caps['ultra-high']);
    // An unknown rung reads as medium.
    dense.setRung('nonsense');
    expect(dense.counts('earthworm').cap).toBe(EARTHWORM.population.caps.medium);
  });

  it('tiers follow distance: full inside fullM, near inside nearM, far beyond; the counts add up', () => {
    const sim = new CreatureSim({ world: fakeWorld('wetland'), seed: 3, rung: 'ultra-high' });
    settle(sim, FOCUS);
    for (const id of CREATURE_IDS) {
      const species = CREATURE_SPECIES[id];
      const full = unitsOfMm(species.population.fullM * 1000);
      const near = unitsOfMm(species.population.nearM * 1000);
      const counts = sim.counts(id);
      expect(counts.byTier.far + counts.byTier.near + counts.byTier.full).toBe(counts.resident);
      for (const c of sim.creatures().filter((x) => x.species === id)) {
        const d = distance(c.at, FOCUS);
        if (d < full) expect(c.tier, `${c.id} at ${d}`).toBe('full');
        else if (d < near) expect(c.tier, `${c.id} at ${d}`).toBe('near');
        else expect(c.tier, `${c.id} at ${d}`).toBe('far');
      }
    }
    // The far tier is not empty in this world, so the far rule was exercised.
    expect(sim.counts('housefly').byTier.far).toBeGreaterThan(0);
  });
});

/** The three species with the tiers pulled in to the reach: everything kept is full. */
function allFull(species: readonly CreatureSpecies[]): CreatureSpecies[] {
  return species.map((s) => ({ ...s, population: { ...s.population, nearM: s.population.reachM, fullM: s.population.reachM } }));
}

describe('thinking is throttled', () => {
  it('a full-tier creature thinks about 10/thinkS times in ten seconds; far creatures think not at all', () => {
    // One aphid, kept: a cap of one at every rung.
    const lone: CreatureSpecies = {
      ...APHID,
      population: { ...APHID.population, nearM: APHID.population.reachM, fullM: APHID.population.reachM, caps: { 'ultra-low': 1, low: 1, medium: 1, high: 1, 'ultra-high': 1 } },
    };
    const sim = new CreatureSim({ world: fakeWorld(), seed: 3, species: [lone] });
    settle(sim, FOCUS);
    expect(sim.counts('aphid').resident).toBe(1);
    let thoughts = 0;
    for (let i = 0; i < 600; i += 1) {
      sim.update(FOCUS, 1 / 60);
      thoughts += sim.cost().thoughts;
    }
    expect(Math.abs(thoughts - 10 / APHID.thinkS)).toBeLessThanOrEqual(1);

    const farOnly: CreatureSpecies = { ...APHID, population: { ...APHID.population, nearM: 1, fullM: 1 } };
    const farSim = new CreatureSim({ world: fakeWorld(), seed: 3, species: [farOnly], rung: 'ultra-high' });
    const away = world(FOCUS.wx + 900, FOCUS.wz + 900);
    settle(farSim, away);
    const near = farSim.creatures().filter((c) => distance(c.at, away) < 100);
    expect(near).toHaveLength(0);
    expect(farSim.counts('aphid').resident).toBeGreaterThan(0);
    let farThoughts = 0;
    for (let i = 0; i < 600; i += 1) {
      farSim.update(away, 1 / 60);
      farThoughts += farSim.cost().thoughts;
    }
    expect(farThoughts).toBe(0);
  });

  it('phases spread the thoughts across frames: no frame carries more than a fraction of the creatures', () => {
    const sim = new CreatureSim({ world: fakeWorld('wetland'), seed: 3, species: allFull([EARTHWORM]), rung: 'ultra-high' });
    settle(sim, FOCUS);
    const n = sim.counts('earthworm').resident;
    expect(n).toBeGreaterThan(20);
    let peak = 0;
    let total = 0;
    for (let i = 0; i < 60; i += 1) {
      sim.update(FOCUS, 1 / 60);
      peak = Math.max(peak, sim.cost().thoughts);
      total += sim.cost().thoughts;
    }
    // One second at thinkS = 0.5: each thought twice, spread over sixty frames.
    expect(total).toBeGreaterThanOrEqual(n);
    expect(peak).toBeLessThan(n / 2);
  });

  it('the near tier moves at ten hertz with dt accumulated: distance is conserved against the full tier', () => {
    const nearSpecies: CreatureSpecies = { ...HOUSEFLY, population: { ...HOUSEFLY.population, nearM: HOUSEFLY.population.reachM, fullM: 1 } };
    const w = fakeWorld();
    const sim = new CreatureSim({ world: w, seed: 3, species: [nearSpecies], rung: 'ultra-high' });
    settle(sim, FOCUS);
    const flies = sim.creatures();
    expect(flies.every((c) => c.tier === 'near')).toBe(true);
    const clocks = flies.map((c) => c.behaviourS);
    let moves = 0;
    for (let i = 0; i < 60; i += 1) {
      sim.update(FOCUS, 1 / 60);
      if (flies[0].behaviourS !== clocks[0]) {
        moves += 1;
        clocks[0] = flies[0].behaviourS;
      }
    }
    expect(moves).toBeLessThanOrEqual(1 / NEAR_STEP_S + 1);
    expect(moves).toBeGreaterThanOrEqual(1 / NEAR_STEP_S - 1);
    for (let i = 0; i < flies.length; i += 1) expect(flies[i].behaviourS - clocks[i]).toBeGreaterThanOrEqual(0);
  });
});

describe('the one door to the ground', () => {
  it('sweeps the entire travelled path and includes vertical surfacing, not just burrow mode', () => {
    const calls: { from: SoilPoint | undefined; to: SoilPoint }[] = [];
    const editor: BurrowEditor = { built: true, bore: (at, height, _radius, from) => {
      calls.push({ from, to: { at, height } }); return true;
    } };
    const sim = new CreatureSim({ world: fakeWorld('wetland'), seed: 3, editor, species: allFull([EARTHWORM]) });
    settle(sim, FOCUS);
    const worm = sim.creatures()[0];
    const start = { at: worm.at, height: ground(worm.at) - 1.2 };
    worm.height = start.height;
    worm.behaviour = 'surface'; worm.behaviourUntilS = 999; worm.sinceThink = -999;
    worm.target = worm.at;
    for (let i = 0; i < 120; i++) sim.update(FOCUS, 1 / 60);
    const mine = calls.filter(c => distance(c.to.at, start.at) < 1);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0].from).toEqual(start);
    expect(mine.some(c => c.from !== undefined && c.to.height > c.from.height)).toBe(true);
    for (let i = 1; i < mine.length; i++) expect(mine[i].from).toEqual(mine[i - 1].to);
  });

  function spy(): BurrowEditor & { calls: number } {
    const e = { built: true, calls: 0, bore: (): boolean => { e.calls += 1; return true; } };
    return e;
  }

  it('only the worm reaches the gate: attempted counts it, refused stays zero, and a spy editor hears every bore', () => {
    const editor = spy();
    const sim = new CreatureSim({ world: fakeWorld('wetland'), seed: 3, editor, species: allFull(CREATURE_IDS.map((id) => CREATURE_SPECIES[id])) });
    settle(sim, FOCUS);
    for (let i = 0; i < 60 * 60; i += 1) sim.update(FOCUS, 1 / 60);
    expect(sim.burrows.attempted).toBeGreaterThan(0);
    expect(sim.burrows.applied).toBe(sim.burrows.attempted);
    expect(sim.burrows.refused).toBe(0);
    expect(editor.calls).toBe(sim.burrows.attempted);
    // Once per half-bore of travel, at most — and the bound is set by the
    // LONGEST worm the draw can produce, because a pace is the
    // individual's: a 250 mm worm covers 25 mm/s, not the cited 15, and
    // bores five sixths again as often as the table's own animal.
    const worms = sim.counts('earthworm').resident;
    const fastest = unitsOfMm(EARTHWORM.pace.wanderMmS) * (EARTHWORM.lengthRangeMm[1] / EARTHWORM.lengthMm);
    expect(sim.burrows.attempted).toBeLessThanOrEqual(worms * 60 * (fastest / (unitsOfMm(EARTHWORM.burrow!.boreMm) / 2)) + worms);
  });

  it('with no worms in the world nothing reaches the gate; a non-editor forced through it is refused; the unbuilt editor changes nothing', () => {
    const editor = spy();
    const noWorms = new CreatureSim({ world: fakeWorld('wetland'), seed: 3, editor, species: allFull([APHID, HOUSEFLY]) });
    settle(noWorms, FOCUS);
    for (let i = 0; i < 60 * 60; i += 1) noWorms.update(FOCUS, 1 / 60);
    expect(noWorms.burrows.attempted).toBe(0);
    expect(editor.calls).toBe(0);
    expect(noWorms.burrows.bore(APHID.canEditTerrain, FOCUS, 0, 0.3)).toBe(false);
    expect(noWorms.burrows.refused).toBe(1);
    expect(editor.calls).toBe(0);

    const unbuilt = new CreatureSim({ world: fakeWorld('wetland'), seed: 3, species: allFull([EARTHWORM]) });
    expect(unbuilt.burrows.editor).toBe(NO_BURROW_EDITOR);
    settle(unbuilt, FOCUS);
    for (let i = 0; i < 60 * 60; i += 1) unbuilt.update(FOCUS, 1 / 60);
    expect(unbuilt.burrows.attempted).toBeGreaterThan(0);
    expect(unbuilt.burrows.applied).toBe(0);
    // Under the ground, or lying on it when surfaced: never above it.
    for (const c of unbuilt.creatures()) expect(c.height).toBeLessThanOrEqual(ground(c.at) + 1e-9);
  });
});

describe('living', () => {
  it('a disturbance at a full-tier fly makes it take off within one think; with no disturbances behaviours still change over a minute', () => {
    const w = fakeWorld();
    const sim = new CreatureSim({ world: w, seed: 3, species: allFull([HOUSEFLY]), rung: 'ultra-high' });
    settle(sim, FOCUS);
    for (let i = 0; i < 60 * 5; i += 1) sim.update(FOCUS, 1 / 60);
    const perched = sim.creatures().find((c) => c.behaviour === 'idle' || c.behaviour === 'rest' || c.behaviour === 'feed');
    expect(perched).toBeDefined();
    w.list = [{ at: perched!.at, height: perched!.height, radius: 0 }];
    const frames = Math.ceil(HOUSEFLY.thinkS * 60) + 2;
    for (let i = 0; i < frames; i += 1) sim.update(FOCUS, 1 / 60);
    expect(['takeoff', 'fly']).toContain(perched!.behaviour);

    const quiet = new CreatureSim({ world: fakeWorld('wetland'), seed: 3, species: allFull(CREATURE_IDS.map((id) => CREATURE_SPECIES[id])) });
    settle(quiet, FOCUS);
    const start = new Map(quiet.creatures().map((c) => [c.id, c.behaviour]));
    for (let i = 0; i < 60 * 60; i += 1) quiet.update(FOCUS, 1 / 60);
    let changed = 0;
    for (const c of quiet.creatures()) if (start.get(c.id) !== c.behaviour) changed += 1;
    expect(changed).toBeGreaterThan(quiet.creatures().length / 4);
  });

  it('a bank closing on the focus alarms the near and full worms through the loop, never a far one, at think cadence and no more', () => {
    // The flood sense runs inside `update`, once per think, before the
    // think: a far creature neither thinks nor drowns, and a double
    // think per alarm would show here as a jump in the thought count.
    let bank: number | null = null;
    const w = fakeWorld('wetland');
    const flooded: CreatureWorld = {
      ...w,
      water: {
        freshDepthAt: (at) => (bank !== null && at.wx >= bank ? 10 : 0),
        isSeaAt: () => false,
        nearestWater: (at, radius) => {
          if (bank === null) return null;
          const distance = Math.abs(at.wx - bank);
          return distance < radius ? { at: world(bank, at.wz), distance } : null;
        },
      },
    };
    const sim = new CreatureSim({ world: flooded, seed: 3, species: [EARTHWORM], rung: 'ultra-high' });
    settle(sim, FOCUS);
    const kept = sim.creatures();
    const simulated = kept.filter((c) => c.tier !== 'far');
    const far = kept.filter((c) => c.tier === 'far');
    expect(simulated.length).toBeGreaterThan(5);
    expect(far.length).toBeGreaterThan(0);

    // Two dry seconds: readings of -1 everywhere, and a baseline of thoughts.
    let dryThoughts = 0;
    for (let i = 0; i < 120; i += 1) {
      sim.update(FOCUS, 1 / 60);
      dryThoughts += sim.cost().thoughts;
    }
    for (const c of kept) expect(c.waterEdge).toBe(-1);

    // The water comes from thirty metres east at three metres a second.
    bank = FOCUS.wx + 3000;
    let wetThoughts = 0;
    for (let i = 0; i < 120; i += 1) {
      bank -= 5;
      sim.update(FOCUS, 1 / 60);
      wetThoughts += sim.cost().thoughts;
    }
    for (const c of simulated) expect(c.waterEdge, `${c.id} read no edge`).toBeGreaterThanOrEqual(0);
    const alarmed = simulated.filter((c) => c.alarm > 0);
    expect(alarmed.length).toBeGreaterThan(simulated.length / 2);
    for (const c of alarmed) expect(c.behaviour).toBe('flee');
    for (const c of far) {
      expect(c.waterEdge, `${c.id} is far and read the water`).toBe(-1);
      expect(c.alarm).toBe(0);
    }
    // The same number of thoughts, give or take the phase each alarm re-seats: a think per alarm on top would be +N.
    expect(Math.abs(wetThoughts - dryThoughts)).toBeLessThanOrEqual(simulated.length / 4 + 2);
  });

  it('uses dt as given: a full creature\'s clock advances by exactly the dt handed in', () => {
    const sim = new CreatureSim({ world: fakeWorld(), seed: 3, species: allFull([EARTHWORM]) });
    settle(sim, FOCUS);
    const worm = sim.creatures()[0];
    const before = worm.behaviourS;
    sim.update(FOCUS, 0.25);
    expect(worm.behaviourS - before).toBeCloseTo(0.25, 12);
    sim.update(FOCUS, NaN);
    sim.update(FOCUS, -1);
    expect(worm.behaviourS - before).toBeCloseTo(0.25, 12);
  });

  it('a thousand simulated seconds around a wandering focus: nothing NaN, everything finite, the state round-trips JSON', () => {
    const w = fakeWorld('wetland');
    const sim = new CreatureSim({ world: w, seed: 3, rung: 'ultra-low' });
    const dt = 1 / 20;
    let focus = FOCUS;
    for (let i = 0; i < 1000 * 20; i += 1) {
      const t = i * dt;
      focus = world(FOCUS.wx + Math.sin(t / 40) * 900, FOCUS.wz + Math.cos(t / 55) * 700);
      if (i % 4000 === 0) w.sky = { rainMmHr: i % 8000 === 0 ? 2 : 0, windX: 0, windZ: 0, night: (i / 4000) % 3 === 1 };
      w.list = i % 2 === 0 ? [{ at: focus, height: ground(focus) + 30, radius: 20 }] : [];
      sim.update(focus, dt);
      if (i % 200 === 0) for (const c of sim.creatures()) finite(c);
    }
    const list = sim.creatures();
    expect(list.length).toBeGreaterThan(0);
    for (const c of list) finite(c);
    expect(JSON.parse(JSON.stringify(list))).toEqual(list);
    const counts = CREATURE_IDS.map((id) => sim.counts(id));
    for (const c of counts) expect(c.resident).toBeLessThanOrEqual(c.cap);
    expect(sim.cost().thoughts).toBeGreaterThanOrEqual(0);
  });

  it('exposes the species in the table\'s order and refuses a broken table', () => {
    const sim = new CreatureSim({ world: fakeWorld(), seed: 1 });
    expect(sim.species.map((s) => s.id)).toEqual(CREATURE_IDS);
    expect(sim.counts('housefly').cap).toBe(HOUSEFLY.population.caps.medium);
    const broken: CreatureSpecies = { ...APHID, canEditTerrain: true };
    expect(() => new CreatureSim({ world: fakeWorld(), seed: 1, species: [broken] })).toThrow(/only a burrower/);
    // `now` is the HUD's clock and nothing else: a moving clock only changes the cost line.
    let t = 0;
    const timed = new CreatureSim({ world: fakeWorld(), seed: 1, now: () => (t += 0.01) });
    settle(timed, FOCUS);
    timed.update(FOCUS, 1 / 60);
    expect(timed.cost().moveMs).toBeGreaterThan(0);
    const untimed = new CreatureSim({ world: fakeWorld(), seed: 1 });
    settle(untimed, FOCUS);
    untimed.update(FOCUS, 1 / 60);
    expect(untimed.cost().moveMs).toBe(0);
    expect(untimed.creatures().map((c) => c.id)).toEqual(timed.creatures().map((c) => c.id));
    expect(cellAt(FOCUS)).toEqual({ cx: 5, cz: 3 });
    const id: CreatureId = 'aphid';
    expect(untimed.counts(id).cap).toBe(APHID.population.caps.medium);
  });
});
