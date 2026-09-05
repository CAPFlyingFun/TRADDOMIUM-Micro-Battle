/**
 * WHAT THE SEA DOES TO SOMETHING ELEVEN MILLIMETRES LONG.
 *
 * `SeaSwell` moves her vertically. This is the horizontal half, and at
 * her scale it is not close:
 *
 *   her body length, adult                    ~10   mm
 *   her top pace over the ground               12   cm/s
 *   her paddle, afloat                         ~2.6 cm/s
 *   open-water orbital flow, peak              ~99  cm/s
 *   a bore breaking in 50 cm of water         ~221  cm/s
 *
 * Those are not tuned numbers. The orbital flow falls straight out of
 * the wave table (`SeaSwell.orbitalAt`) and a broken wave runs as a
 * shallow-water bore at sqrt(g·d), the same square root that governs a
 * tsunami and a bath. At a scale where one swell is thirty body lengths
 * from crest to trough, the honest model is already dramatic and there
 * is nothing here to exaggerate.
 *
 * TWO REGIMES, BLENDED BY DEPTH:
 *
 *   deep     the orbital flow alone — she rides forward under the
 *            crest and back under the trough and goes nowhere much,
 *            which is what floating in a swell IS
 *   shallow  the wave has broken and become a surge running UP the
 *            beach and draining back down it
 *
 * CARRIED FROM v0's `world/surf.ts`. The physics and both tuned numbers
 * — BACKWASH and the shoreward sampling stride — are v0's, and v0 got
 * the model from the pre-swimming build before it. What changed is
 * ownership, as with the swell:
 *
 *  - IT IS A CLASS HOLDING THE SWELL, not a module reaching for one.
 *    The surf is a function of the sea and the ground and owns no state
 *    of its own, so it stores nothing; what it needs is one reference
 *    to the sea whose waves it is breaking.
 *  - THE GROUND COMES THROUGH THE SEA. v0 imported a global
 *    `groundHeight(x, z)`. v1 could have injected a second height
 *    source here, and that is exactly the mistake worth refusing: the
 *    swell already holds one, and two would be two chances to break a
 *    wave on a beach the swell cannot see. `SeaSwell.bedAt` is the one
 *    door.
 *  - GRAVITY IS NOT COPIED. v0 declared `GRAVITY = 981` here while
 *    `seaSwell.ts` declared `G = 981` four files away — two names for
 *    one constant, in the module whose own comments name the
 *    two-answers disease. The value is unchanged; it now has one home.
 *  - THE PUBLIC DOOR TAKES A WorldPoint.
 *
 * ONE THING FROM THE PRE-SWIMMING BUILD IS DELIBERATELY NOT HERE. That
 * version had a hard rail — past ten body lengths of water the sea was
 * forbidden from moving her seaward at all — because there was no
 * swimming yet and a queen towed out to sea was a soft lock with no way
 * back. Swimming exists, so the rail is gone: the sea may take her out,
 * and she can swim. What remains is the ASYMMETRY, which is real surf
 * rather than a safety net — a broken wave runs up the beach faster
 * than it drains back down — and it is what leaves a net shoreward
 * drift over whole wave cycles.
 *
 * Pure: no three, no DOM, no fetch. `src/world/` is core.
 */
import { translate, type WorldPoint } from '../coords';
import { BREAKER_INDEX, G, greenShoalAt, type SeaSwell } from './swell';

/**
 * Gravity, re-exported rather than redeclared.
 *
 * The bore speed sqrt(g·d) and the wave dispersion sqrt(g·k) are the
 * same g. See the header: v0 kept two.
 */
export { G as GRAVITY, BREAKER_INDEX };

/**
 * How far down the backwash is scaled against the run-up.
 *
 * Physically a broken wave's run-up outruns its return — the sheet
 * going up the beach is thin and fast, the one draining back is slower
 * and partly soaks away — and the difference is precisely what makes
 * surf transport things shoreward instead of merely rocking them.
 */
export const BACKWASH = 0.4;

/**
 * How far either side of a point the beach's slope is measured, in
 * world units. A good stride rather than a hair's breadth.
 *
 * v0's reason was grain: a gradient taken across two sand ripples
 * points at the nearest ripple instead of at the island. v1's terrain
 * has no ripples — it is a bilinear surface over a 13.67 m survey — so
 * the number survives for the other half of the same argument. Smaller
 * and it measures floating-point noise across 40 cm of a smooth cell;
 * much larger and it starts averaging across whole survey cells and
 * points at the mountain behind the beach rather than at the beach.
 */
export const SHOREWARD_STEP = 40;

/**
 * The bore speed below which open water is treated as not breaking, in
 * world units a second. Two tenths of a millimetre a second.
 *
 * THIS FIXES AN OPTIMISATION v0 CLAIMED AND DID NOT HAVE. Its comment
 * below — kept, because the reasoning is right — says the common case
 * costs nothing extra because open water is not breaking, and gated on
 * `broken <= 0`. But `brokenAt` is `1 - softMin(green, cap)/green`, and
 * a soft minimum is ASYMPTOTIC: it approaches its smaller term and
 * never equals it. Measured on the shipped table, `broken` is exactly
 * zero only in water shallower than about six units — where the swash
 * taper has already removed the swell — and is 1e-9 out in the abyssal
 * plain. So the gate fired nowhere that mattered and every query in
 * open ocean paid for four heightfield reads to find the slope of a sea
 * floor three kilometres down.
 *
 * The gate is on the BORE ITSELF rather than on a bare epsilon, because
 * `broken` alone does not say how much water is moving: the surge is
 * sqrt(g·d)·broken, and in deep water the two factors run opposite
 * ways. At this floor the term being dropped is a fifth of a percent of
 * her paddle stroke — a body length over a minute of floating — and it
 * is dropped only in water deeper than about 5.6 m, which off Kauaʻi is
 * everything but the shorebreak. `tests/worldSeaSurf.test.ts` pins the
 * bound rather than trusting this paragraph.
 */
