/**
 * THE REAL RIVERS AND LAKES OF KAUAʻI — the FAR tier, and it is a survey
 * rather than a simulation.
 *
 * Not derived, not guessed, not solved: USGS NHDPlus HR, the surveyed
 * hydrography of the actual island, baked to world units by v0's
 * `scripts/bakeHydro.py` and shipped as `public/kauai-hydro.bin`. This
 * file is the FORMAT and the LOOKUP and nothing else. It decodes bytes
 * somebody else loaded, it answers "what water is near here", and it
 * hands out polylines and rings. It does not fetch (that is `assets/`),
 * it does not solve (that is `water/sim.ts`), it does not draw, and it
 * has no opinion about the ground.
 *
 * MEASURED AGAINST THE SHIPPED BYTES, not trusted from a comment:
 * 1,121 runs, 264 of them carrying one of 171 names people use — Hanalei
 * River, Anahola Stream, North Fork Wailua River — Strahler order 1 to 5
 * (564 / 289 / 149 / 104 / 15 runs of each), 140 runs flagged as
 * connected to the sea (which is not the same as ending at it — see
 * `Run.toOcean`),
 * 49,665 points totalling 1,638 km of channel, and 111 lakes drawn as
 * 117 rings of 2,605 vertices, 64 of them named. Widths run 2.5 m to
 * 36.2 m, waterlines from 1.2 m below mean sea level at the mouths to
 * 1,546.8 m up Waiʻaleʻale.
 *
 * WHY A SURVEY AND NOT A SOLVER. The island used to work out its own
 * waterways: sample the drawn ground, fill its pits, route steepest
 * descent, accumulate rainfall, trace what came out. Sound mathematics,
 * solving the wrong island — a 54.7 m grid blurred with a 100 m kernel
 * has its valleys somewhere other than Kauaʻi's. Measured against this
 * file, that blur alone put the ground 13.28 m out and left only 21% of
 * river points within 5 m of their own terrain, against 88% unblurred.
 *
 * So there is nothing left to derive and, more to the point, nothing
 * left to DISAGREE. A derived network moves every time the terrain dial
 * moves; a surveyed one does not. The river is where the river is.
 *
 * `drainage.ts` beside this file is NOT a competitor to it and the two
 * answer different questions. D8 accumulation asks "does the ground here
 * gather enough area to run a stream", at the coarse grid's 54.7 m, and
 * that is what decides where the solver's baseflow ENTERS. This asks
 * "where did the survey put the Hanalei", to the metre, and that is what
 * the far tier DRAWS. One is a feed rule, the other is geography.
 *
 * THE TOPOLOGY IS WORTH AS MUCH AS THE GEOMETRY. Every run carries its
 * Strahler order and whether it reaches the ocean, so "this water
 * connects to that water" is a fact in the file rather than something a
 * renderer has to be trusted not to break. Order is also the far tier's
 * natural LOD dial: drop order 1 and 2 and 853 of the 1,121 runs go with
 * them, leaving the 268 a player would actually name.
 *
 * NOTHING HERE TOUCHES THE TERRAIN, and it could not if it wanted to:
 * there is no height API in this module in either direction. The
 * `level` a point carries is the SURVEY'S OWN waterline, baked with the
 * geometry, not a height read back out of the DEM and not a height
 * written into it (CLAUDE.md: "The terrain is not ours to move").
 *
 * WHAT CHANGED FROM v0's `src/world/hydro.ts`, and why each one:
 *
 *  - IT IS PURE. v0 imported `pullBuffer` and went to the network from
 *    inside core. Decoding a format is core; getting the bytes is not.
 *    This takes an ArrayBuffer that somebody else loaded, which is also
 *    what lets the test below read the real 839,071 shipped bytes off
 *    disk under plain node.
 *  - NO MODULE-LEVEL MUTABLE STATE. v0 kept a loaded singleton, a
 *    `byTile` map and a `useHydro()` that filled them, so "what is the
 *    hydrography" had a different answer depending on when you asked and
 *    who had called `forgetHydro()`. The decoder returns a value and the
 *    caller holds it. Two answers to one question is the failure this
 *    whole rebuild exists to stop.
 *  - THE PUBLIC SURFACE TAKES AND RETURNS `WorldPoint`. The raw parallel
 *    arrays stay public for the code that wants a buffer to fill, but
 *    anything that hands out a position hands out a branded point.
 *  - A `Run`, NOT A `River`. Kauaʻi does not have 1,121 rivers; it has a
 *    few dozen, split by the survey into 1,121 reaches between junctions.
 *    Calling each one a River invites a renderer to label an order-1
 *    trickle the Wailua.
 *  - THE RING ARRAYS ARE RENAMED. v0 had `Hydro.ringCount` (vertices in
 *    ring r) next to `Lake.ringCount` (rings in lake l) — same word, two
 *    meanings, one letter apart at the call site. Here they are
 *    `ringFirstVert` and `ringVertCount`.
 *  - `toOcean` IS NOT A MOUTH FLAG, whatever v0's comment said. See its
 *    field below: the bytes contradict the sentence, and 87 of the 140
 *    runs it marks end where another run begins.
 *  - THE MEDIAN WIDTH COMMENT WAS WRONG. v0 said "Median about 3.6 m".
 *    Measured over all 49,665 points: median 550 units = 5.5 m, mean 784
 *    = 7.84 m, range 250 to 3,620 = 2.5 m to 36.2 m. 3.6 m is the MAXIMUM
 *    read as if it were the median.
 *  - CORRUPTION THROWS FURTHER IN. v0 checked the file's total length,
 *    which catches a truncated download. It did not check that a run's
 *    point range lies inside the point array, so a file of the right
 *    length with a flipped byte decoded into a polyline of zeros — a
 *    river through the middle of the sea, with nothing to say why.
 *
 * WHERE THE FILE NAME IS NOT. `kauai-hydro.bin` is deliberately not
 * named as a constant here: asset paths live in `assets/demSource.ts`
 * beside `COARSE_PATH`, because the deployed build serves them under a
 * base path and core has no business knowing it.
 *
 * Pure: no three, no DOM, no network, no timer. `src/world/` is core.
 */
