import { readFileSync } from 'node:fs';
import { decodeGrid } from '../src/world/kauai';
import { useGrid, setSmoothing, setRelief, baseLand, CELL_VERTS, COARSE_VERTS } from '../src/world/heightfield';
import { decodeHydro, useHydro, forgetHydro } from '../src/world/hydro';
import { decodeHdTile, hdTileName, useHdTile } from '../src/world/kauaiHd';
import { indexRiverBeds, forgetRiverBeds } from '../src/world/riverBed';
import { CHUNK_SPAN } from '../src/world/coords';

const g = readFileSync('public/kauai-1025.bin');
useGrid(decodeGrid(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength)));
setRelief(1); setSmoothing(0);
for (let i = 0; i < 64; i++) {
  const b = readFileSync(`public/kauai-hd/${hdTileName(i)}.bin`);
  useHdTile(i, decodeHdTile(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
}
const h = readFileSync('public/kauai-hydro.bin');
const hy = decodeHydro(h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength));

const pct = (a: number[], q: number) => { const s=[...a].sort((x,y)=>x-y); return s[Math.floor(s.length*q)]/100; };

function buried(): void {
  const d: number[] = []; let wet = 0, n = 0;
  for (let i = 0; i < hy.x.length; i += 3) {
    const ground = baseLand(hy.x[i], hy.z[i]);
    if (ground <= -10_000 || ground >= 200_000) continue;
    n++; const v = ground - hy.level[i]; d.push(v); if (v <= 0) wet++;
  }
  console.log(`  ground above water: median ${pct(d,.5).toFixed(2)} m  p90 ${pct(d,.9).toFixed(2)} m  p99 ${pct(d,.99).toFixed(2)} m   WET ${(100*wet/n).toFixed(1)}%`);
}

console.log('no bed:'); buried();
useHydro(hy); indexRiverBeds();
console.log('with the streambed:'); buried();

// And the fins test: what the carve does to neighbouring lattice vertices.
// Both passes walked in full, index built ONCE each way.
for (const [label, verts] of [['fine(8u)', CELL_VERTS], ['coarse(32u)', COARSE_VERTS]] as const) {
  const step = CHUNK_SPAN / (verts - 1);
  const spots: Array<[number, number]> = [];
  for (let r = 0; r < hy.rivers.length; r += 61) {
    const p = hy.rivers[r].first + (hy.rivers[r].count >> 1);
    spots.push([hy.x[p], hy.z[p]]);
  }
  const walk = () => {
    const out: number[] = [];
    for (const [sx, sz] of spots) {
      const cx = Math.floor(sx / CHUNK_SPAN), cz = Math.floor(sz / CHUNK_SPAN);
      for (const [i, j] of [[0, 0], [1, 0]] as const) {
        const ox = (cx + i) * CHUNK_SPAN, oz = (cz + j) * CHUNK_SPAN;
        for (let row = 0; row < verts; row++) {
          for (let c = 0; c < verts - 1; c++) {
            const axx = ox + c * step, zz = oz + row * step;
            out.push(baseLand(axx, zz) - baseLand(axx + step, zz));
          }
        }
      }
    }
    return out;
  };
  useHydro(hy); indexRiverBeds();
  const cut = walk();
  forgetRiverBeds(); forgetHydro();
  const bare = walk();
  useHydro(hy); indexRiverBeds();
  const d = cut.map((v, i) => Math.abs(v - bare[i])).filter((v) => Number.isFinite(v));
  d.sort((a, b) => a - b);
  const over = (t: number) => (100 * d.filter((v) => v > t).length / d.length).toFixed(4);
  console.log(`${label}  n=${d.length}  p99.9 ${(d[Math.floor(d.length * 0.999)] / 100).toFixed(3)} m  max ${(d[d.length - 1] / 100).toFixed(2)} m  over20cm ${over(20)}%  over40cm ${over(40)}%`);
}
