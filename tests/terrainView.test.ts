/**
 * THE CLIPMAP, AND THE THREE CLAIMS IT LIVES OR DIES ON.
 *
 *  1. IT IS CHEAP, AND STAYS CHEAP. The whole reason for rings rather
 *     than tiles is that the vertex count does not grow with the world:
 *     eleven levels must cover more than the island for about the price
 *     of two character models. A change that quietly makes this 200,000
 *     vertices would still look right on a desktop and kill the phone.
 *  2. IT DOES NOT REBUILD WHAT DID NOT MOVE, AND NOT TOO MUCH AT ONCE.
 *     Refilling all eleven rings every frame is 46,000 heightfield reads
 *     a frame — invisible in a screenshot, fatal in a frame budget. And
 *     refilling five in one frame because a tile landed is a hitch. The
 *     count is exposed so a test can watch it, and the ration is pinned.
 *  3. IT DRAWS THE HEIGHTFIELD IT WAS GIVEN. Every surface vertex sits at
 *     `heightAt` of its own world position, so the mesh cannot drift from
 *     what an ant walks on — and, since the finest rings went below the
 *     survey's step, the triangles BETWEEN the vertices converge on it
 *     too. That last one is measured on the real survey, at the end.
 *
 * Plus the two structural things that are invisible until they are ugly:
 * outer rings are hollow where the finer ring covers them, and every ring
 * hangs a skirt so the seams between levels cannot show sky.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ISLAND_SPAN, samePoint, snapTo, translate, world, type WorldPoint } from '../src/world/coords';
import { setOrigin, toLocal } from '../src/world/origin';
import {
  COARSE_SAMPLES, COARSE_STEP, HD_STEP, HD_TILE_SAMPLES, ISLAND_HALF_SPAN,
  decodeCoarse, decodeHdTile, hdSamplePoint, hdTileFromName, hdTileName, hdTilesNear, type HdTileId,
} from '../src/world/dem';
import { repairGrid } from '../src/world/demRepair';
import { Heightfield } from '../src/world/heightfield';
import { FINEST_QUAD, REFILLS_PER_UPDATE, RING_LEVELS, RING_QUADS, SUB_HD_LEVELS, TerrainView, colourAt } from '../src/terrain/TerrainView';
import type { DemGrid } from '../src/world/dem';

/** A whole-island grid at one height, so every expectation is exact. */
function flatGrid(decimetres: number): DemGrid {
  const samples = new Int16Array(COARSE_SAMPLES * COARSE_SAMPLES);
  samples.fill(decimetres);
  return { side: COARSE_SAMPLES, samples };
}

/** Rising eastward, so a vertex's height depends on where it is. */
function rampGrid(perSample: number): DemGrid {
  const samples = new Int16Array(COARSE_SAMPLES * COARSE_SAMPLES);
  for (let row = 0; row < COARSE_SAMPLES; row += 1) {
    for (let col = 0; col < COARSE_SAMPLES; col += 1) samples[row * COARSE_SAMPLES + col] = col * perSample;
  }
  return { side: COARSE_SAMPLES, samples };
}

/**
 * GROUND WITH CURVATURE IN IT, and the reason this exists.
 *
 * `rampGrid` is linear, and the heightfield interpolates linearly, so on
 * a ramp the middle of any three evenly-spaced collinear vertices ALREADY
 * equals the mean of its neighbours. Every assertion about the boundary
 * stitch is therefore true whether the stitch ran or not: deleting it
 * outright left all eighteen tests in this file green. Nothing about a
 * stitch is observable on a plane — it needs a surface that bends.
 */
function hillGrid(): DemGrid {
  const samples = new Int16Array(COARSE_SAMPLES * COARSE_SAMPLES);
  for (let row = 0; row < COARSE_SAMPLES; row += 1) {
    for (let col = 0; col < COARSE_SAMPLES; col += 1) {
      // Two incommensurable waves, so no lattice this test uses can land
      // on a period and read as flat by accident.
      samples[row * COARSE_SAMPLES + col] = Math.round(
        900 * Math.sin(col / 7.3) * Math.cos(row / 5.1) + 400 * Math.sin((col + row) / 3.7),
      );
    }
  }
  return { side: COARSE_SAMPLES, samples };
}

const viewOf = (grid: DemGrid, over: Partial<{ levels: number; ringQuads: number; refillsPerUpdate: number }> = {}): TerrainView =>
  new TerrainView({ field: new Heightfield(grid), ...over });

const idOf = (name: string): HdTileId => {
  const id = hdTileFromName(name);
  if (!id) throw new Error(`not a tile name: ${name}`);
  return id;
};

const meshes = (view: TerrainView): THREE.Mesh[] =>
  view.group.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh === true);

/**
 * Update at `at` until nothing is left to refill, and say how many
 * updates it took, the final no-op included. Bounded: the ration drains
 * eleven rings in six updates, and a loop that ran longer is a bug.
 */
const settle = (view: TerrainView, at: WorldPoint): number => {
  for (let n = 1; n <= RING_LEVELS + 1; n += 1) {
    view.update(at);
    if (view.lastRebuilt === 0 && view.lastDeferred === 0) return n;
  }
  throw new Error('the clipmap never settled');
};

