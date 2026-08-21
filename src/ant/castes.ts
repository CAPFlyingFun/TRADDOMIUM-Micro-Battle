/**
 * CASTE STATS — Path of Titans' curve-override shape, fitted to ants.
 *
 * Every stat is a curve of FIVE points across the creature's GROWTH,
 * read left to right, exactly as PoT's CurveOverrides.ini does it. That
 * shape is worth copying for one reason above all: a caste is then a
 * data file rather than a branch in the movement code. Adding the major
 * later should be adding numbers, not adding `if (caste === …)`.
 *
 * TWO AXES, NOT ONE. The first draft of this file had a single curve
 * doing both jobs, and it broke immediately: "Alate → Founding → First
 * brood → Established → Mature" is a QUEEN'S LIFE, not a size. A queen
 * is already full-grown when she founds, and a small young queen and a
 * huge laying one can both be starving or both be sealed in. So:
 *
 *   GROWTH      young → adult. What her BODY can do at that size.
 *   LIFE STATE  alate → mature colony. What she is DOING with it.
 *
 *   value = sample(growthCurve, growth) × lifeState.scale[stat]
 *
 * One rule, applied everywhere, so there is never a second competing
 * tuning system to keep in step. See `statOf`.
 *
 * The split also kills a real bug by construction. The old file said
 * hunger stops while she is sealed in — and wrote the zero at curve
 * index 2, which was "first brood", a stage where she is emphatically
 * not sealed in. The claim now lives on the founding STATE, where it
 * cannot drift onto a neighbour.
 *
 * WHAT IS DELIBERATELY NOT COPIED: PoT ships roughly 150 lines per
 * creature, most of them 1,1,1,1,1 placeholders for systems it has and
 * we do not. This is the honest subset, grouped the same way so a line
 * can be added the day the mechanic behind it exists.
 *
 * NOTHING HERE IS WIRED INTO MOVEMENT. `WIRED` names the four stats the
 * live constants in pace.ts and stamina.ts already answer for, and a
 * test holds this file to them at one named reference point. Everything
 * else is recorded design: real once the mechanic exists, inert until
 * then — the same rule the HUD follows.
 *
 * SOURCING. Body length, mass and claustral founding behaviour are
 * commonly reported for Solenopsis invicta and are used as-is. Anything
 * with no biological meaning — health points, damage, recovery rates —
 * is GAME TUNING chosen to sit in that shape, and says so.
 */

/** A stat across growth: five points, youngest first. */
export type Curve = readonly [number, number, number, number, number];

/** A female's job in the colony. */
export type Caste = 'queen' | 'worker' | 'major';

/**
 * What the five curve points mean. Shared by every caste, because it is
 * a body growing rather than a life happening — the worker and the
 * major will use these same five words.
 *
 * A real ant ecloses at its final size and never grows again; this is a
 * GAME progression, and calling it that here is cheaper than letting a
 * future reader mistake it for biology.
 */
export const GROWTH_STAGES = [
  'young', 'growing', 'adolescent', 'subAdult', 'adult',
] as const;
export type Growth = typeof GROWTH_STAGES[number];

/**
 * Where a queen is in her life. Independent of how big she is: she
 * reaches `adult` before she ever flies, and every state after that
 * happens at full size.
 */
export const QUEEN_STATES = [
  'alateUnmated', 'alateMated', 'founding',
  'firstBrood', 'established', 'matureColony',
] as const;
export type QueenState = typeof QUEEN_STATES[number];

export interface LifeState {
  readonly name: string;
  /** Whether she still HAS wings. She sheds them to found, for good. */
  readonly winged: boolean;
  /**
   * Multiplied onto the growth-curve value. A stat missing from here
   * scales by 1 — the table lists what this state CHANGES, so reading
   * it tells you what the state is about.
   */
  readonly scale: Readonly<Partial<Record<string, number>>>;
}

export interface CasteStats {
  readonly caste: Caste;
  readonly species: string;
  readonly attributes: Readonly<Record<string, Curve>>;
  /**
   * SITUATIONAL scalars — resting, in the nest, sprinting. A different
   * axis from the life states: these change minute to minute, a life
   * state changes once and does not come back.
   */
  readonly multipliers: Readonly<Record<string, Curve>>;
  readonly combat: Readonly<Record<string, Curve>>;
  /**
   * INERT. Flight is not built and is not being built yet; these slots
   * exist so the day it lands there is a place for the numbers, and so
   * the shape of the queen's arc (she can fly, then permanently cannot)
   * is written down rather than remembered.
   */
  readonly flight: Readonly<Record<string, Curve>>;
  /** Null for castes whose life is one long state. */
  readonly states: Readonly<Record<string, LifeState>> | null;
}

