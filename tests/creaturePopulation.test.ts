/**
 * The creature population, held to the properties a deterministic world
 * rests on — the same list the objects' populator answers to:
 *
 *   same seed + same cell → the same creatures, deep-equal, in any order
 *   a different seed → different creatures
 *   a habitat decides: no worms on sand or at sea, worms in a wetland,
 *     aphids only on a host plant with an id, flies never in the sea
 *   an aphid colony is a clump, measured, not a scatter
 *   the count is the table's density times the cell's 0.0256 ha
 *   nothing here knows the rung
 */
import { describe, expect, it } from 'vitest';
import { APHID, CREATURE_IDS, CREATURE_SPECIES, EARTHWORM, HOUSEFLY, unitsOfMm, type CreatureSpecies } from '../src/creatures';
import {
  CELL_HECTARES, HOST_SCATTER_LENGTHS, drawLengthMm, expectedCount, hostCandidates, populateCreatures, siteCount,
} from '../src/creatures/population';
import { distance, world, type WorldPoint } from '../src/world/coords';
import type { PlantSource } from '../src/world/ecology/resources';
import type { Habitat, HabitatKind } from '../src/world/habitat';
import { CELL_SPAN, cellOrigin, type ObjectCellId } from '../src/world/objects/cells';

function habitat(kind: HabitatKind, elevation = 500): Habitat {
  return {
    kind, forest: 0, grass: 0, shrub: 0, bare: 0, wet: 0, lake: 0, coast: 0, exposure: 0,
    elevation, slopeDegrees: 0, coastDistance: 10_000, channel: false, rainfallMmYear: null,
  };
}

const gentle = (at: WorldPoint): number => 500 + Math.sin(at.wx / 700) * 20 + Math.cos(at.wz / 900) * 15;

/** Six shrubs with ids and a scatter of id-less grass, per cell, on a lattice. */
function plantsWithShrubs(cx: number, cz: number): PlantSource[] {
  const o = cellOrigin({ cx, cz });
  const out: PlantSource[] = [];
  for (let i = 0; i < 6; i += 1) {
    const at = world(o.wx + 200 + (i % 3) * 500, o.wz + 300 + Math.floor(i / 3) * 700);
    out.push({ family: 'shrub', at, size: 40 + i * 5, id: `shrub:${cx},${cz}:${i}`, variant: 0 });
  }
  for (let i = 0; i < 20; i += 1) {
    out.push({ family: 'grass', at: world(o.wx + 50 + i * 70, o.wz + 800), size: 20, id: null, variant: 0 });
  }
  return out;
}

function options(kind: HabitatKind | ((at: WorldPoint) => HabitatKind), seed = 7, plants: (cx: number, cz: number) => readonly PlantSource[] | null = plantsWithShrubs, ground = gentle) {
  return {
    seed,
    habitatAt: (at: WorldPoint) => habitat(typeof kind === 'function' ? kind(at) : kind, ground(at)),
    plantsOf: plants,
    groundAt: ground,
  };
}

const CELL: ObjectCellId = { cx: 12, cz: -4 };

describe('determinism', () => {
  it('generates the same cell twice, deep-equal, after other cells and round-tripped through JSON', () => {
    for (const id of CREATURE_IDS) {
      const species = CREATURE_SPECIES[id];
      const first = populateCreatures(CELL, species, options('shrubland'));
      populateCreatures({ cx: 13, cz: -4 }, species, options('shrubland'));
      populateCreatures({ cx: 11, cz: -5 }, species, options('wetland'));
      const again = populateCreatures(CELL, species, options('shrubland'));
      expect(again).toEqual(first);
      expect(JSON.parse(JSON.stringify(first))).toEqual(first);
      expect(first.length, id).toBeGreaterThan(0);
    }
  });

  it('a different seed is a different island', () => {
    const a = populateCreatures(CELL, EARTHWORM, options('wetland', 1));
    const b = populateCreatures(CELL, EARTHWORM, options('wetland', 2));
    expect(a.map((c) => c.at)).not.toEqual(b.map((c) => c.at));
  });

  it('refuses a cell address that is not two integers', () => {
    expect(() => populateCreatures({ cx: 1.5, cz: 0 }, EARTHWORM, options('wetland'))).toThrow(/two integers/);
    expect(() => populateCreatures({ cx: NaN, cz: 0 }, EARTHWORM, options('wetland'))).toThrow(/two integers/);
  });
});

