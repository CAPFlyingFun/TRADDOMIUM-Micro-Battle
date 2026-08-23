/**
 * KAUAʻI'S RIVERS, AS THE GROUND AND THE WATER BOTH NEED THEM.
 *
 * 1,121 reaches, 49,665 centreline points, each with a real elevation
 * and a real drainage-derived width (hydro.ts). This module owns the
 * three questions everything else asks about them:
 *
 *   riverBed(x, z)     what the ground under the channel is pressed to
 *   riverLevel(x, z)   where the water surface is, if this is water
 *   riverFlow(x, z)    which way it is going, and how fast
 *
 * THE HOT PATH RULES THIS FILE. `riverBed` runs inside `terrainHeight`,
 * which is called per vertex on every cell rebuild, on every ground
 * query, ~190 times a frame by the touchdown solver, and 1.7 million
 * times baking the island map. The answer for almost every point on the
 * island is "no river here", and that answer is two array reads: a
 * bucket grid over SEGMENTS, with each segment's full influence radius
 * folded into its bucket footprint so a miss never needs geometry.
 *
 * ELEVATIONS ARE MADE MONOTONIC AT LOAD. The NHDPlus elevations carry
 * DEM noise, and noise on a river profile is water flowing uphill —
 * visible as a ribbon that porpoises. Each reach is forced non-
 * increasing along its net-descent direction once, here, in float64.
 * The same pass hands every segment its downstream direction, which is
 * what the flow query serves.
 *
 * THE CARVE ONLY EVER LOWERS THE ISLAND — the lake rule (lakes.ts), for
 * the lake reason. And it is resolution-gated by its CALLER: a tier
 * whose vertices cannot hold a channel does not get the trench (see
 * heightfield.ts), because a 550-unit river across 3,125-unit vertices
 * is not a valley, it is pockmarks.
 *
 * GLOBAL COORDINATES, float64, nothing near the GPU. As everywhere.
 */
import { SPAN, UNITS_PER_METRE } from './kauai';
import type { Hydro } from './hydro';

/**
 * How deep a channel runs, from its width.
 *
 * GAME TUNING INSPIRED BY HYDRAULICS, not measured bathymetry: real
 * small-stream depth scales with width somewhere near this. The median
 * 550-unit (5.5 m) stream gets a 66-unit (66 cm) channel; the Wailua at
 * 3,620 caps out at 2.5 m. BE used 0.6×width floored at 3 m — but that
 * floor exists so a HUMAN can swim in every stream, which is a need she
 * does not have and a trench she does not want.
 */
export function channelDepth(width: number): number {
  return Math.min(Math.max(width * 0.12, 30), 250);
}

/**
 * Fraction of the half-width that is flat bed. The rest is the eased
 * wall. Wide, for the lake reason: a mostly-flat bed reads as one
 * filled body rather than a deep core with pale shoulders.
 */
export const FLAT_BED = 0.5;

/**
 * The bank gradient outside the channel, rise over run.
 *
 * Where the height grid runs well above the real water line (the same
 * averaging that buried 72 lakes), the carve has to come down from that
 * ground to the channel edge, and this is the slope it is allowed to do
 * it at. 0.8 is a steep riverbank, not a canyon wall.
 */
export const BANK_GRADE = 0.8;

/** How far past the half-width the bank cut may reach, in units. */
const BANK_REACH = 400;

/**
 * THE WIDEST FOOTPRINT A COARSE TIER MAY ASK ABOUT, in world units.
 *
 * A distance tier's vertices stand 312 to 3,125 units apart and a
 * river is 550 across, so a tier that samples the trench AT its
 * vertices mostly misses it — which is why `farHeight` used to refuse
 * rivers altogether, and why every ribbon past the streamed cells was
 * drawn over ground that had no channel in it. Measured on the whole
 * drainage, 76% of the river surface sat BELOW the drawn terrain, by a
 * median of 196 units and as much as 6,656.
 *
 * The cure is not a finer tier — it is asking the honest question. A
 * coarse vertex does not stand for a point, it stands for the square
 * around it, and the lowest ground in that square is the answer the
 * mesh should carry. Bounded here because the query walks one cell of
 * neighbours (see `riverAt`) and must not out-reach the walk.
 */
