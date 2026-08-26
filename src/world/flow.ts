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
 * A LEVEL FIELD, OVER A CARVED BED. Version 1 cut the channel bed into the
 * ground at runtime, and the carve broke the terrain twice — a channel
 * at the bottom of a gorge claimed cells partway up its own wall and
 * pressed them toward ITS level, slicing pale benches out of both
 * valley sides. Version 2 stores the water-surface LEVEL at every
 * station and every pond cell, exactly as the ocean is a level, and
 * touched the ground never — and version 3 brought a carve BACK, this
 * time bounded so it cannot repeat the damage: carve.ts cuts a trench
 * no wider than the channel's own shoulder and no deeper than a metre,
 * and terrainHeight applies it. The renderer still draws over-wide
 * flat slabs AT the level and lets the terrain clip them, so the
 * water's edge, the curves, and the mid-stream stones all emerge from
 * the depth test instead of from geometry this file would have to get
 * right — the difference is that the terrain doing the clipping now
 * has a bed in it for the water to sit in.
 *
 * WET OR DRY, ONE RULE, ASKED IN ONE PLACE. drawn level =
 * level * reliefScale(); a point is wet iff that beats
 * groundHeight(wx, wz), and the difference is the depth. Rendering and
 * gameplay both read `waterLevelAt`, which answers in RAW units at
 * relief 1 — callers apply reliefScale() themselves, because this file
 * imports neither heightfield nor three: it has to stay readable from
 * the renderer, the simulation, and the bake's tests without a cycle.
 *
 * ONE SET OF STATIONS, READ BY BOTH SIDES. The index below and the
 * slabs in FlowWater.ts walk the same rows. The last release learnt
 * that the expensive way: the collision index followed the shipped
 * polyline while the ribbon followed a spline through it, and 11.7% of
 * the water she could be pushed by had nothing drawn over it.
 *
 * GLOBAL COORDINATES, float64, nothing near the GPU — as everywhere.
 */
import { SPAN, STEP } from './kauai';

/** `TMBF`, little-endian, as the bake writes it. */
const MAGIC = 0x46424d54;
/**
 * VERSION 3: a LEFT and a RIGHT half-width per station, so the drawn
 * slab is sized by measurement rather than by the channel sitting in
 * the middle of it.
 *
 * Version 2 sized the slab with slabHalf(width), and WIDTH is the TRUE
 * hydraulic channel — honest, and a median of 0.60 m across, which
 * really is how wide the water runs. The trouble is that the ground
 * either side of it stays BELOW the water surface for a median of about
 * 106 m, so a slab sized from the channel painted a thread down the
 * middle of a broad valley floor. Over 598 sampled stations, 92.6% had
 * their wetted reach cut off by the edge of the slab rather than by the
 * terrain: the water looked narrow because we drew it narrow, not
 * because the island is. `scripts/bakeWidth.ts` now walks outward from
 * every station on the ground the GAME draws, until it rises through
 * the level or falls away into somebody else's basin, and stores what
 * it finds. The terrain still clips the final shoreline exactly as it
 * did; it simply gets the chance to.
 *
 * VERSION 2 gave every station a LEVEL and a BED instead of one height,
 * and padded the point block to a 4-byte boundary after the u16 widths.
 * Version 1 had no pad and decoded anyway because nPoints happened to
 * be even; an Int32Array view demands 4-byte alignment, and the pond
 * arrays sit directly after the widths. The guarantee is the format's
 * now, not the data's luck. Version 3 adds two more u16 arrays of that
 * same length — six bytes a station between the three — so the parity
 * comes out unchanged, and the pad is still computed from all three
 * anyway, because six being even is a coincidence and the next array
 * added at some other width would break the arithmetic in silence.
 */
const VERSION = 3;
const HEADER = 32;