export const BORE_FLOOR = 0.02;

/**
 * How fast the water is going sideways, world units a second.
 *
 * Readonly because the still-water answer is one shared frozen object:
 * open sea is the common case and it should not allocate.
 */
export interface Flow {
  readonly x: number;
  readonly z: number;
}

const STILL: Flow = Object.freeze({ x: 0, z: 0 });

/** Which way the land rises, as a unit vector. Null where there is no uphill. */
export interface Uphill {
  readonly x: number;
  readonly z: number;
}

export class SeaSurf {
  constructor(private readonly swell: SeaSwell) {}

  /**
   * The depth this water breaks in — crest-to-trough height over the
   * index, read from what Green's law WANTS here rather than from what
   * the depth allowed.
   *
   * That is the point of it: it answers "how much water would this wave
   * need", so comparing it against the water actually present is what
   * tells you the wave is breaking. Reading it off the capped height
   * instead would answer "exactly the depth it is in" everywhere in the
   * surf and say nothing at all — which is why `greenShoalAt` is
   * exported from the swell separately from `shoalAt`.
   */
  breaksAt(depth: number): number {
    return (2 * this.swell.amplitude() * greenShoalAt(depth)) / BREAKER_INDEX;
  }

  /**
   * Which way the land rises here, as a unit vector — the way a broken
   * wave runs.
   *
   * Null on ground flat enough to have no uphill, which is a real
   * answer rather than a failure: a wave arriving on a flat plain has
   * no preferred direction and the orbital flow is the whole story.
   */
  shoreward(at: WorldPoint, step: number = SHOREWARD_STEP): Uphill | null {
    const swell = this.swell;
    const east = swell.bedAt(translate(at, step, 0)) - swell.bedAt(translate(at, -step, 0));
    const south = swell.bedAt(translate(at, 0, step)) - swell.bedAt(translate(at, 0, -step));
    const slope = Math.hypot(east, south);
    if (slope < 1e-6) return null;
    return { x: east / slope, z: south / slope };
  }

  /**
   * The sea's horizontal current at a world point, world units a second.
   *
   * @param depth the water column here, INCLUDING the swell — the same
   *   number the water query hands out as `depth`.
   * @param surface how high the sea is standing here, above sea level.
   *   Passed in rather than re-derived because the caller has already
   *   paid for it, and because asking twice risks two answers.
   */
  flowAt(at: WorldPoint, depth: number, surface: number): Flow {
    if (depth <= 0) return STILL;
    const orbit = this.swell.orbitalAt(at, depth);
    // How far past breaking this water is: nought out where the wave is
    // still a wave, one where it has entirely become a bore.
    //
    // READ OFF THE DEPTH LIMIT ITSELF. This used to be
    // `1 - depth / breaksAt(depth)`, which asked whether the wave was
    // taller than the water would allow. Now that the swell does not
    // let it BE taller, that comparison sits at the line for the whole
    // surf zone and answers nothing. The height the envelope took away
    // is the same quantity and survives the fix — energy the wave no
    // longer carries as a wave is exactly the energy running up the
    // beach as a bore — and it engages over the same band and smoothly,
    // which the subtraction did not.
    const broken = this.swell.brokenAt(depth);
    // THE COMMON CASE COSTS NOTHING EXTRA. Open water is not breaking,
    // and returning here is what keeps the four extra ground samples
    // below inside the surf zone where they are actually needed — this
    // query is asked several times a frame.
    //
    // The bore this would add, at most, is sqrt(g·d) times `broken`.
    // See BORE_FLOOR for why the test is that product and not `broken`
    // on its own — and for what v0's version of this line actually did.
    // The shallow-water wave speed, sqrt(g·d) — the same square root
    // that governs a tsunami and a bath, and the speed a broken wave
    // runs at. Computed once: it is both the gate and the surge.
    const celerity = Math.sqrt(G * depth);
    if (celerity * broken < BORE_FLOOR) return orbit;
    const up = this.shoreward(at);
    if (!up) return orbit;
    // WHICH WAY THE SURGE IS GOING: up the beach on the crest, back
    // down it in the trough. `tanh` for the sign rather than a step, so
    // there is no instant at which the water changes its mind — and
    // scaled against the swell's reach rather than the depth, so it
    // SATURATES instead of behaving as a second attenuation on top of
    // `broken`.
    const swing = Math.tanh(surface / (this.swell.reach() * 0.3));
    let run = celerity * swing;
    if (run < 0) run *= BACKWASH;
    // `broken` blends the two REGIMES. It does not slow the bore down:
    // a wave that has broken runs at the speed its depth says it runs.
    return {
      x: orbit.x * (1 - broken) + up.x * run * broken,
      z: orbit.z * (1 - broken) + up.z * run * broken,
    };
  }
}
