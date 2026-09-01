/**
 * THE QUEEN'S MISSION BRAIN — Stage H, Phase 1.
 *
 * Adapted from the architecture of Beyond Extinction's DinoAI, not its
 * code: a throttled think pass, explicit states, actions that are
 * COMMITTED rather than re-decided every tick, survival needs that
 * preempt the normal goal, and a remembered objective to go back to
 * afterwards. That brain's `_think()` opens by returning early while
 * eating, swimming or mid-bite — "a throttled re-decision must not yank
 * us out" — and that one line is the whole anti-thrash design. It is
 * reproduced here in `committed()`.
 *
 * WHAT THIS LAYER IS NOT. It does not move her. It decides WHERE and
 * WHY, and publishes an `Intent`; a Phase 2 executor turns that into a
 * FlightDemand, and the existing flight model turns THAT into physics.
 * Three responsibilities, three files, and the seam is deliberate:
 *
 *   MissionBrain   where do I need to go, and why?
 *   (Phase 2)      what demand gets me there?
 *   Flight         what physically happens?
 *
 * IT ALSO DOES NOT TOUCH MOTION OR ACT. Those are DERIVED from the
 * world every frame (ant/motion.ts) and a brain able to assert them
 * would put the physics and the state back into the disagreement Stage
 * G removed. The brain READS them and never writes.
 *
 * PHASE 1 LIMITATION, stated plainly because it is easy to mistake this
 * for more than it is: nothing here makes her travel. Fed a sense
 * stream she will decide correctly, remember her destination across a
 * survival detour, and resume it — which is what the tests prove — but
 * on the device she will sit still while doing so until the executor
 * exists.
 */
import type { WorldPoint } from '../../world/coords';
import type { Act, Motion } from '../motion';
import type { Medium, Tier } from '../gait';
import { AUTONOMY_DEFAULTS, type AutonomyConfig } from './autonomyConfig';
import {
  satisfies, timeUntilDry,
  type Mission, type TripEstimate, type TripEstimator,
} from './mission';

/**
 * WHY she is doing something. The top of the three layers.
 *
 * REACHABLE IN PHASE 1: off, navigate, seek_water, approach_water,
 * drink, wait_wings, replan, water_critical, mission_complete.
 *
 * NAMED BUT UNREACHABLE — the mechanics do not exist, and no fake
 * behaviour has been invented to light them up. They are here so the
 * shape is visible and Phase 2 slots in rather than bolting on, the
 * same call made for `digging` and `fighting` in ant/motion.ts:
 * avoid, seek_rest, rest, approach, land.
 */
/**
 * The states that are ALLOWED to be holding a water detour.
 *
 * `replan` is in it because `plan()` owns the way out of that one and
 * may hand the same errand back; the rest are the errand itself. Any
 * state not in here having a detour is a bug — see `update`.
 *
 * `water_critical` is deliberately NOT in it. It is the state for
 * having no errand to run: it is entered by clearing the detour, and
 * if one ever survived into it the backstop below should take it away.
 */
const SERVES_WATER: ReadonlySet<string> = new Set([
  'seek_water', 'approach_water', 'drink', 'wait_wings', 'replan',
]);

export type Goal =
  | 'off'
  | 'navigate'
  | 'seek_water'
  | 'approach_water'
  | 'drink'
  | 'wait_wings'
  | 'replan'
  /**
   * NO REACHABLE WATER — she is under the floor and nothing she can
   * see can be reached before she dries.
   *
   * A CONDITION, NOT AN ERRAND. She keeps flying the player's
   * destination while it lasts (`intent` still targets the primary),
   * because the alternative is stopping in open country to think
   * about a stream she cannot make. It is stable on purpose: the
   * brain re-asks once a second and stays here until an answer
   * changes, rather than flicking back to `navigate` and finding the
   * same nothing a fifth of a second later.
   */
  | 'water_critical'
  | 'mission_complete'
  // Phase 2+, unreachable today:
  | 'avoid'
  | 'seek_rest'
  | 'rest'
  | 'approach'
  | 'land';

