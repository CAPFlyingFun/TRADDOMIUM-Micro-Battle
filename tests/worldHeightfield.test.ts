/**
 * THE GROUND, ASKED THE WAY v0 COULD NOT ASK IT.
 *
 * v0's height API took two bare numbers and a rendered position went in
 * where a world one belonged; the camera sat two kilometres up a
 * mountain and three sibling bugs arrived the same afternoon. The first
 * test here is therefore a COMPILE-time one: a `LocalPoint` must not be
 * accepted, and `@ts-expect-error` fails the build if it ever is.
 *
 * The rest pin the things that would each be a bad day on a phone:
 *
 *  - AN UNREPAIRED GRID IS REFUSED. One NODATA corner does not read as an
 *    error; it reads as a 3.2 km funnel in the sea floor. The refusal is
 *    what makes demRepair → heightfield an order the code enforces.
 *  - THE TWO LATTICES AGREE where they must. A resident tile and the
 *    coarse fallback return the SAME height at a shared sample point, so
 *    a tile arriving under the player cannot drop them through the floor.
 *  - A SAMPLE POINT READS ITS OWN SAMPLE, exactly. If the grid origin or
 *    the step is off by one the island still looks like an island, and
 *    nothing else would notice.
 *  - KAWAIKINI IS WHERE THE SURVEY PUTS IT, read through the whole chain
 *    rather than out of the array.
 *  - OFF THE ISLAND IS CLAMPED, not NaN and not a throw: a frustum or a
 *    mesh skirt asks for it every frame.
 *
 * Real bytes, not fixtures.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COARSE_SAMPLES, COARSE_STEP, HEIGHT_SCALE, ISLAND_HALF_SPAN, NODATA, coarseSamplePoint, decodeCoarse, decodeHdTile, heightOf, hdTileFromName, hdTileOrigin, metresOf, type DemGrid, type HdTileId } from '../src/world/dem';
import { repairGrid } from '../src/world/demRepair';
import { Heightfield, SEA_LEVEL } from '../src/world/heightfield';
import { local, world, type WorldPoint } from '../src/world/coords';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function readPublic(rel: string): ArrayBuffer {
  const bytes = readFileSync(path.join(ROOT, 'public', rel));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const coarse = repairGrid(decodeCoarse(readPublic('kauai-1025.bin'))).grid;
const tileGrid = (name: string): DemGrid =>
  repairGrid(decodeHdTile(readPublic(path.join('kauai-hd', `${name}.bin`)))).grid;

const idOf = (name: string): HdTileId => {
  const id = hdTileFromName(name);
  if (!id) throw new Error(`not a tile name: ${name}`);
  return id;
};

const field = (): Heightfield => new Heightfield(coarse);

/** D4 is interior: land, relief, no edge case. */
const D4 = idOf('D4');

/** Decimetres of rise per coarse sample in the synthetic ramp. Small enough to stay in an int16 across 1025 of them. */
const RAMP = 30;
/** Named here so the slope expectation is computed from the contract, not copied from a run. */
const HEIGHT_SCALE_UNITS = HEIGHT_SCALE;
const COARSE_STEP_UNITS = COARSE_STEP;

/** A whole-island grid at one height everywhere. */
function constantGrid(decimetres: number): DemGrid {
  const samples = new Int16Array(COARSE_SAMPLES * COARSE_SAMPLES);
  samples.fill(decimetres);
  return { side: COARSE_SAMPLES, samples };
}

/** A whole-island grid rising steadily eastward, by `perSample` decimetres a column. */
function rampGrid(perSample: number): DemGrid {
  const samples = new Int16Array(COARSE_SAMPLES * COARSE_SAMPLES);
  for (let row = 0; row < COARSE_SAMPLES; row += 1) {
    for (let col = 0; col < COARSE_SAMPLES; col += 1) samples[row * COARSE_SAMPLES + col] = col * perSample;
  }
  return { side: COARSE_SAMPLES, samples };
}

describe('the API can only be asked with a world position', () => {
  it('refuses a LocalPoint at compile time', () => {
    const f = field();
    const at = world(0, 0);
    expect(Number.isFinite(f.heightAt(at))).toBe(true);
    // THE v0 BUG, AS A TYPE ERROR. If this line ever stops being an
    // error, the seam is open again and the camera can clamp itself
    // against its own rendered position.
    // @ts-expect-error a LocalPoint is not a WorldPoint
    expect(() => f.heightAt(local(0, 0))).toBeTruthy();
  });
});

