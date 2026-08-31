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
import { CLIMB_RATE, HOVER_HOLD, type FlightDemand } from './flight';
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
  /**
   * OFF THE SURFACE AND STRAIGHT UP, before any of the rest of it.
   *
   * Phase 2 shipped without this and it was the missing link Joshua
   * named: "It never automatically lift and fly from land or water...
   * It's missing a takeoff action to link it together." The file used
   * to say, in as many words, that taking off is a decision with a
   * stamina price and the player's to make — which was a defensible
   * position right up until the player asked for a drone.
   */
  | 'takeoff'
  | 'acquire'
  | 'cruise'
  | 'arrival'
  | 'hold'
  | 'blocked';

/** Why she stopped. Null unless the state is `blocked`. */
export type Blocked = 'no_progress' | 'terrain' | 'wings' | 'reserve';

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
  /** Is she airborne at all? On the surface it lifts her off it. */
  readonly aloft: boolean;
  /**
   * Are her wings too wet to fly?
   *
   * A queen who has been swimming cannot take off until they dry, and
   * that is not the autopilot's rule to bend — the scene refuses the
   * launch regardless. Knowing about it is what lets the readout say
   * WAITING ON WINGS instead of sitting there saying nothing, which is
   * exactly what Joshua photographed on the water.
   */
  readonly wingsWet: boolean;
  /**
   * Would the flight model accept a launch right now?
   *
   * Asked rather than derived: the reserve a takeoff costs belongs to
   * `Flight`, and a second copy of that threshold here is a second
   * thing to get out of step.
   */
  readonly launchable: boolean;
  /** The terrain query, so this file needs no heightfield of its own. */
  readonly terrainAt: (wx: number, wz: number) => number;
  /**
   * THE WIND AT A HEIGHT SHE IS NOT AT, which is the whole altitude
   * argument. The scene owns the profile and the sheltering; this only
   * asks what a candidate band would feel like.
   */
  readonly windAt: (agl: number) => Drift | null;
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
  /** The AGL band she is flying toward, world units. */
  readonly band: number;
  /** The crab that band costs her, degrees. */
  readonly crab: number;
  /**
   * LEAVE THE SURFACE, NOW — the one thing the autopilot cannot do
   * with a `FlightDemand`.
   *
   * Every other command in this file is the demand a thumb produces,
   * and that is the invariant the header opens with: nothing here moves
   * her. A takeoff is not on the stick, though — it is a door in the
   * flight model with a stamina price — so it comes back as a request
   * the scene may refuse, and the scene is still the only thing that
   * spends the reserve or opens the door.
   */
  readonly launch: boolean;
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
 * The bands the autopilot will consider, as AGL in world units.
 *
 * Bunched down low on purpose, because that is where the answer
 * changes. The wind profile is `t²(3−2t)` to full strength at ten
 * metres, so between 55 cm and 4 m it goes from about one per cent of
 * the reported wind to about a third — while everything above ten
 * metres is the same wind and there is nothing to choose between.
 */
export function bandsFor(cfg: AutopilotConfig): number[] {
  const out = [cfg.floorAgl];
  for (const agl of [100, 200, 400, 800, 1_500, 3_000]) {
    if (agl > cfg.floorAgl && agl <= cfg.ceilingAgl) out.push(agl);
  }
  return out;
}

/**
 * HOW FAST SHE WOULD CLOSE ON THE PIN FROM THIS BAND, and this is the
 * whole navigation computer in one function.
 *
 * She can point her nose anywhere; what she cannot do is beat the air.
 * To hold a track she must crab until the wind's ACROSS-track component
 * is exactly cancelled: `sin(crab) = -across / airspeed`. If the across
 * component is bigger than her airspeed there is no such crab, the
 * track cannot be held at that altitude at all, and this says so with
 * a negative infinity rather than a small number — an unflyable band is
 * not a slow band.
 *
 * Otherwise what is left over is `airspeed·cos(crab) + along`, and the
 * `along` term is why she is allowed to CLIMB: a tailwind up high adds
 * to it, and riding it is simply the same arithmetic coming out the
 * other way.
 *
 * Pure, and it takes the wind as a value rather than a height, so a
 * test can hand it a gale without a weather system.
 */
