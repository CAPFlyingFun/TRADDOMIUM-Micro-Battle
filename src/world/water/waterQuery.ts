/**
 * ONE DOOR TO ASK WHERE THE WATER IS.
 *
 * v0's water audit spends a whole section on what happens when there is
 * more than one answer to this question, and the answer is always the
 * same shape of bug: a queen who floats above the surface she is drawn
 * standing in, foam marching across an inland pool at the Pacific's
 * speed, a camera that thinks it is under water while the renderer
 * thinks it is over it. Every one of those is two systems disagreeing
 * about the same cubic centimetre.
 *
 * So freshwater and the sea answer the SAME SHAPE, and nothing that
 * reads water learns which water it is in. A stream and the Pacific are
 * both "a surface, a column under it, and a current" — the difference is
 * in the numbers, and a caller that has to branch on the kind of water
 * is a caller that will eventually branch wrongly.
 *
 * TWO TIERS BEHIND ONE DOOR. Joshua, 2026-09-06: "Do the two-tier,
 * dynamic near and surveyed ribbons far." Near the player a shallow-water
 * solver runs on a 256 m window and the water genuinely moves; beyond it
 * the surveyed courses are drawn as static ribbons. That split is a
 * RENDERING and COST decision, and it stops at this interface: whichever
 * tier a point falls in, the answer has the same fields and means the
 * same thing. A query that returned a current near and none far would be
 * the seam leaking into gameplay.
 *
 * NULL MEANS DRY, and it is not the same as zero depth. A film a
 * millimetre deep is water — she can drink from it, it slows her, it
 * wets her wings. Zero would make "no water here" and "the thinnest
 * possible water here" the same value, and the audit's F3 is exactly
 * that mistake: an invisible-but-afloat band where the surface was not
 * drawn and the physics thought she was swimming.
 *
 * Pure: no three, no DOM. Where the water is is a fact about the world.
 */
import type { WorldPoint } from '../coords';

/** Water at one point: the surface, the column under it, and the current. */
export interface WaterSpot {
  /**
   * The world height of the water's SURFACE — what she floats on and
   * what the renderer draws.
   *
   * Absolute, not a depth above the bed, because the two things that
   * read it most (a camera deciding whether it is submerged, a body
   * deciding where it floats) both live in world height and converting
   * at every call site is how a half-metre of error gets in.
   */
  readonly surface: number;
  /**
   * The column of water under that surface, world units, always > 0.
   *
   * Positive by construction: a spot with no water is `null`, not a spot
   * with zero depth. See the header.
   */
  readonly depth: number;
  /**
   * What the water is doing, world units per second, on the ground plane.
   *
   * Zero for still water, which a lake genuinely is. The sea's answer is
   * its orbital current; a stream's is its flow downhill. Both push her
   * the same way, which is the point of them being one field.
   */
  readonly flowX: number;
  readonly flowZ: number;
}

/**
 * Anything that can be asked where its water is.
 *
 * Implemented by the freshwater solver, by the surveyed far tier, and —
 * when it is wired — by the sea, so that a single router can ask each in
 * turn and hand back the first answer.
 */
export interface WaterSource {
  /** The water at this point, or null where this source has none. */
  spotAt(at: WorldPoint): WaterSpot | null;
}

/**
 * How far below a surface a point is; zero when it is not under.
 *
 * Here rather than in each caller because "am I under the water" is
 * asked by the camera fog, by a later swimming pass and by anything that
 * drowns, and three implementations of one subtraction is three chances
 * to get the sign backwards — which v0 did, and which reads as the world
 * turning green while standing on a beach.
 */
export function submersion(spot: WaterSpot | null, height: number): number {
  return spot === null ? 0 : Math.max(0, spot.surface - height);
}

/**
 * Ask several sources in order and take the first that has water.
 *
 * ORDER IS THE RULE, and it is the caller's to set: the near solver
 * before the far ribbons, so that where they overlap the one that is
 * actually simulating wins. Two sources that both answer for the same
 * point is not a bug — it is the overlap the two tiers need in order to
 * cross over without a seam — but SILENTLY taking the wrong one is.
 */
export function firstSpot(
  sources: readonly WaterSource[],
  at: WorldPoint,
): WaterSpot | null {
  for (const source of sources) {
    const spot = source.spotAt(at);
    if (spot !== null) return spot;
  }
  return null;
}
