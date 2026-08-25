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
import {
  cutHalf, MAX_DEPTH, trenchCut, trenchDepth, trenchWidth,
} from '../src/world/carve';

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
  // The cut reaches PAST the channel, so the bank has room to flatten
  // out above the waterline instead of turning the whole corner in the
  // last few centimetres. That shoulder is what Joshua asked for.
  const reach = cutHalf(WIDTH);
  const depth = trenchDepth(half * 2);

  it('touches nothing outside the shoulder', () => {
    // Exactly at the reach the cut is zero — not nearly zero — so the
    // trench meets untouched ground rather than leaving a step for the
    // mesh to find. Inside it, it is not zero, or this would pass on a
    // carve that had stopped working.
    expect(reach).toBeGreaterThan(half);
    expect(trenchCut(50_000, 49_990, reach * 0.99, WIDTH)).toBeGreaterThan(0);
    for (const off of [reach, reach + 1, reach * 2, 1e9]) {
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

  it('curves smoothly: no crease down the middle, no CORNER at the lip', () => {
    // JOSHUA SAW A CORNER AT THE TOP and a raised cosine is why. Its
    // SLOPE is zero at the bank, so the trench does meet flat ground
    // tangentially — but its CURVATURE is not, and it arrives at the
    // lip bending hard while the ground outside is not bending at all.
    // A shaded surface shows a curvature step as an edge.
    //
    // Smootherstep has zero first AND second derivative at both ends,
    // so this checks the second difference and not just the first. A
    // cosine profile fails the curvature assertion below while sailing
    // through the slope one, which is exactly the bug being fixed.
    const land = 50 * M;
    const level = land - 10;
    const at = (off: number) => land - trenchCut(land, level, off, WIDTH);
    const step = reach / 500;
    // Symmetric about the centreline, and deepest there.
    expect(at(step)).toBeCloseTo(at(-step), 6);
    // Monotonic: the bed only ever climbs on the way out. A wedge or a
    // double-dip would break this.
    for (let off = step; off < reach; off += step) {
      expect(at(off)).toBeGreaterThan(at(off - step) - 1e-9);
    }
    const slope = (off: number) => (at(off + step) - at(off)) / step;
    const bend = (off: number) => (slope(off + step) - slope(off)) / step;
    // FLAT AT THE LIP, in both derivatives. Measured against the
    // steepest part of the bank so the bound is relative to the trench
    // rather than to a magic number.
    const steepest = Math.abs(slope(reach / 2));
    expect(Math.abs(slope(reach - step * 2))).toBeLessThan(steepest * 0.02);
    expect(Math.abs(slope(step))).toBeLessThan(steepest * 0.02);
    const hardest = Math.abs(bend(reach * 0.25));
    expect(Math.abs(bend(reach - step * 3))).toBeLessThan(hardest * 0.1);
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
