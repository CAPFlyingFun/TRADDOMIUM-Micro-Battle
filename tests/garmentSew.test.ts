/**
 * SEWING THE GARMENT'S PIECES (the procedural garment, 2026-10-26). On hand-built grids -- mesh.ts is not imported, so
 * these fixtures pin sew.ts alone: two rectangles sewn along an edge make one sheet with one opening; a rectangle sewn
 * to itself makes a tube with two; three pieces meeting at a corner weld it to one particle; a seam whose sides were cut
 * differently is refused by name; ease beyond 5% is reported and its rest length is the mean; and planSeams gives a seam
 * one count, a fold-crossing edge an even one, carries that across the seam, and gives mirror twins the same count.
 */
import { describe, expect, it } from 'vitest';
import { edgeKey, planSeams, sew, validate } from '../src/sarahlab/garment/sew';
import type { Pattern, PatternPiece, PieceMesh, Seam, Vec2 } from '../src/sarahlab/garment/types';

interface Rect {
  piece: PatternPiece;
  mesh: PieceMesh;
}

/**
 * An axis-aligned rectangle [x0, x0 + w] × [y0, y0 + h] meshed as an nx × ny grid, point (i, j) at index j(nx+1) + i,
 * every cell split into two CCW triangles, with outline edges bottom, right, top, left (CCW) matching the grid.
 */
function rect(id: string, x0: number, y0: number, w: number, h: number, nx: number, ny: number, symmetric = false): Rect {
  const at = (i: number, j: number): number => j * (nx + 1) + i;
  const points = new Float64Array((nx + 1) * (ny + 1) * 2);
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      points[at(i, j) * 2] = x0 + (w * i) / nx;
      points[at(i, j) * 2 + 1] = y0 + (h * j) / ny;
    }
  }
  const tris: number[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      tris.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
    }
  }
  const runs: Record<string, number[]> = { bottom: [], right: [], top: [], left: [] };
  for (let i = 0; i <= nx; i++) runs.bottom.push(at(i, 0));
  for (let j = 0; j <= ny; j++) runs.right.push(at(nx, j));
  for (let i = nx; i >= 0; i--) runs.top.push(at(i, ny));
  for (let j = ny; j >= 0; j--) runs.left.push(at(0, j));
  const edgePoints = new Map<string, Uint32Array>();
  const edges = Object.entries(runs).map(([name, idx]) => {
    edgePoints.set(name, Uint32Array.from(idx));
    const pts: Vec2[] = idx.map((k) => [points[k * 2], points[k * 2 + 1]] as const);
    const spacing = name === 'bottom' || name === 'top' ? w / nx : h / ny;
    return { name, points: pts, spacing };
  });
  return {
    piece: { id, role: 'torso', side: 0, edges, spacing: Math.min(w / nx, h / ny), symmetric },
    mesh: { piece: id, points, triangles: Uint32Array.from(tris), edgePoints },
  };
}

const seam = (name: string, a: string, ea: string, b: string, eb: string): Seam => ({
  name,
  a: { piece: a, edge: ea },
  b: { piece: b, edge: eb },
});

function build(rects: Rect[], seams: Seam[]): { pattern: Pattern; meshes: Map<string, PieceMesh> } {
  return {
    pattern: { pieces: rects.map((r) => r.piece), seams },
    meshes: new Map(rects.map((r) => [r.piece.id, r.mesh])),
  };
}

/** The particle a piece's point became. */
function particleOf(garment: ReturnType<typeof sew>, rects: Rect[], piece: string, point: number): number {
  let offset = 0;
  for (const r of rects) {
    if (r.piece.id === piece) return garment.vertexParticle[offset + point];
    offset += r.mesh.points.length / 2;
  }
  throw new Error(piece);
}

