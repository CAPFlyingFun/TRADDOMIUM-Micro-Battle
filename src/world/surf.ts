/**
 * WHAT THE SEA DOES TO SOMETHING ELEVEN MILLIMETRES LONG.
 *
 * The ocean moved her vertically and not one millimetre sideways: the
 * salt-water query answered `flowX: 0, flowZ: 0`, and `wadeAt` only
 * carries her when those are non-zero, so a queen floating in the surf
 * sat exactly where she was put while the whole sea heaved under her.
 * This is the horizontal half, and at her scale it is not close:
 *
 *   her body length, adult                    ~10   mm
 *   her top pace over the ground               12   cm/s
 *   her paddle, afloat                         ~2.6 cm/s
 *   open-water orbital flow, peak              ~99  cm/s
 *   a bore breaking in 50 cm of water         ~221  cm/s
 *
 * Those are not tuned numbers. The orbital flow falls straight out of
 * the wave table (seaSwell.seaOrbitalAt) and a broken wave runs as a
 * shallow-water bore at sqrt(g*d), the same square root that governs a
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
 * ADAPTED FROM THE PRE-SWIMMING BUILD (2bc8ecc's surf.ts), and one
 * thing is deliberately NOT carried over. That version had a hard rail
 * — past ten body lengths of water the sea was forbidden from moving
 * her seaward at all — because there was no swimming yet and a queen
 * towed out to sea was a soft lock with no way back. Swimming exists
 * now, so the rail is gone: the sea may take her out, and she can swim.
 * What remains is the ASYMMETRY, which is real surf rather than a
 * safety net — a broken wave runs up the beach faster than it drains
 * back down — and it is what leaves a net shoreward drift over whole
 * wave cycles.
 */
import {
  BREAKER_INDEX, brokenAt, greenShoalAt, seaOrbitalAt, swellAmplitude,
  swellReach,
} from './seaSwell';
import { groundHeight } from './heightfield';

/** Gravity, in world units a second squared. 9.81 m/s². */
export const GRAVITY = 981;

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
 * Where the orbital flow gives way to a breaking surge, DERIVED.
 *
 * A wave breaks when its height approaches the depth it is in, and the
 * classic breaker index is about 0.78 of it. So this is not a number
 * to pick: the swell already decided it. The constant now LIVES in
 * seaSwell, because the same index that says where the water breaks is
 * the one that says how tall the water will let the wave stand — two
 * copies of it would be the two-answers disease with a physical name.
 */
export { BREAKER_INDEX };

/**
 * The depth this water breaks in — crest-to-trough height over the
 * index, read from what Green's law WANTS here rather than from what
 * the depth allowed. That is the point of it: it answers "how much
 * water would this wave need", so comparing it against the water
 * actually present is what tells you the wave is breaking. Reading it
 * off the capped height instead would answer "exactly the depth it is
 * in" everywhere in the surf and say nothing at all.
 */
export function breaksAt(depth: number): number {
  return (2 * swellAmplitude() * greenShoalAt(depth)) / BREAKER_INDEX;
}

const STILL = { x: 0, z: 0 } as const;

/**
 * Which way the land rises here, as a unit vector — the way a broken
 * wave runs.
 *
 * Sampled a good stride either side rather than at a hair's breadth: a
 * beach at this scale has grain on it, and a gradient taken across two
 * sand ripples points at the nearest ripple instead of at the island.
 *
 * Null on ground flat enough to have no uphill, which is a real answer
 * rather than a failure — a wave arriving on a flat plain has no
 * preferred direction and the orbital flow is the whole story.
 */
export function shoreward(
  wx: number, wz: number, step = 40,
): { x: number; z: number } | null {
  const east = groundHeight(wx + step, wz) - groundHeight(wx - step, wz);
  const south = groundHeight(wx, wz + step) - groundHeight(wx, wz - step);
  const slope = Math.hypot(east, south);
  if (slope < 1e-6) return null;
  return { x: east / slope, z: south / slope };
}

/**
 * The sea's horizontal current at a world point, world units a second.
 *
 * @param depth the water column here, INCLUDING the swell — the same
 *   number the query hands out as `depth`.
 * @param surface how high the sea is standing here, above sea level.
 *   Passed in rather than re-derived because the caller has already
 *   paid for it, and because asking twice risks two answers.
 */
export function surfFlowAt(
  wx: number, wz: number, depth: number, surface: number,
): { x: number; z: number } {
  if (depth <= 0) return STILL;
  const orbit = seaOrbitalAt(wx, wz, depth);
  // How far past breaking this water is: nought out where the wave is
  // still a wave, one where it has entirely become a bore.
  //
  // READ OFF THE DEPTH LIMIT ITSELF. This used to be
  // `1 - depth / breaksAt(depth)`, which asked whether the wave was
  // taller than the water would allow. Now that seaSwell does not let
  // it BE taller, that comparison sits at the line for the whole surf
  // zone and answers nothing. The height the envelope took away is the
  // same quantity and survives the fix — energy the wave no longer
  // carries as a wave is exactly the energy running up the beach as a
  // bore — and it engages over the same band and smoothly, which the
  // subtraction did not.
  const broken = brokenAt(depth);
  // THE COMMON CASE COSTS NOTHING EXTRA. Open water is not breaking,
  // and returning here is what keeps the four extra ground samples
  // below inside the surf zone where they are actually needed — this
  // query is asked several times a frame.
  if (broken <= 0) return orbit;
  const up = shoreward(wx, wz);
  if (!up) return orbit;
  // WHICH WAY THE SURGE IS GOING: up the beach on the crest, back down
  // it in the trough. `tanh` for the sign rather than a step, so there
  // is no instant at which the water changes its mind — and scaled
  // against the swell's reach rather than the depth, so it SATURATES
  // instead of behaving as a second attenuation on top of `broken`.
  const swing = Math.tanh(surface / (swellReach() * 0.3));
  let run = Math.sqrt(GRAVITY * depth) * swing;
  if (run < 0) run *= BACKWASH;
  // `broken` blends the two REGIMES. It does not slow the bore down: a
  // wave that has broken runs at the speed its depth says it runs.
  return {
    x: orbit.x * (1 - broken) + up.x * run * broken,
    z: orbit.z * (1 - broken) + up.z * run * broken,
  };
}
