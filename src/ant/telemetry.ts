import { bearingFromHeading, bearingOf, wrap180 } from '../ui/compassMath';

/**
 * WHAT THE QUEEN IS ACTUALLY DOING, worked out once.
 *
 * Every number the flight HUD shows comes from here, and nothing on the
 * HUD recomputes any of it. That is the point: an altimeter and a
 * flight-path marker that disagree about her vertical speed are worse
 * than either alone, and the only way they can disagree is if they each
 * did their own arithmetic.
 *
 * THE CENTRAL RELATIONSHIP, and the only one:
 *
 *   ground velocity = air velocity + wind velocity
 *
 * There is no indicated airspeed here, no pressure altitude and no
 * temperature correction. Those exist because an aeroplane's pitot tube
 * measures dynamic pressure and has to be talked back into a real
 * speed; this simulation knows her speed through the air mass because
 * that is the number the flight model integrates. Adding an aircraft
 * TAS formula on top would not make her more accurate, it would take a
 * true number and apply a correction meant for a false one.
 *
 * Everything is in the world's own units — one unit is a centimetre —
 * except where a name says otherwise. Angles out of here are COMPASS
 * BEARINGS in degrees, because that is what the rest of the interface
 * speaks; the conversion happens once, at this boundary.
 *
 * GLOBAL COORDINATES ON PURPOSE. Prediction and terrain sampling run on
 * the island's real, million-unit coordinates, because that is what the
 * heightfield is indexed by and doing it in float64 on the CPU is free.
 * Nothing here goes near the GPU: whoever draws these has to put them
 * through the floating origin first, which is the whole reason the
 * ground texture stopped tearing.
 */

/** A horizontal velocity in world units per second. */
export interface Drift {
  readonly x: number;
  readonly z: number;
}

/** Where a prediction says she will be, and what is under her there. */
export interface Predicted {
  /** Global, world units. */
  readonly wx: number;
  readonly wz: number;
  /** Her world altitude there — terrain elevation plus clearance. */
  readonly altitude: number;
  /** The terrain's own elevation there. */
  readonly terrain: number;
  /** How far above the ground she would be. Negative means through it. */
  readonly agl: number;
  /** Seconds from now. */
  readonly after: number;
  /** How far she travels over the ground to get there. */
  readonly range: number;
}

export interface FlightTelemetry {
  readonly airspeed: number;
  readonly groundSpeed: number;
  /** Compass degrees. Where her nose points. */
  readonly heading: number;
  /** Compass degrees. Where the ground is actually going past. */
  readonly track: number;
  /** Signed, −180..180. Track minus heading. */
  readonly drift: number;
  readonly climbing: number;
  /** Height above the terrain directly beneath her. */
  readonly agl: number;
  /** Her world altitude: the terrain under her plus her clearance. */
  readonly altitude: number;
  readonly ground: Drift;
  /** The wind SHE IS IN, after height and gusts — not the forecast. */
  readonly wind: { readonly speed: number; readonly bearing: number };
  /**
   * WHERE SHE MEETS THE GROUND on her present path, or null when the
   * ground does not come up within the horizon. The touchdown zone.
   */
  readonly touchdown: Predicted | null;

  // ── FOR THE EYE ONLY ─────────────────────────────────────────────
  // Eased over about two seconds so the readouts settle instead of
  // flickering. Never used for physics, collision or the markers'
  // positions — those take the raw values above, because a smoothed
  // touchdown time is a late one.
  /** Her clearance over the ground DIRECTLY BENEATH her. */
  readonly shownAgl: number;
  /**
   * HER HEIGHT ABOVE THE GROUND SHE IS GOING TO LAND ON — the
   * "altitude difference" in Joshua's worked example, and the number
   * that actually governs the descent.
   *
   * It is not the same question as `shownAgl` and the gap between them
   * is the whole reason both are shown. Gliding out over a sea cliff,
   * the ground beneath her drops four hundred metres in a wingbeat and
   * her AGL leaps; the ground she is aimed at has not moved, so this
   * does not. Descending into a valley toward a rising far wall, AGL
   * grows while this shrinks. Null when there is no touchdown to be
   * above.
   */
  readonly shownAtLanding: number | null;
  readonly shownRange: number | null;
  readonly shownWhen: number | null;
}

/**
 * HOW FAR AHEAD THE TOUCHDOWN IS LOOKED FOR, in world units of GROUND
 * DISTANCE. Two kilometres.
 *
 * DISTANCE, NOT TIME, and the unit is the design. Joshua stated the
 * problem the way a pilot does — three thousand feet to lose at three
 * hundred a minute is nine and a third minutes, and at a mile a minute
 * that is nine and a third miles ahead — and the answer he wants drawn
 * is the PLACE. A time horizon answers a different question badly: a
 * shallow descent from cruise is minutes away in time and a few hundred
 * metres away on the ground, so a ten-second horizon says "no
 * touchdown" about a landing she can already see.
 *
 * Two kilometres because that is exactly how far the middle terrain
 * tier reaches. Past it there is no drawn ground for a marker to sit
 * on, so a marker there would be a claim about scenery that is not
 * being rendered. A descent too shallow to reach the ground inside two
 * kilometres simply has no touchdown point, which is the honest
 * answer and needs no threshold to express.
 */
