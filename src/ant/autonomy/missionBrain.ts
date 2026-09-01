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
 * drink, wait_wings, replan, mission_complete.
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
  | 'mission_complete'
  // Phase 2+, unreachable today:
  | 'avoid'
  | 'seek_rest'
  | 'rest'
  | 'approach'
  | 'land';

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
  readonly nearestFresh: { readonly range: number; readonly bearing: number } | null;
  /**
   * STRATEGIC candidate from the island's drainage. Whole island, and a
   * channel rather than a promise — see nearestWater.nearestWatercourse.
   */
  readonly nearestWatercourse: { readonly range: number; readonly bearing: number } | null;
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

/** One line for the developer register. */
export interface AutonomyDebug {
  readonly goal: Goal;
  readonly primary: string | null;
  readonly detour: string | null;
  readonly thirst: number;
  readonly dry: number;
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
    if (this.state !== 'replan') return;
    // REPLAN is the ONLY door to a new water target. Everywhere else a
    // committed detour is left alone, which is what stops the
    // seek/navigate/seek flicker.
    const found = this.chooseWater(sense);
    if (found) {
      this.detour = found;
      this.state = 'seek_water';
      return;
    }
    // Nothing to go to. Carry on with the primary rather than stall —
    // she may fly into range of something, and a brain that stops
    // because it cannot solve a problem is worse than one that keeps
    // going while it looks.
    this.detour = null;
    this.state = this.primary ? 'navigate' : 'off';
  }

  /**
   * PREFER WATER THAT EXISTS. `nearestFresh` is the live simulation and
   * is TRUE; `nearestWatercourse` is the island's drainage and is a
   * CANDIDATE. Take the real one when the window has any, and only fall
   * back to the strategic one to leave the window at all.
   */
  private chooseWater(sense: Sense): Mission | null {
    if (sense.nearestFresh) {
      return {
        id: 'water:sim',
        label: 'water',
        at: pointAt(sense.at, sense.nearestFresh),
        satisfies: ['hydration'],
        arriveWithin: Math.max(1, this.cfg.waterArriveWithin / 10),
      };
    }
    if (sense.nearestWatercourse) {
      const at = pointAt(sense.at, sense.nearestWatercourse);
      return {
        id: `channel:${Math.round(at.wx)},${Math.round(at.wz)}`,
        label: 'channel',
        at,
        satisfies: ['hydration'],
        arriveWithin: this.cfg.waterArriveWithin,
      };
    }
    return null;
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

    if (this.thirstUnsafe(sense)) {
      const found = this.chooseWater(sense);
      if (found) {
        this.detour = found;
        this.state = 'seek_water';
        if (!this.announced) {
          this.announced = true;
          this.pending = 'Very Thirsty! Stopping for water first.';
        }
        return;
      }
      // No candidate anywhere. Keep going and look again next plan.
      this.state = 'replan';
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
   * WILL SHE STILL BE WET WHEN SHE GETS THERE?
   *
   * The ETA arrives from the estimator — the brain does not compute
   * distance or speed, so replacing the estimator with a wind- and
   * terrain-aware planner changes this answer without changing this
   * rule. That separation is the point; a test drives it from a stub.
   *
   * And a destination that ALREADY answers thirst is never interrupted
   * to look for thirst: flying to a river and stopping halfway to find
   * water is the autonomy arguing with itself.
   */
  private thirstUnsafe(sense: Sense): boolean {
    if (satisfies(this.primary, 'hydration')) return false;
    // ALREADY AS FULL AS DRINKING CAN MAKE HER. A water stop is only
    // worth making if it would gain her something, and at the drink
    // target it would gain her nothing — so a trip she cannot survive
    // even on a full tank is a ROUTE problem (staged stops), not a
    // thirst one, and belongs to the Phase 2 planner.
    //
    // Without this the brain loops: drink to full, resume, notice the
    // trip is still too long, detour to the water she is standing in,
    // drink, resume — for ever. Found by its own test.
    if (sense.thirst >= this.cfg.drinkTo) return false;
    if (!this.trip) return false;
    const dry = timeUntilDry(sense.thirst, sense.thirstDrain);
    if (!Number.isFinite(dry)) return false;
    return this.trip.etaSeconds + this.cfg.hydrationReserve > dry;
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