/**
 * NOBODY HAS WALKED OUT FROM THIS STATION YET. bakeFlow.py cannot know
 * how far the water reaches — its cells are 54.7 m across while the
 * walk has to happen on the centimetre-resolution ground the game
 * actually draws — so it writes this into every left and right, and
 * `scripts/bakeWidth.ts` overwrites them with measured half-widths,
 * which never exceed 30,000 units. The sentinel therefore cannot be
 * mistaken for a value at either end. A bake that ships without the
 * second pass loads perfectly and draws exactly the old narrow water,
 * which is a failure that looks like nothing changed.
 */
export const UNMEASURED = 0xffff;

export interface Reach { readonly first: number; readonly count: number; }

export interface Flow {
  readonly reaches: readonly Reach[];
  /** Station positions, world units. */
  readonly x: Int32Array;
  readonly z: Int32Array;
  /**
   * Water surface at each station, raw units at relief 1 — the bake's
   * bed plus channelDepth(width), then clamped never to step uphill
   * downstream along the reach.
   */
  readonly level: Int32Array;
  /**
   * The bake's filled ground surface at each station — the
   * priority-flood surface, which equals the sampled ground outside
   * ponds. `level - bed` is the depth the shader shades by.
   */
  readonly bed: Int32Array;
  /** Full TRUE channel width at each station, world units. */
  readonly width: Uint16Array;
  /**
   * HOW FAR THE WATER REACHES EITHER SIDE of the centreline, as a
   * half-width in world units, named for the DIRECTION OF TRAVEL down
   * the reach and not for any compass: right is the +n side of the
   * station's tangent, left the -n side.
   *
   * THESE ARE ALREADY THE NUMBER TO DRAW. Every margin the stopping
   * rule allows has been applied by the bake before the value was
   * written, because only the bake knows WHY the march stopped. A walk
   * halted by a bank is given 200 units of overshoot, so the terrain
   * and not the slab's edge owns the last step of shoreline; a walk
   * halted by ground falling two metres away into another basin, or by
   * a cell some pond already owns, is given none, because overshooting
   * there paints water onto ground that drains somewhere else. Nothing
   * downstream of the bake can tell those cases apart from the number
   * alone, so nothing downstream should try to: draw what is here.
   *
   * UNMEASURED means the walk has not been taken for this station. Ask
   * halfAt() instead of reading these directly and the fallback to
   * slabHalf() is handled for you.
   */
  readonly left: Uint16Array;
  readonly right: Uint16Array;
  /** Standing water: one entry per ponded grid cell. */
  readonly pondX: Int32Array;
  readonly pondZ: Int32Array;
  /** The pit's spill level — ponds are already full, no depth added. */
  readonly pondLevel: Int32Array;
  /** Spill level minus the bake's ground at the cell. */
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
  // The counts fix the size to the byte, so check it BEFORE building
  // views — a truncated file should say what it is, not throw a
  // RangeError from the middle of a constructor.
  const need = flowBytes(nReach, nPts, nPond);
  if (buffer.byteLength !== need) {
    throw new Error(`kauai-flow.bin says ${need} bytes and is ${buffer.byteLength}`);
  }

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
  const level = take((b, o, n) => new Int32Array(b, o, n), 4, nPts);
  const bed = take((b, o, n) => new Int32Array(b, o, n), 4, nPts);
  const width = take((b, o, n) => new Uint16Array(b, o, n), 2, nPts);
  const left = take((b, o, n) => new Uint16Array(b, o, n), 2, nPts);
  const right = take((b, o, n) => new Uint16Array(b, o, n), 2, nPts);
  // The pad: zero or two zero bytes, whatever brings the pond
  // Int32Arrays back onto a 4-byte boundary. It now falls after THREE
  // u16 arrays rather than one, which is six bytes a station and so
  // leaves the parity exactly where version 2 left it — worked out from
  // where the cursor has actually got to, not from that coincidence.
  at = (at + 3) & ~3;
  const pondX = take((b, o, n) => new Int32Array(b, o, n), 4, nPond);
  const pondZ = take((b, o, n) => new Int32Array(b, o, n), 4, nPond);
  const pondLevel = take((b, o, n) => new Int32Array(b, o, n), 4, nPond);
  const pondDepth = take((b, o, n) => new Uint16Array(b, o, n), 2, nPond);
  return {
    reaches, x, z, level, bed, width, left, right,
    pondX, pondZ, pondLevel, pondDepth, threshold,
  };
}

