import { describe, expect, it } from 'vitest';
import { prepareCrease, relaxCrease, type CreaseMesh, type CreaseResult } from '../src/view/creaseRelax';

/** Grid spacing in geometry units: about 1.8 mm, the scale of her skin's own triangles. */
const S = 0.002;
/** The default reach of a move: 8 mm in geometry units. */
const CAP = 0.008 / 0.89974678;

/** A mesh being built: positions, normals and a triangle index, unwelded, the way a glTF primitive holds them. */
interface Built { readonly pos: number[]; readonly nrm: number[]; readonly idx: number[] }

function built(): Built {
  return { pos: [], nrm: [], idx: [] };
}

/**
 * Adds an nx-by-ny sheet of vertices `S` apart at height `z`, two triangles a cell, facing +z. When `seam` names a
 * column, that column is laid down twice, the way a texture seam splits it: cells to its left use one copy and cells
 * to its right the other. Returns each grid point's vertex (the left copy at the seam) and the seam's right copies.
 */
function sheet(b: Built, nx: number, ny: number, x0: number, y0: number, z: number, seam = -1) {
  const left: number[][] = [], right: number[][] = [];
  const add = (i: number, j: number): number => {
    b.pos.push(x0 + i * S, y0 + j * S, z);
    b.nrm.push(0, 0, 1);
    return b.pos.length / 3 - 1;
  };
  for (let i = 0; i < nx; i += 1) {
    left.push([]); right.push([]);
    for (let j = 0; j < ny; j += 1) {
      const v = add(i, j);
      left[i].push(v);
      right[i].push(i === seam ? add(i, j) : v);
    }
  }
  for (let i = 0; i + 1 < nx; i += 1) {
    for (let j = 0; j + 1 < ny; j += 1) {
      // the cell's left corners belong to the column's right-hand copy, its right corners to the next column's left
      const v00 = right[i][j], v01 = right[i][j + 1], v10 = left[i + 1][j], v11 = left[i + 1][j + 1];
      b.idx.push(v00, v10, v11, v00, v11, v01);
    }
  }
  return { at: (i: number, j: number) => left[i][j], copy: (i: number, j: number) => right[i][j] };
}

/** The per-local-vertex view `relaxCrease` reads: each local vertex's representative, in local order. */
function gather(mesh: CreaseMesh, full: ArrayLike<number>): Float32Array {
  const out = new Float32Array(3 * mesh.reps.length);
  mesh.reps.forEach((v, i) => { out[3 * i] = full[3 * v]; out[3 * i + 1] = full[3 * v + 1]; out[3 * i + 2] = full[3 * v + 2]; });
  return out;
}

/** The mesh's positions after a shape function, applied by approved position so that seam copies move alike. */
function shaped(b: Built, f: (x: number, y: number, z: number) => [number, number, number]): Float32Array {
  const out = new Float32Array(b.pos.length);
  for (let v = 0; v < b.pos.length / 3; v += 1) out.set(f(b.pos[3 * v], b.pos[3 * v + 1], b.pos[3 * v + 2]), 3 * v);
  return out;
}

function rotateAboutX(deg: number): [number, number, number] {
  const a = (deg * Math.PI) / 180;
  return [0, Math.sin(a), Math.cos(a)];
}

/** Every repaired normal is unit length; every untouched one is NaN in all three. */
function expectUnitOrNaN(res: CreaseResult): void {
  for (let k = 0; k < res.vertices.length; k += 1) {
    const x = res.normal[3 * k], y = res.normal[3 * k + 1], z = res.normal[3 * k + 2];
    if (Number.isNaN(x)) {
      expect(Number.isNaN(y) && Number.isNaN(z)).toBe(true);
    } else {
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
    }
  }
}

/** Ring distance from a set of vertices over a triangle index (for a sheet with no seam). */
function ringDistance(idx: number[], count: number, from: number[]): Int32Array {
  const nb: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
  }
  const d = new Int32Array(count).fill(-1), queue = [...from];
  from.forEach((v) => { d[v] = 0; });
  for (let h = 0; h < queue.length; h += 1) {
    for (const j of nb[queue[h]]) if (d[j] < 0) { d[j] = d[queue[h]] + 1; queue.push(j); }
  }
  return d;
}

const everywhere = () => true;

