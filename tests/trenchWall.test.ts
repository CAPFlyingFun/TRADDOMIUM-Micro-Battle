/**
 * THE ISLAND HAS ONE SURFACE, AND IT DOES NOT FALL OFF ANY CLIFFS.
 *
 * Joshua, on the pond shore: "can you fix the jagged edges?" Three
 * things were blamed before the right one. The drawn water's hard alpha
 * cut was real and fixed. The 2.5 m cardboard skirt on every streamed
 * cell edge was real and fixed. Neither was what he was looking at.
 *
 * What he was looking at was the GROUND. Turning the water off left the
 * teeth exactly where they were, and walking the near mesh's own
 * lattice found neighbouring vertices eight units apart differing by
 * 74 cm — a three-quarter-metre cliff inside eight centimetres of
 * island, repeated down the bank as a row of fins.
 *
 * The cause was that the bed was GATED. `terrainHeight` carved through
 * `flowAt`, which stops answering at the collision index's measured
 * claim, while `trenchCut` shaped its profile out to the channel's own
 * shoulder — 1064 units against 2861 on a stream pinned to a valley
 * wall. Between those two radii the carve was still at full depth, and
 * then the next sample got nothing back at all.
 *
 * Clamping the shoulder to the claim fixed the symptom and left the
 * disease: a carve driven by anything that can REFUSE has an edge to
 * fall off. So the channel moved into `baseLand`, cut from `channelAt`,
 * which asks a purely geometric question and never refuses. The
 * profile now reaches zero, with zero slope, on its own terms.
 *
 * These hold that: the structural property directly, and its
 * consequence on the lattice the game is actually drawn on.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  bareLand, baseLand, CELL_VERTS, COARSE_VERTS, setRelief, setSmoothing, useGrid,
} from '../src/world/heightfield';
import { decodeGrid } from '../src/world/kauai';
import { decodeFlow, useFlow, type Flow } from '../src/world/flow';
import { CHUNK_SPAN } from '../src/world/coords';
import { cutHalf, trenchCut } from '../src/world/carve';
import { DEFAULTS } from '../src/ui/settings';

const GRID = fileURLToPath(new URL('../public/kauai-1025.bin', import.meta.url));
const FLOW = fileURLToPath(new URL('../public/kauai-flow.bin', import.meta.url));
let flow: Flow;

beforeAll(() => {
  const g = readFileSync(GRID);
  useGrid(decodeGrid(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength) as ArrayBuffer));
  // The dials the game ships at, for the same reason waterDepth uses
  // them: a wall measured on an island nobody plays is not a wall.
  setSmoothing(DEFAULTS.terrainSmoothing);
  setRelief(1);
  const f = readFileSync(FLOW);
  flow = decodeFlow(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer);
  useFlow(flow);
});

/**
 * How much the CARVE changed the step between each pair of neighbouring
 * lattice vertices, over cells sitting on stations across the island.
 *
 * Against `bareLand`, so the uncut island's own slope is subtracted: a
 * Napali cliff is not a fin, and a test that could not tell them apart
 * would fail on the island rather than on the bug.
 */
function cutSteps(verts: number): number[] {
  const step = CHUNK_SPAN / (verts - 1);
  const out: number[] = [];
  for (let r = 0; r < flow.reaches.length; r += 89) {
    const { first, count } = flow.reaches[r];
    const p = first + (count >> 1);
    const cx = Math.floor(flow.x[p] / CHUNK_SPAN), cz = Math.floor(flow.z[p] / CHUNK_SPAN);
    for (const [i, j] of [[0, 0], [1, 0], [0, 1]] as const) {
      const ox = (cx + i) * CHUNK_SPAN, oz = (cz + j) * CHUNK_SPAN;
      for (let row = 0; row < verts; row++) {
        for (let c = 0; c < verts - 1; c++) {
          const ax = ox + c * step, bx = ax + step, zz = oz + row * step;
          const a = baseLand(ax, zz), b = baseLand(bx, zz);
          if (a <= 0 || b <= 0) continue;   // sea
          out.push(Math.abs((a - b) - (bareLand(ax, zz) - bareLand(bx, zz))));
        }
      }
    }
  }
  return out;
}

