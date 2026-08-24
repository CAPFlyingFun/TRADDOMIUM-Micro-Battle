/**
 * THE ISLAND'S OWN WATER — derived from the height grid, not laid over it.
 *
 * `scripts/bakeFlow.py` rains on Kauai, fills every pit to its spill
 * level and follows the drainage down. What it writes is therefore a
 * property OF `kauai-1025.bin` rather than a second opinion about the
 * same island, and that is the whole point: every previous water layer
 * came from USGS courses drawn over a grid that disagreed with them, so
 * rivers sat inside hillsides and a current pushed her along on dry
 * land. A channel here cannot be anywhere the grid has no valley,
 * because the grid is where it came from.
 *
 * ONE SET OF STATIONS, READ BY BOTH SIDES. The index below and the
 * ribbon in FlowWater.ts walk the same rows. The last release learnt
 * that the expensive way: the collision index followed the shipped
 * polyline while the ribbon followed a spline through it, and 11.7% of
 * the water she could be pushed by had nothing drawn over it.
 *
 * GLOBAL COORDINATES, float64, nothing near the GPU — as everywhere.
 */
import { SPAN } from './kauai';

/** `TMBF`, little-endian, as the bake writes it. */
const MAGIC = 0x46424d54;
const VERSION = 1;
const HEADER = 32;

export interface Reach { readonly first: number; readonly count: number; }

export interface Flow {
  readonly reaches: readonly Reach[];
  /** Station positions and the water surface there, world units. */
  readonly x: Int32Array;
  readonly z: Int32Array;
  readonly y: Int32Array;
  /** Full channel width at each station, world units. */
  readonly width: Uint16Array;
  /** Standing water: one entry per ponded grid cell. */
  readonly pondX: Int32Array;
  readonly pondZ: Int32Array;
  readonly pondLevel: Int32Array;
  readonly pondDepth: Uint16Array;
  /** The discharge a channel had to carry to be written at all. */
  readonly threshold: number;
}

export function decodeFlow(buffer: ArrayBuffer): Flow {
  if (buffer.byteLength < HEADER) throw new Error('kauai-flow.bin is not a file');
  const head = new DataView(buffer);
  if (head.getUint32(0, true) !== MAGIC) throw new Error('kauai-flow.bin lacks TMBF');
  const version = head.getUint16(4, true);
  if (version !== VERSION) throw new Error(`kauai-flow.bin is version ${version}`);
  const nReach = head.getUint32(8, true);
  const nPts = head.getUint32(12, true);
  const nPond = head.getUint32(16, true);
  const threshold = head.getFloat32(20, true);

  let at = HEADER;
  const reaches: Reach[] = [];
  for (let i = 0; i < nReach; i++) {
    reaches.push({ first: head.getUint32(at, true), count: head.getUint32(at + 4, true) });
    at += 8;
  }
  const take = <T>(make: (b: ArrayBuffer, o: number, n: number) => T,
                   bytes: number, n: number): T => {
    const view = make(buffer, at, n); at += bytes * n; return view;
  };
  const x = take((b, o, n) => new Int32Array(b, o, n), 4, nPts);
  const z = take((b, o, n) => new Int32Array(b, o, n), 4, nPts);
  const y = take((b, o, n) => new Int32Array(b, o, n), 4, nPts);
  const width = take((b, o, n) => new Uint16Array(b, o, n), 2, nPts);
  const pondX = take((b, o, n) => new Int32Array(b, o, n), 4, nPond);
  const pondZ = take((b, o, n) => new Int32Array(b, o, n), 4, nPond);
  const pondLevel = take((b, o, n) => new Int32Array(b, o, n), 4, nPond);
  const pondDepth = take((b, o, n) => new Uint16Array(b, o, n), 2, nPond);
  if (at !== buffer.byteLength) {
    throw new Error(`kauai-flow.bin says ${at} bytes and is ${buffer.byteLength}`);
  }
  return { reaches, x, z, y, width, pondX, pondZ, pondLevel, pondDepth, threshold };
}

/**
 * THE MOST THE CARVE MAY EVER LOWER THE GROUND, world units.
 *
 * A channel at the bottom of a gorge claims cells partway up its own
 * wall — they are within reach horizontally — and the profile then
 * presses them down toward ITS level, which on a Kauai headwater is a
 * hundred metres below. Measured from a screenshot: pale flat wedges
 * cut out of both valley walls, and still there with the water layer
 * switched off, which is what proved they were ground and not ribbon.
 *
 * Four metres is the deepest channel (2.5 m) plus its lip. Past that
 * the ground is not a bank, it is a hillside, and it keeps its shape.
 * This is the bound whose absence broke the terrain twice.
 */
export const MAX_CUT = 400;

