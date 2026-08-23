/**
 * WATER, AT THE SCALE WHERE IT IS A SOLID.
 *
 * A queen is 5.5 mm at founding and 10 grown. Water's capillary length
 * — the size above which weight beats surface tension — is 2.7 mm. She
 * is the same order as the thing that decides, which is why an ant can
 * stand on a pond and a mouse cannot, and it is the one number in this
 * file that is measured rather than chosen.
 *
 * WHAT THE BIOLOGY ACTUALLY SAYS. Fire ants are hydrophobic and
 * positively buoyant; a worker put under comes back up. Mlot, Tovey &
 * Hu (PNAS 2011) measured rafts of them surviving weeks afloat, held
 * up by a trapped air layer. Individually they do not swim so much as
 * row, using the fore and mid legs, and they float whether they mean
 * to or not.
 *
 * WHAT IS GAME TUNING, SAID PLAINLY. Everything with a clock on it.
 * A real fire ant does not tire of standing on water and does not
 * drown in a few seconds — submerged ones last hours on their plastron
 * — so the stamina cost of skating, the break-through, and the few
 * seconds under are a difficulty curve, not a finding. They are here
 * because a river the player can ignore is not a river.
 *
 * FOUR STATES AND THE DEPTH DECIDES, not a mode the player picks:
 *
 *   WADING     her feet are down and the water is pushing at her
 *   SKATING    the film is holding her up, and it is costing her
 *   SWIMMING   through it, most of her wet, rowing
 *   UNDER      submerged, going back up whether she likes it or not
 *
 * NO DROWNING, and that is the survival invariant rather than an
 * omission: a bar may only move if there is a way to move it back, and
 * there is no way back from drowned. She runs out of stamina, she goes
 * under, she bobs up, and she is very tired. Which is also, as it
 * happens, what a real one does.
 */

/** Nothing here touches three or the DOM — see tests/simulationCore. */

export type Wetness = 'dry' | 'wading' | 'skating' | 'swimming' | 'under';

/**
 * WATER'S CAPILLARY LENGTH, in world units. 2.7 mm.
 *
 * sqrt(surface tension / (density x gravity)) for water at 20°C. The
 * one measured constant in the file, and the reason any of this is
 * true: a body around this size or smaller is held by the skin.
 */
export const CAPILLARY = 0.27;

/**
 * How deep the water has to be before her feet leave the bottom, as a
 * multiple of her body length.
 *
 * Deeper than her own length, because she stands ON the bed until
 * there is enough water to take her — and this is the number whose
 * absence was the bug. The carry ramped over ONE body length, which is
 * a centimetre, so stepping into a channel two metres deep went from
 * nothing to fully swept inside a single stride.
 */
export const AFLOAT_AT = 1.6;

/** Where the water first gets a grip at all — over her feet. */
export const ANKLE = 0.18;

/** Stamina a second to hold herself on top of the film. */
export const SKATE_COST = 1 / 90;

/** Stamina a second to row, which is harder than standing on it. */
export const SWIM_COST = 1 / 55;

/**
 * Below this reserve the film lets her through.
 *
 * Half, as Joshua asked. It is a threshold on the way DOWN only — see
 * `SKATE_BACK` — because a state that flickers at a boundary is worse
 * than either state.
 */
export const BREAK_THROUGH = 0.5;

/** And she has to earn a good deal more than that to climb back out. */
export const SKATE_BACK = 0.68;

/** How fast buoyancy returns her to the surface, world units a second. */
export const BOB_RATE = 9;

/**
 * The longest a dive holds her under before buoyancy wins outright, in
 * seconds. Game tuning; a real one has hours.
 */
export const UNDER_FOR = 4;

/** How much of the current has her, by state. */
const GRIP = {
  dry: 0,
  wading: 1,
  // Standing ON it: the film drags her along but most of her is in air.
  skating: 0.3,
  swimming: 1,
  under: 1,
} as const;

/** How fast she can push herself along, as a share of her walking pace. */
const PACE = {
  dry: 1,
  wading: 0.7,
  skating: 0.85,
  swimming: 0.45,
  under: 0.25,
} as const;

export interface Water {
  /** Surface height where she is, drawn frame. */
  readonly level: number;
  /** The ground under her, drawn frame. */
  readonly bed: number;
}

export interface Afloat {
  readonly state: Wetness;
  /** Share of the current that has her, 0 to 1. */
  readonly grip: number;
  /** Multiplier on her own movement. */
  readonly pace: number;
  /**
   * How far above the BED she should ride, world units.
   *
   * The scene hands this straight to the walker as its `above`, so
   * floating needs no new code down there: she is simply standing on
   * something higher than the ground.
   */
  readonly ride: number;
  /** Stamina a second this is costing her. Zero on land. */
  readonly cost: number;
}

