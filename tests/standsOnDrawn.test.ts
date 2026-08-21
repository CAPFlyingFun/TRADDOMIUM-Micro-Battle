/**
 * SHE STANDS ON THE SURFACE THAT IS DRAWN.
 *
 * The bug this file exists for: `terrainHeight` is smooth and
 * continuous, but the mesh built from it is flat triangles 10.94 units
 * across — eleven times the length of the ant — sampling that function
 * only at their corners. She stood on the smooth one and the player saw
 * the flat one, so across the spawn area she sat up to 3.36 units, over
 * three body lengths, under the visible ground and clipped through it.
 *
 * Raising the mesh resolution could not have fixed it. At 513 vertices
 * a section — a quarter of a million vertices, unpayable on a phone —
 * she still sank 0.06 units. The gap has to be zero by construction,
 * which means the walker reading the triangle rather than the source.
 *
 * `meshHeight` below is deliberately an INDEPENDENT reimplementation,
 * written from the scene's vertex and index order rather than by
 * calling the code under test. A test that asked `groundHeight` to
 * agree with itself would pass no matter what either of them did.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CELL_SPAN, CELL_VERTS, groundHeight, ISLAND_SPAN, NEAR_STEP, setRelief,
  setSmoothing, terrainHeight, useGrid,
} from '../src/world/heightfield';
import { decodeGrid, findLandfall, type HeightGrid } from '../src/world/kauai';

const ASSET = fileURLToPath(new URL('../public/kauai-1025.bin', import.meta.url));
let grid: HeightGrid;

beforeAll(() => {
  const file = readFileSync(ASSET);
  grid = decodeGrid(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
  );
  useGrid(grid);
});

/**
 * The height the DRAWN mesh has at (x, z), worked out the long way:
 * find the cell, find the quad, pick the triangle, interpolate its
 * plane. This mirrors `buildCell`'s vertex grid and its index order
 * (tl, bl, tr / tr, bl, br — so the diagonal runs bl to tr).
 */
function meshHeight(x: number, z: number): number {
  const step = CELL_SPAN / (CELL_VERTS - 1);
  const originX = Math.floor(x / CELL_SPAN) * CELL_SPAN;
  const originZ = Math.floor(z / CELL_SPAN) * CELL_SPAN;
  const ix = Math.floor((x - originX) / step);
  const iz = Math.floor((z - originZ) / step);
  const fx = (x - originX) / step - ix;
  const fz = (z - originZ) / step - iz;
  const at = (cx: number, cz: number) =>
    terrainHeight(originX + cx * step, originZ + cz * step);

  if (fx + fz <= 1) {
    const tl = at(ix, iz);
    return tl + (at(ix + 1, iz) - tl) * fx + (at(ix, iz + 1) - tl) * fz;
  }
  const br = at(ix + 1, iz + 1);
  return br + (at(ix, iz + 1) - br) * (1 - fx) + (at(ix + 1, iz) - br) * (1 - fz);
}

/** Walk a patch of the spawn area, worst case first. */
function worstGap(reach: number, step: number): { worst: number; where: [number, number] } {
  const start = findLandfall(grid, 3, 20);
  let worst = 0;
  let where: [number, number] = [start.x, start.z];
  for (let dx = -reach; dx <= reach; dx += step) {
    for (let dz = -reach; dz <= reach; dz += step) {
      const x = start.x + dx;
      const z = start.z + dz;
      if (terrainHeight(x, z) <= 0) continue;
      const gap = Math.abs(meshHeight(x, z) - groundHeight(x, z));
      if (gap > worst) {
        worst = gap;
        where = [x, z];
      }
    }
  }
  return { worst, where };
}

afterEach(() => { setRelief(1); setSmoothing(0); });

