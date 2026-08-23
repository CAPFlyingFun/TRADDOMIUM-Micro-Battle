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
import { Wander } from './wander';

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

/**
 * AIRSPEED AS A POWER SETTING — five notches of twenty per cent.
 *
 * A DISPLAY UNIT, not a control and not a model. The wings do not have
 * a throttle; she has a commanded airspeed, and this is that airspeed
 * said in the language a pilot reads without arithmetic. Nothing
 * downstream of the readout uses it.
 *
 * Exact centimetres per second are the wrong number to put in front of
 * someone flying: 41.6 tells you nothing you can act on, and the digit
 * that keeps changing is the one that matters least. Five notches
 * against a floor is a glance.
 */
export const POWER_STEP = 20;

/**
 * The notch below which she is sinking rather than cruising.
 *
 * NOT AN INVENTED FIGURE, though it is a rounded one. Best glide is
 * 30 units per second, which is 43% of full power — the least speed at
 * which the wings still hold her up efficiently, and below it she
 * trades height whatever she does. That lands between the 40 and 60
 * notches, and 40 is the honest side to round it to.
 *
 * It is a MARK on the readout and not a rule in the model: she does
 * not fall out of the sky at 39%, she sinks, and the stall proper is
 * lower still at STALL_SPEED. The band says "you are descending now",
 * which is true, rather than "you are about to stop flying", which
 * would not be.
 */
export const POWER_FLOOR = 40;

/** Her airspeed as a percentage of full power, to the nearest notch. */
export function powerOf(airspeed: number): number {
  const share = (Math.abs(airspeed) / MAX_POWERED_SPEED) * 100;
  const notched = Math.round(share / POWER_STEP) * POWER_STEP;
  return Math.max(0, Math.min(100, notched));
}
/** Nose down, gravity doing the work. */
export const MAX_DIVE_SPEED = 110;

/**
 * What Auto holds at each pace, in world units per second.
 *
 * NOT the ground pace speeds. A crawl is 2.2 units/s, which is not a
 * flight — an ant that slow is not flying, she is falling with her
 * wings out. Flight has its own scale, so Auto has its own targets on
 * it, anchored to the numbers the model already uses: cruise is what
 * powered flight settles at, run is flat out.
 */
export const AUTO_AIRSPEED = { crawl: 20, walk: CRUISE_SPEED, run: MAX_POWERED_SPEED };

/**
 * UNPOWERED TERMINAL FALL, world units per second — 1.78 m/s.
 *
 * PROVISIONAL, AND NOT MEASURED FIRE-ANT DATA. I could find no
 * published terminal velocity for a Solenopsis invicta queen
 * specifically. This is an insect-scale figure of the right order:
 * small insects fall slowly because drag scales with area while weight
 * scales with volume, which is the same reason they survive the
 * landing. Treat it as game tuning with a plausible basis, and replace
 * it if a real measurement turns up.
 *
 * It is a CEILING on passive descent, not a speed she is dropped at.
 */
export const TERMINAL_FALL = 178;

/**
 * How quickly vertical speed answers a change in what is holding her
 * up. Seconds, as a time constant rather than a per-frame fraction.
 */
export const SINK_EASE = 1.1;

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

/**
 * HOW FAR SHE TIPS TO GO FASTER OR SLOWER — the cyclic, in radians.
 *
 * She had roll and no pitch from the stick, which made her a thing
 * that banked into turns and then accelerated flat, like a cursor with
 * a tilt animation. A helicopter tips its disc the way it wants to go;
 * so does a flying insect, and for the same reason — the lift vector
 * has to point somewhere other than straight up for her to change
 * speed at all. Nose down to gain it, nose up to shed it.
 *
 * Eighteen degrees against the thirty of MAX_BANK: enough to read
 * clearly from behind at this camera distance, short of the attitude
 * that would look like a dive rather than an acceleration.
 *
 * VISUAL, like the climb term it adds to. Attitude does not feed back
 * into the speed it came from — she tips because she is accelerating,
 * she does not accelerate because she tipped, and closing that loop
 * would be a different flight model rather than a nicer-looking one.
 */
