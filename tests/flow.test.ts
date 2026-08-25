/**
 * THE WATER IS A LEVEL FIELD, AND THIS FILE HOLDS IT TO THE CONTRACT.
 *
 * TMBF version 3 stores, for every river station, the surface the water
 * stands at (LEVEL), the bake's filled ground under it (BED), the TRUE
 * hydraulic channel (WIDTH), and — new — how far the water actually
 * reaches either side of the centreline, LEFT and RIGHT of the direction
 * of travel. Nothing is carved: the renderer draws flat slabs at LEVEL
 * out to those half-widths and lets the terrain clip them, and
 * waterLevelAt() is the one answer to wet/dry/depth that rendering and
 * gameplay both read. Every comparison here is in raw world units at
 * relief 1 — LEVEL and BED scale together, so the relief slider cannot
 * change a verdict.
 *
 * WHY LEFT AND RIGHT EXIST, written down here next to the numbers that
 * prove it. WIDTH is honest and tiny — a median of 0.60 m across this
 * island — and slabHalf() turned it into a 5.8 m ribbon, while the
 * ground either side of a station stays BELOW the water surface for a
 * median of about 106 m. Over 598 sampled stations, 92.6% had their
 * wetted reach cut off by the EDGE OF THE SLAB rather than by the
 * terrain: the water looked narrow because we drew it narrow.
 * `scripts/bakeWidth.ts` now walks outward on the ground the game draws
 * until the water has a reason to stop, and the median full width goes
 * 5.8 m -> 49.8 m, p95 165 m. The tests below have to be able to tell a
 * file that pass wrote from one it did not, because a bake WITHOUT it
 * loads perfectly, decodes perfectly, and draws exactly the old narrow
 * water — a failure that looks like nothing changed.
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
  channelDepth, decodeFlow, flowAt, flowBytes, forgetFlow, halfAt, pondLevelAt,
  slabHalf, UNMEASURED, useFlow, waterLevelAt,
  type Flow,
} from '../src/world/flow';

const ASSET = fileURLToPath(new URL('../public/kauai-flow.bin', import.meta.url));

/**
 * The most `scripts/bakeWidth.ts` may raise one station's level, from
 * its own LIFT_CAP — a metre. Written out here rather than imported,
 * deliberately: this file is the thing checking the bake kept to its
 * ceiling, and a test that imports the ceiling agrees with whatever the
 * script currently says instead of with what was decided.
 */
const LIFT_CAP = 100;
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
 * 2 is measured NARROWER than its floor on the left, which the real bake
 * never writes and halfAt() must lift anyway; station 3 was never
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

/**
 * Middle value of a column, sorted once. Sorted rather than selected
 * because these columns are 74,962 long and the clarity is worth more
 * than the milliseconds; the bake's own report does it the same way.
 */
