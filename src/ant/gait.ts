/**
 * GAITS — how hard she is pushing herself.
 *
 * Speed is chosen two ways that share one value. The stick's deflection
 * picks a gait continuously, the way an analog stick is meant to work;
 * the gait rail can pin one so it stops changing under your thumb.
 * Whichever is in charge, the ant only ever reads the result.
 *
 * Numbers are GAME TUNING inspired by biology, not measured biology.
 * Real workers walk in the low centimetres per second and sprint several
 * times that; at a centimetre per world unit these sit in that shape
 * while keeping a 56 m island crossable.
 */

export type Gait = 'crawl' | 'walk' | 'run';

/** Slowest first — the order the rail stacks them in. */
export const GAITS: readonly Gait[] = ['crawl', 'walk', 'run'];

/** World units per second at full deflection. */
export const GAIT_SPEED: Record<Gait, number> = {
  crawl: 2,
  walk: 6.5,
  run: 15,
};

/**
 * Radians per second of turning. Momentum costs agility: a running ant
 * takes a wider line than one picking her way along at a crawl.
 */
export const GAIT_TURN: Record<Gait, number> = {
  crawl: 4.2,
  walk: 3.4,
  run: 2.3,
};

/** Where the deflection zones sit, as a fraction of full stick travel. */
export const CRAWL_UNTIL = 0.38;
export const WALK_UNTIL = 0.78;

/**
 * The gait a given stick deflection asks for. Below the crawl threshold
 * she is barely moving, so it still reads as a crawl rather than a stop —
 * the stick's own dead zone decides whether she moves at all.
 */
export function gaitFromDeflection(deflection: number): Gait {
  if (deflection < CRAWL_UNTIL) return 'crawl';
  if (deflection < WALK_UNTIL) return 'walk';
  return 'run';
}
