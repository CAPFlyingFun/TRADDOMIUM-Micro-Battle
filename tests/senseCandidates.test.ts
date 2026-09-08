/**
 * WHAT THE ANTENNAE ARE OFFERED (`src/sense/candidates.ts`), against the
 * world's REAL population rather than a fixture: the same
 * `populateCell` the renderer streams, so the counts, the sizes and the
 * families are the island's own.
 *
 * The decisions pinned here are the ones that make the feature usable
 * rather than a green fog: grass is not a thing, an object stands on the
 * ground, an animal is its cited length, and the walk is bounded so a
 * fern bank cannot cost a phone a frame.
 */
import { describe, expect, it } from 'vitest';
import {
  CREATURE_WORDS, FAMILY_KINDS, FAMILY_WORDS, SENSED_FAMILIES, creatureThings, objectThings,
  type ObjectSource,
} from '../src/sense/candidates';
import { SENSE_KINDS } from '../src/sense/senseTypes';
import { EARTHWORM, HOUSEFLY, newCreature, unitsOfMm, type CreatureId, type CreatureState } from '../src/creatures';
import { OBJECT_FAMILIES } from '../src/world/objects/families';
import { CELL_SPAN, cellAt, type ObjectCellId } from '../src/world/objects/cells';
import { populateCell, type CellPopulation } from '../src/world/objects/populate';
import { WORLD_SEED } from '../src/world/objects/seed';
import { world, type WorldPoint } from '../src/world/coords';
import { UNITS_PER_METRE } from '../src/world/dem';
import { classify, type Habitat } from '../src/world/habitat';
import type { CoverMix } from '../src/world/landcover';

const M = UNITS_PER_METRE;

/**
 * A forest everywhere — the habitat with the most of everything to find,
 * built the way `worldObjectsPlants` builds its fixtures. It has to be a
 * REAL `Habitat` and not the word "forest": `populate.sizeOf` reads the
 * cover factors, so a bare string silently makes every grass and tree
 * size NaN, which is how this test first failed.
 */
const TREE_MIX: CoverMix = { tree: 1, shrub: 0, grass: 0, bare: 0, water: 0, wetland: 0, canopy: 0.9, river: 0 };
const FOREST: Habitat = classify(TREE_MIX, 200 * M, 8, 5000 * M, false, null);
const GROUND = 12_500;

/** The real generator, cached per cell so a test does not re-roll six thousand sites. */
const grown = new Map<string, CellPopulation>();
function population(id: ObjectCellId): CellPopulation {
  const key = `${id.cx},${id.cz}`;
  let p = grown.get(key);
  if (p === undefined) {
    p = populateCell(id, { seed: WORLD_SEED, habitatAt: (): Habitat => FOREST });
    grown.set(key, p);
  }
  return p;
}

const source: ObjectSource = {
  populationAt: (cell) => population(cell),
  groundAt: () => GROUND,
};

/** The middle of a cell well away from the origin, so the arithmetic is at true scale. */
const HERE: WorldPoint = world(1_559_200, -2_400);

function creature(id: string, species: CreatureId, wx: number, wz: number, height = GROUND): CreatureState {
  return newCreature({ id, species, cellKey: '0,0', at: world(wx, wz), height, heading: 0, phase: 0 });
}

describe('the families the antennae read', () => {
  it('leaves GRASS out — the ground cover is the ant\'s forest, not a thing to name', () => {
    expect(SENSED_FAMILIES).not.toContain('grass');
    // Everything else the island grows IS offered.
    expect([...SENSED_FAMILIES].sort()).toEqual(OBJECT_FAMILIES.filter((f) => f !== 'grass').sort());
  });

  it('gives every family a word and a group, and every group is one of the three', () => {
    for (const family of OBJECT_FAMILIES) {
      expect(FAMILY_WORDS[family], family).toMatch(/^[A-Z]+$/);
      expect(SENSE_KINDS, family).toContain(FAMILY_KINDS[family]);
    }
    // The one deliberate rename: the `leaf` family is leaf LITTER, and
    // calling it LEAF beside BROADLEAF would name two things alike.
    expect(FAMILY_WORDS.leaf).toBe('LITTER');
    expect(FAMILY_WORDS.broadleaf).toBe('BROADLEAF');
    expect(FAMILY_KINDS.leaf).toBe('material');
    expect(FAMILY_KINDS.twig).toBe('material');
    expect(FAMILY_KINDS.tree).toBe('plant');
  });

  it('names each animal in the singular, because a label names one of them', () => {
    expect(CREATURE_WORDS.earthworm).toBe('WORM');
    expect(CREATURE_WORDS.aphid).toBe('APHID');
    expect(CREATURE_WORDS.housefly).toBe('FLY');
  });
});

