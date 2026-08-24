import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildStreambed, buildReach } from '../src/world/RiverWater';
import { useGrid } from '../src/world/heightfield';
import { channelDepth } from '../src/world/rivers';
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

  it('faces UP — every triangle, measured, not assumed', () => {
    // The bug this exists for: wound the other way the sheet still
    // draws (DoubleSide) but shades as if lit from below, and the bed
    // renders black. Nothing is missing from the frame, so only the
    // colour gives it away. Measure the cross product instead.
    const bed = buildStreambed(stations(), 0, 0)!;
    const pos = bed.getAttribute('position');
    const idx = bed.getIndex()!;
    let down = 0;
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      const e1 = [pos.getX(b) - pos.getX(a), pos.getY(b) - pos.getY(a), pos.getZ(b) - pos.getZ(a)];
      const e2 = [pos.getX(c) - pos.getX(a), pos.getY(c) - pos.getY(a), pos.getZ(c) - pos.getZ(a)];
      const ny = e1[2] * e2[0] - e1[0] * e2[2];
      if (ny <= 0) down++;
    }
    expect(down).toBe(0);
  });

  it('carries normals that point up too, after computeVertexNormals', () => {
    const bed = buildStreambed(stations(), 0, 0)!;
    const n = bed.getAttribute('normal');
    expect(n).toBeTruthy();
    for (let v = 0; v < n.count; v++) expect(n.getY(v)).toBeGreaterThan(0);
  });

  it('never hangs below its own channel — no skirt', () => {
    // The fault Joshua photographed: an unbounded `min(ground,
    // surface)` let a reach crossing a slope drape its bank vertices
    // hundreds of units down the hillside. It rendered as a black
    // wedge the water could not cover, because it was nowhere near
    // the water. A bed is at most as deep as the channel it beds.
    const st = stations();
    const bed = buildStreambed(st, 0, 0)!;
    const water = buildReach(st, 0, 0)!;
    const bp = bed.getAttribute('position');
    const wp = water.getAttribute('position');
    const rows = bp.count / 3;
    // The test reach is 550 wide; channelDepth caps its trench.
    const deepest = channelDepth(550);
    for (let i = 0; i < rows; i++) {
      const level = wp.getY(i * 2);
      for (let k = 0; k < 3; k++) {
        expect(level - bp.getY(i * 3 + k)).toBeLessThanOrEqual(deepest + 1e-6);
      }
    }
  });

  it('pins its rim to the waterline, so nothing shows outside the water', () => {
    // Joshua's second report — "black in the ground, and the water is
    // not covering the whole area". Both were one fault: the rim was
    // allowed to follow ground BELOW the waterline, so the trough wall
    // stood outside the flat ribbon's silhouette with nothing to cover
    // it. The rim must sit just under the surface and no lower.
    const st = stations();
    const bed = buildStreambed(st, 0, 0)!;
    const water = buildReach(st, 0, 0)!;
    const bp = bed.getAttribute('position');
    const wp = water.getAttribute('position');
    const rows = bp.count / 3;
    for (let i = 0; i < rows; i++) {
      const level = wp.getY(i * 2);
      for (const k of [0, 2]) {           // the two rim vertices
        const under = level - bp.getY(i * 3 + k);
        expect(under).toBeGreaterThan(0);  // never breaks the surface
        expect(under).toBeLessThan(5);     // and never hangs off it
      }
    }
  });

  it('pins its rim to the waterline, so nothing shows outside the water', () => {
    // Joshua's second report: "black in the ground, and the water not
    // covering the whole area". One fault, both symptoms. The rim was
    // allowed to follow ground BELOW the waterline, so a wall of
    // trough stood outside the flat ribbon's silhouette with nothing
    // there to cover it — measured at 66,60,50 against the bank's
    // 88,73,41, which is the "black". The rim sits just under the
    // surface and no lower.
    const st = stations();
    const bed = buildStreambed(st, 0, 0)!;
    const water = buildReach(st, 0, 0)!;
    const bp = bed.getAttribute('position');
    const wp = water.getAttribute('position');
    const rows = bp.count / 3;
    for (let i = 0; i < rows; i++) {
      const level = wp.getY(i * 2);
      for (const k of [0, 2]) {            // the two rim vertices
        const under = level - bp.getY(i * 3 + k);
        expect(under).toBeGreaterThan(0);  // never breaks the surface
        expect(under).toBeLessThan(5);     // and never hangs off it
      }
    }
  });

  it('is wound into two quads a station, not one', () => {
    const bed = buildStreambed(stations(), 0, 0)!;
    const rows = bed.getAttribute('position').count / 3;
    expect(bed.getIndex()!.count).toBe((rows - 1) * 12);
  });
});
