/**
 * WHAT THE WATER DOES TO HER — resurrected from the pre-v0.0.57 build.
 *
 * That version was removed with the water system it read, not because
 * it was wrong; its design notes and numbers are kept whole. What
 * changed is only the source: it reads the simulated window through
 * waterQuery now, instead of the deleted flow index.
 *
 * This is movement only. No drowning, no breath, and that is
 * deliberate rather than unfinished — CLAUDE.md's rule is that a bar
 * may only move if there is a way to move it back, and there is no
 * drying-off yet. Water may slow her and carry her; it may not start
 * a clock she cannot stop.
 *
 * SCALE IS THE WHOLE DESIGN HERE. One world unit is a centimetre and
 * she is about one unit long, so a knee-deep stream is a hundred body
 * lengths of water. There is no wading across that. Anything a stream
 * can offer her is either a film at the very edge or a swim, and the
 * numbers below are set from her body rather than from what water
 * does to a person.
 *
 * SHE FLOATS RATHER THAN SINKING, and that is biology rather than
 * convenience (docs/FIRE_ANT_BIOLOGY.md). Fire ants are hydrophobic
 * enough to ride the surface film — a raft of them survives floods
 * for weeks (Mlot, Tovey & Hu, PNAS 2011) — so deep water is not a
 * wall and not a drop; it is a surface she lands on and the current
 * owns. That is also what makes the water "solid to land on": flight
 * puts her down, and the film holds her up.
 */
import { waterSpotAt } from '../world/waterQuery';
import { MOVING_RECOVERY, SPRINT_DRAIN } from './stamina';
import { OCEAN_STAMINA_MULTIPLIER } from './brine';

/**
 * HOW DEEP SHE CAN STILL PUSH THROUGH — four millimetres, roughly the
 * height of a fire-ant queen's thorax off the ground. Under this she
 * has the bed under her feet and the water is drag. Over it her legs
 * are not reaching anything and she is swimming, whether the water is
 * five millimetres deep or the half-metre a pool actually holds.
 */
export const FOOTING = 0.4;
/**
 * How deep she sits once she is floating — a millimetre and a half.
 * Riding the surface film rather than displacing her own volume, so
 * she sits high and her eyes stay above the water.
 */
export const DRAUGHT = 0.15;
/** What is left of her pace at the deepest she can still walk. */
const WADE_PACE = 0.45;
/** And what is left of it once she is swimming rather than walking. */
export const PADDLE_PACE = 0.22;
/**
 * How much of the current reaches her, wading and afloat. Afloat is
 * nearly all of it: she is ON the water with nothing to push against.
 * Wading is a fraction, because her feet still hold the bed.
 */
const WADE_CARRY = 0.4;
const AFLOAT_CARRY = 0.85;
/**
 * Once she IS floating she stays floating until the water is this
 * fraction of FOOTING — a little hysteresis, so the shoreline's
 * millimetre-scale depth noise cannot flick her between walking and
 * swimming every frame at the exact threshold.
 */
const FOOTING_STICKY = 0.85;
/**
 * WHAT SWIMMING COSTS — priced here, charged by the scene, through
 * the same one-reserve Stamina whose rule is that the caller knows
 * what its activity costs. Two minutes of continuous fresh-water
 * paddling on a full bar: real work, but the film carries her weight,
 * so it is nothing like a sprint. The sea multiplies this by
 * OCEAN_STAMINA_MULTIPLIER (brine.ts).
 */
export const SWIM_DRAIN = 1 / 120;
/**
 * And what DIVING costs on top, at full push. Sprint-grade — thirty
 * seconds of hard downward swimming on a full bar — because holding
 * herself under is a fight against her own buoyancy the whole way
 * (she is a cork with legs; see the header). Scaled by how hard the
 * lever is actually pushing down.
 */
export const DIVE_DRAIN = SPRINT_DRAIN;

export interface Wade {
  /** Water over the ground under her, drawn units. Zero on dry land. */
  readonly depth: number;
  /** How far she rides above the bed — zero until she floats. */
  readonly above: number;
  /** What her pace is multiplied by. */
  readonly pace: number;
  /** World units a second the water is moving her, or null. */
  readonly carry: { readonly x: number; readonly z: number } | null;
  /** True once her feet are off the bottom. */
  readonly afloat: boolean;
  /** Whether this is water she can drink. The window is fresh water
   *  by construction — the sea has no cells in it — so any water at
   *  all answers yes. */
  readonly drinkable: boolean;
  /**
   * Whether this is the SEA. An explicit classification rather than
   * !drinkable, so fresh water can never inherit salt consequences by
   * accident — the two flags happen to mirror each other today and
   * are still two different questions.
   */
  readonly salt: boolean;
}