describe('the transform chain is an order the code enforces', () => {
  it('refuses a coarse grid that still has holes', () => {
    const raw = decodeCoarse(readPublic('kauai-1025.bin'));
    expect(() => new Heightfield(raw)).toThrow(/70 NODATA/);
  });

  it('refuses a tile that still has holes, naming it', () => {
    const raw = decodeHdTile(readPublic(path.join('kauai-hd', 'B3.bin')));
    expect(() => field().addTile(idOf('B3'), raw)).toThrow(/B3.*476 NODATA/s);
  });

  it('refuses a grid that is not a tile’s size at all', () => {
    expect(() => field().addTile(D4, coarse)).toThrow(/513 samples a side/);
  });
});

describe('reading the coarse lattice', () => {
  it('returns a sample’s own height exactly at its own position', () => {
    const f = field();
    for (const [col, row] of [[512, 512], [300, 700], [1024, 1024], [0, 0]]) {
      const expected = heightOf(coarse.samples[row * coarse.side + col]);
      expect(f.heightAt(coarseSamplePoint(col, row))).toBeCloseTo(expected, 6);
    }
  });

  it('puts Kawaikini where the survey does, read through the whole chain', () => {
    const f = field();
    let best = { height: -Infinity, at: world(0, 0) as WorldPoint };
    for (let row = 0; row < coarse.side; row += 1) {
      for (let col = 0; col < coarse.side; col += 1) {
        const h = heightOf(coarse.samples[row * coarse.side + col]);
        if (h > best.height) best = { height: h, at: coarseSamplePoint(col, row) };
      }
    }
    expect(metresOf(f.heightAt(best.at))).toBeGreaterThan(1570);
    expect(metresOf(f.heightAt(best.at))).toBeLessThan(1598);
  });

  it('interpolates between samples rather than stepping', () => {
    const f = field();
    // A midpoint must be the mean of its two neighbours, not either of them.
    const west = coarseSamplePoint(400, 400);
    const east = coarseSamplePoint(401, 400);
    const mid = world((west.wx + east.wx) / 2, west.wz);
    const mean = (f.heightAt(west) + f.heightAt(east)) / 2;
    expect(f.heightAt(mid)).toBeCloseTo(mean, 6);
  });

  it('says the coarse lattice answered when no tile is resident', () => {
    expect(field().sample(coarseSamplePoint(500, 500)).detail).toBe('coarse');
  });
});

describe('a resident tile', () => {
  it('answers instead of the coarse grid, and says so', () => {
    const f = field();
    const at = hdTileOrigin(D4);
    expect(f.sample(at).detail).toBe('coarse');
    f.addTile(D4, tileGrid('D4'));
    expect(f.hasTile(D4)).toBe(true);
    expect(f.sample(at).detail).toBe('hd');
    expect(f.residentTiles()).toEqual(['D4']);
  });

  it('AGREES WITH THE COARSE GRID at a shared sample point', () => {
    // The decimation guarantee, felt from the outside: a tile arriving
    // under the player must not move the ground they are standing on at
    // any point both lattices describe. If this fails, terrain pops
    // vertically as tiles stream and the ant falls or clips.
    const f = field();
    const withoutTile: number[] = [];
    const points: WorldPoint[] = [];
    // Coarse samples 3 x 128 .. 4 x 128 are exactly D4's span.
    for (let row = 3 * 128; row <= 4 * 128; row += 16) {
      for (let col = 3 * 128; col <= 4 * 128; col += 16) {
        const at = coarseSamplePoint(col, row);
        points.push(at);
        withoutTile.push(f.heightAt(at));
      }
    }
    f.addTile(D4, tileGrid('D4'));
    points.forEach((at, i) => {
      expect(f.heightAt(at)).toBeCloseTo(withoutTile[i], 6);
    });
    expect(points.length).toBeGreaterThan(50);
  });

  it('adds detail BETWEEN the coarse samples, which is the whole point', () => {
    // Agreeing everywhere would mean the tiles carry nothing. Off the
    // coarse lattice, in real relief, the two must differ.
    const f = field();
    const offLattice = (col: number, row: number): WorldPoint => {
      const a = coarseSamplePoint(col, row);
      return world(a.wx + 2734, a.wz + 2734);
    };
    const spots = [[440, 470], [450, 480], [460, 490], [455, 465]] as const;
    const before = spots.map(([c, r]) => f.heightAt(offLattice(c, r)));
    f.addTile(D4, tileGrid('D4'));
    const after = spots.map(([c, r]) => f.heightAt(offLattice(c, r)));
    expect(after.some((h, i) => Math.abs(h - before[i]) > 1)).toBe(true);
  });

  it('falls back to the coarse lattice when the tile is evicted', () => {
    const f = field();
    f.addTile(D4, tileGrid('D4'));
    expect(f.dropTile(D4)).toBe(true);
    expect(f.dropTile(D4)).toBe(false);
    expect(f.hasTile(D4)).toBe(false);
    expect(f.sample(hdTileOrigin(D4)).detail).toBe('coarse');
    expect(Number.isFinite(f.heightAt(hdTileOrigin(D4)))).toBe(true);
  });
});