/**
 * HOW DEEP A CHANNEL RUNS, from how wide it is.
 *
 * Twelve per cent of width between 30 cm and 2.5 m — the same law the
 * bake set LEVEL = BED + depth by, repeated here because a number in
 * two files drifts, and anything that still needs a depth from a width
 * alone has to agree with the file to the centimetre.
 */
export function channelDepth(width: number): number {
  return Math.min(Math.max(width * 0.12, 30), 250);
}

/**
 * HALF-WIDTH OF THE DRAWN SLAB WHERE NOBODY HAS MEASURED ONE — the
 * fallback and the floor now, not the primary. Version 3 carries a
 * measured half-width per side per station and halfAt() prefers it;
 * this is what answers for a station still marked UNMEASURED, and it
 * is the number every measured value is floored at, so the move to
 * measured widths is strictly a widening and no stream can come out
 * narrower than it drew before.
 *
 * ONE NUMBER, BOTH SIDES, STILL — whatever answers here answers for
 * the drawn slab and for the index claim alike, because anywhere the
 * slab could be drawn, `flowAt` must be able to name the reach that
 * drew it. That is the same lesson the stations taught, applied to
 * width; halfAt() is where the agreement lives now.
 *
 * The slab is deliberately wider than the channel. The terrain clips
 * it, so the water's edge is wherever the bank rises through the
 * surface; the extra reach buys the banks, the corners the polyline
 * cuts, and the coarseness of the grid the channel came from. One and
 * a half widths plus a two-metre floor so a rill still makes a
 * readable sheet, capped at 26 m of half-width.
 *
 * THE CAP USED TO BE JUSTIFIED BY THE BUCKET GRID — 26 m keeps a claim
 * well inside one 81.92 m cell — and that reasoning is now dead, since
 * a measured claim reaches as far as 300 m and crosses several cells
 * as a matter of course. It was never the load-bearing part: useFlow()
 * folds every segment into EVERY cell its claim's footprint touches,
 * so a claim spanning cells is listed in all of them and flowAt()'s
 * single-cell probe still finds it from wherever she stands. The cap
 * survives on its own merit instead, as the widest slab worth drawing
 * from a width alone when the true reach is unknown.
 */
export function slabHalf(width: number): number {
  return Math.min(width * 1.5 + 200, 2600);
}

/**
 * HOW FAR THE WATER GOES ON ONE SIDE — to draw, and to claim. Side -1
 * is left of the direction of travel, +1 is right.
 *
 * The measured value wins where there is one, and slabHalf() answers
 * where there is not. The floor is applied here as well as in the
 * bake: it costs one comparison, and it makes "version 3 only ever
 * widens" true of every file that loads rather than only of files an
 * up-to-date bakeWidth wrote.
 */
export function halfAt(flow: Flow, p: number, side: -1 | 1): number {
  const measured = side < 0 ? flow.left[p] : flow.right[p];
  // A MEASUREMENT WINS OUTRIGHT, with no floor under it.
  //
  // It used to be floored at slabHalf, which made version 3 strictly a
  // widening: with no bed cut for the water, every extra metre was a
  // metre the terrain would clip anyway, so a floor could only help.
  // `carve.ts` cut a bed, and the floor became the wrong direction —
  // it would push the claim back out past the bank the trench had just
  // established, and claim water on ground nothing had touched.
  return measured === UNMEASURED ? slabHalf(flow.width[p]) : measured;
}

const CELL = 8_192;
const CELLS = Math.ceil(SPAN / CELL);

