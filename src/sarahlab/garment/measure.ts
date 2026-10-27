/**
 * HER BODY, MEASURED (the procedural garment, 2026-10-26: a garment is drafted from her measurements, the way a real
 * one is, and not stretched over her).
 *
 * Everything a pattern drafter takes off a client with a tape measure, taken off her rest mesh instead:
 *   - a DRESS FORM: level slices of her trunk (everything that is not her arm), each the CONVEX outline of the slice seen
 *     from above -- the path a tape measure takes, bridging every hollow -- stacked every `step` metres;
 *   - her girths (bust, underbust, waist, high hip, hip, thigh, neck, the arm all the way down) and the landmarks a
 *     pattern is hung from (side, front and back neck points, shoulder points, armpits), and her height.
 *
 * How a slice is taken, because everything here is one: a plane is intersected with her triangles; each triangle the
 * plane crosses gives a segment whose two ends lie on two of its EDGES. An end is named by its mesh edge (the vertex
 * pair), so the two triangles sharing an edge give the same named point, and the segments chain into the loops of the
 * cross-section by those names (a union-find; nothing is matched by distance). That is what tells her arm's ring from
 * her trunk's at the same height, which is how the armpit is found. Horizontal cuts look their triangles up in a
 * y-bucketed index built once; the arm's cuts, square to its bones, run over the arm's triangles only.
 *
 * Her arm is told from the rest by `BodyInput.arm`, the share of each vertex her arm bones carry: a triangle is TRUNK
 * when at least two of its corners are under 0.5, and ARM when at least two are 0.5 or more.
 *
 * Approximations, named so nobody mistakes them for more:
 *   - an arm's outside length is |shoulder point - elbow| + |elbow - wrist| and its inside length |armpit - elbow| +
 *     |elbow - wrist|: straight lines between joints, not a tape laid over the deltoid or along the inner arm;
 *   - the side neck points are the trunk outline's extreme x points 1 cm above the neck base, where the neck base is the
 *     first height above her chest joint at which that outline is under NECK_WIDTH across;
 *   - the front neck point is on her midline 4.5 cm under the side neck points, the back one 1 cm over them (a bodice
 *     block's usual drops), and the neck girth is the trunk cut by the plane through all four, so it is only as good as
 *     those offsets: on her it reads 0.47 m, as wide as the level outline at the neck base;
 *   - girths are convex-hull perimeters, which is what a tape gives, not the slice's own (longer, wigglier) length;
 *   - the armpit is where the arm's own ring merges with the trunk's in a level cut, which on her A-posed mesh is about
 *     3.5 cm UNDER the fullest level of her bust, so the bust is searched from 0.12 m under the armpit to
 *     BUST_ABOVE_ARMPIT over it; the underbust is found by the change of slope under the breasts (`underbustOf`), not
 *     as a smallest girth, which would be her waist;
 *   - the thigh is taken at her pelvis joint less 0.10 m only if her legs have parted there; on her they part lower,
 *     and it is taken THIGH_BELOW_CROTCH under the crotch.
 *
 * Plain TypeScript, typed arrays, no three.js and no DOM (see types.ts). Units: rest metres.
 */
import type { ArmholeMeasure, ArmMeasure, BodyInput, BodyMeasure, DressForm, Girth, Vec3 } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Tunables

/** Height of one bucket of the horizontal-slice index, metres. */
const BUCKET = 0.005;
/** A trunk slice keeps only points within this of her midline (|x|), metres: her hanging hands stay out of the form. */
const TRUNK_HALF_WIDTH = 0.30;
/** Step of every girth and landmark scan, metres. */
const SCAN = 0.002;
/** The neck base: the first height above her chest joint where the trunk outline is narrower than this, metres. */
const NECK_WIDTH = 0.20;
/**
 * The bust is the largest trunk girth from 0.12 m under her armpit to this far ABOVE it: on her mesh, A-posed, the arm's
 * ring merges with the trunk's about 3.5 cm under the fullest level of her bust (1.245 m against 1.28 m).
 */
const BUST_ABOVE_ARMPIT = 0.06;
/** See `underbustOf`: a girth falling less than this many metres per metre of height is her ribcage, not her breasts. */
const UNDERBUST_SLOPE = 1;
/** Her thigh is measured this far under her crotch when her legs have not parted at her pelvis less 0.10 m, metres. */
const THIGH_BELOW_CROTCH = 0.02;
/** A leg's loop has its centre at least this far to her side, metres. */
const LEG_SIDE = 0.02;
/** The neck loop's centre is within this of the four neck points' mean, metres. */
const NECK_LOOP_REACH = 0.10;
/** The arm's girths are taken at this many fractions, 0 to 1 inclusive. */
const ARM_SAMPLES = 21;
/** An arm cut's loop must have its centre within this of the bone axis, metres. */
const ARM_LOOP_REACH = 0.08;
/** Points round a resampled outline (`hullAt`). */
const RESAMPLE = 128;
/** The dress form `measureBody` returns: from this height, every this many metres, to her height. */
const FORM_Y0 = 0.01;
const FORM_STEP = 0.01;

// ---------------------------------------------------------------------------------------------------------------------
// Small pure helpers (exported: the drafter wants them too)

