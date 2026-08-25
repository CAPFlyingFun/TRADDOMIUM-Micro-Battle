/**
 * WHAT THE WATER SHADER BELIEVES, AGAINST WHAT THE GAME ACTUALLY HAS.
 *
 * Three versions of the water have now been drawn from three different
 * ideas of where the ground is, and each one shipped before anybody
 * asked it this question. So it gets asked here, of the REAL geometry —
 * buildReach is called, the vertices it emits are read back, and the
 * depth the fragment shader would interpolate between them is compared
 * against level-minus-terrainHeight at the same point.
 *
 * Two numbers matter, one for each half of what Joshua kept seeing:
 *
 *   drawn at ZERO alpha   water that is there and cannot be seen
 *   dry ground painted    blue over ground that is above the water
 *
 * The ground-texture build scored 66.6% on the first. The analytic
 * bank profile that replaced it scored 1.3% and 52.3%.
 *
 *   npx vite-node scripts/shaderDepth.ts
 */
import { readFileSync } from 'node:fs';
import { decodeGrid } from '../src/world/kauai';
import { setRelief, setSmoothing, useGrid, terrainHeight } from '../src/world/heightfield';
import { decodeFlow, useFlow, waterLevelAt } from '../src/world/flow';
import { buildReach } from '../src/world/FlowWater';
import { bank } from '../src/world/carve';
import { DEFAULTS } from '../src/ui/settings';

// Which candidate to score. `curve` is the trench profile alone,
// `ground` the sampled island alone, `both` the exact combination.
const WAY = process.env.WAY ?? 'both';
const grid = readFileSync('public/kauai-1025.bin');
useGrid(decodeGrid(grid.buffer.slice(grid.byteOffset, grid.byteOffset + grid.byteLength)));
setSmoothing(DEFAULTS.terrainSmoothing); setRelief(1);
const bin = readFileSync('public/kauai-flow.bin');
const flow = decodeFlow(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
useFlow(flow);

// WEIGHTED BY AREA, NOT BY TRIANGLE. The tessellation deliberately
// crowds vertices into the trench, so counting samples per triangle
// counts the trench several times over and the same water scores
// differently for no reason but how it was cut up. Every figure below
// is a fraction of the SURFACE, which is what the eye sees.
let n = 0, sumReal = 0, sumShader = 0, zero = 0, dry = 0, dryPainted = 0;
const errs: number[] = [];
const missed: number[] = [];
let elsewhere = 0, orphan = 0;
// Every eleventh reach, which is 300-odd of them and a couple of
// million sample points — a whole-island answer in under a minute.
for (let r = 0; r < flow.reaches.length; r += 11) {
  const { first, count } = flow.reaches[r];
  const geometry = buildReach(flow, first, count, 0, 0);
  if (!geometry) continue;
  const pos = geometry.getAttribute('position').array as Float32Array;
  const deep = geometry.getAttribute('deep').array as Float32Array;
  const across = geometry.getAttribute('across').array as Float32Array;
  const span = geometry.getAttribute('span').array as Float32Array;
  const rise = geometry.getAttribute('rise').array as Float32Array;
  const index = geometry.getIndex()!.array as ArrayLike<number>;
  // Sample inside each triangle, where the shader interpolates, rather
  // than at the vertices, where it cannot be wrong by construction.
  for (let f = 0; f < index.length; f += 3) {
    const [a, b, c] = [index[f], index[f + 1], index[f + 2]];
    // Half the cross product, in square metres, split over the samples.
    const ux = pos[b * 3] - pos[a * 3], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const area = Math.abs(ux * vz - uz * vx) / 2 / 1e4 / 3;
    if (area <= 0) continue;
    for (const [wa, wb, wc] of [[.5, .3, .2], [.2, .5, .3], [.3, .2, .5]]) {
      const wx = pos[a * 3] * wa + pos[b * 3] * wb + pos[c * 3] * wc;
      const wz = pos[a * 3 + 2] * wa + pos[b * 3 + 2] * wb + pos[c * 3 + 2] * wc;
      const level = pos[a * 3 + 1] * wa + pos[b * 3 + 1] * wb + pos[c * 3 + 1] * wc;
      if (wx === 0 && wz === 0) continue;                 // degenerate
      // Exactly what the fragment shader evaluates, on exactly the
      // values the rasteriser would hand it.
      const vd = deep[a] * wa + deep[b] * wb + deep[c] * wc;
      const va = across[a] * wa + across[b] * wb + across[c] * wc;
      const vs = span[a] * wa + span[b] * wb + span[c] * wc;
      const vr = rise[a] * wa + rise[b] * wb + rise[c] * wc;
      const curve = vd * bank(Math.abs(va) / Math.max(vs, 1));
      const shader = WAY === 'curve' ? curve
        : WAY === 'ground' ? vr
        : Math.max(vr, curve + Math.min(vr, 0));
      const real = level - terrainHeight(wx, wz);
      if (real <= 0) {
        dry += area;
        // Alpha only bites past a few centimetres; below that the
        // fragment is clear and the ground shows through regardless.
        if (shader > 5) dryPainted += area;
        continue;
      }
      n += area; sumReal += real * area; sumShader += shader * area;
      errs.push(shader - real);
      if (shader <= 0) {
        zero += area; missed.push(real);
        // WHOSE WATER IS THIS? The index answers with the level of the
        // station that actually OWNS the point, which need not be the
        // one whose slab we happen to be walking. Where it names a
        // different level, another reach covers this ground and draws
        // it from its own depth; where it names ours, nobody does.
        const own = waterLevelAt(wx, wz);
        if (own !== null && Math.abs(own - level) > 1) elsewhere += area;
        else orphan += area;
      }
    }
  }
  geometry.dispose();
}
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)];
console.log(`\n${WAY}\nwet water drawn              ${(n / 1e6).toFixed(2)} km2`);
console.log(`mean depth the game has      ${(sumReal / n / 100).toFixed(2)} m`);
console.log(`mean depth the shader sees   ${(sumShader / n / 100).toFixed(2)} m`);
console.log(`drawn at ZERO alpha          ${(100 * zero / n).toFixed(1)}%`);
console.log(`error p05/p50/p95            ${(q(errs,.05)/100).toFixed(2)} / ${(q(errs,.5)/100).toFixed(2)} / ${(q(errs,.95)/100).toFixed(2)} m`);
console.log(`  depth of that, p50/p95     ${(q(missed,.5)/100).toFixed(2)} / ${(q(missed,.95)/100).toFixed(2)} m`);
console.log(`  owned by another reach     ${(100 * elsewhere / zero).toFixed(1)}%`);
console.log(`  covered by nothing else    ${(100 * orphan / zero).toFixed(1)}% (= ${(100 * orphan / n).toFixed(1)}% of water)`);
console.log(`  of it deeper than 10 cm    ${(100 * missed.filter(d => d > 10).length / missed.length).toFixed(1)}%`);
console.log(`dry ground under the slab    ${(dry / 1e6).toFixed(2)} km2`);
console.log(`  of those, painted blue     ${(100 * dryPainted / dry).toFixed(1)}%`);
