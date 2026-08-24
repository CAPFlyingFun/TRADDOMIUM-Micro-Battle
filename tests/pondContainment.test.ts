import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  containedPondLevel, decodePond, forgetPond, pondCellsIn, usePond, type PondField,
} from '../src/world/pond';
import { decodeGrid, SAMPLES, SPAN } from '../src/world/kauai';
import { tessellatePonds } from '../src/world/LakeWater';
import { waterBodyAt } from '../src/world/water';
import { terrainHeight, useGrid } from '../src/world/heightfield';

const DRY = -32768;
const STEP = SPAN / (SAMPLES - 1);

function oneCell(levelMetres = 10): PondField {
  const level = new Int16Array(SAMPLES * SAMPLES).fill(DRY);
  const middle = (SAMPLES >> 1) * SAMPLES + (SAMPLES >> 1);
  level[middle] = levelMetres * 10;
  return { grid: SAMPLES, level };
}

afterEach(() => forgetPond());

describe('terrain-contained pond water', () => {
  it('fills a bowl only to its saddle/spill height', () => {
    usePond(oneCell());
    const spill = 1_000;
    expect(containedPondLevel(0, 0, 200)).toBe(spill);
    expect(containedPondLevel(0, 0, spill)).toBeNull();
    expect(containedPondLevel(0, 0, spill + 1)).toBeNull();
    // Across the nearest-sample boundary the bake is dry, even when the
    // synthetic terrain beyond the saddle is lower.
    expect(containedPondLevel(STEP / 2 + 1, 0, 0)).toBeNull();
  });

  it('clips the visible body to the same terrain test used by queries', () => {
    usePond(oneCell());
    const cells = pondCellsIn(-STEP, -STEP, STEP, STEP);
    const bed = (x: number, z: number) => {
      // Bowl with a dry saddle/ridge through its eastern half.
      const bowl = 250 + (x * x + z * z) / 5_000;
      const saddle = 1_250 - Math.abs(x - 1_200) * 0.45 - Math.abs(z) * 0.6;
      return Math.max(bowl, saddle);
    };
    const geometry = tessellatePonds(cells, 0, 0, bed, 250);
    expect(geometry).not.toBeNull();
    const position = geometry!.getAttribute('position');
    let hasShore = false;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      expect(y).toBeLessThanOrEqual(1_000 + 1e-4);
      expect(y).toBeGreaterThanOrEqual(bed(x, z) - 2);
      if (Math.abs(y - 1_000) < 1e-3 && Math.abs(bed(x, z) - 1_000) < 2) {
        hasShore = true;
      }
    }
    expect(hasShore).toBe(true);
    geometry!.dispose();
  });

  it('builds exterior walls but not a wall between equal-level cells', () => {
    const field = oneCell();
    const centre = (SAMPLES >> 1) * SAMPLES + (SAMPLES >> 1);
    field.level[centre + 1] = 100;
    usePond(field);
    const geometry = tessellatePonds(pondCellsIn(-STEP, -STEP, STEP * 2, STEP), 0, 0, () => 0, STEP);
    expect(geometry).not.toBeNull();
    const position = geometry!.getAttribute('position');
    let exterior = false;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      if (y < 999) exterior = true;
      // x = STEP / 2 is the shared cell edge. It may carry top vertices,
      // but never a down-going internal wall.
      if (Math.abs(x - STEP / 2) < 1e-3 && Math.abs(position.getZ(i)) < STEP / 2 - 1) {
        expect(y).toBeCloseTo(1_000, 4);
      }
    }
    expect(exterior).toBe(true);
    geometry!.dispose();
  });

  it('gives gameplay the terrain-derived body at the rendered level', () => {
    usePond(oneCell());
    const body = waterBodyAt(0, 0, 0);
    expect(body).toMatchObject({
      kind: 'lake',
      level: 1_000,
      flowX: 0,
      flowZ: 0,
    });
  });

  it('keeps the reported screenshot neighbourhood inside the pond mesh budget', () => {
    const file = readFileSync('public/kauai-water.bin');
    usePond(decodePond(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)));
    const terrainFile = readFileSync('public/kauai-1025.bin');
    useGrid(decodeGrid(
      terrainFile.buffer.slice(terrainFile.byteOffset, terrainFile.byteOffset + terrainFile.byteLength),
    ));
    const wx = 2_102_506.08;
    const wz = -302_504.88;
    expect(containedPondLevel(wx, wz, terrainHeight(wx, wz))).toBe(2_280);
    const cells = pondCellsIn(2_052_506, -352_505, 2_152_506, -252_505);
    const geometry = tessellatePonds(cells, wx, wz);
    expect(geometry).not.toBeNull();
    // The target covers top triangles; exterior walls are allowed a small,
    // explicit margin without turning a dense wet area into unbounded work.
    expect(geometry!.getIndex()!.count / 3).toBeLessThanOrEqual(110_000);
    geometry!.dispose();
  });
});