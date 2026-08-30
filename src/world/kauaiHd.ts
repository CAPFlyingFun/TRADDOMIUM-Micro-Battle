/**
 * KAUAʻI AT FULL RESOLUTION, STREAMED — the real island under her feet.
 *
 * `kauai-1025.bin` is the whole island in one 2.1 MB file, and it is
 * `bakeKauai.py`'s assembly of BE's tiles with fifteen of every sixteen
 * samples thrown away: `full[::4, ::4]`. One sample every 54.7 m. That
 * is 5,470 of the queen's body lengths, so every landform below the
 * size of a district has been procedural noise — which looks like
 * ground and does not behave like it. Measured on a bicubic upsample of
 * the coarse grid, a patch of real drainage that concentrates flow into
 * 53 channel cells concentrates it into NONE.
 *
 * The samples were never lost, only dropped. `bake:hd` writes them back
 * out in BE's own 8×8 split — 513 square each, 13.67 m a sample, the
 * same headerless int16-decimetre contract the coarse grid has — and
 * this streams them.
 *
 * WHY TILES AND NOT ONE FILE. 4097 square is 33.6 MB, against a whole
 * game that loads in 4.6. A tile is 526 KB, 197 KB over the wire, and
 * covers 7 km: she walks at a centimetre a second, so one tile is
 * days of travel and the two or three around her are all the fine
 * ground that any tier can resolve.
 *
 * THE TWO GRIDS ARE THE SAME ISLAND, and that is not a hope — the bake
 * asserts it on all 1,050,625 strided samples, and `tests/kauaiHd`
 * asserts it again from the shipped files. It is what lets this fall
 * back to the coarse grid for anything not yet resident without the
 * ground jumping: where a fine sample and a coarse one describe the
 * same point they hold the same number, so the only difference is
 * detail BETWEEN samples.
 */
import { pullBuffer } from './fetchBytes';
import { HEIGHT_SCALE, SAMPLES, SPAN } from './kauai';
import { islandLink, repairFineTile, type Repair } from './demRepair';

/** Samples on a side of one tile — 512 cells plus the shared edge. */
export const HD_TILE = 513;
/** Tiles on a side of the island. */
export const HD_TILES = 8;
/** Samples on a side of the whole fine grid: 8 × 512 + 1. */
export const HD_SAMPLES = HD_TILES * (HD_TILE - 1) + 1;
/** Distance between fine samples, in world units — 13.67 m. */
export const HD_STEP = SPAN / (HD_SAMPLES - 1);
/** Bytes in one tile, and the contract its file has to meet. */
export const HD_TILE_BYTES = HD_TILE * HD_TILE * 2;

const NODATA = -32768;
const SEA_FLOOR = -60_000;
const COLS = 'ABCDEFGH';

/**
 * HOW FAR FROM HER THE FINE GROUND IS WORTH HOLDING.
 *
 * Two kilometres, which is the middle tier's reach — the furthest any
 * drawn surface could resolve a 13.67 m sample. The backdrop beyond it
 * is kilometres to a vertex and reads the coarse grid quite happily.
 *
 * In practice this asks for one tile and, only when she is within 2 km
 * of an edge, its neighbours: a tile is 7 km across.
 */
export const HD_REACH = 200_000;

const tiles = new Map<number, Int16Array>();
const wanted = new Set<number>();
/**
 * Told whenever a tile lands, because the terrain is already CUT by
 * then. The streamed cells are built from `baseLand` at the moment they
 * are made, so a tile arriving afterwards changes the answer without
 * changing the mesh: she would walk on coarse triangles over fine
 * ground. Whoever owns the mesh re-cuts on this.
 */
let arrived: (() => void) | null = null;

/** Say what to do when fine ground lands. Null clears it. */
export function onHdTile(fn: (() => void) | null): void {
  arrived = fn;
}

/** `A1`…`H8` as col × 8 + row, which is what the bake writes. */
export function hdTileIndex(col: number, row: number): number {
  return col * HD_TILES + row;
}

/** The file name a tile index came from. */
export function hdTileName(index: number): string {
  return `${COLS[Math.floor(index / HD_TILES)]}${(index % HD_TILES) + 1}`;
}

/** Which tile covers this point, or -1 off the island. */
export function hdTileAt(x: number, z: number): number {
  const gx = (x + SPAN / 2) / HD_STEP;
  const gz = (z + SPAN / 2) / HD_STEP;
  if (gx < 0 || gz < 0 || gx > HD_SAMPLES - 1 || gz > HD_SAMPLES - 1) return -1;
  const col = Math.min(HD_TILES - 1, Math.floor(gx / (HD_TILE - 1)));
  const row = Math.min(HD_TILES - 1, Math.floor(gz / (HD_TILE - 1)));
  return hdTileIndex(col, row);
}

/**
 * Hand a decoded tile over — SANITISED as it enters the world.
 *
 * Here rather than in `decodeHdTile` because this is the moment the
 * tile becomes ground the game can stand on, and because the repair
 * needs the island grid: whether the ocean can reach a hole is a
 * question about the WORLD, and a tile flooded from its own border
 * would call a pit straddling that border connected. See demRepair.ts.
 */