describe('how many', () => {
  it('is the table density times the cell area, realised as floor or floor-plus-one, and the mean converges on it', () => {
    expect(CELL_HECTARES).toBeCloseTo(0.0256, 12);
    const expected = expectedCount(EARTHWORM, [habitat('wetland'), habitat('wetland'), habitat('wetland'), habitat('wetland'), habitat('wetland')]);
    expect(expected).toBeCloseTo(400 * 0.0256, 9);
    let total = 0;
    const cells = 200;
    for (let i = 0; i < cells; i += 1) {
      const n = populateCreatures({ cx: i, cz: 3 }, EARTHWORM, options('wetland')).length;
      expect([Math.floor(expected), Math.ceil(expected)]).toContain(n);
      total += n;
    }
    expect(total / cells).toBeGreaterThan(expected - 0.5);
    expect(total / cells).toBeLessThan(expected + 0.5);
  });

  it('blends the five samples: a cell whose west two-fifths is wetland and the rest beach holds two-fifths of the worms', () => {
    let total = 0;
    for (let i = 0; i < 100; i += 1) {
      // The line runs through the centre: the NW and SW quarter-points are wetland, the centre (not strictly west) and the east two are beach.
      total += populateCreatures({ cx: i, cz: 9 }, EARTHWORM, options((at) => (at.wx < (i + 0.5) * CELL_SPAN ? 'wetland' : 'beach'))).length;
    }
    const twoFifths = 400 * 0.0256 * 0.4;
    expect(total / 100).toBeGreaterThan(twoFifths - 0.6);
    expect(total / 100).toBeLessThan(twoFifths + 0.6);
  });

  it('a clump makes few sites; a spread makes many; never none', () => {
    expect(siteCount(38, 0.9)).toBe(4);
    expect(siteCount(10, 0.3)).toBe(7);
    expect(siteCount(1, 1)).toBe(1);
    expect(siteCount(0, 0)).toBe(1);
  });
});

