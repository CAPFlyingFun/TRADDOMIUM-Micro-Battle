/**
 * WHEN RAIN MAY REACH THE LENS — the one number the lens layer spawns
 * from, and the reason it is not simply "is it raining".
 *
 * Joshua, 2026-09-07: rain on the camera should be SPARSE and
 * atmospheric, never a windshield in need of wipers, and it should
 * happen for a reason the player can feel — the camera tipped up into
 * the rain, or the wind driving the rain into her face — rather than
 * whenever `rainMmHr` is above zero. So the streaks (`RainView`) fall
 * on every frame of a shower, and THIS decides how much of that shower
 * is landing on the glass.
 *
 * THE PHYSICS IT STANDS ON. A lens is a small plane facing the camera's
 * forward direction f̂. Rain arrives with a velocity v — the boundary-
 * layer drift on the ground plane and the terminal fall speed downward
 * — and the rain that hits the front of that plane per second is
 * proportional to max(0, −v · f̂). With f̂ = (cos p · ĥ, sin p) for a
 * pitch p over a horizontal forward ĥ, and v = (d, −FALL):
 *
 *   flux ∝ FALL · sin p  −  (d · ĥ) · cos p
 *
 * The first term is the camera looking UP into the rain; the second is
 * the wind blowing the rain TOWARD the eye, which is a drift that runs
 * against the forward direction — hence the minus. A crosswind
 * contributes nothing and a tailwind is rain moving away, which is why
 * "wind is blowing" and "rain reaches the lens" are different facts.
 *
 * THE SHAPE THE BRIEF ASKED FOR, on top of that. The pitch term is an
 * eased ramp rather than a sine, `PITCH_BEGIN_DEG` to `PITCH_FULL_DEG`:
 * zero at level and below, beginning gently at five degrees with no
 * pop at the threshold (smoothstep's slope is zero there), full at
 * thirty-five. The wind term is the drift toward the eye over
 * `WIND_FULL`, clamped, weighted by `WIND_WEIGHT` so the wind alone
 * fills the lens a little less readily than the sky does. The two add,
 * clamp to one, and are scaled by the rain's eased `strength` — the
 * same 0..1 the streaks draw at — so a shower that has not arrived yet
 * cannot land on the glass before it lands on the ground.
 *
 * WHY `WIND_FULL` IS WHAT IT IS. The brief offered `RainView`'s
 * `DRIFT_MAX` as the normaliser, or a constant of this file's own "if
 * that is the honest unit". `DRIFT_MAX` is the cap that stops a
 * hurricane laying the rain flat — 975 units a second — and against it
 * a trade wind's drift (a 20 km/h reading is 555 on the plane, 277 in
 * the boundary layer) would count as a quarter, making the wind branch
 * all but dormant on the island it is for. The honest unit is the one
 * that puts the two terms on the same scale: the drift toward the eye
 * whose flux on a LEVEL lens equals vertical rain's flux on a lens
 * pitched to `PITCH_FULL_DEG`. That is FALL · sin(35°) ≈ 373 units a
 * second, and it is derived, not chosen. The drift itself is the
 * streaks' own — `BOUNDARY_LAYER` of the wind, never past `DRIFT_MAX`
 * — so the lens and the streaks tell one story about the same wind.
 *
 * THE POSE IT READS. `pitch` and `yaw` are `FreeFlyCamera.pose()`'s, in
 * RADIANS: pitch UP POSITIVE (`place()` and `CameraReadout.pitch` both
 * say so), and the camera's horizontal forward is (−sin yaw, −cos yaw)
 * in (x, z) — `headingOfYaw`'s docblock spells out why, and this file
 * takes that formula rather than re-deriving it. `windX`/`windZ` are
 * `WeatherNow`'s, units a second on the ground plane, +z south.
 *
 * Pure, and it constructs nothing: a pose's two angles and the weather's
 * two wind components in, three numbers out. No world coordinate is
 * read — a lens has no position, only a direction. NaN or infinite
 * inputs read as zero, so a bad frame produces a dry lens and not a
 * NaN in an instance matrix.
 */