describe('the bed the island cuts for its own water', () => {
  it('comes to nothing, and to nothing smoothly, at its own edge', () => {
    // THE STRUCTURAL PROPERTY, stated directly. Everything below is a
    // consequence of this holding; if this breaks, no threshold on a
    // lattice will save the banks.
    const level = 1000, land = 1000, width = 60;   // 4.8 m drawn channel
    const reach = cutHalf(width);
    // Zero AT the edge, and zero everywhere past it.
    expect(trenchCut(land, level, reach, width)).toBe(0);
    expect(trenchCut(land, level, reach * 1.5, width)).toBe(0);
    // And arriving there smoothly rather than falling off: the last
    // centimetre of cut before the edge is a rounding error, not a
    // cliff. Smootherstep has zero first AND second derivative here.
    const last = trenchCut(land, level, reach - 1, width);
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThan(0.01);
  });

  it('is a continuous function of position, with nothing able to gate it', () => {
    // The fins came from a carve that could be REFUSED — past the
    // collision claim, flowAt returned null and the cut went from full
    // depth to nothing between one sample and the next.
    //
    // So walk straight across real channels at a hair's spacing and
    // watch the cut itself. ACROSS MANY REACHES, not one: the first
    // version of this walked a single station whose claim happened to
    // be wider than its own shoulder, so it had no gate to find and
    // passed just as happily with one reinstated.
    let worst = 0, where = '';
    for (let r = 0; r < flow.reaches.length; r += 29) {
      const { first, count } = flow.reaches[r];
      const p = first + (count >> 1);
      const x = flow.x[p], z = flow.z[p];
      if (bareLand(x, z) <= 0) continue;
      let prev = baseLand(x - 6000, z) - bareLand(x - 6000, z);
      for (let d = -6000 + 2; d <= 6000; d += 2) {
        const cut = baseLand(x + d, z) - bareLand(x + d, z);
        const jump = Math.abs(cut - prev);
        if (jump > worst) { worst = jump; where = `${x + d},${z}`; }
        prev = cut;
      }
    }
    // Two units of travel across a metre-deep trench. What is left is
    // the ground's own gradient, not a seam: where the depth bound
    // binds, the cut tracks `land`, and steep ground moves a couple of
    // centimetres in two units. Measured at 2.6 cm.
    //
    // The faults this refuses are an order of magnitude past that: a
    // reinstated claim gate scores 96, and hard-selecting the nearest
    // segment instead of taking the deepest scores 48.
    expect(worst).toBeLessThan(10);
    expect(where).toBeTruthy();
  });

  it('never falls off a cliff between two vertices of the near mesh', () => {
    // The lattice the streamed cells are cut on, 8 units apart. A step
    // this small cannot hold a real landform: 40 cm in 8 cm is a 79
    // degree wall, and the island under it is interpolated from samples
    // 54.7 m apart and then smoothed.
    const cuts = cutSteps(CELL_VERTS);
    expect(cuts.length).toBeGreaterThan(400_000);
    const over = (t: number) => cuts.filter((v) => v > t).length / cuts.length;
    // Measured on the shipped bake: 0.024% of pairs over 40 cm when the
    // carve ran past the claim, 0.001% with the shoulder clamped to it,
    // and NONE AT ALL now the cut is ungated and continuous.
    expect(over(40)).toBe(0);
    expect(over(20)).toBeLessThan(0.0001);
  });

  it('and not on the coarse lattice either, where the fins showed worst', () => {
    // 32 units between vertices, so the same fault had four times the
    // ground to hide in and showed up four times as often: 0.118% over
    // 40 cm before, 0.0014% now — and what is left is not a gate but
    // the nearest-centreline handoff where two channels meet.
    const cuts = cutSteps(COARSE_VERTS);
    expect(cuts.length).toBeGreaterThan(20_000);
    expect(cuts.filter((v) => v > 40).length / cuts.length).toBeLessThan(0.005);
  });
});
