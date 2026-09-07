/**
 * A micro-benchmark of `CreatureSim.update`, opt-in — it prints numbers
 * and asserts nothing about them, because a CI box's wall-clock is not
 * a phone's. Run it with:
 *
 *   CREATURE_BENCH=1 npx vitest run tests/creatureBench.test.ts
 *
 * Roughly three hundred resident creatures (the `high` rung on a shrub
 * world: 40 worms, 150 aphids, 50 flies at their caps, plus what the
 * far residents cost), at dt = 1/60, in the real mixed tiers and with
 * every tier pulled in to `full`.
 */
import { describe, expect, it } from 'vitest';
import { CREATURE_IDS, CREATURE_SPECIES, type CreatureSpecies, type CreatureWorld } from '../src/creatures';
import { CreatureSim } from '../src/creatures/CreatureSim';
import { world, type WorldPoint } from '../src/world/coords';
import type { PlantSource } from '../src/world/ecology/resources';
import type { Habitat } from '../src/world/habitat';
import { CELL_SPAN, cellOrigin } from '../src/world/objects/cells';

const ground = (at: WorldPoint): number => 300 + Math.sin(at.wx / 900) * 12 + Math.cos(at.wz / 700) * 9;

function habitat(elevation: number): Habitat {
  return {
    kind: 'shrubland', forest: 0.1, grass: 0.3, shrub: 0.5, bare: 0, wet: 0, lake: 0, coast: 0, exposure: 0,
    elevation, slopeDegrees: 3, coastDistance: 10_000, channel: false, rainfallMmYear: null,
  };
}

const plantCache = new Map<string, PlantSource[]>();
function shrubs(cx: number, cz: number): PlantSource[] {
  const key = `${cx},${cz}`;
  let list = plantCache.get(key);
  if (list === undefined) {
    const o = cellOrigin({ cx, cz });
    list = [];
    for (let i = 0; i < 12; i += 1) {
      list.push({ family: 'shrub', at: world(o.wx + 150 + (i % 4) * 400, o.wz + 200 + Math.floor(i / 4) * 500), size: 40, id: `shrub:${key}:${i}`, variant: 0 });
    }
    plantCache.set(key, list);
  }
  return list;
}

function fakeWorld(): CreatureWorld {
  return {
    groundAt: ground,
    normalAt: () => ({ nx: 0, ny: 1, nz: 0 }),
    habitatAt: (at) => habitat(ground(at)),
    plantsOf: shrubs,
    resourcesOf: () => null,
    water: null,
    weather: () => null,
    disturbances: () => [],
  };
}

const FOCUS = world(5 * CELL_SPAN + 700, 3 * CELL_SPAN + 900);

function measure(label: string, species: readonly CreatureSpecies[]): void {
  const sim = new CreatureSim({ world: fakeWorld(), seed: 3, rung: 'high', species, now: () => performance.now() });
  for (let i = 0; i < 400; i += 1) sim.update(FOCUS, 1 / 60);
  const counts = CREATURE_IDS.map((id) => `${id} ${sim.counts(id).resident}/${sim.counts(id).cap} (${sim.counts(id).byTier.full}f ${sim.counts(id).byTier.near}n ${sim.counts(id).byTier.far}far)`);
  const samples: number[] = [];
  let thoughts = 0;
  for (let i = 0; i < 1800; i += 1) {
    const focus = world(FOCUS.wx + Math.sin(i / 300) * 60, FOCUS.wz);
    const t0 = performance.now();
    sim.update(focus, 1 / 60);
    samples.push(performance.now() - t0);
    thoughts += sim.cost().thoughts;
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const max = samples[samples.length - 1];
  // eslint-disable-next-line no-console
  console.log(`[creatureBench] ${label}: ${counts.join(', ')}; mean ${mean.toFixed(3)} ms, p50 ${p50.toFixed(3)}, p95 ${p95.toFixed(3)}, max ${max.toFixed(3)}; ${(thoughts / 1800).toFixed(1)} thoughts/frame`);
  expect(mean).toBeGreaterThan(0);
}

describe.skipIf(!process.env.CREATURE_BENCH)('CreatureSim.update micro-benchmark', () => {
  it('mixed tiers (the real species table)', () => {
    measure('mixed', CREATURE_IDS.map((id) => CREATURE_SPECIES[id]));
  });

  it('every kept creature full', () => {
    measure('full', CREATURE_IDS.map((id) => {
      const s = CREATURE_SPECIES[id];
      return { ...s, population: { ...s.population, nearM: s.population.reachM, fullM: s.population.reachM } };
    }));
  });
});
