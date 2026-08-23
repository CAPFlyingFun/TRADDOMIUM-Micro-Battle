import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeHydro, type Hydro } from '../src/world/hydro';
import { LAKE_DEPTH, SHALLOWEST, forgetLakes, lakeBed, lakeLevel, useLakes } from '../src/world/lakes';
import { terrainHeight, useGrid } from '../src/world/heightfield';
import { decodeGrid, UNITS_PER_METRE } from '../src/world/kauai';

function read(path: string): ArrayBuffer {
  const file = readFileSync(path);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

const hydro: Hydro = decodeHydro(read('public/kauai-hydro.bin'));

/** The centre of each lake's shore ring, and what it says it holds. */
const centres = hydro.lakes.map((lake) => {
  const ring = lake.rings[0];
  let x = 0;
  let z = 0;
  for (let i = 0; i < ring.count; i++) {
    x += hydro.ringX[ring.first + i];
    z += hydro.ringZ[ring.first + i];
  }
  return { x: x / ring.count, z: z / ring.count, level: lake.level };
});

beforeAll(() => {
  useGrid(decodeGrid(read('public/kauai-1025.bin')));
});
afterAll(() => forgetLakes());

describe('the island does not have room for its own lakes', () => {
  it('buries most of them before anything is carved', () => {
    // THE MEASUREMENT THAT CHANGED THE PLAN. WATER_PORT.md said lakes
    // would need no carve because they sit in basins. At 55 m a grid
    // sample, a 130 m lake has no basin — the hollow is averaged flat.
    forgetLakes();
    const buried = centres.filter((c) => terrainHeight(c.x, c.z) >= c.level);
    expect(buried.length).toBeGreaterThan(centres.length * 0.6);
  });

  it('and holds them once it is', () => {
    useLakes(hydro);
    const buried = centres.filter((c) => terrainHeight(c.x, c.z) >= c.level);
    // Not zero: seventeen ring centroids fall outside their own
    // polygon, because a lake bent round a ridge is not convex and its
    // average point can sit on the bank. Those are still carved where
    // the water actually is — see the next test.
    expect(buried.length).toBeLessThan(centres.length * 0.2);
  });

  it('gives every lake real depth somewhere inside it', () => {
    useLakes(hydro);
    let deep = 0;
    for (const lake of hydro.lakes) {
      const ring = lake.rings[0];
      // Walk the chord between opposite shore points; something on it
      // is inside, whatever shape the lake is.
      let found = false;
      for (let i = 0; i < ring.count && !found; i++) {
        const a = ring.first + i;
        const b = ring.first + ((i + (ring.count >> 1)) % ring.count);
        for (const t of [0.35, 0.5, 0.65]) {
          const x = hydro.ringX[a] + (hydro.ringX[b] - hydro.ringX[a]) * t;
          const z = hydro.ringZ[a] + (hydro.ringZ[b] - hydro.ringZ[a]) * t;
          if (lakeBed(x, z) !== null && terrainHeight(x, z) < lake.level) {
            found = true;
            break;
          }
        }
      }
      if (found) deep += 1;
    }
    expect(deep).toBe(hydro.lakes.length);
  });
});

describe('the carve only ever lowers the island', () => {
  it('never raises the ground, anywhere', () => {
    // THE INVARIANT. A lake that could push terrain UP would build a
    // plateau on a hillside and put water on top of it. The bed is
    // taken as a minimum against the existing ground, never a
    // replacement — and this walks a grid over every lake to say so.
    //
    // TWO PASSES, not a toggle per sample: `useLakes` rebuilds a
    // 112-square index, and calling it inside the loop turned a
    // millisecond of arithmetic into a five-second timeout.
    useLakes(hydro);
    const wet: [number, number][] = [];
    for (const c of centres) {
      for (let dx = -30_000; dx <= 30_000; dx += 3_000) {
        for (let dz = -30_000; dz <= 30_000; dz += 3_000) {
          if (lakeBed(c.x + dx, c.z + dz) !== null) wet.push([c.x + dx, c.z + dz]);
        }
      }
    }
    expect(wet.length).toBeGreaterThan(200);
    const carved = wet.map(([x, z]) => terrainHeight(x, z));

    forgetLakes();
    wet.forEach(([x, z], i) => {
      expect(carved[i]).toBeLessThanOrEqual(terrainHeight(x, z) + 1e-6);
    });
  });

  it('changes nothing at all away from a lake', () => {
    useLakes(hydro);
    const withLakes: number[] = [];
    const spots: [number, number][] = [];
    for (let i = 0; i < 400; i++) {
      const x = ((i * 7919) % 5_000_000) - 2_500_000;
      const z = ((i * 104_729) % 5_000_000) - 2_500_000;
      if (lakeBed(x, z) !== null) continue;
      spots.push([x, z]);
      withLakes.push(terrainHeight(x, z));
    }
    forgetLakes();
    spots.forEach(([x, z], i) => expect(terrainHeight(x, z)).toBe(withLakes[i]));
  });
});

describe('the shape of a lake bed', () => {
  beforeAll(() => useLakes(hydro));

  it('never presses a bed below the sea', () => {
    // The lowest lake sits at 1.75 m. A flat two-metre cut would put
    // its bed underwater, and the ocean shader would draw sea in it.
    for (const c of centres) {
      const bed = lakeBed(c.x, c.z);
      if (bed !== null) expect(bed).toBeGreaterThanOrEqual(SHALLOWEST);
    }
  });

  it('reports a surface level only where there is water', () => {
    let inLake = 0;
    for (const c of centres) {
      const level = lakeLevel(c.x, c.z);
      if (level === null) continue;
      inLake += 1;
      expect(level).toBe(c.level);
      expect(level).toBeGreaterThan(0);
      expect(level).toBeLessThan(1_600 * UNITS_PER_METRE);
    }
    expect(inLake).toBeGreaterThan(90);
    // The middle of the ocean is not a lake.
    expect(lakeLevel(0, 2_700_000)).toBeNull();
    expect(lakeBed(0, 2_700_000)).toBeNull();
  });
});

/**
 * A SQUARE LAKE WITH A SQUARE ISLAND IN IT.
 *
 * The real hydrography is the wrong instrument for these questions.
 * Kauaʻi's lakes bend round ridges, so the average of a shore ring is
 * frequently on the bank rather than in the water and a chord between
 * two shore points spends most of its length outside the lake — which
 * is how the first version of these tests convicted the carve of bugs
 * it did not have. Made-up geometry answers exactly what is asked.
 */
describe('the shape of a lake bed', () => {
  const LEVEL = 5_000;
  /** 40,000 units square — 400 m, comfortably bigger than the feather. */
  const SIDE = 40_000;

  function square(cx: number, cz: number, side: number): number[] {
    const h = side / 2;
    return [cx - h, cz - h, cx + h, cz - h, cx + h, cz + h, cx - h, cz + h];
  }

  /** Just enough of a Hydro for the lakes to be read out of it. */
  function pond(withIsland: boolean): Hydro {
    const shore = square(0, 0, SIDE);
    const island = square(0, 0, SIDE / 5);
    const points = withIsland ? [...shore, ...island] : shore;
    const rings = [{ first: 0, count: 4 }];
    if (withIsland) rings.push({ first: 4, count: 4 });
    return {
      rivers: [],
      lakes: [{ name: 'Pond', level: LEVEL, rings }],
      x: new Int32Array(0),
      z: new Int32Array(0),
      y: new Int32Array(0),
      width: new Uint16Array(0),
      ringX: new Int32Array(points.filter((_, i) => i % 2 === 0)),
      ringZ: new Int32Array(points.filter((_, i) => i % 2 === 1)),
    };
  }

  it('is deepest in the middle and eased at the bank', () => {
    // A wall at the shoreline is not a lake, it is a swimming pool.
    useLakes(pond(false));
    const walk: number[] = [];
    for (let x = -SIDE / 2 + 200; x < SIDE / 2; x += 800) {
      const bed = lakeBed(x, 0);
      if (bed !== null) walk.push(LEVEL - bed);
    }
    expect(walk.length).toBeGreaterThan(20);
    const middle = walk[walk.length >> 1];
    expect(middle).toBeCloseTo(LAKE_DEPTH, 6);
    expect(walk[0]).toBeLessThan(middle);
    expect(walk[walk.length - 1]).toBeLessThan(middle);
    // Monotone out from each bank, with no step in it.
    for (let i = 1; i < walk.length >> 1; i++) {
      expect(walk[i]).toBeGreaterThanOrEqual(walk[i - 1] - 1e-9);
    }
  });

  it('knows inside from outside', () => {
    useLakes(pond(false));
    expect(lakeBed(0, 0)).toBeCloseTo(LEVEL - LAKE_DEPTH, 6);
    expect(lakeLevel(0, 0)).toBe(LEVEL);
    for (const [x, z] of [[SIDE, 0], [0, SIDE], [-SIDE, -SIDE], [1e6, 1e6]]) {
      expect(lakeBed(x, z)).toBeNull();
      expect(lakeLevel(x, z)).toBeNull();
    }
  });

  it('leaves an island in a lake standing', () => {
    // Two of the real hundred and eleven have holes, and a hole is land.
    useLakes(pond(true));
    expect(lakeBed(0, 0)).toBeNull();
    expect(lakeLevel(0, 0)).toBeNull();
    // The water around it is still water.
    expect(lakeBed(SIDE / 3, 0)).not.toBeNull();
    expect(lakeLevel(SIDE / 3, 0)).toBe(LEVEL);
  });

  it('eases away from the island’s shore too, not just the lake’s', () => {
    // Otherwise the bed drops off the island as a cliff.
    useLakes(pond(true));
    const closeIn = lakeBed(SIDE / 10 + 300, 0);
    const further = lakeBed(SIDE / 10 + 3_000, 0);
    expect(closeIn).not.toBeNull();
    expect(further).not.toBeNull();
    expect(closeIn as number).toBeGreaterThan(further as number);
  });
});

describe('the real lakes that have islands', () => {
  it('punch a hole the carve respects', () => {
    // Behavioural, because a centroid is not reliably inside a ring:
    // walk the holed lake's box and insist that SOME of the points the
    // outer ring covers are refused, which only a hole can cause.
    useLakes(hydro);
    const holed = hydro.lakes.filter((l) => l.rings.length > 1);
    expect(holed).toHaveLength(2);
    for (const lake of holed) {
      const hole = lake.rings[1];
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < hole.count; i++) {
        const at = hole.first + i;
        minX = Math.min(minX, hydro.ringX[at]);
        maxX = Math.max(maxX, hydro.ringX[at]);
        minZ = Math.min(minZ, hydro.ringZ[at]);
        maxZ = Math.max(maxZ, hydro.ringZ[at]);
      }
      let dry = 0;
      for (let x = minX; x <= maxX; x += (maxX - minX) / 24) {
        for (let z = minZ; z <= maxZ; z += (maxZ - minZ) / 24) {
          if (lakeBed(x, z) === null) dry += 1;
        }
      }
      expect(dry).toBeGreaterThan(0);
    }
  });
});
