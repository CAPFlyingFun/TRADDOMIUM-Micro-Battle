/**
 * The resource layer (Phase 7, the ecology pass), held to Joshua's
 * brief: resources are DERIVED from the deterministic plants and the
 * REAL water, placed by nothing, bounded per cell so no kind crowds out
 * the rest, and the water is a world system the layer asks and never
 * copies.
 *
 *   same cell, same seed → the same sites, in any order, after any others
 *   a different seed → different sites
 *   no nectar without flowers; sap on every tree, low on the trunk
 *   seeds only from a seed head; litter on a forest floor with no leaves
 *   honeydew hosts only at the aphid's host families
 *   water-edge only beside fresh water, never at sea, none without water
 *   the cap holds and every kind survives it
 *   the layer streams nearest first, evicts, refreshes water on time
 *   nothing is NaN
 *
 * Hand-built fake worlds throughout — plain functions, no three, no
 * island: the rules are the subject, not the survey.
 */
import { describe, expect, it } from 'vitest';
import { APHID } from '../src/creatures/species';
import { world, type WorldPoint } from '../src/world/coords';
import { UNITS_PER_METRE } from '../src/world/dem';
import {
  FLOOR_LITTER_PER_SIDE, MAX_SITES_PER_CELL, NECTAR_UL, PLANT_SITE_BUDGET, SAP_ABOVE, SEEDS_PER_HEAD, SEED_HEAD_VARIANT,
  WATER_EDGE_BUDGET, WATER_FRONTAGE_MM_PER_NEIGHBOUR, WATER_LATTICE_PER_SIDE, deriveCellResources, deriveWaterEdgeSites,
  fairShares,
} from '../src/world/ecology/derive';
import { EVICT_BEYOND, ResourceLayer } from '../src/world/ecology/ResourceLayer';
import {
  HONEYDEW_HOST_FAMILIES, OFFERED_KINDS, RESOURCE_KINDS,
  type CellResources, type EcologyWorld, type PlantSource, type ResourceKind, type ResourceSite, type WaterQuery,
} from '../src/world/ecology/resources';
import { waterQueryOf } from '../src/world/ecology/waterQuery';
import { SEA_LEVEL } from '../src/world/heightfield';
import { CELL_SPAN, cellCentre } from '../src/world/objects/cells';
import type { WaterSpot } from '../src/world/water/router';

const M = UNITS_PER_METRE;
const SEED = 7;

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type Hab = ReturnType<EcologyWorld['habitatAt']>;
const GRASSLAND: Hab = { kind: 'grassland', wet: 0, forest: 0.1, grass: 0.9 };
const FOREST: Hab = { kind: 'forest', wet: 0.1, forest: 0.9, grass: 0.1 };
const SEA: Hab = { kind: 'sea', wet: 0, forest: 0, grass: 0 };

interface FakeOptions {
  readonly plants?: (cx: number, cz: number) => readonly PlantSource[] | null;
  readonly habitat?: (at: WorldPoint) => Hab;
  readonly water?: WaterQuery | null;
}

function fakeWorld(o: FakeOptions = {}): EcologyWorld {
  const water = o.water ?? null;
  return { habitatAt: o.habitat ?? (() => GRASSLAND), plantsOf: o.plants ?? (() => []), water };
}

/** A point at fractions (u, v) across cell (cx, cz). */
function inCell(cx: number, cz: number, u: number, v: number): WorldPoint {
  return world((cx + u) * CELL_SPAN, (cz + v) * CELL_SPAN);
}

function plant(family: string, at: WorldPoint, size: number, variant = 0, id: string | null = null): PlantSource {
  return { family, at, size, variant, id };
}

/** A cell's worth of one family on a lattice, `n` a side, ids where `major`. */
function lattice(cx: number, cz: number, family: string, n: number, size: number, variant = 0, major = false): PlantSource[] {
  const out: PlantSource[] = [];
  for (let iz = 0; iz < n; iz += 1) {
    for (let ix = 0; ix < n; ix += 1) {
      const slot = iz * n + ix;
      out.push(plant(family, inCell(cx, cz, (ix + 0.5) / n, (iz + 0.5) / n), size, variant, major ? `${family}:${cx},${cz}:${slot}` : null));
    }
  }
  return out;
}

/** A pond: fresh water `depth` deep inside `radius` of `centre`; sea where wx < `seaWestOf`. Mutable, so rain can fall. */
function pond(centre: WorldPoint, radius: number, depth: number, seaWestOf = Number.NEGATIVE_INFINITY): WaterQuery & { rain(depth: number): void } {
  let d = depth;
  return {
    freshDepthAt: (at) => {
      if (at.wx < seaWestOf) return 0;
      const dx = at.wx - centre.wx;
      const dz = at.wz - centre.wz;
      return dx * dx + dz * dz <= radius * radius ? d : 0;
    },
    isSeaAt: (at) => at.wx < seaWestOf,
    // A pond drawn as a disc has no shoreline list to walk; the edge sites come from `freshDepthAt`'s lattice.
    nearestWater: () => null,
    rain: (next) => { d = next; },
  };
}

const bytes = (cell: CellResources): string => JSON.stringify(cell);
const ofKind = (cell: CellResources, kind: ResourceKind): ResourceSite[] => cell.sites.filter((s) => s.kind === kind);
const countBy = (cell: CellResources): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const s of cell.sites) out[s.kind] = (out[s.kind] ?? 0) + 1;
  return out;
};

function expectFinite(cell: CellResources): void {
  for (const s of cell.sites) {
    expect(Number.isFinite(s.at.wx), `${s.id} wx`).toBe(true);
    expect(Number.isFinite(s.at.wz), `${s.id} wz`).toBe(true);
    expect(Number.isFinite(s.above), `${s.id} above`).toBe(true);
    expect(Number.isFinite(s.amount), `${s.id} amount`).toBe(true);
    expect(s.amount).toBeGreaterThanOrEqual(0);
    expect(s.above).toBeGreaterThanOrEqual(0);
  }
}

