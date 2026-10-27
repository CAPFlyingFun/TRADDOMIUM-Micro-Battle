/**
 * ONE PATTERN PIECE, MESHED FLAT (the procedural garment's third step; see `types.ts` for the whole chain).
 *
 * A piece arrives as a counter-clockwise outline of named edges, and with it the number of segments each edge is to be
 * cut into (`counts`, chosen by the seam planner so the two edges of a seam have the same number of points). It leaves
 * as triangles in its own plane whose boundary is EXACTLY those samples: nothing is ever inserted on the outline, so
 * a seam can weld one piece's edge to another's point for point.
 *
 * How, in order:
 *   1. The outline. Each edge is sampled uniformly by arc length (`sampleEdge`); consecutive edges share their corner.
 *      The sampled ring is checked: closed, counter-clockwise, not crossing itself.
 *   2. The seed. Interior points start on an equilateral lattice of the piece's spacing h, laid in COLUMNS h·√3/2
 *      apart with alternate columns shifted h/2. That is the brief's row lattice turned a quarter turn, and turned for a
 *      reason: column 0 sits on x = 0 with points every h, so the fold of a symmetric piece is a line of the lattice at
 *      the lattice's own spacing (rows put a point on x = 0 only every other row, h·√3 apart, and leave a half-spaced
 *      column h/2 off it). Column c is at x = c·h·√3/2, and columns c and -c carry the same offset, so the lattice is
 *      mirror-symmetric about x = 0.
 *      A lattice point is kept only if it stands at least max(0.5·h, 0.6·b) from the outline, b being the sample
 *      spacing of the outline segment nearest it. Closer than that, it would make a sliver with that segment.
 *   3. The spacing field. s(p) = min(h, min over the outline's segments of (b + 0.5·distance)): an edge cut finer than
 *      the interior asks for points of its own spacing beside it, growing by half the distance away, which keeps
 *      neighbouring triangles within about a factor 1.5 of each other.
 *   4. Delaunay (Bowyer-Watson on a triangle adjacency, below) of outline and seed; the triangles inside the outline
 *      are found by flooding in from the super-triangle without crossing an outline segment.
 *   5. Refinement, Ruppert-style but with the outline fixed: a triangle is BAD if its circumradius R exceeds
 *      SIZE_RATIO·s at its centroid (an equilateral triangle of side s has R = 0.577·s) or R / shortest edge exceeds
 *      QUALITY_RATIO (a smallest angle under about 22°). Its circumcentre is inserted, unless it falls outside the piece,
 *      inside the diametral circle of an outline segment (where Ruppert would split the segment, which we may not), or
 *      closer to the outline than max(0.5·s(p), 0.6·b); a triangle that is only too big tries its centroid instead.
 *      Because no inserted point ever enters an outline segment's diametral circle, every segment stays a Delaunay
 *      edge, and an insertion whose cavity would reach outside the piece is refused before it changes anything.
 *   6. Smoothing: a few Laplacian passes over interior points only, each move kept only if every triangle round the
 *      point stays counter-clockwise, its smallest angle does not get worse (or stays above 35°), and the point keeps
 *      its clearance from the outline. Then a fresh Delaunay of the moved points, and refinement again. (One round: a
 *      second bought no angle on the test shapes and cost half as much time again.)
 *   7. The check. Every outline segment must be the edge of exactly one kept triangle. If one is missing, the interior
 *      points inside its diametral circle are removed and the piece triangulated again; if it is still missing, or
 *      nothing was there to remove, this throws.
 *
 * A SYMMETRIC piece (cut on the fold) is meshed as its half x >= 0 and mirrored, so the result is exactly symmetric:
 * every point's mirror is a point, with x negated bit for bit, and the points on the fold have x === 0. The samples of
 * the -x side are computed as the +x side's, negated; an edge crossing the fold is sampled from its +x end to its
 * middle (its count must be even so the middle is a sample) and mirrored. The half's outline is the +x part of the ring
 * closed by the fold, whose points are the lattice's column 0 where the field allows h, and are graded by the field
 * towards the two outline points on x = 0.
 *
 * Plain TypeScript, no three, no DOM, no allocation worth mentioning beyond the arrays it returns; deterministic (the
 * same piece and counts give bit-identical arrays: no randomness, every loop in a fixed order). A piece of 0.5 × 0.7 m
 * at 12 mm is a few thousand points and a few tens of milliseconds in node.
 */
import type { PatternPiece, PieceMesh, Vec2 } from './types';

/** Corners that must coincide, and mirror images that must match, may differ by this much (metres). */
const CLOSE = 1e-7;
/** A seed lattice point must be this × h from the outline, at least. */
const SEED_CLEAR_H = 0.5;
/** Any interior point must be this × the nearest outline segment's spacing from the outline, at least. */
const CLEAR_SEGMENT = 0.6;
/** An inserted or smoothed point must be this × the spacing field from the outline, at least. */
const CLEAR_FIELD = 0.5;
/** A triangle is too big when its circumradius exceeds this × the field at its centroid (equilateral: 0.577). */
const SIZE_RATIO = 0.8;
/** A triangle is too thin when circumradius / shortest edge exceeds this: 1.25 is a smallest angle of about 23.6°. */
const QUALITY_RATIO = 1.25;
/** Smoothing may lower a point's worst angle only while that angle stays above this (sine of 35°). */
const SMOOTH_FREE_SIN = Math.sin((35 * Math.PI) / 180);
const SMOOTH_PASSES = 3;
const ROUNDS = 1;

// ---------------------------------------------------------------------------------------------------------------------
// Sampling an edge