/**
 * HOW DEEP A CHANNEL RUNS, from how wide it is.
 *
 * Twelve per cent of width between 30 cm and 2.5 m — the same law the
 * bake sized it by, repeated here because the CARVE has to agree with
 * the surface to the centimetre and a number in two files drifts.
 */
export function channelDepth(width: number): number {
  return Math.min(Math.max(width * 0.12, 30), 250);
}

/** Fraction of the half-width that is flat bed; the rest is eased wall. */
const FLAT_BED = 0.5;
/**
 * How steeply the bank climbs away from the channel edge.
 *
 * STEEPER THAN THE HILLSIDE, on purpose, and it used to be 0.8. The
 * carve only ever LOWERS the ground, so a bank grade shallower than the
 * land it crosses does not blend the channel in — it slices a bench out
 * of the valley wall for as far as the cut reaches. Measured from a
 * screenshot: on a headwater slope of about 1.6 the old 0.8 cut a
 * seventeen-metre pale shelf down each side of a twelve-metre stream,
 * which is most of what was on screen.
 *
 * The wide bank cut existed because the OLD channels came from USGS and
 * landed wherever the height grid disagreed with them, so the ground
 * had to be dragged down to meet the water. These channels came out of
 * the height grid, so the valley is already there and the carve only
 * has to cut the channel itself.
 */
const BANK_GRADE = 3.0;
/** How far past the channel the bank cut may reach, world units. */
const BANK_REACH = 60;

const CELL = 8_192;
const CELLS = Math.ceil(SPAN / CELL);

let loaded: Flow | null = null;
let ax: Float64Array | null = null;
let az: Float64Array | null = null;
let bx: Float64Array | null = null;
let bz: Float64Array | null = null;
let ay: Float32Array | null = null;
let by: Float32Array | null = null;
let wide: Float32Array | null = null;
let heads: Int32Array | null = null;
let counts: Int32Array | null = null;
let buckets: Int32Array | null = null;

export function forgetFlow(): void {
  loaded = null;
  ax = az = bx = bz = null;
  ay = by = wide = null;
  heads = counts = buckets = null;
}

export function flowData(): Flow | null { return loaded; }

/** The stations of one reach — the only centreline there is. */
export function reachOf(index: number): Reach | null {
  return loaded?.reaches[index] ?? null;
}

export function useFlow(flow: Flow): void {
  loaded = flow;
  let segments = 0;
  for (const r of flow.reaches) segments += Math.max(0, r.count - 1);
  ax = new Float64Array(segments); az = new Float64Array(segments);
  bx = new Float64Array(segments); bz = new Float64Array(segments);
  ay = new Float32Array(segments); by = new Float32Array(segments);
  wide = new Float32Array(segments);
  let at = 0;
  for (const r of flow.reaches) {
    for (let i = 0; i < r.count - 1; i++) {
      const p = r.first + i;
      ax[at] = flow.x[p]; az[at] = flow.z[p]; ay[at] = flow.y[p];
      bx[at] = flow.x[p + 1]; bz[at] = flow.z[p + 1]; by[at] = flow.y[p + 1];
      wide[at] = Math.max(flow.width[p], flow.width[p + 1]);
      at++;
    }
  }
  // Buckets, with each segment's influence folded into its footprint so
  // a miss never needs geometry — which is almost every query.
  const found: number[][] = [];
  for (let s = 0; s < segments; s++) {
    const reach = wide[s] / 2 + Math.min(BANK_REACH + wide[s] / 2, 2_000);
    const x0 = Math.max(0, Math.floor((Math.min(ax[s], bx[s]) - reach + SPAN / 2) / CELL));
    const x1 = Math.min(CELLS - 1, Math.floor((Math.max(ax[s], bx[s]) + reach + SPAN / 2) / CELL));
    const z0 = Math.max(0, Math.floor((Math.min(az[s], bz[s]) - reach + SPAN / 2) / CELL));
    const z1 = Math.min(CELLS - 1, Math.floor((Math.max(az[s], bz[s]) + reach + SPAN / 2) / CELL));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) (found[cz * CELLS + cx] ??= []).push(s);
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
    heads[cell] = cursor; counts[cell] = list.length;
    for (const s of list) buckets[cursor++] = s;
  }
}

export interface FlowSpot {
  /** Water surface here, world units above the sea. */
  readonly level: number;
  /** What the ground under the channel is pressed to. */
  readonly bed: number;
  readonly width: number;
  /** Distance from the centreline. */
  readonly off: number;
  /** Downstream, scaled by how far from the bank she is. */
  readonly flowX: number;
  readonly flowZ: number;
}

/** IS THIS POINT UNDER THE DRAWN WATER? The one test, asked once. */
export function inChannel(spot: FlowSpot): boolean {
  return spot.off <= spot.width / 2;
}