/**
 * WATER SEEN FROM WHERE SHE IS — range and bearing, never a position.
 *
 * The brain is handed relative sightings and derives world points from
 * them itself (`pointAt`). That is not ceremony: a sighting is only
 * true from the place it was taken, and a type that carried `wx, wz`
 * would invite a caller to hand over a stale one from a hundred metres
 * back and have it silently believed.
 */
export interface WaterSighting {
  /** World units to it, along the ground. */
  readonly range: number;
  /** World radians — she travels along `(sin b, cos b)`. */
  readonly bearing: number;
}

/** Everything the brain is allowed to know. It reads; it never reaches. */
export interface Sense {
  /** WORLD, always. */
  readonly at: WorldPoint;
  /** 0–1. */
  readonly thirst: number;
  /** Fractions a second she is losing. */
  readonly thirstDrain: number;
  /** 0–1, the ONE reserve. Read for Phase 2; nothing decides on it yet. */
  readonly stamina: number;
  readonly staminaSpent: boolean;
  /**
   * HOW HARD SHE IS GOING, and in which set of ceilings — gait.ts.
   *
   * Sensed for Phase 2, which is where it earns its keep: the route
   * planner's first move on an unsafe trip is to CHANGE PACE before it
   * inserts a stop, and a brain that cannot see the pace cannot make
   * that trade. Phase 1 reads it and decides nothing on it, exactly as
   * it does with stamina.
   */
  readonly medium: Medium;
  readonly tier: Tier;
  /** That tier as a share of the medium's own maximum, 0–1. */
  readonly paceShare: number;
  readonly motion: Motion;
  readonly act: Act;
  /** She cannot fly until they dry (ant/wings.ts). */
  readonly wingsWet: boolean;
  /** Fresh water within her reach ring RIGHT HERE — `canDrink`. */
  readonly drinkable: boolean;
  /**
   * LIVE simulated fresh water, from the 256 m window. Real, and local.
   */
  readonly nearestFresh: WaterSighting | null;
  /**
   * STRATEGIC candidate from the island's drainage. Whole island, and a
   * channel rather than a promise — see nearestWater.nearestWatercourse.
   */
  readonly nearestWatercourse: WaterSighting | null;
  /**
   * MORE STRATEGIC CANDIDATES, sampled ALONG THE CORRIDOR she is flying.
   *
   * `nearestWatercourse` answers one question — what is closest to her
   * — and closest is often the wrong stop: a channel 300 m behind her
   * costs 600 m of backtracking, while one 700 m ahead and 40 m off the
   * line costs almost nothing. She cannot tell those apart from a
   * single sighting, so the scene looks a few places down the corridor
   * as well and hands the answers over here.
   *
   * Sightings, like the two above: range and bearing FROM HER, so the
   * brain still never holds a world position it did not derive itself.
   * Optional because a caller that has not looked should say so rather
   * than claim an empty island — absent means "nobody looked", and the
   * nearest sighting carries the decision on its own.
   *
   * They are CANDIDATES, exactly as `nearestWatercourse` is: drainage,
   * not a promise of standing water. The live handoff on arrival is
   * unchanged.
   */
  readonly waterAhead?: readonly WaterSighting[];
}

/**
 * WHAT THE BRAIN ASKS FOR — the seam Phase 2 plugs into.
 *
 * A request, not a command: "get me to this point, then do this". The
 * executor decides the demand; the brain never names a control.
 */
export interface Intent {
  readonly goal: Goal;
  /** Null when there is nowhere to be — off, drinking, complete. */
  readonly target: WorldPoint | null;
  /** Close enough, world units. */
  readonly arrivalRadius: number;
  readonly desiredAction: 'idle' | 'navigate' | 'drink' | 'wait';
}