import { ISLAND_SPAN, world, type WorldPoint } from '../coords';
// ISLAND_HALF_SPAN, not `ISLAND_SPAN / 2` spelled out again: v0 wrote the
// halving at every call site and a single missed one is an island half a
// world away, which is why `dem.ts` made it a name.
import { ISLAND_HALF_SPAN } from '../dem';

// ---------------------------------------------------------------------------
// The format
// ---------------------------------------------------------------------------

/**
 * The first four bytes, read as a little-endian uint32.
 *
 * On disk they are the characters `T B M H` — "TMB" for the game and "H"
 * for hydrography, which is why the mnemonic reads TMBH even though the
 * bytes in file order do not. Stated plainly because v0's comment said
 * `'TMBH'` next to the number and a reader checking the file with a hex
 * dump would find `TBMH` and think one of them was wrong.
 */
export const HYDRO_MAGIC = 0x484d4254;

/** The only version this decoder understands. A newer file must fail loudly. */
export const HYDRO_VERSION = 1;

/**
 * Bytes before the first record: magic (4), version (2), two bytes of
 * padding that keep the six counts 4-byte aligned, then six uint32
 * counts. The padding is real and is zero in the shipped file; it is
 * named here so that nobody "tightens" the header to 30 bytes and moves
 * every record.
 */
export const HYDRO_HEADER_BYTES = 32;

/** Bytes per record. The format has no delimiters; these strides ARE the layout. */
const RUN_BYTES = 16;
const POINT_BYTES = 16;
const LAKE_BYTES = 16;
const RING_BYTES = 8;
const VERT_BYTES = 8;

