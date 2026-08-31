/**
 * ANOTHER PILOT HOLDING THE SAME CONTROLS.
 *
 * Phase 2. The MissionBrain decides WHERE she is going and why; this
 * decides WHAT TO DO WITH THE STICK about it; `Flight` decides what
 * physically happens. Those are three questions and they stay in three
 * files — the brain never learns aerodynamics and this never learns
 * why she is going anywhere.
 *
 * THE ONE RULE THAT MATTERS: nothing here moves her. It returns a
 * `FlightDemand` — the same object a thumb produces — and `Flight.update`
 * remains the only thing in the game that writes a position. There is
 * no teleport, no velocity write and no secret extra thrust, so an
 * autopilot that asks for the impossible simply does not get it, the
 * same as a player who asks for the impossible. That is what makes
 * BLOCKED honest rather than decorative.
 *
 * IT FLIES A TRACK, NOT A HEADING, and that is the whole reason this is
 * more than "point at the pin". Wind already exists in TMB and it is
 * not gentle: at her cruise a stiff trade wind is a large fraction of
 * her airspeed, so a queen pointing her nose straight at a waypoint
 * crabs sideways past it and never arrives. The error this closes is
 * between the bearing TO the pin and the direction she is actually
 * moving over the ground — `telemetry.trackOf`, which the flight HUD
 * has been computing every frame since long before this existed. Point
 * the nose wherever it has to point; it is the track that has to be
 * right.
 *
 * AND IT CANNOT CHEAT THE WIND. If the air is faster than she is, the
 * track error stays open however hard she turns, and this says so —
 * `blocked`, with a reason — rather than quietly adding thrust the
 * flight model does not have. Same for a ridge she cannot outclimb.
 * The failure is reported upward for a future replanner; it is never
 * papered over.
 */
import { bearingOf, wrap180 } from '../ui/compassMath';
import { CLIMB_RATE, type FlightDemand } from './flight';
import { predict, type Drift, type Predicted } from './telemetry';
import { AUTOPILOT_DEFAULTS, CEILING, type AutopilotConfig } from './autopilotConfig';
import type { WorldPoint } from '../world/coords';

/**
 * What the autopilot is trying to do.
 *
 * DELIBERATELY NOT `Motion`. Motion answers "what is her body doing" and
 * is DERIVED from the world every frame (motion.ts); this answers "what
 * is the autopilot attempting", which is a belief and can be wrong.
 * Stage G exists because those two were once one field, and folding
 * them back together would undo it.
 */
export type NavState =
  | 'idle'
  | 'acquire'
  | 'cruise'
  | 'arrival'
  | 'hold'
  | 'blocked';

/** Why she stopped. Null unless the state is `blocked`. */
export type Blocked = 'no_progress' | 'terrain';

/** Everything the autopilot is allowed to know about the world. */
export interface NavSense {
  /** Where she is. WORLD, because it outlives the frame. */
  readonly at: WorldPoint;
  /** Her altitude above sea level, world units. */
  readonly altitude: number;
  /** The terrain elevation directly beneath her. */
  readonly ground: number;
  /** Her heading in radians — she travels along `(sin h, cos h)`. */
  readonly heading: number;
  /** Airspeed, world units a second. */
  readonly airspeed: number;
  /** Her velocity OVER THE GROUND, airspeed and wind combined. */
  readonly drift: Drift;
  /** Compass degrees she is actually moving in — `telemetry.trackOf`. */
  readonly track: number;
  /** Vertical speed, world units a second. */
  readonly climbing: number;
  /** Is she airborne at all? On the ground the autopilot does nothing. */
  readonly aloft: boolean;
  /** The terrain query, so this file needs no heightfield of its own. */
  readonly terrainAt: (wx: number, wz: number) => number;
}

/** What the autopilot decided, and what it is telling the world. */
export interface NavCommand {
  readonly demand: FlightDemand;
  readonly state: NavState;
  readonly blocked: Blocked | null;
  /** Straight-line range to the pin, world units. */
  readonly range: number;
  /** The track she wants, compass degrees. */
  readonly wanted: number;
  /** How far off it she is, degrees, signed. */
  readonly error: number;
  /** Airspeed she is being asked to hold. */
  readonly target: number;
  /** Metres of ground clearance the lookahead found, or null. */
  readonly ahead: number | null;
}

/** Nothing asked for, nothing commanded. */
const IDLE: FlightDemand = { push: 0, side: 0, lift: 0 };

