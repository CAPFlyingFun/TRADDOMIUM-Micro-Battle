import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeHydro, type Hydro } from '../src/world/hydro';
import {
  BANK_GRADE, channelDepth, flowSpeed, forgetRivers, riverAt, riverBed,
  riverFlow, riverIndexSize, riverPointLevels, riverSegment, useRivers, riverDamp, DAMP_REACH,
} from '../src/world/rivers';
import { farHeight, terrainHeight, useGrid } from '../src/world/heightfield';
import { decodeGrid, UNITS_PER_METRE } from '../src/world/kauai';
import { forgetLakes } from '../src/world/lakes';

function read(path: string): ArrayBuffer {
  const file = readFileSync(path);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

const hydro: Hydro = decodeHydro(read('public/kauai-hydro.bin'));

beforeAll(() => {
  useGrid(decodeGrid(read('public/kauai-1025.bin')));
  useRivers(hydro);
});
afterAll(() => { forgetRivers(); forgetLakes(); });

describe('the levelled elevations', () => {
  it('never flow uphill along any of the 1,121 reaches', () => {
    // DEM noise on a river profile is water climbing, and the ribbons
    // draw exactly what this array says. Every reach, both directions
    // checked against its own net descent.
    const levels = riverPointLevels()!;
    for (const river of hydro.rivers) {
      const first = river.first;
      const last = river.first + river.count - 1;
      const down = levels[first] >= levels[last];
      for (let i = first + 1; i <= last; i++) {
        if (down) expect(levels[i]).toBeLessThanOrEqual(levels[i - 1] + 1e-9);
        else expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1] - 1e-9);
      }
    }
  });

  it('stays within DEM noise of what was baked', () => {
    // Levelling is allowed to SHAVE noise, not to invent a canyon.
    const levels = riverPointLevels()!;
    let worst = 0;
    for (let i = 0; i < levels.length; i++) {
      worst = Math.max(worst, Math.abs(levels[i] - hydro.y[i]));
    }
    expect(worst / UNITS_PER_METRE).toBeLessThan(30);
  });
});

