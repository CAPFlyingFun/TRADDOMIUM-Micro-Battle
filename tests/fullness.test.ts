import { beforeAll, describe, expect, it } from 'vitest';
import type { Hydro } from '../src/world/hydro';
import { loadIsland } from './support/island';
import { terrainHeight } from '../src/world/heightfield';
import { UNITS_PER_METRE } from '../src/world/kauai';
import { WaterSim } from '../src/world/waterSim';
import { isWatercourse } from '../src/world/islandChannels';

let hydro: Hydro;
beforeAll(() => { hydro = loadIsland(); });

const CELL = 100, N = 128, DRAWN = 1.5;

/**
 * A window fed EXACTLY as the island feeds it — rain on the upper
 * catchment, terrain does the routing, nothing told about rivers.
 */
function rained(px: number, pz: number, steps: number, base = 1.5, storm = 0, soak = 0.3): WaterSim {
  const span = N * CELL, ox = px - span / 2, oz = pz - span / 2;
  const sim = new WaterSim({ n: N, cell: CELL, dt: 0.02, soak });
  sim.fillBed((ix, iy) => terrainHeight(ox + ix * CELL, oz + iy * CELL));
  // EXACTLY WHAT THE ISLAND DOES: baseflow into the WORLD-FIXED
  // watercourses (islandChannels.ts — island-wide D8, baked once),
  // stormflow over the catchment only while it is raining.
  const course = new Uint8Array(N * N);
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      course[iy * N + ix] = isWatercourse(ox + ix * CELL, oz + iy * CELL) ? 1 : 0;
    }
  }
  const sorted = Float32Array.from(sim.bed).sort();
  const mark = sorted[Math.floor(sorted.length * 0.35)];
  for (let s = 0; s < steps; s++) {
    for (let i = 0; i < sim.depth.length; i++) {
      const land = sim.bed[i] > 0;
      if (land && course[i]) sim.depth[i] += base * 0.02;
      if (storm > 0 && land && sim.bed[i] >= mark) sim.depth[i] += storm * 0.02;
    }
    sim.step(true);
  }
  return sim;
}

describe('does the water land where Kauaʻi keeps its rivers', () => {
  /**
   * NOT A DRIVER — A CHECK.
   *
   * The island is not told where its rivers are; it rains on the high
   * ground and the terrain routes it (CLAUDE.md: "The terrain is not
   * ours to move"). So the surveyed network becomes the thing to test
   * the RESULT against, and what this measures is really how well the
   * 13.67 m elevation model agrees with the surveyed hydrography.
   *
   * A disagreement here is information about the data, not a licence
   * to cut the ground a channel until the two match.
   */
  it('sweeps the baseflow rate for coverage and flooding', () => {
    const NEAR = 5;
    for (const [base, storm] of [[0.3, 0], [0.8, 0], [2, 0], [4, 0], [2, 1.5]]) {
      let on = 0, looked = 0, wet = 0, vol = 0;
      for (let r = 0; r < hydro.rivers.length; r += 149) {
        const river = hydro.rivers[r];
        if (river.count < 6) continue;
        const p = river.first + Math.floor(river.count / 2);
        const px = hydro.x[p], pz = hydro.z[p];
        const sim = rained(px, pz, 1200, base, storm);
        const span = N * CELL, ox = px - span / 2, oz = pz - span / 2;
        const cx = Math.round((px - ox) / CELL), cy = Math.round((pz - oz) / CELL);
        let found = false;
        for (let dy = -NEAR; dy <= NEAR && !found; dy++) {
          for (let dx = -NEAR; dx <= NEAR; dx++) {
            const ix = cx + dx, iy = cy + dy;
            if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
            if (sim.depth[iy * N + ix] > DRAWN) { found = true; break; }
          }
        }
        for (let i = 0; i < sim.depth.length; i++) { vol += sim.depth[i]; if (sim.depth[i] > DRAWN) wet++; }
        if (found) on++;
        looked++;
      }
      console.log(`base ${String(base).padStart(3)} storm ${String(storm).padStart(4)}: ${on}/${looked} on course, ${(100 * wet / (looked * N * N)).toFixed(1)}% cells wet`);
    }
    expect(true).toBe(true);
  }, 1800000);

  it('reports agreement between the routed water and the survey', () => {
    const NEAR = 5;                                   // cells, so 5 m
    let onCourse = 0; let looked = 0; let volume = 0; let wetCells = 0;
    for (let r = 0; r < hydro.rivers.length; r += 149) {
      const river = hydro.rivers[r];
      if (river.count < 6) continue;
      const p = river.first + Math.floor(river.count / 2);
      const px = hydro.x[p], pz = hydro.z[p];
      const sim = rained(px, pz, 1200, 2);
      const span = N * CELL, ox = px - span / 2, oz = pz - span / 2;
      const cx = Math.round((px - ox) / CELL), cy = Math.round((pz - oz) / CELL);
      let found = false;
      for (let dy = -NEAR; dy <= NEAR && !found; dy++) {
        for (let dx = -NEAR; dx <= NEAR; dx++) {
          const ix = cx + dx, iy = cy + dy;
          if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
          if (sim.depth[iy * N + ix] > DRAWN) { found = true; break; }
        }
      }
      for (let i = 0; i < sim.depth.length; i++) {
        volume += sim.depth[i];
        if (sim.depth[i] > DRAWN) wetCells++;
      }
      if (found) onCourse++;
      looked++;
    }
    const litres = (volume * CELL * CELL) / 1000;
    console.log(`RAIN-FED, terrain routed: ${onCourse}/${looked} surveyed points have water within ${NEAR} m`);
    console.log(`  mean ${(litres / Math.max(1, looked) / 1000).toFixed(1)} m³ and ${(100 * wetCells / (looked * N * N)).toFixed(1)}% of cells wet a window`);
    expect(looked).toBeGreaterThan(4);
  }, 1800000);

  it('concentrates rather than sheeting — the water picks channels', () => {
    // The property that says the terrain is doing the routing. Sheet
    // flow puts ~5% of the water in the wettest 5% of cells; drainage
    // puts most of it there.
    const river = hydro.rivers.find((r) => r.order >= 4 && r.count > 20)!;
    const p = river.first + Math.floor(river.count / 2);
    // The SHIPPED baseflow, not a leftover from an older sweep.
    const sim = rained(hydro.x[p], hydro.z[p], 2000, 2);
    const d = Array.from(sim.depth).sort((a, b) => b - a);
    const total = d.reduce((a, b) => a + b, 0);
    const top = d.slice(0, Math.floor(d.length * 0.05)).reduce((a, b) => a + b, 0);
    const share = total > 0 ? top / total : 0;
    console.log(`top 5% of cells hold ${(100 * share).toFixed(1)}% of the water`);
    expect(share).toBeGreaterThan(0.5);
  }, 600000);

  it('the surveyed channels, for scale', () => {
    const w: number[] = [];
    for (let i = 0; i < hydro.width.length; i += 13) if (hydro.width[i] > 0) w.push(hydro.width[i]);
    w.sort((a, b) => a - b);
    const m = (u: number) => (u / UNITS_PER_METRE).toFixed(1);
    console.log(`surveyed width: median ${m(w[Math.floor(w.length / 2)])} m, p95 ${m(w[Math.floor(w.length * 0.95)])} m`);
    expect(w.length).toBeGreaterThan(100);
  });
});
