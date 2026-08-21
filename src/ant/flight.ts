/**
 * ASSISTED ANT FLIGHT — simple controls, believable energy underneath.
 *
 * The player steers horizontally with the stick, climbs with one button
 * and descends with the other, and looks wherever they like. Everything
 * else — airspeed, momentum, lift, sink, glide efficiency, what it all
 * costs — happens under here. She should feel like a flying ant, not a
 * helicopter pinned to a point and not an aircraft wanting six axes of
 * input from two thumbs.
 *
 * THE ONE IDEA WORTH HOLDING ON TO: altitude is stored energy.
 *
 *   descending  ->  airspeed rises, wings work less, the reserve refills
 *   climbing    ->  airspeed falls, wings work harder, the reserve drains
 *   gliding     ->  she trades height for distance at a rate that
 *                   depends on how fast she is going
 *
 * That is what makes height a survival resource: run the reserve out
 * high up and a dive can still save the flight; run it out low and she
 * lands. It is also why there is no separate flight stamina. One bar,
 * many workloads — see stamina.ts.
 *
 * NEUTRAL IS NOT A HOVER. Releasing the stick does not pin her in the
 * air; it stops asking the wings for thrust, and she glides on the
 * momentum she already had.
 *
 * ZERO IS NOT OFF. An empty reserve does not turn the wings off and
 * drop her like a brick. It drops her to minimum-power flight: still
 * steerable, sinking badly, and recoverable by diving.
 *
 * Every number here is GAME TUNING. None of it is measured fire-ant
 * flight performance, and the glide ratios especially are chosen to be
 * readable rather than true.
 */
import { REARM_AT } from './stamina';

/**
 * Where she is in the flight, as a state rather than a pile of
 * booleans. `flying = true/false` cannot tell a climb from a dying
 * glide, and those want different sounds, visuals and costs.
 */
export type FlightState =
  | 'grounded'
  /** Wings engaged, momentum carrying her, not yet properly airborne. */
  | 'takeoff'
  | 'powered'
  | 'glide'
  /** Reserve empty: minimum-power sinking flight, still steerable. */
  | 'exhausted'
  /** Deliberately trading height for airspeed and breath. */
  | 'recovery';

/** World units per second. One unit is about a centimetre. */
export const STALL_SPEED = 12;
/** Where the glide is at its flattest. */
export const BEST_GLIDE_SPEED = 30;
/** What level powered flight settles at. */
export const CRUISE_SPEED = 40;
/** Flat out, wings working. */
export const MAX_POWERED_SPEED = 70;
/** Nose down, gravity doing the work. */
export const MAX_DIVE_SPEED = 110;

/** Forward units per unit of height lost, at BEST_GLIDE_SPEED. */
export const BEST_GLIDE_RATIO = 5;
/** The floor: minimum-power flight on an empty reserve. */
export const EXHAUSTED_GLIDE_RATIO = 0.2;

/**
 * She has to be doing at least this on the ground to get airborne.
 *
 * JUST UNDER a full walk (7), not equal to it. Her ground speed eases
 * onto the pace ceiling exponentially, so it approaches 7 and never
 * arrives — setting the threshold at the ceiling itself meant a walk
 * could never take off, only a run, which is the opposite of the
 * design: crawl too slow, a proper walk enough, a run easy.
 *
 * The margin has to clear the ease in a reasonable time rather than
 * merely be smaller. At SPEED_EASE this is about four tenths of a
 * second of walking, and a test holds it there.
 */
export const TAKEOFF_SPEED = 6.5;
/** A one-off price for leaving the ground, as a fraction of the bar. */
export const TAKEOFF_COST = 0.03;
/** Airspeed she is given at the moment the wings catch. */
export const TAKEOFF_BOOST = 1.35;
/** Height above the ground at which takeoff becomes real flight. */
export const AIRBORNE_HEIGHT = 2.5;

/**
 * How briskly airspeed answers the stick. Units per second squared.
 *
 * Was 34, which took her from a walk to maximum airspeed in about two
 * seconds and read as a missile launch rather than as an ant getting
 * going. Twelve makes it roughly six seconds — she builds speed instead
 * of arriving at it.
 */
export const THRUST = 12;
/** Fraction of airspeed bled off per second with no thrust. */
export const DRAG = 0.22;
/** How hard she can haul herself upward, units per second. */
export const CLIMB_RATE = 16;
/** How hard a deliberate descent pushes the nose down. */
export const DESCENT_RATE = 26;