/** Cross product of (b - a) and (c - a), 2D: positive when a, b, c turn counter-clockwise. */
function turn(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * The convex hull of 2D points given as (x, y) pairs (in this module, (x, z) seen from above, or a plane's own (u, v)).
 * Returned as (x, y) pairs, COUNTER-CLOCKWISE (x right, y up the page), starting at the point of largest x (of two
 * there, the lower, so the walk sets off upward). Collinear points are dropped. Andrew's monotone chain, O(n log n).
 */
export function convexHull2D(points: ArrayLike<number>): Float64Array {
  const n = points.length >> 1;
  if (n === 0) return new Float64Array(0);
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => (points[2 * a] - points[2 * b]) || (points[2 * a + 1] - points[2 * b + 1]));
  const hull = new Uint32Array(2 * n + 1);
  let k = 0;
  for (let i = 0; i < n; i++) { // lower chain
    const p = order[i];
    while (k >= 2 && turn(points[2 * hull[k - 2]], points[2 * hull[k - 2] + 1], points[2 * hull[k - 1]], points[2 * hull[k - 1] + 1], points[2 * p], points[2 * p + 1]) <= 0) k--;
    hull[k++] = p;
  }
  for (let i = n - 2, lower = k + 1; i >= 0; i--) { // upper chain
    const p = order[i];
    while (k >= lower && turn(points[2 * hull[k - 2]], points[2 * hull[k - 2] + 1], points[2 * hull[k - 1]], points[2 * hull[k - 1] + 1], points[2 * p], points[2 * p + 1]) <= 0) k--;
    hull[k++] = p;
  }
  const m = Math.max(1, k - 1); // the last point repeats the first
  // Start at the largest x, the lower of two: in a CCW walk the lower one of a vertical right edge comes first.
  let start = 0;
  for (let i = 1; i < m; i++) {
    const a = hull[i], b = hull[start];
    if (points[2 * a] > points[2 * b] || (points[2 * a] === points[2 * b] && points[2 * a + 1] < points[2 * b + 1])) start = i;
  }
  const out = new Float64Array(2 * m);
  for (let i = 0; i < m; i++) {
    const p = hull[(start + i) % m];
    out[2 * i] = points[2 * p];
    out[2 * i + 1] = points[2 * p + 1];
  }
  return out;
}

/** Length round a closed outline given as (x, y) pairs, metres (0 for fewer than 2 points). */
export function perimeter(outline: ArrayLike<number>): number {
  const n = outline.length >> 1;
  if (n < 2) return 0;
  let len = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) len += Math.hypot(outline[2 * i] - outline[2 * j], outline[2 * i + 1] - outline[2 * j + 1]);
  return len;
}

/**
 * Where the level plane at height `y` cuts her triangles: one segment per triangle it crosses, as (x0, z0, x1, z1)
 * quadruples. `keep`, when given, is one byte per triangle (non-zero: cut it). A vertex exactly at `y` counts as above
 * the plane, so a triangle touching it at one corner gives no segment and neighbours agree. A brute-force pass over
 * every triangle; `measureBody` and `dressForm` use a bucketed index instead, with the same arithmetic.
 */
export function sliceTriangles(positions: Float32Array, triangles: Uint32Array, keep: Uint8Array | null, y: number): Float64Array {
  const out: number[] = [];
  for (let t = 0; t < triangles.length / 3; t++) {
    if (keep !== null && keep[t] === 0) continue;
    crossTriangle(positions, triangles, t, 0, 1, 0, y, (ax, _ay, az, bx, _by, bz) => { out.push(ax, az, bx, bz); });
  }
  return Float64Array.from(out);
}

/**
 * The plane n . p = c crossing triangle t: calls `emit` with the segment's two 3D ends, and returns the two crossed
 * edges' (lo, hi) vertex pairs and interpolation factors through `edgeOut` when given. Returns false when it misses.
 */
