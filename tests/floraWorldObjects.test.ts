/**
 * The streamer, held to the brief's invariants on the real island, with
 * three's InstancedMesh but no renderer:
 *
 *   caps are maximums — no stand ever exceeds its rung's cap
 *   quality does not move the world — a tree at `low` stands where it
 *     stands at `high`
 *   streaming out and back reconstructs the same objects
 *   a non-finite camera cannot poison the bubble
 *   a tile landing re-seats feet and nothing else
 *   the bubble reads different worlds at different places
 *   a camera high above the lawn draws no blades
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DETAIL_QUALITY, objectRadius } from '../src/assets/detailQuality';
import { WorldObjects, rankCutoff } from '../src/flora/WorldObjects';
import { world, type WorldPoint } from '../src/world/coords';
import { toLocal } from '../src/world/origin';
import { UNITS_PER_METRE, decodeCoarse, decodeHdTile, hdTileAt } from '../src/world/dem';
import { repairGrid } from '../src/world/demRepair';
import { geoToWorld } from '../src/world/geo';
import { HabitatMap, type Habitat } from '../src/world/habitat';
import { Heightfield } from '../src/world/heightfield';
import { decodeVeg } from '../src/world/landcover';
import { OBJECT_BUDGETS } from '../src/world/objects/budget';
import { cellAt, cellsWithin } from '../src/world/objects/cells';
import { OBJECT_FAMILIES } from '../src/world/objects/families';
import { WORLD_SEED } from '../src/world/objects/seed';
import { islandChannels } from '../src/world/water/islandChannels';
import { hdTilePath } from '../src/assets/demSource';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const M = UNITS_PER_METRE;

function bytes(file: string): ArrayBuffer {
  const b = readFileSync(path.join(ROOT, 'public', file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

const coarse = repairGrid(decodeCoarse(bytes('kauai-1025.bin'))).grid;
const channels = islandChannels(coarse);
const landcover = decodeVeg(bytes('kauai-veg.bin'));
const habitats = new HabitatMap({ landcover, coarse, isChannel: channels.isChannel });
const habitatAt = (at: WorldPoint): Habitat => habitats.at(at);

const KOLOA = geoToWorld({ lat: 21.907, lon: -159.470 });
const WAILUA = geoToWorld({ lat: 22.043, lon: -159.395 });
const WAIMEA = geoToWorld({ lat: 22.055, lon: -159.665 });

function bubble(detail: 'ultra-low' | 'low' | 'medium' | 'high' | 'ultra-high', field = new Heightfield(coarse)): WorldObjects {
  return new WorldObjects({ field, habitatAt, seed: WORLD_SEED, detail, radius: objectRadius(detail) });
}

/** Camera height: a little above the ground, like an ant's eye with a hat on. */
const eye = (at: WorldPoint, field: Heightfield): number => field.heightAt(at) + 1.5 * M;

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