describe('sew', () => {
  it('sews two rectangles along one edge into one sheet with one opening', () => {
    const rects = [rect('A', 0, 0, 1, 1, 3, 2), rect('B', 1, 0, 1, 1, 3, 2)];
    const { pattern, meshes } = build(rects, [seam('mid', 'A', 'right', 'B', 'left')]);
    const g = sew(pattern, meshes);
    expect(g.count).toBe(12 + 12 - 3);
    // A's right edge point j and B's left edge point j are at the same height: welded.
    for (let j = 0; j <= 2; j++) expect(particleOf(g, rects, 'A', j * 4 + 3)).toBe(particleOf(g, rects, 'B', j * 4));
    expect(g.onSeam.reduce((s, x) => s + x, 0)).toBe(3);
    expect(g.openings).toHaveLength(1);
    expect(g.openings[0].edges).toEqual(['A:bottom', 'B:bottom', 'B:right', 'B:top', 'A:top', 'A:left']);
    expect(g.openings[0].particles[0]).toBe(0);
    const r = validate(g, pattern, meshes);
    expect(r.components).toBe(1);
    expect(r.flippedEdges).toBe(0);
    expect(r.nonManifoldEdges).toBe(0);
    expect(r.euler).toBe(1);
    expect(r.boundaryEdges).toBe(2 * (6 + 4) - 2 * 2);
    expect(r.triangles).toBe(24);
    expect(r.seams).toEqual([{ name: 'mid', lengthA: 1, lengthB: 1, points: 3 }]);
    // Cells 1/3 wide and 1/2 high: the smallest angle is between a diagonal and an upright, atan(2/3).
    expect(r.minAngleDeg).toBeCloseTo((Math.atan(2 / 3) * 180) / Math.PI, 6);
    expect(r.problems).toEqual([]);
  });

  it('sews a rectangle to itself into a tube with two openings', () => {
    const rects = [rect('T', 0, 0, 1, 1, 4, 2)];
    const { pattern, meshes } = build(rects, [seam('back', 'T', 'right', 'T', 'left')]);
    const g = sew(pattern, meshes);
    expect(g.count).toBe(15 - 3);
    const r = validate(g, pattern, meshes);
    expect(r.openings).toHaveLength(2);
    expect(r.openings).toEqual([['T:bottom'], ['T:top']]);
    expect(r.euler).toBe(0);
    expect(r.components).toBe(1);
    expect(r.flippedEdges).toBe(0);
    expect(r.nonManifoldEdges).toBe(0);
    expect(r.problems).toEqual([]);
  });

  it('welds a corner where three pieces meet through two seams into one particle', () => {
    const rects = [rect('A', 0, 0, 1, 1, 2, 2), rect('B', 1, 0, 1, 1, 2, 2), rect('C', 1, 1, 1, 1, 2, 2)];
    const { pattern, meshes } = build(rects, [seam('ab', 'A', 'right', 'B', 'left'), seam('bc', 'B', 'top', 'C', 'bottom')]);
    const g = sew(pattern, meshes);
    const corner = particleOf(g, rects, 'A', 8); // A's top right
    expect(particleOf(g, rects, 'B', 6)).toBe(corner); // B's top left
    expect(particleOf(g, rects, 'C', 0)).toBe(corner); // C's bottom left
    expect(g.count).toBe(27 - 3 - 3);
    const r = validate(g, pattern, meshes);
    expect(r.components).toBe(1);
    expect(r.flippedEdges).toBe(0);
    expect(r.nonManifoldEdges).toBe(0);
    expect(r.openings).toHaveLength(1);
    expect(r.euler).toBe(1);
  });

  it('never merges points that are not on a seam, however close', () => {
    // B's left edge lies exactly on A's right edge, but no seam joins them: two sheets.
    const rects = [rect('A', 0, 0, 1, 1, 2, 2), rect('B', 1, 0, 1, 1, 2, 2)];
    const { pattern, meshes } = build(rects, []);
    const g = sew(pattern, meshes);
    expect(g.count).toBe(18);
    expect(validate(g, pattern, meshes).components).toBe(2);
    expect(validate(g, pattern, meshes).problems.some((p) => p.includes('2 separate pieces'))).toBe(true);
  });

  it('reports flipped edges when one piece is wound the wrong way round', () => {
    const rects = [rect('A', 0, 0, 1, 1, 2, 2), rect('B', 1, 0, 1, 1, 2, 2)];
    const t = rects[1].mesh.triangles;
    for (let k = 0; k < t.length; k += 3) [t[k + 1], t[k + 2]] = [t[k + 2], t[k + 1]];
    const { pattern, meshes } = build(rects, [seam('mid', 'A', 'right', 'B', 'left')]);
    const r = validate(sew(pattern, meshes), pattern, meshes);
    expect(r.flippedEdges).toBe(2);
    expect(r.problems.some((p) => p.includes('wound opposite ways'))).toBe(true);
  });

  it('refuses a seam whose two edges have different point counts, naming it', () => {
    const rects = [rect('A', 0, 0, 1, 1, 2, 2), rect('B', 1, 0, 1, 1, 2, 3)];
    const { pattern, meshes } = build(rects, [seam('side', 'A', 'right', 'B', 'left')]);
    expect(() => sew(pattern, meshes)).toThrow(/seam 'side'.*A:right has 3 points but B:left has 4/);
  });

  it('refuses a weld that would collapse a triangle, naming the seam', () => {
    const rects = [rect('T', 0, 0, 1, 1, 1, 1)];
    const { pattern, meshes } = build(rects, [seam('narrow', 'T', 'right', 'T', 'left')]);
    expect(() => sew(pattern, meshes)).toThrow(/seam 'narrow'/);
  });

  it('reports ease over 5% and rests the welded edge at the mean of its two sides', () => {
    const rects = [rect('A', 0, 0, 1, 1, 2, 2), rect('B', 1, 0, 1, 1.1, 2, 2)];
    const { pattern, meshes } = build(rects, [seam('eased', 'A', 'right', 'B', 'left')]);
    const g = sew(pattern, meshes);
    const p0 = particleOf(g, rects, 'A', 2);
    const p1 = particleOf(g, rects, 'A', 5);
    let found = -1;
    for (let e = 0; e < g.edges.length / 2; e++) {
      if (g.edges[2 * e] === Math.min(p0, p1) && g.edges[2 * e + 1] === Math.max(p0, p1)) found = e;
    }
    expect(found).toBeGreaterThanOrEqual(0);
    expect(g.edgeRest[found]).toBeCloseTo((0.5 + 0.55) / 2, 6);
    const r = validate(g, pattern, meshes);
    expect(r.seams[0].lengthA).toBeCloseTo(1, 9);
    expect(r.seams[0].lengthB).toBeCloseTo(1.1, 9);
    expect(r.problems.some((p) => p.includes("seam 'eased'"))).toBe(true);
  });

  it('keeps every edge sorted and unique, and render vertices one per piece point', () => {
    const rects = [rect('A', 0, 0, 1, 1, 3, 2), rect('B', 1, 0, 1, 1, 3, 2)];
    const { pattern, meshes } = build(rects, [seam('mid', 'A', 'right', 'B', 'left')]);
    const g = sew(pattern, meshes);
    expect(g.vertexParticle.length).toBe(24);
    expect(g.uv.length).toBe(48);
    expect(g.renderTriangles.length).toBe(g.triangles.length);
    for (let k = 0; k < g.triangles.length; k++) expect(g.vertexParticle[g.renderTriangles[k]]).toBe(g.triangles[k]);
    expect(Array.from(g.vertexPiece.slice(0, 12)).every((p) => p === 0)).toBe(true);
    expect(Array.from(g.vertexPiece.slice(12)).every((p) => p === 1)).toBe(true);
    expect(g.uv[12 * 2]).toBe(1); // B's first point, in B's own plane
    for (let e = 1; e < g.edges.length / 2; e++) {
      const prev = g.edges[2 * e - 2] * g.count + g.edges[2 * e - 1];
      const cur = g.edges[2 * e] * g.count + g.edges[2 * e + 1];
      expect(cur).toBeGreaterThan(prev);
      expect(g.edges[2 * e]).toBeLessThan(g.edges[2 * e + 1]);
    }
    expect(Array.from(g.trianglePiece.slice(0, 12)).every((p) => p === 0)).toBe(true);
    expect(g.particlePiece[g.count - 1]).toBe(1);
  });
});

