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
import { beforeAll, describe, expect, it } from 'vitest';
import {
  groundHeight, ISLAND_SPAN, NEAR_STEP, NEAR_VERTS, SECTIONS, terrainHeight, useGrid,
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
 * find the section, find the quad, pick the triangle, interpolate its
 * plane. This mirrors `buildSection`'s vertex grid and its index order
 * (tl, bl, tr / tr, bl, br — so the diagonal runs bl to tr).
 */
function meshHeight(x: number, z: number): number {
  const span = ISLAND_SPAN / SECTIONS;
  const step = span / (NEAR_VERTS - 1);
  const originX = Math.floor((x + ISLAND_SPAN / 2) / span) * span - ISLAND_SPAN / 2;
  const originZ = Math.floor((z + ISLAND_SPAN / 2) / span) * span - ISLAND_SPAN / 2;
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

  it('still reads the sea as the sea', () => {
    // The flattening must not lift the seabed above the waterline, or
    // the spawn search starts finding land in the ocean.
    let x = -ISLAND_SPAN / 2 + 40;
    expect(groundHeight(x, x)).toBeLessThan(0);
  });
});
