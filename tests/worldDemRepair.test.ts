/**
 * THE ONLY WRITE THE TERRAIN RULE ALLOWS, AND THE PROOF IT STAYS INSIDE
 * ITS PERMISSION.
 *
 * CLAUDE.md permits exactly one edit to a stored sample: load-time
 * sanitisation of demonstrably invalid ones. This project has carved
 * terrain four times and regretted it four times, so the interesting
 * tests here are not "does the fill work" — they are the ones that fail
 * if the fill ever becomes something more than a fill:
 *
 *  - IT WRITES ONLY WHERE THE SENTINEL WAS. Every valid sample of the
 *    real coarse grid is bit-identical afterwards. This is the test that
 *    catches a smoother, a clamp or a carve arriving in this file.
 *  - EVERYTHING IT WRITES IS UNDERWATER. The shipped holes are gaps in
 *    the offshore sonar, so no repaired sample should be land. If that
 *    changes, the repair has started inventing ground an ant can stand
 *    on and somebody must look.
 *  - IT DOES NOT TOUCH ITS INPUT. v0's decoder handed out a view onto the
 *    fetched buffer and repaired through it.
 *  - IT TERMINATES. A grid with no valid sample anywhere has no fill, and
 *    a loop that waits for one never ends.
 *
 * The real files are read off disk, because 774 real holes in seven real
 * tiles are worth more than any fixture.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NODATA, decodeCoarse, decodeHdTile, heightOf, metresOf, type DemGrid } from '../src/world/dem';
import { countHoles, isRepaired, repairGrid } from '../src/world/demRepair';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function readPublic(rel: string): ArrayBuffer {
  const bytes = readFileSync(path.join(ROOT, 'public', rel));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const coarse = decodeCoarse(readPublic('kauai-1025.bin'));
const tile = (name: string): DemGrid => decodeHdTile(readPublic(path.join('kauai-hd', `${name}.bin`)));

/** A small square grid from a literal, for the cases the survey does not contain. */
function gridOf(rows: readonly (readonly number[])[]): DemGrid {
  const side = rows.length;
  const samples = new Int16Array(side * side);
  rows.forEach((row, r) => row.forEach((value, c) => { samples[r * side + c] = value; }));
  return { side, samples };
}

/** The lowest and highest valid samples in the 8 cells around one. */
function neighbourRange(grid: DemGrid, col: number, row: number): [number, number] {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= grid.side || nr >= grid.side) continue;
      const value = grid.samples[nr * grid.side + nc];
      if (value === NODATA) continue;
      if (value < low) low = value;
      if (value > high) high = value;
    }
  }
  return [low, high];
}

describe('what the shipped survey actually needs', () => {
  it('has holes, and they are few enough to name', () => {
    // MEASURED, 2026-09-04. If these numbers move, the data changed and
    // everything downstream of it deserves another look.
    expect(countHoles(coarse)).toBe(70);
    expect(countHoles(tile('B3'))).toBe(476);
    expect(countHoles(tile('D4'))).toBe(0);
  });

  it('fills every one of them, with nothing unreachable', () => {
    const { grid, report } = repairGrid(coarse);
    expect(report.holes).toBe(70);
    expect(report.filled).toBe(70);
    expect(report.unreachable).toBe(0);
    expect(isRepaired(grid)).toBe(true);
    expect(report.passes).toBeGreaterThan(0);
  });

  it('fills the worst tile too, in a bounded number of passes', () => {
    const { grid, report } = repairGrid(tile('B3'));
    expect(report.holes).toBe(476);
    expect(report.unreachable).toBe(0);
    expect(isRepaired(grid)).toBe(true);
    // A cluster needs a pass per ring inwards. Bounded and small; a
    // three-figure count would mean something is barely converging.
    expect(report.passes).toBeLessThan(20);
  });
});

