import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { smoothStrap, StrapMesh, type StrapShape } from '../src/sarahlab/strapMesh';

const UP = new THREE.Vector3(0, 1, 0);

function v(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}

/** Distance from `p` to the polyline through `pts` (closing it when `closed`). */
function distToPolyline(p: THREE.Vector3, pts: THREE.Vector3[], closed: boolean): number {
  const seg = new THREE.Line3();
  const q = new THREE.Vector3();
  let best = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    seg.set(pts[i], pts[(i + 1) % pts.length]);
    seg.closestPointToPoint(p, true, q);
    best = Math.min(best, q.distanceTo(p));
  }
  return best;
}

/** Points on a circle of radius r in the xz plane, normals pointing outward. */
function circle(count: number, r: number): { positions: THREE.Vector3[]; normals: THREE.Vector3[]; lifts: number[] } {
  const positions: THREE.Vector3[] = [], normals: THREE.Vector3[] = [], lifts: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    positions.push(v(Math.cos(a) * r, 0, Math.sin(a) * r));
    normals.push(v(Math.cos(a), 0, Math.sin(a)));
    lifts.push(0);
  }
  return { positions, normals, lifts };
}

/** A straight line along x, normals +y. */
function line(length: number, count: number, lift = 0): { positions: THREE.Vector3[]; normals: THREE.Vector3[]; lifts: number[] } {
  const positions: THREE.Vector3[] = [], normals: THREE.Vector3[] = [], lifts: number[] = [];
  for (let i = 0; i < count; i++) {
    positions.push(v((i / (count - 1)) * length, 0, 0));
    normals.push(UP.clone());
    lifts.push(lift);
  }
  return { positions, normals, lifts };
}

function shape(over: Partial<StrapShape> = {}): StrapShape {
  return { kind: 'strip', width: 0.01, thickness: 0.002, clearance: 0.001, closed: false, spacing: 0.003, uvLength: 0.05, ...over };
}

interface Drawn {
  pos: THREE.Vector3[];
  nor: THREE.Vector3[];
  uv: THREE.Vector2[];
  tris: number[];
  usedVertices: number;
}

/** What the mesh draws: every vertex the draw range's triangles reference, and those triangles. */
function drawn(strap: StrapMesh): Drawn {
  const g = strap.mesh.geometry;
  const P = g.getAttribute('position'), N = g.getAttribute('normal'), T = g.getAttribute('uv');
  const I = g.getIndex()!;
  const tris: number[] = [];
  let usedVertices = 0;
  for (let i = g.drawRange.start; i < g.drawRange.start + g.drawRange.count; i++) {
    const k = I.getX(i);
    tris.push(k);
    usedVertices = Math.max(usedVertices, k + 1);
  }
  const pos: THREE.Vector3[] = [], nor: THREE.Vector3[] = [], uv: THREE.Vector2[] = [];
  for (let k = 0; k < usedVertices; k++) {
    pos.push(v(P.getX(k), P.getY(k), P.getZ(k)));
    nor.push(v(N.getX(k), N.getY(k), N.getZ(k)));
    uv.push(new THREE.Vector2(T.getX(k), T.getY(k)));
  }
  return { pos, nor, uv, tris, usedVertices };
}

/** Every non-degenerate triangle's geometric normal against its vertices' mean normal: the worst agreement (cosine). */
function worstWinding(d: Drawn): number {
  let worst = 1;
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), g = new THREE.Vector3(), m = new THREE.Vector3();
  for (let i = 0; i < d.tris.length; i += 3) {
    const [a, b, c] = [d.tris[i], d.tris[i + 1], d.tris[i + 2]];
    e1.subVectors(d.pos[b], d.pos[a]);
    e2.subVectors(d.pos[c], d.pos[a]);
    g.crossVectors(e1, e2);
    if (g.length() < 1e-14) continue;
    g.normalize();
    m.copy(d.nor[a]).add(d.nor[b]).add(d.nor[c]).normalize();
    worst = Math.min(worst, g.dot(m));
  }
  return worst;
}

