/**
 * THE FINE ISLAND AND THE COARSE ONE ARE THE SAME PLACE.
 *
 * `kauai-1025.bin` is the HD grid with fifteen of every sixteen samples
 * dropped, so where the two describe the same point they must hold the
 * same number. That is not decoration: it is what lets the streamer
 * fall back to the coarse grid for a tile that has not arrived without
 * the ground jumping under her. If it ever stops being true, the far
 * view and the dirt at her feet are different islands — which is the
 * exact class of bug that cost this project a summer of water.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeHdTile, forgetHd, hdHeightAt, hdResident, hdTileAt, hdTileIndex,
  hdTileName, hdTilesNear, HD_SAMPLES, HD_STEP, HD_TILE_BYTES,
  useHdTile,
} from '../src/world/kauaiHd';
import { decodeGrid, heightAt, SPAN, type HeightGrid } from '../src/world/kauai';
import { baseLand, setRelief, setSmoothing, useGrid } from '../src/world/heightfield';

const HD = fileURLToPath(new URL('../public/kauai-hd', import.meta.url));
let coarse: HeightGrid;

function tile(name: string): Int16Array {
  const b = readFileSync(`${HD}/${name}.bin`);
  return decodeHdTile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

beforeAll(() => {
  const g = readFileSync(fileURLToPath(new URL('../public/kauai-1025.bin', import.meta.url)));
  coarse = decodeGrid(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength) as ArrayBuffer);
  useGrid(coarse);
  setRelief(1);
  setSmoothing(0);
});

afterEach(() => { forgetHd(); });

describe('the fine grid', () => {
  it('is four times the island in each direction', () => {
    expect(HD_SAMPLES).toBe(4097);
    expect(HD_STEP).toBeCloseTo(SPAN / 4096, 6);
    // 13.67 m a sample against the coarse grid's 54.7.
    expect(HD_STEP / 100).toBeCloseTo(13.67, 1);
    expect(HD_TILE_BYTES).toBe(513 * 513 * 2);
  });

  it('names its tiles the way the bake wrote them', () => {
    expect(hdTileName(hdTileIndex(0, 0))).toBe('A1');
    expect(hdTileName(hdTileIndex(7, 7))).toBe('H8');
    expect(hdTileName(hdTileIndex(4, 6))).toBe('E7');
    // Every index round-trips, or a tile is fetched by the wrong name
    // and the ground quietly comes from somewhere else on the island.
    for (let i = 0; i < 64; i++) {
      const col = Math.floor(i / 8), row = i % 8;
      expect(hdTileIndex(col, row)).toBe(i);
    }
  });

  it('agrees with the coarse grid at every sample they share', () => {
    // THE ASSERTION EVERYTHING ELSE RESTS ON. Walk one tile's own
    // lattice and compare each fourth fine sample with the coarse
    // sample at the same world point.
    useHdTile(hdTileIndex(3, 3), tile('D4'));
    let checked = 0;
    for (let lz = 0; lz <= 508; lz += 16) {
      for (let lx = 0; lx <= 508; lx += 16) {
        const gx = 3 * 512 + lx, gz = 3 * 512 + lz;
        const x = gx * HD_STEP - SPAN / 2;
        const z = gz * HD_STEP - SPAN / 2;
        const fine = hdHeightAt(x, z);
        expect(fine).not.toBeNull();
        // Every 4th fine sample IS a coarse sample, exactly.
        if (gx % 4 === 0 && gz % 4 === 0) {
          expect(fine!).toBeCloseTo(heightAt(coarse, x, z), 3);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('carries detail the coarse grid cannot', () => {
    // If the fine grid were merely an interpolation of the coarse one,
    // the two would agree BETWEEN samples too, and streaming 33 MB
    // would be buying nothing. Sample off the shared lattice.
    useHdTile(hdTileIndex(3, 3), tile('D4'));
    let differ = 0, n = 0, worst = 0;
    for (let lz = 2; lz < 512; lz += 7) {
      for (let lx = 2; lx < 512; lx += 7) {
        const x = (3 * 512 + lx) * HD_STEP - SPAN / 2;
        const z = (3 * 512 + lz) * HD_STEP - SPAN / 2;
        const fine = hdHeightAt(x, z)!;
        if (fine <= 0) continue;                    // sea
        n++;
        const gap = Math.abs(fine - heightAt(coarse, x, z));
        worst = Math.max(worst, gap);
        if (gap > 50) differ++;                     // half a metre
      }
    }
    expect(n).toBeGreaterThan(1_000);
    expect(differ / n).toBeGreaterThan(0.3);
    expect(worst).toBeGreaterThan(500);             // metres of real relief
  });

  it('never needs two tiles to answer one point', () => {
    // The 513th column is the neighbour's first, which is what keeps a
    // bilinear read inside one file. Walk right across a tile border
    // with only the LEFT tile resident: it must answer everywhere up to
    // the border and stop cleanly after, never halfway through a cell.
    useHdTile(hdTileIndex(3, 3), tile('D4'));
    const z = (3 * 512 + 200) * HD_STEP - SPAN / 2;
    let lastAnswered = -Infinity, firstNull = Infinity;
    for (let lx = 500; lx <= 530; lx += 0.25) {
      const x = (3 * 512 + lx) * HD_STEP - SPAN / 2;
      const h = hdHeightAt(x, z);
      if (h === null) firstNull = Math.min(firstNull, lx);
      else lastAnswered = Math.max(lastAnswered, lx);
    }
    // Answers through its last full cell — [511, 512] read from this
    // tile alone — and hands over exactly at the shared edge, which is
    // the neighbour's first column. Never halfway through a cell.
    expect(lastAnswered).toBeGreaterThanOrEqual(511.75);
    expect(firstNull).toBeGreaterThanOrEqual(512);
  });

  it('meets its neighbour with no step at the shared edge', () => {
    // The seam is the reason for the 513th column: neighbours share it,
    // so the two tiles describe one surface. A step here would be a
    // cliff running the length of a 7 km tile edge.
    //
    // MEASURED AS A LIMIT, because a raw difference across the border
    // is mostly SLOPE — Kauaʻi is steep, and any two points on a
    // hillside differ. A continuous surface's step shrinks with the
    // spacing; a seam's does not. So it is sampled twice, four times
    // closer in, and the step has to shrink with it.
    useHdTile(hdTileIndex(3, 3), tile('D4'));
    useHdTile(hdTileIndex(4, 3), tile('E4'));
    const border = 4 * 512 * HD_STEP - SPAN / 2;
    const stepAt = (eps: number) => {
      let worst = 0;
      for (let lz = 40; lz < 480; lz += 3) {
        const z = (3 * 512 + lz) * HD_STEP - SPAN / 2;
        const left = hdHeightAt(border - eps, z);
        const right = hdHeightAt(border + eps, z);
        expect(left).not.toBeNull();
        expect(right).not.toBeNull();
        worst = Math.max(worst, Math.abs(left! - right!));
      }
      return worst;
    };
    const wide = stepAt(HD_STEP * 0.01);
    const close = stepAt(HD_STEP * 0.0025);
    // Four times closer, so a continuous surface's worst step falls by
    // about four. A seam would hold its height however close you look.
    expect(close).toBeLessThan(wide / 3);
    // And in absolute terms it is already down to millimetres.
    expect(close).toBeLessThan(15);
  });

  it('asks for the tiles around her and lets the rest go', () => {
    const mid = hdTileAt(0, 0);
    expect(mid).toBeGreaterThanOrEqual(0);
    // Deep inside a tile, 2 km asks for that one alone: a tile is 7 km.
    const middle = 768 * HD_STEP - SPAN / 2;      // centre of tile column 1
    expect(hdTilesNear(middle, middle, 200_000).length).toBe(1);
    // Standing on the corner where four meet, it asks for all four.
    const corner = 512 * HD_STEP - SPAN / 2;
    expect(hdTilesNear(corner, corner, 200_000).length).toBe(4);
  });

  it('refuses a tile that is the wrong size', () => {
    expect(() => decodeHdTile(new ArrayBuffer(16))).toThrow(/expected/);
    expect(() => useHdTile(0, new Int16Array(10))).toThrow(/expected/);
  });
});

describe('the ground the game reads', () => {
  it('sharpens where a tile has landed and holds elsewhere', () => {
    const x = 0, z = 0;
    setSmoothing(0);
    const before = baseLand(x, z);
    expect(hdResident()).toBe(0);
    useHdTile(hdTileAt(x, z), tile(hdTileName(hdTileAt(x, z))));
    const after = baseLand(x, z);
    // At an arbitrary point the fine island has its own answer, but it
    // may not be far off — what matters is that it is now ANSWERING.
    expect(hdResident()).toBe(1);
    expect(Number.isFinite(after)).toBe(true);
    expect(Math.abs(after - before)).toBeLessThan(20_000);   // 200 m sanity
  });

  it('still slides all the way to the blurred island on the dial', () => {
    // The dial's meaning is unchanged: 0 is real Kauaʻi, 1 is the
    // blurred copy of the coarse grid. What changed is that its sharp
    // end now has sixteen times more island in it.
    const x = 120_000, z = -80_000;
    useHdTile(hdTileAt(x, z), tile(hdTileName(hdTileAt(x, z))));
    setSmoothing(0);
    const sharp = baseLand(x, z);
    setSmoothing(1);
    const soft = baseLand(x, z);
    setSmoothing(0.5);
    const half = baseLand(x, z);
    expect(sharp).not.toBeCloseTo(soft, 1);
    // Halfway is genuinely between the two ends.
    expect(Math.min(sharp, soft)).toBeLessThanOrEqual(half + 1e-6);
    expect(half).toBeLessThanOrEqual(Math.max(sharp, soft) + 1e-6);
    setSmoothing(0);
  });
});
