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
   * HOW MUCH THIRST SHE KEEPS IN HAND AT THE WATER, seconds.
   *
   * The margin on the REACHABILITY test — a candidate is only worth
   * flying to if `waterETA + this < timeUntilDry`. Arriving at exactly
   * zero is not arriving wet: the estimate is a straight line over a
   * real island, she may have to circle, land, walk the last stretch
   * and find the channel dry. Ninety seconds, and it is game tuning
   * rather than anything measured.
   *
   * IT USED TO GUARD THE WHOLE MISSION and that is what broke: the
   * trigger was `missionETA + this > timeUntilDry`, which asks whether
   * the DESTINATION is reachable on the water she has. On an island
   * whose crossing is longer than her tank the answer was permanently
   * no, so she stopped for water at every level and however recently
   * she had drunk. Endurance against the mission is a ROUTE question
   * — staged stops, which she now makes naturally — and this number
   * belongs to the much smaller question it can actually answer: can
   * she reach THAT PUDDLE before she runs out.
   */
  readonly hydrationReserve: number;
  /**
   * SHE DOES NOT STOP FOR WATER UNTIL SHE IS THIS CLOSE TO DRY,
   * seconds. Fifteen minutes, Joshua's number, and now the ONLY thing
   * that starts a water errand.
   *
   * IT USED TO BE HALF A RULE. The other half was "will I still be wet
   * when I arrive", and that half is gone: `missionETA` no longer
   * appears in the trigger at all. It could not, because on an island
   * whose crossing is longer than a tank the answer is permanently no
   * — she topped up to full, resumed, noticed the trip was still too
   * long, detoured to the water she was standing beside, and did it
   * again. Joshua watched exactly that at 81% and 45 minutes in hand:
   * "alternating between water, path, water, path... annoying every 3
   * minutes from 55m to 52m (Water break)".
   *
   * So the rule is now one clause and reads as a sentence: BELOW
   * FIFTEEN MINUTES OF WATER, GO AND DRINK. Above it she flies,
   * whatever the arithmetic says about a journey she has barely
   * started; below it she stops, however short the hop in front of her
   * is — fourteen minutes of water is a problem she should not be
   * carrying into anything.
   *
   * A trip longer than her endurance is served by REPEATING this: she
   * flies, falls to fifteen minutes, drinks to full, flies again. That
   * is what staged stops are, and they need no plan.
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
