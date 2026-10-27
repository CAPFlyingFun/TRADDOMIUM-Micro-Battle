/**
 * BINDING THE GARMENT TO HER (`src/sarahlab/garment/bind.ts`), on synthetic bodies only: a box split along its edges
 * (every face its own vertices, as her mesh is split along its seams) with one face her ARM, and a 50,000-triangle
 * sphere. A particle binds to the exact nearest triangle of its region (checked by brute force), its barycentric weights
 * reproduce that nearest point, its signed distance is + outside and - inside, its offset is clamped and converted to
 * geometry units, the mesh's outward side is read from its vertex normals when given, and 10,000 particles bind in well
 * under a second.
 */
import { describe, expect, it } from 'vitest';
import { bindParticles, BIND_ANY, BIND_ARM, BIND_TRUNK, type BindBody } from '../src/sarahlab/garment/bind';

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V): number => Math.hypot(a[0], a[1], a[2]);
const vert = (P: Float32Array, i: number): V => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];

/** Independent closest point: the plane projection when it is inside, else the nearest of the three edges. */
function closestOn(a: V, b: V, c: V, p: V): number {
  const n = cross(sub(b, a), sub(c, a)), nn = dot(n, n);
  const h = dot(sub(p, a), n) / nn, q: V = [p[0] - n[0] * h, p[1] - n[1] * h, p[2] - n[2] * h];
  const inside = dot(cross(sub(b, a), sub(q, a)), n) >= 0 && dot(cross(sub(c, b), sub(q, b)), n) >= 0 && dot(cross(sub(a, c), sub(q, c)), n) >= 0;
  if (inside) return len(sub(p, q));
  const seg = (s: V, e: V): number => {
    const d = sub(e, s), t = Math.min(1, Math.max(0, dot(sub(p, s), d) / dot(d, d)));
    return len(sub(p, [s[0] + d[0] * t, s[1] + d[1] * t, s[2] + d[2] * t]));
  };
  return Math.min(seg(a, b), seg(b, c), seg(c, a));
}

function bruteNearest(body: BindBody, p: V, allow: (t: number) => boolean): number {
  const P = body.positions, T = body.triangles;
  let best = Infinity;
  for (let t = 0; t < T.length / 3; t++) {
    if (!allow(t)) continue;
    best = Math.min(best, closestOn(vert(P, T[t * 3]), vert(P, T[t * 3 + 1]), vert(P, T[t * 3 + 2]), p));
  }
  return best;
}

function isArmTri(body: BindBody, t: number): boolean {
  const T = body.triangles; let k = 0;
  for (let c = 0; c < 3; c++) if (body.arm[T[t * 3 + c]] >= 0.5) k++;
  return k >= 2;
}
/** The triangle index a binding row names (its three vertex indices, in order). */
function triOf(body: BindBody, tri: Uint32Array, i: number): number {
  const T = body.triangles;
  for (let t = 0; t < T.length / 3; t++) if (T[t * 3] === tri[i * 3] && T[t * 3 + 1] === tri[i * 3 + 1] && T[t * 3 + 2] === tri[i * 3 + 2]) return t;
  return -1;
}

/**
 * A box of half-size h centred at `c`, each face its own (div+1)^2 vertices, counter-clockwise seen from outside.
 * Faces in order +x, -x, +y, -y, +z, -z; `armFaces` lists the faces whose vertices have arm = 1.
 */