describe('the crease under her breasts is untangled where it is wrong and nowhere else', () => {
  it('changes nothing on a shape with nothing wrong, whatever the options, the blend included', () => {
    // a gently domed sheet, with its exact normals: curved, so the crossing test has neighbours at angles to refuse.
    // Its positions are float32 values, as a glTF's are, so the shape as given IS the approved body to the bit.
    const b = built();
    sheet(b, 30, 30, -15 * S, -15 * S, 0);
    const dome = (x: number, y: number) => 2 * (x * x + y * y);
    for (let v = 0; v < b.pos.length / 3; v += 1) {
      const x = b.pos[3 * v], y = b.pos[3 * v + 1];
      b.pos[3 * v + 2] = dome(x, y);
      const nx = -4 * x, ny = -4 * y, l = Math.hypot(nx, ny, 1);
      b.nrm.splice(3 * v, 3, nx / l, ny / l, 1 / l);
    }
    for (let k = 0; k < b.pos.length; k += 1) b.pos[k] = Math.fround(b.pos[k]);
    const mesh = prepareCrease(b.pos, b.nrm, b.idx, everywhere);
    const pos = gather(mesh, b.pos), nrm = gather(mesh, b.nrm);
    const posBefore = pos.slice(), nrmBefore = nrm.slice();
    const blendHard = { sharpTau: 0, blendRings: 3, blendIters: 60, blendLambda: 0.7, blendCap: 0.05 };
    for (const options of [{}, { cap: 0.001, grow: 2, smooth: 0, rounds: 3, strayDeg: 5, strayMarginDeg: 1 }, { rounds: 0, grow: 0 }, blendHard]) {
      const res = relaxCrease(mesh, pos, nrm, options);
      expect(res.vertices.length).toBe(0);
      expect(res.offset.length).toBe(0);
      expect(res.normal.length).toBe(0);
      expect(res.found).toEqual({ folds: 0, crossings: 0 });
      expect(res.left).toEqual({ folds: 0, crossings: 0 });
      expect(res).toMatchObject({ rounds: 0, moved: 0, shaded: 0, most: 0 });
    }
    // and it read its inputs without writing to them
    expect(pos).toEqual(posBefore);
    expect(nrm).toEqual(nrmBefore);
  });

  it('welds the copies a texture seam splits, and moves both copies alike', () => {
    const b = built();
    const g = sheet(b, 30, 30, 0, 0, 0, 15);
    const mesh = prepareCrease(b.pos, b.nrm, b.idx, everywhere);
    expect(b.pos.length / 3).toBe(930);
    expect(mesh.reps.length).toBe(900);
    expect(mesh.zoneCount).toBe(900);
    // a fold straight across the seam: one row pushed back past the row below it
    const pos = shaped(b, (x, y, z) => (Math.abs(y - 15 * S) < 1e-9 && x > 7.5 * S && x < 21.5 * S ? [x, y - 1.5 * S, z] : [x, y, z]));
    const res = relaxCrease(mesh, gather(mesh, pos), gather(mesh, b.nrm));
    expect(res.found.folds).toBeGreaterThan(0);
    expect(res.left.folds).toBe(0);
    const at = new Map<number, number>();
    res.vertices.forEach((v, k) => at.set(v, k));
    let seamMoved = 0;
    for (let j = 0; j < 30; j += 1) {
      const a = at.get(g.at(15, j)), c = at.get(g.copy(15, j));
      expect(a === undefined).toBe(c === undefined);
      if (a === undefined || c === undefined) continue;
      expect([...res.offset.subarray(3 * c, 3 * c + 3)]).toEqual([...res.offset.subarray(3 * a, 3 * a + 3)]);
      expect([...res.normal.subarray(3 * c, 3 * c + 3)]).toEqual([...res.normal.subarray(3 * a, 3 * a + 3)]);
      if (Math.hypot(res.offset[3 * a], res.offset[3 * a + 1], res.offset[3 * a + 2]) > 0) seamMoved += 1;
    }
    expect(seamMoved).toBeGreaterThan(0);
    expectUnitOrNaN(res);
  });

  it('unfolds a strip turned over, inside the zone and within the cap', () => {
    const b = built();
    sheet(b, 30, 30, 0, 0, 0);
    const lo = 3 * S - 1e-9, hi = 26 * S + 1e-9;
    const inZone = (x: number, y: number) => x > lo && x < hi && y > lo && y < hi;
    const mesh = prepareCrease(b.pos, b.nrm, b.idx, inZone);
    expect(mesh.zoneCount).toBe(24 * 24);
    // the zone and the ring round it, less the two ring corners the diagonals leave out of every zone triangle
    expect(mesh.reps.length).toBe(26 * 26 - 2);
    const pos = shaped(b, (x, y, z) => (Math.abs(y - 15 * S) < 1e-9 && x > 7.5 * S && x < 21.5 * S ? [x, y - 1.5 * S, z] : [x, y, z]));
    const res = relaxCrease(mesh, gather(mesh, pos), gather(mesh, b.nrm));
    expect(res.found.folds).toBeGreaterThan(0);
    expect(res.found.crossings).toBe(0); // a fold in the plane passes through nothing
    expect(res.left).toEqual({ folds: 0, crossings: 0 });
    expect(res.rounds).toBeGreaterThan(0);
    expect(res.moved).toBeGreaterThan(0);
    expect(res.shaded).toBeGreaterThanOrEqual(res.moved);
    expect(res.most).toBeGreaterThan(0);
    expect(res.most).toBeLessThanOrEqual(CAP + 1e-12);
    for (let k = 0; k < res.vertices.length; k += 1) {
      const v = res.vertices[k];
      expect(inZone(b.pos[3 * v], b.pos[3 * v + 1])).toBe(true);
      expect(Math.hypot(res.offset[3 * k], res.offset[3 * k + 1], res.offset[3 * k + 2])).toBeLessThanOrEqual(CAP + 1e-9);
    }
    // the repaired shape, applied, is clean: asked again, it finds nothing to fold
    const fixed = pos.slice();
    res.vertices.forEach((v, k) => { for (let c = 0; c < 3; c += 1) fixed[3 * v + c] += res.offset[3 * k + c]; });
    expect(relaxCrease(mesh, gather(mesh, fixed), gather(mesh, b.nrm)).found.folds).toBe(0);
    expectUnitOrNaN(res);
  });

  it('pulls a sheet back out of the sheet it was pushed through', () => {
    // her skin under the breast, and a second sheet lying just above it; a bump on the first pushes through the second
    const b = built();
    sheet(b, 30, 30, 0, 0, 0);
    sheet(b, 8, 8, 11.5 * S, 11.5 * S, 0.0006);
    const mesh = prepareCrease(b.pos, b.nrm, b.idx, everywhere);
    const R = 4 * S, H = 0.0015;
    const pos = shaped(b, (x, y, z) => {
      if (z !== 0) return [x, y, z];
      const r = Math.hypot(x - 15 * S, y - 15 * S) / R;
      const t = Math.max(0, 1 - r);
      return [x, y, H * t * t * (3 - 2 * t)];
    });
    const res = relaxCrease(mesh, gather(mesh, pos), gather(mesh, b.nrm));
    expect(res.found.crossings).toBeGreaterThan(0);
    expect(res.left).toEqual({ folds: 0, crossings: 0 });
    expect(res.most).toBeLessThanOrEqual(CAP + 1e-12);
    expect(res.moved).toBeGreaterThan(0);
    expectUnitOrNaN(res);
  });

  it('repairs a blended normal that strays from its surface, feathered, without moving anything', () => {
    const b = built();
    const g = sheet(b, 30, 30, 0, 0, 0);
    const mesh = prepareCrease(b.pos, b.nrm, b.idx, everywhere);
    const stray = [g.at(15, 15), g.at(16, 15)];
    const nrm = b.nrm.slice();
    for (const v of stray) nrm.splice(3 * v, 3, ...rotateAboutX(80));
    const res = relaxCrease(mesh, gather(mesh, b.pos), gather(mesh, nrm));
    expect(res.found).toEqual({ folds: 0, crossings: 0 });
    expect(res.moved).toBe(0);
    expect(res.most).toBe(0);
    expect([...res.offset].every((o) => o === 0)).toBe(true);
    const grow = 14, d = ringDistance(b.idx, b.pos.length / 3, stray); // the default feather
    expect([...d].some((x) => x > grow)).toBe(true); // the sheet reaches past it, so the feather has an edge to test
    const within = [...d].filter((x) => x >= 0 && x <= grow).length;
    expect(res.vertices.length).toBe(within);
    expect(res.shaded).toBe(within);
    for (let k = 0; k < res.vertices.length; k += 1) {
      const v = res.vertices[k];
      expect(d[v]).toBeLessThanOrEqual(grow);
      expect(res.normal[3 * k + 2]).toBeGreaterThan(0.9999); // the surface's own: straight up
    }
    for (const v of stray) expect(res.vertices).toContain(v);
    // a narrower feather reaches fewer rings
    const narrow = relaxCrease(mesh, gather(mesh, b.pos), gather(mesh, nrm), { grow: 2 });
    expect(narrow.vertices.length).toBe([...d].filter((x) => x >= 0 && x <= 2).length);
    expectUnitOrNaN(res);
  });

  it('measures a normal against how far it already strayed on the approved body', () => {
    const b = built();
    const g = sheet(b, 30, 30, 0, 0, 0);
    const v = g.at(15, 15);
    const approved = b.nrm.slice();
    approved.splice(3 * v, 3, ...rotateAboutX(50)); // shaded 50 degrees off its surface on purpose
    const mesh = prepareCrease(b.pos, approved, b.idx, everywhere);
    const res = relaxCrease(mesh, gather(mesh, b.pos), gather(mesh, approved));
    expect(res.vertices.length).toBe(0);
    expect(res.shaded).toBe(0);
    // 30 degrees further than approved is past the 25 degree margin, and is repaired
    const further = approved.slice();
    further.splice(3 * v, 3, ...rotateAboutX(80));
    const fixed = relaxCrease(mesh, gather(mesh, b.pos), gather(mesh, further));
    expect(fixed.vertices).toContain(v);
    expect(fixed.moved).toBe(0);
    expectUnitOrNaN(fixed);
  });
});

