/**
 * WHAT THE SEA DOES TO SOMETHING ELEVEN MILLIMETRES LONG.
 *
 * The ocean has been scenery. This is the first thing that makes it a
 * place with consequences: a wave arriving at a beach picks the queen up
 * and puts her somewhere else, and at her scale it is not close.
 *
 *   her body length, founding                  5.5 mm
 *   her body length, adult                    10   mm
 *   her top speed over the ground          ~25 cm/s
 *   open-water orbital flow, peak          ~52 cm/s   (2x her)
 *   a bore breaking in 5 cm of water       ~70 cm/s   (3x)
 *   a bore breaking in 30 cm of water     ~170 cm/s   (7x)
 *
 * Those are not tuned numbers. The orbital flow falls out of the wave
 * table (see `seaFlowAt`), and a broken wave runs as a shallow-water
 * bore at √(g·d), which is the same square root that governs a tsunami
 * and a bath. At a scale where the swell is twenty-seven body lengths
 * from crest to trough, the honest model is already dramatic and there
 * is nothing to exaggerate.
 *
 * TWO REGIMES, BLENDED BY DEPTH:
 *
 *   deep    the orbital flow alone — she rides back and forth and goes
 *           nowhere much, which is what floating in a swell is
 *   shallow the wave has broken and become a surge running UP the beach
 *           and draining back down it
 *
 * THE SURGE IS ASYMMETRIC ON PURPOSE, and not only because it looks
 * right. A broken wave runs up the beach as a fast thin sheet and
 * drains back as a slower one — that is real — and it is also the thing
 * that stops this being a way to lose a queen. There is no swimming
 * yet, so water that could tow her out to sea would be a soft lock.
 * Pushed up the beach, she walks back down. See SEAWARD.
 */
import { SWELL, seaFlowAt, seaHeightAt } from './swell';

/** Gravity, in world units a second squared. 9.81 m/s². */
export const GRAVITY = 981;

/**
 * How far down the backwash is scaled against the surge.
 *
 * Physically a broken wave's run-up outruns its return, so some of this
 * is real. The rest is the survival invariant: a bar may only move if
 * there is a way to move it back, and until she can swim, being towed
 * out to sea has no way back.
 */
export const SEAWARD = 0.4;

/**
 * Where the orbital flow gives way to a breaking surge, DERIVED.
 *
 * A wave breaks when its height approaches the depth it is in — the
 * classic breaker index is about 0.78 of it — so this is not a number
 * to pick, it is a number the swell already decided. Wired to `SWELL`
 * so that changing the sea changes where it breaks, rather than leaving
 * a stale constant behind claiming otherwise.
 */
export const BREAKER_INDEX = 0.78;

/** The depth the swell breaks in — crest to trough, over the index. */
export const BREAKS_AT = (SWELL * 2) / BREAKER_INDEX;

/**
 * Body lengths of water past which the sea may only push her shoreward.
 *
 * Ten of them is a hundred millimetres — a hand's depth, and well over
 * her head. A queen there is not wading, she is drowning, and until
 * there is a way back out of that the sea does not get to take her
 * further into it.
 */
export const OUT_OF_DEPTH = 10;

/** What the sea is doing at one spot, to something standing in it. */
export interface Surf {
  /** Water over the ground here, world units. Zero on dry land. */
  readonly depth: number;
  /** How completely the water has her, 0 to 1. */
  readonly grip: number;
  /** Where the water is going, world units a second. */
  readonly x: number;
  readonly z: number;
}

const DRY: Surf = { depth: 0, grip: 0, x: 0, z: 0 };

/**
 * @param ground the DRAWN ground height here — `groundHeight`, not the
 *   raw terrain, because she stands on what is drawn
 * @param uphill which way the land rises, as a unit vector. The shore.
 * @param draft how deep the water must be to have her completely, in
 *   WORLD UNITS. One body length, and a parameter rather than a
 *   constant because she GROWS: a founding queen is 5.5 mm and an adult
 *   is 10, so the same puddle takes the young one and only wets the
 *   old one. (This was a constant of 11 for an afternoon, which is 11
 *   CENTIMETRES — a world unit is a centimetre and a body length is a
 *   tenth of one. Eleven body lengths of water before she noticed it.)
 */