/**
 * WHAT THE WATER CHOICE ACTUALLY DECIDED, kept for the developer line.
 *
 * The scoring is three numbers and a verdict, and all four have to be
 * visible or the choice cannot be argued with: a queen who flew past a
 * stream looks identical from outside to one that never saw it.
 */
export interface WaterChoice {
  /** `water` for the live sim, `channel` for the drainage. */
  readonly label: string;
  /** World units from her to it, at the moment of choosing. */
  readonly range: number;
  /**
   * WHAT THE STOP COSTS THE TRIP, world units.
   *
   * `d(her→water) + d(water→destination) − d(her→destination)`. Zero
   * for water exactly on the line she was already flying, and up to
   * twice the range for water directly behind her. With no destination
   * it degenerates to the range, which is the right answer then.
   */
  readonly cost: number;
  /** Seconds to reach it, from the estimator. */
  readonly eta: number;
  /** `eta + hydrationReserve < timeUntilDry` — can she get there wet. */
  readonly reachable: boolean;
}

/** One line for the developer register. */
export interface AutonomyDebug {
  readonly goal: Goal;
  readonly primary: string | null;
  readonly detour: string | null;
  readonly thirst: number;
  readonly dry: number;
  /** The floor `dry` has to fall under before she stops, seconds. */
  readonly threshold: number;
  /** The last water candidate weighed, with its score. Null if none. */
  readonly candidate: WaterChoice | null;
  readonly eta: number;
  readonly target: WorldPoint | null;
  readonly stamina: number;
  readonly motion: Motion;
  readonly act: Act;
  readonly medium: Medium;
  readonly tier: Tier;
  readonly paceShare: number;
}

const NOWHERE: Intent = {
  goal: 'off', target: null, arrivalRadius: 0, desiredAction: 'idle',
};

/** Turn a range and bearing from her into a world point. */
function pointAt(
  from: WorldPoint, found: { range: number; bearing: number },
): WorldPoint {
  return {
    wx: from.wx + Math.sin(found.bearing) * found.range,
    wz: from.wz + Math.cos(found.bearing) * found.range,
  };
}

const near = (a: WorldPoint, b: WorldPoint, within: number): boolean =>
  Math.hypot(a.wx - b.wx, a.wz - b.wz) <= within;

/** Straight-line world units between two places. */
const span = (a: WorldPoint, b: WorldPoint): number =>
  Math.hypot(a.wx - b.wx, a.wz - b.wz);

export class MissionBrain {
  private readonly cfg: AutonomyConfig;
  private readonly estimate: TripEstimator;

  /** WHERE SHE WAS GOING. A detour never touches this. */
  private primary: Mission | null = null;
  /** The survival errand, if one is running. Depth one, on purpose. */
  private detour: Mission | null = null;

  private state: Goal = 'off';
  private thinkDue = 0;
  private planDue = 0;
  /** Last plan's answer, so THINK can reason without re-planning. */
  private trip: TripEstimate | null = null;
  private pending: string | null = null;
  /** Set while a detour is live, so it is announced once and not again. */
  private announced = false;
  /** The same, for the harder message: nothing she can reach. */
  private criticalSaid = false;
  /** The last candidate weighed, kept for the developer line. */
  private choice: WaterChoice | null = null;

  constructor(estimate: TripEstimator, cfg: AutonomyConfig = AUTONOMY_DEFAULTS) {
    this.estimate = estimate;
    this.cfg = cfg;
  }

  get goal(): Goal { return this.state; }
  get primaryMission(): Mission | null { return this.primary; }
  get detourMission(): Mission | null { return this.detour; }
  /** The mission actually being served — detour first, else primary. */
  get active(): Mission | null { return this.detour ?? this.primary; }

  /** Send her somewhere. Replaces any primary; a live detour survives. */
  order(mission: Mission): void {
    this.primary = mission;
    if (this.state === 'off' || this.state === 'mission_complete') {
      this.state = 'navigate';
    }
    this.trip = null;
    this.planDue = 0;
  }

