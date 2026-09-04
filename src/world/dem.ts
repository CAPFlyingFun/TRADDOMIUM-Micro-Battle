/**
 * THE SURVEY, AS BYTES: what is in the Kauaʻi elevation files, and how a
 * stored sample becomes a height in the world.
 *
 * This module is the FORMAT and nothing else. It decodes, it addresses,
 * it converts units. It does not fetch (that is `assets/`), it does not
 * sample between grid points (that is `heightfield.ts`), and it does not
 * build anything you can look at (that is the renderer). Keeping the
 * format alone in one pure file is what lets a test assert against the
 * real shipped bytes without a browser.
 *
 * THE FILES, verified against the shipped bytes rather than trusted from
 * a comment:
 *
 *   public/kauai-1025.bin      1025 x 1025, one file, 2,101,250 bytes
 *   public/kauai-hd/A1..H8.bin  513 x 513,  64 files,   526,338 bytes each
 *
 * Both are HEADERLESS. The size IS the contract — 1025² × 2 and 513² × 2
 * exactly, with nothing left over — so a truncated or padded file is
 * caught by its length before a single sample is read.
 *
 * A SAMPLE IS A SIGNED 16-BIT DECIMETRE of real elevation above mean sea
 * level, little-endian, row-major, ROW 0 IS NORTH and COLUMN 0 IS WEST.
 * `HEIGHT_SCALE` turns it into world units: a decimetre is 10 cm and a
 * world unit is 1 cm, so the factor is 10 and a raw 15979 is 1,597.9 m —
 * which is Kawaikini, Kauaʻi's summit, at its surveyed 1,598 m. That
 * agreement is why we know the unit is a decimetre and not a guess.
 *
 * THE DATA INCLUDES BATHYMETRY. Samples run down to about −3,271 m
 * because Kauaʻi sits on a seamount and the survey kept going. A negative
 * sample is the sea floor, NOT a fault — which matters, because the
 * sanitisation rule condemns "dry land below sea level" and Hawaiʻi has
 * none. v0 clamped everything below −600 m up to exactly −600 m, which
 * made 27% of the world one dead flat plate; Joshua's call on 2026-09-04
 * was to keep the real depths, so nothing here clamps.
 *
 * ENDIANNESS IS CHECKED ONCE, LOUDLY. The obvious decode —
 * `new Int16Array(buffer)` — reads in the HOST's byte order, which is an
 * unchecked assumption v0 shipped. Every device this game runs on is
 * little-endian, so the assumption holds; but a wrong answer here is a
 * DEM that looks like static, and "it looked like static" is a poor way
 * to discover it. `assertLittleEndian()` costs four bytes once.
 *
 * DECODING DOES NOT MUTATE ITS INPUT. v0's decoder returned a view onto
 * the fetched ArrayBuffer and then repaired through it, so the bytes the
 * network delivered were quietly edited. Here a decode COPIES, and the
 * caller keeps whatever it was given.
 *
 * Pure: no three, no DOM, no fetch, no timer. `src/world/` is core.
 */
import { ISLAND_SPAN, world, type WorldPoint } from './coords';

// ---------------------------------------------------------------------------
// The lattices
// ---------------------------------------------------------------------------

/** Samples along one side of the whole-island grid. 1025 = 1024 + 1: the +1 is the closing edge. */
export const COARSE_SAMPLES = 1025;

/** Samples along one side of ONE high-detail tile. 513 = 512 + 1, and the +1 is shared with the neighbour. */
export const HD_TILE_SAMPLES = 513;

/** High-detail tiles along one side. 8 x 8 = 64 files, named A1 (north-west) to H8 (south-east). */
export const HD_TILES_ACROSS = 8;

/**
 * Samples along one side of the assembled high-detail grid: 8 x 512 + 1.
 * Decimating it by four reproduces the coarse grid exactly — the bake
 * asserted it and the shipped bytes still agree, which is what makes the
 * two lattices one surface read at two rates rather than two surveys.
 */
export const HD_SAMPLES = HD_TILES_ACROSS * (HD_TILE_SAMPLES - 1) + 1;

