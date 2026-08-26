/** What the pond sheet costs to build, at its busiest. */
import { readFileSync } from 'node:fs';
import { decodeGrid } from '../src/world/kauai';
import { setRelief, setSmoothing, useGrid } from '../src/world/heightfield';
import { decodeFlow, pondSheet, useFlow } from '../src/world/flow';
import { buildPonds, REACH } from '../src/world/FlowWater';
import { DEFAULTS } from '../src/ui/settings';
const g = readFileSync('public/kauai-1025.bin');
useGrid(decodeGrid(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength)));
setSmoothing(DEFAULTS.terrainSmoothing); setRelief(1);
const f = readFileSync('public/kauai-flow.bin');
useFlow(decodeFlow(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength)));
const pond = pondSheet()!;
console.log(`sheet cells (listed + rim)  ${pond.x.length}`);
// The densest view: the cell-count winner over a coarse sweep.
let best = { wx: 0, wz: 0, n: 0 };
for (let i = 0; i < pond.x.length; i += 50) {
  let n = 0;
  for (let j = 0; j < pond.x.length; j++) {
    if (Math.abs(pond.x[j] - pond.x[i]) < REACH && Math.abs(pond.z[j] - pond.z[i]) < REACH) n++;
  }
  if (n > best.n) best = { wx: pond.x[i], wz: pond.z[i], n };
}
const cells: number[] = [];
for (let j = 0; j < pond.x.length; j++) {
  if (Math.abs(pond.x[j] - best.wx) < REACH && Math.abs(pond.z[j] - best.wz) < REACH) cells.push(j);
}
// As followPonds builds it: per 50,000-unit block.
const PBLOCK = 50_000;
const blocks = new Map<string, number[]>();
for (const i of cells) {
  const key = Math.floor(pond.x[i] / PBLOCK) + ':' + Math.floor(pond.z[i] / PBLOCK);
  const list = blocks.get(key);
  if (list) list.push(i); else blocks.set(key, [i]);
}
for (let pass = 0; pass < 3; pass++) {
  const t0 = performance.now();
  let verts = 0, worst = 0;
  for (const [key, list] of blocks) {
    const [bx, bz] = key.split(':').map(Number);
    const b0 = performance.now();
    const geo = buildPonds(pond, list, (bx + 0.5) * PBLOCK, (bz + 0.5) * PBLOCK);
    const bms = performance.now() - b0;
    if (bms > worst) worst = bms;
    verts += geo.getAttribute('position').count;
    geo.dispose();
  }
  const ms = performance.now() - t0;
  if (pass === 2) {
    console.log(`densest view  ${cells.length} cells in ${blocks.size} blocks, ${verts.toLocaleString()} vertices`);
    console.log(`whole view    ${ms.toFixed(0)} ms here, ~${(ms * 6).toFixed(0)} ms on a phone (paid once, at load)`);
    console.log(`worst block   ${worst.toFixed(1)} ms here, ~${(worst * 6).toFixed(0)} ms on a phone (a crossing builds a strip of these)`);
  }
}
