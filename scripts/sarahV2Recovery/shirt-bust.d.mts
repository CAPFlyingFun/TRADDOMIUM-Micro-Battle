/** Types for shirt-bust.mjs (laying a modelled shirt's breast shapes again over her skin). */
export function weld(P: ArrayLike<number>, grid?: number): { ids: Int32Array; count: number };
export function neighbours(index: ArrayLike<number>, ids: Int32Array, count: number): { start: Int32Array; list: Int32Array };
export function weldedNormals(X: ArrayLike<number>, index: ArrayLike<number>, ids: Int32Array, count: number): Float64Array;
export interface StandOff { off: number; nx: number; ny: number; nz: number; distance: number }
export function skinSurface(B: ArrayLike<number>, index: ArrayLike<number>, keep?: (t: number) => boolean, cell?: number): (px: number, py: number, pz: number, reach?: number) => StandOff | null;
export function compose(base: ArrayLike<number>, offsets: ReadonlyMap<string, ArrayLike<number>>, weights: ReadonlyMap<string, number>): Float64Array;
export interface Surface { P: ArrayLike<number>; index: ArrayLike<number>; offsets: ReadonlyMap<string, ArrayLike<number>> }
export interface LaidShape {
  offsets: Float32Array;
  normals: Float32Array;
  report: { free: number; intoBefore: { n: number; most: number }; intoAfter: { n: number; most: number }; pushed: number; pushedMost: number; lastPush: { pushed: number; most: number } };
}
export function layBust(
  cloth: Surface,
  skin: Surface & { keep?: (t: number) => boolean },
  plan: readonly { name: string; weight?: number; context: ReadonlyMap<string, number> }[],
  options?: { smooth?: number; settle?: number; rings?: number; maximumStandOff?: number },
): Map<string, LaidShape>;
