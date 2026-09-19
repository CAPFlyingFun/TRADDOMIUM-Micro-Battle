/**
 * A HUMAN MASTER'S SURFACE, ASKED QUESTIONS THE BAKE NEEDS ANSWERED.
 *
 * Two products, both computed from geometry alone and neither ever shipped:
 *
 *   RASTERISE   where every texel of the colour atlas sits in SPACE, and
 *               which triangle it belongs to.
 *   STANDOFF    how far it is from a texel, straight INTO the body, to the
 *               next surface. A lanyard lying on a shirt reads a few
 *               millimetres; the shirt itself reads the width of her torso.
 *   OCCLUSION   how much of the hemisphere above a texel is open. This is
 *               what puts the contact shadow back under a collar and a
 *               strap once the photographic shading has been replaced by
 *               flat colour.
 *
 * GLTF'S (0,0) IS THE TOP-LEFT OF THE IMAGE, so a texel's row is `v * S`
 * and never `(1 - v) * S`. This project has already lost an afternoon to
 * the other convention: every lookup lands on a plausible-looking but
 * different island, and nothing about the result says "wrong".
 *
 * Nothing here uses `Math.random`. Two runs produce byte-identical output,
 * which is what makes a bake reviewable.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Grid cell. Sarah's master is 101,918 triangles over ~1.7 m² of surface —
// a ~4 mm edge — so a 10 mm cell holds a dozen-odd triangles: few enough
// that a cell is a cheap test, coarse enough that a 250 mm ray crosses ~25
// cells rather than ~250.
export const CELL = 0.010;

// The origin is pushed this far below the surface so the texel's own
// triangle lands at negative t and is rejected. 0.5 mm is an eighth of a
// triangle edge and a fiftieth of the ~10 mm the detector has to resolve.
const STANDOFF_EPS = 0.0005;
/** Past the far side of a strap, well short of the far side of a torso. */
export const STANDOFF_MAX = 0.06;

const AO_EPS = 0.0002;
/** A contact-and-crease term, not a room bounce. */
const AO_MAX = 0.25;
const AO_SMOOTH_PASSES = 3;
const GUTTER_PASSES = 6;

// ---------------------------------------------------------------- the grid

/** Bucket every triangle into the cells its bounding box touches. */
export function buildRayGrid(P, IDX, cell = CELL) {
  let mnx = Infinity, mny = Infinity, mnz = Infinity;
  let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    if (P[i] < mnx) mnx = P[i]; if (P[i] > mxx) mxx = P[i];
    if (P[i + 1] < mny) mny = P[i + 1]; if (P[i + 1] > mxy) mxy = P[i + 1];
    if (P[i + 2] < mnz) mnz = P[i + 2]; if (P[i + 2] > mxz) mxz = P[i + 2];
  }
  const pad = cell * 2;
  mnx -= pad; mny -= pad; mnz -= pad; mxx += pad; mxy += pad; mxz += pad;
  const nx = Math.max(1, Math.ceil((mxx - mnx) / cell));
  const ny = Math.max(1, Math.ceil((mxy - mny) / cell));
  const nz = Math.max(1, Math.ceil((mxz - mnz) / cell));
  const tris = IDX.length / 3;
  const range = (t) => {
    const a = IDX[t * 3] * 3, b = IDX[t * 3 + 1] * 3, c = IDX[t * 3 + 2] * 3;
    const clamp = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : v);
    return [
      clamp(((Math.min(P[a], P[b], P[c]) - mnx) / cell) | 0, nx),
      clamp(((Math.max(P[a], P[b], P[c]) - mnx) / cell) | 0, nx),
      clamp(((Math.min(P[a + 1], P[b + 1], P[c + 1]) - mny) / cell) | 0, ny),
      clamp(((Math.max(P[a + 1], P[b + 1], P[c + 1]) - mny) / cell) | 0, ny),
      clamp(((Math.min(P[a + 2], P[b + 2], P[c + 2]) - mnz) / cell) | 0, nz),
      clamp(((Math.max(P[a + 2], P[b + 2], P[c + 2]) - mnz) / cell) | 0, nz),
    ];
  };
  const counts = new Int32Array(nx * ny * nz + 1);
  for (let t = 0; t < tris; t++) {
    const [i0, i1, j0, j1, k0, k1] = range(t);
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      counts[(k * ny + j) * nx + i + 1] += 1;
    }
  }
  for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
  const items = new Int32Array(counts[counts.length - 1]);
  const fill = counts.slice(0, counts.length - 1);
  for (let t = 0; t < tris; t++) {
    const [i0, i1, j0, j1, k0, k1] = range(t);
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      items[fill[(k * ny + j) * nx + i]++] = t;
    }
  }
  // A mailbox: a triangle straddling several cells is tested once per ray.
  return { P, IDX, cell, mnx, mny, mnz, nx, ny, nz, counts, items, mail: new Int32Array(tris), rid: 0 };
}