export const TOUCHDOWN_RANGE = 200_000;

/**
 * THE NEAR MARCH: fine steps out to two hundred metres.
 *
 * Two ranges rather than one, because the two ends of the search are
 * different questions. Close in, the answer is "am I about to hit that
 * ridge" and a two-metre step is what stops a narrow spur passing
 * between samples. Far out, the answer is "roughly where does this
 * glide end", a twenty-metre step is a fifth of a pixel at that
 * distance, and paying near-field precision for it would be a hundred
 * heightfield lookups a frame spent on nothing.
 */
export const NEAR_RANGE = 20_000;
export const NEAR_STEP = 200;
export const FAR_STEP = 2_000;

/**
 * Bisections once a step brackets the ground.
 *
 * The march finds WHICH segment the crossing is in; this finds where in
 * it. Twelve halvings take the far step's twenty metres down to five
 * millimetres, which is finer than her body and far finer than the
 * heightfield's own sample spacing — so the limit on the answer is the
 * terrain data, as it should be, not the search.
 */
export const REFINE = 12;

/**
 * When a touchdown stops being information and starts being a warning,
 * in seconds.
 *
 * At a cruise over the ground of five and a half metres a second, three
 * seconds is about sixteen metres of warning. Short for an aircraft and
 * generous for an ant: she turns in her own length and climbs out of it
 * in one wingbeat, so the useful alarm is "now", not "eventually".
 */
export const SOON = 3;

/** How far ahead the short prediction looks, in seconds. */
export const LOOK_AHEAD = 2;

/**
 * How close counts as hitting it, in world units.
 *
 * Her body is a few millimetres; this is roughly her own depth, so the
 * marker lands where she would actually touch rather than where her
 * centre line would pass through the soil.
 */
export const CLEARANCE = 4;

/** Track cannot be read off a velocity smaller than this. */
const STILL = 0.5;

/**
 * The vector sum, and the only place it is written down.
 *
 * @param airspeed her speed through the air, world units per second
 * @param heading her nose, in radians
 * @param wind what the air is doing, world units per second
 */
export function groundVelocity(
  airspeed: number, heading: number, wind: Drift | null,
): Drift {
  // A heading travels along (sin, cos) in this world — the same
  // convention her body and the camera use.
  return {
    x: Math.sin(heading) * airspeed + (wind?.x ?? 0),
    z: Math.cos(heading) * airspeed + (wind?.z ?? 0),
  };
}

/**
 * Which way the ground is going past, in compass degrees.
 *
 * HELD, NOT GUESSED, when she is barely moving. A queen hovering into a
 * headwind that exactly cancels her has no track at all — the vector is
 * zero and its direction is undefined — and `atan2(0, 0)` is a
 * perfectly good zero that would read as due north and swing wildly the
 * moment a gust nudged her. Below the threshold the last real track
 * stands, which is both honest and steady.
 */
export function trackOf(ground: Drift, held: number): number {
  if (Math.hypot(ground.x, ground.z) < STILL) return held;
  return bearingOf(ground.x, ground.z);
}

/** Track minus heading, the short way round. */
export function driftOf(track: number, headingRadians: number): number {
  return wrap180(track - bearingFromHeading(headingRadians));
}

/** Where she is carried to in `after` seconds, and what is underneath. */
export function predict(
  from: { wx: number; wz: number; altitude: number },
  ground: Drift,
  climbing: number,
  after: number,
  terrainAt: (wx: number, wz: number) => number,
): Predicted {
  const wx = from.wx + ground.x * after;
  const wz = from.wz + ground.z * after;
  const altitude = from.altitude + climbing * after;
  const terrain = terrainAt(wx, wz);
  return {
    wx, wz, altitude, terrain,
    agl: altitude - terrain,
    after,
    range: Math.hypot(ground.x, ground.z) * after,
  };
}