/**
 * THE COORDINATED TURN — what the stick's left and right actually do.
 *
 * On the ground steering is looking: her body comes onto the camera's
 * heading and a sideways push crabs. In the air that is wrong. An
 * animal with wings banks into a turn and the turn follows from the
 * bank, so lateral stick here does three things at once, the way an
 * aircraft with the rudder handled for you does:
 *
 *   100%  bank, to a ceiling of 30 degrees
 *    70%  turn — her heading actually changes
 *    30%  sidestep — she slips a little across her own path
 *
 * Level the stick and she levels out. The bank is a VISUAL and a
 * feeling; the turn is what moves her, and the slip is what stops a
 * turn feeling like a rail.
 *
 * Her heading in the air is HERS, not the camera's. That is the whole
 * difference: the player can look wherever they like while she flies
 * where she is pointed, which is what the design asks for and what
 * "steering is looking" cannot give.
 */
export const MAX_BANK = (30 * Math.PI) / 180;
/** Radians per second of heading change at full stick, before the split. */
export const FLIGHT_TURN_RATE = 1.4;
/** How much of a lateral input turns her. */
export const TURN_SHARE = 0.7;
/** How much of it slides her sideways, as a fraction of her airspeed. */
export const SIDESTEP_SHARE = 0.3;
/** How briskly the bank arrives and how briskly it lets go. */
export const BANK_EASE = 5;
/** Nose attitude per unit of climb rate. Visual only. */
export const PITCH_PER_RISE = 0.012;

/** Fractions of the reserve per second. Positive spends. */
export const CRUISE_DRAIN = 1 / 330;
export const CLIMB_DRAIN = 1 / 55;
export const FAST_DRAIN = 1 / 150;
export const GLIDE_RECOVERY = -0.005;
export const RECOVERY_DESCENT_RECOVERY = -0.018;

/**
 * A whole-model speed dial, so the feel can be found on the device
 * rather than guessed at here.
 *
 * It scales everything with the dimensions of a speed or an
 * acceleration TOGETHER — airspeeds, thrust, climb and descent rates —
 * so the shape of the model is untouched and only its tempo changes.
 * Time to reach full speed stays the same, glide angles stay the same,
 * and the ratio between a climb and a dive stays the same. A dial that
 * moved top speed without moving thrust would quietly retune the
 * acceleration too.
 *
 * TAKEOFF_SPEED deliberately does NOT scale: it is tied to her ground
 * walk, which this dial has nothing to do with.
 */
let scale = 1;

export function setFlightScale(times: number): void {
  scale = Math.max(0.1, times);
}

export function flightScale(): number {
  return scale;
}

export interface FlightDemand {
  /** Horizontal request in the CAMERA's frame, each -1 to 1. */
  readonly push: number;
  readonly side: number;
  readonly climb: boolean;
  readonly descend: boolean;
}

/** What one frame of flight did, for the caller to apply and charge. */
export interface FlightStep {
  /** Fraction of the reserve per second. Negative recovers. */
  readonly effort: number;
  /** Units per second along the camera's forward. */
  readonly ahead: number;
  /** Units per second along the camera's right. */
  readonly across: number;
  /** Signed, units per second. Negative sinks. */
  readonly rise: number;
}

/**
 * Glide ratio at a given airspeed — forward units per unit of height.
 *
 * Moderate speed glides best. Too fast and drag eats it; too slow and
 * it collapses, which is the part that matters: a queen who lets her
 * airspeed decay does not drift gently down, she falls out of the sky.
 *
 * A smooth curve rather than bands, because a band boundary is a cliff
 * the player can feel but not see.
 */
export function glideRatio(airspeed: number): number {
  if (airspeed <= 0) return EXHAUSTED_GLIDE_RATIO;
  // Dimensionless, so it reads the airspeed in UNSCALED terms: a glide
  // ratio is a shape, and the speed dial must not bend it.
  const off = airspeed / (BEST_GLIDE_SPEED * scale);
  if (off >= 1) {
    // Past best glide, drag takes it back gradually.
    const over = Math.min(1, (airspeed - BEST_GLIDE_SPEED * scale)
      / ((MAX_DIVE_SPEED - BEST_GLIDE_SPEED) * scale));
    return BEST_GLIDE_RATIO - (BEST_GLIDE_RATIO - 2.6) * over;
  }
  // Below best glide it falls away fast, and off a cliff below stall.
  const shape = off * off * off;
  return EXHAUSTED_GLIDE_RATIO + (BEST_GLIDE_RATIO - EXHAUSTED_GLIDE_RATIO) * shape;
}

