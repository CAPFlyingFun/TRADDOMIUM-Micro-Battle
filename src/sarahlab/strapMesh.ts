/**
 * A BUILT STRAP'S MESH (Joshua, 2026-10-23: "Strip (hem, waistband, flat strap); Cord (round strap)... adjustable width,
 * thickness, skin clearance and fabric, using the existing materials and edging", and "Builder hems and straps should
 * follow smooth curves, with the edging along them").
 *
 * Milestone 1 of the clothing builder is one editable strap. Every frame another module turns the strap's attachments
 * into posed points on her skin, with her surface direction at each, in her mesh's LOCAL space, and hands them here.
 * This module knows nothing of her body: it is geometry on one BufferGeometry, and nothing else.
 *
 * How it is laid:
 * - The points are SMOOTHED first (`smoothStrap`), because a strap through a handful of attachments drawn as straight
 *   runs reads as a polygon, not a hem. A centripetal Catmull-Rom (alpha 0.5) goes through every point and does not
 *   loop or cusp where two attachments sit close together, which a uniform one does. It is resampled at an equal
 *   arc-length spacing (the caller passes about 3 mm), so the texture runs along it at an even pace however unevenly
 *   the attachments were placed.
 * - Each sample carries a frame: along (t), up off her skin (n) and across (b = t x n). Up is her own surface direction
 *   with the part along the strap taken out, so the strap lies flat on her and twists only as her skin does.
 * - A STRIP is a flat band with real thickness: top, bottom and two sides, each with its own vertices so the edges are
 *   hard. Its texture's v runs across the width on the top and bottom, so a trim whose stitched edges are its top and
 *   bottom bands lands the edging on the strap's two edges, and the sides wear that edge colour. That is "the edging
 *   along them".
 * - A CORD is a round tube of ten facets with smooth normals, v running around it.
 * - An open strap gets flat end caps; a closed one joins its last ring to its first (the texture's u keeps counting
 *   across the join, so there is one seam there, accepted).
 * - Triangles wind counter-clockwise from outside, so the material can be FrontSide.
 *
 * It runs every frame for a few straps of up to a couple of thousand samples, so the buffers are kept and written in
 * place, grown only when a longer strap needs more room, and the scratch vectors are reused.
 */
import * as THREE from 'three';

export type StrapMeshKind = 'strip' | 'cord';

export interface StrapShape {
  readonly kind: StrapMeshKind;
  /** Across the strap, local units (a cord: its diameter). */
  readonly width: number;
  /** A strip's thickness, local units (a cord ignores it). */
  readonly thickness: number;
  /** From her skin to the strap's underside, local units. */
  readonly clearance: number;
  /** The last point joins the first. */
  readonly closed: boolean;
  /** Spacing of the smoothed samples along the strap, local units (the caller passes ~3 mm). */
  readonly spacing: number;
  /** Length along the strap of one repeat of the texture, local units. */
  readonly uvLength: number;
}

/** Default ceiling on samples per strap: beyond it the spacing grows to fit rather than the mesh growing without end. */
const MAX_SAMPLES = 4000;
/** Facets around a cord. Ten reads round at strap sizes and costs eleven vertices a ring with the UV seam. */
const CORD_SIDES = 10;
const CORD_RING = CORD_SIDES + 1;
/** A strip's ring: top (2), bottom (2), and each side (2), each face its own vertices for hard edges. */
const STRIP_RING = 8;
/** Per face of a strip, which two ring vertices are its LEFT and RIGHT edge, such that (right - left) x along = outward. */
const STRIP_FACES: readonly (readonly [number, number])[] = [[0, 1], [3, 2], [5, 4], [6, 7]];
/** How much a buffer grows when it must, so a strap lengthening a little each frame does not reallocate every frame. */
const GROWTH = 1.5;
const TINY = 1e-12;

/** Cosine and sine around a cord, with the seam vertex exactly equal to the first so the tube closes without a crack. */
const CORD_COS = new Float64Array(CORD_RING);
const CORD_SIN = new Float64Array(CORD_RING);
for (let j = 0; j < CORD_RING; j++) {
  const a = (j % CORD_SIDES) / CORD_SIDES * Math.PI * 2;
  CORD_COS[j] = Math.cos(a);
  CORD_SIN[j] = Math.sin(a);
}