describe('smoothStrap', () => {
  const wavy = {
    positions: [v(0, 0, 0), v(0.05, 0.02, 0.01), v(0.1, -0.01, 0.03), v(0.15, 0.03, 0.02), v(0.22, 0, -0.02), v(0.3, 0.01, 0)],
    normals: [UP, UP, UP, UP, UP, UP],
    lifts: [0, 0, 0, 0, 0, 0],
  };

  it('passes through every point it was given, starting and ending on the first and last', () => {
    const s = smoothStrap(wavy.positions, wavy.normals, wavy.lifts, false, 0.003);
    expect(s.positions.length).toBeGreaterThan(50);
    expect(s.positions[0].distanceTo(wavy.positions[0])).toBeLessThan(1e-9);
    expect(s.positions[s.positions.length - 1].distanceTo(wavy.positions[5])).toBeLessThan(1e-9);
    // Between samples the drawn chords cut the curve's corners by their sagitta (about 0.09 mm at 3 mm on these tight
    // bends), and that shrinks with the square of the spacing, which is what a curve through the points does.
    let coarse = 0, fine = 0;
    for (const p of wavy.positions) coarse = Math.max(coarse, distToPolyline(p, s.positions, false));
    const f = smoothStrap(wavy.positions, wavy.normals, wavy.lifts, false, 0.00075);
    for (const p of wavy.positions) fine = Math.max(fine, distToPolyline(p, f.positions, false));
    expect(coarse).toBeLessThan(0.003 * 0.05);
    expect(fine).toBeLessThan(1e-5);
    expect(fine).toBeLessThan(coarse / 8);
  });

  it('samples at an equal arc-length spacing close to the one asked for', () => {
    const s = smoothStrap(wavy.positions, wavy.normals, wavy.lifts, false, 0.003);
    const gaps: number[] = [];
    for (let i = 1; i < s.positions.length; i++) gaps.push(s.positions[i].distanceTo(s.positions[i - 1]));
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(Math.abs(mean - 0.003) / 0.003).toBeLessThan(0.02);
    for (const g of gaps) expect(Math.abs(g - mean) / mean).toBeLessThan(0.02);
    // `along` is cumulative and evenly stepped.
    expect(s.along[0]).toBe(0);
    for (let i = 1; i < s.along.length; i++) expect(s.along[i] - s.along[i - 1]).toBeCloseTo(s.along[1], 9);
    expect(s.along[s.along.length - 1]).toBeGreaterThan(0.3);
  });

  it('interpolates normals and lifts along the strap', () => {
    const s = smoothStrap([v(0, 0, 0), v(1, 0, 0)], [v(0, 1, 0), v(0, 0, 1)], [0, 0.1], false, 0.01);
    expect(s.positions.length).toBe(101);
    const mid = 50;
    expect(s.positions[mid].x).toBeCloseTo(0.5, 6);
    expect(s.lifts[0]).toBeCloseTo(0, 9);
    expect(s.lifts[mid]).toBeCloseTo(0.05, 6);
    expect(s.lifts[100]).toBeCloseTo(0.1, 9);
    expect(s.normals[mid].y).toBeCloseTo(Math.SQRT1_2, 5);
    expect(s.normals[mid].z).toBeCloseTo(Math.SQRT1_2, 5);
    for (const n of s.normals) expect(n.length()).toBeCloseTo(1, 9);
    // Lifts are monotone between monotone points: a lift never overshoots into her skin.
    for (let i = 1; i < s.lifts.length; i++) expect(s.lifts[i]).toBeGreaterThanOrEqual(s.lifts[i - 1] - 1e-12);
  });

  it('wraps a closed loop: the last sample sits one spacing before the first and the length is the loop\'s', () => {
    const r = 0.1;
    const c = circle(16, r);
    const s = smoothStrap(c.positions, c.normals, c.lifts, true, 0.003);
    const n = s.positions.length;
    const closing = s.positions[n - 1].distanceTo(s.positions[0]);
    const step = s.along[1] - s.along[0];
    expect(closing).toBeGreaterThan(0);
    expect(Math.abs(closing - step) / step).toBeLessThan(0.02);
    const total = s.along[n - 1] + closing;
    expect(Math.abs(total - 2 * Math.PI * r) / (2 * Math.PI * r)).toBeLessThan(0.01);
    for (const p of s.positions) expect(Math.abs(Math.hypot(p.x, p.z) - r) / r).toBeLessThan(0.01);
    for (const p of c.positions) expect(distToPolyline(p, s.positions, true)).toBeLessThan(0.003 * 0.02);
    // A loop drawn back onto its own first point is the same loop.
    const again = smoothStrap([...c.positions, c.positions[0].clone()], [...c.normals, c.normals[0]], [...c.lifts, 0], true, 0.003);
    expect(again.positions.length).toBe(n);
  });

  it('drops coincident consecutive points', () => {
    const a = v(0, 0, 0), b = v(0.1, 0.02, 0), c = v(0.2, 0, 0.01);
    const clean = smoothStrap([a, b, c], [UP, UP, UP], [0, 0, 0], false, 0.003);
    const dup = smoothStrap([a, a.clone(), b, b.clone(), b.clone(), c], [UP, UP, UP, UP, UP, UP], [0, 0, 0, 0, 0, 0], false, 0.003);
    expect(dup.positions.length).toBe(clean.positions.length);
    for (let i = 0; i < clean.positions.length; i++) expect(dup.positions[i].distanceTo(clean.positions[i])).toBeLessThan(1e-12);
  });

  it('is empty for fewer than two distinct points', () => {
    expect(smoothStrap([], [], [], false, 0.003).positions).toEqual([]);
    expect(smoothStrap([v(1, 2, 3)], [UP], [0], false, 0.003).positions).toEqual([]);
    const twice = smoothStrap([v(1, 2, 3), v(1, 2, 3)], [UP, UP], [0, 0], true, 0.003);
    expect(twice.positions).toEqual([]);
    expect(twice.along).toEqual([]);
  });

  it('keeps at least two samples on a strap shorter than its spacing', () => {
    const s = smoothStrap([v(0, 0, 0), v(0.001, 0, 0)], [UP, UP], [0, 0], false, 0.003);
    expect(s.positions.length).toBe(2);
    expect(s.positions[1].x).toBeCloseTo(0.001, 12);
  });

  it('caps the sample count and spreads the spacing to fit', () => {
    const s = smoothStrap([v(0, 0, 0), v(10, 0, 0)], [UP, UP], [0, 0], false, 0.003, 100);
    expect(s.positions.length).toBe(100);
    expect(s.along[1]).toBeCloseTo(10 / 99, 6);
    const d = smoothStrap([v(0, 0, 0), v(100, 0, 0)], [UP, UP], [0, 0], false, 0.003);
    expect(d.positions.length).toBe(4000);
  });
});

