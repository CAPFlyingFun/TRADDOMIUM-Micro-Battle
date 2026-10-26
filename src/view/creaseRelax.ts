/**
 * WHERE HER SKIN FOLDS OVER ITSELF, IT IS UNTANGLED THERE AND NOWHERE ELSE.
 *
 * Sarah's body is one mesh reshaped by adding many morph offsets at once -- breast size, belly size and the rest. Each
 * offset was made against the approved body, not against the others, so where two of them pull the same skin opposite
 * ways their sum can fold the surface over itself, or pass one sheet of it through another. Under her breasts that
 * draws as a frayed seam with dark specks: triangles facing the wrong way, and shading normals blended from shapes
 * that no longer agree with the surface they shade.
 *
 * `prepareCrease` indexes a zone of the mesh once, from the approved body. `relaxCrease` then asks what is wrong with
 * the current shape inside it -- triangles folded against a neighbour or turned over, and edges passing through
 * triangles -- relaxes those vertices and a few rings round them toward their neighbours' mean, never further than
 * `cap` from where the shapes put them, until nothing is folded or crossed. It then BLENDS: what moved, and what the
 * shapes made sharper than the approved skin, is rounded out by Taubin smoothing feathered over `blendRings`, so the
 * crease stops reading as a seam (Joshua, on the renders: "look less obvious and blend it more"). Last it takes the
 * shading there from the surface itself, smoothed, feathered back into the blended normals over `grow` rings.
 *
 * WHERE NOTHING IS WRONG IT CHANGES NOTHING. An approved shape comes back as an empty result and draws bit for bit as
 * before, so every step asks what is wrong before it moves anything, and every test of it is made against the approved
 * body: a shading normal that already strayed there is measured against how far it strayed, and skin that was already
 * that sharp is not blended.
 *
 * Pure arithmetic on typed arrays with no imports: it runs on the phone whenever a body control changes, so the
 * indexing is done once and the scratch buffers are kept with the mesh, and a call allocates little beyond its result.
 * It reproduces, step for step, the Python prototype the fix was found with.
 */

/** Her body's geometry units are 0.89974678 m, so the default reach of an untangling move is 8 mm. */
const DEFAULT_CAP = 0.008 / 0.89974678;
/**
 * The repaired shading feathers wide and smooth (Joshua, on the renders: "look less obvious and blend it more"): 14
 * rings and 24 passes are the validated prototype's, where 6 and 4 left the repair's edge visible.
 */
const DEFAULT_GROW = 14;
const DEFAULT_SMOOTH = 24;
const DEFAULT_ROUNDS = 40;
const DEFAULT_STRAY_DEG = 35;
const DEFAULT_STRAY_MARGIN_DEG = 25;
/** Skin this much sharper than on the approved body (in |kappa|, see `curvature`) is blended. */
const DEFAULT_SHARP_TAU = 0.2;
const DEFAULT_BLEND_RINGS = 8;
const DEFAULT_BLEND_ITERS = 30;
const DEFAULT_BLEND_LAMBDA = 0.5;
/** Taubin's mu as a multiple of lambda: the inflating pass a little stronger than the shrinking one. */
const TAUBIN_MU = -1.06;
/** The blend may reach further than the untangling, 20 mm, because rounding a crease moves a broader stretch. */
const DEFAULT_BLEND_CAP = 0.02 / 0.89974678;

/** Two band triangles across an edge are folded when their normals are further apart than 110 degrees. */
const PAIR_COS = Math.cos((110 * Math.PI) / 180);
/** A band triangle is turned over when its normal faces against its approved one by more than this. */
const FLIP_DOT = -0.2;
/** Averaging steps per untangling round. */
const JACOBI_STEPS = 6;
/** Below this the segment lies in the triangle's plane and is not counted as crossing it. */
const DET_EPSILON = 1e-14;
/** Positions are welded on a 1e-5 lattice: copies split for texture seams sit on exactly the same point. */
const WELD_SCALE = 1e5;
/** How many band edges are measured to choose the crossing test's cell size. */
const MEDIAN_SAMPLE = 1024;
/** The crossing grid coarsens until it holds no more than this many entries per triangle. */
const MAX_CELLS_PER_TRIANGLE = 48;
const DEG = 180 / Math.PI;

/** The repair's reach and tolerances. The defaults are the prototype's, tuned on her body; tests may narrow them. */
export interface CreaseOptions {
  /** furthest an untangling move may take a vertex from where the shapes put it, geometry units (default 0.008 / 0.89974678) */
  readonly cap?: number;
  /** rings the repaired shading feathers over (default 14) */
  readonly grow?: number;
  /** smoothing passes over the surface's own normals (default 24) */
  readonly smooth?: number;
  /** most untangling rounds (default 40) */
  readonly rounds?: number;
  /** a blended normal is repaired when it strays further than this from its surface, degrees (default 35)... */
  readonly strayDeg?: number;
  /** ...and further than it already strayed on the approved body plus this, degrees (default 25) */
  readonly strayMarginDeg?: number;
  /**
   * a zone vertex is blended when its |kappa| exceeds the approved body's there by more than this (default 0.2): the
   * shapes made her skin sharper there than it was approved. Kappa is unitless (see `curvature`).
   */
  readonly sharpTau?: number;
  /** rings the blend feathers over from what moved or sharpened (default 8) */
  readonly blendRings?: number;
  /** Taubin smoothing iterations, each a shrinking and an inflating pass (default 30); 0 turns the blend off */
  readonly blendIters?: number;
  /** the blend's step, lambda; the inflating pass uses -1.06 times it (default 0.5) */
  readonly blendLambda?: number;
  /** furthest the blend may leave a vertex from where the shapes put it, geometry units (default 0.02 / 0.89974678) */
  readonly blendCap?: number;
}

/**
 * One mesh's zone, prepared once by `prepareCrease`. Its LOCAL vertices are the welded vertices of every triangle
 * touching the zone: the zone's own first, then the ring of outside vertices those triangles reach, which are read but
 * never changed.
 */
export interface CreaseMesh {
  /** for each local vertex, the unwelded mesh vertex its position and normal are read from */
  readonly reps: Uint32Array;
  /** how many local vertices are in the zone (they come first: local ids 0..zoneCount-1 are the zone) */
  readonly zoneCount: number;
  /**
   * Everything else `prepareCrease` worked out, kept for `relaxCrease` alone. Internal: nothing else reads it, and
   * nothing may edit it, because the scratch buffers inside are reused by every call.
   */
  readonly prepared: CreasePrepared;
}

