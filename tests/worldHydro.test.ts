/**
 * THE SURVEY, CHECKED AGAINST THE BYTES WE ACTUALLY SHIP.
 *
 * Not a fixture and not a mock: this reads `public/kauai-hydro.bin`, all
 * 839,071 bytes of it, off disk. A hydrography decoder that agrees with a
 * synthetic buffer and disagrees with the survey is worth nothing, and
 * the survey is sitting right there — which it can be, because the module
 * is pure and this runs under plain node.
 *
 * What it pins, and why each one would be a bad day:
 *
 *  - THE COUNTS ARE THE FILE. 1,121 runs, 49,665 points, 111 lakes, 117
 *    rings, 2,605 vertices. A decoder that reads the header right and the
 *    strides wrong still produces the right NUMBER of records, so the
 *    counts alone are not enough — the geography below is what proves the
 *    fields landed in the right places.
 *  - EVERY POINT IS ON THE ISLAND. A stride or endianness mistake turns
 *    coordinates into astronomical numbers, and the far tier would draw a
 *    river to the horizon rather than throw.
 *  - LEVELS FALL DOWNSTREAM. The format promises it and the bake
 *    guaranteed it; if it stops being true, water climbs a hill and it
 *    looks like a renderer bug for a week.
 *  - CORRUPTION THROWS. A truncated download, a wrong magic, a future
 *    version and — the one v0 could not catch — a file of exactly the
 *    right length whose records address points that do not exist.
 *  - THE NAMES ARE KAUAʻI'S. Hanalei and Wailua are the cheapest possible
 *    proof that the name table is aligned with the records rather than
 *    merely non-empty: an off-by-one in the ordinals still yields names.
 *  - THE LOOKUP NEVER MISSES. `runsNear` is a broad phase, and a broad
 *    phase that loses a river the player is standing next to is worse
 *    than no broad phase at all. The midpoint test below is the one that
 *    would fail if the segment-gap padding were dropped.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ISLAND_SPAN, distance, world } from '../src/world/coords';
import { ISLAND_HALF_SPAN } from '../src/world/dem';
import {
  HYDRO_CELLS_ACROSS, HYDRO_CELL_SPAN, HYDRO_HEADER_BYTES, HYDRO_MAGIC, HYDRO_VERSION, NO_TILE,
  decodeHydro, indexHydro, lakeRings, lakesNear, runLevels, runPolyline, runWidths, runsNear,
  type Hydro,
} from '../src/world/water/hydro';

/**
 * `process.cwd()` is the repo root under vitest, and it is the portable
 * form — `tests/noMachinePaths.test.ts` forbids naming a checkout
 * directory, having watched one pass locally and fail on the CI runner.
 */
const HYDRO_PATH = path.join(process.cwd(), 'public', 'kauai-hydro.bin');

