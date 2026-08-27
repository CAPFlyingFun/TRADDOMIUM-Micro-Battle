import { readFileSync } from 'node:fs';
import { beforeAll, describe, it } from 'vitest';
import { decodeHydro, type Hydro } from '../src/world/hydro';
import { terrainHeight, useGrid, setSmoothing } from '../src/world/heightfield';
import { decodeGrid, UNITS_PER_METRE } from '../src/world/kauai';
import { hdTileName, useHdTile, HD_TILES, hdTileIndex } from '../src/world/kauaiHd';

function read(p: string): ArrayBuffer {
  const f = readFileSync(p);
  return f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer;
}
let hydro: Hydro;
beforeAll(() => { useGrid(decodeGrid(read('public/kauai-1025.bin'))); setSmoothing(0);
  hydro = decodeHydro(read('public/kauai-hydro.bin'));
  // THE GRID THE GAME ACTUALLY WALKS ON. `useGrid` loads the 54.7 m
  // file; the island streams 64 HD tiles at 13.67 m over the top of
  // it, and `terrainHeight` prefers them. Measuring without them
  // measures a different island — a blurrier one, whose valleys are
  // not where Kauai's are.
  let loaded = 0;
  for (let col = 0; col < HD_TILES; col++) {
    for (let row = 0; row < HD_TILES; row++) {
      const index = hdTileIndex(col, row);
      try {
        const buf = readFileSync(`public/kauai-hd/${hdTileName(index)}.bin`);
        useHdTile(index, new Int16Array(
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
        loaded++;
      } catch { /* a tile that is not there is answered by the coarse grid */ }
    }
  }
  console.log(`HD tiles loaded: ${loaded}/64`);
});

describe('does the ground hold the survey', () => {
  it('counts river points above their own terrain', () => {
    let below = 0, above = 0; const over: number[] = [];
    for (let i = 0; i < hydro.x.length; i++) {
      const ground = terrainHeight(hydro.x[i], hydro.z[i]);
      const level = hydro.level[i];
      if (level >= ground) below++; else { above++; over.push(ground - level); }
    }
    const n = below + above;
    over.sort((a, b) => a - b);
    const m = (u: number) => (u / UNITS_PER_METRE).toFixed(2);
    console.log(`points ${n}: ${(100 * below / n).toFixed(1)}% sit at/below their ground`);
    console.log(`the other ${(100 * above / n).toFixed(1)}% are BURIED by median ${m(over[Math.floor(over.length / 2)])} m, p90 ${m(over[Math.floor(over.length * 0.9)])} m`);
    // what a carve of depth D would recover
    for (const d of [60, 120, 240]) {
      const fixed = below + over.filter((o) => o <= d).length;
      console.log(`  a ${(d / 100).toFixed(1)} m bed would hold ${(100 * fixed / n).toFixed(1)}%`);
    }
  }, 300000);
});
