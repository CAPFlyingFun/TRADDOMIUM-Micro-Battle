/**
 * HER UPPER BODY DEVELOPED FLAT (Stage 2b): above the underarm a pattern's height is not her height.
 *
 * Measured on her (Stage 2b, raglan with gusset, dressed in node): from the underarm line up to her shoulder ridge at
 * the neckline's side, her front is 30.8 cm of surface for 20.3 cm of height -- her bust and the slope of her upper
 * chest back to her shoulder take the rest -- and her back 22.2 cm. A bodice drafted with "pattern height = her height"
 * was 10 cm short there; dressed, it rode 3 to 5 cm up her and stretched its whole yoke 10 to 40%.
 *
 * So above the underarm a bodice is drafted in HER heights (where the neckline is on her, where the raglan line runs)
 * and each point is then carried to the pattern by this map: across stays across (u, the arc from her midline), and up
 * becomes the length a tape laid up her front (back) at that width takes from the underarm line to that height --
 * the convex envelope of her surface in that column up to that height, bridging under her bust as fabric does
 * (`form.ts` profile). Below
 * the underarm it is the identity. Columns wider than `xMax` (into her armpit, where the column no longer starts at the
 * underarm line) use the column at `xMax`.
 *
 * Plain TypeScript, metres; nothing of three.js.
 */
import { surfaceZs } from './form';
import type { DressForm } from './types';

export interface Development {
  /** Where the map starts (her underarm line), metres. */
  readonly yU: number;
  /** Her height y at across-arc u -> the pattern's v. */
  v(u: number, y: number): number;
  /** The inverse: the pattern's v at u -> her height. */
  y(u: number, v: number): number;
  /** How much longer than her height the column at u is from the underarm line to y (v - y). */
  lift(u: number, y: number): number;
}

const DX = 0.005, DY = 0.002;
/** The developed length rises at least this share of the height, so the map is strictly increasing (invertible). */
const MIN_RISE = 0.01;

/**
 * The development of her front (side 'front') or back over the dress form `form`, from the underarm line `yU` up to
 * `yTop`, taking `share` of the extra length. `xOfU` turns the pattern's across-arc into her lateral |x| (the inverse of the draft's across measure).
 */
export function development(form: DressForm, side: 'front' | 'back', yU: number, yTop: number, xOfU: (u: number) => number, xMax = 0.11, share = 1): Development {
  const out = side === 'front' ? 1 : -1;
  const cols = Math.max(1, Math.round(xMax / DX)) + 1, rows = Math.max(2, Math.ceil((yTop - yU) / DY) + 1);
  // per column: the developed length at each row (cumulative along the convex envelope; past where her outline stops
  // reaching that width, the length goes on one for one with height)
  const len: Float64Array[] = [];
  const xs = Array.from({ length: cols }, (_, c) => Math.min(xMax, c * DX));
  const grid = Array.from({ length: rows }, (_, r) => surfaceZs(form, side, yU + r * DY, xs));
  for (let c = 0; c < cols; c++) {
    const ys: number[] = [], zs: number[] = [];
    for (let r = 0; r < rows; r++) {
      const z = grid[r][c];
      if (Number.isNaN(z)) break;
      ys.push(yU + r * DY); zs.push(out * z);
    }
    const L = new Float64Array(rows);
    // the developed length to each row is a tape from the underarm line to THAT height: the upper convex envelope of
    // (y, out*z) over rows 0..r only (Andrew's monotone chain run upward: after row r the stack is that prefix's
    // envelope), so a neckline at the throat's height does not borrow a bridge to the chin above it. Kept non-
    // decreasing -- rising at least MIN_RISE of the height -- so the map has an inverse.
    const hull: number[] = [];
    let total = 0;
    const seg = (a: number, b: number) => Math.hypot(ys[b] - ys[a], zs[b] - zs[a]);
    for (let r = 0; r < ys.length; r++) {
      while (hull.length >= 2) {
        const a = hull[hull.length - 2], b = hull[hull.length - 1];
        if ((ys[b] - ys[a]) * (zs[r] - zs[a]) - (zs[b] - zs[a]) * (ys[r] - ys[a]) >= 0) { total -= seg(a, b); hull.pop(); } else break;
      }
      if (hull.length) total += seg(hull[hull.length - 1], r);
      hull.push(r);
      L[r] = r > 0 ? Math.max(total, L[r - 1] + MIN_RISE * DY) : total;
    }
    const last = Math.max(0, ys.length - 1);
    for (let r = last + 1; r < rows; r++) L[r] = L[last] + (r - last) * DY;
    len.push(L);
  }
  const colAt = (u: number) => Math.min(cols - 1, Math.max(0, xOfU(Math.abs(u)) / DX));
  const lenAt = (u: number, y: number): number => {
    const f = colAt(u), c0 = Math.floor(f), c1 = Math.min(cols - 1, c0 + 1), cu = f - c0;
    const g = Math.min(rows - 1, Math.max(0, (y - yU) / DY)), r0 = Math.floor(g), r1 = Math.min(rows - 1, r0 + 1), rv = g - r0;
    const at = (c: number) => len[c][r0] + rv * (len[c][r1] - len[c][r0]);
    let L = at(c0) + cu * (at(c1) - at(c0));
    if (y > yU + (rows - 1) * DY) L += y - (yU + (rows - 1) * DY);
    return L;
  };
  // `share` of the extra length over her height is taken (1: all of it; the rest is left to the knit's stretch)
  const v = (u: number, y: number) => (y <= yU ? y : y + share * (lenAt(u, y) - (y - yU)));
  return {
    yU,
    v,
    lift: (u, y) => v(u, y) - y,
    y: (u: number, vv: number) => {
      if (vv <= yU) return vv;
      // the map is increasing in y: bisect
      let lo = yU, hi = yU + (vv - yU) + 1e-9;
      while (v(u, hi) < vv) hi += 0.05;
      for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (v(u, m) < vv) lo = m; else hi = m; }
      return (lo + hi) / 2;
    },
  };
}
