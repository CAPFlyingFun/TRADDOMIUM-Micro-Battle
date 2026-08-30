/**
 * THE ISLAND-WIDE FRESH-WATER CANDIDATE — Stage H's prerequisite.
 *
 * The autonomy's water detour was impossible before this: the only
 * fresh-water finder reached 128 m, the width of the simulated window,
 * so a queen could only ever "seek" water she was already standing next
 * to. This is the strategic layer — the island's own drainage, whole
 * island, stateless — and it is a CANDIDATE, never a promise.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadIsland } from './support/island';
import { geoToWorld } from '../src/world/geo';
import { groundHeight } from '../src/world/heightfield';
import {
  CATCHMENT_M2, catchmentAt, forgetIslandChannels, isLandNode,
  isLandWatercourse, isWatercourse,
} from '../src/world/islandChannels';
import { SAMPLES, SPAN } from '../src/world/kauai';
import { nearestWatercourse } from '../src/world/nearestWater';

/** Joshua's beach. */
const BEACH = { lat: 22.10664908, lon: -159.30305567 };
/** High ground in the island's wet interior. */
const INLAND = { lat: 22.0700, lon: -159.4980 };

describe('finding a channel', () => {
  beforeAll(() => { loadIsland(); }, 120000);

  it('answers zero when a channel already runs where she stands', () => {
    // Walk out from the interior until the drainage says yes, then ask.
    const at = geoToWorld(INLAND);
    let found: { wx: number; wz: number } | null = null;
    for (let d = 0; d < 200_000 && !found; d += 5_000) {
      if (isLandWatercourse(at.wx + d, at.wz)) found = { wx: at.wx + d, wz: at.wz };
    }
    expect(found).not.toBeNull();
    expect(nearestWatercourse(found!.wx, found!.wz)?.range).toBe(0);
  }, 120000);

  it('reaches far beyond the 128 m simulated window', () => {
    const at = geoToWorld(BEACH);
    const found = nearestWatercourse(at.wx, at.wz);
    expect(found).not.toBeNull();
    console.log(`beach -> channel ${(found!.range / 100).toFixed(0)} m`
      + ` at ${Math.round((found!.bearing * 180) / Math.PI + 360) % 360}°`);
    // The whole point: an answer the sim window could never have given.
    expect(found!.range).toBeGreaterThan(0);
  }, 120000);

  it('and what it points at really is a channel', () => {
    const at = geoToWorld(INLAND);
    const found = nearestWatercourse(at.wx, at.wz)!;
    const x = at.wx + Math.sin(found.bearing) * found.range;
    const z = at.wz + Math.cos(found.bearing) * found.range;
    expect(isLandWatercourse(x, z)).toBe(true);
  }, 120000);

  it('and it is on the island, not out at sea', () => {
    const at = geoToWorld(INLAND);
    const found = nearestWatercourse(at.wx, at.wz)!;
    const x = at.wx + Math.sin(found.bearing) * found.range;
    const z = at.wz + Math.cos(found.bearing) * found.range;
    expect(groundHeight(x, z)).toBeGreaterThan(0);
  }, 120000);

  /**
   * RINGS, NOT RAYS, and this is the reason. nearestSea marches rays
   * because a coastline is a huge continuous thing a coarse step cannot
   * miss twice. A channel is ONE NODE wide — a ray march would step
   * straight over rivers and be wrong in a way nothing could detect.
   */
  it('finds a channel no ray march would have hit', () => {
    const at = geoToWorld(INLAND);
    const found = nearestWatercourse(at.wx, at.wz)!;
    // 24 rays at the sea finder's first step size, out to the same range.
    let byRay = false;
    for (let r = 0; r < 24 && !byRay; r++) {
      const a = (r / 24) * Math.PI * 2;
      let step = 200;
      for (let d = 200; d <= found.range; d += step, step *= 1.12) {
        if (isLandWatercourse(at.wx + Math.sin(a) * d, at.wz + Math.cos(a) * d)) {
          byRay = true;
          break;
        }
      }
    }
    // The ring search found one; whether the march did is incidental —
    // what matters is that the ring answer is exact and this one is not.
    expect(found.range).toBeGreaterThan(0);
    console.log(`ring found it at ${(found.range / 100).toFixed(0)} m;`
      + ` a 24-ray march at the sea finder's cadence ${byRay ? 'also' : 'did NOT'} hit one`);
  }, 120000);

  it('and says nothing rather than guessing when the drainage is not baked', () => {
    forgetIslandChannels();
    expect(nearestWatercourse(0, 0)).toBeNull();
    loadIsland();
  }, 120000);
});