export const CARVE_SLACK = 5_000;

/**
 * Flow speed from the water-surface slope.
 *
 * GAME TUNING with the right shape: open-channel flow goes with the
 * square root of the slope. A 1% grade gives 100 units/s — a metre a
 * second, a brisk real stream — clamped to a range real Kauaʻi streams
 * actually span. To a 10 mm queen the minimum is still ten body lengths
 * a second.
 */
export function flowSpeed(slope: number): number {
  return Math.min(150, Math.max(10, 1_000 * Math.sqrt(Math.max(0, slope))));
}

/** What the river says about one point in it. */
export interface RiverSpot {
  /** The water surface, world units above the sea. */
  readonly level: number;
  /** The pressed bed there. */
  readonly bed: number;
  /** Full channel width at this point. */
  readonly width: number;
  /** Distance from the centreline. */
  readonly off: number;
  /** Downstream, scaled by speed. World units a second. */
  readonly flowX: number;
  readonly flowZ: number;
}

const CELL = 8_192;
const CELLS = Math.ceil(SPAN / CELL);

/** Segment data, flattened for the cache. One entry per segment. */
let ax: Float64Array | null = null;
let az: Float64Array | null = null;
let bx: Float64Array | null = null;
let bz: Float64Array | null = null;
let ay: Float64Array | null = null;
let by: Float64Array | null = null;
let wide: Float64Array | null = null;
let fx: Float64Array | null = null;
let fz: Float64Array | null = null;
let speed: Float64Array | null = null;
let reachOf: Int32Array | null = null;

let heads: Int32Array | null = null;
let counts: Int32Array | null = null;
let buckets: Int32Array | null = null;

/** Levelled per-point elevations, kept for the ribbons. */
let levelled: Float64Array | null = null;

export function riverPointLevels(): Float64Array | null {
  return levelled;
}

export function forgetRivers(): void {
  ax = az = bx = bz = ay = by = wide = fx = fz = speed = null;
  reachOf = null;
  heads = counts = buckets = null;
  levelled = null;
}

/**
 * Build the segment table and the bucket grid. Called once at boot,
 * after the hydrography lands.
 */
export function useRivers(hydro: Hydro): void {
  // ── Monotonic elevations, per reach ─────────────────────────────
  const level = new Float64Array(hydro.y.length);
  for (let i = 0; i < hydro.y.length; i++) level[i] = hydro.y[i];
  for (const river of hydro.rivers) {
    const first = river.first;
    const last = river.first + river.count - 1;
    // Descent direction from the endpoints; ties default to "along".
    if (level[first] >= level[last]) {
      for (let i = first + 1; i <= last; i++) {
        if (level[i] > level[i - 1]) level[i] = level[i - 1];
      }
    } else {
      for (let i = last - 1; i >= first; i--) {
        if (level[i] > level[i + 1]) level[i] = level[i + 1];
      }
    }
  }
  levelled = level;

  // ── Segments ────────────────────────────────────────────────────
  let segments = 0;
  for (const river of hydro.rivers) segments += river.count - 1;
  ax = new Float64Array(segments);
  az = new Float64Array(segments);
  bx = new Float64Array(segments);
  bz = new Float64Array(segments);
  ay = new Float64Array(segments);
  by = new Float64Array(segments);
  wide = new Float64Array(segments);
  fx = new Float64Array(segments);
  fz = new Float64Array(segments);
  speed = new Float64Array(segments);
  reachOf = new Int32Array(segments);

  let at = 0;
  for (let r = 0; r < hydro.rivers.length; r++) {
    const river = hydro.rivers[r];
    for (let i = 0; i < river.count - 1; i++) {
      const p = river.first + i;
      ax[at] = hydro.x[p];
      az[at] = hydro.z[p];
      bx[at] = hydro.x[p + 1];
      bz[at] = hydro.z[p + 1];
      ay[at] = level[p];
      by[at] = level[p + 1];
      // The channel is as wide as its wider end says.
      wide[at] = Math.max(hydro.width[p], hydro.width[p + 1]);
      reachOf[at] = r;
      const dx = bx[at] - ax[at];
      const dz = bz[at] - az[at];
      const run = Math.hypot(dx, dz);
      // Downstream is toward the lower end; the levelling above means
      // that is one of the two, never neither.
      const sign = by[at] <= ay[at] ? 1 : -1;
      fx[at] = run > 0 ? (dx / run) * sign : 0;
      fz[at] = run > 0 ? (dz / run) * sign : 0;
      speed[at] = flowSpeed(run > 0 ? Math.abs(ay[at] - by[at]) / run : 0);
      at++;
    }
  }

  // ── Buckets, with the influence folded in ───────────────────────
  const found: number[][] = [];
  for (let s = 0; s < segments; s++) {
    const reach = wide[s] / 2 + Math.min(BANK_REACH + wide[s] / 2, 2_000);
    const x0 = Math.max(0, Math.floor((Math.min(ax[s], bx[s]) - reach + SPAN / 2) / CELL));
    const x1 = Math.min(CELLS - 1, Math.floor((Math.max(ax[s], bx[s]) + reach + SPAN / 2) / CELL));
    const z0 = Math.max(0, Math.floor((Math.min(az[s], bz[s]) - reach + SPAN / 2) / CELL));
    const z1 = Math.min(CELLS - 1, Math.floor((Math.max(az[s], bz[s]) + reach + SPAN / 2) / CELL));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        (found[cz * CELLS + cx] ??= []).push(s);
      }
    }
  }
  heads = new Int32Array(CELLS * CELLS).fill(-1);
  counts = new Int32Array(CELLS * CELLS);
  let total = 0;
  for (const list of found) total += list?.length ?? 0;
  buckets = new Int32Array(total);
  let cursor = 0;
  for (let cell = 0; cell < found.length; cell++) {
    const list = found[cell];
    if (!list) continue;
    heads[cell] = cursor;
    counts[cell] = list.length;
    for (const s of list) buckets[cursor++] = s;
  }
}

