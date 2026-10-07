/**
 * A BADGE ON A LANYARD, AS A PENDULUM — the numbers half of the hanging
 * card, and nothing else.
 *
 * Joshua, 2026-10-07: "I separated the badges from the body, so the badge
 * could be like a soft body or something to hang and move more freely."
 * The card used to be part of each scan's skin and moved exactly as
 * rigidly as the chest it was welded to. Now it is its own model
 * (`public/models/badge.glb`) hung from a PIVOT — the clip's ring, where
 * the two straps meet — and this file says how it swings.
 *
 * ─── the frame everything here is in ────────────────────────────────
 *
 * THE CHEST FRAME: x is the wearer's left-right, y is up the torso, z is
 * out of the chest. It is the body's bind frame carried by the chest bone,
 * so when the torso bends, the frame bends with it and gravity — which
 * stays world-down — arrives here as a direction that has moved. Both
 * inputs, gravity and the pivot's acceleration, are given IN THIS FRAME by
 * the caller (`view/HumanBadge.ts`), which is the one place that knows
 * where the chest is.
 *
 * Two angles, both zero when the card hangs straight down the frame's -y:
 *
 *   pitch   about x. POSITIVE swings the card's bottom edge OUT (+z), away
 *           from the chest. The card's hanging direction is
 *           (0, -cos pitch, sin pitch).
 *   roll    about z. POSITIVE swings the bottom edge toward +x. The
 *           hanging direction is (sin roll, -cos roll, 0).
 *
 * The two are integrated as two planar pendulums sharing one gravity.
 * That is an approximation — a real two-axis pendulum couples them — and
 * an honest one at the angles a badge reaches: the coupling is second
 * order in the angles and a card limited to ±0.6 rad of roll never gets
 * far enough for it to read.
 *
 * ─── the pivot accelerates, so gravity is not the only pull ─────────
 *
 * In the pivot's own accelerating frame the card feels g − a: a chest that
 * lurches forward swings the card back toward it, a body that stops dead
 * throws it out. `stepBadge` takes `a` as given and subtracts it.
 *
 * The frame also TURNS. A card hangs in the world, not in the chest, so
 * when the chest rotates by some small angle the card's angle RELATIVE TO
 * THE CHEST changes by minus that angle before any force has acted. That
 * is `turnX` and `turnZ`: the frame's rotation over the step, small-angle,
 * in the chest frame. They are what makes a bow or a twist leave the card
 * behind for a moment instead of carrying it rigidly.
 *
 * ─── the chest is solid ─────────────────────────────────────────────
 *
 * `restPitch` is the pitch at which the card's back meets the wearer's
 * front — MEASURED per body by the view from the skin's own vertices
 * (Sarah's belly puts hers well forward of Jack's). The card may not
 * swing back past it: it stops there and keeps a little of its speed as a
 * bounce, which is what a card does against a shirt. `maxPitch` and
 * `maxRoll` are the lanyard's reach: a strap round a neck does not let the
 * card swing to horizontal.
 *
 * ─── why this is CORE ───────────────────────────────────────────────
 *
 * It imports nothing — no three, no DOM — so a test can drive it with
 * numbers and so a server could, one day, run the same tick. The view
 * reads the chest, calls `stepBadge`, and writes two angles to a group.
 */

/**
 * GAME TUNING. The look of the swing, chosen by eye against the brief
 * ("period ~0.6 s, settles in ~1.5 s"), not measured from a lanyard.
 */
export const BADGE_TUNING = Object.freeze({
  /**
   * The swing's natural period, seconds. 0.6 s is a short, light card: a
   * physical pendulum whose equivalent length is g·(T/2π)² ≈ 0.089 m,
   * which is the card's own ~0.11 m height with its mass nearer the
   * middle. A longer period reads as a heavy pendant.
   */
  periodS: 0.6,
  /**
   * The amplitude's decay rate, per second: an amplitude A falls as
   * A·e^(−rate·t). 2.6 /s brings a swing to 2% of itself in 1.5 s
   * (ln 50 / 1.5), the brief's "settles in ~1.5 s".
   */
  decayPerS: 2.6,
  /** The fraction of its speed a card keeps when it bounces off the chest or a limit. */
  bounce: 0.25,
  /**
   * A bounce slower than this, rad/s, is a card RESTING against the chest
   * or a limit, and is stopped rather than kept: otherwise gravity pressing
   * it into the shirt each substep would come back out as a buzz.
   */
  restingRate: 0.5,
  /** The largest step integrated in one go, seconds; longer steps are cut into these. */
  maxSubstepS: 1 / 120,
  /**
   * The longest frame that is integrated at all, seconds. A frame longer
   * than this — a tab coming back from the background, a debugger pause —
   * is integrated as this much, never as the real gap: the card's
   * position after a long stall is not a question worth thirty substeps.
   */
  maxDtS: 0.25,
  /** The largest pivot acceleration believed, m/s². Beyond it is a teleport, not a lurch. */
  maxAccel: 40,
  /** The largest frame turn believed in one step, radians. Beyond it is a snap. */
  maxTurn: 0.5,
});

