/**
 * THE BELLY CURVE EXPERIMENT (Joshua, 2026-10-22: "Investigate whether Sarah's belly can transition more smoothly
 * across the complete 0-200% slider range, especially at 0-20% and around 100%... Keep this mode optional and
 * default-off... Preserve the approved 0%, 100%, and 200% shapes").
 *
 * WHAT THE APPROVED SLIDER DOES (`bellyWeights`). Her bump is nine approved key shapes -- 0, 25, 30, 50, 60, 75, 100,
 * 150 and 200% -- and the slider crossfades the two either side of it in a straight line. Measured on the slim body
 * (`scripts/sarahV2Recovery/belly-interpolation.mjs`), how far her bump moves between neighbouring keys is very uneven
 * for the slider distance between them:
 *
 *     0-25%  0.43 cm     (1.7 cm per 100% of slider: why 0-20% looks like almost nothing happens)
 *     25-30% 0.52 cm     (10.3 per 100%)
 *     30-50% 2.07 cm     (10.4)        50-60%  1.30 cm (13.0)       60-75%  1.95 cm (13.0)
 *     75-100% 3.80 cm    (15.2)        100-150% 3.67 cm (7.3)       150-200% 3.67 cm (7.3)
 *
 * (RMS over the bump.) So the rate of change jumps at every key, and halves at 100% -- the "change of deformation rate"
 * he sees there -- and the DIRECTION of change turns at each key too (past 100% the bump grows deeper and lower and its
 * sides draw in).
 *
 * Two different things can be done about that, and they are kept apart:
 *   - EASING moves where on the slider each approved shape is reached (a remapping of the percentage). The shapes on
 *     the way are exactly the approved crossfades; only the pace changes.
 *   - CONTINUOUS changes the path between the keys: a smooth (C1) curve through every approved key shape instead of
 *     straight crossfades, so neither the pace nor the direction jumps at a key. Each key is still reached exactly.
 * Both are only new WEIGHTS for the same nine approved targets: no new geometry, nothing to download.
 *
 * The modes:
 *   approved            -- exactly the approved slider (the default; `bellyWeights` unchanged, byte for byte).
 *   continuous          -- the smooth path, each key still at its approved slider position.
 *   eased               -- the approved straight path, paced evenly: the slider spends its travel in proportion to how
 *                          much her shape changes, separately below and above 100%, with the pace eased across 100%.
 *   continuousEased     -- both.
 *   hybrid              -- (Joshua, 2026-10-22: "How about a hybrid of current approved and ease?") the approved
 *                          straight path, so every size on the way is an approved crossfade, paced halfway between the
 *                          approved timing and EASED (`HYBRID_EASE`). Both pacings are smooth and never run backwards,
 *                          so their mix is neither: the jumps in pace at 25% and 100% are softened, the keys move only
 *                          halfway toward their even positions.
 * 0%, 100% and 200% are the approved shapes exactly in every mode.
 *
 * THE SMOOTH PATH is a cubic Hermite spline through the keys, placed at their measured distances along the path (so
 * neighbouring segments are equally fast and the curve is well behaved), with each key's tangent the usual three-point
 * estimate. A C1 curve through a key where some of her surface turns back (her sides draw in past 100%) either slows
 * there or swings a little past; `TANGENT_TENSION` at 100% trades the two, measured: 0.6 keeps any point within 2.2 mm
 * of the range between its two neighbouring keys, everywhere, at every size (1.0 would allow 4 mm; 0.4 would slow the
 * whole bump to a third of its pace at 100%).
 *
 * Pure arithmetic.
 */

export type BellyCurve = 'approved' | 'hybrid' | 'continuous' | 'eased' | 'continuousEased';
export const BELLY_CURVES: readonly BellyCurve[] = Object.freeze(['approved', 'hybrid', 'continuous', 'eased', 'continuousEased']);
export const BELLY_CURVE_NAMES: Readonly<Record<BellyCurve, string>> = Object.freeze({
  approved: 'CURRENT', hybrid: 'HYBRID', continuous: 'CONTINUOUS', eased: 'EASED', continuousEased: 'CONTINUOUS + EASED',
});

