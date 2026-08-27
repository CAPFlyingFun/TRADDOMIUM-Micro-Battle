import type { Hydro } from './hydro';

/**
 * WHERE THE SURVEY PUTS WATER INTO A WINDOW.
 *
 * A RUN IS A POLYLINE, NOT A BAG OF POINTS, and the first version of
 * this forgot it. NHDPlus vertices on these reaches sit about 35 m
 * apart; the solver's cells are 1 m. Rasterising only the vertices
 * dropped a feed into every thirty-fifth cell and nothing in between —
 * eight isolated dots down a whole 256 m window — so what came out was
 * a chain of puddles trickling into each other rather than a river,
 * and the deepest water on a surveyed trunk was 34 cm.
 *
 * The island-wide test caught that in seconds. Nobody had to look at a
 * river to find it, which is the entire argument for having it.
 *
 * So the SEGMENTS are walked, at half a cell a step, and every cell
 * the line crosses is fed. What the survey contributes is a continuous
 * course and a Strahler order; everything else — how wide the water
 * gets, how deep, where it pools, where it spills — is the solver's,
 * because those are the decisions that went wrong every time a person
 * or a heuristic made them.
 */
export function feedFromSurvey(
  hydro: Hydro,
  originX: number,
  originZ: number,
  n: number,
  cell: number,
  perOrder: number,
): Float32Array {
  const feed = new Float32Array(n * n);
  const span = n * cell;
  const add = (wx: number, wz: number, rate: number): void => {
    const cx = Math.round((wx - originX) / cell);
    const cy = Math.round((wz - originZ) / cell);
    // The rim is where water leaves; feeding it would be pouring
    // straight down the drain.
    if (cx < 1 || cy < 1 || cx >= n - 1 || cy >= n - 1) return;
    feed[cy * n + cx] = rate;
  };
  for (const river of hydro.rivers) {
    const rate = perOrder * Math.max(1, river.order);
    for (let p = river.first; p < river.first + river.count - 1; p++) {
      const ax = hydro.x[p]; const az = hydro.z[p];
      const bx = hydro.x[p + 1]; const bz = hydro.z[p + 1];
      // Skip a segment that cannot touch the window at all — most of
      // the 1,121 runs are nowhere near, and this is the whole cost.
      const near = span;
      if (Math.min(ax, bx) > originX + span + near || Math.max(ax, bx) < originX - near) continue;
      if (Math.min(az, bz) > originZ + span + near || Math.max(az, bz) < originZ - near) continue;
      const run = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil((run * 2) / cell));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        add(ax + (bx - ax) * t, az + (bz - az) * t, rate);
      }
    }
  }
  return feed;
}