/** The indexing of one mesh's zone, worked out once from the approved body. */
interface CreasePrepared {
  /** local triangles, three local ids each: the band's first (`bandCount` of them), then every other incident one */
  readonly tris: Uint32Array;
  /** triangles with all three vertices in the zone: the only ones tested for folds and crossings */
  readonly bandCount: number;
  /** each local vertex's neighbours, ascending: `nbr[off[i]]` up to `nbr[off[i + 1]]` */
  readonly off: Uint32Array;
  readonly nbr: Uint32Array;
  /** band triangles meeting across an edge only the two of them share, two band triangle numbers each */
  readonly pairs: Uint32Array;
  /** the band's edges, two local ids each */
  readonly bandEdges: Uint32Array;
  /** each band triangle's unit normal on the approved body */
  readonly n0: Float64Array;
  /** each zone vertex's unwelded copies: `weldList[weldOff[i]]` up to `weldList[weldOff[i + 1]]` */
  readonly weldOff: Uint32Array;
  readonly weldList: Uint32Array;
  /** how far each zone vertex's approved shading normal already strays from its approved surface, degrees */
  readonly e0: Float64Array;
  /** how sharply the approved skin bends at each zone vertex (see `curvature`) */
  readonly kappa0: Float64Array;
  readonly scratch: CreaseScratch;
}

/** Buffers reused by every call, so the common case allocates nothing but its (empty) answer. */
interface CreaseScratch {
  readonly X: Float64Array;
  readonly P: Float64Array;
  readonly M: Float64Array;
  readonly G: Float64Array;
  readonly Nu: Float64Array;
  readonly w: Float64Array;
  readonly triN: Float64Array;
  readonly triBox: Float64Array;
  readonly triCell: Float64Array;
  readonly sample: Float64Array;
  readonly foldMark: Uint8Array;
  readonly crossMark: Uint8Array;
  readonly touched: Uint8Array;
  readonly kappa: Float64Array;
  readonly queue: Uint32Array;
  readonly level: Int32Array;
  readonly dist: Int32Array;
  readonly act: Uint32Array;
  readonly stamp: Int32Array;
  readonly bucket: Int32Array;
  entries: Int32Array;
  stampBase: number;
}

/**
 * What to change, as a sparse list over the unwelded mesh, and what was found. Empty arrays mean nothing was wrong and
 * the shape draws exactly as given. Every copy of a welded vertex is listed with the same offset and normal.
 */
export interface CreaseResult {
  /** unwelded mesh vertices changed */
  readonly vertices: Uint32Array;
  /** per changed vertex, xyz offset to add to its position (0,0,0 where only the normal changed) */
  readonly offset: Float32Array;
  /** per changed vertex, the unit normal to shade with, or NaN,NaN,NaN where its own normal stays */
  readonly normal: Float32Array;
  /**
   * what was wrong as given: folds (band triangle pairs bent past 110 degrees across their edge, plus band triangles
   * turned over against the approved body) and crossings (band edges passing through a band triangle not their own)
   */
  readonly found: { readonly folds: number; readonly crossings: number };
  /** what is still wrong after */
  readonly left: { readonly folds: number; readonly crossings: number };
  /** untangling rounds run (0 when nothing was folded or crossed) */
  readonly rounds: number;
  /** local vertices moved, and local vertices whose shading was repaired */
  readonly moved: number;
  readonly shaded: number;
  /** largest move, geometry units */
  readonly most: number;
}

function pow2AtLeast(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Three integers to a well-mixed 32-bit hash: lattice keys share low bits, and the tables index by low bits. */
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return h >>> 0;
}

