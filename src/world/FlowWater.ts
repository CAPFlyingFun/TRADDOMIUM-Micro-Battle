import * as THREE from 'three';
import { toLocal } from './origin';
import { reliefScale } from './heightfield';
import { reliefUniform } from './terrainMaterial';
import { flowData, halfAt, type Flow } from './flow';
import { baseLand } from './heightfield';
import { BANK_GLSL, cutHalf, WATER_DEPTH_GLSL } from './carve';
import { SPAN } from './kauai';
import type { LoadReport } from '../ui/loadPlan';
import { assetBytes } from '../ui/assetSizes';
import { pullBytes } from './fetchBytes';
import { FAR_WATER, NEAR_WATER } from './farWater';

/**
 * THE SURFACE OF EVERY STREAM AND POND THE ISLAND MAKES FOR ITSELF.
 *
 * WATER IS A LEVEL FIELD, like the ocean. The bake stores each
 * station's water-surface LEVEL — valley floor plus a real depth,
 * clamped monotonic downstream — and each ponded cell's spill LEVEL.
 * This file draws deliberately over-wide flat slabs AT that level and
 * lets the terrain clip them: the banks rise through the surface, so
 * the water's edge, its curves, and the mid-stream stones all come out
 * of the depth test rather than out of anything drawn here. The ground
 * doing the clipping carries carve.ts's bounded trench (since
 * v0.0.45), so the slab has a bed to sit in — an earlier version of
 * this header said NOTHING IS CARVED, which was true for two versions
 * and is not any more.
 *
 * OVER-WIDE IS MEASURED NOW, NOT GUESSED FROM THE CHANNEL. Version 2
 * sized every slab with slabHalf(width), and WIDTH is the TRUE
 * hydraulic channel — a median of 0.60 m across, which really is how
 * wide the water runs, and which slabHalf() drew as a 5.8 m ribbon. The
 * trouble is that the ground either side of that channel stays BELOW
 * the water surface for a median of about 106 m: the island has broad
 * valley floors and we were painting a thread down the middle of them.
 * Over 598 sampled stations, 92.6% had their wetted reach cut off by
 * the EDGE OF THE SLAB rather than by the terrain, so the water looked
 * narrow because it was drawn narrow, not because Kauai is. Version 3
 * carries a half-width per side per station, walked outward on the real
 * ground until it rises through the level or falls away into somebody
 * else's basin, and this file draws that number. Median drawn width
 * 5.8 m becomes 49.8 m, p95 165 m, max 347 m. The terrain still clips
 * the final shoreline exactly as it always did; it simply gets the
 * chance to.
 *
 * ONE RULE, BOTH SIDES: drawn level = level * reliefScale(); wet iff
 * that beats groundHeight(); depth = the difference. `flow.ts`'s
 * waterLevelAt() answers from the same rows these slabs are built
 * from, so what is wet and what is blue are one thing by construction
 * rather than by two implementations staying in step.
 *
 * NO SPLINE. The bake's stations are one grid cell apart and already
 * follow the steepest descent of the ground they came from; smoothing
 * them would move the water off the valley floor it was derived from,
 * which is the exact fault this whole rebuild exists to remove.
 */

/**
 * How far the water GEOMETRY is worth building — the near field plus
 * margin for the crossfade.
 *
 * This dial has now been pushed both ways and both ends were wrong for
 * the same reason. At 200 m the water simply stopped existing while
 * the terrain drew to the horizon, and every approach from altitude
 * crossed dry-looking ground that turned into a river underneath her
 * — "some spots look like land, but suddenly turn into water when I
 * try to land on it." So it went to 2 km, the middle tier's reach —
 * and the middle tier's 31-metre triangles cannot clip a flat sheet,
 * so from two hundred metres up the island wore turquoise shards.
 * Measured at Joshua's own aerial fix: 99.7% of the 2,806 wet points
 * within draw range lay beyond the 200 m transition reach, median
 * 1,442 m out. Essentially everything on screen was the failure case,
 * and no slab tuning could touch it, because the ground out there is
 * not resolved BY DESIGN.
 *
 * The answer is not a better distance for the geometry — it is a
 * different OWNER past the distance where geometry can work. The slabs
 * now fade out across NEAR_WATER..FAR_WATER (150–250 m, inside the
 * transition tier, whose 3-metre vertices can still clip a channel),
 * and past that the terrain itself wears the water as paint from a
 * baked mask — see farWater.ts. The build box only needs to cover the
 * fade plus her own movement between decision cells.
 */
// SIZED TO OUTLAST THE DECISION CELL, which is the review catch that
// mattered here: follow() only rebuilds when she crosses a 50,000-unit
// cell, so between rebuilds she can stand up to 50,000 units from the
// spot the box was built around. A 40,000 box left the far edge of
// that walk with NO geometry inside the crossfade band — water missing
// right next to her, the one place the paint cannot cover. The box
// must reach cell travel plus FAR_WATER plus margin.
const REACH = 80_000;
const FADE_FROM = NEAR_WATER;
const FADE_TO = FAR_WATER;
/**
 * How much of the index's claim the slab draws.
 *
 * IT WAS 0.98, AND THE TWO PER CENT WAS A HOLE. `waterLevelAt` claims a
 * radius around each segment sized from halfAt, and the slab drew 98%
 * of it — so a two-per-cent rind of every stream on the island was
 * water the game would let her swim in with nothing drawn over it. The
 * shortfall used to be justified by an alpha fade that no longer works
 * that way: the fade comes from DEPTH now, and depth goes to nothing on
 * its own at the bank.
 *
 * Slightly OVER instead. Past the claim the ground has risen through
 * the level, so the depth expression is already negative there and the
 * fragments discard themselves — over-drawing costs nothing and cannot
 * put water on dry land, while under-drawing leaves a hole that no
 * amount of shading can fill.
 */
const EDGE = 1.02;

// THE BAKE OWNS THE LEVEL NOW. Version 1 stored the valley floor and
// this file lifted the surface half a channel depth off it (RIDE);
// version 2 stores the water-surface LEVEL itself, so the slab draws
// the file's number verbatim and nothing here invents an elevation.

