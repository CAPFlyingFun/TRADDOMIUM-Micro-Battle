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
 * The profile eases to nothing at the bank and is flat at both ends.
 * Not a wedge, which leaves a crease down the middle, and not a step.
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
 * HOW FAR PAST THE CHANNEL THE CUT REACHES, as a multiple of the
 * channel's own half-width.
 *
 * Joshua, on the first trenched build: "can the trenches have more
 * rounded edges at the top to look natural, like a normal curve into
 * the water vs shape angle?"
 *
 * Two things were making that corner, and this is the second of them.
 * A trench whose cut ENDS at the waterline has all its bank crammed
 * into the strip between the water and the untouched ground, so however
 * smooth the curve is it has to turn through the whole angle in a few
 * centimetres. Giving the cut half again as much ground as the water
 * needs puts a shoulder above the waterline: the bank keeps rising
 * gently after the water has run out, and the lip is where a gentle
 * slope meets flat ground rather than where a steep one does.
 *
 * It costs almost nothing. The cut touched 0.21% of the island before
 * this, and the depth bound is untouched, so the worst case anywhere is
 * still one metre.
 */
const SHOULDER = 1.6;

export function cutHalf(trueWidth: number): number {
  return (trenchWidth(trueWidth) / 2) * SHOULDER;
}

/**
 * THE BANK ITSELF: 1 on the centreline, 0 at the outer edge of the cut.
 *
 * A raised cosine was the first answer and it is smooth in the sense
 * that matters least. Its slope is zero at both ends, so the trench
 * does meet flat ground tangentially — but its CURVATURE is not, and it
 * arrives at the lip bending hard while the ground outside is not
 * bending at all. The eye reads a curvature step as an edge, which is
 * exactly the corner Joshua saw.
 *
 * Smootherstep has zero first AND second derivative at both ends, so
 * the bank leaves the flat and reaches the bed with no step in either.
 * There is nothing for a shaded surface to catch on at the top, and no
 * crease down the middle at the bottom.
 */
export function bank(t: number): number {
  const at = Math.min(1, Math.max(0, t));
  const s = at * at * at * (at * (at * 6 - 15) + 10);
  return 1 - s;
}

/**
 * THE SAME CURVE, FOR THE SHADER — and it has to be the same one.
 *
 * FlowWater shades the water by how deep it is, and the depth inside a
 * trench is this profile times the depth at the middle. It used to ask
 * a ground-height TEXTURE instead, and that texture is one texel every
 * 54.7 m: a twelve-metre channel is a quarter of a texel, so no texture
 * at that resolution can hold a trench however it is sampled. Measured
 * on the shipped build, the shader saw a MEAN DEPTH OF -0.11 m over
 * water the game had at 0.90 m, and drew 66.6% of the island's water at
 * zero alpha. Joshua, for three versions: the water is there but you
 * cannot see it.
 *
 * Evaluating the real curve per pixel needs no second copy of the
 * ground to disagree with. Keep the two identical — a divergence here
 * is invisible until somebody stands in a river that is not there.
 */
export const BANK_GLSL = `
float tmbBank(float t) {
  float at = clamp(t, 0.0, 1.0);
  float s = at * at * at * (at * (at * 6.0 - 15.0) + 10.0);
  return 1.0 - s;
}
`;

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
  claim = Infinity,
): number {
  // NEVER PAST THE CLAIM. The bed exists for water, and the water
  // stops where the index says it does — so a shoulder wider than the
  // claim carves dry ground and, worse, is still at full depth when
  // flowAt refuses the next sample. That guillotine is a vertical
  // cliff the width of one lattice step. Clamping the reach makes the
  // profile arrive at zero exactly where the water does.
  const reach = Math.min(cutHalf(trueWidth), claim);
  if (reach <= 0) return 0;
  // ABSOLUTE, because the profile is not an even function any more.
  // A cosine is symmetric about zero for free and smootherstep is not:
  // fed a small negative offset it returns slightly MORE than one, and
  // the cut comes out deeper than the depth on one side of the
  // centreline. `flowAt` only ever hands this a hypot, so nothing in
  // the game could reach it — which is exactly the kind of trap worth
  // closing while it is still cheap.
  const from = Math.abs(off);
  if (from >= reach) return 0;
  const depth = trenchDepth(trenchWidth(trueWidth));
  const shape = bank(from / reach);
  const bed = level - depth * shape;
  // THE BOUND, AND IT IS SHAPED TOO — which is the second half of
  // Joshua's rounded edges and was a real wall before.
  //
  // The rule is still that no point may be lowered by more than one
  // depth however far above the water it stands, because a carve that
  // presses ground toward a LEVEL cut benches out of the Napali walls
  // last time. But a FLAT bound does something ugly on any slope: once
  // the ground is more than a depth above the bed the bound is what
  // answers, so the cut sits at exactly one depth all the way out and
  // then falls to nothing at the edge. That is a vertical metre of
  // wall along both sides of every trench on sloping ground, and it is
  // the angular top edge in Joshua's screenshot. Measured before the
  // fix, the mean cut where anything was cut at all came to 0.80 m of
  // a 1.00 m maximum — nearly every cut point was against the flat
  // bound rather than following the curve.
  //
  // Shaping the bound with the same curve as the bed keeps the promise
  // and loses the wall: the most that may be taken at the outer edge is
  // nothing, so the trench always leaves the ground where it found it.
  return Math.min(depth * shape, Math.max(0, land - bed));
}

/**
 * HOW DEEP THE WATER STANDS, from the four numbers a slab vertex can
 * carry — the same depth `trenchCut` above leaves under the level.
 *
 * `deep` is the trench's full depth at the station, `across` how far
 * off its centreline the point sits, `span` how far the trench reaches,
 * and `rise` how far the water surface stands above the UNCUT island
 * here. The first three describe the cut and are computed; the fourth
 * is the only one that has to be sampled from the ground.
 *
 * The derivation, because a rearranged formula that nobody can check is
 * how this went wrong the first four times. terrainHeight leaves the
 * ground at `land - cut`, so the water over it is `level - land + cut`
 * deep, and with `D` for `deep * bank(across / span)`:
 *
 *     cut  = min(D, max(0, land - bed)),  bed = level - D
 *     rise = level - land
 *
 * Three cases, and no others. Ground above the waterline: `land - bed`
 * exceeds `D`, so `cut = D` and the depth is `rise + D`, with `rise`
 * negative — the bank eating into the trench, which is what makes a
 * shoreline. Ground between the bed and the waterline: `cut` is
 * `land - bed` and everything cancels to `D` exactly. Ground already
 * below the bed: nothing is cut at all and the depth is `rise`, which
 * in that case is the largest of the three. So:
 *
 *     depth = max(rise, D + min(rise, 0))
 *
 * which is the line below, and the line in WATER_DEPTH_GLSL, and the
 * only description of water depth this game has left.
 */
export function waterDepth(
  deep: number, across: number, span: number, rise: number,
): number {
  const shape = bank(Math.abs(across) / Math.max(span, 1));
  return Math.max(rise, deep * shape + Math.min(rise, 0));
}

/** waterDepth(), for the fragment shader. Held to its twin by a test. */
export const WATER_DEPTH_GLSL = `
float tmbWaterDepth(float deep, float across, float span, float rise) {
  float shape = tmbBank(abs(across) / max(span, 1.0));
  return max(rise, deep * shape + min(rise, 0.0));
}
`;
