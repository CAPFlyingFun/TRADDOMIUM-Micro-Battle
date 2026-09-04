/**
 * The bot's routes: a circle and a figure-eight, each with pauses.
 *
 * Built from the capsule's own tuning, because a full circle is a
 * matter of TIME — at a steady `turn` the heading sweeps 2π in
 * 2π / (turn × turnRate) seconds — and a route that did not know the
 * turn rate would close on one tuning and spiral on another. Speed does
 * not enter: sprinting draws the same circle larger.
 *
 * The figure-eight is two circles turned opposite ways, so the bot
 * crosses its own track through the start point every loop: a
 * replication bug that drifts the replica off the true path shows up
 * as the two lobes failing to meet. Pauses between lobes give a watcher
 * a moment where "standing still" is the truth, which is the easiest
 * state to compare between two screens.
 */
import type { CapsuleTuning } from './CapsuleTuning';
import { pauseLeg, type Leg } from './ScriptedMover';

export interface RouteOptions {
  /** Steady turn request, 0 < turn ≤ 1. Smaller draws a wider circle. GAME TUNING (debug): a half turn. */
  readonly turn?: number;
  /** Standing still between lobes, seconds. 0 leaves the pauses out. GAME TUNING (debug): 1.5 s. */
  readonly pauseSeconds?: number;
  readonly sprint?: boolean;
}

const DEFAULT_TURN = 0.5;
const DEFAULT_PAUSE_SECONDS = 1.5;

interface Resolved {
  readonly turn: number;
  readonly pauseSeconds: number;
  readonly sprint: boolean;
  /** Seconds for the heading to sweep one full circle at `turn`. */
  readonly circleSeconds: number;
}

function resolve(tuning: CapsuleTuning, options: RouteOptions): Resolved {
  const turn = options.turn ?? DEFAULT_TURN;
  const pauseSeconds = options.pauseSeconds ?? DEFAULT_PAUSE_SECONDS;
  if (!(turn > 0 && turn <= 1)) throw new Error(`routes: turn must be in (0, 1], got ${turn}`);
  if (!(Number.isFinite(pauseSeconds) && pauseSeconds >= 0)) throw new Error(`routes: pauseSeconds must be ≥ 0, got ${pauseSeconds}`);
  if (!(tuning.turnRate > 0)) throw new Error(`routes: a circle needs a positive turnRate, got ${tuning.turnRate}`);
  return { turn, pauseSeconds, sprint: options.sprint === true, circleSeconds: (2 * Math.PI) / (turn * tuning.turnRate) };
}

function lobe(r: Resolved, sign: 1 | -1): Leg {
  return { seconds: r.circleSeconds, intent: { forward: 1, strafe: 0, turn: sign * r.turn, sprint: r.sprint } };
}

function withPause(r: Resolved, legs: Leg[]): Leg[] {
  if (r.pauseSeconds > 0) legs.push(pauseLeg(r.pauseSeconds));
  return legs;
}

/** One clockwise circle (seen from above), then a pause. */
export function circleRoute(tuning: CapsuleTuning, options: RouteOptions = {}): Leg[] {
  const r = resolve(tuning, options);
  return withPause(r, [lobe(r, 1)]);
}

/** A clockwise lobe, a pause, an anticlockwise lobe, a pause: the track crosses itself at the start. */
export function figureEightRoute(tuning: CapsuleTuning, options: RouteOptions = {}): Leg[] {
  const r = resolve(tuning, options);
  return withPause(r, [...withPause(r, [lobe(r, 1)]), lobe(r, -1)]);
}