/**
 * The bake writes 0xFF for a run or lake it could not place on one of
 * the survey's 8 x 8 tiles. Named because 255 is also a perfectly good
 * tile index in a world with more than 64 of them, and a future reader
 * should not have to guess which this is. MEASURED: the shipped file has
 * none — every run and every lake is placed.
 */
export const NO_TILE = 255;

/**
 * One surveyed run of water: a reach from a source or a junction to the
 * next junction or to the sea.
 */
export interface Run {
  /** Its name where it has one — 264 runs share 171 names. Null otherwise. */
  readonly name: string | null;
  /** Strahler order: 1 is a headwater trickle, 5 is the Wailua. The far tier's LOD dial. */
  readonly order: number;
  /**
   * The survey's flag for a run CONNECTED to the sea — a reach on a
   * network that drains to the ocean. 140 of the 1,121 carry it.
   *
   * NOT "this reach's downstream end is the shoreline", which is what
   * v0's comment said. MEASURED against the shipped bytes: 87 of the 140
   * end exactly where another run begins, and only 16 end within 2 m of
   * mean sea level, so most of them are plainly not mouths. What the
   * flag tracks is connection — 11 of the 15 order-5 reaches and 64 of
   * the 104 order-4 carry it, against 20 of 564 order-1 — which is the
   * useful question anyway: can a fish, or a migrating ant, get from
   * here to salt water. `tests/worldHydro.test.ts` pins the distinction
   * so it cannot be re-documented as "the mouth" a third time.
   */
  readonly toOcean: boolean;
  /** The survey's own 8 x 8 tile, col * 8 + row, or `NO_TILE`. Carried, not used — see `indexHydro`. */
  readonly tile: number;
  /** First index into the point arrays, and how many points. */
  readonly firstPoint: number;
  readonly pointCount: number;
}

/** Standing water: a shoreline ring, any islands within it, and one level. */
export interface Lake {
  /** 64 of the 111 are named. */
  readonly name: string | null;
  /**
   * The surveyed waterline, world units above mean sea level. MEASURED
   * range across the 111: 175 to 99,639 units, so 1.75 m to 996 m.
   */
  readonly level: number;
  readonly tile: number;
  /** First index into the ring table. Ring 0 is the shore; the rest are holes. */
  readonly firstRing: number;
  readonly ringCount: number;
}

/**
 * The whole hydrography as one value. Parallel arrays rather than an
 * array of objects, because the far tier's job is to pour 49,665 points
 * into a vertex buffer and an object per point would be 49,665
 * allocations to walk once.
 */
export interface Hydro {
  readonly runs: readonly Run[];
  readonly lakes: readonly Lake[];
  /** Per point, world units. MEASURED extent: x -2,519,494..2,510,776, z -1,879,331..1,941,324. */
  readonly x: Int32Array;
  readonly z: Int32Array;
  /**
   * The water surface at this point, world units above mean sea level —
   * ALREADY MONOTONIC DOWNSTREAM, which the bake guaranteed and the test
   * re-checks over all 48,544 steps. Water that climbs a river is the
   * kind of thing that looks like a renderer bug for a week.
   */
  readonly level: Int32Array;
  /** Surveyed channel width, world units. MEASURED median 550 (5.5 m); see the header. */
  readonly width: Uint16Array;
  /** Ring table: the first vertex of ring r, and how many it has. */
  readonly ringFirstVert: Uint32Array;
  readonly ringVertCount: Uint32Array;
  /** Ring vertices, world units. */
  readonly vertX: Int32Array;
  readonly vertZ: Int32Array;
}

