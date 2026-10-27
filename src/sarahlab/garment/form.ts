/**
 * READING THE DRESS FORM (`measure.ts` builds it): the lengths a pattern drafter takes off a form with a tape.
 *
 * - `halves(form, y)`: the front and the back of her outline at a height, each from side to side (a tape measure's
 *   path, bridging every hollow).
 * - `acrossFront(form, y, x)` / `acrossBack`: along the outline from her midline to the point at |x| on the front (back),
 *   both sides averaged so the pattern is symmetric.
 * - `profile(form, 'front' | 'back', x, y0, y1)`: down (or up) her front at a fixed |x|, the length a tape laid
 *   vertically over her takes -- bridging under her bust and over her belly (the convex envelope of her outline's front
 *   at that x, height by height) -- and where it runs out (where her outline no longer reaches |x|: the top of her
 *   shoulder at that x).
 *
 * Plain TypeScript, metres; nothing of three.js.
 */
import { hullAt } from './measure';
import type { DressForm } from './types';

interface Halves { readonly front: number; readonly back: number; readonly xMax: number; readonly xMin: number }

/** Arc length along an outline (x, z pairs) from index i to j going forward (wrapping). */
function arc(h: Float64Array, i: number, j: number): number {
  const n = h.length / 2;
  let s = 0;
  for (let k = i; k !== j; k = (k + 1) % n) {
    const l = (k + 1) % n;
    s += Math.hypot(h[2 * l] - h[2 * k], h[2 * l + 1] - h[2 * k + 1]);
  }
  return s;
}

function minXIndex(h: Float64Array): number {
  let m = 0;
  for (let k = 1; k < h.length / 2; k++) if (h[2 * k] < h[2 * m]) m = k;
  return m;
}

/**
 * Her front and back at height y, each from side seam to side seam: the outline split where it crosses z = zSide (the
 * plane her side seams hang in), front being the part with z > zSide. Without zSide, split at the outline's x
 * extremes. Also the outline's x extremes.
 */
export function halves(form: DressForm, y: number, zSide?: number): Halves {
  const h = hullAt(form, y);
  if (h.length < 6) return { front: 0, back: 0, xMax: 0, xMin: 0 };
  const n = h.length / 2, m = minXIndex(h);
  if (zSide === undefined) return { front: arc(h, 0, m), back: arc(h, m, 0), xMax: h[0], xMin: h[2 * m] };
  // the two crossings of z = zSide, as (segment index, fraction); then the arc over z > zSide between them
  const cross: { k: number; t: number; up: boolean }[] = [];
  for (let k = 0; k < n; k++) {
    const l = (k + 1) % n, za = h[2 * k + 1] - zSide, zb = h[2 * l + 1] - zSide;
    if ((za < 0 && zb >= 0) || (za >= 0 && zb < 0)) cross.push({ k, t: za / (za - zb), up: zb >= 0 });
  }
  if (cross.length !== 2) return { front: arc(h, 0, m), back: arc(h, m, 0), xMax: h[0], xMin: h[2 * m] };
  const total = arc(h, 0, 0) || perimeterOf(h);
  const pos = (c: { k: number; t: number }) => arc(h, 0, c.k) + c.t * Math.hypot(h[2 * ((c.k + 1) % n)] - h[2 * c.k], h[2 * ((c.k + 1) % n) + 1] - h[2 * c.k + 1]);
  const enter = cross.find((c) => c.up)!, leave = cross.find((c) => !c.up)!;
  let front = pos(leave) - pos(enter);
  if (front < 0) front += total;
  return { front, back: total - front, xMax: h[0], xMin: h[2 * m] };
}

function perimeterOf(h: Float64Array): number {
  const n = h.length / 2;
  let s = 0;
  for (let k = 0; k < n; k++) { const l = (k + 1) % n; s += Math.hypot(h[2 * l] - h[2 * k], h[2 * l + 1] - h[2 * k + 1]); }
  return s;
}

/** The plane her side seams hang in at height y: halfway between her front and back there, metres of z. */
export function midZ(form: DressForm, y: number): number {
  const h = hullAt(form, y);
  if (h.length < 6) return 0;
  let lo = Infinity, hi = -Infinity;
  for (let k = 1; k < h.length; k += 2) { lo = Math.min(lo, h[k]); hi = Math.max(hi, h[k]); }
  return (lo + hi) / 2;
}

/**
 * Walk the front (sign +1) or back (-1) path of the outline at y and return, as a function of lateral position, the
 * arc length from the midline crossing; plus the z of the path at lateral x. Both sides are averaged.
 */