  /** Player pulled the plug. Everything stops, including a committed drink. */
  cancel(): void {
    this.primary = null;
    this.detour = null;
    this.state = 'off';
    this.trip = null;
    this.announced = false;
    this.criticalSaid = false;
    this.choice = null;
  }

  /**
   * A message for the player, once, or null.
   *
   * TAKEN rather than read, so a caller cannot show it twice and the
   * brain cannot spam it: `think` sets it on a transition, the scene
   * takes it on the next frame, and it is gone.
   */
  takeNotice(): string | null {
    const say = this.pending;
    this.pending = null;
    return say;
  }

  get intent(): Intent {
    const mission = this.active;
    switch (this.state) {
      case 'drink':
        return {
          goal: 'drink', target: null, arrivalRadius: 0, desiredAction: 'drink',
        };
      case 'wait_wings':
        return {
          goal: 'wait_wings', target: null, arrivalRadius: 0, desiredAction: 'wait',
        };
      case 'navigate':
      case 'seek_water':
      case 'approach_water':
      // SHE KEEPS GOING WHILE SHE IS IN TROUBLE. `water_critical` holds
      // no detour, so `active` is the player's own destination — and
      // stopping in open country to think about a stream she cannot
      // reach would spend the little water she has left on nothing.
      case 'water_critical':
        if (!mission) return NOWHERE;
        return {
          goal: this.state,
          target: mission.at,
          arrivalRadius: mission.arriveWithin,
          desiredAction: 'navigate',
        };
      default:
        return { ...NOWHERE, goal: this.state };
    }
  }

  debug(sense: Sense): AutonomyDebug {
    return {
      goal: this.state,
      primary: this.primary?.label ?? null,
      detour: this.detour?.label ?? null,
      thirst: sense.thirst,
      dry: timeUntilDry(sense.thirst, sense.thirstDrain),
      threshold: this.cfg.thirstFloor,
      candidate: this.choice,
      eta: this.trip?.etaSeconds ?? Number.NaN,
      target: this.active?.at ?? null,
      stamina: sense.stamina,
      motion: sense.motion,
      act: sense.act,
      medium: sense.medium,
      tier: sense.tier,
      paceShare: sense.paceShare,
    };
  }

  /**
   * Advance the brain. Call every frame; it throttles itself.
   *
   * THE RATES DO NOT CHANGE THE ANSWERS. Every decision below is a pure
   * function of the sense it is handed, so how often it runs decides
   * only WHEN a change is noticed, never WHAT is decided — which is the
   * property that lets the executor run at frame rate over a brain that
   * does not.
   */
  update(dt: number, sense: Sense): void {
    if (this.state === 'off' && this.primary === null) return;
    this.planDue -= dt;
    if (this.planDue <= 0) {
      this.planDue = this.cfg.planEvery;
      this.plan(sense);
    }
    this.thinkDue -= dt;
    if (this.thinkDue <= 0) {
      this.thinkDue = this.cfg.thinkEvery;
      this.think(sense);
    }

    // AN ERRAND NOBODY IS RUNNING IS NOT AN ERRAND.
    //
    // The invariant rather than the bug: `detour` may only exist while
    // some state is actually serving it. `wait_wings` used to fall out
    // into `navigate` and strand one, and the damage was out of all
    // proportion to the slip — `active` prefers the detour, so the
    // executor spent the rest of the session flying to a place the
    // brain had stopped thinking about, and every later order was
    // ignored because it went behind that detour in the queue.
    //
    // Fixing the one path is not enough. A detour is invisible to this
    // machine from the wrong state and lethal to the executor, so any
    // future path out of the water states has to lose it too, whether
    // or not whoever writes it remembers.
    //
    // NO TEST REACHES THIS, and that is the honest state of it: with
    // both real fixes in place there is no way to arrive here. It is
    // kept as the backstop for the class rather than the case, because
    // the failure it prevents cost a whole session and the failure it
    // could cause — dropping a live errand, and continuing to the
    // player's own destination — is a fraction as bad.
    if (this.detour !== null && !SERVES_WATER.has(this.state)) {
      this.detour = null;
      this.trip = null;
    }
  }