/**
 * The smallest t > 1e-6 at which the ray hits a triangle, or Infinity.
 *
 * Amanatides–Woo over the grid, Möller–Trumbore per triangle, BOTH facings
 * — the body is a closed shell, so a ray fired inward hits back faces and
 * those are precisely the hits that matter.
 *
 * THE ONE EXIT IS WHERE `tmax` IS ENFORCED, and that is not stylistic. An
 * earlier version returned `best` from inside the walk as soon as the best
 * hit fell inside the current cell's t range, which let a hit in the LAST
 * cell, between tmax and that cell's far face, escape the bound: standoff
 * came back at 74 mm against a 60 mm tmax, and occlusion counted blockers
 * past a quarter of a metre.
 */
export function raycast(g, ox, oy, oz, dx, dy, dz, tmax) {
  const { P, IDX, counts, items, mail, cell, mnx, mny, mnz, nx, ny, nz } = g;
  const mxx = mnx + nx * cell, mxy = mny + ny * cell, mxz = mnz + nz * cell;

  // Clip to the grid box first, so a ray starting outside does not walk an
  // unbounded number of empty cells to reach the body.
  let t0 = 0, t1 = tmax;
  if (dx !== 0) {
    const a = (mnx - ox) / dx, b = (mxx - ox) / dx;
    if (Math.min(a, b) > t0) t0 = Math.min(a, b);
    if (Math.max(a, b) < t1) t1 = Math.max(a, b);
  } else if (ox < mnx || ox >= mxx) return Infinity;
  if (dy !== 0) {
    const a = (mny - oy) / dy, b = (mxy - oy) / dy;
    if (Math.min(a, b) > t0) t0 = Math.min(a, b);
    if (Math.max(a, b) < t1) t1 = Math.max(a, b);
  } else if (oy < mny || oy >= mxy) return Infinity;
  if (dz !== 0) {
    const a = (mnz - oz) / dz, b = (mxz - oz) / dz;
    if (Math.min(a, b) > t0) t0 = Math.min(a, b);
    if (Math.max(a, b) < t1) t1 = Math.max(a, b);
  } else if (oz < mnz || oz >= mxz) return Infinity;
  if (t0 > t1) return Infinity;

  const ts = t0 > 0 ? t0 : 0;
  const px = ox + dx * ts, py = oy + dy * ts, pz = oz + dz * ts;
  let i = ((px - mnx) / cell) | 0, j = ((py - mny) / cell) | 0, k = ((pz - mnz) / cell) | 0;
  if (i < 0) i = 0; else if (i >= nx) i = nx - 1;
  if (j < 0) j = 0; else if (j >= ny) j = ny - 1;
  if (k < 0) k = 0; else if (k >= nz) k = nz - 1;

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const dtX = dx !== 0 ? Math.abs(cell / dx) : Infinity;
  const dtY = dy !== 0 ? Math.abs(cell / dy) : Infinity;
  const dtZ = dz !== 0 ? Math.abs(cell / dz) : Infinity;
  let tX = dx > 0 ? ts + (mnx + (i + 1) * cell - px) / dx
    : dx < 0 ? ts + (mnx + i * cell - px) / dx : Infinity;
  let tY = dy > 0 ? ts + (mny + (j + 1) * cell - py) / dy
    : dy < 0 ? ts + (mny + j * cell - py) / dy : Infinity;
  let tZ = dz > 0 ? ts + (mnz + (k + 1) * cell - pz) / dz
    : dz < 0 ? ts + (mnz + k * cell - pz) / dz : Infinity;

  const rid = ++g.rid;
  let best = Infinity;
  for (;;) {
    const c = (k * ny + j) * nx + i;
    const end = counts[c + 1];
    for (let s = counts[c]; s < end; s++) {
      const t = items[s];
      if (mail[t] === rid) continue;
      mail[t] = rid;
      const a = IDX[t * 3] * 3, b = IDX[t * 3 + 1] * 3, cc = IDX[t * 3 + 2] * 3;
      const ax = P[a], ay = P[a + 1], az = P[a + 2];
      const e1x = P[b] - ax, e1y = P[b + 1] - ay, e1z = P[b + 2] - az;
      const e2x = P[cc] - ax, e2y = P[cc + 1] - ay, e2z = P[cc + 2] - az;
      const pvx = dy * e2z - dz * e2y, pvy = dz * e2x - dx * e2z, pvz = dx * e2y - dy * e2x;
      const det = e1x * pvx + e1y * pvy + e1z * pvz;
      if (det > -1e-14 && det < 1e-14) continue;          // parallel; both signs accepted
      const inv = 1 / det;
      const tvx = ox - ax, tvy = oy - ay, tvz = oz - az;
      const u = (tvx * pvx + tvy * pvy + tvz * pvz) * inv;
      if (u < 0 || u > 1) continue;
      const qvx = tvy * e1z - tvz * e1y, qvy = tvz * e1x - tvx * e1z, qvz = tvx * e1y - tvy * e1x;
      const v = (dx * qvx + dy * qvy + dz * qvz) * inv;
      if (v < 0 || u + v > 1) continue;
      const tt = (e2x * qvx + e2y * qvy + e2z * qvz) * inv;
      if (tt > 1e-6 && tt < best) best = tt;
    }
    const tExit = tX < tY ? (tX < tZ ? tX : tZ) : (tY < tZ ? tY : tZ);
    if (best <= tExit) break;                             // nothing later can beat it
    if (tExit >= t1) break;
    if (tX <= tY && tX <= tZ) { i += stepX; tX += dtX; if (i < 0 || i >= nx) break; }
    else if (tY <= tZ) { j += stepY; tY += dtY; if (j < 0 || j >= ny) break; }
    else { k += stepZ; tZ += dtZ; if (k < 0 || k >= nz) break; }
  }
  return best <= tmax ? best : Infinity;
}

