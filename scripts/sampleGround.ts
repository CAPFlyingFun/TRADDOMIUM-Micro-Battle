/**
 * THE GROUND THE GAME ACTUALLY DRAWS, written out for the water bake.
 *
 * The first version of bakeFlow.py read `kauai-1025.bin` straight off
 * disk and simulated that. But the island she stands on is not that
 * grid — `baseLand` blends it toward a pre-blurred copy by the
 * smoothing dial, adds five octaves of procedural relief, eases that in
 * at the shore and out again on cliffs, and scales the lot by the
 * height dial. Simulating the raw grid meant simulating a DIFFERENT
 * ISLAND, which is the same "two sources for one surface" fault this
 * whole rebuild set out to end, moved up one level.
 *
 * So this calls the game's own `terrainHeight`, with the flow index
 * unloaded so nothing is carved yet, and writes what it gets.
 *
 * SUPERSAMPLED, AND THAT IS NOT A DETAIL. Every noise octave is SHORTER
 * than the grid spacing — 20.5 m is the longest against a 54.7 m cell —
 * so the procedural relief is entirely sub-cell. Point-sampling it once
 * per cell would not capture it, it would ALIAS it: 94 cm of ripple
 * turned into 94 cm of random jitter, and every piece of that jitter a
 * fake pit for the flood fill to pond in. Averaging a 4x4 block per
 * cell takes the ripple back out and leaves the part that can actually
 * move water — the smoothing, the shore, the cliffs, the dial.
 *
 * What is genuinely lost: real puddles at sub-metre scale. Those live
 * in the noise, the noise is procedural and deterministic, and if they
 * are ever wanted they should be found at runtime near the queen rather
 * than baked for an island 56 km across.
 *
 *   npx vite-node scripts/sampleGround.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeGrid, SAMPLES, SPAN } from '../src/world/kauai';
import { setRelief, setSmoothing, terrainHeight, useGrid } from '../src/world/heightfield';
import { forgetFlow } from '../src/world/flow';
import { DEFAULTS } from '../src/ui/settings';

const OUT = 'scripts/.ground.f32';
/** Samples a side within each cell. 16 taps averages the ripple away. */
const SUB = 4;

const file = readFileSync('public/kauai-1025.bin');
useGrid(decodeGrid(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)));
// The dials the game boots with — Joshua's, read off his settings panel.
setSmoothing(DEFAULTS.terrainSmoothing);
setRelief(DEFAULTS.terrainRelief);
// No carve yet: with the index empty `terrainHeight` IS `baseLand`, which
// is the un-carved ground the hydrology has to be solved on.
forgetFlow();

const step = SPAN / (SAMPLES - 1);
const out = new Float32Array(SAMPLES * SAMPLES);
const started = Date.now();
for (let gy = 0; gy < SAMPLES; gy++) {
  for (let gx = 0; gx < SAMPLES; gx++) {
    let sum = 0;
    for (let sy = 0; sy < SUB; sy++) {
      for (let sx = 0; sx < SUB; sx++) {
        const wx = (gx + (sx + 0.5) / SUB - 0.5) * step - SPAN / 2;
        const wz = (gy + (sy + 0.5) / SUB - 0.5) * step - SPAN / 2;
        sum += terrainHeight(wx, wz);
      }
    }
    // Metres, which is what the hydrology works in.
    out[gy * SAMPLES + gx] = sum / (SUB * SUB) / 100;
  }
  if (gy % 128 === 0) {
    process.stderr.write(`  row ${gy}/${SAMPLES}\r`);
  }
}
writeFileSync(OUT, Buffer.from(out.buffer));
// Counted in a loop, not with a spread: a million-element spread is a
// million arguments, and V8 refuses long before that.
let landCells = 0;
let summit = -Infinity;
for (const h of out) { if (h > 0) landCells++; if (h > summit) summit = h; }
console.log(`\nsampled ${SAMPLES}^2 x ${SUB * SUB} taps in ${((Date.now()-started)/1000).toFixed(0)}s`);
console.log(`  smoothing ${DEFAULTS.terrainSmoothing}  height ${DEFAULTS.terrainRelief}`);
console.log(`  land ${landCells.toLocaleString()} cells, summit ${summit.toFixed(0)} m`);
console.log(`  wrote ${OUT}`);
