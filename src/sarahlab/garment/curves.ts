/**
 * Small 2D curve tools for drafting pattern pieces (`draft.ts`): polylines sampled densely enough that a pattern edge
 * follows its curve (`DENSE`), their lengths, cubic Béziers, and a curve whose bulge is solved so it has an exact length
 * (how a seam's two sides are made to match). Plain TypeScript; metres.
 */
import type { Vec2 } from './types';

/** Pattern edges are polylines no coarser than this, metres (types.ts asks for <= 5 mm). */
export const DENSE = 0.003;

export function dist(a: Vec2, b: Vec2): number { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

export function polyLength(p: readonly Vec2[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]);
  return s;
}

/** A cubic Bézier from p0 to p3 with controls p1, p2, sampled every DENSE or finer (both ends exact). */
export function bezier(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): Vec2[] {
  const rough = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
  const n = Math.max(2, Math.ceil(rough / DENSE));
  const out: Vec2[] = [p0];
  for (let i = 1; i < n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  out.push(p3);
  return out;
}

/** A straight line from a to b, sampled every DENSE or finer. */
export function line(a: Vec2, b: Vec2): Vec2[] {
  const n = Math.max(1, Math.ceil(dist(a, b) / DENSE));
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) out.push(i === n ? b : [a[0] + (b[0] - a[0]) * (i / n), a[1] + (b[1] - a[1]) * (i / n)]);
  return out;
}

/**
 * A curve from a to b that bows `bulge` metres to the LEFT of the direction a -> b at its middle (negative: to the
 * right), as a cubic whose controls sit a third and two thirds of the way along, pushed sideways.
 */
export function bowed(a: Vec2, b: Vec2, bulge: number): Vec2[] {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l, ny = dx / l, k = bulge * 4 / 3; // a cubic with both controls pushed by k bows by 0.75 k at its middle
  return bezier(a, [a[0] + dx / 3 + nx * k, a[1] + dy / 3 + ny * k], [a[0] + 2 * dx / 3 + nx * k, a[1] + 2 * dy / 3 + ny * k], b);
}

/**
 * `bowed(a, b, bulge)` with the bulge solved (bisection) so the curve is `length` long, bowing toward `side` (+1 left of
 * a -> b, -1 right). A length shorter than the chord gives the straight line.
 */
export function bowedToLength(a: Vec2, b: Vec2, length: number, side: 1 | -1): Vec2[] {
  const chord = dist(a, b);
  if (length <= chord * (1 + 1e-9)) return line(a, b);
  let lo = 0, hi = chord;
  while (polyLength(bowed(a, b, side * hi)) < length && hi < 10 * chord) hi *= 2;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (polyLength(bowed(a, b, side * mid)) < length) lo = mid; else hi = mid;
  }
  return bowed(a, b, side * (lo + hi) / 2);
}

/** The polyline from a list of points, resampled every DENSE or finer by chaining straight lines (endpoints kept). */
export function densify(points: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [points[0]];
  for (let i = 1; i < points.length; i++) { const seg = line(points[i - 1], points[i]); for (let k = 1; k < seg.length; k++) out.push(seg[k]); }
  return out;
}

/** The polyline mirrored about x = 0 AND reversed (so a counter-clockwise outline's mirror half stays counter-clockwise). */
export function mirrorReverse(p: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = p.length - 1; i >= 0; i--) out.push([-p[i][0], p[i][1]]);
  return out;
}

/** Moving-average smoothing of a polyline's interior points (ends fixed), `passes` times. */
export function smooth(p: readonly Vec2[], passes: number): Vec2[] {
  let a = p.map((q) => [q[0], q[1]] as [number, number]);
  for (let k = 0; k < passes; k++) {
    const b = a.map((q) => [q[0], q[1]] as [number, number]);
    for (let i = 1; i < a.length - 1; i++) { b[i][0] = (a[i - 1][0] + 2 * a[i][0] + a[i + 1][0]) / 4; b[i][1] = (a[i - 1][1] + 2 * a[i][1] + a[i + 1][1]) / 4; }
    a = b;
  }
  return a;
}