/**
 * Kappa, worked out here independently of the module: ((neighbours' mean - x) . n) / mean edge, with n the
 * area-weighted vertex normal. For vertices whose whole neighbourhood is in the mesh given.
 */
function kappaAt(idx: number[], pos: ArrayLike<number>, verts: number[]): number[] {
  const count = pos.length / 3;
  const nb: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
  const n = new Float64Array(3 * count);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
    const e1 = [0, 1, 2].map((k) => pos[3 * b + k] - pos[3 * a + k]), e2 = [0, 1, 2].map((k) => pos[3 * c + k] - pos[3 * a + k]);
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k += 1) n[3 * v + k] += f[k];
  }
  return verts.map((v) => {
    const js = [...nb[v]], l = Math.hypot(n[3 * v], n[3 * v + 1], n[3 * v + 2]);
    let dot = 0, edge = 0;
    for (let k = 0; k < 3; k += 1) dot += (js.reduce((s, j) => s + pos[3 * j + k], 0) / js.length - pos[3 * v + k]) * n[3 * v + k] / l;
    for (const j of js) edge += Math.hypot(pos[3 * j] - pos[3 * v], pos[3 * j + 1] - pos[3 * v + 1], pos[3 * j + 2] - pos[3 * v + 2]);
    return dot / (edge / js.length);
  });
}

