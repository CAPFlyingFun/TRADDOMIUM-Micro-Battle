/**
 * THE TRENCH, AND THE TWO BOUNDS THAT MAKE IT SAFE.
 *
 * Version 1 carved channels and gutted hillsides with them: a stream at
 * the bottom of a gorge pressed ground partway up its own wall toward
 * ITS level, cutting pale benches out of both valley sides that were
 * visible from the air with the water switched off. That is why nothing
 * was cut for two versions, and it is why the cut is back only with
 * bounds attached.
 *
 * These tests are those bounds. Everything else in carve.ts is shape and
 * taste; this is the part that cannot be allowed to regress, because the
 * failure mode is not a wrong number on a screen, it is the island.
 */
import { describe, expect, it } from 'vitest';
import { MAX_DEPTH, trenchCut, trenchDepth, trenchWidth } from '../src/world/carve';

const M = 100;

describe('the channel a stream is given', () => {
  it('scales with the true width, floored and capped', () => {
    // 0.6 m is the island's median true channel; eight times it is the
    // 4.8 m stream Joshua actually has to find.
    expect(trenchWidth(0.6 * M)).toBeCloseTo(4.8 * M, 6);
    // Under the floor, and far under it, still gets the 2 m minimum.
    expect(trenchWidth(0.1 * M)).toBe(2 * M);
    expect(trenchWidth(0)).toBe(2 * M);
    // The Wailua, the island's largest, gets a river and not an estuary.
    expect(trenchWidth(30.8 * M)).toBe(40 * M);
    expect(trenchWidth(1000 * M)).toBe(40 * M);
  });

  it('runs as deep as it is wide, and never past a metre', () => {
    // Joshua's rule, in his words: "make the depth based on width so if
    // it's like 64 cm wide, is the same depth", with "a max depth of 1 m
    // for each waterway".
    expect(trenchDepth(0.64 * M)).toBeCloseTo(0.64 * M, 6);
    expect(trenchDepth(0.5 * M)).toBeCloseTo(0.5 * M, 6);
    expect(trenchDepth(1 * M)).toBe(MAX_DEPTH);
    expect(trenchDepth(40 * M)).toBe(MAX_DEPTH);
    expect(MAX_DEPTH).toBe(1 * M);
  });
});

describe('the cut, and what it refuses to do', () => {
  const WIDTH = 5 * M;                    // true width -> a 40 m channel
  const half = trenchWidth(WIDTH) / 2;
  const depth = trenchDepth(half * 2);

  it('touches nothing outside half a channel width', () => {
    // The bank, and everything past it. Exactly at the half-width the
    // cut is zero — not nearly zero — so the trench meets untouched
    // ground rather than leaving a step for the mesh to find.
    for (const off of [half, half + 1, half * 2, 10_000, 1e9]) {
      expect(trenchCut(50_000, 49_990, off, WIDTH)).toBe(0);
    }
  });

  it('NEVER lowers a point by more than one depth, whatever stands beside it', () => {
    // THE BOUND THAT VERSION 1 DID NOT HAVE. A bank twenty, fifty, five
    // hundred metres above its stream is exactly the case that cut
    // benches out of the Napali walls, because the old carve pressed
    // ground toward a LEVEL and a level can be arbitrarily far below.
    // Here the answer is one metre and it does not matter how far.
    const level = 10 * M;
    for (const land of [10 * M, 12 * M, 30 * M, 100 * M, 1_000 * M, 150_000]) {
      for (let off = 0; off < half; off += half / 37) {
        const cut = trenchCut(land, level, off, WIDTH);
        expect(cut).toBeGreaterThanOrEqual(0);
        expect(cut).toBeLessThanOrEqual(depth);
      }
    }
  });

  it('cuts a full depth on the centreline of a channel it can reach', () => {
    // Where the ground is the water's own bank rather than a cliff over
    // it, the trench is the depth it says it is — this is the case that
    // has to work, and the bound above must not quietly eat it.
    const land = 50 * M;
    const level = land - 10;               // the freeboard the bake uses
    expect(trenchCut(land, level, 0, WIDTH)).toBeCloseTo(depth, 6);
  });

  it('curves smoothly: no crease down the middle, no lip at the bank', () => {
    // "Curved smoothly" is a raised cosine and not a wedge. A wedge has
    // a kink on the centreline that shows as a seam in a mesh cut at 8
    // units; the cosine is flat at both ends, so the trench leaves and
    // rejoins the ground tangentially.
    const land = 50 * M;
    const level = land - 10;
    const at = (off: number) => land - trenchCut(land, level, off, WIDTH);
    const step = half / 400;
    // Symmetric about the centreline, and deepest there.
    expect(at(step)).toBeCloseTo(at(-step), 6);
    for (let off = step; off < half; off += step) {
      expect(at(off)).toBeGreaterThan(at(off - step) - 1e-9);
    }
    // Flat at the middle and flat at the bank: the second sample either
    // side of both differs from the first by far less than the middle of
    // the slope does, which is what "no kink" means numerically.
    const nearMid = at(step * 2) - at(step);
    const nearBank = at(half - step) - at(half - step * 2);
    const midSlope = at(half / 2 + step) - at(half / 2);
    expect(nearMid).toBeLessThan(midSlope * 0.2);
    expect(nearBank).toBeLessThan(midSlope * 0.2);
  });

  it('never raises the ground, only ever lowers it', () => {
    // A carve that can ADD ground is a carve that can bury her, and the
    // min() against `land` is the only thing standing between the two.
    // Asserted against a level far ABOVE the ground, which is the case
    // that would do it.
    for (let off = 0; off < half; off += half / 23) {
      expect(trenchCut(20 * M, 900 * M, off, WIDTH)).toBeGreaterThanOrEqual(0);
    }
  });
});
