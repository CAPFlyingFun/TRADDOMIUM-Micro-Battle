/**
 * WHAT GROWS WHERE, from the real island.
 *
 * ESA WorldCover 10 m, by way of Beyond Extinction's baked rasters and
 * `scripts/bakeVeg.py`. Three 384-square planes over the same 56 km
 * world square as the height grid: the land-cover class, the tree
 * canopy cover, and the river-corridor intensity. Measured over the
 * square: 54.3% water, 28.9% tree, 14.0% grass, 2.0% shrub, and a mean
 * canopy over land of 167 of 255 — Kauaʻi is genuinely dense.
 *
 * ONE PIXEL IS 146 METRES, and that is the right coarseness for what it
 * decides. This says a neighbourhood is jungle rather than pasture; it
 * never says where an individual blade of grass stands. That is the
 * scatter's own hash, which is deterministic and much finer.
 *
 * IT DOES NOT DECIDE WATER. The class has an 80 for it, but our water
 * comes from the hydrography — 1,121 real reaches and 111 real lakes,
 * at metres rather than at 146 of them. Where the two disagree the
 * hydrography wins, because it is the one the ground is carved from.
 * The class's water is used only to keep the scatter off open sea.
 */
import { SPAN } from './kauai';
import { pullBuffer } from './fetchBytes';

/**
 * `TMBV`, read the way the file is read — as the bytes T, M, B, V in
 * that order, through a little-endian uint32.
 *
 * DERIVED FROM THE LETTERS, NOT TYPED AS A NUMBER, because the number
 * was typed wrong: `0x564d4254` is those four bytes in the order they
 * appear in the file, which is exactly the order a little-endian read
 * does NOT return. `decodeVeg` threw on the real file from the day it
 * was written, and nothing noticed for four days because nothing was
 * calling `loadVeg` — the ground cover this feeds was never wired into
 * the shipped scene. Found by the landmark-tree work (v0.0.149) on the
 * first attempt to read the raster for real; the regression guard is a
 * test that decodes `public/kauai-veg.bin` itself.
 */
const MAGIC = new DataView(
  new Uint8Array([0x54, 0x4d, 0x42, 0x56]).buffer, // 'T','M','B','V'
).getUint32(0, true);
const VERSION = 1;
const HEADER = 12;

/** ESA WorldCover classes, as the legend names them. */
export const TREE = 10;
export const SHRUB = 20;
export const GRASS = 30;
export const CROP = 40;
export const BUILT = 50;
export const BARE = 60;
export const WATER = 80;
export const WETLAND = 90;
export const MANGROVE = 95;

export interface Cover {
  /** The ESA class here. */
  readonly kind: number;
  /** Tree canopy cover, 0 to 1. */
  readonly canopy: number;
  /** River-corridor intensity, 0 to 1. */
  readonly river: number;
}

let grid = 0;
let kinds: Uint8Array | null = null;
let canopies: Uint8Array | null = null;
let rivers: Uint8Array | null = null;

/** Unpack the baked rasters. Throws rather than half-reading them. */
export function decodeVeg(buffer: ArrayBuffer): void {
  if (buffer.byteLength < HEADER) {
    throw new Error(`kauai-veg.bin is ${buffer.byteLength} bytes, not a file`);
  }
  const head = new DataView(buffer);
  if (head.getUint32(0, true) !== MAGIC) {
    throw new Error('kauai-veg.bin does not start with TMBV');
  }
  const version = head.getUint16(4, true);
  if (version !== VERSION) {
    throw new Error(`kauai-veg.bin is version ${version}, expected ${VERSION}`);
  }
  const side = head.getUint32(8, true);
  const plane = side * side;
  if (buffer.byteLength !== HEADER + plane * 3) {
    throw new Error(
      `kauai-veg.bin holds ${buffer.byteLength} bytes, not ${HEADER + plane * 3}`,
    );
  }
  grid = side;
  kinds = new Uint8Array(buffer, HEADER, plane);
  canopies = new Uint8Array(buffer, HEADER + plane, plane);
  rivers = new Uint8Array(buffer, HEADER + plane * 2, plane);
}

/** Throw it away — scene resets and tests. */
export function forgetVeg(): void {
  grid = 0;
  kinds = canopies = rivers = null;
}

/** Whether the rasters have landed. */
export function haveVeg(): boolean {
  return kinds !== null;
}

/**
 * The cover at a WORLD position.
 *
 * NEAREST, not bilinear, and deliberately: the class is a category, and
 * the average of "tree" and "grass" is neither. The canopy alone would
 * interpolate happily, but reading both from one cell keeps them
 * describing the same place.
 *
 * Off the grid — which for a 56 km square means out at sea — reads as
 * water, so nothing scatters there.
 */
export function coverAt(wx: number, wz: number): Cover {
  if (!kinds || !canopies || !rivers) {
    return { kind: WATER, canopy: 0, river: 0 };
  }
  const u = Math.round(((wx + SPAN / 2) / SPAN) * (grid - 1));
  const v = Math.round(((wz + SPAN / 2) / SPAN) * (grid - 1));
  if (u < 0 || v < 0 || u >= grid || v >= grid) {
    return { kind: WATER, canopy: 0, river: 0 };
  }
  const at = v * grid + u;
  return {
    kind: kinds[at],
    canopy: canopies[at] / 255,
    river: rivers[at] / 255,
  };
}

/**
 * WHAT THE BAKE WROTE, so the loading bar has an honest maximum — the
 * same arrangement `HYDRO_BYTES` has, kept honest by the same bake.
 */
export const VEG_BYTES = 442_380;

export async function loadVeg(
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const url = `${import.meta.env.BASE_URL}kauai-veg.bin`;
  onProgress?.(0, VEG_BYTES);
  const buffer = await pullBuffer(
    url,
    () => {},
    (done) => onProgress?.(Math.min(done, VEG_BYTES), VEG_BYTES),
  );
  decodeVeg(buffer);
}
