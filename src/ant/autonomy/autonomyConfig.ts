/**
 * THE NUMBERS THE BRAIN READS, and none of the rules.
 *
 * Beyond Extinction's DinoConfig / DinoAI split, kept: a species entry
 * there is a pure dictionary merged over DEFAULTS, and the AI holds no
 * per-species data at all. Same shape here — `missionBrain.ts` is pure
 * behaviour, and every threshold it consults arrives from this file.
 *
 * The reason is not tidiness. A tuning number buried inside a decision
 * cannot be changed without re-reading the decision, and a decision
 * that owns its numbers cannot be tested against anything but them.
 */

/** Every dial the mission brain turns. */
export interface AutonomyConfig {
  /** Seconds between decision passes. Five a second. */
  readonly thinkEvery: number;
  /**
   * Seconds between the expensive passes — trip estimates, route
   * viability, choosing a water target. Once a second.
   */
  readonly planEvery: number;
  /**
   * HOW MUCH THIRST SHE KEEPS IN HAND, seconds.
   *
   * The rule is "will I still be wet when I arrive", and arriving at
   * exactly zero is not arriving wet: the estimate is a straight line
   * over a real island, she may have to circle, land, walk the last
   * stretch and find the channel dry. Ninety seconds is the margin,
   * and it is game tuning rather than anything measured.
   */
  readonly hydrationReserve: number;
  /**
   * SHE DOES NOT STOP FOR WATER UNTIL SHE IS THIS CLOSE TO DRY,
   * seconds. Fifteen minutes, and it is Joshua's number.
   *
   * The rule above — "will I still be wet when I arrive" — is right and
   * on its own it is unliveable. A cross-island trip is ninety minutes
   * and she carries about fifty-five, so the answer is NO from the
   * moment she sets off and stays NO however much she drinks: she
   * tops up to full, resumes, notices the trip is still too long,
   * detours to the water she is standing beside, and does it again.
   * Joshua watched her do exactly that, "alternating between water,
   * path, water, path" at 81% and 45 minutes in hand — "annoying every
   * 3 minutes from 55m to 52m (Water break)".
   *
   * `drinkTo` already stopped the INSTANT loop; it just set the period
   * to however long she takes to fall from full to 95%, which is about
   * a minute and a half.
   *
   * So the trip test is now a sufficiency test behind a necessity one:
   * a queen with three quarters of a tank has no business looking for
   * a stream, whatever the arithmetic says about a journey she has
   * barely started. What the arithmetic was really detecting is a trip
   * longer than her endurance, and that is a ROUTE problem — staged
   * stops — rather than a thirst one.
   */
  readonly thirstFloor: number;
  /**
   * She drinks up to this fraction before she will leave the water.
   *
   * Not 1.0 on purpose. A committed action has to END, and a target of
   * exactly full is a target the last drops approach asymptotically —
   * `Thirst` fills over FILL_SECONDS toward 1, so demanding 1 is
   * demanding the limit. Ninety-five per cent is a drink.
   */
  readonly drinkTo: number;
  /**
   * How close counts as arrived at a strategic water candidate.
   *
   * A watercourse node is known to 54.7 m, so anything tighter than
   * that is pretending to a precision the drainage does not have.
   */
  readonly waterArriveWithin: number;
  /**
   * Speed the PROVISIONAL estimator assumes she makes good, units/s.
   *
   * Her cruise airspeed, from the flight model. It is an airspeed being
   * used as a groundspeed, which is exactly the lie the estimator seam
   * exists to let Phase 2 stop telling — see mission.ts.
   */
  readonly assumedSpeed: number;
}

export const AUTONOMY_DEFAULTS: AutonomyConfig = {
  thinkEvery: 0.2,
  planEvery: 1,
  hydrationReserve: 90,
  thirstFloor: 15 * 60,
  drinkTo: 0.95,
  waterArriveWithin: 5_500,
  // CRUISE_SPEED. Imported as a literal rather than from flight.ts so a
  // config file cannot drag the flight model into a unit test that only
  // wants to reason about thirst.
  assumedSpeed: 40,
};

/** Defaults with any dial overridden — the DinoConfig.get_config shape. */
export function autonomyConfig(over: Partial<AutonomyConfig> = {}): AutonomyConfig {
  return { ...AUTONOMY_DEFAULTS, ...over };
}
