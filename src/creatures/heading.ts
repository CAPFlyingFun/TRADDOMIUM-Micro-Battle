/**
 * THE ONE HEADING CONVENTION, restated for the creatures.
 *
 * An actor's heading `h` means ahead is `(sin h, cos h)` — the rule in
 * `actor/Transform.ts`, and the rule `coords.compassBearing` explains at
 * length. Creatures use the same convention so a renderer aims a worm
 * and an ant the same way, but `creatures/` may not import `actor/`
 * (ARCHITECTURE §3), so the wrap is written here again, in two lines,
 * rather than reached for across a boundary the map does not draw.
 *
 * Pure: no three, no DOM. `src/creatures/` is core.
 */
import { translate, type WorldPoint } from '../world/coords';

export const TAU = Math.PI * 2;

/** Into (−π, π], the actor convention. */
export function wrapHeading(heading: number): number {
  let h = heading % TAU;
  if (h > Math.PI) h -= TAU;
  else if (h <= -Math.PI) h += TAU;
  return h;
}

/** The heading that points from `from` at `to`. Zero when they coincide. */
export function headingToward(from: WorldPoint, to: WorldPoint): number {
  const dx = to.wx - from.wx;
  const dz = to.wz - from.wz;
  if (dx === 0 && dz === 0) return 0;
  return Math.atan2(dx, dz);
}

/** A point `distance` along `heading` from `at`. */
export function ahead(at: WorldPoint, heading: number, distance: number): WorldPoint {
  return translate(at, Math.sin(heading) * distance, Math.cos(heading) * distance);
}

/**
 * `heading` turned toward `wanted` by at most `maxStep` radians, the
 * short way round. A hard angular limit rather than an easing factor —
 * the donor worm's lesson: a lerp turns fastest when the gap is widest,
 * which is a turning radius that shrinks inside the animal's own bore.
 */
export function turnToward(heading: number, wanted: number, maxStep: number): number {
  const gap = wrapHeading(wanted - heading);
  if (!(maxStep > 0) || Math.abs(gap) <= maxStep) return wrapHeading(wanted);
  return wrapHeading(heading + (gap > 0 ? maxStep : -maxStep));
}
