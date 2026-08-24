import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildStreambed, buildReach } from '../src/world/RiverWater';
import { useGrid } from '../src/world/heightfield';
import { decodeGrid, type HeightGrid } from '../src/world/kauai';

const ASSET = fileURLToPath(new URL('../public/kauai-1025.bin', import.meta.url));
let grid: HeightGrid;
beforeAll(() => {
  const f = readFileSync(ASSET);
  grid = decodeGrid(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer);
  useGrid(grid);
});

/** A straight reach: four stations, dropping downstream, 550 wide. */
function stations(): Float64Array {
  const rows = 4;
  const out = new Float64Array(rows * 4);
  for (let i = 0; i < rows; i++) {
    out[i * 4] = i * 2_000;      // x
    out[i * 4 + 1] = 10_000 - i * 50; // level, downhill
    out[i * 4 + 2] = 0;          // z
    out[i * 4 + 3] = 550;        // width
  }
  return out;
}

describe('the streambed under a ribbon', () => {
  it('is three vertices across, so it can have a thread', () => {
    const bed = buildStreambed(stations(), 0, 0)!;
    const water = buildReach(stations(), 0, 0)!;
    const bedRows = bed.getAttribute('position').count / 3;
    const waterRows = water.getAttribute('position').count / 2;
    expect(bedRows).toBe(waterRows);
  });

  it('never rises above the surface it lies under', () => {
    const st = stations();
    const bed = buildStreambed(st, 0, 0)!;
    const water = buildReach(st, 0, 0)!;
    const bp = bed.getAttribute('position');
    const wp = water.getAttribute('position');
    const rows = bp.count / 3;
    for (let i = 0; i < rows; i++) {
      const level = wp.getY(i * 2); // the surface at this station
      for (let k = 0; k < 3; k++) {
        expect(bp.getY(i * 3 + k)).toBeLessThan(level);
      }
    }
  });

  it('puts its banks at the same half-width as the water', () => {
    const st = stations();
    const bed = buildStreambed(st, 0, 0)!;
    const water = buildReach(st, 0, 0)!;
    const bp = bed.getAttribute('position');
    const wp = water.getAttribute('position');
    const rows = bp.count / 3;
    for (let i = 0; i < rows; i++) {
      // bed vertex 0 and 2 are the banks; water 0 and 1 are its edges.
      expect(bp.getZ(i * 3)).toBeCloseTo(wp.getZ(i * 2), 3);
      expect(bp.getZ(i * 3 + 2)).toBeCloseTo(wp.getZ(i * 2 + 1), 3);
    }
  });

  it('dips in the middle — the thread is the deepest part', () => {
    const bed = buildStreambed(stations(), 0, 0)!;
    const bp = bed.getAttribute('position');
    const rows = bp.count / 3;
    let dipped = 0;
    for (let i = 0; i < rows; i++) {
      const left = bp.getY(i * 3);
      const mid = bp.getY(i * 3 + 1);
      const right = bp.getY(i * 3 + 2);
      if (mid < left && mid < right) dipped++;
    }
    // A channel that is a channel for most of its length.
    expect(dipped / rows).toBeGreaterThan(0.8);
  });

  it('is wound into two quads a station, not one', () => {
    const bed = buildStreambed(stations(), 0, 0)!;
    const rows = bed.getAttribute('position').count / 3;
    expect(bed.getIndex()!.count).toBe((rows - 1) * 12);
  });
});