export function progressIn(
  wind: Drift | null, airspeed: number, wantedDegrees: number,
): { speed: number; crab: number } {
  const want = (wantedDegrees * Math.PI) / 180;
  // The track direction, and the axis across it. Compass degrees: north
  // is -Z, east is +X, so the unit vector is (sin, -cos).
  const dx = Math.sin(want);
  const dz = -Math.cos(want);
  const along = wind ? wind.x * dx + wind.z * dz : 0;
  const across = wind ? wind.x * -dz + wind.z * dx : 0;
  if (airspeed <= 0) return { speed: -Infinity, crab: 0 };
  const sin = -across / airspeed;
  if (Math.abs(sin) >= 1) return { speed: -Infinity, crab: 90 };
  const crab = Math.asin(sin);
  return {
    speed: airspeed * Math.cos(crab) + along,
    crab: (crab * 180) / Math.PI,
  };
}

/**
 * WHICH BAND TO FLY, and it is a search rather than a rule.
 *
 * The instruction this replaces was "descend to 55 cm whenever the crab
 * passes 30 degrees", and ChatGPT was right to stop it: a crab is a
 * symptom, and diving on a symptom throws away every case where the
 * wind is HELPING. So every band is priced by what it would actually
 * buy — see `progressIn` — and the best one wins. Down in a headwind,
 * up in a tailwind, and the same arithmetic decides both.
 *
 * The margin is hysteresis: a band has to be meaningfully better than
 * the one she is in, or a gust flipping two near-equal bands would have
 * her porpoising the whole way instead of arriving.
 */