/** World units between coarse samples: 5,600,000 / 1024 = 5,468.75 units = 54.6875 m. */
export const COARSE_STEP = ISLAND_SPAN / (COARSE_SAMPLES - 1);

/** World units between high-detail samples: 5,600,000 / 4096 = 1,367.1875 units = 13.671875 m. */
export const HD_STEP = ISLAND_SPAN / (HD_SAMPLES - 1);

/** World units across one high-detail tile: 512 x 1,367.1875 = 700,000 units = exactly 7 km. */
export const HD_TILE_SPAN = (HD_TILE_SAMPLES - 1) * HD_STEP;

/** Bytes in one whole-island file, and in one tile. The size is the format's only header. */
export const COARSE_BYTES = COARSE_SAMPLES * COARSE_SAMPLES * 2;
export const HD_TILE_BYTES = HD_TILE_SAMPLES * HD_TILE_SAMPLES * 2;

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/**
 * World units per stored decimetre. One unit is a centimetre and one
 * sample is a decimetre, so ten. MEASURED: the peak sample of 15,979
 * becomes 159,790 units = 1,597.9 m, against Kawaikini's surveyed 1,598 m.
 */
export const HEIGHT_SCALE = 10;

/** The sentinel for a sample the survey has no value for. Never a height. */
export const NODATA = -32768;

/** World units per metre, for reading a height back out in human terms. */
export const UNITS_PER_METRE = 100;

/** A stored sample as a height in world units. NODATA has no height and the caller must decide. */
export function heightOf(sample: number): number {
  return sample * HEIGHT_SCALE;
}

/** A height in world units as metres, for a readout or a test. */
export function metresOf(units: number): number {
  return units / UNITS_PER_METRE;
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/**
 * True when this machine stores a 16-bit integer low byte first — which
 * is what the files are. Computed, not assumed.
 */
export function isLittleEndian(): boolean {
  const probe = new ArrayBuffer(2);
  new DataView(probe).setInt16(0, 1, true);
  return new Int16Array(probe)[0] === 1;
}

/**
 * Refuse to decode on a big-endian machine rather than return static.
 * Called by every decode; the check is two allocations and a compare.
 */
function assertLittleEndian(): void {
  if (!isLittleEndian()) {
    throw new Error('dem: the DEM is little-endian and this machine is not; a typed-array decode would be wrong');
  }
}

/**
 * A decoded elevation grid: `side` x `side` signed decimetres, row-major,
 * row 0 north, column 0 west. Owns its memory — see the header on why a
 * decode copies rather than views the caller's buffer.
 */
export interface DemGrid {
  readonly side: number;
  readonly samples: Int16Array;
}

/** Decode a whole-island file. Throws unless it is exactly the right size. */
export function decodeCoarse(buffer: ArrayBuffer): DemGrid {
  return decodeGrid(buffer, COARSE_SAMPLES, 'kauai-1025.bin');
}

/** Decode one high-detail tile. Throws unless it is exactly the right size. */
export function decodeHdTile(buffer: ArrayBuffer): DemGrid {
  return decodeGrid(buffer, HD_TILE_SAMPLES, 'a high-detail tile');
}

function decodeGrid(buffer: ArrayBuffer, side: number, what: string): DemGrid {
  assertLittleEndian();
  const expected = side * side * 2;
  if (buffer.byteLength !== expected) {
    throw new Error(`dem: ${what} must be exactly ${expected} bytes (${side} x ${side} int16), got ${buffer.byteLength}`);
  }
  // A COPY, not a view: the caller keeps the bytes it was handed, and
  // nothing downstream can edit the network's own buffer by accident.
  return { side, samples: new Int16Array(buffer.slice(0)) };
}

/** One sample by grid position. Out of range is NODATA rather than a throw: an edge read is normal. */
export function sampleAt(grid: DemGrid, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= grid.side || row >= grid.side) return NODATA;
  return grid.samples[row * grid.side + col];
}

// ---------------------------------------------------------------------------
// Where a sample is in the world
// ---------------------------------------------------------------------------

/**
 * THE ISLAND IS CENTRED ON THE WORLD ORIGIN. World (0, 0) is the middle
 * of the survey, so the grid runs from −ISLAND_SPAN/2 to +ISLAND_SPAN/2
 * on both axes. Stated here once, as a named constant, because v0 spelled
 * it `+ SPAN / 2` at every call site and a single missed one is an island
 * half a world away.
 */