/**
 * Decode the hydrography. Throws on anything that is not exactly this
 * format rather than returning a plausible-looking wreck.
 *
 * THE ORDER OF THE CHECKS IS THE POINT. Length is verified from the
 * header's own counts BEFORE a single array is allocated, so a corrupt
 * count of four billion is a thrown error rather than an attempt to
 * reserve 68 GB. Then the ranges inside are checked, because a file of
 * the right length can still address points that do not exist.
 *
 * ENDIAN-SAFE WITHOUT AN ASSERTION, unlike `dem.ts`. Every field is read
 * through `DataView` with an explicit little-endian flag and copied into
 * a typed array element by element; nothing is ever a view onto the
 * caller's bytes. That costs a copy the DEM's decoder avoids, and buys a
 * decode that cannot be wrong on a big-endian machine and a caller whose
 * buffer is never edited underneath it.
 */
export function decodeHydro(buffer: ArrayBuffer): Hydro {
  if (buffer.byteLength < HYDRO_HEADER_BYTES) {
    throw new Error(`hydro: a header is ${HYDRO_HEADER_BYTES} bytes and this file is ${buffer.byteLength}`);
  }
  const head = new DataView(buffer);
  const magic = head.getUint32(0, true);
  if (magic !== HYDRO_MAGIC) {
    throw new Error(`hydro: not a TMBH file (magic 0x${magic.toString(16)}, expected 0x${HYDRO_MAGIC.toString(16)})`);
  }
  const version = head.getUint16(4, true);
  if (version !== HYDRO_VERSION) {
    throw new Error(`hydro: file version ${version}, this decoder reads ${HYDRO_VERSION}`);
  }

  const runCount = head.getUint32(8, true);
  const pointCount = head.getUint32(12, true);
  const lakeCount = head.getUint32(16, true);
  const ringCount = head.getUint32(20, true);
  const vertCount = head.getUint32(24, true);
  const nameBytes = head.getUint32(28, true);

  const runsAt = HYDRO_HEADER_BYTES;
  const pointsAt = runsAt + runCount * RUN_BYTES;
  const lakesAt = pointsAt + pointCount * POINT_BYTES;
  const ringsAt = lakesAt + lakeCount * LAKE_BYTES;
  const vertsAt = ringsAt + ringCount * RING_BYTES;
  const namesAt = vertsAt + vertCount * VERT_BYTES;
  const expected = namesAt + nameBytes;
  if (buffer.byteLength !== expected) {
    throw new Error(`hydro: file is ${buffer.byteLength} bytes, its own header describes ${expected}`);
  }

  // NAMES FIRST, because every record refers to one by ordinal and a
  // half-built name table is the kind of bug that shows up as a river
  // called "undefined" three weeks later. The blob is NUL-terminated per
  // entry, so the final split piece is the empty tail and is dropped.
  const names: string[] = nameBytes > 0
    ? new TextDecoder().decode(new Uint8Array(buffer, namesAt, nameBytes)).split('\0').slice(0, -1)
    : [];
  const nameOf = (id: number): string | null => {
    if (id < 0) return null;
    if (id >= names.length) throw new Error(`hydro: name ${id} of ${names.length} — the name table and the records disagree`);
    return names[id];
  };

  const runs: Run[] = [];
  for (let i = 0, at = runsAt; i < runCount; i++, at += RUN_BYTES) {
    const firstPoint = head.getUint32(at, true);
    const count = head.getUint32(at + 4, true);
    if (firstPoint + count > pointCount) {
      throw new Error(`hydro: run ${i} claims points ${firstPoint}..${firstPoint + count} of ${pointCount}`);
    }
    runs.push({
      firstPoint,
      pointCount: count,
      order: head.getUint8(at + 8),
      toOcean: head.getUint8(at + 9) === 1,
      tile: head.getUint8(at + 10),
      name: nameOf(head.getInt16(at + 12, true)),
    });
  }

  const x = new Int32Array(pointCount);
  const z = new Int32Array(pointCount);
  const level = new Int32Array(pointCount);
  const width = new Uint16Array(pointCount);
  for (let i = 0, at = pointsAt; i < pointCount; i++, at += POINT_BYTES) {
    x[i] = head.getInt32(at, true);
    z[i] = head.getInt32(at + 4, true);
    level[i] = head.getInt32(at + 8, true);
    width[i] = head.getUint16(at + 12, true);
  }

  const lakes: Lake[] = [];
  for (let i = 0, at = lakesAt; i < lakeCount; i++, at += LAKE_BYTES) {
    const firstRing = head.getUint32(at, true);
    const rings = head.getUint32(at + 4, true);
    if (firstRing + rings > ringCount) {
      throw new Error(`hydro: lake ${i} claims rings ${firstRing}..${firstRing + rings} of ${ringCount}`);
    }
    lakes.push({
      firstRing,
      ringCount: rings,
      level: head.getInt32(at + 8, true),
      tile: head.getUint8(at + 12),
      name: nameOf(head.getInt16(at + 14, true)),
    });
  }

  const ringFirstVert = new Uint32Array(ringCount);
  const ringVertCount = new Uint32Array(ringCount);
  for (let i = 0, at = ringsAt; i < ringCount; i++, at += RING_BYTES) {
    const first = head.getUint32(at, true);
    const count = head.getUint32(at + 4, true);
    if (first + count > vertCount) {
      throw new Error(`hydro: ring ${i} claims vertices ${first}..${first + count} of ${vertCount}`);
    }
    ringFirstVert[i] = first;
    ringVertCount[i] = count;
  }

  const vertX = new Int32Array(vertCount);
  const vertZ = new Int32Array(vertCount);
  for (let i = 0, at = vertsAt; i < vertCount; i++, at += VERT_BYTES) {
    vertX[i] = head.getInt32(at, true);
    vertZ[i] = head.getInt32(at + 4, true);
  }

  return { runs, lakes, x, z, level, width, ringFirstVert, ringVertCount, vertX, vertZ };
}

