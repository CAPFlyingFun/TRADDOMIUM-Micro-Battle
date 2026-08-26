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
  bank, BANK_GLSL, cutHalf, MAX_DEPTH, trenchCut, trenchDepth, trenchWidth,
  waterDepth, WATER_DEPTH_GLSL,
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

/**
 * THE SHADER'S COPY OF THE CURVE, HELD TO THE ORIGINAL.
 *
 * The water's colour and its transparency now come from the trench's
 * own profile — the fragment shader evaluates the same bank curve the
 * carve uses, because a ground-height TEXTURE could not hold a twelve
 * metre channel at one texel every 54.7 m and, worse, was built from a
 * grid the runtime trench had never been cut into. Measured on the
 * shipped build: the shader believed the mean depth was -0.11 m where
 * the game had 0.90 m, and 66.6% of the island's water was drawn at
 * zero alpha. Joshua, for three versions: the water is there and you
 * cannot see it.
 *
 * That fix is only as good as the two copies staying ONE function. GLSL
 * is a string here; nothing compiles it, nothing typechecks it, and a
 * tweak to bank() would leave the shader on the old shape with no
 * complaint from anything. So the string is read back, transliterated,
 * and made to answer identically. If this test ever fails, the water is
 * being shaded by a curve the ground is not cut to.
 */
/**
 * A GLSL function, run as JavaScript.
 *
 * GLSL and JS share arithmetic; what differs in these two functions is
 * `float` declarations, float literals, and the three built-ins below,
 * all of which translate exactly. Nothing here would survive a real
 * shader — it survives THESE shaders, which are deliberately kept to
 * arithmetic so that this check is possible at all.
 */
