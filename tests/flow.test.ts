/**
 * THE WATER IS A LEVEL FIELD, AND THIS FILE HOLDS IT TO THE CONTRACT.
 *
 * TMBF version 2 stores, for every river station, the surface the
 * water stands at (LEVEL) and the bake's filled ground under it (BED),
 * plus each pond cell's spill level. Nothing is carved: the renderer
 * draws over-wide flat slabs at LEVEL and lets the terrain clip them,
 * and waterLevelAt() is the one answer to wet/dry/depth that rendering
 * and gameplay both read. Every comparison here is in raw world units
 * at relief 1 — LEVEL and BED scale together, so the relief slider
 * cannot change a verdict.
 *
 * The synthetic bake below has FIVE stations on purpose. Five is odd,
 * so the u16 width array ends two bytes short of a four-byte boundary
 * and the pond Int32Arrays cannot be viewed at all without the pad
 * that version 2 guarantees. Version 1 had no pad and decoded anyway,
 * because its bake happened to write 74,962 stations — even, by luck.
 * This file is where that stops being luck.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeFlow, flowAt, forgetFlow, pondLevelAt, slabHalf, useFlow, waterLevelAt,
  type Flow,
} from '../src/world/flow';

const ASSET = fileURLToPath(new URL('../public/kauai-flow.bin', import.meta.url));

/**
 * A bake small enough to check by hand: two reaches, five stations,
 * three ponds. The depths obey the channel law the real bake uses —
 * LEVEL - BED = clip(0.12 * width, 30, 250) — and each reach runs
 * downhill, so this file could have come out of the real pipeline.
 */
const REACHES = [{ first: 0, count: 3 }, { first: 3, count: 2 }];
const POINTS = {
  x: [-120_000, -115_200, -110_400, 200_000, 204_800],
  z: [50_000, 54_000, 58_000, -90_000, -86_400],
  level: [90_350, 90_300, 90_250, 41_200, 41_150],
  bed: [90_248, 90_192, 90_145, 41_126, 41_078],
  width: [850, 900, 875, 620, 600],
};
const PONDS = {
  x: [-1_400_000, -1_394_531, 700_000],
  z: [820_000, 820_000, -300_000],
  level: [123_400, 123_400, 56_780],
  depth: [180, 140, 60],
};
const THRESHOLD = 0.005;

function bakeTiny(): ArrayBuffer {
  const nPts = POINTS.x.length;
  const nPonds = PONDS.x.length;
  const pointBytes = nPts * 18; // four i32 arrays and one u16 array
  const beforePad = 32 + REACHES.length * 8 + pointBytes;
  const pad = (4 - (beforePad % 4)) % 4;
  const buffer = new ArrayBuffer(beforePad + pad + nPonds * 14);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46424d54, true); // 'TMBF'
  view.setUint16(4, 2, true);
  view.setUint32(8, REACHES.length, true);
  view.setUint32(12, nPts, true);
  view.setUint32(16, nPonds, true);
  view.setFloat32(20, THRESHOLD, true);
  // Offsets 6, 24 and 28 are pads and stay the zeroes the buffer
  // was born with, as do the alignment bytes after the widths.
  let at = 32;
  for (const r of REACHES) {
    view.setUint32(at, r.first, true);
    view.setUint32(at + 4, r.count, true);
    at += 8;
  }
  for (const v of POINTS.x) { view.setInt32(at, v, true); at += 4; }
  for (const v of POINTS.z) { view.setInt32(at, v, true); at += 4; }
  for (const v of POINTS.level) { view.setInt32(at, v, true); at += 4; }
  for (const v of POINTS.bed) { view.setInt32(at, v, true); at += 4; }
  for (const v of POINTS.width) { view.setUint16(at, v, true); at += 2; }
  at += pad;
  for (const v of PONDS.x) { view.setInt32(at, v, true); at += 4; }
  for (const v of PONDS.z) { view.setInt32(at, v, true); at += 4; }
  for (const v of PONDS.level) { view.setInt32(at, v, true); at += 4; }
  for (const v of PONDS.depth) { view.setUint16(at, v, true); at += 2; }
  return buffer;
}

