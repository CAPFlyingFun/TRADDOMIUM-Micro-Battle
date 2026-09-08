/**
 * THE ANTENNAE: what a sweep of them finds, and what it looks like.
 *
 * Joshua, 2026-09-08, with two screenshots of another game's version of
 * this: "it has a player/sense which is cool and basically will show
 * objects in a close radius and fill the insects with a solid color. The
 * whole thing last about 10s per ping/sense... which since it knows
 * objects and stuff, will be easy for it even in daytime."
 *
 * He is right that it is easy for this world, and the reason is worth
 * writing down: nothing has to be searched for. Where every blade, twig,
 * stone and tree stands is a FUNCTION of the world seed, its 16 m cell
 * and the habitat (CLAUDE.md, "the world's objects are a function"), and
 * every animal is already in the simulation's own list. A sweep does not
 * look; it asks the world what it already knows and lights it up.
 *
 * WHY IT IS OURS AND NOT A COPY. The convention — a pulse that fills
 * nearby things with a flat colour and names them for a few seconds —
 * is shared by a dozen survival games, and generic conventions may be
 * modelled on others (CLAUDE.md, 2026-09-07). What is not copied is a
 * name or anything unique to one title. So this is ANTENNAE: the player
 * is an ant, an ant reads the world by touch and scent through the pair
 * on its head, and a sweep of them is the most literal thing this game
 * could possibly call it. It is our word for our animal.
 *
 * TWO THINGS MAKE IT READ IN DAYLIGHT, and both come straight off his
 * screenshots. The body is filled with a FLAT bright colour rather than
 * outlined, so it separates from a lit scene as well as from a dark one;
 * and the name sits over it in light text on a dark soft backing, which
 * is legible over bright fog and black soil alike. Neither is lit by the
 * sun — like the finder's pins, these are instrument, not scenery.
 *
 * Pure: no three, no DOM. The renderers in this directory import these
 * types; the types import nothing but coordinates.
 */
import type { WorldPoint } from '../world/coords';

/**
 * What a sensed thing IS, coarsely — three groups, because a colour is
 * only useful if a glance can tell the groups apart, and because these
 * are the three answers to different questions: what is alive near me,
 * what grows here, what can I build with.
 */
export type SenseKind = 'creature' | 'plant' | 'material';

export const SENSE_KINDS: readonly SenseKind[] = Object.freeze(['creature', 'plant', 'material']);

/**
 * One thing the antennae can find. Everything here is a FACT the world
 * already holds — nothing is invented for the sweep, and nothing here
 * may be written back.
 */
export interface SenseThing {
  /**
   * Stable while the thing exists, so a label can keep its identity
   * across frames instead of flickering between neighbours. Objects use
   * their family and cell site (`twig:cx,cz:7`), creatures their own id.
   */
  readonly id: string;
  readonly kind: SenseKind;
  /**
   * The word the label prints, already chosen: `TWIG`, `SPROUT`, `WORM`.
   * A word and not an enum, because the label is text and the renderer
   * must not learn what a creature or a plant family is.
   */
  readonly name: string;
  /** Where it stands. World coordinates, converted only at the render boundary. */
  readonly at: WorldPoint;
  /** The body's reference height above sea level, world units. */
  readonly height: number;
  /**
   * Its longest axis, world units — what the fill is scaled to and how
   * high above it the label floats. A 2.5 mm aphid and a 3 m tree are
   * both in this list, so nothing may assume a size.
   */
  readonly size: number;
}

/** One thing the sweep has actually reached, with how far away and how brightly lit. */
export interface Sighting extends SenseThing {
  /** Horizontal distance from the sweep's origin, world units. */
  readonly distance: number;
  /**
   * How lit it is right now, 0 to 1: the pulse's own envelope times the
   * falloff with distance. The renderers multiply their opacity by it
   * and nothing else decides how bright anything is.
   */
  readonly strength: number;
}

/**
 * THE COLOURS, per kind. Bright and flat, like the screenshots: these
 * are what a body is FILLED with, not lit with.
 *
 * One hue per kind rather than one colour for everything, because the
 * groups answer different questions and a glance should separate them.
 * They are checked against the island in `probe:sense` the same way the
 * finder's pins are: nothing on Kaua'i wears these.
 */
export const SENSE_COLOURS: Readonly<Record<SenseKind, number>> = Object.freeze({
  /** Warm amber: the living things, and the ones you most want to find. */
  creature: 0xffc24d,
  /** Cool white-green: what grows. */
  plant: 0xcdffd6,
  /** Pale blue-white: twigs, stones, rock — what a colony is built out of. */
  material: 0xd6ecff,
});

/** How far above a thing's top its name floats, as a fraction of its size. GAME TUNING. */
export const LABEL_LIFT = 0.65;

/**
 * The label's smallest lift, world units: a 2.5 mm aphid's 65% is under
 * two millimetres, which would print its name inside its own body.
 */
export const LABEL_LIFT_FLOOR = 2;