// ---------------------------------------------------------------------------
// Geometry, as world points
// ---------------------------------------------------------------------------

/**
 * A run's channel centreline, source end first.
 *
 * ALLOCATES ONE OBJECT PER POINT, so it is for the code that builds
 * something once — a ribbon mesh, a map overlay, a test. Per-frame code
 * reads `hydro.x` / `hydro.z` directly from `firstPoint`, which is the
 * whole reason the parallel arrays are public.
 */
export function runPolyline(hydro: Hydro, run: Run): WorldPoint[] {
  const out: WorldPoint[] = new Array(run.pointCount);
  for (let i = 0; i < run.pointCount; i++) {
    out[i] = world(hydro.x[run.firstPoint + i], hydro.z[run.firstPoint + i]);
  }
  return out;
}

/**
 * A lake's rings. The first is its shore; any that follow are islands
 * standing in it, and a renderer that ignores them fills the island in
 * with water.
 */
export function lakeRings(hydro: Hydro, lake: Lake): WorldPoint[][] {
  const rings: WorldPoint[][] = [];
  for (let r = lake.firstRing; r < lake.firstRing + lake.ringCount; r++) {
    const first = hydro.ringFirstVert[r];
    const count = hydro.ringVertCount[r];
    const ring: WorldPoint[] = new Array(count);
    for (let i = 0; i < count; i++) ring[i] = world(hydro.vertX[first + i], hydro.vertZ[first + i]);
    rings.push(ring);
  }
  return rings;
}

/**
 * The water surface along a run, one per point, monotonically falling.
 * A VIEW, not a copy — no allocation, and the arithmetic that picks the
 * slice happens once here rather than at every call site.
 */
export function runLevels(hydro: Hydro, run: Run): Int32Array {
  return hydro.level.subarray(run.firstPoint, run.firstPoint + run.pointCount);
}

/** The surveyed channel width along a run, one per point. A view, as above. */
export function runWidths(hydro: Hydro, run: Run): Uint16Array {
  return hydro.width.subarray(run.firstPoint, run.firstPoint + run.pointCount);
}

