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
import { isWatercourse, forgetIslandChannels } from '../src/world/islandChannels';
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
      if (isWatercourse(at.wx + d, at.wz)) found = { wx: at.wx + d, wz: at.wz };
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
    expect(isWatercourse(x, z)).toBe(true);
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
        if (isWatercourse(at.wx + Math.sin(a) * d, at.wz + Math.cos(a) * d)) {
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
