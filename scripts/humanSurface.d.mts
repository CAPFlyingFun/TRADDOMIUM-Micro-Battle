/**
 * Types for the bake's surface helper, so a test can import it.
 *
 * The module itself is plain JS because everything under `scripts/` is —
 * they are run by `node`, not by vite, and adding a build step for a bake
 * script would be a build step nobody asked for. This file exists only so
 * `tests/humanSurface.test.ts` can pin the two invariants that have
 * actually broken here: the ray caster's `tmax` bound, and glTF's
 * top-left UV origin.
 */
export declare const CELL: number;
export declare const STANDOFF_MAX: number;

export interface RayGrid {
  readonly P: Float32Array | Float64Array;
  readonly IDX: Uint16Array | Uint32Array;
  readonly cell: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  rid: number;
}

export declare function buildRayGrid(
  P: ArrayLike<number>, IDX: ArrayLike<number>, cell?: number,
): RayGrid;

export declare function raycast(
  g: RayGrid,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  tmax: number,
): number;

export interface TexelSheet {
  readonly pos: Float32Array;
  readonly nrm: Float32Array;
  readonly ok: Uint8Array;
  readonly tri: Int32Array;
}

/** `prim` is a gltf-transform Primitive; typed loosely so the test need not
 * pull the whole glTF type surface in to rasterise four triangles. */
export declare function rasterize(prim: unknown, S: number, bleed?: number): TexelSheet;

export declare function gutter(
  a: Float32Array, ok: Uint8Array, S: number, passes: number, far: number,
): number;

export declare function bakeStandoff(
  g: RayGrid, S: number, pos: Float32Array, nrm: Float32Array, ok: Uint8Array,
): Float32Array;

export declare function bakeAO(
  g: RayGrid, S: number, pos: Float32Array, nrm: Float32Array, ok: Uint8Array, K?: number,
): Float32Array;

export declare function surfaceOf(
  prim: unknown, S: number, cacheDir: string, stamp: string, log?: (line: string) => void,
): TexelSheet & { ao: Float32Array; standoff: Float32Array };
