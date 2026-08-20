/**
 * THE THROTTLE LADDER — what speed she is set to, not how hard a thumb
 * is pushing.
 *
 * Warship-style: the setting persists, so you pick a speed and steer,
 * rather than holding a stick at a distance and hoping. Tapping a notch
 * goes straight to it, which covers both stepping one along and
 * dropping from a sprint to reverse in a single reach.
 *
 * Reverse only goes as fast as a crawl or a walk. An ant hauling
 * something backwards is not sprinting.
 *
 * Numbers are GAME TUNING inspired by biology, not measured biology.
 * Real workers forage in the low centimetres per second and move
 * several times that when pressed; at a centimetre per world unit these
 * sit in that shape while keeping a 56 m island crossable.
 */

export type Notch =
  | 'backWalk'
  | 'backCrawl'
  | 'stop'
  | 'crawl'
  | 'walk'
  | 'run'
  | 'sprint';

/** Slowest (most astern) first — the order the gauge stacks them in. */
export const NOTCHES: readonly Notch[] = [
  'backWalk', 'backCrawl', 'stop', 'crawl', 'walk', 'run', 'sprint',
];

/** World units per second. Negative is astern. */
export const NOTCH_SPEED: Record<Notch, number> = {
  backWalk: -7,
  backCrawl: -2.2,
  stop: 0,
  crawl: 2.2,
  walk: 7,
  run: 12,
  sprint: 18,
};

/**
 * Radians per second of turning. Momentum costs agility, so the faster
 * settings take a wider line; standing still she pivots freely.
 */
export const NOTCH_TURN: Record<Notch, number> = {
  backWalk: 2.6,
  backCrawl: 3.2,
  stop: 4.5,
  crawl: 4.2,
  walk: 3.4,
  run: 2.8,
  sprint: 2.1,
};

/** How the gauge writes each notch — Joshua's own chevron notation. */
export const NOTCH_MARK: Record<Notch, string> = {
  backWalk: '‹‹',
  backCrawl: '‹',
  stop: '■',
  crawl: '›',
  walk: '››',
  run: '›››',
  sprint: '››››',
};

export const NOTCH_NAME: Record<Notch, string> = {
  backWalk: 'reverse walk',
  backCrawl: 'reverse crawl',
  stop: 'stop',
  crawl: 'crawl',
  walk: 'walk',
  run: 'run',
  sprint: 'sprint',
};

/** The only notch that costs anything to hold. */
export const COSTS_STAMINA: Notch = 'sprint';

/** Step the throttle by one notch, clamped at either end of the ladder. */
export function shift(from: Notch, steps: number): Notch {
  const at = NOTCHES.indexOf(from);
  const to = Math.max(0, Math.min(NOTCHES.length - 1, at + steps));
  return NOTCHES[to];
}

/** The next notch down from here — what an exhausted sprint falls back to. */
export function slower(from: Notch): Notch {
  return shift(from, -1);
}
