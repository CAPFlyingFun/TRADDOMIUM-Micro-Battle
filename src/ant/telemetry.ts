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
  /** The short look-ahead. Always present. */
  readonly soon: Predicted;
  /** Where the ground gets in the way, if it does within the horizon. */
  readonly impact: Predicted | null;

  // ── FOR THE EYE ONLY ─────────────────────────────────────────────
  // Eased over about two seconds so the readouts settle instead of
  // flickering. Never used for physics, collision or the markers'
  // positions — those take the raw values above, because a smoothed
  // impact time is a late one.
  readonly shownAgl: number;
  readonly shownTarget: number;
  readonly shownImpact: number | null;
}

/** How far ahead the short prediction looks, in seconds. */
export const LOOK_AHEAD = 2;

/** How far the terrain search runs before giving up. */
export const MAX_LOOKAHEAD = 10;

/**
 * Seconds between terrain samples along the predicted path.
 *
 * A hundred samples at the far end of the horizon, which is a hundred
 * heightfield lookups a frame in the worst case — the lookup is four
 * array reads and a bilinear blend, so this is cheap even on a phone.
 * Coarser than this and a ridge can pass between two samples.
 */
export const STEP = 0.1;

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
 * WHERE THE GROUND GETS IN THE WAY — walked, not solved.
 *
 * There is a closed-form answer for a flat island and this is not it.
 * Kauaʻi has ridges and valleys and sea cliffs, and the useful warning
 * is exactly the one flat maths cannot give: she is level, losing
 * nothing, and the land ahead is coming up to meet her. So the path is
 * stepped forward and the terrain asked at every step.
 *
 * Returns null when nothing is in the way inside the horizon — which is
 * most of the time, and is not a failure.
 */
export function terrainIntercept(
  from: { wx: number; wz: number; altitude: number },
  ground: Drift,
  climbing: number,
  terrainAt: (wx: number, wz: number) => number,
  horizon = MAX_LOOKAHEAD,
  step = STEP,
): Predicted | null {
  // Standing still and not sinking, she never arrives anywhere.
  if (Math.hypot(ground.x, ground.z) < 1e-6 && climbing >= 0) return null;
  for (let after = step; after <= horizon + 1e-9; after += step) {
    const at = predict(from, ground, climbing, after, terrainAt);
    if (at.agl <= CLEARANCE) return at;
  }
  return null;
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