/**
 * Range to the pin.
 *
 * Flat, on purpose: she is asked to arrive OVER a place rather than at
 * an altitude, because Phase 2 has no landing and choosing a height to
 * arrive at would be inventing one.
 */
export function rangeTo(from: WorldPoint, to: WorldPoint): number {
  return Math.hypot(to.wx - from.wx, to.wz - from.wz);
}

/** The compass bearing from one world point to another. */
export function bearingTo(from: WorldPoint, to: WorldPoint): number {
  return bearingOf(to.wx - from.wx, to.wz - from.wz);
}

/**
 * How hard to turn, given how far off track she is.
 *
 * Proportional inside `trackFullScale`, saturated outside it, and flat
 * zero inside the deadband. POSITIVE IS RIGHT: `Flight.steer` does
 * `facing -= rate * side * dt` and a compass bearing is `π − heading`,
 * so the two minus signs cancel and a positive side command raises the
 * bearing. That is worth writing down rather than rediscovering, since
 * the same pair of signs has been got backwards in this repo before.
 */
export function turnFor(errorDegrees: number, cfg: AutopilotConfig): number {
  const size = Math.abs(errorDegrees);
  if (size <= cfg.trackDeadband) return 0;
  // Measured from the EDGE of the deadband, so the command comes off
  // zero smoothly instead of stepping to a finite value the moment the
  // error clears it.
  const past = (size - cfg.trackDeadband) / (cfg.trackFullScale - cfg.trackDeadband);
  const pull = Math.min(1, Math.max(0, past)) * cfg.maxTurn;
  return errorDegrees > 0 ? pull : -pull;
}

/**
 * The airspeed to hold at this range — the arrival profile.
 *
 * `sqrt(2 * brake * range)` is the speed from which `brake` exactly
 * stops her at the pin, so following it is a constant, gentle
 * deceleration all the way in rather than a series of steps. Capped at
 * cruise far out and floored above the stall close in, because an
 * autopilot flying the edge of the envelope is one gust from falling
 * out of the sky with nobody holding it.
 */
export function speedFor(range: number, cfg: AutopilotConfig): number {
  const stopping = Math.sqrt(2 * cfg.brake * Math.max(0, range));
  return Math.max(cfg.slowest, Math.min(cfg.cruise, stopping));
}

/**
 * Captured, with hysteresis.
 *
 * A single radius is what makes an autopilot orbit: the wind nudges her
 * a metre outside it, the controller turns back, she overshoots, and
 * the loop is a circle round the pin for ever. Letting go has to need
 * more than taking hold did.
 */
export function captured(range: number, was: boolean, cfg: AutopilotConfig): boolean {
  return was ? range <= cfg.release : range <= cfg.capture;
}

/** Has the player taken the controls back? */
export function tookOver(
  push: number, side: number, lift: number, cfg: AutopilotConfig,
): boolean {
  return Math.hypot(push, side) > cfg.manualDeadzone
    || Math.abs(lift) > cfg.manualDeadzone;
}

export class Autopilot {
  private readonly cfg: AutopilotConfig;
  private target: WorldPoint | null = null;
  private state: NavState = 'idle';
  private why: Blocked | null = null;
  private held = false;
  /** The closest she has been, and how long since it improved. */
  private closest = Number.POSITIVE_INFINITY;
  private stale = 0;

  constructor(cfg: AutopilotConfig = AUTOPILOT_DEFAULTS) {
    this.cfg = cfg;
  }

  get flying(): NavState { return this.state; }
  get blockedBy(): Blocked | null { return this.why; }
  get engaged(): boolean { return this.target !== null && this.state !== 'idle'; }
  get pin(): WorldPoint | null { return this.target; }

  /**
   * Fly to a place. Replaces whatever it was doing.
   *
   * Takes a bare point rather than a Mission: the autopilot has no
   * business knowing WHY she is going, and a signature that named a
   * Mission would be the first crack in that.
   */
  engage(at: WorldPoint): void {
    this.target = at;
    this.state = 'acquire';
    this.why = null;
    this.held = false;
    this.closest = Number.POSITIVE_INFINITY;
    this.stale = 0;
  }

  /**
   * Hand the controls back.
   *
   * The TARGET SURVIVES on purpose — disengaging is the player taking
   * over, not changing their mind, and the MissionBrain still holds the
   * destination either way. Re-engaging picks it up where it was.
   */
  disengage(): void {
    if (this.state !== 'idle') this.state = 'idle';
  }

