/**
 * ONE PATTERN PIECE, MESHED FLAT (`src/sarahlab/garment/mesh.ts`). On a rectangle with one edge cut finer than the
 * rest: every edge has exactly its count of segments, every outline segment is the edge of exactly one triangle, every
 * triangle is counter-clockwise, the triangles tile the outline's area exactly, no angle is under 20 degrees and no
 * interior point stands within 0.4·h of the outline. On a T-shirt front cut on the fold (scoop neck, curved armholes):
 * the mesh is exactly mirror-symmetric, with the fold's points at x === 0. And the malformed pieces it must refuse, the
 * arc-length sampling the seams depend on, determinism, and the time a 0.5 × 0.7 m piece takes.
 */
import { describe, expect, it } from 'vitest';
import { meshPiece, pieceMeshQuality, sampleEdge } from '../src/sarahlab/garment/mesh';
import type { PatternEdge, PatternPiece, PieceMesh, Vec2 } from '../src/sarahlab/garment/types';

/** A straight polyline from a to b, points at most 4 mm apart. */
function line(a: Vec2, b: Vec2): Vec2[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.004));
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  out[n] = b;
  return out;
}

/** A cubic Bezier as a polyline of n + 1 points, its ends exact. */
function bezier(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
  out[0] = p0;
  out[n] = p3;
  return out;
}

const mirrorEdge = (pts: readonly Vec2[]): Vec2[] => pts.map((p): Vec2 => [-p[0], p[1]]).reverse();

function arcLength(pts: readonly Vec2[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

/** Counts as the seam planner would choose them alone: length / spacing, rounded (even where `even`). */
function countsFor(piece: PatternPiece, even: ReadonlySet<string> = new Set()): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of piece.edges) {
    let c = Math.max(1, Math.round(arcLength(e.points) / e.spacing));
    if (even.has(e.name) && c % 2 === 1) c++;
    m.set(e.name, c);
  }
  return m;
}

function rectangle(w: number, hgt: number, spacing: number, fine: number): PatternPiece {
  const edges: PatternEdge[] = [
    { name: 'bottom', points: line([0, 0], [w, 0]), spacing: fine },
    { name: 'right', points: line([w, 0], [w, hgt]), spacing },
    { name: 'top', points: line([w, hgt], [0, hgt]), spacing },
    { name: 'left', points: line([0, hgt], [0, 0]), spacing },
  ];
  return { id: 'rect', role: 'torso', side: 0, edges, spacing, symmetric: false };
}

/** A T-shirt front cut on the fold: straight hem and sides, curved armholes, sloped shoulders, a scoop neck. */
function teeFront(h: number): PatternPiece {
  const sideP = line([0.25, 0], [0.25, 0.42]);
  const armP = bezier([0.25, 0.42], [0.2, 0.44], [0.19, 0.52], [0.19, 0.62], 40);
  const shoulderP = line([0.19, 0.62], [0.08, 0.66]);
  const neck = bezier([0.08, 0.66], [0.08, 0.58], [-0.08, 0.58], [-0.08, 0.66], 50);
  const edges: PatternEdge[] = [
    { name: 'hem', points: line([-0.25, 0], [0.25, 0]), spacing: 0.008 },
    { name: 'side+', points: sideP, spacing: 0.012 },
    { name: 'armhole+', points: armP, spacing: 0.01 },
    { name: 'shoulder+', points: shoulderP, spacing: 0.01 },
    { name: 'neck', points: neck, spacing: 0.008 },
    { name: 'shoulder-', points: mirrorEdge(shoulderP), spacing: 0.01 },
    { name: 'armhole-', points: mirrorEdge(armP), spacing: 0.01 },
    { name: 'side-', points: mirrorEdge(sideP), spacing: 0.012 },
  ];
  return { id: 'front', role: 'torso', side: 0, edges, spacing: h, symmetric: true };
}

const CENTRE = new Set(['hem', 'neck', 'bottom', 'top']);

/** Every outline segment (from edgePoints, in outline order) is the edge of exactly one triangle, in its direction. */
function boundaryUse(mesh: PieceMesh): { segments: number; ok: number } {
  const use = new Map<string, number>();
  const t = mesh.triangles;
  for (let k = 0; k < t.length; k += 3) {
    for (let e = 0; e < 3; e++) {
      const key = `${t[k + e]},${t[k + ((e + 1) % 3)]}`;
      use.set(key, (use.get(key) ?? 0) + 1);
    }
  }
  let segments = 0, ok = 0;
  for (const idx of mesh.edgePoints.values()) {
    for (let i = 0; i + 1 < idx.length; i++) {
      segments++;
      const fwd = use.get(`${idx[i]},${idx[i + 1]}`) ?? 0, back = use.get(`${idx[i + 1]},${idx[i]}`) ?? 0;
      if (fwd === 1 && back === 0) ok++;
    }
  }
  return { segments, ok };
}

