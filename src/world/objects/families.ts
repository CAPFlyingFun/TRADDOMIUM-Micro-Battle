/**
 * THE KINDS OF THING THAT STAND ON THE GROUND — and which of them are
 * somebody, and which are scenery.
 *
 * Five families ship in the first milestone (Joshua, 2026-09-06: "Start
 * SMALL"): grass, twigs, stones, rocks, trees. Two lines run through
 * them and both matter to the architecture more than to the picture:
 *
 * MAJOR vs COSMETIC. A tree or a boulder is a thing gameplay will one
 * day refer to — climbed, felled, hidden behind, nested under — so it
 * needs an IDENTITY that survives a reload and a second phone: the same
 * tree is `tree:cx,cz:7` for everyone, forever, and a future delta can
 * say "tree:cx,cz:7 was felled" and mean something. A blade of grass or
 * a twig is density: there may be twenty thousand in view and none of
 * them is anyone. They are still addressable (cell + index, and the
 * populator is deterministic) so a later pass CAN give one a name if a
 * carried twig turns out to matter, but nothing is spent naming them
 * now. Joshua: "do not build a system where a future gameplay-important
 * tree is indistinguishable from a disposable GPU decoration".
 *
 * NEAR vs FAR. An ant cannot use a twig ninety metres away, and a phone
 * cannot afford to draw one. Each family has a REACH, a fraction of the
 * detail rung's radius with a floor and a ceiling, past which it is not
 * generated at all — and inside which it is thinned with distance by
 * rank (`budget.ts`). The numbers are Joshua's bands (very near 0–10 m,
 * near 10–30, mid 30–60, far 60–100) turned into per-family curves, and
 * they are GAME TUNING to be measured on the phone, not measured facts.
 *
 * Pure: no three, no DOM. `src/world/` is core.
 */

export type ObjectFamily = 'grass' | 'twig' | 'stone' | 'rock' | 'tree';

/** In the order the budgets and the HUD list them. */
export const OBJECT_FAMILIES: readonly ObjectFamily[] = Object.freeze(['grass', 'twig', 'stone', 'rock', 'tree']);

export interface FamilySpec {
  readonly family: ObjectFamily;
  /** Whether an object of this family carries a stable id. See the header. */
  readonly major: boolean;
  /**
   * How far from the camera this family EXISTS, as a fraction of the
   * detail rung's object radius, held between a floor and a ceiling in
   * world units. Beyond it nothing is generated; inside it the rank
   * thinning (`budget.ts`) decides how much is drawn at each distance.
   */
  readonly reachOfRadius: number;
  readonly reachFloor: number;
  readonly reachCeiling: number;
  /**
   * Where the thinning starts as a fraction of the family's reach: full
   * density inside, falling to `farKeep` at the reach.
   */
  readonly fullUntil: number;
  /** The fraction still drawn at the far edge of the reach, before the cap thins further. */
  readonly farKeep: number;
}

/** 100 world units to the metre, as everywhere. */
const M = 100;

export const FAMILY_SPECS: Readonly<Record<ObjectFamily, FamilySpec>> = Object.freeze({
  grass: Object.freeze({
    family: 'grass' as ObjectFamily,
    major: false,
    // Blades are the ant's forest and a phone's whole vertex budget:
    // full inside ten metres, a third of that by thirty, none beyond.
    reachOfRadius: 0.3, reachFloor: 12 * M, reachCeiling: 30 * M,
    fullUntil: 0.35, farKeep: 0.25,
  }),
  twig: Object.freeze({
    family: 'twig' as ObjectFamily,
    major: false,
    reachOfRadius: 0.2, reachFloor: 10 * M, reachCeiling: 20 * M,
    fullUntil: 0.5, farKeep: 0.3,
  }),
  stone: Object.freeze({
    family: 'stone' as ObjectFamily,
    major: false,
    // Small stones are very-near clutter: a pebble is a boulder to her
    // and nothing at all from twelve metres.
    reachOfRadius: 0.12, reachFloor: 8 * M, reachCeiling: 12 * M,
    fullUntil: 0.6, farKeep: 0.4,
  }),
  rock: Object.freeze({
    family: 'rock' as ObjectFamily,
    major: true,
    reachOfRadius: 1, reachFloor: 15 * M, reachCeiling: 200 * M,
    fullUntil: 0.6, farKeep: 0.6,
  }),
  tree: Object.freeze({
    family: 'tree' as ObjectFamily,
    major: true,
    reachOfRadius: 1, reachFloor: 15 * M, reachCeiling: 200 * M,
    fullUntil: 0.7, farKeep: 0.7,
  }),
});

/** How far a family exists at a given object radius, world units. */
export function familyReach(family: ObjectFamily, objectRadius: number): number {
  const spec = FAMILY_SPECS[family];
  return Math.min(spec.reachCeiling, Math.max(spec.reachFloor, objectRadius * spec.reachOfRadius));
}

/**
 * The fraction of a family still drawn at `distance` from the camera,
 * given its reach: 1 inside `fullUntil`, falling smoothly to `farKeep`
 * at the reach, 0 beyond it. Deterministic and continuous, so the
 * rank threshold it drives moves smoothly as the camera does.
 */
export function keepFraction(family: ObjectFamily, distance: number, reach: number): number {
  if (!(distance < reach)) return 0;
  const spec = FAMILY_SPECS[family];
  const from = reach * spec.fullUntil;
  if (distance <= from) return 1;
  const t = (distance - from) / (reach - from);
  const s = t * t * (3 - 2 * t);
  return 1 + (spec.farKeep - 1) * s;
}