/** The shipped bytes, as an ArrayBuffer exactly the length of the file. */
function readHydroBytes(): ArrayBuffer {
  const bytes = readFileSync(HYDRO_PATH);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const bytes = readHydroBytes();
const hydro: Hydro = decodeHydro(bytes);
const index = indexHydro(hydro);

/** The shipped file's length. The size is not the format, but it is a fact. */
const FILE_BYTES = 839_071;

/** A fresh copy with one field overwritten, for the corruption tests. */
function corrupted(edit: (view: DataView) => void): ArrayBuffer {
  const copy = bytes.slice(0);
  edit(new DataView(copy));
  return copy;
}

describe('the file is the survey we think it is', () => {
  it('is the shipped size and decodes to the real counts', () => {
    // If any of these move, the asset was re-baked and every number in
    // this file — and in hydro.ts's header — is describing an older one.
    expect(bytes.byteLength).toBe(FILE_BYTES);
    expect(hydro.runs.length).toBe(1121);
    expect(hydro.x.length).toBe(49_665);
    expect(hydro.z.length).toBe(49_665);
    expect(hydro.level.length).toBe(49_665);
    expect(hydro.width.length).toBe(49_665);
    expect(hydro.lakes.length).toBe(111);
    expect(hydro.ringFirstVert.length).toBe(117);
    expect(hydro.ringVertCount.length).toBe(117);
    expect(hydro.vertX.length).toBe(2605);
    expect(hydro.vertZ.length).toBe(2605);
  });

  it('has the header constants the format documents', () => {
    const head = new DataView(bytes);
    expect(head.getUint32(0, true)).toBe(HYDRO_MAGIC);
    expect(head.getUint16(4, true)).toBe(HYDRO_VERSION);
    // The two bytes after the version are padding that keeps the counts
    // aligned. Zero in the shipped file; if they ever mean something, the
    // header stops being 32 bytes of nothing-but-counts.
    expect(head.getUint16(6, true)).toBe(0);
    expect(HYDRO_HEADER_BYTES).toBe(32);
  });

  it('accounts for every point, ring and vertex exactly once', () => {
    // Gaps or overlaps here mean the runs and the point array disagree,
    // and a renderer would draw one reach with another's geometry.
    let point = 0;
    for (const run of hydro.runs) {
      expect(run.firstPoint).toBe(point);
      point += run.pointCount;
    }
    expect(point).toBe(hydro.x.length);

    let ring = 0;
    for (const lake of hydro.lakes) {
      expect(lake.firstRing).toBe(ring);
      ring += lake.ringCount;
    }
    expect(ring).toBe(hydro.ringFirstVert.length);

    let vert = 0;
    for (let r = 0; r < hydro.ringFirstVert.length; r++) {
      expect(hydro.ringFirstVert[r]).toBe(vert);
      vert += hydro.ringVertCount[r];
    }
    expect(vert).toBe(hydro.vertX.length);
  });

  it('does not edit the buffer it was handed', () => {
    // v0's DEM decoder returned a view and then repaired through it, so
    // the bytes the network delivered were quietly rewritten. A decode
    // copies; the caller keeps what it gave.
    const before = Buffer.from(bytes.slice(0));
    decodeHydro(bytes);
    // Buffer.compare rather than a deep-equal over 839,071 elements:
    // vitest's matcher takes two seconds on it and says the same thing.
    expect(Buffer.from(bytes).equals(before)).toBe(true);
  });
});

describe('the topology the survey came with', () => {
  it('carries Strahler order 1 to 5, in the measured proportions', () => {
    // Order is the far tier's LOD dial. If the byte moved, the dial would
    // still "work" and would be hiding the wrong 853 runs.
    const histogram = [0, 0, 0, 0, 0, 0];
    for (const run of hydro.runs) histogram[run.order] += 1;
    expect(histogram).toEqual([0, 564, 289, 149, 104, 15]);
  });

  it('marks 140 runs as connected to the sea, weighted to the big ones', () => {
    const toOcean = hydro.runs.filter((r) => r.toOcean);
    expect(toOcean.length).toBe(140);
    // MEASURED per order. Connection to the sea is not evenly spread —
    // 11 of the 15 order-5 reaches carry it and 20 of 564 order-1 do —
    // which is what a flag about NETWORKS should look like. A flag read
    // from the wrong byte would be spread flat across the orders.
    const histogram = [0, 0, 0, 0, 0, 0];
    for (const run of toOcean) histogram[run.order] += 1;
    expect(histogram).toEqual([0, 20, 14, 31, 64, 11]);
  });

  it('does NOT mean the run ends at the shoreline, whatever v0 said', () => {
    // The correction, pinned so it cannot be lost again. v0 documented
    // `toOcean` as "ends in the sea rather than in another run"; the
    // bytes disagree, and a far tier that trusted the sentence would draw
    // a river mouth a kilometre up a valley.
    const startsAt = new Set(hydro.runs.map((r) => `${hydro.x[r.firstPoint]},${hydro.z[r.firstPoint]}`));
    const endsAtAnotherStart = hydro.runs.filter((run) => {
      const last = run.firstPoint + run.pointCount - 1;
      return run.toOcean && startsAt.has(`${hydro.x[last]},${hydro.z[last]}`);
    });
    expect(endsAtAnotherStart.length).toBe(87);
    // And their downstream ends stand well above the tide: the median
    // sea-connected run finishes 25 m up.
    const ends = hydro.runs.filter((r) => r.toOcean)
      .map((r) => hydro.level[r.firstPoint + r.pointCount - 1]).sort((a, b) => a - b);
    expect(ends[ends.length >> 1]).toBeGreaterThan(1000);
  });

  it('places every run and lake on a tile', () => {
    // The bake writes NO_TILE where it could not place one. It never did
    // here; if a re-bake starts to, whoever streams by tile has to decide
    // what to do about it rather than silently lose the reach.
    for (const run of hydro.runs) expect(run.tile).not.toBe(NO_TILE);
    for (const lake of hydro.lakes) expect(lake.tile).not.toBe(NO_TILE);
  });

  it('names 264 runs and 64 lakes, and the names belong to Kauaʻi', () => {
    const named = hydro.runs.filter((r) => r.name !== null);
    expect(named.length).toBe(264);
    expect(hydro.lakes.filter((l) => l.name !== null).length).toBe(64);
    const names = new Set(named.map((r) => r.name));
    // Real rivers, not merely non-empty strings: an off-by-one in the
    // name ordinals still hands back plausible names, and only a name
    // that has to belong to a particular reach catches it.
    expect(names.has('Hanalei River')).toBe(true);
    expect(names.has('North Fork Wailua River')).toBe(true);
    expect(names.has('Anahola Stream')).toBe(true);
    expect(hydro.lakes.some((l) => l.name === 'Wailua Reservoir')).toBe(true);
  });

  it('puts the Hanalei on the north shore and the Wailua on the east', () => {
    // The one assertion that ties a NAME to a PLACE. Kauaʻi's north coast
    // is -wz and its east coast +wx (dem.ts: +wx east, +wz south), so a
    // name table shifted by one row would put the Hanalei in the wrong
    // quarter of the island and nothing else here would notice.
    const middle = (name: string): { wx: number; wz: number } => {
      const run = hydro.runs.find((r) => r.name === name);
      if (run === undefined) throw new Error(`${name} is missing`);
      const line = runPolyline(hydro, run);
      const mid = line[line.length >> 1];
      return { wx: mid.wx, wz: mid.wz };
    };
    expect(middle('Hanalei River').wz).toBeLessThan(0);
    expect(middle('North Fork Wailua River').wx).toBeGreaterThan(0);
  });
});

describe('the geometry is on the island', () => {
  it('keeps every river point and ring vertex inside the survey', () => {
    // A stride or endianness mistake produces astronomical coordinates,
    // and the far tier would draw a river to the horizon rather than
    // throw. MEASURED extent is well inside: x -2,519,494..2,510,776.
    // Offenders collected and asserted empty, rather than 150,000 matcher
    // calls: same coverage, a fifth of a second, and a failure names the
    // point instead of only the first one.
    const off: string[] = [];
    for (let i = 0; i < hydro.x.length; i++) {
      if (Math.abs(hydro.x[i]) > ISLAND_HALF_SPAN || Math.abs(hydro.z[i]) > ISLAND_HALF_SPAN) {
        off.push(`point ${i} at ${hydro.x[i]}, ${hydro.z[i]}`);
      }
    }
    for (let i = 0; i < hydro.vertX.length; i++) {
      if (Math.abs(hydro.vertX[i]) > ISLAND_HALF_SPAN || Math.abs(hydro.vertZ[i]) > ISLAND_HALF_SPAN) {
        off.push(`vertex ${i} at ${hydro.vertX[i]}, ${hydro.vertZ[i]}`);
      }
    }
    expect(off).toEqual([]);
    expect(ISLAND_HALF_SPAN).toBe(ISLAND_SPAN / 2);
  });

  it('keeps every level and width inside what Kauaʻi can hold', () => {
    // Kawaikini is 1,598 m = 159,800 units, so no waterline may stand
    // above it; a river mouth may sit a little under mean sea level,
    // which is what the -120 floor is. Widths are metres of channel, not
    // kilometres: MEASURED 250 to 3,620 units, 2.5 m to 36.2 m.
    const off: string[] = [];
    for (let i = 0; i < hydro.level.length; i++) {
      if (hydro.level[i] <= -1000 || hydro.level[i] >= 159_800) off.push(`level ${i} = ${hydro.level[i]}`);
      if (hydro.width[i] <= 0 || hydro.width[i] >= 10_000) off.push(`width ${i} = ${hydro.width[i]}`);
    }
    expect(off).toEqual([]);
    for (const lake of hydro.lakes) {
      expect(lake.level).toBeGreaterThan(0);
      expect(lake.level).toBeLessThan(159_800);
    }
  });

  it('never lets a run climb: levels fall downstream, all 48,544 steps', () => {
    // The format's own promise. Water that runs uphill would be blamed on
    // the renderer, on the solver, and on the terrain, in that order,
    // before anyone suspected the file.
    let steps = 0;
    const climbs: string[] = [];
    for (let r = 0; r < hydro.runs.length; r++) {
      const levels = runLevels(hydro, hydro.runs[r]);
      for (let i = 1; i < levels.length; i++) {
        if (levels[i] > levels[i - 1]) climbs.push(`run ${r} step ${i}: ${levels[i - 1]} -> ${levels[i]}`);
        steps += 1;
      }
    }
    expect(climbs).toEqual([]);
    expect(steps).toBe(48_544);
  });

  it('hands out polylines and rings as world points that match the arrays', () => {
    // The branded WorldPoint is the whole reason this module has a public
    // surface rather than exposing the arrays alone: a bare {wx, wz} is
    // not a WorldPoint, so a renderer cannot invent one from a rendered
    // coordinate and pass it back in.
    const run = hydro.runs.find((r) => r.name === 'Hanalei River');
    if (run === undefined) throw new Error('the Hanalei is missing');
    const line = runPolyline(hydro, run);
    expect(line.length).toBe(run.pointCount);
    expect(line[0].wx).toBe(hydro.x[run.firstPoint]);
    expect(line[0].wz).toBe(hydro.z[run.firstPoint]);
    const last = run.firstPoint + run.pointCount - 1;
    expect(line[line.length - 1].wx).toBe(hydro.x[last]);
    expect(line[line.length - 1].wz).toBe(hydro.z[last]);
    expect(runWidths(hydro, run).length).toBe(run.pointCount);

    const multi = hydro.lakes.find((l) => l.ringCount > 1);
    if (multi === undefined) throw new Error('no lake with an island in it');
    const rings = lakeRings(hydro, multi);
    expect(rings.length).toBe(multi.ringCount);
    // Ring 0 is the shore; the rest stand inside it. If a renderer drew
    // them all the same way it would fill the islands in with water, so
    // the shore has to be the longest.
    for (let r = 1; r < rings.length; r++) expect(rings[0].length).toBeGreaterThan(rings[r].length);
    expect(rings[0][0].wx).toBe(hydro.vertX[hydro.ringFirstVert[multi.firstRing]]);
  });
});

describe('a corrupt file throws instead of decoding into nonsense', () => {
  it('refuses a buffer too short to hold a header', () => {
    expect(() => decodeHydro(bytes.slice(0, 16))).toThrow(/header/);
  });

  it('refuses a truncated download', () => {
    // The commonest real failure, and the one the length check exists
    // for: a connection dropped halfway through 839 KB.
    expect(() => decodeHydro(bytes.slice(0, FILE_BYTES - 1))).toThrow(/bytes/);
    expect(() => decodeHydro(bytes.slice(0, HYDRO_HEADER_BYTES + 4000))).toThrow(/bytes/);
  });

  it('refuses another format wearing the right extension', () => {
    expect(() => decodeHydro(corrupted((v) => v.setUint32(0, 0x12345678, true)))).toThrow(/TMBH/);
  });

  it('refuses a future version rather than guessing at it', () => {
    expect(() => decodeHydro(corrupted((v) => v.setUint16(4, 2, true)))).toThrow(/version/);
  });

  it('refuses a header whose counts do not add up to the file', () => {
    // One flipped byte in a count. The bytes are all still there, so only
    // the arithmetic catches it.
    expect(() => decodeHydro(corrupted((v) => v.setUint32(12, 49_666, true)))).toThrow(/bytes/);
  });

  it('refuses a record that addresses points outside the point array', () => {
    // THE ONE v0 COULD NOT CATCH. The file is exactly the right length —
    // only run 0's point count changed — and v0 would have decoded it,
    // then read zeros off the end of the array and drawn a river through
    // the middle of the Pacific with nothing to say why.
    expect(() => decodeHydro(corrupted((v) => v.setUint32(HYDRO_HEADER_BYTES + 4, 1_000_000, true))))
      .toThrow(/run 0 claims points/);
  });

  it('refuses a lake or ring that addresses geometry that is not there', () => {
    const lakesAt = HYDRO_HEADER_BYTES + 1121 * 16 + 49_665 * 16;
    expect(() => decodeHydro(corrupted((v) => v.setUint32(lakesAt + 4, 500, true))))
      .toThrow(/lake 0 claims rings/);
    const ringsAt = lakesAt + 111 * 16;
    expect(() => decodeHydro(corrupted((v) => v.setUint32(ringsAt + 4, 99_999, true))))
      .toThrow(/ring 0 claims vertices/);
  });

  it('refuses a name ordinal the name table does not have', () => {
    // Run 0 is unnamed (-1). Pointing it at name 9,999 is what a shifted
    // or truncated name blob looks like; v0 answered null and carried on.
    expect(() => decodeHydro(corrupted((v) => v.setInt16(HYDRO_HEADER_BYTES + 12, 9999, true))))
      .toThrow(/name 9999/);
  });
});

describe('finding the water near a point', () => {
  it('lays 64 cells of 875 m across the island', () => {
    expect(HYDRO_CELLS_ACROSS).toBe(64);
    expect(HYDRO_CELL_SPAN).toBe(87_500);
    // The cells nest inside the DEM's 8 x 8 tiles, 8 per tile: anything
    // streaming by tile can take whole cells.
    expect((ISLAND_SPAN / 8) % HYDRO_CELL_SPAN).toBe(0);
  });

  it('measures the point spacing from the file rather than trusting a constant', () => {
    // MEASURED: 3,501.21 units = 35.01 m. Written down as a constant it
    // would silently go stale on a re-bake and `runsNear` would quietly
    // start missing runs, which is a bug that looks like a renderer bug.
    expect(index.maxPointGap).toBeCloseTo(3501.21, 1);
  });

  it('buckets tightly: about three cells per run, and a bounding box per lake', () => {
    // MEASURED. If these grow by an order of magnitude the index is being
    // built wrong — a run entered once per POINT rather than per cell, say
    // — and every query pays for it.
    expect(index.runsByCell.length).toBe(3221);
    expect(index.lakesByCell.length).toBe(202);
    expect(index.runStart.length).toBe(64 * 64 + 1);
    expect(index.runStart[0]).toBe(0);
    expect(index.runStart[index.runStart.length - 1]).toBe(index.runsByCell.length);
    for (let c = 1; c < index.runStart.length; c++) expect(index.runStart[c]).toBeGreaterThanOrEqual(index.runStart[c - 1]);
    expect(index.lakeStart[index.lakeStart.length - 1]).toBe(index.lakesByCell.length);
    expect(index.hydro).toBe(hydro);
  });

  it('finds the run under your feet, from any of its own points', () => {
    // The basic promise. Every twentieth run, at its middle point, with
    // no radius at all.
    for (let r = 0; r < hydro.runs.length; r += 20) {
      const run = hydro.runs[r];
      const p = run.firstPoint + (run.pointCount >> 1);
      expect(runsNear(index, world(hydro.x[p], hydro.z[p]), 0)).toContain(r);
    }
  });

  it('finds a run from the MIDDLE OF A SEGMENT, where it has no point at all', () => {
    // THE ASSERTION THAT WOULD FAIL if the half-gap padding were dropped
    // as "an unnecessary fudge". Points are 35 m apart, cells are 875 m,
    // so a query standing between two points of a run can fall in a cell
    // the run was never entered into — and the river the player is wading
    // in would not be in the list.
    let checked = 0;
    for (let r = 0; r < hydro.runs.length; r += 7) {
      const run = hydro.runs[r];
      if (run.pointCount < 2) continue;
      const p = run.firstPoint + (run.pointCount >> 1);
      const mid = world((hydro.x[p] + hydro.x[p - 1]) / 2, (hydro.z[p] + hydro.z[p - 1]) / 2);
      expect(runsNear(index, mid, 0)).toContain(r);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('finds a lake from the middle of it, not only from its shore', () => {
    // Lakes are bucketed by bounding box for exactly this: the biggest is
    // 1,713 m across and its ring edges run up to 703 m, so a vertex
    // bucket would leave a swimmer in open water finding nothing.
    for (let l = 0; l < hydro.lakes.length; l++) {
      const rings = lakeRings(hydro, hydro.lakes[l]);
      const shore = rings[0];
      let sx = 0;
      let sz = 0;
      for (const v of shore) {
        sx += v.wx;
        sz += v.wz;
      }
      expect(lakesNear(index, world(sx / shore.length, sz / shore.length), 0)).toContain(l);
    }
  });

  it('answers a radius query with everything inside it, and not the whole island', () => {
    const at = world(hydro.x[0], hydro.z[0]);
    const radius = 200_000; // 2 km
    const near = runsNear(index, at, radius);
    // COMPLETE: every run with a point inside the radius is in the list.
    const truth: number[] = [];
    for (let r = 0; r < hydro.runs.length; r++) {
      const run = hydro.runs[r];
      for (let p = run.firstPoint; p < run.firstPoint + run.pointCount; p++) {
        if (distance(at, world(hydro.x[p], hydro.z[p])) <= radius) {
          truth.push(r);
          break;
        }
      }
    }
    for (const r of truth) expect(near).toContain(r);
    // CONSERVATIVE, but not uselessly so: a 2 km query must not return
    // most of a 1,121-run island, or the broad phase has saved nothing.
    expect(truth.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThan(hydro.runs.length / 4);
  });

  it('returns ascending, duplicate-free ids, so a cache can key on them', () => {
    // The scan order depends on the query rectangle; the ANSWER must not,
    // or the same place produces two different lists and a far-tier cache
    // rebuilds geometry it already had.
    const near = runsNear(index, world(hydro.x[20_000], hydro.z[20_000]), 500_000);
    expect(near.length).toBeGreaterThan(1);
    expect([...new Set(near)].length).toBe(near.length);
    expect([...near].sort((a, b) => a - b)).toEqual(near);
  });

  it('says nothing is near a point that is not near the island', () => {
    // Clamping the cell coordinates instead of rejecting would answer a
    // query far out to sea with the contents of the edge column — rivers
    // 100 km away, drawn on the horizon.
    const offshore = world(ISLAND_SPAN, ISLAND_SPAN);
    expect(runsNear(index, offshore, 100_000)).toEqual([]);
    expect(lakesNear(index, offshore, 100_000)).toEqual([]);
    // And a radius big enough to reach back does find something, so the
    // emptiness above is the geometry and not a broken query.
    expect(runsNear(index, offshore, ISLAND_SPAN).length).toBeGreaterThan(0);
  });

  it('costs a fraction of walking all 1,121 runs', () => {
    // The reason the index exists. A far-tier re-centre asks this on
    // every window move; if it were not cheaper than the linear scan it
    // is replacing, it would just be more code.
    const at = world(hydro.x[10_000], hydro.z[10_000]);
    expect(runsNear(index, at, 100_000).length).toBeLessThan(60);
  });
});