/** A vector's length. Not `Math.hypot`, which V8 runs many times slower and this calls thousands of times a frame. */
function len3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

function grow(a: Float64Array, need: number): Float64Array {
  return a.length >= need ? a : new Float64Array(Math.max(need, Math.ceil(a.length * GROWTH)));
}

/**
 * The smoothing, with its own scratch arrays so the mesh can run it every frame without allocating. `smoothStrap` is
 * this with the results copied out into vectors.
 */
class StrapSampler {
  /** The kept (finite, non-coincident) points: position, normal and lift. */
  private cp = new Float64Array(0);
  private cn = new Float64Array(0);
  private cl = new Float64Array(0);
  /** Per segment the cubic's coefficients, xyz each of a, b, c, d: p(u) = ((a u + b) u + c) u + d, u in 0..1. */
  private coef = new Float64Array(0);
  /** A fine walk along the spline, used only to measure it: global parameter (segment + u) and arc length so far. */
  private denseU = new Float64Array(0);
  private denseS = new Float64Array(0);
  /** The samples. */
  pos = new Float64Array(0);
  nor = new Float64Array(0);
  lift = new Float64Array(0);
  along = new Float64Array(0);
  count = 0;
  /** The strap's whole arc length; a closed strap's includes the span from its last sample back to its first. */
  length = 0;

