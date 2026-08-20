/**
 * GAITS — how hard she is pushing herself.
 *
 * Chosen by how far the stick travels, in zones rather than a curve:
 * inside half the ring is a crawl, the outer half is a walk, and pushing
 * the thumb past the ring entirely is a sprint. Zones because a phone
 * stick is only ~64 px of travel, and a continuous ramp across that
 * distance gives no room to sit at a middle speed.
 *
 * Speed is flat within a zone. That is the point of having zones: a
 * crawl is a crawl wherever in the crawl band your thumb happens to be.
 *
 * Numbers are GAME TUNING inspired by biology, not measured biology.
 * Real workers walk in the low centimetres per second and sprint several
 * times that; at a centimetre per world unit these sit in that shape
 * while keeping a 56 m island crossable.
 */

export type Gait = 'crawl' | 'walk' | 'sprint';

/** Slowest first — the order the throttle stacks them in. */
export const GAITS: readonly Gait[] = ['crawl', 'walk', 'sprint'];

/** World units per second. */
export const GAIT_SPEED: Record<Gait, number> = {
  crawl: 2.2,
  walk: 7,
  sprint: 16,
};

/**
 * Radians per second of turning. Momentum costs agility: a sprinting
 * ant takes a wider line than one picking her way along at a crawl.
 */
export const GAIT_TURN: Record<Gait, number> = {
  crawl: 4.2,
  walk: 3.4,
  sprint: 2.3,
};

/**
 * Zone edges, as a fraction of the stick's ring radius. Half the ring
 * divides crawl from walk; the ring's own edge divides walk from
 * sprint, so the boundary you have to feel for is one you can see.
 */
export const CRAWL_UNTIL = 0.5;
export const WALK_UNTIL = 1;

/** The gait a given stick deflection asks for. */
export function gaitFromDeflection(deflection: number): Gait {
  if (deflection < CRAWL_UNTIL) return 'crawl';
  if (deflection < WALK_UNTIL) return 'walk';
  return 'sprint';
}