/** The approved keys' slider positions, smallest first (`BELLY_KEYS`, as fractions). */
export const BELLY_KNOTS: readonly number[] = Object.freeze([0, 0.25, 0.3, 0.5, 0.6, 0.75, 1, 1.5, 2]);
/**
 * MEASURED: how far her bump's surface moves between neighbouring keys, RMS over every vertex that moves more than 5%
 * of the most any does between 0% and 200%, in the model's units (metres), the upper-belly target included at each
 * key's own ratio. `scripts/sarahV2Recovery/belly-interpolation.mjs` measures it; the test holds it to the file.
 */
export const BELLY_KEY_GAPS: readonly number[] = Object.freeze([0.004325, 0.005172, 0.020714, 0.012976, 0.019474, 0.037984, 0.036665, 0.036652]);
/** GAME TUNING (measured trade-off above): how much of each key's tangent the smooth path keeps; 1 is the full estimate. */
export const TANGENT_TENSION: readonly number[] = Object.freeze([1, 1, 1, 1, 1, 1, 0.6, 1, 1]);

const N = BELLY_KNOTS.length;
const I100 = BELLY_KNOTS.indexOf(1);
/** Each key's position along the path: by measured distance, 0 to 1 below 100% and 1 to 2 above it. */
export const PATH_KNOTS: readonly number[] = Object.freeze((() => {
  const cum = [0];
  for (const g of BELLY_KEY_GAPS) cum.push(cum[cum.length - 1] + g);
  return cum.map((c, i) => (i <= I100 ? c / cum[I100] : 1 + (c - cum[I100]) / (cum[N - 1] - cum[I100])));
})());
/** How fast her shape changes along the path below and above 100% (metres per unit of path). */
const PACE_BELOW = BELLY_KEY_GAPS.slice(0, I100).reduce((a, b) => a + b, 0);
const PACE_ABOVE = BELLY_KEY_GAPS.slice(I100).reduce((a, b) => a + b, 0);

/** Which segment `x` falls in on `knots`, and how far along it. */
function locate(knots: readonly number[], x: number): { i: number; t: number } {
  let i = 0;
  while (i < knots.length - 2 && x > knots[i + 1]) i += 1;
  const h = knots[i + 1] - knots[i];
  return { i, t: Math.min(1, Math.max(0, (x - knots[i]) / h)) };
}

/** Each key's tangent on the path as weights over the keys (a tangent is a fixed blend of the key shapes). */
const TANGENTS: readonly Float64Array[] = (() => {
  const k = PATH_KNOTS, h = k.slice(1).map((v, i) => v - k[i]);
  const slope = (i: number) => { const d = new Float64Array(N); d[i] = -1 / h[i]; d[i + 1] = 1 / h[i]; return d; };
  return k.map((_, i) => {
    let m: Float64Array;
    if (i === 0) m = slope(0);
    else if (i === N - 1) m = slope(N - 2);
    else { const a = slope(i - 1), b = slope(i); m = a.map((v, j) => (h[i] * v + h[i - 1] * b[j]) / (h[i - 1] + h[i])); }
    return m.map((v) => v * TANGENT_TENSION[i]);
  });
})();

/** Weights over the keys at path position `u` (0..2): straight crossfades, or the smooth curve. */
function pathWeights(u: number, smooth: boolean): number[] {
  const { i, t } = locate(PATH_KNOTS, u), w = new Array<number>(N).fill(0);
  if (!smooth) { w[i] = 1 - t; w[i + 1] = t; return w; }
  const h = PATH_KNOTS[i + 1] - PATH_KNOTS[i];
  const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
  w[i] += h00; w[i + 1] += h01;
  for (let j = 0; j < N; j++) w[j] += h10 * h * TANGENTS[i][j] + h11 * h * TANGENTS[i + 1][j];
  return w;
}