/** The mesh's positions with a result's offsets added, the way the renderer applies them. */
function applied(pos: ArrayLike<number>, res: CreaseResult): Float32Array {
  const out = Float32Array.from(pos);
  res.vertices.forEach((v, k) => { for (let c = 0; c < 3; c += 1) out[3 * v + c] += res.offset[3 * k + c]; });
  return out;
}

/** A groove pressed `depth` deep along row 15 of a flat sheet, from column 8 to 21: one vertex wide, a sharp V. */
function grooved(b: Built, depth: number): number[] {
  return b.pos.map((c, k) => {
    const v = Math.floor(k / 3), x = b.pos[3 * v], y = b.pos[3 * v + 1];
    return k % 3 === 2 && Math.abs(y - 15 * S) < 1e-9 && x > 7.5 * S && x < 21.5 * S ? c - depth : c;
  });
}

describe('the crease is blended where the shapes made it sharper than the approved body (Joshua: "blend it more")', () => {
  const lo = 3 * S - 1e-9, hi = 26 * S + 1e-9;
  const inZone = (x: number, y: number) => x > lo && x < hi && y > lo && y < hi;
  const BLEND_CAP = 0.02 / 0.89974678;

  it('rounds out a sharp groove the approved body did not have, inside the zone and within the blend cap', () => {
    const b = built();
    sheet(b, 30, 30, 0, 0, 0);
    const mesh = prepareCrease(b.pos, b.nrm, b.idx, inZone);
    const pos = grooved(b, S); // as deep as the mesh is fine: kappa about 0.5 along it, where the flat sheet is 0
    const res = relaxCrease(mesh, gather(mesh, pos), gather(mesh, b.nrm));
    // nothing was folded or crossed, so this is the blend alone
    expect(res.found).toEqual({ folds: 0, crossings: 0 });
    expect(res.rounds).toBe(0);
    expect(res.left).toEqual({ folds: 0, crossings: 0 });
    expect(res.moved).toBeGreaterThan(0);
    expect(res.most).toBeLessThanOrEqual(BLEND_CAP + 1e-12);
    for (let k = 0; k < res.vertices.length; k += 1) {
      const v = res.vertices[k];
      expect(inZone(b.pos[3 * v], b.pos[3 * v + 1])).toBe(true);
      expect(Math.hypot(res.offset[3 * k], res.offset[3 * k + 1], res.offset[3 * k + 2])).toBeLessThanOrEqual(BLEND_CAP + 1e-9);
    }
    const zone = [...Array(b.pos.length / 3).keys()].filter((v) => inZone(b.pos[3 * v], b.pos[3 * v + 1]));
    const before = Math.max(...kappaAt(b.idx, pos, zone).map(Math.abs));
    const after = Math.max(...kappaAt(b.idx, applied(pos, res), zone).map(Math.abs));
    expect(before).toBeGreaterThan(0.3);
    expect(after).toBeLessThan(before / 2);
    expectUnitOrNaN(res);
  });

  it('leaves skin alone that is exactly as sharp as the approved body, and blends it once the shapes sharpen it', () => {
    const b = built();
    sheet(b, 30, 30, 0, 0, 0);
    const approved = grooved(b, S); // the approved body carries the groove itself
    const mesh = prepareCrease(approved, b.nrm, b.idx, inZone);
    const same = relaxCrease(mesh, gather(mesh, approved), gather(mesh, b.nrm));
    expect(same.vertices.length).toBe(0);
    expect(same).toMatchObject({ moved: 0, shaded: 0, most: 0 });
    // pressed twice as deep, it is sharper than approved, and is blended
    const deeper = approved.map((c, k) => c + (grooved(b, S)[k] - b.pos[k]));
    const blended = relaxCrease(mesh, gather(mesh, deeper), gather(mesh, b.nrm));
    expect(blended.moved).toBeGreaterThan(0);
  });

  it('with blendIters 0 gives exactly what it gave before the blend existed', () => {
    // the fold of the untangling test, run with the old feather (6 rings, 4 passes); the numbers were recorded from
    // the module as it stood before the blend was added
    const b = built();
    sheet(b, 30, 30, 0, 0, 0);
    const mesh = prepareCrease(b.pos, b.nrm, b.idx, inZone);
    const pos = shaped(b, (x, y, z) => (Math.abs(y - 15 * S) < 1e-9 && x > 7.5 * S && x < 21.5 * S ? [x, y - 1.5 * S, z] : [x, y, z]));
    const old = relaxCrease(mesh, gather(mesh, pos), gather(mesh, b.nrm), { blendIters: 0, grow: 6, smooth: 4 });
    expect(old).toMatchObject({ found: { folds: 58, crossings: 0 }, left: { folds: 0, crossings: 0 }, rounds: 1, moved: 100, shaded: 400 });
    expect(old.vertices.length).toBe(400);
    expect(old.most).toBeCloseTo(0.0024357298520936016, 12);
    let sum = 0, sq = 0;
    for (const o of old.offset) { sum += o; sq += o * o; }
    expect(sum).toBeCloseTo(0.0025111059934214766, 12);
    expect(sq).toBeCloseTo(0.00008164746609184582, 14);
    // the blend off is the untangle alone: a blend that moves nothing (lambda 0) lands every vertex on the same spot
    const still = relaxCrease(mesh, gather(mesh, pos), gather(mesh, b.nrm), { blendLambda: 0, grow: 6, smooth: 4 });
    expect([...still.vertices]).toEqual([...old.vertices]);
    expect([...still.offset]).toEqual([...old.offset]);
    // and with the blend on, the untangled strip is rounded further, over a wider stretch, still unfolded
    const on = relaxCrease(mesh, gather(mesh, pos), gather(mesh, b.nrm));
    expect(on.moved).toBeGreaterThan(old.moved);
    expect(on.left).toEqual({ folds: 0, crossings: 0 });
    expect(on.most).toBeLessThanOrEqual(BLEND_CAP + 1e-12);
  });
});
