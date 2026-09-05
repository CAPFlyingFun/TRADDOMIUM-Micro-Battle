/**
 * NOTHING THAT SHOULD BE UNDER WATER IS ABOVE IT.
 *
 * Joshua made this the gate for Phase 3 (2026-09-05): "as long as it is
 * below sea level, we are good, and we can start on the ocean, if not, we
 * need to fix before we do the ocean."
 *
 * It is the right gate. The ocean is a surface at MSL — height 0, the
 * datum every stored sample is measured from — so anything the terrain
 * puts above 0 will stick out of it. Land sticking out is the island. A
 * speck of SEA FLOOR sticking out is a rock in the middle of the ocean
 * that nobody surveyed, and once the water is drawn it is the kind of
 * thing you notice from a boat and cannot explain.
 *
 * Three ways it could go wrong, and one test each:
 *
 *  1. THE SURVEY ITSELF holds a sample above 0 in open water.
 *  2. THE REPAIR invents one. It fills a hole with the mean of its valid
 *     neighbours, and a mean cannot exceed its terms — so a fill above 0
 *     needs real land next to it. That is an argument; this measures it,
 *     because the fill is iterative and a later pass reads an earlier
 *     pass's values, which is a path for land to walk outward.
 *  3. THE WORLD PAST THE SURVEY. Off the edge, `Heightfield` clamps the
 *     POSITION, which repeats the border sample outward for another 56 km.
 *     That border is not one depth — it runs from -3,015 m to -9 m — so
 *     the question of whether the extrusion is under water is a real one
 *     rather than an obvious one.
 *
 * Read against the shipped bytes. The whole-survey scans are the reason
 * this file is slower than its neighbours; it is checking 17.9 million
 * samples for one that would ruin the ocean.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  HD_TILES_ACROSS, ISLAND_HALF_SPAN, NODATA,
  decodeCoarse, decodeHdTile, hdTileName, type DemGrid,
} from '../src/world/dem';
import { repairGrid } from '../src/world/demRepair';
import { Heightfield, SEA_LEVEL } from '../src/world/heightfield';
import { world } from '../src/world/coords';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const readPublic = (rel: string): ArrayBuffer => {
  const bytes = readFileSync(path.join(ROOT, 'public', rel));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

const coarseRaw = decodeCoarse(readPublic('kauai-1025.bin'));
const tileRaw = (name: string): DemGrid => decodeHdTile(readPublic(path.join('kauai-hd', `${name}.bin`)));
const TILE_NAMES: string[] = [];
for (let col = 0; col < HD_TILES_ACROSS; col += 1) {
  for (let row = 0; row < HD_TILES_ACROSS; row += 1) TILE_NAMES.push(hdTileName({ col, row }));
}

/**
 * Every sample above sea level whose whole neighbourhood is below it —
 * a speck of ground with nothing but water around it.
 *
 * The margin is two samples, so a lone pixel AND a two-pixel pair both
 * count. Samples within the margin of the grid's own edge are skipped:
 * for a tile, the ground past its edge is the neighbouring tile's, and
 * this is asked per grid.
 */
function specksInOpenWater(grid: DemGrid, margin = 2): { col: number; row: number; height: number }[] {
  const { side, samples } = grid;
  const found: { col: number; row: number; height: number }[] = [];
  for (let row = margin; row < side - margin; row += 1) {
    for (let col = margin; col < side - margin; col += 1) {
      const here = samples[row * side + col];
      if (here === NODATA || here <= 0) continue;
      let alone = true;
      for (let dr = -margin; dr <= margin && alone; dr += 1) {
        for (let dc = -margin; dc <= margin; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          const near = samples[(row + dr) * side + (col + dc)];
          if (near !== NODATA && near > 0) {
            alone = false;
            break;
          }
        }
      }
      if (alone) found.push({ col, row, height: here });
    }
  }
  return found;
}

describe('the survey puts nothing but the island above the waterline', () => {
  it('would actually find a speck if there were one', () => {
    // The scan below returns an empty list, and an empty list is what a
    // broken scan returns too. One planted rock, in water, proves the
    // difference — and one planted next to land proves it is not simply
    // reporting everything above zero.
    const side = 40;
    const samples = new Int16Array(side * side).fill(-2000);
    samples[20 * side + 20] = 15;
    expect(specksInOpenWater({ side, samples })).toEqual([{ col: 20, row: 20, height: 15 }]);

    const coastal = new Int16Array(side * side).fill(-2000);
    for (let row = 0; row < side; row += 1) {
      for (let col = 0; col < 25; col += 1) coastal[row * side + col] = 300;
    }
    expect(specksInOpenWater({ side, samples: coastal })).toEqual([]);
  });

  it('has no speck of ground standing alone in open water, at either resolution', () => {
    expect(specksInOpenWater(coarseRaw)).toEqual([]);
    const offenders: string[] = [];
    for (const name of TILE_NAMES) {
      for (const s of specksInOpenWater(tileRaw(name))) {
        offenders.push(`${name} ${s.col},${s.row} at ${(s.height / 10).toFixed(1)} m`);
      }
    }
    expect(offenders).toEqual([]);
  }, 120_000);

  it('is one island and a few coastal pieces, not a scattering of rocks', () => {
    // MEASURED 2026-09-05: four bodies above sea level in the coarse grid.
    // One is Kauaʻi. The other three are coastal land 0.3 to 1.5 km off it,
    // cut off in the DEM by water 1 to 3 m deep — river mouths and shallow
    // bays, which is real ground and will stand out of the ocean correctly.
    // A number climbing here means the coastline has started to break up.
    expect(bodiesAboveSeaLevel(coarseRaw).length).toBe(4);
  });
});

