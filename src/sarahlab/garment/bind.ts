/**
 * BINDING THE GARMENT TO HER: where on her skin every cloth particle sits at rest.
 *
 * The garment is laid round her in her REST space (`place.ts`, metres). The cloth simulation (`clothSkin.ts`) does not
 * keep those positions: it keeps, per particle, a spot of her skin -- a triangle by its three vertex indices, barycentric
 * weights on it -- and how far the particle stands off it along that triangle's outward face normal, in her GEOMETRY
 * units (`ClothBinding`). So `ClothSkin.restShape` lays particle i at `u*A + v*B + w*C + offset * n`. This module finds
 * that spot: the nearest point of her (restricted by region) to each particle.
 *
 * How:
 * - A uniform grid per region (trunk, arm), each over its own triangles' bounding boxes in metres (2 cm cells, coarser
 *   only if the grid would be huge), in compressed rows, so a search never wades through the other region's triangles.
 *   A particle searches rings of cells round its own, outward, each ring's cells nearest first; a cell, and then a
 *   triangle's bounding box, farther than the best found so far is skipped; and it stops once the best is nearer than
 *   anything outside the rings searched could be -- so the answer is the exact nearest, not a guess. Her body (208,592
 *   triangles) and 10,000 particles: about 0.3 s in node, a fifth of it building the grids.
 * - The closest point on a triangle is Ericson's region test (Real-Time Collision Detection 5.1.5), as `clothSkin.ts`
 *   measures it, every division guarded so a sliver answers with a point.
 * - REGION: a triangle is her ARM when two or more of its corners have `arm >= 0.5`, else her TRUNK. A trunk particle
 *   binds only to trunk triangles, an arm particle only to arm ones, 'any' to either. (A region with no triangles at all
 *   falls back to all of her rather than leave a particle unbound.) This is the same rule ClothSkin uses for its floor:
 *   between her side and a hanging arm a trunk particle must not take the arm as its skin.
 * - OUT is decided once for the whole mesh, as ClothSkin decides it (`restSign`): the face normals' agreement with the
 *   vertex normals when those are given, summed over every triangle; without them counter-clockwise faces are taken to
 *   point outward. A particle's signed distance is its distance to its BOUND triangle, + when it is outside her: on the
 *   outward side of the nearest triangle of EITHER region. For an 'any' particle that is its own triangle; for a trunk
 *   particle beside her arm it is the arm's, so one whose nearest trunk point is the edge where her trunk meets her arm
 *   is not called inside because that edge's plane is behind it.
 * - Ties (a particle equally near two triangles, as across an edge or a corner) go to the triangle whose face normal the
 *   particle lies most squarely along, so the sign of a particle off a convex edge is read from the face that faces it.
 *   Search order is fixed, so the result is deterministic.
 *
 * Plain TypeScript: no three.js, no DOM.
 */
import type { ClothBinding } from '../clothTypes';

export type BindRegion = 'trunk' | 'arm' | 'any';
/** The per-particle region codes `bindParticles` reads. */
export const BIND_TRUNK = 0;
export const BIND_ARM = 1;
export const BIND_ANY = 2;
/** A region's code. */
export function bindRegionCode(region: BindRegion): number {
  return region === 'trunk' ? BIND_TRUNK : region === 'arm' ? BIND_ARM : BIND_ANY;
}

export interface BindOptions {
  /** rest metres -> geometry units: geom = (rest - offset) / scale (Sarah: scale 0.89974678, offset [0, 0.8002533, -0.0340415]; see FACE_REST_SCALE/OFFSET in src/sarahlab/faceRig.ts). */
  readonly scale: number;
  /** Only `scale` changes a LENGTH; the offset is accepted so the conversion is named whole. */
  readonly offset: readonly [number, number, number];
  /** Offsets are clamped to [minOffset, maxOffset] metres before conversion (defaults 0.002 and 0.06). */
  readonly minOffset?: number;
  readonly maxOffset?: number;
}