/**
 * WHERE SHE MEETS THE GROUND, if she carries on exactly like this.
 *
 * The touchdown zone, and the marker Joshua asked to be drawn on the
 * island. Over flat ground it reduces to precisely the arithmetic in
 * his worked example — height to lose, divided by sink rate, times
 * ground speed — and `tests/telemetry.test.ts` runs that example, in
 * his own numbers, as a test.
 *
 * BUT IT IS NOT THAT FORMULA, because Kauaʻi is not flat, and the
 * closed form gets the interesting cases wrong in both directions. It
 * puts a descent over the Nāpali coast a kilometre out to sea when the
 * cliff is four hundred metres away, and it reports no touchdown at all
 * for a queen holding a dead-level cruise straight at Waiʻaleʻale —
 * which is the exact case where she most needs to be told. So the path
 * is walked and the terrain asked at every step.
 *
 * WALKED IN DISTANCE, NOT IN TIME. The whole thing is then a
 * one-dimensional root find along her ground track:
 *
 *   agl(s) = altitude + (climb / speed)·s − terrain(track at s)
 *
 * which is worth writing out because it says why level flight is not a
 * special case needing a special rule. Level means the middle term is
 * zero; the function still crosses wherever the land rises to meet
 * her, and the search does not know or care that anything is unusual.
 * The only genuinely level answer is over open water, where the ground
 * never comes up — and then there is no touchdown, honestly, and the
 * flight-path vector sitting on the horizon says exactly that.
 *
 * Returns null when the ground does not come up within the horizon,
 * which is most of a cruise, and is not a failure.
 */
export function touchdown(
  from: { wx: number; wz: number; altitude: number },
  ground: Drift,
  climbing: number,
  terrainAt: (wx: number, wz: number) => number,
  horizon = TOUCHDOWN_RANGE,
): Predicted | null {
  const speed = Math.hypot(ground.x, ground.z);

  // HOVERING, OR NEARLY. There is no track to walk, so the root find
  // has nothing to find along; she comes down where she already is.
  // Kept as its own branch rather than nudged with an epsilon, because
  // dividing a real sink rate by a near-zero speed is how a marker ends
  // up thirty kilometres away on the strength of a rounding error.
  if (speed < STILL) {
    if (climbing >= -1e-6) return null;
    const terrain = terrainAt(from.wx, from.wz);
    const fall = from.altitude - terrain - CLEARANCE;
    if (fall <= 0) return null;
    return {
      wx: from.wx,
      wz: from.wz,
      altitude: terrain + CLEARANCE,
      terrain,
      agl: CLEARANCE,
      after: fall / -climbing,
      range: 0,
    };
  }

  const ux = ground.x / speed;
  const uz = ground.z / speed;
  // Height lost per unit travelled over the ground — the glide slope,
  // and the only place her vertical rate enters at all.
  const slope = climbing / speed;

  /** How far above the ground she is, `s` units along the track. */
  const clearing = (s: number): number =>
    from.altitude + slope * s - terrainAt(from.wx + ux * s, from.wz + uz * s);

  // Already in the dirt: do not report a touchdown behind her.
  if (clearing(0) <= CLEARANCE) return null;

  let lo = 0;
  let hi = -1;
  const walk = (until: number, step: number, start: number): boolean => {
    for (let s = start; s <= until + 1e-9; s += step) {
      if (clearing(s) <= CLEARANCE) { hi = s; return true; }
      lo = s;
    }
    return false;
  };
  const near = Math.min(NEAR_RANGE, horizon);
  if (!walk(near, NEAR_STEP, NEAR_STEP) && !walk(horizon, FAR_STEP, near + FAR_STEP)) {
    return null;
  }

  // Bisect the bracketing segment. `lo` is known clear and `hi` known
  // blocked, so the invariant holds by construction at every halving.
  for (let i = 0; i < REFINE; i++) {
    const mid = (lo + hi) / 2;
    if (clearing(mid) <= CLEARANCE) hi = mid; else lo = mid;
  }

  const range = hi;
  const wx = from.wx + ux * range;
  const wz = from.wz + uz * range;
  const terrain = terrainAt(wx, wz);
  return {
    wx, wz,
    altitude: from.altitude + slope * range,
    terrain,
    agl: from.altitude + slope * range - terrain,
    after: range / speed,
    range,
  };
}

/**
 * A number that catches up rather than jumping.
 *
 * Terrain sampled along a moving path is genuinely spiky — a metre
 * sideways can be a different hillside — and a readout that reports
 * every one of those honestly is unreadable. This eases toward the
 * truth with a time constant, so the display settles in about two
 * seconds without ever lagging the physics, which is never smoothed.
 *
 * Frame-rate independent by construction: the fraction taken depends on
 * how much time passed, not on how many frames did.
 */
export class Eased {
  private value: number | null = null;

  constructor(private readonly tau = 0.67) {}

  /** @param dt seconds since the last reading */
  push(sample: number, dt: number): number {
    if (this.value === null || !Number.isFinite(this.value)) {
      this.value = sample;
      return sample;
    }
    const alpha = 1 - Math.exp(-Math.max(0, dt) / this.tau);
    this.value += (sample - this.value) * alpha;
    return this.value;
  }

  /** Jump straight there — a respawn, or a first reading after a gap. */
  set(to: number): void {
    this.value = to;
  }

  get shown(): number {
    return this.value ?? 0;
  }
}