  /**
   * COMMITTED ACTIONS RUN TO COMPLETION — the Beyond Extinction rule,
   * and the reason its dinos do not flicker between chasing and roaming.
   *
   * Its `_think()` opens by returning early while eating, swimming or
   * mid-bite. Ours returns early while she is DRINKING and still short
   * of the target, because a drink interrupted at the halfway mark is
   * a queen who walks away thirsty and immediately decides she is
   * thirsty.
   */
  private committed(sense: Sense): boolean {
    return this.state === 'drink' && sense.thirst < this.cfg.drinkTo;
  }

  /**
   * THE EXPENSIVE PASS — trip estimates and choosing a water target.
   *
   * Once a second, because neither answer moves meaningfully faster
   * than that and both cost real work: the estimate will one day be a
   * route solve, and the water candidate is a ring search.
   */
  private plan(sense: Sense): void {
    const mission = this.active;
    this.trip = mission ? this.estimate(sense.at, mission.at) : null;
    if (this.state !== 'replan' && this.state !== 'water_critical') return;
    // THESE TWO ARE THE ONLY DOORS to a new water target. Everywhere
    // else a committed detour is left alone, which is what stops the
    // seek/navigate/seek flicker.
    //
    // `water_critical` is in here because the condition has to be able
    // to END: she is flying while it lasts, so the country under her is
    // changing, and a stream that was out of range a kilometre back may
    // not be now. Asked once a second, which is this pass — never at
    // think rate, which is what would make it flicker.
    const found = this.chooseWater(sense);
    if (found) {
      this.detour = found;
      this.state = 'seek_water';
      this.sayThirsty();
      return;
    }
    // NOTHING SHE CAN REACH. Carry on with the primary rather than
    // stall — a brain that stops because it cannot solve a problem is
    // worse than one that keeps going while it looks — but say so, and
    // hold the condition instead of pretending it is an ordinary
    // flight. See `water_critical`.
    this.detour = null;
    this.trip = null;
    if (!this.primary) { this.state = 'off'; return; }
    this.state = 'water_critical';
    this.sayCritical();
  }

  /** The thirst message, at most once per episode. */
  private sayThirsty(): void {
    if (this.announced) return;
    this.announced = true;
    this.pending = 'Very Thirsty! Stopping for water first.';
  }

  /** The harder one, also at most once per episode. */
  private sayCritical(): void {
    if (this.criticalSaid) return;
    this.criticalSaid = true;
    this.pending = 'No water in reach — continuing to destination.';
  }

  /** The live sighting as an errand — real water, inside the window. */
  private freshMission(from: WorldPoint, seen: WaterSighting): Mission {
    return {
      id: 'water:sim',
      label: 'water',
      at: pointAt(from, seen),
      satisfies: ['hydration'],
      arriveWithin: Math.max(1, this.cfg.waterArriveWithin / 10),
    };
  }

  /** A drainage sighting as an errand — a channel, not a promise. */
  private channelMission(from: WorldPoint, seen: WaterSighting): Mission {
    const at = pointAt(from, seen);
    return {
      id: `channel:${Math.round(at.wx)},${Math.round(at.wz)}`,
      label: 'channel',
      at,
      satisfies: ['hydration'],
      arriveWithin: this.cfg.waterArriveWithin,
    };
  }

  /**
   * WHAT A STOP WOULD COST HER, and whether she can make it.
   *
   * Two different judgements and they must not be run together. COST is
   * geometry — how much further the trip gets — and decides which water
   * is worth going to. REACHABILITY is time, from the estimator, and
   * decides whether any of them is worth going to at all. A cheap stop
   * she cannot reach is not a cheap stop.
   */
  private weigh(
    sense: Sense, mission: Mission, range: number,
    goal: WorldPoint | null, dry: number,
  ): WaterChoice {
    const eta = this.estimate(sense.at, mission.at).etaSeconds;
    // d(her→water) + d(water→destination) − d(her→destination). Zero on
    // the line she was already flying, twice the range straight behind
    // her. Clamped at zero only against floating-point noise — the
    // triangle inequality says it cannot really go negative.
    const cost = goal === null ? range
      : Math.max(0, range + span(mission.at, goal) - span(sense.at, goal));
    return {
      label: mission.label,
      range,
      cost,
      eta,
      reachable: Number.isFinite(eta) && eta + this.cfg.hydrationReserve < dry,
    };
  }

