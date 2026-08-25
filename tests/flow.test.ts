/**
 * THE WATER IS A LEVEL FIELD, AND THIS FILE HOLDS IT TO THE CONTRACT.
 *
 * TMBF version 3 stores, for every river station, the surface the water
 * stands at (LEVEL), the bake's filled ground under it (BED), the TRUE
 * hydraulic channel (WIDTH), and — new — how far the water actually
 * reaches either side of the centreline, LEFT and RIGHT of the direction
 * of travel. The renderer draws flat slabs at LEVEL out to those
 * half-widths and lets the terrain clip them, and waterLevelAt() is the
 * one answer to wet/dry/depth that rendering and gameplay both read.
 * Every comparison here is in raw world units at relief 1 — LEVEL and
 * BED scale together, so the relief slider cannot change a verdict.
 *
 * AND THE GROUND IS CARVED AGAIN, which reverses what this header said
 * for two versions. `carve.ts` cuts a bounded trench along every
 * centreline, so BED is now the bottom of that trench rather than the
 * priority-flood surface, and LEVEL - BED is the true depth of the
 * water rather than a law applied to a width. Two versions of not
 * cutting proved the case: an island with no channels gives water
 * nowhere to sit, so it spreads across every flat valley floor it can
 * reach — 20.9% of Kauai, at the end of it.
 *
 * WHY LEFT AND RIGHT EXIST, written down here next to the numbers that
 * prove it. WIDTH is honest and tiny — a median of 0.60 m across this
 * island — and slabHalf() turned it into a 5.8 m ribbon, while the
 * ground either side of a station stays BELOW the water surface for a
 * median of about 106 m. Over 598 sampled stations, 92.6% had their
 * wetted reach cut off by the EDGE OF THE SLAB rather than by the
 * terrain: the water looked narrow because we drew it narrow.
 * `scripts/bakeWidth.ts` walks outward on the ground the game draws
 * until the water has a reason to stop. Unbounded and uncarved that
 * took the median full width from 5.8 m to 53.5 m; with a bed cut for
 * it the same march comes back at 6.3 m, because the trench stops it.
 * The tests below still have to tell a file that pass wrote from one it
 * did not, because a bake WITHOUT it loads perfectly, decodes
 * perfectly, and draws water at the wrong height over an uncut floor —
 * a failure that looks like nothing changed.
 *
 * The synthetic bake below has FIVE stations on purpose. Five is odd, so
 * the u16 arrays end two bytes short of a four-byte boundary and the
 * pond Int32Arrays cannot be viewed at all without the pad the format
 * guarantees. Version 1 had no pad and decoded anyway, because its bake
 * happened to write 74,962 stations — even, by luck. This file is where
 * that stops being luck. Version 3 puts THREE u16 arrays where version 2
 * had one, which is six bytes a station and so leaves the parity exactly
 * where it was; that is a coincidence and not a rule, so the fixture
 * asserts where the cursor ACTUALLY lands rather than trusting the
 * arithmetic to keep coming out even.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeFlow, flowAt, flowBytes, forgetFlow, halfAt, pondLevelAt,
  slabHalf, UNMEASURED, useFlow, waterLevelAt,
  type Flow,
} from '../src/world/flow';
import { trenchDepth, trenchWidth } from '../src/world/carve';

const ASSET = fileURLToPath(new URL('../public/kauai-flow.bin', import.meta.url));

/** bakeWidth.ts's CAP: three hundred metres and no further, per side. */
const MEASURED_CAP = 30_000;

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
/**
 * The measured half-widths, chosen to be every case halfAt() has to tell
 * apart rather than to be plausible hydrology. Their slab floors are
 * 1475, 1550, 1512.5, 1130 and 1100, so station 0 is measured wider on
 * both sides; station 1 sits EXACTLY on its floor on the right; station
 * 2 is measured NARROWER than slabHalf would answer on the left, which
 * halfAt() must now report AS MEASURED rather than lifting — the floor
 * went when the bed came in, because a floor over a cut channel claims
 * water past its own bank; station 3 was never
 * marched at all on the left; and station 4 is at the 300 m cap on one
 * side and under its floor on the other. Left and right differ at every
 * station but the third, so a decoder that read one array into the other
 * would come back with the wrong numbers rather than with a symmetry
 * nobody notices.
 */
