/**
 * THE CELL: the unit the world is generated in, and the address every
 * object has.
 *
 * SIXTEEN METRES, and why not something else. The two things a cell
 * size has to serve pull in opposite directions. The STREAMER wants
 * cells big, so that walking across the bubble touches few of them and
 * each generation pays its fixed costs once. The DETAIL LADDER wants
 * them small, so that the lowest rung (a 20 m radius at `low`, 15 m at
 * `ultra-low`) is not one cell that is mostly outside its own circle.
 * Sixteen metres is the largest cell that still gives the 15 m rung a
 * 3x3 of them, and it makes the 100 m rung a 13x13 (169 cells) and the
 * 200 m desktop rung a 25x25 (625). It is not the terrain's tile (7 km)
 * or its HD sample (13.67 m) or the landcover pixel (146 m) or the
 * drainage cell (54.7 m): none of those is a size at which grass is
 * generated, and tying this to one of them would let a survey decision
 * move the objects. `coords.CHUNK_SPAN` (5.12 m) exists and is unused
 * by anything; it is far too small for this and is left alone.
 *
 * A CELL IS INDEPENDENTLY RECONSTRUCTABLE. Its address is derived from
 * world position alone (`cellAt`), its contents from its address, the
 * world seed and the habitat at its centre and corners — never from a
 * neighbour, never from what was generated before it. That is the whole
 * of what lets any window of the island be grown on its own, on any
 * phone, in any order, and come out the same.
 *
 * Pure: no three, no DOM. `src/world/` is core.
 */
import { world, type WorldPoint } from '../coords';

/** World units a side. 16 m. */
export const CELL_SPAN = 1_600;

export interface ObjectCellId {
  readonly cx: number;
  readonly cz: number;
}

export function cellAt(at: WorldPoint): ObjectCellId {
  return { cx: Math.floor(at.wx / CELL_SPAN), cz: Math.floor(at.wz / CELL_SPAN) };
}

/** The cell's north-west corner, where its contents begin. */
export function cellOrigin(id: ObjectCellId): WorldPoint {
  return world(id.cx * CELL_SPAN, id.cz * CELL_SPAN);
}

/** The cell's centre — where its habitat is read. */
export function cellCentre(id: ObjectCellId): WorldPoint {
  return world((id.cx + 0.5) * CELL_SPAN, (id.cz + 0.5) * CELL_SPAN);
}

/** A stable string address, for maps and for object ids. */
export function cellKey(id: ObjectCellId): string {
  return `${id.cx},${id.cz}`;
}

export function sameCell(a: ObjectCellId, b: ObjectCellId): boolean {
  return a.cx === b.cx && a.cz === b.cz;
}

/**
 * Every cell whose square overlaps a circle of `radius` about `at`,
 * nearest first — the order a streamer should generate them in. Allocates;
 * call when the camera has moved a cell, not every frame.
 */
export function cellsWithin(at: WorldPoint, radius: number): ObjectCellId[] {
  if (!Number.isFinite(at.wx) || !Number.isFinite(at.wz) || !(radius >= 0)) return [];
  const lo = cellAt(world(at.wx - radius, at.wz - radius));
  const hi = cellAt(world(at.wx + radius, at.wz + radius));
  const out: { id: ObjectCellId; d2: number }[] = [];
  for (let cz = lo.cz; cz <= hi.cz; cz += 1) {
    for (let cx = lo.cx; cx <= hi.cx; cx += 1) {
      // Distance from the point to the nearest point of the cell's square.
      const x0 = cx * CELL_SPAN;
      const z0 = cz * CELL_SPAN;
      const dx = at.wx < x0 ? x0 - at.wx : at.wx > x0 + CELL_SPAN ? at.wx - x0 - CELL_SPAN : 0;
      const dz = at.wz < z0 ? z0 - at.wz : at.wz > z0 + CELL_SPAN ? at.wz - z0 - CELL_SPAN : 0;
      const d2 = dx * dx + dz * dz;
      if (d2 <= radius * radius) out.push({ id: { cx, cz }, d2 });
    }
  }
  out.sort((a, b) => a.d2 - b.d2 || a.id.cz - b.id.cz || a.id.cx - b.id.cx);
  return out.map((o) => o.id);
}

/** Distance from a point to the nearest point of a cell's square. */
export function distanceToCell(at: WorldPoint, id: ObjectCellId): number {
  const x0 = id.cx * CELL_SPAN;
  const z0 = id.cz * CELL_SPAN;
  const dx = at.wx < x0 ? x0 - at.wx : at.wx > x0 + CELL_SPAN ? at.wx - x0 - CELL_SPAN : 0;
  const dz = at.wz < z0 ? z0 - at.wz : at.wz > z0 + CELL_SPAN ? at.wz - z0 - CELL_SPAN : 0;
  return Math.hypot(dx, dz);
}