describe('planSeams', () => {
  it('gives both sides of a seam one count from their mean length and the finer spacing', () => {
    const a = rect('A', 0, 0, 1, 1, 10, 10);
    const b = rect('B', 1, 0, 1, 1.2, 8, 8);
    const pattern: Pattern = { pieces: [a.piece, b.piece], seams: [seam('s', 'A', 'right', 'B', 'left')] };
    const plan = planSeams(pattern);
    expect(plan.get(edgeKey('A', 'right'))).toBe(11); // 1.1 / 0.1
    expect(plan.get(edgeKey('B', 'left'))).toBe(11);
    expect(plan.get(edgeKey('A', 'bottom'))).toBe(10);
    expect(plan.get(edgeKey('B', 'top'))).toBe(8);
  });

  it('cuts a fold-crossing edge of a symmetric piece an even number of times, and carries it across its seam', () => {
    // F is cut on the fold: x from -0.54 to 0.54. Its bottom and top cross the fold; 1.08 / 0.2 = 5.4 -> 6.
    const f = rect('F', -0.54, 0, 1.08, 1, 5, 5, true);
    const g = rect('G', -0.54, -1, 1.08, 1, 5, 5);
    const pattern: Pattern = { pieces: [f.piece, g.piece], seams: [seam('waist', 'F', 'bottom', 'G', 'top')] };
    const plan = planSeams(pattern);
    expect(plan.get(edgeKey('F', 'bottom'))).toBe(6);
    expect(plan.get(edgeKey('G', 'top'))).toBe(6);
    expect(plan.get(edgeKey('F', 'top'))).toBe(6);
    // G is not symmetric: its own unsewn bottom is not forced even.
    expect(plan.get(edgeKey('G', 'bottom'))).toBe(5);
  });

  it('gives mirror twins the same count even when their spacings differ', () => {
    const f = rect('F', -0.5, 0, 1, 1, 4, 4, true);
    const edges = f.piece.edges.map((e) => (e.name === 'left' ? { ...e, spacing: 0.2 } : e.name === 'right' ? { ...e, spacing: 0.1 } : e));
    const pattern: Pattern = { pieces: [{ ...f.piece, edges }], seams: [] };
    const plan = planSeams(pattern);
    expect(plan.get(edgeKey('F', 'right'))).toBe(10);
    expect(plan.get(edgeKey('F', 'left'))).toBe(10);
  });

  it('names a seam that refers to an edge that does not exist', () => {
    const a = rect('A', 0, 0, 1, 1, 2, 2);
    expect(() => planSeams({ pieces: [a.piece], seams: [seam('bad', 'A', 'right', 'A', 'hem')] })).toThrow(/seam 'bad'/);
  });

  it('plans counts that sew: meshing each edge to its planned count welds every seam', () => {
    const a = rect('A', 0, 0, 1, 1, 3, 2);
    const b = rect('B', 1, 0, 1, 1, 3, 2);
    const pattern: Pattern = { pieces: [a.piece, b.piece], seams: [seam('mid', 'A', 'right', 'B', 'left')] };
    const plan = planSeams(pattern);
    // The fixture's grids are 2 rows high, and the plan agrees with them, so the sewing goes through.
    expect(plan.get(edgeKey('A', 'right'))).toBe(2);
    expect(plan.get(edgeKey('B', 'left'))).toBe(2);
    expect(() => sew(pattern, new Map([['A', a.mesh], ['B', b.mesh]]))).not.toThrow();
  });
});
