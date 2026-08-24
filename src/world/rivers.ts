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
import { RIBBON_EDGE, level as levelStations, resample } from './centreline';
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
 * How far under the waterline the ground sits where a footprint
 * touches the channel but the vertex is not in it.
 *
 * ZERO, AND IT USED TO BE TWELVE, which is where the gap came from.
 * Twelve world units sounds small and is not: a unit is a CENTIMETRE
 * and the queen is one centimetre long, so the ground beside every
 * channel was set twelve BODY LENGTHS below the water while the ribbon
 * ended flush at the surface. From her eye that is a ledge you can see
 * under, all the way along both banks — "water is not covering the
 * ground so there is a gap", exactly as reported, and written by me
 * while calling it small on purpose.
 *
 * At zero the shelf meets the sheet at the waterline and there is
 * nothing to see under. Containment is untouched: level is not above
 * level, which was the only thing the drop was ever protecting.
 */
const BRIM = 0;

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

/**
 * Segment data, flattened for the cache. One entry per segment.
 *
 * THREE OF THEM ARE FLOAT32, which this table did not need while it
 * held the 48,544 raw segments and does now that it holds 281,069
 * resampled ones (centreline.ts). An elevation tops out at 155,000 and
 * a width at 3,620, so single precision resolves both to well under a
 * millimetre and saves seven megabytes on a phone.
 *
 * THE FLOW VECTOR IS NOT AMONG THEM, and the tests said so before I
 * did: `flowSpeed` clamps between 10 and 150, and a unit vector
 * rounded to float32 has a length of 1 ± 3e-8, so a current pinned at
 * the ceiling came back as 150.000004 and one at the floor as
 * 9.99999999. Those are harmless numbers and a bound that is not
 * actually a bound is not harmless, so the direction and the speed
 * keep their doubles.
 */
let ax: Float64Array | null = null;
let az: Float64Array | null = null;
let bx: Float64Array | null = null;
let bz: Float64Array | null = null;
let ay: Float32Array | null = null;
let by: Float32Array | null = null;
let wide: Float32Array | null = null;
let fx: Float64Array | null = null;
let fz: Float64Array | null = null;
let speed: Float64Array | null = null;
let reachOf: Int32Array | null = null;

/**
 * The resampled centreline of each reach, [x, y, z, width] per row —
 * exactly the stations the index below is built from, handed to
 * RiverWater so the ribbon is drawn through the same points.
 */
let stations: (Float64Array | null)[] = [];

let heads: Int32Array | null = null;
let counts: Int32Array | null = null;
let buckets: Int32Array | null = null;

/** Levelled per-point elevations, kept for the ribbons. */
let levelled: Float64Array | null = null;

export function riverPointLevels(): Float64Array | null {
  return levelled;
}

/**
 * The stations of one reach, [x, y, z, width] per row, or null.
 *
 * THE ONLY CENTRELINE THERE IS. RiverWater used to spline the raw
 * points itself and drew a river the index did not agree existed; it
 * reads this instead, so the ribbon and the water are the same curve
 * by construction rather than by two implementations staying in step.
 */
export function reachStations(reach: number): Float64Array | null {
  return stations[reach] ?? null;
}

