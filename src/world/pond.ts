/**
 * STANDING WATER, AS BAKED — the field that cannot float.
 *
 * `scripts/bakeWater.py` runs a priority-flood over the real island
 * and writes the surface after every pit in the elevation model has
 * been filled to its spill point. This reads it.
 *
 * WHY THIS EXISTS. Three releases running, the same fault came back in
 * a different disguise: the water sheet standing over ground that was
 * not under it, drawn as a floating edge with a gap beneath. Each time
 * the cause was the same — the water's LEVEL and the ground's HEIGHT
 * were decided by different code and agreed only by arrangement. A
 * carve pressed the bed down to meet a level that came from vector
 * data; widen the carve and the water hung over the trench, narrow it
 * and the terrain pierced the sheet.
 *
 * A filled surface removes the arrangement. It is derived FROM the bed
 * and is never below it, so "water here, at this level" and "ground
 * here, at this height" are two readings of one number. Measured on
 * the bake: three cells out of 31,162 stand over lower dry ground, by
 * zero metres — floating-point ties. The time-stepping solve this
 * replaced managed 23.9% and 28.6 m after twelve thousand steps.
 *
 * WHAT IT DOES NOT COVER. The grid is 1025 square, one sample every
 * 54.7 m, so this is lakes, ponds and the wet floors of valleys. A
 * 5.5 m stream is far under one cell and stays where it is, in the
 * vector drainage (rivers.ts). What a stream can take from here is a
 * level it is not allowed to exceed.
 */
import { SPAN, SAMPLES, UNITS_PER_METRE } from './kauai';
import { pullBuffer } from './fetchBytes';

const MAGIC = 0x57424d54; // "TMBW", little-endian

/** Header is four bytes of magic, two shorts, then two ints. */
const HEADER = 16;

/** Written where the fill found no standing water at all. */
const DRY = -32768;

/**
 * Exactly how big `kauai-water.bin` is, kept honest by the bake — the
 * same arrangement the grid and the hydrography use, and for the same
 * reason: `Content-Length` counts the compressed wire, not the bytes.
 */
export const POND_BYTES = HEADER + SAMPLES * SAMPLES * 2;

export interface PondField {
  readonly grid: number;
  /** Surface height in DECIMETRES, or DRY. Read through `pondLevel`. */
  readonly level: Int16Array;
}

export interface PondCell {
  /** Centre of the nearest-sampled cell, in global world coordinates. */
  readonly x: number;
  readonly z: number;
  readonly level: number;
  readonly size: number;
}

let field: PondField | null = null;

/** Fetch and decode the bake that ships with the build. */
export async function loadPond(
  onProgress?: (done: number, total: number) => void,
): Promise<PondField> {
  // The size is known and never asked for, the same way the grid and
  // the hydrography handle it: Content-Length counts the compressed
  // wire, and this file gzips to a fifteenth of itself.
  const url = `${import.meta.env.BASE_URL}kauai-water.bin`;
  onProgress?.(0, POND_BYTES);
  return decodePond(await pullBuffer(
    url,
    () => {},
    (done) => onProgress?.(Math.min(done, POND_BYTES), POND_BYTES),
  ));
}

export function decodePond(buffer: ArrayBuffer): PondField {
  if (buffer.byteLength !== POND_BYTES) {
    throw new Error(
      `kauai-water is ${buffer.byteLength} bytes, expected ${POND_BYTES}`,
    );
  }
  const head = new DataView(buffer);
  if (head.getUint32(0, true) !== MAGIC) throw new Error('kauai-water is not a water bake');
  const grid = head.getUint32(8, true);
  if (grid !== SAMPLES) {
    throw new Error(`kauai-water is ${grid} square, expected ${SAMPLES}`);
  }
  return { grid, level: new Int16Array(buffer, HEADER, grid * grid) };
}

export function usePond(from: PondField): void {
  field = from;
}

/** Throw it away — scene resets and tests. */
export function forgetPond(): void {
  field = null;
}

/** Add the bake to the simulation core's Node-runnable guard. */
export function havePond(): boolean {
  return field !== null;
}

/**
 * The surface of standing water here, in world units, or null.
 *
 * NEAREST, not bilinear, and the distinction matters. Interpolating
 * between a wet cell and a dry one invents a level halfway up the
 * bank — which is the floating edge all over again, reintroduced by
 * the sampler. A pond's surface is flat; its EDGE is a discontinuity,
 * and a discontinuity is the one thing bilinear cannot represent.
 */
export function pondLevel(x: number, z: number): number | null {
  if (!field) return null;
  const grid = field.grid;
  const step = SPAN / (grid - 1);
  const c = Math.round((x + SPAN / 2) / step);
  const r = Math.round((z + SPAN / 2) / step);
  if (c < 0 || r < 0 || c >= grid || r >= grid) return null;
  const raw = field.level[r * grid + c];
  if (raw === DRY) return null;
  // Decimetres of real metres to world units.
  return (raw / 10) * UNITS_PER_METRE;
}

/**
 * Standing water after the final terrain has had the last word.
 *
 * The bake supplies a possible spill level, not permission to draw through
 * later terrain detail. Keeping this test beside the sampler makes render
 * and gameplay use the same containment rule.
 */
export function containedPondLevel(
  x: number, z: number, bed: number,
): number | null {
  const level = pondLevel(x, z);
  return level !== null && level > bed ? level : null;
}

/** Wet nearest-sample cells whose square can overlap the requested box. */
export function pondCellsIn(
  minX: number, minZ: number, maxX: number, maxZ: number,
): PondCell[] {
  if (!field) return [];
  const grid = field.grid;
  const step = SPAN / (grid - 1);
  const firstC = Math.max(0, Math.ceil((minX + SPAN / 2) / step - 0.5));
  const lastC = Math.min(grid - 1, Math.floor((maxX + SPAN / 2) / step + 0.5));
  const firstR = Math.max(0, Math.ceil((minZ + SPAN / 2) / step - 0.5));
  const lastR = Math.min(grid - 1, Math.floor((maxZ + SPAN / 2) / step + 0.5));
  const found: PondCell[] = [];
  for (let r = firstR; r <= lastR; r++) {
    for (let c = firstC; c <= lastC; c++) {
      const raw = field.level[r * grid + c];
      if (raw === DRY) continue;
      found.push({
        x: c * step - SPAN / 2,
        z: r * step - SPAN / 2,
        level: (raw / 10) * UNITS_PER_METRE,
        size: step,
      });
    }
  }
  return found;
}

/** How much standing water is over this ground, or zero. */
export function pondDepth(x: number, z: number, bed: number): number {
  const level = pondLevel(x, z);
  return level === null ? 0 : Math.max(0, level - bed);
}
