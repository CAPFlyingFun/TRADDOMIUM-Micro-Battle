/**
 * WHAT A WATER REBUILD COSTS, at the density the shader needs.
 *
 * The slab carries a ground sample per vertex now, and the rebuild
 * happens on a background thread nobody has — it is a straight stall in
 * the frame that crosses a 50,000-unit decision cell, which is every
 * five hundred metres of travel. Joshua plays this on a phone, so the
 * density argument is settled here and not by how the numbers look.
 *
 *   npx vite-node scripts/waterCost.ts
 */
import { readFileSync } from 'node:fs';
import { decodeGrid } from '../src/world/kauai';
import { setRelief, setSmoothing, useGrid } from '../src/world/heightfield';
import { decodeFlow, useFlow } from '../src/world/flow';
import { buildReach } from '../src/world/FlowWater';
import { DEFAULTS } from '../src/ui/settings';
const grid = readFileSync('public/kauai-1025.bin');
useGrid(decodeGrid(grid.buffer.slice(grid.byteOffset, grid.byteOffset + grid.byteLength)));
setSmoothing(DEFAULTS.terrainSmoothing); setRelief(1);
const bin = readFileSync('public/kauai-flow.bin');
const flow = decodeFlow(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
useFlow(flow);
const REACH = 200_000;
// The Wailua mouth: the busiest water on the island, which is the
// number that matters rather than an average one.
let best = { wx: 0, wz: 0, n: 0 };
for (const [wx, wz] of [[-1.2e6, 1.1e6], [0, 0], [8e5, -6e5], [-2e6, -1e6], [1.5e6, 9e5]]) {
  let n = 0;
  for (const { first, count } of flow.reaches) {
    for (let i = 0; i < count; i += 4) {
      const p = first + i;
      if (Math.abs(flow.x[p] - wx) < REACH && Math.abs(flow.z[p] - wz) < REACH) { n += count; break; }
    }
  }
  if (n > best.n) best = { wx, wz, n };
}
const want = flow.reaches.filter(({ first, count }) => {
  for (let i = 0; i < count; i += 4) {
    const p = first + i;
    if (Math.abs(flow.x[p] - best.wx) < REACH && Math.abs(flow.z[p] - best.wz) < REACH) return true;
  }
  return false;
});
for (let pass = 0; pass < 3; pass++) {
  const t0 = performance.now();
  let verts = 0;
  for (const { first, count } of want) {
    const g = buildReach(flow, first, count, 0, 0);
    if (!g) continue;
    verts += g.getAttribute('position').count;
    g.dispose();
  }
  const ms = performance.now() - t0;
  if (pass === 2) {
    console.log(`busiest view: ${want.length} reaches, ${best.n} stations`);
    console.log(`vertices     ${verts.toLocaleString()}`);
    console.log(`rebuild      ${ms.toFixed(0)} ms on this desktop`);
    console.log(`             ~${(ms * 6).toFixed(0)} ms on a phone at 6x`);
    // THE ONE-OFF IS NOT THE HITCH. follow() diffs its wanted set, so
    // crossing a decision cell rebuilds only the reaches that just came
    // into the box — the whole-view figure above is paid once, while
    // the game is loading. This is the one that lands in a frame.
    const moved = flow.reaches.filter(({ first, count }) => {
      let now = false, then = false;
      for (let i = 0; i < count; i += 4) {
        const q = first + i;
        if (Math.abs(flow.z[q] - best.wz) >= REACH) continue;
        if (Math.abs(flow.x[q] - (best.wx + 50_000)) < REACH) now = true;
        if (Math.abs(flow.x[q] - best.wx) < REACH) then = true;
      }
      return now && !then;
    });
    const t1 = performance.now();
    for (const { first, count } of moved) buildReach(flow, first, count, 0, 0)?.dispose();
    const step = performance.now() - t1;
    console.log(`one cell of travel: ${moved.length} new reaches`);
    console.log(`             ${step.toFixed(1)} ms here, ~${(step * 6).toFixed(0)} ms on a phone`);
  }
}
