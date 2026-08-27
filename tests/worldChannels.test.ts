import { beforeAll, describe, expect, it } from 'vitest';
import type { Hydro } from '../src/world/hydro';
import { loadIsland } from './support/island';
import { catchmentAt, isWatercourse } from '../src/world/islandChannels';

let hydro: Hydro;
beforeAll(() => { hydro = loadIsland(); });

describe('the world-fixed channel map', () => {
  it('gives the SAME answer regardless of any window — by construction, checked anyway', () => {
    // THE REGRESSION TEST FOR THE MORPHING BUG (PR #2's finding).
    // The old per-window D8 disagreed with itself on 16% of shared
    // channel cells one re-centre apart. A world-space lookup cannot,
    // but "cannot" has shipped broken before, so: same coordinates,
    // asked twice, in different orders, interleaved with other reads.
    const spots: [number, number][] = [];
    for (let i = 0; i < 2000; i++) {
      spots.push([(i * 7919) % 5_000_000 - 2_500_000, (i * 104729) % 5_000_000 - 2_500_000]);
    }
    const first = spots.map(([x, z]) => isWatercourse(x, z));
    spots.reverse();
    const second = spots.map(([x, z]) => isWatercourse(x, z)).reverse();
    expect(first).toEqual(second);
  });

  it('finds the great valleys — the island’s biggest catchments are rivers', () => {
    // The Waimea drains ~150 km²; the map must consider its mouth a
    // watercourse many times over the threshold.
    let biggest = 0;
    for (const river of hydro.rivers) {
      if (river.order < 5) continue;
      for (let p = river.first; p < river.first + river.count; p += 8) {
        biggest = Math.max(biggest, catchmentAt(hydro.x[p], hydro.z[p]));
      }
    }
    expect(biggest).toBeGreaterThan(10_000_000); // ≥ 10 km² through an order-5 trunk
  });

  it('agrees with the survey where the survey is big', () => {
    // Order-4/5 reaches are unambiguous rivers; the island's own
    // drainage should put a watercourse on (or within a node of) most
    // of their sampled midpoints. Order-1 trickles are BELOW the
    // threshold by design and are not asserted.
    let hit = 0; let looked = 0;
    for (const river of hydro.rivers) {
      if (river.order < 4 || river.count < 10) continue;
      const p = river.first + Math.floor(river.count / 2);
      looked++;
      // within one coarse node either way
      const NODE = 5469;
      let found = false;
      for (let dz = -1; dz <= 1 && !found; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (isWatercourse(hydro.x[p] + dx * NODE, hydro.z[p] + dz * NODE)) { found = true; break; }
        }
      }
      if (found) hit++;
    }
    console.log(`order-4/5 midpoints on a watercourse: ${hit}/${looked}`);
    expect(hit / looked).toBeGreaterThan(0.8);
  });
});
