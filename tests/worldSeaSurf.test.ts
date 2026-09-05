/**
 * THE SEA MOVES HER SIDEWAYS — the half that was missing in v0 until
 * late, and the half that decides whether an ant in the water has any
 * agency at all.
 *
 * v0's salt-water query answered `flowX: 0, flowZ: 0`, so the ocean
 * heaved a floating queen up and down and never carried her an inch.
 * `surf` is the fix, and these tests hold the v1 port to what it
 * claims: orbital motion that does not tow out deep, a breaking surge
 * that runs up the beach harder than it drains back, and a net that is
 * SHOREWARD over whole wave cycles.
 *
 * MOST OF IT RUNS ON AN ANALYTIC BEACH, and that is not a shortcut. A
 * plane of known slope has an exactly known uphill direction, so
 * `shoreward` can be checked against a right answer rather than against
 * itself, and the drift tests can name which way "in" is without
 * trusting the thing under test to say. v0's own surf tests could not
 * do this — they read a module-global heightfield — and had to scan the
 * real island to find any slope at all.
 *
 * THE REAL ISLAND STILL GETS A TEST, at the end, because a beach that
 * only exists in the test file proves nothing about Kauaʻi. That one
 * scans for coast rather than naming a coordinate: v0 named one twice
 * and was wrong twice, landing six metres up the beach and measuring a
 * sea that was not there.
 *
 * TWO THINGS HERE ARE NEW RATHER THAN CARRIED. The bore gate (see
 * BORE_FLOOR) is measured against an ungated reference rather than
 * asserted, and the deep-water net is identified as Stokes drift and
 * checked against linear theory — v0 could only say it was "small".
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { world, type WorldPoint } from '../src/world/coords';
import { decodeCoarse } from '../src/world/dem';
import { repairGrid } from '../src/world/demRepair';
import { Heightfield } from '../src/world/heightfield';
import { DEFAULT_WAVES, G, SeaSwell, greenShoalAt } from '../src/world/sea/swell';
import { BACKWASH, BORE_FLOOR, BREAKER_INDEX, GRAVITY, SHOREWARD_STEP, SeaSurf } from '../src/world/sea/surf';

// ---------------------------------------------------------------------------
// Beaches
// ---------------------------------------------------------------------------

/**
 * A beach of known slope, rising toward -x, with the shoreline at
 * wx = 0 and the sea at wx > 0.
 *
 * ORIENTED INTO THE SWELL DELIBERATELY. The shipped table runs toward
 * 245° and 222°, both of which have a negative x component, so a bed
 * that rises toward -x is a shore these waves are actually arriving at.
 * Point the beach the other way and the surf still breaks, but the
 * deep-water Stokes drift is then pulling out to sea and the net is a
 * fight between two real effects rather than a clean reading of one —
 * which is a thing worth knowing about the model, and not what these
 * tests are asking.
 */
const BEACH_SLOPE = 0.02;
const beachBed = (at: WorldPoint): number => -at.wx * BEACH_SLOPE;
/** Where the water is `depth` units deep on that beach. */
const onBeach = (depth: number, wz = 0): WorldPoint => world(depth / BEACH_SLOPE, wz);
/** Uphill on that beach, exactly. */
const BEACH_UP = { x: -1, z: 0 } as const;

const beachSea = (): { swell: SeaSwell; surf: SeaSurf } => {
  const swell = new SeaSwell({ groundAt: beachBed });
  return { swell, surf: new SeaSurf(swell) };
};

/** Deep enough that nothing is shoaled and the bore gate is shut. */
const DEEP = 4000;

// ---------------------------------------------------------------------------
// Drifting
// ---------------------------------------------------------------------------

/**
 * Advect a drifter through the flow and report where it ended up.
 *
 * THE ONLY HONEST WAY TO ASK "does the sea carry her in": the flow is
 * an oscillation, and one instant of it says nothing about the net.
 */