function box(h = 0.1, div = 4, c: V = [0, 1, 0], armFaces: number[] = [0], flip = false): BindBody & { faceOf: Int32Array } {
  const pos: number[] = [], arm: number[] = [], nor: number[] = [], tris: number[] = [], faceOf: number[] = [];
  const axes: { n: V; u: V; v: V }[] = [
    { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
  ];
  axes.forEach(({ n, u, v }, f) => {
    const base = pos.length / 3;
    for (let j = 0; j <= div; j++) for (let i = 0; i <= div; i++) {
      const a = -h + (2 * h * i) / div, b = -h + (2 * h * j) / div;
      for (let k = 0; k < 3; k++) pos.push(c[k] + n[k] * h + u[k] * a + v[k] * b);
      nor.push(...n); arm.push(armFaces.includes(f) ? 1 : 0);
    }
    for (let j = 0; j < div; j++) for (let i = 0; i < div; i++) {
      const p0 = base + j * (div + 1) + i, p1 = p0 + 1, p2 = p0 + div + 1, p3 = p2 + 1;
      // u x v = n, so (p0, p1, p3) and (p0, p3, p2) wind counter-clockwise seen from outside
      if (flip) tris.push(p0, p3, p1, p0, p2, p3); else tris.push(p0, p1, p3, p0, p3, p2);
      faceOf.push(f, f);
    }
  });
  return { positions: new Float32Array(pos), triangles: new Uint32Array(tris), arm: new Float32Array(arm), normals: new Float32Array(nor), faceOf: new Int32Array(faceOf) };
}

/** A UV sphere of radius r: 2 * seg * (rings - 1) triangles, counter-clockwise seen from outside. */
function sphere(r: number, seg: number, rings: number, c: V = [0, 1, 0]): BindBody {
  const pos: number[] = [c[0], c[1] + r, c[2]], tris: number[] = [];
  for (let j = 1; j < rings; j++) {
    const th = (Math.PI * j) / rings;
    for (let i = 0; i < seg; i++) {
      const ph = (2 * Math.PI * i) / seg;
      pos.push(c[0] + r * Math.sin(th) * Math.cos(ph), c[1] + r * Math.cos(th), c[2] + r * Math.sin(th) * Math.sin(ph));
    }
  }
  const south = pos.length / 3; pos.push(c[0], c[1] - r, c[2]);
  const at = (j: number, i: number): number => 1 + (j - 1) * seg + (i % seg);
  for (let i = 0; i < seg; i++) tris.push(0, at(1, i + 1), at(1, i));
  for (let j = 1; j < rings - 1; j++) for (let i = 0; i < seg; i++) {
    tris.push(at(j, i), at(j, i + 1), at(j + 1, i + 1), at(j, i), at(j + 1, i + 1), at(j + 1, i));
  }
  for (let i = 0; i < seg; i++) tris.push(south, at(rings - 1, i), at(rings - 1, i + 1));
  const n = pos.length / 3, arm = new Float32Array(n), nor = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const d: V = [pos[v * 3] - c[0], pos[v * 3 + 1] - c[1], pos[v * 3 + 2] - c[2]], l = len(d);
    nor[v * 3] = d[0] / l; nor[v * 3 + 1] = d[1] / l; nor[v * 3 + 2] = d[2] / l;
    arm[v] = d[0] > r * 0.5 ? 1 : 0;
  }
  return { positions: new Float32Array(pos), triangles: new Uint32Array(tris), arm, normals: nor };
}

