/**
 * THE CLIPMAP, AND THE THREE CLAIMS IT LIVES OR DIES ON.
 *
 *  1. IT IS CHEAP, AND STAYS CHEAP. The whole reason for rings rather
 *     than tiles is that the vertex count does not grow with the world:
 *     eight levels must cover more than the island for about the price of
 *     one character model. A change that quietly makes this 200,000
 *     vertices would still look right on a desktop and kill the phone.
 *  2. IT DOES NOT REBUILD WHAT DID NOT MOVE. Refilling all eight rings
 *     every frame is 26,000 heightfield reads a frame — invisible in a
 *     screenshot, fatal in a frame budget. The count is exposed so a test
 *     can watch it.
 *  3. IT DRAWS THE HEIGHTFIELD IT WAS GIVEN. Every surface vertex sits at
 *     `heightAt` of its own world position, so the mesh cannot drift from
 *     what an ant walks on.
 *
 * Plus the two structural things that are invisible until they are ugly:
 * outer rings are hollow where the finer ring covers them, and every ring
 * hangs a skirt so the seams between levels cannot show sky.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ISLAND_SPAN, world } from '../src/world/coords';
import { setOrigin } from '../src/world/origin';
import { COARSE_SAMPLES, HD_STEP } from '../src/world/dem';
import { Heightfield } from '../src/world/heightfield';
import { FINEST_QUAD, RING_LEVELS, RING_QUADS, TerrainView, colourAt } from '../src/terrain/TerrainView';
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

const viewOf = (grid: DemGrid, over: Partial<{ levels: number; ringQuads: number }> = {}): TerrainView =>
  new TerrainView({ field: new Heightfield(grid), ...over });

const meshes = (view: TerrainView): THREE.Mesh[] =>
  view.group.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh === true);

describe('what it costs', () => {
  it('covers more than the island, for about one character model of vertices', () => {
    const view = viewOf(flatGrid(0));
    expect(view.ringCount()).toBe(RING_LEVELS);
    // Eight doublings from the survey's own 13.67 m step.
    expect(view.reach()).toBeCloseTo(FINEST_QUAD * 2 ** (RING_LEVELS - 1) * RING_QUADS, 3);
    expect(view.reach()).toBeGreaterThan(ISLAND_SPAN);
    // THE NUMBER THAT MUST NOT GROW.
    expect(view.vertexCount()).toBeLessThan(40_000);
    view.dispose();
  });

  it('draws the finest ring at the survey’s own step, so it invents no detail', () => {
    expect(FINEST_QUAD).toBe(HD_STEP);
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
    expect(view.lastRebuilt).toBe(RING_LEVELS);
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
        view.update(world(px, pz));
        const offsets = view.holeOffsets();
        for (let i = 1; i < all.length; i += 1) {
          const quad = FINEST_QUAD * 2 ** i;
          // The offset can only ever be one quad either way. More than
          // that means the snapping changed and the hole is now a guess.
          expect(Math.abs(offsets[i].x)).toBeLessThanOrEqual(1);
          expect(Math.abs(offsets[i].z)).toBeLessThanOrEqual(1);
          // And the hole is where the finer ring IS: its centre must be
          // this ring's centre plus exactly that offset.
          expect(all[i - 1].position.x).toBeCloseTo(all[i].position.x + offsets[i].x * quad, 3);
          expect(all[i - 1].position.z).toBeCloseTo(all[i].position.z + offsets[i].z * quad, 3);
        }
      }
    }
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
    const grid = rampGrid(20);
    const field = new Heightfield(grid);
    const view = new TerrainView({ field });
    view.update(world(0, 0));
    const all = meshes(view);

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
        expect(outerPos.getY(run[i])).toBeCloseTo(field.heightAt(here), 3);
        trueHeights += 1;
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