/** The samples k = 0..last of `points` cut into `count` equal arc lengths (k = count is the polyline's end). */
function sampleRange(points: readonly Vec2[], count: number, last: number): [number, number][] {
  const n = points.length;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  const length = cum[n - 1];
  if (!(length > 0)) throw new Error('sampleEdge: the edge has no length');
  const out: [number, number][] = [[points[0][0], points[0][1]]];
  let seg = 0;
  for (let k = 1; k <= last; k++) {
    if (k === count) {
      out.push([points[n - 1][0], points[n - 1][1]]);
      break;
    }
    const t = (length * k) / count;
    while (seg < n - 2 && cum[seg + 1] < t) seg++;
    const span = cum[seg + 1] - cum[seg];
    const f = span > 0 ? (t - cum[seg]) / span : 0;
    const a = points[seg], b = points[seg + 1];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

/**
 * The points an edge is cut at: `count` segments of equal arc length along its polyline, count + 1 points, the first
 * and last exactly the polyline's ends. (A symmetric piece's samples are computed from its +x side and mirrored, so on
 * its -x side and on an edge crossing the fold they can differ from this in the last bit.)
 */
export function sampleEdge(points: readonly Vec2[], count: number): Vec2[] {
  if (!Number.isInteger(count) || count < 1) throw new Error(`sampleEdge: count must be a whole number >= 1 (got ${count})`);
  if (points.length < 2) throw new Error('sampleEdge: an edge needs at least 2 points');
  return sampleRange(points, count, count);
}

function polylineLength(points: readonly Vec2[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return length;
}

/** x mirrored about the fold, keeping 0 as +0 so fold points stay exactly 0. */
const flip = (x: number): number => (x === 0 ? 0 : -x);

// ---------------------------------------------------------------------------------------------------------------------
// The outline

/** The sampled outline: a closed ring, each segment's spacing, and where each edge's samples start in it. */
interface Outline {
  readonly x: number[];
  readonly y: number[];
  /** Per segment i -> i + 1: its edge's arc length / count. */
  readonly sp: number[];
  readonly start: number[];
  readonly count: number[];
}

function buildOutline(piece: PatternPiece, counts: ReadonlyMap<string, number>): Outline {
  const id = piece.id;
  const edges = piece.edges;
  if (edges.length === 0) throw new Error(`meshPiece(${id}): the piece has no edges`);
  const names = new Set<string>();
  const cnt: number[] = [];
  for (const e of edges) {
    if (names.has(e.name)) throw new Error(`meshPiece(${id}): two edges are named '${e.name}'`);
    names.add(e.name);
    const c = counts.get(e.name);
    if (c === undefined) throw new Error(`meshPiece(${id}): no count given for edge '${e.name}'`);
    if (!Number.isInteger(c) || c < 1) throw new Error(`meshPiece(${id}): edge '${e.name}' has count ${c}; it must be a whole number >= 1`);
    if (e.points.length < 2) throw new Error(`meshPiece(${id}): edge '${e.name}' has fewer than 2 points`);
    for (const p of e.points) if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) throw new Error(`meshPiece(${id}): edge '${e.name}' has a non-finite point`);
    cnt.push(c);
  }
  for (let k = 0; k < edges.length; k++) {
    const a = edges[k], b = edges[(k + 1) % edges.length];
    const p = a.points[a.points.length - 1], q = b.points[0];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) > CLOSE) {
      throw new Error(`meshPiece(${id}): the outline does not close: edge '${a.name}' ends at (${p[0]}, ${p[1]}) but '${b.name}' starts at (${q[0]}, ${q[1]})`);
    }
  }

  const samples: [number, number][][] = piece.symmetric ? symmetricSamples(piece, cnt) : edges.map((e, k) => sampleRange(e.points, cnt[k], cnt[k]));

  const x: number[] = [], y: number[] = [], sp: number[] = [], start: number[] = [];
  for (let k = 0; k < edges.length; k++) {
    start.push(x.length);
    const s = samples[k];
    const b = polylineLength(edges[k].points) / cnt[k];
    for (let i = 0; i < cnt[k]; i++) {
      x.push(s[i][0]);
      y.push(s[i][1]);
      sp.push(b);
    }
  }
  return { x, y, sp, start, count: cnt };
}

/**
 * The samples of a symmetric piece's edges, built so the -x side is the +x side negated exactly: an edge on the +x side
 * is sampled as it is, one on the -x side is its mirror partner's samples mirrored, one crossing the fold is sampled
 * from its +x end to its middle and mirrored.
 */
function symmetricSamples(piece: PatternPiece, cnt: number[]): [number, number][][] {
  const id = piece.id;
  const edges = piece.edges;
  const side: number[] = []; // +1, -1, 0 (crosses the fold)
  for (const e of edges) {
    let lo = Infinity, hi = -Infinity;
    for (const p of e.points) {
      lo = Math.min(lo, p[0]);
      hi = Math.max(hi, p[0]);
    }
    if (lo >= -CLOSE && hi <= CLOSE) throw new Error(`meshPiece(${id}): edge '${e.name}' lies on the fold x = 0, which a symmetric piece cannot have`);
    side.push(lo >= -CLOSE ? 1 : hi <= CLOSE ? -1 : 0);
  }
  const out: [number, number][][] = edges.map(() => []);
  for (let k = 0; k < edges.length; k++) {
    const e = edges[k], c = cnt[k], pts = e.points, n = pts.length;
    if (side[k] === 1) {
      const s = sampleRange(pts, c, c);
      for (const p of s) if (p[0] < CLOSE) p[0] = 0;
      out[k] = s;
    } else if (side[k] === 0) {
      if (c % 2 !== 0) throw new Error(`meshPiece(${id}): edge '${e.name}' crosses the fold, so its count must be even (got ${c})`);
      for (let i = 0; i < n; i++) {
        const p = pts[i], q = pts[n - 1 - i];
        if (Math.abs(p[0] + q[0]) > CLOSE || Math.abs(p[1] - q[1]) > CLOSE) throw new Error(`meshPiece(${id}): edge '${e.name}' crosses the fold but is not its own mirror image`);
      }
      const fromStart = pts[0][0] > 0;
      const half = sampleRange(fromStart ? pts : [...pts].reverse(), c, c / 2);
      half[c / 2][0] = 0;
      const s: [number, number][] = new Array(c + 1);
      for (let i = 0; i <= c / 2; i++) {
        const p = half[i];
        const m: [number, number] = [flip(p[0]), p[1]];
        if (fromStart) {
          s[i] = p;
          if (i < c / 2) s[c - i] = m;
        } else {
          s[c - i] = p;
          if (i < c / 2) s[i] = m;
        }
      }
      out[k] = s;
    }
  }
  const used = new Set<number>();
  for (let k = 0; k < edges.length; k++) {
    if (side[k] !== -1) continue;
    const e = edges[k], n = e.points.length;
    let partner = -1;
    for (let q = 0; q < edges.length && partner < 0; q++) {
      if (side[q] !== 1 || used.has(q) || edges[q].points.length !== n) continue;
      let match = true;
      for (let i = 0; i < n && match; i++) {
        const p = e.points[i], m = edges[q].points[n - 1 - i];
        match = Math.abs(p[0] + m[0]) <= CLOSE && Math.abs(p[1] - m[1]) <= CLOSE;
      }
      if (match) partner = q;
    }
    if (partner < 0) throw new Error(`meshPiece(${id}): edge '${e.name}' has no mirror image on the +x side`);
    if (cnt[partner] !== cnt[k]) throw new Error(`meshPiece(${id}): mirror edges '${edges[partner].name}' and '${e.name}' have different counts (${cnt[partner]}, ${cnt[k]})`);
    used.add(partner);
    const c = cnt[k], src = out[partner];
    const s: [number, number][] = [];
    for (let i = 0; i <= c; i++) s.push([flip(src[c - i][0]), src[c - i][1]]);
    out[k] = s;
  }
  for (let k = 0; k < edges.length; k++) {
    if (side[k] === 1 && !used.has(k)) throw new Error(`meshPiece(${id}): edge '${edges[k].name}' has no mirror image on the -x side`);
  }
  return out;
}

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/** Throws unless the ring has no zero-length segment, runs counter-clockwise and does not cross itself. */
function checkRing(x: readonly number[], y: readonly number[], what: string): void {
  const n = x.length;
  if (n < 3) throw new Error(`${what}: the outline has fewer than 3 points`);
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (x[i] === x[j] && y[i] === y[j]) throw new Error(`${what}: the outline has two samples on top of each other at (${x[i]}, ${y[i]})`);
    area += x[i] * y[j] - x[j] * y[i];
  }
  if (!(area > 0)) throw new Error(`${what}: the outline is not counter-clockwise (signed area ${area / 2})`);
  // Segments crossing: sorted by their left end, each compared only with those that start before it ends.
  const order = Array.from({ length: n }, (_, i) => i);
  const lo = (i: number): number => Math.min(x[i], x[(i + 1) % n]);
  const hi = (i: number): number => Math.max(x[i], x[(i + 1) % n]);
  order.sort((a, b) => lo(a) - lo(b) || a - b);
  for (let oi = 0; oi < n; oi++) {
    const i = order[oi], i1 = (i + 1) % n;
    const ihi = hi(i);
    for (let oj = oi + 1; oj < n; oj++) {
      const j = order[oj];
      if (lo(j) > ihi) break;
      const j1 = (j + 1) % n;
      if (j === i1 || i === j1) continue; // neighbours share a corner
      if (Math.max(y[i], y[i1]) < Math.min(y[j], y[j1]) || Math.max(y[j], y[j1]) < Math.min(y[i], y[i1])) continue;
      const d1 = orient(x[i], y[i], x[i1], y[i1], x[j], y[j]);
      const d2 = orient(x[i], y[i], x[i1], y[i1], x[j1], y[j1]);
      const d3 = orient(x[j], y[j], x[j1], y[j1], x[i], y[i]);
      const d4 = orient(x[j], y[j], x[j1], y[j1], x[i1], y[i1]);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        throw new Error(`${what}: the outline crosses itself near (${x[i]}, ${y[i]})`);
      }
      if ((d1 === 0 && onSegment(x[i], y[i], x[i1], y[i1], x[j], y[j])) || (d2 === 0 && onSegment(x[i], y[i], x[i1], y[i1], x[j1], y[j1]))
        || (d3 === 0 && onSegment(x[j], y[j], x[j1], y[j1], x[i], y[i])) || (d4 === 0 && onSegment(x[j], y[j], x[j1], y[j1], x[i1], y[i1]))) {
        throw new Error(`${what}: the outline touches itself near (${x[i]}, ${y[i]})`);
      }
    }
  }
}

