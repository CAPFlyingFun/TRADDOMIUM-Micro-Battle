import { describe, expect, it } from 'vitest';
import { world } from '../src/world/coords';
import { SparseSoil } from '../src/world/SparseSoil';
import { MAX_SOIL_STROKES, readSoilEdits, SOIL_CELL } from '../src/world/soilTypes';

const p = (x: number, y: number, z = 0) => ({ at: world(x, z), height: y });
const flat = () => new SparseSoil({ heightAt: () => 0 });

describe('shared voxel soil', () => {
  it('subtracts a continuous three-dimensional bore without changing the survey', () => {
    const grid = new Float32Array([0, 0, 0, 0]);
    const soil = new SparseSoil({ heightAt: () => grid[0] });
    expect(soil.dig('burrower', p(-2, -1), p(2, -1), .3)).toBe(true);
    for (let x = -2; x <= 2; x += .05) {
      expect(soil.densityAt(world(x, 0), -1)).toBeLessThan(0);
      expect(soil.densityAt(world(x, .5), -1)).toBeGreaterThan(0);
    }
    expect(soil.densityAt(world(0, 0), -.3)).toBeGreaterThan(0);
    expect([...grid]).toEqual([0, 0, 0, 0]);
  });

  it('joins vertical entry to underground travel and exposes the changed surface to readers', () => {
    const soil = flat();
    soil.dig('player-ant', p(0, .2), p(0, -1), .3);
    soil.dig('colony-ant', p(0, -1), p(2, -1), .3);
    for (let y = .1; y >= -1; y -= .05) expect(soil.solidAt(world(0, 0), y)).toBe(false);
    expect(soil.surfaceAt(world(0, 0))).toBeCloseTo(-1.3, 2);
    expect(soil.surfaceAt(world(1, 0))).toBe(0); // a sealed tunnel keeps its roof
    expect(soil.surfaceAt(world(4, 4))).toBe(0);
  });

  it('refuses non-diggers, malformed brushes and repeated work without consuming a save entry', () => {
    const soil = flat();
    for (const actor of ['water', 'weather', 'walking', 'aphid', 'fly']) {
      expect(soil.dig(actor, p(0, -1), p(1, -1), .3)).toBe(false);
    }
    expect(soil.dig('burrower', p(NaN, -1), p(1, -1), .3)).toBe(false);
    expect(soil.dig('burrower', p(0, -1), p(100, -1), .3)).toBe(false);
    expect(soil.dig('burrower', p(0, 5), p(1, 5), .3)).toBe(false);
    expect(soil.strokeCount).toBe(0);
    soil.dig('burrower', p(0, -1), p(1, -1), .3);
    expect(soil.dig('burrower', p(0, -1), p(1, -1), .3)).toBe(false);
    expect(soil.strokeCount).toBe(1);
  });

  it('replays after leaving the render region, at negative and large world coordinates', () => {
    const origin = -1_256_438.4;
    const soil = new SparseSoil({ heightAt: at => 20 + (at.wx - origin) * .2 });
    soil.dig('burrower', p(origin - 1, 19), p(origin + 2, 19.6), .3);
    const saved = JSON.parse(JSON.stringify(soil.snapshot()));
    soil.tilesNear(world(0, 0), 20);
    const resumed = new SparseSoil({ heightAt: at => 20 + (at.wx - origin) * .2 }, saved);
    for (let x = origin - 1; x < origin + 2; x += .07) {
      const y = 19 + (x - origin + 1) * .2;
      expect(resumed.densityAt(world(x, 0), y)).toBeCloseTo(soil.densityAt(world(x, 0), y), 8);
      expect(resumed.solidAt(world(x, 0), y)).toBe(false);
    }
    expect(resumed.tilesNear(world(origin, 0), 10).length).toBeGreaterThan(1);
  });

  it('shares lattice samples at column boundaries and invalidates only affected tiles', () => {
    const soil = flat();
    soil.dig('burrower', p(3, -.7), p(3.5, -.7), .3);
    const tiles = soil.tilesNear(world(3.2, 0), 5);
    const left = tiles.find(t => t.tx === 0 && t.tz === 0)!;
    const right = tiles.find(t => t.tx === 1 && t.tz === 0)!;
    expect(left).toBeDefined(); expect(right).toBeDefined();
    expect(soil.sample(32, -7, 0)).toBeLessThan(0);
    expect(soil.densityAt(world(32 * SOIL_CELL, 0), -.7)).toBeCloseTo(soil.sample(32, -7, 0), 8);
    soil.dig('burrower', p(20, -1), p(21, -1), .3);
    expect(soil.tile(0, 0).revision).toBe(left.revision);
  });

  it('bounds saved input and refuses a full journal without erasing existing tunnels', () => {
    const stroke = [0, -1, 0, 1, -1, 0, .3];
    const payload = { version: 1, strokes: Array.from({ length: MAX_SOIL_STROKES }, () => stroke) };
    expect(readSoilEdits(payload)).toBeDefined();
    expect(readSoilEdits({ ...payload, strokes: [...payload.strokes, stroke] })).toBeUndefined();
    expect(readSoilEdits({ version: 1, strokes: [stroke, [Infinity]] })).toBeUndefined();
    const soil = new SparseSoil({ heightAt: () => 0 }, payload);
    expect(soil.dig('burrower', p(5, -1), p(6, -1), .3)).toBe(false);
    expect(soil.atLimit).toBe(true);
    expect(soil.solidAt(world(.5, 0), -1)).toBe(false);
    expect(soil.strokeCount).toBe(MAX_SOIL_STROKES);
  });
});