function outlineArea(piece: PatternPiece, mesh: PieceMesh): number {
  let a = 0;
  const p = mesh.points;
  const ring: number[] = [];
  for (const e of piece.edges) {
    const idx = mesh.edgePoints.get(e.name)!;
    for (let i = 0; i + 1 < idx.length; i++) ring.push(idx[i]);
  }
  for (let i = 0; i < ring.length; i++) {
    const j = ring[(i + 1) % ring.length], k = ring[i];
    a += p[2 * k] * p[2 * j + 1] - p[2 * j] * p[2 * k + 1];
  }
  return a / 2;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

describe('sampleEdge', () => {
  it('cuts a curve into equal arc lengths, ends exact', () => {
    const pts = bezier([0, 0], [0.1, 0.2], [0.3, -0.1], [0.4, 0.1], 400);
    const s = sampleEdge(pts, 25);
    expect(s.length).toBe(26);
    expect(s[0]).toEqual(pts[0]);
    expect(s[25]).toEqual(pts[400]);
    // Arc length along the polyline to each sample: k / 25 of the whole.
    const total = arcLength(pts);
    const along = (q: Vec2): number => {
      let acc = 0, best = Infinity, at = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const d = distToSegment(q[0], q[1], a[0], a[1], b[0], b[1]);
        if (d < best) {
          best = d;
          at = acc + Math.hypot(q[0] - a[0], q[1] - a[1]);
        }
        acc += seg;
      }
      return at;
    };
    for (let k = 0; k <= 25; k++) expect(along(s[k])).toBeCloseTo((total * k) / 25, 9);
  });

  it('refuses a count below 1', () => {
    expect(() => sampleEdge(line([0, 0], [1, 0]), 0)).toThrow(/count/);
  });
});

describe('meshPiece: a rectangle with one fine edge', () => {
  const h = 0.012;
  const piece = rectangle(0.3, 0.4, h, 0.008);
  const counts = countsFor(piece);
  const mesh = meshPiece(piece, counts);
  const q = pieceMeshQuality(mesh);

  it('cuts every edge into exactly its count, corners shared', () => {
    for (const e of piece.edges) {
      const idx = mesh.edgePoints.get(e.name)!;
      expect(idx.length).toBe(counts.get(e.name)! + 1);
      expect([mesh.points[2 * idx[0]], mesh.points[2 * idx[0] + 1]]).toEqual([...e.points[0]]);
    }
    const names = piece.edges.map((e) => e.name);
    for (let k = 0; k < names.length; k++) {
      const a = mesh.edgePoints.get(names[k])!, b = mesh.edgePoints.get(names[(k + 1) % names.length])!;
      expect(a[a.length - 1]).toBe(b[0]);
    }
  });

  it('makes every outline segment the edge of exactly one triangle', () => {
    const { segments, ok } = boundaryUse(mesh);
    expect(segments).toBe([...counts.values()].reduce((s, c) => s + c, 0));
    expect(ok).toBe(segments);
  });

  it('winds every triangle counter-clockwise and tiles the outline exactly', () => {
    const p = mesh.points, t = mesh.triangles;
    let area = 0;
    for (let k = 0; k < t.length; k += 3) {
      const [a, b, c] = [t[k], t[k + 1], t[k + 2]];
      const a2 = (p[2 * b] - p[2 * a]) * (p[2 * c + 1] - p[2 * a + 1]) - (p[2 * b + 1] - p[2 * a + 1]) * (p[2 * c] - p[2 * a]);
      expect(a2).toBeGreaterThan(0);
      area += a2 / 2;
    }
    expect(Math.abs(area - 0.12)).toBeLessThan(1e-9);
    expect(Math.abs(q.area - outlineArea(piece, mesh))).toBeLessThan(1e-9);
  });

  it('keeps every angle at 20 degrees or more', () => {
    expect(q.minAngleDeg).toBeGreaterThanOrEqual(20);
    expect(q.under20).toBe(0);
  });

  it('keeps interior points at least 0.4 h from the outline', () => {
    const onOutline = new Set<number>();
    for (const idx of mesh.edgePoints.values()) for (const i of idx) onOutline.add(i);
    const p = mesh.points;
    let nearest = Infinity;
    for (let i = 0; i < p.length / 2; i++) {
      if (onOutline.has(i)) continue;
      const x = p[2 * i], y = p[2 * i + 1];
      nearest = Math.min(nearest, x, y, 0.3 - x, 0.4 - y);
    }
    expect(nearest).toBeGreaterThanOrEqual(0.4 * h);
  });

  it('grades: triangles by the fine edge are smaller than in the middle', () => {
    const p = mesh.points, t = mesh.triangles;
    let nearSum = 0, nearN = 0, midSum = 0, midN = 0;
    for (let k = 0; k < t.length; k += 3) {
      const cy = (p[2 * t[k] + 1] + p[2 * t[k + 1] + 1] + p[2 * t[k + 2] + 1]) / 3;
      const cx = (p[2 * t[k]] + p[2 * t[k + 1]] + p[2 * t[k + 2]]) / 3;
      const len = Math.hypot(p[2 * t[k + 1]] - p[2 * t[k]], p[2 * t[k + 1] + 1] - p[2 * t[k] + 1]);
      if (cy < 0.006 && cx > 0.05 && cx < 0.25) (nearSum += len), nearN++;
      if (Math.abs(cy - 0.2) < 0.05 && Math.abs(cx - 0.15) < 0.05) (midSum += len), midN++;
    }
    expect(nearSum / nearN).toBeLessThan(0.0095);
    expect(midSum / midN).toBeGreaterThan(0.0105);
  });

  it('is deterministic', () => {
    const again = meshPiece(piece, counts);
    expect(Array.from(again.points)).toEqual(Array.from(mesh.points));
    expect(Array.from(again.triangles)).toEqual(Array.from(mesh.triangles));
  });
});

