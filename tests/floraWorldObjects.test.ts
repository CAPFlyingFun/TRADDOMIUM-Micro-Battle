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
import { UNITS_PER_METRE, decodeCoarse, decodeHdTile, hdTileAt, hdTileName } from '../src/world/dem';
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
    // The same for rocks — the other family with an identity. A rock's
    // drawn origin is its plane position bedded a little along the
    // ground's normal (`ROCK_SINK`), the same at both rungs, so it is
    // matched to the generated plane position within half a metre.
    const highRocks = Array.from(generatedAt(high, 'rock'), (p) => p.split(',').map(Number));
    for (const p of drawnPositions(low, 'rock')) {
      const [x, z] = p.split(',').map(Number);
      const near = highRocks.some(([hx, hz]) => Math.hypot(hx - x, hz - z) <= 0.5 * M);
      expect(near, `rock drawn at ${p} is not at a plane position high generated`).toBe(true);
    }
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

/**
 * REST ON THE GROUND. Joshua, from the phone (2026-09-06): "some objects
 * are underground and twigs aren't lying flat on the ground". Measured
 * on the survey before the fix: rocks and stones took any rotation, so
 * seven in ten rocks had more than half their body under the ground;
 * twigs took a uniform 0–90°. Each assertion below is read off the
 * ACTUAL instance matrices and the ACTUAL geometry the phone draws, at
 * the canyon wall (the steepest ground there is) and in the wood, with
 * the HD tiles resident — and each fails on the mutation it was written
 * against: `leanOf` rock/stone → t·π, twig → t·π/2, the tree's slope
 * burial removed, the stale re-pose removed.
 */
