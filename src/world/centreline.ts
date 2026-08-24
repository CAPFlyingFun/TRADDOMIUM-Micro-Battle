/**
 * ONE CENTRELINE, READ BY BOTH SIDES OF THE WATER.
 *
 * A river had two different courses in this game and nobody could see
 * the second one. The index that answers "is she in the water, and
 * which way is it pushing her" walked the raw NHDPlus polyline; the
 * ribbon on screen walked a centripetal Catmull-Rom spline through the
 * same points. A spline through a chord is not the chord, and the
 * shipped chords are 35 metres long against channels 5.5 metres wide,
 * so the two courses part company by most of a channel width on every
 * bend.
 *
 * MEASURED, on the shipped hydrography, before this module existed:
 * of the points the game called water, 11.7% had no ribbon drawn over
 * them — median 49 units past the drawn edge, 152 at the ninetieth
 * percentile, 352 at worst, which is three and a half metres of ground
 * that looks dry and moves her downstream anyway. And 15,455 samples
 * ran the other way: under the ribbon, on water she could see, the
 * game said dry land. That second number is why widening one side
 * would never have worked. The ribbon is not narrower than the
 * channel, it is OFFSET from it, and the only repair is for both to
 * read the same curve.
 *
 * So the spline moves here, out of the renderer, and the index is
 * built from its output instead of from the raw points. Whatever the
 * player sees is what the water does. The stations are the truth and
 * there is only one copy of them.
 *
 * GLOBAL COORDINATES, float64, nothing near the GPU — the same rule
 * that governs rivers.ts and hydro.ts, and for the same reason: a
 * river ribbon is long, thin and aligned to nothing, the exact shape
 * that shows float32 quantisation as a visible kink.
 */

/**
 * Resample spacing along a reach, world units. Six real metres.
 *
 * This was the renderer's own STEP and it keeps that value, because
 * changing it now would change how every ribbon looks as well as where
 * every river is. At 600 units a median 550-unit stream turns over
 * roughly its own width per station, which is fine enough that the
 * perpendicular can come from a central difference without mitring.
 */
export const STATION_STEP = 600;

/**
 * The ribbon stops just short of the channel edge, so the alpha fade
 * has somewhere to finish. Exported because the WATER TEST has to use
 * the same number: two per cent of a half-width is only five units,
 * but five units is half a queen, and the whole point of this module
 * is that there is no daylight between what is drawn and what is wet.
 */
export const RIBBON_EDGE = 0.98;

/**
 * Centripetal Catmull-Rom over one four-channel point row —
 * [x, y, z, width] interpolated together, so a reach that narrows into
 * a bend narrows THROUGH the bend.
 *
 * Centripetal (α = ½) rather than uniform: uniform Catmull-Rom
 * overshoots on the uneven spacing NHDPlus vertices actually have, and
 * an overshooting river visits places the river does not go.
 *
 * Returns rows of [x, y, z, width], the first and last stations landing
 * exactly on the reach's own endpoints.
 */
export function resample(points: Float64Array): Float64Array {
  const rows = points.length / 4;
  if (rows < 2) return points.slice();
  const out: number[] = [];
  const at = (i: number, c: number) =>
    points[Math.max(0, Math.min(rows - 1, i)) * 4 + c];
  for (let i = 0; i < rows - 1; i++) {
    // Knots from PLANAR spacing, α = ½ — the centripetal family.
    const knot = (a: number, b: number) => Math.max(
      Math.hypot(at(b, 0) - at(a, 0), at(b, 2) - at(a, 2)), 1e-4,
    ) ** 0.5;
    const t0 = 0;
    const t1 = t0 + knot(i - 1, i);
    const t2 = t1 + knot(i, i + 1);
    const t3 = t2 + knot(i + 1, i + 2);
    const span = Math.hypot(at(i + 1, 0) - at(i, 0), at(i + 1, 2) - at(i, 2));
    const steps = Math.max(1, Math.round(span / STATION_STEP));
    for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
      const t = t1 + ((t2 - t1) * s) / steps;
      for (let c = 0; c < 4; c++) {
        // THE BOW IS FOR X AND Z ONLY. Catmull-Rom overshoots, and
        // overshoot is the whole point in plan — it is what makes a
        // bend a bend rather than a chord. In elevation and in width
        // it is damage: an overshoot on a river profile is a ripple of
        // uphill water, and clamping that afterwards with a monotonic
        // pass over the finished row propagates ONE undershoot all the
        // way downstream. Measured before this clamp existed: median
        // nothing, but 53 cm at the ninety-ninth percentile and 2.9
        // METRES at worst, every one of them a drop, and the carve
        // follows the level so that is a trench gouged three metres
        // too deep. Held inside the span it came from, the error can
        // never exceed that span's own drop.
        const clamped = c === 1 || c === 3;
        // Barry–Goldman, one channel at a time.
        const p0 = at(i - 1, c);
        const p1 = at(i, c);
        const p2 = at(i + 1, c);
        const p3 = at(i + 2, c);
        const a1 = t1 - t0 > 0 ? p0 + ((p1 - p0) * (t - t0)) / (t1 - t0) : p1;
        const a2 = t2 - t1 > 0 ? p1 + ((p2 - p1) * (t - t1)) / (t2 - t1) : p2;
        const a3 = t3 - t2 > 0 ? p2 + ((p3 - p2) * (t - t2)) / (t3 - t2) : p3;
        const b1 = t2 - t0 > 0 ? a1 + ((a2 - a1) * (t - t0)) / (t2 - t0) : a2;
        const b2 = t3 - t1 > 0 ? a2 + ((a3 - a2) * (t - t1)) / (t3 - t1) : a3;
        const value = t2 - t1 > 0 ? b1 + ((b2 - b1) * (t - t1)) / (t2 - t1) : b1;
        out.push(clamped
          ? Math.min(Math.max(value, Math.min(p1, p2)), Math.max(p1, p2))
          : value);
      }
    }
  }
  return Float64Array.from(out);
}

/**
 * Force a resampled profile back downhill.
 *
 * Belt and braces after the span clamp above: that keeps every station
 * inside the bracket of the two shipped points it lies between, which
 * bounds the error but still permits a wiggle WITHIN one span. This
 * takes the wiggle out. It cannot run away downstream any more,
 * because a station it lowers was already inside a bracket at or below
 * everything upstream of it.
 *
 * Here rather than in the renderer because the INDEX reads these
 * elevations too, and a level the ribbon does not draw is a level she
 * should not be swimming in.
 */
export function level(stations: Float64Array): void {
  const rows = stations.length / 4;
  if (rows < 2) return;
  if (stations[1] >= stations[(rows - 1) * 4 + 1]) {
    for (let i = 1; i < rows; i++) {
      if (stations[i * 4 + 1] > stations[(i - 1) * 4 + 1]) {
        stations[i * 4 + 1] = stations[(i - 1) * 4 + 1];
      }
    }
  } else {
    for (let i = rows - 2; i >= 0; i--) {
      if (stations[i * 4 + 1] > stations[(i + 1) * 4 + 1]) {
        stations[i * 4 + 1] = stations[(i + 1) * 4 + 1];
      }
    }
  }
}
