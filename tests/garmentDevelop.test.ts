/**
 * READING THE DRESS FORM AND DEVELOPING IT FLAT (`src/sarahlab/garment/form.ts`, `develop.ts`), on synthetic dress
 * forms of circles where every answer is known:
 *
 * - form.ts: `halves` splits a circle into equal halves, or at a raised side plane by the arc above it; `midZ` is its
 *   centre; `acrossFront`/`acrossBack` are the arc r asin(x / r) from the midline, extrapolated straight past the side;
 *   `surfaceZ`/`surfaceZs` agree and are NaN where the outline does not reach; `profile` is the height on a cylinder, the
 *   slant on a cone, bridges a bump (shorter than its surface), and stops where the outline stops reaching its x.
 * - develop.ts: the identity below the underarm line yU; on a cone the lift is the slant's extra length; `y` inverts
 *   `v`; `v` rises with y and the lift is never negative; past yTop the lift holds; `share` scales the lift and 0 makes
 *   the map the identity; and the length to a height reads only her below it (a bulge above changes nothing under it).
 */
import { describe, expect, it } from 'vitest';
import { development } from '../src/sarahlab/garment/develop';
import { acrossBack, acrossFront, halves, midZ, profile, surfaceZ, surfaceZs } from '../src/sarahlab/garment/form';
import type { DressForm } from '../src/sarahlab/garment/types';

/** A circle of radius r about (0, zc), n points, CCW in (x, z) from its largest x. */
function circle(r: number, n = 128, zc = 0): Float64Array {
  const o = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; o[2 * i] = r * Math.cos(a); o[2 * i + 1] = zc + r * Math.sin(a); }
  return o;
}

/** A dress form of circles every `step` from y0 to y1, radius r(y), centred on (0, zc). */
function circleForm(r: (y: number) => number, y0 = 1.0, y1 = 1.6, step = 0.02, zc = 0): DressForm {
  const n = Math.round((y1 - y0) / step) + 1;
  return { y0, step, hulls: Array.from({ length: n }, (_, i) => circle(r(y0 + i * step), 128, zc)) };
}

const R = 0.12;

describe('form.ts on a cylinder of circles', () => {
  const zc = 0.03;
  const form = circleForm(() => R, 1.0, 1.6, 0.02, zc);

  it('halves: a circle splits into equal halves; a raised side plane shortens the front by the arc it cuts off', () => {
    const tol = 2e-3 * Math.PI * R; // a 128-gon is 0.04% short of the circle
    const plain = halves(form, 1.3);
    expect(Math.abs(plain.front - Math.PI * R)).toBeLessThan(tol);
    expect(Math.abs(plain.back - Math.PI * R)).toBeLessThan(tol);
    expect(plain.xMax).toBeCloseTo(R, 6);
    expect(plain.xMin).toBeCloseTo(-R, 6);
    const centred = halves(form, 1.3, zc);
    expect(Math.abs(centred.front - Math.PI * R)).toBeLessThan(tol);
    expect(Math.abs(centred.back - Math.PI * R)).toBeLessThan(tol);
    // a side plane r/2 above the centre: the front is the arc from 30 to 150 degrees
    const raised = halves(form, 1.3, zc + R / 2);
    expect(Math.abs(raised.front - (2 * Math.PI * R) / 3)).toBeLessThan(tol);
    expect(Math.abs(raised.front + raised.back - 2 * Math.PI * R)).toBeLessThan(tol);
    // nothing there: zeros
    expect(halves({ y0: 0, step: 0.1, hulls: [new Float64Array(0)] }, 0)).toEqual({ front: 0, back: 0, xMax: 0, xMin: 0 });
  });

  it('midZ is the centre', () => {
    expect(midZ(form, 1.25)).toBeCloseTo(zc, 6);
    expect(midZ({ y0: 0, step: 0.1, hulls: [new Float64Array(0)] }, 0)).toBe(0);
  });

  it('acrossFront / acrossBack: r asin(x / r) from the midline, straight on past the side', () => {
    for (const x of [0, 0.03, 0.06, 0.1, -0.06]) {
      const want = R * Math.asin(Math.abs(x) / R);
      expect(Math.abs(acrossFront(form, 1.3, x) - want)).toBeLessThan(1e-3 * R + 1e-9);
      expect(Math.abs(acrossBack(form, 1.3, x) - want)).toBeLessThan(1e-3 * R + 1e-9);
    }
    const past = (Math.PI / 2) * R + 0.03;
    expect(Math.abs(acrossFront(form, 1.3, R + 0.03) - past)).toBeLessThan(1e-3);
    // monotone in |x|
    let last = -1;
    for (let x = 0; x <= R; x += 0.005) { const a = acrossFront(form, 1.3, x); expect(a).toBeGreaterThan(last); last = a; }
  });

  it('surfaceZ / surfaceZs: the circle, front and back, NaN past its reach', () => {
    const xs = [0, 0.04, 0.08, 0.11, 0.13, -0.08];
    const fr = surfaceZs(form, 'front', 1.3, xs), bk = surfaceZs(form, 'back', 1.3, xs);
    xs.forEach((x, i) => {
      if (Math.abs(x) > R) {
        expect(Number.isNaN(fr[i])).toBe(true);
        expect(Number.isNaN(surfaceZ(form, 'back', 1.3, x))).toBe(true);
        return;
      }
      const z = Math.sqrt(R * R - x * x);
      expect(Math.abs(fr[i] - (zc + z))).toBeLessThan(5e-4);
      expect(Math.abs(bk[i] - (zc - z))).toBeLessThan(5e-4);
      expect(fr[i]).toBe(surfaceZ(form, 'front', 1.3, x));
      expect(bk[i]).toBe(surfaceZ(form, 'back', 1.3, x));
    });
  });

  it('profile on a cylinder is the height', () => {
    for (const x of [0, 0.06]) {
      const p = profile(form, 'front', x, 1.1, 1.4);
      expect(p.end).toBe(1.4);
      expect(Math.abs(p.length - 0.3)).toBeLessThan(0.0021); // the tape is laid every 2 mm
    }
  });
});

