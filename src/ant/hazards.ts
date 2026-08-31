/**
 * THE THINGS IN HER WAY, AND THE ONE QUESTION THAT SORTS THEM.
 *
 * **Does it have a top?**
 *
 * That is the whole taxonomy, and it is not mine — it is the single
 * idea worth taking from CanaryGC's mission optimizer (MIT; read
 * 2026-08-31, see docs/DRONE_GCS_AUDIT.md). A drone GCS divides the
 * world into obstacles, which have a height and can be climbed over,
 * and restricted airspace, which cannot be climbed over at any
 * altitude because it is a rule rather than a thing. One distinction,
 * two completely different responses:
 *
 *   HAS A TOP        raise the leg to clear it. The route is unchanged.
 *   HAS NO TOP       go around it. The altitude is unchanged.
 *
 * And the reason it is worth taking is what it removes. With that
 * split, avoidance is a 2D route plus a per-leg altitude — there is no
 * 3D search anywhere, no voxel grid, no volumetric map. CanaryGC's
 * whole optimizer is 354 lines because of it.
 *
 * TMB'S TRANSLATION IS NOT A METAPHOR:
 *
 *   tree, rock, cliff, plant     has a top      climbable
 *   predator zone, hostile nest  has no top     never climbable
 *   deep ocean, when it is a     has no top     never climbable
 *     no-go rather than a view
 *
 * A predator does not become safe at four metres. That is exactly what
 * restricted airspace means, and it is why "no top" is `null` rather
 * than a very large number: a very large number would let a planner
 * with a generous ceiling decide to fly over a spider.
 *
 * HEIGHTS ARE ABOVE THE LOCAL GROUND, never MSL. The same rule the
 * autopilot's bands follow, and for the same reason: `top` is how much
 * air she must have under her to pass over the thing, and a number
 * measured from sea level would mean one height in a valley and another
 * on a ridge for the same tree.
 *
 * NOTHING HERE KNOWS WHAT A HAZARD *IS*. It is a circle, a top and a
 * label. What puts a hazard in the list — vegetation, a creature, a
 * region the colony has learned to avoid — is somebody else's problem,
 * and keeping it that way is what stops this file growing a dependency
 * on every system that might one day produce one.
 */
import type { WorldPoint } from '../world/coords';

/** What kind of thing it is. For the readout and the map, not the maths. */
export type HazardKind =
  | 'obstacle'
  | 'predator'
  | 'colony'
  | 'water'
  | 'zone';

export interface Hazard {
  /** Stable identity, so a plan can be compared with the last one. */
  readonly id: string;
  /** Centre, in WORLD coordinates — it outlives the frame. */
  readonly at: WorldPoint;
  /** Footprint radius, world units. */
  readonly radius: number;
  /**
   * HOW MUCH AIR SHE NEEDS UNDER HER TO PASS OVER IT, above the local
   * ground, world units — or NULL for a thing that cannot be flown over
   * at any height.
   *
   * Null is the whole point of the type. See the header.
   */
  readonly top: number | null;
  readonly kind: HazardKind;
  /** For the map and the readout. */
  readonly label?: string;
}

/**
 * CAN SHE GET OVER IT, given how high she is willing to go?
 *
 * A hazard with no top never can. A hazard whose top plus the clearance
 * she keeps stands above her ceiling never can either — and that second
 * case is the one that makes the split honest rather than a label,
 * because it means a big enough obstacle becomes restricted airspace on
 * its own merits and gets routed around like one.
 */
export function clearable(
  hazard: Hazard, clearance: number, ceilingAgl: number,
): boolean {
  return hazard.top !== null && hazard.top + clearance <= ceilingAgl;
}

/**
 * The AGL a leg must hold to pass over this hazard.
 *
 * Meaningless for one that cannot be cleared, so it says so rather than
 * returning a number a caller might use: `null` in, `null` out.
 */
export function topFor(hazard: Hazard, clearance: number): number | null {
  return hazard.top === null ? null : hazard.top + clearance;
}

/**
 * The hazard's footprint as a polygon, grown by a margin.
 *
 * A REGULAR POLYGON RATHER THAN A CIRCLE, because the router works on
 * corners: a visibility graph needs vertices to aim at, and a circle
 * has none. Eight sides by default — enough that the detour does not
 * visibly cut the corner, few enough that a dozen hazards do not
 * outgrow the graph bound.
 *
 * GROWN FROM THE RADIUS, so the routed path clears the true edge by the
 * margin instead of grazing it. And the polygon is drawn OUTSIDE the
 * circle rather than inscribed in it: an inscribed octagon's edges pass
 * inside the radius, which would route her through the thing she is
 * avoiding by up to 8 per cent of it.
 */
export function ringAround(
  hazard: Hazard, margin: number, sides: number,
): WorldPoint[] {
  const n = Math.max(3, Math.round(sides));
  // sec(π/n) pushes the flat edges out onto the circle.
  const reach = (hazard.radius + margin) / Math.cos(Math.PI / n);
  const ring: WorldPoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    ring.push({
      wx: hazard.at.wx + Math.cos(a) * reach,
      wz: hazard.at.wz + Math.sin(a) * reach,
    });
  }
  return ring;
}
