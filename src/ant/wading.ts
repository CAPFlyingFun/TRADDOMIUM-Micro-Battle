/**
 * WHAT THE WATER DOES TO HER — the first thing it has ever done.
 *
 * Joshua, after the trenches went in: "no water collisions yet." He is
 * right, and it has been true the whole time. `flowAt` has returned a
 * current vector for three versions and NOTHING HAS EVER READ IT: she
 * walked across every stream on the island at full pace, dry, and the
 * water was a thing to look at rather than a thing to cross.
 *
 * This is movement only. No drowning, no breath, no stamina drain, and
 * that is deliberate rather than unfinished — CLAUDE.md's rule is that
 * a bar may only move if there is a way to move it back, and there is
 * no way to get out of the water and dry off yet. Water may slow her
 * and carry her; it may not start a clock she cannot stop.
 *
 * SCALE IS THE WHOLE DESIGN HERE. One world unit is a centimetre and
 * she is about one unit long, so the trench she is looking at is a
 * hundred body lengths deep. There is no wading across that. Anything
 * a stream can offer her is either a puddle at the very edge or a
 * swim, and the numbers below are set from her body rather than from
 * what water does to a person.
 *
 * SHE FLOATS RATHER THAN SINKING, and that is biology rather than
 * convenience. Fire ants are hydrophobic enough to sit on the surface
 * film, and a raft of them survives floods for weeks (Mlot, Tovey &
 * Hu, PNAS 2011) — an individual worker on still water rides on top of
 * it. So deep water is not a wall and not a drop; it is a surface she
 * is stuck to and the current owns.
 */
import { flowAt, waterLevelAt } from '../world/flow';
import { reliefScale } from '../world/heightfield';

/**
 * HOW DEEP SHE CAN STILL PUSH THROUGH — four millimetres, which is
 * roughly the height of a fire ant queen's thorax off the ground.
 *
 * Under this she has the bed under her feet and the water is drag.
 * Over it her legs are not reaching anything and she is swimming,
 * whether the water is five millimetres deep or the metre a trench
 * actually runs.
 */
const FOOTING = 0.4;
/**
 * How deep she sits once she is floating — a millimetre and a half.
 * Riding the surface film rather than displacing her own volume, so
 * she sits high and her eyes stay above the water.
 */
const DRAUGHT = 0.15;
/** What is left of her pace at the deepest she can still walk. */
const WADE_PACE = 0.45;
/** And what is left of it once she is swimming rather than walking. */
const PADDLE_PACE = 0.22;
/**
 * How much of the current reaches her, wading and afloat.
 *
 * Afloat is nearly all of it: she is ON the water and has nothing to
 * push against. Wading is a fraction, because her feet are still on
 * the bed. Neither is the whole story on its own — `flowAt` already
 * shapes the current parabolically across the TRUE channel, so the
 * thread runs fast down the middle and dies at the banks. That is what
 * lets her get out of a stream she should not have entered: the
 * hydraulic channel is 0.6 m across the median trench's 4.8 m, so most
 * of the water she is in is barely moving.
 */
const WADE_CARRY = 0.4;
const AFLOAT_CARRY = 0.85;

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
  /**
   * Whether this is water she can DRINK.
   *
   * Fresh only, and that falls out of where the number came from
   * rather than needing a rule: `waterLevelAt` answers for the flow
   * index and the ponds, and the sea is in neither. She cannot drink
   * the sea, and nothing here has to remember that.
   */
  readonly drinkable: boolean;
}

const DRY: Wade = {
  depth: 0, above: 0, pace: 1, carry: null, afloat: false, drinkable: false,
};

/**
 * What the water at (wx, wz) is doing to something standing on
 * `ground` — which is the DRAWN ground in drawn units, the surface she
 * is actually on, so this agrees with what the player can see by
 * construction rather than by two numbers being kept in step.
 */
export function wadeAt(
  wx: number, wz: number, ground: number, dive = 0,
): Wade {
  const raw = waterLevelAt(wx, wz);
  if (raw === null) return DRY;
  // Levels are stored at relief 1 and the dial is applied by the
  // caller, the same rule FlowWater seats its slabs by. One rule, or
  // the water and the ground part company the moment the slider moves.
  const depth = raw * reliefScale() - ground;
  if (depth <= 0) return DRY;

  const afloat = depth >= FOOTING;
  const sunk = Math.min(1, depth / FOOTING);
  const spot = flowAt(wx, wz);
  const pull = afloat ? AFLOAT_CARRY : WADE_CARRY * sunk;
  return {
    depth,
    // Floating puts her at the surface less her draught. Wading leaves
    // her on the bed, where `above` must stay exactly zero: lifting a
    // walking ant off the ground by a fraction of the water she is in
    // is a hover, and it reads as one.
    //
    // AND `dive` PULLS HER DOWN THROUGH IT, nought at the surface and
    // one on the bottom, which is the whole of swimming underwater.
    // Scaling the height she floats at is what makes the bed the
    // limit for free: at dive 1 she is standing on it however deep the
    // trench is, and there is no separate clamp to keep in step.
    above: afloat
      ? Math.max(0, (depth - DRAUGHT) * (1 - Math.min(1, Math.max(0, dive))))
      : 0,
    pace: afloat ? PADDLE_PACE : 1 - (1 - WADE_PACE) * sunk,
    carry: spot && (spot.flowX !== 0 || spot.flowZ !== 0)
      ? { x: spot.flowX * pull, z: spot.flowZ * pull }
      : null,
    afloat,
    drinkable: true,
  };
}
