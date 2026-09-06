/**
 * THE ISLAND'S SOURCE OF NUMBERS THAT ARE THE SAME ON EVERY PHONE.
 *
 * Three tools, one file, because they have to agree with each other and
 * with nothing else:
 *
 *   stableHash   a NUMBER for a place — (x, z, salt) in, 0..1 out, no
 *                state, no order. The same cell asked twice, on two
 *                devices, a year apart, gets the same answer. This is
 *                what a deterministic world is made of: a tree does not
 *                stand where a random number generator happened to be
 *                when the player walked up; it stands where its cell's
 *                hash puts it, and the cell's hash is a property of the
 *                cell.
 *
 *   mulberry32   a SEQUENCE of numbers from a seed, for the places a
 *                sequence is genuinely wanted (a weather schedule, the
 *                order of a bough spiral). Seed it from `stableHash` and
 *                the sequence is as stable as the hash.
 *
 *   valueNoise   a SMOOTH field over the plane, built from the hash, so
 *                that grass comes in patches and trees in stands rather
 *                than as confetti. Two octaves is all the clumping needs
 *                and all a phone should pay for.
 *
 * NOT `Math.random`, and not `fract(sin(x))` either. Two players in the
 * same clearing must see the same clearing, and `Math.sin` is not
 * required to agree across JavaScript engines to the last bit, so a
 * placement hashed through it can differ by one tree between two phones.
 * `Math.imul` is exact 32-bit arithmetic everywhere, by specification.
 *
 * ONE COPY. v0 had this hash in `stableHash.ts` and mulberry32 in two
 * places; v1 had mulberry32 in `net/seededRandom.ts` and a second private
 * copy in `weather/skyModel.ts`, because `world/` may not import `net/`
 * (ARCHITECTURE §3). This file is the copy `world/` is allowed to have,
 * the weather now imports it, and anything that grows on the island
 * hashes the same way.
 *
 * Pure: no three, no DOM. `src/world/` is core.
 */

/** 2^32, as a divisor: a uint32 over this is a number in [0, 1). */
const UINT32_RANGE = 4_294_967_296;

/**
 * A number for a place. `x` and `z` are INTEGERS (a cell address, a
 * lattice index — truncated with `| 0` if they are not), `salt` names the
 * question being asked so two questions about one cell get two answers.
 *
 * Returns [0, 1). Stateless and order-independent: the answer depends on
 * the arguments and nothing else, which is the property every window of
 * the island being reconstructable on its own rests on.
 *
 * The constants are v0's (large odd multipliers, xorshift folds); the
 * multiplies are `Math.imul` rather than `*` so the mixing is genuinely
 * 32-bit and not a double that lost its low bits somewhere past 2^53.
 */
export function stableHash(x: number, z: number, salt: number): number {
  let h = Math.imul(x | 0, 374_761_393) + Math.imul(z | 0, 668_265_263) + Math.imul(salt | 0, 1_442_695_041);
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
  h = Math.imul(h ^ (h >>> 16), 2_246_822_507);
  return ((h ^ (h >>> 13)) >>> 0) / UINT32_RANGE;
}

/**
 * The same hash as a 32-bit SEED, for handing to `mulberry32` or for
 * folding further. Kept separate from `stableHash` so a caller that
 * wants bits does not have to multiply a fraction back up and hope.
 */
export function stableSeed(x: number, z: number, salt: number): number {
  let h = Math.imul(x | 0, 374_761_393) + Math.imul(z | 0, 668_265_263) + Math.imul(salt | 0, 1_442_695_041);
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
  h = Math.imul(h ^ (h >>> 16), 2_246_822_507);
  return (h ^ (h >>> 13)) >>> 0;
}

/**
 * mulberry32 (Tommy Ettinger, public domain): 32-bit state, one multiply
 * and a few shifts a draw, period 2^32, no pattern visible at the scale
 * of anything this game asks of it. Not cryptographic; nothing here is.
 *
 * A STATEFUL closure, deliberately: it is for sequences. For a number
 * that belongs to a place, use `stableHash`.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

/** Smoothstep on [0, 1]: the ease that keeps value noise from showing its lattice. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Value noise: a smooth field in [0, 1) over the plane, with a random
 * value at every integer lattice point and an eased bilinear blend
 * between them. `x` and `z` are in LATTICE UNITS — divide a world
 * coordinate by the wavelength wanted before calling.
 *
 * Built on `stableHash`, so it is as stable as the hash: the same field
 * on every device. `salt` gives each consumer its own field, so grass
 * patches and tree stands do not sit on top of each other because they
 * happened to read the same numbers.
 */
export function valueNoise(x: number, z: number, salt: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = ease(x - x0);
  const tz = ease(z - z0);
  const a = stableHash(x0, z0, salt);
  const b = stableHash(x0 + 1, z0, salt);
  const c = stableHash(x0, z0 + 1, salt);
  const d = stableHash(x0 + 1, z0 + 1, salt);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * tz;
}

/**
 * Two octaves of value noise, the second at twice the frequency and half
 * the weight, normalised back to [0, 1). Enough to break a single
 * octave's blobbiness into something that reads as vegetation; not so
 * many that a phone pays for texture it cannot see.
 */
export function clumpNoise(x: number, z: number, salt: number): number {
  const coarse = valueNoise(x, z, salt);
  const fine = valueNoise(x * 2 + 17.3, z * 2 + 9.1, salt + 1);
  return (coarse * 2 + fine) / 3;
}