// ---------------------------------------------------------------------------
// Finding the water near a point
// ---------------------------------------------------------------------------

/**
 * The lookup grid: 64 cells a side over the whole island, so one cell is
 * 87,500 world units — 875 m.
 *
 * WHY NOT v0's 8 x 8. v0 bucketed by the survey's own terrain tile, which
 * is 7 km across. Kauaʻi's land is about 1,430 km², so an occupied 7 km
 * tile holds on the order of a hundred runs and "what is near me" hands
 * back most of a district. MEASURED at 64 a side: 3,221 (run, cell)
 * entries for 1,121 runs — under three cells per run, seventeen for the
 * longest — spread over roughly 1,900 occupied cells, so a cell holds
 * one or two runs and a query touches what it asked for.
 *
 * 64 rather than 32 or 128 because 5,600,000 / 64 = 87,500 exactly and
 * the cell edges nest inside the DEM's 8 x 8 tile grid (8 cells per tile),
 * so anything streaming by tile can take whole cells. 128 halves the cell
 * to 437 m and nearly doubles the entries to 5,367 for no query it
 * answers better at far-tier ranges.
 */
export const HYDRO_CELLS_ACROSS = 64;

/** One cell's width in world units: 5,600,000 / 64 = 87,500 = 875 m. */
export const HYDRO_CELL_SPAN = ISLAND_SPAN / HYDRO_CELLS_ACROSS;

const HYDRO_CELLS = HYDRO_CELLS_ACROSS * HYDRO_CELLS_ACROSS;

/**
 * Where the runs and lakes are, in a form that answers "near here"
 * without walking all 1,121.
 *
 * TWO SHAPES, TWO STRATEGIES, each chosen from a measured number, and
 * the mismatch between them is the whole reason this is not one loop:
 *
 *  - A RUN IS A DENSE POLYLINE. MEASURED: the bake resampled at about
 *    35 m, and the longest gap between consecutive points anywhere in the
 *    file is 3,501 units = 35.01 m. So bucketing a run by the cells its
 *    POINTS fall in is tight, and the only thing it can miss is a segment
 *    that clips the corner of a cell neither endpoint is in — which
 *    `runsNear` closes by padding its search by half the longest gap.
 *  - A LAKE IS A SPARSE RING AROUND A FILLED INTERIOR. MEASURED: the
 *    longest single ring edge is 70,303 units = 703 m, and the biggest
 *    lake's bounding box is 171,263 units = 1,713 m — both larger than a
 *    cell. Bucketing a lake by its vertices would leave a query standing
 *    in the middle of it finding nothing, which is the exact question a
 *    swimming ant asks. So a lake is bucketed by its BOUNDING BOX, which
 *    fills the interior. It costs nothing: 202 entries for 111 lakes.
 *
 * COMPRESSED SPARSE ROW, not a `Map<number, Run[]>`. v0 used the map, and
 * for 4,096 cells that is 4,096 objects plus an array each, rebuilt
 * whenever the hydrography reloads. Two flat typed arrays hold the same
 * thing with two allocations, and the query is a pair of index reads.
 */
export interface HydroIndex {
  /** The hydrography this index is FOR. Carried so a caller holds one object, not two that could be mismatched. */
  readonly hydro: Hydro;
  /** The longest gap between consecutive points on any run, world units. MEASURED: 3,501 (35.01 m). */
  readonly maxPointGap: number;
  /** CSR over cells: run entries for cell c are `runsByCell[runStart[c] .. runStart[c + 1]]`. */
  readonly runStart: Uint32Array;
  readonly runsByCell: Uint32Array;
  /** The same for lakes. */
  readonly lakeStart: Uint32Array;
  readonly lakesByCell: Uint32Array;
}

/**
 * Build the lookup grid. One pass to measure, two to fill, no state kept
 * anywhere but the value returned.
 */
