/**
 * THE CARDBOARD CURTAIN, AND WHY IT TOOK A WATERLINE TO SEE IT.
 *
 * Every streamed terrain cell used to hang a 250-unit vertical skirt
 * off ALL FOUR of its edges, to plug the cracks where a fine cell meets
 * a coarse one. Equal-resolution neighbours share their edge exactly
 * and have no crack — so most of those skirts were 2.5 metres of wall
 * printed across continuous ground, invisible only because the ground
 * itself hid them. This file's own history called them "cardboard
 * curtains" in the commit that merged the dry tree, and moved on.
 *
 * Then flat water arrived at a level ABOVE the bottom of the skirt, and
 * every cell boundary crossing the waterline stood up out of the
 * surface as a row of dark teeth. Joshua, on the far shore of the Mana
 * pond: "I think I found the cardboard."
 *
 * A seam bridge is now emitted only where the resolution actually
 * changes, and it spans the measured disagreement rather than an
 * arbitrary wall. These tests hold both halves: no geometry below a
 * cell that needs no bridge, and a bounded bridge on one that does.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildCell, MAX_SEAM_DROP, MAX_TIER_DROP, type CellSeam,
} from '../src/world/TerrainStream';
import { setRelief, setSmoothing, useGrid } from '../src/world/heightfield';
import { decodeGrid } from '../src/world/kauai';
import { decodeFlow, useFlow } from '../src/world/flow';
import { geoToWorld } from '../src/world/geo';
import { world } from '../src/world/coords';
import { DEFAULTS } from '../src/ui/settings';

const SPAN_CELL = 512;
const VERTS = 65;

beforeAll(() => {
  const g = readFileSync(fileURLToPath(new URL('../public/kauai-1025.bin', import.meta.url)));
  useGrid(decodeGrid(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength) as ArrayBuffer));
  setSmoothing(DEFAULTS.terrainSmoothing);
  setRelief(1);
  // The trench is what the two surfaces disagree ABOUT — the cells cut
  // it and the tier behind them does not — so the tier seam below
  // measures nothing without the flow loaded.
  const f = readFileSync(fileURLToPath(new URL('../public/kauai-flow.bin', import.meta.url)));
  useFlow(decodeFlow(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer));
});

/** The lowest a cell's geometry reaches under its own surface. */
function overhang(geo: ReturnType<typeof buildCell>): number {
  const pos = geo.getAttribute('position').array as Float32Array;
  const n = geo.getAttribute('position').count;
  // The surface grid is the first VERTS*VERTS vertices; anything after
  // is bridge. Measure how far below the surface's own minimum the
  // bridge hangs.
  let floor = Infinity;
  for (let v = 0; v < VERTS * VERTS; v++) floor = Math.min(floor, pos[v * 3 + 1]);
  let lowest = floor;
  for (let v = VERTS * VERTS; v < n; v++) lowest = Math.min(lowest, pos[v * 3 + 1]);
  return floor - lowest;
}

describe('a cell whose neighbours match its resolution', () => {
  it('has no skirt geometry at all', () => {
    // Kauaʻi's interior, well inland, so the ground is real.
    const geo = buildCell(world(-600_000, 300_000), SPAN_CELL, VERTS);
    // The whole point: vertices are the surface and nothing else.
    expect(geo.getAttribute('position').count).toBe(VERTS * VERTS);
    // 250 units of drop is the wall this test exists to refuse.
    expect(overhang(geo)).toBe(0);
    geo.dispose();
  });

  it('draws only the surface triangles', () => {
    const geo = buildCell(world(-600_000, 300_000), SPAN_CELL, VERTS);
    const quads = VERTS - 1;
    expect(geo.getIndex()!.count).toBe(quads * quads * 6);
    geo.dispose();
  });
});