  /**
   * WHICH WATER, AND WHETHER ANY OF IT IS ANY USE.
   *
   * PREFER WATER THAT EXISTS. `nearestFresh` is the live simulation and
   * is TRUE; everything else is the island's drainage and is a
   * CANDIDATE. The live one is taken whenever the window has any, and
   * that is not a shortcut past the scoring — the window is 256 m, so
   * water inside it is a stop that costs half a kilometre at the very
   * worst and no drainage node can beat it.
   *
   * PAST THAT, THE NEAREST CHANNEL IS NOT THE RIGHT CHANNEL. Closest to
   * HER is the wrong question when she is going somewhere: 300 m behind
   * costs 600 m of backtracking, and 700 m ahead and slightly off the
   * line costs almost nothing. So the strategic candidates — the
   * nearest, plus whatever the scene saw down the corridor — are scored
   * by DETOUR COST and the cheapest reachable one wins.
   *
   * AND REACHABILITY IS A FILTER, not a tiebreak. A queen with eight
   * minutes of water and nothing inside twenty is not helped by being
   * sent at the nearest of them; she is helped by being told, and by
   * continuing to the destination she at least has a reason to be
   * flying toward. That is `water_critical`, and it is what null here
   * means.
   */
  private chooseWater(sense: Sense): Mission | null {
    const dry = timeUntilDry(sense.thirst, sense.thirstDrain);
    const goal = this.primary?.at ?? null;
    const weighed: {
      readonly mission: Mission;
      readonly score: WaterChoice;
      readonly live: boolean;
    }[] = [];

    if (sense.nearestFresh) {
      const mission = this.freshMission(sense.at, sense.nearestFresh);
      weighed.push({
        mission, live: true,
        score: this.weigh(sense, mission, sense.nearestFresh.range, goal, dry),
      });
    }
    const strategic: WaterSighting[] = [];
    if (sense.nearestWatercourse) strategic.push(sense.nearestWatercourse);
    for (const seen of sense.waterAhead ?? []) strategic.push(seen);
    for (const seen of strategic) {
      const mission = this.channelMission(sense.at, seen);
      // Two corridor samples very often find the same node, and the id
      // is that node's rounded position, so this is an exact match
      // rather than a distance heuristic.
      if (weighed.some((had) => had.mission.id === mission.id)) continue;
      weighed.push({
        mission, live: false,
        score: this.weigh(sense, mission, seen.range, goal, dry),
      });
    }
    if (weighed.length === 0) { this.choice = null; return null; }

    // Live first, then least detour. A stable order, so two candidates
    // that score alike do not swap places between passes.
    weighed.sort((a, b) => (
      a.live === b.live ? a.score.cost - b.score.cost : a.live ? -1 : 1
    ));
    const best = weighed.find((one) => one.score.reachable) ?? null;
    // Remember what was weighed even when nothing was reachable — the
    // developer line's whole job in that case is showing WHY.
    this.choice = (best ?? weighed[0]).score;
    return best?.mission ?? null;
  }