/**
 * Read a curve at a growth of 0 to 1.
 *
 * Straight lines between the five points rather than a spline: a spline
 * can overshoot between its knots, and a stat that dips below the value
 * either side of it is a bug nobody would think to look for.
 */
export function sample(curve: Curve, growth: number): number {
  const at = Math.min(1, Math.max(0, growth)) * (curve.length - 1);
  const low = Math.floor(at);
  const high = Math.min(curve.length - 1, low + 1);
  return curve[low] + (curve[high] - curve[low]) * (at - low);
}

/** Find a stat's curve wherever it is grouped. */
export function curveOf(stats: CasteStats, name: string): Curve {
  const found = stats.attributes[name] ?? stats.multipliers[name]
    ?? stats.combat[name] ?? stats.flight[name];
  // Loudly, rather than handing back a NaN that spreads: a typo here
  // would otherwise surface as a speed of zero somewhere far away.
  if (!found) throw new Error(`no such stat: ${name}`);
  return found;
}

/**
 * THE ONE RESOLUTION RULE: body size, then what she is doing with it.
 *
 * @param growth 0 (young) to 1 (adult)
 * @param state a life state, or undefined for "whatever her body says"
 */
export function statOf(
  stats: CasteStats,
  name: string,
  growth: number,
  state?: LifeState,
): number {
  return sample(curveOf(stats, name), growth) * (state?.scale[name] ?? 1);
}

/**
 * THE FIRE ANT QUEEN.
 *
 * Her arc is the reason to write her first: it is not a size curve, so
 * it forces the format to carry something other than "bigger numbers
 * later". She grows to a winged alate, flies once, sheds her wings to
 * found, spends weeks sealed in a chamber living off her own flight
 * muscles, and ends an immobile egg factory the colony feeds.
 *
 * Growth counts up. The life states are where she gets slower, heavier,
 * tougher and finally stops being able to walk anywhere worth walking.
 */
