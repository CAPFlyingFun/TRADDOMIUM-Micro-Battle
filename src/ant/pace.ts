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
 * ── Feel ────────────────────────────────────────────────────────────
 *
 * Matched to the Godot build, which is the reference Joshua likes.
 * Slow-to-turn and lean-into-the-turn were both tried here first and
 * both felt wrong on the device.
 *
 * The scheme those replaced: input is CAMERA-relative, and while she is
 * being driven her body points where the camera points. Travelling
 * somewhere is already a statement about which way she means to face,
 * so steering is just looking — no turn control at all.
 */

/**
 * How fast her body comes onto the camera's heading while she is being
 * driven, as an exponential rate. Brisk on purpose: this is steering,
 * and steering that lags reads as ice.
 */
export const TURN_RATE = 18;

/**
 * How far the camera may swing off her nose, at rest, before she turns
 * to meet it.
 *
 * She only comes back to the EDGE of it rather than onto her nose —
 * chasing it to zero would mean she could never be looked at from the
 * side at all. Standing still you can look this far round her and she
 * just watches you over her shoulder.
 *
 * The Godot build uses 60, tuned for a mouse. A thumb-drag covers
 * ground far more slowly, so waiting out 60 degrees of it felt like she
 * was ignoring you.
 *
 * It is also the size of the lag itself, which is the part that reads
 * as sluggish: she settles at the EDGE of this arc, so whatever it is
 * set to is how far behind the view she permanently sits. Halving it
 * from 60 halves that. If she still reads as trailing the camera, this
 * is the number, not the rate below.
 */
export const REST_DEADZONE = (30 * Math.PI) / 180;

/**
 * How briskly she closes that gap once past it, as an exponential rate
 * — so HIGHER is quicker, and 3 is gentler than the 7 it replaces.
 *
 * Deliberately gentle now that the deadzone is small: she starts coming
 * round much sooner, so the movement has time to be a shuffle rather
 * than a snap.
 */
export const REST_EASE = 3;

/**
 * How fast her speed closes on what the stick is asking for. An
 * exponential ease rather than a fixed acceleration, so a standing
 * start and a small correction settle in the same time and neither
 * depends on the frame rate.
 */
export const SPEED_EASE = 7;

/**
 * How fast the DIRECTION she is trying to go swings round.
 *
 * Separate from SPEED_EASE deliberately. One is "how fast does she get
 * up to pace", the other is "how fast does she change her mind", and
 * they want different answers: flicking the stick from left to right
 * reversed her travel inside a single frame, which no six-legged
 * animal does — the legs are still mid-stride the old way.
 */
export const DIRECTION_EASE = 6;