export const ISLAND_HALF_SPAN = ISLAND_SPAN / 2;

/** +wx is EAST and +wz is SOUTH, matching the files' column and row order. */
export function gridColumn(wx: number, step: number): number {
  return (wx + ISLAND_HALF_SPAN) / step;
}

export function gridRow(wz: number, step: number): number {
  return (wz + ISLAND_HALF_SPAN) / step;
}

/** The world position of a coarse sample. The inverse of `gridColumn`/`gridRow` at `COARSE_STEP`. */
export function coarseSamplePoint(col: number, row: number): WorldPoint {
  return world(col * COARSE_STEP - ISLAND_HALF_SPAN, row * COARSE_STEP - ISLAND_HALF_SPAN);
}

/** The world position of a sample in the assembled high-detail grid. */
export function hdSamplePoint(col: number, row: number): WorldPoint {
  return world(col * HD_STEP - ISLAND_HALF_SPAN, row * HD_STEP - ISLAND_HALF_SPAN);
}

// ---------------------------------------------------------------------------
// The high-detail tiles
// ---------------------------------------------------------------------------

/** Column letters, west to east. The LETTER is the column and the DIGIT is the row: A1 is the north-west tile. */
export const HD_COLUMNS = 'ABCDEFGH';

/** Which tile a world position falls in. Clamped to the grid: off-island reads the edge tile. */
export interface HdTileId {
  /** 0..7, west to east. */
  readonly col: number;
  /** 0..7, north to south. */
  readonly row: number;
}

export function hdTileAt(at: WorldPoint): HdTileId {
  const col = Math.floor(gridColumn(at.wx, HD_STEP) / (HD_TILE_SAMPLES - 1));
  const row = Math.floor(gridRow(at.wz, HD_STEP) / (HD_TILE_SAMPLES - 1));
  return { col: clampTile(col), row: clampTile(row) };
}

function clampTile(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(HD_TILES_ACROSS - 1, Math.max(0, value));
}

/** The file name of a tile: `A1` is north-west, `H8` south-east. */
export function hdTileName(id: HdTileId): string {
  return `${HD_COLUMNS[clampTile(id.col)]}${clampTile(id.row) + 1}`;
}

/** A stable key for a residency map. The name already is one; this says so at the type level. */
export function hdTileKey(id: HdTileId): string {
  return hdTileName(id);
}

export function sameHdTile(a: HdTileId, b: HdTileId): boolean {
  return a.col === b.col && a.row === b.row;
}

/** Parse a tile name back to an id, or null when it is not one. */
export function hdTileFromName(name: string): HdTileId | null {
  if (name.length !== 2) return null;
  const col = HD_COLUMNS.indexOf(name[0]);
  const row = Number(name[1]) - 1;
  if (col < 0 || !Number.isInteger(row) || row < 0 || row >= HD_TILES_ACROSS) return null;
  return { col, row };
}

/**
 * The world rectangle one tile covers: its north-west corner and its
 * span. Tiles share their edge line with their neighbour (513 = 512 + 1),
 * so a tile's LAST row is its neighbour's FIRST — the two files carry
 * bit-identical samples there, which is what lets a read between them
 * come from one file rather than two.
 */
export function hdTileOrigin(id: HdTileId): WorldPoint {
  return world(id.col * HD_TILE_SPAN - ISLAND_HALF_SPAN, id.row * HD_TILE_SPAN - ISLAND_HALF_SPAN);
}

/** Every tile whose rectangle touches the square of `reach` world units around `at`. */
export function hdTilesNear(at: WorldPoint, reach: number): HdTileId[] {
  const span = Math.max(0, reach);
  const first = hdTileAt(world(at.wx - span, at.wz - span));
  const last = hdTileAt(world(at.wx + span, at.wz + span));
  const tiles: HdTileId[] = [];
  for (let row = first.row; row <= last.row; row += 1) {
    for (let col = first.col; col <= last.col; col += 1) tiles.push({ col, row });
  }
  return tiles;
}
