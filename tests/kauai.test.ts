import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  decodeGrid, findLandfall, heightAt, HEIGHT_SCALE, SAMPLES, slopeAt, SPAN, STEP,
  type HeightGrid,
} from '../src/world/kauai';

const ASSET = fileURLToPath(new URL('../public/kauai-1025.bin', import.meta.url));

let grid: HeightGrid;

beforeAll(() => {
  const file = readFileSync(ASSET);
  grid = decodeGrid(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
  );
});

describe('the baked Kauai grid', () => {
  it('is the size the bake promises', () => {
    expect(grid.length).toBe(SAMPLES * SAMPLES);
  });

  it('rejects a grid of the wrong size', () => {
    expect(() => decodeGrid(new ArrayBuffer(16))).toThrow(/expected/);
  });

  it('carries the real island: a summit near Kawaikini, and an ocean', () => {
    let max = -Infinity;
    let land = 0;
    for (const raw of grid) {
      if (raw > max) max = raw;
      if (raw > 0) land++;
    }
    // Kauai's high point is 1598 m; the striding bake lands just under.
    const summitMetres = (max * HEIGHT_SCALE) / 0.1;
    expect(summitMetres).toBeGreaterThan(1500);
    expect(summitMetres).toBeLessThan(1650);
    // Roughly half the square is island, the rest is sea.
    const landFraction = land / grid.length;
    expect(landFraction).toBeGreaterThan(0.3);
    expect(landFraction).toBeLessThan(0.7);
  });

  it('puts the summit inside the island, not out at sea', () => {
    let bestAt = 0;
    let max = -Infinity;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] > max) {
        max = grid[i];
        bestAt = i;
      }
    }
    const col = bestAt % SAMPLES;
    const row = (bestAt - col) / SAMPLES;
    const x = col * STEP - SPAN / 2;
    const z = row * STEP - SPAN / 2;
    expect(Math.hypot(x, z)).toBeLessThan(SPAN * 0.4);
    expect(heightAt(grid, x, z)).toBeCloseTo(max * HEIGHT_SCALE, 5);
  });
});

describe('sampling the grid', () => {
  it('interpolates between samples instead of stepping', () => {
    // Walk a line and count how often the height changes: a stepped
    // sampler would repeat each value across a whole cell.
    const y0 = heightAt(grid, 0, 0);
    let changes = 0;
    for (let i = 1; i <= 12; i++) {
      if (heightAt(grid, (i * STEP) / 12, 0) !== y0) changes++;
    }
    expect(changes).toBeGreaterThan(8);
  });

  it('holds the edge sample out beyond the grid', () => {
    const edge = heightAt(grid, SPAN, SPAN);
    expect(Number.isFinite(edge)).toBe(true);
    expect(edge).toBe(heightAt(grid, SPAN * 4, SPAN * 4));
  });

  it('never returns the raw nodata marker as a height', () => {
    // -32768 decimetres would be a 327-unit hole; the floor catches it.
    for (let i = 0; i < grid.length; i += 997) {
      const col = i % SAMPLES;
      const row = (i - col) / SAMPLES;
      const h = heightAt(grid, col * STEP - SPAN / 2, row * STEP - SPAN / 2);
      expect(h).toBeGreaterThan(-61);
    }
  });

  it('finds a landfall spot that is actually on dry land', () => {
    const spot = findLandfall(grid, 3, 20);
    const h = heightAt(grid, spot.x, spot.z);
    expect(h).toBeGreaterThanOrEqual(3);
    expect(h).toBeLessThanOrEqual(20);
  });

  it('lands her on level ground, not a Kauai cliff face', () => {
    // A chase camera behind an ant on a steep slope ends up inside the
    // hill, clamped to the dirt with the view full of mud. The spawn
    // has to be flat enough that the camera has somewhere to stand.
    const spot = findLandfall(grid, 3, 20);
    expect(slopeAt(grid, spot.x, spot.z)).toBeLessThan(0.1);
  });
});
