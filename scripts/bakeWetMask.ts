/**
 * THE ISLAND'S FRESH WATER AS ONE SMALL PICTURE, for the far view.
 *
 * From two hundred metres up, the water is not a surface she can stand
 * on — it is a drainage pattern on a landscape. The slab geometry was
 * being asked to serve both, and past the transition tier it cannot:
 * a 31 m middle-tier triangle clips a flat slab into exactly the
 * turquoise shards Joshua photographed. Measured at his own aerial fix
 * (22.04161170, -159.37212633): 99.7% of the 2,806 wet lattice points
 * within draw range sat beyond the 200 m transition reach, median
 * 1,442 m out — essentially everything on screen was the failure case.
 *
 * So the far field changes owner. Within a couple hundred metres the
 * water is geometry, clipped by a mesh fine enough to clip it; past
 * that the TERRAIN wears the water as colour, from this mask, and the
 * geometry is not drawn at all. One owner per distance, and the
 * crossfade between them shares one pair of constants.
 *
 * WET FRACTION, NOT WET/DRY. Each texel is 54.7 m of island and most
 * rivers are narrower, so a boolean would either lose them or fatten
 * every stream to a texel. The byte stores how much of the texel's
 * area is underwater, 4x4-supersampled, which antialiases for free:
 * a 12 m stream reads as a faint line, the Wailua as a strong one,
 * a pond as solid — which is how drainage looks from a plane.
 *
 *   npx vite-node scripts/bakeWetMask.ts
 *
 * Writes public/kauai-wet.bin: 'TMWM', u16 version=1, u16 size, then
 * size*size bytes row-major, row j = south-to-north (v = +z), byte =
 * round(255 * wetFraction). Re-run after any flow re-bake, then
 * scripts/bakeSizes.ts; tests/farWater.test.ts holds it to the flow.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeGrid, SPAN } from '../src/world/kauai';
import { setRelief, setSmoothing, terrainHeight, useGrid } from '../src/world/heightfield';
import { decodeFlow, halfAt, useFlow, waterLevelAt } from '../src/world/flow';
import { DEFAULTS } from '../src/ui/settings';

const g = readFileSync('public/kauai-1025.bin');
useGrid(decodeGrid(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength)));
setSmoothing(DEFAULTS.terrainSmoothing); setRelief(1);
const f = readFileSync('public/kauai-flow.bin');
const flow = decodeFlow(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength));
useFlow(flow);

// 1024 rather than the grid's 1025: a power of two so the texture can
// mip, which is what stops the far rivers shimmering at grazing angles.
const SIZE = 1024;
const SS = 4;
const TEXEL = SPAN / SIZE;

const data = new Uint8Array(SIZE * SIZE);
let wetTexels = 0, area = 0;
const t0 = performance.now();
for (let j = 0; j < SIZE; j++) {
  const z0 = (j / SIZE) * SPAN - SPAN / 2;
  for (let i = 0; i < SIZE; i++) {
    const x0 = (i / SIZE) * SPAN - SPAN / 2;
    let wet = 0;
    for (let sj = 0; sj < SS; sj++) {
      const wz = z0 + ((sj + 0.5) / SS) * TEXEL;
      for (let si = 0; si < SS; si++) {
        const wx = x0 + ((si + 0.5) / SS) * TEXEL;
        // waterLevelAt is cheap where there is no water — most of the
        // island — and terrainHeight is only asked when there is.
        const level = waterLevelAt(wx, wz);
        if (level !== null && level > terrainHeight(wx, wz)) wet++;
      }
    }
    if (wet > 0) { wetTexels++; area += wet / (SS * SS); }
    data[j * SIZE + i] = Math.round((255 * wet) / (SS * SS));
  }
  if (j % 128 === 0) console.log(`row ${j}/${SIZE}`);
}

// AND THE DRAINAGE NETWORK STAMPED ALONG ITS OWN CENTRELINES.
//
// Area sampling alone loses the thin streams: sixteen samples in a
// 54.7 m texel sit 13.7 m apart, and a five-metre mountain channel
// slips between all of them more often than not — measured, 60% of
// genuinely-wet stations landed in a ZERO texel, which from the air
// is every thin river drawn as dashes. So every reach's polyline is
// walked at half-texel steps and each texel it crosses is FLOORED at
// the stream's own share of the texel: wet width over texel width,
// which is the area a crossing stream actually covers. The floor can
// only raise a texel the water really passes through, and the area
// pass still owns everything wide.
let stamped = 0;
for (const { first, count } of flow.reaches) {
  for (let i = 0; i < count - 1; i++) {
    const p = first + i, q = p + 1;
    // A span a pond has taken draws nothing and claims nothing.
    if (flow.level[p] < flow.bed[p] || flow.level[q] < flow.bed[q]) continue;
    const leg = Math.hypot(flow.x[q] - flow.x[p], flow.z[q] - flow.z[p]);
    const steps = Math.max(1, Math.ceil(leg / (TEXEL / 2)));
    for (let n = 0; n <= steps; n++) {
      const t = n / steps;
      const wx = flow.x[p] + (flow.x[q] - flow.x[p]) * t;
      const wz = flow.z[p] + (flow.z[q] - flow.z[p]) * t;
      const width =
        halfAt(flow, p, -1) + (halfAt(flow, q, -1) - halfAt(flow, p, -1)) * t
        + halfAt(flow, p, 1) + (halfAt(flow, q, 1) - halfAt(flow, p, 1)) * t;
      const gi = Math.floor(((wx + SPAN / 2) / SPAN) * SIZE);
      const gj = Math.floor(((wz + SPAN / 2) / SPAN) * SIZE);
      if (gi < 0 || gj < 0 || gi >= SIZE || gj >= SIZE) continue;
      const floor = Math.round(255 * Math.min(1, width / TEXEL));
      const at = gj * SIZE + gi;
      if (data[at] < floor) { data[at] = floor; stamped++; }
    }
  }
}
console.log(`${stamped} texels raised by the centreline stamp`);

const out = new Uint8Array(8 + data.length);
const view = new DataView(out.buffer);
out[0] = 0x54; out[1] = 0x4d; out[2] = 0x57; out[3] = 0x4d;   // 'TMWM'
view.setUint16(4, 1, true);
view.setUint16(6, SIZE, true);
out.set(data, 8);
writeFileSync('public/kauai-wet.bin', out);
console.log(`baked in ${((performance.now() - t0) / 1000).toFixed(0)}s`);
console.log(`${wetTexels} texels touch water (${(100 * wetTexels / (SIZE * SIZE)).toFixed(2)}%)`);
console.log(`fresh water area ${(area * (TEXEL / 100) * (TEXEL / 100) / 1e6).toFixed(1)} km2`);