export const QUEEN: CasteStats = {
  caste: 'queen',
  species: 'Solenopsis invicta',

  attributes: {
    /**
     * Millimetres, nose to gaster. A mated S. invicta queen is commonly
     * reported around 8-10 mm, which is the ADULT end. The young end is
     * a game choice: 5.5 mm is small enough to read as a different
     * animal beside a 10 mm adult — 1.8× in length is roughly 6× in
     * volume — while still being an ant rather than a speck.
     *
     * The steps shrink as she goes (1.3, 1.2, 1.1, 0.9) so the earliest
     * stages, where the player is looking hardest, change the most.
     * Her gaster swelling with laying is a STATE, not more growth.
     */
    bodyLength: [5.5, 6.8, 8.0, 9.1, 10.0],

    /** Milligrams at adult. Mass is where founding hurts — see states. */
    mass: [3.5, 6.0, 9.0, 12.0, 14.0],

    /** Game tuning. She is not a fighter; she is an investment. */
    maxHealth: [30, 50, 75, 100, 120],

    /**
     * Seconds of sprint — the reserve IS a clock, so it is stored as
     * one. Adult meets SPRINT_SECONDS exactly; a test holds it there.
     * That also means the cost of a sprint is one second per second by
     * definition, so there is no second "sprint cost" number to drift.
     */
    maxStamina: [3.5, 4.2, 4.9, 5.5, 6.0],

    /** Multiplies the pace ceilings in pace.ts. Adult meets them. */
    speed: [0.72, 0.82, 0.9, 0.96, 1.0],
    sprintSpeed: [0.7, 0.8, 0.89, 0.95, 1.0],

    /** How wide a line she takes. Higher is wider — she gets heavy. */
    turnRadius: [0.6, 0.72, 0.84, 0.92, 1.0],

    /** Chitin. Game tuning. */
    armour: [0.6, 0.75, 0.85, 0.95, 1.0],

    /** Fraction of the reserve per second. Adult meets RECOVER_SECONDS. */
    staminaRecovery: [0.105, 0.096, 0.088, 0.08, 0.0714],
    /** Points per second. Game tuning; small things mend quickly. */
    healthRecovery: [1.4, 1.3, 1.2, 1.1, 1.0],

    /** What she can hold. Game tuning, arbitrary units. */
    maxHunger: [40, 60, 80, 100, 120],
    maxThirst: [30, 45, 60, 80, 100],
    /** Per second, at full size. Founding zeroes both — see states. */
    hungerRate: [0.018, 0.022, 0.026, 0.028, 0.03],
    thirstRate: [0.018, 0.022, 0.026, 0.028, 0.03],

    /** Times her own mass. Game tuning; she is a poor hauler. */
    carry: [3.0, 2.6, 2.2, 1.8, 1.5],

    /** Voxels per second. Capacity — whether she digs is a state. */
    dig: [0.3, 0.5, 0.7, 0.85, 1.0],

    /**
     * Eggs per day her body COULD lay. A mature S. invicta queen is
     * commonly reported on the order of 1,500 a day; every stage before
     * that is a fraction of it, and the fraction is the state's job.
     */
    eggsPerDay: [0, 0, 200, 800, 1500],

    /** Growth per second of play. Tuning — young to adult in ~2 hours. */
    growthPerSecond: [0.00014, 0.00014, 0.00014, 0.00014, 0],
  },

  multipliers: {
    /** Standing still catches her breath faster. Matches RESTING_BONUS. */
    'staminaRecovery.resting': [2.2, 2.2, 2.2, 2.2, 2.2],
    'staminaRecovery.walking': [1.0, 1.0, 1.0, 1.0, 1.0],
    'staminaRecovery.running': [0.8, 0.8, 0.8, 0.8, 0.8],
    /** Nothing comes back while she is spending it. */
    'staminaRecovery.sprinting': [0, 0, 0, 0, 0],

    /** She heals fastest at home, which is where she is meant to be. */
    'healthRecovery.inNest': [1.6, 1.6, 2.0, 2.4, 2.4],
    'healthRecovery.resting': [1.15, 1.15, 1.15, 1.15, 1.15],

    /** Caught still, she cannot defend herself. Worse the bigger she is. */
    'incomingDamage.resting': [1.3, 1.4, 1.6, 1.8, 2.0],
  },

  combat: {
    /** Game tuning. Her jaws are for digging and carrying brood. */
    biteDamage: [2, 3, 4, 6, 8],
    biteCooldown: [1.0, 1.1, 1.2, 1.4, 1.6],

    /**
     * The fire ant's actual weapon is the sting, not the bite — the
     * bite is a grip that anchors it. Alkaloid venom, and the reason
     * the species is named for fire. It out-damages the bite at every
     * size, which is the one combat fact this species has to get right.
     */
    stingDamage: [3, 5, 7, 9, 14],
    stingCooldown: [2.2, 2.3, 2.5, 3.0, 3.4],
    /** Venom dealt per second after a sting lands. Game tuning. */
    venomRate: [0.4, 0.5, 0.6, 0.8, 1.0],
  },

  flight: {
    /** INERT. Multiplies a flight speed that does not exist yet. */
    flightSpeed: [0, 0, 0, 0.8, 1.0],
    /** INERT. World units per second climbed under power. */
    climbRate: [0, 0, 0, 20, 30],
    /**
     * INERT. How many times faster the reserve drains at full airspeed
     * than at a sprint on the ground. There is ONE stamina pool: flight
     * spends the same reserve running does, so there is one number to
     * tune, one bar to read, and no way for the two to disagree about
     * how tired she is.
     */
    flightDrain: [0, 0, 0, 1.6, 1.4],
  },

  states: {
    alateUnmated: {
      name: 'Alate',
      winged: true,
      // The lightest and quickest she will ever be, and the only time
      // she has nothing to protect.
      scale: {
        speed: 1.15,
        sprintSpeed: 1.2,
        maxStamina: 1.1,
        dig: 0.4,
        eggsPerDay: 0,
      },
    },

    alateMated: {
      name: 'Mated alate',
      winged: true,
      // THE REFERENCE POINT. Everything scales by 1 here on purpose:
      // this is the ant the live constants describe, so the data file
      // and the game meet at exactly one place and a test can say so.
      scale: { dig: 0.6, eggsPerDay: 0 },
    },

    founding: {
      name: 'Founding',
      winged: false,
      // Sealed in, wings gone, digesting her own flight muscles. She
      // loses a third of her mass and has no way to spend food or water
      // because there is none to spend — a hunger clock here would be a
      // countdown with no answer, which the project rule forbids.
      scale: {
        mass: 0.68,
        maxHealth: 0.85,
        speed: 0.8,
        sprintSpeed: 0.75,
        maxStamina: 0.7,
        hungerRate: 0,
        thirstRate: 0,
        healthRecovery: 0.5,
        armour: 1.1,
        // She digs exactly one chamber, and it is the whole job.
        dig: 1.0,
        // Her first eggs, laid in the dark on borrowed tissue.
        eggsPerDay: 0.01,
        flightSpeed: 0,
        climbRate: 0,
        flightDrain: 0,
      },
    },

    firstBrood: {
      name: 'First brood',
      winged: false,
      // The workers are out and foraging, so food exists again, but she
      // is still the thinnest she has been.
      scale: {
        mass: 0.72,
        maxHealth: 0.9,
        speed: 0.85,
        sprintSpeed: 0.8,
        maxStamina: 0.75,
        hungerRate: 0.6,
        thirstRate: 0.6,
        armour: 1.1,
        carry: 0.8,
        dig: 0.3,
        eggsPerDay: 0.05,
        flightSpeed: 0,
        climbRate: 0,
        flightDrain: 0,
      },
    },

    established: {
      name: 'Established',
      winged: false,
      scale: {
        mass: 0.95,
        maxHealth: 1.3,
        speed: 0.7,
        sprintSpeed: 0.65,
        maxStamina: 0.6,
        turnRadius: 1.4,
        armour: 1.6,
        hungerRate: 1.2,
        thirstRate: 1.2,
        healthRecovery: 1.6,
        carry: 0.4,
        dig: 0.1,
        eggsPerDay: 0.35,
        'incomingDamage.resting': 1.3,
        flightSpeed: 0,
        climbRate: 0,
        flightDrain: 0,
      },
    },

    matureColony: {
      name: 'Mature colony',
      winged: false,
      // An egg factory the colony carries. The gaster swells past the
      // adult body length, she cannot haul anything, and being caught
      // at rest is the way she dies.
      scale: {
        bodyLength: 1.1,
        mass: 1.3,
        maxHealth: 1.7,
        speed: 0.4,
        sprintSpeed: 0.35,
        maxStamina: 0.4,
        turnRadius: 2.0,
        armour: 2.5,
        hungerRate: 1.6,
        thirstRate: 1.6,
        healthRecovery: 2.4,
        carry: 0,
        dig: 0,
        eggsPerDay: 1.0,
        biteDamage: 0.6,
        stingDamage: 0.6,
        'incomingDamage.resting': 1.6,
        flightSpeed: 0,
        climbRate: 0,
        flightDrain: 0,
      },
    },
  },
};