/** The nearest reach that claims this point, or null. */
export function flowAt(x: number, z: number): FlowSpot | null {
  if (!heads || !counts || !buckets) return null;
  const cx = Math.floor((x + SPAN / 2) / CELL);
  const cz = Math.floor((z + SPAN / 2) / CELL);
  if (cx < 0 || cz < 0 || cx >= CELLS || cz >= CELLS) return null;
  const cell = cz * CELLS + cx;
  const from = heads[cell];
  if (from < 0) return null;

  let best: FlowSpot | null = null;
  let bestInside = false;
  const many = counts[cell];
  for (let n = 0; n < many; n++) {
    const s = buckets[from + n];
    const half = wide![s] / 2;
    const cut = half + Math.min(BANK_REACH + half, 2_000);
    if (x < Math.min(ax![s], bx![s]) - cut || x > Math.max(ax![s], bx![s]) + cut) continue;
    if (z < Math.min(az![s], bz![s]) - cut || z > Math.max(az![s], bz![s]) + cut) continue;
    const ex = bx![s] - ax![s];
    const ez = bz![s] - az![s];
    const run = ex * ex + ez * ez;
    const t = run > 0
      ? Math.max(0, Math.min(1, ((x - ax![s]) * ex + (z - az![s]) * ez) / run)) : 0;
    const dx = x - (ax![s] + ex * t);
    const dz = z - (az![s] + ez * t);
    const off = Math.hypot(dx, dz);
    if (off > cut) continue;

    const level = ay![s] + (by![s] - ay![s]) * t;
    const width = wide![s];
    const deep = channelDepth(width);
    let bed: number;
    if (off <= half) {
      // In the channel: flat bed down the middle, eased wall to the edge.
      const wall = Math.max(0, (off / half - FLAT_BED) / (1 - FLAT_BED));
      const eased = wall * wall * (3 - 2 * wall);
      bed = level - deep * (1 - eased);
    } else {
      // And the bank, climbing from the waterline rather than stepping
      // off it. Zero freeboard on purpose: a shelf below the surface is
      // a ledge you can see under, all the way along both banks.
      bed = level + (off - half) * BANK_GRADE;
    }
    // A channel's velocity profile is roughly parabolic across it —
    // friction holds the margins nearly still while the thread down the
    // middle carries everything. Without this, the edge of a river hit
    // her as hard as the middle and stepping in was a wall of water.
    const across = Math.min(1, off / Math.max(1e-6, half));
    const thread = Math.max(0, 1 - across * across);
    const runLen = Math.hypot(ex, ez);
    const sign = by![s] <= ay![s] ? 1 : -1;
    const speed = flowSpeed(runLen > 0 ? Math.abs(ay![s] - by![s]) / runLen : 0);
    const spot: FlowSpot = {
      level, bed, width, off,
      flowX: runLen > 0 ? (ex / runLen) * sign * speed * thread : 0,
      flowZ: runLen > 0 ? (ez / runLen) * sign * speed * thread : 0,
    };
    const inside = off <= half;
    // IN-CHANNEL BEATS BANK, and only then does higher water win. A
    // river runs downhill, so a segment upstream of her always stands
    // higher than the one she is standing in; ranking on level alone
    // picks that one the moment it comes inside the claim radius.
    if (!best || (inside && !bestInside)
      || (inside === bestInside && (level > best.level || off < best.off))) {
      best = spot; bestInside = inside;
    }
  }
  return best;
}

/**
 * How fast water runs down a grade, world units a second.
 *
 * Manning's equation in spirit rather than in full: velocity climbs with
 * the square root of slope. Clamped at both ends — nothing crawls and
 * nothing becomes a firehose.
 */
function flowSpeed(grade: number): number {
  return Math.min(Math.max(180 * Math.sqrt(Math.max(grade, 0)), 10), 150);
}

/** What the ground under a channel is pressed to, or null. */
export function flowBed(x: number, z: number): number | null {
  const spot = flowAt(x, z);
  return spot ? spot.bed : null;
}

/** How big the file is, worked out the way the grid's loader does it. */
export function flowBytes(reaches: number, points: number, ponds: number): number {
  return HEADER + reaches * 8 + points * 14 + ponds * 14;
}

/** Fetch and decode the baked flow that ships with the build. */
export async function loadFlow(
  onProgress?: (bytes: number) => void,
): Promise<Flow> {
  const url = `${import.meta.env.BASE_URL}kauai-flow.bin`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`kauai-flow.bin: ${response.status}`);
  const buffer = await response.arrayBuffer();
  onProgress?.(buffer.byteLength);
  return decodeFlow(buffer);
}