const DRY: Afloat = {
  state: 'dry', grip: 0, pace: 1, ride: 0, cost: 0,
};

export class Swim {
  private state: Wetness = 'dry';
  private under = 0;
  /**
   * Whether this dive has already spent itself.
   *
   * Without it, buoyancy pushing her out of `under` while the lever is
   * still held simply started a new dive on the next frame, timer and
   * all — she could hold herself down for ever, four seconds at a
   * time. She has to let go and take a breath.
   */
  private ducked = false;
  private depth = 0;

  /** What the water is doing to her this frame. */
  get afloat(): Afloat {
    return this.last;
  }

  private last: Afloat = DRY;

  /**
   * @param water where the surface and the bed are, or null on land
   * @param body her length in world units
   * @param reserve stamina left, 0 to 1
   * @param dived whether she is actively driving herself downward
   */
  update(
    water: Water | null, body: number, reserve: number,
    dived: boolean, dt: number,
  ): Afloat {
    const deep = water ? water.level - water.bed : 0;
    this.depth = deep;
    if (!water || deep <= body * ANKLE) {
      this.state = 'dry';
      this.under = 0;
      this.last = DRY;
      return this.last;
    }

    // HER FEET ARE STILL DOWN. Ramped over more than a body length, so
    // a channel gets deeper as she walks into it instead of taking her
    // the instant she is wet.
    if (deep < body * AFLOAT_AT) {
      this.state = 'wading';
      this.under = 0;
      const span = body * (AFLOAT_AT - ANKLE);
      const t = Math.min(1, (deep - body * ANKLE) / Math.max(1e-6, span));
      const eased = t * t * (3 - 2 * t);
      this.last = {
        state: 'wading',
        grip: GRIP.wading * eased,
        pace: 1 + (PACE.wading - 1) * eased,
        ride: 0,
        cost: 0,
      };
      return this.last;
    }

    // DEEP ENOUGH TO TAKE HER. Which of the three depends on what she
    // has left and what she is asking for.
    if (!dived) this.ducked = false;
    if (dived && !this.ducked && this.state !== 'under') {
      this.state = 'under';
      this.under = 0;
    }

    if (this.state === 'under') {
      this.under += dt;
      // Buoyancy is not optional and not a timer she can extend: she is
      // a cork with legs. Holding the lever down buys the four seconds
      // and no more.
      if (!dived || this.under >= UNDER_FOR) {
        if (this.under >= UNDER_FOR) this.ducked = true;
        this.state = reserve >= SKATE_BACK ? 'skating' : 'swimming';
      }
    } else if (this.state === 'skating' || this.state === 'dry' || this.state === 'wading') {
      this.state = reserve > BREAK_THROUGH ? 'skating' : 'swimming';
    } else if (reserve >= SKATE_BACK) {
      // Back out on top, but only well clear of where she fell in.
      this.state = 'skating';
    }

    this.last = {
      state: this.state,
      grip: GRIP[this.state],
      pace: PACE[this.state],
      ride: this.rideFor(deep, body, dt),
      cost: this.state === 'skating' ? SKATE_COST
        : this.state === 'swimming' ? SWIM_COST : SWIM_COST,
    };
    return this.last;
  }

  /**
   * How high off the bed she sits.
   *
   * SKATING is on top of the film — the whole depth plus nothing.
   * SWIMMING is half in, so she rides a body-depth lower. UNDER is
   * wherever she has got to, rising at BOB_RATE, which is what makes
   * a dive feel like a dive and a resurfacing feel like a cork.
   */
  private rideFor(deep: number, body: number, dt: number): number {
    const top = deep;
    const swimming = Math.max(0, deep - body * 0.45);
    if (this.state === 'skating') return top;
    if (this.state === 'swimming') return swimming;
    // Under: sink toward the bed while she is driving down, and rise
    // back whenever she is not.
    const want = this.under >= UNDER_FOR ? swimming : Math.max(0, deep - body * 3);
    const from = this.last.ride;
    const step = BOB_RATE * dt;
    return from < want ? Math.min(want, from + step) : Math.max(want, from - step);
  }

  /** How deep the water she is in is, for the HUD. */
  get depthNow(): number {
    return this.depth;
  }

  /** Scene resets and respawns. */
  forget(): void {
    this.state = 'dry';
    this.under = 0;
    this.ducked = false;
    this.last = DRY;
  }
}