export function bestBand(
  sense: NavSense, wantedDegrees: number, cfg: AutopilotConfig,
): { agl: number; speed: number; crab: number } {
  const agl = Math.max(0, sense.altitude - sense.ground);
  let best = { agl, ...progressIn(sense.windAt(agl), sense.airspeed, wantedDegrees) };
  for (const band of bandsFor(cfg)) {
    const here = progressIn(sense.windAt(band), sense.airspeed, wantedDegrees);
    if (here.speed > best.speed + cfg.bandMargin) best = { agl: band, ...here };
  }
  return best;
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
  /** The band she has chosen, AGL in world units, and the crab it costs. */
  private band = 0;
  private crab = 0;
  /** The closest she has been, and how long since it improved. */
  private closest = Number.POSITIVE_INFINITY;
  private stale = 0;

  /**
   * The config for the leg being flown — the base, or the base with
   * this leg's own floor raised. See `engage`.
   */
  private leg: AutopilotConfig;

  constructor(cfg: AutopilotConfig = AUTOPILOT_DEFAULTS) {
    this.cfg = cfg;
    this.leg = cfg;
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
   *
   * `floorAgl` IS THE LEG'S, not a new setting. The route planner may
   * raise a leg to clear something with a top, and this is how that
   * arrives: a MINIMUM the band search may not look below, for this leg
   * only. It never picks her altitude — the search still does that,
   * above the floor. Two systems both entitled to name her height would
   * fight; one naming a floor and the other choosing over it does not.
   */
  engage(at: WorldPoint, floorAgl?: number): void {
    this.leg = floorAgl === undefined || floorAgl <= this.cfg.floorAgl
      ? this.cfg : { ...this.cfg, floorAgl };
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
    this.leg = this.cfg;
    this.target = null;
    this.state = 'idle';
    this.why = null;
    this.held = false;
  }

  /**
   * One frame. Returns the demand a thumb would have produced — plus,
   * on the surface, a request to leave it.
   */
  update(dt: number, sense: NavSense): NavCommand {
    const to = this.target;
    if (to === null || this.state === 'idle') {
      return this.report(IDLE, 0, 0, 0, 0, null);
    }

    const range = rangeTo(sense.at, to);
    const wanted = bearingTo(sense.at, to);
    // AGAINST HER TRACK, NOT HER HEADING. The difference is the whole
    // point of the file — see the header.
    const error = wrap180(wanted - sense.track);

    // ── OFF THE SURFACE FIRST ────────────────────────────────────
    // Nothing else in this file means anything to a queen standing on a
    // beach. She is asked to leave, and until she has, she is asked for
    // nothing else at all: no track, no band, no speed.
    if (!sense.aloft) {
      this.state = 'takeoff';
      this.held = false;
      // THE WATCHDOG DOES NOT RUN ON THE GROUND. `stale` measures a
      // range that has stopped improving, and a range cannot improve
      // while she is standing still waiting for her wings — she would
      // report BLOCKED for the crime of obeying the rule that keeps
      // her out of the sea.
      this.closest = Number.POSITIVE_INFINITY;
      this.stale = 0;
      this.band = this.cfg.launchAgl;
      this.crab = 0;
      // WET WINGS ARE NOT A FAILURE, they are a wait, and the second
      // of Joshua's two screenshots is exactly this: a queen on the
      // open sea with `AI wait_wings` and seven seconds on the clock.
      // The scene refuses the launch either way; saying so is what
      // makes the wait legible instead of looking like a dead
      // autopilot.
      this.why = sense.wingsWet ? 'wings'
        : sense.launchable ? null : 'reserve';
      return this.report(
        IDLE, range, wanted, error, 0, null, this.why === null,
      );
    }

    // ── AND STRAIGHT UP BEFORE ANYWHERE ELSE ─────────────────────
    // A metre of clear air under her before she is asked to travel.
    // Not fussiness: she has just left a surface, the band search is
    // about to pick a cruising altitude from the wind, and a search
    // that begins at ten centimetres would have her choose a band
    // while still inside the surf she is leaving.
    if (this.state === 'takeoff') {
      const climbed = Math.max(0, sense.altitude - sense.ground);
      if (climbed < this.cfg.launchAgl) {
        this.band = this.cfg.launchAgl;
        this.crab = 0;
        this.why = null;
        // Full lever, no push. The hover hold is what keeps this a
        // CLIMB rather than a launch across the beach: the model reads
        // an unpowered demand as a glide, and a glide from ten
        // centimetres is a landing.
        return this.report(
          { push: 0, side: 0, lift: 1, hold: HOVER_HOLD },
          range, wanted, error, 0, null,
        );
      }
      // A metre up and flying. From here it is an ordinary acquire, and
      // the no-progress watchdog starts counting from this moment
      // rather than from the beach.
      this.state = 'acquire';
      this.closest = Number.POSITIVE_INFINITY;
      this.stale = 0;
    }

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

    // ── WHICH BAND TO FLY ────────────────────────────────────────
    // Priced rather than ruled: every candidate altitude is asked what
    // ground progress it would actually buy, and the best wins. Down in
    // a headwind, UP in a tailwind — the same arithmetic decides both,
    // which is why this is a search and not "descend when the crab gets
    // big". See `bestBand`.
    const band = bestBand(sense, wanted, this.leg);
    this.band = band.agl;
    this.crab = band.crab;

    // ── TERRAIN, REACTIVELY ──────────────────────────────────────
    // Local and cheap: where the ground velocity puts her in a couple
    // of seconds, and how much air is under her there. This is NOT a
    // route profile — the island-wide planner is a later phase, and
    // pretending otherwise here would be exactly the fabricated
    // capability the brief forbids.
    const soon = this.lookAhead(sense);
    const clearance = soon ? soon.agl : null;

    // FLY THE BAND, in AGL and never in MSL. `sense.ground` is the
    // DRAWN floor the scene hands over — terrain, or the water's own
    // surface where there is water — so this is AGL over land and AWL
    // over a lake without knowing which it is looking at. An altitude
    // above sea level would put her fifty metres up a hillside and
    // three hundred over a valley for the same number.
    const agl = Math.max(0, sense.altitude - sense.ground);
    let lift = Math.max(-1, Math.min(1,
      (band.agl - agl) / Math.max(1, band.agl) * this.cfg.bandUrgency));

    // AND THE FLOOR IS NOT NEGOTIABLE. Nothing below 55 cm except a
    // landing, which this phase does not do.
    if (agl < this.leg.floorAgl) lift = Math.max(lift, this.cfg.bandUrgency);

    // TERRAIN OUTRANKS THE BAND. A tailwind two metres up is no use if
    // the ground two seconds ahead is three metres up: the lookahead
    // can only ever push the command UP, never hold her down.
    if (soon !== null && soon.agl < this.leg.floorAgl) {
      lift = Math.max(lift, Math.min(1,
        (this.leg.floorAgl - soon.agl) / this.leg.floorAgl));
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
    launch = false,
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
      band: this.band,
      crab: this.crab,
      launch,
    };
  }
}