export function useHdTile(index: number, data: Int16Array): void {
  if (data.length !== HD_TILE * HD_TILE) {
    throw new Error(`tile ${hdTileName(index)} is ${data.length} samples, expected ${HD_TILE * HD_TILE}`);
  }
  lastRepair = repairFineTile(
    data, HD_TILE, Math.floor(index / HD_TILES), index % HD_TILES,
    islandLink((HD_TILE - 1) * HD_TILES / (SAMPLES - 1)),
  );
  tiles.set(index, data);
}

/** What the last tile handed over had to repair, for probes and tests. */
let lastRepair: Repair | null = null;

/** What sanitising the last fine tile corrected, or null before any. */
export function hdRepair(): Repair | null {
  return lastRepair;
}

/** Drop everything — for tests, and for leaving the island. */
export function forgetHd(): void {
  tiles.clear();
  wanted.clear();
  arrived = null;
}

/** How many tiles are resident right now. */
export function hdResident(): number {
  return tiles.size;
}

function sample(tile: Int16Array, col: number, row: number): number {
  const c = col < 0 ? 0 : col > HD_TILE - 1 ? HD_TILE - 1 : col;
  const r = row < 0 ? 0 : row > HD_TILE - 1 ? HD_TILE - 1 : row;
  const raw = tile[r * HD_TILE + c];
  if (raw === NODATA) return SEA_FLOOR;
  const h = raw * HEIGHT_SCALE;
  return h < SEA_FLOOR ? SEA_FLOOR : h;
}

/**
 * The fine island here, or null where no tile has arrived.
 *
 * A fine CELL never straddles two tiles, which is the whole reason the
 * tiles carry 513 samples rather than 512: neighbours share their edge
 * column, so the four corners a bilinear read needs are always inside
 * one file. Without that overlap every tile boundary would need two
 * tiles resident to sample at all, and would show a seam whenever only
 * one of them was.
 */
export function hdHeightAt(x: number, z: number): number | null {
  if (tiles.size === 0) return null;
  const gx = (x + SPAN / 2) / HD_STEP;
  const gz = (z + SPAN / 2) / HD_STEP;
  if (gx < 0 || gz < 0 || gx > HD_SAMPLES - 1 || gz > HD_SAMPLES - 1) return null;
  const span = HD_TILE - 1;
  const col = Math.min(HD_TILES - 1, Math.floor(gx / span));
  const row = Math.min(HD_TILES - 1, Math.floor(gz / span));
  const tile = tiles.get(hdTileIndex(col, row));
  if (!tile) return null;
  const lx = gx - col * span;
  const lz = gz - row * span;
  const c = Math.floor(lx);
  const r = Math.floor(lz);
  const fx = lx - c;
  const fz = lz - r;
  const h00 = sample(tile, c, r);
  const h10 = sample(tile, c + 1, r);
  const h01 = sample(tile, c, r + 1);
  const h11 = sample(tile, c + 1, r + 1);
  const top = h00 + (h10 - h00) * fx;
  const bottom = h01 + (h11 - h01) * fx;
  return top + (bottom - top) * fz;
}

/** Every tile overlapping the square of side 2·reach around a point. */
export function hdTilesNear(x: number, z: number, reach = HD_REACH): number[] {
  const span = HD_TILE - 1;
  const lo = (v: number) => Math.floor(((v + SPAN / 2) / HD_STEP) / span);
  const out: number[] = [];
  const c0 = Math.max(0, lo(x - reach));
  const c1 = Math.min(HD_TILES - 1, lo(x + reach));
  const r0 = Math.max(0, lo(z - reach));
  const r1 = Math.min(HD_TILES - 1, lo(z + reach));
  for (let col = c0; col <= c1; col++) {
    for (let row = r0; row <= r1; row++) out.push(hdTileIndex(col, row));
  }
  return out;
}

/** Read one tile's bytes as samples, checking the size contract. */
export function decodeHdTile(buffer: ArrayBuffer): Int16Array {
  if (buffer.byteLength !== HD_TILE_BYTES) {
    throw new Error(`HD tile is ${buffer.byteLength} bytes, expected ${HD_TILE_BYTES}`);
  }
  return new Int16Array(buffer);
}

/**
 * Make sure the fine ground around a point is on its way, and let go of
 * what is no longer near.
 *
 * Deliberately fire-and-forget: the coarse grid answers for anything
 * not yet here, and it answers with the SAME NUMBER at every sample the
 * two share, so a tile landing sharpens the ground rather than moving
 * it. Awaiting this on the hot path would stall a frame to avoid a
 * change nobody can see.
 */
export function followHd(x: number, z: number, base = 'kauai-hd'): void {
  const near = hdTilesNear(x, z);
  for (const index of near) {
    if (tiles.has(index) || wanted.has(index)) continue;
    wanted.add(index);
    void pullBuffer(`${base}/${hdTileName(index)}.bin`, () => {}, () => {})
      .then((buffer) => { useHdTile(index, decodeHdTile(buffer)); arrived?.(); })
      .catch(() => {})
      .finally(() => wanted.delete(index));
  }
  // Nine tiles is 4.7 MB of Int16Array and she can only stand on one.
  if (tiles.size > near.length) {
    const keep = new Set(near);
    for (const index of [...tiles.keys()]) if (!keep.has(index)) tiles.delete(index);
  }
}

/** Fetch one tile and hand it over — for the boot, which waits. */
export async function loadHdTile(index: number, base = 'kauai-hd'): Promise<void> {
  const buffer = await pullBuffer(`${base}/${hdTileName(index)}.bin`, () => {}, () => {});
  useHdTile(index, decodeHdTile(buffer));
}