export class Flight {
  private state: FlightState = 'grounded';
  private above = 0;
  private speed = 0;
  /** Where her NOSE points, in world radians. Hers, not the camera's. */
  private facing = 0;
  /** Roll, radians. Positive banks to her right. */
  private bank = 0;
  private rise = 0;

  get where(): FlightState {
    return this.state;
  }

  get height(): number {
    return this.above;
  }

  get airspeed(): number {
    return this.speed;
  }

  get climbing(): number {
    return this.rise;
  }

  /** Her nose direction, world radians. */
  get heading(): number {
    return this.facing;
  }

  /** Her roll. Positive is right wing down. */
  get roll(): number {
    return this.bank;
  }

  /**
   * Her nose attitude, from what she is doing vertically. Visual only.
   *
   * POSITIVE IS NOSE UP, matching the slope alignment on the ground —
   * where higher terrain ahead gives a positive rotation. This had the
   * sign the other way, which pointed her nose at the floor as she
   * climbed and at the sky as she dived.
   */
  get pitch(): number {
    return this.rise * PITCH_PER_RISE;
  }

  get aloft(): boolean {
    return this.state !== 'grounded';
  }

  /**
   * Whether the takeoff button should light up.
   *
   * ACTUAL ground speed, never the selected pace: choosing Run and then
   * barely moving must not offer a takeoff, and a genuine walk that
   * reaches the threshold must.
   */
  canTakeOff(groundSpeed: number, reserve: number): boolean {
    return !this.aloft && groundSpeed >= TAKEOFF_SPEED && reserve >= TAKEOFF_COST;
  }

  /**
   * Leave the ground, keeping what she had.
   *
   * No teleport upward: the wings catch, she gets a modest boost on top
   * of the speed she ran up, and her momentum carries her forward. A
   * marginal takeoff stays low and may settle straight back down, which
   * is the correct outcome rather than a failure to handle.
   *
   * @returns the reserve it cost, or 0 if she was refused
   */
  /**
   * @param facing which way she is pointed as she leaves the ground,
   *   world radians. She keeps it: a takeoff does not turn her.
   */
  takeOff(groundSpeed: number, reserve: number, facing: number): number {
    if (!this.canTakeOff(groundSpeed, reserve)) return 0;
    this.state = 'takeoff';
    this.speed = groundSpeed * TAKEOFF_BOOST;
    this.facing = facing;
    this.bank = 0;
    this.rise = CLIMB_RATE * scale * 0.5;
    this.above = 0.01;
    return TAKEOFF_COST;
  }

  /** Put her flat on the ground — landings, respawns, scene resets. */
  land(): void {
    this.state = 'grounded';
    this.above = 0;
    this.speed = 0;
    this.rise = 0;
    this.bank = 0;
  }

  /**
   * Fly one frame.
   *
   * @param reserve what is left in the bar, 0 to 1
   * @param spent whether the reserve has latched empty
   * @returns what she did and what it cost
   */
  update(demand: FlightDemand, reserve: number, spent: boolean, dt: number): FlightStep {
    if (!this.aloft) return { effort: 0, ahead: 0, across: 0, rise: 0 };

    const empty = spent || reserve <= 0;
    const asked = Math.hypot(demand.push, demand.side);
    this.steer(demand, dt);
    this.thrust(demand, asked, empty, dt);

    const effort = this.rising(demand, reserve, empty, dt);

    // One cap, chosen by what she is doing. A dive outranks everything,
    // including an empty reserve — trading height for speed is exactly
    // what an exhausted queen is supposed to reach for.
    const cap = (demand.descend ? MAX_DIVE_SPEED
      : empty ? STALL_SPEED * 1.6
        : MAX_POWERED_SPEED) * scale;
    this.speed = Math.max(0, Math.min(cap, this.speed));
    this.above = Math.max(0, this.above + this.rise * dt);

    // Along her nose, plus the slip across it. Both in HER frame; the
    // caller turns them into world travel using her heading, which is
    // why the camera can point anywhere without moving her.
    return {
      effort,
      ahead: this.speed,
      across: this.speed * SIDESTEP_SHARE * Math.max(-1, Math.min(1, demand.side)),
      rise: this.rise,
    };
  }