  /** Forget the destination entirely. */
  clear(): void {
    this.target = null;
    this.state = 'idle';
    this.why = null;
    this.held = false;
  }

  /**
   * One frame. Returns the demand a thumb would have produced.
   *
   * On the ground it commands nothing at all: taking off is a decision
   * with a stamina price and a player's, not something an autopilot
   * does because a pin exists somewhere.
   */
  update(dt: number, sense: NavSense): NavCommand {
    const to = this.target;
    if (to === null || this.state === 'idle' || !sense.aloft) {
      if (!sense.aloft && this.state !== 'idle') this.state = 'acquire';
      return this.report(IDLE, 0, 0, 0, 0, null);
    }

    const range = rangeTo(sense.at, to);
    const wanted = bearingTo(sense.at, to);
    // AGAINST HER TRACK, NOT HER HEADING. The difference is the whole
    // point of the file — see the header.
    const error = wrap180(wanted - sense.track);

    this.held = captured(range, this.held, this.cfg);
    if (this.held) {
      this.state = 'hold';
      this.why = null;
      // Held over the pin: wings level, no thrust asked for, and the
      // scene's own hover hold keeps her up. Nothing to steer toward.
      return this.report(
        { push: 0, side: 0, lift: 0, hold: null }, range, wanted, error, 0, null,
      );
    }

    // ── TERRAIN, REACTIVELY ──────────────────────────────────────
    // Local and cheap: where the ground velocity puts her in a couple
    // of seconds, and how much air is under her there. This is NOT a
    // route profile — the island-wide planner is a later phase, and
    // pretending otherwise here would be exactly the fabricated
    // capability the brief forbids.
    const soon = this.lookAhead(sense);
    const clearance = soon ? soon.agl : null;
    let lift = 0;
    if (soon !== null && soon.agl < this.cfg.clearance) {
      // Proportional, so a hill answers with a nudge and a wall
      // answers with everything she has.
      lift = Math.min(1, (this.cfg.clearance - soon.agl) / this.cfg.clearance);
    }

    const target = speedFor(range, this.cfg);
    const side = turnFor(error, this.cfg);

    // ── IS SHE GETTING ANYWHERE? ─────────────────────────────────
    // Measured on the RANGE rather than on the airspeed, because the
    // question is about the ground and the wind is the thing that
    // separates the two. Coming round onto track legitimately opens
    // the range for a few seconds, which is what `patience` is for.
    if (range < this.closest - this.cfg.crawling * dt) {
      this.closest = range;
      this.stale = 0;
    } else {
      this.stale += dt;
    }

    if (this.stale >= this.cfg.patience) {
      this.state = 'blocked';
      // A CLIMB SHE CANNOT MAKE is a different problem from a wind she
      // cannot beat, and a replanner will want to know which.
      this.why = lift > 0.99 && sense.climbing < CLIMB_RATE * 0.1
        ? 'terrain' : 'no_progress';
    } else {
      this.state = Math.abs(error) > this.cfg.trackFullScale ? 'acquire' : 'cruise';
      this.why = null;
    }

    // BLOCKED STILL FLIES. It is a report, not a shutdown — she keeps
    // holding the best track she can while something upstream decides
    // what to do about it. An autopilot that let go of the controls to
    // announce a problem would turn a slow arrival into a crash.
    return this.report(
      { push: 0, side, lift, hold: Math.min(CEILING, target) },
      range, wanted, error, target, clearance,
    );
  }

  /**
   * The ground under where she will be shortly.
   *
   * The distance comes from her ground velocity rather than a constant,
   * so a hover looks just ahead and a sprint looks a long way. Null
   * when she is barely moving, which is honest: there is no "ahead".
   */
  private lookAhead(sense: NavSense): Predicted | null {
    const speed = Math.hypot(sense.drift.x, sense.drift.z);
    if (speed < 1) return null;
    return predict(
      { wx: sense.at.wx, wz: sense.at.wz, altitude: sense.altitude },
      sense.drift,
      sense.climbing,
      this.cfg.lookAhead,
      sense.terrainAt,
    );
  }

  private report(
    demand: FlightDemand, range: number, wanted: number,
    error: number, target: number, ahead: number | null,
  ): NavCommand {
    return {
      demand,
      state: this.state,
      blocked: this.why,
      range,
      wanted,
      error,
      target,
      ahead,
    };
  }
}
