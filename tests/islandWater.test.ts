import { beforeAll, describe, expect, it } from 'vitest';
import type { Hydro } from '../src/world/hydro';
import { loadIsland } from './support/island';
import { terrainHeight } from '../src/world/heightfield';

import { WaterSim } from '../src/world/waterSim';

let hydro: Hydro;
beforeAll(() => { hydro = loadIsland(); });

const CELL = 100;

/**
 * One window centred on a reach, fed the way IslandWater feeds it.
 *
 * Smaller than the game's 256² so a sweep of the whole island is a
 * test and not an errand: the invariants below are properties of the
 * solver and the survey, and neither cares how wide the window is.
 */
function runAt(cx: number, cz: number, n = 64, steps = 600) {
  const sim = new WaterSim({ n, cell: CELL, dt: 0.02, soak: 0.3 });
  const span = n * CELL;
  const ox = cx - span / 2;
  const oz = cz - span / 2;
  sim.fillBed((ix, iy) => terrainHeight(ox + ix * CELL, oz + iy * CELL));
  // FED THE WAY THE ISLAND FEEDS — rain on the upper catchment, and
  // the terrain does the routing. The survey is not an input to the
  // water any more (CLAUDE.md: "The terrain is not ours to move"); it
  // is what tests/fullness.test.ts checks the RESULT against.
  const sorted = Float32Array.from(sim.bed).sort();
  const mark = sorted[Math.floor(sorted.length * 0.5)];
  const feed = new Float32Array(n * n);
  for (let i = 0; i < feed.length; i++) {
    feed[i] = sim.bed[i] >= mark && sim.bed[i] > 0 ? 1.5 : 0;
  }
  let fedHeight = 0; let fedCount = 0;
  for (let i = 0; i < feed.length; i++) {
    if (feed[i] > 0) { fedHeight += sim.bed[i]; fedCount++; }
  }
  for (let s = 0; s < steps; s++) {
    for (let i = 0; i < feed.length; i++) if (feed[i] > 0) sim.depth[i] += feed[i] * 0.02;
    sim.step(true);
  }
  return { sim, feed, fedCount, fedMean: fedCount ? fedHeight / fedCount : 0 };
}

describe('the island under water, checked rather than looked at', () => {
  /**
   * THE POINT OF THIS FILE. There are 1,121 surveyed runs. Looking at
   * each one, from both banks, at several angles, is not a review — it
   * is a career. These are the properties that made every previous
   * water system wrong, asserted across a sweep of the real island so
   * that "it works" is a measurement instead of an impression.
   */
  const sample = () => {
    const out: { name: string; x: number; z: number }[] = [];
    for (let r = 0; r < hydro.rivers.length; r += 17) {
      const river = hydro.rivers[r];
      if (river.count < 2) continue;
      const mid = river.first + Math.floor(river.count / 2);
      out.push({ name: river.name ?? `run ${r}`, x: hydro.x[mid], z: hydro.z[mid] });
    }
    return out;
  };

  it('never blows up, anywhere on the island', () => {
    const spots = sample();
    expect(spots.length).toBeGreaterThan(50);
    const bad: string[] = [];
    for (const spot of spots) {
      const { sim } = runAt(spot.x, spot.z);
      for (let i = 0; i < sim.depth.length; i++) {
        const d = sim.depth[i];
        if (!Number.isFinite(d) || d < 0 || d > 5_000) {
          bad.push(`${spot.name}: depth ${d} at cell ${i}`);
          break;
        }
      }
    }
    expect(bad).toEqual([]);
  }, 900_000);

  it('cannot put water above the ground it stands on — by construction', () => {
    // Surface IS bed + depth, so this can only fail if depth goes
    // negative. That is the whole reason the drawn-water attempts kept
    // floating and this cannot: there is no second surface to disagree.
    const spots = sample().slice(0, 12);
    for (const spot of spots) {
      const { sim } = runAt(spot.x, spot.z);
      for (let i = 0; i < sim.depth.length; i++) {
        expect(sim.surface(i)).toBeGreaterThanOrEqual(sim.bed[i]);
      }
    }
  }, 900_000);

  it('carries water downhill from where the survey put it', () => {
    // The physical claim, island-wide: water fed onto surveyed reaches
    // ends up lower than it started. If a window ever reported water
    // pooling ABOVE its own sources, the solver would be climbing.
    const spots = sample().slice(0, 20);
    let checked = 0;
    for (const spot of spots) {
      const { sim, fedCount, fedMean } = runAt(spot.x, spot.z);
      if (fedCount < 5) continue;
      let wet = 0; let wetHeight = 0;
      for (let i = 0; i < sim.depth.length; i++) {
        if (sim.depth[i] > 1.5) { wet += sim.depth[i]; wetHeight += sim.bed[i] * sim.depth[i]; }
      }
      if (wet <= 0) continue;
      checked++;
      expect(wetHeight / wet).toBeLessThanOrEqual(fedMean + 1e-3);
    }
    expect(checked).toBeGreaterThan(5);
  }, 900_000);


  it('is deterministic — the same window twice is the same water', () => {
    // A world that reloads to a different river is a world that cannot
    // be saved, screenshotted or reported against.
    const spot = sample()[3];
    const a = runAt(spot.x, spot.z, 48, 300).sim;
    const b = runAt(spot.x, spot.z, 48, 300).sim;
    for (let i = 0; i < a.depth.length; i++) expect(a.depth[i]).toBe(b.depth[i]);
  }, 300_000);

});