describe('the TMBF version 2 format', () => {
  it('actually needs the pad: five stations end the widths off a boundary', () => {
    // 32 header + 16 of reaches + 5 * 18 of points = 138, and
    // 138 % 4 = 2. Without the two zero bytes the pond Int32Arrays
    // would sit at offset 138 and constructing a view there is a
    // RangeError — not wrong numbers, no numbers. If this file ever
    // decodes with the pad removed, the pad has stopped being real.
    expect(POINTS.x.length % 2).toBe(1);
    expect(bakeTiny().byteLength % 4).toBe(2);
  });

  it('round-trips every field through decodeFlow', () => {
    const flow = decodeFlow(bakeTiny());
    expect(flow.reaches).toEqual(REACHES);
    expect(Array.from(flow.x)).toEqual(POINTS.x);
    expect(Array.from(flow.z)).toEqual(POINTS.z);
    expect(Array.from(flow.level)).toEqual(POINTS.level);
    expect(Array.from(flow.bed)).toEqual(POINTS.bed);
    expect(Array.from(flow.width)).toEqual(POINTS.width);
    expect(Array.from(flow.pondX)).toEqual(PONDS.x);
    expect(Array.from(flow.pondZ)).toEqual(PONDS.z);
    expect(Array.from(flow.pondLevel)).toEqual(PONDS.level);
    expect(Array.from(flow.pondDepth)).toEqual(PONDS.depth);
    expect(flow.threshold).toBeCloseTo(THRESHOLD, 6);
  });

  it('rejects a file that is not TMBF', () => {
    const bad = bakeTiny();
    new DataView(bad).setUint32(0, 0x46424d55, true); // one bit off
    expect(() => decodeFlow(bad)).toThrow();
  });

  it('rejects version 1 — the format without the alignment guarantee', () => {
    const bad = bakeTiny();
    new DataView(bad).setUint16(4, 1, true);
    expect(() => decodeFlow(bad)).toThrow();
  });

  it('rejects a truncated file instead of reading past its end', () => {
    const whole = bakeTiny();
    expect(() => decodeFlow(whole.slice(0, whole.byteLength - 4))).toThrow();
    expect(() => decodeFlow(new ArrayBuffer(8))).toThrow();
  });
});

