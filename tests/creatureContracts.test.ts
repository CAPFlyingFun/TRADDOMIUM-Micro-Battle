/**
 * The creature contracts (Phase 7, the ecology pass): the species table
 * holds to its own rules and to the research it cites, a species can
 * only use its medium's behaviours, and the terrain-edit seam is a
 * no-op that refuses everything but an authorised burrower.
 */
import { describe, expect, it } from 'vitest';
import {
  APHID, BEHAVIOURS, BEHAVIOURS_BY_MEDIUM, CREATURE_IDS, CREATURE_SPECIES, EARTHWORM, HOUSEFLY, MM_PER_UNIT,
  NO_BURROW_EDITOR, assertSpeciesTable, behaviourAllowed, burrowGate, newCreature, rigScale, sizeRatio,
  speciesProblems, unitsOfMm, type CreatureId, type CreatureSpecies,
} from '../src/creatures';
import { OBJECT_RUNGS } from '../src/world/objects/budget';
import { world } from '../src/world/coords';
import { OFFERED_KINDS } from '../src/world/ecology/resources';
import { HABITAT_KINDS } from '../src/world/habitat';

/** One creature of a species with nothing said about its size: the table's own animal. */
function spawn(species: CreatureId) {
  return newCreature({ id: `${species}:0,0:0`, species, cellKey: '0,0', at: world(0, 0), height: 0, heading: 0, phase: 0 });
}