const LEFT = [4_200, 9_000, 1_200, UNMEASURED, 30_000];
const RIGHT = [7_000, 1_550, 26_000, 640, 300];
const PONDS = {
  x: [-1_400_000, -1_394_531, 700_000],
  z: [820_000, 820_000, -300_000],
  level: [123_400, 123_400, 56_780],
  depth: [180, 140, 60],
};
const THRESHOLD = 0.005;

/**
 * Where the point block ends and the alignment pad begins. Four i32
 * arrays and three u16 arrays is 22 bytes a station: 32 + 16 + 110 =
 * 158, which is two short of a boundary. bakeTiny() checks its own
 * cursor against this before it pads, so the constant cannot quietly
 * drift away from the bytes actually written.
 */
const BEFORE_PAD = 32 + REACHES.length * 8 + POINTS.x.length * 22;

function bakeTiny(): ArrayBuffer {
  const nPts = POINTS.x.length;
  const nPonds = PONDS.x.length;
  const pad = (4 - (BEFORE_PAD % 4)) % 4;
  const buffer = new ArrayBuffer(BEFORE_PAD + pad + nPonds * 14);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46424d54, true); // 'TMBF'
  view.setUint16(4, 3, true);
  view.setUint32(8, REACHES.length, true);
  view.setUint32(12, nPts, true);
  view.setUint32(16, nPonds, true);
  view.setFloat32(20, THRESHOLD, true);
  // Offsets 6, 24 and 28 are pads and stay the zeroes the buffer was
  // born with, as do the alignment bytes after the half-widths.
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
  for (const v of LEFT) { view.setUint16(at, v, true); at += 2; }
  for (const v of RIGHT) { view.setUint16(at, v, true); at += 2; }
  if (at !== BEFORE_PAD) throw new Error(`fixture wrote ${at} bytes, not ${BEFORE_PAD}`);
  at += pad;
  for (const v of PONDS.x) { view.setInt32(at, v, true); at += 4; }
  for (const v of PONDS.z) { view.setInt32(at, v, true); at += 4; }
  for (const v of PONDS.level) { view.setInt32(at, v, true); at += 4; }
  for (const v of PONDS.depth) { view.setUint16(at, v, true); at += 2; }
  return buffer;
}

