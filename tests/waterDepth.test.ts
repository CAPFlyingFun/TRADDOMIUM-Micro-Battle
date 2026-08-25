/**
 * THE WATER MUST BE AS DEEP AS THE GROUND UNDER IT IS LOW.
 *
 * This is the invariant that has broken four separate times, and every
 * break shipped, and every one of them reached Joshua as some version
 * of the same sentence: the water is there and you cannot see it.
 *
 *   1. Depth rode the geometry — one baked level-minus-bed per slab.
 *      Flat tones, a straight polygon edge at every ownership
 *      boundary, the island wearing shards instead of water.
 *   2. Depth came from a texture of the RAW height grid, where the
 *      terrain is the BLURRED one: 8.07 m out on average, wet-or-dry
 *      disagreeing on 28.7% of the water.
 *   3. Blended as baseLand blends it — and still a texture, so still
 *      no trench, because the trench is cut at RUNTIME. Mean depth
 *      -0.11 m where the game had 0.90 m; 66.6% of the island's water
 *      drawn at zero alpha. No texture could have saved it either:
 *      1025 samples over 56 km is one texel every 54.7 m, and a
 *      twelve-metre channel is a quarter of a texel.
 *   4. The trench profile alone, which knows the channel but not the
 *      ground either side of it: depth overstated by 54% and 74.6% of
 *      the DRY ground under a slab painted blue.
 *
 * What they have in common is that the water was shaded from a SECOND
 * description of the island, and any second description drifts. The
 * fragment shader now evaluates the depth terrainHeight itself arrives
 * at — see FlowWater's build() for the derivation — from four numbers
 * the slab carries. These tests hold that expression to the ground it
 * claims to be describing, on the shipped island rather than on a
 * fixture, because every one of the four failures above was invisible
 * to a fixture and obvious on Kauaʻi.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  setRelief, setSmoothing, terrainHeight, useGrid,
} from '../src/world/heightfield';
import { decodeGrid } from '../src/world/kauai';
import { decodeFlow, useFlow, waterLevelAt, type Flow } from '../src/world/flow';
import { buildReach } from '../src/world/FlowWater';
import { MAX_DEPTH, waterDepth as shaded } from '../src/world/carve';
import { DEFAULTS } from '../src/ui/settings';

const GRID = fileURLToPath(new URL('../public/kauai-1025.bin', import.meta.url));
const FLOW = fileURLToPath(new URL('../public/kauai-flow.bin', import.meta.url));
let flow: Flow;

beforeAll(() => {
  const g = readFileSync(GRID);
  useGrid(decodeGrid(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength) as ArrayBuffer));
  // The dials the game ships at. Depth is measured against the ground
  // she WALKS on, so a test at some other smoothing is testing an
  // island nobody plays.
  setSmoothing(DEFAULTS.terrainSmoothing);
  setRelief(1);
  const f = readFileSync(FLOW);
  flow = decodeFlow(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer);
  useFlow(flow);
});

interface Slab {
  pos: Float32Array; deep: Float32Array; across: Float32Array;
  span: Float32Array; rise: Float32Array;
}

/** Every fourteenth reach of the shipped bake, as read-back attributes. */
function slabs(): Slab[] {
  const out: Slab[] = [];
  for (let r = 0; r < flow.reaches.length; r += 14) {
    const { first, count } = flow.reaches[r];
    const g = buildReach(flow, first, count, 0, 0);
    if (!g) continue;
    out.push({
      pos: g.getAttribute('position').array as Float32Array,
      deep: g.getAttribute('deep').array as Float32Array,
      across: g.getAttribute('across').array as Float32Array,
      span: g.getAttribute('span').array as Float32Array,
      rise: g.getAttribute('rise').array as Float32Array,
    });
    g.dispose();
  }
  return out;
}