let loaded: Flow | null = null;
let ax: Float64Array | null = null;
let az: Float64Array | null = null;
let bx: Float64Array | null = null;
let bz: Float64Array | null = null;
let aLev: Float32Array | null = null;
let bLev: Float32Array | null = null;
let aBed: Float32Array | null = null;
let bBed: Float32Array | null = null;
let wide: Float32Array | null = null;
let claim: Float32Array | null = null;
let sheet: PondSheet | null = null;
/**
 * THE SAME CLAIM, PER SIDE — two floats a segment, left then right.
 *
 * `claim` above is the max of both sides at both ends, because the
 * broad phase is a circle swept along a line and a circle has no
 * sides. That is right for the bucket footprint and the bounding box,
 * and it was ALSO doing the final accept, which is where it went
 * wrong: a stream hugging a valley wall reaches two metres on the wall
 * side and two hundred across the floor, and the symmetric claim said
 * "wet" two hundred metres up the wall on a bench the bake had never
 * walked. Nothing was DRAWN there — buildReach uses the per-side
 * half-width — so the game let her swim in water she could not see.
 *
 * Measured: 7.8% of everything waterLevelAt called wet had no geometry
 * over it, and none of it was pond-owned. That is Joshua's "still
 * water not showing in a deep part".
 *
 * So the broad phase stays generous and the narrow phase gets exact.
 *
 * FOUR FLOATS, NOT TWO: each side at each END of the segment. Two was
 * the max along the whole segment, and the slab does not do that — it
 * INTERPOLATES between its stations, so a segment running from a
 * forty-metre reach to a five-metre one is a taper in the geometry and
 * was a forty-metre rectangle in the index. That gap sits mid-segment,
 * which is exactly where the holes were: a median of 17 m from the
 * nearest station, on a stream whose half-widths comfortably covered
 * 17 m at one end. Ordered [aLeft, aRight, bLeft, bRight].
 */
let sideClaim: Float32Array | null = null;
let heads: Int32Array | null = null;
let counts: Int32Array | null = null;
let buckets: Int32Array | null = null;
let ponds: Map<string, number> | null = null;

export function forgetFlow(): void {
  loaded = null;
  ax = az = bx = bz = null;
  aLev = bLev = aBed = bBed = wide = claim = sideClaim = null;
  sheet = null;
  heads = counts = buckets = null;
  ponds = null;
}

export function flowData(): Flow | null { return loaded; }

