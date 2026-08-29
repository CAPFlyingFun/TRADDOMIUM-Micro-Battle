/**
 * THE WATER LEAVES HER; IT DOES NOT DROP HER.
 *
 * The inland hydrology is LIVE, and that is the point of it — rain
 * fills the courses and the slopes shed afterwards. What it must not
 * do is take the queen's float state with it while there is still
 * water standing over her.
 *
 * This drives the REAL solver, fed exactly as `IslandWater.update`
 * feeds it, and walks the depth it produces under a queen through
 * `wadeAt` frame by frame — because the bug was not in either piece
 * alone. The solver is right and the wade rule was right; the exit
 * threshold sat where a draining pool crosses it in under a second.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadIsland } from './support/island';
import { terrainHeight } from '../src/world/heightfield';
import { WaterSim } from '../src/world/waterSim';
import { isWatercourse } from '../src/world/islandChannels';
import { useWaterQuery } from '../src/world/waterQuery';
import { DRAUGHT, FLOAT_EXIT, FOOTING, wadeAt } from '../src/ant/wading';
import type { Hydro } from '../src/world/hydro';

/** IslandWater's own numbers — a window this test is a slice of. */
const CELL = 100, N = 128, BASEFLOW = 2, SOAK = 0.3, DT = 0.02;
const STORM_PER_MM = 0.075;
/** What the exit used to be: a fraction of FOOTING, 3.4 mm. */
const OLD_EXIT = FOOTING * 0.85;

let hydro: Hydro;
beforeAll(() => { hydro = loadIsland(); });

/** The depth history of a few just-afloat cells as a shower ends. */
function shower(): { wet: number; series: number[] }[] {
  const river = hydro.rivers.find((r) => r.order >= 5 && r.count > 20)!;
  const p = river.first + Math.floor(river.count / 2);
  const span = N * CELL;
  const ox = hydro.x[p] - span / 2, oz = hydro.z[p] - span / 2;
  const sim = new WaterSim({ n: N, cell: CELL, dt: DT, soak: SOAK });
  sim.fillBed((ix, iy) => terrainHeight(ox + ix * CELL, oz + iy * CELL));
  const course = new Uint8Array(N * N);
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      course[iy * N + ix] = isWatercourse(ox + ix * CELL, oz + iy * CELL) ? 1 : 0;
    }
  }
  const sorted = Float32Array.from(sim.bed).sort();
  const mark = sorted[Math.floor(sorted.length * 0.35)];
  const catchment = Uint8Array.from(sim.bed, (b) => (b > 0 && b >= mark ? 1 : 0));
  const feed = (mmHr: number) => {
    const storm = STORM_PER_MM * mmHr;
    for (let i = 0; i < sim.depth.length; i++) {
      if (course[i] && sim.bed[i] > 0) sim.depth[i] += BASEFLOW * DT;
      if (storm > 0 && catchment[i]) sim.depth[i] += storm * DT;
    }
    sim.step(true);
  };
  for (let s = 0; s < 120 / DT; s++) feed(12);          // two minutes of rain
  const watch: number[] = [];
  for (let i = 0; i < sim.depth.length && watch.length < 6; i += 977) {
    if (sim.depth[i] >= FOOTING && sim.depth[i] < FOOTING * 6) watch.push(i);
  }
  const out = watch.map((i) => ({ wet: sim.depth[i], series: [] as number[] }));
  for (let s = 0; s < 60 / DT; s++) {                    // and a minute of drain
    feed(0);
    watch.forEach((i, k) => out[k].series.push(sim.depth[i]));
  }
  return out;
}

/** Walk a depth history under a floating queen. */
function ride(series: number[], exit: number) {
  let afloat = true;
  for (let f = 0; f < series.length; f++) {
    useWaterQuery(() => ({ depth: series[f], flowX: 0, flowZ: 0 }));
    const w = wadeAt(0, 0, 0, afloat);
    // The exit under test, applied the way wadeAt applies its own.
    afloat = series[f] >= (afloat ? exit : FOOTING);
    if (!afloat) return { at: f * DT, depth: series[f], above: w.above };
  }
  useWaterQuery(null);
  return null;
}

describe('a draining pool sets her down rather than dropping her', () => {
  let runs: { wet: number; series: number[] }[];
  beforeAll(() => { runs = shower(); }, 900000);

  it('used to come aground with millimetres still over her', () => {
    // THE REGRESSION, MEASURED. Soak sheds 0.3 units a second, so a
    // pool nothing is feeding loses three millimetres a second — and
    // the old exit sat 3.4 mm up. Every cell she could have been
    // floating on crossed it within a second of the rain stopping,
    // while the water over her was still deeper than her whole
    // draught. "Floats correctly, then a few seconds later she is
    // under it again."
    let dropped = 0;
    for (const run of runs) {
      const end = ride(run.series, OLD_EXIT);
      if (!end) continue;
      dropped++;
      expect(end.at).toBeLessThan(2);
      expect(end.depth).toBeGreaterThan(DRAUGHT * 2);
    }
    expect(dropped).toBeGreaterThan(3);
  }, 900000);

  it('now rides it down to the bed instead', () => {
    for (const run of runs) {
      const end = ride(run.series, FLOAT_EXIT);
      // Either she is still afloat a minute later — because there IS
      // still water — or she came aground with the film gone and no
      // height left to lose.
      if (end === null) {
        expect(run.series[run.series.length - 1]).toBeGreaterThanOrEqual(FLOAT_EXIT);
      } else {
        expect(end.depth).toBeLessThan(DRAUGHT);
        expect(end.above).toBeLessThan(0.02);
      }
    }
  }, 900000);

  it('and is not left floating over dry ground', () => {
    // The other failure this could have been. A pool that empties must
    // put her down; deep hysteresis is not a licence to hover.
    const emptied = runs.filter((r) => r.series[r.series.length - 1] <= 0);
    expect(emptied.length).toBeGreaterThan(0);
    for (const run of emptied) {
      const end = ride(run.series, FLOAT_EXIT);
      expect(end).not.toBeNull();
      expect(end!.at).toBeLessThan(60);
    }
  }, 900000);
});