/**
 * One pond cell's quad, exactly one grid cell wide.
 *
 * IT WAS 1.12 CELLS AND THE OVERLAP DREW ITSELF. Two coplanar
 * transparent quads double-blend where they overlap, so the fused
 * sheet came out with a dark lattice along every cell boundary — a
 * grid of seams across the whole Mana plain, photographed on the
 * first probe run. Exact fit needs no fusing: every cell of one pond
 * sits at the same spill level by construction (a basin fills to one
 * lip), so adjacent quads share edges and are one surface already.
 * The hairline float cracks exact fit risks are invisible against
 * terrain; the double-blend was not.
 */
/**
 * HOW DEEP THE WATER HAS TO BE BEFORE IT IS FULLY OPAQUE, and how
 * opaque that is.
 *
 * IT WAS FORTY-FIVE CENTIMETRES, and the median stream on this island
 * is fifty deep, so the ramp was spread across the entire depth range
 * the water has. Measured over the shipped island: the shallow rim —
 * water under 20 cm, which is 19% of the surface and the whole of what
 * you look at to see whether water reaches land — came out at a mean
 * alpha of 0.11. Clear glass. Joshua: "the edges of the water looks
 * almost clear, and in one spot, I don't see any water making it to
 * land, but I did land on water."
 *
 * Six centimetres puts that rim at 0.63 and the water as a whole at
 * 0.86, against 0.66 before. Short enough that water is water a few
 * body lengths from shore; long enough that the terrain clip still
 * happens under a fade the eye cannot follow, and that the discard
 * which keeps invisible water from writing depth still has something
 * to catch.
 */
export const EDGE_FADE = 6;
export const SURFACE_ALPHA = 0.92;

const POND_QUAD = SPAN / 1024;

/** Which way a lake's ripples travel. Any direction; one direction. */
const POND_DRIFT = { x: 0.8, z: 0.6 };

/** How many pond cells the ripple coordinate runs before it repeats. */
const TILES = 16;

interface Drawn { readonly mesh: THREE.Mesh; readonly cx: number; readonly cz: number; }

/**
 * HOW MANY VERTICES A SLAB GETS ACROSS ITS WIDTH.
 *
 * It was TWO — one per bank — and two is enough to place a flat sheet
 * but not to say how deep the water on it runs. A median slab is fifty
 * metres across and the ground under it is a valley floor, not a plane;
 * one straight line from bank to bank across fifty metres of Kauaʻi is
 * a guess.
 *
 * NINE, AND NOT MORE, BECAUSE THE HARD PART ISN'T INTERPOLATED. The
 * sharp feature under a slab is the trench, which is under eight metres
 * wide, and no spacing worth paying for resolves it: five across scored
 * 10.3% of the water drawn at zero alpha and thirty-three scored 9.6%.
 * The trench is ANALYTIC here (see build()); these vertices carry only
 * baseLand, the island with no channel in it, which is smooth at this
 * scale and interpolates honestly. Nine is a sample every six metres
 * across a median slab.
 */
const ACROSS = 9;

/**
 * HOW MANY ROWS OF THOSE VERTICES EACH STATION-TO-STATION SPAN GETS.
 *
 * Stations are one grid cell apart, about 55 m, and for four versions
 * that was the only spacing the water had ALONG its own length. Across
 * the slab the spacing was measured and argued about; along it, never
 * — and along it is where the error turned out to live. The ground
 * between two stations is 55 m of Kauaʻi and a straight line through it
 * misses whole banks. Per scripts/shaderDepth.ts, water drawn at zero
 * alpha and dry ground painted blue:
 *
 *     1     10.1%     36.0%
 *     2      8.0%     14.7%
 *     4      5.4%      5.7%
 *     8      3.5%      1.8%
 *
 * FOUR, NOT EIGHT, AND THE REASON IS THE PHONE. Every vertex costs a
 * baseLand(), which scripts/waterProfile.ts puts at 64% of a rebuild —
 * so the density here IS the cost, and nothing else in this file is
 * worth optimising ahead of it. Handing the far field to the terrain's
 * wet-mask paint shrank the build box from 2 km to 800 m and took most
 * of the bill with it: per scripts/waterCost.ts the busiest view is
 * now 20,691 vertices, 19 ms here and about 115 ms on a phone at six
 * times slower, paid once at load because follow() diffs its wanted
 * set; a decision cell of travel is 28 new reaches, about 30 ms on a
 * phone, once per five hundred metres. Eight rows would double that
 * for another 1.9% of the water, which is still not the trade.
 */
const ALONG = 4;