export interface BindBody {
  /** Rest positions, metres, 3 per vertex. */
  readonly positions: Float32Array;
  /** Triangles, 3 vertex indices each. */
  readonly triangles: Uint32Array;
  /** Per vertex, 0..1: how much her arm bones carry it. */
  readonly arm: Float32Array;
  /** Optional per-vertex rest normals (unit), used only to decide which way her triangles face. */
  readonly normals?: Float32Array;
}

export type GarmentBinding = ClothBinding & {
  /** Per particle: signed distance to its bound triangle, metres, + on the outward side (unclamped). */
  readonly distance: Float32Array;
};

export const BIND_MIN_OFFSET = 0.002;
export const BIND_MAX_OFFSET = 0.06;
/** The grid's cell, metres (grown only when the grid would exceed BIND_MAX_CELLS). */
export const BIND_CELL = 0.02;
const BIND_MAX_CELLS = 4_000_000;
const KIND_TRUNK = 1, KIND_ARM = 2;
/** Two squared distances within this (relative) are a tie. */
const TIE = 1e-9;

/**
 * Bind every particle to the nearest body triangle of its region.
 *
 * positions: the body's rest positions in metres (3 per vertex); triangles: body triangles; arm: per-vertex arm weight
 * 0..1 (a triangle is ARM when >= 2 corners have arm >= 0.5, else TRUNK); normals: optional per-vertex rest normals
 * (metres space, unit) used only to decide which way the triangles face; particles: n x 3 rest metres; region per
 * particle (0 trunk, 1 arm, 2 any).
 */