export function indexHydro(hydro: Hydro): HydroIndex {
  const runs = buildCsr(HYDRO_CELLS, (emit) => {
    // A stamp per cell, holding the run that last claimed it, so a run
    // with forty points in one cell is entered once. Cheaper and less
    // fragile than sorting and de-duplicating afterwards.
    const stamp = new Int32Array(HYDRO_CELLS).fill(-1);
    for (let r = 0; r < hydro.runs.length; r++) {
      const run = hydro.runs[r];
      for (let p = run.firstPoint; p < run.firstPoint + run.pointCount; p++) {
        const cell = cellOf(hydro.x[p], hydro.z[p]);
        if (stamp[cell] === r) continue;
        stamp[cell] = r;
        emit(r, cell);
      }
    }
  });

  const lakes = buildCsr(HYDRO_CELLS, (emit) => {
    for (let l = 0; l < hydro.lakes.length; l++) {
      const lake = hydro.lakes[l];
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let r = lake.firstRing; r < lake.firstRing + lake.ringCount; r++) {
        const first = hydro.ringFirstVert[r];
        for (let v = first; v < first + hydro.ringVertCount[r]; v++) {
          if (hydro.vertX[v] < minX) minX = hydro.vertX[v];
          if (hydro.vertX[v] > maxX) maxX = hydro.vertX[v];
          if (hydro.vertZ[v] < minZ) minZ = hydro.vertZ[v];
          if (hydro.vertZ[v] > maxZ) maxZ = hydro.vertZ[v];
        }
      }
      // A lake with no rings has no place on the map. Skipped rather than
      // entered at cell 0, which is where an Infinity bounding box lands.
      if (!(minX <= maxX)) continue;
      const c0 = cellAxis(minX);
      const c1 = cellAxis(maxX);
      const r0 = cellAxis(minZ);
      const r1 = cellAxis(maxZ);
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) emit(l, row * HYDRO_CELLS_ACROSS + col);
      }
    }
  });

  return {
    hydro,
    maxPointGap: longestPointGap(hydro),
    runStart: runs.start,
    runsByCell: runs.items,
    lakeStart: lakes.start,
    lakesByCell: lakes.items,
  };
}

/**
 * The runs whose CHANNEL passes within `radius` of `at`, as indices into
 * `index.hydro.runs`, ascending.
 *
 * CONSERVATIVE AND COMPLETE, in that order of importance. It never
 * misses: the search rectangle is padded by half the longest gap between
 * consecutive points, so a run whose line passes within `radius` always
 * has a point inside the searched cells even when the nearest part of it
 * is the middle of a segment. It may include extra runs, because a cell
 * is 875 m and the test is cell overlap rather than distance. A caller
 * that needs the exact set measures the polylines it gets back — this is
 * the broad phase, and a broad phase that lies in the other direction is
 * a river that vanishes when you walk up to it.
 *
 * INDICES, NOT OBJECTS, because the index IS the run's identity: a far
 * tier caches the geometry it built by that number, and `index.hydro.runs[i]`
 * is one lookup away.
 *
 * IT ALLOCATES. Call it when the streaming window moves and hold the
 * result; do not call it per frame.
 */
export function runsNear(index: HydroIndex, at: WorldPoint, radius: number): number[] {
  return gather(index.runStart, index.runsByCell, at, radius + index.maxPointGap / 2);
}

/**
 * The lakes whose BOUNDING BOX comes within `radius` of `at`, ascending.
 * No padding: the boxes already fill their interiors, so a point in the
 * middle of a lake finds it. Conservative in the corners, as a box is.
 */
export function lakesNear(index: HydroIndex, at: WorldPoint, radius: number): number[] {
  return gather(index.lakeStart, index.lakesByCell, at, radius);
}

// ---------------------------------------------------------------------------
// The grid arithmetic
// ---------------------------------------------------------------------------

/** A world coordinate as an unclamped cell coordinate on one axis. */
function axisRaw(w: number): number {
  return Math.floor((w + ISLAND_HALF_SPAN) / HYDRO_CELL_SPAN);
}

