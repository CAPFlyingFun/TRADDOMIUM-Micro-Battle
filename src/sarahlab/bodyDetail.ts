/**
 * DETAIL THROUGH PAINT (Joshua, 2026-10-20: painted onto her, "the modeled nipples can sometimes read a little too
 * strongly through painted clothing... reduce them by about 50-60%... the bellybutton... keep about 70-90%", both
 * adjustable, Body Paint only, "not to flatten the anatomy unnaturally, but to soften it so the result looks like fabric
 * over the body").
 *
 * What is softened is her SURFACE DETAIL, not her shape: the difference between her rest surface and a smoothed copy
 * of it (Taubin smoothing, which takes the small bumps away without shrinking the large forms the way plain averaging
 * does). Around each nipple and the navel -- each nipple the most forward point of its breast, the navel the vertex
 * her own navel morph moves most -- that detail is stored per vertex, as a position offset and a
 * normal offset, with a soft falloff. The shader (`fabricMaterial.ts`) takes back a share of it, scaled by how much
 * paint covers the vertex: bare skin is never touched, a bikini or the base body never changes, and the share follows
 * her through every pose, belly and breast size, because it is subtracted from her surface as it moves, before
 * skinning.
 *
 * Pure arithmetic over plain arrays.
 */
import { BODY_REGIONS, type BodyMap } from './bodyRegions';

/** How much of each detail stays visible under paint: 1 all of it, 0 none. */
export interface DetailKeep { readonly nipple: number; readonly navel: number }
/** His defaults: nipples to about 45% (cut by 55%), the navel to 80%. */
export const DEFAULT_KEEP: DetailKeep = Object.freeze({ nipple: 0.45, navel: 0.8 });
/** Fabric weights as presets: thin shows more of her, thick less. */
export const KEEP_PRESETS: Readonly<Record<'thin' | 'medium' | 'thick', DetailKeep>> = Object.freeze({
  thin: Object.freeze({ nipple: 0.7, navel: 0.95 }),
  medium: DEFAULT_KEEP,
  thick: Object.freeze({ nipple: 0.2, navel: 0.5 }),
});

/** Where on her chest a nipple is looked for: out from her midline (fractions of her hip-joint spacing) and up her
 * trunk (hip joints 0, base of the neck 1). */
export const NIPPLE_WINDOW = Object.freeze({ across: [0.3, 0.85] as const, trunk: [0.6, 0.88] as const, apex: 0.03 });

/** Radii of the softened areas, as fractions of her trunk (hip joints to the base of the neck). */
export const DETAIL_RADII = Object.freeze({ areola: 0.042, ring: 0.075, navel: 0.06 });

export interface DetailInput {
  readonly map: BodyMap;
  readonly restPosition: ArrayLike<number>;
  readonly restNormal: ArrayLike<number>;
  readonly neighbours: readonly Uint32Array[];
  /** Her trunk's length in the positions' units. */
  readonly trunkLength: number;
  /** Taubin passes (each one a smoothing and an un-shrinking step). */
  readonly passes?: number;
  /** Her navel, if the caller knows it (the vertex her navel morph moves most); otherwise found on the surface. */
  readonly navelHint?: number;
}

export interface Detail {
  /** Per vertex: the detail's position offset (xyz) and the nipple weight (w), 0 outside the areas. */
  readonly offset: Float32Array;
  /** Per vertex: the detail's normal offset (xyz) and the navel weight (w). */
  readonly normal: Float32Array;
  /** Where each was found, for a test or a probe: vertex indices, -1 if none. */
  readonly nipples: readonly [number, number];
  readonly navel: number;
}

function smoothed(values: ArrayLike<number>, neighbours: readonly Uint32Array[], passes: number, only: Uint8Array): Float32Array {
  let cur = Float32Array.from(values as ArrayLike<number>), next = new Float32Array(cur.length);
  const list: number[] = [];
  for (let v = 0; v < neighbours.length; v++) if (only[v]) list.push(v);
  const step = (from: Float32Array, to: Float32Array, k: number) => {
    to.set(from);
    for (const v of list) {
      const nb = neighbours[v];
      if (!nb.length) continue;
      let x = 0, y = 0, z = 0;
      for (let i = 0; i < nb.length; i++) { const w = nb[i] * 3; x += from[w]; y += from[w + 1]; z += from[w + 2]; }
      x /= nb.length; y /= nb.length; z /= nb.length;
      to[v * 3] = from[v * 3] + k * (x - from[v * 3]);
      to[v * 3 + 1] = from[v * 3 + 1] + k * (y - from[v * 3 + 1]);
      to[v * 3 + 2] = from[v * 3 + 2] + k * (z - from[v * 3 + 2]);
    }
  };
  for (let p = 0; p < passes; p++) {
    step(cur, next, 0.5); [cur, next] = [next, cur];
    step(cur, next, -0.53); [cur, next] = [next, cur];
  }
  return cur;
}