describe('meshPiece: a T-shirt front cut on the fold', () => {
  const piece = teeFront(0.015);
  const counts = countsFor(piece, CENTRE);
  const mesh = meshPiece(piece, counts);
  const q = pieceMeshQuality(mesh);

  it('is exactly mirror-symmetric, with the fold at x === 0', () => {
    const p = mesh.points;
    const at = new Map<string, number>();
    for (let i = 0; i < p.length / 2; i++) at.set(`${p[2 * i]}|${p[2 * i + 1]}`, i);
    expect(at.size).toBe(p.length / 2);
    let fold = 0;
    for (let i = 0; i < p.length / 2; i++) {
      const x = p[2 * i];
      if (x === 0) {
        fold++;
        expect(Object.is(x, 0)).toBe(true);
      }
      expect(at.has(`${x === 0 ? 0 : -x}|${p[2 * i + 1]}`)).toBe(true);
    }
    expect(fold).toBeGreaterThan(30);
    // And the triangles mirror too.
    const tri = new Set<string>();
    const key = (a: number, b: number, c: number): string => [a, b, c].sort((u, v) => u - v).join(',');
    const t = mesh.triangles;
    for (let k = 0; k < t.length; k += 3) tri.add(key(t[k], t[k + 1], t[k + 2]));
    const twin = (i: number): number => at.get(`${p[2 * i] === 0 ? 0 : -p[2 * i]}|${p[2 * i + 1]}`)!;
    for (let k = 0; k < t.length; k += 3) expect(tri.has(key(twin(t[k]), twin(t[k + 1]), twin(t[k + 2])))).toBe(true);
  });

  it('samples mirror edges as exact mirror images, and the centre edges through x = 0', () => {
    const p = mesh.points;
    for (const [plus, minus] of [['side+', 'side-'], ['armhole+', 'armhole-'], ['shoulder+', 'shoulder-']]) {
      const a = mesh.edgePoints.get(plus)!, b = mesh.edgePoints.get(minus)!;
      expect(a.length).toBe(b.length);
      for (let i = 0; i < a.length; i++) {
        const j = b[b.length - 1 - i];
        expect(p[2 * j]).toBe(-p[2 * a[i]]);
        expect(p[2 * j + 1]).toBe(p[2 * a[i] + 1]);
      }
    }
    for (const name of ['hem', 'neck']) {
      const idx = mesh.edgePoints.get(name)!;
      expect(p[2 * idx[(idx.length - 1) / 2]]).toBe(0);
    }
  });

  it('is sound: outline segments used once, counter-clockwise, area exact, angles >= 20', () => {
    const { segments, ok } = boundaryUse(mesh);
    expect(ok).toBe(segments);
    expect(Math.abs(q.area - outlineArea(piece, mesh))).toBeLessThan(1e-9);
    expect(q.minAngleDeg).toBeGreaterThanOrEqual(20);
  });
});