const onSegment = (ax: number, ay: number, bx: number, by: number, px: number, py: number): boolean =>
  px >= Math.min(ax, bx) && px <= Math.max(ax, bx) && py >= Math.min(ay, by) && py <= Math.max(ay, by);

// ---------------------------------------------------------------------------------------------------------------------
// Segments in a grid: the nearest one, the spacing field, diametral circles

/**
 * A ring's segments bucketed in square cells. Every question asked of it only cares about segments within `cell` of
 * the point (the field reaches h once 0.5·distance >= h, so cell >= 2h; clearances and diametral circles are smaller
 * than the longest segment, so cell >= that), so the 3 × 3 cells round the point are enough.
 */
class SegmentGrid {
  private readonly ax: Float64Array;
  private readonly ay: Float64Array;
  private readonly bx: Float64Array;
  private readonly by: Float64Array;
  private readonly sp: Float64Array;
  private readonly x0: number;
  private readonly y0: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly first: Int32Array;
  private readonly items: Int32Array;
  /** Set by `nearest`: the distance to the nearest segment (Infinity if none within a cell) and its spacing. */
  dist = Infinity;
  near = 0;

  constructor(x: readonly number[], y: readonly number[], sp: readonly number[], readonly cell: number) {
    const n = x.length;
    this.ax = new Float64Array(n);
    this.ay = new Float64Array(n);
    this.bx = new Float64Array(n);
    this.by = new Float64Array(n);
    this.sp = Float64Array.from(sp);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.ax[i] = x[i];
      this.ay[i] = y[i];
      this.bx[i] = x[j];
      this.by[i] = y[j];
      minX = Math.min(minX, x[i]);
      minY = Math.min(minY, y[i]);
      maxX = Math.max(maxX, x[i]);
      maxY = Math.max(maxY, y[i]);
    }
    this.x0 = minX;
    this.y0 = minY;
    this.nx = Math.floor((maxX - minX) / cell) + 1;
    this.ny = Math.floor((maxY - minY) / cell) + 1;
    const cells = this.nx * this.ny;
    const tally = new Int32Array(cells + 1);
    const visit = (i: number, f: (c: number) => void): void => {
      const cx0 = this.cx(Math.min(this.ax[i], this.bx[i])), cx1 = this.cx(Math.max(this.ax[i], this.bx[i]));
      const cy0 = this.cy(Math.min(this.ay[i], this.by[i])), cy1 = this.cy(Math.max(this.ay[i], this.by[i]));
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) f(cy * this.nx + cx);
    };
    for (let i = 0; i < n; i++) visit(i, (c) => tally[c + 1]++);
    for (let c = 0; c < cells; c++) tally[c + 1] += tally[c];
    this.first = tally.slice();
    this.items = new Int32Array(tally[cells]);
    const fill = tally.slice();
    for (let i = 0; i < n; i++) visit(i, (c) => (this.items[fill[c]++] = i));
  }

  private cx(x: number): number {
    return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.x0) / this.cell)));
  }

  private cy(y: number): number {
    return Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.y0) / this.cell)));
  }

  private distTo(i: number, px: number, py: number): number {
    const ax = this.ax[i], ay = this.ay[i], dx = this.bx[i] - ax, dy = this.by[i] - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = px - ax - t * dx, ey = py - ay - t * dy;
    return Math.sqrt(ex * ex + ey * ey);
  }

  // The 3 × 3 cells round a point, set by `span` (loops are written out in each query: they are the hot path).
  private gx0 = 0;
  private gx1 = -1;
  private gy0 = 0;
  private gy1 = -1;

  private span(px: number, py: number): void {
    const fx = Math.floor((px - this.x0) / this.cell), fy = Math.floor((py - this.y0) / this.cell);
    this.gx0 = Math.max(0, fx - 1);
    this.gx1 = Math.min(this.nx - 1, fx + 1);
    this.gy0 = Math.max(0, fy - 1);
    this.gy1 = Math.min(this.ny - 1, fy + 1);
  }

  nearest(px: number, py: number): void {
    let best = Infinity, near = 0, bestI = -1;
    this.span(px, py);
    for (let cy = this.gy0; cy <= this.gy1; cy++) {
      for (let cx = this.gx0; cx <= this.gx1; cx++) {
        const c = cy * this.nx + cx;
        for (let k = this.first[c]; k < this.first[c + 1]; k++) {
          const i = this.items[k];
          const d = this.distTo(i, px, py);
          if (d < best || (d === best && i < bestI)) {
            best = d;
            near = this.sp[i];
            bestI = i;
          }
        }
      }
    }
    this.dist = best;
    this.near = near;
  }

  /** The spacing field: min(h, min over segments of (spacing + 0.5·distance)). */
  field(px: number, py: number, h: number): number {
    let s = h;
    this.span(px, py);
    for (let cy = this.gy0; cy <= this.gy1; cy++) {
      for (let cx = this.gx0; cx <= this.gx1; cx++) {
        const c = cy * this.nx + cx;
        for (let k = this.first[c]; k < this.first[c + 1]; k++) {
          const i = this.items[k];
          if (this.sp[i] >= s) continue;
          const v = this.sp[i] + 0.5 * this.distTo(i, px, py);
          if (v < s) s = v;
        }
      }
    }
    return s;
  }

  /** True when p is strictly inside some segment's diametral circle (it sees the segment at more than 90°). */
  encroaches(px: number, py: number): boolean {
    this.span(px, py);
    for (let cy = this.gy0; cy <= this.gy1; cy++) {
      for (let cx = this.gx0; cx <= this.gx1; cx++) {
        const c = cy * this.nx + cx;
        for (let k = this.first[c]; k < this.first[c + 1]; k++) {
          const i = this.items[k];
          if ((px - this.ax[i]) * (px - this.bx[i]) + (py - this.ay[i]) * (py - this.by[i]) < 0) return true;
        }
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Delaunay: Bowyer-Watson on a triangle adjacency

/**
 * Points 0..2 are the super-triangle's. Triangle t is v[3t..3t+2], counter-clockwise; nb[3t + e] is the triangle across
 * the edge opposite v[3t + e] (-1 outside the super-triangle). Freed slots are reused; `gen` counts reuses so a queued
 * triangle can tell it has been replaced.
 */
class Delaunay {
  readonly x: number[] = [];
  readonly y: number[] = [];
  readonly v: number[] = [];
  readonly nb: number[] = [];
  readonly alive: number[] = [];
  readonly inside: number[] = [];
  readonly gen: number[] = [];
  /** The triangles the last successful insertion made. */
  readonly made: number[] = [];
  private readonly free: number[] = [];
  private readonly mark: number[] = [];
  private stamp = 0;
  private last = 0;
  private readonly cav: number[] = [];
  private readonly ea: number[] = [];
  private readonly eb: number[] = [];
  private readonly en: number[] = [];

  constructor(minX: number, minY: number, maxX: number, maxY: number) {
    const d = Math.max(maxX - minX, maxY - minY, 1e-6);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    this.x.push(cx - 30 * d, cx + 30 * d, cx);
    this.y.push(cy - 15 * d, cy - 15 * d, cy + 30 * d);
    const t = this.alloc();
    this.v[0] = 0;
    this.v[1] = 1;
    this.v[2] = 2;
    this.nb[0] = this.nb[1] = this.nb[2] = -1;
    this.inside[t] = 0;
  }

  private alloc(): number {
    let t: number;
    if (this.free.length > 0) t = this.free.pop()!;
    else {
      t = this.alive.length;
      this.alive.push(0);
      this.inside.push(0);
      this.gen.push(0);
      this.mark.push(0);
      this.v.push(0, 0, 0);
      this.nb.push(-1, -1, -1);
    }
    this.alive[t] = 1;
    this.gen[t]++;
    return t;
  }

  /**
   * Which side of a -> b point p is on (> 0 left). Always evaluated with the lower index first and negated otherwise, so
   * the two triangles sharing an edge agree about p exactly: rounding cannot send a walk back and forth across it.
   */
  private side(a: number, b: number, px: number, py: number): number {
    const x = this.x, y = this.y;
    return a < b ? orient(x[a], y[a], x[b], y[b], px, py) : -orient(x[b], y[b], x[a], y[a], px, py);
  }

  private inCircle(t: number, px: number, py: number): boolean {
    const v = this.v, x = this.x, y = this.y;
    const a = v[3 * t], b = v[3 * t + 1], c = v[3 * t + 2];
    const adx = x[a] - px, ady = y[a] - py, bdx = x[b] - px, bdy = y[b] - py, cdx = x[c] - px, cdy = y[c] - py;
    const al = adx * adx + ady * ady, bl = bdx * bdx + bdy * bdy, cl = cdx * cdx + cdy * cdy;
    return adx * (bdy * cl - cdy * bl) - ady * (bdx * cl - cdx * bl) + al * (bdx * cdy - bdy * cdx) > 0;
  }

  /** The triangle containing p, walking from `hint`; -1 if p is outside the super-triangle. */
  locate(px: number, py: number, hint: number): number {
    const v = this.v;
    let t = hint >= 0 && this.alive[hint] ? hint : this.last;
    if (!this.alive[t]) t = this.alive.indexOf(1);
    for (let it = 0; it < 100_000; it++) {
      let next = -2;
      for (let k = 0; k < 3; k++) {
        const e = (k + it) % 3;
        const a = v[3 * t + ((e + 1) % 3)], b = v[3 * t + ((e + 2) % 3)];
        if (this.side(a, b, px, py) < 0) {
          next = this.nb[3 * t + e];
          break;
        }
      }
      if (next === -2) return t;
      if (next === -1) return -1;
      t = next;
    }
    // Unreachable for a valid triangulation; a last resort rather than a hang.
    for (let u = 0; u < this.alive.length; u++) {
      if (!this.alive[u]) continue;
      if (this.side(v[3 * u], v[3 * u + 1], px, py) >= 0 && this.side(v[3 * u + 1], v[3 * u + 2], px, py) >= 0 && this.side(v[3 * u + 2], v[3 * u], px, py) >= 0) return u;
    }
    return -1;
  }

  /**
   * Inserts point p (already in x, y). With `requireInside`, refuses (changing nothing) when the cavity would take in a
   * triangle that is not inside the piece; the new triangles get `insideFlag`. Returns false when p cannot be placed.
   */
  insert(p: number, hint: number, requireInside: boolean, insideFlag: number): boolean {
    const v = this.v, nb = this.nb, x = this.x, y = this.y, mark = this.mark;
    const px = x[p], py = y[p];
    const t0 = this.locate(px, py, hint);
    if (t0 < 0) return false;
    for (let k = 0; k < 3; k++) {
      const q = v[3 * t0 + k];
      if (x[q] === px && y[q] === py) return false;
    }
    const s = ++this.stamp;
    const cav = this.cav;
    cav.length = 0;
    cav.push(t0);
    mark[t0] = s;
    for (let q = 0; q < cav.length; q++) {
      const c = cav[q];
      for (let e = 0; e < 3; e++) {
        const n = nb[3 * c + e];
        if (n >= 0 && mark[n] !== s && this.inCircle(n, px, py)) {
          mark[n] = s;
          cav.push(n);
        }
      }
    }
    // Rounding can leave a cavity that p cannot see all of; growing it across any edge p is not strictly left of
    // makes it star-shaped again.
    for (let q = 0; q < cav.length; q++) {
      const c = cav[q];
      for (let e = 0; e < 3; e++) {
        const n = nb[3 * c + e];
        if (n >= 0 && mark[n] === s) continue;
        const a = v[3 * c + ((e + 1) % 3)], b = v[3 * c + ((e + 2) % 3)];
        if (this.side(a, b, px, py) <= 0) {
          if (n < 0) return false;
          mark[n] = s;
          cav.push(n);
        }
      }
    }
    if (requireInside) for (const c of cav) if (!this.inside[c]) return false;
    const ea = this.ea, eb = this.eb, en = this.en;
    ea.length = eb.length = en.length = 0;
    for (const c of cav) {
      for (let e = 0; e < 3; e++) {
        const n = nb[3 * c + e];
        if (n >= 0 && mark[n] === s) continue;
        ea.push(v[3 * c + ((e + 1) % 3)]);
        eb.push(v[3 * c + ((e + 2) % 3)]);
        en.push(n);
      }
    }
    for (const c of cav) {
      this.alive[c] = 0;
      this.free.push(c);
    }
    const made = this.made;
    made.length = 0;
    for (let k = 0; k < ea.length; k++) {
      const t = this.alloc();
      made.push(t);
      v[3 * t] = ea[k];
      v[3 * t + 1] = eb[k];
      v[3 * t + 2] = p;
      nb[3 * t + 2] = en[k];
      this.inside[t] = insideFlag;
      const n = en[k];
      if (n >= 0) {
        for (let e = 0; e < 3; e++) {
          if (v[3 * n + ((e + 1) % 3)] === eb[k] && v[3 * n + ((e + 2) % 3)] === ea[k]) {
            nb[3 * n + e] = t;
            break;
          }
        }
      }
    }
    // Triangle (a, b, p): across b -> p is the new triangle starting at b; across p -> a, the one ending at a.
    for (let k = 0; k < made.length; k++) {
      const t = made[k];
      for (let j = 0; j < made.length; j++) {
        if (ea[j] === eb[k]) nb[3 * t] = made[j];
        if (eb[j] === ea[k]) nb[3 * t + 1] = made[j];
      }
    }
    this.last = made[0];
    return true;
  }

  /** Adds a point and inserts it; removes it again and returns -1 if it could not be inserted. */
  tryInsert(px: number, py: number, hint: number, requireInside: boolean): number {
    const p = this.x.length;
    this.x.push(px);
    this.y.push(py);
    if (this.insert(p, hint, requireInside, 1)) return p;
    this.x.pop();
    this.y.pop();
    return -1;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Meshing a region: a fixed counter-clockwise ring and the points inside it

interface Region {
  /** The fixed outline (its points become mesh points 0..n-1, in order). */
  readonly x: readonly number[];
  readonly y: readonly number[];
  /** Per segment: the spacing for the clearance rule. */
  readonly sp: readonly number[];
  /** The ring's own segments (clearances, diametral circles). */
  readonly ring: SegmentGrid;
  /** The garment's real edges (the spacing field). */
  readonly field: SegmentGrid;
  readonly h: number;
  /** The lowest lattice column to seed from (1 for the half of a symmetric piece: column 0 is its fold). */
  readonly firstColumn: number;
  /** Names the piece in errors. */
  readonly what: string;
}

/** Interior lattice points inside the ring, clear of it. Column by column, so inside-ness is a sorted crossing list. */
function seed(r: Region): number[] {
  const { x, y, h } = r;
  const n = x.length;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, x[i]);
    maxX = Math.max(maxX, x[i]);
    minY = Math.min(minY, y[i]);
    maxY = Math.max(maxY, y[i]);
  }
  const dx = h * Math.sqrt(3) / 2;
  const out: number[] = [];
  const cross: number[] = [];
  for (let c = Math.max(r.firstColumn, Math.ceil(minX / dx)); c <= Math.floor(maxX / dx); c++) {
    const cx = c * dx;
    cross.length = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if ((x[i] <= cx) !== (x[j] <= cx)) cross.push(y[i] + ((cx - x[i]) * (y[j] - y[i])) / (x[j] - x[i]));
    }
    cross.sort((a, b) => a - b);
    const off = (Math.abs(c) % 2) * 0.5;
    for (let k = 0; k + 1 < cross.length; k += 2) {
      for (let j = Math.ceil(cross[k] / h - off); (j + off) * h <= cross[k + 1]; j++) {
        const py = (j + off) * h;
        if (py <= cross[k]) continue;
        r.ring.nearest(cx, py);
        if (r.ring.dist < Math.max(SEED_CLEAR_H * h, CLEAR_SEGMENT * r.ring.near)) continue;
        out.push(cx, py);
      }
    }
  }
  return out;
}

/** May an interior point stand at p? Clear of the outline by the field and the nearest segment, and in no diametral circle. */
function clear(r: Region, px: number, py: number): boolean {
  r.ring.nearest(px, py);
  const s = r.field.field(px, py, r.h);
  if (r.ring.dist < Math.max(CLEAR_FIELD * s, CLEAR_SEGMENT * r.ring.near)) return false;
  return !r.ring.encroaches(px, py);
}

/** Triangulates outline + interior from scratch, inserting in a snake order of cells so each walk is short. */
function triangulate(r: Region, ix: readonly number[], iy: readonly number[]): Delaunay {
  const nRing = r.x.length;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < nRing; i++) {
    minX = Math.min(minX, r.x[i]);
    maxX = Math.max(maxX, r.x[i]);
    minY = Math.min(minY, r.y[i]);
    maxY = Math.max(maxY, r.y[i]);
  }
  const d = new Delaunay(minX, minY, maxX, maxY);
  for (let i = 0; i < nRing; i++) {
    d.x.push(r.x[i]);
    d.y.push(r.y[i]);
  }
  for (let i = 0; i < ix.length; i++) {
    d.x.push(ix[i]);
    d.y.push(iy[i]);
  }
  const total = d.x.length - 3;
  const cell = 2 * r.h;
  const cols = Math.floor((maxX - minX) / cell) + 1;
  const key = new Float64Array(total);
  const order = new Int32Array(total);
  for (let k = 0; k < total; k++) {
    const row = Math.floor((d.y[k + 3] - minY) / cell);
    const col = Math.min(cols - 1, Math.max(0, Math.floor((d.x[k + 3] - minX) / cell)));
    key[k] = row * cols + (row % 2 === 0 ? col : cols - 1 - col);
    order[k] = k;
  }
  order.sort((a, b) => key[a] - key[b] || a - b);
  let hint = 0;
  for (let k = 0; k < total; k++) {
    const p = order[k] + 3;
    if (!d.insert(p, hint, false, 0)) throw new Error(`${r.what}: could not triangulate a point at (${d.x[p]}, ${d.y[p]})`);
    hint = d.made[0];
  }
  classify(d, nRing);
  return d;
}

/** Is a -> b (Delaunay indices) a segment of the ring (either way round)? */
function ringEdge(a: number, b: number, nRing: number): boolean {
  const i = a - 3, j = b - 3;
  if (i < 0 || j < 0 || i >= nRing || j >= nRing) return false;
  return j === (i + 1) % nRing || i === (j + 1) % nRing;
}

/** Marks the triangles inside the ring: everything the super-triangle's corners cannot reach without crossing it. */
function classify(d: Delaunay, nRing: number): void {
  const T = d.alive.length;
  const out = new Uint8Array(T);
  const stack: number[] = [];
  for (let t = 0; t < T; t++) {
    if (d.alive[t] && (d.v[3 * t] < 3 || d.v[3 * t + 1] < 3 || d.v[3 * t + 2] < 3)) {
      out[t] = 1;
      stack.push(t);
    }
  }
  while (stack.length > 0) {
    const t = stack.pop()!;
    for (let e = 0; e < 3; e++) {
      const n = d.nb[3 * t + e];
      if (n < 0 || out[n]) continue;
      if (ringEdge(d.v[3 * t + ((e + 1) % 3)], d.v[3 * t + ((e + 2) % 3)], nRing)) continue;
      out[n] = 1;
      stack.push(n);
    }
  }
  for (let t = 0; t < T; t++) d.inside[t] = d.alive[t] && !out[t] ? 1 : 0;
}

/** The ring segments that are not the edge (in their own direction) of exactly one inside triangle. */
function missingSegments(d: Delaunay, nRing: number): number[] {
  const seen = new Int32Array(nRing);
  for (let t = 0; t < d.alive.length; t++) {
    if (!d.inside[t]) continue;
    for (let e = 0; e < 3; e++) {
      const i = d.v[3 * t + e] - 3, j = d.v[3 * t + ((e + 1) % 3)] - 3;
      if (i >= 0 && i < nRing && j === (i + 1) % nRing) seen[i]++;
    }
  }
  const out: number[] = [];
  for (let i = 0; i < nRing; i++) if (seen[i] !== 1) out.push(i);
  return out;
}

const circumAndBad = { cx: 0, cy: 0, score: 0, thin: false };

/** Measures inside triangle t: its circumcentre, and score > 1 when it is bad (too big or too thin). */
function measure(r: Region, d: Delaunay, t: number): void {
  const a = d.v[3 * t], b = d.v[3 * t + 1], c = d.v[3 * t + 2];
  const ax = d.x[a], ay = d.y[a];
  const bx = d.x[b] - ax, by = d.y[b] - ay, cx = d.x[c] - ax, cy = d.y[c] - ay;
  const det = 2 * (bx * cy - by * cx);
  const b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (cy * b2 - by * c2) / det, uy = (bx * c2 - cx * b2) / det;
  const R = Math.sqrt(ux * ux + uy * uy);
  const ex = cx - bx, ey = cy - by;
  const shortest = Math.sqrt(Math.min(b2, c2, ex * ex + ey * ey));
  const s = r.field.field(ax + (bx + cx) / 3, ay + (by + cy) / 3, r.h);
  const size = R / (SIZE_RATIO * s), thin = R / shortest / QUALITY_RATIO;
  circumAndBad.cx = ax + ux;
  circumAndBad.cy = ay + uy;
  circumAndBad.score = Math.max(size, thin);
  circumAndBad.thin = thin > 1;
}

/** Inserts circumcentres (or centroids) of bad triangles until none can be fixed so, or the budget is spent. */
function refine(r: Region, d: Delaunay, budget: number): void {
  let queue: number[] = [];
  const scores: number[] = [];
  const enqueue = (t: number): void => {
    measure(r, d, t);
    if (circumAndBad.score > 1) {
      queue.push(t, d.gen[t]);
      scores.push(circumAndBad.score);
    }
  };
  for (let t = 0; t < d.alive.length; t++) if (d.inside[t]) enqueue(t);
  let inserted = 0;
  while (queue.length > 0 && inserted < budget) {
    const items = queue, itemScores = scores.slice();
    const order = Array.from({ length: itemScores.length }, (_, i) => i).sort((a, b) => itemScores[b] - itemScores[a] || items[2 * a] - items[2 * b]);
    queue = [];
    scores.length = 0;
    for (const o of order) {
      const t = items[2 * o];
      if (!d.alive[t] || d.gen[t] !== items[2 * o + 1] || !d.inside[t]) continue;
      measure(r, d, t);
      if (circumAndBad.score <= 1) continue;
      const thin = circumAndBad.thin;
      let p = -1;
      const ccx = circumAndBad.cx, ccy = circumAndBad.cy;
      if (clear(r, ccx, ccy)) {
        const at = d.locate(ccx, ccy, t);
        if (at >= 0 && d.inside[at]) p = d.tryInsert(ccx, ccy, at, true);
      }
      if (p < 0 && !thin) {
        const a = d.v[3 * t], b = d.v[3 * t + 1], c = d.v[3 * t + 2];
        const gx = (d.x[a] + d.x[b] + d.x[c]) / 3, gy = (d.y[a] + d.y[b] + d.y[c]) / 3;
        if (clear(r, gx, gy)) p = d.tryInsert(gx, gy, t, true);
      }
      if (p < 0) continue;
      inserted++;
      for (const m of d.made.slice()) enqueue(m);
      if (inserted >= budget) break;
    }
  }
}

/** sin of the smallest angle of triangle (a, b, c) given as coordinates; <= 0 when it is not counter-clockwise. */
function minSin(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const area2 = orient(ax, ay, bx, by, cx, cy);
  if (area2 <= 0) return area2;
  const ab = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
  const bc = (cx - bx) * (cx - bx) + (cy - by) * (cy - by);
  const ca = (ax - cx) * (ax - cx) + (ay - cy) * (ay - cy);
  // The smallest angle faces the shortest side: sin = 2·area / (product of the other two). (Squared lengths and one
  // square root: Math.hypot is several times slower and this runs a few hundred thousand times.)
  if (ab <= bc && ab <= ca) return area2 / Math.sqrt(bc * ca);
  if (bc <= ca) return area2 / Math.sqrt(ab * ca);
  return area2 / Math.sqrt(ab * bc);
}

/** Laplacian passes over the interior points (index >= 3 + ring), each move kept only if it does no harm. */
function smooth(r: Region, d: Delaunay): void {
  const N = d.x.length, fixed = 3 + r.x.length;
  const count = new Int32Array(N + 1);
  for (let t = 0; t < d.alive.length; t++) if (d.inside[t]) for (let k = 0; k < 3; k++) count[d.v[3 * t + k] + 1]++;
  for (let i = 0; i < N; i++) count[i + 1] += count[i];
  const tris = new Int32Array(count[N]);
  const fill = count.slice();
  for (let t = 0; t < d.alive.length; t++) if (d.inside[t]) for (let k = 0; k < 3; k++) tris[fill[d.v[3 * t + k]]++] = t;
  const x = d.x, y = d.y, v = d.v;
  // The smallest angle round point i, were it at (px, py).
  const worst = (i: number, px: number, py: number): number => {
    let w = Infinity;
    for (let k = count[i]; k < count[i + 1]; k++) {
      const t = tris[k];
      const k0 = v[3 * t] === i ? 0 : v[3 * t + 1] === i ? 1 : 2;
      const b = v[3 * t + ((k0 + 1) % 3)], c = v[3 * t + ((k0 + 2) % 3)];
      const sn = minSin(px, py, x[b], y[b], x[c], y[c]);
      if (sn < w) w = sn;
    }
    return w;
  };
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    for (let i = fixed; i < N; i++) {
      const k0 = count[i], k1 = count[i + 1];
      if (k1 === k0) continue;
      let sx = 0, sy = 0, m = 0;
      for (let k = k0; k < k1; k++) {
        const t = tris[k];
        for (let j = 0; j < 3; j++) {
          const q = v[3 * t + j];
          if (q === i) continue;
          sx += x[q];
          sy += y[q];
          m++;
        }
      }
      const nx = sx / m, ny = sy / m;
      const before = worst(i, x[i], y[i]);
      const after = worst(i, nx, ny);
      if (after <= 0 || (after < before && after < SMOOTH_FREE_SIN)) continue;
      if (!clear(r, nx, ny)) continue;
      x[i] = nx;
      y[i] = ny;
    }
  }
}