describe('the edges of the world', () => {
  it('clamps a read off the island to its edge instead of throwing or returning the sentinel', () => {
    const f = field();
    const corner = f.heightAt(world(-ISLAND_HALF_SPAN, -ISLAND_HALF_SPAN));
    const far = f.heightAt(world(-ISLAND_HALF_SPAN * 4, -ISLAND_HALF_SPAN * 9));
    expect(far).toBeCloseTo(corner, 6);
    expect(Number.isFinite(far)).toBe(true);
    // The sentinel must never reach a caller as a height.
    expect(far).not.toBeCloseTo(heightOf(NODATA), 0);
  });

  it('survives a position that is not a number at all', () => {
    const f = field();
    expect(Number.isFinite(f.heightAt(world(Number.NaN, 0)))).toBe(true);
    expect(Number.isFinite(f.heightAt(world(0, Number.POSITIVE_INFINITY)))).toBe(true);
  });

  it('reads the far corner of the survey without falling off it', () => {
    const f = field();
    const last = coarse.side - 1;
    const expected = heightOf(coarse.samples[last * coarse.side + last]);
    expect(f.heightAt(coarseSamplePoint(last, last))).toBeCloseTo(expected, 6);
  });
});

describe('the shape of the ground', () => {
  it('points straight up on ground that is actually level', () => {
    // Synthetic, because the real survey has no flat place to stand: the
    // island sits on a seamount, so even the open ocean 600 m off the
    // north-west corner is its flank at about 5 degrees. A known answer
    // needs a known surface.
    const f = new Heightfield(constantGrid(-1000));
    const n = f.normalAt(world(0, 0));
    expect(n).toEqual({ nx: 0, ny: 1, nz: 0 });
    expect(f.slopeDegrees(world(0, 0))).toBe(0);
  });

  it('measures a known gradient as the angle that gradient actually is', () => {
    // A ramp of RAMP decimetres a sample eastward. The slope is the
    // arctangent of the rise over the run, computed from the constants
    // rather than copied, so the test states the definition.
    const f = new Heightfield(rampGrid(RAMP));
    const at = coarseSamplePoint(400, 400);
    const expected = Math.atan((RAMP * HEIGHT_SCALE_UNITS) / COARSE_STEP_UNITS) * (180 / Math.PI);
    expect(f.slopeDegrees(at)).toBeCloseTo(expected, 6);
    // Rising to the east tilts the normal west, and not at all north-south.
    const n = f.normalAt(at);
    expect(n.nx).toBeLessThan(0);
    expect(n.nz).toBeCloseTo(0, 12);
  });

  it('finds the Napali coast far steeper than the sea floor around it', () => {
    // What the real survey can support is a COMPARISON, not an absolute:
    // the island's west wall against the open water off its corner.
    const f = field();
    let napali = 0;
    for (let row = 180; row < 320; row += 4) {
      for (let col = 120; col < 260; col += 4) {
        napali = Math.max(napali, f.slopeDegrees(coarseSamplePoint(col, row)));
      }
    }
    const open = f.slopeDegrees(world(-ISLAND_HALF_SPAN + 60_000, -ISLAND_HALF_SPAN + 60_000));
    expect(napali).toBeGreaterThan(20);
    expect(open).toBeLessThan(10);
    expect(napali).toBeGreaterThan(open * 3);
  });

  it('always returns a unit normal', () => {
    const f = field();
    f.addTile(D4, tileGrid('D4'));
    for (const at of [hdTileOrigin(D4), coarseSamplePoint(500, 500), world(0, 0)]) {
      const n = f.normalAt(at);
      expect(Math.hypot(n.nx, n.ny, n.nz)).toBeCloseTo(1, 9);
      // Up is up: the ground is never returned upside down.
      expect(n.ny).toBeGreaterThan(0);
    }
  });

  it('measures sea level from the datum the samples are stored against', () => {
    expect(SEA_LEVEL).toBe(0);
    expect(heightOf(0)).toBe(SEA_LEVEL);
  });
});