export const MAX_TILT = (18 * Math.PI) / 180;

/** How briskly the tip arrives and lets go. Slower than the bank. */
export const TILT_EASE = 4;

/**
 * The most she will ever be drawn tipped, radians.
 *
 * The climb term is unbounded by construction — a long dive drives it
 * as far as the sink rate goes — and adding the cyclic on top of that
 * can put her past vertical, at which point the model is drawn
 * standing on its nose. Sixty degrees is well beyond anything ordinary
 * flight reaches, so the clamp only ever catches the absurd case.
 */
export const MAX_PITCH = (60 * Math.PI) / 180;

/**
 * HOW LONG SHE CAN STAY UP — anchored to a measurement, at last.
 *
 * Markin et al. followed *S. invicta* mating flights with aircraft and
 * light traps and found that FEMALES REMAINED ALOFT THIRTY MINUTES OR
 * LESS, with 95% back on the ground inseminated.
 *
 *   [Markin GP, Dillier JH, Hill SO, Blum MS, Hermann HR (1971).
 *    Nuptial flight and flight ranges of the imported fire ant,
 *    Solenopsis saevissima richteri. J. Georgia Entomol. Soc. 6:145–156,
 *    as reported in Gui et al. 2010, J. Insect Sci. 10:19.]
 *
 * So a full reserve now buys thirty minutes of cruising rather than the
 * five and a half it used to. That is a sixfold change and it is not a
 * tuning nudge: the old number was invented, and this one is the
 * animal's.
 *
 * THE OTHER TWO ARE STILL GAME TUNING, and are set as multiples of the
 * cruise so the relationship survives the next re-anchoring:
 *
 *   cruise   1800 s   measured
 *   flat out  900 s   twice the cost of cruising
 *   climbing  300 s   six times — hauling herself upward is the
 *                     expensive thing an insect does
 *
 * WHAT THIS COSTS IN RANGE, written down so nobody has to re-derive it:
 * thirty minutes at her 0.70 m/s top airspeed is 1.26 km of still air.
 * Vogt et al. (2000) flew *S. invicta* females on a mill and got LESS
 * THAN 5 km, so 1.26 sits comfortably under the ceiling — consistent,
 * at the low end, and the two figures come from different experiments
 * rather than one flight, so they should not be multiplied together.
 */

/** Seconds of level powered flight a full reserve buys. MEASURED. */
export const CRUISE_SECONDS = 30 * 60;