describe('a cell on a real resolution boundary', () => {
  // A fine cell whose east neighbour is coarse: 8-unit vertices meeting
  // 32-unit ones, which is the crack the bridge exists to close.
  const seams: CellSeam[] = [{ edge: 'east', neighbourStep: SPAN_CELL / 16 }];

  it('bridges that edge and only that edge', () => {
    const geo = buildCell(world(-600_000, 300_000), SPAN_CELL, VERTS, false, seams);
    expect(geo.getAttribute('position').count).toBe(VERTS * VERTS + VERTS);
    geo.dispose();
  });

  it('spans the disagreement, not a wall', () => {
    const geo = buildCell(world(-600_000, 300_000), SPAN_CELL, VERTS, false, seams);
    const pos = geo.getAttribute('position').array as Float32Array;
    // Every bridge vertex sits within the cap of the surface vertex it
    // was copied from — measured local disagreement, either direction.
    // The old skirt put every one of them 250 units below.
    const east = Array.from({ length: VERTS }, (_, i) => i * VERTS + (VERTS - 1));
    let worst = 0;
    for (let i = 0; i < VERTS; i++) {
      const from = pos[east[i] * 3 + 1];
      const to = pos[(VERTS * VERTS + i) * 3 + 1];
      worst = Math.max(worst, Math.abs(to - from));
    }
    expect(worst).toBeLessThanOrEqual(MAX_SEAM_DROP + 1e-6);
    // And it is 8 cm, not 2.5 m — the number that decides whether a
    // waterline can reveal it.
    expect(MAX_SEAM_DROP).toBeLessThan(20);
    geo.dispose();
  });

  it('reaches down to the tier behind the window, and only down', () => {
    // THE OTHER SEAM, and the one removing the cardboard revealed. The
    // streamed window stops at 20.48 m and the transition tier carries
    // on from there — cut from a different height function, because the
    // cells carve a real trench and the tier does not. Around Joshua's
    // own fix the two disagree by a full metre, so the cells' outer
    // edge stands that proud of the ground behind it.
    const at = geoToWorld({ lat: 22.04110839, lon: -159.37390526 });
    const rim: CellSeam[] = [{ edge: 'east', neighbourStep: SPAN_CELL / 16, tier: true }];
    const geo = buildCell(world(at.wx, at.wz), SPAN_CELL, VERTS, false, rim);
    const pos = geo.getAttribute('position').array as Float32Array;
    expect(geo.getAttribute('position').count).toBe(VERTS * VERTS + VERTS);
    let moved = 0, worst = 0;
    for (let i = 0; i < VERTS; i++) {
      const from = pos[(i * VERTS + (VERTS - 1)) * 3 + 1];
      const to = pos[(VERTS * VERTS + i) * 3 + 1];
      // NEVER UP. Lifting the rim would put cell geometry above the
      // tier and turn the wall to face the other way, which is the
      // same tooth seen from behind.
      expect(to).toBeLessThanOrEqual(from + 1e-6);
      worst = Math.max(worst, from - to);
      if (from - to > 0.01) moved++;
    }
    expect(worst).toBeLessThanOrEqual(MAX_TIER_DROP + 1e-6);
    // And it has to actually reach: a rim that never moves is not
    // bridging the surfaces, it is just more vertices.
    expect(moved).toBeGreaterThan(0);
    geo.dispose();
  });

  it('still closes the crack it exists for', () => {
    // The bridge has to actually MOVE where the two surfaces differ,
    // or it is a no-op that leaves the sliver of sky the skirt was
    // plugging. Somewhere along a 512-unit edge of real Kauaʻi, a
    // 32-unit straight line must miss the 8-unit ground.
    const geo = buildCell(world(-600_000, 300_000), SPAN_CELL, VERTS, false, seams);
    const pos = geo.getAttribute('position').array as Float32Array;
    const east = Array.from({ length: VERTS }, (_, i) => i * VERTS + (VERTS - 1));
    let moved = 0;
    for (let i = 0; i < VERTS; i++) {
      const from = pos[east[i] * 3 + 1];
      const to = pos[(VERTS * VERTS + i) * 3 + 1];
      if (Math.abs(to - from) > 0.01) moved++;
    }
    expect(moved).toBeGreaterThan(VERTS / 4);
    geo.dispose();
  });
});