/** Standard gravity, m/s². */
export const BADGE_GRAVITY = 9.81;

/** The card's state. Mutable: `stepBadge` writes it in place, a frame allocates nothing. */
export interface BadgeState {
  /** Radians about the chest's x. Positive is the bottom edge out, away from the chest. */
  pitch: number;
  /** Radians about the chest's z. Positive is the bottom edge toward +x. */
  roll: number;
  /** rad/s. */
  pitchRate: number;
  /** rad/s. */
  rollRate: number;
}

/** What a step needs. Every vector is in the CHEST frame (see the header). */
export interface BadgeInput {
  /**
   * World-down as a UNIT direction; this file scales it by `BADGE_GRAVITY`.
   * (0, −1, 0) when the chest is upright.
   */
  readonly gx: number;
  readonly gy: number;
  readonly gz: number;
  /** The pivot's linear acceleration, m/s². */
  readonly ax: number;
  readonly ay: number;
  readonly az: number;
  /**
   * The chest frame's rotation over this step about its own x and z,
   * radians, small-angle. Optional: zero when the caller does not track it.
   */
  readonly turnX?: number;
  readonly turnZ?: number;
  /** The pitch the card may not swing back past — where its back meets the wearer's front. */
  readonly restPitch: number;
  /** The furthest the card may swing out, radians. Must exceed `restPitch`. */
  readonly maxPitch: number;
  /** The furthest the card may swing sideways either way, radians. */
  readonly maxRoll: number;
}

/** A card hanging still, at the given pitch (the rest limit, usually). */
export function createBadge(pitch = 0): BadgeState {
  return { pitch, roll: 0, pitchRate: 0, rollRate: 0 };
}

/** The pendulum's equivalent length, metres, from the tuned period: L = g·(T/2π)². */
export function badgeLength(periodS: number = BADGE_TUNING.periodS): number {
  const w = (2 * Math.PI) / periodS;
  return BADGE_GRAVITY / (w * w);
}

const LENGTH = badgeLength();

function finite(value: number | undefined, fallback = 0): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function clampMag(x: number, limit: number): number {
  return x > limit ? limit : x < -limit ? -limit : x;
}

/**
 * One frame. `dt` is seconds of the caller's clock; it is clamped to
 * `maxDtS` and integrated in substeps no longer than `maxSubstepS`, so
 * the result is the same shape at 240 Hz as at 4 Hz and a long frame
 * cannot throw the card through the chest.
 *
 * Semi-implicit Euler (velocity first, then position from the NEW
 * velocity), with the damping applied as an exact exponential per
 * substep — `rate *= e^(−2·decay·h)` — so its strength does not depend on
 * how the frame was cut.
 *
 * Returns the same `state` it was given.
 */