describe('meshPiece refuses a malformed piece', () => {
  it('with an edge missing from counts', () => {
    const piece = rectangle(0.3, 0.4, 0.012, 0.012);
    const counts = countsFor(piece);
    counts.delete('right');
    expect(() => meshPiece(piece, counts)).toThrow(/no count given for edge 'right'/);
  });

  it('with a count below 1', () => {
    const piece = rectangle(0.3, 0.4, 0.012, 0.012);
    expect(() => meshPiece(piece, new Map([...countsFor(piece), ['top', 0]]))).toThrow(/'top' has count 0/);
  });

  it('with an odd count on an edge crossing the fold', () => {
    const piece = teeFront(0.015);
    const counts = countsFor(piece, CENTRE);
    counts.set('hem', counts.get('hem')! + 1);
    expect(() => meshPiece(piece, counts)).toThrow(/'hem' crosses the fold, so its count must be even/);
  });

  it('with a clockwise outline', () => {
    const ccw = rectangle(0.3, 0.4, 0.012, 0.012);
    const cw: PatternPiece = { ...ccw, edges: [...ccw.edges].reverse().map((e) => ({ ...e, points: [...e.points].reverse() })) };
    expect(() => meshPiece(cw, countsFor(cw))).toThrow(/not counter-clockwise/);
  });

  it('with an outline that does not close', () => {
    const piece = rectangle(0.3, 0.4, 0.012, 0.012);
    const broken: PatternPiece = { ...piece, edges: piece.edges.map((e) => (e.name === 'top' ? { ...e, points: line([0.3, 0.4], [0.01, 0.4]) } : e)) };
    expect(() => meshPiece(broken, countsFor(broken))).toThrow(/does not close/);
  });

  it('with an outline crossing itself', () => {
    // A bow tie: (0,0) -> (0.2,0.2) -> (0.2,0) -> (0,0.2) -> back.
    const pts: Vec2[] = [[0, 0], [0.2, 0.2], [0.2, 0], [0, 0.2]];
    const edges: PatternEdge[] = pts.map((p, i) => ({ name: `e${i}`, points: line(p, pts[(i + 1) % 4]), spacing: 0.012 }));
    const piece: PatternPiece = { id: 'bow', role: 'torso', side: 0, edges, spacing: 0.012, symmetric: false };
    expect(() => meshPiece(piece, countsFor(piece))).toThrow(/crosses itself|counter-clockwise/);
  });

  it('with mirror edges given different counts', () => {
    const piece = teeFront(0.015);
    const counts = countsFor(piece, CENTRE);
    counts.set('side-', counts.get('side+')! + 1);
    expect(() => meshPiece(piece, counts)).toThrow(/different counts/);
  });
});

describe('meshPiece: cost', () => {
  it('meshes a 0.5 x 0.7 m piece at 12 mm in under 200 ms', () => {
    const edges: PatternEdge[] = [
      { name: 'hem', points: line([-0.25, 0], [0.25, 0]), spacing: 0.008 },
      { name: 'side+', points: line([0.25, 0], [0.25, 0.7]), spacing: 0.012 },
      { name: 'top', points: line([0.25, 0.7], [-0.25, 0.7]), spacing: 0.012 },
      { name: 'side-', points: line([-0.25, 0.7], [-0.25, 0]), spacing: 0.012 },
    ];
    const sym: PatternPiece = { id: 'big', role: 'torso', side: 0, edges, spacing: 0.012, symmetric: true };
    const plain: PatternPiece = { ...sym, id: 'bigPlain', symmetric: false };
    const counts = countsFor(sym, CENTRE);
    meshPiece(plain, counts); // warm the JIT
    let t0 = performance.now();
    const a = meshPiece(plain, counts);
    const plainMs = performance.now() - t0;
    t0 = performance.now();
    const b = meshPiece(sym, counts);
    const symMs = performance.now() - t0;
    const qa = pieceMeshQuality(a), qb = pieceMeshQuality(b);
    console.info(`0.5 x 0.7 m at 12 mm: plain ${qa.points} points ${qa.triangles} tris ${plainMs.toFixed(1)} ms min ${qa.minAngleDeg.toFixed(1)} deg; `
      + `symmetric ${qb.points} points ${symMs.toFixed(1)} ms min ${qb.minAngleDeg.toFixed(1)} deg`);
    expect(plainMs).toBeLessThan(200);
    expect(symMs).toBeLessThan(200);
    expect(qa.minAngleDeg).toBeGreaterThanOrEqual(20);
    expect(qb.minAngleDeg).toBeGreaterThanOrEqual(20);
    expect(Math.abs(qa.area - 0.35)).toBeLessThan(1e-9);
    expect(Math.abs(qb.area - 0.35)).toBeLessThan(1e-9);
  });
});