describe('form.ts profile on cones and bumps', () => {
  it('on a cone it is the slant, and it stops where the outline no longer reaches its x', () => {
    // radius 0.12 up to 1.2, then narrowing 0.7 m per metre to 0.05 at 1.3 and on
    const form = circleForm((y) => (y <= 1.2 ? R : Math.max(0.05, R - 0.7 * (y - 1.2))), 1.0, 1.6, 0.1);
    const p = profile(form, 'front', 0, 1.2, 1.28);
    expect(Math.abs(p.length - Math.hypot(0.08, 0.7 * 0.08))).toBeLessThan(0.003);
    expect(p.end).toBe(1.28);
    // at x = 0.1 the outline stops reaching where 0.12 - 0.7 (y - 1.2) = 0.1
    const q = profile(form, 'back', 0.1, 1.0, 1.5);
    expect(Math.abs(q.end - (1.2 + 0.02 / 0.7))).toBeLessThan(0.003);
    // level to 1.2, then the column's depth (6.6 cm there) falls away to nothing in 2.9 cm of height: the tape follows
    // it down, longer than the height, shorter than the height plus the depth
    const depth = Math.sqrt(R * R - 0.01);
    expect(q.length).toBeGreaterThan(q.end - 1.0 + 0.02);
    expect(q.length).toBeLessThan(q.end - 1.0 + depth);
  });

  it('bridges a bump the way a tape does: shorter than the surface, as long as the envelope', () => {
    // flat at 0.10, a 3 cm ridge at 1.3 tapering to nothing at 1.24 and 1.36
    const form = circleForm((y) => 0.1 + 0.03 * Math.max(0, 1 - Math.abs(y - 1.3) / 0.06), 1.0, 1.6, 0.02);
    const p = profile(form, 'front', 0, 1.2, 1.4);
    const envelope = 2 * Math.hypot(0.1, 0.03), surface = 0.08 + 2 * Math.hypot(0.06, 0.03);
    expect(Math.abs(p.length - envelope)).toBeLessThan(1e-3);
    expect(p.length).toBeLessThan(surface - 0.004);
  });
});