describe('the repair never writes land the survey did not have', () => {
  it('puts every above-water fill against real surveyed land, at either resolution', () => {
    // The fill is a mean, so it cannot exceed its own terms — but it is
    // ITERATIVE, and a later pass reads an earlier pass's values, which is
    // how land could walk outward into water over several passes. Both
    // lattices in fact converge in ONE pass, so there is no chain at all;
    // this asserts the outcome rather than the reason.
    for (const raw of [coarseRaw, ...['B3', 'B4', 'C2', 'C3', 'D2', 'G6', 'G7'].map(tileRaw)]) {
      const { grid, report } = repairGrid(raw);
      expect(report.passes).toBe(1);
      const { side } = raw;
      for (let row = 0; row < side; row += 1) {
        for (let col = 0; col < side; col += 1) {
          const i = row * side + col;
          if (raw.samples[i] !== NODATA || grid.samples[i] <= 0) continue;
          // It was a hole, and it now reads as land. Real land must be near.
          let real = false;
          for (let dr = -2; dr <= 2 && !real; dr += 1) {
            for (let dc = -2; dc <= 2; dc += 1) {
              const nr = row + dr;
              const nc = col + dc;
              if (nr < 0 || nc < 0 || nr >= side || nc >= side) continue;
              const was = raw.samples[nr * side + nc];
              if (was !== NODATA && was > 0) {
                real = true;
                break;
              }
            }
          }
          expect(real, `a fill at ${col},${row} became land with no surveyed land near it`).toBe(true);
        }
      }
    }
  }, 60_000);
});

describe('the world past the edge of the survey is under water', () => {
  it('reads below sea level everywhere outside the island, in every direction', () => {
    // Off the survey the heightfield clamps the POSITION, repeating the
    // border sample outward. The border runs from -3,015 m to -9 m, so
    // "is the extrusion under water" is a real question — and the answer
    // has to hold all the way round, not just where somebody looked.
    const field = new Heightfield(repairGrid(coarseRaw).grid);
    const out = ISLAND_HALF_SPAN * 1.4;
    let shallowest = -Infinity;
    for (let i = 0; i < 720; i += 1) {
      const a = (i / 720) * Math.PI * 2;
      // THE SURVEY IS A SQUARE, so "outside" is not a circle. A ring at
      // 1.01 x the half-span still cuts back INSIDE the box near the
      // diagonals — where it reads the island, at +11.8 m, and fails this
      // test for the wrong reason. The distance to the boundary along a
      // bearing is half-span / max(|cos|, |sin|); everything past that is
      // genuinely off the survey.
      const toEdge = ISLAND_HALF_SPAN / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
      for (const r of [toEdge * 1.001, toEdge * 1.5, toEdge * 8]) {
        const h = field.heightAt(world(Math.cos(a) * r, Math.sin(a) * r));
        if (h > shallowest) shallowest = h;
      }
    }
    expect(shallowest).toBeLessThan(SEA_LEVEL);
    // And the four corners, which is where two clamps meet at once.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        expect(field.heightAt(world(sx * out, sz * out))).toBeLessThan(SEA_LEVEL);
      }
    }
  });
});

/** Connected bodies of above-sea-level ground, 8-connected. */
function bodiesAboveSeaLevel(grid: DemGrid): number[] {
  const { side, samples } = grid;
  const seen = new Uint8Array(side * side);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < side * side; start += 1) {
    if (seen[start] === 1 || samples[start] === NODATA || samples[start] <= 0) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    let n = 0;
    while (stack.length > 0) {
      const j = stack.pop() as number;
      n += 1;
      const jr = Math.floor(j / side);
      const jc = j % side;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const nr = jr + dr;
          const nc = jc + dc;
          if (nr < 0 || nc < 0 || nr >= side || nc >= side) continue;
          const k = nr * side + nc;
          if (seen[k] === 1 || samples[k] === NODATA || samples[k] <= 0) continue;
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    sizes.push(n);
  }
  return sizes.sort((a, b) => b - a);
}
