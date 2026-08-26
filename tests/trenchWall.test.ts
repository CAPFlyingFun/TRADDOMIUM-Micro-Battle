/**
 * THE TRENCH MAY NOT END IN A WALL.
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
 * The cause was two numbers that used to be one. `trenchCut` shapes the
 * bed out to `cutHalf(width)`, a shoulder half again as wide as the
 * channel. The collision index, since the widths were measured per
 * side, claims only as far as the water actually reaches on THIS side
 * here — and on a stream pinned against a valley wall that is 1064
 * units where the shoulder is 2861. Between those two radii the carve
 * was still cutting at full depth, and then `flowAt` returned null and
 * the next sample got no cut at all. The profile never came down; it
 * was guillotined.
 *
 * So the claim rides on `FlowSpot` now and bounds the cut, and this is
 * the measurement that says it still does. It walks the surface the
 * near cells are actually built from — `terrainHeight` on each cell's
 * own lattice — around stations spread the length of the bake, and asks
 * what the CARVE did to the step between neighbours. The uncut ground's
 * own slope is subtracted: a Napali cliff is not a fin, and a test that
 * could not tell them apart would fail on the island rather than on the
 * bug.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  baseLand, CELL_VERTS, COARSE_VERTS, setRelief, setSmoothing, terrainHeight, useGrid,
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
 * How much the carve changed the step between each pair of neighbouring
 * lattice vertices, over cells sitting on stations across the island.
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
          const a = terrainHeight(ax, zz), b = terrainHeight(bx, zz);
          if (a <= 0 || b <= 0) continue;   // sea
          out.push(Math.abs((a - b) - (baseLand(ax, zz) - baseLand(bx, zz))));
        }
      }
    }
  }
  return out;
}

describe('the bank the trench leaves behind', () => {
  it('never falls off a cliff between two vertices of the near mesh', () => {
    // The lattice the streamed cells are cut on, 8 units apart. A step
    // this small cannot hold a real landform: 40 cm in 8 cm is a 79
    // degree wall, and the island under it is interpolated from samples
    // 54.7 m apart and then smoothed.
    const cuts = cutSteps(CELL_VERTS);
    expect(cuts.length).toBeGreaterThan(400_000);
    const over = (t: number) => cuts.filter((v) => v > t).length / cuts.length;
    // Measured on the shipped bake: 0.024% of pairs over 40 cm with the
    // cut running past the claim, 0.001% with it clamped. Set at 0.01%,
    // which is an order of magnitude either side of both.
    expect(over(40)).toBeLessThan(0.0001);
    expect(over(20)).toBeLessThan(0.001);
  });

  it('and not on the coarse lattice either, where the fins showed worst', () => {
    // 32 units between vertices, so the same guillotine has four times
    // the ground to hide in and showed up four times as often: 0.118%
    // over 40 cm before the clamp, 0.002% after.
    const cuts = cutSteps(COARSE_VERTS);
    expect(cuts.length).toBeGreaterThan(20_000);
    expect(cuts.filter((v) => v > 40).length / cuts.length).toBeLessThan(0.0002);
  });

  it('brings the profile to nothing at the claim, not at the shoulder', () => {
    // The mechanism, stated directly, so a future reader does not have
    // to infer it from a percentage. A stream whose measured claim is
    // narrower than its own shoulder must reach zero cut at the claim —
    // that is the point flowAt stops answering, and the last cut before
    // it is the height of the cliff.
    const level = 1000, land = 1000, width = 60;   // 4.8 m drawn channel
    const shoulder = cutHalf(width);
    const claim = shoulder / 3;
    expect(claim).toBeLessThan(shoulder);
    // Just inside the claim: still a hair of cut, and only a hair.
    const last = trenchCut(land, level, claim - 0.5, width, claim);
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThan(1);
    // Outside it: nothing. The pair is the whole invariant — the cut
    // arrives at zero where the water does.
    expect(trenchCut(land, level, claim, width, claim)).toBe(0);
    // Without the claim the same offset is still being cut hard, which
    // is the cliff this test exists to keep out of the ground.
    expect(trenchCut(land, level, claim - 0.5, width)).toBeGreaterThan(50);
  });

  it('still cuts the full trench where the claim is the wider of the two', () => {
    // The clamp may only ever narrow the cut. A claim reaching past the
    // shoulder — the common case on open valley floor — must leave the
    // trench exactly as it was, or this fix has quietly filled in every
    // stream on the island.
    const level = 1000, land = 1000, width = 60;
    for (const off of [0, 50, 120, 240]) {
      expect(trenchCut(land, level, off, width, 10_000))
        .toBeCloseTo(trenchCut(land, level, off, width), 9);
    }
  });
});