/** A mixed cell: flowers, trees, leaves, seed heads, plain grass, a shrub, a fern, a reed, a coastal plant. */
function mixedPlants(cx: number, cz: number): PlantSource[] {
  return [
    plant('flower', inCell(cx, cz, 0.1, 0.1), 25, 0, `flower:${cx},${cz}:0`),
    plant('flower', inCell(cx, cz, 0.9, 0.2), 40, 1, `flower:${cx},${cz}:1`),
    plant('tree', inCell(cx, cz, 0.5, 0.5), 12 * M, 0, `tree:${cx},${cz}:5`),
    plant('tree', inCell(cx, cz, 0.3, 0.8), 3 * M, 1, `tree:${cx},${cz}:9`),
    plant('leaf', inCell(cx, cz, 0.7, 0.7), 8),
    plant('grass', inCell(cx, cz, 0.2, 0.4), 30, SEED_HEAD_VARIANT),
    plant('grass', inCell(cx, cz, 0.25, 0.45), 20, 0),
    plant('grass', inCell(cx, cz, 0.3, 0.5), 22, 1),
    plant('shrub', inCell(cx, cz, 0.6, 0.3), 120, 0, `shrub:${cx},${cz}:2`),
    plant('fern', inCell(cx, cz, 0.8, 0.6), 60),
    plant('broadleaf', inCell(cx, cz, 0.85, 0.85), 50),
    plant('reed', inCell(cx, cz, 0.15, 0.9), 150),
    plant('coastal', inCell(cx, cz, 0.95, 0.95), 80),
  ];
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

describe('the contract', () => {
  it('names every kind once, offers a subset of them, and hosts are the aphid\'s own list', () => {
    expect(new Set(RESOURCE_KINDS).size).toBe(RESOURCE_KINDS.length);
    for (const kind of OFFERED_KINDS) expect(RESOURCE_KINDS).toContain(kind);
    expect(RESOURCE_KINDS).toContain('fruit');
    expect(RESOURCE_KINDS).toContain('carrion');
    expect([...HONEYDEW_HOST_FAMILIES]).toEqual([...(APHID.population.hosts ?? [])]);
    expect(MAX_SITES_PER_CELL).toBe(96);
    expect(PLANT_SITE_BUDGET + WATER_EDGE_BUDGET).toBe(MAX_SITES_PER_CELL);
  });
});

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

describe('derivation is deterministic', () => {
  const w = fakeWorld({ plants: mixedPlants, water: pond(inCell(3, 4, 0.5, 0.5), 3 * M, 20) });

  it('gives the same cell twice, in any order, after other cells', () => {
    const first = deriveCellResources(3, 4, w, SEED);
    deriveCellResources(4, 4, w, SEED);
    deriveCellResources(-2, 9, w, SEED);
    const again = deriveCellResources(3, 4, w, SEED);
    expect(bytes(again)).toBe(bytes(first));
    expect(first.sites.length).toBeGreaterThan(5);
  });

  it('a different seed is a different answer', () => {
    const a = deriveCellResources(3, 4, w, SEED);
    const b = deriveCellResources(3, 4, w, SEED + 1);
    expect(bytes(b)).not.toBe(bytes(a));
    // Same plants, same kinds, same count — the seed moves the numbers, not the flowers.
    expect(countBy(b)).toEqual(countBy(a));
  });

  it('ids are unique, name their kind and cell, and carry the plant\'s id as owner where it has one', () => {
    const cell = deriveCellResources(3, 4, w, SEED);
    const ids = cell.sites.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of cell.sites) expect(s.id.startsWith(`${s.kind}:3,4:`), s.id).toBe(true);
    const sap = ofKind(cell, 'sap');
    expect(sap.map((s) => s.ownerId).sort()).toEqual(['tree:3,4:5', 'tree:3,4:9']);
    for (const s of ofKind(cell, 'water-edge')) expect(s.ownerId).toBeNull();
  });

  it('refuses a cell address that is not two integers', () => {
    expect(() => deriveCellResources(1.5, 0, w, SEED)).toThrow(/two integers/);
    expect(() => deriveCellResources(Number.NaN, 0, w, SEED)).toThrow(/two integers/);
  });
});