  /** The decision pass. Five a second, and cheap. */
  private think(sense: Sense): void {
    if (this.state === 'off' && this.primary === null) return;
    // ARRIVED, AND STAYS ARRIVED. Completion is something the player and
    // the executor have to be able to SEE; a state that lasted one
    // think pass before falling through to `off` announced nothing.
    // She waits here until ordered somewhere else.
    if (this.state === 'mission_complete') return;
    if (this.committed(sense)) {
      // ...but a drink over water that has gone away is not a drink.
      if (!sense.drinkable && sense.act !== 'drinking') this.state = 'replan';
      return;
    }

    // FINISHED DRINKING. Clear the errand and go back to what she was
    // doing — the whole point of keeping `primary` untouched.
    if (this.state === 'drink') {
      this.detour = null;
      this.announced = false;
      this.criticalSaid = false;
      this.pending = 'Hydrated. Resuming destination.';
      this.state = this.primary ? 'navigate' : 'off';
      this.trip = null;
      return;
    }

    // WET WINGS OUTRANK TRAVEL, because they forbid it: she cannot take
    // off until they dry (ant/wings.ts), so a goal that needs flight is
    // a goal she cannot start. Only while the water still has her —
    // wet wings on dry land do not stop her walking.
    if (sense.wingsWet && (sense.motion === 'swimming' || sense.motion === 'diving')) {
      this.state = 'wait_wings';
      return;
    }
    if (this.state === 'wait_wings') {
      // BACK TO THE ERRAND, NOT PAST IT — and this one line deadlocked
      // a whole session.
      //
      // It went straight to `navigate` whatever it had been doing, so a
      // queen who was waiting for her wings in the middle of a WATER
      // errand came out of the wait having forgotten the errand — while
      // `detour` was still set. Nothing in this machine serves a detour
      // from `navigate`, so it was never advanced, never satisfied and
      // never cleared. And `active` prefers the detour, so the executor
      // kept flying to it: Joshua's third screenshot is exactly that,
      // `AI navigate · det water` over `AP hold 1m`, sitting on the
      // water it had already reached.
      //
      // Everything downstream then looks broken. A new waypoint does
      // nothing, because `active` is still the stale detour. Drinking
      // by hand does nothing, because `drink` — the only state that
      // clears a detour — is unreachable from `navigate`.
      this.state = this.detour ? 'seek_water'
        : this.primary ? 'navigate' : 'off';
    }

    // SURVIVAL FIRST, before the normal goal is even considered — the
    // shape of DinoAI's flee check, which runs ahead of the temperament
    // dispatch for the same reason.
    if (this.state === 'seek_water' || this.state === 'approach_water') {
      this.serveWater(sense);
      return;
    }
    if (this.state === 'replan') return;       // plan() owns the way out

    // NOTHING SHE CAN REACH — a condition she stays in, deliberately.
    //
    // The temptation is to drop back to `navigate` and let the next
    // think pass discover the same nothing, which is a state machine
    // flickering five times a second over a fact that changes on the
    // scale of kilometres. She holds this instead; `plan()` re-asks
    // once a second, and the two ways out are water she can reach and
    // water she has drunk.
    if (this.state === 'water_critical') {
      if (!this.thirstUnsafe(sense)) {
        this.announced = false;
        this.criticalSaid = false;
        this.state = this.primary ? 'navigate' : 'off';
        return;
      }
      // STILL ARRIVING, THOUGH. She is flying the primary while this
      // lasts, so she can reach it while this lasts — and a queen who
      // silently failed to notice would strand the waypoint chain
      // behind her.
      if (!this.primary) { this.state = 'off'; return; }
      if (near(sense.at, this.primary.at, this.primary.arriveWithin)) {
        this.state = 'mission_complete';
        this.primary = null;
      }
      return;
    }

    if (this.thirstUnsafe(sense)) {
      const found = this.chooseWater(sense);
      if (found) {
        this.detour = found;
        this.state = 'seek_water';
        this.sayThirsty();
        return;
      }
      // NOTHING REACHABLE. Not a replan — `chooseWater` has just looked
      // at everything there is, and asking again a fifth of a second
      // later would get the same answer. Say so once and keep flying.
      this.detour = null;
      this.trip = null;
      if (!this.primary) { this.state = 'off'; return; }
      this.state = 'water_critical';
      this.sayCritical();
      return;
    }

    // Nothing wrong: serve the primary.
    if (!this.primary) { this.state = 'off'; return; }
    this.state = near(sense.at, this.primary.at, this.primary.arriveWithin)
      ? 'mission_complete'
      : 'navigate';
    if (this.state === 'mission_complete') this.primary = null;
  }