describe('the bubble', () => {
  it('primes to a full radius of cells and draws something at every family on a grassland', () => {
    const field = new Heightfield(coarse);
    const objects = bubble('high', field);
    objects.prime(KOLOA, eye(KOLOA, field));
    const cost = objects.cost;
    expect(cost.pending).toBe(0);
    // A 100 m radius is a 13x13 of 16 m cells, minus the corners.
    expect(cost.cells).toBeGreaterThan(120);
    expect(cost.cells).toBeLessThan(170);
    expect(cost.radius).toBe(DETAIL_QUALITY.high.objectRadius);
    expect(cost.drawn.grass).toBeGreaterThan(1000);
    expect(cost.drawn.twig).toBeGreaterThan(0);
    expect(cost.drawn.stone).toBeGreaterThan(0);
    expect(cost.habitat).toMatch(/grassland|shrubland/);
    // The mean and peak are the fill's, reset by prime: a frame with nothing to do is near free.
    objects.update(KOLOA, eye(KOLOA, field));
    expect(objects.cost.peakMs).toBeLessThan(50);
    objects.dispose();
  });

  it('never exceeds a cap — at every rung, at the grassiest and the woodiest place', () => {
    for (const rung of ['ultra-low', 'low', 'medium', 'high'] as const) {
      const field = new Heightfield(coarse);
      const objects = bubble(rung, field);
      for (const at of [KOLOA, WAILUA]) {
        objects.prime(at, eye(at, field));
        const caps = OBJECT_BUDGETS[rung].caps;
        for (const family of OBJECT_FAMILIES) expect(objects.cost.drawn[family], `${rung} ${family}`).toBeLessThanOrEqual(caps[family]);
        for (const stand of objects.standCounts()) {
          expect(stand.count, `${rung} stand ${stand.family}`).toBeLessThanOrEqual(stand.capacity);
          expect(stand.count).toBeLessThanOrEqual(caps[stand.family]);
        }
      }
      // And the cap BITES on the lawn at high: more grass is generated than drawn.
      if (rung === 'high') {
        objects.prime(KOLOA, eye(KOLOA, field));
        expect(objects.cost.generated.grass).toBeGreaterThan(objects.cost.drawn.grass);
      }
      objects.dispose();
    }
  });

  it('a cap is a maximum, not a quota: a rocky wall draws far fewer blades than the cap allows', () => {
    const field = new Heightfield(coarse);
    const objects = bubble('high', field);
    // The barest cell near the canyon rim.
    let wall = WAIMEA;
    for (let r = 0; r < 4000 * M; r += 40 * M) {
      const at = world(WAIMEA.wx + r, WAIMEA.wz);
      if (habitats.at(at).kind === 'rocky' && habitats.at(at).bare > 0.85) { wall = at; break; }
    }
    objects.prime(wall, eye(wall, field));
    expect(objects.cost.drawn.grass).toBeLessThan(OBJECT_BUDGETS.high.caps.grass * 0.4);
    expect(objects.cost.drawn.rock + objects.cost.drawn.stone).toBeGreaterThan(20);
    objects.dispose();
  });

  it('does not move a tree when the quality changes: low\'s trees are a subset of high\'s, in the same places', () => {
    const field = new Heightfield(coarse);
    const low = bubble('low', field);
    const high = bubble('high', field);
    low.prime(WAILUA, eye(WAILUA, field));
    high.prime(WAILUA, eye(WAILUA, field));
    // Every tree LOW draws stands at a position HIGH generated — the rung
    // decides which are drawn (a cap at high can drop a far tree that low,
    // with its shorter reach, never had to thin), never where they are.
    const generatedAt = (objects: WorldObjects, family: 'tree' | 'rock'): Set<string> => {
      const out = new Set<string>();
      for (const id of cellsWithin(WAILUA, objectRadius('high'))) {
        const p = objects.populationOf(id);
        if (p === null) continue;
        const b = p.batches[family];
        for (let i = 0; i < b.count; i += 1) {
          // The instance matrix is float32; compare in the precision it has.
          const l = toLocal(world(b.wx[i], b.wz[i]));
          out.add(`${Math.fround(l.lx).toFixed(2)},${Math.fround(l.lz).toFixed(2)}`);
        }
      }
      return out;
    };
    const lowTrees = drawnPositions(low, 'tree');
    const highTrees = generatedAt(high, 'tree');
    expect(lowTrees.size).toBeGreaterThan(0);
    expect(drawnPositions(high, 'tree').size).toBeGreaterThan(lowTrees.size);
    for (const p of lowTrees) expect(highTrees.has(p), `tree at ${p} moved between rungs`).toBe(true);
    // The same for rocks — the other family with an identity.
    const highRocks = generatedAt(high, 'rock');
    for (const p of drawnPositions(low, 'rock')) expect(highRocks.has(p)).toBe(true);
    // And the populations themselves are identical objects at both rungs.
    const cell = cellAt(WAILUA);
    const a = low.populationOf(cell)!;
    const b = high.populationOf(cell)!;
    expect(Array.from(a.batches.tree.wx)).toEqual(Array.from(b.batches.tree.wx));
    expect(a.batches.tree.ids).toEqual(b.batches.tree.ids);
    low.dispose();
    high.dispose();
  });

  it('streams out and back to the same objects', () => {
    const field = new Heightfield(coarse);
    const objects = bubble('medium', field);
    objects.prime(KOLOA, eye(KOLOA, field));
    const before = drawnPositions(objects, 'grass');
    const beforeTrees = drawnPositions(objects, 'tree');
    // Fly 400 m away in 3 m steps — every cell leaves — and come back.
    const away = world(KOLOA.wx + 400 * M, KOLOA.wz);
    for (let t = 0; t <= 1; t += 0.01) {
      const at = world(KOLOA.wx + (away.wx - KOLOA.wx) * t, KOLOA.wz);
      objects.update(at, eye(at, field));
    }
    // Drain the queue so the far end is fully built, then check the lawn is gone.
    for (let i = 0; i < 200; i += 1) objects.update(away, eye(away, field));
    expect(objects.populationOf(cellAt(KOLOA))).toBeNull();
    for (let t = 1; t >= 0; t -= 0.01) {
      const at = world(KOLOA.wx + (away.wx - KOLOA.wx) * t, KOLOA.wz);
      objects.update(at, eye(at, field));
    }
    for (let i = 0; i < 200; i += 1) objects.update(KOLOA, eye(KOLOA, field));
    expect(objects.cost.pending).toBe(0);
    expect(drawnPositions(objects, 'grass')).toEqual(before);
    expect(drawnPositions(objects, 'tree')).toEqual(beforeTrees);
    objects.dispose();
  });

  it('shrugs off a non-finite camera and carries on from the last good one', () => {
    const field = new Heightfield(coarse);
    const objects = bubble('low', field);
    objects.prime(KOLOA, eye(KOLOA, field));
    const before = drawnPositions(objects, 'grass');
    objects.update(world(Number.NaN, KOLOA.wz), eye(KOLOA, field));
    objects.update(KOLOA, Number.POSITIVE_INFINITY);
    objects.update(world(KOLOA.wx, Number.NaN), 12);
    expect(objects.cost.cells).toBeGreaterThan(0);
    expect(drawnPositions(objects, 'grass')).toEqual(before);
    for (const stand of objects.standCounts()) expect(Number.isFinite(stand.count)).toBe(true);
    objects.dispose();
  });

  it('re-seats feet when a tile lands, and moves nothing on the plane', () => {
    const field = new Heightfield(coarse);
    const objects = bubble('low', field);
    objects.prime(WAILUA, eye(WAILUA, field));
    const plane = drawnPositions(objects, 'tree');
    const heightsBefore: number[] = [];
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    objects.group.traverse((node) => {
      if (!(node instanceof THREE.InstancedMesh) || node.name !== 'tree') return;
      for (let i = 0; i < node.count; i += 1) { node.getMatrixAt(i, m); heightsBefore.push(p.setFromMatrixPosition(m).y); }
    });
    expect(heightsBefore.length).toBeGreaterThan(0);
    // The Wailua's tile, from disk, as the streamer would add it.
    const tile = hdTileAt(WAILUA);
    field.addTile(tile, repairGrid(decodeHdTile(bytes(hdTilePath(tile)))).grid);
    objects.update(WAILUA, eye(WAILUA, field));
    expect(drawnPositions(objects, 'tree')).toEqual(plane);
    const heightsAfter: number[] = [];
    objects.group.traverse((node) => {
      if (!(node instanceof THREE.InstancedMesh) || node.name !== 'tree') return;
      for (let i = 0; i < node.count; i += 1) { node.getMatrixAt(i, m); heightsAfter.push(p.setFromMatrixPosition(m).y); }
    });
    // The fine ground differs from the coarse one somewhere under these trees.
    let moved = 0;
    for (let i = 0; i < heightsBefore.length; i += 1) if (Math.abs(heightsBefore[i] - heightsAfter[i]) > 1) moved += 1;
    expect(moved).toBeGreaterThan(0);
    objects.dispose();
  });

  it('draws different worlds at different places: the lawn, the wood, the wall', () => {
    const field = new Heightfield(coarse);
    const objects = bubble('high', field);
    const at = (p: WorldPoint) => { objects.prime(p, eye(p, field)); return objects.cost.drawn; };
    // prime() only primes once; use a fresh bubble per place.
    const lawn = at(KOLOA);
    const lawnGenerated = objects.cost.generated;
    const wood = bubble('high', field);
    wood.prime(WAILUA, eye(WAILUA, field));
    const woodDrawn = wood.cost.drawn;
    const woodGenerated = wood.cost.generated;
    expect(lawn.grass).toBeGreaterThan(woodDrawn.grass);
    // Drawn trees meet the cap in both; what the HABITAT put there does not.
    expect(woodGenerated.tree).toBeGreaterThan(lawnGenerated.tree * 2);
    expect(woodDrawn.tree).toBeGreaterThanOrEqual(lawn.tree);
    expect(woodDrawn.twig).toBeGreaterThan(lawn.twig);
    objects.dispose();
    wood.dispose();
  });

  it('draws no grass to a camera a hundred metres above the lawn — distance is 3D', () => {
    const field = new Heightfield(coarse);
    const objects = bubble('high', field);
    objects.prime(KOLOA, eye(KOLOA, field));
    expect(objects.cost.drawn.grass).toBeGreaterThan(1000);
    // Forty metres up: past the grass's reach, inside the trees' and rocks'.
    objects.update(KOLOA, field.heightAt(KOLOA) + 40 * M);
    expect(objects.cost.drawn.grass).toBe(0);
    expect(objects.cost.drawn.stone).toBe(0);
    expect(objects.cost.drawn.tree + objects.cost.drawn.rock).toBeGreaterThan(0);
    // A hundred and twenty metres up: nothing is within a hundred metres.
    objects.update(KOLOA, field.heightAt(KOLOA) + 120 * M);
    for (const family of OBJECT_FAMILIES) expect(objects.cost.drawn[family], family).toBe(0);
    // And the cells did not go anywhere: the ground under her still exists.
    expect(objects.cost.cells).toBeGreaterThan(120);
    objects.dispose();
  });
});

describe('rankCutoff', () => {
  it('finds the rank below which exactly the cap fall, and passes everything through under the cap', () => {
    const ranks = new Float32Array(10_000);
    for (let i = 0; i < ranks.length; i += 1) ranks[i] = (i * 7919) % 10_000 / 10_000;
    expect(rankCutoff(ranks, ranks.length, 20_000)).toBe(2);
    const cut = rankCutoff(ranks, ranks.length, 2_500);
    let under = 0;
    for (const r of ranks) if (r < cut) under += 1;
    expect(under).toBeLessThanOrEqual(2_500);
    expect(under).toBeGreaterThan(2_400);
  });
});