describe('each kind follows its rule', () => {
  it('no nectar without flowers; a flower head at the plant\'s height, within the standing-crop range', () => {
    const bare = fakeWorld({ plants: (cx, cz) => [plant('grass', inCell(cx, cz, 0.5, 0.5), 20), plant('tree', inCell(cx, cz, 0.2, 0.2), 900)] });
    expect(ofKind(deriveCellResources(0, 0, bare, SEED), 'nectar')).toEqual([]);
    const cell = deriveCellResources(3, 4, fakeWorld({ plants: mixedPlants }), SEED);
    const nectar = ofKind(cell, 'nectar');
    expect(nectar).toHaveLength(2);
    for (const s of nectar) {
      expect(s.amount).toBeGreaterThanOrEqual(NECTAR_UL[0]);
      expect(s.amount).toBeLessThanOrEqual(NECTAR_UL[1]);
      expect(s.ownerId).toMatch(/^flower:/);
    }
    const heads = nectar.map((s) => s.above).sort((a, b) => a - b);
    expect(heads).toEqual([25, 40]);
  });

  it('sap on every tree, low on the trunk, more of it on a bigger tree', () => {
    const cell = deriveCellResources(3, 4, fakeWorld({ plants: mixedPlants }), SEED);
    const sap = ofKind(cell, 'sap');
    expect(sap).toHaveLength(2);
    for (const s of sap) {
      expect(s.above).toBeGreaterThanOrEqual(SAP_ABOVE[0]);
      expect(s.above).toBeLessThanOrEqual(SAP_ABOVE[1]);
      expect(s.amount).toBeGreaterThan(0);
    }
    const big = sap.find((s) => s.ownerId === 'tree:3,4:5')!;
    const small = sap.find((s) => s.ownerId === 'tree:3,4:9')!;
    expect(big.amount).toBeGreaterThan(small.amount);
    expect(big.amount / small.amount).toBeCloseTo(12 / 3, 9);
  });

  it('seeds only from a seed-head grass, five to forty of them, whole', () => {
    const cell = deriveCellResources(3, 4, fakeWorld({ plants: mixedPlants }), SEED);
    const seeds = ofKind(cell, 'seed');
    expect(seeds).toHaveLength(1);
    expect(seeds[0].above).toBe(30);
    expect(Number.isInteger(seeds[0].amount)).toBe(true);
    expect(seeds[0].amount).toBeGreaterThanOrEqual(SEEDS_PER_HEAD[0]);
    expect(seeds[0].amount).toBeLessThanOrEqual(SEEDS_PER_HEAD[1]);
    // Every variant across a lattice: only the seed head yields.
    for (const variant of [0, 1, 3]) {
      const w = fakeWorld({ plants: (cx, cz) => lattice(cx, cz, 'grass', 6, 20, variant) });
      expect(ofKind(deriveCellResources(0, 0, w, SEED), 'seed')).toEqual([]);
    }
    const heads = fakeWorld({ plants: (cx, cz) => lattice(cx, cz, 'grass', 3, 20, SEED_HEAD_VARIANT) });
    expect(ofKind(deriveCellResources(0, 0, heads, SEED), 'seed')).toHaveLength(9);
  });

  it('litter lies under a leaf, and on a forest floor with no leaf objects at all — but not on a grassland with none', () => {
    const leaves = deriveCellResources(3, 4, fakeWorld({ plants: mixedPlants }), SEED);
    const underLeaf = ofKind(leaves, 'litter');
    expect(underLeaf).toHaveLength(1);
    expect(underLeaf[0].above).toBe(0);
    expect(underLeaf[0].amount).toBeCloseTo(0.5 * 8 * 8, 9);

    const forest = fakeWorld({ habitat: () => FOREST });
    const floor = deriveCellResources(10, 10, forest, SEED);
    const litter = ofKind(floor, 'litter');
    expect(litter.length).toBeGreaterThan(0);
    expect(litter.length).toBeLessThanOrEqual(FLOOR_LITTER_PER_SIDE * FLOOR_LITTER_PER_SIDE);
    for (const s of litter) {
      expect(s.ownerId).toBeNull();
      expect(s.above).toBe(0);
      // Inside the cell.
      expect(s.at.wx).toBeGreaterThanOrEqual(10 * CELL_SPAN);
      expect(s.at.wx).toBeLessThan(11 * CELL_SPAN);
      expect(s.at.wz).toBeGreaterThanOrEqual(10 * CELL_SPAN);
      expect(s.at.wz).toBeLessThan(11 * CELL_SPAN);
    }
    // Every other kind is absent: the floor is litter and nothing else.
    expect(floor.sites.length).toBe(litter.length);

    const grassland = fakeWorld({ habitat: () => GRASSLAND });
    expect(deriveCellResources(10, 10, grassland, SEED).sites).toEqual([]);
  });

  it('the forest floor puts no litter where its ground is the sea', () => {
    // Forest at the centre, sea over the west half of the cell.
    const half = fakeWorld({ habitat: (at) => (at.wx < 10.5 * CELL_SPAN ? SEA : FOREST) });
    const cell = deriveCellResources(10, 10, half, SEED);
    expect(cell.sites.length).toBeGreaterThan(0);
    for (const s of cell.sites) expect(s.at.wx).toBeGreaterThanOrEqual(10.5 * CELL_SPAN);
  });

  it('honeydew hosts at the host families only', () => {
    const cell = deriveCellResources(3, 4, fakeWorld({ plants: mixedPlants }), SEED);
    const hosts = ofKind(cell, 'honeydew-host');
    // flowers 2, trees 2, grass 3, shrub 1, fern 1, broadleaf 1 = 10; leaf, reed, coastal are not hosts.
    expect(hosts).toHaveLength(10);
    const plants = mixedPlants(3, 4);
    for (const s of hosts) {
      const index = Number(s.id.split(':')[2]);
      expect(HONEYDEW_HOST_FAMILIES).toContain(plants[index].family);
      expect(s.above).toBeCloseTo(0.6 * plants[index].size, 9);
      expect(s.amount).toBe(plants[index].size);
    }
    for (const family of ['reed', 'coastal', 'leaf', 'moss']) {
      const w = fakeWorld({ plants: (cx, cz) => lattice(cx, cz, family, 4, 30) });
      expect(ofKind(deriveCellResources(0, 0, w, SEED), 'honeydew-host')).toEqual([]);
    }
  });

  it('a site stands where its plant stands', () => {
    const cell = deriveCellResources(3, 4, fakeWorld({ plants: mixedPlants }), SEED);
    const plants = mixedPlants(3, 4);
    for (const s of cell.sites) {
      if (s.kind === 'water-edge') continue;
      const index = Number(s.id.split(':')[2]);
      expect(s.at.wx).toBe(plants[index].at.wx);
      expect(s.at.wz).toBe(plants[index].at.wz);
    }
  });
});