/** A deterministic random stream. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const OPT = { scale: 1, offset: [0, 0, 0] as [number, number, number] };
const pts = (...p: V[]): Float32Array => new Float32Array(p.flat());

describe('bindParticles', () => {
  it('binds to the nearest triangle, with barycentric weights that reproduce the nearest point', () => {
    const b = box();
    const p: V = [0.03, 1.12, 0.01];
    const r = bindParticles(b, pts(p), new Uint8Array([BIND_ANY]), OPT);
    const t = triOf(b, r.tri, 0);
    expect(b.faceOf[t]).toBe(2); // +y
    const [A, B, C] = [0, 1, 2].map((k) => vert(b.positions, r.tri[k]));
    const q = [0, 1, 2].map((k) => r.bary[0] * A[k] + r.bary[1] * B[k] + r.bary[2] * C[k]);
    expect(q[0]).toBeCloseTo(0.03, 6); expect(q[1]).toBeCloseTo(1.1, 6); expect(q[2]).toBeCloseTo(0.01, 6);
    expect(r.bary[0] + r.bary[1] + r.bary[2]).toBeCloseTo(1, 6);
    for (let k = 0; k < 3; k++) expect(r.bary[k]).toBeGreaterThanOrEqual(0);
    expect(r.distance[0]).toBeCloseTo(0.02, 6);
    expect(r.offset[0]).toBeCloseTo(0.02, 6);
  });

  it('finds the exact nearest of its region for scattered particles in and around the box (brute force)', () => {
    const b = box(0.1, 5, [0, 1, 0], [0, 2]);
    const rand = rng(7), n = 300, P = new Float32Array(n * 3), reg = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      P[i * 3] = (rand() - 0.5) * 0.4; P[i * 3 + 1] = 1 + (rand() - 0.5) * 0.4; P[i * 3 + 2] = (rand() - 0.5) * 0.4;
      reg[i] = i % 3;
    }
    const r = bindParticles(b, P, reg, OPT);
    for (let i = 0; i < n; i++) {
      const p = vert(P, i);
      const want = bruteNearest(b, p, (t) => reg[i] === BIND_ANY || (reg[i] === BIND_ARM) === isArmTri(b, t));
      expect(Math.abs(r.distance[i])).toBeCloseTo(want, 5);
      const t = triOf(b, r.tri, i);
      if (reg[i] !== BIND_ANY) expect(isArmTri(b, t)).toBe(reg[i] === BIND_ARM);
      const [A, B, C] = [0, 1, 2].map((k) => vert(b.positions, r.tri[i * 3 + k]));
      const q: V = [0, 1, 2].map((k) => r.bary[i * 3] * A[k] + r.bary[i * 3 + 1] * B[k] + r.bary[i * 3 + 2] * C[k]) as V;
      expect(len(sub(p, q))).toBeCloseTo(want, 5);
      // inside the box is behind every face
      const inside = Math.abs(p[0]) < 0.1 && Math.abs(p[1] - 1) < 0.1 && Math.abs(p[2]) < 0.1;
      if (want > 1e-4) expect(r.distance[i] < 0).toBe(inside);
    }
  });

  it('respects region: a trunk particle beside an arm face binds to the nearest trunk face', () => {
    const b = box(); // +x is the arm
    const p: V = [0.12, 1.08, 0];
    const r = bindParticles(b, pts(p, p, p), new Uint8Array([BIND_TRUNK, BIND_ARM, BIND_ANY]), OPT);
    const [tTrunk, tArm, tAny] = [0, 1, 2].map((i) => triOf(b, r.tri, i));
    expect(b.faceOf[tTrunk]).toBe(2); // +y face, at its edge (0.1, 1.1, 0)
    expect(isArmTri(b, tTrunk)).toBe(false);
    expect(r.distance[0]).toBeCloseTo(Math.hypot(0.02, 0.02), 6);
    expect(r.distance[0]).toBeGreaterThan(0);
    expect(b.faceOf[tArm]).toBe(0);
    expect(r.distance[1]).toBeCloseTo(0.02, 6);
    expect(b.faceOf[tAny]).toBe(0);
    // and an arm particle beside a trunk face binds to the arm
    const q: V = [0.08, 1.12, 0];
    const s = bindParticles(b, pts(q), new Uint8Array([BIND_ARM]), OPT);
    expect(b.faceOf[triOf(b, s.tri, 0)]).toBe(0);
    expect(s.distance[0]).toBeCloseTo(Math.hypot(0.02, 0.02), 6);
  });

  it('clamps offsets to [minOffset, maxOffset] and converts them to geometry units', () => {
    const b = box(0.1, 4, [0, 1, 0], []);
    const scale = 0.89974678, off: [number, number, number] = [0, 0.8002533, -0.0340415];
    const ps: V[] = [[0.01, 1.03, 0.11], [0.01, 1.03, 0.1005], [0.01, 1.03, 0.25], [0.01, 1.03, 0.05]];
    const r = bindParticles(b, pts(...ps), new Uint8Array(4).fill(BIND_ANY), { scale, offset: off });
    expect(r.distance[0]).toBeCloseTo(0.01, 6);
    expect(r.offset[0]).toBeCloseTo(0.01 / scale, 6);
    expect(r.offset[1]).toBeCloseTo(0.002 / scale, 6); // 0.5 mm out -> minOffset
    expect(r.distance[2]).toBeCloseTo(0.15, 6);
    expect(r.offset[2]).toBeCloseTo(0.06 / scale, 6); // maxOffset
    // inside: negative distance, minOffset
    expect(r.distance[3]).toBeCloseTo(-0.05, 6);
    expect(r.offset[3]).toBeCloseTo(0.002 / scale, 6);

    // the unclamped particle is laid back exactly as ClothSkin.restShape lays it, in geometry units
    const geom = (v: V): V => [(v[0] - off[0]) / scale, (v[1] - off[1]) / scale, (v[2] - off[2]) / scale];
    const [A, B, C] = [0, 1, 2].map((k) => geom(vert(b.positions, r.tri[k])));
    const n = cross(sub(B, A), sub(C, A)), nl = len(n);
    const g = [0, 1, 2].map((k) => r.bary[0] * A[k] + r.bary[1] * B[k] + r.bary[2] * C[k] + (n[k] / nl) * r.offset[0]);
    const want = geom(ps[0]);
    for (let k = 0; k < 3; k++) expect(g[k]).toBeCloseTo(want[k], 5);

    // custom bounds
    const s = bindParticles(b, pts(ps[1], ps[2]), new Uint8Array(2).fill(BIND_ANY), { scale: 2, offset: [0, 0, 0], minOffset: 0.001, maxOffset: 0.1 });
    expect(s.offset[0]).toBeCloseTo(0.001 / 2, 6);
    expect(s.offset[1]).toBeCloseTo(0.1 / 2, 6);
  });

  it('reads which way is out from the vertex normals, and assumes counter-clockwise without them', () => {
    const p: V = [0.01, 1.03, 0.13];
    const one = new Uint8Array([BIND_ANY]);
    const flipped = box(0.1, 4, [0, 1, 0], [], true);
    expect(bindParticles(flipped, pts(p), one, OPT).distance[0]).toBeCloseTo(0.03, 6); // normals say outward
    const bare = { positions: flipped.positions, triangles: flipped.triangles, arm: flipped.arm };
    expect(bindParticles(bare, pts(p), one, OPT).distance[0]).toBeCloseTo(-0.03, 6); // clockwise taken as inward
    const ccw = box(0.1, 4, [0, 1, 0], []);
    expect(bindParticles({ positions: ccw.positions, triangles: ccw.triangles, arm: ccw.arm }, pts(p), one, OPT).distance[0]).toBeCloseTo(0.03, 6);
  });

  it('is deterministic', () => {
    const b = box(0.1, 6, [0, 1, 0], [0, 4]);
    const rand = rng(3), n = 200, P = new Float32Array(n * 3), reg = new Uint8Array(n);
    for (let i = 0; i < n * 3; i++) P[i] = (i % 3 === 1 ? 1 : 0) + (rand() - 0.5) * 0.3;
    for (let i = 0; i < n; i++) reg[i] = i % 3;
    const a = bindParticles(b, P, reg, OPT), c = bindParticles(b, P, reg, OPT);
    expect(Array.from(c.tri)).toEqual(Array.from(a.tri));
    expect(Array.from(c.bary)).toEqual(Array.from(a.bary));
    expect(Array.from(c.offset)).toEqual(Array.from(a.offset));
    expect(Array.from(c.distance)).toEqual(Array.from(a.distance));
  });

  it('binds 10,000 particles on a 50,000-triangle sphere in well under a second', () => {
    const R = 0.3, s = sphere(R, 200, 126);
    expect(s.triangles.length / 3).toBe(50000);
    const rand = rng(11), n = 10000, P = new Float32Array(n * 3), reg = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const z = rand() * 2 - 1, ph = rand() * Math.PI * 2, rr = R * (0.9 + rand() * 0.3), q = Math.sqrt(1 - z * z);
      P[i * 3] = rr * q * Math.cos(ph); P[i * 3 + 1] = 1 + rr * z; P[i * 3 + 2] = rr * q * Math.sin(ph);
      reg[i] = i % 3;
    }
    const t0 = performance.now();
    const r = bindParticles(s, P, reg, { scale: 0.89974678, offset: [0, 0.8002533, -0.0340415] });
    const ms = performance.now() - t0;
    console.log(`bindParticles: ${n} particles on ${s.triangles.length / 3} triangles in ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(1000);
    expect(r.count).toBe(n);
    // spot checks against brute force, and the sign by the radius
    for (let i = 0; i < n; i += 250) {
      const p = vert(P, i);
      const want = bruteNearest(s, p, (t) => reg[i] === BIND_ANY || (reg[i] === BIND_ARM) === isArmTri(s, t));
      expect(Math.abs(r.distance[i])).toBeCloseTo(want, 5);
      if (reg[i] === BIND_ANY) {
        const rad = Math.hypot(p[0], p[1] - 1, p[2]);
        if (Math.abs(rad - R) > 0.002) expect(r.distance[i] > 0).toBe(rad > R);
      }
    }
  });
});
