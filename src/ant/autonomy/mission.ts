/**
 * WHAT SHE IS TRYING TO DO, and how far away it is.
 *
 * This is the vocabulary layer of Stage H — the data the brain reasons
 * over, with no decisions in it. `missionBrain.ts` is the behaviour and
 * `autonomyConfig.ts` is the tuning, the same three-way split Beyond
 * Extinction's DinoAI / DinoConfig uses and for the same reason: a
 * number you want to change should never live inside a rule you do not.
 *
 * THREE LAYERS, AND THEY ANSWER DIFFERENT QUESTIONS. This one is the
 * top:
 *
 *   MISSION / GOAL   why she is going          (here, and missionBrain)
 *   MOTION           how her body is moving    (ant/motion.ts)
 *   ACT              what she is doing with it (ant/motion.ts)
 *
 * A goal of SEEK_WATER can be flown, waded or swum, and can carry the
 * act of drinking at the end of it. None of those three replaces
 * another, and nothing here may reach down and set a Motion: motion is
 * DERIVED from the world every frame and having a brain able to assert
 * it would put the two back into the disagreement Stage G removed.
 */
import type { WorldPoint } from '../../world/coords';

/**
 * What a destination is good for.
 *
 * A mission ADVERTISES what it satisfies so the brain can tell whether
 * a survival detour is redundant. Flying to a river already solves
 * thirst; interrupting that flight to look for water would be the
 * autonomy arguing with itself.
 *
 * `rest` is named for Phase 2 and nothing produces it yet.
 */
export type Need = 'hydration' | 'rest';

/** Somewhere she is going, and why. */
export interface Mission {
  /** Stable identity, so a re-plan can tell "same target" from "new". */
  readonly id: string;
  /** Short, for the debug line and any future HUD. */
  readonly label: string;
  /** WORLD coordinates. Anything that outlives a frame is world. */
  readonly at: WorldPoint;
  /** What arriving here solves. Empty is legitimate — a plain waypoint. */
  readonly satisfies: readonly Need[];
  /** Close enough to count as arrived, world units. */
  readonly arriveWithin: number;
}

/** Whether this mission already answers a need, so a detour would be silly. */
export function satisfies(mission: Mission | null, need: Need): boolean {
  return mission !== null && mission.satisfies.includes(need);
}

/**
 * WHAT A TRIP COSTS — and this interface is the whole point of the file.
 *
 * The hydration decision is "will I still be wet enough when I get
 * there", which needs an arrival time. The obvious way to get one is
 * `distance / cruise`, and the obvious way is wrong: a queen flying
 * into a 20-knot trade wind at 0.4 m/s of airspeed has a groundspeed
 * near zero, and a straight line takes no account of a ridge in the
 * way, the climb to clear it, or the stamina that climb costs.
 *
 * So the brain does NOT own the arithmetic. It asks for a TripEstimate
 * and reasons about the answer. Phase 1 ships the naive estimator
 * below; Phase 2 or 3 can replace it with a wind- and terrain-aware
 * route planner WITHOUT touching a single thirst rule — and a test
 * holds that seam by driving the brain from a stub estimator.
 *
 * The optional fields are the shape the real one will fill in. They are
 * declared now so adding them later is not an interface change that
 * ripples through every caller.
 */
export interface TripEstimate {
  /** How long the journey takes, seconds. Infinity when unreachable. */
  readonly etaSeconds: number;
  /** How far, world units — straight line today, path length later. */
  readonly distance: number;
  /** Fraction of the ONE stamina reserve the trip would spend. */
  readonly staminaCost?: number;
  /** Whether the route is flyable at all. Undefined means "not judged". */
  readonly viable?: boolean;
}

/** Anything that can price a journey. The brain holds one of these. */
export type TripEstimator = (from: WorldPoint, to: WorldPoint) => TripEstimate;

/**
 * PROVISIONAL — straight line at a fixed speed. Phase 1 only.
 *
 * Deliberately the dumbest thing that answers the question, so that the
 * hydration logic can be built and tested against a known number and
 * the real planner has an obvious seam to arrive at. It knows nothing
 * about wind, terrain, climb, stamina or obstacles, and it says so
 * rather than quietly under-reporting: `staminaCost` and `viable` are
 * left UNDEFINED, which reads as "not judged" instead of "free" and
 * "fine".
 *
 * @param speed world units a second she is assumed to make good.
 */
export function straightLineTrip(speed: number): TripEstimator {
  return (from, to) => {
    const distance = Math.hypot(to.wx - from.wx, to.wz - from.wz);
    return {
      distance,
      etaSeconds: speed > 0 ? distance / speed : Number.POSITIVE_INFINITY,
    };
  };
}

/**
 * HOW LONG UNTIL SHE IS DRY, seconds — the other half of the decision.
 *
 * Infinity when nothing is draining her, which is the honest answer and
 * keeps a divide-by-zero out of every caller. Zero when she is already
 * empty.
 */
export function timeUntilDry(fraction: number, drainPerSecond: number): number {
  if (!(drainPerSecond > 0)) return Number.POSITIVE_INFINITY;
  return Math.max(0, fraction) / drainPerSecond;
}
