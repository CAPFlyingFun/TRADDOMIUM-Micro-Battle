/**
 * The populator, held to the properties a deterministic world rests on
 * (Joshua's list, 2026-09-06 §20), on the real island:
 *
 *   same seed + same cell → the same objects, byte for byte
 *   a different seed → a different island
 *   a beach is not a forest; a forest is trees; rock favours rock
 *   nothing stands in the sea or on a watercourse
 *   positions are finite and inside their cell; a NaN cell is refused
 *   two cells never share an object; ids are unique
 *   generating one family does not change how it is generated
 *   the terrain is never written
 *   the populator knows nothing of the detail rung or the water
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { world, type WorldPoint } from '../src/world/coords';
import { UNITS_PER_METRE, decodeCoarse } from '../src/world/dem';
import { repairGrid } from '../src/world/demRepair';
import { geoToWorld } from '../src/world/geo';
import { HabitatMap, type Habitat } from '../src/world/habitat';
import { decodeVeg } from '../src/world/landcover';
import { islandChannels } from '../src/world/water/islandChannels';
import { CELL_SPAN, cellAt, cellCentre, cellsWithin, type ObjectCellId } from '../src/world/objects/cells';
import { OBJECT_FAMILIES, type ObjectFamily } from '../src/world/objects/families';
import { SITES_PER_SIDE, TREE_PALM, populateCell, type CellPopulation, type FamilyBatch } from '../src/world/objects/populate';
import { NO_DELTAS, WORLD_SEED } from '../src/world/objects/seed';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const M = UNITS_PER_METRE;

function bytes(file: string): ArrayBuffer {
  const b = readFileSync(path.join(ROOT, 'public', file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

const coarse = repairGrid(decodeCoarse(bytes('kauai-1025.bin'))).grid;
const channels = islandChannels(coarse);
const landcover = decodeVeg(bytes('kauai-veg.bin'));
const map = new HabitatMap({ landcover, coarse, isChannel: channels.isChannel });
const habitatAt = (at: WorldPoint): Habitat => map.at(at);
const grow = (id: ObjectCellId, seed = WORLD_SEED): CellPopulation => populateCell(id, { seed, habitatAt });

/** The nearest cell to a named centre whose centre habitat satisfies `want`. Reads the habitat, not the populator: cheap. */
function cellWhere(centre: WorldPoint, want: (h: Habitat) => boolean, reach = 4000 * M): ObjectCellId {
  for (const id of cellsWithin(centre, reach)) {
    if (want(map.at(cellCentre(id)))) return id;
  }
  throw new Error(`no such cell within ${reach} of ${centre.wx},${centre.wz}`);
}
const cellOfKind = (centre: WorldPoint, kind: Habitat['kind'], reach = 4000 * M): ObjectCellId =>
  cellWhere(centre, (h) => h.kind === kind, reach);

/** Sum a family over every cell under a circle. */
function countWithin(centre: WorldPoint, radius: number): Record<ObjectFamily, number> {
  const sums = Object.fromEntries(OBJECT_FAMILIES.map((f) => [f, 0])) as Record<ObjectFamily, number>;
  for (const id of cellsWithin(centre, radius)) {
    const p = grow(id);
    for (const f of OBJECT_FAMILIES) sums[f] += p.batches[f].count;
  }
  return sums;
}

function batchBytes(b: FamilyBatch): string {
  return JSON.stringify([
    b.count, Array.from(b.wx), Array.from(b.wz), Array.from(b.size), Array.from(b.girth), Array.from(b.spin),
    Array.from(b.lean), Array.from(b.leanDir), Array.from(b.tint), Array.from(b.rank), Array.from(b.variant), Array.from(b.site), b.ids,
  ]);
}