describe('objectThings', () => {
  it('finds the forest\'s real objects inside the radius and none outside it', () => {
    const radius = 3 * 100; // three metres
    const things = objectThings(source, HERE, radius);
    expect(things.length).toBeGreaterThan(0);
    for (const t of things) {
      const dx = t.at.wx - HERE.wx;
      const dz = t.at.wz - HERE.wz;
      expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(radius + 1e-6);
      expect(t.name).toMatch(/^[A-Z]+$/);
      expect(t.size).toBeGreaterThan(0);
      // Standing on the ground the source reports.
      expect(t.height).toBe(GROUND);
      expect(t.id).toContain(':');
    }
  });

  it('offers no grass however dense the cell is', () => {
    const things = objectThings(source, HERE, 5 * 100);
    expect(things.some((t) => t.name === 'GRASS')).toBe(false);
    // And the cell really does have grass to leave out — otherwise this
    // test would pass over an empty lawn and prove nothing.
    expect(population(cellAt(HERE)).batches.grass.count).toBeGreaterThan(100);
  });

  it('gives every thing a distinct id, so a label keeps its identity', () => {
    const things = objectThings(source, HERE, 2 * 100);
    expect(new Set(things.map((t) => t.id)).size).toBe(things.length);
  });

  it('BOUNDS THE WALK, not just the result: a dense cell cannot cost a phone a frame', () => {
    const capped = objectThings(source, HERE, 8 * 100, 50);
    expect(capped).toHaveLength(50);
    // The cells are walked nearest-first, so a cap that bites keeps near work.
    const uncapped = objectThings(source, HERE, 8 * 100);
    expect(uncapped.length).toBeGreaterThan(50);
  });

  it('skips a cell the streamer has not reached rather than inventing one', () => {
    const empty: ObjectSource = { populationAt: () => null, groundAt: () => GROUND };
    expect(objectThings(empty, HERE, 5 * 100)).toEqual([]);
  });

  it('answers nothing for a radius of zero or a broken origin', () => {
    expect(objectThings(source, HERE, 0)).toEqual([]);
    expect(objectThings(source, world(Number.NaN, 0), 500)).toEqual([]);
  });

  it('reaches across a cell boundary, since a sweep does not stop at one', () => {
    // Stand on the corner of four cells; the sweep must gather from all of them.
    const corner = world(Math.round(HERE.wx / CELL_SPAN) * CELL_SPAN, Math.round(HERE.wz / CELL_SPAN) * CELL_SPAN);
    const cells = new Set(objectThings(source, corner, 4 * 100).map((t) => t.id.split(':')[1]));
    expect(cells.size).toBeGreaterThanOrEqual(2);
  });
});

describe('creatureThings', () => {
  it('reads an animal\'s CITED length, not a drawn extent', () => {
    const worm = creature('w1', 'earthworm', HERE.wx + 100, HERE.wz);
    const [thing] = creatureThings([worm], HERE, 5 * 100);
    expect(thing.size).toBeCloseTo(unitsOfMm(EARTHWORM.lengthMm), 6);
    expect(thing.size).toBeCloseTo(15, 6);
    expect(thing.kind).toBe('creature');
    expect(thing.name).toBe('WORM');
    expect(thing.id).toBe('w1');
  });

  it('takes the animal\'s own height, so a buried worm and a flying fly differ', () => {
    const worm = creature('w1', 'earthworm', HERE.wx, HERE.wz, GROUND - 1.2);
    const fly = creature('f1', 'housefly', HERE.wx + 50, HERE.wz, GROUND + 120);
    const things = creatureThings([worm, fly], HERE, 5 * 100);
    expect(things.find((t) => t.id === 'w1')?.height).toBeCloseTo(GROUND - 1.2, 6);
    expect(things.find((t) => t.id === 'f1')?.height).toBeCloseTo(GROUND + 120, 6);
    expect(things.find((t) => t.id === 'f1')?.size).toBeCloseTo(unitsOfMm(HOUSEFLY.lengthMm), 6);
  });

  it('measures horizontally, like every other reach in this project', () => {
    // A hundred metres up is still standing over it.
    const worm = creature('w1', 'earthworm', HERE.wx + 100, HERE.wz, GROUND + 10_000);
    expect(creatureThings([worm], HERE, 5 * 100)).toHaveLength(1);
    // And one just outside the radius is out, however low it is.
    const far = creature('w2', 'earthworm', HERE.wx + 501, HERE.wz, GROUND);
    expect(creatureThings([far], HERE, 5 * 100)).toHaveLength(0);
  });

  it('answers nothing for a radius of zero', () => {
    expect(creatureThings([creature('w1', 'earthworm', HERE.wx, HERE.wz)], HERE, 0)).toEqual([]);
  });
});
