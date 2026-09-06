/**
 * THE PROPERTIES THE WATER MODEL EXISTS FOR.
 *
 * A shallow-water solver is easy to write and hard to trust: it can look
 * plausible for one step and detonate in three hundred, or settle into a
 * pool that is quietly a centimetre out of level, or drain a hillside by
 * losing the water rather than by moving it. So these are not spot checks
 * of arithmetic — each one is a behaviour the game depends on, with the
 * failure it would be spelled out beside it.
 *
 * The one that matters most is the SPILL. Water pooling in a pit and then
 * leaving over the LOWEST part of its rim, with nothing in the code
 * knowing where that rim is, is the whole reason a simulation is run here
 * instead of a ribbon being drawn. Every previous attempt in this lineage
 * drew the water, and every one of them ended up carving the ground to
 * make the drawing true.
 *
 * The last test reads the SHIPPED SURVEY. Synthetic bowls and ramps prove
 * the maths; only real ground proves that the analysis says something
 * about Kauaʻi. Waimea Canyon is 2.5 km of the deepest valley in the
 * Pacific and the answer there should be obvious — and it is: 47 times
 * more upstream area on the valley floors than on the ridges.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { world, type WorldPoint } from '../src/world/coords';
import { decodeCoarse } from '../src/world/dem';
import { repairGrid } from '../src/world/demRepair';
import { geoToWorld } from '../src/world/geo';
import { Heightfield } from '../src/world/heightfield';
import { rainToUnitsPerSecond } from '../src/world/weather/weather';
import { CATCHMENT_M2, catchmentM2, channelMask, flowAccumulation } from '../src/world/water/drainage';
import {
  BASEFLOW,
  MAX_STEPS_PER_ADVANCE,
  NO_FEED,
  WATER_SIM_DEFAULTS,
  WaterSim,
  type WaterFeed,
} from '../src/world/water/sim';

// ---------------------------------------------------------------------------
// Small patches, so a few thousand steps is still milliseconds
// ---------------------------------------------------------------------------

/** Where every synthetic patch is placed. Snaps to itself, so cell (0,0) is at -half. */
const CENTRE: WorldPoint = world(0, 0);

/**
 * A bathtub: rim shut and nothing soaking away, so every measurement is
 * about where the water WENT rather than about how much of it left.
 */
function tub(over: (cx: number, cy: number) => number, n = 32, extra: Partial<typeof WATER_SIM_DEFAULTS> = {}): WaterSim {
  const sim = new WaterSim({ n, cell: 100, soak: 0, drainRim: false, ...extra });
  place(sim, over);
  return sim;
}

/** Fill the bed from a function of CELL indices, by inverting the placement. */
function place(sim: WaterSim, height: (cx: number, cy: number) => number): void {
  const half = (sim.n * sim.cell) / 2;
  sim.placeAt(CENTRE, (at) => height(
    Math.round((at.wx + half) / sim.cell),
    Math.round((at.wz + half) / sim.cell),
  ));
}

function run(sim: WaterSim, steps: number, feed: WaterFeed = NO_FEED): void {
  for (let s = 0; s < steps; s += 1) sim.step(feed);
}

/** Depth into every cell at once, the way a first fill or a test does it. */
function fill(sim: WaterSim, depth: number, where?: (cx: number, cy: number) => boolean): void {
  // Through the public feed, since the grid is read-only by design: one
  // step of rain at a rate that lands exactly `depth`.
  const mask = new Uint8Array(sim.n * sim.n);
  for (let cy = 0; cy < sim.n; cy += 1) {
    for (let cx = 0; cx < sim.n; cx += 1) {
      mask[cy * sim.n + cx] = !where || where(cx, cy) ? 1 : 0;
    }
  }
  sim.step({ rainPerSecond: 0, baseflowPerSecond: depth / sim.opts.dt, channels: mask });
}

const depths = (sim: WaterSim): Float32Array => {
  const grid = sim.grid();
  const out = new Float32Array(grid.n * grid.n);
  for (let i = 0; i < out.length; i += 1) out[i] = grid.depth[i];
  return out;
};

const beds = (sim: WaterSim): Float32Array => {
  const grid = sim.grid();
  const out = new Float32Array(grid.n * grid.n);
  for (let i = 0; i < out.length; i += 1) out[i] = grid.bed[i];
  return out;
};

/** The same floats, seen as bytes: the strictest "unchanged" there is. */
const bytes = (floats: Float32Array): Uint8Array => new Uint8Array(floats.buffer.slice(0));

// ---------------------------------------------------------------------------
// The pipe model
// ---------------------------------------------------------------------------

