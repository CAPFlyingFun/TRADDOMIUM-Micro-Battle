/**
 * SEWING THE PIECES INTO ONE SHEET (the procedural garment, 2026-10-26: "approach this as a modular garment system rather
 * than a single mesh being stretched").
 *
 * Three steps, in the order the garment needs them:
 *   1. `planSeams` decides, BEFORE anything is meshed, how many segments every outline edge is cut into. A seam only
 *      welds point for point if both its edges were cut the same number of times, so the count belongs to the seam, not
 *      to either edge; a piece cut on the fold is meshed as a half and mirrored, so an edge that crosses the fold needs
 *      an even count (a point on the fold) and an edge and its mirror twin need the same one. Those three rules are all
 *      "equal" or "even", so they are solved at once with a union-find over edges: every edge in a group takes the
 *      group's count. Nothing can then conflict, and no iteration is needed.
 *   2. `sew` welds the meshed pieces: a's edge point i to b's edge point (n - i), transitively, so the corner where three
 *      pieces meet becomes one particle. Only seam points are ever merged -- two points that merely lie close (a dart's
 *      lips, a tube's ends before sewing) stay two particles. Rest lengths come from the FLAT pieces, so the cloth
 *      simulation is told the garment's cut, not whatever shape it is laid out in.
 *   3. `validate` says, in numbers and in words, whether the sheet is one consistently wound, manifold piece of cloth
 *      with sane triangles and seams whose sides agree.
 *
 * Plain TypeScript, typed arrays, no three.js and no DOM (see types.ts).
 */
import type { GarmentReport, Opening, Pattern, PatternEdge, PatternPiece, PieceMesh, SewnGarment } from './types';

/** Key for an edge: `${piece}:${edge}`. */
export const edgeKey = (piece: string, edge: string): string => `${piece}:${edge}`;

/** Two pattern points closer than this (metres) are the same point, for the fold and mirror-twin tests. */
const SAME = 1e-7;
/** Seam sides whose lengths differ by more than this share of their mean are reported: too much ease to sew. */
const EASE_LIMIT = 0.05;
/** A triangle with an angle below this (degrees) is a sliver. */
const SLIVER_DEG = 15;

function polylineLength(points: readonly (readonly [number, number])[]): number {
  let len = 0;
  for (let k = 1; k < points.length; k++) {
    len += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
  }
  // Rounded so that an edge and its mirror twin, whose float sums can differ in the last bits, divide identically.
  return Math.round(len * 1e9) / 1e9;
}

/** True when the edge's two ends are mirror images about x = 0 (and not both on it): it crosses the fold. */
function crossesFold(edge: PatternEdge): boolean {
  const p = edge.points[0];
  const q = edge.points[edge.points.length - 1];
  return Math.abs(p[0] + q[0]) < SAME && Math.abs(p[1] - q[1]) < SAME && Math.abs(p[0]) >= SAME;
}

/**
 * True when `b` is `a` mirrored about x = 0. Reflection reverses orientation, so in a CCW outline the twin runs the
 * other way; both directions are accepted so a hand-built pattern is not held to that.
 */
function mirrorTwins(a: PatternEdge, b: PatternEdge): boolean {
  const n = a.points.length;
  if (b.points.length !== n) return false;
  const matches = (reversed: boolean): boolean => {
    for (let k = 0; k < n; k++) {
      const p = a.points[reversed ? n - 1 - k : k];
      const q = b.points[k];
      if (Math.abs(p[0] + q[0]) >= SAME || Math.abs(p[1] - q[1]) >= SAME) return false;
    }
    return true;
  };
  return matches(true) || matches(false);
}