function crossTriangle(
  positions: Float32Array, triangles: Uint32Array, t: number, nx: number, ny: number, nz: number, c: number,
  emit: (ax: number, ay: number, az: number, bx: number, by: number, bz: number, a0: number, a1: number, ta: number, b0: number, b1: number, tb: number) => void,
): boolean {
  const i0 = triangles[3 * t], i1 = triangles[3 * t + 1], i2 = triangles[3 * t + 2];
  const d0 = nx * positions[3 * i0] + ny * positions[3 * i0 + 1] + nz * positions[3 * i0 + 2] - c;
  const d1 = nx * positions[3 * i1] + ny * positions[3 * i1 + 1] + nz * positions[3 * i1 + 2] - c;
  const d2 = nx * positions[3 * i2] + ny * positions[3 * i2 + 1] + nz * positions[3 * i2 + 2] - c;
  const s0 = d0 >= 0, s1 = d1 >= 0, s2 = d2 >= 0;
  if (s0 === s1 && s1 === s2) return false;
  // The lone corner (the one on its own side) and the two edges out of it.
  let lone: number, p: number, q: number, dl: number, dp: number, dq: number;
  if (s0 !== s1 && s0 !== s2) { lone = i0; p = i1; q = i2; dl = d0; dp = d1; dq = d2; }
  else if (s1 !== s0 && s1 !== s2) { lone = i1; p = i2; q = i0; dl = d1; dp = d2; dq = d0; }
  else { lone = i2; p = i0; q = i1; dl = d2; dp = d0; dq = d1; }
  // Interpolate from the edge's LOWER vertex index so that both triangles sharing an edge compute the identical point.
  const at = (a: number, da: number, b: number, db: number): [number, number, number, number, number, number] => {
    const lo = a < b ? a : b, hi = a < b ? b : a, dlo = a < b ? da : db, dhi = a < b ? db : da;
    const f = dlo / (dlo - dhi);
    return [
      positions[3 * lo] + f * (positions[3 * hi] - positions[3 * lo]),
      positions[3 * lo + 1] + f * (positions[3 * hi + 1] - positions[3 * lo + 1]),
      positions[3 * lo + 2] + f * (positions[3 * hi + 2] - positions[3 * lo + 2]),
      lo, hi, f,
    ];
  };
  const a = at(lone, dl, p, dp), b = at(lone, dl, q, dq);
  emit(a[0], a[1], a[2], b[0], b[1], b[2], a[3], a[4], a[5], b[3], b[4], b[5]);
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Cuts and their loops

/** A cut: `n` segments, segment i from end 2i to end 2i + 1. */
interface Cut {
  readonly n: number;
  /** 3 per end: the point. */
  readonly p: Float64Array;
  /** 1 per end: her arm weight there, interpolated along the cut edge. */
  readonly w: Float64Array;
  /** 1 per end: the cut mesh edge, lo * vertexCount + hi (the name two triangles agree on). */
  readonly key: Float64Array;
}

/** One connected loop (or open chain) of a cut. */
interface Loop {
  /** Its segments' indices in the cut. */
  readonly segs: Int32Array;
  /** Mean of its ends. */
  readonly cx: number; readonly cy: number; readonly cz: number;
  /** Mean arm weight of its ends. */
  readonly arm: number;
}

/** Everything `measureBody` reads more than once: her triangles indexed by height, and which of them are trunk and arm. */
interface Body {
  readonly positions: Float32Array;
  readonly triangles: Uint32Array;
  readonly arm: Float32Array;
  readonly vertexCount: number;
  readonly yMin: number;
  readonly buckets: number;
  /** CSR: bucket b's triangles are list[start[b] .. start[b + 1]). */
  readonly start: Uint32Array;
  readonly list: Uint32Array;
  /** 1 per triangle: 1 when trunk (2+ corners arm < 0.5). */
  readonly trunk: Uint8Array;
  /** The arm triangles (2+ corners arm >= 0.5). */
  readonly armTris: Uint32Array;
  /**
   * Per vertex: the first vertex at exactly the same position. A model file splits a vertex wherever its UVs or normals
   * do, so two triangles either side of a UV seam share an edge in space but not in index; cuts name their points by
   * these welded indices, or every loop would break at every seam.
   */
  readonly weld: Uint32Array;
}

/** Per vertex, the first vertex at exactly its position (see Body.weld). */
function weldOf(positions: Float32Array): Uint32Array {
  const n = positions.length / 3;
  const weld = new Uint32Array(n);
  const bits = new Uint32Array(positions.buffer, positions.byteOffset, positions.length);
  const first = new Map<string, number>();
  for (let v = 0; v < n; v++) {
    const k = `${bits[3 * v]},${bits[3 * v + 1]},${bits[3 * v + 2]}`;
    const f = first.get(k);
    if (f === undefined) { first.set(k, v); weld[v] = v; } else weld[v] = f;
  }
  return weld;
}

function prepare(input: BodyInput): Body {
  const { positions, triangles, arm } = input;
  const tCount = triangles.length / 3;
  const vertexCount = positions.length / 3;
  let yMin = Infinity, yMax = -Infinity;
  for (let v = 0; v < vertexCount; v++) { const y = positions[3 * v + 1]; if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
  if (!(yMax >= yMin)) { yMin = 0; yMax = 0; }
  const buckets = Math.floor((yMax - yMin) / BUCKET) + 1;
  const lo = new Int32Array(tCount), hi = new Int32Array(tCount);
  const count = new Uint32Array(buckets + 1);
  const trunk = new Uint8Array(tCount);
  let armCount = 0;
  for (let t = 0; t < tCount; t++) {
    const a = triangles[3 * t], b = triangles[3 * t + 1], c = triangles[3 * t + 2];
    const ya = positions[3 * a + 1], yb = positions[3 * b + 1], yc = positions[3 * c + 1];
    lo[t] = Math.floor((Math.min(ya, yb, yc) - yMin) / BUCKET);
    hi[t] = Math.min(buckets - 1, Math.floor((Math.max(ya, yb, yc) - yMin) / BUCKET));
    for (let k = lo[t]; k <= hi[t]; k++) count[k + 1]++;
    const armCorners = (arm[a] >= 0.5 ? 1 : 0) + (arm[b] >= 0.5 ? 1 : 0) + (arm[c] >= 0.5 ? 1 : 0);
    if (armCorners <= 1) trunk[t] = 1; else armCount++;
  }
  const start = new Uint32Array(buckets + 1);
  for (let k = 0; k < buckets; k++) start[k + 1] = start[k] + count[k + 1];
  const fill = start.slice(0, buckets);
  const list = new Uint32Array(start[buckets]);
  const armTris = new Uint32Array(armCount);
  for (let t = 0, j = 0; t < tCount; t++) {
    for (let k = lo[t]; k <= hi[t]; k++) list[fill[k]++] = t;
    if (trunk[t] === 0) armTris[j++] = t;
  }
  return { positions, triangles, arm, vertexCount, yMin, buckets, start, list, trunk, armTris, weld: weldOf(positions) };
}

/** Cut `tris` (or the bucket of height c when `tris` is null and the plane is level) with n . p = c. */
function cut(body: Body, tris: Uint32Array | null, keep: Uint8Array | null, nx: number, ny: number, nz: number, c: number): Cut {
  let from = 0, to: number, source: Uint32Array;
  if (tris === null) {
    const k = Math.floor((c - body.yMin) / BUCKET);
    if (k < 0 || k >= body.buckets) return { n: 0, p: new Float64Array(0), w: new Float64Array(0), key: new Float64Array(0) };
    source = body.list; from = body.start[k]; to = body.start[k + 1];
  } else { source = tris; to = tris.length; }
  const p: number[] = [], w: number[] = [], key: number[] = [];
  const { arm, vertexCount, weld } = body;
  for (let i = from; i < to; i++) {
    const t = source[i];
    if (keep !== null && keep[t] === 0) continue;
    crossTriangle(body.positions, body.triangles, t, nx, ny, nz, c, (ax, ay, az, bx, by, bz, a0, a1, ta, b0, b1, tb) => {
      p.push(ax, ay, az, bx, by, bz);
      w.push(arm[a0] + ta * (arm[a1] - arm[a0]), arm[b0] + tb * (arm[b1] - arm[b0]));
      const a = weld[a0], b = weld[a1], c = weld[b0], d = weld[b1];
      key.push(a < b ? a * vertexCount + b : b * vertexCount + a, c < d ? c * vertexCount + d : d * vertexCount + c);
    });
  }
  return { n: p.length / 6, p: Float64Array.from(p), w: Float64Array.from(w), key: Float64Array.from(key) };
}

/** A level cut through the y-bucket index. */
const level = (body: Body, y: number, keep: Uint8Array | null): Cut => cut(body, null, keep, 0, 1, 0, y);

/** The cut's segments joined into loops by the mesh edges their ends lie on. */
function loops(c: Cut): Loop[] {
  const parent = new Int32Array(c.n);
  for (let i = 0; i < c.n; i++) parent[i] = i;
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const seen = new Map<number, number>();
  for (let e = 0; e < 2 * c.n; e++) {
    const s = e >> 1, k = c.key[e];
    const other = seen.get(k);
    if (other === undefined) seen.set(k, s);
    else { const a = find(s), b = find(other); if (a !== b) parent[a] = b; }
  }
  const groups = new Map<number, number[]>();
  for (let s = 0; s < c.n; s++) {
    const r = find(s);
    const g = groups.get(r);
    if (g) g.push(s); else groups.set(r, [s]);
  }
  const out: Loop[] = [];
  for (const segs of groups.values()) {
    let cx = 0, cy = 0, cz = 0, w = 0;
    for (const s of segs) for (let e = 2 * s; e < 2 * s + 2; e++) { cx += c.p[3 * e]; cy += c.p[3 * e + 1]; cz += c.p[3 * e + 2]; w += c.w[e]; }
    const m = 2 * segs.length;
    out.push({ segs: Int32Array.from(segs), cx: cx / m, cy: cy / m, cz: cz / m, arm: w / m });
  }
  return out;
}

/** The (x, z) of a cut's ends (all, or one loop's), optionally only those with |x| < halfWidth. */
function xz(c: Cut, segs: Int32Array | null, halfWidth = Infinity): Float64Array {
  const out: number[] = [];
  const add = (e: number): void => { const x = c.p[3 * e]; if (Math.abs(x) < halfWidth) out.push(x, c.p[3 * e + 2]); };
  if (segs === null) for (let e = 0; e < 2 * c.n; e++) add(e);
  else for (const s of segs) { add(2 * s); add(2 * s + 1); }
  return Float64Array.from(out);
}

/** Her trunk's outline at height y: the convex hull, seen from above, of the trunk cut within TRUNK_HALF_WIDTH of her midline. */
const trunkHull = (body: Body, y: number): Float64Array => convexHull2D(xz(level(body, y, body.trunk), null, TRUNK_HALF_WIDTH));

/** Largest minus smallest x of an outline. */
function width(outline: Float64Array): number {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < outline.length; i += 2) { if (outline[i] < lo) lo = outline[i]; if (outline[i] > hi) hi = outline[i]; }
  return outline.length === 0 ? 0 : hi - lo;
}

// ---------------------------------------------------------------------------------------------------------------------
// The dress form

function formOf(body: Body, y0: number, y1: number, step: number): DressForm {
  const n = Math.max(1, Math.floor((y1 - y0) / step + 1e-9) + 1);
  const hulls: Float64Array[] = [];
  for (let i = 0; i < n; i++) hulls.push(trunkHull(body, y0 + i * step));
  return { y0, step, hulls };
}

/**
 * Her trunk as a dress form (see DressForm): the trunk outline at y0, y0 + step, ... up to y1 (inclusive when it falls
 * on a step).
 */
export function dressForm(body: BodyInput, y0: number, y1: number, step: number): DressForm {
  return formOf(prepare(body), y0, y1, step);
}

/** The area centroid of a convex outline (the mean of its points when it has no area). */
function centroid(outline: ArrayLike<number>): [number, number] {
  const n = outline.length >> 1;
  let a = 0, cx = 0, cy = 0, mx = 0, my = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const x0 = outline[2 * j], y0 = outline[2 * j + 1], x1 = outline[2 * i], y1 = outline[2 * i + 1];
    const cr = x0 * y1 - x1 * y0;
    a += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr;
    mx += x1; my += y1;
  }
  if (Math.abs(a) < 1e-12) return [mx / Math.max(1, n), my / Math.max(1, n)];
  return [cx / (3 * a), cy / (3 * a)];
}