// ----------------------------------------------------------- the texel sheet

/**
 * Walk the UV triangles and record, per texel, its position, its normal and
 * the triangle it came from.
 *
 * `ok` is 0 for the empty page, 1 for a bleed skirt and 2 for a texel
 * genuinely inside a triangle — and a texel already claimed from INSIDE is
 * never overwritten by another triangle's skirt, or the islands would eat
 * each other's edges in whatever order the index buffer happens to run.
 */
export function rasterize(prim, S, bleed = 2) {
  const P = prim.getAttribute('POSITION').getArray();
  const N = prim.getAttribute('NORMAL').getArray();
  const UV = prim.getAttribute('TEXCOORD_0').getArray();
  const IDX = prim.getIndices().getArray();
  const pos = new Float32Array(S * S * 3), nrm = new Float32Array(S * S * 3);
  const ok = new Uint8Array(S * S);
  const tri = new Int32Array(S * S).fill(-1);
  for (let t = 0; t < IDX.length; t += 3) {
    const v = [IDX[t], IDX[t + 1], IDX[t + 2]];
    const ux = [UV[v[0] * 2] * S, UV[v[1] * 2] * S, UV[v[2] * 2] * S];
    const uy = [UV[v[0] * 2 + 1] * S, UV[v[1] * 2 + 1] * S, UV[v[2] * 2 + 1] * S];
    const x0 = Math.floor(Math.min(...ux)) - bleed, x1 = Math.ceil(Math.max(...ux)) + bleed;
    const y0 = Math.floor(Math.min(...uy)) - bleed, y1 = Math.ceil(Math.max(...uy)) + bleed;
    if ((x1 - x0) * (y1 - y0) > 250000) continue;          // a degenerate chart, not a triangle
    const d = (uy[1] - uy[2]) * (ux[0] - ux[2]) + (ux[2] - ux[1]) * (uy[0] - uy[2]);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= S || y >= S) continue;
      let l0 = 1 / 3, l1 = 1 / 3, l2 = 1 / 3;
      if (Math.abs(d) > 1e-12) {
        l0 = ((uy[1] - uy[2]) * (x + 0.5 - ux[2]) + (ux[2] - ux[1]) * (y + 0.5 - uy[2])) / d;
        l1 = ((uy[2] - uy[0]) * (x + 0.5 - ux[2]) + (ux[0] - ux[2]) * (y + 0.5 - uy[2])) / d;
        l2 = 1 - l0 - l1;
        if (l0 < -0.4 || l1 < -0.4 || l2 < -0.4) continue;
      }
      const i = y * S + x;
      const inside = l0 >= 0 && l1 >= 0 && l2 >= 0;
      if (ok[i] === 2 && !inside) continue;
      for (let k = 0; k < 3; k++) {
        pos[i * 3 + k] = l0 * P[v[0] * 3 + k] + l1 * P[v[1] * 3 + k] + l2 * P[v[2] * 3 + k];
        nrm[i * 3 + k] = l0 * N[v[0] * 3 + k] + l1 * N[v[1] * 3 + k] + l2 * N[v[2] * 3 + k];
      }
      ok[i] = inside ? 2 : 1;
      tri[i] = t / 3;
    }
  }
  return { pos, nrm, ok, tri };
}

