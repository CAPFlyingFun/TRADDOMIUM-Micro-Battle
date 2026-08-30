/**
 * THE ISLAND HAS NO HOLES IN IT.
 *
 * The DEM shipped with samples hundreds of metres below sea level
 * sitting inside dry land, and because the water query calls any
 * ground below zero THE SEA, each one became a flooded shaft in a
 * beach — 27 m across, 200 m deep, reading SALTWATER on sand. These
 * are the tests that say the repair takes them out and takes nothing
 * else.
 *
 * The rule under test is a fact about the island rather than a
 * threshold: Hawaiʻi has no dry land below sea level, so a
 * below-sea-level sample the open ocean cannot reach is not a place on
 * Kauaʻi. Everything here is either "that defect is gone" or "that
 * real thing is untouched".
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  NODATA, enclosedWater, forgetOceanMask, islandLink, repairCoarse,
  repairFineTile, wet,
} from '../src/world/demRepair';
import { HD_TILE, HD_TILES, hdTileIndex } from '../src/world/kauaiHd';
import { SAMPLES } from '../src/world/kauai';

const T = HD_TILE;
const STEP = (HD_TILE - 1) * HD_TILES / (SAMPLES - 1);

/** The shipped island grid, fresh off disk each time. */
const rawIsland = (): Int16Array => {
  const buf = readFileSync('public/kauai-1025.bin');
  return new Int16Array(buf.buffer.slice(
    buf.byteOffset, buf.byteOffset + SAMPLES * SAMPLES * 2,
  ));
};
/** One shipped tile, fresh off disk each time. */
const rawTile = (name: string): Int16Array => {
  const buf = readFileSync(`public/kauai-hd/${name}.bin`);
  return new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + T * T * 2));
};
const nameToIndex = (name: string): number =>
  hdTileIndex('ABCDEFGH'.indexOf(name[0]), Number(name[1]) - 1);

/** Repair a tile the way the game does: island first, then the tile. */
function repaired(name: string): { before: Int16Array; after: Int16Array } {
  const island = rawIsland();
  repairCoarse(island, SAMPLES);
  const before = rawTile(name);
  const after = rawTile(name);
  repairFineTile(after, T, ...tileColRow(name), islandLink(STEP));
  return { before, after };
}
function tileColRow(name: string): [number, number] {
  const index = nameToIndex(name);
  return [Math.floor(index / HD_TILES), index % HD_TILES];
}

/**
 * COUNT, THEN ASSERT ONCE.
 *
 * These sweeps compare hundreds of thousands of samples, and an
 * `expect` per sample is an assertion per sample — a million of them
 * took 4.8 s locally against vitest's 5 s default, passed, and then
 * timed out on the CI runner, which failed the deploy and left the
 * holes on Joshua's phone for a version. So the loops count and report
 * the first offender, and the assertion happens once.
 */
function sameEverywhere(
  a: Int16Array, b: Int16Array, keep: (i: number) => boolean,
): { checked: number; first: string | null; wrong: number } {
  let checked = 0;
  let wrong = 0;
  let first: string | null = null;
  for (let i = 0; i < a.length; i++) {
    if (!keep(i)) continue;
    checked++;
    if (a[i] === b[i]) continue;
    wrong++;
    first ??= `sample ${i}: ${a[i]} became ${b[i]}`;
  }
  return { checked, first, wrong };
}

afterEach(() => forgetOceanMask());

