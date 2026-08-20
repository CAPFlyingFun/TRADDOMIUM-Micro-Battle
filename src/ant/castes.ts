/**
 * CASTE STATS — Path of Titans' curve-override shape, fitted to ants.
 *
 * Every stat is a curve of FIVE points across the creature's growth,
 * read left to right, exactly as PoT's CurveOverrides.ini does it. That
 * shape is worth copying for one reason above all: a caste is then a
 * data file rather than a branch in the movement code. Adding the major
 * later should be adding numbers, not adding `if (caste === …)`.
 *
 * WHAT IS DELIBERATELY NOT COPIED: PoT ships roughly 150 lines per
 * creature, most of which are 1,1,1,1,1 placeholders for systems it has
 * and we do not — flying, diving, bone breaks, tail fans. Copying those
 * would be pretending to a depth that is not here. This is the honest
 * subset, grouped the same way so a line can be added the day the
 * mechanic behind it exists.
 *
 * WIRED tells you which of these the game reads TODAY. Everything else
 * is recorded design, not live tuning, and moving it changes nothing
 * until the mechanic lands. That is the same rule the HUD follows: an
 * unbuilt thing must not look like it works.
 *
 * SOURCING. Body length, mass and the claustral founding behaviour are
 * commonly reported for Solenopsis invicta and are used as-is. Anything
 * with no biological meaning — health points, damage, recovery rates —
 * is GAME TUNING chosen to sit in that shape, and says so.
 */

/** A stat across growth: five points, youngest first. */
export type Curve = readonly [number, number, number, number, number];

export type Caste = 'queen' | 'worker' | 'major';

export interface CasteStats {
  readonly caste: Caste;
  readonly species: string;
  /** What the five curve points MEAN for this caste. */
  readonly stages: readonly [string, string, string, string, string];
  readonly attributes: Readonly<Record<string, Curve>>;
  /** State-dependent scalars, applied on top of the attributes. */
  readonly multipliers: Readonly<Record<string, Curve>>;
  readonly combat: Readonly<Record<string, Curve>>;
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

/**
 * THE FIRE ANT QUEEN.
 *
 * Her arc is not a size curve, which is what makes her the right one to
 * write first — it forces the format to carry something other than
 * "bigger numbers later". She emerges winged and light, sheds her wings
 * to found, spends weeks sealed in a chamber living off her own flight
 * muscles, and ends up an immobile egg factory that the colony feeds.
 *
 * So she gets FASTER and WEAKER early, then slower and vastly tougher.
 * A stat table that only counts up cannot say that.
 */
export const QUEEN: CasteStats = {
  caste: 'queen',
  species: 'Solenopsis invicta',
  stages: ['Alate', 'Founding', 'First brood', 'Established', 'Mature'],

  attributes: {
    /**
     * Millimetres, nose to gaster. Commonly reported at 8-10 mm for a
     * newly mated S. invicta queen; the gaster swells with laying
     * rather than the body growing, which is the rise at the end.
     */
    bodyLength: [8.0, 8.5, 8.8, 9.4, 10.0],

    /**
     * Milligrams. She LOSES mass founding — the flight muscles are the
     * larder, and there is no other food in a sealed chamber.
     */
    mass: [14.0, 12.5, 9.5, 13.0, 18.0],

    /** Game tuning. She is not a fighter; she is an investment. */
    maxHealth: [60, 70, 80, 120, 200],

    /** Game tuning, in seconds of sprint. See stamina.ts. */
    maxStamina: [6.0, 5.0, 3.0, 2.5, 2.0],

    /**
     * Multiplies the pace ceilings in pace.ts. A young alate is the
     * quickest thing in the colony on foot; a laying queen barely
     * moves, and would not want to.
     */
    speed: [1.15, 1.0, 0.8, 0.6, 0.45],

    /** Sprint is the one thing she keeps, and only briefly. */
    sprintSpeed: [1.2, 1.05, 0.9, 0.7, 0.5],

    /** How wide a line she takes. Higher is wider — she gets heavy. */
    turnRadius: [0.8, 0.9, 1.0, 1.4, 2.0],

    /** Chitin. Game tuning; a mature queen is armoured by bulk. */
    armour: [1, 1, 1.2, 1.8, 3.0],

    /** Food and water she can hold. Game tuning, in arbitrary units. */
    maxHunger: [80, 80, 40, 120, 200],
    maxThirst: [60, 60, 30, 100, 160],

    /**
     * Per second. ZERO while founding — she is sealed in and living on
     * her own tissue, so a hunger clock there would be a countdown with
     * no way to answer it. A bar may only move if there is a way to
     * move it back.
     */
    hungerRate: [0.03, 0.02, 0.0, 0.04, 0.06],
    thirstRate: [0.03, 0.02, 0.0, 0.04, 0.06],

    /** Points per second. Game tuning. */
    healthRecovery: [1.0, 1.0, 0.6, 1.6, 2.4],
    /** Fraction of the reserve per second. See RECOVER_SECONDS. */
    staminaRecovery: [0.09, 0.08, 0.05, 0.06, 0.07],

    /** Times her own mass. Game tuning; she hauls almost nothing. */
    carry: [2, 2, 1, 1, 0],

    /** Voxels per second. She digs the founding chamber and no more. */
    dig: [0.6, 1.0, 0.4, 0.1, 0],

    /**
     * Eggs per day. Nothing until the chamber is sealed, then the
     * number that makes a colony: a mature S. invicta queen is commonly
     * reported laying on the order of 1,500 a day.
     */
    eggsPerDay: [0, 0, 20, 400, 1500],

    /** Growth per second of play. Tuning — the whole arc in ~2 hours. */
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
    'healthRecovery.inNest': [1.6, 1.6, 2.4, 2.4, 2.4],
    'healthRecovery.resting': [1.15, 1.15, 1.15, 1.15, 1.15],

    /** Caught asleep or laying, she cannot defend herself. */
    'incomingDamage.resting': [1.5, 1.5, 2.0, 2.5, 3.0],
  },

  combat: {
    /** Game tuning. Her jaws are for digging and carrying brood. */
    biteDamage: [4, 4, 5, 6, 8],
    biteCooldown: [1.2, 1.2, 1.2, 1.4, 1.8],

    /**
     * The fire ant's actual weapon is the sting, not the bite — the
     * bite is a grip that anchors it. Alkaloid venom, and the reason
     * the species is named for fire.
     */
    stingDamage: [6, 6, 8, 10, 14],
    stingCooldown: [2.5, 2.5, 2.5, 3.0, 4.0],
    /** Venom dealt per second after a sting lands. Game tuning. */
    venomRate: [0.5, 0.5, 0.6, 0.8, 1.0],

    /** Fraction of the reserve spent per second of sprint. */
    sprintCostPerSecond: [0.167, 0.2, 0.33, 0.4, 0.5],
  },
};

/**
 * What the game reads today.
 *
 * Everything else in the tables above is recorded design: real once the
 * mechanic behind it exists, inert until then. Keeping the list here
 * rather than in a comment means a test can hold it honest.
 */
export const WIRED = [
  'maxStamina',
  'speed',
  'sprintSpeed',
  'staminaRecovery',
] as const;

export const CASTES: Readonly<Record<Caste, CasteStats | null>> = {
  queen: QUEEN,
  // Next, in this order: the worker carries the game, the major is the
  // one that changes combat. Both follow this exact shape.
  worker: null,
  major: null,
};