/** Meshes a region: returns its points (the ring's first, in order) and counter-clockwise triangles. */
function meshRegion(r: Region): { x: number[]; y: number[]; triangles: number[] } {
  const nRing = r.x.length;
  const s = seed(r);
  let ix: number[] = [], iy: number[] = [];
  for (let k = 0; k < s.length; k += 2) {
    ix.push(s[k]);
    iy.push(s[k + 1]);
  }
  let d = triangulate(r, ix, iy);
  const budget = 4 * (nRing + ix.length) + 1000;
  for (let round = 0; ; round++) {
    let missing = missingSegments(d, nRing);
    if (missing.length > 0) {
      // Take out the interior points standing in a missing segment's diametral circle and try once more.
      const drop = new Uint8Array(d.x.length);
      let any = false;
      for (const i of missing) {
        const j = (i + 1) % nRing;
        for (let p = 3 + nRing; p < d.x.length; p++) {
          if ((d.x[p] - r.x[i]) * (d.x[p] - r.x[j]) + (d.y[p] - r.y[i]) * (d.y[p] - r.y[j]) <= 0) {
            drop[p] = 1;
            any = true;
          }
        }
      }
      if (any) {
        const kx: number[] = [], ky: number[] = [];
        for (let p = 3 + nRing; p < d.x.length; p++) if (!drop[p]) kx.push(d.x[p]), ky.push(d.y[p]);
        d = triangulate(r, kx, ky);
        missing = missingSegments(d, nRing);
      }
      if (missing.length > 0) {
        const i = missing[0];
        throw new Error(`${r.what}: cannot make outline segment ${i} (${r.x[i]}, ${r.y[i]}) an edge of the mesh (${missing.length} such)`);
      }
    }
    refine(r, d, budget);
    if (round === ROUNDS) break;
    smooth(r, d);
    ix = d.x.slice(3 + nRing);
    iy = d.y.slice(3 + nRing);
    d = triangulate(r, ix, iy);
  }
  const triangles: number[] = [];
  for (let t = 0; t < d.alive.length; t++) if (d.inside[t]) triangles.push(d.v[3 * t] - 3, d.v[3 * t + 1] - 3, d.v[3 * t + 2] - 3);
  return { x: d.x.slice(3), y: d.y.slice(3), triangles };
}