describe('rest on the ground', () => {
  /** The Waimea canyon wall — the probe's rocky site — and the Wailua wood. */
  const WALL = world(-1215200, -143200);
  const WOOD = world(1559200, -2400);

  /** A heightfield with the HD tiles under a 100 m bubble at `at` resident. */
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

  interface Drawn { readonly family: string; readonly matrix: THREE.Matrix4; readonly geometry: THREE.BufferGeometry }

  /** Every drawn instance with its matrix and the geometry it is drawn with. */
  function drawn(objects: WorldObjects, family: string): Drawn[] {
    const out: Drawn[] = [];
    objects.group.traverse((node) => {
      if (!(node instanceof THREE.InstancedMesh) || node.name !== family) return;
      for (let i = 0; i < node.count; i += 1) {
        const matrix = new THREE.Matrix4();
        node.getMatrixAt(i, matrix);
        out.push({ family, matrix, geometry: node.geometry });
      }
    });
    return out;
  }

  /** The fraction of an instance's vertices under the ground's tangent plane at its origin. The origin is identity here: local is world. */
  function buriedFraction(d: Drawn, field: Heightfield): number {
    const p = new THREE.Vector3().setFromMatrixPosition(d.matrix);
    const at = world(p.x, p.z);
    const foot = field.heightAt(at);
    const n = field.normalAt(at, 25);
    const pos = d.geometry.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    let under = 0;
    for (let k = 0; k < pos.count; k += 1) {
      v.fromBufferAttribute(pos, k).applyMatrix4(d.matrix);
      const ground = foot - (n.nx / n.ny) * (v.x - p.x) - (n.nz / n.ny) * (v.z - p.z);
      if (v.y < ground) under += 1;
    }
    return under / pos.count;
  }

  it('rolls every rock and stone onto its base: none has more than a third of its body under the ground, at the wall or in the wood', () => {
    for (const site of [WALL, WOOD]) {
      const field = groundUnder(site);
      const objects = bubble('high', field);
      objects.prime(site, eye(site, field));
      for (const family of ['rock', 'stone'] as const) {
        const instances = drawn(objects, family);
        expect(instances.length, `${family} drawn`).toBeGreaterThan(10);
        const fractions = instances.map((d) => buriedFraction(d, field)).sort((a, b) => a - b);
        // Bedded, not buried: the sink is 15% of a rock's size (7.5% of a
        // stone's), which on a bumpy base is about a fifth of its
        // vertices; a rock turned onto its top would read over a half.
        expect(fractions[fractions.length - 1], `${family}: the most buried`).toBeLessThanOrEqual(0.35);
        expect(fractions[Math.floor(fractions.length / 2)], `${family}: the median`).toBeLessThanOrEqual(0.25);
        // And bedded rather than perched: the median touches the ground.
        expect(fractions[Math.floor(fractions.length / 2)], `${family}: the median`).toBeGreaterThan(0.05);
      }
      objects.dispose();
    }
  });

  it('lays every twig along the slope: its length is within nine degrees of the ground plane', () => {
    const field = groundUnder(WOOD);
    const objects = bubble('high', field);
    objects.prime(WOOD, eye(WOOD, field));
    const twigs = drawn(objects, 'twig');
    expect(twigs.length).toBeGreaterThan(100);
    const axis = new THREE.Vector3();
    const p = new THREE.Vector3();
    let steepest = 0;
    for (const d of twigs) {
      axis.setFromMatrixColumn(d.matrix, 1).normalize();
      p.setFromMatrixPosition(d.matrix);
      const n = field.normalAt(world(p.x, p.z), 25);
      const off = Math.asin(Math.abs(axis.x * n.nx + axis.y * n.ny + axis.z * n.nz)) * (180 / Math.PI);
      steepest = Math.max(steepest, off);
    }
    // `leanOf` props a twig by at most 8°; the table's third of a degree is the rest.
    expect(steepest).toBeLessThanOrEqual(9);
    objects.dispose();
  });

  it('buries a tree on a slope deep enough that the downhill side of its trunk meets the ground', () => {
    const field = groundUnder(WALL);
    const objects = bubble('high', field);
    objects.prime(WALL, eye(WALL, field));
    const trees = drawn(objects, 'tree');
    expect(trees.length).toBeGreaterThan(0);
    const p = new THREE.Vector3();
    const col = new THREE.Vector3();
    for (const d of trees) {
      p.setFromMatrixPosition(d.matrix);
      const at = world(p.x, p.z);
      const n = field.normalAt(at, 25);
      // The trunk's radius: the x scale is the tree's width; the baked
      // broad tree's girth is 4.5% of its height, its radius half that.
      const radius = col.setFromMatrixColumn(d.matrix, 0).length() * 0.045 / 2;
      const slope = Math.acos(Math.min(1, n.ny));
      const downhillGround = field.heightAt(at) - radius * Math.tan(slope);
      expect(p.y, `a trunk base ${(p.y - downhillGround).toFixed(0)} units over the downhill ground`).toBeLessThanOrEqual(downhillGround + 1);
      // And it still grows UP: the trunk's axis is within the lean a tree is allowed.
      col.setFromMatrixColumn(d.matrix, 1).normalize();
      expect(Math.acos(Math.min(1, col.y)) * (180 / Math.PI)).toBeLessThanOrEqual(13);
    }
    objects.dispose();
  });

  it('re-poses a cell when a tile lands under it, within the frame budget, so a rock sits on the HD ground, not the coarse one', () => {
    // Composed over the coarse survey, then the HD tile arrives.
    const field = new Heightfield(coarse);
    const objects = bubble('high', field);
    objects.prime(WALL, eye(WALL, field));
    const before = drawn(objects, 'rock');
    expect(before.length).toBeGreaterThan(10);
    const id = hdTileAt(WALL);
    field.addTile(id, repairGrid(decodeHdTile(bytes(path.join('kauai-hd', `${hdTileName(id)}.bin`)))).grid);
    // The feet move on the next refresh; the poses follow under budget.
    for (let f = 0; f < 200; f += 1) objects.update(WALL, eye(WALL, field));
    const after = drawn(objects, 'rock');
    const up = new THREE.Vector3();
    const p = new THREE.Vector3();
    let checked = 0;
    for (const d of after) {
      p.setFromMatrixPosition(d.matrix);
      const n = field.normalAt(world(p.x, p.z), 25);
      up.setFromMatrixColumn(d.matrix, 1).normalize();
      // A rock's up is the HD ground's normal, give or take its own lean (≤ 12°).
      const off = Math.acos(Math.min(1, up.x * n.nx + up.y * n.ny + up.z * n.nz)) * (180 / Math.PI);
      expect(off, `a rock ${off.toFixed(1)}° off the ground it stands on`).toBeLessThanOrEqual(12.5);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(10);
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
