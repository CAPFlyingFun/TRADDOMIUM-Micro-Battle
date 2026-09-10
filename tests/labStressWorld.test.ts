/**
 * The bench's capacity and the stress crowd's placement
 * (`creatures/labWorld.ts`): a species table that is the island's in
 * every number but the cap, and a hundredth creature that lands in the
 * same place on every run, on a surface its own medium allows.
 */
import { describe, expect, it } from 'vitest';
import {
  BLOCK, CREATURE_SPECIES, LAB_CAPACITY, LAB_CREATURE_IDS, LAB_HALF, LAB_PLANTS, LAB_SIZE, LAB_SPECIES_TABLE, labGroundAt,
  labInBounds, labStressSpawn, speciesProblems, unitsOfMm, type CreatureId,
} from '../src/creatures';
import { MAX_CREATURES } from '../src/lab/stressTest';
import { world } from '../src/world/coords';

const IDS = LAB_CREATURE_IDS;

describe('the bench\'s capacity', () => {
  it('raises every cap to the bench\'s, and changes nothing else about a species', () => {
    expect(LAB_SPECIES_TABLE).toHaveLength(IDS.length);
    for (const species of LAB_SPECIES_TABLE) {
      const island = CREATURE_SPECIES[species.id];
      for (const rung of Object.keys(island.population.caps)) {
        expect(species.population.caps[rung as keyof typeof island.population.caps], `${species.id} ${rung}`).toBe(LAB_CAPACITY);
      }
      // Every other number is the island's: the point of testing here.
      expect(species.pace).toEqual(island.pace);
      expect(species.senses).toEqual(island.senses);
      expect(species.needs).toEqual(island.needs);
      expect(species.flight).toEqual(island.flight);
      expect(species.burrow).toEqual(island.burrow);
      expect(species.lengthMm).toBe(island.lengthMm);
      expect(species.climber).toBe(island.climber);
      expect(species.population.reachM).toBe(island.population.reachM);
      expect(species.population.nearM).toBe(island.population.nearM);
      expect(species.population.fullM).toBe(island.population.fullM);
      expect(species.population.hosts).toEqual(island.population.hosts);
      // And the table is still a legal one: the validator has a rule about caps.
      expect(speciesProblems(species)).toEqual([]);
    }
  });

  it('has room for a whole run, so a cap can never be what a run measures', () => {
    // The run's own ceiling is the only limit the report should ever hit.
    expect(LAB_CAPACITY).toBeGreaterThan(MAX_CREATURES);
  });
});