  /**
   * IS SHE LOW ON WATER? One clause, and that is the fix.
   *
   * IT USED TO ASK TWO THINGS and the second one ruined it: "will I
   * still be wet when I ARRIVE", against the mission's own ETA. That
   * question has no liveable answer on an island whose crossing is
   * longer than a full tank — it says no from the first second of every
   * long flight and keeps saying no however recently she drank, so she
   * bounced between the water and the path for ever. Joshua watched it
   * happen every three minutes with three quarters of a tank in hand.
   *
   * The trip's length is a ROUTE question, and it is answered by
   * repeating this rule rather than by complicating it: fly, fall to
   * the floor, drink to full, fly again. Staged stops, with no plan.
   *
   * WHAT SURVIVES OF THE ESTIMATOR is the question it can actually
   * answer — can she reach a PARTICULAR PUDDLE before she dries — and
   * that lives in `weigh`, where the answer changes what she does about
   * being thirsty rather than whether she is.
   *
   * And a destination that ALREADY answers thirst is never interrupted
   * to look for thirst: flying to a river and stopping halfway to find
   * water is the autonomy arguing with itself.
   */
  private thirstUnsafe(sense: Sense): boolean {
    if (satisfies(this.primary, 'hydration')) return false;
    // ALREADY AS FULL AS DRINKING CAN MAKE HER. A water stop is only
    // worth making if it would gain her something, and at the drink
    // target it would gain her nothing. This is what stops the errand
    // restarting the instant she steps out of the stream.
    if (sense.thirst >= this.cfg.drinkTo) return false;
    const dry = timeUntilDry(sense.thirst, sense.thirstDrain);
    if (!Number.isFinite(dry)) return false;
    return dry <= this.cfg.thirstFloor;
  }

  /**
   * Running the water errand. COMMITTED: the target is not reselected
   * here, only handed off or abandoned.
   */
  private serveWater(sense: Sense): void {
    if (sense.drinkable) { this.state = 'drink'; return; }
    // AND THE ERRAND ENDS WHEN THE REASON FOR IT DOES.
    //
    // This asked every question about the water except the first one:
    // does she still need it. So a queen who got a drink some OTHER way
    // — the player holding the button, which is exactly what Joshua
    // did — kept the errand for ever, because the only exit was
    // arriving at a target she no longer had any reason to visit.
    //
    // It is the deeper half of the deadlock his session found. Sending
    // her back to `seek_water` after her wings dried was right, and on
    // its own it only moved the stall: from a detour nobody was serving
    // to a detour being served for nothing.
    if (!this.thirstUnsafe(sense)) {
      this.detour = null;
      this.trip = null;
      this.announced = false;
      this.criticalSaid = false;
      this.state = this.primary ? 'navigate' : 'off';
      return;
    }
    const target = this.detour;
    if (!target) { this.state = 'replan'; return; }
    // ARRIVED AT THE STRATEGIC CANDIDATE. The drainage got her to the
    // valley; the live sim takes it from here. If the channel is dry
    // when she arrives — 29.7% of surveyed reaches are, and the
    // drainage is no better a promise — there is nothing to hand off
    // to, and replanning is the honest answer rather than hovering.
    if (near(sense.at, target.at, target.arriveWithin)) {
      if (sense.nearestFresh) {
        this.detour = {
          ...target,
          id: 'water:sim',
          label: 'water',
          at: pointAt(sense.at, sense.nearestFresh),
          arriveWithin: Math.max(1, this.cfg.waterArriveWithin / 10),
        };
        this.state = 'approach_water';
        return;
      }
      this.state = 'replan';
      return;
    }
    this.state = this.state === 'approach_water' ? 'approach_water' : 'seek_water';
  }
}