/**
 * The nearest reach that claims this point, or null.
 *
 * "Claims" means within the channel plus its bank cut. Where reaches
 * cross (a confluence), the one whose water stands higher wins, which
 * keeps the junction wet rather than letting a shallow tributary carve
 * a notch through the trunk's surface.
 */
export function riverAt(x: number, z: number, slack = 0): RiverSpot | null {
  if (!heads || !counts || !buckets) return null;
  const give = Math.max(0, Math.min(slack, CARVE_SLACK));
  const cx = Math.floor((x + SPAN / 2) / CELL);
  const cz = Math.floor((z + SPAN / 2) / CELL);
  if (cx < 0 || cz < 0 || cx >= CELLS || cz >= CELLS) return null;

  // WITH SLACK, ONE CELL IS NOT ENOUGH. A segment is bucketed by its
  // own influence, which is a few hundred units; a coarse vertex asks
  // about a footprint of up to CARVE_SLACK. The neighbouring cells
  // reach at least CELL units in every direction, and CARVE_SLACK is
  // bounded below that, so the walk cannot miss a claimant. The hot
  // path — slack zero, which is every fine query — still reads one.
  let best: RiverSpot | null = null;
  if (give === 0) return scan(cz * CELLS + cx, x, z, 0, null);
  for (let dz = -1; dz <= 1; dz++) {
    const nz = cz + dz;
    if (nz < 0 || nz >= CELLS) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx;
      if (nx < 0 || nx >= CELLS) continue;
      best = scan(nz * CELLS + nx, x, z, give, best);
    }
  }
  return best;
}