describe('the species table', () => {
  it('holds its three, in the layer order, each carrying its own id', () => {
    expect(CREATURE_IDS).toEqual(['earthworm', 'aphid', 'housefly']);
    for (const id of CREATURE_IDS) expect(CREATURE_SPECIES[id].id).toBe(id);
    expect(() => assertSpeciesTable()).not.toThrow();
    for (const id of CREATURE_IDS) expect(speciesProblems(CREATURE_SPECIES[id])).toEqual([]);
  });

  it('sizes are the cited measurements, by the spine, in a world of centimetres', () => {
    // The brief: verify sizes against the repo's research, size by the
    // spine, not the bounding box. The sources are on the entries.
    expect(EARTHWORM.lengthMm).toBe(150);
    expect(APHID.lengthMm).toBe(2.5);
    expect(HOUSEFLY.lengthMm).toBe(6.5);
    for (const id of CREATURE_IDS) expect(CREATURE_SPECIES[id].lengthSource).toMatch(/—/);
    expect(MM_PER_UNIT).toBe(10);
    expect(unitsOfMm(150)).toBe(15);
    // The rig scale makes the spine measure the cited length: 25.74 GLB units × scale = 15 world units.
    expect(EARTHWORM.model.spineUnits * rigScale(EARTHWORM)).toBeCloseTo(15, 9);
    expect(APHID.model.spineUnits * rigScale(APHID)).toBeCloseTo(0.25, 9);
    expect(HOUSEFLY.model.spineUnits * rigScale(HOUSEFLY)).toBeCloseTo(0.65, 9);
    // A fly is not a worm: the three scales are the three sizes, not one number copied thrice.
    expect(rigScale(EARTHWORM)).toBeGreaterThan(rigScale(HOUSEFLY));
    expect(rigScale(HOUSEFLY)).toBeGreaterThan(rigScale(APHID));
  });

  it('a length is an individual\'s: the cited one is the reference, the default, and what sizeRatio measures against', () => {
    // Joshua, 2026-09-08: the earthworm "should be based on size and
    // dynamic". The range on each entry is the one its own source gives.
    expect(EARTHWORM.lengthRangeMm).toEqual([120, 250]);
    expect(APHID.lengthRangeMm).toEqual([1.5, 4]);
    expect(HOUSEFLY.lengthRangeMm).toEqual([4, 8]);
    for (const id of CREATURE_IDS) {
      const species = CREATURE_SPECIES[id];
      expect(species.lengthMm, id).toBeGreaterThanOrEqual(species.lengthRangeMm[0]);
      expect(species.lengthMm, id).toBeLessThanOrEqual(species.lengthRangeMm[1]);
      // A creature made without a drawn length IS the animal the table
      // cites — every caller that predates the draw still gets it.
      const cited = spawn(id);
      expect(cited.lengthMm, id).toBe(species.lengthMm);
      expect(sizeRatio(cited, species), id).toBe(1);
      // Twice the body is twice the ratio, and every pace and body-length
      // measure in the simulation is that number times the table's.
      expect(sizeRatio({ ...cited, lengthMm: species.lengthMm * 2 }, species), id).toBeCloseTo(2, 12);
      expect(sizeRatio({ ...cited, lengthMm: species.lengthRangeMm[0] }, species), id)
        .toBeCloseTo(species.lengthRangeMm[0] / species.lengthMm, 12);
      // A length that is not one reads as the species' own animal rather
      // than freezing it or sending it off the island.
      for (const bad of [NaN, 0, -5, Infinity]) {
        expect(sizeRatio({ ...cited, lengthMm: bad }, species), `${id} at ${bad}`).toBe(1);
      }
    }
  });

  it('the worm travels at the measured tenth of its body a second, and every species flees faster than it walks', () => {
    // Quillin (1999, J. Exp. Biol.) measured L. terrestris crawling at
    // about a tenth of a body length a second, so the cited 150 mm animal
    // travels at 15 mm/s — which is also where Joshua's source lands its
    // medium worm (185 ft/hr = 15.7 mm/s), reached from the other side.
    expect(EARTHWORM.pace.wanderMmS).toBeCloseTo(EARTHWORM.lengthMm * 0.1, 9);
    for (const id of CREATURE_IDS) {
      const species = CREATURE_SPECIES[id];
      expect(species.pace.fleeMmS, `${id} flees no faster than it walks`).toBeGreaterThan(species.pace.wanderMmS);
    }
  });

  it('each species has exactly the spec its medium needs, and only the burrower may edit the ground', () => {
    expect(EARTHWORM.medium).toBe('soil');
    expect(EARTHWORM.burrow).not.toBeNull();
    expect(EARTHWORM.flight).toBeNull();
    expect(EARTHWORM.canEditTerrain).toBe(true);
    expect(APHID.medium).toBe('plant');
    expect(APHID.burrow).toBeNull();
    expect(APHID.flight).toBeNull();
    expect(APHID.canEditTerrain).toBe(false);
    expect(APHID.population.hosts?.length).toBeGreaterThan(0);
    expect(HOUSEFLY.medium).toBe('air');
    expect(HOUSEFLY.flight).not.toBeNull();
    expect(HOUSEFLY.burrow).toBeNull();
    expect(HOUSEFLY.canEditTerrain).toBe(false);
  });

  it('nothing lives at sea, and every habitat named is one the classifier knows', () => {
    for (const id of CREATURE_IDS) {
      const table = CREATURE_SPECIES[id].population.perHectare;
      expect(table.sea ?? 0, id).toBe(0);
      for (const kind of Object.keys(table)) expect(HABITAT_KINDS, `${id} names habitat ${kind}`).toContain(kind);
    }
    // A worm is a soil animal: none on sand. A fly is drawn to the wrack line: some on the beach.
    expect(EARTHWORM.population.perHectare.beach ?? 0).toBe(0);
    expect(HOUSEFLY.population.perHectare.beach ?? 0).toBeGreaterThan(0);
  });

  it('caps rise with the rung and are named for every rung the objects know', () => {
    for (const id of CREATURE_IDS) {
      const caps = CREATURE_SPECIES[id].population.caps;
      expect(Object.keys(caps).sort()).toEqual([...OBJECT_RUNGS].sort());
      let last = 0;
      for (const rung of OBJECT_RUNGS) {
        expect(caps[rung], `${id} ${rung}`).toBeGreaterThanOrEqual(last);
        last = caps[rung];
      }
    }
  });

  it('what a species eats or is drawn to is a resource kind the layer offers today, or carrion, which is named and not offered', () => {
    for (const id of CREATURE_IDS) {
      const species = CREATURE_SPECIES[id];
      for (const kind of species.needs.eats) expect(OFFERED_KINDS, `${id} eats ${kind}`).toContain(kind);
      for (const kind of species.flight?.drawnTo ?? []) {
        if (kind === 'carrion') continue;
        expect(OFFERED_KINDS, `${id} drawn to ${kind}`).toContain(kind);
      }
    }
  });

  it('the validator has teeth: a fly with a burrow, a digging aphid, a cap that falls, a bore wider than its band', () => {
    const flyWithBurrow: CreatureSpecies = { ...HOUSEFLY, burrow: EARTHWORM.burrow };
    expect(speciesProblems(flyWithBurrow).join('\n')).toMatch(/only a soil species does/);
    const diggingAphid: CreatureSpecies = { ...APHID, canEditTerrain: true };
    expect(speciesProblems(diggingAphid).join('\n')).toMatch(/only a burrower may be a terrain editor/);
    const fallingCaps: CreatureSpecies = {
      ...EARTHWORM,
      population: { ...EARTHWORM.population, caps: { ...EARTHWORM.population.caps, high: 1 } },
    };
    expect(speciesProblems(fallingCaps).join('\n')).toMatch(/caps fall/);
    const wideBore: CreatureSpecies = { ...EARTHWORM, burrow: { ...EARTHWORM.burrow!, boreMm: 100 } };
    expect(speciesProblems(wideBore).join('\n')).toMatch(/break the surface/);
    const seaWorm: CreatureSpecies = {
      ...EARTHWORM,
      population: { ...EARTHWORM.population, perHectare: { ...EARTHWORM.population.perHectare, sea: 5 } },
    };
    expect(speciesProblems(seaWorm).join('\n')).toMatch(/nothing lives at sea/);
    const backwards: CreatureSpecies = { ...EARTHWORM, lengthRangeMm: [250, 120] };
    expect(speciesProblems(backwards).join('\n')).toMatch(/lengthRangeMm runs backwards/);
    const citedOutside: CreatureSpecies = { ...EARTHWORM, lengthRangeMm: [10, 40] };
    expect(speciesProblems(citedOutside).join('\n')).toMatch(/outside lengthRangeMm/);
    const lazyFlee: CreatureSpecies = { ...EARTHWORM, pace: { ...EARTHWORM.pace, fleeMmS: EARTHWORM.pace.wanderMmS } };
    expect(speciesProblems(lazyFlee).join('\n')).toMatch(/fleeing is not faster than walking/);
    const idSwap = { ...CREATURE_SPECIES, aphid: HOUSEFLY };
    expect(() => assertSpeciesTable(idSwap)).toThrow(/carries id "housefly"/);
  });
});