describe('the depth the water is shaded with', () => {
  it('is the depth the ground actually gives it', () => {
    // The whole point, stated as one number. At a vertex the shader's
    // expression and terrainHeight are the same algebra rearranged, so
    // this is not "close enough" — it is exact, and the tolerance is
    // here for float32 attributes and nothing else.
    //
    // The exceptions are real and bounded, and they are all the same
    // exception: flowAt carves toward the NEAREST station and segment,
    // and a vertex reaching a couple of hundred metres off a bend can
    // be nearest to neither of the two this row was built from. Where
    // that happens the cut it got is another station's, and no
    // expression built from this one's numbers can name it. Measured
    // at 5.3% of the vertices we own, none of them worse than the
    // metre a trench is deep — so the assertions are set at the
    // measurement plus headroom, not at zero.
    let n = 0, off = 0;
    let worst = 0;
    for (const s of slabs()) {
      for (let v = 0; v < s.deep.length; v++) {
        const wx = s.pos[v * 3], wz = s.pos[v * 3 + 2], level = s.pos[v * 3 + 1];
        if (wx === 0 && wz === 0) continue;                // collapsed
        const own = waterLevelAt(wx, wz);
        if (own === null || Math.abs(own - level) > 1) continue;  // not ours
        n++;
        const err = Math.abs(
          shaded(s.deep[v], s.across[v], s.span[v], s.rise[v])
          - (level - terrainHeight(wx, wz)),
        );
        if (err > 1) { off++; worst = Math.max(worst, err); }
      }
    }
    expect(n).toBeGreaterThan(10_000);
    // Version 3 of this shader would have scored about 100% here.
    expect(off / n).toBeLessThan(0.08);
    // And the worst case is bounded by the thing it is a disagreement
    // ABOUT: two stations can differ over whether a point sits in a
    // trench, and a trench is one metre deep. It comes back at exactly
    // that, plus float32 dust — which is the shape of the error
    // confirming what it is. Anything past it is a different bug.
    expect(worst).toBeLessThanOrEqual(MAX_DEPTH + 1);
  });

  it('does not leave the island invisibly wet', () => {
    // The bug in Joshua's words, as a threshold. A vertex standing in
    // real water must come out with real depth: alpha ramps in over the
    // first 45 units, so a zero here is water that is drawn and cannot
    // be seen.
    let wet = 0, unseen = 0;
    for (const s of slabs()) {
      for (let v = 0; v < s.deep.length; v++) {
        const wx = s.pos[v * 3], wz = s.pos[v * 3 + 2], level = s.pos[v * 3 + 1];
        if (wx === 0 && wz === 0) continue;
        if (level - terrainHeight(wx, wz) <= 0) continue;   // dry here
        wet++;
        if (shaded(s.deep[v], s.across[v], s.span[v], s.rise[v]) <= 0) unseen++;
      }
    }
    expect(wet).toBeGreaterThan(10_000);
    expect(unseen / wet).toBeLessThan(0.05);
  });

  it('does not paint blue over ground that stands above it', () => {
    // The other half of the same complaint — water "floating like
    // highways". The depth test hides it, but only from a camera that
    // has the geometry to hide it with, and the water carries a
    // polygon offset toward the eye. Alpha reaching zero on its own is
    // what makes that not matter.
    let dry = 0, painted = 0;
    for (const s of slabs()) {
      for (let v = 0; v < s.deep.length; v++) {
        const wx = s.pos[v * 3], wz = s.pos[v * 3 + 2], level = s.pos[v * 3 + 1];
        if (wx === 0 && wz === 0) continue;
        if (level - terrainHeight(wx, wz) > 0) continue;    // wet here
        dry++;
        // Below a few centimetres the fragment is clear anyway.
        if (shaded(s.deep[v], s.across[v], s.span[v], s.rise[v]) > 5) painted++;
      }
    }
    expect(dry).toBeGreaterThan(1_000);
    expect(painted / dry).toBeLessThan(0.10);
  });

  it('gives a slab enough vertices to carry the ground it crosses', () => {
    // The density is not taste. Five rows per station scored 10.1% of
    // the water at zero alpha where four rows scores 5.4%, and the
    // tests above pass or fail on it — so if someone thins the mesh to
    // buy back a millisecond, this says what it costs.
    const { first, count } = flow.reaches[0];
    const g = buildReach(flow, first, count, 0, 0)!;
    const rows = g.getAttribute('position').count / 9;
    expect(rows).toBe((count - 1) * 4 + 1);
    g.dispose();
  });
});
