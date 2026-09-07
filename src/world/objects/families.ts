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
 * ─── the seven that came with the ecology pass (2026-09-07) ──────────
 *
 * Joshua's brief: "Add richer biome-aware vegetation: grass varieties,
 * ground plants, broad-leaf plants, ferns, small shrubs, reeds near
 * freshwater, coastal plants, sparse rocky/high plants, leaf litter,
 * flowers/seeds. Habitat decides WHAT, generation decides WHERE, Detail
 * Quality decides HOW MUCH. Counts are CAPS, not quotas. Major objects
 * never vanish by quality." Seven families answer it — fern, reed,
 * flower, leaf (litter), shrub, broadleaf, coastal — and they run
 * through the same two lines the first five do. Six are COSMETIC:
 * density, addressable by cell and site, named by nobody. The SHRUB is
 * MAJOR, and the reason is the resource layer's, not the picture's: an
 * aphid colony sits on a shrub (`world/ecology/resources.ts`,
 * `honeydew-host`), a save will one day store deltas against it, and a
 * plant something lives on has to be the same plant on every phone.
 *
 * Their REACHES are the bands again: litter and flowers are very-near
 * clutter like stones; ferns, broad leaves and the coastal spreader go
 * as far as grass does; reeds, standing to nearly two metres, are seen
 * from further; shrubs, which are somebody, reach most of the way to
 * the trees. GAME TUNING, to be argued with on the phone.
 *
 * Pure: no three, no DOM. `src/world/` is core.
 */

export type ObjectFamily =
  | 'grass' | 'twig' | 'stone' | 'rock' | 'tree'
  | 'fern' | 'reed' | 'flower' | 'leaf' | 'shrub' | 'broadleaf' | 'coastal';

/**
 * In the order the budgets and the HUD list them: the first five as
 * shipped, then the ecology pass's seven. Other modules depend on the
 * spellings; the order is a display order and a loop order.
 */
export const OBJECT_FAMILIES: readonly ObjectFamily[] = Object.freeze([
  'grass', 'twig', 'stone', 'rock', 'tree',
  'fern', 'reed', 'flower', 'leaf', 'shrub', 'broadleaf', 'coastal',
]);

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
  // ── the ecology pass's seven (2026-09-07). GAME TUNING throughout. ──
  fern: Object.freeze({
    family: 'fern' as ObjectFamily,
    major: false,
    // A knee-high frond reads about as far as a tall blade does.
    reachOfRadius: 0.25, reachFloor: 10 * M, reachCeiling: 25 * M,
    fullUntil: 0.4, farKeep: 0.3,
  }),
  reed: Object.freeze({
    family: 'reed' as ObjectFamily,
    major: false,
    // Up to 1.8 m tall and standing in beds: the furthest-seen cosmetic
    // plant, so a stream's line is visible from across a field.
    reachOfRadius: 0.4, reachFloor: 12 * M, reachCeiling: 40 * M,
    fullUntil: 0.4, farKeep: 0.35,
  }),
  flower: Object.freeze({
    family: 'flower' as ObjectFamily,
    major: false,
    // A head the size of a coin: a very-near thing, like a stone.
    reachOfRadius: 0.2, reachFloor: 10 * M, reachCeiling: 20 * M,
    fullUntil: 0.5, farKeep: 0.3,
  }),
  leaf: Object.freeze({
    family: 'leaf' as ObjectFamily,
    major: false,
    // Litter is the ant's own floor and nothing at all from twelve metres.
    reachOfRadius: 0.12, reachFloor: 8 * M, reachCeiling: 12 * M,
    fullUntil: 0.6, farKeep: 0.4,
  }),
  shrub: Object.freeze({
    family: 'shrub' as ObjectFamily,
    major: true,
    // Somebody: kept to most of the trees' reach, and never thinned by
    // the draw fraction (`budget.ts` holds every major family to 1).
    reachOfRadius: 0.6, reachFloor: 15 * M, reachCeiling: 80 * M,
    fullUntil: 0.6, farKeep: 0.6,
  }),
  broadleaf: Object.freeze({
    family: 'broadleaf' as ObjectFamily,
    major: false,
    reachOfRadius: 0.2, reachFloor: 10 * M, reachCeiling: 20 * M,
    fullUntil: 0.5, farKeep: 0.3,
  }),
  coastal: Object.freeze({
    family: 'coastal' as ObjectFamily,
    major: false,
    // A low spreader half a metre across: seen about as far as grass.
    reachOfRadius: 0.3, reachFloor: 12 * M, reachCeiling: 30 * M,
    fullUntil: 0.5, farKeep: 0.35,
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