describe('StrapMesh', () => {
  it('lays a strip on a straight line: top and bottom heights, width across, u along and v across', () => {
    const strap = new StrapMesh();
    const lift = 0.002;
    const l = line(0.3, 4, lift);
    const sh = shape();
    strap.update(l.positions, l.normals, l.lifts, sh);
    expect(strap.sampleCount).toBe(101);
    const d = drawn(strap);
    const yBottom = sh.clearance + lift, yTop = yBottom + sh.thickness;
    let tops = 0, bottoms = 0, sides = 0;
    let minZ = Infinity, maxZ = -Infinity;
    for (let k = 0; k < d.usedVertices; k++) {
      const p = d.pos[k], n = d.nor[k], uv = d.uv[k];
      if (Math.abs(n.x) > 0.99) continue;   // end caps
      expect(uv.x).toBeCloseTo(p.x / sh.uvLength, 4);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      if (n.y > 0.99) {
        tops++;
        expect(p.y).toBeCloseTo(yTop, 6);
        expect(uv.y).toBeCloseTo((p.z + sh.width / 2) / sh.width, 5);
      } else if (n.y < -0.99) {
        bottoms++;
        expect(p.y).toBeCloseTo(yBottom, 6);
        expect(uv.y).toBeCloseTo((p.z + sh.width / 2) / sh.width, 5);
      } else {
        sides++;
        // Sides face across the strap and wear the edge: v 0 on the -z side, 1 on the +z side.
        expect(Math.abs(n.z)).toBeCloseTo(1, 6);
        expect(uv.y).toBe(n.z < 0 ? 0 : 1);
        expect(Math.abs(p.z)).toBeCloseTo(sh.width / 2, 6);
      }
    }
    expect(tops).toBe(202);
    expect(bottoms).toBe(202);
    expect(sides).toBe(404);
    expect(maxZ - minZ).toBeCloseTo(sh.width, 6);
    // u grows along x.
    expect(d.uv[8 * 100].x).toBeGreaterThan(d.uv[0].x);
    expect(d.uv[8 * 100].x).toBeCloseTo(0.3 / sh.uvLength, 4);
    // Open: body plus two caps.
    expect(strap.mesh.geometry.drawRange.count).toBe(100 * 24 + 12);
    expect(strap.mesh.frustumCulled).toBe(false);
    expect(strap.mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    strap.dispose();
  });

  it('lays a cord on a straight line: a round tube of radius width / 2 standing off her by the clearance', () => {
    const strap = new StrapMesh();
    const lift = 0.001;
    const l = line(0.2, 3, lift);
    const sh = shape({ kind: 'cord', width: 0.008 });
    strap.update(l.positions, l.normals, l.lifts, sh);
    const d = drawn(strap);
    const r = sh.width / 2, yc = sh.clearance + lift + r;
    let body = 0, vMax = 0;
    for (let k = 0; k < d.usedVertices; k++) {
      const p = d.pos[k], n = d.nor[k], uv = d.uv[k];
      if (Math.abs(n.x) > 0.99) continue;   // end caps
      body++;
      const out = v(0, p.y - yc, p.z);
      expect(out.length()).toBeCloseTo(r, 6);
      out.normalize();
      expect(n.distanceTo(out)).toBeLessThan(1e-5);
      expect(uv.x).toBeCloseTo(p.x / sh.uvLength, 4);
      expect(uv.y).toBeGreaterThanOrEqual(0);
      expect(uv.y).toBeLessThanOrEqual(1);
      vMax = Math.max(vMax, uv.y);
    }
    expect(body).toBe(strap.sampleCount * 11);
    expect(vMax).toBe(1);
    expect(strap.mesh.geometry.drawRange.count).toBe((strap.sampleCount - 1) * 60 + 60);
    strap.dispose();
  });

  it('winds every face counter-clockwise from outside, so its geometric normal agrees with its vertex normal', () => {
    const l = line(0.3, 4, 0.001);
    const c = circle(12, 0.1);
    for (const kind of ['strip', 'cord'] as const) {
      const strap = new StrapMesh();
      strap.update(l.positions, l.normals, l.lifts, shape({ kind }));
      // A strip's faces are flat, so its normals agree exactly; a ten-sided cord's smooth normals lean up to half a
      // facet (18 degrees) off each flat triangle.
      const straight = kind === 'strip' ? 0.999 : Math.cos(Math.PI / 10) - 0.01;
      expect(worstWinding(drawn(strap))).toBeGreaterThan(straight);
      strap.update(c.positions, c.normals, c.lifts, shape({ kind, closed: true }));
      expect(worstWinding(drawn(strap))).toBeGreaterThan(kind === 'strip' ? 0.99 : 0.93);
      // A twisting, open, curved strap too.
      const wavy = [v(0, 0, 0), v(0.05, 0.02, 0.01), v(0.1, -0.01, 0.03), v(0.15, 0.03, 0.02)];
      const tilted = [v(0, 1, 0), v(0, 1, 0.3).normalize(), v(0.2, 1, 0.5).normalize(), v(0, 1, -0.4).normalize()];
      strap.update(wavy, tilted, [0, 0.001, 0, 0.002], shape({ kind }));
      expect(worstWinding(drawn(strap))).toBeGreaterThan(0.9);
      strap.dispose();
    }
  });

  it('joins a closed loop end to start with no caps, its texture counting on across the join', () => {
    const r = 0.1;
    const c = circle(16, r);
    for (const kind of ['strip', 'cord'] as const) {
      const strap = new StrapMesh();
      const sh = shape({ kind, closed: true });
      strap.update(c.positions, c.normals, c.lifts, sh);
      const n = strap.sampleCount;
      const ring = kind === 'strip' ? 8 : 11;
      expect(strap.mesh.geometry.drawRange.count).toBe(n * (kind === 'strip' ? 24 : 60));
      const d = drawn(strap);
      expect(d.usedVertices).toBe((n + 1) * ring);
      for (let j = 0; j < ring; j++) {
        // The closing ring stands exactly on the first.
        expect(d.pos[n * ring + j].distanceTo(d.pos[j])).toBeLessThan(1e-6);
        expect(d.nor[n * ring + j].distanceTo(d.nor[j])).toBeLessThan(1e-6);
        expect(d.uv[n * ring + j].x).toBeCloseTo((2 * Math.PI * r) / sh.uvLength, 1);
        expect(d.uv[n * ring + j].x).toBeGreaterThan(d.uv[(n - 1) * ring + j].x);
      }
      // No vertex faces along the strap (round the circle): there are no caps.
      for (let k = 0; k < d.usedVertices; k++) {
        const p = d.pos[k];
        const along = v(-p.z, 0, p.x).normalize();
        expect(Math.abs(d.nor[k].dot(along))).toBeLessThan(0.1);
      }
      strap.dispose();
    }
  });

  it('grows its buffers when a longer strap follows a short one, and draws only what is used', () => {
    const strap = new StrapMesh();
    const g = strap.mesh.geometry;
    const short = line(0.01, 2);
    strap.update(short.positions, short.normals, short.lifts, shape());
    const shortSamples = strap.sampleCount;
    expect(g.drawRange.count).toBe((shortSamples - 1) * 24 + 12);
    const before = g.getAttribute('position').count;
    const long = line(3, 2);
    strap.update(long.positions, long.normals, long.lifts, shape());
    expect(strap.sampleCount).toBe(1001);
    expect(g.drawRange.count).toBe(1000 * 24 + 12);
    expect(g.getAttribute('position').count).toBeGreaterThan(before);
    expect(g.getAttribute('position').count).toBeGreaterThanOrEqual(1001 * 8 + 8);
    expect(g.getIndex()!.count).toBeGreaterThanOrEqual(g.drawRange.count);
    expect(g.getIndex()!.array).toBeInstanceOf(Uint32Array);
    expect(strap.mesh.geometry).toBe(g);
    // The bounds are the long strap's, and hold every vertex drawn.
    expect(g.boundingSphere!.radius).toBeGreaterThan(1.49);
    for (const p of drawn(strap).pos) expect(g.boundingSphere!.distanceToPoint(p)).toBeLessThanOrEqual(1e-9);
    // Back to the short one: the buffer is kept, the draw range and bounds shrink.
    strap.update(short.positions, short.normals, short.lifts, shape());
    expect(g.drawRange.count).toBe((shortSamples - 1) * 24 + 12);
    expect(g.boundingSphere!.radius).toBeLessThan(0.02);
    const d = drawn(strap);
    expect(d.usedVertices).toBe(shortSamples * 8 + 8);
    for (const p of d.pos) {
      expect(g.boundingSphere!.distanceToPoint(p)).toBeLessThanOrEqual(1e-9);
      expect(g.boundingBox!.distanceToPoint(p)).toBeLessThanOrEqual(1e-9);
    }
    strap.dispose();
  });

  it('draws nothing for fewer than two distinct points', () => {
    const strap = new StrapMesh();
    strap.update([], [], [], shape());
    expect(strap.sampleCount).toBe(0);
    expect(strap.mesh.geometry.drawRange.count).toBe(0);
    const l = line(0.1, 3);
    strap.update(l.positions, l.normals, l.lifts, shape());
    expect(strap.sampleCount).toBeGreaterThan(0);
    strap.mesh.visible = false;
    strap.update([v(0, 0, 0), v(0, 0, 0)], [UP, UP], [0, 0], shape());
    expect(strap.sampleCount).toBe(0);
    expect(strap.mesh.geometry.drawRange.count).toBe(0);
    expect(strap.mesh.visible).toBe(false);
    strap.dispose();
  });

  it('wears the material it is given and leaves it alone on dispose; its own it disposes', () => {
    const mine = new THREE.MeshBasicMaterial();
    let disposedMine = false;
    mine.addEventListener('dispose', () => { disposedMine = true; });
    const given = new StrapMesh(mine);
    expect(given.mesh.material).toBe(mine);
    given.dispose();
    expect(disposedMine).toBe(false);

    const own = new StrapMesh();
    let disposedOwn = false;
    (own.mesh.material as THREE.Material).addEventListener('dispose', () => { disposedOwn = true; });
    own.dispose();
    expect(disposedOwn).toBe(true);
  });
});