// ---------------------------------------------------------------------------------------------------------------------
// The piece

/**
 * Mesh one pattern piece flat. `counts` gives, for EVERY edge of the piece by name, the number of SEGMENTS it is cut
 * into (so count + 1 points along it, both ends included). Throws an Error naming the problem for a malformed piece (an
 * edge missing from `counts`, a count < 1, an outline that does not close or is not counter-clockwise, a
 * self-intersecting outline; for a symmetric piece also an odd count on an edge crossing the fold, an edge without its
 * mirror image, or mirror edges with different counts).
 */
export function meshPiece(piece: PatternPiece, counts: ReadonlyMap<string, number>): PieceMesh {
  const what = `meshPiece(${piece.id})`;
  const h = piece.spacing;
  if (!(h > 0) || !Number.isFinite(h)) throw new Error(`${what}: spacing must be a positive number (got ${h})`);
  const ring = buildOutline(piece, counts);
  checkRing(ring.x, ring.y, what);
  const n = ring.x.length;
  let maxSp = 0;
  for (const b of ring.sp) maxSp = Math.max(maxSp, b);
  const cell = Math.max(2 * h, maxSp);
  const field = new SegmentGrid(ring.x, ring.y, ring.sp, cell);

  let px: number[], py: number[], tris: number[];
  /** Full ring index -> mesh point index. */
  let ringToPoint: (i: number) => number;

  if (!piece.symmetric) {
    const m = meshRegion({ x: ring.x, y: ring.y, sp: ring.sp, ring: field, field, h, firstColumn: -Infinity, what });
    px = m.x;
    py = m.y;
    tris = m.triangles;
    ringToPoint = (i) => i;
  } else {
    const zeros: number[] = [];
    for (let i = 0; i < n; i++) if (ring.x[i] === 0) zeros.push(i);
    if (zeros.length !== 2) throw new Error(`${what}: a symmetric piece's outline must meet x = 0 at exactly two samples (found ${zeros.length})`);
    const bot = ring.x[(zeros[0] + 1) % n] > 0 ? zeros[0] : zeros[1];
    const top = bot === zeros[0] ? zeros[1] : zeros[0];
    const chain = ((top - bot + n) % n) + 1;
    if (n !== 2 * (chain - 1)) throw new Error(`${what}: the outline is not mirror-symmetric (its two sides have different numbers of samples)`);
    for (let j = 1; j < chain - 1; j++) {
      const a = (bot + j) % n, b = (bot - j + n) % n;
      if (!(ring.x[a] > 0) || ring.x[b] !== -ring.x[a] || ring.y[b] !== ring.y[a]) throw new Error(`${what}: the outline is not mirror-symmetric near (${ring.x[a]}, ${ring.y[a]})`);
    }
    const yBot = ring.y[bot], yTop = ring.y[top];
    if (!(yBot < yTop)) throw new Error(`${what}: a symmetric piece's outline must cross x = 0 going right at the bottom and left at the top`);

    // The fold: column 0 of the lattice where it is clear of the real outline, graded by the field to its two ends.
    const anchors: number[] = [yBot];
    for (let j = Math.ceil(yBot / h); j * h < yTop; j++) {
      const fy = j * h;
      if (fy <= yBot) continue;
      field.nearest(0, fy);
      if (field.dist >= Math.max(SEED_CLEAR_H * h, CLEAR_SEGMENT * field.near)) anchors.push(fy);
    }
    anchors.push(yTop);
    const fold: number[] = [];
    for (let k = 0; k + 1 < anchors.length; k++) {
      const y0 = anchors[k], y1 = anchors[k + 1];
      const steps = Math.max(16, Math.ceil((y1 - y0) / (h / 32)));
      const cum = new Float64Array(steps + 1);
      let prev = 1 / field.field(0, y0, h);
      for (let i = 1; i <= steps; i++) {
        const cur = 1 / field.field(0, y0 + ((y1 - y0) * i) / steps, h);
        cum[i] = cum[i - 1] + ((prev + cur) / 2) * ((y1 - y0) / steps);
        prev = cur;
      }
      const parts = Math.max(1, Math.round(cum[steps]));
      let i = 0;
      for (let q = 1; q < parts; q++) {
        const target = (cum[steps] * q) / parts;
        while (cum[i + 1] < target) i++;
        const f = (target - cum[i]) / (cum[i + 1] - cum[i]);
        fold.push(y0 + ((y1 - y0) * (i + f)) / steps);
      }
      if (k + 1 < anchors.length - 1) fold.push(y1);
    }

    // The half's ring: the +x chain from the bottom fold point up to the top one, then down the fold.
    const hx: number[] = [], hy: number[] = [], hs: number[] = [];
    for (let j = 0; j < chain; j++) {
      const i = (bot + j) % n;
      hx.push(ring.x[i]);
      hy.push(ring.y[i]);
      if (j < chain - 1) hs.push(ring.sp[i]);
    }
    for (let k = fold.length - 1; k >= -1; k--) {
      const from = hy[hy.length - 1];
      const to = k >= 0 ? fold[k] : yBot;
      hs.push(from - to);
      if (k >= 0) {
        hx.push(0);
        hy.push(fold[k]);
      }
    }
    checkRing(hx, hy, `${what} (its +x half)`);
    const half = meshRegion({ x: hx, y: hy, sp: hs, ring: new SegmentGrid(hx, hy, hs, cell), field, h, firstColumn: 1, what });

    // Mirror: points with x > 0 get a twin with x negated; fold points are shared. Triangles mirror reversed.
    const H = half.x.length;
    const twin = new Int32Array(H);
    px = half.x.slice();
    py = half.y.slice();
    for (let i = 0; i < H; i++) {
      if (half.x[i] === 0) twin[i] = i;
      else {
        if (!(half.x[i] > 0)) throw new Error(`${what}: the half mesh has a point at x < 0`);
        twin[i] = px.length;
        px.push(-half.x[i]);
        py.push(half.y[i]);
      }
    }
    tris = half.triangles.slice();
    for (let k = 0; k < half.triangles.length; k += 3) tris.push(twin[half.triangles[k]], twin[half.triangles[k + 2]], twin[half.triangles[k + 1]]);
    ringToPoint = (i) => {
      const pos = (i - bot + n) % n;
      return pos < chain ? pos : twin[n - pos];
    };
  }

  const edgePoints = new Map<string, Uint32Array>();
  piece.edges.forEach((e, k) => {
    const c = ring.count[k];
    const idx = new Uint32Array(c + 1);
    for (let i = 0; i <= c; i++) idx[i] = ringToPoint((ring.start[k] + i) % n);
    edgePoints.set(e.name, idx);
  });
  return { piece: piece.id, points: Float64Array.from(interleave(px, py)), triangles: Uint32Array.from(tris), edgePoints };
}