describe('the shape of the defect, on a hand-made island', () => {
  // Eight by eight: ocean down the left, land to the right, and three
  // things that must be told apart. Values are decimetres, as the DEM
  // stores them.
  const build = (): Int16Array => {
    const n = 8;
    const a = new Int16Array(n * n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) a[r * n + c] = c < 2 ? -200 : 100;
    }
    a[3 * 8 + 5] = -2108;          // a pit, enclosed by land
    a[5 * 8 + 1] = -900;           // deeper open sea — legitimate
    a[6 * 8 + 5] = NODATA;         // a void inland
    a[2 * 8 + 2] = -30;            // a shoreline sample, touching the sea
    return a;
  };

  it('finds only what the sea cannot reach', () => {
    const a = build();
    const bad = enclosedWater(a, 8, (i) => i % 8 === 0);
    expect(bad[3 * 8 + 5]).toBe(1);            // the pit
    expect(bad[6 * 8 + 5]).toBe(1);            // the void
    expect(bad[5 * 8 + 1]).toBe(0);            // open sea
    expect(bad[2 * 8 + 2]).toBe(0);            // shoreline, connected
  });

  it('fills them from the ground around, not with a flat plug or a zero', () => {
    const a = build();
    repairCoarse(a, 8);
    expect(a[3 * 8 + 5]).toBe(100);            // the rim's own height
    expect(a[6 * 8 + 5]).toBe(100);
    expect(a[3 * 8 + 5]).not.toBe(0);          // NOT clamped to sea level
    expect(a[5 * 8 + 1]).toBe(-900);           // sea untouched
    expect(a[2 * 8 + 2]).toBe(-30);            // shoreline untouched
  });

  it('does not leak between land samples that merely touch corners', () => {
    // Four-connected: a diagonal gap is not a channel the sea can use.
    const n = 6;
    const a = new Int16Array(n * n).fill(100);
    for (let r = 0; r < n; r++) a[r * n] = -200;      // ocean column
    a[2 * n + 2] = -50;                                // pit
    a[1 * n + 1] = -50; a[3 * n + 3] = -50;            // diagonal neighbours
    const bad = enclosedWater(a, n, (i) => i % n === 0);
    expect(bad[2 * n + 2]).toBe(1);
    expect(bad[3 * n + 3]).toBe(1);
    expect(bad[1 * n + 1]).toBe(0);                    // touches the ocean column
  });
});

describe('the pit from the screenshots', () => {
  // Tile E2, sample 310,230: a 2×2 block at −685 and −2108 decimetres
  // ringed by beach at +27 to +65. This is the one she fell into, and
  // the one the HUD called SALTWATER.
  let before: Int16Array;
  let after: Int16Array;
  beforeAll(() => { ({ before, after } = repaired('E2')); }, 120000);

  it('was really there', () => {
    expect(before[230 * T + 310]).toBe(-685);
    expect(before[230 * T + 311]).toBe(-2108);
    expect(before[231 * T + 310]).toBe(-681);
    expect(before[231 * T + 311]).toBe(-2061);
  });

  it('is gone, and is beach again', () => {
    for (const [c, r] of [[310, 230], [311, 230], [310, 231], [311, 231]]) {
      const v = after[r * T + c];
      expect(v).toBeGreaterThan(0);          // no longer the sea
      expect(v).toBeLessThan(200);           // and no spike either
    }
  });

  it('carries no step at the join', () => {
    // The rim is untouched and the fill meets it, so nothing around
    // the old hole may differ from its neighbours by more than the
    // beach already did.
    for (let r = 228; r <= 233; r++) {
      for (let c = 308; c <= 313; c++) {
        const v = after[r * T + c];
        for (const [dc, dr] of [[1, 0], [0, 1]]) {
          const w = after[(r + dr) * T + (c + dc)];
          expect(Math.abs(v - w)).toBeLessThan(300);   // < 30 m per 13.67 m
        }
      }
    }
  });

  it('leaves everything outside the hole byte-identical', () => {
    let moved = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) moved++;
    // Only the enclosed samples in this tile, and nothing else.
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(400);
    for (let i = 0; i < before.length; i++) {
      if (before[i] === after[i]) continue;
      expect(wet(before[i])).toBe(true);     // every change was water or void
    }
  });
});