  run(positions: readonly THREE.Vector3[], normals: readonly THREE.Vector3[], lifts: readonly number[], closed: boolean,
    spacing: number, maxSamples: number): number {
    this.count = 0;
    this.length = 0;
    const spacingOk = Number.isFinite(spacing) && spacing > 0;
    // Two attachments closer than this are one: a knot interval of nothing is all the spline cannot take.
    const eps = spacingOk ? Math.max(1e-9, spacing * 1e-4) : 1e-9;
    const eps2 = eps * eps;

    // 1. Keep the points worth keeping.
    const total = positions.length;
    this.cp = grow(this.cp, total * 3);
    this.cn = grow(this.cn, total * 3);
    this.cl = grow(this.cl, total);
    const cp = this.cp, cn = this.cn, cl = this.cl;
    let m = 0;
    let lnx = 0, lny = 1, lnz = 0;
    for (let i = 0; i < total; i++) {
      const p = positions[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
      if (m > 0) {
        const dx = p.x - cp[(m - 1) * 3], dy = p.y - cp[(m - 1) * 3 + 1], dz = p.z - cp[(m - 1) * 3 + 2];
        if (dx * dx + dy * dy + dz * dz <= eps2) continue;
      }
      // A missing or broken normal borrows the last good one, so one bad attachment does not flip the strap.
      const nv = normals[i];
      if (nv && Number.isFinite(nv.x) && Number.isFinite(nv.y) && Number.isFinite(nv.z) && nv.x * nv.x + nv.y * nv.y + nv.z * nv.z > TINY) {
        lnx = nv.x; lny = nv.y; lnz = nv.z;
      }
      const lv = lifts[i];
      cp[m * 3] = p.x; cp[m * 3 + 1] = p.y; cp[m * 3 + 2] = p.z;
      cn[m * 3] = lnx; cn[m * 3 + 1] = lny; cn[m * 3 + 2] = lnz;
      cl[m] = typeof lv === 'number' && Number.isFinite(lv) ? lv : 0;
      m++;
    }
    if (closed) {
      // A loop drawn back onto its first point already closes; the wrap supplies that span.
      while (m > 1) {
        const dx = cp[(m - 1) * 3] - cp[0], dy = cp[(m - 1) * 3 + 1] - cp[1], dz = cp[(m - 1) * 3 + 2] - cp[2];
        if (dx * dx + dy * dy + dz * dz > eps2) break;
        m--;
      }
    }
    if (m < 2) return 0;

    // 2. One cubic per span between kept points: the centripetal Catmull-Rom through them, written as a Hermite cubic
    //    whose end tangents are the non-uniform Catmull-Rom's (equivalent to Barry and Goldman's pyramid, cheaper to
    //    evaluate). Open ends take a mirrored ghost point, so the strap leaves its first point heading at its second.
    const segs = closed ? m : m - 1;
    this.coef = grow(this.coef, segs * 12);
    const coef = this.coef;
    let chordTotal = 0;
    for (let s = 0; s < segs; s++) {
      const i1 = s, i2 = (s + 1) % m;
      const p1x = cp[i1 * 3], p1y = cp[i1 * 3 + 1], p1z = cp[i1 * 3 + 2];
      const p2x = cp[i2 * 3], p2y = cp[i2 * 3 + 1], p2z = cp[i2 * 3 + 2];
      let p0x: number, p0y: number, p0z: number, p3x: number, p3y: number, p3z: number;
      if (closed || i1 > 0) {
        const i0 = (i1 - 1 + m) % m;
        p0x = cp[i0 * 3]; p0y = cp[i0 * 3 + 1]; p0z = cp[i0 * 3 + 2];
      } else {
        p0x = 2 * p1x - p2x; p0y = 2 * p1y - p2y; p0z = 2 * p1z - p2z;
      }
      if (closed || i2 < m - 1) {
        const i3 = (i2 + 1) % m;
        p3x = cp[i3 * 3]; p3y = cp[i3 * 3 + 1]; p3z = cp[i3 * 3 + 2];
      } else {
        p3x = 2 * p2x - p1x; p3y = 2 * p2y - p1y; p3z = 2 * p2z - p1z;
      }
      const chord = len3(p2x - p1x, p2y - p1y, p2z - p1z);
      chordTotal += chord;
      const d12 = Math.sqrt(chord);
      let d01 = Math.sqrt(len3(p1x - p0x, p1y - p0y, p1z - p0z));
      let d23 = Math.sqrt(len3(p3x - p2x, p3y - p2y, p3z - p2z));
      if (d01 < 1e-9) d01 = d12;
      if (d23 < 1e-9) d23 = d12;
      const k = s * 12;
      for (let c = 0; c < 3; c++) {
        const q0 = c === 0 ? p0x : c === 1 ? p0y : p0z;
        const q1 = c === 0 ? p1x : c === 1 ? p1y : p1z;
        const q2 = c === 0 ? p2x : c === 1 ? p2y : p2z;
        const q3 = c === 0 ? p3x : c === 1 ? p3y : p3z;
        const m1 = ((q1 - q0) / d01 - (q2 - q0) / (d01 + d12) + (q2 - q1) / d12) * d12;
        const m2 = ((q2 - q1) / d12 - (q3 - q1) / (d12 + d23) + (q3 - q2) / d23) * d12;
        coef[k + c] = 2 * q1 - 2 * q2 + m1 + m2;
        coef[k + 3 + c] = -3 * q1 + 3 * q2 - 2 * m1 - m2;
        coef[k + 6 + c] = m1;
        coef[k + 9 + c] = q1;
      }
    }

    // 3. Measure it on a walk about twice as fine as the samples will be (and never fewer than four steps a span).
    const cap = Math.max(2, Math.floor(Number.isFinite(maxSamples) ? maxSamples : MAX_SAMPLES));
    const coarsest = chordTotal / cap;
    const step = Math.max(spacingOk ? spacing : 0, coarsest) / 2;
    let denseCount = 1;
    for (let s = 0; s < segs; s++) denseCount += this.stepsFor(s, step);
    this.denseU = grow(this.denseU, denseCount);
    this.denseS = grow(this.denseS, denseCount);
    const dU = this.denseU, dS = this.denseS;
    let w = 0;
    let px = coef[9], py = coef[10], pz = coef[11];
    dU[0] = 0; dS[0] = 0;
    for (let s = 0; s < segs; s++) {
      const steps = this.stepsFor(s, step);
      const k = s * 12;
      for (let i = 1; i <= steps; i++) {
        const u = i / steps;
        const x = ((coef[k] * u + coef[k + 3]) * u + coef[k + 6]) * u + coef[k + 9];
        const y = ((coef[k + 1] * u + coef[k + 4]) * u + coef[k + 7]) * u + coef[k + 10];
        const z = ((coef[k + 2] * u + coef[k + 5]) * u + coef[k + 8]) * u + coef[k + 11];
        w++;
        dU[w] = s + u;
        dS[w] = dS[w - 1] + len3(x - px, y - py, z - pz);
        px = x; py = y; pz = z;
      }
    }
    const L = dS[w];
    if (!(L > TINY)) return 0;

    // 4. How many samples: the spacing asked for, rounded so they divide the length evenly, within the ceiling.
    let n = spacingOk ? Math.round(closed ? L / spacing : L / spacing + 1) : cap;
    n = Math.min(Math.max(n, closed ? 3 : 2), cap);
    const gap = closed ? L / n : L / (n - 1);

    // 5. Place them: find each one's arc length on the walk, read the spline's parameter there, and evaluate the spline
    //    itself, so every sample is ON the curve and the curve goes through every point.
    this.pos = grow(this.pos, n * 3);
    this.nor = grow(this.nor, n * 3);
    this.lift = grow(this.lift, n);
    this.along = grow(this.along, n);
    const pos = this.pos, nor = this.nor, lift = this.lift, along = this.along;
    let d = 0;
    for (let k = 0; k < n; k++) {
      const s = !closed && k === n - 1 ? L : k * gap;
      while (d < w - 1 && dS[d + 1] < s) d++;
      const span = dS[d + 1] - dS[d];
      const f = span > TINY ? Math.min(1, Math.max(0, (s - dS[d]) / span)) : 0;
      const U = dU[d] + f * (dU[d + 1] - dU[d]);
      const seg = Math.min(segs - 1, Math.floor(U));
      const u = U - seg;
      const c = seg * 12;
      pos[k * 3] = ((coef[c] * u + coef[c + 3]) * u + coef[c + 6]) * u + coef[c + 9];
      pos[k * 3 + 1] = ((coef[c + 1] * u + coef[c + 4]) * u + coef[c + 7]) * u + coef[c + 10];
      pos[k * 3 + 2] = ((coef[c + 2] * u + coef[c + 5]) * u + coef[c + 8]) * u + coef[c + 11];
      // Normal and lift go straight from one point's to the next along the same parameter. Linear on purpose: a
      // spline through the lifts would overshoot, and a lift dipping below zero puts the strap inside her.
      const a = seg, b = (seg + 1) % m;
      let nx = cn[a * 3] + (cn[b * 3] - cn[a * 3]) * u;
      let ny = cn[a * 3 + 1] + (cn[b * 3 + 1] - cn[a * 3 + 1]) * u;
      let nz = cn[a * 3 + 2] + (cn[b * 3 + 2] - cn[a * 3 + 2]) * u;
      let len = len3(nx, ny, nz);
      if (len < 1e-9) {
        // Opposite normals half way: take the nearer point's.
        const o = u < 0.5 ? a : b;
        nx = cn[o * 3]; ny = cn[o * 3 + 1]; nz = cn[o * 3 + 2];
        len = len3(nx, ny, nz) || 1;
      }
      nor[k * 3] = nx / len; nor[k * 3 + 1] = ny / len; nor[k * 3 + 2] = nz / len;
      lift[k] = cl[a] + (cl[b] - cl[a]) * u;
      along[k] = s;
    }
    this.count = n;
    this.length = L;
    return n;
  }

  /** Steps on the measuring walk for span `s`: its chord over the step, at least four. */
  private stepsFor(s: number, step: number): number {
    const k = s * 12;
    const c = this.coef;
    // The chord of span s is |p(1) - p(0)| = |a + b + c|.
    const chord = len3(c[k] + c[k + 3] + c[k + 6], c[k + 1] + c[k + 4] + c[k + 7], c[k + 2] + c[k + 5] + c[k + 8]);
    return step > 0 ? Math.min(4096, Math.max(4, Math.ceil(chord / step))) : 4;
  }
}

/**
 * Smooth the points: a centripetal Catmull-Rom spline (alpha 0.5) through every point (closed: wrapping; open: with
 * mirrored end tangents), resampled at equal arc-length `spacing` (at least 2 samples for an open strap of >= 2 points;
 * at most `maxSamples`, default 4000 — beyond that the spacing grows to fit), each sample's normal the points' normals
 * interpolated along the same parameter and normalized, its `lift` likewise interpolated. Returns sample
 * positions/normals/lifts and cumulative arc length per sample. Coincident consecutive points are dropped first. Fewer
 * than 2 distinct points: empty.
 *
 * A closed strap's samples are all distinct: the last is one spacing short of the first, and the loop's whole length is
 * the last sample's `along` plus that span.
 */
export function smoothStrap(positions: readonly THREE.Vector3[], normals: readonly THREE.Vector3[], lifts: readonly number[],
  closed: boolean, spacing: number, maxSamples = MAX_SAMPLES): { positions: THREE.Vector3[]; normals: THREE.Vector3[]; lifts: number[]; along: number[] } {
  const sampler = new StrapSampler();
  const n = sampler.run(positions, normals, lifts, closed, spacing, maxSamples);
  const out = { positions: [] as THREE.Vector3[], normals: [] as THREE.Vector3[], lifts: [] as number[], along: [] as number[] };
  for (let k = 0; k < n; k++) {
    out.positions.push(new THREE.Vector3(sampler.pos[k * 3], sampler.pos[k * 3 + 1], sampler.pos[k * 3 + 2]));
    out.normals.push(new THREE.Vector3(sampler.nor[k * 3], sampler.nor[k * 3 + 1], sampler.nor[k * 3 + 2]));
    out.lifts.push(sampler.lift[k]);
    out.along.push(sampler.along[k]);
  }
  return out;
}

export class StrapMesh {
  /** The drawn strap; geometry updated in place every call (buffers grown when needed, setDrawRange to what is used). frustumCulled = false. Its material is the one passed in, or a MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }). */
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly ownMaterial: THREE.Material | null;
  private readonly sampler = new StrapSampler();
  private position!: THREE.BufferAttribute;
  private normal!: THREE.BufferAttribute;
  private uv!: THREE.BufferAttribute;
  private index!: THREE.BufferAttribute;
  private vertexCapacity = 0;
  private indexCapacity = 0;
  /** The index buffer depends only on kind, ring count and open/closed; it is rewritten only when those change. */
  private topology = '';
  private samples = 0;

