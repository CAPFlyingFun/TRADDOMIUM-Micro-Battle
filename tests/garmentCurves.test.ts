/**
 * THE DRAFT'S CURVE TOOLS (`src/sarahlab/garment/curves.ts`), on hand-made polylines where every answer is known:
 * polyLength sums its segments; line and bezier sample no coarser than DENSE with both ends exact; bowed bows by its
 * bulge at its middle, to the left of a -> b for a positive bulge and to the right for a negative one; bowedToLength
 * hits the length asked to a tenth of a millimetre on either side, and gives the straight line for a length under the
 * chord; densify keeps every point it was given and its length; mirrorReverse keeps a counter-clockwise half outline
 * counter-clockwise and undoes itself; smooth fixes the ends, leaves a straight line straight and flattens a zigzag.
 */
import { describe, expect, it } from 'vitest';
import { bezier, bowed, bowedToLength, DENSE, densify, dist, line, mirrorReverse, polyLength, smooth } from '../src/sarahlab/garment/curves';
import type { Vec2 } from '../src/sarahlab/garment/types';

/** Signed area of a closed outline: positive when counter-clockwise. */
function area(p: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return a / 2;
}

/** The longest step between consecutive points. */
function maxStep(p: readonly Vec2[]): number {
  let m = 0;
  for (let i = 1; i < p.length; i++) m = Math.max(m, dist(p[i - 1], p[i]));
  return m;
}