function interleave(x: readonly number[], y: readonly number[]): number[] {
  const out = new Array<number>(2 * x.length);
  for (let i = 0; i < x.length; i++) {
    out[2 * i] = x[i];
    out[2 * i + 1] = y[i];
  }
  return out;
}

/** What a flat mesh is like: its smallest and largest angles (degrees), its edge lengths, its area. */
export interface PieceMeshQuality {
  readonly points: number;
  readonly triangles: number;
  readonly minAngleDeg: number;
  readonly maxAngleDeg: number;
  /** Triangles with an angle under 20 degrees. */
  readonly under20: number;
  readonly minEdge: number;
  readonly maxEdge: number;
  readonly area: number;
}

export function pieceMeshQuality(mesh: PieceMesh): PieceMeshQuality {
  const p = mesh.points, t = mesh.triangles;
  let minA = 180, maxA = 0, under20 = 0, minE = Infinity, maxE = 0, area = 0;
  for (let k = 0; k < t.length; k += 3) {
    const a = t[k], b = t[k + 1], c = t[k + 2];
    const ax = p[2 * a], ay = p[2 * a + 1], bx = p[2 * b], by = p[2 * b + 1], cx = p[2 * c], cy = p[2 * c + 1];
    const la = Math.hypot(cx - bx, cy - by), lb = Math.hypot(ax - cx, ay - cy), lc = Math.hypot(bx - ax, by - ay);
    area += orient(ax, ay, bx, by, cx, cy) / 2;
    const angle = (opp: number, s1: number, s2: number): number => (Math.acos(Math.max(-1, Math.min(1, (s1 * s1 + s2 * s2 - opp * opp) / (2 * s1 * s2)))) * 180) / Math.PI;
    const A = angle(la, lb, lc), B = angle(lb, la, lc), C = angle(lc, la, lb);
    const lo = Math.min(A, B, C), hi = Math.max(A, B, C);
    minA = Math.min(minA, lo);
    maxA = Math.max(maxA, hi);
    if (lo < 20) under20++;
    minE = Math.min(minE, la, lb, lc);
    maxE = Math.max(maxE, la, lb, lc);
  }
  return { points: p.length / 2, triangles: t.length / 3, minAngleDeg: minA, maxAngleDeg: maxA, under20, minEdge: minE, maxEdge: maxE, area };
}
