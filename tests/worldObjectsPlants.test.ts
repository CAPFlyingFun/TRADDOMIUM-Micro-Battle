/**
 * The ecology pass's vegetation (Joshua, 2026-09-07: "Habitat decides
 * WHAT, generation decides WHERE, Detail Quality decides HOW MUCH.
 * Counts are CAPS, not quotas. Major objects never vanish by quality."),
 * held to it:
 *
 *   identity      a fern, a flower, a shrub stands at the same place and
 *                 size whatever families are asked for and at every rung
 *   habitat       a beach has coastal plants and no reeds, ferns or
 *                 flowers; a forest has ferns, litter and broad leaves
 *                 and no coastal plant; a grassland has flowers and about
 *                 fifteen percent seed-head grass; a wetland has reeds;
 *                 the sea has nothing; shrubs are sparse on rock, never
 *                 nothing
 *   caps          maximums — a cap bites where the habitat overfills it
 *                 and is nowhere near touched where it does not; the
 *                 thinning keeps the same plants as the cap tightens
 *   plant sources bounded per family, ids stable and never null, the
 *                 same for the same cell
 *   rest          a leaf lies along the slope and above the ground, a
 *                 shrub stands up and is bedded like a tree, nothing new
 *                 sits under the ground it stands on
 *   budget        the seven at `high` add at most 6,000 instances, and
 *                 climb the ladder without a step down
 *
 * The habitats are FAKES, uniform across a cell, built by the
 * classifier from a landcover mix the way tests/worldHabitat.test.ts
 * does — so each assertion is about ONE rule and not about where on
 * Kauaʻi a cell of that kind happens to be. The ground under the
 * renderer is the real survey, because the rest poses are read off it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { objectRadius } from '../src/assets/detailQuality';
import {
  WorldObjects, broadleafGeometry, coastalGeometry, fernGeometry, flowerGeometry, leafGeometry, reedGeometry, seedHeadGeometry, shrubGeometry,
} from '../src/flora/WorldObjects';
import { world, type WorldPoint } from '../src/world/coords';
import { UNITS_PER_METRE, decodeCoarse, decodeHdTile, hdTileAt, hdTileName } from '../src/world/dem';
import { repairGrid } from '../src/world/demRepair';
import { geoToWorld } from '../src/world/geo';
import { SEA_HABITAT, classify, type Habitat } from '../src/world/habitat';
import { Heightfield } from '../src/world/heightfield';
import type { CoverMix } from '../src/world/landcover';
import { OBJECT_BUDGETS, OBJECT_RUNGS } from '../src/world/objects/budget';
import { cellAt, cellsWithin, type ObjectCellId } from '../src/world/objects/cells';
import { FAMILY_SPECS, OBJECT_FAMILIES, type ObjectFamily } from '../src/world/objects/families';
import { PLANT_FAMILIES, PLANT_SOURCE_LIMIT, plantSourcesOf } from '../src/world/objects/plants';
import {
  GRASS_SEED_HEAD, SEED_HEAD_SHARE, SITES_PER_SIDE, populateCell, type CellPopulation, type FamilyBatch,
} from '../src/world/objects/populate';
import { WORLD_SEED } from '../src/world/objects/seed';
import { toLocal } from '../src/world/origin';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const M = UNITS_PER_METRE;

function bytes(file: string): ArrayBuffer {
  const b = readFileSync(path.join(ROOT, 'public', file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

const coarse = repairGrid(decodeCoarse(bytes('kauai-1025.bin'))).grid;

// ── the fake habitats: one rule each, uniform across a cell ──
const grassMix: CoverMix = { tree: 0, shrub: 0, grass: 1, bare: 0, water: 0, wetland: 0, canopy: 0, river: 0 };
const treeMix: CoverMix = { tree: 1, shrub: 0, grass: 0, bare: 0, water: 0, wetland: 0, canopy: 0.9, river: 0 };
const wetMix: CoverMix = { tree: 0.1, shrub: 0, grass: 0.3, bare: 0, water: 0, wetland: 0.6, canopy: 0.2, river: 0.3 };
const shrubMix: CoverMix = { tree: 0.2, shrub: 0.7, grass: 0.1, bare: 0, water: 0, wetland: 0, canopy: 0.3, river: 0 };
const bareMix: CoverMix = { tree: 0, shrub: 0.05, grass: 0.1, bare: 0.85, water: 0, wetland: 0, canopy: 0, river: 0 };

const GRASSLAND = classify(grassMix, 50 * M, 3, 3000 * M, false, null);
const FOREST = classify(treeMix, 200 * M, 8, 5000 * M, false, null);
const BEACH = classify(grassMix, 2 * M, 2, 10 * M, false, null);
const WETLAND = classify(wetMix, 5 * M, 1, 2000 * M, false, null);
const SHRUBLAND = classify(shrubMix, 120 * M, 6, 4000 * M, false, null);
const ROCKY = classify(bareMix, 300 * M, 50, 5000 * M, false, null);

const uniform = (h: Habitat) => (_at: WorldPoint): Habitat => h;
const CELL: ObjectCellId = { cx: 913, cz: -71 };
const grow = (h: Habitat, id = CELL, families?: readonly ObjectFamily[]): CellPopulation =>
  populateCell(id, { seed: WORLD_SEED, habitatAt: uniform(h), families });

function batchBytes(b: FamilyBatch): string {
  return JSON.stringify([
    b.count, Array.from(b.wx), Array.from(b.wz), Array.from(b.size), Array.from(b.girth), Array.from(b.spin),
    Array.from(b.lean), Array.from(b.leanDir), Array.from(b.tint), Array.from(b.rank), Array.from(b.variant), Array.from(b.site), b.ids,
  ]);
}

/** A family's count summed over a 3x3 of cells, for the sparse families a single cell may hold none of. */
function countOver9(h: Habitat, family: ObjectFamily): number {
  let n = 0;
  for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) n += grow(h, { cx: CELL.cx + dx, cz: CELL.cz + dz }, [family]).batches[family].count;
  return n;
}

