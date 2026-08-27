import { readFileSync } from 'node:fs';
import { decodeHydro, type Hydro } from '../../src/world/hydro';
import { useGrid, setSmoothing } from '../../src/world/heightfield';
import { decodeGrid } from '../../src/world/kauai';
import { HD_TILES, hdTileIndex, hdTileName, useHdTile } from '../../src/world/kauaiHd';

/**
 * THE ISLAND THE GAME ACTUALLY WALKS ON.
 *
 * `useGrid` alone loads the 54.7 m file, and a test that stops there
 * is measuring a DIFFERENT ISLAND — a blurrier one whose valleys are
 * not where Kauaʻi's are. It is not a small difference: on the coarse
 * grid 79.1% of the surveyed river network is buried in terrain, and
 * on the HD grid the game streams it is 29.7%. A water test run on the
 * coarse grid reports rivers bone dry that are fine in the game, and
 * would send somebody off to fix a bug that does not exist.
 *
 * So every water test loads all 64 HD tiles, exactly as `followHd`
 * would have done around the player, and gets the same answer the
 * player gets.
 */
export function loadIsland(): Hydro {
  const read = (p: string): Buffer => readFileSync(p);
  const buf = read('public/kauai-1025.bin');
  useGrid(decodeGrid(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer));
  setSmoothing(0);
  for (let col = 0; col < HD_TILES; col++) {
    for (let row = 0; row < HD_TILES; row++) {
      const index = hdTileIndex(col, row);
      const tile = read(`public/kauai-hd/${hdTileName(index)}.bin`);
      useHdTile(index, new Int16Array(
        tile.buffer.slice(tile.byteOffset, tile.byteOffset + tile.byteLength)));
    }
  }
  const h = read('public/kauai-hydro.bin');
  return decodeHydro(h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength) as ArrayBuffer);
}