describe('water-edge is asked of the real water', () => {
  it('none without a water', () => {
    expect(deriveWaterEdgeSites(3, 4, null, SEED)).toEqual([]);
    const w = fakeWorld({ plants: mixedPlants, water: null });
    expect(ofKind(deriveCellResources(3, 4, w, SEED), 'water-edge')).toEqual([]);
  });

  it('stands on a dry lattice point beside a wet one, with frontage per wet neighbour, and never in the water', () => {
    const centre = inCell(3, 4, 0.5, 0.5);
    const water = pond(centre, 3 * M, 20);
    const sites = deriveWaterEdgeSites(3, 4, water, SEED);
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.length).toBeLessThanOrEqual(WATER_EDGE_BUDGET);
    const pitch = CELL_SPAN / WATER_LATTICE_PER_SIDE;
    for (const s of sites) {
      expect(s.kind).toBe('water-edge');
      expect(s.above).toBe(0);
      expect(water.freshDepthAt(s.at)).toBe(0);
      expect(water.isSeaAt(s.at)).toBe(false);
      // Frontage is a whole number of neighbours' worth, one to four.
      const neighbours = s.amount / WATER_FRONTAGE_MM_PER_NEIGHBOUR;
      expect(Number.isInteger(neighbours)).toBe(true);
      expect(neighbours).toBeGreaterThanOrEqual(1);
      expect(neighbours).toBeLessThanOrEqual(4);
      // And that many of the four lattice neighbours are wet.
      let wet = 0;
      for (const [dx, dz] of [[pitch, 0], [-pitch, 0], [0, pitch], [0, -pitch]]) {
        if (water.freshDepthAt(world(s.at.wx + dx, s.at.wz + dz)) > 0) wet += 1;
      }
      expect(wet).toBe(neighbours);
      // On the cell's own lattice: a half-pitch offset from the cell's origin.
      expect(((s.at.wx - 3 * CELL_SPAN) / pitch) % 1).toBeCloseTo(0.5, 9);
      expect(((s.at.wz - 4 * CELL_SPAN) / pitch) % 1).toBeCloseTo(0.5, 9);
    }
    // A dry cell far from the pond has no edge.
    expect(deriveWaterEdgeSites(30, 40, water, SEED)).toEqual([]);
  });

  it('never at sea, even beside fresh water', () => {
    // A pond straddling the line where the sea begins: every edge on the sea side is refused.
    const line = 3.5 * CELL_SPAN;
    const water = pond(world(line, 4.5 * CELL_SPAN), 3 * M, 20, line);
    const sites = deriveWaterEdgeSites(3, 4, water, SEED);
    expect(sites.length).toBeGreaterThan(0);
    for (const s of sites) {
      expect(s.at.wx).toBeGreaterThanOrEqual(line);
      expect(water.isSeaAt(s.at)).toBe(false);
    }
    // And a cell wholly at sea beside a pond has none.
    const allSea: WaterQuery = { freshDepthAt: () => 0, isSeaAt: () => true, nearestWater: () => null };
    expect(deriveWaterEdgeSites(3, 4, allSea, SEED)).toEqual([]);
  });

  it('finds a bank whose water lies across the cell line', () => {
    // Water fills cell (4, 4) entirely; cell (3, 4) is dry. The east column of (3, 4) is an edge.
    const water: WaterQuery = { freshDepthAt: (at) => (at.wx >= 4 * CELL_SPAN ? 10 : 0), isSeaAt: () => false, nearestWater: () => null };
    const sites = deriveWaterEdgeSites(3, 4, water, SEED);
    expect(sites).toHaveLength(WATER_LATTICE_PER_SIDE);
    const pitch = CELL_SPAN / WATER_LATTICE_PER_SIDE;
    for (const s of sites) {
      expect(s.at.wx).toBeCloseTo(4 * CELL_SPAN - pitch / 2, 9);
      expect(s.amount).toBe(WATER_FRONTAGE_MM_PER_NEIGHBOUR);
    }
  });

  it('keeps its ids across a refresh: a slot is a slot', () => {
    const water = pond(inCell(3, 4, 0.5, 0.5), 3 * M, 20);
    const before = deriveWaterEdgeSites(3, 4, water, SEED);
    water.rain(50);
    const after = deriveWaterEdgeSites(3, 4, water, SEED);
    expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id));
    water.rain(0);
    expect(deriveWaterEdgeSites(3, 4, water, SEED)).toEqual([]);
  });
});