/** A convex outline resampled to RESAMPLE points, one on each ray from its centroid at angles 2 pi k / RESAMPLE. */
function resample(outline: Float64Array): Float64Array {
  const out = new Float64Array(2 * RESAMPLE);
  const n = outline.length >> 1;
  const [cx, cz] = centroid(outline);
  for (let k = 0; k < RESAMPLE; k++) {
    const a = (2 * Math.PI * k) / RESAMPLE, dx = Math.cos(a), dz = Math.sin(a);
    let best = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const px = outline[2 * i] - cx, pz = outline[2 * i + 1] - cz;
      const ex = outline[2 * j] - outline[2 * i], ez = outline[2 * j + 1] - outline[2 * i + 1];
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-15) continue;
      const t = (px * ez - pz * ex) / den, s = (px * dz - pz * dx) / den;
      if (s >= -1e-9 && s <= 1 + 1e-9 && t > best) best = t;
    }
    out[2 * k] = cx + best * dx;
    out[2 * k + 1] = cz + best * dz;
  }
  return out;
}

/**
 * The dress form's outline at height y: the two nearest levels each resampled to RESAMPLE points by angle about its
 * centroid, blended linearly, and rotated to start at the point of largest x (so it is CCW from largest x, like a
 * level). Below the first level or above the last, that level; where one of the two is empty, the other; where both
 * are, an empty array.
 */
