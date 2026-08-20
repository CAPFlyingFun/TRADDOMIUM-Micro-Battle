import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  bandFor, groundDetail, groundHeight, hasGrid, ISLAND_SPAN, SAMPLE_STEP, useGrid,
} from '../src/world/heightfield';
import { decodeGrid, heightAt, type HeightGrid } from '../src/world/kauai';

const ASSET = fileURLToPath(new URL('../public/kauai-1025.bin', import.meta.url));

let grid: HeightGrid;

beforeAll(() => {
  const file = readFileSync(ASSET);
  grid = decodeGrid(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
  );
  useGrid(grid);
});

describe('the ground everyone shares', () => {
  it('is loaded', () => {
    expect(hasGrid()).toBe(true);
  });

  it('is deterministic', () => {
    for (const [x, z] of [
      [0, 0],
      [137.5, -820.25],
      [-2100.1, 640.5],
    ]) {
      expect(groundHeight(x, z)).toBe(groundHeight(x, z));
    }
  });

  it('leaves the sea alone', () => {
    // Relief must not pimple the water into islands, so anywhere the
    // baked grid is at or below the waterline the height passes through.
    let checked = 0;
    for (let x = -ISLAND_SPAN / 2; x < ISLAND_SPAN / 2; x += 137) {
      for (let z = -ISLAND_SPAN / 2; z < ISLAND_SPAN / 2; z += 149) {
        const base = heightAt(grid, x, z);
        if (base > 0) continue;
        expect(groundHeight(x, z)).toBe(base);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('adds relief on land, but stays close to the real elevation', () => {
    // The mesh draws quads about 11 units wide, so added relief has to
    // stay small enough that the ant is never far off the drawn surface.
    let moved = 0;
    let worst = 0;
    for (let x = -1200; x <= 1200; x += 53) {
      for (let z = -1200; z <= 1200; z += 61) {
        const base = heightAt(grid, x, z);
        if (base <= 10) continue;
        const drift = Math.abs(groundHeight(x, z) - base);
        worst = Math.max(worst, drift);
        if (drift > 1e-6) moved++;
      }
    }
    expect(moved).toBeGreaterThan(100);
    expect(worst).toBeLessThan(1.6);
  });

  it('keeps the shading mottle inside its range', () => {
    for (let i = 0; i < 400; i++) {
      const d = groundDetail(i * 13.7, i * -7.3);
      expect(d).toBeGreaterThanOrEqual(-1);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it('reaches ant-world scale', () => {
    // The "huge tiny world" pillar: she walks ~6 units/s, so crossing
    // the island must be a long trek, not a stroll.
    expect(ISLAND_SPAN / 6).toBeGreaterThan(600);
    // Elevation samples are a few body-lengths apart.
    expect(SAMPLE_STEP).toBeGreaterThan(1);
    expect(SAMPLE_STEP).toBeLessThan(20);
  });
});

describe('elevation bands', () => {
  it('runs sea to summit in order as the ground rises', () => {
    expect(bandFor(-40)).toBe('seabed');
    expect(bandFor(-0.3)).toBe('reef');
    expect(bandFor(0.6)).toBe('sand');
    expect(bandFor(12)).toBe('lowland');
    expect(bandFor(45)).toBe('jungle');
    expect(bandFor(100)).toBe('cliff');
    expect(bandFor(150)).toBe('peak');
  });

  it('never leaves a height unbanded', () => {
    for (let h = -80; h < 200; h += 0.37) {
      expect(bandFor(h)).toBeTruthy();
    }
  });
});