describe('the repair stays inside its permission', () => {
  it('changes nothing that was not the sentinel', () => {
    // THE CARVE TEST. Four carves in this project's history; this fails
    // if a fifth, or a smoother, or a clamp, is added to this file.
    const { grid } = repairGrid(coarse);
    let compared = 0;
    for (let i = 0; i < coarse.samples.length; i += 1) {
      if (coarse.samples[i] === NODATA) continue;
      if (grid.samples[i] !== coarse.samples[i]) {
        throw new Error(`sample ${i} was ${coarse.samples[i]} and is now ${grid.samples[i]}`);
      }
      compared += 1;
    }
    expect(compared).toBe(coarse.samples.length - 70);
  });

  it('can never create a peak or a pit: a fill lies between its own neighbours', () => {
    // THE INVARIANT THAT MATTERS, and it holds by construction because a
    // mean is bounded by its terms. It is asserted against the real
    // survey anyway, because "by construction" is what was said about
    // every carve before it was measured. A repair that ever landed
    // outside the neighbourhood it read would be inventing relief, which
    // is the one thing this file is not allowed to do.
    for (const name of ['B3', 'C2', 'D2', 'G6']) {
      const before = tile(name);
      const { grid } = repairGrid(before);
      const { side } = before;
      let checked = 0;
      for (let row = 0; row < side; row += 1) {
        for (let col = 0; col < side; col += 1) {
          const index = row * side + col;
          if (before.samples[index] !== NODATA) continue;
          const filled = grid.samples[index];
          if (filled === NODATA) continue;
          const [low, high] = neighbourRange(grid, col, row);
          expect(filled).toBeGreaterThanOrEqual(low);
          expect(filled).toBeLessThanOrEqual(high);
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(0);
    }
  });

  it('is nearly all sea floor on the detailed lattice, and coastal on the coarse one', () => {
    // MEASURED, 2026-09-04, and worth writing down because it is not what
    // it looks like from one lattice alone.
    //
    // On the HIGH-DETAIL tiles the holes are gaps in the offshore sonar:
    // 774 of them, and only four — all in B3, where the gap runs up to the
    // foot of the Napali cliffs — have land among their neighbours.
    //
    // On the COARSE grid the same coastline is sampled every 54.7 m, so a
    // hole's 8-neighbourhood spans 164 m and reaches the cliff far more
    // often: 33 of its 70 holes fill above water, up to 107 m. That is the
    // shoreline being coarse, not the repair being ambitious, and the
    // coarse lattice is only ever the fallback where no tile is resident.
    for (const name of ['B4', 'C2', 'C3', 'D2', 'G6', 'G7']) {
      const { report } = repairGrid(tile(name));
      expect(report.filled).toBeGreaterThan(0);
      expect(metresOf(report.highestFilled ?? 0)).toBeLessThan(0);
    }
    expect(metresOf(repairGrid(tile('B3')).report.highestFilled ?? 0)).toBeCloseTo(57.5, 1);

    const { report } = repairGrid(coarse);
    expect(metresOf(report.highestFilled ?? 0)).toBeCloseTo(106.9, 1);
    // Nothing filled anywhere is at terrain's own scale: Kawaikini is
    // 1,598 m, so no fill may come near being a landform of its own.
    expect(metresOf(report.highestFilled ?? 0)).toBeLessThan(150);
    // And nothing was filled with the sentinel's own depth, which would
    // be a 3.2 km pit dressed up as a repair.
    expect(metresOf(report.lowestFilled ?? 0)).toBeGreaterThan(-3271);
  });

  it('leaves the grid it was handed exactly as it found it', () => {
    const before = tile('B3');
    const copy = Int16Array.from(before.samples);
    const { grid } = repairGrid(before);
    expect(before.samples).toEqual(copy);
    expect(countHoles(before)).toBe(476);
    expect(grid.samples).not.toEqual(copy);
  });

  it('returns a clean grid untouched, without a pass', () => {
    const clean = tile('D4');
    const { grid, report } = repairGrid(clean);
    expect(grid).toBe(clean);
    expect(report).toEqual({
      holes: 0, filled: 0, unreachable: 0, passes: 0, highestFilled: null, lowestFilled: null,
    });
  });
});

describe('the fill itself', () => {
  it('is the mean of the valid neighbours, rounded to a whole decimetre', () => {
    const g = gridOf([
      [100, 200, 300],
      [400, NODATA, 500],
      [600, 700, 800],
    ]);
    const { grid, report } = repairGrid(g);
    // (100+200+300+400+500+600+700+800) / 8 = 450
    expect(grid.samples[4]).toBe(450);
    expect(report.passes).toBe(1);
    expect(report.highestFilled).toBe(heightOf(450));
  });

  it('reads the pass it started with, so the answer does not depend on where the scan began', () => {
    // Two holes in a row with one valid sample beyond them. Reading the
    // live array would fill both in one sweep left-to-right and neither
    // right-to-left; reading a snapshot fills the reachable one first and
    // takes a second pass for the other, whichever way the loop runs.
    const g = gridOf([
      [NODATA, NODATA, 100],
      [NODATA, NODATA, 100],
      [100, 100, 100],
    ]);
    const { grid, report } = repairGrid(g);
    expect(report.passes).toBe(2);
    expect(isRepaired(grid)).toBe(true);
  });

  it('gives the same answer twice, because nothing in it is random', () => {
    const a = repairGrid(tile('C2')).grid;
    const b = repairGrid(tile('C2')).grid;
    expect(a.samples).toEqual(b.samples);
  });

  it('stops rather than spinning when a hole can never be filled', () => {
    const g = gridOf([
      [NODATA, NODATA],
      [NODATA, NODATA],
    ]);
    const { grid, report } = repairGrid(g);
    expect(report.holes).toBe(4);
    expect(report.filled).toBe(0);
    expect(report.unreachable).toBe(4);
    expect(report.passes).toBe(1);
    expect(report.highestFilled).toBeNull();
    expect(isRepaired(grid)).toBe(false);
  });
});