export function hullAt(form: DressForm, y: number): Float64Array {
  const n = form.hulls.length;
  if (n === 0) return new Float64Array(0);
  const f = Math.min(n - 1, Math.max(0, (y - form.y0) / form.step));
  const i = Math.min(n - 1, Math.floor(f)), j = Math.min(n - 1, i + 1), u = f - i;
  const a = form.hulls[i], b = form.hulls[j];
  const okA = a.length >= 6, okB = b.length >= 6;
  if (!okA && !okB) return new Float64Array(0);
  const ra = okA ? resample(a) : resample(b), rb = okB ? resample(b) : ra;
  const mixed = new Float64Array(2 * RESAMPLE);
  for (let k = 0; k < 2 * RESAMPLE; k++) mixed[k] = ra[k] + u * (rb[k] - ra[k]);
  let start = 0;
  for (let k = 1; k < RESAMPLE; k++) if (mixed[2 * k] > mixed[2 * start]) start = k;
  const out = new Float64Array(2 * RESAMPLE);
  for (let k = 0; k < RESAMPLE; k++) {
    const s = (start + k) % RESAMPLE;
    out[2 * k] = mixed[2 * s];
    out[2 * k + 1] = mixed[2 * s + 1];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The measurements

/** The girth (trunk outline perimeter) at y, remembered: the scans below revisit heights. */
function girthReader(body: Body): (y: number) => number {
  const memo = new Map<number, number>();
  return (y: number): number => {
    const key = Math.round(y * 1e6);
    let g = memo.get(key);
    if (g === undefined) { g = perimeter(trunkHull(body, y)); memo.set(key, g); }
    return g;
  };
}

/** The largest (or smallest) girth between two heights, scanned every SCAN metres. */
function scan(girth: (y: number) => number, from: number, to: number, largest: boolean): Girth {
  const lo = Math.min(from, to), hi = Math.max(from, to);
  let best: Girth = { y: lo, girth: girth(lo) };
  for (let y = lo + SCAN; y <= hi + 1e-9; y += SCAN) {
    const g = girth(y);
    if (largest ? g > best.girth : g < best.girth) best = { y, girth: g };
  }
  return best;
}

/**
 * Her underbust: the level where her breasts end and her ribcage begins. Going down from the bust, the girth first falls
 * steeply (the underside of the breasts) and then gently (the ribcage tapering to the waist); the underbust is the
 * first level below the steepest fall at which it falls less than UNDERBUST_SLOPE metres per metre of height, measured
 * over a centimetre. Searched within 0.15 m under the bust; where no fall is steeper than that (a body with no bust),
 * the smallest girth there.
 */
function underbustOf(girth: (y: number) => number, bustY: number): Girth {
  const slope = (y: number): number => (girth(y) - girth(y - 0.01)) / 0.01;
  let steepest = bustY, most = -Infinity;
  for (let y = bustY; y >= bustY - 0.15 + 0.01; y -= SCAN) { const s = slope(y); if (s > most) { most = s; steepest = y; } }
  if (most > UNDERBUST_SLOPE) {
    for (let y = steepest - SCAN; y >= bustY - 0.15 + 0.01; y -= SCAN) if (slope(y) < UNDERBUST_SLOPE) return { y, girth: girth(y) };
  }
  return scan(girth, bustY - 0.15, bustY, false);
}

/** True when the level cut of ALL her triangles at y still holds her arm on `side` as a loop of its own. */
function armSeparate(body: Body, y: number, side: 1 | -1): boolean {
  for (const l of loops(level(body, y, null))) if (l.arm > 0.5 && l.cx * side > 0) return true;
  return false;
}

/**
 * The highest height at which her arm on `side` is still its own loop, scanned up from her elbow every SCAN metres and
 * then bisected to a quarter of a millimetre. Her elbow's height when it never is (a body with no arm).
 */
function armpitHeight(body: Body, elbowY: number, shoulderY: number, side: 1 | -1): number {
  if (!armSeparate(body, elbowY, side)) return elbowY;
  let below = elbowY, above = shoulderY;
  for (let y = elbowY + SCAN; y <= shoulderY; y += SCAN) {
    if (armSeparate(body, y, side)) below = y; else { above = y; break; }
  }
  while (above - below > 0.00025) {
    const mid = (below + above) / 2;
    if (armSeparate(body, mid, side)) below = mid; else above = mid;
  }
  return below;
}

/** The outline's extreme point toward `side` in x, as [x, z]. */
function extremeX(outline: Float64Array, side: 1 | -1): [number, number] {
  let best = -1;
  for (let i = 0; i < outline.length; i += 2) if (best < 0 || outline[i] * side > outline[best] * side) best = i;
  return best < 0 ? [0, 0] : [outline[best], outline[best + 1]];
}

/** On the trunk cut at y, the largest (front) or smallest (back) z where it crosses her midline x = 0. */
function midlineZ(body: Body, y: number, front: boolean): number {
  const c = level(body, y, body.trunk);
  let best = front ? -Infinity : Infinity;
  for (let s = 0; s < c.n; s++) {
    const ax = c.p[6 * s], az = c.p[6 * s + 2], bx = c.p[6 * s + 3], bz = c.p[6 * s + 5];
    if ((ax < 0) === (bx < 0) || ax === bx) continue;
    const z = az + (bz - az) * (-ax / (bx - ax));
    if (front ? z > best : z < best) best = z;
  }
  if (Number.isFinite(best)) return best;
  for (let e = 0; e < 2 * c.n; e++) { // nothing crosses it exactly: the nearest ends
    if (Math.abs(c.p[3 * e]) >= 0.01) continue;
    const z = c.p[3 * e + 2];
    if (front ? z > best : z < best) best = z;
  }
  return Number.isFinite(best) ? best : 0;
}

/** The topmost vertex with |x - X| < 0.01 and z within 0.04 of `z0`. */
function topAt(body: Body, X: number, z0: number): Vec3 {
  const p = body.positions;
  let best = -1;
  for (let v = 0; v < body.vertexCount; v++) {
    if (Math.abs(p[3 * v] - X) >= 0.01 || Math.abs(p[3 * v + 2] - z0) >= 0.04) continue;
    if (best < 0 || p[3 * v + 1] > p[3 * best + 1]) best = v;
  }
  return best < 0 ? [X, 0, z0] : [p[3 * best], p[3 * best + 1], p[3 * best + 2]];
}

type V3 = [number, number, number];
const sub = (a: Vec3, b: Vec3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));

/**
 * The convex-hull perimeter of a plane cut's loop nearest `centre` (its ends' mean within `reach` of it), measured in
 * the plane; 0 when none is.
 */
function loopGirth(c: Cut, n: Vec3, centre: Vec3, reach: number): number {
  let best: Loop | null = null, bestD = reach;
  for (const l of loops(c)) {
    const d = dist([l.cx, l.cy, l.cz], centre);
    if (d < bestD) { best = l; bestD = d; }
  }
  if (best === null) return 0;
  // A basis of the plane: u square to n (from whichever axis n is least along), v = n x u.
  const ax: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const d = ax[0] * n[0] + ax[1] * n[1] + ax[2] * n[2];
  const u = unit([ax[0] - d * n[0], ax[1] - d * n[1], ax[2] - d * n[2]]);
  const v: V3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const pts = new Float64Array(4 * best.segs.length);
  let k = 0;
  for (const s of best.segs) for (let e = 2 * s; e < 2 * s + 2; e++) {
    const x = c.p[3 * e], y = c.p[3 * e + 1], z = c.p[3 * e + 2];
    pts[k++] = x * u[0] + y * u[1] + z * u[2];
    pts[k++] = x * v[0] + y * v[1] + z * v[2];
  }
  return perimeter(convexHull2D(pts));
}

/** One arm measured from its joints (see ArmMeasure). */
function measureArm(body: Body, shoulder: Vec3, elbow: Vec3, wrist: Vec3, shoulderPoint: Vec3, armpit: Vec3): ArmMeasure {
  // Start on the upper arm's axis at her armpit's height.
  const drop = shoulder[1] - elbow[1];
  const f = drop > 1e-9 ? Math.min(1, Math.max(0, (shoulder[1] - armpit[1]) / drop)) : 0;
  const top: V3 = [shoulder[0] + f * (elbow[0] - shoulder[0]), shoulder[1] + f * (elbow[1] - shoulder[1]), shoulder[2] + f * (elbow[2] - shoulder[2])];
  const upper = dist(top, elbow), fore = dist(elbow, wrist), total = upper + fore;
  const du = unit(sub(elbow, top)), df = unit(sub(wrist, elbow));
  const girths: number[] = [];
  for (let i = 0; i < ARM_SAMPLES; i++) {
    const s = (i / (ARM_SAMPLES - 1)) * total;
    let at: V3, n: V3;
    if (s < upper - 1e-9) {
      at = [top[0] + du[0] * s, top[1] + du[1] * s, top[2] + du[2] * s]; n = du;
    } else if (s > upper + 1e-9) {
      const r = s - upper;
      at = [elbow[0] + df[0] * r, elbow[1] + df[1] * r, elbow[2] + df[2] * r]; n = df;
    } else {
      at = [elbow[0], elbow[1], elbow[2]]; n = unit([du[0] + df[0], du[1] + df[1], du[2] + df[2]]); // at the elbow: the bisector
    }
    const c = cut(body, body.armTris, null, n[0], n[1], n[2], n[0] * at[0] + n[1] * at[1] + n[2] * at[2]);
    girths.push(loopGirth(c, n, at, ARM_LOOP_REACH));
  }
  return {
    shoulder, elbow, wrist, girths,
    outsideLength: dist(shoulderPoint, elbow) + fore,
    insideLength: dist(armpit, elbow) + fore,
  };
}

/** On the level cut of all her triangles at y, the larger non-arm loop on her +x side: its girth, 0 when there is none. */
function thighAt(body: Body, y: number): number {
  const c = level(body, y, null);
  let best = 0;
  for (const l of loops(c)) {
    if (l.arm > 0.5 || l.cx <= LEG_SIDE) continue;
    const g = perimeter(convexHull2D(xz(c, l.segs)));
    if (g > best) best = g;
  }
  return best;
}

/**
 * Her thigh just below her crotch: at her pelvis joint's height less 0.10 m if her legs are already apart there;
 * otherwise scanned down to her crotch (the first height at which they are) and taken THIGH_BELOW_CROTCH under it.
 */
function thighOf(body: Body, pelvisY: number, kneeY: number): Girth {
  const first = pelvisY - 0.10;
  for (let y = first; y > kneeY; y -= SCAN) {
    if (thighAt(body, y) === 0) continue;
    const at = y === first ? y : y - THIGH_BELOW_CROTCH;
    return { y: at, girth: thighAt(body, at) };
  }
  return { y: first, girth: 0 };
}

/** Every triangle any part of which is between heights y0 and y1, once each. */
function trianglesBetween(body: Body, y0: number, y1: number): Uint32Array {
  const k0 = Math.max(0, Math.floor((y0 - body.yMin) / BUCKET)), k1 = Math.min(body.buckets - 1, Math.floor((y1 - body.yMin) / BUCKET));
  const mark = new Uint8Array(body.triangles.length / 3);
  const out: number[] = [];
  for (let k = k0; k <= k1; k++) for (let i = body.start[k]; i < body.start[k + 1]; i++) {
    const t = body.list[i];
    if (mark[t] === 0) { mark[t] = 1; out.push(t); }
  }
  return Uint32Array.from(out);
}

/**
 * Round the base of her neck through its four points: the trunk cut by the plane that holds the line between the side
 * neck points and the line from the back neck point to the front one (tilted down at the front, as a collar is), the
 * loop nearest the four points' mean, its convex-hull perimeter in that plane.
 */
function neckGirthOf(body: Body, side: readonly [Vec3, Vec3], front: Vec3, back: Vec3): number {
  const across = sub(side[0], side[1]), fb = sub(front, back);
  let n: V3 = unit([across[1] * fb[2] - across[2] * fb[1], across[2] * fb[0] - across[0] * fb[2], across[0] * fb[1] - across[1] * fb[0]]);
  if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
  const mid: V3 = [0, 0, 0];
  for (const p of [side[0], side[1], front, back]) { mid[0] += p[0] / 4; mid[1] += p[1] / 4; mid[2] += p[2] / 4; }
  const ys = [side[0][1], side[1][1], front[1], back[1]];
  const tris = trianglesBetween(body, Math.min(...ys) - 0.05, Math.max(...ys) + 0.05);
  const c = cut(body, tris, body.trunk, n[0], n[1], n[2], n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2]);
  return loopGirth(c, n, mid, NECK_LOOP_REACH);
}