export function surfAt(
  wx: number, wz: number, seconds: number,
  ground: number,
  uphill: { readonly x: number; readonly z: number },
  draft: number,
): Surf {
  const surface = seaHeightAt(wx, wz, seconds);
  const depth = surface - ground;
  if (depth <= 0) return DRY;

  const orbit = seaFlowAt(wx, wz, seconds);

  // THE BORE. Once the water is shallower than the wave is tall, the
  // wave is breaking and the water stops orbiting and starts running.
  // A shallow-water wave travels at √(g·d) — the depth here is what
  // sets the speed, and it is why the surge is fastest where it is
  // deepest enough to still be moving and shallowest enough to have
  // broken.
  const broken = 1 - Math.min(1, depth / BREAKS_AT);
  let x = orbit.x;
  let z = orbit.z;
  if (broken > 0) {
    // Which way the surge is going: up the beach on the crest, back
    // down it in the trough. `tanh` for the sign rather than a step, so
    // there is no instant where the water changes its mind — and scaled
    // against the swell rather than against the breaking depth, so it
    // SATURATES. Scaled against the depth it behaved as a second
    // attenuation on top of `broken`, and the two together throttled a
    // 1.7 m/s bore to half a metre a second.
    const swing = Math.tanh(surface / (SWELL * 0.3));
    let run = Math.sqrt(GRAVITY * depth) * swing;
    if (run < 0) run *= SEAWARD;
    // `broken` blends the two REGIMES. It does not slow the bore down:
    // a wave that has broken runs at the speed the depth says it runs.
    x = x * (1 - broken) + uphill.x * run * broken;
    z = z * (1 - broken) + uphill.z * run * broken;
  }

  // EASED, NOT LINEAR. Drag on a body grows faster than the depth does,
  // because the widest part of her is in the middle — a film over her
  // feet has far less of her than a quarter of the pull of water up to
  // her waist. Linear made a puddle a quarter her depth take a quarter
  // of her, which is not what standing in a puddle is like.
  const wet = Math.min(1, Math.max(0, depth / Math.max(1e-6, draft)));
  // OUT OF HER DEPTH, AND THIS IS A RAIL, NOT PHYSICS.
  //
  // Once the water is deeper than she is long by this much she cannot
  // stand, cannot swim — there is no swimming — and any seaward
  // component is a way to lose a queen with no way back. So past here
  // the sea may only ever push her toward the shore.
  //
  // The asymmetry above (SEAWARD) makes the NET drift shoreward, which
  // is true and is real surf. It is also a statistical argument, and a
  // statistical argument is the wrong kind of guarantee for "can the
  // player permanently lose the game to a wave". This is the kind that
  // holds on every frame, and it goes when swimming arrives.
  if (depth > draft * OUT_OF_DEPTH) {
    const out = x * uphill.x + z * uphill.z;
    if (out < 0) {
      x -= uphill.x * out;
      z -= uphill.z * out;
    }
  }

  return { depth, grip: wet * wet * (3 - 2 * wet), x, z };
}

/**
 * Which way the land rises here, as a unit vector — the way a broken
 * wave runs.
 *
 * Sampled a good stride either side rather than at a hair's breadth: a
 * beach at this scale has grain on it, and a gradient taken across two
 * sand ripples points at the nearest ripple instead of at the island.
 *
 * Returns null on ground flat enough to have no uphill, which is a real
 * answer and not a failure — a wave arriving on a flat plain has no
 * preferred direction and the orbital flow is the whole story.
 */
export function shoreward(
  wx: number, wz: number,
  ground: (x: number, z: number) => number,
  step = 40,
): { x: number; z: number } | null {
  const east = ground(wx + step, wz) - ground(wx - step, wz);
  const south = ground(wx, wz + step) - ground(wx, wz - step);
  const slope = Math.hypot(east, south);
  if (slope < 1e-6) return null;
  return { x: east / slope, z: south / slope };
}
