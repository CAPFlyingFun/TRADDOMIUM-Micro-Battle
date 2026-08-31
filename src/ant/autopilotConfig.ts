/**
 * THE NUMBERS THE AUTOPILOT TURNS, and none of the rules.
 *
 * The same split `autonomyConfig.ts` keeps, for the same reason and
 * from the same source: Beyond Extinction's DinoConfig is a pure
 * dictionary merged over defaults, and the AI that reads it holds no
 * data at all. A tuning number buried inside a decision cannot be
 * changed without re-reading the decision, and a decision that owns its
 * numbers cannot be tested against anything but them.
 *
 * Everything here is GAME TUNING. None of it is measured biology, and
 * the few numbers that come from the flight model say so.
 */
import { CRUISE_SPEED, MAX_POWERED_SPEED, STALL_SPEED } from './flight';

export interface AutopilotConfig {
  /**
   * Degrees of track error that count as "on track".
   *
   * The deadband, and the whole of the anti-chatter story. Without one
   * the controller answers a tenth of a degree with a stick input, the
   * turn overshoots by a tenth of a degree the other way, and she
   * wags her way across the island. Three degrees is finer than a
   * player flies and coarser than the wind's own noise.
   */
  readonly trackDeadband: number;
  /**
   * Track error, in degrees, at which the turn command saturates.
   *
   * Below it the response is proportional, so a small error gets a
   * small correction; at or above it she turns as hard as she turns.
   * Forty-five rather than one-eighty: a queen a hundred and eighty
   * degrees out and a queen fifty degrees out both want the same
   * answer, which is "all of it".
   */
  readonly trackFullScale: number;
  /**
   * The most side-stick the autopilot will ever ask for, 0 to 1.
   *
   * Under one on purpose. It leaves the player's own authority visibly
   * greater than the autopilot's, and it keeps the bank inside the
   * range the flight model was tuned to look right in.
   */
  readonly maxTurn: number;
  /** Airspeed held when the waypoint is far away, world units a second. */
  readonly cruise: number;
  /**
   * How gently she is asked to shed speed on the way in, units per
   * second squared.
   *
   * The arrival profile is `sqrt(2 * a * range)` capped at cruise — the
   * speed from which this deceleration exactly stops her at the pin.
   * A smooth curve rather than a threshold, so nothing about the
   * approach happens at a particular distance.
   */
  readonly brake: number;
  /**
   * The slowest she is asked to fly on an approach.
   *
   * Above the stall with room to spare: an autopilot that commands the
   * edge of the envelope is one gust from falling out of the sky, and
   * the queen has no business being there when nobody is holding her.
   */
  readonly slowest: number;
  /** Inside this range of the pin she is ARRIVED, world units. */
  readonly capture: number;
  /**
   * And outside THIS she is not, world units.
   *
   * The hysteresis, and the reason she cannot orbit. A single radius
   * means the wind nudges her a metre out, the controller turns back
   * for it, she overshoots, and the loop is a circle round the pin
   * forever. Letting go needs more than taking hold did.
   */
  readonly release: number;
  /** Metres of clearance she keeps over the terrain while en route. */
  readonly clearance: number;
  /**
   * Seconds ahead the terrain is checked, scaled by groundspeed.
   *
   * A fixed distance is wrong at both ends — useless at a sprint and
   * wasteful at a hover — so this is time, and the distance follows
   * from how fast she is actually crossing the ground.
   */
  readonly lookAhead: number;
  /**
   * How long range must fail to close before she calls it BLOCKED.
   *
   * Long enough that a turn, a gust or a climb over a ridge is not
   * mistaken for defeat. She may legitimately fly away from the pin
   * for several seconds while coming round onto track.
   */
  readonly patience: number;
  /**
   * The closing rate below which no progress is being made, units a
   * second. Slightly above zero, so a queen held exactly still by a
   * headwind is blocked rather than eternally patient.
   */
  readonly crawling: number;
  /**
   * Stick movement that counts as the player taking over, 0 to 1.
   *
   * A deadzone, because a thumb resting on the glass is not a command
   * and a stick that has not quite re-centred is not either. Anything
   * past this hands control straight back.
   */
  readonly manualDeadzone: number;
}

export const AUTOPILOT_DEFAULTS: AutopilotConfig = {
  trackDeadband: 3,
  trackFullScale: 45,
  maxTurn: 0.75,
  cruise: CRUISE_SPEED,
  // CHOSEN FROM WHERE THE APPROACH SHOULD START, not from a fraction
  // of cruise — the first attempt used a tenth of cruise a second and
  // its own comment claimed that began the slow-down eighty metres out.
  // The arithmetic says two: cruise is reached at `v^2 / 2a`, so 4
  // units per second squared puts the whole approach inside 200 units,
  // which is INSIDE the 180-unit capture radius. The profile would
  // never have engaged at all and she would have arrived at full
  // cruise every time.
  //
  // 1.2 puts it at 667 units — about six and a half metres, some
  // seventeen seconds of flight at her speed. Far enough to read as an
  // approach, near enough that a cross-island trip is not spent
  // decelerating.
  brake: 1.2,
  // Half again over the stall.
  slowest: STALL_SPEED * 1.5,
  // A hundred and eighty world units is 1.8 m — a body length or two,
  // and inside the 5.5 m a watercourse node is known to.
  capture: 180,
  release: 420,
  // Four metres. High enough to clear the scatter and the microterrain
  // she is not flying around, low enough to still feel like an ant.
  clearance: 400,
  lookAhead: 2.5,
  patience: 6,
  crawling: 2,
  manualDeadzone: 0.18,
};

/** Defaults with any dial overridden — the DinoConfig.get_config shape. */
export function autopilotConfig(
  over: Partial<AutopilotConfig> = {},
): AutopilotConfig {
  return { ...AUTOPILOT_DEFAULTS, ...over };
}

/** The fastest the model can be asked for, for clamping a command. */
export const CEILING = MAX_POWERED_SPEED;