// ------------------------------------------------------------------- baking

function hash32(x) {
  let h = Math.imul(x, 2654435761) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489917) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hammersley: (i + ½)/K against the radical inverse in base 2. */
function hammersley(K) {
  const out = new Float64Array(K * 2);
  for (let i = 0; i < K; i++) {
    let b = i, r = 0, f = 0.5;
    while (b) { r += (b & 1) * f; b >>= 1; f *= 0.5; }
    out[i * 2] = (i + 0.5) / K;
    out[i * 2 + 1] = r;
  }
  return out;
}

/** A 3×3 average that only ever reads covered texels, so a UV seam cannot
 * pick up the empty page. */
function smooth(a, ok, S, passes) {
  const tmp = new Float32Array(S * S);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (!ok[i]) { tmp[i] = a[i]; continue; }
      let s = 0, n = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(S - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(S - 1, x + 1); xx++) {
          const j = yy * S + xx; if (ok[j]) { s += a[j]; n += 1; }
        }
      }
      tmp[i] = s / n;
    }
    a.set(tmp);
  }
}

/**
 * Grow the covered region outward into the empty page, then set whatever is
 * still empty to `far`.
 *
 * WITHOUT THIS, A MIP OR A BILINEAR TAP AT AN ISLAND'S EDGE REACHES INTO
 * THE EMPTY PAGE. For occlusion the page reads 0, which means "fully
 * buried", and the renderer draws a dark hairline down every seam in the
 * atlas. The two far values are deliberately asymmetric — 1 is "open" for
 * occlusion, `STANDOFF_MAX` is "nothing behind me" for standoff — so a
 * reader must not assume one convention from the other.
 */
export function gutter(a, ok, S, passes, far) {
  const filled = Uint8Array.from(ok, (v) => (v ? 1 : 0));
  let written = 0;
  for (let p = 0; p < passes; p++) {
    const add = [];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (filled[i]) continue;
      let s = 0, n = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(S - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(S - 1, x + 1); xx++) {
          const j = yy * S + xx; if (filled[j]) { s += a[j]; n += 1; }
        }
      }
      if (n) add.push(i, s / n);
    }
    if (!add.length) break;
    for (let k = 0; k < add.length; k += 2) { a[add[k]] = add[k + 1]; filled[add[k]] = 1; written += 1; }
  }
  for (let i = 0; i < S * S; i++) if (!filled[i]) a[i] = far;
  return written;
}

/** How far it is from each texel, straight into the body, to the next surface. */
export function bakeStandoff(g, S, pos, nrm, ok) {
  const out = new Float32Array(S * S).fill(STANDOFF_MAX);
  for (let i = 0; i < S * S; i++) {
    if (!ok[i]) continue;
    let nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    const t = raycast(g,
      pos[i * 3] - STANDOFF_EPS * nx, pos[i * 3 + 1] - STANDOFF_EPS * ny, pos[i * 3 + 2] - STANDOFF_EPS * nz,
      -nx, -ny, -nz, STANDOFF_MAX);
    out[i] = Number.isFinite(t) ? t : STANDOFF_MAX;
  }
  gutter(out, ok, S, GUTTER_PASSES, STANDOFF_MAX);
  return out;
}