export function bindParticles(body: BindBody, particles: Float32Array, region: Uint8Array, options: BindOptions): GarmentBinding {
  const P = body.positions, T = body.triangles, arm = body.arm, N = body.normals;
  const nV = Math.floor(P.length / 3), nT = Math.floor(T.length / 3), n = Math.floor(particles.length / 3);
  const scale = options.scale, minOff = options.minOffset ?? BIND_MIN_OFFSET, maxOff = options.maxOffset ?? BIND_MAX_OFFSET;
  if (!(scale > 0) || !Number.isFinite(scale)) throw new RangeError(`bindParticles: scale must be a positive number (got ${scale})`);
  if (!(minOff <= maxOff)) throw new RangeError(`bindParticles: minOffset ${minOff} is above maxOffset ${maxOff}`);
  if (region.length < n) throw new RangeError(`bindParticles: ${region.length} regions for ${n} particles`);
  if (arm.length < nV) throw new RangeError(`bindParticles: ${arm.length} arm weights for ${nV} vertices`);
  if (N && N.length < nV * 3) throw new RangeError(`bindParticles: ${N.length / 3} normals for ${nV} vertices`);
  if (n > 0 && nT === 0) throw new RangeError('bindParticles: the body has no triangles');
  for (let k = 0; k < nT * 3; k++) if (T[k] >= nV) throw new RangeError(`bindParticles: triangle ${Math.floor(k / 3)} names vertex ${T[k]} of ${nV}`);

  // --- each triangle's region, and which way the mesh faces ---
  const kind = new Uint8Array(nT);
  let vote = 0;
  for (let t = 0; t < nT; t++) {
    const i = T[t * 3], j = T[t * 3 + 1], k = T[t * 3 + 2];
    const armCorners = (arm[i] >= 0.5 ? 1 : 0) + (arm[j] >= 0.5 ? 1 : 0) + (arm[k] >= 0.5 ? 1 : 0);
    kind[t] = armCorners >= 2 ? KIND_ARM : KIND_TRUNK;
    if (N) {
      const a = i * 3, b = j * 3, c = k * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const d = cx * (N[a] + N[b] + N[c]) + cy * (N[a + 1] + N[b + 1] + N[c + 1]) + cz * (N[a + 2] + N[b + 2] + N[c + 2]);
      if (Number.isFinite(d)) vote += d;
    }
  }
  const outSign = vote < 0 ? -1 : 1;

  // --- one grid per region, each over its own triangles' bounding boxes ---
  const trunkIds: number[] = [], armIds: number[] = [];
  for (let t = 0; t < nT; t++) (kind[t] === KIND_ARM ? armIds : trunkIds).push(t);
  const trunkGrid = buildGrid(P, T, trunkIds), armGrid = buildGrid(P, T, armIds);

  // --- the closest point on triangle t to (px, py, pz): squared distance; point in qx/qy/qz, weights on corners 1, 2 in qv/qw ---
  let qx = 0, qy = 0, qz = 0, qv = 0, qw = 0;
  const closest = (t: number, px: number, py: number, pz: number): number => {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const ax = P[a], ay = P[a + 1], az = P[a + 2];
    const abx = P[b] - ax, aby = P[b + 1] - ay, abz = P[b + 2] - az;
    const acx = P[c] - ax, acy = P[c + 1] - ay, acz = P[c + 2] - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    let v = 0, w = 0;
    if (d1 <= 0 && d2 <= 0) { /* corner 0 */ }
    else {
      const bpx = px - P[b], bpy = py - P[b + 1], bpz = pz - P[b + 2];
      const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) v = 1;
      else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) { const den = d1 - d3; v = den > 0 ? d1 / den : 0; }
        else {
          const cpx = px - P[c], cpy = py - P[c + 1], cpz = pz - P[c + 2];
          const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
          if (d6 >= 0 && d5 <= d6) w = 1;
          else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) { const den = d2 - d6; w = den > 0 ? d2 / den : 0; }
            else {
              const va = d3 * d6 - d5 * d4, e1 = d4 - d3, e2 = d5 - d6;
              if (va <= 0 && e1 >= 0 && e2 >= 0) { const den = e1 + e2, s = den > 0 ? e1 / den : 0; v = 1 - s; w = s; }
              else {
                const sum = va + vb + vc;
                if (sum > 0) { v = vb / sum; w = vc / sum; }
              }
            }
          }
        }
      }
    }
    qv = v; qw = w;
    qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
    const dx = px - qx, dy = py - qy, dz = pz - qz;
    return dx * dx + dy * dy + dz * dz;
  };
  // triangle t's outward unit normal into nx/ny/nz (zero for a triangle with no area)
  let nx = 0, ny = 0, nz = 0;
  const normalOf = (t: number): void => {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (!(len > 0)) { nx = ny = nz = 0; return; }
    const s = outSign / len; nx = cx * s; ny = cy * s; nz = cz * s;
  };

  // --- the search: rings of cells outward until the nearest is certain ---
  // The running best of one search (squared distance, triangle, weights on corners 1 and 2, point, alignment), so a
  // second grid can carry on from where the first left off.
  let sD = Infinity, sT = -1, sV = 0, sW = 0, sQx = 0, sQy = 0, sQz = 0, sAlign = -1;
  // alignment: how squarely (px, py, pz) lies along triangle t's normal from (x, y, z), its closest point there (1 on the
  // face's axis, 0 along its plane); only ever needed to break a tie, so the best's is measured when one comes (-1: not yet)
  const alignOf = (t: number, px: number, py: number, pz: number, x: number, y: number, z: number): number => {
    normalOf(t);
    const ex = px - x, ey = py - y, ez = pz - z, d = ex * ex + ey * ey + ez * ez, dt = ex * nx + ey * ny + ez * nz;
    return d > 0 ? (dt * dt) / d : 1;
  };
  const stamp = new Uint32Array(nT);
  let query = 0;
  let ringCell = new Int32Array(256), ringGap = new Float64Array(256);
  const search = (g: Grid, px: number, py: number, pz: number): void => {
    if (g.count === 0) return;
    // nothing in this grid is nearer than its box
    const bx = Math.max(g.minX - px, 0, px - g.maxX), by = Math.max(g.minY - py, 0, py - g.maxY), bz = Math.max(g.minZ - pz, 0, pz - g.maxZ);
    const box = Math.sqrt(bx * bx + by * by + bz * bz);
    if (box * box * (1 - TIE) > sD) return;
    query++;
    if (query === 0xffffffff) { stamp.fill(0); query = 1; }
    const q = query, { gx, gy, gz, cell, start, tris, boxes, minX, minY, minZ } = g, gxy = gx * gy;
    // the running best, in locals for the hot loop (written back at the end); `tie` is the squared distance a candidate
    // must not exceed to count, kept in step with `best`
    let best = sD, bT = sT, bV = sV, bW = sW, bQx = sQx, bQy = sQy, bQz = sQz, bAlign = sAlign;
    let tie = best * (1 + TIE) + 1e-30;
    // a cell's distance from the particle along each axis is measured against the cell padded by this, so float
    // rounding never prunes a cell that holds the nearest triangle
    const pad = cell * 1e-6;
    const cx = cellOf(px, minX, cell, gx), cy = cellOf(py, minY, cell, gy), cz = cellOf(pz, minZ, cell, gz);
    let rc = ringCell, rg = ringGap;
    for (let r = 0; ; r++) {
      // the shell of occupied cells at Chebyshev distance r, clipped to the grid, gathered nearest first so the best
      // tightens early and the rest of the ring is mostly pruned whole
      let ringN = 0;
      for (let dz = -r; dz <= r; dz++) {
        const z = cz + dz; if (z < 0 || z >= gz) continue;
        const zlo = minZ + z * cell - pad, zhi = zlo + cell + 2 * pad, gzd = pz < zlo ? zlo - pz : pz > zhi ? pz - zhi : 0, z2 = gzd * gzd;
        if (z2 > tie) continue;
        const zFace = dz === -r || dz === r;
        for (let dy = -r; dy <= r; dy++) {
          const y = cy + dy; if (y < 0 || y >= gy) continue;
          const ylo = minY + y * cell - pad, yhi = ylo + cell + 2 * pad, gyd = py < ylo ? ylo - py : py > yhi ? py - yhi : 0, yz2 = z2 + gyd * gyd;
          if (yz2 > tie) continue;
          const row = z * gxy + y * gx, full = zFace || dy === -r || dy === r;
          const x0 = full ? Math.max(0, cx - r) : cx - r, x1 = full ? Math.min(gx - 1, cx + r) : cx + r, step = full || r === 0 ? 1 : 2 * r;
          for (let x = x0; x <= x1; x += step) {
            if (x < 0 || x >= gx) continue;
            const c = row + x;
            if (start[c] === start[c + 1]) continue;
            const xlo = minX + x * cell - pad, xhi = xlo + cell + 2 * pad, gxd = px < xlo ? xlo - px : px > xhi ? px - xhi : 0, d = yz2 + gxd * gxd;
            if (d > tie) continue;
            if (ringN === rc.length) {
              const nc = new Int32Array(ringN * 2), ng = new Float64Array(ringN * 2); nc.set(rc); ng.set(rg); rc = ringCell = nc; rg = ringGap = ng;
            }
            let j = ringN++;
            while (j > 0 && rg[j - 1] > d) { rc[j] = rc[j - 1]; rg[j] = rg[j - 1]; j--; }
            rc[j] = c; rg[j] = d;
          }
        }
      }
      for (let j = 0; j < ringN; j++) {
        if (rg[j] > tie) break;
        const c = rc[j];
        for (let k = start[c], e = start[c + 1]; k < e; k++) {
          // a triangle whose box is farther than the best already found cannot be nearer (its box is stored beside its
          // entry, so the scan of a cell reads memory in order)
          const o = k * 6;
          const lx = boxes[o] - px, hx = px - boxes[o + 3], ex = lx > 0 ? lx : hx > 0 ? hx : 0;
          const ly = boxes[o + 1] - py, hy = py - boxes[o + 4], ey = ly > 0 ? ly : hy > 0 ? hy : 0;
          const lz = boxes[o + 2] - pz, hz = pz - boxes[o + 5], ez = lz > 0 ? lz : hz > 0 ? hz : 0;
          if (ex * ex + ey * ey + ez * ez > tie) continue;
          const t = tris[k];
          if (stamp[t] === q) continue;
          stamp[t] = q;
          const d = closest(t, px, py, pz);
          if (d > tie) continue;
          if (d < best * (1 - TIE) - 1e-30) {
            best = d; bT = t; bV = qv; bW = qw; bQx = qx; bQy = qy; bQz = qz; bAlign = -1;
            tie = best * (1 + TIE) + 1e-30;
            continue;
          }
          // a tie: the face the particle lies most squarely along wins
          const x = qx, y = qy, z = qz, v = qv, w = qw;
          if (bAlign < 0) bAlign = alignOf(bT, px, py, pz, bQx, bQy, bQz);
          const align = alignOf(t, px, py, pz, x, y, z);
          if (align > bAlign) {
            if (d < best) { best = d; tie = best * (1 + TIE) + 1e-30; }
            bT = t; bV = v; bW = w; bQx = x; bQy = y; bQz = z; bAlign = align;
          }
        }
      }
      // the nearest anything outside the searched block could be: beyond one of its open faces, and inside the box
      let face = Infinity;
      if (cx - r > 0) face = Math.min(face, px - (minX + (cx - r) * cell));
      if (cx + r < gx - 1) face = Math.min(face, minX + (cx + r + 1) * cell - px);
      if (cy - r > 0) face = Math.min(face, py - (minY + (cy - r) * cell));
      if (cy + r < gy - 1) face = Math.min(face, minY + (cy + r + 1) * cell - py);
      if (cz - r > 0) face = Math.min(face, pz - (minZ + (cz - r) * cell));
      if (cz + r < gz - 1) face = Math.min(face, minZ + (cz + r + 1) * cell - pz);
      if (face === Infinity) break; // the whole grid is searched
      const bound = Math.max(face, box);
      if (bound > 0 && best < bound * bound * (1 - TIE)) break;
    }
    sD = best; sT = bT; sV = bV; sW = bW; sQx = bQx; sQy = bQy; sQz = bQz; sAlign = bAlign;
  };

  // --- each particle ---
  const tri = new Uint32Array(n * 3), bary = new Float32Array(n * 3), offset = new Float32Array(n), distance = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const px = particles[i * 3], py = particles[i * 3 + 1], pz = particles[i * 3 + 2];
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) throw new RangeError(`bindParticles: particle ${i} is not a finite point`);
    let code = region[i];
    if (code > BIND_ANY) throw new RangeError(`bindParticles: particle ${i} has region ${code} (0 trunk, 1 arm, 2 any)`);
    if ((code === BIND_TRUNK && trunkGrid.count === 0) || (code === BIND_ARM && armGrid.count === 0)) code = BIND_ANY;
    const own = code === BIND_ARM ? armGrid : trunkGrid, other = code === BIND_ARM ? trunkGrid : armGrid;
    sD = Infinity; sT = -1; sAlign = -1;
    search(own, px, py, pz);
    // the binding: the nearest of its own region ('any': of both)
    if (code === BIND_ANY) search(other, px, py, pz);
    if (sT < 0) throw new Error(`bindParticles: no triangle found for particle ${i}`);
    const t = sT, best = sD, bV = sV, bW = sW;
    // the side: read from the nearest triangle of EITHER region, so a trunk particle beside her arm is outside her even
    // where the nearest trunk triangle's own plane is behind it (the search goes on from the binding's distance, and
    // stops at once when the other region is farther)
    if (code !== BIND_ANY) search(other, px, py, pz);
    normalOf(sT);
    const side = (px - sQx) * nx + (py - sQy) * ny + (pz - sQz) * nz;

    const o = i * 3;
    tri[o] = T[t * 3]; tri[o + 1] = T[t * 3 + 1]; tri[o + 2] = T[t * 3 + 2];
    let u = 1 - bV - bW, v = bV, w = bW;
    if (u < 0) u = 0; if (v < 0) v = 0; if (w < 0) w = 0;
    const s = u + v + w;
    if (s > 0) { u /= s; v /= s; w /= s; } else { u = 1; v = 0; w = 0; }
    bary[o] = u; bary[o + 1] = v; bary[o + 2] = w;
    const dist = Math.sqrt(best), signed = side < 0 ? -dist : dist;
    distance[i] = signed;
    offset[i] = (signed < minOff ? minOff : signed > maxOff ? maxOff : signed) / scale;
  }
  return { count: n, tri, bary, offset, distance };
}

