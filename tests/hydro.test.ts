/**
 * THE RIVERS ARE REAL, AND THEY LAND ON THE ISLAND.
 *
 * TMB spent a summer deriving its own waterways and every water bug it
 * shipped came from the same root: the network was computed on one
 * island and drawn on another. A surveyed network cannot drift that way
 * — but a BAKE can, and the transform from BE's metres to TMB's
 * centimetres is exactly the kind of arithmetic that goes wrong quietly.
 * A factor of ten here puts the Wailua in the sea and nothing throws.
 *
 * So these hold the file to the ground it claims to describe, on the
 * shipped island, in the units the game reads.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeHydro, metres, NO_TILE, type Hydro } from '../src/world/hydro';
import { decodeGrid } from '../src/world/kauai';
import { baseLand, setRelief, setSmoothing, useGrid } from '../src/world/heightfield';

const HYDRO = fileURLToPath(new URL('../public/kauai-hydro.bin', import.meta.url));
const GRID = fileURLToPath(new URL('../public/kauai-1025.bin', import.meta.url));
let hydro: Hydro;

beforeAll(() => {
  const h = readFileSync(HYDRO);
  hydro = decodeHydro(h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength) as ArrayBuffer);
  const g = readFileSync(GRID);
  useGrid(decodeGrid(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength) as ArrayBuffer));
  setRelief(1);
});

describe('the surveyed hydrography', () => {
  it('carries the whole island', () => {
    expect(hydro.rivers.length).toBe(1121);
    expect(hydro.x.length).toBe(49_665);
    expect(hydro.lakes.length).toBe(111);
    // Every run has points, and every run's slice is inside the arrays.
    for (const r of hydro.rivers) {
      expect(r.count).toBeGreaterThan(0);
      expect(r.first + r.count).toBeLessThanOrEqual(hydro.x.length);
    }
  });

  it('knows what the rivers are called', () => {
    const named = hydro.rivers.filter((r) => r.name);
    expect(named.length).toBe(264);
    const names = new Set(named.map((r) => r.name));
    // If the string table is off by one these come back as neighbours'
    // names, or as undefined, and the count above would not notice.
    expect(names).toContain('Hanalei River');
    expect(names).toContain('Anahola Stream');
    expect([...names].every((n) => typeof n === 'string' && n.length > 0)).toBe(true);
  });

  it('carries the drainage topology, not just the lines', () => {
    // Strahler order and ocean connectivity are the half of this file
    // that a derived network kept getting wrong. An order outside 1..5
    // or a run with no order at all means the bake dropped a field.
    const orders = new Set(hydro.rivers.map((r) => r.order));
    expect([...orders].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(hydro.rivers.filter((r) => r.toOcean).length).toBe(140);
    // A fifth-order run is a real river and must be one of the big ones.
    const big = hydro.rivers.filter((r) => r.order === 5);
    expect(big.length).toBeGreaterThan(0);
    expect(big.some((r) => r.toOcean)).toBe(true);
  });

  it('runs downhill, which is the one thing water always does', () => {
    // The bake states its levels are monotonic downstream. If the scale
    // transform inverted anything, or the points were written in the
    // wrong order, this is where it shows.
    let checked = 0;
    for (const r of hydro.rivers) {
      for (let i = r.first + 1; i < r.first + r.count; i++) {
        // A centimetre of tolerance: the levels are rounded integers.
        expect(hydro.level[i]).toBeLessThanOrEqual(hydro.level[i - 1] + 1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(40_000);
  });

  it('sits on the island rather than beside it', () => {
    // THE ASSERTION THIS FILE EXISTS FOR. A scale error, an axis flip or
    // a sign slip all leave a file that decodes perfectly and describes
    // somewhere else. Measured against the SHIPPED 1025 grid, unblurred.
    setSmoothing(0);
    let near = 0, n = 0;
    let worst = 0;
    for (let i = 0; i < hydro.x.length; i += 7) {
      const ground = baseLand(hydro.x[i], hydro.z[i]);
      if (ground <= -10_000 || ground >= 200_000) continue;
      n++;
      const off = Math.abs(metres(hydro.level[i] - ground));
      if (off < 10) near++; else worst = Math.max(worst, off);
    }
    expect(n).toBeGreaterThan(5_000);
    // 89.1% on the strided grid, 96.9% on the HD tiles. Set below both:
    // a factor-of-ten slip scores essentially zero here.
    expect(near / n).toBeGreaterThan(0.85);
  });

  it('puts the water inside the world', () => {
    const HALF = 2_800_000;   // the island's own half-span, in units
    for (let i = 0; i < hydro.x.length; i += 13) {
      expect(Math.abs(hydro.x[i])).toBeLessThan(HALF);
      expect(Math.abs(hydro.z[i])).toBeLessThan(HALF);
    }
    // Widths are surveyed, not invented: a few metres, never a kilometre.
    let widest = 0;
    for (const w of hydro.width) widest = Math.max(widest, w);
    expect(metres(widest)).toBeGreaterThan(20);
    expect(metres(widest)).toBeLessThan(60);
  });
});

describe('the lakes', () => {
  it('are closed rings at a real waterline', () => {
    expect(hydro.lakes.length).toBe(111);
    let holes = 0;
    for (const l of hydro.lakes) {
      // Ring 0 is the shoreline; anything after it is an island in the
      // lake. A lake with no rings at all would draw as nothing.
      expect(l.ringCount).toBeGreaterThan(0);
      holes += l.ringCount - 1;
      const shore = l.firstRing;
      expect(hydro.ringCount[shore]).toBeGreaterThan(2);   // a polygon
      expect(l.level).toBeGreaterThan(0);                  // above the sea
    }
    expect(holes).toBe(6);
  });

  it('stand where the island has somewhere to hold them', () => {
    setSmoothing(0);
    let held = 0;
    for (const l of hydro.lakes) {
      // The shoreline's own ground should be near the waterline: that is
      // what a shoreline IS. Sampled at the ring's first vertex.
      const v = hydro.ringFirst[l.firstRing];
      const ground = baseLand(hydro.vertX[v], hydro.vertZ[v]);
      if (Math.abs(metres(l.level - ground)) < 25) held++;
    }
    // Reservoirs are dammed, so some sit proud of the coarse grid by
    // more than this; most should not.
    expect(held / hydro.lakes.length).toBeGreaterThan(0.5);
  });

  it('name the ones people named', () => {
    const named = hydro.lakes.filter((l) => l.name);
    expect(named.length).toBe(64);
    expect(named.some((l) => l.name?.includes('Reservoir'))).toBe(true);
  });
});

describe('the format itself', () => {
  it('refuses a file that is not one', () => {
    expect(() => decodeHydro(new ArrayBuffer(32))).toThrow(/not a TMBH/);
  });

  it('refuses a truncated one rather than reading past the end', () => {
    const h = readFileSync(HYDRO);
    const cut = h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength - 64);
    expect(() => decodeHydro(cut as ArrayBuffer)).toThrow(/bytes, expected/);
  });

  it('marks a run the bake could not place', () => {
    // Not every run got a tile, and 255 has to stay distinguishable from
    // tile 255 if the split ever grows past 64.
    expect(NO_TILE).toBe(255);
    for (const r of hydro.rivers) {
      expect(r.tile === NO_TILE || (r.tile >= 0 && r.tile < 64)).toBe(true);
    }
  });
});
