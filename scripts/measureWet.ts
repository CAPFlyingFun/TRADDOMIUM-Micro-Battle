/**
 * HOW WIDE THE WATER ACTUALLY COMES OUT, measured on the ground the
 * game draws.
 *
 * The bake stores a centreline, a width from hydraulic geometry, and a
 * water LEVEL; the renderer lays an over-wide slab at that level and
 * lets the terrain clip it. So the width a player SEES is not the
 * baked width at all -- it is however far the ground stays below the
 * level, bounded by how far the slab was drawn. This walks outward from
 * every sampled station until the ground rises through the surface and
 * reports the difference between the three.
 *
 *   npx vite-node scripts/measureWet.ts [stations]
 */
import { readFileSync } from 'node:fs';
import { decodeGrid, SPAN } from '../src/world/kauai';
import {
  groundHeight, setRelief, setSmoothing, terrainHeight, useGrid,
} from '../src/world/heightfield';
import { decodeFlow, slabHalf, useFlow, type Flow } from '../src/world/flow';
import { DEFAULTS } from '../src/ui/settings';

const STEP_OUT = 20;          // 20 cm a stride
const MARCH = 400_000;        // give up at 4 km

const grid = readFileSync('public/kauai-1025.bin');
useGrid(decodeGrid(grid.buffer.slice(grid.byteOffset, grid.byteOffset + grid.byteLength)));
setSmoothing(DEFAULTS.terrainSmoothing);
setRelief(1);
const bin = readFileSync('public/kauai-flow.bin');
const flow: Flow = decodeFlow(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
useFlow(flow);

/** Unit normal to the reach at station `p`, from its neighbours. */
function normal(first: number, count: number, i: number): [number, number] {
  const back = first + Math.max(0, i - 1);
  const fore = first + Math.min(count - 1, i + 1);
  let dx = flow.x[fore] - flow.x[back];
  let dz = flow.z[fore] - flow.z[back];
  const run = Math.hypot(dx, dz);
  if (run < 1e-6) return [0, 1];
  dx /= run; dz /= run;
  return [-dz, dx];
}

/** How far the ground stays under `level` walking out along (nx, nz). */
function reachOut(x: number, z: number, nx: number, nz: number, level: number): number {
  for (let d = STEP_OUT; d <= MARCH; d += STEP_OUT) {
    if (groundHeight(x + nx * d, z + nz * d) >= level) return d - STEP_OUT;
  }
  return MARCH;
}

const want = Number(process.argv[2] ?? 2000);
const rows: {
  q: number; baked: number; slab: number; wetL: number; wetR: number;
  drawn: number; deep: number; dry: boolean; capped: boolean; open: boolean;
}[] = [];

// Stride the reaches so the sample spans the island rather than one corner.
const stride = Math.max(1, Math.floor(flow.reaches.length / want));
for (let r = 0; r < flow.reaches.length; r += stride) {
  const { first, count } = flow.reaches[r];
  const i = Math.floor(count / 2);
  const p = first + i;
  const level = flow.level[p];
  if (level < flow.bed[p]) continue;              // a pond owns this one
  const [nx, nz] = normal(first, count, i);
  const x = flow.x[p], z = flow.z[p];
  const wetL = reachOut(x, z, -nx, -nz, level);
  const wetR = reachOut(x, z, nx, nz, level);
  const slab = slabHalf(flow.width[p]);
  const ground = groundHeight(x, z);
  rows.push({
    q: flow.width[p], baked: flow.width[p], slab,
    wetL, wetR,
    drawn: Math.min(wetL, slab) + Math.min(wetR, slab),
    deep: level - ground,
    dry: ground >= level,
    capped: wetL > slab || wetR > slab,
    open: wetL >= MARCH || wetR >= MARCH,
  });
}

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const m = (u: number) => (u / 100).toFixed(2) + ' m';
const col = (name: string, xs: number[]) =>
  `${name.padEnd(12)} p05 ${m(q(xs, .05)).padStart(9)}  median ${m(q(xs, .5)).padStart(9)}`
  + `  p95 ${m(q(xs, .95)).padStart(9)}  max ${m(Math.max(...xs)).padStart(9)}`;

console.log(`\n${rows.length} stations sampled, one mid-reach\n`);
console.log(col('baked width', rows.map(r => r.baked)));
console.log(col('slab (both)', rows.map(r => r.slab * 2)));
console.log(col('WET (both)', rows.map(r => r.wetL + r.wetR)));
console.log(col('DRAWN', rows.map(r => r.drawn)));
console.log(col('depth here', rows.map(r => r.deep)));
console.log(`\nDRY at the centreline      ${rows.filter(r => r.dry).length}`
  + ` of ${rows.length}  (${(100 * rows.filter(r => r.dry).length / rows.length).toFixed(1)}%)`);
console.log(`wet reach cut by the slab  ${rows.filter(r => r.capped).length}`
  + `  (${(100 * rows.filter(r => r.capped).length / rows.length).toFixed(1)}%)`);
console.log(`still open at ${MARCH / 100} m       ${rows.filter(r => r.open).length}`
  + `  (${(100 * rows.filter(r => r.open).length / rows.length).toFixed(1)}%)`);

// How rough the ground is beside a channel, which is what a shallow
// sheet has to survive: the bake averaged 4x4 per cell, the game draws
// every octave.
const rough: number[] = [];
for (const r of flow.reaches.slice(0, 400)) {
  const p = r.first + Math.floor(r.count / 2);
  let lo = Infinity, hi = -Infinity;
  for (let d = -3000; d <= 3000; d += 50) {
    const h = terrainHeight(flow.x[p] + d, flow.z[p]);
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  rough.push(hi - lo);
}
console.log(`\nground range over 60 m across a channel: median ${m(q(rough, .5))},`
  + ` p95 ${m(q(rough, .95))}`);
