/**
 * WHAT EACH SETTING OF `SPREAD` COSTS, in water on the island.
 *
 * `bakeWidth.ts` marches outward until the GROUND stops the water, and
 * the ground has no channel cut for a trickle, so a five-litre-a-second
 * rill on a flat valley floor claims the whole floor. SPREAD bounds
 * that claim by the size of the stream itself.
 *
 * This is the tool that says what any given bound does to the island,
 * and it is the one that produced the table in bakeWidth.ts's comment
 * on SPREAD. When that dial is next argued about, re-run this rather
 * than trusting the table: the numbers move with the terrain, with the
 * smoothing, and with the discharge threshold, and a table in a comment
 * cannot know that any of those have changed.
 *
 * It works on the SHIPPED bake, clamping the stored half-widths in
 * memory rather than marching again, so a whole sweep is seconds where
 * a re-bake per setting would be half an hour.
 *
 *   npx vite-node scripts/measureSpread.ts
 */
import { readFileSync } from 'node:fs';
import { decodeGrid, SPAN } from '../src/world/kauai';
import { groundHeight, setRelief, setSmoothing, useGrid } from '../src/world/heightfield';
import { decodeFlow, useFlow, waterLevelAt, forgetFlow, slabHalf, UNMEASURED, type Flow } from '../src/world/flow';
import { DEFAULTS } from '../src/ui/settings';
const grid = readFileSync('public/kauai-1025.bin');
useGrid(decodeGrid(grid.buffer.slice(grid.byteOffset, grid.byteOffset + grid.byteLength)));
setSmoothing(DEFAULTS.terrainSmoothing); setRelief(1);
const bin = readFileSync('public/kauai-flow.bin');

function load(): Flow {
  return decodeFlow(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
}
const STEP = 4_000;                        // 40 m lattice
const n = Math.floor(SPAN / STEP);
function survey(): { land: number; wet: number } {
  let land = 0, wet = 0;
  for (let j = 0; j < n; j++) {
    const wz = j * STEP - SPAN / 2;
    for (let i = 0; i < n; i++) {
      const wx = i * STEP - SPAN / 2;
      const g = groundHeight(wx, wz);
      if (g <= 0) continue;
      land++;
      const w = waterLevelAt(wx, wz);
      if (w !== null && w > g) wet++;
    }
  }
  return { land, wet };
}
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
console.log('k = how many TRUE channel widths the water may spread across\n');
console.log('k        wet % of land     km2     median width   p95 width');
for (const k of [0, 4, 8, 16, 32, 64, Infinity]) {
  const flow = load();
  const widths: number[] = [];
  for (let p = 0; p < flow.left.length; p++) {
    const floor = slabHalf(flow.width[p]);
    const bound = k === Infinity ? Infinity : Math.max(floor, k * flow.width[p] / 2);
    for (const arr of [flow.left, flow.right]) {
      if (arr[p] === UNMEASURED) continue;
      arr[p] = Math.round(Math.max(floor, Math.min(arr[p], bound)));
    }
    widths.push(flow.left[p] + flow.right[p]);
  }
  forgetFlow(); useFlow(flow);
  const { land, wet } = survey();
  console.log(`${(k === Infinity ? 'none' : String(k)).padEnd(8)}`
    + `${(100 * wet / land).toFixed(2).padStart(9)}%`
    + `${(wet * (STEP/100) * (STEP/100) / 1e6).toFixed(0).padStart(10)}`
    + `${(q(widths,.5)/100).toFixed(1).padStart(14)} m`
    + `${(q(widths,.95)/100).toFixed(1).padStart(11)} m`);
}