/** Everything a pattern needs of her (see BodyMeasure). */
/** Angular bins round the shoulder the armhole's contour is averaged in. */
const ARMHOLE_BINS = 48;
/** The contour is read down to this far under her armpit (below it her arm's weight crosses half along her side). */
const ARMHOLE_BELOW = 0.04;
/** ...and no nearer her midline than this (her collarbones' skin is shared with her arm bones too), metres. */
const ARMHOLE_INNER = 0.05;

/**
 * Her armhole: the contour where her arm bones carry half of her skin, within 20 cm of the shoulder joint and no more
 * than ARMHOLE_BELOW under her armpit, gathered into angular bins round the line from her shoulder to her elbow (the median point of each bin), and
 * measured round. The top is the highest bin, the bottom the lowest; the front half is the one whose middle stands
 * further forward.
 */
function armholeOf(input: BodyInput, shoulder: Vec3, elbow: Vec3, floor: number): ArmholeMeasure {
  const { positions: P, triangles: T, arm: A } = input;
  const d = norm3([elbow[0] - shoulder[0], elbow[1] - shoulder[1], elbow[2] - shoulder[2]]);
  const u = norm3([d[1], -d[0], 0]); // d x (0,0,1)
  const w: Vec3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  const bins: Vec3[][] = Array.from({ length: ARMHOLE_BINS }, () => []);
  const seen = new Set<number>();
  for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) {
    let a = T[t + e], b = T[t + (e + 1) % 3];
    if (a > b) [a, b] = [b, a];
    const wa = A[a] - 0.5, wb = A[b] - 0.5;
    if (wa * wb >= 0) continue;
    const key = a * 4194304 + b; // vertex counts are far under 2^22
    if (seen.has(key)) continue;
    seen.add(key);
    const f = wa / (wa - wb);
    const p: Vec3 = [P[3 * a] + f * (P[3 * b] - P[3 * a]), P[3 * a + 1] + f * (P[3 * b + 1] - P[3 * a + 1]), P[3 * a + 2] + f * (P[3 * b + 2] - P[3 * a + 2])];
    const r: Vec3 = [p[0] - shoulder[0], p[1] - shoulder[1], p[2] - shoulder[2]];
    if (Math.hypot(r[0], r[1], r[2]) > 0.2 || p[1] < floor || p[0] * Math.sign(shoulder[0]) < ARMHOLE_INNER) continue;
    const ang = Math.atan2(r[0] * w[0] + r[1] * w[1] + r[2] * w[2], r[0] * u[0] + r[1] * u[1] + r[2] * u[2]);
    bins[Math.min(ARMHOLE_BINS - 1, Math.floor(((ang + Math.PI) / (2 * Math.PI)) * ARMHOLE_BINS))].push(p);
  }
  const median = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
  const loop: Vec3[] = bins.filter((b) => b.length > 0).map((b) => [median(b.map((q) => q[0])), median(b.map((q) => q[1])), median(b.map((q) => q[2]))]);
  const n = loop.length;
  if (n < 4) return { loop: 0, front: 0, back: 0 };
  const seg = loop.map((q, i) => { const r = loop[(i + 1) % n]; return Math.hypot(r[0] - q[0], r[1] - q[1], r[2] - q[2]); });
  let top = 0, bottom = 0;
  for (let i = 1; i < n; i++) { if (loop[i][1] > loop[top][1]) top = i; if (loop[i][1] < loop[bottom][1]) bottom = i; }
  const arc = (i: number, j: number) => { let s = 0; for (let k = i; k !== j; k = (k + 1) % n) s += seg[k]; return s; };
  const one = arc(top, bottom), other = arc(bottom, top);
  const zMid = (i: number, j: number) => loop[(i + Math.floor(((j - i + n) % n) / 2)) % n][2];
  const oneIsFront = zMid(top, bottom) > zMid(bottom, top);
  return { loop: one + other, front: oneIsFront ? one : other, back: oneIsFront ? other : one };
}