function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
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

  it('reads halfAt off the measurement, the sentinel, and the floor, by hand', () => {
    // Side -1 is LEFT of the direction of travel and +1 is RIGHT, which
    // is the convention FlowWater.ts's strip already runs on: it offsets
    // by (-dz, dx) * half * side, so +1 is the +n side. Every number
    // below is slabHalf(width) = width * 1.5 + 200 worked out by hand
    // against the fixture, so this fails if either the sides or the
    // fallback are wired the other way round.
    const flow = decodeFlow(bakeTiny());
    expect(halfAt(flow, 0, -1)).toBe(4_200);   // measured, over its 1475 floor
    expect(halfAt(flow, 0, 1)).toBe(7_000);
    expect(halfAt(flow, 1, 1)).toBe(1_550);    // measured, exactly its floor
    expect(halfAt(flow, 2, -1)).toBe(1_512.5); // measured UNDER the floor: floored
    expect(halfAt(flow, 2, 1)).toBe(26_000);
    expect(halfAt(flow, 3, -1)).toBe(slabHalf(POINTS.width[3])); // never marched
    expect(halfAt(flow, 3, -1)).toBe(1_130);
    expect(halfAt(flow, 3, 1)).toBe(1_130);    // measured 640, floored to the same
    expect(halfAt(flow, 4, -1)).toBe(30_000);  // the 300 m cap survives the floor
    expect(halfAt(flow, 4, 1)).toBe(1_100);
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

    it('keeps the channel depth law as a FLOOR now, plus the metre bakeWidth may lift', () => {
      // The law bakeFlow.py writes is depth = clip(0.12 * width, 30,
      // 250), and until version 3 it was an equality. It is not one any
      // more, and saying so plainly is the point of this rewrite: a
      // test that silently loosens is worse than one that fails.
      // bakeWidth.ts lifts a station's level to a ten-centimetre skin
      // over the ground the game DRAWS, because the bed is a 4x4 cell
      // average while the drawn triangle carries every noise octave on
      // top of it — 7.4% of stations came out dry at their own
      // centreline, and a march outward from a hole in the stream
      // measures nothing at all. That lift is capped at a metre. The
      // pass that then restores non-increasing-downstream can only
      // raise a station to a downstream neighbour's lifted level, and
      // the bake's own levels are already non-increasing within every
      // unponded run — measured on the shipped file, that repair adds
      // nothing whatever beyond the lift — so a metre is the whole of
      // it. Two units of slack on top for the rounding the bake always
      // had, one from LEVEL's and one from BED's, measured at 1.04 at
      // its worst today.
      //
      // BELOW the law is where the two sanctioned behaviours live, and
      // this names them rather than widening the bound until nothing
      // fails. INSIDE A POND the reach tucks two units under the spill
      // so the pond owns the pixel. JUST DOWNSTREAM of one the stream
      // leaves at the pond's surface, hugs the bed, and only deepens as
      // the ground falls away; that hug cannot be told from its
      // neighbours station by station, so it is bounded by count
      // instead — 627 of them, which is 0.84% of stations under a flat
      // 25-unit floor and 1.14% under their own channelDepth, against a
      // 2% budget that any drift between the bake and channelDepth()
      // would blow straight through. The lift only ever RAISES a level,
      // so both counts can only fall from where they are measured here.
      let first = '';
      let shallow = 0;
      let underLaw = 0;
      for (let p = 0; p < flow.level.length; p++) {
        const deep = flow.level[p] - flow.bed[p];
        const law = channelDepth(flow.width[p]);
        if (deep < -2 || deep > law + LIFT_CAP + 2) {
          if (!first) {
            first = `station ${p}: ${deep} deep at width ${flow.width[p]}, law ${law}`;
          }
        }
        // Pond-owned stations are licensed shallow by the tuck rule and
        // tested by name above; counting them here would double-charge
        // them against a budget meant for the OUTLET hug.
        if (pondLevelAt(flow.x[p], flow.z[p]) !== null) continue;
        if (deep < 25) shallow++;
        if (deep < law - 2) underLaw++;
      }
      expect(first).toBe('');
      expect(shallow / flow.level.length).toBeLessThan(0.02);
      expect(underLaw / flow.level.length).toBeLessThan(0.02);
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
          const offTuck = rise <= LIFT_CAP + 2
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

    it('never stores less than the slab it replaced, so nothing regressed', () => {
      // THE FLOOR IS TODAY'S SLAB. bakeWidth.ts takes
      // max(slabHalf(width), march) before it rounds, which makes the
      // move to measured widths strictly a widening: whatever the
      // ground says, no station comes out narrower than it drew before.
      // Checked on the STORED number rather than on halfAt(), because
      // halfAt() applies the same floor itself and would answer
      // correctly over a bake that had forgotten it — the floor has two
      // owners on purpose, and this is the one that can be caught
      // skipping. slabHalf() is a half-unit number wherever width is
      // odd, and Math.round takes that half upward, so the floor
      // survives the rounding as an integer and needs no slack.
      //
      // Then halfAt() itself, which is where the drawn slab and the
      // index claim agree: the sentinel answers slabHalf() exactly, and
      // a measurement answers ITSELF exactly. That second equality is
      // not a restatement of the implementation — it holds only because
      // the stored value cleared the floor, so it fails loudly on a
      // bake that wrote a raw march distance straight out of reachOut().
      let below = '';
      let wrong = '';
      for (let p = 0; p < flow.left.length; p++) {
        const floor = slabHalf(flow.width[p]);
        for (const side of [-1, 1] as const) {
          const stored = side < 0 ? flow.left[p] : flow.right[p];
          const half = halfAt(flow, p, side);
          if (stored !== UNMEASURED && stored < floor && !below) {
            below = `station ${p} side ${side}: stored ${stored} under its ${floor} floor`;
          }
          const want = stored === UNMEASURED ? floor : stored;
          if (half !== want && !wrong) {
            wrong = `station ${p} side ${side}: halfAt ${half}, stored ${stored}, floor ${floor}`;
          }
          if (half < floor && !wrong) {
            wrong = `station ${p} side ${side}: halfAt ${half} under its ${floor} floor`;
          }
        }
      }
      expect(below).toBe('');
      expect(wrong).toBe('');
    });

    it('draws water measurably wider than the thread it used to', () => {
      // THE TEST THAT FAILS IF bakeWidth.ts NEVER RAN. Sentinels
      // everywhere would still load, still decode, and still draw — at
      // exactly the old width, because halfAt() would fall back to
      // slabHalf() at every station and the two medians below would come
      // out identical. So the assertion is the COMPARISON and not a
      // number in isolation. Measured over 598 sampled stations, the
      // full drawn width goes from a median of 5.8 m to 49.8 m, p95
      // 165 m, max 347 m, with 9.0% of stations held at today's width in
      // steep gorges and 0.5% of sides against the 300 m cap. Twenty
      // metres of median is comfortably above the 5.8 m thread and
      // comfortably below the 49.8 m measured, so it survives a re-bake
      // moving the distribution about without surviving the pass being
      // skipped.
      const slab: number[] = [];
      const drawn: number[] = [];
      let widened = 0;
      for (let p = 0; p < flow.width.length; p++) {
        const before = slabHalf(flow.width[p]) * 2;
        const now = halfAt(flow, p, -1) + halfAt(flow, p, 1);
        slab.push(before);
        drawn.push(now);
        if (now > before) widened++;
      }
      // THE ABSOLUTE MOVES WITH A DIAL AND THE RELATIONSHIP DOES NOT,
      // so these pin the relationship. bakeWidth.ts's SPREAD decides
      // how many true channel widths the water may cross — game tuning,
      // Joshua's to turn — and at 32 the median comes out 19.2 m where
      // an unbounded march gave 49.8 m and the old thread gave 5.8 m.
      // An assertion written against 49.8 would have broken the moment
      // that dial moved while saying nothing about whether the pass had
      // run, which is the one thing this test is here to know.
      const wasWide = median(slab);
      const isWide = median(drawn);
      expect(wasWide).toBeLessThan(1_000);        // the 5.8 m thread, as shipped
      expect(isWide).toBeGreaterThan(1_200);      // twelve metres, against 19.2 measured
      expect(isWide).toBeGreaterThan(2 * wasWide);
      // 12.5% hold at today's width; the rest of the island widened.
      // Nothing draws nothing, which the bake also reports — but that
      // is not asserted here, because the floor test above already
      // proves every station draws at least the slab it drew before,
      // and a second, weaker way of saying so would only look like
      // cover it does not give.
      expect(widened / flow.width.length).toBeGreaterThan(0.5);
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
            // Only a side the march actually widened can separate the
            // two numbers at all: 5,000 units is 50 m, past the widest
            // half-channel on the island by more than a factor of three,
            // and past the old 26 m cap outright. On a bake where the
            // pass never ran, nothing clears this and the counts below
            // fail the test rather than passing it vacuously.
            if (half < 5_000) continue;
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
