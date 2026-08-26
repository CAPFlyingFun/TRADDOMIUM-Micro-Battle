/**
 * THE BED THE SURVEYED RIVERS RUN IN.
 *
 * Drawn flat at the surveyed level with nothing cut, 70.3% of the
 * network is already below its ground — the valleys are real. The rest
 * is buried by a p90 of 1.24 m, which breaks a run into a chain of
 * pools: from the air the Hanalei traces its own valley perfectly and
 * does it as a dotted line.
 *
 * This is the third carve this project has had. The first pressed
 * ground toward a level with no bound and cut benches out of the Nāpali
 * walls. The second was GATED — it ran through an index that stops
 * answering at a claim radius, so the cut fell from full depth to
 * nothing between one lattice vertex and the next and grew a row of
 * 73 cm fins down every bank. These tests are those two failures
 * written down.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  bank, channelHalf, DRAUGHT, forgetRiverBeds, indexRiverBeds, MAX_CUT,
  riverBedsReady, riverCut,
} from '../src/world/riverBed';
import { decodeHydro, forgetHydro, useHydro, type Hydro } from '../src/world/hydro';
import { decodeGrid } from '../src/world/kauai';
import { baseLand, setRelief, setSmoothing, useGrid } from '../src/world/heightfield';
import { decodeHdTile, hdTileName, useHdTile } from '../src/world/kauaiHd';

let hy: Hydro;

beforeAll(() => {
  const g = readFileSync(fileURLToPath(new URL('../public/kauai-1025.bin', import.meta.url)));
  useGrid(decodeGrid(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength) as ArrayBuffer));
  setRelief(1);
  setSmoothing(0);
  // THE HD TILES, or this measures the wrong island. The rivers were
  // surveyed on Kauaʻi and the 54.7 m grid is Kauaʻi with fifteen of
  // every sixteen samples missing: on it only 74% of river points sit
  // within 5 m of their terrain, against 88% on the fine grid, and the
  // burial the bed exists to close comes out quite different.
  for (let i = 0; i < 64; i++) {
    const t = readFileSync(fileURLToPath(new URL(`../public/kauai-hd/${hdTileName(i)}.bin`, import.meta.url)));
    useHdTile(i, decodeHdTile(t.buffer.slice(t.byteOffset, t.byteOffset + t.byteLength) as ArrayBuffer));
  }
  const h = readFileSync(fileURLToPath(new URL('../public/kauai-hydro.bin', import.meta.url)));
  hy = decodeHydro(h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength) as ArrayBuffer);
  useHydro(hy);
  indexRiverBeds();
});

describe('the profile', () => {
  it('is one on the centreline and nothing at the bank', () => {
    expect(bank(0)).toBe(1);
    expect(bank(1)).toBe(0);
    expect(bank(2)).toBe(0);
    expect(bank(-1)).toBe(1);
    // Zero slope AND zero curvature at both ends, which is what stops
    // the lip reading as an edge. The last hundredth before the bank is
    // a rounding error, not a step.
    expect(bank(0.99)).toBeLessThan(0.002);
    expect(1 - bank(0.01)).toBeLessThan(0.002);
  });

  it('shares one half-width with the surface that is drawn', () => {
    // The drawn ribbon and the cut bed are the two things that must
    // agree about where a river is, and the whole history of this file
    // is descriptions of one river drifting apart.
    expect(channelHalf(1000)).toBe(500);
    // Floored, so the narrowest run still reads as water.
    expect(channelHalf(10)).toBe(60);
  });
});

describe('the cut', () => {
  it('is bounded however high the ground stands', () => {
    // The first carve had no bound and benched the Nāpali walls. Ask
    // for a cut under a cliff a hundred metres above the water.
    const river = hy.rivers.find((r) => r.count > 4)!;
    const p = river.first + 2;
    const x = hy.x[p], z = hy.z[p];
    expect(riverCut(x, z, hy.level[p] + 10_000)).toBeLessThanOrEqual(MAX_CUT);
    expect(riverCut(x, z, hy.level[p] + 1_000_000)).toBeLessThanOrEqual(MAX_CUT);
  });

  it('never lifts the ground, only lowers it', () => {
    const river = hy.rivers.find((r) => r.count > 8)!;
    for (let i = 1; i < 8; i++) {
      const p = river.first + i;
      // Well below the water: nothing to take.
      expect(riverCut(hy.x[p], hy.z[p], hy.level[p] - 5_000)).toBe(0);
      expect(riverCut(hy.x[p], hy.z[p], hy.level[p] + 100)).toBeGreaterThanOrEqual(0);
    }
  });

  it('is zero everywhere off the island’s rivers', () => {
    // A point far from any surveyed run must be untouched, or the carve
    // is reaching somewhere it was never asked to.
    expect(riverCut(0, 0, 100_000)).toBe(0);
    expect(riverCut(2_700_000, 2_700_000, 100_000)).toBe(0);
  });

  it('leaves a draught of water over the bed it cuts', () => {
    // The point of the whole exercise: after the cut, the ground under
    // a river is BELOW the river.
    const river = hy.rivers.find((r) => r.order >= 3 && r.count > 10)!;
    let wet = 0, n = 0;
    for (let i = 1; i < river.count - 1; i++) {
      const p = river.first + i;
      const ground = baseLand(hy.x[p], hy.z[p]);
      if (ground <= 0) continue;
      n++;
      if (ground <= hy.level[p]) wet++;
    }
    expect(n).toBeGreaterThan(5);
    expect(wet / n).toBeGreaterThan(0.9);
  });
});

describe('the surface it leaves', () => {
  /**
   * Walk straight across a river at a hair's spacing and return the
   * worst thing the CARVE does to the step between two samples.
   *
   * Measured as roughness ADDED, which took two wrong metrics to get
   * right. The island's own slope is not a fin — a hillside steps 41 cm
   * in four units all by itself — so the raw step is no good. Nor is
   * the raw DIFFERENCE from the bare step: a bed levels the ground it
   * cuts, so where it works perfectly the finished surface is flat, the
   * bare one is not, and the difference is largest exactly where the
   * carve is doing its job best.
   *
   * What a fin actually is: a step the finished surface has that the
   * bare one did not. So it is |finished| MINUS |bare|, and only the
   * positive side of it counts.
   */
  function worstStepAcross(runs: readonly { first: number; count: number }[]): number {
    const walks: Array<{ x: number; z: number }[]> = [];
    for (const river of runs) {
      if (river.count < 3) continue;
      const p = river.first + (river.count >> 1);
      const line: { x: number; z: number }[] = [];
      for (let d = -4000; d <= 4000; d += 4) line.push({ x: hy.x[p] + d, z: hy.z[p] });
      walks.push(line);
    }
    forgetRiverBeds();
    const bare = walks.map((line) => line.map((q) => baseLand(q.x, q.z)));
    useHydro(hy);
    indexRiverBeds();
    let worst = 0;
    for (const [w, line] of walks.entries()) {
      const cut = line.map((q, i) => baseLand(q.x, q.z) - bare[w][i]);
      for (let i = 1; i < line.length; i++) {
        const bareStep = Math.abs(bare[w][i] - bare[w][i - 1]);
        const finished = Math.abs(
          (bare[w][i] + cut[i]) - (bare[w][i - 1] + cut[i - 1]));
        worst = Math.max(worst, finished - bareStep);
      }
    }
    return worst;
  }

  it('is continuous across a river, with nothing able to gate it', () => {
    // THE FIN TEST. The second carve went from full depth to nothing
    // where its index stopped answering — a 73 cm cliff inside 8 cm of
    // ground. The third did it again at every river MOUTH, where
    // `baseLand` returned early for anything at or below sea level and
    // took the carve out with it: 1.55 m of bed at one sample and none
    // two units later. Both were found here.
    //
    // A bank three metres deep over six of run adds at most four
    // centimetres to a four-unit step. Twelve is three times that; a
    // gate is measured in metres.
    const runs = hy.rivers.filter((_, i) => i % 29 === 0);
    expect(worstStepAcross(runs)).toBeLessThan(12);
  });

  it('takes the deepest channel where two meet, not the nearest', () => {
    // Selecting one segment makes the cut jump wherever the choice
    // flips, because neighbouring segments carry different levels and
    // widths. A maximum of continuous functions is continuous;
    // selection is not. Confluences and mouths are where it shows.
    const mouths = hy.rivers.filter((r) => r.toOcean && r.count > 4).slice(0, 60);
    expect(worstStepAcross(mouths)).toBeLessThan(12);
  });

  it('does the work — without it the rivers are broken', () => {
    // A test that passes with the carve gone is not testing the carve.
    const wetness = () => {
      let wet = 0, n = 0;
      for (let i = 0; i < hy.x.length; i += 23) {
        const ground = baseLand(hy.x[i], hy.z[i]);
        if (ground <= -10_000 || ground >= 200_000) continue;
        n++;
        if (ground <= hy.level[i]) wet++;
      }
      return wet / n;
    };
    const cut = wetness();
    forgetRiverBeds();
    expect(riverBedsReady()).toBe(false);
    const bare = wetness();
    useHydro(hy);
    indexRiverBeds();
    expect(riverBedsReady()).toBe(true);
    // 70.3% bare, 94.9% cut, measured over the whole network.
    expect(bare).toBeGreaterThan(0.6);
    expect(bare).toBeLessThan(0.8);
    expect(cut).toBeGreaterThan(0.9);
  });

  it('goes quiet when the hydrography does', () => {
    forgetRiverBeds();
    forgetHydro();
    expect(riverCut(hy.x[0], hy.z[0], 100_000)).toBe(0);
    indexRiverBeds();
    expect(riverBedsReady()).toBe(false);   // nothing to index
    useHydro(hy);
    indexRiverBeds();
  });
});

describe('the draught', () => {
  it('is a real stream depth, not a canyon', () => {
    expect(DRAUGHT / 100).toBeCloseTo(0.3, 6);
    // Three metres is the most any point may be lowered. The p90 gap is
    // 1.24 m, so this clears it with margin and still cannot bench a
    // ridge the way the first carve did.
    expect(MAX_CUT / 100).toBeCloseTo(3, 6);
  });
});