function path(form: DressForm, y: number, sign: 1 | -1): { xs: number[]; zs: number[]; ss: number[] } | null {
  const h = hullAt(form, y);
  if (h.length < 6) return null;
  const n = h.length / 2, m = minXIndex(h);
  // the front path runs 0 -> m (CCW, x falling from + to -), the back path m -> 0 (x rising); either way, collect points
  // ordered by falling x along the path from the +x extreme to the -x extreme
  const idx: number[] = [];
  if (sign > 0) for (let k = 0; k !== m; k = (k + 1) % n) idx.push(k);
  else for (let k = 0; k !== m; k = (k - 1 + n) % n) idx.push(k);
  idx.push(m);
  const xs: number[] = [], zs: number[] = [], ss: number[] = [];
  let s = 0;
  for (let q = 0; q < idx.length; q++) {
    if (q > 0) s += Math.hypot(h[2 * idx[q]] - h[2 * idx[q - 1]], h[2 * idx[q] + 1] - h[2 * idx[q - 1] + 1]);
    xs.push(h[2 * idx[q]]); zs.push(h[2 * idx[q] + 1]); ss.push(s);
  }
  return { xs, zs, ss };
}

/** Where along a path (by arc) x first equals X; NaN when never. The path's x falls from + to - (not strictly). */
function arcAtX(p: { xs: number[]; ss: number[] }, X: number): number {
  for (let k = 1; k < p.xs.length; k++) {
    const a = p.xs[k - 1], b = p.xs[k];
    if ((a - X) * (b - X) <= 0 && a !== b) { const t = (a - X) / (a - b); return p.ss[k - 1] + t * (p.ss[k] - p.ss[k - 1]); }
  }
  return NaN;
}
function zAtX(p: { xs: number[]; zs: number[] }, X: number): number {
  for (let k = 1; k < p.xs.length; k++) {
    const a = p.xs[k - 1], b = p.xs[k];
    if ((a - X) * (b - X) <= 0 && a !== b) { const t = (a - X) / (a - b); return p.zs[k - 1] + t * (p.zs[k] - p.zs[k - 1]); }
  }
  return NaN;
}

/** Along the front (back) of the outline at y from the midline to |x|, both sides averaged; extrapolated straight past the side. */
function across(form: DressForm, y: number, x: number, sign: 1 | -1): number {
  const p = path(form, y, sign);
  if (!p) return Math.abs(x);
  const mid = arcAtX(p, 0), X = Math.abs(x);
  const side = (s: 1 | -1): number => {
    const e = s > 0 ? p.xs[0] : p.xs[p.xs.length - 1];
    if (s * e < X) return Math.abs((s > 0 ? 0 : p.ss[p.ss.length - 1]) - mid) + (X - s * e);
    return Math.abs(arcAtX(p, s * X) - mid);
  };
  return (side(1) + side(-1)) / 2;
}
export const acrossFront = (form: DressForm, y: number, x: number): number => across(form, y, x, 1);
export const acrossBack = (form: DressForm, y: number, x: number): number => across(form, y, x, -1);

/** The z of her front (back) at height y and lateral |x| (both sides averaged), NaN where her outline does not reach. */
export function surfaceZ(form: DressForm, side: 'front' | 'back', y: number, x: number): number {
  const p = path(form, y, side === 'front' ? 1 : -1);
  if (!p) return NaN;
  const a = zAtX(p, Math.abs(x)), b = zAtX(p, -Math.abs(x));
  return Number.isNaN(a) ? b : Number.isNaN(b) ? a : (a + b) / 2;
}

/** surfaceZ at many |x| at once (one walk of the outline): NaN where her outline does not reach. */
export function surfaceZs(form: DressForm, side: 'front' | 'back', y: number, xs: readonly number[]): number[] {
  const p = path(form, y, side === 'front' ? 1 : -1);
  if (!p) return xs.map(() => NaN);
  return xs.map((x) => { const a = zAtX(p, Math.abs(x)), b = zAtX(p, -Math.abs(x)); return Number.isNaN(a) ? b : Number.isNaN(b) ? a : (a + b) / 2; });
}

const PROFILE_STEP = 0.002;

/**
 * A tape laid up her front (back) at lateral |x| from y0 to y1 (y1 > y0): the length of the convex envelope of her
 * surface there (bridging hollows, as fabric does), and the height where her outline stops reaching |x| (her shoulder's
 * top at that x) if that comes before y1.
 */
export function profile(form: DressForm, side: 'front' | 'back', x: number, y0: number, y1: number): { length: number; end: number } {
  const ys: number[] = [], zs: number[] = [];
  const out = side === 'front' ? 1 : -1;
  let end = y1;
  for (let y = y0; y <= y1 + 1e-9; y += PROFILE_STEP) {
    const z = surfaceZ(form, side, y, x);
    if (Number.isNaN(z)) { end = y; break; }
    ys.push(y); zs.push(out * z);
  }
  if (ys.length < 2) return { length: Math.max(0, end - y0), end };
  // upper convex envelope of (y, out*z): Andrew's monotone chain, keeping the chain above
  const hull: number[] = [];
  for (let i = 0; i < ys.length; i++) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2], b = hull[hull.length - 1];
      const cross = (ys[b] - ys[a]) * (zs[i] - zs[a]) - (zs[b] - zs[a]) * (ys[i] - ys[a]);
      if (cross >= 0) hull.pop(); else break;
    }
    hull.push(i);
  }
  let length = 0;
  for (let k = 1; k < hull.length; k++) length += Math.hypot(ys[hull[k]] - ys[hull[k - 1]], zs[hull[k]] - zs[hull[k - 1]]);
  return { length, end };
}