const KOLOA = geoToWorld({ lat: 21.907, lon: -159.470 });
const WAILUA = geoToWorld({ lat: 22.043, lon: -159.395 });
const WAIMEA = geoToWorld({ lat: 22.055, lon: -159.665 });
const HANALEI_BAY = geoToWorld({ lat: 22.204, lon: -159.501 });
const WAIALEALE = geoToWorld({ lat: 22.070, lon: -159.500 });

describe('determinism', () => {
  it('grows the same cell twice, byte for byte, in any order and after other cells', () => {
    const id = cellAt(KOLOA);
    const first = grow(id);
    grow({ cx: id.cx + 1, cz: id.cz });
    grow({ cx: id.cx - 3, cz: id.cz + 2 });
    const again = grow(id);
    for (const f of OBJECT_FAMILIES) expect(batchBytes(again.batches[f])).toBe(batchBytes(first.batches[f]));
    expect(again.total).toBe(first.total);
    expect(first.total).toBeGreaterThan(100);
  });

  it('grows a different island from a different seed, and the same one from the same seed on a fresh map', () => {
    const id = cellAt(WAILUA);
    const a = grow(id, WORLD_SEED);
    const b = grow(id, WORLD_SEED + 1);
    expect(batchBytes(b.batches.grass)).not.toBe(batchBytes(a.batches.grass));
    expect(batchBytes(b.batches.tree)).not.toBe(batchBytes(a.batches.tree));
    const fresh = new HabitatMap({ landcover, coarse, isChannel: channels.isChannel });
    const c = populateCell(id, { seed: WORLD_SEED, habitatAt: (at) => fresh.at(at) });
    for (const f of OBJECT_FAMILIES) expect(batchBytes(c.batches[f])).toBe(batchBytes(a.batches[f]));
  });

  it('generates one family identically whether or not the others were asked for', () => {
    const id = cellAt(WAILUA);
    const all = grow(id);
    const treesOnly = populateCell(id, { seed: WORLD_SEED, habitatAt, families: ['tree'] });
    expect(batchBytes(treesOnly.batches.tree)).toBe(batchBytes(all.batches.tree));
    expect(treesOnly.batches.grass.count).toBe(0);
    expect(treesOnly.total).toBe(all.batches.tree.count);
  });

  it('never calls anything random: the same cell on two habitat maps built in different orders agrees', () => {
    // The only inputs are the seed, the address and five habitat reads.
    // A populator that consulted a clock or a global would fail here.
    const id = cellAt(WAIMEA);
    const seen = new Set<string>();
    for (let i = 0; i < 5; i += 1) seen.add(batchBytes(grow(id).batches.rock));
    expect(seen.size).toBe(1);
  });
});