export function useFlow(flow: Flow): void {
  loaded = flow;
  let segments = 0;
  for (const r of flow.reaches) segments += Math.max(0, r.count - 1);
  ax = new Float64Array(segments); az = new Float64Array(segments);
  bx = new Float64Array(segments); bz = new Float64Array(segments);
  aLev = new Float32Array(segments); bLev = new Float32Array(segments);
  aBed = new Float32Array(segments); bBed = new Float32Array(segments);
  wide = new Float32Array(segments);
  claim = new Float32Array(segments);
  sideClaim = new Float32Array(segments * 4);
  let at = 0;
  for (const r of flow.reaches) {
    for (let i = 0; i < r.count - 1; i++) {
      const p = r.first + i;
      ax[at] = flow.x[p]; az[at] = flow.z[p];
      bx[at] = flow.x[p + 1]; bz[at] = flow.z[p + 1];
      aLev[at] = flow.level[p]; bLev[at] = flow.level[p + 1];
      aBed[at] = flow.bed[p]; bBed[at] = flow.bed[p + 1];
      wide[at] = Math.max(flow.width[p], flow.width[p + 1]);
      // THE CLAIM IS NOT THE CHANNEL, and the two must never collapse
      // back into one number. `wide` is the TRUE hydraulic channel and
      // the velocity thread is shaped from it, which is what keeps the
      // current inside the water; `claim` is how far the SLAB reaches,
      // measured per side by the bake and now as much as 300 m of it.
      // A segment is claimed to the widest of its two ends on either
      // side, because the claim is a circle swept along a line and has
      // no sides to be asymmetric about. Being generous here costs
      // only a geometry test, and never a drop of water where there
      // should be none: waterLevelAt()'s caller still has to beat the
      // ground with the level before anything is wet.
      // A SPAN A POND HAS TAKEN OVER CLAIMS NOTHING, because nothing
      // is drawn over it. The bake tucks a ponded station under the
      // spill level — level below bed, the only case that writes one —
      // and buildReach collapses the whole span to a degenerate strip
      // if EITHER end is flagged, so the pond sheet owns those pixels
      // alone. The index was still claiming them, which is water the
      // game would let her swim in with nothing over it, and it is the
      // last of the holes that widening the slab could not close.
      // pondLevelAt answers for that ground, as it should.
      const taken = flow.level[p] < flow.bed[p] || flow.level[p + 1] < flow.bed[p + 1];
      const aL = taken ? 0 : halfAt(flow, p, -1), aR = taken ? 0 : halfAt(flow, p, 1);
      const bL = taken ? 0 : halfAt(flow, p + 1, -1), bR = taken ? 0 : halfAt(flow, p + 1, 1);
      claim[at] = Math.max(aL, aR, bL, bR);
      sideClaim[at * 4] = aL;
      sideClaim[at * 4 + 1] = aR;
      sideClaim[at * 4 + 2] = bL;
      sideClaim[at * 4 + 3] = bR;
      at++;
    }
  }
  // Buckets, with each segment's claim folded into its footprint so
  // a miss never needs geometry — which is almost every query. That
  // footprint is a rectangle of CELLS, not a single one, which is the
  // only reason a claim may now be larger than a cell: at 300 m a
  // measured claim spans four or five of the 81.92 m grid, is listed
  // in every one of them, and so is still found by the single-cell
  // probe in flowAt().
  const found: number[][] = [];
  for (let s = 0; s < segments; s++) {
    const far = claim[s];
    const x0 = Math.max(0, Math.floor((Math.min(ax[s], bx[s]) - far + SPAN / 2) / CELL));
    const x1 = Math.min(CELLS - 1, Math.floor((Math.max(ax[s], bx[s]) + far + SPAN / 2) / CELL));
    const z0 = Math.max(0, Math.floor((Math.min(az[s], bz[s]) - far + SPAN / 2) / CELL));
    const z1 = Math.min(CELLS - 1, Math.floor((Math.max(az[s], bz[s]) + far + SPAN / 2) / CELL));
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
  // The pond sheet as a hash of the grid cell. A pond is a per-cell
  // fact in the bake, so the lookup owes nothing to geometry: key the
  // nearest sample exactly as the bake indexed it and the answer is
  // O(1) whatever shape the pond grew into.
  ponds = new Map();
  const many = flow.pondX.length;
  const listed = new Map<string, number>();
  for (let i = 0; i < many; i++) {
    const cx = Math.round((flow.pondX[i] + SPAN / 2) / STEP);
    const cz = Math.round((flow.pondZ[i] + SPAN / 2) / STEP);
    listed.set(cx + ',' + cz, flow.pondLevel[i]);
  }
  // AND ONE RING OF RIM CELLS AROUND EVERY LISTED ONE, at the spill
  // level of the flooded neighbour. The bake lists a cell only when
  // its own SAMPLE floods, so a lake's true waterline — where the
  // spill level meets the rising ground — usually crosses the ring of
  // cells just OUTSIDE the listed set. Without the rim, both the
  // drawn sheet and the physical answer stopped dead at the last
  // listed cell's edge: a 55-metre staircase of quad borders standing
  // in open water, which is most of the jagged pond shoreline in
  // Joshua's screenshots. The rim cell carries its neighbour's level
  // and the ordinary rule — wet iff level beats ground — finds the
  // real shoreline inside it. Where the rim's ground is above the
  // spill, the rim answers a level the ground beats, which is DRY,
  // exactly as before; this can only extend water downhill of a lip,
  // never invent it on a bank.
  //
  // Where two basins' rims meet, the higher spill owns the cell — the
  // same rule waterLevelAt already applies when surfaces overlap.
  const rim = new Map<string, number>();
  for (const [key, level] of listed) {
    const [cx, cz] = key.split(',').map(Number);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const at = (cx + dx) + ',' + (cz + dz);
        if (listed.has(at)) continue;
        const held = rim.get(at);
        if (held === undefined || level > held) rim.set(at, level);
      }
    }
  }
  for (const [key, level] of listed) ponds.set(key, level);
  for (const [key, level] of rim) ponds.set(key, level);
  // The drawable sheet: every cell the hash answers for, listed and
  // rim alike, as coordinates the renderer can batch. Kept here so
  // the drawn cells and the answering cells are one set by
  // construction — a rim that answered but was not drawn would be
  // swimmable invisible water, and that bug has been shipped before.
  const cells = ponds.size;
  sheet = {
    x: new Int32Array(cells), z: new Int32Array(cells),
    spill: new Int32Array(cells), rim: new Uint8Array(cells),
  };
  let put = 0;
  for (const [key, level] of ponds) {
    const [cx, cz] = key.split(',').map(Number);
    sheet.x[put] = Math.round(cx * STEP - SPAN / 2);
    sheet.z[put] = Math.round(cz * STEP - SPAN / 2);
    sheet.spill[put] = level;
    sheet.rim[put] = listed.has(key) ? 0 : 1;
    put++;
  }
}