describe('the worst defects in the shipped data', () => {
  /**
   * THE DETECTOR THAT FOUND THE BUG, kept as the independent check.
   * Nothing to do with the repair's own connectivity rule: a sample
   * below sea level, mostly ringed by land, more than 10 m under its
   * own rim. This is what surveyed 1,104 pits in the shipped tiles.
   */
  const pits = (a: Int16Array, n: number): number => {
    let found = 0;
    for (let r = 1; r < n - 1; r++) {
      for (let c = 1; c < n - 1; c++) {
        const v = a[r * n + c];
        if (v === NODATA) { found++; continue; }
        if (v >= 0) continue;
        let land = 0;
        let rim = -99999;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const w = a[(r + dr) * n + (c + dc)];
            if (w === NODATA) continue;
            if (w > 0) land++;
            if (w > rim) rim = w;
          }
        }
        if (land >= 5 && rim - v > 100) found++;
      }
    }
    return found;
  };

  it('takes the −3,212 m HD shafts out, by an independent measure', () => {
    const island = rawIsland();
    repairCoarse(island, SAMPLES);
    let worstBefore = 0;
    let worstAfter = 0;
    let before = 0;
    let after = 0;
    for (const name of ['A4', 'B3', 'C2', 'D2', 'E2', 'G6', 'H2']) {
      const tile = rawTile(name);
      for (let i = 0; i < tile.length; i++) {
        if (tile[i] !== NODATA && tile[i] < worstBefore) worstBefore = tile[i];
      }
      before += pits(tile, T);
      repairFineTile(tile, T, ...tileColRow(name), islandLink(STEP));
      after += pits(tile, T);
      for (let i = 0; i < tile.length; i++) if (tile[i] < worstAfter) worstAfter = tile[i];
    }
    expect(worstBefore).toBeLessThan(-30_000);       // −3,000 m and worse
    expect(before).toBeGreaterThan(500);
    // What is left is not a leftover defect: every survivor is water
    // the ISLAND GRID also calls water — a real cove under a cliff,
    // which this local heuristic cannot tell from a pit but the two
    // datasets agreeing can. Checked exhaustively in the sweep below.
    expect(after).toBeLessThan(before / 5);
    console.log(`HD pits ${before} -> ${after}; worst `
      + `${(worstBefore / 10).toFixed(0)} m -> ${(worstAfter / 10).toFixed(0)} m`);
  }, 300000);

  it('takes the −3,271 m coarse defect out', () => {
    const island = rawIsland();
    let worstBefore = 0;
    for (let i = 0; i < island.length; i++) {
      if (island[i] !== NODATA && island[i] < worstBefore) worstBefore = island[i];
    }
    const report = repairCoarse(island, SAMPLES);
    expect(worstBefore).toBeLessThan(-30_000);
    // Nothing below sea level may remain that the border cannot reach.
    const left = enclosedWater(island, SAMPLES, (i) => {
      const c = i % SAMPLES;
      const r = (i / SAMPLES) | 0;
      return c === 0 || r === 0 || c === SAMPLES - 1 || r === SAMPLES - 1;
    });
    let enclosed = 0;
    for (let i = 0; i < left.length; i++) if (left[i]) enclosed++;
    expect(enclosed).toBe(0);
    console.log(`coarse: repaired ${report.repaired} (${report.voids} voids), `
      + `lowest ${(report.wasLowest / 10).toFixed(0)} m -> ${(report.nowLowest / 10).toFixed(0)} m`);
  }, 120000);

  it('sends NODATA through the same door', () => {
    // A void used to become the seabed constant, −600 m. It is a hole
    // in the data, so it is repaired like one — no special case, and
    // never left as a marker for something downstream to trip over.
    const island = rawIsland();
    repairCoarse(island, SAMPLES);
    const tile = rawTile('B3');            // 476 voids, the most of any
    let voidsBefore = 0;
    for (let i = 0; i < tile.length; i++) if (tile[i] === NODATA) voidsBefore++;
    expect(voidsBefore).toBeGreaterThan(400);
    const report = repairFineTile(tile, T, ...tileColRow('B3'), islandLink(STEP));
    let voidsAfter = 0;
    for (let i = 0; i < tile.length; i++) if (tile[i] === NODATA) voidsAfter++;
    expect(voidsAfter).toBe(0);
    expect(report.voids).toBe(voidsBefore);
  }, 120000);
});

