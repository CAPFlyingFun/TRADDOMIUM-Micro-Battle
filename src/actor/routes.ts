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

/**
 * THE PRACTICE PATROL: the route a bot walks so a person alone in a room
 * has something to watch, and can see every control it is pressing.
 *
 * Two properties matter more than the shape:
 *
 * IT CLOSES. Every turn is a quarter and there are four of them; every
 * leg forward is answered by one back, every strafe by its mirror. A
 * loop ends where it started, facing the way it started, so the bot
 * patrols a box beside the player instead of walking into the fog. An
 * open route would be gone in a minute and the feature would be a bot
 * you have to chase.
 *
 * IT PRESSES EVERY BUTTON. Ahead, back, strafe both ways, turn both
 * ways, and one sprint — because the on-screen control diagram is the
 * point (`perf/BotHud.ts`), and a diagram whose cells never light is
 * not evidence of anything. A watcher sees each cell light at least
 * once a loop.
 *
 * WHY HALF PACE ON THE LONG LEGS. `intent.forward` is a request, not a
 * speed (`input/Intent.ts`: pace is a CEILING), so half ahead is half
 * the walk. At full pace a five-second leg is three metres of world —
 * far enough that the box would swallow the grid the player is standing
 * on. Half pace keeps a five-second leg at about a metre and a half,
 * which is the same order as the spacing the authority spawns players
 * at (`net/Host.ts`, SPAWN_SPACING), so the bot stays the size it
 * should be on screen. The seconds are Joshua's (2026-09-04: "forward
 * for 5s, left or right, every 10s, backwards, 10s"); only the pace is
 * ours.
 *
 * The sprint leg is deliberately short and answered immediately: it is
 * there to light the SPRINT cell and to prove the authority's travel
 * budget pays for a capsule at top speed, not to cover ground.
 */
export interface PatrolOptions extends RouteOptions {
  /** Seconds per long leg. GAME TUNING (debug): 5 s, Joshua's number. */
  readonly legSeconds?: number;
  /** How hard the long legs push, 0 < pace ≤ 1. GAME TUNING (debug): half pace — see above. */
  readonly pace?: number;
}

const DEFAULT_LEG_SECONDS = 5;
const DEFAULT_PACE = 0.5;
/** Seconds of sideways walking, each way. Shorter than a leg: it is a demonstration, not a journey. */
const STRAFE_SECONDS = 4;
/** Seconds of sprint, each way. Short on purpose — see above. */
const SPRINT_SECONDS = 2;

export function patrolRoute(tuning: CapsuleTuning, options: PatrolOptions = {}): Leg[] {
  const r = resolve(tuning, options);
  const legSeconds = options.legSeconds ?? DEFAULT_LEG_SECONDS;
  const pace = options.pace ?? DEFAULT_PACE;
  if (!(Number.isFinite(legSeconds) && legSeconds > 0)) {
    throw new Error(`routes: legSeconds must be > 0, got ${legSeconds}`);
  }
  if (!(pace > 0 && pace <= 1)) throw new Error(`routes: pace must be in (0, 1], got ${pace}`);

  /** Seconds for the heading to sweep a quarter circle at `turn`. A corner is a matter of time, not of distance. */
  const quarter = r.circleSeconds / 4;
  const walk = (seconds: number, forward: number): Leg => ({
    seconds,
    intent: { forward: forward * pace, strafe: 0, turn: 0, sprint: false },
  });
  const sidestep = (seconds: number, strafe: number): Leg => ({
    seconds,
    intent: { forward: 0, strafe: strafe * pace, turn: 0, sprint: false },
  });
  const corner = (sign: 1 | -1): Leg => ({
    seconds: quarter,
    intent: { forward: 0, strafe: 0, turn: sign * r.turn, sprint: false },
  });
  const dash = (forward: 1 | -1): Leg => ({ seconds: SPRINT_SECONDS, intent: { forward, strafe: 0, turn: 0, sprint: true } });

  const legs: Leg[] = [];
  // A square: four sides, four right-hand corners. Four quarters is one
  // full turn, so the heading comes home as well as the position.
  for (let side = 0; side < 4; side += 1) {
    legs.push(walk(legSeconds, 1));
    withPause(r, legs);
    legs.push(corner(1));
  }
  // Back the way it came, and forward again: the BACK cell, cancelled.
  legs.push(walk(legSeconds, -1), walk(legSeconds, 1));
  withPause(r, legs);
  // Sideways both ways: the two strafe cells, cancelled.
  legs.push(sidestep(STRAFE_SECONDS, 1), sidestep(STRAFE_SECONDS, -1));
  withPause(r, legs);
  // A left corner and a right one: the four sides only ever turned right,
  // so without this pair the TURN LEFT cell would never light. They cancel,
  // which is why they can be added to a route that has to close.
  legs.push(corner(-1), corner(1));
  withPause(r, legs);
  // One sprint out and back: the SPRINT cell, cancelled.
  legs.push(dash(1), dash(-1));
  return withPause(r, legs);
}