/**
 * Every cell the pond hash answers for, as drawable coordinates.
 *
 * The surface field is `spill`, not `level`, and the odd name is a
 * guard: `Flow` also carries x/z/level (the STATION arrays), so a
 * sheet shaped exactly like it would let a Flow pass anywhere a sheet
 * is wanted — structurally typed, silently, with station data where
 * pond cells belong. That exact mistake compiled clean during this
 * change; the distinct field name is what stops it compiling.
 */
export interface PondSheet {
  readonly x: Int32Array;
  readonly z: Int32Array;
  readonly spill: Int32Array;
  /** 1 where the cell is rim — outside the bake's own listing. */
  readonly rim: Uint8Array;
}

/** The standing water's drawable cells, or null before useFlow. */
export function pondSheet(): PondSheet | null {
  return sheet;
}

export interface FlowSpot {
  /** Water surface here, raw units at relief 1. */
  readonly level: number;
  /** The bake's filled ground under it; level - bed is the depth. */
  readonly bed: number;
  readonly width: number;
  /** Distance from the centreline. */
  readonly off: number;
  /**
   * How far the water reaches on THIS side, here — the claim that
   * admitted this point.
   *
   * Carried because the carve has to stop where the claim does. The
   * trench's own shoulder is cutHalf(width), which can be three times
   * this on a stream pinned against a valley wall; shaping the bed to
   * the shoulder and then having flowAt refuse the point a centimetre
   * later leaves the cut hanging at full depth — a 73 cm cliff in
   * 8 cm of ground, repeated along the bank as a row of fins. See
   * terrainHeight.
   */
  readonly reach: number;
  /** Downstream, scaled by how far from the bank she is. */
  readonly flowX: number;
  readonly flowZ: number;
}

