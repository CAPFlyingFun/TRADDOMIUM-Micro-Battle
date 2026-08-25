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
import { groundHeight, reliefScale } from '../world/heightfield';

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

/**
 * HOW FAR SHE CAN REACH TO DRINK — sixteen centimetres.
 *
 * GAME TUNING, not biology, and the measurement that forced it. A
 * queen crossing the median stream on this island gets TWO CENTIMETRES
 * of ground she can stand on while wet before the bed drops away and
 * she is swimming, and on a quarter of the crossings measured she gets
 * none at all: dry, then over her head, in one step. That is what
 * Joshua found — "it's like right at the edge and very small of an
 * area" — and it is not a bug in the water. It is a one-metre trench
 * seen by something a centimetre long. The walkable shoreline of a
 * real stream, at her scale, genuinely is a couple of body lengths
 * wide.
 *
 * So drinking stops being a question about the ground UNDER her and
 * becomes one about water she can get her head into. Sixteen
 * centimetres is about a quarter-second of walking at her ordinary
 * pace — enough that the shoreline is somewhere she can arrive rather
 * than something she has to hit, and short enough that she is plainly
 * standing at the water rather than drinking across it.
 *
 * She can still drink while afloat, and that has always worked: there
 * are 5.7 m of water she floats on for every 2 cm she can wade in.
 */
const DRINK_REACH = 16;
/**
 * Eight points around the ring. Enough that a shoreline crossing the
 * ring at any angle is caught; few enough that this is nothing beside
 * the terrain sample each one costs.
 */
const PROBES = 8;

/**
 * Is there water here she could drink, or any within reach?
 *
 * Fresh only, and that falls out of `waterLevelAt` rather than needing
 * a rule — it answers for the flow index and the ponds, and the sea is
 * in neither.
 */
export function canDrink(wx: number, wz: number, ground: number): boolean {
  // Under her feet first, which is the common case and costs nothing.
  const here = waterLevelAt(wx, wz);
  if (here !== null && here * reliefScale() - ground > 0) return true;
  for (let i = 0; i < PROBES; i++) {
    const a = (i / PROBES) * Math.PI * 2;
    const x = wx + Math.cos(a) * DRINK_REACH;
    const z = wz + Math.sin(a) * DRINK_REACH;
    const level = waterLevelAt(x, z);
    // The ground AT THE PROBE, not under her — she is on the bank
    // looking down at the water, so the two are different by exactly
    // the thing that makes this necessary.
    if (level !== null && level * reliefScale() - groundHeight(x, z) > 0) return true;
  }
  return false;
}