function transliterate(glsl: string, ...args: string[]): (...xs: number[]) => number {
  const body = glsl.slice(glsl.indexOf('{') + 1, glsl.lastIndexOf('}'));
  return new Function(...args, body
    .replace(/\bfloat\b/g, 'const')
    // Built-ins BEFORE clamp: clamp expands to Math.min/Math.max, and
    // a later \bmin\b pass would find the `min` inside `Math.min`.
    .replace(/\b(abs|max|min)\(/g, (_, f) => `Math.${f}(`)
    .replace(/\bclamp\(([^;]+?), ([^;]+?), ([^;]+?)\)/g,
      'Math.min($3, Math.max($2, $1))')) as (...xs: number[]) => number;
}

describe('the bank curve the shader draws with', () => {
  const glsl = transliterate(BANK_GLSL, 't') as (t: number) => number;

  it('is the same function the ground is cut with', () => {
    for (let i = 0; i <= 64; i++) {
      const t = i / 64;
      expect(glsl(t)).toBeCloseTo(bank(t), 12);
    }
  });

  it('agrees outside the trench as well as inside it', () => {
    // The slab is drawn wider than the cut, so the shader is asked for
    // t past 1 on every shoreline pixel. Both must clamp, or the water
    // gets an alpha from a polynomial running away past its domain.
    for (const t of [-4, -1, -0.001, 1.001, 2, 40]) {
      expect(glsl(t)).toBeCloseTo(bank(t), 12);
    }
  });

  it('is full depth mid-channel and nothing at the lip', () => {
    // The two ends the whole profile hangs off: a pond passes t = 0 and
    // must come out at its own full depth; the bank must reach zero, or
    // the shoreline is a step in the alpha instead of a ramp.
    expect(glsl(0)).toBe(1);
    expect(glsl(1)).toBe(0);
  });
});

/**
 * AND THE DEPTH EXPRESSION BUILT ON IT, held to its twin the same way.
 *
 * This is the one that decides whether a fragment of water is drawn at
 * all, and four separate shipped versions of the water got it wrong —
 * see tests/waterDepth.test.ts for the list. Those tests hold the JS
 * side to the actual island; this one holds the GLSL side to the JS,
 * which is the only part of the chain nothing else can reach: the
 * shader is a string here, nothing compiles it, and a fix applied to
 * one copy and not the other would look exactly like a fix.
 */
describe('the depth expression the shader draws with', () => {
  const glsl = transliterate(WATER_DEPTH_GLSL, 'deep', 'across', 'span', 'rise');
  // tmbWaterDepth calls tmbBank, and a `new Function` body resolves
  // free names against the global scope, so that is where it goes.
  const run = (d: number, a: number, s: number, r: number) => {
    (globalThis as Record<string, unknown>).tmbBank = bank;
    try { return glsl(d, a, s, r); } finally {
      delete (globalThis as Record<string, unknown>).tmbBank;
    }
  };

  it('is the same expression the JS side uses', () => {
    // Across the three cases the derivation splits into: bank above the
    // water, floor between bed and waterline, floor below the bed.
    for (const deep of [0, 30, 100]) {
      for (const span of [1, 384, 3200]) {
        for (const across of [0, 100, 383, 384, 2000, 12000]) {
          for (const rise of [-4000, -100, -1, 0, 1, 60, 500]) {
            expect(run(deep, across, span, rise))
              .toBeCloseTo(waterDepth(deep, across, span, rise), 10);
          }
        }
      }
    }
  });

  it('never claims water where the ground is above it and the trench is dry', () => {
    // Past the trench lip the profile is nothing, so all that is left
    // is the bank — and a bank standing above the waterline must come
    // out negative, or the shoreline is a hard edge held back only by
    // the depth test.
    expect(waterDepth(100, 5000, 384, -300)).toBeLessThan(0);
    expect(run(100, 5000, 384, -300)).toBeLessThan(0);
  });

  it('gives a pond its measured depth from edge to edge', () => {
    // buildPonds passes across 0 and span 1, which puts every corner at
    // the middle of the profile where the curve answers exactly 1.
    expect(waterDepth(240, 0, 1, 240)).toBeCloseTo(240, 10);
    expect(run(240, 0, 1, 240)).toBeCloseTo(240, 10);
  });
});

/**
 * A POND CARRIES ZERO `deep`, AND ITS DEPTH IS THE GROUND'S ALONE.
 *
 * buildPonds samples `rise` per vertex from the uncut island and sets
 * `deep` to nought, so waterDepth collapses to max(rise, min(rise, 0))
 * — the rise itself: positive underwater, negative on the bank, with
 * the same six-centimetre alpha ramp as every stream at the crossing.
 * That is the whole of the smooth pond shoreline, and it also retires
 * a sliver: `across` is the ripple coordinate on ponds, and wherever
 * it passed near nought the bank curve came back positive — a
 * non-zero `deep` would have punched a full-depth stripe through the
 * shore ramp every 875 m.
 *
 * This coupling between three files is invisible in all of them, so
 * it is written down here. If waterDepth stops answering `rise` when
 * `deep` is nought, every lake shoreline goes back to a sawtooth.
 */
describe('a pond, which has no profile at all', () => {
  it('is exactly as deep as the water stands over the ground', () => {
    for (const across of [0, 0.4, 500, 87_500, -87_500]) {
      for (const span of [1, 384]) {
        for (const rise of [1, 45, 240, 900]) {
          expect(waterDepth(0, across, span, rise)).toBe(rise);
        }
      }
    }
  });

  it('is dry on the bank, whatever the ripple coordinate does', () => {
    // Negative rise must come out non-positive even at across near
    // nought, where the bank curve answers 1 — this is the stripe a
    // non-zero deep would have drawn.
    for (const across of [0, 0.4, 2, 500]) {
      expect(waterDepth(0, across, 1, -30)).toBeLessThanOrEqual(0);
    }
    // And with a deep, the stripe is real — which is why ponds must
    // never carry one.
    expect(waterDepth(240, 0, 1, -30)).toBeGreaterThan(0);
  });

  it('and that is not true of a reach, which is the point', () => {
    // A reach's rise is NOT its depth — on a bank it is negative and
    // the trench profile decides everything.
    expect(waterDepth(100, 0, 384, -50)).toBeGreaterThan(waterDepth(100, 300, 384, -50));
  });
});
