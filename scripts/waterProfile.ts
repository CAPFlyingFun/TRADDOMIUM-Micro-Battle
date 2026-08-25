/** Where a water rebuild spends its time. npx vite-node scripts/waterProfile.ts */
import { readFileSync } from 'node:fs';
import { decodeGrid } from '../src/world/kauai';
import { setRelief, setSmoothing, useGrid, baseLand } from '../src/world/heightfield';
import { decodeFlow, useFlow, halfAt } from '../src/world/flow';
import { buildReach } from '../src/world/FlowWater';
import { DEFAULTS } from '../src/ui/settings';
const g = readFileSync('public/kauai-1025.bin');
useGrid(decodeGrid(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength)));
setSmoothing(DEFAULTS.terrainSmoothing); setRelief(1);
const f = readFileSync('public/kauai-flow.bin');
const flow = decodeFlow(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength));
useFlow(flow);
const REACH = 200_000, wx = -1.2e6, wz = 1.1e6;
const want = flow.reaches.filter(({ first, count }) => {
  for (let i = 0; i < count; i += 4) {
    const p = first + i;
    if (Math.abs(flow.x[p] - wx) < REACH && Math.abs(flow.z[p] - wz) < REACH) return true;
  }
  return false;
});
let verts = 0;
for (const { first, count } of want) {
  const geo = buildReach(flow, first, count, 0, 0);
  if (geo) { verts += geo.getAttribute('position').count; geo.dispose(); }
}
// Whole rebuild.
let t = performance.now();
for (const { first, count } of want) buildReach(flow, first, count, 0, 0)?.dispose();
const whole = performance.now() - t;
// The terrain sample alone, at the same count.
t = performance.now();
// Summed so nothing is optimised away as dead.
let sink = 0;
for (const { first, count } of want) {
  for (let i = 0; i < count; i++) {
    const p = first + i;
    for (let k = 0; k < 9 * 4; k++) sink += baseLand(flow.x[p] + k, flow.z[p]);
  }
}
const ground = performance.now() - t;
// halfAt alone, twice per vertex the way the loop asks it.
t = performance.now();
for (const { first, count } of want) {
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 9 * 4; k++) sink += halfAt(flow, first + i, k < 18 ? -1 : 1);
  }
}
const half = performance.now() - t;
console.log(`vertices        ${verts.toLocaleString()}`);
console.log(`whole rebuild   ${whole.toFixed(0)} ms`);
console.log(`  baseLand      ${ground.toFixed(0)} ms  (${(100 * ground / whole).toFixed(0)}%)`);
console.log(`  halfAt        ${half.toFixed(0)} ms  (${(100 * half / whole).toFixed(0)}%)`);
console.log(`  everything else ${(whole - ground - half).toFixed(0)} ms`);
console.log(`\n(checksum ${sink.toFixed(0)} — the samples are summed so they are not dead code)`);