/** One reach as a strip of level slab, relative to (cx, 0, cz). */
export function buildReach(
  flow: Flow, first: number, count: number, cx: number, cz: number,
): THREE.BufferGeometry | null {
  if (count < 2) return null;
  const rows = (count - 1) * ALONG + 1;
  const positions = new Float32Array(rows * ACROSS * 3);
  // THE FOUR NUMBERS A FRAGMENT NEEDS TO KNOW HOW DEEP IT IS, as our
  // own attributes. `vUv` looked like the obvious carrier and is not
  // declared at all unless the material has a map — three.js gates it
  // behind USE_UV, the program failed to link, and every stream came
  // out untextured black. Ours are always there.
  //
  // `deep` is the trench's full depth here and `across`/`span` say
  // where in its profile the vertex sits; `rise` is how far the water
  // surface stands above the UNCUT island, which is the one of the four
  // that has to be sampled from the ground. build() has the formula
  // that puts them together.
  const deep = new Float32Array(rows * ACROSS);
  const across = new Float32Array(rows * ACROSS);
  const span = new Float32Array(rows * ACROSS);
  const rise = new Float32Array(rows * ACROSS);
  // AND TWO MORE, SO THE SURFACE CAN MOVE. `along` is how far
  // downstream this vertex is, in world units, measured up the reach
  // rather than guessed from a texture coordinate; `flowx`/`flowz` are
  // the unit direction the water is going there. The waves are a
  // travelling function of the first and lean along the second, so a
  // stream's ripples run DOWN it — which is the whole reason the water
  // needs to move at all rather than just shimmer.
  const along = new Float32Array(rows * ACROSS);
  const flowx = new Float32Array(rows * ACROSS);
  const flowz = new Float32Array(rows * ACROSS);
  let run_ = 0;
  for (let row = 0; row < rows; row++) {
    // Which station-to-station span this row falls in, and how far
    // along it. The last row is the final station exactly.
    const i = Math.min(count - 2, Math.floor(row / ALONG));
    const t = (row - i * ALONG) / ALONG;
    const p = first + i, q = p + 1;
    const at = (a: Int32Array | Uint16Array) => a[p] + (a[q] - a[p]) * t;
    const x = at(flow.x), z = at(flow.z);
    const back = first + Math.max(0, i - 1);
    const fore = first + Math.min(count - 1, i + 2);
    let dx = flow.x[fore] - flow.x[back];
    let dz = flow.z[fore] - flow.z[back];
    const run = Math.hypot(dx, dz);
    if (run < 1e-6) { dx = 1; dz = 0; } else { dx /= run; dz /= run; }
    // OVER-WIDE ON PURPOSE, AND ASYMMETRIC. The terrain clips the slab
    // back to the water the valley actually holds, and the same
    // halfAt() bounds the collision index's claim, so drawn and wet
    // share one edge. What is new is that the two sides no longer have
    // to agree. A stream sitting hard against one valley wall reaches a
    // couple of metres on the wall side and a couple of hundred across
    // the floor on the other, and drawing it that way is most of what
    // makes the widening read as a VALLEY rather than as a fat ribbon
    // laid over one: a single number for both sides would have to take
    // the smaller of the two to avoid painting the wall, which is how
    // we ended up drawing a thread in the first place. halfAt() falls
    // back to slabHalf() for any station the bake has not walked, and
    // floors every measured value at it, so this can only ever widen.
    //
    // COLLAPSED TO NOTHING WHERE A POND OWNS THE WATER. The bake tucks
    // a ponded station two units UNDER the spill level so the pond
    // sheet wins the depth test — level below bed, which is the flag,
    // and the only case that writes one. Winning the depth test was
    // not enough: the slab is TRANSPARENT, so it still drew first and
    // the pond blended over it, and its near-zero alpha (depth two
    // units, invisible over bare ground) came out as a darker band
    // across the lake. Joshua saw the band; drawing the two layers
    // separately proved the pond sheet alone was flawless and the slab
    // was the one adding it. A zero half-width makes every triangle in
    // the run degenerate, so the rasteriser discards them and the pond
    // is alone on those pixels — one owner, in geometry as well as in
    // level.
    //
    // The collapse is asked BEFORE the side, and answers for both: a
    // pond owning the water owns all of it, and a half-width that was
    // zero on one side only would leave the run a sliver rather than
    // degenerate, which is the same double-blend by a thinner name.
    // A span with a ponded station at EITHER end collapses whole: the
    // rows between them are the ones straddling the pond's edge.
    const owned = flow.level[p] < flow.bed[p] || flow.level[q] < flow.bed[q];
    const level = at(flow.level);
    // THE TRENCH PROFILE IS READ OFF THE STATION THE GROUND WAS CARVED
    // BY, which is the NEAREST one — flowAt picks a station, not a
    // blend, so blending its numbers here describes a trench nobody
    // dug. The surface level still interpolates: that is a water
    // surface and has to be continuous, and it is the one number the
    // bake stores per station rather than per cut.
    const near = t < 0.5 ? p : q;
    const full = flow.level[near] - flow.bed[near];
    const reach = cutHalf(flow.width[near]);
    // AND SO IS THE PERPENDICULAR. The vertices are laid out along a
    // SMOOTHED normal, because a strip that kinks at every station
    // opens wedges on the outside of every bend — but flowAt measures
    // its offset against the LOCAL segment, and at a forty-five degree
    // turn the two normals differ enough to put a vertex a third of
    // the way across the trench from where the ground thinks it is.
    // Measured: 99.3% of the vertices whose shaded depth disagreed
    // with terrainHeight were inside the trench, which is the only
    // place a wrong offset can cost a whole metre.
    //
    // So the vertex is PLACED with the smooth normal and MEASURED with
    // the true one. There is no conflict: where the vertex sits is a
    // question about geometry, and how deep it is is a question about
    // the cut.
    let sx = flow.x[q] - flow.x[p], sz = flow.z[q] - flow.z[p];
    const leg = Math.hypot(sx, sz);
    if (leg < 1e-6) { sx = dx; sz = dz; } else { sx /= leg; sz /= leg; }
    for (let k = 0; k < ACROSS; k++) {
      // -1 at the left bank, 0 on the centreline, +1 at the right.
      const u = (k / (ACROSS - 1)) * 2 - 1;
      const side = u < 0 ? -1 : 1;
      const half = owned ? 0
        : (halfAt(flow, p, side) + (halfAt(flow, q, side) - halfAt(flow, p, side)) * t) * EDGE;
      // MITRED, so the drawn edge is as far from the SEGMENT as the
      // collision index says the water reaches.
      //
      // The vertices are laid along a SMOOTHED normal — see above, it
      // is what stops the strip kinking at every station — but the
      // index measures its claim perpendicular to the LOCAL segment.
      // Offsetting by `half` along a normal that is φ off the true one
      // leaves a clearance of only half·cos(φ), and the gap is worst
      // exactly where a steepest-descent path turns hardest. Measured
      // before this line existed: 7.8% of the ground the game called
      // wet had no geometry over it at all, none of it pond-owned.
      // That is Joshua's "still water not showing in a deep part".
      //
      // Dividing by the cosine is the standard miter join, and it has
      // the standard problem: at a hairpin the cosine approaches zero
      // and the offset runs away. Capped at twice, which covers every
      // turn up to 120 degrees and lets anything sharper stay short
      // rather than fire a spike across the valley.
      const lean = Math.max(0.5, -dz * -sz + dx * sx);
      const off = half * u / lean;
      const wx = x + -dz * off, wz = z + dx * off;
      const v = row * ACROSS + k;
      positions[v * 3] = wx - cx;
      positions[v * 3 + 1] = level;
      positions[v * 3 + 2] = wz - cz;
      deep[v] = full;
      across[v] = (wx - x) * -sz + (wz - z) * sx;
      span[v] = reach;
      // THE ONLY THING HERE THAT HAS TO ASK THE GROUND, and it asks the
      // island the terrain is built from, at the exact point the vertex
      // sits. Negative where the bank has already risen through the
      // water: that is what takes the alpha to nothing at the shore
      // instead of leaving the terrain to hide a fully opaque sheet.
      rise[v] = level - baseLand(wx, wz);
      along[v] = run_;
      // The LOCAL segment again, for the same reason the offset uses
      // it: this is which way the water is actually going here.
      flowx[v] = sx;
      flowz[v] = sz;
    }
    // Arc length accumulates once per row, after the row is written,
    // so every vertex across a row shares its station's distance. The
    // wave crest is therefore straight across the channel and travels
    // down it, which is what a ripple on a stream does.
    if (row + 1 < rows) {
      const nx = flow.x[p] + (flow.x[q] - flow.x[p]) * ((row + 1 - i * ALONG) / ALONG);
      const nz = flow.z[p] + (flow.z[q] - flow.z[p]) * ((row + 1 - i * ALONG) / ALONG);
      run_ += Math.hypot(nx - x, nz - z);
    }
  }
  const faces: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let k = 0; k < ACROSS - 1; k++) {
      const a = i * ACROSS + k;
      const b = a + ACROSS;
      faces.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('deep', new THREE.Float32BufferAttribute(deep, 1));
  geometry.setAttribute('across', new THREE.Float32BufferAttribute(across, 1));
  geometry.setAttribute('span', new THREE.Float32BufferAttribute(span, 1));
  geometry.setAttribute('rise', new THREE.Float32BufferAttribute(rise, 1));
  geometry.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  geometry.setAttribute('flowx', new THREE.Float32BufferAttribute(flowx, 1));
  geometry.setAttribute('flowz', new THREE.Float32BufferAttribute(flowz, 1));
  geometry.setIndex(faces);
  // FLAT +Y NORMALS, written rather than computed: computeVertexNormals
  // shades each quad facet visibly through transparent water, and a
  // stream's real slope is metres over kilometres, which is flat.
  const normals = new Float32Array(rows * ACROSS * 3);
  for (let v = 0; v < rows * ACROSS; v++) normals[v * 3 + 1] = 1;
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

/** The listed pond cells as one batch of quads, relative to (cx, 0, cz). */
export function buildPonds(
  flow: Flow, cells: readonly number[], cx: number, cz: number,
): THREE.BufferGeometry {
  const half = POND_QUAD / 2;
  const positions = new Float32Array(cells.length * 4 * 3);
  // A POND IS FLAT, and the bake measured its depth for it. `rise` is
  // set to that same depth, and that ALONE fixes the answer: with rise
  // positive, waterDepth's `min(rise, 0)` is nought and its `max` picks
  // rise over anything the bank curve can return, because the curve
  // never exceeds one. So a pond is its measured depth corner to
  // corner whatever `across` and `span` say.
  //
  // Which frees `across` to do the other job it is asked for — half of
  // the ripple's texture coordinate. See build(); the reaches use the
  // real offset across the channel, and a pond, having no channel, uses
  // its own place on the island instead.
  const deep = new Float32Array(cells.length * 4);
  const across = new Float32Array(cells.length * 4);
  const span = new Float32Array(cells.length * 4).fill(1);
  const rise = new Float32Array(cells.length * 4);
  // A POND HAS NO DIRECTION, so it is given one — a fixed compass
  // bearing shared by every cell. Still water is not still at this
  // scale; it drifts on whatever the wind is doing, and one direction
  // across a whole lake reads as exactly that. What it must not do is
  // differ per cell, which would put a seam on every cell boundary.
  const along = new Float32Array(cells.length * 4);
  const flowx = new Float32Array(cells.length * 4).fill(POND_DRIFT.x);
  const flowz = new Float32Array(cells.length * 4).fill(POND_DRIFT.z);
  const normals = new Float32Array(cells.length * 4 * 3);
  const faces: number[] = [];
  for (let q = 0; q < cells.length; q++) {
    const i = cells[q];
    const x = flow.pondX[i] - cx;
    const z = flow.pondZ[i] - cz;
    // Which cell of the bake's grid this is. Non-negative before the
    // modulo, because a remainder of a negative number is negative and
    // would fold the ripple back on itself across the island's middle.
    const gi = Math.round((flow.pondX[i] + SPAN / 2) / POND_QUAD) + TILES * 4;
    const gj = Math.round((flow.pondZ[i] + SPAN / 2) / POND_QUAD) + TILES * 4;
    for (let corner = 0; corner < 4; corner++) {
      const v = q * 4 + corner;
      positions[v * 3] = x + (corner % 2 === 0 ? -half : half);
      positions[v * 3 + 1] = flow.pondLevel[i];
      positions[v * 3 + 2] = z + (corner < 2 ? -half : half);
      deep[v] = flow.pondDepth[i];
      rise[v] = flow.pondDepth[i];
      // WHERE ON THE ISLAND THIS CELL IS, WRAPPED SMALL.
      //
      // The ripple is a texture lookup, and a texture coordinate of
      // four million in float32 has a precision of a quarter of a
      // unit — coarse enough to quantise a 23-unit wavelet into
      // steps. So the coordinate is the cell's own GRID INDEX, taken
      // modulo TILES, which keeps it under a kilometre and is stable:
      // it depends on where the cell is, never on where the camera is
      // or when the sheet was last rebuilt. A batch-relative
      // coordinate would have been bounded too and would have jumped
      // the whole pattern every five hundred metres of travel.
      //
      // The pattern repeats every TILES cells, which is 875 m of lake.
      // Kauaʻi has no standing water that wide.
      across[v] = (gi % TILES) * POND_QUAD + (corner % 2 === 0 ? -half : half);
      along[v] = (gj % TILES) * POND_QUAD + (corner < 2 ? -half : half);
      normals[v * 3 + 1] = 1;
    }
    const a = q * 4;
    faces.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('deep', new THREE.Float32BufferAttribute(deep, 1));
  geometry.setAttribute('across', new THREE.Float32BufferAttribute(across, 1));
  geometry.setAttribute('span', new THREE.Float32BufferAttribute(span, 1));
  geometry.setAttribute('rise', new THREE.Float32BufferAttribute(rise, 1));
  geometry.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  geometry.setAttribute('flowx', new THREE.Float32BufferAttribute(flowx, 1));
  geometry.setAttribute('flowz', new THREE.Float32BufferAttribute(flowz, 1));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(faces);
  return geometry;
}


/**
 * THE STRING SURGERY, ON ITS OWN, WHERE A TEST CAN REACH IT.
 *
 * Everything below is `.replace` against three.js's own shader source,
 * and a replace that does not match is not an error — it is silence,
 * and the water comes back subtly wrong with nothing in the build to
 * say why. That has now happened twice: `vUv` was never declared, so
 * the program failed to link and every stream drew black; and a guard
 * spelt `USE_LOGDEPTHBUF` instead of `USE_LOGARITHMIC_DEPTH_BUFFER`
 * compiled perfectly and did nothing at all.
 *
 * Pulled out of onBeforeCompile so tests/waterDepth.test.ts can run it
 * against the real ShaderLib source and check that every injection
 * landed and every name it uses is declared.
 */
export function waterShader(
  vert: string, frag: string,
): { vertexShader: string; fragmentShader: string } {
  let vertexShader = vert;
  let fragmentShader = frag;
      const ins = ['deep', 'across', 'span', 'rise', 'along', 'flowx', 'flowz'];
      vertexShader =
        ins.map((a) => `attribute float ${a};`).join('\n') + '\n'
        + ins.map((a) => `varying float v_${a};`).join('\n') + '\n'
        + vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n'
          + ins.map((a) => `  v_${a} = ${a};`).join('\n')
          // The wave leans along the flow, and the fragment shades in
          // VIEW space, so the direction has to be carried there. Only
          // the vertex shader has normalMatrix.
          + '\n  vFlowView = normalize(normalMatrix * vec3(flowx, 0.0, flowz));');
      vertexShader = 'varying vec3 vFlowView;\n' + vertexShader;
      // AND THE DEPTH BIAS THE POLYGON OFFSET COULD NOT GIVE IT.
      //
      // Under a logarithmic depth buffer three.js writes
      //     gl_FragDepth = log2(vFragDepth) * logDepthBufFC * 0.5
      // so a constant subtracted here is a constant in LOG space,
      // which is a fixed RATIO in distance — the same relative lift a
      // centimetre from the eye and a kilometre away. That is exactly
      // the right shape for an island 56 km across seen by something a
      // centimetre long, and it is why the fixed-function offset,
      // which works in absolute depth units, was the wrong tool even
      // before it stopped being applied at all.
      //
      // Small enough to be invisible, and it has to be: this decides
      // depth ONLY, so a lift big enough to see would let the water
      // draw over a bank standing in front of it.
      fragmentShader = fragmentShader.replace(
        '#include <logdepthbuf_fragment>',
        [
          '#include <logdepthbuf_fragment>',
          // The macro is three.js's own, spelt exactly as r180 spells
          // it — a guard on a name that does not exist compiles
          // perfectly and does nothing, which is the same silent
          // nothing the polygon offset was doing. A test in
          // tests/waterDepth.test.ts holds this name to the chunk.
          '#ifdef USE_LOGARITHMIC_DEPTH_BUFFER',
          '  gl_FragDepth -= 3e-6;',
          '#endif',
        ].join('\n'));
      // LITTLE WAVES, TRAVELLING DOWNSTREAM.
      //
      // Nothing is displaced: the surface stays the flat level field
      // the whole game agrees on — she floats on it, waterLevelAt
      // answers from it, and moving the geometry would put the drawn
      // water somewhere the simulation is not, which is the fault three
      // versions of this file existed to remove. Only the NORMAL moves,
      // so the sun and the sky slide across the surface while the water
      // stays exactly where it was.
      //
      // FOUR SAMPLES OF ONE TEXTURE, at scales with no common factor,
      // each rotated by its own odd angle. Both of those are load-
      // bearing and both are Beyond Extinction's findings rather than
      // mine: harmonic scales beat into a moiré, and unrotated ones
      // stack their repeats into a visible grid. This shipped as two
      // travelling sines an hour ago, which is the shape BE already
      // tried and removed.
      //
      // The two finer octaves fade OUT with distance so far water
      // cannot alias into speckle, and the finest fades IN close up,
      // which is what stops the surface reading as flat when she is
      // standing in it.
      //
      // The coordinate is the channel's own: `across` the stream and
      // `along` it. So the drift runs DOWNSTREAM by construction, no
      // reach has to know which way north is, and the floating origin
      // cannot move it — which is the one thing sampling by world
      // position, as BE does, would not have survived here.
      fragmentShader = fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        {
          vec2 wp = vec2(v_across, v_along);
          float camD = length(vViewPosition);
          float far = 1.0 - smoothstep(${RIPPLE_FAR}.0 * 0.08, ${RIPPLE_FAR}.0, camD);
          float near = 1.0 - smoothstep(${RIPPLE_NEAR}.0 * 0.08, ${RIPPLE_NEAR}.0, camD);
          vec3 rn = vec3(0.0);
          rn += (texture2D(ripple, tmbSpin(0.0) * wp / 263.0
                 + clock * vec2(0.0021, -0.0080)).xyz - 0.5);
          rn += (texture2D(ripple, tmbSpin(2.1) * wp / 127.0
                 - clock * vec2(0.0037, 0.0125)).xyz - 0.5) * (0.8 * far);
          rn += (texture2D(ripple, tmbSpin(4.3) * wp / 59.0
                 + clock * vec2(0.0062, -0.0210)).xyz - 0.5) * (0.65 * far);
          rn += (texture2D(ripple, tmbSpin(1.2) * wp / 23.0
                 + clock * vec2(-0.0090, -0.0330)).xyz - 0.5) * (0.7 * near);
          // Into the surface's own frame. The geometry is flat +Y, so
          // \`normal\` is the up of that frame and vFlowView is its
          // downstream axis; their cross product is the third.
          // STRONGER, because the texture is the texture now. At 0.55
          // the octaves were a sheen under a specular blob; the blob
          // has gone and this is what is left to read the surface by.
          vec3 sideways = normalize(cross(normal, vFlowView));
          normal = normalize(normal + (rn.x * sideways + rn.y * vFlowView) * 1.15);
        }`);
      fragmentShader =
        'uniform float clock;\nuniform float relief;\n'
        + 'uniform sampler2D ripple;\n'
        + 'varying vec3 vFlowView;\n'
        + 'mat2 tmbSpin(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}\n'
        + ins.map((a) => `varying float v_${a};`).join('\n') + '\n'
        + BANK_GLSL + WATER_DEPTH_GLSL
        + fragmentShader.replace(
          '#include <color_fragment>', `#include <color_fragment>
        // THE DEPTH, EXACTLY — the same expression terrainHeight
        // arrives at, rearranged so a fragment can evaluate it.
        //
        // terrainHeight cuts the trench as
        //     cut = min(D*bank, max(0, land - bed)),  bed = level - D*bank
        // and the water over it stands level - (land - cut) deep. Take
        // that apart by cases and the whole of it collapses to the two
        // lines below: on a bank the trench profile carries the depth
        // and the ground above the waterline eats into it; on ground
        // already lower than the water, the ground wins outright.
        //
        // Which matters because the two halves want opposite things
        // from the geometry. \`rise\` is the island with no channel in
        // it and is smooth, so it interpolates across a fifty-metre
        // slab without complaint; the trench is under eight metres
        // wide and would need thirty-odd vertices per station to
        // interpolate at all, so it is computed instead. A build that
        // sampled only the finished ground left 6.1% of the island's
        // water invisible whatever density it was cut at.
        float depth = tmbWaterDepth(v_deep, v_across, v_span, v_rise) * relief;
        // GREEN OVER BLUE, but not three to one. That was the recipe
        // as given — "75% green, 25% blue" — and it came back "a
        // little too green and looks a little sick". It does: at 3:1
        // the hue lands near 150 degrees, which is the green of algae
        // rather than of water, and the sun on it makes that worse
        // rather than better.
        //
        // Nearer three to two instead, and more red in both tones.
        // Green stays the larger share — that was the instruction, and
        // it still reads as green rather than blue — but the hue moves
        // to 154 and 162 degrees, a shallow tropical teal, and the
        // saturation drops from 0.60 to 0.45. What is given up is the
        // strength of the green, not the green.
        //
        // AND THE RAMP RUNS OVER THE DEPTH THE WATER ACTUALLY HAS.
        // This was 0 to 250 units, and the trench is capped at 100, so
        // the deep tone was unreachable and every stream on the island
        // wore the shallow one at 20% strength. The whole palette was
        // being spent on the first tenth of its range.
        float deepness = smoothstep(0.0, 90.0, depth);
        diffuseColor.rgb = mix(vec3(0.13, 0.34, 0.25), vec3(0.020, 0.105, 0.080), deepness);
        // THE SHORELINE IS AN ALPHA RAMP, not an edge — but it was a
        // forty-five centimetre one, and that is the whole width of
        // most of the water on this island. Joshua: "the edges of the
        // water looks almost clear, and in one spot, I don't see any
        // water making it to land." Both halves of that are this line.
        // A stream a hand deep was drawn at a fifth of full opacity
        // along its entire width, so it never looked like it arrived
        // anywhere — it faded out before it got to the bank, and the
        // bank is exactly where you look to see whether water reaches
        // land.
        //
        // SIX CENTIMETRES. Long enough that the terrain clip happens
        // under a transparency the eye cannot follow, short enough
        // that water is water a few body lengths from shore. Past the
        // bank the depth goes NEGATIVE and this is already at zero, so
        // nothing is left for the depth test to have to hide.
        diffuseColor.a = mix(0.0, ${SURFACE_ALPHA}, smoothstep(0.0, ${EDGE_FADE}.0, depth));
        // Fade out where the channel stops being resolved, so the cut
        // is not a pop.
        // THE GEOMETRY'S HALF OF THE CROSSFADE — the exact complement
        // of the smoothstep the terrain's far-water paint fades in
        // with, on the same two constants, so at every eye distance
        // exactly one owner is at full strength.
        diffuseColor.a *= 1.0 - smoothstep(${FADE_FROM}.0, ${FADE_TO}.0, length(vViewPosition));
        // WATER NOBODY CAN SEE MUST NOT WRITE DEPTH. The material
        // writes depth so two overlapping sheets cannot blend twice,
        // and that is right — but a fragment whose alpha has ramped to
        // nothing at the shoreline was writing it too, and there it
        // sits within millimetres of the bank. Two surfaces that
        // close, both writing depth, is the speckle along a waterline.
        // Dropping the invisible ones costs nothing that was ever
        // drawn and takes the whole quarrel off the table.
        if (diffuseColor.a < 0.004) discard;
      `);
  return { vertexShader, fragmentShader };
}

/**
 * THE RIPPLE MAP, AND WHY IT IS BORROWED.
 *
 * Beyond Extinction solved this surface already, and its shader comment
 * carries the finding that matters: a sum of cosine wavelets "beat into
 * a hard diamond grid/moiré (playtest); removed". The version of this
 * file that shipped an hour ago is that same idea — two travelling
 * sines — and it was on its way to the same grid. What replaced it
 * there is a tiling normal map sampled at several NON-HARMONIC scales,
 * each rotated by its own odd angle so the repeats never line up, and
 * that is what is used here.
 *
 * The texture is Beyond Extinction's water_normal.png, unchanged. The
 * scales are not: that ocean is measured in metres and this island in
 * centimetres, and a queen is one unit long, so its 17 m swell would be
 * a wave seventeen hundred times her length.
 */
const RIPPLE_URL = 'water-normal.png';

/** The plan's name for the ripple map's download. */
export const RIPPLE_JOB = 'ripple';

/**
 * Declare the ripple map on a plan, before it starts.
 *
 * IT IS 206 KB AND THE LOADING SCREEN HAS TO KNOW. A download the plan
 * has never heard of does not make the bar wrong — it makes it lie by
 * omission, finishing while two hundred kilobytes are still in flight,
 * which is the exact complaint the plan was built to answer.
 */
export function planRipple(report: LoadReport): void {
  const baked = assetBytes(RIPPLE_URL);
  report.add(RIPPLE_JOB, 'The water', baked ?? 206_000, true, baked !== null);
}

/** Distances over which the finer ripples give way, in world units. */
const RIPPLE_FAR = 40_000;
const RIPPLE_NEAR = 600;

export class FlowWater {
  private readonly drawn = new Map<number, Drawn>();
  private ponds: Drawn | null = null;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly clock = { value: 0 };
  private readonly ripple: { value: THREE.Texture };
  private lastCell = '';
  private shownAll = true;

  /**
   * NO COPY OF THE GROUND LIVES HERE ANY MORE.
   *
   * There used to be one: a DataTexture of the height grid, so the
   * fragment could ask how far the bed lay below it. Depth is a
   * property of WHERE the fragment is rather than of which slab
   * painted it, and that much was right — but the island had five
   * separate descriptions of its own surface by then (the raw grid,
   * the blurred grid, terrainHeight's carve, farHeight's coarse
   * answer, and this texture), and every water bug of the last four
   * releases was two of them disagreeing. This one disagreed worst:
   * the trench is cut at RUNTIME, so a texture built from the grid
   * has no trench in it, and the shader was asked how deep the water
   * stood over ground nobody had dug.
   *
   * The depth now comes from the trench's own profile, evaluated per
   * pixel from the same function that cuts it — see build(). That
   * removes a description of the island rather than adding a sixth.
   */

  constructor(
    private readonly scene: THREE.Scene,
    report?: LoadReport,
  ) {
    // FLAT UNTIL IT ARRIVES. 128,128,255 is the normal map that says
    // "no bump at all", so the water is a calm sheet for the first
    // second and then starts moving. Handing the material no texture
    // until the load resolves would recompile the shader mid-scene.
    const flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    flat.needsUpdate = true;
    this.ripple = { value: flat };
    this.material = this.build();
    // PULLED AS BYTES FIRST, exactly as the band maps are, so the
    // loading screen counts this one too rather than finishing while
    // it is still in flight.
    void pullBytes(
      `${import.meta.env.BASE_URL}${RIPPLE_URL}`,
      (size) => report?.resize(RIPPLE_JOB, size),
      (got) => report?.advance(RIPPLE_JOB, got),
    ).then((pull) => new THREE.TextureLoader().load(
      pull.url,
      (tex) => {
        // NOT sRGB: these are vectors, not colours, and decoding them
        // through a gamma curve bends every one of them.
        tex.colorSpace = THREE.NoColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.needsUpdate = true;
        this.ripple.value = tex;
        URL.revokeObjectURL(pull.url);
        report?.finish(RIPPLE_JOB);
      },
      undefined,
      () => {
        URL.revokeObjectURL(pull.url);
        report?.finish(RIPPLE_JOB);
      },
    )).catch((why) => {
      // Water that will not ripple is still water. A loading screen
      // that never lifts is not.
      console.warn('the water ripple map did not load', why);
      report?.finish(RIPPLE_JOB);
    });
  }

  /** Drawn reaches, plus one for the pond sheet when it exists. */
  get shown(): number { return this.drawn.size + (this.ponds ? 1 : 0); }

  setVisible(on: boolean): void {
    this.shownAll = on;
    for (const d of this.drawn.values()) d.mesh.visible = on;
    if (this.ponds) this.ponds.mesh.visible = on;
  }

  /**
   * SHOW ONE KIND OF WATER AT A TIME — for telling them apart.
   *
   * Reach slabs and pond sheets can both put blue on a pixel and a
   * screenshot cannot say which did. Drawing them one at a time answers
   * in two frames what an afternoon of reasoning about depth precision
   * does not.
   */
  setLayer(which: 'reaches' | 'ponds', on: boolean): void {
    if (which === 'reaches') {
      for (const d of this.drawn.values()) d.mesh.visible = on;
    } else if (this.ponds) {
      this.ponds.mesh.visible = on;
    }
  }

  private build(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      // ROUGH AND DIM, because the first version came back nearly
      // white. A smooth standard material under the island's sun blows
      // out to a pale sheet at every angle, which reads as plastic
      // rather than as water; the colour work below then has nothing
      // left to say.
      color: 0x1d4a5c, transparent: true, opacity: 0.72,
      // BACK UP AGAIN, because 0.34 bought a mirror. It was dropped
      // there when the ripple was two sine waves and needed gloss to
      // show at all; with a normal map doing the work the gloss is not
      // paying for anything, and what it buys instead is one enormous
      // white specular blob sitting on the middle of every stream.
      // Joshua: "water too shiny with not much texture" — those are
      // the same sentence. The blob IS the missing texture, because a
      // near-mirror returns the sun as a single lobe and everything
      // outside that lobe as flat dark.
      //
      // 0.58 spreads the sun across the whole surface, so the ripples
      // shade instead of one of them flaring.
      roughness: 0.58, metalness: 0.0,
      // ONE WATER OWNER PER PIXEL. The water writes depth, so where two
      // transparent sheets overlap — a tributary's slab across its
      // trunk's at every junction, the strip folding at a sharp bend,
      // two ponds meeting — the first surface wins and the second is
      // z-rejected instead of blending again. Joshua photographed what
      // depthWrite:false does at this scale: every overlap painted
      // itself twice, darker, with a straight polygon edge, and the
      // island's water read as shards instead of one body.
      depthWrite: true,
      // Both faces, because the underwater pass to come looks at this
      // surface from below.
      side: THREE.DoubleSide,
    });
    // THE POLYGON OFFSET THAT USED TO BE HERE NEVER DID ANYTHING.
    //
    // Water lies close over its own bed for its whole length — at the
    // shoreline the two surfaces are millimetres apart — so it was
    // given polygonOffsetUnits -8 to lift its fragments toward the eye
    // and stop the bed freckling through. But the renderer runs with
    // logarithmicDepthBuffer, and that makes every fragment shader
    // WRITE gl_FragDepth. Polygon offset is applied by the rasteriser
    // to the depth it interpolated; a shader that writes its own depth
    // replaces that value outright, offset and all. So the lift was
    // silently discarded for as long as both settings have been on,
    // and Joshua is watching the water and the land fight over the
    // same pixels.
    //
    // The bias has to be applied where the depth is actually decided,
    // which is in the shader below. Nothing is set here, so nothing
    // reads as though it were handled.
    // DEPTH IS THE ONLY THING THIS SHADER NEEDS AND IT TOOK FOUR
    // SHIPPED VERSIONS TO GET IT FROM THE RIGHT PLACE.
    //
    // First it rode the geometry: one baked level-minus-bed per slab.
    // Every sheet came out its own flat tone with a straight polygon
    // edge at every ownership boundary — the island wearing shards.
    //
    // Then it came from a ground-height TEXTURE, which is right in
    // principle (depth belongs to WHERE the fragment is, not to which
    // slab painted it) and wrong three times over in fact. The texture
    // was the RAW grid where the terrain is the BLURRED one: 8.07 m
    // out on average, wet-or-dry disagreeing on 28.7% of the water.
    // Blending it as baseLand does fixed that and left the real fault
    // standing: the trench is cut at RUNTIME and no grid has one in
    // it, so the shader was asked how deep the water stood over ground
    // nobody had dug. Measured on the shipped build — mean depth
    // -0.11 m against the 0.90 m the game actually had, and 66.6% of
    // the island's water drawn at zero alpha. Joshua, for three
    // versions running: the water is there and you cannot see it. Nor
    // could any texture have saved it. 1025 samples over 56 km is one
    // texel every 54.7 m, and a twelve-metre channel is a quarter of a
    // texel.
    //
    // Then the trench's own profile, evaluated per pixel from the
    // curve carve.ts digs with. That fixed the invisible water — down
    // to 1.6% — and broke the other half, because a curve knows the
    // channel but not the ground either side of it: depth overstated
    // by 54% and 74.6% of the DRY ground under a slab painted blue.
    //
    // What all four have in common is that the water was shaded from a
    // SECOND description of the island, and a second description
    // drifts. So now there is one. The fragment evaluates the depth
    // terrainHeight itself arrives at, derived in carve.ts's
    // waterDepth() and shared with the shader verbatim: the trench
    // half is computed from the same curve that cuts it, and the
    // ground half is one baseLand() sample per vertex. Against the
    // game's own 0.50 m mean it now reads 0.49 m, with 4.6% at zero
    // alpha and 6.6% of dry ground painted. tests/waterDepth.test.ts
    // holds all three of those numbers to the shipped island, and
    // tests/carve.test.ts holds this GLSL to its JavaScript twin.
    material.onBeforeCompile = (shader) => {
      shader.uniforms.clock = this.clock;
      shader.uniforms.relief = reliefUniform;
      shader.uniforms.ripple = this.ripple;
      const patched = waterShader(shader.vertexShader, shader.fragmentShader);
      shader.vertexShader = patched.vertexShader;
      shader.fragmentShader = patched.fragmentShader;
    };
    return material;
  }

  update(dt: number): void { this.clock.value += dt; }

  /** Bring the nearby water into being and let the far water go. */
  follow(at: { wx: number; wz: number }): void {
    const flow = flowData();
    if (!flow) return;
    const cell = `${Math.round(at.wx / 50_000)}:${Math.round(at.wz / 50_000)}`;
    if (cell === this.lastCell) { this.place(); return; }
    this.lastCell = cell;

    const wanted = new Set<number>();
    for (let r = 0; r < flow.reaches.length; r++) {
      const reach = flow.reaches[r];
      for (let i = 0; i < reach.count; i += 4) {
        const p = reach.first + i;
        if (Math.abs(flow.x[p] - at.wx) < REACH && Math.abs(flow.z[p] - at.wz) < REACH) {
          wanted.add(r); break;
        }
      }
    }
    for (const [index, reach] of this.drawn) {
      if (wanted.has(index)) continue;
      this.scene.remove(reach.mesh);
      reach.mesh.geometry.dispose();
      this.drawn.delete(index);
    }
    for (const index of wanted) {
      if (this.drawn.has(index)) continue;
      const { first, count } = flow.reaches[index];
      let cx = 0, cz = 0;
      for (let i = 0; i < count; i++) { cx += flow.x[first + i]; cz += flow.z[first + i]; }
      cx /= count; cz /= count;
      const geometry = buildReach(flow, first, count, cx, cz);
      if (!geometry) continue;
      this.drawn.set(index, { mesh: this.show(geometry), cx, cz });
    }
    this.followPonds(flow, at);
    this.place();
  }

  /**
   * THE POND SHEET IS REBUILT WHOLE, not diffed. The decision cell
   * changes every 50,000 units of travel and the visibility box holds
   * at most a few dozen cells, so one batch geometry per rebuild is
   * cheaper than the bookkeeping that would avoid it.
   */
  private followPonds(flow: Flow, at: { wx: number; wz: number }): void {
    if (this.ponds) {
      this.scene.remove(this.ponds.mesh);
      this.ponds.mesh.geometry.dispose();
      this.ponds = null;
    }
    const cells: number[] = [];
    let cx = 0, cz = 0;
    for (let i = 0; i < flow.pondX.length; i++) {
      if (Math.abs(flow.pondX[i] - at.wx) < REACH && Math.abs(flow.pondZ[i] - at.wz) < REACH) {
        cells.push(i); cx += flow.pondX[i]; cz += flow.pondZ[i];
      }
    }
    if (cells.length === 0) return;
    cx /= cells.length; cz /= cells.length;
    this.ponds = { mesh: this.show(buildPonds(flow, cells, cx, cz)), cx, cz };
  }

  private show(geometry: THREE.BufferGeometry): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.renderOrder = 1;
    mesh.visible = this.shownAll;
    this.scene.add(mesh);
    return mesh;
  }

  /** Re-seat against the floating origin and the relief dial. */
  place(): void {
    const relief = reliefScale();
    for (const d of this.drawn.values()) this.seat(d, relief);
    if (this.ponds) this.seat(this.ponds, relief);
  }

  private seat(d: Drawn, relief: number): void {
    const at = toLocal({ wx: d.cx, wz: d.cz });
    d.mesh.position.set(at.lx, 0, at.lz);
    // Levels are stored at relief 1; the dial is applied here, the same
    // scale groundHeight() applies, so slab and terrain move as one.
    d.mesh.scale.y = relief;
  }

  dispose(): void {
    for (const d of this.drawn.values()) {
      this.scene.remove(d.mesh);
      d.mesh.geometry.dispose();
    }
    this.drawn.clear();
    if (this.ponds) {
      this.scene.remove(this.ponds.mesh);
      this.ponds.mesh.geometry.dispose();
      this.ponds = null;
    }
    this.material.dispose();
  }
}