/**
 * THE APPROVED TIMING, SMOOTHED: the slider to the path through every key at its approved slider position, as a
 * monotone cubic (Fritsch-Carlson: it never overshoots, so the slider never runs backwards). Her shape changes faster
 * per unit of path below 100% than above it, so at 100% the curve takes a slope on each side that leaves her pace
 * unbroken there (each side's slope times its own pace is the same number).
 */
function approvedTiming(b: number): number {
  const xs = BELLY_KNOTS, ys = PATH_KNOTS, n = xs.length;
  const h = xs.slice(1).map((v, i) => v - xs[i]), d = ys.slice(1).map((v, i) => (v - ys[i]) / h[i]);
  const m = xs.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (3 * (h[i - 1] + h[i])) / ((2 * h[i] + h[i - 1]) / d[i - 1] + (h[i] + 2 * h[i - 1]) / d[i])));
  const { i, t } = locate(xs, b);
  const split = (2 / (PACE_BELOW + PACE_ABOVE));
  const m0 = i === I100 ? m[i] * split * PACE_BELOW : m[i], m1 = i + 1 === I100 ? m[i + 1] * split * PACE_ABOVE : m[i + 1];
  return (2 * t ** 3 - 3 * t ** 2 + 1) * ys[i] + (t ** 3 - 2 * t ** 2 + t) * h[i] * m0 + (-2 * t ** 3 + 3 * t ** 2) * ys[i + 1] + (t ** 3 - t ** 2) * h[i] * m1;
}

/**
 * EASED pace: the slider to the path, so the shape changes at an even pace below 100% and an even pace above it, with
 * the pace eased across 100% (its slope there is the harmonic mean of the two), and 0, 100 and 200 fixed.
 */
function evenPace(b: number): number {
  const below = (2 * PACE_ABOVE) / (PACE_BELOW + PACE_ABOVE), above = (2 * PACE_BELOW) / (PACE_BELOW + PACE_ABOVE);
  const hermite = (t: number, m0: number, m1: number) => (t ** 3 - 2 * t ** 2 + t) * m0 + (-2 * t ** 3 + 3 * t ** 2) + (t ** 3 - t ** 2) * m1;
  return b <= 1 ? hermite(b, 1, below) : 1 + hermite(b - 1, above, 1);
}

/** GAME TUNING: how far HYBRID goes from the approved timing toward EASED (0 approved, 1 eased). */
export const HYBRID_EASE = 0.5;

/** The path position the slider reaches in a mode: the approved timing keeps each key at its own slider position. */
export function pathPosition(bumpPercent: number, curve: BellyCurve): number {
  const b = Math.min(2, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 100) / 100);
  if (curve === 'eased' || curve === 'continuousEased') return evenPace(b);
  if (curve === 'continuous') return approvedTiming(b);
  if (curve === 'hybrid') return (1 - HYBRID_EASE) * approvedTiming(b) + HYBRID_EASE * evenPace(b);
  const { i, t } = locate(BELLY_KNOTS, b);
  return PATH_KNOTS[i] + t * (PATH_KNOTS[i + 1] - PATH_KNOTS[i]);
}

/**
 * Each approved key's weight at a belly size, smallest key first (`BELLY_KNOTS`). In `approved` this is the approved
 * crossfade; the smooth curves' weights can dip a little below 0 or rise a little past 1 between keys (that is how a
 * smooth curve through fixed shapes is made) and always add up to 1.
 */
export function bellyKeyWeights(bumpPercent: number, curve: BellyCurve): number[] {
  const u = pathPosition(bumpPercent, curve);
  return pathWeights(u, curve === 'continuous' || curve === 'continuousEased');
}