export function stepBadge(state: BadgeState, dt: number, input: BadgeInput): BadgeState {
  if (!Number.isFinite(dt) || dt <= 0) return state;
  // A state poisoned by a NaN upstream is put back at rest rather than
  // carried: one bad frame must not leave a card spinning for ever.
  if (!Number.isFinite(state.pitch) || !Number.isFinite(state.roll)
    || !Number.isFinite(state.pitchRate) || !Number.isFinite(state.rollRate)) {
    state.pitch = finite(input.restPitch);
    state.roll = 0;
    state.pitchRate = 0;
    state.rollRate = 0;
  }

  const restPitch = finite(input.restPitch);
  const maxPitch = Math.max(restPitch, finite(input.maxPitch, restPitch));
  const maxRoll = Math.max(0, finite(input.maxRoll));
  const t = BADGE_TUNING;

  // g − a, the pull the card feels in the pivot's accelerating frame.
  const ax = clampMag(finite(input.ax), t.maxAccel);
  const ay = clampMag(finite(input.ay), t.maxAccel);
  const az = clampMag(finite(input.az), t.maxAccel);
  const ex = finite(input.gx) * BADGE_GRAVITY - ax;
  const ey = finite(input.gy, -1) * BADGE_GRAVITY - ay;
  const ez = finite(input.gz) * BADGE_GRAVITY - az;

  // The frame turned under the card: the card keeps its place in the
  // world, so its angle RELATIVE TO THE CHEST moves the other way. A chest
  // that bows (a turn about +x, its up tipping toward +z) finds the card
  // further out from it: +pitch. A turn about +z tips the chest's up
  // toward −x, and the card, still hanging world-down, now lies toward −x
  // of the chest's centre line: −roll.
  state.pitch += clampMag(finite(input.turnX), t.maxTurn);
  state.roll -= clampMag(finite(input.turnZ), t.maxTurn);

  const total = Math.min(dt, t.maxDtS);
  const steps = Math.max(1, Math.ceil(total / t.maxSubstepS - 1e-9));
  const h = total / steps;
  const keep = Math.exp(-2 * t.decayPerS * h);

  for (let i = 0; i < steps; i += 1) {
    // Tangential pull over L. For pitch the tangent is (0, sin p, cos p);
    // for roll it is (cos r, sin r, 0).
    const sp = Math.sin(state.pitch);
    const cp = Math.cos(state.pitch);
    const sr = Math.sin(state.roll);
    const cr = Math.cos(state.roll);
    state.pitchRate += ((ey * sp + ez * cp) / LENGTH) * h;
    state.rollRate += ((ey * sr + ex * cr) / LENGTH) * h;
    state.pitchRate *= keep;
    state.rollRate *= keep;
    state.pitch += state.pitchRate * h;
    state.roll += state.rollRate * h;
    limit(state, restPitch, maxPitch, maxRoll);
  }
  return state;
}

/** A rate reflected off a stop, or zero when what is left is a card at rest against it. */
function rebound(rate: number): number {
  const back = -rate * BADGE_TUNING.bounce;
  return Math.abs(back) < BADGE_TUNING.restingRate ? 0 : back;
}

function limit(state: BadgeState, restPitch: number, maxPitch: number, maxRoll: number): void {
  if (state.pitch < restPitch) {
    state.pitch = restPitch;
    if (state.pitchRate < 0) state.pitchRate = rebound(state.pitchRate);
  } else if (state.pitch > maxPitch) {
    state.pitch = maxPitch;
    if (state.pitchRate > 0) state.pitchRate = rebound(state.pitchRate);
  }
  if (state.roll > maxRoll) {
    state.roll = maxRoll;
    if (state.rollRate > 0) state.rollRate = rebound(state.rollRate);
  } else if (state.roll < -maxRoll) {
    state.roll = -maxRoll;
    if (state.rollRate < 0) state.rollRate = rebound(state.rollRate);
  }
}

/**
 * A badge as the renderer holds it: something that can say what the chest
 * is doing and can draw the card where the state says. `view/HumanBadge`
 * is one; `swingBadge` drives it.
 *
 * WHY THE STEP IS HERE AND NOT IN THE VIEW: `view/` reads actor state and
 * never runs it (ARCHITECTURE §3, `tests/viewBoundary.test.ts`). So the
 * view measures and draws, this file integrates, and the caller — the
 * scene that owns the body — calls the one line between them.
 */
export interface BadgeSensor {
  /** The pendulum. Owned by the sensor, stepped here. */
  readonly state: BadgeState;
  /** This frame's input, read off the chest; null when there is nothing to step (detached, a bad dt). */
  sense(dt: number): BadgeInput | null;
  /** Draw the card and its strap at `state`. */
  show(): void;
}

/**
 * One frame of a hung badge: sense, step, show. Takes null so a call site
 * whose badge never arrived needs no guard.
 */
export function swingBadge(badge: BadgeSensor | null, dt: number): void {
  if (badge === null) return;
  const input = badge.sense(dt);
  if (input !== null) stepBadge(badge.state, dt, input);
  badge.show();
}