  constructor(material?: THREE.Material) {
    this.ownMaterial = material ? null : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    this.allocate(STRIP_RING * 64, 24 * 64);
    this.geometry.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geometry, material ?? this.ownMaterial!);
    // Her straps move with her every frame and their bounds with them; culling one by a stale sphere would make it blink.
    this.mesh.frustumCulled = false;
  }

  /** Samples drawn by the last update (0 when nothing). */
  get sampleCount(): number {
    return this.samples;
  }

  /** Lay the strap along `positions` (posed local points on her skin) with her surface direction `normals` there and per-point extra `lifts` (local units), shaped by `shape`. Fewer than 2 distinct points: draws nothing (mesh.visible stays as the caller set it, draw range 0). */
  update(positions: readonly THREE.Vector3[], normals: readonly THREE.Vector3[], lifts: readonly number[], shape: StrapShape): void {
    const s = this.sampler;
    const n = s.run(positions, normals, lifts, shape.closed, shape.spacing, MAX_SAMPLES);
    if (n < 2) {
      this.samples = 0;
      this.geometry.setDrawRange(0, 0);
      return;
    }
    const closed = shape.closed;
    const cord = shape.kind === 'cord';
    const ringSize = cord ? CORD_RING : STRIP_RING;
    // A closed strap repeats its first ring at the end, so its texture can keep counting across the join.
    const rings = closed ? n + 1 : n;
    const segs = rings - 1;
    const capVerts = closed ? 0 : cord ? 2 * (CORD_SIDES + 1) : 2 * 4;
    const capIdx = closed ? 0 : cord ? 2 * CORD_SIDES * 3 : 2 * 2 * 3;
    const usedV = rings * ringSize + capVerts;
    const usedI = segs * (cord ? CORD_SIDES * 6 : STRIP_FACES.length * 6) + capIdx;
    if (usedV > this.vertexCapacity || usedI > this.indexCapacity) {
      this.allocate(Math.max(usedV, Math.ceil(this.vertexCapacity * GROWTH)), Math.max(usedI, Math.ceil(this.indexCapacity * GROWTH)));
    }

    const width = Math.max(0, shape.width || 0);
    const thick = cord ? width : Math.max(0, shape.thickness || 0);
    const clearance = shape.clearance || 0;
    const uScale = Number.isFinite(shape.uvLength) && shape.uvLength > 0 ? 1 / shape.uvLength : 0;
    const P = this.position.array as Float32Array, N = this.normal.array as Float32Array, T = this.uv.array as Float32Array;
    const pos = s.pos, nor = s.nor;
    const w2 = width / 2, h2 = thick / 2;

    let tx = 1, ty = 0, tz = 0;   // the last good tangent, for a sample where the strap folds back on itself
    let ux = 0, uy = 1, uz = 0;   // the last good up, for a sample whose skin normal runs along the strap
    let fx = 0, fy = 0, fz = 0, fnx = 0, fny = 0, fnz = 0, fbx = 0, fby = 0, fbz = 0, ftx = 0, fty = 0, ftz = 0;
    // The centre line's box, for the bounds.
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let r = 0; r < rings; r++) {
      const k = r % n;   // the closing ring is the first sample again
      let cx: number, cy: number, cz: number, nx: number, ny: number, nz: number, bx: number, by: number, bz: number;
      let u: number;
      if (closed && r === n) {
        cx = fx; cy = fy; cz = fz; nx = fnx; ny = fny; nz = fnz; bx = fbx; by = fby; bz = fbz;
        tx = ftx; ty = fty; tz = ftz;
        u = s.length * uScale;
      } else {
        // Tangent: central difference, one-sided at an open strap's ends, wrapping round a closed one.
        const prev = closed ? (k - 1 + n) % n : Math.max(0, k - 1);
        const next = closed ? (k + 1) % n : Math.min(n - 1, k + 1);
        let ax = pos[next * 3] - pos[prev * 3], ay = pos[next * 3 + 1] - pos[prev * 3 + 1], az = pos[next * 3 + 2] - pos[prev * 3 + 2];
        let al = len3(ax, ay, az);
        if (al < 1e-12) {
          ax = pos[next * 3] - pos[k * 3]; ay = pos[next * 3 + 1] - pos[k * 3 + 1]; az = pos[next * 3 + 2] - pos[k * 3 + 2];
          al = len3(ax, ay, az);
        }
        if (al >= 1e-12) { tx = ax / al; ty = ay / al; tz = az / al; }
        // Up: her surface direction with the along part taken out (Gram-Schmidt).
        let sx = nor[k * 3], sy = nor[k * 3 + 1], sz = nor[k * 3 + 2];
        let dot = sx * tx + sy * ty + sz * tz;
        sx -= dot * tx; sy -= dot * ty; sz -= dot * tz;
        let sl = len3(sx, sy, sz);
        if (sl < 1e-6) {
          // Her normal runs along the strap here: keep the last up, made perpendicular.
          sx = ux; sy = uy; sz = uz;
          dot = sx * tx + sy * ty + sz * tz;
          sx -= dot * tx; sy -= dot * ty; sz -= dot * tz;
          sl = len3(sx, sy, sz);
          if (sl < 1e-6) {
            // Any perpendicular: the world axis least along the strap, crossed with it.
            const ex = Math.abs(tx) < 0.6 ? 1 : 0, ey = ex ? 0 : Math.abs(ty) < 0.6 ? 1 : 0, ez = ex || ey ? 0 : 1;
            sx = ty * ez - tz * ey; sy = tz * ex - tx * ez; sz = tx * ey - ty * ex;
            sl = len3(sx, sy, sz);
          }
        }
        nx = sx / sl; ny = sy / sl; nz = sz / sl;
        ux = nx; uy = ny; uz = nz;
        // Across: t x n.
        bx = ty * nz - tz * ny; by = tz * nx - tx * nz; bz = tx * ny - ty * nx;
        const bl = len3(bx, by, bz) || 1;
        bx /= bl; by /= bl; bz /= bl;
        // The centre line stands off her skin by the clearance, the lift and half the strap's own height.
        const off = clearance + s.lift[k] + h2;
        cx = pos[k * 3] + nx * off; cy = pos[k * 3 + 1] + ny * off; cz = pos[k * 3 + 2] + nz * off;
        u = s.along[k] * uScale;
        if (r === 0) {
          fx = cx; fy = cy; fz = cz; fnx = nx; fny = ny; fnz = nz; fbx = bx; fby = by; fbz = bz; ftx = tx; fty = ty; ftz = tz;
        }
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        if (cz < minZ) minZ = cz;
        if (cz > maxZ) maxZ = cz;
      }

      let v = r * ringSize;
      if (cord) {
        for (let j = 0; j < CORD_RING; j++, v++) {
          const dx = nx * CORD_COS[j] + bx * CORD_SIN[j], dy = ny * CORD_COS[j] + by * CORD_SIN[j], dz = nz * CORD_COS[j] + bz * CORD_SIN[j];
          P[v * 3] = cx + dx * w2; P[v * 3 + 1] = cy + dy * w2; P[v * 3 + 2] = cz + dz * w2;
          N[v * 3] = dx; N[v * 3 + 1] = dy; N[v * 3 + 2] = dz;
          T[v * 2] = u; T[v * 2 + 1] = j / CORD_SIDES;
        }
      } else {
        // Corners: top/bottom (+-n) by left/right (-b, +b). v is 0 on the -b edge and 1 on the +b edge.
        const tlx = cx + nx * h2 - bx * w2, tly = cy + ny * h2 - by * w2, tlz = cz + nz * h2 - bz * w2;
        const trx = cx + nx * h2 + bx * w2, try_ = cy + ny * h2 + by * w2, trz = cz + nz * h2 + bz * w2;
        const blx = cx - nx * h2 - bx * w2, bly = cy - ny * h2 - by * w2, blz = cz - nz * h2 - bz * w2;
        const brx = cx - nx * h2 + bx * w2, bry = cy - ny * h2 + by * w2, brz = cz - nz * h2 + bz * w2;
        v = this.vertex(v, tlx, tly, tlz, nx, ny, nz, u, 0);     // 0 top, -b
        v = this.vertex(v, trx, try_, trz, nx, ny, nz, u, 1);    // 1 top, +b
        v = this.vertex(v, blx, bly, blz, -nx, -ny, -nz, u, 0);  // 2 bottom, -b
        v = this.vertex(v, brx, bry, brz, -nx, -ny, -nz, u, 1);  // 3 bottom, +b
        v = this.vertex(v, tlx, tly, tlz, -bx, -by, -bz, u, 0);  // 4 side -b, top
        v = this.vertex(v, blx, bly, blz, -bx, -by, -bz, u, 0);  // 5 side -b, bottom
        v = this.vertex(v, trx, try_, trz, bx, by, bz, u, 1);    // 6 side +b, top
        v = this.vertex(v, brx, bry, brz, bx, by, bz, u, 1);     // 7 side +b, bottom
      }

      // An open strap's cut ends: flat caps facing back along it at the start and forward at the end.
      if (!closed && (r === 0 || r === rings - 1)) {
        const sign = r === 0 ? -1 : 1;
        const qx = tx * sign, qy = ty * sign, qz = tz * sign;
        let c = rings * ringSize + (r === 0 ? 0 : capVerts / 2);
        if (cord) {
          c = this.vertex(c, cx, cy, cz, qx, qy, qz, u, 0.5);
          for (let j = 0; j < CORD_SIDES; j++) {
            const dx = nx * CORD_COS[j] + bx * CORD_SIN[j], dy = ny * CORD_COS[j] + by * CORD_SIN[j], dz = nz * CORD_COS[j] + bz * CORD_SIN[j];
            c = this.vertex(c, cx + dx * w2, cy + dy * w2, cz + dz * w2, qx, qy, qz, u, j / CORD_SIDES);
          }
        } else {
          for (let q = 0; q < 4; q++) {
            const up = q < 2 ? h2 : -h2, side = q % 2 === 0 ? -w2 : w2;
            c = this.vertex(c, cx + nx * up + bx * side, cy + ny * up + by * side, cz + nz * up + bz * side, qx, qy, qz, u, q % 2);
          }
        }
      }
    }