describe('the behaviour vocabulary', () => {
  it('is eleven words, and every medium uses a subset that includes the five shared ones', () => {
    expect(BEHAVIOURS).toHaveLength(11);
    const shared = ['idle', 'wander', 'feed', 'rest', 'flee'] as const;
    for (const medium of ['soil', 'plant', 'air'] as const) {
      for (const b of shared) expect(behaviourAllowed(medium, b), `${medium} ${b}`).toBe(true);
      for (const b of BEHAVIOURS_BY_MEDIUM[medium]) expect(BEHAVIOURS).toContain(b);
    }
    // No worm in the air, no fly underground, no aphid doing either.
    expect(behaviourAllowed('soil', 'fly')).toBe(false);
    expect(behaviourAllowed('air', 'burrow')).toBe(false);
    expect(behaviourAllowed('plant', 'fly')).toBe(false);
    expect(behaviourAllowed('plant', 'burrow')).toBe(false);
    expect(behaviourAllowed('soil', 'burrow')).toBe(true);
    expect(behaviourAllowed('air', 'hover')).toBe(true);
  });

  it('a new creature is idle, unalarmed, untargeted, far, with its phase wrapped', () => {
    const c = newCreature({ id: 'housefly:1,2:3', species: 'housefly', cellKey: '1,2', at: world(10, 20), height: 5, heading: 1, phase: 1.25, hunger: 2 });
    expect(c.behaviour).toBe('idle');
    expect(c.tier).toBe('far');
    expect(c.target).toBeNull();
    expect(c.alarm).toBe(0);
    expect(c.hunger).toBe(1);
    expect(c.phase).toBeCloseTo(0.25, 12);
    expect(c.targetHeight).toBe(5);
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });
});

describe('the terrain-edit seam', () => {
  it('is not built, and says so', () => {
    expect(NO_BURROW_EDITOR.built).toBe(false);
    expect(NO_BURROW_EDITOR.bore(world(0, 0), 10, 0.3)).toBe(false);
  });

  it('the gate refuses every non-editor before the editor hears of it, and counts what the editor did', () => {
    let heard = 0;
    const editor = { built: true, bore: () => { heard += 1; return heard % 2 === 0; } };
    const gate = burrowGate(editor);
    expect(gate.bore(false, world(0, 0), 10, 0.3)).toBe(false);
    expect(heard).toBe(0);
    expect(gate.refused).toBe(1);
    expect(gate.bore(true, world(0, 0), 10, 0.3)).toBe(false);
    expect(gate.bore(true, world(0, 0), 10, 0.3)).toBe(true);
    expect(heard).toBe(2);
    expect(gate.attempted).toBe(2);
    expect(gate.applied).toBe(1);
    expect(burrowGate().editor).toBe(NO_BURROW_EDITOR);
  });
});
