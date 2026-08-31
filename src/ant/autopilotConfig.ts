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
import { MAX_POWERED_SPEED, STALL_SPEED } from './flight';

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
  /**
   * Airspeed held when the waypoint is far away, world units a second.
   *
   * THE FASTEST THE MODEL WILL GIVE, not CRUISE_SPEED. The first cut
   * used cruise — 40 of a possible 70 — and Joshua flew it: "traveling
   * way too slow and should set for the fastest speed". He is right,
   * and en-route automation has no reason to loiter. Everything that
   * SHOULD slow her down still does: the arrival profile, the turns,
   * and the wind.
   */
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
  /**
   * THE FLOOR, and it is a floor rather than a cruising height.
   *
   * 55 cm above whatever is underneath her — ground, or the water's own
   * surface. Joshua and ChatGPT, 2026-08-31: "55 cm AGL/AWL is the
   * MINIMUM en-route clearance candidate, not the automatic target...
   * never below 55 cm except during an actual landing."
   *
   * The first cut had this at 4 m and treated it as the altitude she
   * flew, which is why the screenshots show her at 4.2 and 4.9 m in a
   * gale she could not beat. It was doing what it was told; it was told
   * the wrong thing.
   */
  readonly floorAgl: number;
  /**
   * HOW HIGH THE DRONE LIFT GOES BEFORE SHE STARTS TRAVELLING.
   *
   * Joshua's number, 2026-08-31: "lifts straight up to 1.0m, and once
   * it reaches that altitude AWL/AGL, will then start flying and adjust
   * altitude accordingly for flight."
   *
   * Above `floorAgl` on purpose, and not by accident of taste: the band
   * search will pick her cruising altitude the instant she starts
   * travelling, and starting that search from below the floor would
   * have her leave the ground already breaking the one altitude rule
   * the autopilot has. A metre is also clear of the surf she may have
   * just left — a crest stands about 22 cm over mean water.
   */
  readonly launchAgl: number;
  /**
   * The highest band the search will consider, world units.
   *
   * Not a limit on where she may BE — a player can fly as high as the
   * model allows — only on how far up the autopilot will look for a
   * better wind. Thirty metres is well past the ten at which the
   * profile saturates, so nothing above it would read differently.
   */
  readonly ceilingAgl: number;
  /**
   * How briskly she moves between bands, as a share of full lever.
   *
   * Gentle: a queen porpoising between altitudes every time a gust
   * changes which band scores best would be worse than one that simply
   * picked wrong and stayed there.
   */
  readonly bandUrgency: number;
  /**
   * Ground progress a band must beat the current one by before she
   * moves, world units a second.
   *
   * Hysteresis, and the same argument as the capture radius: without it
   * two bands a hair apart trade places on the noise and she spends the
   * flight climbing and descending instead of arriving.
   */
  readonly bandMargin: number;
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
  cruise: MAX_POWERED_SPEED,
  // CHOSEN FROM WHERE THE APPROACH SHOULD START, not from a fraction
  // of cruise — the first attempt used a tenth of cruise a second and
  // its own comment claimed that began the slow-down eighty metres out.
  // The arithmetic says two: cruise is reached at `v^2 / 2a`, so 4
  // units per second squared puts the whole approach inside 200 units,
  // which is INSIDE the 180-unit capture radius. The profile would
  // never have engaged at all and she would have arrived at full
  // cruise every time.
  //
  // 1.2 put the approach at 667 units against a 40-unit cruise. With
  // the cruise now the model's full 70 the same brake would start it
  // over two thousand — twenty metres of decelerating — so it rises
  // with the speed it has to shed: 3.6 puts it back around 680.
  brake: 3.6,
  // Half again over the stall.
  slowest: STALL_SPEED * 1.5,
  // A hundred and eighty world units is 1.8 m — a body length or two,
  // and inside the 5.5 m a watercourse node is known to.
  capture: 180,
  release: 420,
  // 55 cm — a floor, not a target. See the field.
  floorAgl: 55,
  launchAgl: 100,
  ceilingAgl: 3_000,
  bandUrgency: 0.45,
  bandMargin: 4,
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