const SEVEN = ['fern', 'reed', 'flower', 'leaf', 'shrub', 'broadleaf', 'coastal'] as const;

describe('the kinds the habitats grow', () => {
  it('a beach has coastal plants and no reeds, ferns or flowers', () => {
    expect(BEACH.kind).toBe('beach');
    const p = grow(BEACH);
    expect(p.batches.coastal.count).toBeGreaterThan(20);
    expect(p.batches.reed.count).toBe(0);
    expect(p.batches.fern.count).toBe(0);
    expect(p.batches.flower.count).toBe(0);
    expect(p.batches.broadleaf.count).toBe(0);
  });

  it('a forest has ferns, leaf litter and broad leaves, and no coastal plant', () => {
    expect(FOREST.kind).toBe('forest');
    const p = grow(FOREST);
    expect(p.batches.fern.count).toBeGreaterThan(50);
    expect(p.batches.leaf.count).toBeGreaterThan(500);
    expect(p.batches.broadleaf.count).toBeGreaterThan(50);
    expect(p.batches.coastal.count).toBe(0);
    // The forest interior does not bloom, and a reed has no water here.
    expect(p.batches.flower.count).toBeLessThan(10);
    expect(p.batches.reed.count).toBe(0);
    // Litter is the forest floor's: far more of it than a grassland has.
    expect(p.batches.leaf.count).toBeGreaterThan(grow(GRASSLAND).batches.leaf.count * 10);
  });

  it('a grassland has flowers and about fifteen percent seed-head grass, and nothing of the water or the shore', () => {
    expect(GRASSLAND.kind).toBe('grassland');
    const p = grow(GRASSLAND);
    expect(p.batches.flower.count).toBeGreaterThan(100);
    expect(p.batches.reed.count).toBe(0);
    expect(p.batches.fern.count).toBe(0);
    expect(p.batches.coastal.count).toBe(0);
    let heads = 0;
    for (let i = 0; i < p.batches.grass.count; i += 1) if (p.batches.grass.variant[i] === GRASS_SEED_HEAD) heads += 1;
    const share = heads / p.batches.grass.count;
    expect(p.batches.grass.count).toBeGreaterThan(2000);
    expect(share).toBeGreaterThan(SEED_HEAD_SHARE - 0.03);
    expect(share).toBeLessThan(SEED_HEAD_SHARE + 0.03);
    // A seed head stands taller than the blades around it, on average.
    let headHeight = 0, bladeHeight = 0, blades = 0;
    for (let i = 0; i < p.batches.grass.count; i += 1) {
      if (p.batches.grass.variant[i] === GRASS_SEED_HEAD) headHeight += p.batches.grass.size[i];
      else { bladeHeight += p.batches.grass.size[i]; blades += 1; }
    }
    expect(headHeight / heads).toBeGreaterThan(bladeHeight / blades);
    // The forest floor's short grass carries none.
    const wood = grow(FOREST);
    let woodHeads = 0;
    for (let i = 0; i < wood.batches.grass.count; i += 1) if (wood.batches.grass.variant[i] === GRASS_SEED_HEAD) woodHeads += 1;
    expect(woodHeads).toBe(0);
  });

  it('a wetland has reeds; the sea has nothing at all', () => {
    expect(WETLAND.kind).toBe('wetland');
    expect(grow(WETLAND).batches.reed.count).toBeGreaterThan(100);
    const sea = grow(SEA_HABITAT);
    expect(sea.total).toBe(0);
    for (const family of OBJECT_FAMILIES) expect(sea.batches[family].count, family).toBe(0);
  });

  it('shrubs are shrubland\'s first, the forest edge\'s next, and sparse on rock — never nothing', () => {
    const scrub = countOver9(SHRUBLAND, 'shrub');
    const rock = countOver9(ROCKY, 'shrub');
    const wood = countOver9(FOREST, 'shrub');
    expect(scrub).toBeGreaterThan(rock * 3);
    expect(scrub).toBeGreaterThan(wood);
    expect(rock).toBeGreaterThan(0);
    expect(rock).toBeLessThan(30);
  });

  it('a family that cannot be in a cell is skipped whole, and generated identically when it can', () => {
    // Nothing coastal three kilometres inland; the batch is empty, not merely thinned.
    expect(grow(GRASSLAND, CELL, ['coastal']).batches.coastal.count).toBe(0);
    expect(grow(GRASSLAND, CELL, ['reed']).batches.reed.count).toBe(0);
    // And where the drivers are nonzero the answer is the full lattice roll: the same bytes either way.
    const all = grow(FOREST);
    for (const family of SEVEN) expect(batchBytes(grow(FOREST, CELL, [family]).batches[family])).toBe(batchBytes(all.batches[family]));
  });

  it('every one of the seven stays inside its own cell and its lattice square, and never rolls a full site twice', () => {
    for (const [h, families] of [[FOREST, ['fern', 'leaf', 'broadleaf']], [GRASSLAND, ['flower']], [SHRUBLAND, ['shrub']], [WETLAND, ['reed']], [BEACH, ['coastal']]] as const) {
      const p = grow(h);
      const x0 = CELL.cx * 1600, z0 = CELL.cz * 1600;
      for (const f of families) {
        const b = p.batches[f];
        expect(b.count, f).toBeGreaterThan(0);
        const pitch = 1600 / SITES_PER_SIDE[f];
        const sites = new Set<number>();
        for (let i = 0; i < b.count; i += 1) {
          expect(b.wx[i]).toBeGreaterThan(x0);
          expect(b.wx[i]).toBeLessThan(x0 + 1600);
          expect(b.wz[i]).toBeGreaterThan(z0);
          expect(b.wz[i]).toBeLessThan(z0 + 1600);
          const fx = ((b.wx[i] - x0) / pitch) % 1;
          expect(fx).toBeGreaterThan(0.09);
          expect(fx).toBeLessThan(0.91);
          expect(sites.has(b.site[i])).toBe(false);
          sites.add(b.site[i]);
          expect(b.variant[i]).toBe(f === 'flower' ? b.variant[i] : 0);
          if (f === 'flower') expect(b.variant[i]).toBeLessThan(4);
        }
        if (FAMILY_SPECS[f].major) {
          expect(b.ids).toHaveLength(b.count);
          for (let i = 0; i < b.count; i += 1) expect(b.ids![i]).toBe(`${f}:${CELL.cx},${CELL.cz}:${b.site[i]}`);
        } else {
          expect(b.ids).toBeNull();
        }
      }
    }
  });
});