describe('habitat placement', () => {
  it('no worms on sand or at sea; worms in a wetland; nothing at all at sea', () => {
    expect(populateCreatures(CELL, EARTHWORM, options('beach'))).toEqual([]);
    for (const id of CREATURE_IDS) expect(populateCreatures(CELL, CREATURE_SPECIES[id], options('sea', 7, plantsWithShrubs, () => -50))).toEqual([]);
    const worms = populateCreatures(CELL, EARTHWORM, options('wetland'));
    expect(worms.length).toBeGreaterThanOrEqual(10);
    for (const w of worms) {
      expect(w.behaviour).toBe('burrow');
      expect(w.height).toBeCloseTo(gentle(w.at) - unitsOfMm(EARTHWORM.burrow!.underMm), 9);
      expect(w.hostId).toBeNull();
    }
  });

  it('a creature born over the sea is not born: the waterline through a cell thins a fly cell and leaves ids stable', () => {
    let wet = 0;
    let dryTotal = 0;
    for (let i = 0; i < 40; i += 1) {
      const cell = { cx: i, cz: 5 };
      const line = (i + 0.75) * CELL_SPAN;
      const ground = (at: WorldPoint): number => (at.wx < line ? 300 : -200);
      const kind = (at: WorldPoint): HabitatKind => (at.wx < line ? 'beach' : 'sea');
      const flies = populateCreatures(cell, HOUSEFLY, options(kind, 7, plantsWithShrubs, ground));
      const dry = populateCreatures(cell, HOUSEFLY, options('beach', 7, plantsWithShrubs, () => 300));
      wet += flies.length;
      dryTotal += dry.length;
      for (const f of flies) {
        expect(f.at.wx).toBeLessThan(line);
        expect(f.height).toBe(300);
        expect(f.behaviour).toBe('idle');
      }
    }
    expect(wet).toBeGreaterThan(0);
    expect(wet).toBeLessThan(dryTotal);
    // A cell wholly at sea holds nothing; one whose centre is sea but whose west quarter is sand is the wrack line, and holds some.
    const wrack = { cx: 3, cz: 8 };
    const shore = (3 + 0.3) * CELL_SPAN;
    let onShore = 0;
    for (let i = 0; i < 30; i += 1) {
      const c = { cx: wrack.cx + i, cz: wrack.cz };
      const edge = shore + i * CELL_SPAN;
      onShore += populateCreatures(c, HOUSEFLY, options((at) => (at.wx < edge ? 'beach' : 'sea'), 7, plantsWithShrubs, (at) => (at.wx < edge ? 300 : -200))).length;
    }
    expect(onShore).toBeGreaterThan(0);
  });

  it('aphids sit only on a host plant with an id, within two body lengths of its foot and up its stem', () => {
    const aphids = populateCreatures(CELL, APHID, options('shrubland'));
    expect(aphids.length).toBeGreaterThan(20);
    const plants = plantsWithShrubs(CELL.cx, CELL.cz);
    const hosts = hostCandidates(plants, APHID);
    expect(hosts.every((p) => p.family === 'shrub' && p.id !== null)).toBe(true);
    const body = unitsOfMm(APHID.lengthMm);
    for (const a of aphids) {
      expect(a.hostId).not.toBeNull();
      const host = hosts.find((p) => p.id === a.hostId);
      expect(host, a.hostId ?? '').toBeDefined();
      expect(distance(a.at, host!.at)).toBeLessThanOrEqual(HOST_SCATTER_LENGTHS * body + 1e-9);
      const ground = gentle(a.at);
      expect(a.height).toBeGreaterThan(ground);
      expect(a.height).toBeLessThanOrEqual(ground + host!.size);
      expect(a.behaviour).toBe('idle');
    }
  });

  it('no host plants → no aphids; plants not generated yet → none either; a cosmetic blade is not a host', () => {
    expect(populateCreatures(CELL, APHID, options('shrubland', 7, () => []))).toEqual([]);
    expect(populateCreatures(CELL, APHID, options('shrubland', 7, () => null))).toEqual([]);
    const grassOnly = (cx: number, cz: number): PlantSource[] => plantsWithShrubs(cx, cz).filter((p) => p.family === 'grass');
    expect(populateCreatures(CELL, APHID, options('grassland', 7, grassOnly))).toEqual([]);
  });

  it('a melon aphid is a dicot feeder: a cell of ferns or seed-head grass WITH ids holds none, and the same cell with a shrub holds a colony', () => {
    // aphid.md D4: Hawaiʻi's grass aphids and its fern aphid are other genera. A plant with an id is a host only if its family is.
    const of = (family: string) => (cx: number, cz: number): PlantSource[] => {
      const o = cellOrigin({ cx, cz });
      const out: PlantSource[] = [];
      for (let i = 0; i < 6; i += 1) {
        out.push({ family, at: world(o.wx + 200 + (i % 3) * 500, o.wz + 300 + Math.floor(i / 3) * 700), size: 30, id: `${family}:${cx},${cz}:${i}`, variant: 2 });
      }
      return out;
    };
    for (const family of ['fern', 'grass']) {
      expect(hostCandidates(of(family)(CELL.cx, CELL.cz), APHID), family).toEqual([]);
      expect(populateCreatures(CELL, APHID, options('grassland', 7, of(family))), family).toEqual([]);
    }
    for (const family of ['shrub', 'broadleaf', 'flower', 'tree']) {
      expect(hostCandidates(of(family)(CELL.cx, CELL.cz), APHID), family).toHaveLength(6);
      expect(populateCreatures(CELL, APHID, options('grassland', 7, of(family))).length, family).toBeGreaterThan(0);
    }
  });

  it('an aphid colony is a clump: mean nearest-neighbour distance far below a uniform scatter of the same count', () => {
    const aphids = populateCreatures(CELL, APHID, options('shrubland'));
    const n = aphids.length;
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      let best = Infinity;
      for (let j = 0; j < n; j += 1) {
        if (i === j) continue;
        best = Math.min(best, distance(aphids[i].at, aphids[j].at));
      }
      sum += best;
    }
    const meanNN = sum / n;
    // Clark & Evans: a uniform Poisson scatter of n over area A has mean NN distance 0.5 * sqrt(A / n).
    const uniform = 0.5 * Math.sqrt((CELL_SPAN * CELL_SPAN) / n);
    expect(meanNN).toBeLessThan(uniform / 20);
  });

  it('worms are spread, not clumped: their mean nearest-neighbour distance is the same order as a uniform scatter', () => {
    const worms = populateCreatures(CELL, EARTHWORM, options('wetland'));
    const n = worms.length;
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      let best = Infinity;
      for (let j = 0; j < n; j += 1) if (i !== j) best = Math.min(best, distance(worms[i].at, worms[j].at));
      sum += best;
    }
    const uniform = 0.5 * Math.sqrt((CELL_SPAN * CELL_SPAN) / n);
    expect(sum / n).toBeGreaterThan(uniform / 4);
  });
});