/** The signed distance of p from the line a -> b, positive to its LEFT. */
function leftOf(a: Vec2, b: Vec2, p: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return (dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / Math.hypot(dx, dy);
}

describe('polyLength, line and bezier', () => {
  it('polyLength sums the segments; one point is no length', () => {
    expect(polyLength([[0, 0], [3, 4], [3, 10]])).toBeCloseTo(11, 12);
    expect(polyLength([[1, 1]])).toBe(0);
    expect(polyLength([])).toBe(0);
  });

  it('line is straight, sampled every DENSE or finer, ends exact', () => {
    const a: Vec2 = [0.1, -0.2], b: Vec2 = [0.4, 0.2];
    const l = line(a, b);
    expect(l[0]).toEqual(a);
    expect(l[l.length - 1]).toEqual(b);
    expect(maxStep(l)).toBeLessThanOrEqual(DENSE + 1e-12);
    expect(polyLength(l)).toBeCloseTo(dist(a, b), 12);
    for (const p of l) expect(Math.abs(leftOf(a, b, p))).toBeLessThan(1e-12);
    // a zero-length line is still two points
    expect(line(a, a).length).toBe(2);
  });

  it('bezier passes through its ends, sampled every DENSE or finer, and hits a known middle', () => {
    const p0: Vec2 = [0, 0], p1: Vec2 = [0, 0.1], p2: Vec2 = [0.2, 0.1], p3: Vec2 = [0.2, 0];
    const c = bezier(p0, p1, p2, p3);
    expect(c[0]).toEqual(p0);
    expect(c[c.length - 1]).toEqual(p3);
    expect(maxStep(c)).toBeLessThanOrEqual(DENSE);
    // at t = 0.5 the cubic is (p0 + 3 p1 + 3 p2 + p3) / 8 = (0.1, 0.075): the highest point, by symmetry
    expect(Math.max(...c.map((q) => q[1]))).toBeCloseTo(0.075, 5);
  });
});

describe('bowed and bowedToLength', () => {
  it('bowed bows by its bulge at the middle, left for positive and right for negative', () => {
    const a: Vec2 = [0, 0], b: Vec2 = [0.3, 0.4]; // chord 0.5
    for (const bulge of [0.02, 0.1, -0.05]) {
      const c = bowed(a, b, bulge);
      expect(c[0]).toEqual(a);
      expect(c[c.length - 1]).toEqual(b);
      // bezier spaces its samples evenly in t, not in arc, so a strongly bowed curve's steps run a little over DENSE
      // (3.2 mm at a bulge of a fifth of its chord); the contract a pattern edge has to meet is 5 mm (types.ts)
      expect(maxStep(c)).toBeLessThanOrEqual(0.005);
      if (Math.abs(bulge) <= 0.02) expect(maxStep(c)).toBeLessThanOrEqual(DENSE);
      const off = c.map((p) => leftOf(a, b, p));
      const extreme = bulge > 0 ? Math.max(...off) : Math.min(...off);
      expect(extreme).toBeCloseTo(bulge, 4);
      // never to the other side
      for (const o of off) expect(o * Math.sign(bulge)).toBeGreaterThanOrEqual(-1e-12);
    }
    // no bulge: the chord
    expect(polyLength(bowed(a, b, 0))).toBeCloseTo(0.5, 9);
  });

  it('bowedToLength hits the length asked, bowing to the side asked', () => {
    const a: Vec2 = [0, 0], b: Vec2 = [0.2, 0];
    for (const [length, side] of [[0.21, 1], [0.25, -1], [0.4, 1], [0.6, -1]] as const) {
      const c = bowedToLength(a, b, length, side);
      expect(c[0]).toEqual(a);
      expect(c[c.length - 1]).toEqual(b);
      expect(Math.abs(polyLength(c) - length)).toBeLessThan(1e-4);
      const off = c.map((p) => leftOf(a, b, p));
      if (side > 0) expect(Math.max(...off)).toBeGreaterThan(0.005); else expect(Math.min(...off)).toBeLessThan(-0.005);
      for (const o of off) expect(o * side).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it('bowedToLength gives the straight line for a length at or under the chord', () => {
    const a: Vec2 = [0, 0], b: Vec2 = [0, 0.15];
    for (const length of [0.1, 0.15]) {
      const c = bowedToLength(a, b, length, 1);
      expect(polyLength(c)).toBeCloseTo(0.15, 12);
      for (const p of c) expect(Math.abs(p[0])).toBeLessThan(1e-12);
    }
  });
});

describe('densify, mirrorReverse and smooth', () => {
  it('densify keeps every point it was given and its length, and samples every DENSE or finer', () => {
    const pts: Vec2[] = [[0, 0], [0.05, 0], [0.05, 0.002], [0.12, 0.08], [-0.03, 0.1]];
    const d = densify(pts);
    expect(d[0]).toEqual(pts[0]);
    expect(d[d.length - 1]).toEqual(pts[pts.length - 1]);
    for (const p of pts) expect(d.some((q) => q[0] === p[0] && q[1] === p[1])).toBe(true);
    expect(polyLength(d)).toBeCloseTo(polyLength(pts), 12);
    expect(maxStep(d)).toBeLessThanOrEqual(DENSE + 1e-12);
    // no repeated points where the segments join
    for (let i = 1; i < d.length; i++) expect(dist(d[i - 1], d[i])).toBeGreaterThan(0);
  });

  it('mirrorReverse keeps a counter-clockwise half outline counter-clockwise, and undoes itself', () => {
    // the right half of a 2 x 2 square, from the bottom of the centre line up its right side to the top of the centre
    const right: Vec2[] = [[0, -1], [1, -1], [1, 1], [0, 1]];
    const left = mirrorReverse(right);
    expect(left).toEqual([[-0, 1], [-1, 1], [-1, -1], [-0, -1]]);
    const whole = [...right, ...left.slice(1, -1)];
    expect(area(whole)).toBeCloseTo(4, 12);
    expect(mirrorReverse(left).map(([x, y]) => [x + 0, y])).toEqual(right);
    expect(polyLength(left)).toBeCloseTo(polyLength(right), 12);
  });

  it('smooth fixes the ends, leaves a straight line straight and flattens a zigzag', () => {
    const straight = line([0, 0], [0.1, 0.05]);
    const s = smooth(straight, 5);
    expect(s.length).toBe(straight.length);
    for (let i = 0; i < s.length; i++) {
      expect(s[i][0]).toBeCloseTo(straight[i][0], 12);
      expect(s[i][1]).toBeCloseTo(straight[i][1], 12);
    }
    // a zigzag at the sampling's own frequency is gone in one pass of [1, 2, 1] / 4
    const zig: Vec2[] = Array.from({ length: 21 }, (_, i) => [i * 0.01, i % 2 === 0 ? 0 : 0.01] as Vec2);
    const flat = smooth(zig, 1);
    expect(flat[0]).toEqual(zig[0]);
    expect(flat[20]).toEqual(zig[20]);
    for (let i = 1; i < 20; i++) expect(flat[i][1]).toBeCloseTo(0.005, 12);
    // a wave four samples long, starting and ending on zero, halves each pass, ends fixed
    const wave: Vec2[] = Array.from({ length: 21 }, (_, i) => [i * 0.01, 0.01 * Math.sin((i * Math.PI) / 2)] as Vec2);
    const amp = (p: readonly Vec2[]) => Math.max(...p.map((q) => Math.abs(q[1])));
    expect(amp(wave)).toBeCloseTo(0.01, 12);
    expect(amp(smooth(wave, 1))).toBeCloseTo(0.005, 12);
    expect(amp(smooth(wave, 3))).toBeCloseTo(0.00125, 12);
    expect(amp(smooth(wave, 10))).toBeCloseTo(0.01 / 1024, 12);
    for (const q of smooth(wave, 4)) expect(q[0]).toBeCloseTo(Math.round(q[0] * 100) / 100, 12); // x of an even grid stays put
    // the input is not touched, and no passes is a copy
    expect(zig[1]).toEqual([0.01, 0.01]);
    expect(smooth(zig, 0)).toEqual(zig.map((p) => [p[0], p[1]]));
  });
});