/** The nearest reach that claims this point, or null. */
export function flowAt(wx: number, wz: number): FlowSpot | null {
  if (!heads || !counts || !buckets) return null;
  const cx = Math.floor((wx + SPAN / 2) / CELL);
  const cz = Math.floor((wz + SPAN / 2) / CELL);
  if (cx < 0 || cz < 0 || cx >= CELLS || cz >= CELLS) return null;
  const cell = cz * CELLS + cx;
  const from = heads[cell];
  if (from < 0) return null;

  let best: FlowSpot | null = null;
  let bestInside = false;
  const many = counts[cell];
  for (let n = 0; n < many; n++) {
    const s = buckets[from + n];
    const width = wide![s];
    const far = claim![s];
    if (wx < Math.min(ax![s], bx![s]) - far || wx > Math.max(ax![s], bx![s]) + far) continue;
    if (wz < Math.min(az![s], bz![s]) - far || wz > Math.max(az![s], bz![s]) + far) continue;
    const ex = bx![s] - ax![s];
    const ez = bz![s] - az![s];
    const run = ex * ex + ez * ez;
    const t = run > 0
      ? Math.max(0, Math.min(1, ((wx - ax![s]) * ex + (wz - az![s]) * ez) / run)) : 0;
    const dx = wx - (ax![s] + ex * t);
    const dz = wz - (az![s] + ez * t);
    const off = Math.hypot(dx, dz);
    if (off > far) continue;
    // AND NOW HOW FAR THE SLAB ACTUALLY REACHES HERE — on this side,
    // at this point along the segment.
    //
    // buildReach offsets its `side = +1` vertices along (-ez, ex), and
    // the cross product of the segment with that is positive, so a
    // positive cross here is that same side. The lerp on `t` is the
    // taper: the geometry interpolates its half-width between the two
    // stations and this has to follow it, or the index claims a
    // rectangle where the slab draws a wedge.
    const hand = ex * dz - ez * dx >= 0 ? 1 : 0;
    const reach = sideClaim![s * 4 + hand]
      + (sideClaim![s * 4 + 2 + hand] - sideClaim![s * 4 + hand]) * t;
    if (off > reach) continue;

    const level = aLev![s] + (bLev![s] - aLev![s]) * t;
    const bed = aBed![s] + (bBed![s] - aBed![s]) * t;
    const half = width / 2;
    // A channel's velocity profile is roughly parabolic across it —
    // friction holds the margins nearly still while the thread down the
    // middle carries everything. Without this, the edge of a river hit
    // her as hard as the middle and stepping in was a wall of water.
    // The claim reaches as far past the bank as the DRAWN water does,
    // which since version 3 is measured and can be three hundred metres
    // rather than twenty-six — so the thread carries more weight than
    // it ever has. `half` below is half the TRUE channel and nothing
    // else, which is what guarantees ZERO current outside it: a current
    // on dry land is the founding fault this whole file exists to
    // remove. Widening the water we DRAW must never widen the water
    // that PUSHES, so this reads `wide` and never `claim`.
    const across = Math.min(1, off / Math.max(1e-6, half));
    const thread = Math.max(0, 1 - across * across);
    const runLen = Math.hypot(ex, ez);
    const sign = bLev![s] <= aLev![s] ? 1 : -1;
    const speed = flowSpeed(runLen > 0 ? Math.abs(aLev![s] - bLev![s]) / runLen : 0);
    const spot: FlowSpot = {
      level, bed, width, off, reach,
      flowX: runLen > 0 ? (ex / runLen) * sign * speed * thread : 0,
      flowZ: runLen > 0 ? (ez / runLen) * sign * speed * thread : 0,
    };
    const inside = off <= half;
    // IN-CHANNEL BEATS BANK-CLAIM, and only then does higher water win.
    // A river runs downhill, so a segment upstream of her always stands
    // higher than the one she is standing in; ranking on level alone
    // picks that one the moment it comes inside the claim radius.
    if (!best || (inside && !bestInside)
      || (inside === bestInside && (level > best.level || off < best.off))) {
      best = spot; bestInside = inside;
    }
  }
  return best;
}

/** What a coarse terrain vertex needs to know about a channel near it. */
export interface NearChannel {
  readonly level: number;
  readonly bed: number;
  readonly width: number;
  /** True distance from the centreline, which may exceed the claim. */
  readonly off: number;
}

