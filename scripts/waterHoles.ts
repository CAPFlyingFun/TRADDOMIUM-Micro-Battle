/**
 * WHERE THE GAME SAYS WATER AND NOTHING IS DRAWN.
 *
 * Depth is right and the shoreline is opaque, and Joshua still finds
 * places with no water in them: "still water not showing in a deep
 * part". So this asks the only question left — is there GEOMETRY over
 * every point the level field calls wet?
 *
 * Drawn coverage is rasterised from the real slabs, triangle by
 * triangle, rather than reasoned about from half-widths. Every previous
 * version of this argument was made from half-widths and every one of
 * them was wrong.
 *
 *   npx vite-node scripts/waterHoles.ts
 */
import { readFileSync } from 'node:fs';
import { decodeGrid, SPAN } from '../src/world/kauai';
import { setRelief, setSmoothing, useGrid, terrainHeight } from '../src/world/heightfield';
import { decodeFlow, useFlow, waterLevelAt, pondLevelAt } from '../src/world/flow';
import { buildReach, buildPonds } from '../src/world/FlowWater';
import { DEFAULTS } from '../src/ui/settings';

const g = readFileSync('public/kauai-1025.bin');
useGrid(decodeGrid(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength)));
setSmoothing(DEFAULTS.terrainSmoothing); setRelief(1);
const f = readFileSync('public/kauai-flow.bin');
const flow = decodeFlow(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength));
useFlow(flow);

// One 4 km square of island per probe, sampled every 4 m.
const HALF = 200_000;
const STEP = 400;
const N = (HALF * 2) / STEP;

/** Rasterise every slab that touches the box into a coverage grid. */
function drawnOver(cx: number, cz: number): Uint8Array {
  const hit = new Uint8Array(N * N);
  const mark = (
    ax: number, az: number, bx: number, bz: number, dx: number, dz: number,
  ) => {
    const lo = (v: number) => Math.max(0, Math.floor((v + HALF) / STEP));
    const hi = (v: number) => Math.min(N - 1, Math.ceil((v + HALF) / STEP));
    const x0 = lo(Math.min(ax, bx, dx)), x1 = hi(Math.max(ax, bx, dx));
    const z0 = lo(Math.min(az, bz, dz)), z1 = hi(Math.max(az, bz, dz));
    const side = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) =>
      (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
    for (let j = z0; j <= z1; j++) {
      const pz = j * STEP - HALF;
      for (let i = x0; i <= x1; i++) {
        const px = i * STEP - HALF;
        const s1 = side(ax, az, bx, bz, px, pz);
        const s2 = side(bx, bz, dx, dz, px, pz);
        const s3 = side(dx, dz, ax, az, px, pz);
        if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) {
          hit[j * N + i] = 1;
        }
      }
    }
  };
  const eat = (geo: ReturnType<typeof buildPonds> | null, ox: number, oz: number) => {
    if (!geo) return;
    const pos = geo.getAttribute('position').array as Float32Array;
    const idx = geo.getIndex()!.array as ArrayLike<number>;
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      mark(
        pos[a * 3] + ox - cx, pos[a * 3 + 2] + oz - cz,
        pos[b * 3] + ox - cx, pos[b * 3 + 2] + oz - cz,
        pos[c * 3] + ox - cx, pos[c * 3 + 2] + oz - cz,
      );
    }
    geo.dispose();
  };
  for (const { first, count } of flow.reaches) {
    let near = false;
    for (let i = 0; i < count && !near; i++) {
      const p = first + i;
      if (Math.abs(flow.x[p] - cx) < HALF * 1.6 && Math.abs(flow.z[p] - cz) < HALF * 1.6) near = true;
    }
    if (near) eat(buildReach(flow, first, count, 0, 0), 0, 0);
  }
  const cells: number[] = [];
  for (let i = 0; i < flow.pondX.length; i++) {
    if (Math.abs(flow.pondX[i] - cx) < HALF * 1.6 && Math.abs(flow.pondZ[i] - cz) < HALF * 1.6) {
      cells.push(i);
    }
  }
  if (cells.length) eat(buildPonds(flow, cells, 0, 0), 0, 0);
  return hit;
}

let wet = 0, holed = 0, pondHole = 0, ownedHole = 0, farHole = 0;
const offs: number[] = [];
/** Nearest station to a point, and whether a pond has been given it. */
function nearest(wx: number, wz: number): { d: number; owned: boolean } {
  let d = Infinity, owned = false;
  for (let q = 0; q < flow.x.length; q++) {
    const e = Math.hypot(flow.x[q] - wx, flow.z[q] - wz);
    if (e < d) { d = e; owned = flow.level[q] < flow.bed[q]; }
  }
  return { d, owned };
}
const spots: Array<[number, number]> = [
  [-1.2e6, 1.1e6], [0, 0], [8e5, -6e5], [-2e6, -1e6], [1.5e6, 9e5], [-6e5, 4e5],
];
for (const [cx, cz] of spots) {
  const hit = drawnOver(cx, cz);
  for (let j = 0; j < N; j++) {
    const wz = cz + j * STEP - HALF;
    for (let i = 0; i < N; i++) {
      const wx = cx + i * STEP - HALF;
      const level = waterLevelAt(wx, wz);
      if (level === null || level - terrainHeight(wx, wz) <= 0) continue;
      wet++;
      if (hit[j * N + i]) continue;
      holed++;
      if (pondLevelAt(wx, wz) !== null) pondHole++;
      if (holed % 17 === 0) {
        const near = nearest(wx, wz);
        offs.push(near.d);
        if (near.owned) ownedHole++;
        else farHole++;
      }
    }
  }
}
console.log(`wet samples the game claims   ${wet}`);
console.log(`with NO geometry over them    ${holed}  (${(100 * holed / wet).toFixed(1)}%)`);
console.log(`  of those, a pond COVERS it  ${(100 * pondHole / Math.max(1, holed)).toFixed(1)}%`);
const sampled = ownedHole + farHole;
console.log(`  sampled ${sampled} of them:`);
console.log(`    nearest station is pond-FLAGGED  ${(100 * ownedHole / sampled).toFixed(1)}%`);
const q = (xs: number[], f: number) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * f)];
console.log(`    distance to it, p50/p95   ${(q(offs, .5) / 100).toFixed(1)} / ${(q(offs, .95) / 100).toFixed(1)} m`);
