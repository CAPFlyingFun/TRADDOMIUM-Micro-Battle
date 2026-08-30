/**
 * HOW HARD SHE IS ALLOWED TO GO, in one place, for all three media.
 *
 * The paces were never a single idea. LAND owns `PACE_SPEED` and
 * `SPRINT_SPEED` (pace.ts); AIR owns `AUTO_AIRSPEED` and
 * `SPRINT_AIRSPEED` (flight.ts); SEA is neither — it is the land
 * ceiling multiplied by `PADDLE_PACE` inside `wadeAt`. Three files,
 * three shapes, and nowhere to ask "what tier is she on, and what
 * share of what she could do is that".
 *
 * This is that place. It decides nothing and changes nothing: it reads
 * the three existing tables and reports them in one vocabulary, so the
 * mission brain can sense her pace and the developer line can show it.
 *
 * THE TIERS ARE NOT THE SAME SHARE IN EVERY MEDIUM, and that is a fact
 * about the tuning rather than a bug in this file:
 *
 *   AIR    crawl 25%  walk 50%  run 75%  sprint 100%   (by construction)
 *   LAND   crawl 12%  walk 39%  run 67%  sprint 100%
 *   SEA    the same shares as land — PADDLE_PACE scales every tier
 *          equally, so the ratios survive it exactly
 *
 * The air table is written as literal quarters of MAX_POWERED_SPEED.
 * The land table is four hand-tuned speeds — 2.2, 7, 12, 18 — chosen
 * against an ant's real foraging speeds and against a 56 km island
 * being crossable, and they do not land on quarters. Whether they
 * SHOULD is a tuning decision and Joshua's; this file's job is to make
 * the disagreement visible rather than to quietly average it away.
 */
import { PACE_SPEED, SPRINT_SPEED, type Pace } from './pace';
import { AUTO_AIRSPEED, SPRINT_AIRSPEED } from './flight';
import { PADDLE_PACE } from './wading';
import { afloatIn, type Motion } from './motion';

/** Which set of ceilings is in force. */
export type Medium = 'land' | 'air' | 'sea';

/**
 * The four rungs. Sprint is a stamina-limited OVERRIDE rather than a
 * fourth standing pace (pace.ts) — but from the outside it is the top
 * rung of the same ladder, and a readout that could not name it would
 * be unable to say what she is actually doing.
 */
export type Tier = Pace | 'sprint';

export const TIERS: readonly Tier[] = ['crawl', 'walk', 'run', 'sprint'];

/** Which medium a motion belongs to. Derived, never asserted. */
export function mediumOf(motion: Motion): Medium {
  if (motion === 'flying') return 'air';
  if (afloatIn(motion)) return 'sea';
  return 'land';
}

/** The speed ceiling in force, world units a second. */
export function paceCeiling(medium: Medium, tier: Tier): number {
  if (medium === 'air') {
    return tier === 'sprint' ? SPRINT_AIRSPEED : AUTO_AIRSPEED[tier];
  }
  const ground = tier === 'sprint' ? SPRINT_SPEED : PACE_SPEED[tier];
  // Paddling is the land ceiling scaled — wadeAt multiplies her drive
  // by PADDLE_PACE rather than holding a table of its own.
  return medium === 'sea' ? ground * PADDLE_PACE : ground;
}

/**
 * That ceiling as a share of the FASTEST this medium offers, 0–1.
 *
 * Sprint is 1 everywhere by definition. What the lower rungs come to
 * is the tuning, and it differs by medium — see the header.
 */
export function paceShare(medium: Medium, tier: Tier): number {
  const top = paceCeiling(medium, 'sprint');
  return top > 0 ? paceCeiling(medium, tier) / top : 0;
}

/** What she is on right now, given the selected pace and the override. */
export function tierOf(pace: Pace, sprinting: boolean): Tier {
  return sprinting ? 'sprint' : pace;
}

/** `crawl 12%` — one short cell for a developer line. */
export function gaitWords(medium: Medium, tier: Tier): string {
  return `${tier} ${(paceShare(medium, tier) * 100).toFixed(0)}%`;
}