describe('how big each one is', () => {
  it('draws a length per creature, the same lengths for the same cell in any order, and never outside the cited range', () => {
    for (const id of CREATURE_IDS) {
      const species = CREATURE_SPECIES[id];
      const first = populateCreatures(CELL, species, options('shrubland'));
      populateCreatures({ cx: 40, cz: 40 }, species, options('wetland'));
      const again = populateCreatures(CELL, species, options('shrubland'));
      expect(again.map((c) => c.lengthMm), id).toEqual(first.map((c) => c.lengthMm));
      const lengths = new Set(first.map((c) => c.lengthMm));
      // Not one number handed to the whole cell: they are individuals.
      expect(lengths.size, id).toBeGreaterThan(1);
      for (const c of first) {
        expect(c.lengthMm, `${id} ${c.id}`).toBeGreaterThanOrEqual(species.lengthRangeMm[0]);
        expect(c.lengthMm, `${id} ${c.id}`).toBeLessThanOrEqual(species.lengthRangeMm[1]);
      }
    }
    // A different seed is a different set of animals, sizes included.
    const a = populateCreatures(CELL, EARTHWORM, options('wetland', 1)).map((c) => c.lengthMm);
    const b = populateCreatures(CELL, EARTHWORM, options('wetland', 2)).map((c) => c.lengthMm);
    expect(a).not.toEqual(b);
  });

  it("the draw's mean is the cited length, not the range's midpoint, and the skew shows in the median", () => {
    // The exponent is chosen so E[length] = lengthMm exactly
    // (`drawLengthMm`): a uniform draw over the worm's 120-250 mm would
    // average 185, and the island's worms would quietly be a third
    // longer and a third faster than the animal the table cites.
    for (const id of CREATURE_IDS) {
      const species = CREATURE_SPECIES[id];
      let sum = 0;
      const n = 20_000;
      for (let i = 0; i < n; i += 1) sum += drawLengthMm(species, (i + 0.5) / n);
      expect(sum / n, id).toBeCloseTo(species.lengthMm, 3);
    }
    // And over the real hashed population, not merely over the formula.
    const lengths: number[] = [];
    for (let cx = 0; cx < 120; cx += 1) {
      for (let cz = 0; cz < 3; cz += 1) {
        for (const c of populateCreatures({ cx, cz }, EARTHWORM, options('wetland'))) lengths.push(c.lengthMm);
      }
    }
    expect(lengths.length).toBeGreaterThan(2000);
    const mean = lengths.reduce((t, v) => t + v, 0) / lengths.length;
    expect(mean).toBeGreaterThan(EARTHWORM.lengthMm - 3);
    expect(mean).toBeLessThan(EARTHWORM.lengthMm + 3);
    // Right-skewed: many ordinary worms, a few giants, so the median sits below the mean.
    lengths.sort((x, y) => x - y);
    expect(lengths[Math.floor(lengths.length / 2)]).toBeLessThan(mean);
    expect(lengths[lengths.length - 1]).toBeGreaterThan(EARTHWORM.lengthMm * 1.4);
  });

  it('a range that is not a range answers with a length anyway, never a NaN body', () => {
    const noRange: CreatureSpecies = { ...EARTHWORM, lengthRangeMm: [200, 100] };
    expect(drawLengthMm(noRange, 0.5)).toBe(EARTHWORM.lengthMm);
    const flat: CreatureSpecies = { ...EARTHWORM, lengthRangeMm: [150, 150] };
    expect(drawLengthMm(flat, 0.5)).toBe(150);
    for (const u of [NaN, -1, 2, Infinity]) {
      const drawn = drawLengthMm(EARTHWORM, u);
      expect(Number.isFinite(drawn), `${u}`).toBe(true);
      expect(drawn).toBeGreaterThanOrEqual(EARTHWORM.lengthRangeMm[0]);
      expect(drawn).toBeLessThanOrEqual(EARTHWORM.lengthRangeMm[1]);
    }
  });
});