describe('plant sources', () => {
  it('bounds every family to the limit by rank, ids stable and never null, the same for the same cell', () => {
    const p = grow(GRASSLAND);
    const sources = plantSourcesOf(p, PLANT_FAMILIES);
    const byFamily = new Map<string, number>();
    for (const s of sources) byFamily.set(s.family, (byFamily.get(s.family) ?? 0) + 1);
    expect(byFamily.get('grass')).toBe(PLANT_SOURCE_LIMIT);
    expect(p.batches.grass.count).toBeGreaterThan(PLANT_SOURCE_LIMIT);
    expect(byFamily.get('flower')).toBe(Math.min(PLANT_SOURCE_LIMIT, p.batches.flower.count));
    for (const [family, n] of byFamily) expect(n, family).toBeLessThanOrEqual(PLANT_SOURCE_LIMIT);
    // Ids: the populator's own for a major family, synthesised in the same form for a cosmetic one.
    const ids = new Set<string>();
    for (const s of sources) {
      expect(s.id).not.toBeNull();
      expect(s.id).toMatch(new RegExp(`^${s.family}:${CELL.cx},${CELL.cz}:\\d+$`));
      expect(ids.has(s.id as string)).toBe(false);
      ids.add(s.id as string);
      expect(Number.isFinite(s.at.wx) && Number.isFinite(s.at.wz)).toBe(true);
      expect(s.size).toBeGreaterThan(0);
    }
    // The grass sources are the LOWEST-ranked blades — the ones the renderer keeps longest — in ascending order.
    const grassRanks = new Map<string, number>();
    for (let i = 0; i < p.batches.grass.count; i += 1) grassRanks.set(`grass:${CELL.cx},${CELL.cz}:${p.batches.grass.site[i]}`, p.batches.grass.rank[i]);
    const kept = sources.filter((s) => s.family === 'grass').map((s) => grassRanks.get(s.id as string) as number);
    for (let i = 1; i < kept.length; i += 1) expect(kept[i]).toBeGreaterThanOrEqual(kept[i - 1]);
    const all = Array.from(grassRanks.values()).sort((a, b) => a - b);
    expect(kept[kept.length - 1]).toBeLessThanOrEqual(all[PLANT_SOURCE_LIMIT - 1]);
    // Seed heads are among them, marked by their variant, for the layer to read as seeds.
    expect(sources.some((s) => s.family === 'grass' && s.variant === GRASS_SEED_HEAD)).toBe(true);
    // The same cell twice, and named in another order, is the same list.
    expect(plantSourcesOf(grow(GRASSLAND), [...PLANT_FAMILIES].reverse())).toEqual(sources);
    // A tighter limit is a PREFIX of a looser one: the cap thins the same plants first.
    const fewer = plantSourcesOf(p, ['grass', 'flower'], 40);
    const more = plantSourcesOf(p, ['grass', 'flower'], 160);
    expect(fewer.filter((s) => s.family === 'grass')).toEqual(more.filter((s) => s.family === 'grass').slice(0, 40));
  });

  it('answers only for plants, keeps a major family\'s own ids, and lists the nine plant families', () => {
    expect(PLANT_FAMILIES).toEqual(['grass', 'tree', 'fern', 'reed', 'flower', 'leaf', 'shrub', 'broadleaf', 'coastal']);
    const p = grow(SHRUBLAND);
    expect(plantSourcesOf(p, ['rock', 'twig', 'stone'])).toEqual([]);
    const shrubs = plantSourcesOf(p, ['shrub']);
    expect(shrubs.length).toBe(p.batches.shrub.count);
    // The populator's own ids, every one — in rank order here, site order there.
    expect([...shrubs.map((s) => s.id)].sort()).toEqual([...p.batches.shrub.ids!].sort());
    expect(plantSourcesOf(grow(SEA_HABITAT), PLANT_FAMILIES)).toEqual([]);
  });
});