describe('virtual-pipes shallow water over a fixed bed', () => {
  it('runs downhill and not up', () => {
    // A clean ramp, high at cx = 0. If the surface difference were read
    // with the sign flipped — or from the bed instead of bed + water —
    // this is the test that would fail, and it would fail as water
    // climbing a mountain.
    const sim = tub((cx) => 5000 - cx * 100);
    fill(sim, 30);
    run(sim, 3000);
    const half = sim.n / 2;
    let high = 0;
    let low = 0;
    const grid = sim.grid();
    for (let cy = 0; cy < sim.n; cy += 1) {
      for (let cx = 0; cx < sim.n; cx += 1) {
        const d = grid.depth[cy * sim.n + cx];
        if (cx < half) high += d;
        else low += d;
      }
    }
    expect(low).toBeGreaterThan(high * 3);
  });

  it('pools in a basin and settles FLAT — the property no drawn ribbon has', () => {
    // A bowl. Water poured into it must find ONE level, because the pipes
    // compare bed + water and not bed. A failure here reads as a pool
    // that slopes, which is the look every previous water system in this
    // lineage had just before it was deleted.
    const sim = tub((cx, cy) => {
      const mid = (32 - 1) / 2;
      const r = Math.hypot(cx - mid, cy - mid);
      return 1000 + r * r * 4;
    });
    const mid = (sim.n - 1) / 2;
    fill(sim, 40, (cx, cy) => Math.hypot(cx - mid, cy - mid) < 8);
    run(sim, 6000);
    const grid = sim.grid();
    const wet: number[] = [];
    for (let i = 0; i < sim.n * sim.n; i += 1) if (grid.depth[i] > 1) wet.push(sim.surfaceOf(i));
    expect(wet.length).toBeGreaterThan(20);
    // Within a centimetre of level right across the pool.
    expect(Math.max(...wet) - Math.min(...wet)).toBeLessThan(1);
  });

  it('fills a pit and then SPILLS at its lowest rim, with nothing told where the rim is', () => {
    // THE TEST THE WHOLE MODEL EXISTS FOR. A bowl with one notch cut in
    // the +x wall; the notch is never named to the solver. Water must
    // rise to it and leave THERE, not over the high rim and not by
    // evaporating through the floor.
    const n = 32;
    const mid = (n - 1) / 2;
    const sim = tub((cx, cy) => {
      const r = Math.hypot(cx - mid, cy - mid);
      const h = 1000 + r * r * 6;
      // A saddle on the +x side, low enough that a filling bowl reaches
      // it before it reaches any other part of the rim.
      if (cy > mid - 2 && cy < mid + 2 && cx > mid) return Math.min(h, 1240);
      return h;
    }, n);
    fill(sim, 60, (cx, cy) => Math.hypot(cx - mid, cy - mid) < 6);
    // RIM SHUT, deliberately: with it open the patch drains completely
    // and the measurement is zero against zero, which proves nothing.
    run(sim, 6000);
    const grid = sim.grid();
    let plusX = 0;
    let minusX = 0;
    for (let cy = 0; cy < n; cy += 1) {
      for (let cx = 0; cx < n; cx += 1) {
        const d = grid.depth[cy * n + cx];
        if (cx > mid + 8) plusX += d;
        if (cx < mid - 8) minusX += d;
      }
    }
    expect(plusX).toBeGreaterThan(minusX * 5);
  });

  it('never writes a negative or non-finite depth, at any rain rate or step it can be given', () => {
    // THE SCALING STEP is what this is really testing: four pipes each
    // deciding alone can ask a cell for more than it holds, and without
    // one factor K over all four the cell goes negative and the grid
    // detonates within a few hundred steps. Swept across the whole dt
    // range the solver is stable over (0.004..0.8, measured in v0) and
    // across rain from a drizzle to an absurdity.
    for (const dt of [0.004, 0.02, 0.1, 0.4, 0.8]) {
      for (const rain of [0.001, 1, 200, 5000]) {
        const sim = tub((cx, cy) => 4000 - cx * 60 - cy * 20, 24, { dt });
        run(sim, 600, { rainPerSecond: rain, baseflowPerSecond: 0, channels: null });
        const grid = sim.grid();
        for (let i = 0; i < sim.n * sim.n; i += 1) {
          const d = grid.depth[i];
          if (!(d >= 0) || !Number.isFinite(d)) {
            throw new Error(`dt ${dt}, rain ${rain}: cell ${i} holds ${d}`);
          }
        }
      }
    }
  });

  it('is still standing after thousands of steps, not merely after one', () => {
    // Stability is a property of the long run: an unstable scheme can
    // look perfectly reasonable for fifty steps. Fed continuously with an
    // open rim and a soak, the patch must reach a STEADY STATE rather
    // than climbing without bound or ringing itself apart.
    const sim = new WaterSim({ n: 48, cell: 100, soak: 0.3, drainRim: true });
    place(sim, (cx, cy) => 3000 - cx * 40 + Math.sin(cy * 0.4) * 120);
    const channels = new Uint8Array(48 * 48);
    for (let cy = 0; cy < 48; cy += 1) channels[cy * 48 + 24] = 1;
    const feed: WaterFeed = { rainPerSecond: 0.05, baseflowPerSecond: BASEFLOW, channels };
    run(sim, 2000, feed);
    const early = sim.volume();
    run(sim, 4000, feed);
    const late = sim.volume();
    const grid = sim.grid();
    for (let i = 0; i < 48 * 48; i += 1) {
      expect(Number.isFinite(grid.depth[i])).toBe(true);
      expect(grid.depth[i]).toBeGreaterThanOrEqual(0);
    }
    // Settled, not growing: four thousand more steps move the total by a
    // few percent, not by a factor. A blow-up shows here as a ratio in
    // the thousands and a stall as an exact zero.
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(early * 1.5);
    expect(late).toBeGreaterThan(early * 0.5);
  });

  it('conserves water when the rim is shut and nothing soaks away', () => {
    // Nothing is added and nothing may leave, so the total is a constant.
    // The depths are float32 and the volume is half a billion cubic
    // units, so the bar is RELATIVE — an absolute tolerance here would be
    // a test of IEEE 754 rather than of the solver. v0 measured a drift
    // of 1.4e-8 over 1,500 steps; this measures about 3e-8 over 2,000.
    const sim = tub((cx, cy) => 3000 - cx * 40 - cy * 40);
    fill(sim, 50);
    const before = sim.volume();
    run(sim, 2000);
    expect(Math.abs(sim.volume() - before) / before).toBeLessThan(1e-6);
  });

  it('loses water to soak and to an open rim, and to nothing else', () => {
    // The other half of conservation: the two sanctioned sinks, measured
    // separately, so "the water drained away" can never be an alias for
    // "the solver lost it". Soak alone, rim shut: the loss is exactly the
    // flat rate times the time, on every cell that still has water.
    const sim = tub((cx, cy) => 2000 + cx * 0 + cy * 0, 16, { soak: 0.5 });
    fill(sim, 100);
    const before = sim.volume();
    const steps = 500;
    run(sim, steps);
    const expected = before - 0.5 * sim.opts.dt * steps * 16 * 16 * sim.cell * sim.cell;
    // RELATIVE, because the depths are float32 and this is 500 repeated
    // subtractions of 0.01 from 100: measured drift 1.1e-5 of the total,
    // which is rounding. An absolute bar here would be a test of IEEE 754.
    expect(Math.abs(sim.volume() - expected) / expected).toBeLessThan(1e-4);
  });

  it('leaves a flat bed under still water EXACTLY as it found it', () => {
    // No slope, no rain, no soak: every surface difference is exactly
    // zero, so every flux stays exactly zero and not one float may move.
    // This is the test that catches a stray epsilon, a one-sided
    // boundary, or an accumulator that drifts when nothing is happening —
    // all of which read in the game as a pond that shimmers or creeps.
    const sim = tub(() => 2000, 16);
    fill(sim, 25);
    const before = depths(sim);
    run(sim, 500);
    expect(bytes(depths(sim))).toEqual(bytes(before));
  });

  it('never writes the bed — not one byte, after thousands of fed steps', () => {
    // THE STANDING RULE (CLAUDE.md: the terrain is not ours to move).
    // This is why steps 3 and 4 of Mei/Decaudin/Hu — erosion and sediment
    // transport — are excluded permanently rather than merely unfinished:
    // both write the bed every tick by definition. If this fails, the
    // island has started editing itself.
    const sim = new WaterSim({ n: 32, cell: 100, soak: 0.3, drainRim: true });
    place(sim, (cx, cy) => 4000 - cx * 55 + Math.cos(cy * 0.3) * 200);
    const before = bytes(beds(sim));
    const channels = new Uint8Array(32 * 32).fill(1);
    run(sim, 5000, { rainPerSecond: 2, baseflowPerSecond: 5, channels });
    expect(bytes(beds(sim))).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// The feeds, and the weather contract behind the rain
// ---------------------------------------------------------------------------

describe('what goes into the water', () => {
  it('turns millimetres an hour into exactly the depth it should', () => {
    // The whole chain, checked against a number a person can verify:
    // 10 mm/hr for an hour is 10 mm of water, which at a centimetre to
    // the unit is a depth of 1. A unit slip anywhere between the forecast
    // and the grid shows up here as a factor of ten, sixty or 3,600.
    const rain = rainToUnitsPerSecond(10);
    const sim = tub(() => 1000, 16);
    const seconds = 3600;
    const steps = Math.round(seconds / sim.opts.dt);
    run(sim, steps, { rainPerSecond: rain, baseflowPerSecond: 0, channels: null });
    const grid = sim.grid();
    // Flat bed, shut rim, no soak: it simply stands where it fell.
    //
    // Two decimal places rather than six, and the slack is named: this is
    // 180,000 float32 additions of 5.6e-6 into a number that grows to 1,
    // and it lands 0.16% low. That is accumulation, not a unit slip — a
    // unit slip is a factor of 10, 60 or 3,600 and would not squeak in
    // under a percent.
    expect(grid.depth[8 * 16 + 8]).toBeCloseTo(1, 2);
  });

  it('puts baseflow in the channels and nowhere else', () => {
    // The separation the island's drainage depends on: between showers a
    // river runs and the hillsides do not. If baseflow leaked onto every
    // cell, every slope would be permanently wet — v0's sprinkler.
    const sim = tub(() => 1000, 16);
    const channels = new Uint8Array(16 * 16);
    for (let cy = 0; cy < 16; cy += 1) channels[cy * 16 + 8] = 1;
    sim.step({ rainPerSecond: 0, baseflowPerSecond: BASEFLOW, channels });
    const grid = sim.grid();
    // Nearly all of the fed depth, not exactly it: the same step runs the
    // pipes, so the channel has already started handing water to its
    // banks — which is the routing working, and is why the feed may be a
    // coarse 55 m band without the rivers being 55 m wide.
    expect(grid.depth[3 * 16 + 8]).toBeGreaterThan(BASEFLOW * sim.opts.dt * 0.9);
    expect(grid.depth[3 * 16 + 8]).toBeLessThanOrEqual(BASEFLOW * sim.opts.dt);
    // Six cells from the channel, and water moves one cell a step: dry,
    // exactly, or baseflow is leaking onto the hillsides.
    expect(grid.depth[3 * 16 + 2]).toBe(0);
  });

  it('refuses a mask that is not this grid, and a rate that is not a number', () => {
    // A mask of the wrong size would silently feed the wrong cells — the
    // rivers would run diagonally across the window and look like a
    // solver bug. A NaN rate poisons every cell within one step, and the
    // symptom ("the water vanished") points nowhere near the weather.
    const sim = tub(() => 1000, 16);
    expect(() => sim.step({ rainPerSecond: 0, baseflowPerSecond: 1, channels: new Uint8Array(9) }))
      .toThrow(/channel mask/);
    expect(() => sim.step({ rainPerSecond: Number.NaN, baseflowPerSecond: 0, channels: null }))
      .toThrow(/finite/);
  });

  it('advances in whole fixed steps, carries the remainder and caps a stall', () => {
    // The dt was swept for a reason; a variable step taken straight from
    // a frame would walk the answer around with the frame rate. And a
    // frame that stalls must not make the solver spend a second catching
    // up — the surplus is dropped on purpose.
    const sim = tub(() => 1000, 16);
    expect(sim.advance(0.05)).toBe(2);          // 0.05 / 0.02 = 2.5 steps
    expect(sim.advance(0.05)).toBe(3);          // the carried 0.5 arrives
    expect(sim.advance(60)).toBe(MAX_STEPS_PER_ADVANCE);
    expect(sim.advance(0)).toBe(0);
    // A NaN clock is a bug to be told about, not "no time passed": the
    // sign test alone would swallow it, because NaN > 0 is false.
    expect(() => sim.advance(Number.NaN)).toThrow(/finite/);
  });
});

// ---------------------------------------------------------------------------
// The point query
// ---------------------------------------------------------------------------

describe('asking the patch where its water is', () => {
  it('answers null for dry ground, and a spot for the thinnest film', () => {
    // NULL MEANS DRY AND ZERO DEPTH IS NOT DRY (waterQuery.ts). Making
    // them the same value is the audit's F3: an invisible-but-afloat band
    // where the surface is not drawn and the physics thinks she is
    // swimming.
    const sim = tub(() => 1000, 16);
    expect(sim.spotAt(CENTRE)).toBeNull();
    fill(sim, 0.01);                            // a tenth of a millimetre
    const spot = sim.spotAt(CENTRE);
    expect(spot).not.toBeNull();
    expect(spot?.depth).toBeGreaterThan(0);
    expect(spot?.kind).toBe('fresh');
  });

  it('puts the surface on top of the bed, and leaves the current at zero', () => {
    // The surface is absolute world height, so a camera and a floating
    // body can both read it without re-deriving the bed and getting two
    // answers. The current is zero by decision: flux over depth is a
    // singularity on a film — 368 cm/s over 1.5 mm, measured on Joshua's
    // device — and until there is a stream model, inland water does not
    // carry her.
    const sim = tub(() => 1000, 16);
    fill(sim, 20);
    const spot = sim.spotAt(CENTRE);
    expect(spot?.surface).toBeCloseTo(1020, 5);
    expect(spot?.depth).toBeCloseTo(20, 5);
    expect(spot?.flowX).toBe(0);
    expect(spot?.flowZ).toBe(0);
  });

  it('says nothing about ground outside its window, or before it has one', () => {
    // The window is 256 m of a 56 km island. Guessing past its rim would
    // be worse than saying so, and "not placed yet" is the same answer as
    // "no water here" on purpose — there is no second code path for a
    // world that has not loaded.
    const sim = new WaterSim({ n: 16, cell: 100 });
    expect(sim.spotAt(CENTRE)).toBeNull();
    place(sim, () => 1000);
    fill(sim, 20);
    expect(sim.spotAt(world(100_000, 0))).toBeNull();
    expect(sim.spotAt(world(0, -100_000))).toBeNull();
  });

  it('moves with its window, carrying the water it already holds', () => {
    // A re-centre is a whole number of cells and the depths are CARRIED,
    // not resampled: interpolating a depth field invents water that was
    // never there, one pool becoming two half-pools every re-centre.
    const sim = tub(() => 1000, 32);
    fill(sim, 20);
    const before = sim.volume();
    sim.placeAt(world(400, 0), () => 1000);
    const grid = sim.grid();
    expect(grid.origin.wx).toBe(400 - (32 * 100) / 2);
    // Four columns walked off the edge and are gone; the rest is intact.
    expect(sim.volume()).toBeCloseTo(before * (28 / 32), 3);
  });

  it('builds its channel mask from a world-fixed answer, not from its own bed', () => {
    // Running D8 on the window's own bed made the rivers depend on where
    // the camera was: two windows one re-centre apart disagreed on 16% of
    // their shared channel cells and the network visibly morphed. The
    // mask is a lookup into an island-wide answer, so a cell's membership
    // travels with the ISLAND.
    const sim = tub(() => 1000, 16);
    const isChannel = (at: WorldPoint): boolean => Math.abs(at.wz) < 150;
    const first = sim.channelMask(isChannel);
    sim.placeAt(world(0, 400), () => 1000);
    const second = sim.channelMask(isChannel);
    const wetRow = (mask: Uint8Array, cy: number): number => {
      let n = 0;
      for (let cx = 0; cx < 16; cx += 1) n += mask[cy * 16 + cx];
      return n;
    };
    // The band sits four rows further up the grid after a 400-unit move,
    // because it did not move at all.
    expect(wetRow(first, 8)).toBe(16);
    expect(wetRow(second, 8)).toBe(0);
    expect(wetRow(second, 4)).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// D8 drainage
// ---------------------------------------------------------------------------

describe('D8 flow accumulation', () => {
  it('accumulates downhill — the foot of a ramp carries everything', () => {
    const n = 16;
    const bed = new Float32Array(n * n);
    for (let cy = 0; cy < n; cy += 1) for (let cx = 0; cx < n; cx += 1) bed[cy * n + cx] = 1000 - cy * 10;
    const acc = flowAccumulation(bed, n);
    let top = 0;
    let foot = 0;
    for (let cx = 0; cx < n; cx += 1) {
      top += acc[cx];
      foot += acc[(n - 1) * n + cx];
    }
    expect(foot).toBeGreaterThan(top * 5);
  });

  it('finds a valley floor and not its walls', () => {
    // A V running down +z. If the crease did not carry the water, the
    // baseflow feed would land on the hillsides and the island would be
    // wet everywhere except its rivers.
    const n = 32;
    const mid = (n - 1) / 2;
    const bed = new Float32Array(n * n);
    for (let cy = 0; cy < n; cy += 1) {
      for (let cx = 0; cx < n; cx += 1) bed[cy * n + cx] = 2000 - cy * 8 + Math.abs(cx - mid) * 20;
    }
    // 20 m cells, so one cell is 400 m² and the threshold is 300 cells.
    const mask = channelMask(bed, n, 2000);
    let onCrease = 0;
    let onWall = 0;
    for (let cy = 2; cy < n - 2; cy += 1) {
      if (mask[cy * n + Math.round(mid)]) onCrease += 1;
      if (mask[cy * n + 2]) onWall += 1;
    }
    expect(onCrease).toBeGreaterThan(n / 4);
    expect(onWall).toBe(0);
  });

  it('counts every cell once, and writes nothing to the ground it read', () => {
    const n = 12;
    const bed = new Float32Array(n * n);
    for (let i = 0; i < bed.length; i += 1) bed[i] = 500 - (i % n) * 3 - Math.floor(i / n) * 2;
    const before = bytes(bed);
    const acc = flowAccumulation(bed, n);
    for (let i = 0; i < acc.length; i += 1) expect(acc[i]).toBeGreaterThanOrEqual(1);
    expect(bytes(bed)).toEqual(before);
  });

  it('reads catchment in square metres, not in cells', () => {
    // The threshold is a real area because that is what hydrology
    // measures channel initiation in; the cell size is the only place the
    // two meet, and getting it wrong is a factor of ten thousand at true
    // scale.
    expect(catchmentM2(300, 2000)).toBe(120_000);
    expect(catchmentM2(1, 100)).toBe(1);
    expect(CATCHMENT_M2).toBe(120_000);
  });
});

// ---------------------------------------------------------------------------
// The real island
// ---------------------------------------------------------------------------

/**
 * Waimea Canyon, the deepest valley in the Pacific, read from the shipped
 * survey rather than from a bowl somebody drew.
 *
 * A 2.56 km window at 20 m cells, off the coarse grid (no high-detail
 * tiles are loaded, so every read is the 54.7 m lattice bilinearly
 * sampled — the same ground the game opens with before its tiles land).
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WAIMEA = geoToWorld({ lat: 22.075, lon: -159.665 });

function islandBed(n: number, cell: number, centre: WorldPoint): Float32Array {
  const bytes_ = readFileSync(path.join(ROOT, 'public', 'kauai-1025.bin'));
  const buffer = bytes_.buffer.slice(bytes_.byteOffset, bytes_.byteOffset + bytes_.byteLength) as ArrayBuffer;
  const field = new Heightfield(repairGrid(decodeCoarse(buffer)).grid);
  const bed = new Float32Array(n * n);
  const ox = centre.wx - (n * cell) / 2;
  const oz = centre.wz - (n * cell) / 2;
  for (let cy = 0; cy < n; cy += 1) {
    for (let cx = 0; cx < n; cx += 1) bed[cy * n + cx] = field.heightAt(world(ox + cx * cell, oz + cy * cell));
  }
  return bed;
}

describe('D8 on a real slice of Kauaʻi', () => {
  const n = 128;
  const cell = 2000;                                  // 20 m
  const bed = islandBed(n, cell, WAIMEA);
  const acc = flowAccumulation(bed, n);

  /**
   * Valley or ridge by TOPOGRAPHIC POSITION: a cell against the mean of
   * its 9 x 9 neighbourhood, which is 180 m of ground. Ten metres below
   * that mean is a valley floor, ten above it is a ridge. Deliberately
   * NOT "low ground versus high ground" — the window tilts, and the low
   * end of a tilted window would win that comparison without D8 having to
   * be right about anything.
   */
  const R = 4;
  const valley: number[] = [];
  const ridge: number[] = [];
  for (let cy = R + 1; cy < n - R - 1; cy += 1) {
    for (let cx = R + 1; cx < n - R - 1; cx += 1) {
      let sum = 0;
      for (let dy = -R; dy <= R; dy += 1) {
        for (let dx = -R; dx <= R; dx += 1) sum += bed[(cy + dy) * n + cx + dx];
      }
      const tpi = bed[cy * n + cx] - sum / ((2 * R + 1) * (2 * R + 1));
      if (tpi < -1000) valley.push(cy * n + cx);
      else if (tpi > 1000) ridge.push(cy * n + cx);
    }
  }
  const mean = (list: readonly number[]): number => list.reduce((s, i) => s + acc[i], 0) / list.length;

  it('found both landforms to compare — the canyon is where it is said to be', () => {
    // Guards the two tests below against passing vacuously on a flat
    // sample of sea floor: a window in the wrong place would find no
    // ridges, and an empty mean is NaN, which compares false and reads as
    // a failure of D8 rather than of the coordinates.
    expect(valley.length).toBeGreaterThan(1000);
    expect(ridge.length).toBeGreaterThan(1000);
    let lo = Infinity;
    let hi = -Infinity;
    for (const h of bed) {
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    // Measured: 245 m to 1,096 m over this window.
    expect((hi - lo) / 100).toBeGreaterThan(500);
  });

  it('carries far more upstream ground in the valleys than on the ridges', () => {
    // Measured on the shipped bytes: valley cells average 93.8 upstream
    // cells against the ridges' 2.0 — a factor of 47 — with medians of 10
    // and 1. The bar is set at 10x, so this fails on a real regression
    // and not on the survey being re-baked. If it ever inverts, baseflow
    // is being fed to hilltops.
    expect(mean(valley)).toBeGreaterThan(mean(ridge) * 10);
    expect(mean(ridge)).toBeLessThan(10);
  });

  it('marks about two percent of the canyon as watercourse, and no ridge at all', () => {
    // The mask is what baseflow is poured into, so a ridge in it is
    // literally a river running along a mountaintop. Measured: 2.1% of
    // cells pass 120,000 m², 288 of them valley floors, 0 ridges.
    const mask = channelMask(bed, n, cell);
    let marked = 0;
    for (let i = 0; i < mask.length; i += 1) marked += mask[i];
    let onRidge = 0;
    for (const i of ridge) onRidge += mask[i];
    let inValley = 0;
    for (const i of valley) inValley += mask[i];
    expect(marked / mask.length).toBeGreaterThan(0.005);
    expect(marked / mask.length).toBeLessThan(0.06);
    expect(inValley).toBeGreaterThan(100);
    expect(onRidge).toBe(0);
  });

  it('floods that canyon without going negative, and still leaves the bed alone', () => {
    // The solver and the analysis on the same real ground: baseflow into
    // the channels the survey's own shape defines, rain on everything,
    // and after forty simulated seconds the water is somewhere sensible
    // and the island is exactly as it was.
    const sim = new WaterSim({ n, cell, soak: 0.3, drainRim: true });
    let read = 0;
    sim.placeAt(WAIMEA, (at) => {
      // The same window the analysis used, sampled through the same door.
      const cx = Math.round((at.wx - (WAIMEA.wx - (n * cell) / 2)) / cell);
      const cy = Math.round((at.wz - (WAIMEA.wz - (n * cell) / 2)) / cell);
      read += 1;
      return bed[Math.min(n - 1, Math.max(0, cy)) * n + Math.min(n - 1, Math.max(0, cx))];
    });
    expect(read).toBe(n * n);
    const bedBefore = bytes(beds(sim));
    const channels = channelMask(bed, n, cell);
    run(sim, 2_000, { rainPerSecond: 0.02, baseflowPerSecond: BASEFLOW, channels });
    const grid = sim.grid();
    let wetOnChannel = 0;
    let wetOffChannel = 0;
    for (let i = 0; i < n * n; i += 1) {
      expect(grid.depth[i]).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(grid.depth[i])).toBe(true);
      if (grid.depth[i] > 1) {
        if (channels[i]) wetOnChannel += 1;
        else wetOffChannel += 1;
      }
    }
    // The water is IN the drainage: nearly every fed cell holds water,
    // and it has spread beyond them downhill, which is the routing doing
    // its job rather than the feed painting a picture.
    expect(wetOnChannel).toBeGreaterThan(0);
    expect(wetOffChannel).toBeGreaterThan(0);
    expect(bytes(beds(sim))).toEqual(bedBefore);
  });

  it('CARRIES TWICE THE WATER ON TWICE THE BASEFLOW — the doubling Joshua asked for', () => {
    // Joshua, 2026-09-06: "Can you double the water amount/volume on the
    // island?" The scene answers by doubling BASEFLOW_PER_SECOND, and
    // that answer is only true if the water in the window is LINEAR in
    // the feed. It very nearly is, and the two reasons it is not exactly
    // are both worth the test noticing:
    //
    //  - SOAK is a flat subtraction from every wet cell, so it is a
    //    smaller FRACTION of a bigger feed. That pushes the ratio above
    //    two.
    //  - The open rim sheds more when there is more to shed, which pulls
    //    it back down.
    //
    // Measured here at 2.15x, and on the island's own valleys at 2.07x.
    // The band is wide enough to survive re-tuning soak or the rim and
    // narrow enough that a CAP on depth — the obvious wrong fix for the
    // flood a valley floor reaches — would fail it.
    const channels = channelMask(bed, n, cell);
    const held = (baseflowPerSecond: number): number => {
      const sim = new WaterSim({ n, cell, soak: 0.3, drainRim: true });
      sim.placeAt(WAIMEA, (at) => {
        const cx = Math.round((at.wx - (WAIMEA.wx - (n * cell) / 2)) / cell);
        const cy = Math.round((at.wz - (WAIMEA.wz - (n * cell) / 2)) / cell);
        return bed[Math.min(n - 1, Math.max(0, cy)) * n + Math.min(n - 1, Math.max(0, cx))];
      });
      run(sim, 1_000, { rainPerSecond: 0, baseflowPerSecond, channels });
      let sum = 0;
      const grid = sim.grid();
      for (let i = 0; i < n * n; i += 1) sum += grid.depth[i];
      return sum;
    };
    const single = held(6);
    const doubled = held(12);
    expect(single).toBeGreaterThan(0);
    expect(doubled / single).toBeGreaterThan(1.7);
    expect(doubled / single).toBeLessThan(2.4);
  });
});

/**
 * WHAT THE REVIEW PASS FOUND, turned into tests.
 *
 * Every one of these was written after an adversarial reader mutated the
 * source and watched the existing 26 tests stay green. A test that
 * survives a real mutation is not a test, and these are the mutations
 * that survived.
 */
describe('the holes the review found', () => {
  const flat = (): WaterSim => {
    const sim = new WaterSim({ n: 8, cell: 100, dt: 0.02, damping: 0.995, soak: 0 });
    sim.placeAt(world(0, 0), () => 1000);
    return sim;
  };

  it('REFUSES A NON-FINITE QUERY instead of answering NaN', () => {
    // Every comparison against NaN is false, so a bounds guard written
    // as `< 0 || >= n` lets one through, and what comes back is a spot
    // whose surface and depth are NaN. `router.ts` promises depth is
    // always above zero where a spot exists; `submersion` would hand
    // that NaN to the camera fog.
    const sim = flat();
    sim.advance(1, { rainPerSecond: 10, baseflowPerSecond: 0, channels: null });
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      expect(sim.spotAt(world(bad, 0)), `wx ${bad}`).toBeNull();
      expect(sim.spotAt(world(0, bad)), `wz ${bad}`).toBeNull();
    }
    // And a good point still answers, or this passes by refusing all of them.
    expect(sim.spotAt(world(0, 0))).not.toBeNull();
  });

  it('REFUSES A NON-FINITE CENTRE rather than marking itself placed', () => {
    // The old order wrote the origin and the placed flag before reading
    // the ground, so a bad centre left a window that believed it was
    // placed, with a NaN origin poisoning every point it derived.
    const sim = new WaterSim({ n: 8, cell: 100, dt: 0.02, damping: 0.995, soak: 0 });
    expect(() => sim.placeAt(world(Number.NaN, 0), () => 1000)).toThrow();
    expect(sim.isPlaced(), 'it marked itself placed on a centre it refused').toBe(false);
  });

  it('RE-READS THE GROUND WHEN THE SURVEY CHANGES, even standing still', () => {
    // v1 streams HD tiles in behind the player, so the ordinary case is
    // the ground being REPLACED under someone who has not moved. A
    // window that only re-reads its bed when it MOVES keeps solving
    // against terrain that is no longer there.
    const sim = new WaterSim({ n: 8, cell: 100, dt: 0.02, damping: 0.995, soak: 0 });
    let asked = 0;
    let height = 1000;
    const bedAt = (): number => { asked += 1; return height; };

    sim.placeAt(world(0, 0), bedAt, 1);
    const first = asked;
    expect(first).toBeGreaterThan(0);

    // Same place, same revision: nothing to do, and it does nothing.
    sim.placeAt(world(0, 0), bedAt, 1);
    expect(asked, 'it re-read the ground for no reason').toBe(first);

    // Same place, NEW revision: an HD tile landed. It must read again.
    height = 2000;
    sim.placeAt(world(0, 0), bedAt, 2);
    expect(asked, 'the ground changed and the window did not notice').toBeGreaterThan(first);
    expect(sim.grid().bed[0]).toBe(2000);
  });

  it('NEVER MARKS A CHANNEL BELOW SEA LEVEL, whatever the predicate says', () => {
    // D8 accumulation over the whole island does what it is asked and
    // routes water downhill past the shoreline: the review measured
    // 89.2% of the island-wide channel mask landing on the SEABED, the
    // deepest three kilometres down. Baseflow poured there is fresh
    // water inside the ocean's territory — two owners in one cell, which
    // is the failure `router.ts` exists to prevent.
    //
    // The predicate is a thing a caller can forget, so the guard is in
    // the solver where it cannot be. This hands it the most forgetful
    // predicate there is.
    const sim = new WaterSim({ n: 8, cell: 100, dt: 0.02, damping: 0.995, soak: 0 });
    // A bed that crosses the shoreline: west half dry land, east half seabed.
    sim.placeAt(world(0, 0), (at) => (at.wx < 0 ? 500 : -500));
    const mask = sim.channelMask(() => true);
    const g = sim.grid();
    let wet = 0;
    let dry = 0;
    for (let i = 0; i < mask.length; i += 1) {
      if (g.bed[i] < 0) expect(mask[i], `cell ${i} is ${g.bed[i]} below sea level`).toBe(0);
      else { expect(mask[i]).toBe(1); dry += 1; }
      if (mask[i] === 1) wet += 1;
    }
    // And it did not simply mark nothing, which would pass the loop above.
    expect(dry).toBeGreaterThan(0);
    expect(wet).toBe(dry);
    expect(wet).toBeLessThan(mask.length);
  });

  it('CARRIES THE WATER THE RIGHT WAY when the window moves', () => {
    // The old re-centre test filled the tub uniformly and asserted only
    // the total, so reversing both shift signs lost the same number of
    // columns and passed. This asks where a KNOWN BLOB ended up, in
    // world coordinates, which is the thing a player would notice.
    const sim = new WaterSim({ n: 16, cell: 100, dt: 0.02, damping: 0.995, soak: 0 });
    sim.placeAt(world(0, 0), () => 1000);
    const g = sim.grid();
    // A KNOWN BLOB, not a uniform tub: put water in a few cells only, on
    // one side of the window, so that carrying it the wrong way moves it
    // somewhere a world query can tell the difference.
    const blob = new Uint8Array(g.n * g.n);
    for (let cy = 9; cy < 12; cy += 1) for (let cx = 9; cx < 12; cx += 1) blob[cy * g.n + cx] = 1;
    sim.advance(1, { rainPerSecond: 0, baseflowPerSecond: 40, channels: blob });
    const at = sim.pointOf(10, 10);
    const before = sim.spotAt(at);
    expect(before, 'the blob was not where it was put').not.toBeNull();

    // Move the window three cells EAST and ask about the SAME world
    // point. The water belongs to the world, not to the lattice.
    sim.placeAt(world(3 * g.cell, 0), () => 1000);
    const after = sim.spotAt(at);
    expect(after, 'the water did not travel with the world').not.toBeNull();
    expect(after?.depth).toBeCloseTo(before?.depth ?? -1, 4);
  });
});
