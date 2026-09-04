/**
 * A small seeded generator, so a lossy, jittery test wire is the SAME
 * lossy, jittery wire on every run. `Math.random` cannot be seeded, and
 * a replication test that passes on one draw and fails on the next is a
 * test nobody can act on.
 *
 * mulberry32 (Tommy Ettinger, public domain): 32-bit state, one
 * multiply per draw, period 2^32 — far more than a test consumes and
 * with no visible pattern at the scale of a few thousand messages. Not
 * for anything cryptographic; nothing here is.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