function smooth01(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

/**
 * Area-weighted vertex normals of `Y` from the local triangles, into `G`: unit length for the first `z` (zone)
 * vertices, whose triangles are all local; left as raw sums for the ring, which sees only part of its surface.
 */
function areaNormals(tris: Uint32Array, z: number, Y: Float64Array, G: Float64Array): void {
  G.fill(0);
  for (let t = 0, T = tris.length / 3; t < T; t += 1) {
    const a = 3 * tris[3 * t], b = 3 * tris[3 * t + 1], c = 3 * tris[3 * t + 2];
    const e1x = Y[b] - Y[a], e1y = Y[b + 1] - Y[a + 1], e1z = Y[b + 2] - Y[a + 2];
    const e2x = Y[c] - Y[a], e2y = Y[c + 1] - Y[a + 1], e2z = Y[c + 2] - Y[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    G[a] += nx; G[a + 1] += ny; G[a + 2] += nz;
    G[b] += nx; G[b + 1] += ny; G[b + 2] += nz;
    G[c] += nx; G[c + 1] += ny; G[c + 2] += nz;
  }
  for (let i = 0; i < z; i += 1) {
    const gx = G[3 * i], gy = G[3 * i + 1], gz = G[3 * i + 2];
    const gl = Math.max(Math.sqrt(gx * gx + gy * gy + gz * gz), 1e-15);
    G[3 * i] = gx / gl; G[3 * i + 1] = gy / gl; G[3 * i + 2] = gz / gl;
  }
}

/**
 * How sharply the skin bends at each zone vertex, into `out`: kappa = ((neighbours' mean - Y_i) . n_i) / mean edge,
 * with `n` from `areaNormals`. Positive in a groove, negative on a ridge, and unitless, so a fine stretch of mesh and
 * a coarse one read alike. A crease the shapes pressed in reads as |kappa| larger than the approved body's there.
 */
function curvature(off: Uint32Array, nbr: Uint32Array, z: number, Y: Float64Array, G: Float64Array, out: Float64Array): void {
  for (let i = 0; i < z; i += 1) {
    const x = Y[3 * i], y = Y[3 * i + 1], w = Y[3 * i + 2];
    let sx = 0, sy = 0, sz = 0, el = 0;
    const o0 = off[i], o1 = off[i + 1];
    for (let k = o0; k < o1; k += 1) {
      const j = 3 * nbr[k], dx = Y[j] - x, dy = Y[j + 1] - y, dz = Y[j + 2] - w;
      sx += Y[j]; sy += Y[j + 1]; sz += Y[j + 2];
      el += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const m = Math.max(o1 - o0, 1);
    const lx = sx / m - x, ly = sy / m - y, lz = sz / m - w;
    out[i] = (lx * G[3 * i] + ly * G[3 * i + 1] + lz * G[3 * i + 2]) / Math.max(el / m, 1e-12);
  }
}

/**
 * Weights falling smoothly from 1 at the seeds (`queue[0..seeds)`, their `dist` already 0 and every other `dist`
 * already `rings + 1`) to 0 past `rings` rings, by ring distance over every local vertex; written to `w` for zone
 * vertices (0 elsewhere), and the zone vertices with any weight listed in `list`. Returns how many were listed.
 */
function feather(
  p: CreasePrepared, z: number, seeds: number, rings: number, w: Float64Array, list: Uint32Array,
): number {
  const { off, nbr } = p, { queue, dist } = p.scratch, n = dist.length, reach = rings + 1;
  let tail = seeds;
  for (let head = 0; head < tail; head += 1) {
    const i = queue[head], d = dist[i];
    if (d + 1 > rings) continue;
    for (let k = off[i]; k < off[i + 1]; k += 1) {
      const j = nbr[k];
      if (dist[j] > d + 1) { dist[j] = d + 1; queue[tail++] = j; }
    }
  }
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    w[i] = i < z ? smooth01(1 - dist[i] / reach) : 0;
    if (w[i] > 0) list[count++] = i;
  }
  return count;
}

/**
 * Prepare once per mesh, from its APPROVED rest positions and normals (every vertex), its full triangle index, and the
 * zone test (geometry units).
 */
export function prepareCrease(
  base: ArrayLike<number>,
  baseNormal: ArrayLike<number>,
  index: ArrayLike<number>,
  inZone: (x: number, y: number, z: number) => boolean,
): CreaseMesh {
  const V = Math.floor(base.length / 3);

  // Weld: copies split for texture seams share one id, so a fold across a seam is one fold and both copies move alike.
  // The representative of a welded id is its lowest unwelded vertex.
  const weld = new Uint32Array(V);
  const repOf = new Uint32Array(V);
  const key = new Float64Array(3 * V);
  const tableSize = pow2AtLeast(2 * V + 1), tableMask = tableSize - 1;
  const table = new Int32Array(tableSize).fill(-1);
  let welded = 0;
  for (let v = 0; v < V; v += 1) {
    const kx = Math.round(base[3 * v] * WELD_SCALE), ky = Math.round(base[3 * v + 1] * WELD_SCALE);
    const kz = Math.round(base[3 * v + 2] * WELD_SCALE);
    let slot = hash3(kx, ky, kz) & tableMask, id = -1;
    for (;;) {
      const w = table[slot];
      if (w < 0) break;
      if (key[3 * w] === kx && key[3 * w + 1] === ky && key[3 * w + 2] === kz) { id = w; break; }
      slot = (slot + 1) & tableMask;
    }
    if (id < 0) {
      id = welded;
      welded += 1;
      table[slot] = id;
      key[3 * id] = kx; key[3 * id + 1] = ky; key[3 * id + 2] = kz;
      repOf[id] = v;
    }
    weld[v] = id;
  }

  const zoneW = new Uint8Array(welded);
  for (let w = 0; w < welded; w += 1) {
    const r = repOf[w];
    zoneW[w] = inZone(base[3 * r], base[3 * r + 1], base[3 * r + 2]) ? 1 : 0;
  }

  // Welded triangles, dropping any the weld collapsed; incident ones touch the zone, band ones lie wholly inside it.
  const T = Math.floor(index.length / 3);
  const kind = new Uint8Array(T);
  const used = new Uint8Array(welded);
  let nInc = 0, nBand = 0;
  for (let t = 0; t < T; t += 1) {
    const a = weld[index[3 * t]], b = weld[index[3 * t + 1]], c = weld[index[3 * t + 2]];
    if (a === b || b === c || a === c) continue;
    const z = zoneW[a] + zoneW[b] + zoneW[c];
    if (z === 0) continue;
    kind[t] = z === 3 ? 2 : 1;
    nInc += 1;
    if (z === 3) nBand += 1;
    used[a] = 1; used[b] = 1; used[c] = 1;
  }

  // Local vertices: every welded vertex an incident triangle uses, the zone's first.
  const localOf = new Int32Array(welded).fill(-1);
  let n = 0;
  for (let w = 0; w < welded; w += 1) if (used[w] && zoneW[w]) { localOf[w] = n; n += 1; }
  const zoneCount = n;
  for (let w = 0; w < welded; w += 1) if (used[w] && !zoneW[w]) { localOf[w] = n; n += 1; }
  const reps = new Uint32Array(n);
  for (let w = 0; w < welded; w += 1) if (localOf[w] >= 0) reps[localOf[w]] = repOf[w];

  const tris = new Uint32Array(3 * nInc);
  let bi = 0, oi = nBand;
  for (let t = 0; t < T; t += 1) {
    if (!kind[t]) continue;
    const at = kind[t] === 2 ? bi++ : oi++;
    tris[3 * at] = localOf[weld[index[3 * t]]];
    tris[3 * at + 1] = localOf[weld[index[3 * t + 1]]];
    tris[3 * at + 2] = localOf[weld[index[3 * t + 2]]];
  }

  // Adjacency from the incident triangles' edges. A zone vertex's every triangle is incident, so its neighbourhood is
  // whole; a ring vertex's is only the part next to the zone, which is why the shading never trusts its own surface.
  const rawOff = new Uint32Array(n + 1);
  for (let k = 0; k < 3 * nInc; k += 1) rawOff[tris[k] + 1] += 2;
  for (let i = 0; i < n; i += 1) rawOff[i + 1] += rawOff[i];
  const nbrRaw = new Uint32Array(rawOff[n]);
  const cursor = rawOff.slice(0, n);
  for (let t = 0; t < nInc; t += 1) {
    const a = tris[3 * t], b = tris[3 * t + 1], c = tris[3 * t + 2];
    nbrRaw[cursor[a]++] = b; nbrRaw[cursor[a]++] = c;
    nbrRaw[cursor[b]++] = a; nbrRaw[cursor[b]++] = c;
    nbrRaw[cursor[c]++] = a; nbrRaw[cursor[c]++] = b;
  }
  const off = new Uint32Array(n + 1);
  let write = 0;
  for (let i = 0; i < n; i += 1) {
    const start = rawOff[i], end = rawOff[i + 1];
    for (let k = start + 1; k < end; k += 1) {
      const x = nbrRaw[k];
      let j = k - 1;
      while (j >= start && nbrRaw[j] > x) { nbrRaw[j + 1] = nbrRaw[j]; j -= 1; }
      nbrRaw[j + 1] = x;
    }
    off[i] = write;
    for (let k = start; k < end; k += 1) if (k === start || nbrRaw[k] !== nbrRaw[k - 1]) nbrRaw[write++] = nbrRaw[k];
  }
  off[n] = write;
  const nbr = nbrRaw.slice(0, write);
  const slotOf = (u: number, v: number): number => {
    for (let k = off[u]; k < off[u + 1]; k += 1) if (nbr[k] === v) return k;
    return -1;
  };

  // Edges, by their slot in the lower id's neighbour list. Every triangle on an edge between two zone vertices is
  // incident, so counting over the incident triangles counts the whole mesh there.
  const edgeCount = new Uint8Array(write);
  const edgeT0 = new Int32Array(write), edgeT1 = new Int32Array(write);
  const bandEdge = new Uint8Array(write);
  for (let t = 0; t < nInc; t += 1) {
    for (let e = 0; e < 3; e += 1) {
      const p = tris[3 * t + e], q = tris[3 * t + ((e + 1) % 3)];
      const s = slotOf(p < q ? p : q, p < q ? q : p);
      const c = edgeCount[s];
      if (c === 0) edgeT0[s] = t; else if (c === 1) edgeT1[s] = t;
      if (c < 255) edgeCount[s] = c + 1;
      if (t < nBand) bandEdge[s] = 1;
    }
  }
  let nPairs = 0, nBandEdges = 0;
  for (let u = 0; u < n; u += 1) {
    for (let k = off[u]; k < off[u + 1]; k += 1) {
      if (nbr[k] <= u) continue;
      if (edgeCount[k] === 2 && edgeT0[k] < nBand && edgeT1[k] < nBand) nPairs += 1;
      if (bandEdge[k]) nBandEdges += 1;
    }
  }
  const pairs = new Uint32Array(2 * nPairs), bandEdges = new Uint32Array(2 * nBandEdges);
  nPairs = 0; nBandEdges = 0;
  for (let u = 0; u < n; u += 1) {
    for (let k = off[u]; k < off[u + 1]; k += 1) {
      if (nbr[k] <= u) continue;
      if (edgeCount[k] === 2 && edgeT0[k] < nBand && edgeT1[k] < nBand) {
        pairs[2 * nPairs] = edgeT0[k]; pairs[2 * nPairs + 1] = edgeT1[k]; nPairs += 1;
      }
      if (bandEdge[k]) { bandEdges[2 * nBandEdges] = u; bandEdges[2 * nBandEdges + 1] = nbr[k]; nBandEdges += 1; }
    }
  }

  // The approved band's facing, which a turned-over triangle is caught against.
  const n0 = new Float64Array(3 * nBand);
  for (let t = 0; t < nBand; t += 1) {
    const a = 3 * reps[tris[3 * t]], b = 3 * reps[tris[3 * t + 1]], c = 3 * reps[tris[3 * t + 2]];
    const e1x = base[b] - base[a], e1y = base[b + 1] - base[a + 1], e1z = base[b + 2] - base[a + 2];
    const e2x = base[c] - base[a], e2y = base[c + 1] - base[a + 1], e2z = base[c + 2] - base[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz), inv = l > 0 ? 1 / l : 0;
    n0[3 * t] = nx * inv; n0[3 * t + 1] = ny * inv; n0[3 * t + 2] = nz * inv;
  }

  // Each zone vertex's unwelded copies, which is where a repair is written back.
  const weldOff = new Uint32Array(zoneCount + 1);
  for (let v = 0; v < V; v += 1) {
    const l = localOf[weld[v]];
    if (l >= 0 && l < zoneCount) weldOff[l + 1] += 1;
  }
  for (let i = 0; i < zoneCount; i += 1) weldOff[i + 1] += weldOff[i];
  const weldList = new Uint32Array(weldOff[zoneCount]);
  const wc = weldOff.slice(0, zoneCount);
  for (let v = 0; v < V; v += 1) {
    const l = localOf[weld[v]];
    if (l >= 0 && l < zoneCount) weldList[wc[l]++] = v;
  }

  // How far the approved shading already strays from the approved surface: a crease the artist shaded on purpose
  // is not a fault, and is measured against itself.
  const acc = new Float64Array(3 * zoneCount);
  for (let t = 0; t < nInc; t += 1) {
    const la = tris[3 * t], lb = tris[3 * t + 1], lc = tris[3 * t + 2];
    const a = 3 * reps[la], b = 3 * reps[lb], c = 3 * reps[lc];
    const e1x = base[b] - base[a], e1y = base[b + 1] - base[a + 1], e1z = base[b + 2] - base[a + 2];
    const e2x = base[c] - base[a], e2y = base[c + 1] - base[a + 1], e2z = base[c + 2] - base[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    if (la < zoneCount) { acc[3 * la] += nx; acc[3 * la + 1] += ny; acc[3 * la + 2] += nz; }
    if (lb < zoneCount) { acc[3 * lb] += nx; acc[3 * lb + 1] += ny; acc[3 * lb + 2] += nz; }
    if (lc < zoneCount) { acc[3 * lc] += nx; acc[3 * lc + 1] += ny; acc[3 * lc + 2] += nz; }
  }
  const e0 = new Float64Array(zoneCount);
  for (let i = 0; i < zoneCount; i += 1) {
    const gx = acc[3 * i], gy = acc[3 * i + 1], gz = acc[3 * i + 2];
    const gl = Math.max(Math.sqrt(gx * gx + gy * gy + gz * gz), 1e-15);
    const r = 3 * reps[i];
    const bx = baseNormal[r], by = baseNormal[r + 1], bz = baseNormal[r + 2];
    const bl = Math.max(Math.sqrt(bx * bx + by * by + bz * bz), 1e-12);
    const d = (gx * bx + gy * by + gz * bz) / (gl * bl);
    e0[i] = Math.acos(d < -1 ? -1 : d > 1 ? 1 : d) * DEG;
  }

  // How sharply the approved skin already bends: the blend rounds only what the shapes made sharper than this.
  const Y0 = new Float64Array(3 * n), G0 = new Float64Array(3 * n);
  for (let i = 0; i < n; i += 1) {
    const r = 3 * reps[i];
    Y0[3 * i] = base[r]; Y0[3 * i + 1] = base[r + 1]; Y0[3 * i + 2] = base[r + 2];
  }
  areaNormals(tris, zoneCount, Y0, G0);
  const kappa0 = new Float64Array(zoneCount);
  curvature(off, nbr, zoneCount, Y0, G0, kappa0);

  const bucketSize = pow2AtLeast(Math.max(1024, 2 * nBand));
  const scratch: CreaseScratch = {
    X: new Float64Array(3 * n),
    P: new Float64Array(3 * n),
    M: new Float64Array(3 * n),
    G: new Float64Array(3 * n),
    Nu: new Float64Array(3 * n),
    w: new Float64Array(n),
    triN: new Float64Array(3 * nBand),
    triBox: new Float64Array(6 * nBand),
    triCell: new Float64Array(6 * nBand),
    sample: new Float64Array(MEDIAN_SAMPLE + 1),
    foldMark: new Uint8Array(n),
    crossMark: new Uint8Array(n),
    touched: new Uint8Array(n),
    kappa: new Float64Array(zoneCount),
    queue: new Uint32Array(n),
    level: new Int32Array(n).fill(-1),
    dist: new Int32Array(n),
    act: new Uint32Array(Math.max(zoneCount, 1)),
    stamp: new Int32Array(nBand),
    bucket: new Int32Array(bucketSize + 1),
    entries: new Int32Array(Math.max(16, 8 * nBand)),
    stampBase: 1,
  };

  return {
    reps,
    zoneCount,
    prepared: { tris, bandCount: nBand, off, nbr, pairs, bandEdges, n0, weldOff, weldList, e0, kappa0, scratch },
  };
}

/**
 * Folded band triangles in `X`: pairs across an edge whose normals are more than 110 degrees apart, and triangles
 * turned over against the approved band. Marks every vertex of each in `mark` and returns how many were found.
 */
function folded(p: CreasePrepared, X: Float64Array, mark: Uint8Array): number {
  mark.fill(0);
  const { tris, bandCount, pairs, n0 } = p, N = p.scratch.triN;
  for (let t = 0; t < bandCount; t += 1) {
    const a = 3 * tris[3 * t], b = 3 * tris[3 * t + 1], c = 3 * tris[3 * t + 2];
    const e1x = X[b] - X[a], e1y = X[b + 1] - X[a + 1], e1z = X[b + 2] - X[a + 2];
    const e2x = X[c] - X[a], e2y = X[c + 1] - X[a + 1], e2z = X[c + 2] - X[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz), inv = l > 0 ? 1 / l : 0;
    N[3 * t] = nx * inv; N[3 * t + 1] = ny * inv; N[3 * t + 2] = nz * inv;
  }
  let count = 0;
  for (let k = 0; k < pairs.length; k += 2) {
    const s = 3 * pairs[k], q = 3 * pairs[k + 1];
    if (N[s] * N[q] + N[s + 1] * N[q + 1] + N[s + 2] * N[q + 2] < PAIR_COS) {
      count += 1;
      mark[tris[s]] = 1; mark[tris[s + 1]] = 1; mark[tris[s + 2]] = 1;
      mark[tris[q]] = 1; mark[tris[q + 1]] = 1; mark[tris[q + 2]] = 1;
    }
  }
  for (let t = 0; t < bandCount; t += 1) {
    const s = 3 * t;
    if (N[s] * n0[s] + N[s + 1] * n0[s + 1] + N[s + 2] * n0[s + 2] < FLIP_DOT) {
      count += 1;
      mark[tris[s]] = 1; mark[tris[s + 1]] = 1; mark[tris[s + 2]] = 1;
    }
  }
  return count;
}

/**
 * Where the band passes through itself in `X`: each band edge tested against every band triangle that does not touch
 * it, through a hashed grid of the triangles' boxes. Marks the edge's ends and the triangle's corners in `mark` and
 * returns how many edge-triangle hits there were.
 *
 * This is the dear step, and it is exact, so it cannot be skipped where nothing looks wrong: on her 25,428-triangle
 * band it measured about 30 ms in Node (2.1 GHz Xeon), against under 1 ms for the fold test. A refitted bounding
 * volume tree, triangle records packed into one cache line, boxes stored inline in the grid and a branchless box test
 * were each measured against this on her real shapes, gave the same hits and marks, and none was faster.
 */
function crossings(p: CreasePrepared, X: Float64Array, mark: Uint8Array): number {
  mark.fill(0);
  const { tris, bandCount: B, bandEdges } = p, s = p.scratch;
  const E = bandEdges.length >> 1;
  if (B === 0 || E === 0) return 0;

  // The cell is twice a typical edge, measured on the shape as it is now: the shapes stretch the skin.
  const stride = Math.max(1, Math.floor(E / MEDIAN_SAMPLE));
  let ns = 0;
  for (let e = 0; e < E && ns < s.sample.length; e += stride) {
    const o = 3 * bandEdges[2 * e], q = 3 * bandEdges[2 * e + 1];
    const dx = X[q] - X[o], dy = X[q + 1] - X[o + 1], dz = X[q + 2] - X[o + 2];
    s.sample[ns++] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  const sorted = s.sample.subarray(0, ns).sort();
  let h = 2 * sorted[ns >> 1];

  const box = s.triBox, cell = s.triCell;
  let ox = Infinity, oy = Infinity, oz = Infinity, ex = -Infinity, ey = -Infinity, ez = -Infinity;
  for (let t = 0; t < B; t += 1) {
    const a = 3 * tris[3 * t], b = 3 * tris[3 * t + 1], c = 3 * tris[3 * t + 2];
    const x0 = Math.min(X[a], X[b], X[c]), y0 = Math.min(X[a + 1], X[b + 1], X[c + 1]);
    const z0 = Math.min(X[a + 2], X[b + 2], X[c + 2]);
    const x1 = Math.max(X[a], X[b], X[c]), y1 = Math.max(X[a + 1], X[b + 1], X[c + 1]);
    const z1 = Math.max(X[a + 2], X[b + 2], X[c + 2]);
    box[6 * t] = x0; box[6 * t + 1] = y0; box[6 * t + 2] = z0;
    box[6 * t + 3] = x1; box[6 * t + 4] = y1; box[6 * t + 5] = z1;
    if (x0 < ox) ox = x0; if (y0 < oy) oy = y0; if (z0 < oz) oz = z0;
    if (x1 > ex) ex = x1; if (y1 > ey) ey = y1; if (z1 > ez) ez = z1;
  }
  const extent = Math.max(ex - ox, ey - oy, ez - oz);
  if (!(h > 0) || !Number.isFinite(h)) h = extent > 0 && Number.isFinite(extent) ? extent / 16 : 1;
  if (!Number.isFinite(ox)) ox = 0;
  if (!Number.isFinite(oy)) oy = 0;
  if (!Number.isFinite(oz)) oz = 0;

  // Coarsen the grid until it is a sensible size: one stretched triangle must not fill the table.
  let total = 0, inv = 1 / h;
  for (let tries = 0; tries < 64; tries += 1) {
    total = 0;
    for (let t = 0; t < B; t += 1) {
      const i0 = Math.floor((box[6 * t] - ox) * inv), j0 = Math.floor((box[6 * t + 1] - oy) * inv);
      const k0 = Math.floor((box[6 * t + 2] - oz) * inv);
      const i1 = Math.floor((box[6 * t + 3] - ox) * inv), j1 = Math.floor((box[6 * t + 4] - oy) * inv);
      const k1 = Math.floor((box[6 * t + 5] - oz) * inv);
      const cells = (i1 - i0 + 1) * (j1 - j0 + 1) * (k1 - k0 + 1);
      if (cells >= 1) {
        cell[6 * t] = i0; cell[6 * t + 1] = j0; cell[6 * t + 2] = k0;
        cell[6 * t + 3] = i1; cell[6 * t + 4] = j1; cell[6 * t + 5] = k1;
        total += cells;
      } else {
        // a triangle with no finite box is in no cell, and so is never a candidate
        cell[6 * t] = 0; cell[6 * t + 1] = 0; cell[6 * t + 2] = 0;
        cell[6 * t + 3] = -1; cell[6 * t + 4] = -1; cell[6 * t + 5] = -1;
      }
    }
    if (total <= MAX_CELLS_PER_TRIANGLE * B) break;
    h *= 2;
    inv = 1 / h;
  }

  const bucket = s.bucket, mask = bucket.length - 2;
  bucket.fill(0);
  if (s.entries.length < total) s.entries = new Int32Array(Math.ceil(total * 1.5));
  const entries = s.entries;
  for (let t = 0; t < B; t += 1) {
    for (let i = cell[6 * t]; i <= cell[6 * t + 3]; i += 1)
      for (let j = cell[6 * t + 1]; j <= cell[6 * t + 4]; j += 1)
        for (let k = cell[6 * t + 2]; k <= cell[6 * t + 5]; k += 1) bucket[hash3(i, j, k) & mask] += 1;
  }
  for (let b = 1; b <= mask; b += 1) bucket[b] += bucket[b - 1];
  bucket[mask + 1] = total;
  for (let t = 0; t < B; t += 1) {
    for (let i = cell[6 * t]; i <= cell[6 * t + 3]; i += 1)
      for (let j = cell[6 * t + 1]; j <= cell[6 * t + 4]; j += 1)
        for (let k = cell[6 * t + 2]; k <= cell[6 * t + 5]; k += 1) entries[--bucket[hash3(i, j, k) & mask]] = t;
  }

  const stamp = s.stamp;
  if (s.stampBase + E + 1 > 0x7fffffff) { stamp.fill(0); s.stampBase = 1; }
  const stampBase = s.stampBase;
  s.stampBase += E;

  let count = 0;
  for (let e = 0; e < E; e += 1) {
    const lo = bandEdges[2 * e], lq = bandEdges[2 * e + 1];
    const o = 3 * lo, q = 3 * lq;
    const px = X[o], py = X[o + 1], pz = X[o + 2];
    const dx = X[q] - px, dy = X[q + 1] - py, dz = X[q + 2] - pz;
    const bx0 = Math.min(px, X[q]), by0 = Math.min(py, X[q + 1]), bz0 = Math.min(pz, X[q + 2]);
    const bx1 = Math.max(px, X[q]), by1 = Math.max(py, X[q + 1]), bz1 = Math.max(pz, X[q + 2]);
    const i0 = Math.floor((bx0 - ox) * inv), j0 = Math.floor((by0 - oy) * inv), k0 = Math.floor((bz0 - oz) * inv);
    const i1 = Math.floor((bx1 - ox) * inv), j1 = Math.floor((by1 - oy) * inv), k1 = Math.floor((bz1 - oz) * inv);
    const mine = stampBase + e;
    for (let i = i0; i <= i1; i += 1)
      for (let j = j0; j <= j1; j += 1)
        for (let k = k0; k <= k1; k += 1) {
          const bk = hash3(i, j, k) & mask;
          for (let m = bucket[bk], end = bucket[bk + 1]; m < end; m += 1) {
            const t = entries[m];
            if (stamp[t] === mine) continue;
            stamp[t] = mine;
            const la = tris[3 * t], lb = tris[3 * t + 1], lc = tris[3 * t + 2];
            if (la === lo || la === lq || lb === lo || lb === lq || lc === lo || lc === lq) continue;
            const tb = 6 * t;
            if (box[tb] > bx1 || box[tb + 3] < bx0 || box[tb + 1] > by1 || box[tb + 4] < by0 ||
                box[tb + 2] > bz1 || box[tb + 5] < bz0) continue;
            // Moller-Trumbore on the segment o->q
            const a = 3 * la, b = 3 * lb, c = 3 * lc;
            const ax = X[a], ay = X[a + 1], az = X[a + 2];
            const e1x = X[b] - ax, e1y = X[b + 1] - ay, e1z = X[b + 2] - az;
            const e2x = X[c] - ax, e2y = X[c + 1] - ay, e2z = X[c + 2] - az;
            const qx = dy * e2z - dz * e2y, qy = dz * e2x - dx * e2z, qz = dx * e2y - dy * e2x;
            const det = e1x * qx + e1y * qy + e1z * qz;
            if (!(Math.abs(det) > DET_EPSILON)) continue;
            const id = 1 / det;
            const tx = px - ax, ty = py - ay, tz = pz - az;
            const u = (tx * qx + ty * qy + tz * qz) * id;
            if (u < 0 || u > 1) continue;
            const rx = ty * e1z - tz * e1y, ry = tz * e1x - tx * e1z, rz = tx * e1y - ty * e1x;
            const v = (dx * rx + dy * ry + dz * rz) * id;
            if (v < 0 || u + v > 1) continue;
            const along = (e2x * rx + e2y * ry + e2z * rz) * id;
            if (!(along > 0 && along < 1)) continue;
            count += 1;
            mark[lo] = 1; mark[lq] = 1; mark[la] = 1; mark[lb] = 1; mark[lc] = 1;
          }
        }
  }
  return count;
}

/**
 * Every local vertex within `rings` of a marked one (marked in `a`, or in `b` when given), written to `out` if it is
 * in the zone. Returns how many were written.
 */
function grow(
  p: CreasePrepared, zoneCount: number, a: Uint8Array, b: Uint8Array | null, rings: number, out: Uint32Array,
): number {
  const { off, nbr } = p, { queue, level } = p.scratch, n = level.length;
  let tail = 0;
  for (let i = 0; i < n; i += 1) if (a[i] || (b !== null && b[i])) { level[i] = 0; queue[tail++] = i; }
  for (let head = 0; head < tail; head += 1) {
    const i = queue[head], l = level[i];
    if (l >= rings) continue;
    for (let k = off[i]; k < off[i + 1]; k += 1) {
      const j = nbr[k];
      if (level[j] < 0) { level[j] = l + 1; queue[tail++] = j; }
    }
  }
  let count = 0;
  for (let k = 0; k < tail; k += 1) {
    const i = queue[k];
    level[i] = -1;
    if (i < zoneCount) out[count++] = i;
  }
  return count;
}

/**
 * Untangle, blend and reshade. `position` and `normal` are PER LOCAL VERTEX (3 floats each, local order = mesh.reps),
 * the current summed rest shape and its blended (not necessarily unit) normals.
 */
export function relaxCrease(
  mesh: CreaseMesh,
  position: ArrayLike<number>,
  normal: ArrayLike<number>,
  options: CreaseOptions = {},
): CreaseResult {
  const p = mesh.prepared, s = p.scratch, z = mesh.zoneCount, n = mesh.reps.length;
  if (position.length < 3 * n || normal.length < 3 * n) {
    throw new RangeError(`relaxCrease: expected ${3 * n} floats per array, one xyz per local vertex`);
  }
  const cap = options.cap ?? DEFAULT_CAP;
  const growRings = Math.max(0, Math.floor(options.grow ?? DEFAULT_GROW));
  const smoothPasses = Math.max(0, Math.floor(options.smooth ?? DEFAULT_SMOOTH));
  const rounds = Math.max(0, Math.floor(options.rounds ?? DEFAULT_ROUNDS));
  const strayDeg = options.strayDeg ?? DEFAULT_STRAY_DEG;
  const strayMarginDeg = options.strayMarginDeg ?? DEFAULT_STRAY_MARGIN_DEG;
  const sharpTau = options.sharpTau ?? DEFAULT_SHARP_TAU;
  const blendRings = Math.max(0, Math.floor(options.blendRings ?? DEFAULT_BLEND_RINGS));
  const blendIters = Math.max(0, Math.floor(options.blendIters ?? DEFAULT_BLEND_ITERS));
  const blendLambda = options.blendLambda ?? DEFAULT_BLEND_LAMBDA;
  const blendCap = options.blendCap ?? DEFAULT_BLEND_CAP;
  const { X, P, M, G, Nu, w, foldMark, crossMark, touched, kappa, act, dist, queue } = s;
  const { off, nbr, tris, e0, kappa0 } = p;

  for (let k = 0; k < 3 * n; k += 1) { P[k] = position[k]; X[k] = P[k]; }

  // What is wrong as given.
  const foundFolds = folded(p, X, foldMark);
  const foundCrossings = crossings(p, X, crossMark);
  let folds = foundFolds, crosses = foundCrossings;
  let crossFresh = true;
  touched.fill(0);

  // Untangle: relax what is wrong and a ring or more round it toward the neighbours' mean, within the cap.
  let r = 0, rings = 1;
  while ((folds > 0 || (crossFresh && crosses > 0)) && r < rounds) {
    const nAct = grow(p, z, foldMark, crossFresh ? crossMark : null, rings, act);
    for (let k = 0; k < nAct; k += 1) touched[act[k]] = 1;
    for (let step = 0; step < JACOBI_STEPS; step += 1) {
      for (let k = 0; k < nAct; k += 1) {
        const i = act[k], o0 = off[i], o1 = off[i + 1];
        let sx = 0, sy = 0, sz = 0;
        for (let m = o0; m < o1; m += 1) { const j = 3 * nbr[m]; sx += X[j]; sy += X[j + 1]; sz += X[j + 2]; }
        const inv = 1 / Math.max(o1 - o0, 1);
        M[3 * k] = sx * inv; M[3 * k + 1] = sy * inv; M[3 * k + 2] = sz * inv;
      }
      for (let k = 0; k < nAct; k += 1) {
        const i = 3 * act[k];
        X[i] = 0.5 * X[i] + 0.5 * M[3 * k];
        X[i + 1] = 0.5 * X[i + 1] + 0.5 * M[3 * k + 1];
        X[i + 2] = 0.5 * X[i + 2] + 0.5 * M[3 * k + 2];
      }
    }
    for (let i = 0; i < z; i += 1) {
      const dx = X[3 * i] - P[3 * i], dy = X[3 * i + 1] - P[3 * i + 1], dz = X[3 * i + 2] - P[3 * i + 2];
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l > cap) {
        const f = cap / l;
        X[3 * i] = P[3 * i] + dx * f; X[3 * i + 1] = P[3 * i + 1] + dy * f; X[3 * i + 2] = P[3 * i + 2] + dz * f;
      }
    }
    folds = folded(p, X, foldMark);
    // The crossing test is the dear one: every fifth round, and always before the loop may stop on no folds.
    if (r % 5 === 4 || folds === 0) { crosses = crossings(p, X, crossMark); crossFresh = true; } else crossFresh = false;
    r += 1;
    if (r % 10 === 0) rings += 1;
  }
  if (!crossFresh) crosses = crossings(p, X, crossMark);

  // Blend (Joshua, on the renders: "look less obvious and blend it more"). Untangled is not yet smooth: the crease
  // still reads as a seam where the repair moved skin and where the shapes pressed it sharper than the approved body.
  // Round those out by Taubin's lambda/mu smoothing, feathered over `blendRings`: each shrinking pass is followed by a
  // slightly stronger inflating one, which takes out ridges, pits and the crease's edge without shrinking her. The
  // approved body's own sharpness is the baseline, so skin as sharp as it was approved is left alone.
  if (blendIters > 0) {
    areaNormals(tris, z, X, G);
    curvature(off, nbr, z, X, G, kappa);
    dist.fill(blendRings + 1);
    let seeds = 0;
    for (let i = 0; i < z; i += 1) {
      const dx = X[3 * i] - P[3 * i], dy = X[3 * i + 1] - P[3 * i + 1], dz = X[3 * i + 2] - P[3 * i + 2];
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 0 || Math.abs(kappa[i]) - Math.abs(kappa0[i]) > sharpTau) {
        dist[i] = 0; queue[seeds++] = i;
      }
    }
    if (seeds > 0) {
      const nBlend = feather(p, z, seeds, blendRings, w, act);
      for (let it = 0; it < blendIters; it += 1) {
        for (let pass = 0; pass < 2; pass += 1) {
          const lambda = pass === 0 ? blendLambda : TAUBIN_MU * blendLambda;
          for (let k = 0; k < nBlend; k += 1) {
            const i = act[k], o0 = off[i], o1 = off[i + 1];
            let sx = 0, sy = 0, sz = 0;
            for (let m = o0; m < o1; m += 1) { const j = 3 * nbr[m]; sx += X[j]; sy += X[j + 1]; sz += X[j + 2]; }
            const inv = 1 / Math.max(o1 - o0, 1);
            M[3 * k] = sx * inv; M[3 * k + 1] = sy * inv; M[3 * k + 2] = sz * inv;
          }
          for (let k = 0; k < nBlend; k += 1) {
            const i = 3 * act[k], f = lambda * w[act[k]];
            X[i] += f * (M[3 * k] - X[i]);
            X[i + 1] += f * (M[3 * k + 1] - X[i + 1]);
            X[i + 2] += f * (M[3 * k + 2] - X[i + 2]);
          }
        }
      }
      for (let i = 0; i < z; i += 1) {
        const dx = X[3 * i] - P[3 * i], dy = X[3 * i + 1] - P[3 * i + 1], dz = X[3 * i + 2] - P[3 * i + 2];
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (l > blendCap) {
          const f = blendCap / l;
          X[3 * i] = P[3 * i] + dx * f; X[3 * i + 1] = P[3 * i + 1] + dy * f; X[3 * i + 2] = P[3 * i + 2] + dz * f;
        }
      }
      // what is still wrong is reported after the blend; the untangling is not run again
      folds = folded(p, X, foldMark);
      crosses = crossings(p, X, crossMark);
    }
  }

  // Shading: the surface's own normals, where the shape moved and where the blended normals stray from it.
  areaNormals(tris, z, X, G);
  for (let i = 0; i < n; i += 1) {
    const x = normal[3 * i], y = normal[3 * i + 1], zz = normal[3 * i + 2];
    const l = Math.max(Math.sqrt(x * x + y * y + zz * zz), 1e-12);
    Nu[3 * i] = x / l; Nu[3 * i + 1] = y / l; Nu[3 * i + 2] = zz / l;
    // a ring vertex sees only part of its surface, so it keeps the shading it was given
    if (i >= z) { G[3 * i] = Nu[3 * i]; G[3 * i + 1] = Nu[3 * i + 1]; G[3 * i + 2] = Nu[3 * i + 2]; }
  }

  // Seeds: whatever moved in the final shape, blend included, and every zone normal straying further than it did on
  // the approved body. What the untangling reached is kept as a seed too, so with the blend off the shading is
  // exactly what it was before the blend existed.
  dist.fill(growRings + 1);
  let tail = 0;
  for (let i = 0; i < z; i += 1) {
    const dx = X[3 * i] - P[3 * i], dy = X[3 * i + 1] - P[3 * i + 1], dz = X[3 * i + 2] - P[3 * i + 2];
    let seed = touched[i] === 1 || Math.sqrt(dx * dx + dy * dy + dz * dz) > 0;
    if (!seed) {
      const d = G[3 * i] * Nu[3 * i] + G[3 * i + 1] * Nu[3 * i + 1] + G[3 * i + 2] * Nu[3 * i + 2];
      const angle = Math.acos(d < -1 ? -1 : d > 1 ? 1 : d) * DEG;
      seed = angle > Math.max(strayDeg, e0[i] + strayMarginDeg);
    }
    if (seed) { dist[i] = 0; queue[tail++] = i; }
  }
  if (tail === 0) {
    return {
      vertices: new Uint32Array(0), offset: new Float32Array(0), normal: new Float32Array(0),
      found: { folds: foundFolds, crossings: foundCrossings }, left: { folds, crossings: crosses },
      rounds: r, moved: 0, shaded: 0, most: 0,
    };
  }
  // Feather the repair over `grow` rings, and smooth the surface's normals across the repaired stretch.
  const nw = feather(p, z, tail, growRings, w, act);
  for (let pass = 0; pass < smoothPasses; pass += 1) {
    for (let k = 0; k < nw; k += 1) {
      const i = act[k];
      let sx = 0, sy = 0, sz = 0;
      for (let m = off[i]; m < off[i + 1]; m += 1) { const j = 3 * nbr[m]; sx += G[j]; sy += G[j + 1]; sz += G[j + 2]; }
      const l = Math.max(Math.sqrt(sx * sx + sy * sy + sz * sz), 1e-12);
      M[3 * k] = sx / l; M[3 * k + 1] = sy / l; M[3 * k + 2] = sz / l;
    }
    for (let k = 0; k < nw; k += 1) {
      const i = 3 * act[k];
      G[i] = M[3 * k]; G[i + 1] = M[3 * k + 1]; G[i + 2] = M[3 * k + 2];
    }
  }

  // Write back to every unwelded copy of each zone vertex that moved or is reshaded.
  const { weldOff, weldList } = p;
  let moved = 0, shaded = 0, most = 0, out = 0;
  for (let i = 0; i < z; i += 1) {
    const dx = X[3 * i] - P[3 * i], dy = X[3 * i + 1] - P[3 * i + 1], dz = X[3 * i + 2] - P[3 * i + 2];
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l > 0) moved += 1;
    if (l > most) most = l;
    if (w[i] > 0) shaded += 1;
    if (l > 0 || w[i] > 0) out += weldOff[i + 1] - weldOff[i];
  }
  const vertices = new Uint32Array(out), offset = new Float32Array(3 * out), normalOut = new Float32Array(3 * out);
  let o = 0;
  for (let i = 0; i < z; i += 1) {
    const dx = X[3 * i] - P[3 * i], dy = X[3 * i + 1] - P[3 * i + 1], dz = X[3 * i + 2] - P[3 * i + 2];
    const wi = w[i];
    if (!(Math.sqrt(dx * dx + dy * dy + dz * dz) > 0 || wi > 0)) continue;
    let nx = NaN, ny = NaN, nz = NaN;
    if (wi > 0) {
      const bx = Nu[3 * i] * (1 - wi) + G[3 * i] * wi, by = Nu[3 * i + 1] * (1 - wi) + G[3 * i + 1] * wi;
      const bz = Nu[3 * i + 2] * (1 - wi) + G[3 * i + 2] * wi;
      const l = Math.max(Math.sqrt(bx * bx + by * by + bz * bz), 1e-12);
      nx = bx / l; ny = by / l; nz = bz / l;
    }
    for (let k = weldOff[i]; k < weldOff[i + 1]; k += 1) {
      vertices[o] = weldList[k];
      offset[3 * o] = dx; offset[3 * o + 1] = dy; offset[3 * o + 2] = dz;
      normalOut[3 * o] = nx; normalOut[3 * o + 1] = ny; normalOut[3 * o + 2] = nz;
      o += 1;
    }
  }

  return {
    vertices, offset, normal: normalOut,
    found: { folds: foundFolds, crossings: foundCrossings },
    left: { folds, crossings: crosses },
    rounds: r, moved, shaded, most,
  };
}