describe('the per-cell cap', () => {
  const crowded = (cx: number, cz: number): PlantSource[] => [
    ...lattice(cx, cz, 'grass', 50, 20),                    // 2,500 hosts
    ...lattice(cx, cz, 'flower', 12, 30, 0, true),          // 144 nectar + 144 hosts
    ...lattice(cx, cz, 'tree', 10, 800, 0, true),           // 100 sap + 100 hosts
    ...lattice(cx, cz, 'leaf', 8, 10),                      // 64 litter
    ...lattice(cx, cz, 'grass', 6, 25, SEED_HEAD_VARIANT),  // 36 seed + 36 hosts
  ];

  it('holds at 96 with every kind present, shared fairly, and the water in its own reserve', () => {
    const w = fakeWorld({ plants: crowded, water: pond(inCell(0, 0, 0.5, 0.5), 5 * M, 20) });
    const cell = deriveCellResources(0, 0, w, SEED);
    expect(cell.sites.length).toBeLessThanOrEqual(MAX_SITES_PER_CELL);
    const by = countBy(cell);
    // Five plant kinds, each with more than an equal share: sixteen each.
    for (const kind of ['nectar', 'seed', 'sap', 'litter', 'honeydew-host']) expect(by[kind], kind).toBe(PLANT_SITE_BUDGET / 5);
    expect(by['water-edge']).toBeGreaterThan(0);
    expect(by['water-edge']).toBeLessThanOrEqual(WATER_EDGE_BUDGET);
    expect(new Set(cell.sites.map((s) => s.id)).size).toBe(cell.sites.length);
    expectFinite(cell);
  });

  it('one flower among thousands of blades keeps its nectar; the hosts take what is left', () => {
    const w = fakeWorld({ plants: (cx, cz) => [...lattice(cx, cz, 'grass', 70, 20), plant('flower', inCell(cx, cz, 0.5, 0.5), 30, 0, 'flower:0,0:0')] });
    const by = countBy(deriveCellResources(0, 0, w, SEED));
    expect(by.nectar).toBe(1);
    expect(by['honeydew-host']).toBe(PLANT_SITE_BUDGET - 1);
  });

  it('the kept sites are the same sites whatever else the cell holds nearby, and are spread over the cell', () => {
    const w = fakeWorld({ plants: crowded });
    const cell = deriveCellResources(0, 0, w, SEED);
    const hosts = ofKind(cell, 'honeydew-host');
    // Spread: not all in one quarter.
    const quarters = new Set(hosts.map((s) => `${s.at.wx < 0.5 * CELL_SPAN ? 'w' : 'e'}${s.at.wz < 0.5 * CELL_SPAN ? 'n' : 's'}`));
    expect(quarters.size).toBeGreaterThan(1);
    // Determinism through the cap: the same sixteen again.
    expect(bytes(deriveCellResources(0, 0, w, SEED))).toBe(bytes(cell));
  });

  it('the fair-share rule, to its words', () => {
    expect(fairShares([2, 5000], 80)).toEqual([2, 78]);
    expect(fairShares([1, 1, 1000, 500], 80)).toEqual([1, 1, 39, 39]);
    expect(fairShares([10, 10, 10], 80)).toEqual([10, 10, 10]);
    expect(fairShares([0, 50, 0], 80)).toEqual([0, 50, 0]);
    const three = fairShares([100, 100, 100], 80);
    expect(three.reduce((a, b) => a + b, 0)).toBe(80);
    for (const s of three) expect(s).toBeGreaterThanOrEqual(26);
    expect(fairShares([], 80)).toEqual([]);
    expect(fairShares([5, 5], 0)).toEqual([0, 0]);
  });
});