    const key = `${shape.kind}:${rings}:${closed ? 1 : 0}`;
    if (key !== this.topology) {
      this.writeIndex(cord, rings, ringSize, closed);
      this.topology = key;
      const index = this.index;
      index.clearUpdateRanges();
      index.addUpdateRange(0, usedI);
      index.needsUpdate = true;
    }
    for (const [attr, size] of [[this.position, 3], [this.normal, 3], [this.uv, 2]] as const) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, usedV * size);
      attr.needsUpdate = true;
    }
    this.geometry.setDrawRange(0, usedI);
    // Every vertex lies within the cross-section's half-diagonal of the centre line.
    const margin = cord ? w2 : Math.sqrt(w2 * w2 + h2 * h2);
    this.bound(minX - margin, minY - margin, minZ - margin, maxX + margin, maxY + margin, maxZ + margin);
    this.samples = n;
  }

  dispose(): void {
    this.geometry.dispose();
    this.ownMaterial?.dispose();
  }

  private vertex(v: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, vv: number): number {
    const P = this.position.array as Float32Array, N = this.normal.array as Float32Array, T = this.uv.array as Float32Array;
    P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
    N[v * 3] = nx; N[v * 3 + 1] = ny; N[v * 3 + 2] = nz;
    T[v * 2] = u; T[v * 2 + 1] = vv;
    return v + 1;
  }

  /** Every face counter-clockwise from outside: for a left and right edge vertex, (right - left) x along is outward. */
  private writeIndex(cord: boolean, rings: number, ringSize: number, closed: boolean): void {
    const I = this.index.array as Uint32Array;
    let i = 0;
    for (let r = 0; r < rings - 1; r++) {
      const a = r * ringSize, b = a + ringSize;
      if (cord) {
        for (let j = 0; j < CORD_SIDES; j++) {
          I[i++] = a + j; I[i++] = a + j + 1; I[i++] = b + j;
          I[i++] = a + j + 1; I[i++] = b + j + 1; I[i++] = b + j;
        }
      } else {
        for (const [L, R] of STRIP_FACES) {
          I[i++] = a + L; I[i++] = a + R; I[i++] = b + L;
          I[i++] = a + R; I[i++] = b + R; I[i++] = b + L;
        }
      }
    }
    if (closed) return;
    const start = rings * ringSize;
    if (cord) {
      const end = start + CORD_SIDES + 1;
      for (let j = 0; j < CORD_SIDES; j++) {
        const j1 = (j + 1) % CORD_SIDES;
        // Start cap faces -t: centre, next, this. End cap faces +t: centre, this, next.
        I[i++] = start; I[i++] = start + 1 + j1; I[i++] = start + 1 + j;
        I[i++] = end; I[i++] = end + 1 + j; I[i++] = end + 1 + j1;
      }
    } else {
      // Cap corners: 0 top -b, 1 top +b, 2 bottom -b, 3 bottom +b.
      const end = start + 4;
      I[i++] = start; I[i++] = start + 2; I[i++] = start + 1;
      I[i++] = start + 1; I[i++] = start + 2; I[i++] = start + 3;
      I[i++] = end; I[i++] = end + 1; I[i++] = end + 2;
      I[i++] = end + 1; I[i++] = end + 3; I[i++] = end + 2;
    }
  }

  /**
   * New, larger buffers. The geometry is disposed first, which tells the renderer to free the old GPU buffers; it
   * re-registers the geometry with the new ones on the next draw. Swapping attributes without that would strand the
   * old buffers on the GPU.
   */
  private allocate(vertices: number, indices: number): void {
    if (this.vertexCapacity > 0) this.geometry.dispose();
    this.vertexCapacity = vertices;
    this.indexCapacity = indices;
    this.position = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.normal = new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.uv = new THREE.BufferAttribute(new Float32Array(vertices * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.index = new THREE.BufferAttribute(new Uint32Array(indices), 1).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position);
    this.geometry.setAttribute('normal', this.normal);
    this.geometry.setAttribute('uv', this.uv);
    this.geometry.setIndex(this.index);
    this.topology = '';
  }

  /**
   * Bounds of what is drawn now: the centre line's box grown by the cross-section, and the sphere round that box. Not
   * `computeBoundingSphere`, which reads the whole buffer, stale tail and all, so a strap that shrank would keep the
   * bounds of the longer one it replaced; and the centre line is an eighth of the vertices to walk. The sphere is a
   * little loose (a box's corner), which costs a raycast nothing but an early-out it would have taken anyway.
   */
  private bound(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): void {
    const box = this.geometry.boundingBox ?? (this.geometry.boundingBox = new THREE.Box3());
    box.min.set(minX, minY, minZ);
    box.max.set(maxX, maxY, maxZ);
    const sphere = this.geometry.boundingSphere ?? (this.geometry.boundingSphere = new THREE.Sphere());
    box.getBoundingSphere(sphere);
  }
}