describe('the TMBF version 3 format', () => {
  it('actually needs the pad: five stations end the half-widths off a boundary', () => {
    // 32 header + 16 of reaches + 5 * 22 of points = 158, and 158 % 4 =
    // 2. Without the two zero bytes the pond Int32Arrays would sit at
    // offset 158 and constructing a view there is a RangeError — not
    // wrong numbers, no numbers. Version 3 added two more u16 arrays and
    // left that parity untouched, which is exactly the kind of luck
    // version 1 ran on, so the fixture asserts the offset itself.
    expect(POINTS.x.length % 2).toBe(1);
    expect(BEFORE_PAD % 4).toBe(2);
    // And the size the decoder demands is worked out from the counts by
    // flowBytes(), which has never met this fixture. Two independent
    // arithmetics on one buffer: if either drifts, they disagree here
    // instead of in a RangeError from the middle of a constructor.
    expect(bakeTiny().byteLength)
      .toBe(flowBytes(REACHES.length, POINTS.x.length, PONDS.x.length));
  });

  it('round-trips every field through decodeFlow', () => {
    const flow = decodeFlow(bakeTiny());
    expect(flow.reaches).toEqual(REACHES);
    expect(Array.from(flow.x)).toEqual(POINTS.x);
    expect(Array.from(flow.z)).toEqual(POINTS.z);
    expect(Array.from(flow.level)).toEqual(POINTS.level);
    expect(Array.from(flow.bed)).toEqual(POINTS.bed);
    expect(Array.from(flow.width)).toEqual(POINTS.width);
    expect(Array.from(flow.left)).toEqual(LEFT);
    expect(Array.from(flow.right)).toEqual(RIGHT);
    expect(Array.from(flow.pondX)).toEqual(PONDS.x);
    expect(Array.from(flow.pondZ)).toEqual(PONDS.z);
    expect(Array.from(flow.pondLevel)).toEqual(PONDS.level);
    expect(Array.from(flow.pondDepth)).toEqual(PONDS.depth);
    expect(flow.threshold).toBeCloseTo(THRESHOLD, 6);
  });

  it('reads halfAt off the measurement, or off the sentinel, by hand', () => {
    // Side -1 is LEFT of the direction of travel and +1 is RIGHT, which
    // is the convention FlowWater.ts's strip already runs on: it offsets
    // by (-dz, dx) * half * side, so +1 is the +n side. This fails if
    // either the sides or the fallback are wired the other way round.
    //
    // A MEASUREMENT IS REPORTED AS MEASURED, high or low. slabHalf is
    // the answer for a station nobody walked and nothing else; it was a
    // floor under every value until `carve.ts` cut a bed, and a floor
    // over a cut channel claims water past its own bank. Station 2's
    // left and station 3's right are both under what slabHalf would
    // say, and both come back untouched — that is the whole reversal,
    // in two lines.
    const flow = decodeFlow(bakeTiny());
    expect(halfAt(flow, 0, -1)).toBe(4_200);
    expect(halfAt(flow, 0, 1)).toBe(7_000);
    expect(halfAt(flow, 1, 1)).toBe(1_550);
    expect(halfAt(flow, 2, -1)).toBe(1_200);   // under slabHalf's 1512.5
    expect(halfAt(flow, 2, 1)).toBe(26_000);
    expect(halfAt(flow, 3, 1)).toBe(640);      // under slabHalf's 1130
    // The one station never marched, which is the only case slabHalf
    // still answers. Asserted twice on purpose: once against the
    // function, so the fallback is really slabHalf, and once against
    // the number, so slabHalf itself cannot drift unnoticed.
    expect(halfAt(flow, 3, -1)).toBe(slabHalf(POINTS.width[3]));
    expect(halfAt(flow, 3, -1)).toBe(1_130);
    expect(halfAt(flow, 4, -1)).toBe(30_000);  // the 300 m cap
    expect(halfAt(flow, 4, 1)).toBe(300);
  });

  it('rejects a file that is not TMBF', () => {
    const bad = bakeTiny();
    new DataView(bad).setUint32(0, 0x46424d55, true); // one bit off
    expect(() => decodeFlow(bad)).toThrow();
  });

  it('rejects the older versions, which would decode at the wrong offsets', () => {
    // Version 1 is the format without the alignment guarantee. Version 2
    // is the sharper danger: it is byte-for-byte a version 3 file minus
    // the LEFT and RIGHT arrays, so a v2 file read as v3 would take six
    // bytes a station out of the pond block and hand back pond
    // coordinates that are really widths — plausible-looking numbers in
    // the wrong places, which is precisely the class of fault a version
    // number exists to catch before a length check can.
    for (const version of [1, 2]) {
      const bad = bakeTiny();
      new DataView(bad).setUint16(4, version, true);
      expect(() => decodeFlow(bad)).toThrow();
    }
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
    it('is version 3, thresholded near 0.005 m³/s, and not empty', () => {
      // Getting here at all means decodeFlow accepted the version.
      // The counts are loose on purpose — a re-bake may move them —
      // but a bake with a handful of reaches is a broken bake.
      expect(flow.reaches.length).toBeGreaterThan(100);
      expect(flow.x.length).toBeGreaterThan(10_000);
      expect(flow.pondX.length).toBeGreaterThan(100);
      expect(flow.threshold).toBeCloseTo(0.005, 4);
      // The two new arrays are per-station, and a decoder that sized
      // them from anything else would still produce a file that loads.
      expect(flow.left.length).toBe(flow.x.length);
      expect(flow.right.length).toBe(flow.x.length);
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

    it('still tucks stations under the ponds that own them, for FlowWater to collapse', () => {
      // FlowWater.ts reads `level < bed` as the flag that a pond owns
      // this water and collapses the station's slab to a ZERO
      // half-width, so every triangle in the run is degenerate and the
      // pond sheet has the pixels to itself. Winning the depth test was
      // not enough on its own: the slab is transparent, so it drew
      // first, the pond blended over it, and Joshua saw a darker band
      // across the lake. bakeWidth.ts now rewrites every level in the
      // file, and if its lift ever reached a tucked station the flag
      // would vanish, the collapse would stop firing, and the band
      // would come back with nothing in this suite to say why. The bake
      // ships 3,331 of these; a hundred is the loose floor, because a
      // re-bake moves the count and zero is the only value that means
      // the mechanism is gone.
      let tucked = 0;
      for (let p = 0; p < flow.level.length; p++) {
        if (flow.level[p] < flow.bed[p]) tucked++;
      }
      expect(tucked).toBeGreaterThan(100);
    });

    it('cuts each bed exactly one trench depth under its own water', () => {
      // THE LAW CHANGED WHEN THE GROUND DID, and this says so rather
      // than widening a bound until nothing fails. Until version 3
      // nothing was carved, so BED was the priority-flood surface and
      // LEVEL was that plus clip(0.12 * width, 30, 250) — a stream
      // finding its own height over ground nobody had cut for it.
      // `carve.ts` cuts a bed now, so BED is the bottom of that trench
      // and the law is exact rather than approximate:
      //
      //     level - bed === trenchDepth(trenchWidth(width))
      //
      // which is Joshua's rule — as deep as it is wide, never over a
      // metre — with the width scaled for a player who is a centimetre
      // long. Exact because bakeWidth.ts writes the bed FROM the level
      // by subtracting that number, so any drift at all means the two
      // have stopped being written together.
      //
      // It is also the discriminator this whole suite needs. A file
      // bakeFlow.py wrote and bakeWidth.ts never touched carries
      // channelDepth() here instead, which for the median 0.6 m channel
      // is 30 units against this law's 100. The old width comparison
      // cannot tell them apart any more — a trench-contained stream and
      // an unmeasured one both come out at the slab floor — so the
      // depth is what proves the second pass ran.
      let first = '';
      let checked = 0;
      for (let p = 0; p < flow.level.length; p++) {
        // A pond owns its own water and keeps the two-unit tuck that
        // says so; the trench is not cut through a lake floor and no
        // depth law applies there. Tested by name in its own case above.
        if (pondLevelAt(flow.x[p], flow.z[p]) !== null) continue;
        checked++;
        const deep = flow.level[p] - flow.bed[p];
        const law = Math.round(trenchDepth(trenchWidth(flow.width[p])));
        if (deep !== law && !first) {
          first = `station ${p}: ${deep} deep at width ${flow.width[p]}, law ${law}`;
        }
      }
      expect(first).toBe('');
      // And it really did look at the island rather than at nothing.
      expect(checked).toBeGreaterThan(50_000);
    });

    it('never steps uphill downstream, except off a pond tuck by the tuck plus the lift', () => {
      // Water that rises along its own reach is water drawn through a
      // hillside somewhere. One rise is sanctioned, and version 3 made
      // it bigger. A ponded station is written two units UNDER the
      // spill and bakeWidth.ts never touches it; the station leaving
      // the pond is unponded and may have been raised by as much as a
      // metre to clear the drawn ground. Two of tuck plus a hundred of
      // lift is 102, and nothing can add to that: the repair pass only
      // ever raises a station to a downstream level that is itself at
      // most a metre above a level no higher than this one. Measured on
      // the file before the lift, 394 rises, every one of two units or
      // less and every one off a station a pond owns. A metre,
      // underwater, at the mouth of a lake; a rise anywhere else, or a
      // larger one here, is the real fault.
      let first = '';
      for (const reach of flow.reaches) {
        for (let i = 1; i < reach.count; i++) {
          const p = reach.first + i;
          const rise = flow.level[p] - flow.level[p - 1];
          if (rise <= 0) continue;
          // EITHER END being pond-owned voids the comparison, not just
          // the upstream one. A tucked station is written two units
          // under its spill so the pond sheet wins the pixel; that
          // number is a rendering trick and not a water surface, so a
          // step measured against it says nothing about whether water
          // runs uphill. The old form asked only about the upstream
          // station and so charged the bake for steps INTO a lake as
          // well as out of one.
          const atPond = pondLevelAt(flow.x[p], flow.z[p]) !== null
            || pondLevelAt(flow.x[p - 1], flow.z[p - 1]) !== null;
          if (!atPond && !first) {
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

  describe('was measured for how wide to draw it', () => {
    it('stores a measurement or the sentinel, and nothing that could pass for either', () => {
      // UNMEASURED is 0xFFFF and a march stops at 30,000, so there is a
      // clean 35,000-unit gap between the widest thing bakeWidth.ts can
      // write and the value bakeFlow.py leaves behind. A number in that
      // gap is a number nobody meant, and the sentinel would stop being
      // unambiguous the moment one appeared.
      //
      // Then: NONE of them may still be the sentinel. The reaches
      // partition the station list contiguously — 74,962 stations, every
      // one in exactly one reach — and bakeWidth.ts walks every station
      // of every reach, so a surviving sentinel means the second pass
      // never ran over this file. That is the failure that looks like
      // nothing changed, and it is the one this whole describe block is
      // here to catch.
      let first = '';
      let unmeasured = 0;
      for (let p = 0; p < flow.left.length; p++) {
        for (const v of [flow.left[p], flow.right[p]]) {
          if (v === UNMEASURED) { unmeasured++; continue; }
          if (v > MEASURED_CAP && !first) first = `station ${p}: half-width ${v}`;
        }
      }
      expect(first).toBe('');
      expect(unmeasured).toBe(0);
    });

    it('never claims wider than the bed that was cut for it', () => {
      // THE INVARIANT THAT REPLACED THE FLOOR. Version 3 floored every
      // measurement at slabHalf and called the change strictly a
      // widening, which was right while nothing was carved: the water
      // had no bed, so an extra metre was a metre the terrain would
      // clip anyway. `carve.ts` cut a bed and reversed the direction.
      // A claim past the bank is water she can walk into that was never
      // drawn — Joshua, from the air: "some spots look like land, but
      // suddenly turn into water when I try to land on it" — so the
      // trench, plus the two metres of overshoot the terrain is meant
      // to clip, is now a ceiling and not a floor.
      const MARGIN = 200;
      let over = '';
      let measured = 0;
      for (let p = 0; p < flow.width.length; p++) {
        const bound = trenchWidth(flow.width[p]) / 2 + MARGIN;
        for (const side of [-1, 1] as const) {
          const stored = side < 0 ? flow.left[p] : flow.right[p];
          if (stored === UNMEASURED) continue;
          measured++;
          if (stored > bound && !over) {
            over = `station ${p} side ${side}: claims ${stored} past a bank at ${bound}`;
          }
        }
      }
      expect(over).toBe('');
      expect(measured).toBeGreaterThan(100_000);
    });

    it('walked the ground rather than answering from the width alone', () => {
      // THE TEST THAT FAILS IF bakeWidth.ts NEVER RAN. A file
      // bakeFlow.py wrote and this pass never touched answers
      // slabHalf(width) on every side of every station, exactly, and
      // loads and draws while looking perfectly healthy. So the
      // discriminator is disagreement WITH slabHalf, in either
      // direction — narrower where the bed is narrow, wider where the
      // march found a real bank past it.
      let differs = 0;
      let sides = 0;
      for (let p = 0; p < flow.width.length; p++) {
        const slab = slabHalf(flow.width[p]);
        for (const side of [-1, 1] as const) {
          sides++;
          if (halfAt(flow, p, side) !== slab) differs++;
        }
      }
      // 96% of sides on the shipped file, against exactly 0% on a bake
      // of sentinels.
      expect(differs / sides).toBeGreaterThan(0.5);
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
      // open ocean. The nearest station is 8 km away, so widening the
      // claim to 300 m has not brought the island any closer to this.
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

    it('answers out at the measured edge, and pushes her nowhere once she is past the channel', () => {
      // THE CLAIM AND THE THREAD ARE TWO NUMBERS NOW, and this is the
      // test that watches both of them at once, out where they differ
      // by a factor of three hundred.
      //
      // The claim must REACH: useFlow() sizes every segment's claim from
      // halfAt(), so a point 45 m off a measured centreline has to come
      // back with a reach named for it. If the index were still sized by
      // slabHalf() the answer past 26 m would be null while the slab
      // carried on being drawn out to 300 m — which is the 11.7% fault
      // in a new costume: water on screen that she can stand in with
      // nothing underneath answering for it.
      //
      // The thread must NOT: flowAt() shapes velocity on `wide`, the
      // TRUE hydraulic channel, and never on `claim`. The widest channel
      // in the bake is 3,083 units across, so 15.4 m of half-channel;
      // sample at 45 m and whichever segment wins the ranking, the point
      // is far outside its own channel and the parabola has run out. The
      // current there must be exactly zero. A current on ground she is
      // merely standing in is the founding fault the whole level-field
      // rebuild exists to remove, and widening what we DRAW must never
      // widen what PUSHES.
      // SAMPLED HARDER RATHER THAN JUDGED SOFTER. The 5,000-unit gate
      // below is the discriminator and it stays exactly where it is;
      // what changed is that bakeWidth.ts's SPREAD bound leaves fewer
      // stations that wide, so a stride of 7 by 11 found only 24 of
      // them and the run failed on its sample size rather than on the
      // thing it tests. Lowering the bar would have thrown the
      // discriminator away to keep a green tick. Walking more of the
      // island keeps it.
      let answered = 0;
      let outside = 0;
      for (let r = 0; r < flow.reaches.length; r += 3) {
        const reach = flow.reaches[r];
        if (reach.count < 2) continue;
        for (let i = 0; i < reach.count; i += 5) {
          const p = reach.first + i;
          // The reach's own direction of travel, from the neighbours
          // either side, exactly as bakeWidth.ts marched and as
          // FlowWater.ts builds its strip: side +1 offsets by (-dz, dx),
          // so +1 is RIGHT and -1 is LEFT of travel.
          const back = reach.first + Math.max(0, i - 1);
          const fore = reach.first + Math.min(reach.count - 1, i + 1);
          let dx = flow.x[fore] - flow.x[back];
          let dz = flow.z[fore] - flow.z[back];
          const run = Math.hypot(dx, dz);
          if (run < 1e-6) continue;
          dx /= run; dz /= run;
          for (const side of [-1, 1] as const) {
            const half = halfAt(flow, p, side);
            // Wide enough that the query point lands well outside the
            // TRUE channel, which is what the zero-current claim is
            // about. Six metres was fifty before `carve.ts`, when the
            // water spread across whole valley floors; the trench caps
            // a half-width at its own bank now, and the widest on the
            // island is 22 m. On a bake of sentinels the widest
            // slabHalf can answer is 26 m, so this still clears — but
            // the counts are not what discriminates here, the current
            // is: a thread shaped on the CLAIM instead of the channel
            // would push her at the far bank, and nothing else in this
            // suite would notice.
            if (half < 600) continue;
            const out = 0.9 * half;
            const spot = flowAt(
              flow.x[p] + -dz * out * side, flow.z[p] + dx * out * side,
            );
            expect(spot).not.toBeNull();
            if (spot === null) continue;
            answered++;
            // A different, genuinely wider reach may own this point and
            // hold it inside its own channel; that is not a violation,
            // it is a confluence, so judge only the points that landed
            // outside the winner's channel.
            if (spot.off <= spot.width / 2) continue;
            outside++;
            expect(Math.hypot(spot.flowX, spot.flowZ)).toBe(0);
          }
        }
      }
      expect(answered).toBeGreaterThan(25);
      expect(outside).toBeGreaterThan(25);
    });
  });
});

describe('slabHalf, the fallback and the floor', () => {
  // Version 2 sized the drawn slab and the index claim from this one
  // number, and the release before it split them: 11.7% of the pushable
  // water had nothing drawn over it. Version 3 measures the claim
  // instead and slabHalf() became the fallback for a station nobody has
  // marched and the floor under every station somebody has — halfAt() is
  // where the two sides agree now, and these three facts are still the
  // shape of the number underneath it.
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