describe('develop.ts on a widening cone', () => {
  const yU = 1.2, yTop = 1.45, k = 0.4;
  const r = (y: number) => (y <= yU ? R : R + k * (y - yU));
  const form = circleForm(r, 1.0, 1.6, 0.02);
  const id = (u: number) => u;
  const dev = development(form, 'front', yU, yTop, id);
  const us = [0, 0.03, 0.05, 0.09, 0.11];
  const ys = Array.from({ length: 61 }, (_, i) => 1.1 + i * 0.005); // 1.1 .. 1.4

  /** The front column at x from yU to y: the arc of z = sqrt(r(y)^2 - x^2), which is concave in y (its own envelope). */
  const columnLength = (x: number, y: number): number => {
    let L = 0, py = yU, pz = Math.sqrt(r(yU) ** 2 - x * x);
    for (let s = 1; s <= 2000; s++) {
      const yy = yU + ((y - yU) * s) / 2000, z = Math.sqrt(r(yy) ** 2 - x * x);
      L += Math.hypot(yy - py, z - pz); py = yy; pz = z;
    }
    return L;
  };

  it('is the identity at and below the underarm line', () => {
    expect(dev.yU).toBe(yU);
    for (const u of us) for (const y of [1.0, 1.15, yU]) {
      expect(dev.v(u, y)).toBe(y);
      expect(dev.y(u, y)).toBe(y);
      expect(dev.lift(u, y)).toBe(0);
    }
  });

  it('above it, v - y is how much longer the column is than the height', () => {
    expect(Math.abs(dev.lift(0, 1.4) - (Math.hypot(1, k) - 1) * 0.2)).toBeLessThan(2e-4);
    for (const x of [0.05, 0.09]) for (const y of [1.3, 1.4]) {
      const want = columnLength(x, y) - (y - yU);
      expect(Math.abs(dev.lift(x, y) - want)).toBeLessThan(0.02 * want + 2e-4);
    }
    // wider columns slope more on a widening cone, so they lift more
    expect(dev.lift(0.09, 1.4)).toBeGreaterThan(dev.lift(0.05, 1.4));
    expect(dev.lift(0.05, 1.4)).toBeGreaterThan(dev.lift(0, 1.4));
  });

  it('rises with y, never lifts below zero, and y inverts v', () => {
    for (const u of us) {
      let last = -Infinity;
      for (const y of ys) {
        const v = dev.v(u, y);
        expect(v).toBeGreaterThan(last);
        last = v;
        expect(dev.lift(u, y)).toBeGreaterThanOrEqual(0);
        expect(Math.abs(dev.y(u, v) - y)).toBeLessThan(1e-7);
      }
    }
  });

  it('past yTop the lift holds; past xMax the column at xMax is used', () => {
    expect(dev.lift(0.05, yTop + 0.1)).toBeCloseTo(dev.lift(0.05, yTop), 9);
    expect(dev.lift(0.2, 1.35)).toBeCloseTo(dev.lift(0.11, 1.35), 12);
    expect(dev.lift(-0.05, 1.35)).toBeCloseTo(dev.lift(0.05, 1.35), 12);
  });

  it('`share` scales the lift; 0 is the identity', () => {
    const half = development(form, 'front', yU, yTop, id, 0.11, 0.5), none = development(form, 'front', yU, yTop, id, 0.11, 0);
    for (const u of us) for (const y of ys) {
      expect(half.lift(u, y)).toBeCloseTo(0.5 * dev.lift(u, y), 12);
      expect(none.v(u, y)).toBeCloseTo(y, 12);
      expect(Math.abs(half.y(u, half.v(u, y)) - y)).toBeLessThan(1e-7);
    }
    expect(half.lift(0.09, 1.4)).toBeGreaterThan(0.005);
  });

  it('the length to a height reads only her below it: a bulge above changes nothing under it', () => {
    // the same cone to 1.34, then a chin jutting 6 cm out from 1.36
    const chin = circleForm((y) => (y < 1.35 ? r(y) : r(y) + 0.06), 1.0, 1.6, 0.02);
    const other = development(chin, 'front', yU, yTop, id);
    for (const u of us) for (const y of ys) if (y <= 1.338) expect(other.v(u, y)).toBeCloseTo(dev.v(u, y), 9);
    // ...and the bulge itself does lengthen the column (the comparison above is not vacuous)
    expect(other.lift(0, 1.4)).toBeGreaterThan(dev.lift(0, 1.4) + 0.02);
  });

  it('the back is developed over the back of the form', () => {
    // an egg: the front stands out with height, the back does not move
    const egg: DressForm = {
      y0: 1.0, step: 0.02,
      hulls: Array.from({ length: 31 }, (_, i) => {
        const y = 1.0 + i * 0.02, front = y <= yU ? R : R + k * (y - yU), n = 128, o = new Float64Array(2 * n);
        for (let j = 0; j < n; j++) { const a = (2 * Math.PI * j) / n, s = Math.sin(a); o[2 * j] = R * Math.cos(a); o[2 * j + 1] = (s > 0 ? front : R) * s; }
        return o;
      }),
    };
    const f = development(egg, 'front', yU, yTop, id), b = development(egg, 'back', yU, yTop, id);
    expect(f.lift(0, 1.4)).toBeGreaterThan(0.01);
    expect(b.lift(0, 1.4)).toBeLessThan(f.lift(0, 1.4) / 2);
    for (const y of ys) expect(b.lift(0.05, y)).toBeGreaterThanOrEqual(0);
  });
});
