/**
 * The one ordering used to decide which coincident water surface exists.
 * Priority-flood ponds are the measured spill surface, vector lakes their
 * basin, and a centreline is the remaining running water.
 */
import { terrainHeight } from './heightfield';
import { lakeLevel } from './lakes';
import { containedPondLevel } from './pond';

export type WaterOwner = 'pond' | 'lake' | 'river' | 'sea';
export interface WaterCandidates { readonly pond: boolean; readonly lake: boolean; readonly river: boolean; }

/** Pure, testable ownership matrix. Sea is the unconditional final owner. */
export function waterOwner({ pond, lake, river }: WaterCandidates): WaterOwner {
  if (pond) return 'pond';
  if (lake) return 'lake';
  if (river) return 'river';
  return 'sea';
}

/** CPU predicate used when clipping inland draw geometry. */
export function inlandOwnerAt(wx: number, wz: number, river: boolean): WaterOwner {
  const bed = terrainHeight(wx, wz);
  return waterOwner({
    pond: containedPondLevel(wx, wz, bed) !== null,
    lake: lakeLevel(wx, wz) !== null,
    river,
  });
}