describe('the channel carve', () => {
  it('digs the centreline under its own water, everywhere sampled', () => {
    for (let i = 0; i < hydro.x.length; i += 97) {
      const spot = riverAt(hydro.x[i], hydro.z[i]);
      if (!spot || spot.off > spot.width * 0.2) continue;
      expect(spot.bed).toBeLessThan(spot.level);
      expect(spot.level - spot.bed).toBeGreaterThan(channelDepth(spot.width) * 0.5);
    }
  });

  it('scales depth with width, inside real-stream bounds', () => {
    expect(channelDepth(250) / UNITS_PER_METRE).toBeCloseTo(0.3, 6);
    expect(channelDepth(550) / UNITS_PER_METRE).toBeCloseTo(0.66, 2);
    expect(channelDepth(3_620) / UNITS_PER_METRE).toBe(2.5);
  });

  it('climbs the bank at the stated grade outside the channel', () => {
    // Find a wide straight segment and walk out from the centre.
    const i = hydro.rivers.findIndex((r) => r.name === 'North Fork Wailua River');
    const river = hydro.rivers[i];
    const p = river.first + (river.count >> 1);
    const spot = riverAt(hydro.x[p], hydro.z[p])!;
    const half = spot.width / 2;
    // Perpendicular direction, found by probing.
    for (const step of [1.2, 1.6, 2.0]) {
      const out = riverAt(hydro.x[p] + half * step, hydro.z[p]);
      if (!out || out.off <= half) continue;
      expect(out.bed).toBeGreaterThan(out.level);
      expect(out.bed - out.level).toBeLessThanOrEqual(
        (out.off - out.width / 2) * BANK_GRADE + 1,
      );
    }
  });

  it('only ever LOWERS the island — the water invariant', () => {
    let checked = 0;
    for (let i = 0; i < hydro.x.length; i += 397) {
      for (const [dx, dz] of [[0, 0], [300, 0], [0, -400], [900, 500]]) {
        const x = hydro.x[i] + dx;
        const z = hydro.z[i] + dz;
        if (riverBed(x, z) === null) continue;
        checked++;
        expect(terrainHeight(x, z)).toBeLessThanOrEqual(farHeight(x, z) + 1e-6);
      }
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('reaches the far tiers as a footprint, not as a point', () => {
    // THIS TEST USED TO ASSERT THE OPPOSITE, and asserting it is how
    // the floating-water bug survived: farHeight refused the channel
    // outright, on the argument that a point sample at 312 or 3,125
    // units lands on one vertex and misses the next — pockmarks, not
    // rivers. True of a POINT sample. The ribbons were drawn out there
    // regardless, over ground with no channel in it, and ended up
    // inside the hillside. See waterFits.test.ts for the measurement.
    //
    // Asked about a footprint instead, a coarse vertex answers with the
    // lowest ground it stands for, and the channel arrives at a width
    // the tier's triangles can hold. So: no carve at a bare point far
    // from the channel, a carve once the footprint reaches it, and
    // never above what terrainHeight already said.
    let widened = 0;
    for (let i = 0; i < hydro.x.length; i += 397) {
      const x = hydro.x[i];
      const z = hydro.z[i];
      // A stride away — outside the channel, inside a coarse footprint.
      const off = 1_200;
      const point = farHeight(x + off, z);
      const square = farHeight(x + off, z, 3_125);
      expect(square).toBeLessThanOrEqual(point + 1e-6);
      if (point - square > 1) widened++;
    }
    expect(widened).toBeGreaterThan(50);
  });

  it('and the footprint never lifts the ground', () => {
    for (let i = 0; i < hydro.x.length; i += 397) {
      const x = hydro.x[i];
      const z = hydro.z[i];
      const bare = farHeight(x, z);
      for (const slack of [312.5, 3_125]) {
        expect(farHeight(x, z, slack)).toBeLessThanOrEqual(bare + 1e-6);
      }
    }
  });
});

describe('the flow', () => {
  it('goes with the square root of the slope, clamped to real streams', () => {
    expect(flowSpeed(0)).toBe(10);
    expect(flowSpeed(0.01)).toBeCloseTo(100, 6);
    expect(flowSpeed(1)).toBe(150);
  });

  it('points DOWNSTREAM on every one of the 48,544 segments', () => {
    // Tested at the CONSTRUCTION, not through riverAt: the crossing
    // rule hands a junction's midpoint to whichever reach stands
    // higher, and two earlier versions of this test convicted the flow
    // of that geometry. The invariant is the segment's own: its flow
    // vector points at its lower end, exactly.
    const { segments } = riverIndexSize();
    for (let i = 0; i < segments; i++) {
      const seg = riverSegment(i)!;
      const dx = seg.bx - seg.ax;
      const dz = seg.bz - seg.az;
      if (Math.hypot(dx, dz) < 1e-6) continue;
      const drop = seg.ay - seg.by;
      if (Math.abs(drop) < 1e-9) continue;
      const along = seg.fx * dx + seg.fz * dz;
      expect(Math.sign(along)).toBe(Math.sign(drop));
      expect(Math.hypot(seg.fx, seg.fz)).toBeCloseTo(1, 6);
      expect(seg.speed).toBeGreaterThanOrEqual(10);
    }
  });

  it('is water she cannot generally outrun, and knows it', () => {
    // Her walk tops out near 25. The median grade beats her; the
    // clamps mean nothing is ever slower than 10 or faster than 150.
    let fast = 0;
    let total = 0;
    for (let i = 0; i < hydro.x.length; i += 149) {
      const flow = riverFlow(hydro.x[i], hydro.z[i]);
      if (!flow) continue;
      const speed = Math.hypot(flow.x, flow.z);
      expect(speed).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(speed).toBeLessThanOrEqual(150 + 1e-9);
      total++;
      if (speed > 25) fast++;
    }
    expect(fast / total).toBeGreaterThan(0.3);
  });
});

describe('the index', () => {
  it('finds what a brute-force search finds', () => {
    // The bucket grid against the definition. A segment folded into
    // the wrong bucket is a river with a hole in it at one exact spot,
    // found only by the queen who walks there.
    let seed = 424_242;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let n = 0; n < 400; n++) {
      const p = Math.floor(rnd() * hydro.x.length);
      const x = hydro.x[p] + (rnd() - 0.5) * 3_000;
      const z = hydro.z[p] + (rnd() - 0.5) * 3_000;
      const indexed = riverAt(x, z);
      // Brute force: the nearest claiming segment across every reach.
      let truth: number | null = null;
      const levels = riverPointLevels()!;
      for (const river of hydro.rivers) {
        for (let i = 0; i < river.count - 1; i++) {
          const a = river.first + i;
          const ax = hydro.x[a];
          const az = hydro.z[a];
          const ex = hydro.x[a + 1] - ax;
          const ez = hydro.z[a + 1] - az;
          const run = ex * ex + ez * ez;
          const t = run > 0
            ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / run)) : 0;
          const off = Math.hypot(x - ax - ex * t, z - az - ez * t);
          const width = Math.max(hydro.width[a], hydro.width[a + 1]);
          if (off > width / 2) continue;
          const level = levels[a] + (levels[a + 1] - levels[a]) * t;
          if (truth === null || level > truth) truth = level;
        }
      }
      if (truth !== null) {
        expect(indexed).not.toBeNull();
        // The index may find a higher-standing claimer at a crossing,
        // never a lower one, and never nothing.
        expect(indexed!.level).toBeGreaterThanOrEqual(truth - 1);
      }
    }
  });

  it('covers all 48,544 segments', () => {
    const { segments, entries } = riverIndexSize();
    expect(segments).toBe(48_544);
    expect(entries).toBeGreaterThanOrEqual(segments);
  });
});

describe('the ground a river keeps wet', () => {
  it('is a corridor, widest at the bank and gone by the edge of it', () => {
    const seg = riverSegment(2_000)!;
    const x = (seg.ax + seg.bx) / 2;
    const z = (seg.az + seg.bz) / 2;
    // Relative to the reach, not to a number that was true when the
    // reach was twelve metres.
    const across = [0, 0.5, 1, 1.5, 2.5]
      .map((of) => riverDamp(x + of * DAMP_REACH, z));
    // Monotonic outward, saturated over the channel, gone past the band.
    for (let i = 1; i < across.length; i++) {
      expect(across[i]).toBeLessThanOrEqual(across[i - 1] + 1e-9);
    }
    expect(across[0]).toBe(1);
    expect(across[across.length - 1]).toBeLessThan(0.1);
  });

  it('is dry almost everywhere, which is the point', () => {
    // A corridor, not a wash of colour over the island. If this ever
    // creeps up, the tint has stopped meaning "there is a river here".
    let wet = 0;
    let n = 0;
    for (let i = 0; i < 200; i++) {
      for (let j = 0; j < 200; j++) {
        n++;
        if (riverDamp(-1_400_000 + i * 8_000, -400_000 + j * 8_000) > 0) wet++;
      }
    }
    expect(wet / n).toBeLessThan(0.12);
    expect(wet).toBeGreaterThan(0);
  });

  // A trunk waters more ground than a headwater — true by the band
  // formula, and NOT tested here. Marching outward from a reach to
  // find the corridor's edge walks straight into the next reach on a
  // drainage this dense, so the measurement came back inverted and was
  // measuring meander spacing rather than corridor width.
});