/** Fractions of the reserve per second. Positive spends. */
export const CRUISE_DRAIN = 1 / CRUISE_SECONDS;
export const CLIMB_DRAIN = 6 / CRUISE_SECONDS;
export const FAST_DRAIN = 2 / CRUISE_SECONDS;
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
  /**
   * AUTO: hold this AIRSPEED without the stick, world units per second.
   *
   * Airspeed, and the distinction is the point. Auto removes the need
   * to keep a thumb on forward; it is not an autopilot and it does not
   * know where she is going. Into a headwind stronger than she is, Auto
   * holds her at full power flying forwards and she goes backwards over
   * the island — because that is what happens, and hiding it would mean
   * secretly giving her an engine she has not got.
   */
  readonly hold?: number | null;
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
  /** Nose attitude asked for by the stick, radians. Positive is up. */
  private tilt = 0;
  private rise = 0;
  /**
   * The air she is in, as a vertical rate — see wander.ts.
   *
   * HELD APART FROM `rise` ON PURPOSE. `rise` is a state the model
   * eases toward a target, so folding a disturbance into it would
   * compound: next frame's ease starts from the disturbed value and the
   * wander leaks into her real rate. This is added at the points of
   * USE, and only there, so the model's own vertical is untouched and
   * the disturbance stays exactly as bounded as its own maths says.
   */
  private readonly air = new Wander();
  private drift = 0;

  get where(): FlightState {
    return this.state;
  }

  get height(): number {
    return this.above;
  }

  get airspeed(): number {
    return this.speed;
  }

  /**
   * WHAT SHE IS ACTUALLY DOING VERTICALLY: the model's rate plus the
   * air's. The one number everything downstream should ask for.
   */
  get climbing(): number {
    return this.rise + this.drift;
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
    const total = this.climbing * PITCH_PER_RISE + this.tilt;
    return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, total));
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
    this.tilt = 0;
    this.rise = CLIMB_RATE * scale * 0.5;
    this.above = 0.01;
    this.air.reset();
    this.drift = 0;
    return TAKEOFF_COST;
  }

  /**
   * PUT HER IN THE AIR, level, at a height and a heading — the only
   * way to restore an airborne position fix (see ui/fix.ts).
   *
   * Not a gameplay move and not reachable from the controls: a fix
   * says "the camera was here, this high, pointed this way", and the
   * model has no other door that takes a height. Level and at cruise,
   * because a fix records where she was rather than what she was
   * doing, and level is the one attitude that does not immediately
   * change the first of those.
   */
  hold(above: number, facing: number): void {
    this.state = 'powered';
    this.above = Math.max(0.01, above);
    this.speed = CRUISE_SPEED;
    this.facing = facing;
    this.bank = 0;
    this.tilt = 0;
    this.rise = 0;
    this.air.reset();
    this.drift = 0;
  }

  /** Put her flat on the ground — landings, respawns, scene resets. */
  land(): void {
    this.state = 'grounded';
    this.above = 0;
    this.speed = 0;
    this.rise = 0;
    this.drift = 0;
    this.bank = 0;
    this.tilt = 0;
    this.air.reset();
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
    // The air, once a frame, after the model has had its say. A takeoff
    // is a scripted climb off the soil and does not get jostled.
    this.drift = this.state === 'takeoff' ? 0 : this.air.advance(dt);

    // One cap, chosen by what she is doing. A dive outranks everything,
    // including an empty reserve — trading height for speed is exactly
    // what an exhausted queen is supposed to reach for.
    const cap = (demand.descend ? MAX_DIVE_SPEED
      : empty ? STALL_SPEED * 1.6
        : MAX_POWERED_SPEED) * scale;
    this.speed = Math.max(0, Math.min(cap, this.speed));
    this.above = Math.max(0, this.above + this.climbing * dt);

    // Along her nose, plus the slip across it. Both in HER frame; the
    // caller turns them into world travel using her heading, which is
    // why the camera can point anywhere without moving her.
    return {
      effort,
      ahead: this.speed,
      across: this.speed * SIDESTEP_SHARE * Math.max(-1, Math.min(1, demand.side)),
      rise: this.climbing,
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
    // MINUS. A positive heading turns her toward +X while the slip term
    // pushes toward -X, so the two were pulling opposite ways and the
    // stick turned her the wrong way — Joshua flew it and the roll was
    // right while the yaw was mirrored. One sign fixes both: she now
    // turns the way the stick points AND slips the same way she turns,
    // which is what "30% sidestep in that direction" asked for.
    this.facing -= FLIGHT_TURN_RATE * TURN_SHARE * side * dt;
    const wants = MAX_BANK * side;
    this.bank += (wants - this.bank) * Math.min(1, dt * BANK_EASE);

    // THE CYCLIC. Forward on the stick tips her nose DOWN — the sign
    // is the whole content of the line, and it is the way round a
    // helicopter works: you point the lift where you want to go, so
    // asking for speed lowers the nose and asking to slow raises it.
    // The same expression covers the brake, because a brake is
    // negative push.
    //
    // Nothing here in Auto, and that is right rather than an omission:
    // Auto holds a speed, and something holding a speed is not
    // accelerating, so it flies level.
    const push = Math.max(-1, Math.min(1, demand.push));
    this.tilt += (-MAX_TILT * push - this.tilt) * Math.min(1, dt * TILT_EASE);
  }

  /**
   * Backward on the stick is a BRAKE, never reverse flight. She does
   * not fly tail-first; pulling back bleeds speed off for tighter
   * low-speed handling, which is what the input is actually for.
   */
  private thrust(demand: FlightDemand, asked: number, empty: boolean, dt: number): void {
    const hold = demand.hold ?? null;
    if (empty) {
      this.speed -= this.speed * DRAG * dt;
    } else if (demand.push < -0.05) {
      this.speed -= THRUST * scale * Math.abs(demand.push) * 0.8 * dt;
    } else if (asked > 0.05) {
      this.speed += THRUST * scale * asked * dt;
    } else if (hold !== null && hold > 0) {
      // AUTO: fly AT a speed rather than hold a stick position.
      //
      // Holding an arbitrary stick percentage would give a different
      // speed on every dial setting and every wind, and would sit at
      // full thrust forever once it reached the cap. A target closes
      // the gap and then stops — accelerating hard when far off, easing
      // in as it arrives, and answering drag on its own. Exponential
      // rather than a fixed step per frame, so a phone at 30 fps and a
      // probe at 4 reach the same speed at the same simulated moment.
      const gap = hold * scale - this.speed;
      this.speed += gap * (1 - Math.exp(-dt * (THRUST * scale) / Math.max(1, hold * scale)));
    } else {
      this.speed -= this.speed * DRAG * dt;
    }
    this.speed = Math.max(0, this.speed);
  }

  /**
   * How much of her weight the wings are still carrying, 0 to 1.
   *
   * One at a healthy airspeed, nothing at all at a standstill. Squared
   * because lift goes with the square of airspeed, which also makes the
   * hand-over gentle at the top and decisive at the bottom — she does
   * not fall out of a fast glide, and she does not hang at zero.
   */
  private lift(): number {
    const flying = this.speed / Math.max(1e-6, STALL_SPEED * scale);
    const held = Math.min(1, Math.max(0, flying));
    return held * held;
  }

  /**
   * Ease the vertical toward a target sink, frame-rate independently.
   *
   * A queen has mass. Losing her wings does not switch her descent to
   * terminal velocity between two frames; it takes it away over about a
   * second, which is what this is for.
   */
  private sinkToward(target: number, dt: number): void {
    this.rise += (target - this.rise) * (1 - Math.exp(-dt / SINK_EASE));
  }

  /**
   * The passive descent at the current airspeed.
   *
   * A GLIDE while she has speed to glide on, a FALL when she has not,
   * and a smooth hand-over between the two. The old model was the first
   * half alone — `sink = airspeed / glideRatio` — which is right at
   * speed and absurd at rest: as airspeed decayed toward zero, so did
   * the sinking, so a queen who stopped asking for anything eventually
   * hung motionless in the sky. Nothing hangs in the sky.
   */
  private passiveSink(): number {
    const held = this.lift();
    const glide = this.speed / Math.max(0.1, glideRatio(this.speed));
    return glide * held + TERMINAL_FALL * scale * (1 - held);
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
      const held = this.lift();
      const target = -Math.min(
        TERMINAL_FALL * scale,
        (this.speed / sinking) * held + TERMINAL_FALL * scale * (1 - held),
      );
      this.sinkToward(target, dt);
      return GLIDE_RECOVERY * 0.4;
    }

    const asked = Math.hypot(demand.push, demand.side);
    // AUTO IS POWERED FLIGHT. Without this it read as neutral, so Auto
    // would have held the airspeed while the model sank as though she
    // were gliding on it — thrust and lift disagreeing about whether
    // the wings were working.
    const powered = asked > 0.05 || (demand.hold ?? 0) > 0;
    if (powered) {
      this.state = 'powered';
      // Powered flight holds height, easing rather than snapping level.
      this.rise += (0 - this.rise) * Math.min(1, dt * 3);
      return this.speed > CRUISE_SPEED * scale ? FAST_DRAIN : CRUISE_DRAIN;
    }

    // Neutral is a GLIDE while there is airspeed to glide on, and a
    // fall once there is not. Never a hover.
    this.state = 'glide';
    this.sinkToward(-Math.min(TERMINAL_FALL * scale, this.passiveSink()), dt);
    return GLIDE_RECOVERY;
  }
}