/** The centre ring `level` wants for a camera at `at`: snapped to twice its quad. */
const centreOf = (level: number, at: WorldPoint): WorldPoint => snapTo(at, FINEST_QUAD * 2 ** (level + 1));

/** Which rings a move from `from` to `to` stales, from the snapping rule itself rather than from the view. */
const staledBy = (from: WorldPoint, to: WorldPoint): number[] => {
  const out: number[] = [];
  for (let level = 0; level < RING_LEVELS; level += 1) {
    if (!samePoint(centreOf(level, from), centreOf(level, to))) out.push(level);
  }
  return out;
};

/**
 * THE HOLE IS WHERE THE FINER RING IS: the finer ring's centre must be
 * this ring's centre plus the offset it cut its hole at, in its own
 * quads — whether or not every ring is current. With the origin at 0,0
 * a mesh's position is its centre in world units. `bounded` also asks
 * for the offset to be within one quad, which is the guarantee under
 * normal motion and not during a teleport.
 */
const expectHolesAroundFinerRings = (view: TerrainView, bounded: boolean): void => {
  const all = meshes(view);
  const offsets = view.holeOffsets();
  for (let i = 1; i < all.length; i += 1) {
    const quad = FINEST_QUAD * 2 ** i;
    expect(all[i - 1].position.x).toBeCloseTo(all[i].position.x + offsets[i].x * quad, 3);
    expect(all[i - 1].position.z).toBeCloseTo(all[i].position.z + offsets[i].z * quad, 3);
    if (bounded) {
      // More than one quad either way means the snapping changed and the
      // hole is now a guess.
      expect(Math.abs(offsets[i].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(offsets[i].z)).toBeLessThanOrEqual(1);
    }
  }
};

describe('what it costs', () => {
  it('covers more than the island, for about two character models of vertices', () => {
    const view = viewOf(flatGrid(0));
    expect(view.ringCount()).toBe(RING_LEVELS);
    expect(view.reach()).toBeCloseTo(FINEST_QUAD * 2 ** (RING_LEVELS - 1) * RING_QUADS, 3);
    // The reach is seven doublings of the survey's own step across 64
    // quads, and it does NOT depend on how many rings sit below that
    // step: the sub-survey levels are added inside, not outside.
    expect(view.reach()).toBeCloseTo(HD_STEP * 2 ** 7 * RING_QUADS, 3);
    expect(view.reach()).toBeGreaterThan(ISLAND_SPAN);
    // THE NUMBER THAT MUST NOT GROW. Eleven rings of 4,225 surface
    // vertices and a 256-vertex skirt: 49,291. It grew once, by the three
    // sub-survey rings, on purpose and with the measurement in the file.
    expect(view.vertexCount()).toBe(RING_LEVELS * ((RING_QUADS + 1) ** 2 + 4 * RING_QUADS));
    expect(view.vertexCount()).toBeLessThan(50_000);
    view.dispose();
  });

  it('draws the finest ring at an eighth of the survey’s step, and level SUB_HD_LEVELS at the step itself', () => {
    expect(SUB_HD_LEVELS).toBe(3);
    expect(FINEST_QUAD).toBe(HD_STEP / 2 ** SUB_HD_LEVELS);
    // Exact, not close: every quad in the ladder is a binary fraction of
    // the survey's step, so a snapped centre lands on the lattice with no
    // rounding at all.
    expect(FINEST_QUAD * 2 ** SUB_HD_LEVELS).toBe(HD_STEP);
    const view = viewOf(flatGrid(0));
    const all = meshes(view);
    const quadOf = (m: THREE.Mesh): number => {
      const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute;
      return pos.getX(1) - pos.getX(0);
    };
    expect(quadOf(all[0])).toBeCloseTo(FINEST_QUAD, 6);
    expect(quadOf(all[SUB_HD_LEVELS])).toBeCloseTo(HD_STEP, 6);
    view.dispose();
  });

  it('is one draw call a ring, and no more', () => {
    const view = viewOf(flatGrid(0));
    expect(meshes(view)).toHaveLength(RING_LEVELS);
    view.dispose();
  });
});

describe('what it rebuilds', () => {
  it('fills every ring once, then nothing while the camera holds still', () => {
    const view = viewOf(flatGrid(0));
    view.update(world(0, 0));
    // THE FIRST FILL IS EXEMPT from the ration: every ring, in one call,
    // behind the loading screen. Pinned as more than the ration so the
    // exemption is what this measures rather than a ration that happens
    // to be large enough.
    expect(RING_LEVELS).toBeGreaterThan(REFILLS_PER_UPDATE);
    expect(view.lastRebuilt).toBe(RING_LEVELS);
    expect(view.lastDeferred).toBe(0);
    view.update(world(0, 0));
    expect(view.lastRebuilt).toBe(0);
    // A step far smaller than the finest ring's own grid moves nothing.
    view.update(world(10, 10));
    expect(view.lastRebuilt).toBe(0);
    view.dispose();
  });

  it('rebuilds only the rings whose own grid actually moved', () => {
    const view = viewOf(flatGrid(0));
    view.update(world(0, 0));
    // Half of ring 0's snap step: ring 0 moves, and nothing coarser does.
    view.update(world(FINEST_QUAD, 0));
    expect(view.lastRebuilt).toBe(1);
    view.dispose();
  });

  it('redraws in the new frame of reference when the origin rebases, without touching a height', () => {
    // The origin is module-owned, so this drives the REAL one and puts it
    // back. A rebase moves where the ground is drawn and nothing else:
    // heights are world facts and do not depend on the frame it is
    // drawn in, which is the whole point of the two point types.
    setOrigin(world(0, 0));
    const view = viewOf(flatGrid(120));
    view.update(world(0, 0));
    const before = (meshes(view)[0].geometry.getAttribute('position') as THREE.BufferAttribute).array.slice();

    // On the origin's own 1024 lattice, because setOrigin snaps to it:
    // 512,000 = 500 x 1024 and -256,000 = -250 x 1024.
    setOrigin(world(512_000, -256_000));
    view.update(world(0, 0));
    expect(view.lastRebuilt).toBe(0);
    expect(meshes(view)[0].position.x).toBeCloseTo(-512_000, 6);
    expect(meshes(view)[0].position.z).toBeCloseTo(256_000, 6);
    expect((meshes(view)[0].geometry.getAttribute('position') as THREE.BufferAttribute).array).toEqual(before);
    view.dispose();
    setOrigin(world(0, 0));
  });
});

describe('the rings line up with each other', () => {
  it('cuts each hole exactly where the finer ring landed, at every camera position', () => {
    // THE BUG THIS PINS, seen in the first screenshot: every ring snaps to
    // its OWN lattice, so ring N sits at a multiple of its two-quad step —
    // which is one quad of ring N+1 — and lands offset from the middle of
    // ring N+1's hole. Cut the hole in the middle anyway and you get sky
    // through a gap on one side and z-fighting on the other.
    setOrigin(world(0, 0));
    const view = viewOf(flatGrid(0));
    const all = meshes(view);

    // A spread of positions including exact lattice points, half-steps and
    // ugly ones, because the offset only appears at some of them.
    const positions = [0, 1, FINEST_QUAD / 2, FINEST_QUAD, FINEST_QUAD * 1.5,
      FINEST_QUAD * 3, 12_345, -98_765, 1_000_000, -2_400_000];
    for (const px of positions) {
      for (const pz of [0, FINEST_QUAD * 2.5, -654_321]) {
        const at = world(px, pz);
        // A jump this size leaves rings lagging for a few updates. The
        // hole must be around where the finer ring ACTUALLY is on every
        // one of them, and within one quad once everything has caught up.
        for (let n = 0; n < RING_LEVELS; n += 1) {
          view.update(at);
          expectHolesAroundFinerRings(view, false);
          if (view.lastDeferred === 0) break;
        }
        expect(view.lastDeferred).toBe(0);
        expectHolesAroundFinerRings(view, true);
      }
    }
    expect(all.length).toBe(RING_LEVELS);
    view.dispose();
  });

  it('never leaves the innermost ring with a hole', () => {
    const view = viewOf(flatGrid(0));
    view.update(world(123_456, -78_910));
    expect(view.holeOffsets()[0]).toEqual({ x: 0, z: 0 });
    const solid = meshes(view)[0].geometry.getIndex();
    const hollow = meshes(view)[1].geometry.getIndex();
    if (!solid || !hollow) throw new Error('rings must be indexed');
    expect(hollow.count).toBeLessThan(solid.count);
    view.dispose();
  });

  it('keeps every ring from level SUB_HD_LEVELS outward on the survey’s own lattice, wherever the camera is', () => {
    // WHAT THE SUB-SURVEY RINGS MUST NOT BREAK. Two arguments in the
    // renderer assume a ring's vertices sit on a sample lattice: the
    // stale-on-tile rule (a ring at the coarse step or above samples only
    // coarse sample points, so a tile cannot change it) and the seam
    // (a fine ring's even vertices coincide with the coarse ring's). Both
    // hold because a ring snaps to twice its own quad and its vertices
    // are whole quads from there — which is true at ANY quad, but this
    // says so with real positions rather than by inspection.
    setOrigin(world(0, 0));
    const view = viewOf(flatGrid(0));
    const all = meshes(view);
    const onLattice = (w: number, step: number): boolean => {
      const index = (w + ISLAND_HALF_SPAN) / step;
      return Math.abs(index - Math.round(index)) < 1e-6;
    };
    let checked = 0;
    for (const px of [0, 1, 12_345, -98_765, FINEST_QUAD * 1.5, 1_000_000.25]) {
      for (const pz of [0, FINEST_QUAD * 2.5, -654_321.75]) {
        view.update(world(px, pz));
        for (let level = 0; level < all.length; level += 1) {
          const mesh = all[level];
          const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
          const skirtFrom = mesh.geometry.userData.skirtFrom as number;
          const quad = FINEST_QUAD * 2 ** level;
          for (let i = 0; i < skirtFrom; i += 131) {
            // The origin is at 0,0, so drawn position is world position.
            const wx = mesh.position.x + pos.getX(i);
            const wz = mesh.position.z + pos.getZ(i);
            expect(onLattice(wx, quad)).toBe(true);
            expect(onLattice(wz, quad)).toBe(true);
            if (level >= SUB_HD_LEVELS) {
              expect(onLattice(wx, HD_STEP)).toBe(true);
              expect(onLattice(wz, HD_STEP)).toBe(true);
            }
            if (quad >= COARSE_STEP) {
              expect(onLattice(wx, COARSE_STEP)).toBe(true);
              expect(onLattice(wz, COARSE_STEP)).toBe(true);
            }
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    view.dispose();
  });
});

describe('when the ground itself changes under it', () => {
  it('redraws when a streamed tile lands, even though the camera has not moved', () => {
    // THE BUG THIS PINS: a ring was refilled only when it MOVED. A tile
    // downloaded under a camera standing still reached nobody — the whole
    // streaming layer drew nothing until the player happened to travel
    // far enough — and once they did, the rings caught up at eight
    // different rates and pulled the stitched seam apart between them.
    setOrigin(world(0, 0));
    const field = new Heightfield(flatGrid(-100));
    const view = new TerrainView({ field });
    view.update(world(0, 0));
    expect(view.lastRebuilt).toBe(RING_LEVELS);
    view.update(world(0, 0));
    expect(view.lastRebuilt).toBe(0);

    const before = (meshes(view)[0].geometry.getAttribute('position') as THREE.BufferAttribute).array.slice();

    // A tile with different ground in it lands under the parked camera.
    const bumpy = new Int16Array(HD_TILE_SAMPLES * HD_TILE_SAMPLES);
    for (let i = 0; i < bumpy.length; i += 1) bumpy[i] = -100 + (i % 37) * 3;
    field.addTile(idOf('E5'), { side: HD_TILE_SAMPLES, samples: bumpy });

    view.update(world(0, 0));
    expect(view.lastRebuilt).toBeGreaterThan(0);
    const after = (meshes(view)[0].geometry.getAttribute('position') as THREE.BufferAttribute).array;
    expect(after).not.toEqual(before);
    // And it settles — over the ration rather than in one frame: five
    // rings are stale and two go an update, so two more updates do the
    // rest and the one after that has nothing left to do.
    let refilled = view.lastRebuilt;
    let updates = 0;
    while (view.lastDeferred > 0 && updates < RING_LEVELS) {
      view.update(world(0, 0));
      refilled += view.lastRebuilt;
      updates += 1;
    }
    expect(updates).toBe(2);
    expect(refilled).toBe(SUB_HD_LEVELS + 2);
    view.update(world(0, 0));
    expect(view.lastRebuilt).toBe(0);
    view.dispose();
  });

  it('refills only the rings a tile can possibly change, not all of them', () => {
    // A ring whose quad is the coarse lattice's own step samples ONLY at
    // coarse sample points, and decimating the high-detail grid by four
    // reproduces the coarse grid exactly there. So a tile arriving cannot
    // change one vertex of those rings, and refilling them would be six
    // rings of wasted work — the most expensive thing this class does —
    // on every one of the nine downloads at boot.
    setOrigin(world(0, 0));
    const field = new Heightfield(flatGrid(-100));
    const view = new TerrainView({ field });
    view.update(world(0, 0));

    const bumpy = new Int16Array(HD_TILE_SAMPLES * HD_TILE_SAMPLES);
    for (let i = 0; i < bumpy.length; i += 1) bumpy[i] = -100 + (i % 37) * 3;
    field.addTile(idOf('E5'), { side: HD_TILE_SAMPLES, samples: bumpy });
    // Drained over the ration; what is counted is the total.
    let refilled = 0;
    let updates = 0;
    do {
      view.update(world(0, 0));
      refilled += view.lastRebuilt;
      updates += 1;
    } while (view.lastDeferred > 0 && updates < RING_LEVELS);

    const finerThanCoarse = [];
    for (let level = 0; level < RING_LEVELS; level += 1) {
      if (FINEST_QUAD * 2 ** level < COARSE_STEP) finerThanCoarse.push(level);
    }
    // The three sub-survey rings, the survey-step ring and the one above
    // it; the six from the coarse step outward are left alone.
    expect(finerThanCoarse.length).toBe(SUB_HD_LEVELS + 2);
    expect(refilled).toBe(finerThanCoarse.length);
    expect(updates).toBe(Math.ceil(finerThanCoarse.length / REFILLS_PER_UPDATE));
    view.dispose();
  });

  it('drops back to the coarse lattice when a tile is evicted', () => {
    setOrigin(world(0, 0));
    const field = new Heightfield(flatGrid(-100));
    const view = new TerrainView({ field });
    const bumpy = new Int16Array(HD_TILE_SAMPLES * HD_TILE_SAMPLES);
    for (let i = 0; i < bumpy.length; i += 1) bumpy[i] = -100 + (i % 37) * 3;
    field.addTile(idOf('E5'), { side: HD_TILE_SAMPLES, samples: bumpy });
    view.update(world(0, 0));
    const withTile = (meshes(view)[0].geometry.getAttribute('position') as THREE.BufferAttribute).array.slice();

    field.dropTile(idOf('E5'));
    view.update(world(0, 0));
    expect(view.lastRebuilt).toBeGreaterThan(0);
    expect((meshes(view)[0].geometry.getAttribute('position') as THREE.BufferAttribute).array).not.toEqual(withTile);
    view.dispose();
  });
});

describe('what it draws', () => {
  it('puts every surface vertex at the heightfield’s own answer', () => {
    setOrigin(world(0, 0));
    const grid = rampGrid(20);
    const field = new Heightfield(grid);
    const view = new TerrainView({ field });
    view.update(world(0, 0));

    for (const mesh of meshes(view)) {
      const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const skirtFrom = mesh.geometry.userData.skirtFrom as number;
      // The origin is at 0,0 here, so drawn position IS world position.
      const centreX = mesh.position.x;
      const centreZ = mesh.position.z;
      // A spread of surface vertices, not all of them: the property is per
      // vertex. The outer boundary is EXCLUDED — those are pinned to the
      // coarse ring's line so the seam has no T-junction, which is the one
      // deliberate exception and is checked on its own below.
      const runs = mesh.geometry.userData.edgeRuns as number[][];
      const onEdge = new Set(runs.flat());
      let checked = 0;
      for (let i = 0; i < skirtFrom; i += 97) {
        if (onEdge.has(i)) continue;
        const here = world(centreX + position.getX(i), centreZ + position.getZ(i));
        expect(position.getY(i)).toBeCloseTo(field.heightAt(here), 3);
        checked += 1;
      }
      expect(checked).toBeGreaterThan(0);
    }
    view.dispose();
  });

  it('pins each ring’s boundary to the line the coarse ring draws, so the seam has no gap', () => {
    // THE 83 SKY-COLOURED PIXELS, as a test. Two fine edge segments meet
    // one coarse segment; the fine vertex in between is off the coarse
    // line, and that hairline is the sky. Averaging it onto the line makes
    // the two polylines identical, so there is nothing left to leak.
    setOrigin(world(0, 0));
    const field = new Heightfield(hillGrid());
    const view = new TerrainView({ field });
    view.update(world(0, 0));
    const all = meshes(view);

    // The fixture must actually bend, or this test is about a plane again.
    // On a plane the stitch is a no-op and its removal is invisible.
    let bends = 0;
    for (let m = 0; m < all.length - 1; m += 1) {
      const pos = all[m].geometry.getAttribute('position') as THREE.BufferAttribute;
      const runs = all[m].geometry.userData.edgeRuns as number[][];
      for (const run of runs) {
        for (let i = 1; i < run.length - 1; i += 2) {
          const here = world(all[m].position.x + pos.getX(run[i]), all[m].position.z + pos.getZ(run[i]));
          const mean = (pos.getY(run[i - 1]) + pos.getY(run[i + 1])) / 2;
          if (Math.abs(field.heightAt(here) - mean) > 1) bends += 1;
        }
      }
    }
    expect(bends).toBeGreaterThan(100);

    for (let m = 0; m < all.length - 1; m += 1) {
      const position = all[m].geometry.getAttribute('position') as THREE.BufferAttribute;
      const runs = all[m].geometry.userData.edgeRuns as number[][];
      let stitched = 0;
      for (const run of runs) {
        for (let i = 1; i < run.length - 1; i += 2) {
          const mean = (position.getY(run[i - 1]) + position.getY(run[i + 1])) / 2;
          expect(position.getY(run[i])).toBeCloseTo(mean, 6);
          stitched += 1;
        }
      }
      expect(stitched).toBeGreaterThan(0);
    }

    // The OUTERMOST ring keeps its real heights: there is nothing coarser
    // outside it to agree with, and flattening its edge would be inventing.
    const outer = all[all.length - 1];
    const outerPos = outer.geometry.getAttribute('position') as THREE.BufferAttribute;
    const outerRuns = outer.geometry.userData.edgeRuns as number[][];
    let trueHeights = 0;
    for (const run of outerRuns) {
      for (let i = 1; i < run.length - 1; i += 2) {
        const here = world(outer.position.x + outerPos.getX(run[i]), outer.position.z + outerPos.getZ(run[i]));
        const mean = (outerPos.getY(run[i - 1]) + outerPos.getY(run[i + 1])) / 2;
        expect(outerPos.getY(run[i])).toBeCloseTo(field.heightAt(here), 3);
        // And on THIS fixture that is a different number from the mean,
        // so the assertion above is about the outermost ring keeping its
        // real heights rather than about arithmetic that holds anywhere.
        if (Math.abs(field.heightAt(here) - mean) > 1) trueHeights += 1;
      }
    }
    expect(trueHeights).toBeGreaterThan(0);
    view.dispose();
  });

  it('hangs every ring’s skirt below its own edge, and never above it', () => {
    const view = viewOf(flatGrid(300));
    view.update(world(0, 0));
    const surface = 3000;
    for (const mesh of meshes(view)) {
      const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const skirtFrom = mesh.geometry.userData.skirtFrom as number;
      expect(skirtFrom).toBeLessThan(position.count);
      for (let i = 0; i < skirtFrom; i += 1) expect(position.getY(i)).toBeCloseTo(surface, 6);
      for (let i = skirtFrom; i < position.count; i += 1) expect(position.getY(i)).toBeLessThan(surface);
    }
    view.dispose();
  });

  it('leaves a hole in every ring but the finest, where the finer one covers', () => {
    const view = viewOf(flatGrid(0));
    const all = meshes(view);
    const innermost = all[0].geometry.getIndex();
    const next = all[1].geometry.getIndex();
    if (!innermost || !next) throw new Error('rings must be indexed');
    // The hollow ring draws its middle quarter as nothing, so it carries
    // about three quarters of the solid ring's triangles plus its skirt.
    expect(next.count).toBeLessThan(innermost.count);
    expect(next.count).toBeGreaterThan(innermost.count / 2);
    view.dispose();
  });
});

describe('the refill is rationed', () => {
  // THE HITCH THIS PINS: a refill is 3.3 ms in node and likely 8 or more
  // on a phone, and a tile landing stales five rings at once. Two a
  // frame, finest first, and the rest wait — see the header of the
  // renderer for why the lag that leaves is bounded.
  it('pins the ration at two, the most rings a frame can stale by movement alone', () => {
    expect(REFILLS_PER_UPDATE).toBe(2);
  });

  /**
   * A move that stales exactly four rings, chosen from the snapping rule
   * rather than found by trial: on x, 0 to 800 crosses the snap lines of
   * rings 0, 1 and 2 (odd multiples of 171, 342 and 684 units); on z,
   * 1,300 to 1,400 crosses ring 3's line at 1,367 and no other ring's.
   * `staledBy` says so from the rule itself before the view is asked.
   */
  const HOME = world(0, 1300);
  const THERE = world(800, 1400);

  const expectAt = (mesh: THREE.Mesh, centre: WorldPoint): void => {
    expect(mesh.position.x).toBeCloseTo(centre.wx, 3);
    expect(mesh.position.z).toBeCloseTo(centre.wz, 3);
  };

  it('refills two rings an update, finest first, and catches up on the next', () => {
    setOrigin(world(0, 0));
    const view = viewOf(flatGrid(0));
    settle(view, HOME);
    expect(staledBy(HOME, THERE)).toEqual([0, 1, 2, 3]);
    const all = meshes(view);

    view.update(THERE);
    expect(view.lastRebuilt).toBe(2);
    expect(view.lastDeferred).toBe(2);
    // The two finest moved to their new lattice; the two deferred stayed
    // exactly where they were, heights and all.
    for (const level of [0, 1]) expectAt(all[level], centreOf(level, THERE));
    for (const level of [2, 3]) expectAt(all[level], centreOf(level, HOME));

    view.update(THERE);
    expect(view.lastRebuilt).toBe(2);
    expect(view.lastDeferred).toBe(0);
    view.update(THERE);
    expect(view.lastRebuilt).toBe(0);
    // Every ring is now at its snapped centre.
    for (let level = 0; level < RING_LEVELS; level += 1) expectAt(all[level], centreOf(level, THERE));
    view.dispose();
  });

  it('keeps every hole around where the finer ring ACTUALLY is while rings lag, within the one-quad bound', () => {
    setOrigin(world(0, 0));
    const view = viewOf(flatGrid(0));
    settle(view, HOME);

    view.update(THERE);
    expect(view.lastDeferred).toBe(2);
    // Mid-lag: rings 0 and 1 are on THERE's lattice, rings 2 and 3 still
    // on HOME's. Ring 1 moved one of ring 2's quads east and ring 2 did
    // not, so ring 2's hole is recut a quad off its middle — around where
    // ring 1 is, not where ring 2 will be.
    expectHolesAroundFinerRings(view, true);
    expect(view.holeOffsets()[2]).toEqual({ x: 1, z: 0 });
    expect(view.holeOffsets()[3]).toEqual({ x: 0, z: 1 });

    view.update(THERE);
    expect(view.lastDeferred).toBe(0);
    expectHolesAroundFinerRings(view, true);
    view.update(THERE);
    expect(view.lastRebuilt).toBe(0);
    expectHolesAroundFinerRings(view, true);
    view.dispose();
  });

  it('drains a tile landing, five stale rings, in three updates, and moves nothing while it does', () => {
    setOrigin(world(0, 0));
    const field = new Heightfield(flatGrid(-100));
    const view = new TerrainView({ field });
    settle(view, HOME);
    const all = meshes(view);
    const bumpy = new Int16Array(HD_TILE_SAMPLES * HD_TILE_SAMPLES);
    for (let i = 0; i < bumpy.length; i += 1) bumpy[i] = -100 + (i % 37) * 3;
    field.addTile(idOf('E5'), { side: HD_TILE_SAMPLES, samples: bumpy });

    const drained: number[] = [];
    for (let n = 0; n < 4; n += 1) {
      view.update(HOME);
      drained.push(view.lastRebuilt);
      // Nothing moved: a revision drain is heights only, so the holes are
      // trivially where they were and every centre is still HOME's.
      expectHolesAroundFinerRings(view, true);
      for (let level = 0; level < RING_LEVELS; level += 1) expectAt(all[level], centreOf(level, HOME));
    }
    expect(drained).toEqual([2, 2, 1, 0]);
    view.dispose();
  });

  it('exempts the first fill, so the world is whole before the first frame', () => {
    const view = viewOf(flatGrid(0));
    view.update(world(123_456, -78_910));
    expect(view.lastRebuilt).toBe(RING_LEVELS);
    expect(view.lastDeferred).toBe(0);
    view.dispose();
  });

  it('honours an override of the ration, which is how the unrationed clipmap is measured', () => {
    setOrigin(world(0, 0));
    const view = viewOf(flatGrid(0), { refillsPerUpdate: Infinity });
    settle(view, HOME);
    view.update(THERE);
    expect(view.lastRebuilt).toBe(4);
    expect(view.lastDeferred).toBe(0);
    view.dispose();
  });
});

describe('the drawn ground converges on heightAt near the camera, on the real survey', () => {
  // THE BUG THIS PINS: objects seated on `heightAt` — bilinear between the
  // survey's samples — stood on, or under, a mesh that drew the same
  // samples as two triangles a quad. Between the vertices the two differ
  // by the quad's twist; on Waimea's canyon wall that was median 15 cm,
  // p90 71 cm, max 4.2 m, and Joshua saw objects underground. The fix is
  // three ring levels below the survey's step, and the proof is measured
  // on the shipped bytes rather than on a fixture that could not twist.
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const readPublic = (rel: string): ArrayBuffer => {
    const bytes = readFileSync(path.join(ROOT, 'public', rel));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  };
  /** A point on the Waimea canyon wall, from the measurement that found the bug. */
  const CANYON = world(-1_215_200, -143_200);

  /** The coarse survey with every high-detail tile within 200 m of the point resident, as the streamer would have it. */
  const surveyed = (): Heightfield => {
    const field = new Heightfield(repairGrid(decodeCoarse(readPublic('kauai-1025.bin'))).grid);
    for (const id of hdTilesNear(CANYON, 20_000)) {
      field.addTile(id, repairGrid(decodeHdTile(readPublic(path.join('kauai-hd', `${hdTileName(id)}.bin`)))).grid);
    }
    return field;
  };

  /**
   * A fixed 15 x 15 lattice within 40 m of the camera: 523 units a step,
   * a prime, so no probe lands on a ring vertex or a survey sample by
   * accident and every one is inside a triangle. No Math.random.
   */
  const probes = (): WorldPoint[] => {
    const out: WorldPoint[] = [];
    for (let i = -7; i <= 7; i += 1) {
      for (let j = -7; j <= 7; j += 1) out.push(translate(CANYON, i * 523, j * 523));
    }
    return out;
  };

  /**
   * What a ring DRAWS at a point: the triangle from its own index buffer
   * that contains the point, interpolated from its own vertex heights.
   * Walks the buffer rather than assuming the split, so a change to how
   * quads are cut is caught here rather than assumed away.
   */
  const drawnHeight = (mesh: THREE.Mesh, at: WorldPoint): number => {
    const l = toLocal(at);
    const px = l.lx - mesh.position.x;
    const pz = l.lz - mesh.position.z;
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = mesh.geometry.getIndex();
    if (!index) throw new Error('rings must be indexed');
    const skirtFrom = mesh.geometry.userData.skirtFrom as number;
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t);
      const b = index.getX(t + 1);
      const c = index.getX(t + 2);
      if (a >= skirtFrom || b >= skirtFrom || c >= skirtFrom) continue;
      const ax = pos.getX(a); const az = pos.getZ(a);
      const bx = pos.getX(b); const bz = pos.getZ(b);
      const cx = pos.getX(c); const cz = pos.getZ(c);
      const det = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
      if (det === 0) continue;
      const u = ((px - ax) * (cz - az) - (cx - ax) * (pz - az)) / det;
      const v = ((bx - ax) * (pz - az) - (px - ax) * (bz - az)) / det;
      if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue;
      return pos.getY(a) + u * (pos.getY(b) - pos.getY(a)) + v * (pos.getY(c) - pos.getY(a));
    }
    throw new Error(`no surface triangle of ${mesh.name} contains ${at.wx}, ${at.wz}`);
  };

  /**
   * What the OLD finest ring drew, analytically: `heightAt` at the four
   * corners of the survey cell, split (a,c,b),(b,c,d) as `cutHole` does.
   * The old ring snapped to twice the survey's step, so its vertices WERE
   * the survey's samples and this is its triangle exactly.
   */
  const surveyTriangleHeight = (field: Heightfield, at: WorldPoint): number => {
    const col = (at.wx + ISLAND_HALF_SPAN) / HD_STEP;
    const row = (at.wz + ISLAND_HALF_SPAN) / HD_STEP;
    const c0 = Math.floor(col);
    const r0 = Math.floor(row);
    const fc = col - c0;
    const fr = row - r0;
    const ha = field.heightAt(hdSamplePoint(c0, r0));
    const hb = field.heightAt(hdSamplePoint(c0 + 1, r0));
    const hc = field.heightAt(hdSamplePoint(c0, r0 + 1));
    const hd = field.heightAt(hdSamplePoint(c0 + 1, r0 + 1));
    return fc + fr <= 1 ? ha + fc * (hb - ha) + fr * (hc - ha) : hd + (1 - fc) * (hc - hd) + (1 - fr) * (hb - hd);
  };

  it('draws the canyon wall within 5 cm of heightAt at every probe within 40 m of the camera', () => {
    const field = surveyed();
    expect(field.sample(CANYON).detail).toBe('hd');
    setOrigin(CANYON);
    const view = new TerrainView({ field });
    view.update(CANYON);
    const finest = meshes(view)[0];
    let worst = 0;
    for (const at of probes()) {
      worst = Math.max(worst, Math.abs(drawnHeight(finest, at) - field.heightAt(at)));
    }
    // 5 units is 5 cm. MEASURED on a 41 x 41 lattice at 2 m over the same
    // 40 m: median 0.32, p90 1.3, p99 3.3, max 4.5 units — the brief's
    // 1.1 cm is the p90 and holds; the single worst quad here has a
    // 3.4 m twist and keeps 4.5 cm of it even at an eighth of the step.
    // One more level would take that to 1.1 cm for another ring's cost.
    expect(worst).toBeLessThanOrEqual(5);
    view.dispose();
    setOrigin(world(0, 0));
  });

  it('would not have at the survey’s own step: the old finest ring was off by more than 20 cm', () => {
    // The mutation this guards: set SUB_HD_LEVELS back to 0 and the test
    // above fails by this much, so the change is proven needed rather
    // than merely present.
    const field = surveyed();
    let worstOld = 0;
    for (const at of probes()) {
      worstOld = Math.max(worstOld, Math.abs(surveyTriangleHeight(field, at) - field.heightAt(at)));
    }
    expect(worstOld).toBeGreaterThan(20);

    // And the analytic triangle IS what the old clipmap drew: build the
    // pre-subdivision view through the option that exists for exactly
    // this, and its finest ring agrees with the arithmetic to float32.
    setOrigin(CANYON);
    const old = new TerrainView({ field, finestQuad: HD_STEP, levels: 8 });
    old.update(CANYON);
    const finest = meshes(old)[0];
    for (const at of probes()) {
      expect(drawnHeight(finest, at)).toBeCloseTo(surveyTriangleHeight(field, at), 1);
    }
    old.dispose();
    setOrigin(world(0, 0));
  });
});

describe('the colour stands in for a texture, and says which way is up', () => {
  it('draws sea floor cold and land warm, without pretending to be water', () => {
    const deep = colourAt(-200_000);
    const shore = colourAt(0);
    const forest = colourAt(40_000);
    // Deep is blue: more blue than red, and dark.
    expect(deep.b).toBeGreaterThan(deep.r);
    // Land is not.
    expect(forest.g).toBeGreaterThan(forest.b);
    expect(shore.r).toBeGreaterThan(deep.r);
  });

  it('is continuous, so the ground has no painted contour lines', () => {
    const below = colourAt(24_900);
    const above = colourAt(25_100);
    expect(Math.abs(below.r - above.r)).toBeLessThan(0.05);
    expect(Math.abs(below.g - above.g)).toBeLessThan(0.05);
    expect(Math.abs(below.b - above.b)).toBeLessThan(0.05);
  });

  it('holds its ends rather than running off the ramp', () => {
    expect(colourAt(-9_000_000).getHex()).toBe(colourAt(-300_000).getHex());
    expect(colourAt(9_000_000).getHex()).toBe(colourAt(160_000).getHex());
  });

  it('stays green all the way to the summit, because Kauaʻi has no treeline', () => {
    // Waiʻaleʻale's 1,548 m top is a rainforest bog, the wettest place on
    // Earth. A generic height ramp paints it grey, which is a mountain
    // from somewhere else.
    const summit = colourAt(155_000);
    expect(summit.g).toBeGreaterThan(summit.r);
    expect(summit.g).toBeGreaterThan(summit.b);
  });

  it('makes bare rock a matter of slope, not height', () => {
    // The island's rock is its cliffs — Waimea's walls, the Napali face.
    const meadow = colourAt(60_000, 5);
    const cliff = colourAt(60_000, 70);
    expect(meadow.g).toBeGreaterThan(meadow.r);
    expect(cliff.r).toBeGreaterThan(cliff.g);
    // Gradual, so a hillside is not a hard line where the rule trips.
    const slope = colourAt(60_000, 45);
    expect(slope.r).toBeGreaterThan(meadow.r);
    expect(slope.r).toBeLessThan(cliff.r);
  });

  it('never paints rock onto the sea floor, however steep the seamount is', () => {
    // The flanks below the island are 20 degrees and more, and a rock face
    // painted down there would be visible through nothing at all.
    expect(colourAt(-100_000, 80).getHex()).toBe(colourAt(-100_000, 0).getHex());
  });
});