function drift(
  sea: { swell: SeaSwell; surf: SeaSurf },
  start: WorldPoint,
  seconds: number,
  dt = 1 / 60,
): { dx: number; dz: number; travelled: number } {
  let wx = start.wx;
  let wz = start.wz;
  let travelled = 0;
  for (let t = 0; t < seconds; t += dt) {
    sea.swell.tick(dt);
    const at = world(wx, wz);
    const ground = sea.swell.bedAt(at);
    if (ground >= 0) break;
    const surface = sea.swell.heightAt(at, -ground);
    const depth = -ground + surface;
    if (depth <= 0) break;
    const flow = sea.surf.flowAt(at, depth, surface);
    wx += flow.x * dt;
    wz += flow.z * dt;
    travelled += Math.hypot(flow.x, flow.z) * dt;
  }
  return { dx: wx - start.wx, dz: wz - start.wz, travelled };
}

/** How far the drift went toward the land, in world units. */
const shorewardOf = (moved: { dx: number; dz: number }, up: { x: number; z: number }): number =>
  moved.dx * up.x + moved.dz * up.z;

// ---------------------------------------------------------------------------
// One sea, one bed
// ---------------------------------------------------------------------------

describe('one sea, one bed', () => {
  it('reads the ground THROUGH the swell — the surf has no height source of its own', () => {
    // The structural claim the port is built on. v0 imported a module
    // global here; v1 could have injected a second `groundAt`, and that
    // is the mistake being refused: two injections are two chances to
    // break a wave on a beach the swell cannot see.
    let reads = 0;
    const swell = new SeaSwell({
      groundAt: (at) => {
        reads += 1;
        return beachBed(at);
      },
    });
    const surf = new SeaSurf(swell);
    reads = 0;
    const up = surf.shoreward(onBeach(40));
    expect(up).not.toBeNull();
    // Four samples, all of them the swell's — east, west, south, north.
    expect(reads).toBe(4);
  });

  it('follows the swell’s bed when the bed changes, because there is only one', () => {
    let flipped = false;
    const swell = new SeaSwell({ groundAt: (at) => (flipped ? at.wx : -at.wx) * BEACH_SLOPE });
    const surf = new SeaSurf(swell);
    expect(surf.shoreward(onBeach(40))?.x).toBeCloseTo(-1, 9);
    flipped = true;
    expect(surf.shoreward(onBeach(40))?.x).toBeCloseTo(1, 9);
  });

  it('does not touch the ground at all in open water', () => {
    // What the bore gate is FOR. Four heightfield reads per query, for
    // the slope of a sea floor three kilometres down, several times a
    // frame, is the kind of CPU cost Joshua named as the ocean's
    // problem on his phone.
    let reads = 0;
    const swell = new SeaSwell({
      groundAt: (at) => {
        reads += 1;
        return beachBed(at);
      },
    });
    const surf = new SeaSurf(swell);
    swell.tick(1 / 60);
    reads = 0;
    surf.flowAt(onBeach(DEEP), DEEP, 3);
    expect(reads).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The constants
// ---------------------------------------------------------------------------

describe('the constants have one home', () => {
  it('shares gravity with the swell instead of declaring a second one', () => {
    // v0 had `GRAVITY = 981` in surf.ts and `G = 981` in seaSwell.ts —
    // two names for one constant, in the pair of modules whose own
    // comments name the two-answers disease. Same value, one home.
    expect(GRAVITY).toBe(G);
    expect(GRAVITY).toBe(981);
  });

  it('shares the breaker index with the swell', () => {
    // The index that says where the water breaks is the one that says
    // how tall the water will let the wave stand.
    expect(BREAKER_INDEX).toBeCloseTo(0.78, 9);
  });

  it('keeps v0’s tuned numbers exactly', () => {
    expect(BACKWASH).toBe(0.4);
    expect(BACKWASH).toBeLessThan(1);
    expect(SHOREWARD_STEP).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Where the wave breaks
// ---------------------------------------------------------------------------

describe('where the wave breaks', () => {
  it('breaks at a depth the wave height sets, not at a constant', () => {
    const { surf } = beachSea();
    // Deep water is not breaking; the shallows are.
    expect(surf.breaksAt(1000)).toBeLessThan(1000);
    expect(surf.breaksAt(40)).toBeGreaterThan(40);
  });

  it('needs more water than the wave is tall, by the breaker index', () => {
    const { swell, surf } = beachSea();
    // Out deep, where shoaling is 1, the depth it would break in is
    // exactly its own height over 0.78.
    expect(surf.breaksAt(DEEP)).toBeCloseTo((2 * swell.amplitude()) / BREAKER_INDEX, 6);
    // And in the surf, the shoaled wave needs more.
    expect(surf.breaksAt(40)).toBeGreaterThan(2 * swell.amplitude());
  });

  it('reads Green’s law UNCAPPED, which is the whole point of it', () => {
    // The distinguishing test, and one v0 argued for in a comment and
    // never measured. `breaksAt` asks "how much water would this wave
    // NEED" — so it must use the shoaling the wave wants, not the
    // shoaling the depth allowed. Read off the capped answer instead
    // and it would report roughly the depth it is already in, all
    // through the surf, and say nothing.
    const { swell, surf } = beachSea();
    for (const depth of [20, 30, 40, 50, 60]) {
      const capped = (2 * swell.amplitude() * swell.shoalAt(depth)) / BREAKER_INDEX;
      expect(surf.breaksAt(depth), `${depth} units deep`).toBeGreaterThan(capped);
      expect(surf.breaksAt(depth)).toBeCloseTo(
        (2 * swell.amplitude() * greenShoalAt(depth)) / BREAKER_INDEX, 9,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Which way the land rises
// ---------------------------------------------------------------------------

describe('which way the land rises', () => {
  it('points uphill, as a unit vector', () => {
    const { surf } = beachSea();
    const up = surf.shoreward(onBeach(40));
    expect(up).not.toBeNull();
    expect(up!.x).toBeCloseTo(BEACH_UP.x, 9);
    expect(up!.z).toBeCloseTo(BEACH_UP.z, 9);
    expect(Math.hypot(up!.x, up!.z)).toBeCloseTo(1, 9);
  });

  it('finds the diagonal when the beach runs diagonally', () => {
    const swell = new SeaSwell({ groundAt: (at) => -(at.wx + at.wz) * BEACH_SLOPE });
    const up = new SeaSurf(swell).shoreward(world(2000, 2000));
    expect(up!.x).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(up!.z).toBeCloseTo(-Math.SQRT1_2, 9);
  });

  it('says null on flat ground rather than inventing a direction', () => {
    // A real answer, not a failure: a wave arriving on a flat plain has
    // no preferred direction and the orbital flow is the whole story.
    const swell = new SeaSwell({ groundAt: () => -500 });
    expect(new SeaSurf(swell).shoreward(world(0, 0))).toBeNull();
  });

  it('measures across a stride, so a wider stencil sees a slope a narrow one misses', () => {
    // Why SHOREWARD_STEP is 40 and not a hair's breadth: the gradient
    // is read across real ground, and what counts as "the slope here"
    // depends on how far apart the samples are.
    const swell = new SeaSwell({
      // A bench: flat out to wx = 100, then rising. A ±40 stencil at
      // the origin sits entirely on the flat and reports no slope; a
      // ±400 one reaches the rise and finds it.
      groundAt: (at) => (at.wx < 100 ? -500 : -500 + (at.wx - 100) * 0.1),
    });
    const surf = new SeaSurf(swell);
    expect(surf.shoreward(world(0, 0))).toBeNull();
    expect(surf.shoreward(world(0, 0), 400)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The two regimes
// ---------------------------------------------------------------------------

describe('the two regimes', () => {
  it('is still where there is no water', () => {
    const { surf } = beachSea();
    const flow = surf.flowAt(onBeach(40), 0, 0);
    expect(flow.x).toBe(0);
    expect(flow.z).toBe(0);
    // The same frozen object every time — open sea is the common case
    // and the still answer must not allocate.
    expect(surf.flowAt(world(0, 0), -5, 0)).toBe(flow);
    expect(Object.isFrozen(flow)).toBe(true);
  });

  it('is the orbital flow alone in deep water — nothing else is added out there', () => {
    const { swell, surf } = beachSea();
    for (let i = 0; i < 60; i += 1) {
      swell.tick(1 / 60);
      const at = onBeach(DEEP, i * 37);
      const surface = swell.heightAt(at, DEEP);
      const flow = surf.flowAt(at, DEEP, surface);
      const orbit = swell.orbitalAt(at, DEEP);
      expect(flow.x).toBe(orbit.x);
      expect(flow.z).toBe(orbit.z);
    }
  });

  it('never lets the bore gate move the water by more than BORE_FLOOR', () => {
    // The gate is an optimisation, so it owes a bound, not an
    // assurance. This re-implements v0's ungated arithmetic and holds
    // the gated answer to within BORE_FLOOR of it across the whole
    // depth range and many instants. Measured worst case is about
    // 1.5e-2 units/s — a fifth of a percent of her paddle stroke.
    const { swell, surf } = beachSea();
    const ungated = (at: WorldPoint, depth: number, surface: number): { x: number; z: number } => {
      const orbit = swell.orbitalAt(at, depth);
      const broken = swell.brokenAt(depth);
      const up = surf.shoreward(at);
      if (!up) return orbit;
      const swing = Math.tanh(surface / (swell.reach() * 0.3));
      let run = Math.sqrt(G * depth) * swing;
      if (run < 0) run *= BACKWASH;
      return {
        x: orbit.x * (1 - broken) + up.x * run * broken,
        z: orbit.z * (1 - broken) + up.z * run * broken,
      };
    };
    let worst = 0;
    for (let step = 0; step < 120; step += 1) {
      swell.tick(1 / 60);
      for (let depth = 1; depth <= 20000; depth = depth < 100 ? depth + 1 : Math.round(depth * 1.1)) {
        const at = onBeach(depth, depth * 0.37);
        const surface = swell.heightAt(at, depth);
        const gated = surf.flowAt(at, depth, surface);
        const plain = ungated(at, depth, surface);
        worst = Math.max(worst, Math.hypot(gated.x - plain.x, gated.z - plain.z));
      }
    }
    expect(worst).toBeLessThan(BORE_FLOOR);
  });

  it('runs up the beach harder than it drains back', () => {
    // The asymmetry is real surf, not a safety net, and it is what
    // leaves a net shoreward drift over whole cycles.
    const { swell, surf } = beachSea();
    const at = onBeach(30);
    let inward = 0;
    let outward = 0;
    for (let i = 0; i < 720; i += 1) {
      swell.tick(1 / 60);
      const ground = swell.bedAt(at);
      const surface = swell.heightAt(at, -ground);
      const depth = -ground + surface;
      if (depth <= 0) continue;
      const flow = surf.flowAt(at, depth, surface);
      const along = shorewardOf({ dx: flow.x, dz: flow.z }, BEACH_UP);
      if (along > 0) inward += along; else outward -= along;
    }
    expect(inward).toBeGreaterThan(outward);
  });

  it('out-swims the ant by an order of magnitude, which is the point', () => {
    // Her paddle afloat is 2.6 units/s and her top pace over the ground
    // is 12. An ant does not out-swim the ocean.
    const { swell, surf } = beachSea();
    const at = onBeach(30);
    let peak = 0;
    for (let i = 0; i < 400; i += 1) {
      swell.tick(1 / 60);
      const ground = swell.bedAt(at);
      const surface = swell.heightAt(at, -ground);
      const flow = surf.flowAt(at, -ground + surface, surface);
      peak = Math.max(peak, Math.hypot(flow.x, flow.z));
    }
    expect(peak).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// Over whole cycles
// ---------------------------------------------------------------------------

describe('over whole wave cycles', () => {
  it('carries a floating queen TOWARD the land', () => {
    for (const depth of [25, 30, 40, 50]) {
      const moved = drift(beachSea(), onBeach(depth), 12);
      const along = shorewardOf(moved, BEACH_UP);
      expect(along, `${depth} units deep`).toBeGreaterThan(0);
      // And it is a real distance, not a rounding error: she is an ant,
      // so a hundred units is a hundred body lengths up the beach.
      expect(along, `${depth} units deep`).toBeGreaterThan(100);
    }
  });

  it('washes her in at the frame rate the phone actually runs, not just the test rig', () => {
    // THE DEVICE IS NOT A TEST RIG. v0's headless probe managed about
    // 1.5 frames a second, which advances the swell 168 degrees a step:
    // the flow it samples is aliased into noise and the net drift it
    // reports is meaningless in either direction. Joshua's phone runs
    // the terrain build at 60 and v0's ocean build at 10 to 30, so the
    // model has to give the same answer across that whole band or the
    // surf is a different sea depending on the frame rate.
    const reference = shorewardOf(drift(beachSea(), onBeach(30), 12, 1 / 60), BEACH_UP);
    for (const rate of [30, 16, 10]) {
      const along = shorewardOf(drift(beachSea(), onBeach(30), 12, 1 / rate), BEACH_UP);
      expect(along / reference, `${rate} Hz`).toBeGreaterThan(0.95);
      expect(along / reference, `${rate} Hz`).toBeLessThan(1.05);
    }
  });

  it('has no rail against the open sea — swimming exists now', () => {
    // The pre-swimming build forbade any seaward component past ten
    // body lengths of water, because a queen towed out to sea was a
    // soft lock with no way back. Deep water must be free to push her
    // out as well as in, or the ocean is a funnel.
    const { swell, surf } = beachSea();
    const at = onBeach(DEEP);
    let sawSeaward = false;
    for (let i = 0; i < 400; i += 1) {
      swell.tick(1 / 60);
      const surface = swell.heightAt(at, DEEP);
      const flow = surf.flowAt(at, DEEP + surface, surface);
      if (shorewardOf({ dx: flow.x, dz: flow.z }, BEACH_UP) < 0) sawSeaward = true;
    }
    expect(sawSeaward).toBe(true);
  });

  it('rocks far more than it tows, out where the wave is still a wave', () => {
    const moved = drift(beachSea(), onBeach(DEEP), 12);
    const net = Math.hypot(moved.dx, moved.dz);
    // The water goes a long way each way and comes back nearly to
    // where it started, which is what floating in a swell IS.
    expect(moved.travelled).toBeGreaterThan(300);
    expect(net).toBeLessThan(moved.travelled * 0.5);
  });

  it('what net there is out deep is Stokes drift — downwave, at the size linear theory gives', () => {
    // v0 could only say the deep net was "small". It is not noise: an
    // advected particle in a wave field samples a slightly faster
    // forward phase than backward one, and drifts downwave at omega·k·A²
    // per component. Naming it is worth more than bounding it, because
    // a net drift in any OTHER direction would mean the port had the
    // wave headings or the velocity sign wrong — and both of those are
    // mistakes v0 made at least once.
    let sx = 0;
    let sz = 0;
    for (const w of DEFAULT_WAVES) {
      const rate = w.omega * w.k * w.amp * w.amp;
      sx += rate * w.dx;
      sz += rate * w.dz;
    }
    const predicted = Math.hypot(sx, sz) * 12;
    const moved = drift(beachSea(), onBeach(DEEP), 12);
    const net = Math.hypot(moved.dx, moved.dz);
    // Direction: within a few degrees of the summed wave heading.
    const cosine = (moved.dx * sx + moved.dz * sz) / (net * Math.hypot(sx, sz));
    expect(cosine).toBeGreaterThan(0.99);
    // Size: the right order. Linear theory is an over-estimate here —
    // the surface-velocity model carries no depth decay and the two
    // components' cross terms partly cancel — so this is a band, not a
    // match, and it is a band that a sign error or a missing component
    // would leave.
    expect(net).toBeGreaterThan(predicted * 0.25);
    expect(net).toBeLessThan(predicted * 1.5);
  });
});

// ---------------------------------------------------------------------------
// The real island
// ---------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Kauaʻi's coarse survey, repaired, as the sea bed. */
function realIsland(): Heightfield {
  const bytes = readFileSync(path.join(ROOT, 'public', 'kauai-1025.bin'));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Heightfield(repairGrid(decodeCoarse(buffer)).grid);
}

describe('on Kauaʻi itself', () => {
  it('washes a drifter onto every stretch of coast the swell is running at', () => {
    // SCANNED, NOT NAMED. v0 named a coastal coordinate twice and was
    // wrong twice — a lat/lon through the wrong converter landed six
    // metres up the beach, and the tests then measured a sea that was
    // not there and passed a zero as agreement.
    //
    // The filter is physical rather than convenient: a beach the swell
    // is running AT should have things washed onto it. A beach the
    // swell runs away from is a real place too, and there the deep
    // Stokes drift and the shorebreak pull opposite ways — an
    // interesting question, and not this test's.
    const field = realIsland();
    const islandSea = (): { swell: SeaSwell; surf: SeaSurf } => {
      const swell = new SeaSwell({ groundAt: (at: WorldPoint) => field.heightAt(at) });
      return { swell, surf: new SeaSurf(swell) };
    };
    // The table's energy-weighted heading, as a unit vector.
    let waveX = 0;
    let waveZ = 0;
    for (const w of DEFAULT_WAVES) {
      waveX += w.amp * w.dx;
      waveZ += w.amp * w.dz;
    }
    const waveLen = Math.hypot(waveX, waveZ);
    waveX /= waveLen;
    waveZ /= waveLen;

    const scout = islandSea();
    const facing: { at: WorldPoint; up: { x: number; z: number } }[] = [];
    for (let wx = -2_600_000; wx <= 2_600_000 && facing.length < 8; wx += 20_000) {
      for (let wz = -2_600_000; wz <= 2_600_000 && facing.length < 8; wz += 20_000) {
        const at = world(wx, wz);
        const bed = field.heightAt(at);
        // The surf zone: shallow enough to break, deep enough to have a
        // wave left after the swash taper.
        if (bed > -25 || bed < -45) continue;
        const up = scout.surf.shoreward(at);
        if (!up) continue;
        // Running AT this shore, not along it or away from it. Both are
        // unit vectors, so this is the cosine between them.
        if (up.x * waveX + up.z * waveZ < 0.5) continue;
        facing.push({ at, up });
      }
    }

    // The scan must find coast, or a short list would pass silently —
    // which is exactly how v0's named-coordinate version reported
    // agreement with a sea that was not there. On the shipped coarse
    // survey this grid finds 23 spots in the depth band and 6 of them
    // facing the swell, on the east, south and south-west shores.
    expect(facing.length).toBeGreaterThanOrEqual(4);
    for (const spot of facing) {
      const moved = drift(islandSea(), spot.at, 12);
      expect(
        shorewardOf(moved, spot.up),
        `${spot.at.wx},${spot.at.wz} (bed ${field.heightAt(spot.at).toFixed(0)})`,
      ).toBeGreaterThan(0);
    }
  });
});