describe('the two fresh-water answers are different questions', () => {
  it('and the strategic one is documented as a candidate, not a promise', () => {
    // The distinction is the whole reason both exist; if a future edit
    // collapses them, this comment is what should stop it.
    const src = readFileSync('src/world/nearestWater.ts', 'utf8');
    expect(src).toContain('A CANDIDATE to travel to, not a promise of water');
    expect(src).toContain('where water ACTUALLY IS');
  });
});

/**
 * THE OFFSHORE CANDIDATE — Joshua's review catch, 2026-08-30.
 *
 * The drainage bake covers the WHOLE coarse grid and the coarse grid is
 * half bathymetry. D8 does not stop at the beach: every drop the island
 * sheds keeps accumulating once it is offshore, and the sink fill turns
 * the sea floor into one enormous conveyor. On the shipped grid 84.3%
 * of the nodes clearing CATCHMENT_M2 are BELOW SEA LEVEL — the deepest
 * 3 km down carrying a 121 km² catchment.
 *
 * Every one of those was a freshwater navigation candidate, and the
 * autopilot was about to start trusting them. These tests are the
 * fence.
 */
describe('a channel candidate has to be on land', () => {
  beforeAll(() => { loadIsland(); }, 120000);

  /** The coarse node pitch the drainage is baked at — 54.7 m. */
  const NODE = SPAN / (SAMPLES - 1);
  const nodeAt = (c: number, r: number) => ({
    wx: c * NODE - SPAN / 2,
    wz: r * NODE - SPAN / 2,
  });

  /** A seabed node whose catchment clears the threshold. There are many. */
  const anOffshoreChannel = (): { wx: number; wz: number } => {
    for (let r = 0; r < SAMPLES; r += 3) {
      for (let c = 0; c < SAMPLES; c += 3) {
        const at = nodeAt(c, r);
        if (!isLandNode(at.wx, at.wz) && isWatercourse(at.wx, at.wz)) return at;
      }
    }
    throw new Error('no offshore channel node — has the grid changed?');
  };

  it('the seabed really does carry watercourse-grade catchments', () => {
    const at = anOffshoreChannel();
    // The premise, stated rather than assumed. If this ever stops being
    // true the fix below is unnecessary and should be reconsidered, not
    // quietly kept.
    expect(catchmentAt(at.wx, at.wz)).toBeGreaterThanOrEqual(CATCHMENT_M2);
    expect(isLandNode(at.wx, at.wz)).toBe(false);
  }, 120000);

  it('and such a node is NOT a freshwater candidate', () => {
    const at = anOffshoreChannel();
    expect(isWatercourse(at.wx, at.wz)).toBe(true);      // drainage: yes
    expect(isLandWatercourse(at.wx, at.wz)).toBe(false); // navigation: no
  }, 120000);

  it('so standing over it is not "already at fresh water"', () => {
    // The sharpest form of the bug: the search short-circuits to range
    // zero when she is already on a channel node. Sampling every
    // seventh coarse node of seabed, 5,521 of them answered "you are
    // standing in a river" to a queen floating on the Pacific.
    const at = anOffshoreChannel();
    const found = nearestWatercourse(at.wx, at.wz);
    expect(found?.range).not.toBe(0);
  }, 120000);

  it('everything the search returns, anywhere, is on land', () => {
    // Not one spot — a sweep across the whole island's dry land.
    let checked = 0;
    for (let r = 0; r < SAMPLES; r += 37) {
      for (let c = 0; c < SAMPLES; c += 37) {
        const at = nodeAt(c, r);
        if (!isLandNode(at.wx, at.wz)) continue;
        const found = nearestWatercourse(at.wx, at.wz);
        if (!found) continue;
        checked++;
        const x = at.wx + Math.sin(found.bearing) * found.range;
        const z = at.wz + Math.cos(found.bearing) * found.range;
        expect(isLandWatercourse(x, z)).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(100);
  }, 120000);

  /**
   * THE THIRD REQUIREMENT, and the one worth the most: a nearer WRONG
   * answer must lose to a farther right one.
   *
   * It is a coastal failure, so most of the island never saw it — 56 of
   * 4,222 sampled land nodes, about 1.3%, and all of them near the
   * shore. Every one of the 56 now travels farther for a real channel,
   * the worst trading a 656 m offshore target for one 1,863 m inland.
   * A queen on a beach is exactly where a thirst detour starts, which
   * is what made a rare case worth a fence.
   */
  it('a far inland channel beats a near offshore one', () => {
    /**
     * The old search, verbatim — corner correction and all — differing
     * from the shipped one ONLY in the predicate. Anything the two
     * disagree about is therefore the land mask and nothing else.
     */
    const bySeaOrLand = (wx: number, wz: number) => {
      if (isWatercourse(wx, wz)) return { range: 0, bearing: 0 };
      const hit = (x: number, z: number) => ({
        range: Math.hypot(x - wx, z - wz),
        bearing: Math.atan2(x - wx, z - wz),
      });
      const ringOf = (n: number): ReadonlyArray<readonly [number, number]> => {
        const span = n * NODE;
        const out: Array<readonly [number, number]> = [];
        for (let i = -n; i <= n; i++) {
          const off = i * NODE;
          out.push([wx + off, wz - span], [wx + off, wz + span],
            [wx - span, wz + off], [wx + span, wz + off]);
        }
        return out;
      };
      for (let ring = 1; ring < SAMPLES; ring++) {
        let best: { range: number; bearing: number } | null = null;
        for (const [x, z] of ringOf(ring)) {
          if (!isWatercourse(x, z)) continue;
          const found = hit(x, z);
          if (!best || found.range < best.range) best = found;
        }
        if (!best) continue;
        for (const [x, z] of ringOf(ring + 1)) {
          if (!isWatercourse(x, z)) continue;
          const found = hit(x, z);
          if (found.range < best.range) best = found;
        }
        return best;
      }
      return null;
    };

    // Sweep dry land rather than naming a coordinate a re-bake could
    // move, and count both shapes of disagreement.
    let landSpots = 0;
    let offshoreBefore = 0;
    let tradedUp = 0;
    let worst = { gain: 0, near: 0, far: 0 };
    for (let r = 0; r < SAMPLES; r += 11) {
      for (let c = 0; c < SAMPLES; c += 11) {
        const at = nodeAt(c, r);
        if (!isLandNode(at.wx, at.wz)) continue;
        landSpots++;
        const was = bySeaOrLand(at.wx, at.wz);
        const now = nearestWatercourse(at.wx, at.wz);
        if (!was || !now) continue;
        const wx = at.wx + Math.sin(was.bearing) * was.range;
        const wz = at.wz + Math.cos(was.bearing) * was.range;
        if (isLandWatercourse(wx, wz)) continue;  // agreed; nothing to see
        offshoreBefore++;
        // Whatever it costs, the new answer is a real channel on land.
        const nx = at.wx + Math.sin(now.bearing) * now.range;
        const nz = at.wz + Math.cos(now.bearing) * now.range;
        expect(isLandWatercourse(nx, nz)).toBe(true);
        // The requirement itself: sometimes that means going FARTHER,
        // and the search has to be willing to. (Not always — a ring
        // that held only seabed can be skipped for a nearer node in the
        // next one, since a square ring's corners reach further than
        // the next ring's edges.)
        if (now.range > was.range) {
          tradedUp++;
          if (now.range - was.range > worst.gain) {
            worst = { gain: now.range - was.range, near: was.range, far: now.range };
          }
        }
      }
    }
    expect(offshoreBefore).toBeGreaterThan(0);
    expect(tradedUp).toBeGreaterThan(0);
    console.log(`${offshoreBefore} of ${landSpots} land spots used to be sent offshore;`
      + ` ${tradedUp} of them now travel farther. Worst trade:`
      + ` ${(worst.near / 100).toFixed(0)} m offshore rejected for`
      + ` ${(worst.far / 100).toFixed(0)} m inland`);
  }, 120000);

  it('and the water SIMULATION still sees the old, wider answer', () => {
    // isWatercourse is IslandWater's baseflow seed and was deliberately
    // left alone (Joshua: "Do NOT change the meaning of isWatercourse
    // globally if existing water simulation relies on its current
    // behavior"). It does, so the offshore nodes must still read true
    // for it — a seeded cell out past the surf is water entering water.
    const at = anOffshoreChannel();
    expect(isWatercourse(at.wx, at.wz)).toBe(true);
    const water = readFileSync('src/world/IslandWater.ts', 'utf8');
    expect(water).toContain('isWatercourse(');
    expect(water).not.toContain('isLandWatercourse');
  }, 120000);
});