/**
 * THE NEAREST CHANNEL WITHIN `slack`, for the tiers drawn too coarsely
 * to have found it any other way.
 *
 * `flowAt` answers only inside a segment's CLAIM, which since the bed
 * was cut is a handful of metres — right for gameplay, and useless to
 * a middle-tier vertex standing 31 m from the water it is supposed to
 * be holding. That mismatch is what put Joshua's rivers on stilts: the
 * near mesh cut its trench and the coarse mesh did not, so past twenty
 * metres the water lay on top of uncut ground with its edges showing.
 * "Floating like highways."
 *
 * Deliberately NOT the hot path and deliberately not a FlowSpot: this
 * returns the four numbers a carve needs and no current, so nothing
 * here has to keep step with the velocity thread, and `flowAt` stays
 * exactly as fast as it was.
 */
export function flowNear(wx: number, wz: number, slack: number): NearChannel | null {
  if (!heads || !counts || !buckets || !loaded) return null;
  // The bucket grid holds each segment under every cell its claim
  // touches, so widening the question by `slack` means widening the
  // SEARCH by the same, one bucket at a time.
  const span = Math.ceil(slack / CELL);
  const cx = Math.floor((wx + SPAN / 2) / CELL);
  const cz = Math.floor((wz + SPAN / 2) / CELL);
  let best: NearChannel | null = null;
  for (let dz = -span; dz <= span; dz++) {
    for (let dx = -span; dx <= span; dx++) {
      const ax2 = cx + dx;
      const az2 = cz + dz;
      if (ax2 < 0 || az2 < 0 || ax2 >= CELLS || az2 >= CELLS) continue;
      const cell = az2 * CELLS + ax2;
      const from = heads[cell];
      if (from < 0) continue;
      const many = counts[cell];
      for (let n = 0; n < many; n++) {
        const s = buckets[from + n];
        const ex = bx![s] - ax![s];
        const ez = bz![s] - az![s];
        const run = ex * ex + ez * ez;
        const t = run > 0
          ? Math.max(0, Math.min(1, ((wx - ax![s]) * ex + (wz - az![s]) * ez) / run)) : 0;
        const offX = wx - (ax![s] + ex * t);
        const offZ = wz - (az![s] + ez * t);
        const off = Math.hypot(offX, offZ);
        if (off > claim![s] + slack) continue;
        if (best && off >= best.off) continue;
        const level = aLev![s] + (bLev![s] - aLev![s]) * t;
        const bed = aBed![s] + (bBed![s] - aBed![s]) * t;
        best = { level, bed, width: wide![s], off };
      }
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

/**
 * STANDING WATER at this point, or null. One hash probe: the bake
 * writes ponds per grid cell at the pit's spill level — already full,
 * so there is no depth law to apply and the level IS the answer.
 */
export function pondLevelAt(wx: number, wz: number): number | null {
  if (!ponds) return null;
  const cx = Math.round((wx + SPAN / 2) / STEP);
  const cz = Math.round((wz + SPAN / 2) / STEP);
  return ponds.get(cx + ',' + cz) ?? null;
}

/**
 * THE ONE ANSWER for "is there water here, and how high does it
 * stand". Raw units at relief 1 — callers multiply by reliefScale()
 * before comparing with groundHeight(); wet iff the drawn level beats
 * the ground, and the difference is the depth. Where a reach runs
 * through a pond the higher of the two surfaces stands.
 */
export function waterLevelAt(wx: number, wz: number): number | null {
  const pond = pondLevelAt(wx, wz);
  const spot = flowAt(wx, wz);
  if (pond === null) return spot ? spot.level : null;
  if (!spot) return pond;
  return Math.max(pond, spot.level);
}

/**
 * How big the file is, worked out the way the grid's loader does it.
 * A station is 22 bytes in version 3 — sixteen of i32 and six across
 * the three u16 arrays, width and left and right — plus its share of
 * the alignment pad, the two zero bytes that exist when nPoints is
 * odd, and a pond is 14. The decoder checks against this before it
 * builds a single view.
 */
export function flowBytes(reaches: number, points: number, ponds: number): number {
  const rows = HEADER + reaches * 8 + points * 16 + points * 6;
  return ((rows + 3) & ~3) + ponds * 14;
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