function norm3(a: Vec3): Vec3 { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

export function measureBody(input: BodyInput): BodyMeasure {
  const body = prepare(input);
  const J = input.joints;
  const girth = girthReader(body);

  let height = -Infinity;
  for (let v = 0; v < body.vertexCount; v++) if (input.positions[3 * v + 1] > height) height = input.positions[3 * v + 1];

  // Armpits: where each arm stops being a ring of its own, on the trunk outline's extreme there.
  const sides = [1, -1] as const;
  const armpit = sides.map((side, k): Vec3 => {
    const y = armpitHeight(body, J.elbow[k][1], J.shoulder[k][1], side);
    const [x, z] = extremeX(trunkHull(body, y), side);
    return [x, y, z];
  }) as unknown as [Vec3, Vec3];
  const armpitY = (armpit[0][1] + armpit[1][1]) / 2;

  const bust = scan(girth, armpitY + BUST_ABOVE_ARMPIT, armpitY - 0.12, true);
  const underbust = underbustOf(girth, bust.y);
  const waist = scan(girth, J.pelvis[1] + 0.02, underbust.y, false);
  const hip = scan(girth, J.knee[0][1] / 2 + J.knee[1][1] / 2 + 0.25, J.pelvis[1], true);
  const highHipY = (waist.y + hip.y) / 2;
  const highHip: Girth = { y: highHipY, girth: girth(highHipY) };

  // The neck base: the first height above her chest joint where her trunk outline is under NECK_WIDTH across.
  let neckBase = J.neck[1];
  for (let y = J.chest[1]; y <= J.head[1]; y += SCAN) if (width(trunkHull(body, y)) < NECK_WIDTH) { neckBase = y; break; }
  const sideY = neckBase + 0.01;
  const sideHull = trunkHull(body, sideY);
  const side = sides.map((s): Vec3 => { const [x, z] = extremeX(sideHull, s); return [x, sideY, z]; }) as unknown as [Vec3, Vec3];
  const front: Vec3 = [0, sideY - 0.045, midlineZ(body, sideY - 0.045, true)];
  const back: Vec3 = [0, sideY + 0.01, midlineZ(body, sideY + 0.01, false)];
  const neckGirth = neckGirthOf(body, side, front, back);

  const shoulderPoint = sides.map((s, k): Vec3 => topAt(body, J.shoulder[k][0] + 0.02 * s, J.shoulder[k][2])) as unknown as [Vec3, Vec3];

  const armhole = sides.map((_, k) => armholeOf(input, J.shoulder[k], J.elbow[k], armpit[k][1] - ARMHOLE_BELOW)) as unknown as [ArmholeMeasure, ArmholeMeasure];

  const arms = sides.map((_, k) => measureArm(body, J.shoulder[k], J.elbow[k], J.wrist[k], shoulderPoint[k], armpit[k])) as unknown as [ArmMeasure, ArmMeasure];

  const kneeY = (J.knee[0][1] + J.knee[1][1]) / 2;
  const thigh = thighOf(body, J.pelvis[1], kneeY);

  return {
    form: formOf(body, FORM_Y0, height, FORM_STEP),
    neck: { side, front, back, girth: neckGirth },
    shoulderPoint, armpit, armhole, bust, underbust, waist, highHip, hip, arms, thigh,
    kneeY,
    height,
  };
}