export function forgetRivers(): void {
  ax = az = bx = bz = ay = by = wide = fx = fz = speed = null;
  reachOf = null;
  heads = counts = buckets = null;
  levelled = null;
  stations = [];
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

  // ── The centreline, resampled once ──────────────────────────────
  // THE SPLINE RUNS BEFORE THE INDEX DOES, not after and not
  // elsewhere. The shipped points sit 35 metres apart on channels five
  // metres wide, and the ribbon has always been drawn through a
  // centripetal Catmull-Rom rather than through those chords — so
  // indexing the chords meant the water pushed her along a course the
  // screen never showed. See centreline.ts for what that cost, in
  // measurements taken before this line existed.
  stations = [];
  let segments = 0;
  for (const river of hydro.rivers) {
    const raw = new Float64Array(river.count * 4);
    for (let i = 0; i < river.count; i++) {
      const p = river.first + i;
      raw[i * 4] = hydro.x[p];
      raw[i * 4 + 1] = level[p];
      raw[i * 4 + 2] = hydro.z[p];
      raw[i * 4 + 3] = hydro.width[p];
    }
    const row = resample(raw);
    // The spline can bend a levelled profile back uphill; take it out
    // again here, where the index will read the same numbers the
    // ribbon does.
    levelStations(row);
    stations.push(row);
    segments += Math.max(0, row.length / 4 - 1);
  }

  // ── Segments ────────────────────────────────────────────────────
  ax = new Float64Array(segments);
  az = new Float64Array(segments);
  bx = new Float64Array(segments);
  bz = new Float64Array(segments);
  ay = new Float32Array(segments);
  by = new Float32Array(segments);
  wide = new Float32Array(segments);
  fx = new Float64Array(segments);
  fz = new Float64Array(segments);
  speed = new Float64Array(segments);
  reachOf = new Int32Array(segments);

  let at = 0;
  for (let r = 0; r < hydro.rivers.length; r++) {
    const row = stations[r]!;
    const rows = row.length / 4;
    for (let i = 0; i < rows - 1; i++) {
      ax[at] = row[i * 4];
      az[at] = row[i * 4 + 2];
      bx[at] = row[(i + 1) * 4];
      bz[at] = row[(i + 1) * 4 + 2];
      ay[at] = row[i * 4 + 1];
      by[at] = row[(i + 1) * 4 + 1];
      // The channel is as wide as its wider end says.
      wide[at] = Math.max(row[i * 4 + 3], row[(i + 1) * 4 + 3]);
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
  // Whether `best` holds the point inside its channel or merely claims its
  // bank. Recovered from `best` rather than threaded through the nine-cell
  // walk, so a claimant found in an earlier cell is ranked the same way.
  let bestInside = best !== null && best.off <= best.width / 2;
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
    let bed: number;
    if (off <= half) {
      // IN the channel: the true profile, read where she actually is.
      const wall = Math.max(0, (off / half - FLAT_BED) / (1 - FLAT_BED));
      const eased = wall * wall * (3 - 2 * wall);
      bed = level - deep * (1 - eased);
    } else if (off - give <= half) {
      // THE FOOTPRINT REACHES THE CHANNEL BUT THE VERTEX DOES NOT, and
      // this branch is the whole correction. It used to slide the
      // entire profile outward, which dug the FLAT BED out to the edge
      // of the footprint: at the middle tier a 5.5 m stream got a
      // thirty-one metre trench at full depth with water down the
      // middle of it, and from a low angle the ribbon hung in the air
      // over a dry ditch. Joshua photographed the gap.
      //
      // A vertex that stands for some water must not stand ABOVE it —
      // that is the containment rule and it is why any of this exists.
      // It must not be dug to the BED either, because it is not in the
      // channel. Just under the waterline is both.
      bed = level - BRIM;
    } else if (off - give * 2 <= half) {
      // THE SHELF RUNS TO TWICE THE FOOTPRINT, and the second half of
      // it is what keeps the bank out of the channel's own cell.
      //
      // A tier interpolates bilinearly across a cell one step wide. At
      // the coarsest that is 3,125 units, wide enough to hold channel,
      // shelf AND rising bank at once — and the rise then lifts the
      // interpolated surface back over the water in the middle of the
      // channel. Measured, that buried the river by up to 2.5 cm,
      // which is two and a half queens standing in it.
      //
      // One footprint of shelf beyond the footprint guarantees every
      // cell containing channel has its other corners on the flat.
      bed = level - BRIM;
    } else {
      // And then the bank, climbing from the shelf so the two meet
      // rather than step. Measured on the true offset, so a coarse
      // tier does not flatten the whole valley side.
      bed = level - BRIM + (off - give * 2 - half) * BANK_GRADE;
    }

    // HOW FAST THE WATER IS GOING *HERE*, which is not how fast the
    // reach is going. A channel's velocity profile is roughly
    // parabolic across it — friction holds the margins nearly still
    // while the thread down the middle carries everything — and
    // ignoring that gave every square centimetre of a stream the
    // midstream speed. At ant scale that is the difference between a
    // ford and a wall of water: she could not get a body length in
    // before a metre a second took her.
    //
    // Real, and it happens to be the playable answer too: the edge of
    // a river is crossable and the middle of one is not.
    const across = Math.min(1, off / Math.max(1e-6, half));
    const thread = Math.max(0, 1 - across * across);
    const spot = {
      level, bed, width, off,
      flowX: fx![s] * speed![s] * thread,
      flowZ: fz![s] * speed![s] * thread,
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
    // IN-CHANNEL BEATS BANK, AND ONLY THEN DOES HIGHER WATER WIN.
    //
    // The crossing rule on its own is "highest level among everything that
    // claims this point", and a claim reaches hundreds of units past the
    // channel because the BANK has to be shaped too. That was wrong the whole
    // time and could not show it: a river runs DOWNHILL, so a segment upstream
    // of you always stands higher than the one you are standing in, and the
    // rule prefers it the moment it comes inside the claim radius. At the
    // shipped 3,500-unit chords it never did — the next segment's nearest
    // point was 3,500 away, outside the reach of the cut — so the fault sat
    // there masked by segment length until the centreline was resampled to 600
    // and every station's neighbour landed 583 units away.
    //
    // Measured at that point: standing dead centre in reach 2, `riverAt`
    // answered with a bank-only segment 583 units upstream, off = 2.2
    // half-widths, and `inChannel` therefore said dry land. Two thirds of the
    // shipped points on the island reported themselves out of their own river.
    //
    // The crossing rule is still right for what it was written for — where two
    // channels genuinely overlap, the trunk's higher surface should win so the
    // junction stays wet — so it keeps its meaning, applied within the class
    // that actually contains the point.
    const inside = off <= half;
    const better = !best
      || (inside && !bestInside)
      || (inside === bestInside
        && (level > best.level + 1e-9
          || (level > best.level - 1e-9 && off < best.off)));
    if (better) {
      best = spot;
      bestInside = inside;
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

/**
 * IS THIS POINT UNDER THE DRAWN WATER? The one test, asked once.
 *
 * `riverAt` claims a much wider footprint than the channel — the bank
 * cut goes out hundreds of units past it, because the GROUND has to
 * come down to meet the water somewhere. Only the part inside the
 * channel is wet, and "inside the channel" has to mean exactly what
 * the ribbon covers or she is swimming in ground again. Same
 * centreline (centreline.ts), same half-width, same edge inset.
 */
export function inChannel(spot: RiverSpot): boolean {
  return spot.off <= (spot.width / 2) * RIBBON_EDGE;
}

/** The water surface here, or null — only INSIDE the channel. */
export function riverLevel(x: number, z: number): number | null {
  const spot = riverAt(x, z);
  if (!spot || !inChannel(spot)) return null;
  return spot.level;
}

/**
 * Which way the water is going here, or null. Only inside the channel:
 * the bank cut is dry ground and dry ground does not flow.
 */
export function riverFlow(x: number, z: number): { x: number; z: number } | null {
  const spot = riverAt(x, z);
  if (!spot || !inChannel(spot)) return null;
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

/**
 * HOW WET THE GROUND IS HERE, 0 to 1 — the riparian corridor.
 *
 * WHY THIS EXISTS AND THE TRENCH DOES NOT SUFFICE. From two hundred
 * metres up the rivers read as blue ribbon laid over sand, and the
 * honest reason is that they very nearly are: a median reach is 5.5 m
 * across, the height grid samples every 55 m, and no runtime carve can
 * put a visible valley under a stream the source data has never heard
 * of. Deepening the coarse-tier trench until it showed would also make
 * the tiers disagree with each other by metres, which is the
 * two-terrains fault the tier ladder exists to prevent.
 *
 * But a stream from the air is not mostly water. It is a CORRIDOR —
 * damp ground, darker soil, the vegetation that follows it — and that
 * corridor is tens of metres wide where the water is five. It is what
 * the eye actually reads as "there is a river there", and unlike a
 * valley it costs one lookup per terrain vertex and nothing in
 * geometry, so every tier can carry it and none of them disagree.
 *
 * Widens with the channel, because a trunk waters more ground than a
 * headwater does.
 */
export function riverDamp(x: number, z: number): number {
  const spot = riverAt(x, z, DAMP_REACH);
  if (!spot) return 0;
  const half = spot.width / 2;
  const band = half + DAMP_REACH * (0.4 + 0.6 * Math.min(1, spot.width / 1_500));
  if (spot.off >= band) return 0;
  const near = 1 - (spot.off - half) / Math.max(1, band - half);
  return Math.min(1, Math.max(0, near));
}

/**
 * How far the damp ground reaches past the bank, world units.
 *
 * Twenty-two metres, and bounded by the same walk that bounds the
 * carve. Measured rather than picked: at twelve it was invisible from
 * the two hundred metres the ribbons were reported from, which is the
 * altitude the corridor exists to be seen from. Still a corridor and
 * not a wash — the test holds it under a tenth of the island.
 */
export const DAMP_REACH = 2_200;

/** One real metre, for tests that want to speak in metres. */
export const METRE = UNITS_PER_METRE;