/** One bucket's worth of candidates, folded into `best`. */
function scan(
  cell: number, x: number, z: number, give: number, best: RiverSpot | null,
): RiverSpot | null {
  const from = heads![cell];
  if (from < 0) return best;

  const many = counts![cell];
  for (let n = 0; n < many; n++) {
    const s = buckets![from + n];
    const half = wide![s] / 2;
    const cut = half + Math.min(BANK_REACH + half, 2_000) + give;
    // Cheap box reject before the projection.
    if (x < Math.min(ax![s], bx![s]) - cut || x > Math.max(ax![s], bx![s]) + cut) continue;
    if (z < Math.min(az![s], bz![s]) - cut || z > Math.max(az![s], bz![s]) + cut) continue;

    const ex = bx![s] - ax![s];
    const ez = bz![s] - az![s];
    const run = ex * ex + ez * ez;
    const t = run > 0
      ? Math.max(0, Math.min(1, ((x - ax![s]) * ex + (z - az![s]) * ez) / run))
      : 0;
    const dx = x - (ax![s] + ex * t);
    const dz = z - (az![s] + ez * t);
    const off = Math.hypot(dx, dz);
    if (off > cut) continue;

    const level = ay![s] + (by![s] - ay![s]) * t;
    const width = wide![s];
    const deep = channelDepth(width);
    // The carve profile: flat bed in the middle, eased wall to the
    // channel edge, then the bank grade climbing away from it.
    //
    // READ AT THE NEAREST POINT OF THE FOOTPRINT, not at the vertex.
    // `give` is half a coarse tier's vertex spacing, so this answers
    // "how low does the ground get anywhere this vertex stands for" —
    // and a vertex that stands for a piece of channel is put in the
    // channel. Zero for every fine query, where the vertex is the only
    // place it speaks for.
    const inner = Math.max(0, off - give);
    let bed: number;
    if (inner <= half) {
      const wall = Math.max(0, (inner / half - FLAT_BED) / (1 - FLAT_BED));
      const eased = wall * wall * (3 - 2 * wall);
      bed = level - deep * (1 - eased);
    } else {
      bed = level + (inner - half) * BANK_GRADE;
    }

    const spot = {
      level, bed, width, off,
      flowX: fx![s] * speed![s],
      flowZ: fz![s] * speed![s],
    };
    if (give > 0) {
      // A FOOTPRINT WANTS THE LOWEST BED, and only that. The crossing
      // rule below is the right answer to "whose water is this" and
      // the wrong answer to "how low does the ground get here": on
      // ground this steep a tributary a hundred metres off can stand
      // twenty metres higher, and letting it win lifts the bed back
      // over the reach the vertex was supposed to hold. Measured, the
      // rule alone made a wider footprint WORSE — 37% of the river
      // surface buried at 0.75 of a step, 52% at 1.45.
      if (!best || bed < best.bed) best = spot;
      continue;
    }
    if (!best || level > best.level - 1e-9) {
      // Higher water wins at a crossing; nearer wins a tie.
      if (!best || level > best.level + 1e-9 || off < best.off) best = spot;
    }
  }
  return best;
}

/**
 * What the ground under a river is pressed to, or null.
 *
 * The shape `terrainHeight` wants: a floor to take as a minimum. The
 * bank-grade part of the profile rises above the water line, so away
 * from the channel it climbs past any sensible terrain and stops
 * mattering on its own.
 */
export function riverBed(x: number, z: number, slack = 0): number | null {
  const spot = riverAt(x, z, slack);
  return spot ? spot.bed : null;
}

/** The water surface here, or null — only INSIDE the channel. */
export function riverLevel(x: number, z: number): number | null {
  const spot = riverAt(x, z);
  if (!spot || spot.off > spot.width / 2) return null;
  return spot.level;
}

/**
 * Which way the water is going here, or null. Only inside the channel:
 * the bank cut is dry ground and dry ground does not flow.
 */
export function riverFlow(x: number, z: number): { x: number; z: number } | null {
  const spot = riverAt(x, z);
  if (!spot || spot.off > spot.width / 2) return null;
  return { x: spot.flowX, z: spot.flowZ };
}

/**
 * One raw segment, for tests — the construction is the invariant here
 * (flow points at the lower end BY BUILD), and testing it through
 * `riverAt` entangles it with the crossing rule, which twice convicted
 * this file of a junction's geometry.
 */
export function riverSegment(i: number): {
  ax: number; az: number; bx: number; bz: number;
  ay: number; by: number; fx: number; fz: number; speed: number;
} | null {
  if (!ax || i < 0 || i >= ax.length) return null;
  return {
    ax: ax[i], az: az![i], bx: bx![i], bz: bz![i],
    ay: ay![i], by: by![i], fx: fx![i], fz: fz![i], speed: speed![i],
  };
}

/** For the probes: how big the index came out. */
export function riverIndexSize(): { segments: number; entries: number } {
  return { segments: ax?.length ?? 0, entries: buckets?.length ?? 0 };
}

/** One real metre, for tests that want to speak in metres. */
export const METRE = UNITS_PER_METRE;
