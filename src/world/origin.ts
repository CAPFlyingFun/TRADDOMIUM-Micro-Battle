/**
 * THE FLOATING ORIGIN — how a five-million-unit world renders at all.
 *
 * At true scale the island is 5,600,000 units across. Nothing may be
 * handed to the GPU in those coordinates, because float32 cannot hold
 * them usefully:
 *
 *   world coordinate      float32 spacing there
 *        5,600                0.0002 units
 *       50,000                0.002
 *      500,000                0.016
 *    5,600,000                0.25     <- a quarter of her body
 *
 * A queen 1.0 unit long whose position snaps to a 0.25-unit grid
 * shudders as she walks, her legs quantise, and terrain vertices
 * z-fight. This is the single hard constraint of a big world, and it is
 * why "another game runs at full scale" rarely transfers: a game with
 * metre-sized units and an 8 km map lives at coordinate 8,000, where
 * float32 spacing is a millimetre and none of this exists.
 *
 * THE FIX is to keep the rendered scene near zero and move the world
 * underneath it. Her LOGICAL position is a JavaScript number, which is
 * float64 — spacing at 5.6 million is about 1e-9 units, so the logical
 * world is free. Only what reaches the GPU needs rebasing, and it never
 * sees a coordinate larger than the view distance.
 *
 * Everything renders at `world - origin`. The origin snaps to a coarse
 * lattice rather than following her exactly, so it moves in jumps: a
 * continuously-shifting origin would re-round every vertex every frame
 * and reintroduce the shimmer it exists to prevent.
 *
 * THIS IS A TRANSFORM, NOT A LOCATION SYSTEM. Nothing should ask it
 * where anything IS. Where things are lives in coords.ts, in world
 * coordinates, and this only says where to draw them today.
 */
import { local, world, type LocalPoint, type WorldPoint } from './coords';

/** How far she may stray before the world is shifted under her. */
export const REBASE_AT = 4096;

/** The origin snaps to this lattice, so shifts are exact and repeatable. */
export const ORIGIN_STEP = 1024;

let originX = 0;
let originZ = 0;

export function originAt(): { x: number; z: number } {
  return { x: originX, z: originZ };
}

/**
 * The conversions, and the ONLY ones.
 *
 * There were loose `localX(number)` / `localZ(number)` helpers beside
 * these. They took bare numbers, so nothing stopped a rendered value
 * going in where a world one belonged — which is the whole class of bug
 * this file exists to prevent. Gone: if it converts, it goes through a
 * typed point.
 */
export function toLocal(at: WorldPoint): LocalPoint {
  return local(at.wx - originX, at.wz - originZ);
}

/**
 * Rendered back to world.
 *
 * Needed wherever something only knows where it is on screen and has to
 * ask the world a question — the camera's floor clamp being the one
 * that got this wrong and ended up two kilometres up a mountain.
 */
export function toWorld(at: LocalPoint): WorldPoint {
  return world(at.lx + originX, at.lz + originZ);
}

/**
 * Move the origin under her if she has strayed far enough.
 *
 * @returns how far the world just shifted, or null if it did not. The
 *   caller has to move everything already placed by exactly this, so
 *   handing back the delta rather than the new origin means nothing has
 *   to subtract two large numbers to find it.
 */
export function rebaseFor(
  worldX: number, worldZ: number,
): { x: number; z: number } | null {
  if (Math.abs(worldX - originX) < REBASE_AT && Math.abs(worldZ - originZ) < REBASE_AT) {
    return null;
  }
  const wantX = Math.round(worldX / ORIGIN_STEP) * ORIGIN_STEP;
  const wantZ = Math.round(worldZ / ORIGIN_STEP) * ORIGIN_STEP;
  const shift = { x: wantX - originX, z: wantZ - originZ };
  originX = wantX;
  originZ = wantZ;
  return shift;
}

/** Put the origin somewhere outright — spawns and scene resets. */
export function setOrigin(worldX: number, worldZ: number): void {
  originX = Math.round(worldX / ORIGIN_STEP) * ORIGIN_STEP;
  originZ = Math.round(worldZ / ORIGIN_STEP) * ORIGIN_STEP;
}