/** The same, clamped into the grid. The island's own points are always inside it. */
function cellAxis(w: number): number {
  const i = axisRaw(w);
  return i < 0 ? 0 : i > HYDRO_CELLS_ACROSS - 1 ? HYDRO_CELLS_ACROSS - 1 : i;
}

function cellOf(x: number, z: number): number {
  return cellAxis(z) * HYDRO_CELLS_ACROSS + cellAxis(x);
}

/**
 * Every distinct item in the cells a square of half-width `reach` around
 * `at` touches, ascending.
 *
 * SORTED, so the answer depends only on which items are near and not on
 * the shape of the rectangle that found them. Two devices, or the same
 * device before and after a re-centre, get the same list in the same
 * order — which is what makes it safe to key a cache on.
 *
 * OFF THE GRID IS EMPTY, not clamped. Clamping first would answer a query
 * a hundred kilometres out to sea with the contents of the edge column.
 */
function gather(start: Uint32Array, items: Uint32Array, at: WorldPoint, reach: number): number[] {
  const r = reach > 0 ? reach : 0;
  const c0 = axisRaw(at.wx - r);
  const c1 = axisRaw(at.wx + r);
  const r0 = axisRaw(at.wz - r);
  const r1 = axisRaw(at.wz + r);
  const last = HYDRO_CELLS_ACROSS - 1;
  if (c1 < 0 || c0 > last || r1 < 0 || r0 > last) return [];
  const found: number[] = [];
  const seen = new Set<number>();
  for (let row = Math.max(0, r0); row <= Math.min(last, r1); row++) {
    for (let col = Math.max(0, c0); col <= Math.min(last, c1); col++) {
      const cell = row * HYDRO_CELLS_ACROSS + col;
      for (let k = start[cell]; k < start[cell + 1]; k++) {
        const id = items[k];
        if (seen.has(id)) continue;
        seen.add(id);
        found.push(id);
      }
    }
  }
  return found.sort((a, b) => a - b);
}

/**
 * The longest gap between consecutive points on any run, world units.
 *
 * MEASURED FROM THE DATA rather than written down as a constant, because
 * it is a property of whatever the bake produced. A future re-bake at a
 * coarser spacing would silently invalidate a hardcoded 3,501 and start
 * dropping runs from queries; measuring it means the padding follows the
 * file. One pass over 49,665 points, once, when the index is built.
 */
function longestPointGap(hydro: Hydro): number {
  let worst = 0;
  for (const run of hydro.runs) {
    for (let p = run.firstPoint + 1; p < run.firstPoint + run.pointCount; p++) {
      const dx = hydro.x[p] - hydro.x[p - 1];
      const dz = hydro.z[p] - hydro.z[p - 1];
      const d = dx * dx + dz * dz;
      if (d > worst) worst = d;
    }
  }
  return Math.sqrt(worst);
}

/**
 * Build a compressed-sparse-row bucket table by running the caller's
 * enumeration twice: once to count per cell, once to place.
 *
 * Twice rather than once into growable arrays because the second pass is
 * cheap next to allocating 4,096 arrays that mostly stay empty, and
 * because the result is two flat typed arrays a query can walk without
 * chasing a pointer.
 */
function buildCsr(
  cells: number,
  visit: (emit: (item: number, cell: number) => void) => void,
): { start: Uint32Array; items: Uint32Array } {
  const start = new Uint32Array(cells + 1);
  let total = 0;
  visit((_item, cell) => {
    start[cell + 1] += 1;
    total += 1;
  });
  for (let c = 0; c < cells; c++) start[c + 1] += start[c];
  const items = new Uint32Array(total);
  // A cursor per cell, so the fill pass does not disturb `start`.
  const cursor = start.slice(0, cells);
  visit((item, cell) => {
    items[cursor[cell]] = item;
    cursor[cell] += 1;
  });
  return { start, items };
}
