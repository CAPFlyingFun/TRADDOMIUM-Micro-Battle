/**
 * WHAT THE WATER DOES TO HER, held to the contract.
 *
 * `flowAt` returned a current for three versions and nothing read it,
 * so she walked every stream on the island dry and at full pace. These
 * tests are what stops that being true again quietly.
 *
 * Everything is in DRAWN units — `wadeAt` takes the ground she is
 * actually standing on and compares the water against it, so the tests
 * below are asking the same question the player's eye asks.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { wadeAt } from '../src/ant/wading';
import { decodeFlow, forgetFlow, flowAt, useFlow, waterLevelAt, pondLevelAt, type Flow } from '../src/world/flow';
import { setRelief } from '../src/world/heightfield';

const ASSET = fileURLToPath(new URL('../public/kauai-flow.bin', import.meta.url));

let flow: Flow;
/** A station in real running water, with a current on it. */
let stream: { x: number; z: number; level: number };

beforeAll(() => {
  const file = readFileSync(ASSET);
  flow = decodeFlow(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  useFlow(flow);
  setRelief(1);
  for (let p = 0; p < flow.level.length; p++) {
    if (pondLevelAt(flow.x[p], flow.z[p]) !== null) continue;
    const spot = flowAt(flow.x[p], flow.z[p]);
    if (!spot || Math.hypot(spot.flowX, spot.flowZ) < 1) continue;
    stream = { x: flow.x[p], z: flow.z[p], level: flow.level[p] };
    break;
  }
});
afterAll(() => { forgetFlow(); setRelief(1); });

describe('the island the tests stand on', () => {
  it('found running water with a current on it', () => {
    // The guard that stops a re-bake turning every assertion below into
    // a comparison against undefined.
    expect(stream).toBeDefined();
    expect(waterLevelAt(stream.x, stream.z)).toBe(stream.level);
  });
});

describe('dry land', () => {
  it('does nothing at all, and says so with a null rather than a zero', () => {
    // A zero vector would still be a push of nothing every frame; null
    // is the answer that lets PlayerAnt skip the arithmetic, and it is
    // the one thing that proves wadeAt looked and found no water.
    const dry = wadeAt(stream.x, stream.z, stream.level + 500);
    expect(dry.depth).toBe(0);
    expect(dry.above).toBe(0);
    expect(dry.pace).toBe(1);
    expect(dry.carry).toBeNull();
    expect(dry.afloat).toBe(false);
  });

  it('answers the same off the island entirely, where there is no index', () => {
    const sea = wadeAt(2_600_000, 2_600_000, 0);
    expect(sea.pace).toBe(1);
    expect(sea.carry).toBeNull();
  });
});

describe('water she can still stand up in', () => {
  it('slows her without lifting her a millimetre off the bed', () => {
    // THE HOVER. `above` is what floats her, and a walking ant lifted
    // by a fraction of the water she is wading through reads as one —
    // so it must be EXACTLY zero right up to the moment her feet leave
    // the bottom, not merely small.
    for (const depth of [0.05, 0.1, 0.2, 0.39]) {
      const wade = wadeAt(stream.x, stream.z, stream.level - depth);
      expect(wade.afloat).toBe(false);
      expect(wade.above).toBe(0);
      expect(wade.pace).toBeLessThan(1);
      expect(wade.pace).toBeGreaterThanOrEqual(0.45);
    }
  });

  it('slows her further the deeper it gets, all the way to her footing', () => {
    // Monotonic, and it must actually MOVE: a constant multiplier would
    // pass a "less than 1" test and feel like nothing.
    let last = 1;
    for (let depth = 0.02; depth < 0.4; depth += 0.02) {
      const pace = wadeAt(stream.x, stream.z, stream.level - depth).pace;
      expect(pace).toBeLessThan(last);
      last = pace;
    }
    expect(last).toBeLessThan(0.5);
  });
});

describe('water over her head, which is nearly all of it', () => {
  it('floats her at the surface less her draught, at any depth', () => {
    // The trench runs a metre deep and she is a centimetre long, so a
    // stream is not something she wades — it is a surface she is stuck
    // to. Her height above the BED therefore grows with the water while
    // her height above the WATER stays put, which is what floating is.
    // Clear of the footing threshold rather than sitting on it:
    // `level - 0.4` then `level - that` does not come back as exactly
    // 0.4 in float64, and a test that trips on the boundary is testing
    // arithmetic rather than floating. The boundary itself is covered
    // by the wading case above, which walks up to 0.39.
    for (const depth of [0.5, 1, 10, 100]) {
      const wade = wadeAt(stream.x, stream.z, stream.level - depth);
      expect(wade.afloat).toBe(true);
      expect(wade.above).toBeCloseTo(depth - 0.15, 6);
      // Her eye ends up the same distance under the surface however
      // deep the trench is. That is the assertion that would catch a
      // draught accidentally scaled by depth.
      expect(depth - wade.above).toBeCloseTo(0.15, 6);
      expect(wade.pace).toBeCloseTo(0.22, 6);
    }
  });

  it('lets the current have her, harder than when she was wading', () => {
    const swimming = wadeAt(stream.x, stream.z, stream.level - 2);
    const wading = wadeAt(stream.x, stream.z, stream.level - 0.2);
    expect(swimming.carry).not.toBeNull();
    expect(wading.carry).not.toBeNull();
    const fast = Math.hypot(swimming.carry!.x, swimming.carry!.z);
    const slow = Math.hypot(wading.carry!.x, wading.carry!.z);
    expect(fast).toBeGreaterThan(slow);
    expect(fast).toBeGreaterThan(0);
  });
});

describe('the two ways this could be silently wrong', () => {
  it('moves with the relief dial, which a raw comparison would not', () => {
    // Levels are stored at relief 1 and the ground she stands on is in
    // DRAWN units, so a comparison that forgets the dial is correct at
    // the default and wrong at every other setting — the single most
    // likely bug in the file, and invisible until somebody moves the
    // slider. Asserted at a relief that is NOT 1, and asserted on the
    // VERDICT rather than the magnitude so it cannot pass by drifting.
    const ground = stream.level - 1;          // a metre under, at relief 1
    expect(wadeAt(stream.x, stream.z, ground).afloat).toBe(true);
    setRelief(0.5);
    // The water halved in height; the ground she is on did not move,
    // because the caller passes it in. She is now above the surface.
    expect(wadeAt(stream.x, stream.z, ground).depth).toBe(0);
    expect(wadeAt(stream.x, stream.z, ground).pace).toBe(1);
    setRelief(2);
    expect(wadeAt(stream.x, stream.z, ground).afloat).toBe(true);
    setRelief(1);
  });

  it('carries her nowhere once she is outside the true channel', () => {
    // A CURRENT ON GROUND SHE IS MERELY STANDING IN is the founding
    // fault the whole water rebuild exists to remove, and wiring the
    // push into her movement is the first time it could actually hurt
    // rather than merely be wrong. `flowAt` shapes the thread
    // parabolically across the TRUE hydraulic channel, which is a
    // fraction of the trench she is swimming in, so past the channel
    // the water must not move her at all.
    //
    // ASKED OF THE SPOT THAT ANSWERED, not of the station we started
    // from. My first version stepped a metre off one station's
    // centreline and demanded zero, and it failed honestly: at a bend
    // or a confluence that point can be INSIDE a different segment's
    // channel, and a real current there is correct. The invariant is
    // about the reach that actually claimed the point.
    let outside = 0;
    let inside = 0;
    for (let p = 0; p < flow.level.length && outside < 60; p += 331) {
      if (pondLevelAt(flow.x[p], flow.z[p]) !== null) continue;
      const reach = flow.reaches.find(r => p >= r.first && p < r.first + r.count);
      if (!reach || reach.count < 3) continue;
      const i = p - reach.first;
      const back = reach.first + Math.max(0, i - 1);
      const fore = reach.first + Math.min(reach.count - 1, i + 1);
      let dx = flow.x[fore] - flow.x[back];
      let dz = flow.z[fore] - flow.z[back];
      const run = Math.hypot(dx, dz);
      if (run < 1e-6) continue;
      dx /= run; dz /= run;
      const shove = (x: number, z: number): number => {
        // A null carry is the answer wadeAt gives when the thread has
        // run out, which is STRONGER than a zero vector rather than a
        // case to skip — my first pass skipped it and counted nothing.
        const wade = wadeAt(x, z, flow.level[p] - 2);
        return wade.carry === null ? 0 : Math.hypot(wade.carry.x, wade.carry.z);
      };
      // THE CONTROL, at the centreline of the same station: if this is
      // zero too then the zeroes below prove nothing at all, and the
      // test would pass just as happily against a build where the
      // current had been unplugged.
      if (shove(flow.x[p], flow.z[p]) > 0) inside++;
      for (const side of [-1, 1] as const) {
        const out = flow.width[p] / 2 + 150;
        const x = flow.x[p] + -dz * out * side;
        const z = flow.z[p] + dx * out * side;
        const spot = flowAt(x, z);
        if (!spot || spot.off <= spot.width / 2) continue;
        outside++;
        expect(shove(x, z)).toBe(0);
      }
    }
    // Both have to have happened, or this proves nothing: the zeroes
    // could all be points nothing claimed, on a build with no current
    // in it anywhere.
    expect(outside).toBeGreaterThan(20);
    expect(inside).toBeGreaterThan(10);
  });
});