const DRY: Wade = {
  depth: 0, above: 0, pace: 1, carry: null, afloat: false,
  drinkable: false, salt: false,
};

/**
 * What the water at (wx, wz) is doing to something standing on the
 * DRAWN ground there.
 *
 * @param dive nought at the surface, one on the bottom — how far down
 *   she is swimming. Scaling the float height is what makes the bed
 *   the limit for free: at dive 1 she stands on it however deep the
 *   pool is, and there is no separate clamp to keep in step.
 * @param wasAfloat whether she was floating LAST frame — feeds the
 *   sticky threshold so the shoreline cannot flicker her state.
 */
export function wadeAt(wx: number, wz: number, dive = 0, wasAfloat = false): Wade {
  const spot = waterSpotAt(wx, wz);
  if (!spot || spot.depth <= 0) return DRY;
  const depth = spot.depth;
  const afloat = depth >= FOOTING * (wasAfloat ? FOOTING_STICKY : 1);
  const sunk = Math.min(1, depth / FOOTING);
  const pull = afloat ? AFLOAT_CARRY : WADE_CARRY * sunk;
  const carrying = spot.flowX !== 0 || spot.flowZ !== 0;
  return {
    depth,
    // Floating puts her at the surface less her draught. Wading leaves
    // her on the bed, where `above` must stay exactly zero: lifting a
    // walking ant off the ground by a fraction of the water she is in
    // is a hover, and it reads as one.
    above: afloat
      ? Math.max(0, (depth - DRAUGHT) * (1 - Math.min(1, Math.max(0, dive))))
      : 0,
    pace: afloat ? PADDLE_PACE : 1 - (1 - WADE_PACE) * sunk,
    carry: carrying ? { x: spot.flowX * pull, z: spot.flowZ * pull } : null,
    afloat,
    // The window is fresh by construction; the sea announces itself.
    drinkable: !spot.salt,
    salt: spot.salt === true,
  };
}

/**
 * What being IN the water costs the one reserve, in fractions of a
 * full bar per second — or null when she is not floating, because
 * wading is walking and the ground ladder already prices walking.
 *
 * The ladder, shallow to deep:
 *   floating still            recovers, slowly — the film holds her
 *   paddling, fresh water     SWIM_DRAIN
 *   paddling, the sea         SWIM_DRAIN × OCEAN_STAMINA_MULTIPLIER
 *   pushing down (either)     + DIVE_DRAIN × how hard
 *
 * The sea multiplier touches only the POSITIVE swim cost. Resting
 * afloat recovers at the moving rate in both waters — a multiplier on
 * a recovery would make the ocean restful, which is the opposite of
 * the point of it.
 */
export function swimEffort(
  afloat: boolean, salt: boolean, paddling: boolean, wantDive: number,
): number | null {
  if (!afloat) return null;
  const base = paddling
    ? SWIM_DRAIN * (salt ? OCEAN_STAMINA_MULTIPLIER : 1)
    : MOVING_RECOVERY;
  return base + DIVE_DRAIN * Math.min(1, Math.max(0, wantDive));
}

/**
 * HOW FAR SHE CAN REACH TO DRINK — sixteen centimetres, and the
 * measurement that forced it is in the old build's notes: the walkable
 * shoreline of a stream, at her scale, genuinely is a couple of body
 * lengths wide, so drinking is about water she can get her head into
 * rather than water under her feet.
 */
const DRINK_REACH = 16;
/** Eight points around the ring — any shoreline crossing it is caught. */
const PROBES = 8;

/** Is there water here she could drink, or any within reach? */
export function canDrink(wx: number, wz: number): boolean {
  const here = waterSpotAt(wx, wz);
  if (here && !here.salt && here.depth > 0) return true;
  for (let i = 0; i < PROBES; i++) {
    const a = (i / PROBES) * Math.PI * 2;
    const spot = waterSpotAt(wx + Math.cos(a) * DRINK_REACH, wz + Math.sin(a) * DRINK_REACH);
    if (spot && !spot.salt && spot.depth > 0) return true;
  }
  return false;
}