/** A union-find over 0..n-1 with path halving; `find` returns the class's representative. */
class UnionFind {
  readonly parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(i: number): number {
    const p = this.parent;
    while (p[i] !== i) {
      p[i] = p[p[i]];
      i = p[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    // The smaller index wins, so representatives do not depend on the order seams are listed in.
    if (ra < rb) this.parent[rb] = ra;
    else if (rb < ra) this.parent[ra] = rb;
  }
}

function findEdge(pattern: Pattern, piece: string, edge: string, seam: string): PatternEdge {
  const p = pattern.pieces.find((x) => x.id === piece);
  if (!p) throw new Error(`seam '${seam}': no piece '${piece}'`);
  const e = p.edges.find((x) => x.name === edge);
  if (!e) throw new Error(`seam '${seam}': piece '${piece}' has no edge '${edge}'`);
  return e;
}

// ---------------------------------------------------------------------------------------------------------------------
// planSeams

/**
 * How many SEGMENTS every edge of every piece is cut into, keyed by edgeKey. A seam's two edges get the same count,
 * round(mean length / the finer spacing); an unsewn edge round(length / spacing); both at least 1. On a symmetric piece
 * an edge that crosses the fold gets an even count (at least 2) and an edge and its mirror twin the same count; all of
 * it carries across seams. Where an equal-count group has several natural counts (twins with different spacings), the
 * finest -- the largest -- is taken.
 */
export function planSeams(pattern: Pattern): Map<string, number> {
  const keys: string[] = [];
  const index = new Map<string, number>();
  const lengths: number[] = [];
  const spacings: number[] = [];
  const mustBeEven: boolean[] = [];
  for (const piece of pattern.pieces) {
    for (const edge of piece.edges) {
      const key = edgeKey(piece.id, edge.name);
      if (index.has(key)) throw new Error(`edge '${key}' appears twice`);
      index.set(key, keys.length);
      keys.push(key);
      lengths.push(polylineLength(edge.points));
      spacings.push(edge.spacing);
      mustBeEven.push(piece.symmetric && crossesFold(edge));
    }
  }

  const groups = new UnionFind(keys.length);
  for (const piece of pattern.pieces) {
    if (!piece.symmetric) continue;
    for (let i = 0; i < piece.edges.length; i++) {
      for (let j = i + 1; j < piece.edges.length; j++) {
        if (mirrorTwins(piece.edges[i], piece.edges[j])) {
          groups.union(index.get(edgeKey(piece.id, piece.edges[i].name))!, index.get(edgeKey(piece.id, piece.edges[j].name))!);
        }
      }
    }
  }

  // The natural ratio (length / spacing, before rounding) of each edge: a seam's own for both its edges.
  const ratio = new Float64Array(keys.length);
  const sewn = new Uint8Array(keys.length);
  for (let i = 0; i < keys.length; i++) ratio[i] = lengths[i] / spacings[i];
  for (const seam of pattern.seams) {
    findEdge(pattern, seam.a.piece, seam.a.edge, seam.name);
    findEdge(pattern, seam.b.piece, seam.b.edge, seam.name);
    const a = index.get(edgeKey(seam.a.piece, seam.a.edge))!;
    const b = index.get(edgeKey(seam.b.piece, seam.b.edge))!;
    if (a === b) throw new Error(`seam '${seam.name}' sews edge '${keys[a]}' to itself`);
    if (sewn[a] || sewn[b]) throw new Error(`seam '${seam.name}': edge '${keys[sewn[a] ? a : b]}' is already in another seam`);
    sewn[a] = sewn[b] = 1;
    const r = (lengths[a] + lengths[b]) / 2 / Math.min(spacings[a], spacings[b]);
    ratio[a] = ratio[b] = r;
    groups.union(a, b);
  }

  // Each group: does any member need an even count, and the largest natural count among its members.
  const even = new Uint8Array(keys.length);
  for (let i = 0; i < keys.length; i++) if (mustBeEven[i]) even[groups.find(i)] = 1;
  const count = new Int32Array(keys.length);
  for (let i = 0; i < keys.length; i++) {
    const g = groups.find(i);
    const n = even[g] ? Math.max(2, 2 * Math.round(ratio[i] / 2)) : Math.max(1, Math.round(ratio[i]));
    if (n > count[g]) count[g] = n;
  }
  const plan = new Map<string, number>();
  for (let i = 0; i < keys.length; i++) plan.set(keys[i], count[groups.find(i)]);
  return plan;
}

// ---------------------------------------------------------------------------------------------------------------------
// sew

/** Where each piece's points start in the run of all pieces' points (piece order, then point order). */
function pointOffsets(pieces: readonly PatternPiece[], meshes: ReadonlyMap<string, PieceMesh>): Int32Array {
  const offsets = new Int32Array(pieces.length + 1);
  for (let p = 0; p < pieces.length; p++) {
    const mesh = meshes.get(pieces[p].id);
    if (!mesh) throw new Error(`piece '${pieces[p].id}' has no mesh`);
    offsets[p + 1] = offsets[p] + mesh.points.length / 2;
  }
  return offsets;
}

/** Any triangle (in all-pieces point indices) two of whose corners are the same class, or -1. */
function collapsedTriangle(uf: UnionFind, tris: Uint32Array): number {
  for (let t = 0; t < tris.length; t += 3) {
    const a = uf.find(tris[t]);
    const b = uf.find(tris[t + 1]);
    const c = uf.find(tris[t + 2]);
    if (a === b || b === c || a === c) return t / 3;
  }
  return -1;
}

/**
 * Sew the meshed pieces (one PieceMesh per pattern piece, keyed by piece id, each meshed with planSeams' counts) into
 * one sheet. Each seam welds a's edge point i to b's edge point (n - i), transitively; nothing off a seam is merged.
 * Throws, naming the seam, when its two edges have different point counts or when a weld would put two corners of one
 * triangle on the same particle.
 */
export function sew(pattern: Pattern, meshes: ReadonlyMap<string, PieceMesh>): SewnGarment {
  const pieces = pattern.pieces;
  const pieceIndex = new Map<string, number>();
  pieces.forEach((p, i) => pieceIndex.set(p.id, i));
  const offsets = pointOffsets(pieces, meshes);
  const total = offsets[pieces.length];

  // Every triangle, in all-pieces point indices: these are the render triangles.
  let triCount = 0;
  for (const p of pieces) triCount += meshes.get(p.id)!.triangles.length / 3;
  const renderTriangles = new Uint32Array(triCount * 3);
  const trianglePiece = new Uint16Array(triCount);
  {
    let w = 0;
    for (let p = 0; p < pieces.length; p++) {
      const tris = meshes.get(pieces[p].id)!.triangles;
      for (let k = 0; k < tris.length; k++) renderTriangles[w + k] = tris[k] + offsets[p];
      trianglePiece.fill(p, w / 3, (w + tris.length) / 3);
      w += tris.length;
    }
  }

  // Each seam as the two runs of all-pieces point indices it welds, b already walked backwards.
  const runs: { name: string; a: Uint32Array; b: Uint32Array }[] = [];
  for (const seam of pattern.seams) {
    const run = (side: { piece: string; edge: string }): Uint32Array => {
      const p = pieceIndex.get(side.piece);
      if (p === undefined) throw new Error(`seam '${seam.name}': no piece '${side.piece}'`);
      const pts = meshes.get(side.piece)!.edgePoints.get(side.edge);
      if (!pts) throw new Error(`seam '${seam.name}': mesh of '${side.piece}' has no edge '${side.edge}'`);
      const out = new Uint32Array(pts.length);
      for (let i = 0; i < pts.length; i++) out[i] = pts[i] + offsets[p];
      return out;
    };
    const a = run(seam.a);
    const fwd = run(seam.b);
    if (a.length !== fwd.length) {
      throw new Error(
        `seam '${seam.name}': ${edgeKey(seam.a.piece, seam.a.edge)} has ${a.length} points but ` +
          `${edgeKey(seam.b.piece, seam.b.edge)} has ${fwd.length}`,
      );
    }
    runs.push({ name: seam.name, a, b: fwd.reverse() });
  }

  const uf = new UnionFind(total);
  const pointOnSeam = new Uint8Array(total);
  for (const r of runs) {
    for (let i = 0; i < r.a.length; i++) {
      uf.union(r.a[i], r.b[i]);
      pointOnSeam[r.a[i]] = pointOnSeam[r.b[i]] = 1;
    }
  }
  if (collapsedTriangle(uf, renderTriangles) >= 0) {
    // Only on failure: replay the seams one at a time to name the one that closed the triangle.
    const replay = new UnionFind(total);
    for (const r of runs) {
      for (let i = 0; i < r.a.length; i++) replay.union(r.a[i], r.b[i]);
      const t = collapsedTriangle(replay, renderTriangles);
      if (t >= 0) {
        throw new Error(`seam '${r.name}' welds two corners of a triangle of '${pieces[trianglePiece[t]].id}' into one particle`);
      }
    }
  }

  // Particles, numbered by each class's first point in all-pieces order.
  const particleOf = new Int32Array(total).fill(-1);
  const vertexParticle = new Uint32Array(total);
  const vertexPiece = new Uint16Array(total);
  const firstPiece: number[] = [];
  let count = 0;
  for (let p = 0; p < pieces.length; p++) {
    for (let v = offsets[p]; v < offsets[p + 1]; v++) {
      const root = uf.find(v);
      if (particleOf[root] < 0) {
        particleOf[root] = count++;
        firstPiece.push(p);
      }
      vertexParticle[v] = particleOf[root];
      vertexPiece[v] = p;
    }
  }
  const particlePiece = Uint16Array.from(firstPiece);
  const onSeam = new Uint8Array(count);
  for (let v = 0; v < total; v++) if (pointOnSeam[v]) onSeam[vertexParticle[v]] = 1;

  // Every point's plane coordinates: full precision for rest lengths, Float32 for the UVs that are drawn.
  const flat = new Float64Array(total * 2);
  for (let p = 0; p < pieces.length; p++) flat.set(meshes.get(pieces[p].id)!.points, offsets[p] * 2);
  const uv = Float32Array.from(flat);

  const triangles = new Uint32Array(renderTriangles.length);
  for (let k = 0; k < renderTriangles.length; k++) triangles[k] = vertexParticle[renderTriangles[k]];

  // Unique particle edges and their rest lengths: the mean over each piece-mesh edge (deduplicated within its piece, so
  // an interior edge counts once, and a seam edge once per side) of its length in that piece's plane.
  const restSum = new Map<number, number>();
  const restN = new Map<number, number>();
  const seenLocal = new Set<number>();
  for (let t = 0; t < renderTriangles.length; t += 3) {
    for (let c = 0; c < 3; c++) {
      const u = renderTriangles[t + c];
      const v = renderTriangles[t + ((c + 1) % 3)];
      const localKey = Math.min(u, v) * total + Math.max(u, v);
      if (seenLocal.has(localKey)) continue;
      seenLocal.add(localKey);
      const pu = vertexParticle[u];
      const pv = vertexParticle[v];
      const key = Math.min(pu, pv) * count + Math.max(pu, pv);
      const len = Math.hypot(flat[2 * u] - flat[2 * v], flat[2 * u + 1] - flat[2 * v + 1]);
      restSum.set(key, (restSum.get(key) ?? 0) + len);
      restN.set(key, (restN.get(key) ?? 0) + 1);
    }
  }
  const edgeKeys = [...restSum.keys()].sort((x, y) => x - y);
  const edges = new Uint32Array(edgeKeys.length * 2);
  const edgeRest = new Float32Array(edgeKeys.length);
  for (let e = 0; e < edgeKeys.length; e++) {
    const key = edgeKeys[e];
    edges[2 * e] = Math.floor(key / count);
    edges[2 * e + 1] = key % count;
    edgeRest[e] = restSum.get(key)! / restN.get(key)!;
  }

  const openings = findOpenings(pieces, meshes, offsets, triangles, renderTriangles, vertexParticle, vertexPiece, count);

  return {
    pieces: pieces.map((p) => p.id),
    count,
    particlePiece,
    onSeam,
    triangles,
    trianglePiece,
    edges,
    edgeRest,
    vertexParticle,
    vertexPiece,
    uv,
    renderTriangles,
    openings,
  };
}

/**
 * The boundary -- particle edges used by exactly one triangle -- chained into loops in the direction the triangles walk
 * it, each started at its smallest particle, with the outline edges each boundary segment came from.
 */
function findOpenings(
  pieces: readonly PatternPiece[],
  meshes: ReadonlyMap<string, PieceMesh>,
  offsets: Int32Array,
  triangles: Uint32Array,
  renderTriangles: Uint32Array,
  vertexParticle: Uint32Array,
  vertexPiece: Uint16Array,
  count: number,
): Opening[] {
  const total = vertexParticle.length;
  // Which outline edge a pair of adjacent outline points belongs to, either way round.
  const outlineName = new Map<number, string>();
  for (let p = 0; p < pieces.length; p++) {
    for (const [name, pts] of meshes.get(pieces[p].id)!.edgePoints) {
      const label = edgeKey(pieces[p].id, name);
      for (let k = 1; k < pts.length; k++) {
        const u = pts[k - 1] + offsets[p];
        const v = pts[k] + offsets[p];
        outlineName.set(Math.min(u, v) * total + Math.max(u, v), label);
      }
    }
  }

  const uses = new Map<number, number>();
  for (let t = 0; t < triangles.length; t += 3) {
    for (let c = 0; c < 3; c++) {
      const a = triangles[t + c];
      const b = triangles[t + ((c + 1) % 3)];
      const key = Math.min(a, b) * count + Math.max(a, b);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }

  // The boundary's directed segments, grouped by the particle they leave.
  const from: number[] = [];
  const to: number[] = [];
  const names: string[] = [];
  for (let t = 0; t < triangles.length; t += 3) {
    for (let c = 0; c < 3; c++) {
      const a = triangles[t + c];
      const b = triangles[t + ((c + 1) % 3)];
      if (uses.get(Math.min(a, b) * count + Math.max(a, b)) !== 1) continue;
      const u = renderTriangles[t + c];
      const v = renderTriangles[t + ((c + 1) % 3)];
      from.push(a);
      to.push(b);
      names.push(outlineName.get(Math.min(u, v) * total + Math.max(u, v)) ?? `${pieces[vertexPiece[u]].id}:?`);
    }
  }
  const order = from.map((_, i) => i).sort((x, y) => from[x] - from[y] || x - y);
  const outgoing = new Map<number, number[]>();
  for (const i of order) {
    const list = outgoing.get(from[i]);
    if (list) list.push(i);
    else outgoing.set(from[i], [i]);
  }

  const used = new Uint8Array(from.length);
  const openings: Opening[] = [];
  for (const first of order) {
    if (used[first]) continue;
    const loop: number[] = [];
    const loopNames: string[] = [];
    let seg = first;
    for (;;) {
      used[seg] = 1;
      loop.push(from[seg]);
      if (!loopNames.includes(names[seg])) loopNames.push(names[seg]);
      if (to[seg] === from[first]) break;
      const next = outgoing.get(to[seg])?.find((i) => !used[i]);
      if (next === undefined) break; // a boundary that does not close (non-manifold): end the loop where it stops
      seg = next;
    }
    openings.push({ particles: Uint32Array.from(loop), edges: loopNames });
  }
  return openings;
}

// ---------------------------------------------------------------------------------------------------------------------
// validate

/** Check the sewn sheet; see GarmentReport in types.ts. Pure; never throws for a well-formed SewnGarment. */
export function validate(garment: SewnGarment, pattern: Pattern, meshes: ReadonlyMap<string, PieceMesh>): GarmentReport {
  const { count, triangles, edges, edgeRest } = garment;
  const F = triangles.length / 3;
  const E = edges.length / 2;

  // Per unique edge: how many triangles use it, and how many walk it lo -> hi.
  const edgeIndex = new Map<number, number>();
  for (let e = 0; e < E; e++) edgeIndex.set(edges[2 * e] * count + edges[2 * e + 1], e);
  const uses = new Uint32Array(E);
  const forward = new Uint32Array(E);
  for (let t = 0; t < triangles.length; t += 3) {
    for (let c = 0; c < 3; c++) {
      const a = triangles[t + c];
      const b = triangles[t + ((c + 1) % 3)];
      const e = edgeIndex.get(Math.min(a, b) * count + Math.max(a, b));
      if (e === undefined) continue;
      uses[e]++;
      if (a < b) forward[e]++;
    }
  }
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let flippedEdges = 0;
  for (let e = 0; e < E; e++) {
    if (uses[e] === 1) boundaryEdges++;
    else if (uses[e] > 2) nonManifoldEdges++;
    else if (uses[e] === 2 && forward[e] !== 1) flippedEdges++;
  }

  const uf = new UnionFind(count);
  for (let t = 0; t < triangles.length; t += 3) {
    uf.union(triangles[t], triangles[t + 1]);
    uf.union(triangles[t], triangles[t + 2]);
  }
  const roots = new Set<number>();
  for (let t = 0; t < triangles.length; t += 3) roots.add(uf.find(triangles[t]));
  const components = roots.size;

  // Angles, each triangle in its own piece's flat plane (full precision from the meshes; the Float32 uv if one is missing).
  const offsets = new Int32Array(garment.pieces.length + 1);
  for (let p = 0; p < garment.pieces.length; p++) {
    const m = meshes.get(garment.pieces[p]);
    offsets[p + 1] = offsets[p] + (m ? m.points.length / 2 : 0);
  }
  const xy = (v: number, axis: 0 | 1): number => {
    const p = garment.vertexPiece[v];
    const m = meshes.get(garment.pieces[p]);
    return m ? m.points[(v - offsets[p]) * 2 + axis] : garment.uv[v * 2 + axis];
  };
  let minAngle = F > 0 ? 180 : 0;
  let slivers = 0;
  let degenerate = 0;
  const rt = garment.renderTriangles;
  for (let t = 0; t < rt.length; t += 3) {
    const ax = xy(rt[t], 0), ay = xy(rt[t], 1);
    const bx = xy(rt[t + 1], 0), by = xy(rt[t + 1], 1);
    const cx = xy(rt[t + 2], 0), cy = xy(rt[t + 2], 1);
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const scale = Math.max((bx - ax) ** 2 + (by - ay) ** 2, (cx - ax) ** 2 + (cy - ay) ** 2, (cx - bx) ** 2 + (cy - by) ** 2);
    if (!(Math.abs(cross) > 1e-12 * scale)) degenerate++;
    const angle = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number =>
      (Math.atan2(Math.abs((qx - px) * (ry - py) - (qy - py) * (rx - px)), (qx - px) * (rx - px) + (qy - py) * (ry - py)) * 180) / Math.PI;
    const smallest = Math.min(angle(ax, ay, bx, by, cx, cy), angle(bx, by, cx, cy, ax, ay), angle(cx, cy, ax, ay, bx, by));
    if (smallest < minAngle) minAngle = smallest;
    if (smallest < SLIVER_DEG) slivers++;
  }

  let minEdge = E > 0 ? Infinity : 0;
  let maxEdge = 0;
  let sumEdge = 0;
  for (let e = 0; e < E; e++) {
    const r = edgeRest[e];
    if (r < minEdge) minEdge = r;
    if (r > maxEdge) maxEdge = r;
    sumEdge += r;
  }

  const problems: string[] = [];
  const seams = pattern.seams.map((seam) => {
    const edgeOf = (piece: string, edge: string): PatternEdge | undefined =>
      pattern.pieces.find((p) => p.id === piece)?.edges.find((x) => x.name === edge);
    const ea = edgeOf(seam.a.piece, seam.a.edge);
    const eb = edgeOf(seam.b.piece, seam.b.edge);
    const lengthA = ea ? polylineLength(ea.points) : 0;
    const lengthB = eb ? polylineLength(eb.points) : 0;
    const points = meshes.get(seam.a.piece)?.edgePoints.get(seam.a.edge)?.length ?? 0;
    const mean = (lengthA + lengthB) / 2;
    if (mean > 0 && Math.abs(lengthA - lengthB) / mean > EASE_LIMIT + (seam.ease ?? 0)) {
      problems.push(
        `seam '${seam.name}': its sides differ by ${((Math.abs(lengthA - lengthB) / mean) * 100).toFixed(1)}% ` +
          `(${(lengthA * 100).toFixed(1)} cm against ${(lengthB * 100).toFixed(1)} cm), more ease than ${((EASE_LIMIT + (seam.ease ?? 0)) * 100).toFixed(0)}%`,
      );
    }
    return { name: seam.name, lengthA, lengthB, points };
  });

  if (nonManifoldEdges > 0) problems.push(`${nonManifoldEdges} edge(s) are shared by more than two triangles`);
  if (flippedEdges > 0) problems.push(`${flippedEdges} edge(s) join triangles wound opposite ways (a piece is sewn inside out)`);
  if (components !== 1) problems.push(`the cloth is in ${components} separate pieces, not one`);
  if (degenerate > 0) problems.push(`${degenerate} triangle(s) have no area in their piece's plane`);
  if (slivers > 0) problems.push(`${slivers} sliver triangle(s) with an angle under ${SLIVER_DEG} degrees`);

  return {
    particles: count,
    triangles: F,
    edges: E,
    boundaryEdges,
    nonManifoldEdges,
    flippedEdges,
    components,
    openings: garment.openings.map((o) => o.edges),
    euler: count - E + F,
    minAngleDeg: minAngle,
    slivers,
    minEdge,
    maxEdge,
    meanEdge: E > 0 ? sumEdge / E : 0,
    seams,
    problems,
  };
}