describe('the seven drawn', () => {
  const KOLOA = geoToWorld({ lat: 21.907, lon: -159.470 });
  const WAILUA = geoToWorld({ lat: 22.043, lon: -159.395 });
  const eye = (at: WorldPoint, field: Heightfield): number => field.heightAt(at) + 1.5 * M;

  function bubble(detail: 'ultra-low' | 'low' | 'medium' | 'high' | 'ultra-high', habitat: Habitat, field = new Heightfield(coarse)): WorldObjects {
    return new WorldObjects({ field, habitatAt: uniform(habitat), seed: WORLD_SEED, detail, radius: objectRadius(detail) });
  }

  /** Every drawn instance's local x/z from a stand, as strings, for set comparison. */
  function drawnPositions(objects: WorldObjects, family: string): Set<string> {
    const out = new Set<string>();
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    objects.group.traverse((node) => {
      if (!(node instanceof THREE.InstancedMesh) || node.name !== family) return;
      for (let i = 0; i < node.count; i += 1) {
        node.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        out.add(`${p.x.toFixed(2)},${p.z.toFixed(2)}`);
      }
    });
    return out;
  }

  /** The generated plane positions of a family across the bubble, in float32 like the matrices. */
  function generatedAt(objects: WorldObjects, at: WorldPoint, family: ObjectFamily): Set<string> {
    const out = new Set<string>();
    for (const id of cellsWithin(at, objectRadius('high'))) {
      const p = objects.populationOf(id);
      if (p === null) continue;
      const b = p.batches[family];
      for (let i = 0; i < b.count; i += 1) {
        const l = toLocal(world(b.wx[i], b.wz[i]));
        out.add(`${Math.fround(l.lx).toFixed(2)},${Math.fround(l.lz).toFixed(2)}`);
      }
    }
    return out;
  }

  it('draws one stand per new family and three for the grass, every plant geometry coloured, none over its triangle budget', () => {
    const objects = bubble('low', GRASSLAND);
    const stands = objects.standCounts();
    for (const family of SEVEN) expect(stands.filter((s) => s.family === family), family).toHaveLength(1);
    expect(stands.filter((s) => s.family === 'grass')).toHaveLength(3);
    objects.group.traverse((node) => {
      if (!(node instanceof THREE.InstancedMesh)) return;
      if ((SEVEN as readonly string[]).includes(node.name)) expect(node.geometry.getAttribute('color'), `${node.name} has no colour`).toBeDefined();
    });
    objects.dispose();
    const tris = (g: THREE.BufferGeometry): number => g.getAttribute('position').count / 3;
    expect(tris(fernGeometry())).toBeLessThanOrEqual(40);
    expect(tris(shrubGeometry())).toBeLessThanOrEqual(60);
    expect(tris(broadleafGeometry())).toBeLessThanOrEqual(30);
    expect(tris(coastalGeometry())).toBeLessThanOrEqual(40);
    expect(tris(reedGeometry())).toBe(36);
    expect(tris(flowerGeometry())).toBeLessThanOrEqual(16);
    expect(tris(leafGeometry())).toBeLessThanOrEqual(12);
    expect(tris(seedHeadGeometry())).toBe(20);
    // Every unit geometry has its foot at or above y = 0 and its top near y = 1.
    for (const g of [fernGeometry(), reedGeometry(), flowerGeometry(), shrubGeometry(), broadleafGeometry(), coastalGeometry(), seedHeadGeometry()]) {
      g.computeBoundingBox();
      expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(-1e-6);
      expect(g.boundingBox!.max.y).toBeGreaterThan(0.9);
      expect(g.boundingBox!.max.y).toBeLessThanOrEqual(1.0 + 1e-6);
    }
  });

  it('does not move a shrub or a fern when the quality changes: low\'s are a subset of high\'s, in the same places', () => {
    const field = new Heightfield(coarse);
    const low = bubble('low', FOREST, field);
    const high = bubble('high', FOREST, field);
    low.prime(WAILUA, eye(WAILUA, field));
    high.prime(WAILUA, eye(WAILUA, field));
    for (const family of ['shrub', 'fern', 'leaf'] as const) {
      const lowDrawn = drawnPositions(low, family);
      expect(lowDrawn.size, `${family} at low`).toBeGreaterThan(0);
      if (family === 'shrub') {
        // A shrub's origin is its foot buried a little straight down: the plane position is exact.
        const highGenerated = generatedAt(high, WAILUA, family);
        for (const p of lowDrawn) expect(highGenerated.has(p), `${family} at ${p} moved between rungs`).toBe(true);
      } else {
        // A fern stands on its foot; a leaf is lifted three millimetres along the normal. Within a centimetre.
        const highGenerated = Array.from(generatedAt(high, WAILUA, family), (p) => p.split(',').map(Number));
        for (const p of lowDrawn) {
          const [x, z] = p.split(',').map(Number);
          expect(highGenerated.some(([hx, hz]) => Math.hypot(hx - x, hz - z) <= 1), `${family} drawn at ${p} is not where high generated one`).toBe(true);
        }
      }
    }
    // And the populations themselves are identical at both rungs: the rung never reached the populator.
    const cell = cellAt(WAILUA);
    const a = low.populationOf(cell)!;
    const b = high.populationOf(cell)!;
    for (const family of SEVEN) expect(batchBytes(a.batches[family]), family).toBe(batchBytes(b.batches[family]));
    expect(a.batches.shrub.ids).toEqual(b.batches.shrub.ids);
    low.dispose();
    high.dispose();
  });

  it('caps are maximums: a reed bed meets its cap and a beach is nowhere near the litter\'s, and no stand exceeds its cap at any rung', () => {
    const field = new Heightfield(coarse);
    for (const rung of ['ultra-low', 'low', 'medium', 'high'] as const) {
      const caps = OBJECT_BUDGETS[rung].caps;
      const wood = bubble(rung, FOREST, field);
      wood.prime(KOLOA, eye(KOLOA, field));
      for (const family of OBJECT_FAMILIES) expect(wood.cost.drawn[family], `${rung} ${family}`).toBeLessThanOrEqual(caps[family]);
      for (const stand of wood.standCounts()) expect(stand.count, `${rung} stand ${stand.family}`).toBeLessThanOrEqual(stand.capacity);
      // The forest floor generates more litter than any rung draws, and draws some at every rung.
      expect(wood.cost.generated.leaf, `${rung} litter generated`).toBeGreaterThan(caps.leaf);
      expect(wood.cost.drawn.leaf, `${rung} litter drawn`).toBeGreaterThan(0);
      wood.dispose();
    }
    // A reed bed at `high` overfills the reeds' cap even after the distance thinning: the cap bites,
    // to within the histogram cut's bin (`rankCutoff` is a thousandth of a rank, a few reeds).
    const marsh = bubble('high', WETLAND, field);
    marsh.prime(KOLOA, eye(KOLOA, field));
    expect(marsh.cost.generated.reed).toBeGreaterThan(OBJECT_BUDGETS.high.caps.reed * 2);
    expect(marsh.cost.drawn.reed).toBeLessThanOrEqual(OBJECT_BUDGETS.high.caps.reed);
    expect(marsh.cost.drawn.reed).toBeGreaterThan(OBJECT_BUDGETS.high.caps.reed - 16);
    marsh.dispose();
    const beach = bubble('high', BEACH, field);
    beach.prime(KOLOA, eye(KOLOA, field));
    expect(beach.cost.drawn.leaf).toBe(0);
    expect(beach.cost.drawn.fern).toBe(0);
    expect(beach.cost.drawn.reed).toBe(0);
    expect(beach.cost.drawn.flower).toBe(0);
    expect(beach.cost.drawn.coastal).toBeGreaterThan(0);
    expect(beach.cost.drawn.coastal).toBeLessThanOrEqual(OBJECT_BUDGETS.high.caps.coastal);
    beach.dispose();
  });

  /**
   * REST ON THE GROUND, for the seven, read off the actual instance
   * matrices over the real HD ground at the Wailua wood.
   */
  describe('rest on the ground', () => {
    const WOOD = world(1559200, -2400);

    function groundUnder(at: WorldPoint): Heightfield {
      const field = new Heightfield(coarse);
      const seen = new Set<string>();
      for (const dx of [-1, 0, 1]) {
        for (const dz of [-1, 0, 1]) {
          const id = hdTileAt(world(at.wx + dx * 100 * M, at.wz + dz * 100 * M));
          const name = hdTileName(id);
          if (seen.has(name)) continue;
          seen.add(name);
          field.addTile(id, repairGrid(decodeHdTile(bytes(path.join('kauai-hd', `${name}.bin`)))).grid);
        }
      }
      return field;
    }

    interface Drawn { readonly matrix: THREE.Matrix4 }

    function drawn(objects: WorldObjects, family: string): Drawn[] {
      const out: Drawn[] = [];
      objects.group.traverse((node) => {
        if (!(node instanceof THREE.InstancedMesh) || node.name !== family) return;
        for (let i = 0; i < node.count; i += 1) {
          const matrix = new THREE.Matrix4();
          node.getMatrixAt(i, matrix);
          out.push({ matrix });
        }
      });
      return out;
    }

    it('lays every leaf along the slope, a hair above the ground; stands every shrub up, bedded like a tree; seats the rest on their feet', () => {
      const field = groundUnder(WOOD);
      const objects = bubble('medium', FOREST, field);
      objects.prime(WOOD, eye(WOOD, field));
      const p = new THREE.Vector3();
      const col = new THREE.Vector3();
      // LEAVES: the tent's rib (the geometry's z, column 2) is the ground's normal.
      const leaves = drawn(objects, 'leaf');
      expect(leaves.length).toBeGreaterThan(100);
      let steepest = 0;
      for (const d of leaves) {
        p.setFromMatrixPosition(d.matrix);
        const at = world(p.x, p.z);
        const n = field.normalAt(at, 25);
        col.setFromMatrixColumn(d.matrix, 2).normalize();
        const off = Math.acos(Math.min(1, Math.abs(col.x * n.nx + col.y * n.ny + col.z * n.nz))) * (180 / Math.PI);
        steepest = Math.max(steepest, off);
        // Lifted, never sunk: the origin is at or above the ground under it (the matrices are float32).
        expect(p.y, 'a leaf under the ground').toBeGreaterThanOrEqual(field.heightAt(at) - 0.5);
      }
      // `leanOf` props a leaf by at most 6°; the trig table's third of a degree is the rest.
      expect(steepest).toBeLessThanOrEqual(7);
      // SHRUBS: up whatever the slope, the foot a little under the ground and never more than a tree's.
      const shrubs = drawn(objects, 'shrub');
      expect(shrubs.length).toBeGreaterThan(5);
      for (const d of shrubs) {
        p.setFromMatrixPosition(d.matrix);
        const foot = field.heightAt(world(p.x, p.z));
        const height = col.setFromMatrixColumn(d.matrix, 1).length();
        expect(p.y).toBeLessThanOrEqual(foot + 0.5);
        expect(p.y).toBeGreaterThanOrEqual(foot - 0.3 * height - 0.5);
        col.normalize();
        expect(Math.acos(Math.min(1, col.y)) * (180 / Math.PI)).toBeLessThanOrEqual(6);
      }
      // FERNS AND BROAD LEAVES: on their feet, growing up, half persuaded by the slope like grass.
      for (const family of ['fern', 'broadleaf'] as const) {
        const plants = drawn(objects, family);
        expect(plants.length, family).toBeGreaterThan(50);
        for (const d of plants) {
          p.setFromMatrixPosition(d.matrix);
          const foot = field.heightAt(world(p.x, p.z));
          expect(Math.abs(p.y - foot), `a ${family} off its foot`).toBeLessThanOrEqual(0.5);
          col.setFromMatrixColumn(d.matrix, 1).normalize();
          expect(Math.acos(Math.min(1, col.y)) * (180 / Math.PI), `a ${family} lying down`).toBeLessThanOrEqual(40);
        }
      }
      objects.dispose();
    });

    it('seats flowers, reeds and the coastal spreader on their feet too', () => {
      const field = groundUnder(WOOD);
      const p = new THREE.Vector3();
      for (const [habitat, family] of [[GRASSLAND, 'flower'], [WETLAND, 'reed'], [BEACH, 'coastal']] as const) {
        const objects = bubble('low', habitat, field);
        objects.prime(WOOD, eye(WOOD, field));
        const plants = drawn(objects, family);
        expect(plants.length, family).toBeGreaterThan(20);
        for (const d of plants) {
          p.setFromMatrixPosition(d.matrix);
          expect(Math.abs(p.y - field.heightAt(world(p.x, p.z))), `a ${family} off its foot`).toBeLessThanOrEqual(0.5);
        }
        objects.dispose();
      }
    });
  });
});