describe('nothing is NaN', () => {
  it('a plant with no size still stands, a plant nowhere does not, and every number is finite', () => {
    const w = fakeWorld({
      plants: (cx, cz) => [
        plant('flower', inCell(cx, cz, 0.2, 0.2), Number.NaN, 0, 'flower:0,0:0'),
        plant('tree', world(Number.NaN, 5), 900, 0, 'tree:0,0:nowhere'),
        plant('shrub', inCell(cx, cz, 0.4, 0.4), Number.POSITIVE_INFINITY, 0, 'shrub:0,0:0'),
        plant('tree', inCell(cx, cz, 0.6, 0.6), -5, 0, 'tree:0,0:1'),
        plant('grass', inCell(cx, cz, 0.7, 0.7), 20, SEED_HEAD_VARIANT),
      ],
      water: { freshDepthAt: () => Number.NaN, isSeaAt: () => false, nearestWater: () => null },
    });
    const cell = deriveCellResources(0, 0, w, SEED);
    expectFinite(cell);
    expect(cell.sites.some((s) => s.ownerId === 'tree:0,0:nowhere')).toBe(false);
    expect(ofKind(cell, 'nectar')).toHaveLength(1);
    expect(ofKind(cell, 'sap')).toHaveLength(1);
    expect(ofKind(cell, 'water-edge')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The water adapter
// ---------------------------------------------------------------------------

describe('waterQueryOf', () => {
  const fresh: WaterSpot = { kind: 'fresh', surface: 35, depth: 25, flowX: 0, flowZ: 0 };
  const sea: WaterSpot = { kind: 'sea', surface: 12, depth: 60, flowX: 1, flowZ: 0 };
  // Fresh west of 100; a sea spot between 1,000 and 2,000; ground below MSL past 2,000 with no spot at all.
  const spots = {
    spotAt: (at: WorldPoint): WaterSpot | null => (at.wx < 100 ? fresh : at.wx > 1000 && at.wx <= 2000 ? sea : null),
  };
  const groundAt = (at: WorldPoint): number => (at.wx > 2000 ? SEA_LEVEL - 50 : SEA_LEVEL + 10);
  const q = waterQueryOf(spots, groundAt);

  it('reads a fresh spot\'s own depth, and dry ground as zero', () => {
    expect(q.freshDepthAt(world(50, 0))).toBe(25);
    expect(q.isSeaAt(world(50, 0))).toBe(false);
    expect(q.freshDepthAt(world(500, 0))).toBe(0);
    expect(q.isSeaAt(world(500, 0))).toBe(false);
  });

  it('a sea spot is sea and no fresh depth; ground below sea level is sea even with no spot', () => {
    expect(q.freshDepthAt(world(1500, 0))).toBe(0);
    expect(q.isSeaAt(world(1500, 0))).toBe(true);
    expect(q.freshDepthAt(world(2500, 0))).toBe(0);
    expect(q.isSeaAt(world(2500, 0))).toBe(true);
  });

  it('a depth that is not a number is not a depth', () => {
    const odd = waterQueryOf({ spotAt: () => ({ kind: 'fresh', surface: 1, depth: Number.NaN, flowX: 0, flowZ: 0 }) }, () => 10);
    expect(odd.freshDepthAt(world(0, 0))).toBe(0);
    const neg = waterQueryOf({ spotAt: () => ({ kind: 'fresh', surface: 1, depth: -3, flowX: 0, flowZ: 0 }) }, () => 10);
    expect(neg.freshDepthAt(world(0, 0))).toBe(0);
  });

  it('is read-only by construction, and a NaN ground defers to the spot', () => {
    expect(Object.isFrozen(q)).toBe(true);
    const unknown = waterQueryOf(spots, () => Number.NaN);
    expect(unknown.isSeaAt(world(1500, 0))).toBe(true);
    expect(unknown.isSeaAt(world(2500, 0))).toBe(false);
  });

  describe('nearestWater', () => {
    // A shoreline running north-south at wx = 0, one point a metre, plus one stray point far east.
    const bank: WorldPoint[] = [];
    for (let i = -20; i <= 20; i += 1) bank.push(world(0, i * 100));
    bank.push(world(5000, 0));
    const shore = { spotAt: spots.spotAt, shoreline: () => bank };
    const withEdge = waterQueryOf(shore, groundAt);

    it('a source with no shoreline answers null, which is "none in reach" and not an error', () => {
      expect(q.nearestWater(world(0, 0), 10_000)).toBeNull();
    });

    it('finds the nearest point inside the radius, with its distance, and nothing outside it', () => {
      // Standing 3 m east of the bank and 30 cm north of a lattice point: the nearest is that point.
      const near = withEdge.nearestWater(world(300, 130), 1000);
      expect(near).not.toBeNull();
      expect(near!.at).toBe(bank[21]); // (0, 100): the solver's own point, not a copy
      expect(near!.distance).toBeCloseTo(Math.hypot(300, 30), 9);
      // The same spot with a reach shorter than the gap: nothing.
      expect(withEdge.nearestWater(world(300, 130), 250)).toBeNull();
      // Far from the bank but inside reach of the stray: the stray wins, because it is nearer.
      const stray = withEdge.nearestWater(world(4800, 10), 10_000);
      expect(stray!.at).toBe(bank[bank.length - 1]);
    });

    it('is strictly inside the radius, and a bad radius or a bad point asks nothing', () => {
      expect(withEdge.nearestWater(world(100, 0), 100)).toBeNull();
      expect(withEdge.nearestWater(world(100, 0), 100.001)).not.toBeNull();
      for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(withEdge.nearestWater(world(100, 0), bad), `radius ${bad}`).toBeNull();
      expect(withEdge.nearestWater(world(Number.NaN, 0), 1000)).toBeNull();
      expect(withEdge.nearestWater(world(0, Number.POSITIVE_INFINITY), 1000)).toBeNull();
    });

    it('reads the shoreline afresh each call, so an edge that moves is seen to move', () => {
      let line = 0;
      const moving = waterQueryOf({ spotAt: () => null, shoreline: () => [world(line, 0)] }, groundAt);
      expect(moving.nearestWater(world(1000, 0), 5000)!.distance).toBe(1000);
      line = 400;
      expect(moving.nearestWater(world(1000, 0), 5000)!.distance).toBe(600);
    });
  });
});

// ---------------------------------------------------------------------------
// The layer
// ---------------------------------------------------------------------------

describe('ResourceLayer', () => {
  /**
   * The streaming radius the layer tests use. From a cell's centre it
   * reaches the four edge neighbours (800 away) and not the diagonals
   * (1,131). Not 800 exactly: `cellsWithin` bounds its search by
   * `cellAt(at ± radius)`, and at the exact boundary the low side floors
   * to the focus cell — an edge case of the cells' own, sat beside here
   * rather than on.
   */
  const REACH = 1000;
  /** A flower at every cell's centre, named for its cell, plus a tree — so every cell has something to count. */
  const everywhere = (cx: number, cz: number): PlantSource[] => [
    plant('flower', cellCentre({ cx, cz }), 30, 0, `flower:${cx},${cz}:0`),
    plant('tree', inCell(cx, cz, 0.25, 0.25), 600, 0, `tree:${cx},${cz}:0`),
  ];

  it('streams nearest first, a few cells an update, and reports what is pending', () => {
    const layer = new ResourceLayer({ world: fakeWorld({ plants: everywhere }), seed: SEED, cellsPerUpdate: 2 });
    // A focus in cell (0, 0), a little east of centre: (1, 0) at 600 is nearer than (0, ±1) at 800; (-1, 0) at 1,000 is out of reach.
    const focus = world(1000, 800);
    layer.update(focus, 900, 1 / 60);
    expect(layer.residentCells()).toBe(2);
    expect(layer.sitesOf(0, 0)).not.toBeNull();
    expect(layer.sitesOf(1, 0)).not.toBeNull();
    expect(layer.sitesOf(0, 1)).toBeNull();
    expect(layer.sitesOf(0, -1)).toBeNull();
    expect(layer.pending()).toBe(2);
    layer.update(focus, 900, 1 / 60);
    expect(layer.residentCells()).toBe(4);
    expect(layer.pending()).toBe(0);
    expect(layer.sitesOf(0, 1)).not.toBeNull();
    expect(layer.sitesOf(0, -1)).not.toBeNull();
    expect(layer.sitesOf(-1, 0)).toBeNull();
    // Idle updates change nothing.
    layer.update(focus, 900, 1 / 60);
    expect(layer.residentCells()).toBe(4);
  });

  it('evicts cells beyond radius × EVICT_BEYOND when the focus moves, and not before', () => {
    const layer = new ResourceLayer({ world: fakeWorld({ plants: everywhere }), seed: SEED, cellsPerUpdate: 16 });
    // From a cell's centre at REACH (1,000): the cell and its four neighbours (800 away); the diagonals (1,131) are out.
    layer.update(cellCentre({ cx: 0, cz: 0 }), REACH, 1);
    expect(layer.residentCells()).toBe(5);
    // Step to the centre of (1, 0). From there (-1, 0)'s square is 2,400 away — beyond 1,000 × 1.25 — and goes;
    // (0, ±1)'s squares are 1,131 away — inside the hysteresis — and stay.
    layer.update(cellCentre({ cx: 1, cz: 0 }), REACH, 1);
    expect(layer.sitesOf(-1, 0)).toBeNull();
    expect(layer.sitesOf(0, 1)).not.toBeNull();
    expect(layer.sitesOf(0, -1)).not.toBeNull();
    expect(layer.sitesOf(0, 0)).not.toBeNull();
    expect(EVICT_BEYOND).toBe(1.25);
    // Far away: everything old goes.
    layer.update(cellCentre({ cx: 40, cz: 40 }), REACH, 1);
    expect(layer.sitesOf(0, 0)).toBeNull();
    expect(layer.sitesOf(1, 0)).toBeNull();
    expect(layer.residentCells()).toBe(5);
    expect(layer.sitesOf(40, 40)).not.toBeNull();
  });

  it('refreshes water-edge after the interval when the water changed, and not before, leaving the plants\' sites the same objects', () => {
    const water = pond(cellCentre({ cx: 0, cz: 0 }), 3 * M, 0);
    const layer = new ResourceLayer({ world: fakeWorld({ plants: everywhere, water }), seed: SEED, cellsPerUpdate: 16, waterRefreshS: 10 });
    const focus = cellCentre({ cx: 0, cz: 0 });
    layer.update(focus, REACH, 1);
    const before = layer.sitesOf(0, 0)!;
    expect(layer.counts()['water-edge']).toBe(0);
    const nectarBefore = ofKind(before, 'nectar')[0];
    // Rain: the pond fills. Nothing changes until the interval has passed.
    water.rain(30);
    for (let i = 0; i < 8; i += 1) layer.update(focus, REACH, 1);
    expect(layer.counts()['water-edge']).toBe(0);
    expect(layer.sitesOf(0, 0)).toBe(before);
    layer.update(focus, REACH, 1);
    layer.update(focus, REACH, 1);
    const after = layer.sitesOf(0, 0)!;
    expect(after).not.toBe(before);
    expect(ofKind(after, 'water-edge').length).toBeGreaterThan(0);
    expect(layer.counts()['water-edge']).toBeGreaterThan(0);
    // The flower did not move: the same site object, and the same plant sites in the same order.
    expect(ofKind(after, 'nectar')[0]).toBe(nectarBefore);
    expect(after.sites.filter((s) => s.kind !== 'water-edge')).toEqual(before.sites);
    // The pond dries: the edges go on the next refresh.
    water.rain(0);
    for (let i = 0; i < 10; i += 1) layer.update(focus, REACH, 1);
    expect(layer.counts()['water-edge']).toBe(0);
  });

  it('spreads a refresh over updates, a few cells each, and a null water refreshes nothing', () => {
    // A 9.5 m pond about the centre cell: past the neighbours' nearest samples (9 m) and short of the
    // centre cell's corner samples (9.9 m), so its edge runs through every one of the five cells.
    const water = pond(cellCentre({ cx: 0, cz: 0 }), 9.5 * M, 30);
    const layer = new ResourceLayer({ world: fakeWorld({ plants: everywhere, water }), seed: SEED, cellsPerUpdate: 1, waterRefreshS: 5 });
    const focus = cellCentre({ cx: 0, cz: 0 });
    // dt is a binary fraction so the interval arithmetic below is exact.
    const dt = 0.125;
    for (let i = 0; i < 5; i += 1) layer.update(focus, REACH, dt);
    expect(layer.residentCells()).toBe(5);
    const full = layer.counts()['water-edge'];
    expect(full).toBeGreaterThan(4);
    for (const cell of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      expect(ofKind(layer.sitesOf(cell[0], cell[1])!, 'water-edge').length, `cell ${cell}`).toBeGreaterThan(0);
    }
    water.rain(0);
    // Up to the interval, nothing: the first cell was derived at 0.125 s and is due at 5.125 s.
    for (let i = 0; i < 35; i += 1) layer.update(focus, REACH, dt);
    expect(layer.counts()['water-edge']).toBe(full);
    // Then one cell an update, so the edges vanish a cell at a time.
    layer.update(focus, REACH, dt);
    const one = layer.counts()['water-edge'];
    expect(one).toBeLessThan(full);
    expect(one).toBeGreaterThan(0);
    layer.update(focus, REACH, dt);
    const two = layer.counts()['water-edge'];
    expect(two).toBeLessThan(one);
    expect(two).toBeGreaterThan(0);
    for (let i = 0; i < 3; i += 1) layer.update(focus, REACH, dt);
    expect(layer.counts()['water-edge']).toBe(0);

    const dry = new ResourceLayer({ world: fakeWorld({ plants: everywhere, water: null }), seed: SEED, cellsPerUpdate: 16, waterRefreshS: 1 });
    dry.update(focus, REACH, 1);
    for (let i = 0; i < 5; i += 1) dry.update(focus, REACH, 1);
    expect(dry.counts()['water-edge']).toBe(0);
    expect(dry.residentCells()).toBe(5);
  });

  it('nearest finds the nearest of the asked kinds within the radius, and null outside or for kinds not asked', () => {
    const layer = new ResourceLayer({ world: fakeWorld({ plants: everywhere }), seed: SEED, cellsPerUpdate: 16 });
    const focus = cellCentre({ cx: 0, cz: 0 });
    layer.update(focus, 2 * CELL_SPAN, 1);
    expect(layer.residentCells()).toBeGreaterThan(9);
    // From just east of (0, 0)'s centre, the nearest flower is (0, 0)'s own.
    const at = world(focus.wx + 100, focus.wz);
    expect(layer.nearest(at, ['nectar'], 5 * M)?.ownerId).toBe('flower:0,0:0');
    // Ask for sap only: the tree at (0.25, 0.25) of the cell is 400 + ... away; the flower is ignored.
    expect(layer.nearest(at, ['sap'], 20 * M)?.ownerId).toBe('tree:0,0:0');
    // Either kind: the flower, at 100, wins.
    expect(layer.nearest(at, ['sap', 'nectar'], 20 * M)?.kind).toBe('nectar');
    // Too far: null. No kinds: null. A kind nobody offers: null.
    expect(layer.nearest(at, ['nectar'], 50)).toBeNull();
    expect(layer.nearest(at, [], 50 * M)).toBeNull();
    expect(layer.nearest(at, ['carrion'], 50 * M)).toBeNull();
    // From (0, 0)'s centre exactly, the flower is at distance 0 and is found even at radius 0.
    expect(layer.nearest(focus, ['nectar'], 0)?.ownerId).toBe('flower:0,0:0');
    // Across cells: from near the east edge of (0, 0), the tree of (1, 0) at (2000, 400) is 640 away
    // and (0, 0)'s own at (400, 400) is 1,170 — the search reads the neighbour's cell.
    const east = world(1500, focus.wz);
    expect(layer.nearest(east, ['sap'], CELL_SPAN)?.ownerId).toBe('tree:1,0:0');
    // The flowers are 700 and 900 away: (0, 0)'s wins, and a radius short of it finds nothing.
    expect(layer.nearest(east, ['nectar'], CELL_SPAN)?.ownerId).toBe('flower:0,0:0');
    expect(layer.nearest(east, ['nectar'], 600)).toBeNull();
  });

  it('counts sum the resident cells and name every kind', () => {
    const layer = new ResourceLayer({ world: fakeWorld({ plants: everywhere }), seed: SEED, cellsPerUpdate: 16 });
    expect(Object.keys(layer.counts()).sort()).toEqual([...RESOURCE_KINDS].sort());
    for (const kind of RESOURCE_KINDS) expect(layer.counts()[kind]).toBe(0);
    layer.update(cellCentre({ cx: 0, cz: 0 }), REACH, 1);
    const c = layer.counts();
    expect(layer.residentCells()).toBe(5);
    expect(c.nectar).toBe(5);
    expect(c.sap).toBe(5);
    expect(c['honeydew-host']).toBe(10);
    expect(c.seed).toBe(0);
    expect(c.carrion).toBe(0);
    expect(c.fruit).toBe(0);
  });

  it('waits for a cell whose plants are not generated, and derives it the update they appear', () => {
    let ready = false;
    const w = fakeWorld({ plants: (cx, cz) => (cx === 1 && cz === 0 && !ready ? null : everywhere(cx, cz)) });
    const layer = new ResourceLayer({ world: w, seed: SEED, cellsPerUpdate: 16 });
    const focus = cellCentre({ cx: 0, cz: 0 });
    for (let i = 0; i < 3; i += 1) layer.update(focus, REACH, 1);
    expect(layer.residentCells()).toBe(4);
    expect(layer.pending()).toBe(1);
    expect(layer.sitesOf(1, 0)).toBeNull();
    ready = true;
    layer.update(focus, REACH, 1);
    expect(layer.residentCells()).toBe(5);
    expect(layer.pending()).toBe(0);
    expect(layer.sitesOf(1, 0)?.sites.length).toBeGreaterThan(0);
  });

  it('a waiting cell does not block the ones behind it', () => {
    const w = fakeWorld({ plants: (cx, cz) => (cx === 0 && cz === 0 ? null : everywhere(cx, cz)) });
    const layer = new ResourceLayer({ world: w, seed: SEED, cellsPerUpdate: 1 });
    const focus = cellCentre({ cx: 0, cz: 0 });
    layer.update(focus, REACH, 1);
    // The nearest cell is the one waiting; the next nearest was derived instead.
    expect(layer.residentCells()).toBe(1);
    expect(layer.sitesOf(0, 0)).toBeNull();
  });

  it('measures its cost on the injected clock, and never on one it was not given', () => {
    let t = 0;
    let step = 3;
    const w = fakeWorld({ plants: everywhere });
    const layer = new ResourceLayer({ world: w, seed: SEED, now: () => (t += step) });
    const focus = cellCentre({ cx: 0, cz: 0 });
    layer.update(focus, REACH, 1);
    expect(layer.cost).toEqual({ meanMs: 3, peakMs: 3 });
    step = 9;
    layer.update(focus, REACH, 1);
    expect(layer.cost).toEqual({ meanMs: 6, peakMs: 9 });
    layer.resetCost();
    expect(layer.cost).toEqual({ meanMs: 0, peakMs: 0 });
    const silent = new ResourceLayer({ world: w, seed: SEED });
    silent.update(focus, REACH, 1);
    expect(silent.cost).toEqual({ meanMs: 0, peakMs: 0 });
  });

  it('refuses options that would make it do nothing or everything', () => {
    const w = fakeWorld({ plants: everywhere });
    expect(() => new ResourceLayer({ world: w, seed: SEED, cellsPerUpdate: 0 })).toThrow(/cellsPerUpdate/);
    expect(() => new ResourceLayer({ world: w, seed: SEED, cellsPerUpdate: 1.5 })).toThrow(/cellsPerUpdate/);
    expect(() => new ResourceLayer({ world: w, seed: SEED, waterRefreshS: 0 })).toThrow(/waterRefreshS/);
    expect(() => new ResourceLayer({ world: w, seed: SEED, waterRefreshS: Number.NaN })).toThrow(/waterRefreshS/);
  });

  it('a NaN focus or a negative radius derives nothing and throws nothing', () => {
    const layer = new ResourceLayer({ world: fakeWorld({ plants: everywhere }), seed: SEED });
    layer.update(world(Number.NaN, 0), REACH, 1);
    layer.update(cellCentre({ cx: 0, cz: 0 }), -1, 1);
    expect(layer.residentCells()).toBe(0);
    expect(layer.pending()).toBe(0);
    expect(layer.nearest(world(Number.NaN, 0), ['nectar'], 100)).toBeNull();
  });
});