describe('labStressSpawn: the crowd', () => {
  it('is deterministic: the same index is the same body, every run', () => {
    for (const id of IDS) {
      for (const index of [0, 7, 199]) {
        expect(labStressSpawn(index, id)).toEqual(labStressSpawn(index, id));
      }
    }
  });

  it('gives every body its own id, in a shape the bench\'s own five can never wear', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const options = labStressSpawn(i, IDS[i % IDS.length]);
      expect(ids.has(options.id), options.id).toBe(false);
      ids.add(options.id);
      expect(options.id.startsWith('stress:')).toBe(true);
    }
    expect(ids.size).toBe(200);
  });

  it('stands every body inside the box and clear of the block\'s footprint', () => {
    for (let i = 0; i < 300; i += 1) {
      const id = IDS[i % IDS.length];
      const options = labStressSpawn(i, id);
      expect(labInBounds(options.at), `${id} ${i} is inside the box`).toBe(true);
      expect(Math.abs(options.at.wx)).toBeLessThanOrEqual(LAB_HALF);
      expect(Math.abs(options.at.wz)).toBeLessThanOrEqual(LAB_HALF);
      // Not standing inside a solid: the pillar and the slab share the block's footprint.
      const inside = Math.abs(options.at.wx) < BLOCK.size / 2 && Math.abs(options.at.wz) < BLOCK.size / 2;
      expect(inside, `${id} ${i} at ${options.at.wx},${options.at.wz} is inside the block`).toBe(false);
    }
  });

  it('puts each body where its own medium allows, and nowhere else', () => {
    for (let i = 0; i < 120; i += 1) {
      for (const id of IDS) {
        const options = labStressSpawn(i, id);
        const species = CREATURE_SPECIES[id];
        const ground = labGroundAt(options.at);
        expect(Number.isFinite(options.height), `${id} height`).toBe(true);
        switch (species.medium) {
          case 'soil': {
            // In its band: under the ground, and not deeper than the band's floor.
            const under = unitsOfMm(species.burrow!.underMm);
            expect(options.height).toBeLessThan(ground);
            expect(options.height).toBeGreaterThanOrEqual(ground - under);
            expect(options.behaviour).toBe('burrow');
            break;
          }
          case 'plant': {
            // On a host plant the bench actually carries, part-way up it.
            const host = LAB_PLANTS.find((p) => p.id === options.hostId);
            expect(host, `${id} host ${options.hostId}`).toBeDefined();
            expect(species.population.hosts).toContain(host!.family);
            expect(options.at).toEqual(host!.at);
            const foot = labGroundAt(host!.at);
            expect(options.height).toBeGreaterThan(foot);
            expect(options.height).toBeLessThanOrEqual(foot + host!.size);
            break;
          }
          case 'air': {
            const lo = unitsOfMm(species.flight!.cruiseMm[0]);
            expect(options.height).toBeGreaterThanOrEqual(ground + lo);
            // Never over the box: the bench is a metre tall.
            expect(options.height).toBeLessThanOrEqual(ground + LAB_SIZE);
            expect(options.behaviour).toBe('fly');
            break;
          }
          default:
            expect(options.height).toBe(ground);
            break;
        }
      }
    }
  });

  it('draws a size inside the species\' range and a phase inside the cycle', () => {
    for (const id of IDS) {
      const range = CREATURE_SPECIES[id].lengthRangeMm;
      const lengths = new Set<number>();
      for (let i = 0; i < 60; i += 1) {
        const options = labStressSpawn(i, id);
        expect(options.lengthMm!).toBeGreaterThanOrEqual(range[0] - 1e-9);
        expect(options.lengthMm!).toBeLessThanOrEqual(range[1] + 1e-9);
        expect(options.phase).toBeGreaterThanOrEqual(0);
        expect(options.phase).toBeLessThan(1);
        lengths.add(options.lengthMm!);
      }
      // A crowd of one size would be a crowd the draw never ran on.
      expect(lengths.size).toBeGreaterThan(20);
    }
  });

  it('scatters: two hundred bodies are not a heap in one corner', () => {
    const points = Array.from({ length: 200 }, (_, i) => labStressSpawn(i, 'queen' as CreatureId).at);
    const xs = points.map((p) => p.wx);
    const zs = points.map((p) => p.wz);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(LAB_SIZE * 0.7);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(LAB_SIZE * 0.7);
    // And they are spread either side of the middle.
    expect(xs.filter((x) => x > 0).length).toBeGreaterThan(60);
    expect(zs.filter((z) => z > 0).length).toBeGreaterThan(60);
  });

  it('a different seed is a different crowd, in the same room', () => {
    const one = labStressSpawn(3, 'worker' as CreatureId);
    const other = labStressSpawn(3, 'worker' as CreatureId, 0x99);
    expect(other.at).not.toEqual(one.at);
    expect(labInBounds(other.at)).toBe(true);
  });

  it('is never NaN, whatever it is handed', () => {
    for (const index of [0, -1, 1e9]) {
      const options = labStressSpawn(index, 'housefly' as CreatureId);
      expect(Number.isFinite(options.at.wx)).toBe(true);
      expect(Number.isFinite(options.at.wz)).toBe(true);
      expect(Number.isFinite(options.height)).toBe(true);
      expect(Number.isFinite(options.heading)).toBe(true);
    }
    expect(labGroundAt(world(0, 0))).toBeGreaterThan(0);
  });
});