describe('the mobile budget', () => {
  it('the seven add at most 6,000 instances at high, and every family climbs the ladder without a step down', () => {
    let atHigh = 0;
    for (const family of SEVEN) atHigh += OBJECT_BUDGETS.high.caps[family];
    expect(atHigh).toBeLessThanOrEqual(6_000);
    for (const family of SEVEN) {
      let prev = 0;
      for (const rung of OBJECT_RUNGS) {
        const cap = OBJECT_BUDGETS[rung].caps[family];
        expect(cap, `${rung} ${family}`).toBeGreaterThanOrEqual(prev);
        expect(Number.isInteger(cap)).toBe(true);
        prev = cap;
        const draw = OBJECT_BUDGETS[rung].draw[family];
        expect(draw).toBeGreaterThan(0);
        expect(draw).toBeLessThanOrEqual(1);
      }
      // ultra-high may double; it may not go wild.
      expect(OBJECT_BUDGETS['ultra-high'].caps[family]).toBeLessThanOrEqual(OBJECT_BUDGETS.high.caps[family] * 2);
    }
    // A shrub is somebody: the rung caps how many, never which.
    for (const rung of OBJECT_RUNGS) expect(OBJECT_BUDGETS[rung].draw.shrub).toBe(1);
    // The first five are untouched: Joshua's numbers.
    expect(OBJECT_BUDGETS.high.caps).toMatchObject({ grass: 25_000, twig: 2_000, stone: 500, rock: 50, tree: 100 });
  });
});