  /**
   * The coordinated turn: bank, yaw and slip from one lateral input.
   *
   * The bank is eased both ways, so it arrives as she rolls in and
   * bleeds off when the stick centres — levelling out on its own is
   * half of what makes this feel like a wing rather than a cursor.
   */
  private steer(demand: FlightDemand, dt: number): void {
    const side = Math.max(-1, Math.min(1, demand.side));
    this.facing += FLIGHT_TURN_RATE * TURN_SHARE * side * dt;
    const wants = MAX_BANK * side;
    this.bank += (wants - this.bank) * Math.min(1, dt * BANK_EASE);
  }

  /**
   * Backward on the stick is a BRAKE, never reverse flight. She does
   * not fly tail-first; pulling back bleeds speed off for tighter
   * low-speed handling, which is what the input is actually for.
   */
  private thrust(demand: FlightDemand, asked: number, empty: boolean, dt: number): void {
    if (empty) {
      this.speed -= this.speed * DRAG * dt;
    } else if (demand.push < -0.05) {
      this.speed -= THRUST * scale * Math.abs(demand.push) * 0.8 * dt;
    } else if (asked > 0.05) {
      this.speed += THRUST * scale * asked * dt;
    } else {
      this.speed -= this.speed * DRAG * dt;
    }
    this.speed = Math.max(0, this.speed);
  }

  /**
   * Decide the vertical, pick the state, and price it.
   *
   * Order matters and encodes the design: a takeoff still in progress
   * outranks everything, a descent is always available (it is the
   * escape hatch), a climb needs a reserve to pay for it, and an empty
   * reserve sinks rather than stops.
   */
  private rising(
    demand: FlightDemand, reserve: number, empty: boolean, dt: number,
  ): number {
    // Still leaving the ground. Held here rather than in the branches
    // below, which would each overwrite it before it could be read.
    if (this.state === 'takeoff') {
      this.rise = CLIMB_RATE * scale * 0.5;
      if (this.above + this.rise * dt >= AIRBORNE_HEIGHT) this.state = 'powered';
      return CRUISE_DRAIN;
    }

    if (demand.descend) {
      this.rise = -DESCENT_RATE * scale;
      // Diving converts height into airspeed, which is the whole trick.
      this.speed += DESCENT_RATE * scale * 0.55 * dt;
      // A descent counts as RECOVERY only when she actually needs it.
      // Naming it off the reserve rather than off the button means the
      // state describes her situation, not the player's thumb.
      const desperate = empty || reserve < REARM_AT;
      this.state = desperate ? 'recovery' : 'glide';
      return desperate ? RECOVERY_DESCENT_RECOVERY : GLIDE_RECOVERY * 1.6;
    }

    if (demand.climb && !empty) {
      this.rise = CLIMB_RATE * scale;
      this.state = 'powered';
      // A climb is not free: it costs airspeed as well as breath.
      this.speed = Math.max(0, this.speed - CLIMB_RATE * scale * 0.45 * dt);
      return CLIMB_DRAIN;
    }

    if (empty) {
      // Minimum-power flight: hers to steer, but she is coming down.
      // Zero stamina must never mean the wings switch off.
      this.state = 'exhausted';
      const sinking = Math.max(EXHAUSTED_GLIDE_RATIO, glideRatio(this.speed) * 0.35);
      this.rise = -this.speed / sinking;
      return GLIDE_RECOVERY * 0.4;
    }

    const asked = Math.hypot(demand.push, demand.side);
    if (asked > 0.05) {
      this.state = 'powered';
      // Powered flight holds height, easing rather than snapping level.
      this.rise += (0 - this.rise) * Math.min(1, dt * 3);
      return this.speed > CRUISE_SPEED * scale ? FAST_DRAIN : CRUISE_DRAIN;
    }

    // Neutral is a GLIDE, not a hover. She keeps her momentum and pays
    // for distance in height at whatever ratio her airspeed earns.
    this.state = 'glide';
    this.rise = -this.speed / Math.max(0.1, glideRatio(this.speed));
    return GLIDE_RECOVERY;
  }
}