describe('the walked surface is the drawn surface', () => {
  it('never differs anywhere near the spawn', () => {
    const { worst, where } = worstGap(200, 1.7);
    expect(worst, `worst at ${where.map((v) => v.toFixed(0)).join(', ')}`).toBeLessThan(1e-6);
  });

  it('lands exactly on the vertices themselves', () => {
    // At a lattice corner both triangles and the source agree, so this
    // is the one place the OLD code was also right — which is why the
    // clipping came and went as she walked rather than being constant.
    const start = findLandfall(grid, 3, 20);
    for (let i = 0; i < 12; i++) {
      const x = Math.round((start.x + i * 37) / NEAR_STEP) * NEAR_STEP;
      const z = Math.round((start.z + i * 53) / NEAR_STEP) * NEAR_STEP;
      expect(groundHeight(x, z)).toBeCloseTo(terrainHeight(x, z), 6);
    }
  });

  it('is made of flat triangles, which is the honest shape of it', () => {
    // Halfway along a quad's edge the drawn surface is the average of
    // its ends, never the curve the source takes. If this ever starts
    // matching the source again, the walker has drifted back onto the
    // invisible surface.
    const start = findLandfall(grid, 3, 20);
    const x = Math.round(start.x / NEAR_STEP) * NEAR_STEP;
    const z = Math.round(start.z / NEAR_STEP) * NEAR_STEP;
    const flat = (terrainHeight(x, z) + terrainHeight(x + NEAR_STEP, z)) / 2;
    expect(groundHeight(x + NEAR_STEP / 2, z)).toBeCloseTo(flat, 6);
  });

  it('still agrees when the relief dial flattens the island', () => {
    // The dial scales the section meshes on Y and scales groundHeight
    // by the same number. If those two ever drift, she walks through a
    // flattened island exactly as she used to walk through a full one —
    // so the invariant is retested rather than assumed to carry over.
    for (const relief of [0.1, 0.35, 0.7, 1.5]) {
      setRelief(relief);
      const start = findLandfall(grid, 3, 20);
      let worst = 0;
      for (let dx = -120; dx <= 120; dx += 3.1) {
        for (let dz = -120; dz <= 120; dz += 3.1) {
          const x = start.x + dx;
          const z = start.z + dz;
          if (terrainHeight(x, z) <= 0) continue;
          // The mesh is BUILT at full height and scaled, so the drawn
          // height is the unscaled triangle times the dial.
          worst = Math.max(worst, Math.abs(meshHeight(x, z) * relief - groundHeight(x, z)));
        }
      }
      expect(worst, `at relief ${relief}`).toBeLessThan(1e-6);
    }
  });

  it('flattens every slope by the dial, which is the point of it', () => {
    // Halving the height halves every rise over the same run, so the
    // tangent of every slope halves with it. That is the claim the
    // slider is making to the player.
    const start = findLandfall(grid, 3, 20);
    const rise = (r: number) => {
      setRelief(r);
      return groundHeight(start.x + NEAR_STEP, start.z) - groundHeight(start.x, start.z);
    };
    const full = rise(1);
    expect(rise(0.5)).toBeCloseTo(full * 0.5, 9);
    expect(rise(0.1)).toBeCloseTo(full * 0.1, 9);
  });

  it('still agrees when the smoothing dial blurs the island', () => {
    // Smoothing moves the vertices themselves rather than scaling them,
    // so the mesh is genuinely rebuilt. Both sides read terrainHeight,
    // which is where the blend lives — but that is the kind of thing
    // worth checking rather than reasoning about.
    for (const amount of [0.25, 0.6, 1]) {
      setSmoothing(amount);
      const start = findLandfall(grid, 3, 20);
      let worst = 0;
      for (let dx = -120; dx <= 120; dx += 3.1) {
        for (let dz = -120; dz <= 120; dz += 3.1) {
          const x = start.x + dx;
          const z = start.z + dz;
          if (terrainHeight(x, z) <= 0) continue;
          worst = Math.max(worst, Math.abs(meshHeight(x, z) - groundHeight(x, z)));
        }
      }
      expect(worst, `at smoothing ${amount}`).toBeLessThan(1e-6);
    }
  });

  it('is already smooth at TRUE scale, which is what fixed the creases', () => {
    // The headline of the scale change, kept as a measurement.
    //
    // At 1:1000 the mesh drew flat triangles 10.94 units apart across
    // terrain sampled every 55 metres of real Kauai, and the worst
    // fold near the spawn was 46 degrees — the visible hard V-shaped
    // edges. At true scale the same 55-metre features are drawn across
    // 5,469 units with hundreds of vertices between them, so the
    // landforms arrive as gentle slopes and the surface detail is
    // synthesised at wavelengths the lattice can actually carry.
    const start = findLandfall(grid, 3, 20);
    let worst = 0;
    for (let dx = -400; dx <= 400; dx += NEAR_STEP) {
      for (let dz = -400; dz <= 400; dz += NEAR_STEP) {
        const x = start.x + dx;
        const z = start.z + dz;
        if (terrainHeight(x, z) <= 0) continue;
        const a = Math.atan2(
          groundHeight(x, z) - groundHeight(x - NEAR_STEP, z), NEAR_STEP,
        );
        const b = Math.atan2(
          groundHeight(x + NEAR_STEP, z) - groundHeight(x, z), NEAR_STEP,
        );
        worst = Math.max(worst, Math.abs(b - a));
      }
    }
    const degrees = (worst * 180) / Math.PI;
    expect(degrees, `worst crease ${degrees.toFixed(2)}deg`).toBeLessThan(5);
  });

  it('leaves the smoothing dial pointed at LANDFORMS, not creases', () => {
    // Worth being explicit, because the dial was built to fix creases
    // that the scale change then removed. What it still moves is the
    // baked grid — the island's own shape — and at ant scale that is
    // 55-metre features, not the ground under her feet. It is not
    // useless, but it no longer does the job it was named for.
    const start = findLandfall(grid, 3, 20);
    setSmoothing(0);
    const sharp = terrainHeight(start.x, start.z);
    setSmoothing(1);
    const soft = terrainHeight(start.x, start.z);
    expect(Math.abs(soft - sharp)).toBeGreaterThan(0);
  });

  it('still reads the sea as the sea', () => {
    // The flattening must not lift the seabed above the waterline, or
    // the spawn search starts finding land in the ocean.
    let x = -ISLAND_SPAN / 2 + 40;
    expect(groundHeight(x, x)).toBeLessThan(0);
  });
});
