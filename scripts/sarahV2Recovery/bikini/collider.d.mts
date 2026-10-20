/** Types for collider.mjs (a static posed-skin triangle BVH in world centimetres). */
export interface ClosestHit {
  point: number[]; normal: number[]; geometricNormal: number[]; projectionDirection: number[];
  distance: number; signedDistance: number; planeDistance: number; triangle: number;
}
export interface RayHit { point: number[]; normal: number[]; distance: number; triangle: number }
export class SkinCollider {
  constructor(positions: ArrayLike<number>, indices: ArrayLike<number>);
  closest(point: ArrayLike<number> | { x: number; y: number; z: number }, out?: Partial<ClosestHit>, predicate?: (triangle: { id: number; n: number[]; v: number[] }) => boolean): ClosestHit | null;
  closestWhere(point: ArrayLike<number> | { x: number; y: number; z: number }, predicate: (triangle: { id: number; n: number[]; v: number[] }) => boolean, out?: Partial<ClosestHit>): ClosestHit | null;
  rayExit(point: ArrayLike<number> | { x: number; y: number; z: number }, direction: number[], options?: { maxDistanceCm?: number }): RayHit | null;
}
