/**
 * THE BED A STREAM RUNS IN — cut, at last, and cut with bounds.
 *
 * WHY THIS EXISTS, AND WHY IT IS A REVERSAL. Version 1 carved channels
 * and the carve broke the terrain twice: a stream at the bottom of a
 * gorge claimed cells partway up its own wall and pressed them toward
 * ITS level, slicing pale benches out of both valley sides. Joshua saw
 * them from the air and made the call — "let's try not carving any
 * waterways out at first and let the Sim find the waterways based on
 * the terrain" — and versions 2 and 3 honoured it: nothing cut, water
 * as a level field, the ground clipping it.
 *
 * That worked, and it exposed the real cost of not cutting. An island
 * with no channels gives water nowhere to sit, so a level field spreads
 * sideways across flat valley floors until something stops it. Left
 * alone that put 20.9% of Kauai under fresh water; bounded by a
 * constant instead, the constant rather than the terrain drew 55.8% of
 * the shorelines. Neither is a shape anybody wants, and both are the
 * same missing thing: there is no bed.
 *
 * So Joshua asked for one, in the terms that matter to him: "a max
 * depth of 1 m for each waterway, or make the depth based on width, so
 * if it's 64 cm wide it's the same depth, but curved smoothly."
 *
 * WHAT MAKES THIS SAFE WHERE THE FIRST ONE WAS NOT. Two bounds, and the
 * first carve had neither.
 *
 *   NOTHING OUTSIDE THE CHANNEL IS TOUCHED. The cut is zero at exactly
 *   half a width from the centreline, and its gradient is zero there
 *   too, so the trench meets untouched ground tangentially rather than
 *   at a lip.
 *
 *   NO POINT IS EVER LOWERED BY MORE THAN THE DEPTH. That is the one
 *   that matters. The old carve pressed ground TOWARD a level, so a
 *   bank standing twenty metres over its stream was cut twenty metres.
 *   Here the worst case anywhere on the island is one metre, whatever
 *   the ground beside the water is doing.
 *
 * The profile is a raised cosine: deepest on the centreline, easing to
 * nothing at the bank, flat at both ends. Not a wedge, which leaves a
 * crease down the middle, and not a step.
 */
import { UNITS_PER_METRE as M } from './kauai';

/**
 * HOW WIDE A CHANNEL IS DRAWN, from the true hydraulic width.
 *
 * GAME TUNING ON TOP OF MEASUREMENT, and worth saying plainly. The true
 * width is Leopold and Maddock and it is honest: a median of 0.60 m
 * across this island, which really is how wide the water runs. It is
 * also sixty of her body lengths, invisible from any distance, and a
 * thing she would spend an hour failing to find. Eight times that is a
 * median stream of 4.8 m — still a stream, still narrow enough to walk
 * around, wide enough to see coming.
 *
 * Floored at 2 m so the smallest gulch still reads as water rather than
 * as a scratch, capped at 40 m so the Wailua gets a river and not an
 * estuary. Both ends are dials.
 */
const SCALE = 8;
const MIN_WIDTH = 2 * M;
const MAX_WIDTH = 40 * M;

export function trenchWidth(trueWidth: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, trueWidth * SCALE));
}

/**
 * HOW DEEP THAT CHANNEL RUNS. Joshua's rule exactly: as deep as it is
 * wide, and never more than a metre.
 *
 * In practice the cap is what almost always answers, since anything
 * over a metre across is over a metre wide by definition — so the
 * island's channels are a metre deep and vary in width, which is the
 * shape of a real drainage rather than of a formula. The narrowest, at
 * the 2 m floor, still get their full 1 m.
 */
export const MAX_DEPTH = 1 * M;

export function trenchDepth(width: number): number {
  return Math.min(MAX_DEPTH, width);
}

/**
 * HOW FAR THE GROUND IS CUT at `off` from the centreline — never
 * negative, never more than the depth, and zero outside the channel.
 *
 * `land` is the surface before any cut and `level` is the water above
 * it; the bed is aimed at one depth below the water rather than one
 * depth below the ground, because a bed measured from the ground would
 * follow every bump in it and the water would not.
 */
export function trenchCut(
  land: number, level: number, off: number, trueWidth: number,
): number {
  const half = trenchWidth(trueWidth) / 2;
  if (off >= half) return 0;
  const depth = trenchDepth(half * 2);
  // 1 on the centreline, 0 at the bank, and flat at both — which is
  // what "curved smoothly" has to mean if the trench is not to leave a
  // crease down its middle or a lip along its edge.
  const shape = 0.5 * (1 + Math.cos(Math.PI * (off / half)));
  const bed = level - depth * shape;
  // THE BOUND. Aim for the bed, but refuse to lower this point by more
  // than one depth however far above the water it stands. A bank high
  // over its stream simply keeps its height; the trench is cut where
  // there is a trench to cut.
  const floor = land - depth;
  return land - Math.max(floor, Math.min(land, bed));
}