/** A uniform grid over some triangles' bounding boxes, metres: the triangles in each cell as compressed rows. */
interface Grid {
  readonly count: number;
  readonly minX: number; readonly minY: number; readonly minZ: number;
  readonly maxX: number; readonly maxY: number; readonly maxZ: number;
  readonly cell: number;
  readonly gx: number; readonly gy: number; readonly gz: number;
  /** Cell c's triangles are `tris[start[c] .. start[c + 1])`. */
  readonly start: Uint32Array;
  readonly tris: Uint32Array;
  /** Each entry's triangle's bounding box, 6 per entry of `tris` (min x, y, z, max x, y, z). */
  readonly boxes: Float32Array;
}

function cellOf(v: number, min: number, cell: number, g: number): number {
  const c = Math.floor((v - min) / cell);
  return c < 0 ? 0 : c >= g ? g - 1 : c;
}

function buildGrid(P: Float32Array, T: Uint32Array, ids: readonly number[]): Grid {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of ids) for (let c = 0; c < 3; c++) {
    const a = T[t * 3 + c] * 3, x = P[a], y = P[a + 1], z = P[a + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (ids.length === 0) minX = minY = minZ = maxX = maxY = maxZ = 0;
  let cell = BIND_CELL, gx = 1, gy = 1, gz = 1;
  for (;;) {
    gx = Math.max(1, Math.ceil((maxX - minX) / cell)); gy = Math.max(1, Math.ceil((maxY - minY) / cell)); gz = Math.max(1, Math.ceil((maxZ - minZ) / cell));
    if (gx * gy * gz <= BIND_MAX_CELLS) break;
    cell *= 1.25;
  }
  const gxy = gx * gy, cells = gxy * gz, m = ids.length;
  const range = new Int32Array(m * 6), start = new Uint32Array(cells + 1);
  for (let k = 0; k < m; k++) {
    const t = ids[k], a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3, r = k * 6;
    range[r] = cellOf(Math.min(P[a], P[b], P[c]), minX, cell, gx); range[r + 1] = cellOf(Math.max(P[a], P[b], P[c]), minX, cell, gx);
    range[r + 2] = cellOf(Math.min(P[a + 1], P[b + 1], P[c + 1]), minY, cell, gy); range[r + 3] = cellOf(Math.max(P[a + 1], P[b + 1], P[c + 1]), minY, cell, gy);
    range[r + 4] = cellOf(Math.min(P[a + 2], P[b + 2], P[c + 2]), minZ, cell, gz); range[r + 5] = cellOf(Math.max(P[a + 2], P[b + 2], P[c + 2]), minZ, cell, gz);
    for (let z = range[r + 4]; z <= range[r + 5]; z++) for (let y = range[r + 2]; y <= range[r + 3]; y++) {
      const row = z * gxy + y * gx;
      for (let x = range[r]; x <= range[r + 1]; x++) start[row + x + 1]++;
    }
  }
  for (let c = 0; c < cells; c++) start[c + 1] += start[c];
  const tris = new Uint32Array(start[cells]), boxes = new Float32Array(start[cells] * 6), fill = start.slice(0, cells);
  for (let k = 0; k < m; k++) {
    const r = k * 6, t = ids[k], a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const x0 = Math.min(P[a], P[b], P[c]), y0 = Math.min(P[a + 1], P[b + 1], P[c + 1]), z0 = Math.min(P[a + 2], P[b + 2], P[c + 2]);
    const x1 = Math.max(P[a], P[b], P[c]), y1 = Math.max(P[a + 1], P[b + 1], P[c + 1]), z1 = Math.max(P[a + 2], P[b + 2], P[c + 2]);
    for (let z = range[r + 4]; z <= range[r + 5]; z++) for (let y = range[r + 2]; y <= range[r + 3]; y++) {
      const row = z * gxy + y * gx;
      for (let x = range[r]; x <= range[r + 1]; x++) {
        const e = fill[row + x]++, o = e * 6;
        tris[e] = t;
        boxes[o] = x0; boxes[o + 1] = y0; boxes[o + 2] = z0; boxes[o + 3] = x1; boxes[o + 4] = y1; boxes[o + 5] = z1;
      }
    }
  }
  return { count: m, minX, minY, minZ, maxX, maxY, maxZ, cell, gx, gy, gz, start, tris, boxes };
}