describe('a defect crossing a tile boundary cannot escape', () => {
  // THE HOLE IN THE OBVIOUS APPROACH. A pit straddling a tile edge
  // touches the border of both tiles it lies in, so a flood seeded
  // from that border calls it connected to the sea and lets it
  // through. The seed is the WORLD's ocean instead, so it does not.
  const island = (): Int16Array => {
    // A 9×9 island: ocean ring, land inside. Its own border is sea, so
    // the world flood is sound.
    const n = 9;
    const a = new Int16Array(n * n).fill(500);
    for (let k = 0; k < n; k++) {
      a[k] = -300; a[(n - 1) * n + k] = -300; a[k * n] = -300; a[k * n + n - 1] = -300;
    }
    return a;
  };

  it('is repaired even though it touches the tile edge', () => {
    const world = island();
    repairCoarse(world, 9);
    // A fine tile 5 across, sharing every 2nd sample with the world
    // grid, sitting at column 1 row 1 — inland. Its LEFT edge carries
    // a pit, exactly as a defect straddling the boundary would.
    const n = 5;
    const tile = new Int16Array(n * n).fill(500);
    tile[2 * n + 0] = -1500;               // on the tile's own border
    tile[3 * n + 0] = -1500;
    const report = repairFineTile(tile, n, 1, 1, { grid: world, side: 9, step: 2 });
    expect(report.repaired).toBe(2);
    expect(tile[2 * n + 0]).toBeGreaterThan(0);
    expect(tile[3 * n + 0]).toBeGreaterThan(0);
  });

  it('while the same pit WOULD have escaped a border flood', () => {
    // The counter-test, so the guarantee is demonstrated and not just
    // asserted: seeded from its own border, that pit reads as ocean.
    const n = 5;
    const tile = new Int16Array(n * n).fill(500);
    tile[2 * n + 0] = -1500;
    tile[3 * n + 0] = -1500;
    const bad = enclosedWater(tile, n, (i) => {
      const c = i % n;
      const r = (i / n) | 0;
      return c === 0 || r === 0 || c === n - 1 || r === n - 1;
    });
    expect(bad[2 * n + 0]).toBe(0);        // escapes — the old way
    expect(bad[3 * n + 0]).toBe(0);
  });

  it('and real sea reaching the same edge is kept', () => {
    const world = island();
    repairCoarse(world, 9);
    // A tile at the world's edge, where the ocean genuinely is.
    const n = 5;
    const tile = new Int16Array(n * n).fill(500);
    for (let r = 0; r < n; r++) tile[r * n] = -300;
    const report = repairFineTile(tile, n, 0, 1, { grid: world, side: 9, step: 2 });
    expect(report.repaired).toBe(0);
    for (let r = 0; r < n; r++) expect(tile[r * n]).toBe(-300);
  });
});