/**
 * Where the data file and the running game meet.
 *
 * The live ant is a full-grown mated alate, so every scale at that
 * state is 1 and the adult end of each curve is the live constant
 * itself. Naming the point rather than writing an index is the whole
 * lesson of the last bug: an index silently means whatever the array
 * has drifted to.
 */
export const LIVE_GROWTH = 1;
export const LIVE_STATE: QueenState = 'alateMated';

/**
 * The stats the game's live constants already answer for. This file
 * must AGREE with them at the reference point above, or it is quietly
 * lying about the game rather than describing it; a test says so.
 *
 * Everything else in the tables is recorded design, inert until the
 * mechanic behind it exists. Moving those numbers changes nothing.
 */
/**
 * The bridge between this file and the running game.
 *
 * Anything that wants a number for the ant the player is actually
 * driving asks here, so there is exactly one place that knows which
 * growth and which state "live" means — and changing it is one edit
 * rather than a hunt.
 */
export function liveStat(name: string, stats: CasteStats = QUEEN): number {
  return statOf(stats, name, LIVE_GROWTH, stats.states?.[LIVE_STATE]);
}

export const WIRED = [
  'maxStamina',
  'speed',
  'sprintSpeed',
  'staminaRecovery',
] as const;

export const CASTES: Readonly<Record<Caste, CasteStats | null>> = {
  queen: QUEEN,
  // Next, in this order: the worker carries the game, the major is the
  // one that changes combat. Both follow this exact shape — and both
  // get `states: null`, because a worker's life is one long state.
  worker: null,
  major: null,
};

/**
 * THE MALE IS NOT A CASTE.
 *
 * He is a sex. Folding him into `Caste` would put him in every switch
 * over a colony job he does not have, and every one of those switches
 * would need a branch meaning "not one of those". He gets his own
 * handle here so the domain is written down, and his own stat table the
 * day he exists — a short one: he flies once, mates, and dies.
 */
export interface Male {
  readonly sex: 'male';
  readonly species: string;
  readonly stats: CasteStats | null;
}

export const MALE: Male = {
  sex: 'male',
  species: 'Solenopsis invicta',
  stats: null,
};