import { BOUNDARY_LAYER, DRIFT_MAX, FALL } from './RainView';

const DEG = Math.PI / 180;

/** Below this pitch (degrees, up positive) the sky puts nothing on the lens. GAME TUNING. */
export const PITCH_BEGIN_DEG = 5;
/** At this pitch the sky's share of the exposure is full. GAME TUNING. */
export const PITCH_FULL_DEG = 35;
/**
 * The wind's share of the exposure, against the sky's one. GAME TUNING:
 * a head wind fills the lens a little less readily than looking up does,
 * because looking up is the deliberate act and the wind is the ambush.
 */
export const WIND_WEIGHT = 0.8;
/**
 * The drift toward the eye, in units a second, that counts as full wind
 * exposure: the drift whose flux on a level lens equals vertical rain's
 * on a lens pitched to `PITCH_FULL_DEG`. Derived (see the docblock), not
 * a tuning number.
 */
export const WIND_FULL = FALL * Math.sin(PITCH_FULL_DEG * DEG);

export interface LensExposureInput {
  /** The camera's pitch, radians, UP POSITIVE — `FreeFlyCamera.pose().pitch`. */
  readonly pitch: number;
  /** The camera's yaw, radians about +Y — `FreeFlyCamera.pose().yaw`. */
  readonly yaw: number;
  /** `WeatherNow.windX`, units a second on the ground plane. */
  readonly windX: number;
  /** `WeatherNow.windZ`, units a second on the ground plane; +z is south. */
  readonly windZ: number;
  /** The rain's eased strength, 0..1 — `RainView.strength`. */
  readonly strength: number;
}

export interface LensExposure {
  /** How much of the rain is reaching the glass, 0..1. What the lens spawns from. */
  readonly exposure: number;
  /** The sky's share before the wind and the rain are counted: the pitch ramp, 0..1. */
  readonly upward: number;
  /** The wind's share before weighting: drift toward the eye over `WIND_FULL`, 0..1. */
  readonly intoLens: number;
}

/** A non-finite reading is no reading. */
function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** The eased ramp: zero slope at both ends, so neither threshold pops. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * How much of the rain is landing on the lens.
 *
 *   upward   = smoothstep(PITCH_BEGIN_DEG, PITCH_FULL_DEG, pitch in degrees)
 *   intoLens = clamp(−(drift · forward) / WIND_FULL, 0, 1)
 *              drift   = wind × BOUNDARY_LAYER, its length held to DRIFT_MAX
 *              forward = (−sin yaw, −cos yaw) on the ground plane
 *   exposure = clamp(upward + intoLens × WIND_WEIGHT, 0, 1) × clamp(strength, 0, 1)
 */
export function lensExposure(input: LensExposureInput): LensExposure {
  const pitch = finite(input.pitch);
  const yaw = finite(input.yaw);
  const strength = clamp01(finite(input.strength));

  const upward = smoothstep(PITCH_BEGIN_DEG, PITCH_FULL_DEG, pitch / DEG);

  // The streaks' drift, by the streaks' rule, so both read the same wind.
  let driftX = finite(input.windX) * BOUNDARY_LAYER;
  let driftZ = finite(input.windZ) * BOUNDARY_LAYER;
  const drift = Math.hypot(driftX, driftZ);
  if (drift > DRIFT_MAX) {
    driftX *= DRIFT_MAX / drift;
    driftZ *= DRIFT_MAX / drift;
  }
  // The camera looks along (−sin yaw, −cos yaw); rain reaches the glass
  // when its drift runs the other way, toward the eye.
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const toward = -(driftX * forwardX + driftZ * forwardZ);
  const intoLens = clamp01(toward / WIND_FULL);

  const exposure = clamp01(upward + intoLens * WIND_WEIGHT) * strength;
  return { exposure, upward, intoLens };
}
