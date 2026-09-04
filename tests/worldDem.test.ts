/**
 * THE FORMAT, CHECKED AGAINST THE BYTES WE ACTUALLY SHIP.
 *
 * Not a fixture and not a mock: this reads `public/kauai-1025.bin` and
 * the real high-detail tiles off disk. A DEM decoder that agrees with a
 * synthetic buffer and disagrees with the survey is worth nothing, and
 * the survey is 36 MB sitting right there.
 *
 * What it pins, and why each one would be a bad day:
 *
 *  - THE SIZES ARE THE FORMAT. Both files are headerless, so a truncated
 *    or padded download is only catchable by its length.
 *  - THE UNIT IS A DECIMETRE, proved by the island's own summit: the peak
 *    sample must come back as Kawaikini's surveyed height. If someone
 *    "fixes" HEIGHT_SCALE, Kauaʻi is ten times too tall or ten times too
 *    flat and every other number in the game still looks reasonable.
 *  - THE TWO LATTICES ARE ONE SURFACE. Decimating the high-detail grid by
 *    four must reproduce the coarse grid exactly. If that ever stops
 *    being true they are two surveys, and the ground moves under the ant
 *    as tiles arrive.
 *  - TILES SHARE THEIR EDGE. 513 = 512 + 1, and the shared line must be
 *    bit-identical, or a read near a seam depends on which of two files
 *    answered.
 *  - BATHYMETRY IS DATA. Negative samples are the sea floor, not faults —
 *    Joshua's call on 2026-09-04 was to keep the real depths rather than
 *    v0's −600 m clamp, so the range must reach the real ocean floor.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ISLAND_SPAN, world } from '../src/world/coords';
import {
  COARSE_BYTES, COARSE_SAMPLES, COARSE_STEP, HD_COLUMNS, HD_SAMPLES, HD_STEP, HD_TILES_ACROSS, HD_TILE_BYTES,
  HD_TILE_SAMPLES, HD_TILE_SPAN, HEIGHT_SCALE, ISLAND_HALF_SPAN, NODATA, coarseSamplePoint, decodeCoarse,
  decodeHdTile, hdSamplePoint, hdTileAt, hdTileFromName, hdTileName, hdTileOrigin, hdTilesNear, heightOf,
  isLittleEndian, metresOf, sampleAt, type DemGrid,
} from '../src/world/dem';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The shipped bytes, as an ArrayBuffer exactly the length of the file. */
function readPublic(rel: string): ArrayBuffer {
  const bytes = readFileSync(path.join(ROOT, 'public', rel));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const coarse = decodeCoarse(readPublic('kauai-1025.bin'));
const tile = (name: string): DemGrid => decodeHdTile(readPublic(path.join('kauai-hd', `${name}.bin`)));

/** Kawaikini, Kauaʻi's summit. MEASURED: 1,598 m. */
const KAWAIKINI_M = 1598;

describe('the lattices', () => {
  it('are the sizes the files actually are', () => {
    expect(COARSE_BYTES).toBe(2_101_250);
    expect(HD_TILE_BYTES).toBe(526_338);
    expect(coarse.side).toBe(COARSE_SAMPLES);
    expect(coarse.samples.length).toBe(COARSE_SAMPLES * COARSE_SAMPLES);
    const d4 = tile('D4');
    expect(d4.side).toBe(HD_TILE_SAMPLES);
    expect(d4.samples.length).toBe(HD_TILE_SAMPLES * HD_TILE_SAMPLES);
  });

  it('cover the island exactly, with the +1 closing the edge', () => {
    expect(HD_SAMPLES).toBe(4097);
    expect((COARSE_SAMPLES - 1) * COARSE_STEP).toBe(ISLAND_SPAN);
    expect((HD_SAMPLES - 1) * HD_STEP).toBe(ISLAND_SPAN);
    expect(HD_TILES_ACROSS * HD_TILE_SPAN).toBe(ISLAND_SPAN);
    // 7 km a tile, and the high-detail step is four coarse steps finer.
    expect(HD_TILE_SPAN).toBe(700_000);
    expect(COARSE_STEP / HD_STEP).toBe(4);
    expect(metresOf(HD_STEP)).toBeCloseTo(13.671875, 9);
    expect(metresOf(COARSE_STEP)).toBeCloseTo(54.6875, 9);
  });

  it('refuses a file that is not exactly the right size', () => {
    expect(() => decodeCoarse(new ArrayBuffer(COARSE_BYTES - 2))).toThrow(/exactly/);
    expect(() => decodeHdTile(new ArrayBuffer(HD_TILE_BYTES + 2))).toThrow(/exactly/);
    // The size is the only header, so the message must say what was wanted.
    expect(() => decodeHdTile(new ArrayBuffer(4))).toThrow(/526338/);
  });

  it('decodes a COPY, so the buffer it was handed is never edited', () => {
    const buffer = readPublic(path.join('kauai-hd', 'D4.bin'));
    const before = new Int16Array(buffer.slice(0, 8));
    const grid = decodeHdTile(buffer);
    grid.samples[0] = 1234;
    expect(new Int16Array(buffer.slice(0, 8))).toEqual(before);
  });

  it('is decoding on a little-endian machine, and says so rather than returning static', () => {
    expect(isLittleEndian()).toBe(true);
  });
});

describe('a sample is a decimetre above sea level', () => {
  it('puts the island’s summit where the survey puts it', () => {
    // THE TEST THAT PROVES THE UNIT. Anything but decimetres and this is
    // out by a factor of ten in one direction or the other.
    const peak = coarse.samples.reduce((best, s) => (s !== NODATA && s > best ? s : best), NODATA);
    expect(metresOf(heightOf(peak))).toBeGreaterThan(KAWAIKINI_M - 20);
    expect(metresOf(heightOf(peak))).toBeLessThanOrEqual(KAWAIKINI_M);
    expect(HEIGHT_SCALE).toBe(10);
  });

  it('keeps the real sea floor rather than clamping it flat', () => {
    // Joshua, 2026-09-04: keep the bathymetry. v0 raised everything below
    // −600 m to exactly −600 m, which made 27% of the world one plate.
    // Folded rather than spread: a million samples through `Math.min(...)`
    // is a million arguments, and that is a stack overflow, not a minimum.
    const floor = coarse.samples.reduce(
      (worst, s) => (s !== NODATA && s < worst ? s : worst),
      Number.POSITIVE_INFINITY,
    );
    const deepest = metresOf(heightOf(floor));
    expect(deepest).toBeLessThan(-3000);
    // A1 is the north-west corner: open ocean, nothing but sea floor.
    const a1 = tile('A1');
    expect([...a1.samples].every((s) => s < 0)).toBe(true);
  });

  it('reads out of range as NODATA rather than throwing, because an edge read is normal', () => {
    expect(sampleAt(coarse, -1, 0)).toBe(NODATA);
    expect(sampleAt(coarse, 0, COARSE_SAMPLES)).toBe(NODATA);
    expect(sampleAt(coarse, 0, 0)).toBe(coarse.samples[0]);
  });
});

describe('the two lattices are one surface', () => {
  it('decimating the high-detail grid by four reproduces the coarse grid exactly', () => {
    // Checked on one tile's worth rather than all 64: the property is per
    // sample, and D4 is interior so it has land, relief and no edge case.
    const d4 = tile('D4');
    const col0 = 3 * (HD_TILE_SAMPLES - 1);
    const row0 = 3 * (HD_TILE_SAMPLES - 1);
    let compared = 0;
    for (let r = 0; r < HD_TILE_SAMPLES - 1; r += 4) {
      for (let c = 0; c < HD_TILE_SAMPLES - 1; c += 4) {
        const fine = sampleAt(d4, c, r);
        const coarseSample = sampleAt(coarse, (col0 + c) / 4, (row0 + r) / 4);
        expect(fine).toBe(coarseSample);
        compared += 1;
      }
    }
    expect(compared).toBe(128 * 128);
  });

  it('gives neighbouring tiles a bit-identical shared edge', () => {
    // 513 = 512 + 1. The last column of D4 IS the first column of E4, so
    // a read near the seam never needs two files.
    const d4 = tile('D4');
    const e4 = tile('E4');
    for (let r = 0; r < HD_TILE_SAMPLES; r += 1) {
      expect(sampleAt(d4, HD_TILE_SAMPLES - 1, r)).toBe(sampleAt(e4, 0, r));
    }
    // And the same going south: D4's last row is D5's first.
    const d5 = tile('D5');
    for (let c = 0; c < HD_TILE_SAMPLES; c += 1) {
      expect(sampleAt(d4, c, HD_TILE_SAMPLES - 1)).toBe(sampleAt(d5, c, 0));
    }
  });
});

describe('where a sample is in the world', () => {
  it('centres the island on the origin', () => {
    expect(ISLAND_HALF_SPAN).toBe(2_800_000);
    expect(coarseSamplePoint(0, 0)).toEqual(world(-ISLAND_HALF_SPAN, -ISLAND_HALF_SPAN));
    expect(coarseSamplePoint(COARSE_SAMPLES - 1, COARSE_SAMPLES - 1)).toEqual(
      world(ISLAND_HALF_SPAN, ISLAND_HALF_SPAN),
    );
    expect(hdSamplePoint((HD_SAMPLES - 1) / 2, (HD_SAMPLES - 1) / 2)).toEqual(world(0, 0));
  });

  it('agrees between the two lattices at a shared point', () => {
    // Coarse sample n is high-detail sample 4n; they must be the same place.
    for (const n of [0, 1, 37, 512, 1024]) {
      expect(coarseSamplePoint(n, n)).toEqual(hdSamplePoint(n * 4, n * 4));
    }
  });
});

describe('the high-detail tiles', () => {
  it('names the letter for the column and the digit for the row, A1 north-west', () => {
    expect(hdTileName({ col: 0, row: 0 })).toBe('A1');
    expect(hdTileName({ col: 7, row: 7 })).toBe('H8');
    expect(hdTileName({ col: 3, row: 4 })).toBe('D5');
    expect(HD_COLUMNS).toHaveLength(HD_TILES_ACROSS);
    // Every name the loader will ever ask for is a file we ship.
    for (let col = 0; col < HD_TILES_ACROSS; col += 1) {
      for (let row = 0; row < HD_TILES_ACROSS; row += 1) {
        expect(hdTileFromName(hdTileName({ col, row }))).toEqual({ col, row });
      }
    }
    expect(hdTileFromName('I1')).toBeNull();
    expect(hdTileFromName('A9')).toBeNull();
    expect(hdTileFromName('A')).toBeNull();
  });

  it('puts a world position in the right tile, and clamps off-island rather than throwing', () => {
    expect(hdTileAt(world(-ISLAND_HALF_SPAN, -ISLAND_HALF_SPAN))).toEqual({ col: 0, row: 0 });
    expect(hdTileAt(world(0, 0))).toEqual({ col: 4, row: 4 });
    expect(hdTileAt(world(ISLAND_HALF_SPAN, ISLAND_HALF_SPAN))).toEqual({ col: 7, row: 7 });
    // Far off the survey: the edge tile, not a crash and not a negative index.
    expect(hdTileAt(world(-9e9, 9e9))).toEqual({ col: 0, row: 7 });
    expect(hdTileAt(world(Number.NaN, 0)).col).toBe(0);
  });

  it('places a tile’s north-west corner where its samples say it is', () => {
    for (const id of [{ col: 0, row: 0 }, { col: 3, row: 4 }, { col: 7, row: 7 }]) {
      const corner = hdTileOrigin(id);
      expect(corner).toEqual(hdSamplePoint(id.col * (HD_TILE_SAMPLES - 1), id.row * (HD_TILE_SAMPLES - 1)));
      // And the corner is inside the tile it belongs to.
      expect(hdTileAt(corner)).toEqual(id);
    }
  });

  it('finds every tile a square around a point touches', () => {
    // Dead centre of one tile, reaching nowhere: one tile.
    const middleOfD4 = world(
      hdTileOrigin({ col: 3, row: 3 }).wx + HD_TILE_SPAN / 2,
      hdTileOrigin({ col: 3, row: 3 }).wz + HD_TILE_SPAN / 2,
    );
    expect(hdTilesNear(middleOfD4, 0)).toEqual([{ col: 3, row: 3 }]);
    // On a corner, reaching a little: the four tiles that meet there.
    const corner = hdTileOrigin({ col: 3, row: 3 });
    const four = hdTilesNear(world(corner.wx, corner.wz), 1000);
    expect(four).toHaveLength(4);
    expect(four).toContainEqual({ col: 2, row: 2 });
    expect(four).toContainEqual({ col: 3, row: 3 });
    // A reach that spans the island asks for all 64 and no more.
    expect(hdTilesNear(world(0, 0), ISLAND_SPAN)).toHaveLength(HD_TILES_ACROSS * HD_TILES_ACROSS);
  });
});
