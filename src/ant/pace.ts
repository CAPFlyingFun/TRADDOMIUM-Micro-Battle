/**
 * PACE — the ceiling on how fast she may go, NOT propulsion.
 *
 * This is the piece the telegraph got wrong. Selecting WALK does not
 * make her walk; it says that a full push of the stick means a walk.
 * She moves because a thumb is asking her to, and stops when it lets
 * go.
 *
 * The point is precision. A thumb-sized stick has about 64 px of travel,
 * which is nowhere near enough to divide into four reliable speed bands
 * — the old build proved that on the device. Spend the whole radius
 * inside ONE pace instead and every pace gets fine control, at the cost
 * of one extra decision the player makes rarely.
 *
 * Numbers are GAME TUNING inspired by biology, not measured biology.
 * Real workers forage in the low centimetres per second and move
 * several times that when pressed; at a centimetre per world unit these
 * sit in that shape while keeping a 56 m island crossable.
 */

/** The sustainable paces. Sprint is not one of these — see below. */
export type Pace = 'crawl' | 'walk' | 'run';

/** Slowest first — the order the selector stacks them in. */
export const PACES: readonly Pace[] = ['crawl', 'walk', 'run'];

/** World units per second at FULL stick, per pace. */
export const PACE_SPEED: Record<Pace, number> = {
  crawl: 2.2,
  walk: 7,
  run: 12,
};

/**
 * Sprint is a stamina-limited override, not a fourth pace. It is the
 * only speed that costs anything, so it cannot be a standing choice.
 */
export const SPRINT_SPEED = 18;

/**
 * Reverse never exceeds a reverse walk however high the pace is set. An
 * ant hauling something backwards is not sprinting.
 */
export const REVERSE_CAP = 7;

/**
 * Sidestepping is slower than travelling forwards — six legs crabbing
 * sideways do not cover ground the way six legs striding do.
 */
export const STRAFE_SHARE = 0.65;

/** How the selector writes each pace — Joshua's chevron notation. */
export const PACE_MARK: Record<Pace, string> = {
  crawl: '›',
  walk: '››',
  run: '›››',
};

export const SPRINT_MARK = '››››';

export const PACE_NAME: Record<Pace, string> = {
  crawl: 'crawl',
  walk: 'walk',
  run: 'run',
};

/** Step the pace, clamped at either end rather than wrapping. */
export function shiftPace(from: Pace, steps: number): Pace {
  const at = PACES.indexOf(from);
  return PACES[Math.max(0, Math.min(PACES.length - 1, at + steps))];
}

export function fasterPace(from: Pace): Pace {
  return shiftPace(from, 1);
}

export function slowerPace(from: Pace): Pace {
  return shiftPace(from, -1);
}

/*
 * ── Camera / body catch-up ──────────────────────────────────────────
 *
 * At low speed the camera may lead and the body follows it after a
 * beat, the way the Godot prototype does. Above CATCHUP_MAX_SPEED it is
 * off entirely: looking around at a run must never yank her onto a new
 * heading.
 *
 * These four are deliberately one place. CATCHUP_MAX_SPEED especially:
 * Joshua chose "you must slow down to turn" with the cost in front of
 * him, and if a chase turns out to feel bad on the phone, raising this
 * to PACE_SPEED.walk or .run opens turning up at speed without touching
 * a line of logic anywhere else.
 */

/** How far the camera may stray before her body takes an interest. */
export const FREE_LOOK_ANGLE = (30 * Math.PI) / 180;

/** How long it must stay strayed before she starts coming round. */
export const BODY_CATCHUP_DELAY = 0.35;

/** How fast she comes round once she does, in radians per second. */
export const BODY_CATCHUP_RATE = 2.4;

/** At or below this speed the camera may lead her. Above it, never. */
export const CATCHUP_MAX_SPEED = PACE_SPEED.crawl + 0.001;