export function bodyDetail(input: DetailInput): Detail {
  const { map, restPosition: P, restNormal: N, neighbours, trunkLength } = input;
  const n = map.region.length, passes = input.passes ?? 150;
  const id = (v: number) => BODY_REGIONS[map.region[v] - 1]?.id ?? '';
  // only the front of her torso is worked on: the rest is never softened, and is not worth smoothing
  const torso = new Uint8Array(n);
  for (let v = 0; v < n; v++) { const r = id(v); torso[v] = r === 'chest' || r === 'belly' || r === 'hips' || r === 'neck' ? 1 : 0; }
  const smooth = smoothed(P, neighbours, passes, torso);
  const nrmSmooth = smoothed(N, neighbours, passes, torso);
  // smoothing shortens the normals; a detail normal is a difference of two unit normals, or it flips the shading
  for (let v = 0; v < n; v++) {
    if (!torso[v]) continue;
    const l = Math.hypot(nrmSmooth[v * 3], nrmSmooth[v * 3 + 1], nrmSmooth[v * 3 + 2]) || 1;
    nrmSmooth[v * 3] /= l; nrmSmooth[v * 3 + 1] /= l; nrmSmooth[v * 3 + 2] /= l;
  }
  // the signed height of each vertex's detail above the smoothed surface
  const height = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    if (!torso[v]) continue;
    height[v] = (P[v * 3] - smooth[v * 3]) * N[v * 3] + (P[v * 3 + 1] - smooth[v * 3 + 1]) * N[v * 3 + 1] + (P[v * 3 + 2] - smooth[v * 3 + 2]) * N[v * 3 + 2];
  }
  // the nipples: each breast's most forward point (the first render showed why not "the strongest bump": her
  // collarbones are stronger). The navel: what the caller says, or the deepest dip on her belly's front midline
  const nipples: [number, number] = [-1, -1], best = [-Infinity, -Infinity];
  let navel = input.navelHint ?? -1, deepest = Infinity;
  // each breast's most forward point in the window: the nipple is the strongest bump close to it
  const inWindow = (v: number) => id(v) === 'chest' && map.front[v] > 0 && map.across[v] >= NIPPLE_WINDOW.across[0] && map.across[v] <= NIPPLE_WINDOW.across[1] && map.trunk[v] >= NIPPLE_WINDOW.trunk[0] && map.trunk[v] <= NIPPLE_WINDOW.trunk[1];
  const apex = [-Infinity, -Infinity];
  for (let v = 0; v < n; v++) if (inWindow(v)) { const s2 = P[v * 3] >= 0 ? 0 : 1; apex[s2] = Math.max(apex[s2], P[v * 3 + 2] * map.facing); }
  const nearApex = (v: number) => P[v * 3 + 2] * map.facing >= apex[P[v * 3] >= 0 ? 0 : 1] - NIPPLE_WINDOW.apex * trunkLength;
  for (let v = 0; v < n; v++) {
    if (map.front[v] <= 0) continue;
    const r = id(v);
    if (inWindow(v) && !nearApex(v)) continue;
    // within each breast's own window -- out from the sternum, between the underbust and the collarbones -- the
    // strongest bump is the nipple (her collarbones and the top of her bump lie outside it)
    if (r === 'chest' && map.across[v] >= NIPPLE_WINDOW.across[0] && map.across[v] <= NIPPLE_WINDOW.across[1] && map.trunk[v] >= NIPPLE_WINDOW.trunk[0] && map.trunk[v] <= NIPPLE_WINDOW.trunk[1]) {
      const s = P[v * 3] >= 0 ? 0 : 1;
      if (height[v] > best[s]) { best[s] = height[v]; nipples[s] = v; }
    } else if (input.navelHint === undefined && r === 'belly' && map.across[v] < 0.12 && height[v] < deepest) { deepest = height[v]; navel = v; }
  }
  const offset = new Float32Array(n * 4), normal = new Float32Array(n * 4);
  const dist = (v: number, c: number) => Math.hypot(P[v * 3] - P[c * 3], P[v * 3 + 1] - P[c * 3 + 1], P[v * 3 + 2] - P[c * 3 + 2]);
  const fall = (d: number, inner: number, outer: number) => (d <= inner ? 1 : d >= outer ? 0 : ((t) => t * t * (3 - 2 * t))((outer - d) / (outer - inner)));
  // EACH NIPPLE: the breast under it is the smooth surface (a quadric) fitted to a ring of skin round the areola, so
  // the breast's own dome is kept exactly and only what stands above it -- nipple and areola -- is the detail
  // (smoothing could not do this: her mesh is so fine there that the nipple is "large" to any smoothing that keeps
  // the breast, and the first renders showed it barely moved)
  const r1 = DETAIL_RADII.areola * trunkLength, r2 = DETAIL_RADII.ring * trunkLength;
  for (const c of nipples) {
    if (c < 0) continue;
    // the local frame: the average rest normal over the patch, and two directions across it
    let nx = 0, ny = 0, nz = 0;
    const patch: number[] = [];
    for (let v = 0; v < n; v++) if (torso[v] && dist(v, c) < r2) { patch.push(v); nx += N[v * 3]; ny += N[v * 3 + 1]; nz += N[v * 3 + 2]; }
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    let ax = Math.abs(nx) < 0.9 ? 1 : 0, ay = Math.abs(nx) < 0.9 ? 0 : 1, az = 0;
    // t1 = a - (a.n) n, t2 = n x t1
    const an = ax * nx + ay * ny + az * nz; ax -= an * nx; ay -= an * ny; az -= an * nz;
    const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
    const bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax;
    const local = (v: number) => {
      const dx = P[v * 3] - P[c * 3], dy = P[v * 3 + 1] - P[c * 3 + 1], dz = P[v * 3 + 2] - P[c * 3 + 2];
      return [dx * ax + dy * ay + dz * az, dx * bx + dy * by + dz * bz, dx * nx + dy * ny + dz * nz] as const;
    };
    // least squares h = q0 + q1 u + q2 v + q3 u^2 + q4 uv + q5 v^2 over the ring
    const A = Array.from({ length: 6 }, () => new Float64Array(6)), B = new Float64Array(6);
    let ringCount = 0;
    for (const v of patch) {
      const d = dist(v, c);
      if (d < r1) continue;
      const [u, w, h] = local(v), f = [1, u, w, u * u, u * w, w * w];
      for (let i = 0; i < 6; i++) { B[i] += f[i] * h; for (let j = 0; j < 6; j++) A[i][j] += f[i] * f[j]; }
      ringCount++;
    }
    const q = ringCount >= 12 ? solve6(A, B) : null;
    if (!q) continue;
    for (const v of patch) {
      const d = dist(v, c), wgt = fall(d, r1 * 0.75, r1 * 1.2);
      if (!wgt) continue;
      const [u, w, h] = local(v);
      const fit = q[0] + q[1] * u + q[2] * w + q[3] * u * u + q[4] * u * w + q[5] * w * w;
      const above = h - fit;
      const du = q[1] + 2 * q[3] * u + q[4] * w, dw = q[2] + q[4] * u + 2 * q[5] * w;
      // the fitted surface's normal, back in her space
      let fx = nx - du * ax - dw * bx, fy = ny - du * ay - dw * by, fz = nz - du * az - dw * bz;
      const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      offset[v * 4] = above * nx; offset[v * 4 + 1] = above * ny; offset[v * 4 + 2] = above * nz;
      offset[v * 4 + 3] = Math.max(offset[v * 4 + 3], wgt);
      normal[v * 4] = N[v * 3] - fx; normal[v * 4 + 1] = N[v * 3 + 1] - fy; normal[v * 4 + 2] = N[v * 3 + 2] - fz;
    }
  }
  // THE NAVEL: only its weight is stored (its relief map is faded by it; the shape itself is flattened by her own
  // navelFlat morph, which knows exactly what her navel is)
  const rV = DETAIL_RADII.navel * trunkLength;
  if (navel >= 0) for (let v = 0; v < n; v++) if (torso[v]) { const w = fall(dist(v, navel), rV * 0.5, rV); if (w) normal[v * 4 + 3] = w; }
  return { offset, normal, nipples, navel };
}

/** A 6x6 linear solve by Gaussian elimination with partial pivoting; null when singular. */
function solve6(A: Float64Array[], B: Float64Array): number[] | null {
  const m = A.map((row, i) => [...row, B[i]]);
  for (let col = 0; col < 6; col++) {
    let piv = col;
    for (let r = col + 1; r < 6; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-18) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < 6; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let k = col; k < 7; k++) m[r][k] -= f * m[col][k];
    }
  }
  return m.map((row, i) => row[6] / row[i]);
}