describe('the shipped bake', () => {
  let flow: Flow;

  beforeAll(() => {
    const file = readFileSync(ASSET);
    flow = decodeFlow(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
    );
    useFlow(flow);
  });

  afterAll(() => {
    forgetFlow();
  });

  describe('carries an island of water, not a bug that decodes', () => {
    it('is version 2, thresholded near 0.005 m³/s, and not empty', () => {
      // Getting here at all means decodeFlow accepted the version.
      // The counts are loose on purpose — a re-bake may move them —
      // but a bake with a handful of reaches is a broken bake.
      expect(flow.reaches.length).toBeGreaterThan(100);
      expect(flow.x.length).toBeGreaterThan(10_000);
      expect(flow.pondX.length).toBeGreaterThan(100);
      expect(flow.threshold).toBeCloseTo(0.005, 4);
    });

    it('writes the surface below its own bed only where a pond owns the water', () => {
      // Inside a pond the reach tucks exactly two units under the spill
      // level ON PURPOSE, so the pond sheet wins the depth test instead
      // of a raised band crossing every lake. Anywhere else, a level
      // under the bed is water drawn inside a hillside.
      let first = '';
      for (let p = 0; p < flow.level.length; p++) {
        const under = flow.bed[p] - flow.level[p];
        if (under <= 0) continue;
        if (under <= 2 && pondLevelAt(flow.x[p], flow.z[p]) !== null) continue;
        if (!first) first = `station ${p}: level ${flow.level[p]} under bed ${flow.bed[p]}`;
      }
      expect(first).toBe('');
    });

    it('keeps the channel depth law, with its two named exceptions', () => {
      // The law is depth = clip(0.12 * width, 30, 250). Two behaviours
      // are sanctioned by design, and this test names them instead of
      // loosening the bound until nothing fails: INSIDE A POND the
      // reach tucks two units under the spill so the pond owns the
      // pixel, and JUST DOWNSTREAM of one the stream leaves at the
      // pond's surface, hugs the bed, and only deepens as the ground
      // falls away. The monotonic clamp can also shave a station a few
      // units where a stream widens on near-flat ground. So: hard
      // bounds everywhere (never more than 2 under bed, never over
      // 250 deep), and the 25-unit floor asserted STATISTICALLY -- if
      // the bake and channelDepth() drift apart, far more than 2% of
      // stations move.
      let shallow = 0;
      let first = '';
      for (let p = 0; p < flow.level.length; p++) {
        const deep = flow.level[p] - flow.bed[p];
        if (deep < -2 || deep > 250) {
          if (!first) first = `station ${p}: ${deep} deep at width ${flow.width[p]}`;
        }
        // Pond-owned stations are licensed shallow by the tuck rule and
        // tested by name above; counting them here would double-charge
        // them against a budget meant for the OUTLET hug. Measured on
        // the shipped bake: 3,331 tucks and 627 hugs — the hugs are
        // 0.84% of all stations, and drift between the bake and
        // channelDepth() would move far more than 2%.
        if (deep < 25 && pondLevelAt(flow.x[p], flow.z[p]) === null) shallow++;
      }
      expect(first).toBe('');
      expect(shallow / flow.level.length).toBeLessThan(0.02);
    });

    it('never steps uphill downstream, except the two-unit rebound off a pond tuck', () => {
      // Water that rises along its own reach is water drawn through a
      // hillside somewhere. One rise is sanctioned: a ponded station is
      // written two units UNDER the spill, and the next station leaves
      // the pond AT the spill -- a rebound of at most two units, only
      // ever off a station a pond owns. Two centimetres, underwater,
      // invisible; a rise anywhere else is the real fault.
      let first = '';
      for (const reach of flow.reaches) {
        for (let i = 1; i < reach.count; i++) {
          const p = reach.first + i;
          const rise = flow.level[p] - flow.level[p - 1];
          if (rise <= 0) continue;
          const offTuck = rise <= 2
            && pondLevelAt(flow.x[p - 1], flow.z[p - 1]) !== null;
          if (!offTuck && !first) {
            first = `station ${p} rises ${rise} above upstream`;
          }
        }
      }
      expect(first).toBe('');
    });

    it('writes widths a channel could actually have', () => {
      // 60 units is the narrowest rill worth a slab; 3,300 is wider
      // than any real Kauai river at this threshold. A width outside
      // this range is a unit mistake, and u16 truncation is exactly
      // how one would arrive.
      let first = '';
      for (let p = 0; p < flow.width.length; p++) {
        if (flow.width[p] < 60 || flow.width[p] > 3300) {
          if (!first) first = `station ${p}: width ${flow.width[p]}`;
        }
      }
      expect(first).toBe('');
    });
  });

  describe('asked where the water is', () => {
    it('answers a pond at its own cell with its own spill level', () => {
      const n = flow.pondX.length;
      for (const i of [0, n >> 2, n >> 1, (3 * n) >> 2, n - 1]) {
        const level = flow.pondLevel[i];
        // The cell map is exact — this coordinate IS the pond.
        expect(pondLevelAt(flow.pondX[i], flow.pondZ[i])).toBe(level);
        // waterLevelAt may stand HIGHER — a channel running through a
        // pond wins the max — but never lower, and never dry.
        const water = waterLevelAt(flow.pondX[i], flow.pondZ[i]);
        expect(water).not.toBeNull();
        if (water === null) continue;
        expect(water).toBeGreaterThanOrEqual(level);
      }
    });

    it('stands at or above the bed at every sampled station', () => {
      let asserted = 0;
      for (let r = 0; r < flow.reaches.length; r += 37) {
        const reach = flow.reaches[r];
        if (reach.count < 2) continue;
        const p = reach.first + (reach.count >> 1);
        const water = waterLevelAt(flow.x[p], flow.z[p]);
        // A station the index cannot find is the 11.7% bug again:
        // water she can be pushed by with nothing answering for it.
        expect(water).not.toBeNull();
        if (water === null) continue;
        expect(water).toBeGreaterThanOrEqual(flow.bed[p]);
        asserted++;
      }
      expect(asserted).toBeGreaterThan(50);
    });

    it('does not claim the open ocean', () => {
      // A kilometre off the south coast, far outside any valley. The
      // level field owns rivers and ponds; the sea belongs to the sea.
      // Null is the right answer, and a level at or below zero-ground
      // is tolerable — anything above it would draw fresh water over
      // open ocean.
      const sea = waterLevelAt(0, 2_700_000);
      if (sea !== null) expect(sea).toBeLessThanOrEqual(0);
    });

    it('runs the current between 10 and 150 down the thread', () => {
      // Speed law: clip(180 * sqrt(grade), 10, 150), shaped across the
      // channel by thread = 1 - (off / halfWidth)^2. Dividing the
      // measured magnitude by the thread recovers the clipped speed
      // exactly, so the bounds hold with no slack for where in the
      // channel the ranking happened to land us.
      let asserted = 0;
      for (let r = 0; r < flow.reaches.length; r += 37) {
        const reach = flow.reaches[r];
        if (reach.count < 2) continue;
        const p = reach.first + (reach.count >> 1);
        const spot = flowAt(flow.x[p], flow.z[p]);
        expect(spot).not.toBeNull();
        if (spot === null) continue;
        const magnitude = Math.hypot(spot.flowX, spot.flowZ);
        expect(magnitude).toBeLessThanOrEqual(150 + 1e-6);
        const across = spot.off / (spot.width / 2);
        const thread = Math.max(0, 1 - across * across);
        // Near a junction a higher neighbour may claim the point off
        // its own centreline; only judge the law where the thread is
        // strong enough to read it back.
        if (thread < 0.9) continue;
        expect(magnitude / thread).toBeGreaterThanOrEqual(10 - 1e-6);
        expect(magnitude / thread).toBeLessThanOrEqual(150 + 1e-6);
        asserted++;
      }
      expect(asserted).toBeGreaterThan(50);
    });
  });
});

describe('slabHalf, the one claim both sides share', () => {
  // The drawn slab and the index use the SAME half-width. The last
  // release split them and 11.7% of the pushable water had nothing
  // drawn over it; these three facts are the shape of the one number.
  it('never narrows as the channel widens', () => {
    let prev = slabHalf(0);
    for (let w = 20; w <= 4000; w += 20) {
      const half = slabHalf(w);
      expect(half).toBeGreaterThanOrEqual(prev);
      prev = half;
    }
  });

  it('floors at 290 for the narrowest channel the bake writes', () => {
    // 60 * 1.5 + 200. Even a rill claims well past its true banks,
    // because the slab must outlive the terrain clipping into it.
    expect(slabHalf(60)).toBe(290);
  });

  it('caps at 2600 so a river mouth cannot claim half a coast', () => {
    expect(slabHalf(1600)).toBe(2600); // the knee: 1600 * 1.5 + 200
    expect(slabHalf(3300)).toBe(2600);
  });
});
