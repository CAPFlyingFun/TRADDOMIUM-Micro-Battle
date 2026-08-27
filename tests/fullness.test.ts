import { beforeAll, describe, it } from 'vitest';
import type { Hydro } from '../src/world/hydro';
import { loadIsland } from './support/island';
import { terrainHeight } from '../src/world/heightfield';
import { UNITS_PER_METRE } from '../src/world/kauai';
import { WaterSim } from '../src/world/waterSim';
import { feedFromSurvey } from '../src/world/waterFeed';

let hydro: Hydro;
beforeAll(() => { hydro = loadIsland(); });

const CELL = 100, N = 128, DRAWN = 1.5;

/** Wet run across the channel at a surveyed point, in world units. */
function wetWidthAt(pointIndex: number, order: number, perOrder: number, steps: number) {
  const px = hydro.x[pointIndex], pz = hydro.z[pointIndex];
  const span = N * CELL, ox = px - span / 2, oz = pz - span / 2;
  const sim = new WaterSim({ n: N, cell: CELL, dt: 0.02 });
  sim.fillBed((ix, iy) => terrainHeight(ox + ix * CELL, oz + iy * CELL));
  const feed = feedFromSurvey(hydro, ox, oz, N, CELL, perOrder);
  for (let s = 0; s < steps; s++) {
    for (let i = 0; i < feed.length; i++) if (feed[i] > 0) sim.depth[i] += feed[i] * 0.02;
    sim.step(true);
  }
  // Perpendicular to the local course.
  const ax = hydro.x[Math.max(0, pointIndex - 1)], az = hydro.z[Math.max(0, pointIndex - 1)];
  const bx = hydro.x[pointIndex + 1] ?? px, bz = hydro.z[pointIndex + 1] ?? pz;
  let dx = bx - ax, dz = bz - az;
  const run = Math.hypot(dx, dz) || 1; dx /= run; dz /= run;
  const at = (t: number) => {
    const wx = px + -dz * t, wz = pz + dx * t;
    const ix = Math.round((wx - ox) / CELL), iy = Math.round((wz - oz) / CELL);
    if (ix < 0 || iy < 0 || ix >= N || iy >= N) return 0;
    return sim.depth[iy * N + ix];
  };
  let wet = 0;
  for (let t = 0; t < 40 * CELL; t += CELL) { if (at(t) > DRAWN) wet += CELL; else break; }
  for (let t = -CELL; t > -40 * CELL; t -= CELL) { if (at(t) > DRAWN) wet += CELL; else break; }
  let vol = 0;
  for (let i = 0; i < sim.depth.length; i++) vol += sim.depth[i];
  return { wet, volume: vol * CELL * CELL, order };
}

describe('how full are the rivers', () => {
  it('reports how much of the surveyed network is actually wet', () => {
    // THE HEADLINE. Joshua asked how much water is in the island; this
    // is the answer as a number rather than an impression. For a
    // sample of surveyed points: is there ANY drawn water within a few
    // metres of where the survey says a river is?
    const NEAR = 5;                                    // cells, so 5 m
    for (const perOrder of [12, 20, 32]) {
      let onCourse = 0; let looked = 0; let volume = 0;
      for (let r = 0; r < hydro.rivers.length; r += 149) {
        const river = hydro.rivers[r];
        if (river.count < 6) continue;
        const p = river.first + Math.floor(river.count / 2);
        const px = hydro.x[p], pz = hydro.z[p];
        const span = N * CELL, ox = px - span / 2, oz = pz - span / 2;
        const sim = new WaterSim({ n: N, cell: CELL, dt: 0.02 });
        sim.fillBed((ix, iy) => terrainHeight(ox + ix * CELL, oz + iy * CELL));
        const feed = feedFromSurvey(hydro, ox, oz, N, CELL, perOrder);
        for (let s = 0; s < 1200; s++) {
          for (let i = 0; i < feed.length; i++) if (feed[i] > 0) sim.depth[i] += feed[i] * 0.02;
          sim.step(true);
        }
        const cx = Math.round((px - ox) / CELL), cy = Math.round((pz - oz) / CELL);
        let found = false;
        for (let dy = -NEAR; dy <= NEAR && !found; dy++) {
          for (let dx = -NEAR; dx <= NEAR; dx++) {
            const ix = cx + dx, iy = cy + dy;
            if (ix < 0 || iy < 0 || ix >= N || iy >= N) continue;
            if (sim.depth[iy * N + ix] > DRAWN) { found = true; break; }
          }
        }
        for (let i = 0; i < sim.depth.length; i++) volume += sim.depth[i];
        if (found) onCourse++;
        looked++;
      }
      const litres = (volume * CELL * CELL) / 1000;    // cm³ -> litres
      console.log(`feed ${String(perOrder).padStart(4)}/order: ${onCourse}/${looked} surveyed points have water within ${NEAR} m; mean ${(litres / Math.max(1, looked)).toFixed(0)} L a window`);
    }
  }, 1800000);

  it('measures wet width against the surveyed width', () => {
    const m = (u: number) => u / UNITS_PER_METRE;
    for (const perOrder of [1.6, 8, 40]) {
      let ratios: number[] = [];
      let n = 0;
      for (let r = 0; r < hydro.rivers.length; r += 97) {
        const river = hydro.rivers[r];
        if (river.count < 6) continue;
        const p = river.first + Math.floor(river.count / 2);
        const surveyed = hydro.width[p];
        if (surveyed <= 0) continue;
        const { wet } = wetWidthAt(p, river.order, perOrder, 1200);
        ratios.push(wet / surveyed);
        n++;
        if (n >= 10) break;
      }
      ratios.sort((a, b) => a - b);
      const med = ratios[Math.floor(ratios.length / 2)];
      const dry = ratios.filter((x) => x === 0).length;
      console.log(`feed ${String(perOrder).padStart(4)}/order: wet/surveyed median ${(100 * med).toFixed(0)}%  (${dry}/${ratios.length} bone dry)`);
    }
    // and the surveyed sizes themselves, for scale
    let w: number[] = [];
    for (let i = 0; i < hydro.width.length; i += 13) if (hydro.width[i] > 0) w.push(hydro.width[i]);
    w.sort((a, b) => a - b);
    console.log(`surveyed width: median ${m(w[Math.floor(w.length / 2)]).toFixed(1)} m, p95 ${m(w[Math.floor(w.length * 0.95)]).toFixed(1)} m, max ${m(w[w.length - 1]).toFixed(1)} m`);
  }, 1800000);
});