/** How much of the hemisphere above each texel is open, 0 buried to 1 clear. */
export function bakeAO(g, S, pos, nrm, ok, K = 32) {
  const ham = hammersley(K);
  const out = new Float32Array(S * S).fill(1);
  for (let i = 0; i < S * S; i++) {
    if (!ok[i]) continue;
    let nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    // Duff et al., a branchless orthonormal basis about n.
    const sg = nz >= 0 ? 1 : -1;
    const a = -1 / (sg + nz), b = nx * ny * a;
    const t1x = 1 + sg * nx * nx * a, t1y = sg * b, t1z = -sg * nx;
    const t2x = b, t2y = sg + ny * ny * a, t2z = -ny;
    // Cranley–Patterson: the same stratified set everywhere, shifted by a
    // hash of the TEXEL, so the residual noise does not band along UV rows.
    const h1 = hash32(i) / 4294967296;
    const h2 = hash32(i ^ 0x9e3779b9) / 4294967296;
    const ox = pos[i * 3] + AO_EPS * nx, oy = pos[i * 3 + 1] + AO_EPS * ny, oz = pos[i * 3 + 2] + AO_EPS * nz;
    let open = 0;
    for (let s = 0; s < K; s++) {
      let u1 = ham[s * 2] + h1; if (u1 >= 1) u1 -= 1;
      let u2 = ham[s * 2 + 1] + h2; if (u2 >= 1) u2 -= 1;
      const r = Math.sqrt(u1), phi = 6.283185307179586 * u2;
      const lx = r * Math.cos(phi), ly = r * Math.sin(phi), lz = Math.sqrt(1 - u1);
      if (!Number.isFinite(raycast(g, ox, oy, oz,
        lx * t1x + ly * t2x + lz * nx,
        lx * t1y + ly * t2y + lz * ny,
        lx * t1z + ly * t2z + lz * nz, AO_MAX))) open += 1;
    }
    out[i] = open / K;
  }
  smooth(out, ok, S, AO_SMOOTH_PASSES);
  gutter(out, ok, S, GUTTER_PASSES, 1);
  return out;
}

/**
 * Both maps for one primitive, kept on disk between runs.
 *
 * THE CACHE IS KEYED ON THE MASTER'S OWN BYTES, because that is the only
 * thing either map depends on. Re-baking occlusion is about two minutes a
 * body, and the master changes about once a month, so a bake that had to
 * pay it every time would simply stop being run.
 */
export function surfaceOf(prim, S, cacheDir, stamp, log = () => {}) {
  const aoPath = `${cacheDir}/${stamp}-ao.bin`;
  const soPath = `${cacheDir}/${stamp}-standoff.bin`;
  const sheet = rasterize(prim, S, 2);
  let covered = 0;
  for (let i = 0; i < S * S; i++) if (sheet.ok[i]) covered += 1;
  log(`atlas ${S}x${S}, ${covered.toLocaleString()} of ${(S * S).toLocaleString()} texels covered (${(100 * covered / (S * S)).toFixed(1)}%)`);
  if (existsSync(aoPath) && existsSync(soPath)) {
    log(`occlusion and standoff read from the cache (${stamp})`);
    return {
      ...sheet,
      ao: new Float32Array(readFileSync(aoPath).buffer.slice(0)),
      standoff: new Float32Array(readFileSync(soPath).buffer.slice(0)),
    };
  }
  const started = Date.now();
  const g = buildRayGrid(prim.getAttribute('POSITION').getArray(), prim.getIndices().getArray());
  const standoff = bakeStandoff(g, S, sheet.pos, sheet.nrm, sheet.ok);
  const ao = bakeAO(g, S, sheet.pos, sheet.nrm, sheet.ok);
  writeFileSync(soPath, Buffer.from(standoff.buffer));
  writeFileSync(aoPath, Buffer.from(ao.buffer));
  let sum = 0, mn = Infinity, mx = -Infinity;
  for (let i = 0; i < S * S; i++) if (sheet.ok[i]) { sum += ao[i]; if (ao[i] < mn) mn = ao[i]; if (ao[i] > mx) mx = ao[i]; }
  log(`occlusion baked in ${((Date.now() - started) / 1000).toFixed(0)} s — min ${mn.toFixed(3)}, mean ${(sum / covered).toFixed(3)}, max ${mx.toFixed(3)}; cached as ${stamp}`);
  return { ...sheet, ao, standoff };
}