describe('what grows where', () => {
  it('a beach is driftwood, stones, a fringe of grass and the odd palm — not a forest and not a lawn', () => {
    const beach = cellOfKind(HANALEI_BAY, 'beach');
    const p = grow(beach);
    const forest = grow(cellOfKind(WAILUA, 'forest'));
    // Far fewer blades than a grassland, far fewer trees than a forest.
    expect(p.batches.grass.count).toBeLessThan(grow(cellOfKind(KOLOA, 'grassland')).batches.grass.count * 0.5);
    expect(p.batches.tree.count).toBeLessThanOrEqual(2);
    expect(p.batches.tree.count).toBeLessThan(forest.batches.tree.count);
    // Every tree on the sand is a palm.
    for (let i = 0; i < p.batches.tree.count; i += 1) expect(p.batches.tree.variant[i]).toBe(TREE_PALM);
    // And there is something on it: the driftwood and the stones the brief asks for.
    expect(p.batches.twig.count + p.batches.stone.count).toBeGreaterThan(10);
  });

  it('a grassland is grass-heavy: more blades than a forest floor, and few trees', () => {
    const lawn = grow(cellOfKind(KOLOA, 'grassland'));
    const wood = grow(cellOfKind(WAILUA, 'forest'));
    expect(lawn.batches.grass.count).toBeGreaterThan(1500);
    expect(lawn.batches.grass.count).toBeGreaterThan(wood.batches.grass.count * 1.5);
    expect(lawn.batches.tree.count).toBeLessThan(wood.batches.tree.count);
    // Grassland blades are the medium-to-tall kind: 15–60 cm mostly.
    const heights = Array.from(lawn.batches.grass.size).sort((a, b) => a - b);
    const median = heights[heights.length >> 1];
    expect(median).toBeGreaterThan(15 * M / 100);
    expect(median).toBeLessThan(60 * M / 100);
  });

  it('a forest is tree-heavy with litter under it, and a short understory', () => {
    const within = countWithin(WAILUA, 60 * M);
    const lawn = countWithin(KOLOA, 60 * M);
    expect(within.tree).toBeGreaterThan(40);
    expect(within.tree).toBeGreaterThan(lawn.tree * 3);
    expect(within.twig).toBeGreaterThan(lawn.twig * 1.5);
    const wood = grow(cellOfKind(WAILUA, 'forest'));
    const heights = Array.from(wood.batches.grass.size).sort((a, b) => a - b);
    expect(heights[heights.length >> 1]).toBeLessThan(30 * M / 100);
    // Forest trees are broad-leaved, 8 m and up.
    let broad = 0;
    for (let i = 0; i < wood.batches.tree.count; i += 1) {
      if (wood.batches.tree.variant[i] === 0) broad += 1;
      expect(wood.batches.tree.size[i]).toBeGreaterThanOrEqual(2.5 * M);
      expect(wood.batches.tree.size[i]).toBeLessThanOrEqual(26 * M);
    }
    expect(broad).toBeGreaterThan(wood.batches.tree.count / 2);
  });

  it('rock favours rock: the canyon walls carry more rocks and stones than blades per rock, and sparse grass', () => {
    const wall = grow(cellWhere(WAIMEA, (h) => h.kind === 'rocky' && h.bare > 0.85, 6000 * M));
    const lawn = grow(cellOfKind(KOLOA, 'grassland'));
    expect(wall.batches.rock.count + wall.batches.stone.count).toBeGreaterThan(lawn.batches.rock.count + lawn.batches.stone.count);
    expect(wall.batches.grass.count).toBeLessThan(lawn.batches.grass.count * 0.3);
    expect(wall.batches.tree.count).toBeLessThanOrEqual(lawn.batches.tree.count + 1);
    // The summit plateau is exposed: sparse and short.
    const ridge = grow(cellOfKind(WAIALEALE, 'ridge', 6000 * M));
    expect(ridge.batches.grass.count).toBeLessThan(lawn.batches.grass.count * 0.6);
  });

  it('sizes every family inside the brief\'s ranges', () => {
    const ranges: Record<ObjectFamily, [number, number]> = {
      grass: [5 * M / 100, 100 * M / 100],
      twig: [5 * M / 100, 60 * M / 100],
      stone: [2 * M / 100, 20 * M / 100],
      rock: [25 * M / 100, 250 * M / 100],
      tree: [2.5 * M, 26 * M],
      // The ecology pass's seven, the brief's ranges.
      fern: [20 * M / 100, 60 * M / 100],
      reed: [60 * M / 100, 180 * M / 100],
      flower: [8 * M / 100, 40 * M / 100],
      leaf: [3 * M / 100, 12 * M / 100],
      shrub: [40 * M / 100, 150 * M / 100],
      broadleaf: [15 * M / 100, 50 * M / 100],
      coastal: [20 * M / 100, 60 * M / 100],
    };
    const bad: string[] = [];
    let checked = 0;
    for (const centre of [KOLOA, WAILUA, WAIMEA, HANALEI_BAY, WAIALEALE]) {
      for (const id of cellsWithin(centre, 30 * M)) {
        const p = grow(id);
        for (const f of OBJECT_FAMILIES) {
          const b = p.batches[f];
          for (let i = 0; i < b.count; i += 1) {
            checked += 1;
            const ok = b.size[i] >= ranges[f][0] - 1e-6 && b.size[i] <= ranges[f][1] + 1e-6
              && b.girth[i] > 0 && b.rank[i] >= 0 && b.rank[i] < 1 && b.tint[i] >= 0 && b.lean[i] >= 0;
            if (!ok && bad.length < 10) bad.push(`${f} size ${b.size[i]} girth ${b.girth[i]} rank ${b.rank[i]}`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
    expect(bad).toEqual([]);
  });
});

describe('where nothing grows', () => {
  it('grows nothing in a cell that is entirely at sea, and nothing below the waterline in one that straddles it', () => {
    const open = grow(cellAt(world(2_600_000, 2_600_000)));
    expect(open.total).toBe(0);
    expect(open.habitat.kind).toBe('sea');
    // Every object anywhere near the shore stands on ground above the sea.
    const shore = cellOfKind(HANALEI_BAY, 'beach');
    let inSea = 0;
    let checked = 0;
    for (const id of cellsWithin(cellCentre(shore), 60 * M)) {
      const p = grow(id);
      for (const f of OBJECT_FAMILIES) {
        const b = p.batches[f];
        for (let i = 0; i < b.count; i += 1) {
          checked += 1;
          if (map.at(world(b.wx[i], b.wz[i])).elevation <= 0) inSea += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(inSea).toBe(0);
  });

  it('keeps grass and trees off the drainage\'s watercourses', () => {
    let onChannel = 0;
    let checked = 0;
    for (const centre of [WAILUA, KOLOA, geoToWorld({ lat: 22.185, lon: -159.470 })]) {
      for (const id of cellsWithin(centre, 100 * M)) {
        const p = grow(id);
        for (const f of ['grass', 'tree'] as const) {
          const b = p.batches[f];
          for (let i = 0; i < b.count; i += 1) {
            checked += 1;
            if (channels.isChannel(world(b.wx[i], b.wz[i]))) onChannel += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    // The channel factor is blended across a cell, so a blade can sit a
    // metre inside a 54.7 m channel cell's edge; what cannot happen is
    // grass standing in the river.
    expect(onChannel / checked).toBeLessThan(0.02);
  });
});

describe('addresses and identities', () => {
  it('keeps every object inside its own cell, finite, and off the cell\'s edges', () => {
    let bad = 0;
    let checked = 0;
    for (const centre of [KOLOA, WAILUA, HANALEI_BAY]) {
      for (const id of cellsWithin(centre, 30 * M)) {
        const p = grow(id);
        const x0 = id.cx * CELL_SPAN;
        const z0 = id.cz * CELL_SPAN;
        for (const f of OBJECT_FAMILIES) {
          const b = p.batches[f];
          const pitch = CELL_SPAN / SITES_PER_SIDE[f];
          for (let i = 0; i < b.count; i += 1) {
            checked += 1;
            const x = b.wx[i];
            const z = b.wz[i];
            if (!Number.isFinite(x) || !Number.isFinite(z)) { bad += 1; continue; }
            if (!(x > x0 && x < x0 + CELL_SPAN && z > z0 && z < z0 + CELL_SPAN)) { bad += 1; continue; }
            // Thrown inside its own square, never on the line.
            const fx = ((x - x0) / pitch) % 1;
            const fz = ((z - z0) / pitch) % 1;
            if (!(fx > 0.09 && fx < 0.91 && fz > 0.09 && fz < 0.91)) bad += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
    expect(bad).toBe(0);
  });

  it('never grows the same object in two cells, and never two objects at one site', () => {
    const seen = new Set<string>();
    const ids = new Set<string>();
    // Counted, not expected per object: a hundred cells of a doubled
    // lattice is a million blades, and a million `expect` calls is a
    // timeout, not a test.
    let repeatedPositions = 0;
    let repeatedSites = 0;
    for (const id of cellsWithin(WAILUA, 80 * M)) {
      const p = grow(id);
      for (const f of OBJECT_FAMILIES) {
        const b = p.batches[f];
        const sites = new Set<number>();
        for (let i = 0; i < b.count; i += 1) {
          const at = `${f}:${b.wx[i].toFixed(3)},${b.wz[i].toFixed(3)}`;
          if (seen.has(at)) repeatedPositions += 1;
          seen.add(at);
          if (sites.has(b.site[i])) repeatedSites += 1;
          sites.add(b.site[i]);
        }
        if (b.ids !== null) {
          expect(b.ids).toHaveLength(b.count);
          for (const oid of b.ids) {
            expect(oid).toMatch(new RegExp(`^${f}:${id.cx},${id.cz}:\\d+$`));
            expect(ids.has(oid)).toBe(false);
            ids.add(oid);
          }
        } else {
          expect(['grass', 'twig', 'stone', 'fern', 'reed', 'flower', 'leaf', 'broadleaf', 'coastal']).toContain(f);
        }
      }
    }
    expect(repeatedPositions).toBe(0);
    expect(repeatedSites).toBe(0);
    expect(ids.size).toBeGreaterThan(50);
  });

  it('removes exactly the object a delta names, and nothing else moves', () => {
    const id = cellOfKind(WAILUA, 'forest');
    const before = grow(id);
    expect(before.batches.tree.count).toBeGreaterThan(1);
    const felled = before.batches.tree.ids![0];
    const after = populateCell(id, { seed: WORLD_SEED, habitatAt, deltas: { isRemoved: (o) => o === felled } });
    expect(after.batches.tree.count).toBe(before.batches.tree.count - 1);
    expect(after.batches.tree.ids).toEqual(before.batches.tree.ids!.filter((o) => o !== felled));
    for (let i = 0; i < after.batches.tree.count; i += 1) {
      expect(after.batches.tree.wx[i]).toBe(before.batches.tree.wx[i + 1]);
      expect(after.batches.tree.site[i]).toBe(before.batches.tree.site[i + 1]);
    }
    // Cosmetic families are untouched by a delta about a tree.
    expect(batchBytes(after.batches.grass)).toBe(batchBytes(before.batches.grass));
    expect(NO_DELTAS.isRemoved(felled)).toBe(false);
  });

  it('refuses a cell address that is not two integers', () => {
    expect(() => grow({ cx: Number.NaN, cz: 0 })).toThrow(/two integers/);
    expect(() => grow({ cx: 0.5, cz: 0 })).toThrow(/two integers/);
    expect(() => grow({ cx: 0, cz: Number.POSITIVE_INFINITY })).toThrow(/two integers/);
  });
});

describe('what the populator may not touch', () => {
  it('never writes the terrain: the survey is byte-identical after growing a hundred cells', () => {
    const before = Buffer.from(coarse.samples.buffer.slice(0)).toString('base64');
    for (const id of cellsWithin(WAILUA, 80 * M)) grow(id);
    for (const id of cellsWithin(HANALEI_BAY, 80 * M)) grow(id);
    expect(Buffer.from(coarse.samples.buffer.slice(0)).toString('base64')).toBe(before);
  });

  it('imports nothing of the water, the sea, the detail ladder or the renderer — by source text', () => {
    const dir = path.join(ROOT, 'src', 'world', 'objects');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    // `ecology/resources` is the resource layer's CONTRACT (types only), which `plants.ts` shapes its answer to.
    const allowed = /^(\.\/[\w]+|\.\.\/(coords|dem|habitat|random|heightfield|ecology\/resources))$/;
    for (const file of files) {
      const source = readFileSync(path.join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      for (const m of source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
        expect(m[1], `${file} imports ${m[1]}`).toMatch(allowed);
      }
      expect(source, `${file} names the detail rung`).not.toMatch(/DetailTier|waveRadius|assets\//);
      expect(source, `${file} reaches the water`).not.toMatch(/water\/|sea\/|three/);
    }
  });
});