describe('what a creature is born with', () => {
  it('ids are species:cx,cz:n, unique, and positions are inside the cell', () => {
    for (const id of CREATURE_IDS) {
      const list = populateCreatures(CELL, CREATURE_SPECIES[id], options('shrubland'));
      const ids = new Set(list.map((c) => c.id));
      expect(ids.size).toBe(list.length);
      const o = cellOrigin(CELL);
      for (const c of list) {
        expect(c.id).toMatch(new RegExp(`^${id}:12,-4:\\d+$`));
        expect(c.cellKey).toBe('12,-4');
        expect(c.species).toBe(id);
        expect(c.at.wx).toBeGreaterThanOrEqual(o.wx);
        expect(c.at.wx).toBeLessThanOrEqual(o.wx + CELL_SPAN);
        expect(c.at.wz).toBeGreaterThanOrEqual(o.wz);
        expect(c.at.wz).toBeLessThanOrEqual(o.wz + CELL_SPAN);
        expect(c.tier).toBe('far');
        expect(c.alarm).toBe(0);
        expect(Number.isFinite(c.heading)).toBe(true);
        expect(Math.abs(c.heading)).toBeLessThanOrEqual(Math.PI);
      }
    }
  });

  it('phases spread the think clocks; needs start below their thresholds', () => {
    const aphids = populateCreatures(CELL, APHID, options('shrubland'));
    const clocks = new Set(aphids.map((a) => a.sinceThink.toFixed(6)));
    expect(clocks.size).toBeGreaterThan(aphids.length / 2);
    for (const a of aphids) {
      expect(a.sinceThink).toBeCloseTo(a.phase * APHID.thinkS, 12);
      expect(a.hunger).toBeLessThan(APHID.needs.feedAt);
      expect(a.fatigue).toBeLessThan(APHID.needs.restAt);
    }
  });

  it('the population knows nothing of the rung: a species with different caps places the same creatures', () => {
    const richer: CreatureSpecies = {
      ...EARTHWORM,
      population: { ...EARTHWORM.population, caps: { 'ultra-low': 1, low: 1, medium: 1, high: 1, 'ultra-high': 1 } },
    };
    expect(populateCreatures(CELL, richer, options('wetland'))).toEqual(populateCreatures(CELL, EARTHWORM, options('wetland')));
  });
});