describe('what must not change', () => {
  let island: Int16Array;
  let before: Int16Array;
  let after: Int16Array;
  beforeAll(() => {
    island = rawIsland();
    repairCoarse(island, SAMPLES);
    ({ before, after } = repaired('B3'));   // the coastal tile, most voids
  }, 180000);

  /**
   * GENUINE SEA IS WHERE BOTH DATASETS SAY SEA.
   *
   * Not a per-tile flood: the shipped data disproved that definition.
   * B3 carries a −2,674 m hole through a +160 m mountainside whose
   * corrupt samples chain out to the tile border, so a border flood
   * calls it ocean — 173 samples in that tile alone. The bake asserts
   * the two grids agree, so agreement is the honest test, and it is
   * independent of the repair's own connectivity rule.
   */
  const bothSaySea = (a: Int16Array, col: number, row: number): Uint8Array => {
    const sea = new Uint8Array(T * T);
    for (let r = 0; r < T; r++) {
      for (let c = 0; c < T; c++) {
        const i = r * T + c;
        if (a[i] === NODATA || a[i] >= 0) continue;
        const cx = Math.min(SAMPLES - 1, Math.round((col * (T - 1) + c) / STEP));
        const cz = Math.min(SAMPLES - 1, Math.round((row * (T - 1) + r) / STEP));
        if (island[cz * SAMPLES + cx] < 0) sea[i] = 1;
      }
    }
    return sea;
  };

  it('leaves genuine bathymetry alone, however deep', () => {
    const [col, row] = tileColRow('B3');
    const sea = bothSaySea(before, col, row);
    let deep = 0;
    for (let i = 0; i < before.length; i++) if (sea[i] && before[i] < deep) deep = before[i];
    const { checked: held, first, wrong } = sameEverywhere(before, after, (i) => sea[i] === 1);
    expect(first).toBe(null);
    expect(wrong).toBe(0);
    expect(held).toBeGreaterThan(10_000);
    console.log(`B3 sea samples held: ${held}, deepest ${(deep / 10).toFixed(0)} m`);
  });

  it('and holds the deep ocean, three kilometres down', () => {
    // B3 is a nearshore shelf and bottoms out at −60 m, so "however
    // deep" has to be asked of a tile that actually has depth. H8 is
    // open Pacific: 263,169 samples of it, reaching −3,015 m.
    const world = rawIsland();
    repairCoarse(world, SAMPLES);
    const raw = rawTile('H8');
    const fixed = rawTile('H8');
    const [col, row] = tileColRow('H8');
    repairFineTile(fixed, T, col, row, islandLink(STEP));
    let deepest = 0;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== NODATA && raw[i] < deepest) deepest = raw[i];
    }
    const { checked: held, first, wrong } = sameEverywhere(
      raw, fixed, (i) => raw[i] !== NODATA && raw[i] < 0,
    );
    expect(first).toBe(null);
    expect(wrong).toBe(0);
    expect(held).toBeGreaterThan(250_000);
    expect(deepest).toBeLessThan(-30_000);        // −3,000 m and deeper
    console.log(`H8 sea samples held: ${held}, deepest ${(deepest / 10).toFixed(0)} m`);
  }, 120000);

  it('leaves the legitimate coastline exactly where it was', () => {
    // The shore is dry land touching genuine sea. Not one sample of it
    // may move: the waterline is the island's own, and moving it out
    // by a sample would square off the coast.
    const [col, row] = tileColRow('B3');
    const sea = bothSaySea(before, col, row);
    const moved: string[] = [];
    let shore = 0;
    for (let r = 1; r < T - 1; r++) {
      for (let c = 1; c < T - 1; c++) {
        const i = r * T + c;
        if (before[i] === NODATA || before[i] < 0) continue;
        if (!(sea[i - 1] || sea[i + 1] || sea[i - T] || sea[i + T])) continue;
        shore++;
        if (before[i] !== after[i]) moved.push(`sample ${i}: ${before[i]} -> ${after[i]}`);
      }
    }
    expect(moved).toEqual([]);
    expect(shore).toBeGreaterThan(300);
    console.log(`coastline samples held: ${shore}`);
  });

  it('leaves every sample above sea level bit for bit unchanged', () => {
    // The repair may only ever touch water or a void. Dry land is the
    // surveyed island and is not ours to move — the standing rule.
    const { checked, first, wrong } = sameEverywhere(
      before, after, (i) => before[i] !== NODATA && before[i] >= 0,
    );
    expect(first).toBe(null);
    expect(wrong).toBe(0);
    expect(checked).toBeGreaterThan(10_000);
  }, 60000);

  it('and the island grid keeps its dry land too', () => {
    const fresh = rawIsland();
    const { checked, first, wrong } = sameEverywhere(
      fresh, island, (i) => fresh[i] !== NODATA && fresh[i] >= 0,
    );
    expect(first).toBe(null);
    expect(wrong).toBe(0);
    expect(checked).toBeGreaterThan(100_000);
  }, 60000);
});

describe('the two grids still agree where they share a sample', () => {
  it('holds after repair, as the bake asserts before it', () => {
    const world = rawIsland();
    repairCoarse(world, SAMPLES);
    for (const name of ['E2', 'B3', 'D2']) {
      const tile = rawTile(name);
      const [col, row] = tileColRow(name);
      repairFineTile(tile, T, col, row, islandLink(STEP));
      const apart: string[] = [];
      let checked = 0;
      for (let r = 0; r < T; r += STEP) {
        for (let c = 0; c < T; c += STEP) {
          const cx = (col * (T - 1) + c) / STEP;
          const cz = (row * (T - 1) + r) / STEP;
          if (cx > SAMPLES - 1 || cz > SAMPLES - 1) continue;
          if (tile[r * T + c] !== world[cz * SAMPLES + cx]) {
            apart.push(`${name} ${c},${r}: ${tile[r * T + c]} vs ${world[cz * SAMPLES + cx]}`);
          }
          checked++;
        }
      }
      expect(apart).toEqual([]);
      expect(checked).toBeGreaterThan(10_000);
    }
  }, 300000);
});
