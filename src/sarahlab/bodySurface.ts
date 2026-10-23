/**
 * WHERE A BUILT PIECE IS ON HER (Joshua, 2026-10-23: "snap points to her surface, then keep stable surface attachments
 * (no per-frame nearest-vertex search)").
 *
 * A strap of the clothing builder is a list of points, and each point is a SURFACE ANCHOR: one triangle of her body
 * mesh and three barycentric weights in it. That pair is the whole attachment. It is decided once, when the point is
 * placed, and never searched for again: every frame the point is re-made from that triangle's three vertices as they
 * stand NOW -- every morph target (belly size, breast shape, bounce), every slider and every bone of a walk or a sit --
 * so the strap rides her skin exactly as the skin itself moves, for three vertex reads a point instead of a search over
 * fifty thousand.
 *
 * Two spaces, on purpose:
 * - QUERIES ARE ASKED OF HER REST SHAPE (the approved body before any morph or pose, handed in as `rest`): snapping a
 *   point to her, walking a strap along her skin, mirroring a point from one side to the other. A length then means
 *   the same at 0% and at 200% belly -- the same reason the paint brush measures its radius at rest (`bodyPaint.ts`) --
 *   and a triangle chosen at rest is the same triangle in every pose.
 * - A TAP IS READ OFF HER POSED BODY (`capture`, then `pick`): the finger lands on what is on screen, an arm in front of
 *   her belly included, and the anchor that comes back names the same triangle at rest.
 *
 * Her mesh is split along its texture seams -- two vertices can share one position, and the triangles either side of a
 * seam share no vertex index -- so nothing here crosses her surface by vertex-sharing adjacency. Crossing is SPATIAL:
 * a uniform grid over the rest triangles, built once, answers "the closest point of her to here", and a screen grid
 * over the posed triangles, built once per gesture, answers "what is under the finger".
 *
 * Nothing here edits the mesh. A vertex is posed exactly as three's `SkinnedMesh.getVertexPosition` poses it -- morphs,
 * then the bind matrix, the weighted bones, the inverse bind matrix -- and its normal takes her morphs' normals too, as
 * her shader does, but with ONE blended bone matrix per vertex that
 * turns its normal as well as moving its point, rather than three `applyBoneTransform` calls (the cleavage bridge's
 * point-minus-origin trick, which is the same linear map). That keeps a few hundred strap points with their normals to
 * about a millisecond a frame. The bones are read through their current WORLD MATRICES, so whoever has just moved her
 * bones brings those up to date first (the renderer's scene update does it every frame).
 */
import * as THREE from 'three';

/**
 * One point on her: a triangle of the FULL canonical triangle list and its barycentric weights. Declared here as well
 * as beside the clothing builder's data so the two modules need not wait on each other; the shapes are identical.
 */
export interface SurfaceAnchor { readonly tri: number; readonly bary: readonly [number, number, number] }

/** A triangle the surface cannot use at all: a corner outside the vertex list, or a rest corner that is not finite. */
const BROKEN = 1;
/** A triangle with no area at rest (a sliver or a repeated corner): `evaluate` still reads it, every query skips it. */
const FLAT = 2;
/** The rest grid's cells are held under this many; past it the cell grows rather than the grid outgrowing a phone. */
const MAX_REST_CELLS = 1 << 21;
/** The tap grid's cell, CSS pixels. */
const SCREEN_CELL_PX = 16;
/** How far past the viewport's edges the tap grid reaches, so a slop circle at the edge of the screen still finds her. */
const SCREEN_MARGIN_PX = 64;
/** Three's own unskinned vertex read: base position plus morph targets. The skinning is applied here, see `posedVertex`. */
const MORPHED_VERTEX = THREE.Mesh.prototype.getVertexPosition;
/** A rest point this many cells off the grid is not a question about her: answered by brute force rather than rings. */
const FAR_CELLS = 1 << 24;

/** What one gesture saw: her posed body, where it was on screen, and the camera it was seen from. */
interface Capture {
  readonly camera: THREE.Camera;
  readonly width: number;
  readonly height: number;
  /** Local space of the mesh, from world, as it stood at the capture. */
  readonly toLocal: THREE.Matrix4;
  /** xyz per vertex, posed, local. */
  readonly posed: Float32Array;
  /** Screen x and y in CSS pixels, and NDC depth, per vertex. */
  readonly sx: Float32Array;
  readonly sy: Float32Array;
  readonly sd: Float32Array;
  /** 1 where the vertex lies between the near and far planes, so its screen place means something. */
  readonly seen: Uint8Array;
  readonly gw: number;
  readonly gh: number;
  readonly start: Uint32Array;
  readonly list: Uint32Array;
  /** Triangles with a corner off the near or far plane: their screen box is not trustworthy, so every pick tests them. */
  readonly straddle: Uint32Array;
}

export class BodySurface {
  readonly mesh: THREE.SkinnedMesh;
  readonly triangleCount: number;

  private readonly tris: Uint32Array;
  private readonly rest: Float32Array;
  private readonly vertexCount: number;
  private readonly flags: Uint8Array;
  private readonly midX: number;

  // THE REST GRID: a dense box of cells over her rest shape, each cell the triangles whose bounds touch it
  private readonly cell: number;
  private readonly ox: number;
  private readonly oy: number;
  private readonly oz: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  private readonly cellStart: Uint32Array;
  private readonly cellTris: Uint32Array;

  /** One mark per triangle so a triangle in several cells is tested once a query. */
  private readonly stamp: Uint32Array;
  private stampId = 0;

  // the closest-point search's running answer, held on the instance so the inner loop allocates nothing
  private bestTri = -1;
  private bestD2 = Infinity;
  private bu = 0;
  private bv = 0;
  private bw = 0;
  private qu = 0;
  private qv = 0;
  private qw = 0;
  private w0 = 0;
  private w1 = 0;
  private w2 = 0;

  // scratch for `evaluate`, which runs every frame for every anchor of every strap
  private readonly p0 = new THREE.Vector3();
  private readonly p1 = new THREE.Vector3();
  private readonly p2 = new THREE.Vector3();
  private readonly n0 = new THREE.Vector3();
  private readonly n1 = new THREE.Vector3();
  private readonly n2 = new THREE.Vector3();
  private readonly skinIndex = new THREE.Vector4();
  private readonly skinWeight = new THREE.Vector4();
  private readonly skinMatrix = new THREE.Matrix4();
  private readonly boneMatrix = new THREE.Matrix4();
  private readonly e1 = new THREE.Vector3();
  private readonly e2 = new THREE.Vector3();

  private cap: Capture | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  constructor(mesh: THREE.SkinnedMesh, triangles: ArrayLike<number>, rest: Float32Array) {
    this.mesh = mesh;
    this.rest = rest;
    this.tris = Uint32Array.from(triangles);
    const T = Math.floor(this.tris.length / 3);
    this.triangleCount = T;
    const position = mesh.geometry.getAttribute('position');
    this.vertexCount = Math.min(Math.floor(rest.length / 3), position ? position.count : Infinity);
    this.flags = new Uint8Array(T);
    this.stamp = new Uint32Array(T);

    // her midline: the mean rest x of her vertices (a symmetric body's own mirror plane)
    let sumX = 0, nX = 0;
    for (let v = 0; v < this.vertexCount; v++) { const x = rest[v * 3]; if (Number.isFinite(x)) { sumX += x; nX++; } }
    this.midX = nX ? sumX / nX : 0;

    // which triangles a query may use, how big they are, and the box they fill
    const R = rest, tri = this.tris, V = this.vertexCount;
    let edgeSum = 0, edges = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let t = 0; t < T; t++) {
      const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
      if (a >= V || b >= V || c >= V) { this.flags[t] = BROKEN; continue; }
      const ax = R[a * 3], ay = R[a * 3 + 1], az = R[a * 3 + 2];
      const bx = R[b * 3], by = R[b * 3 + 1], bz = R[b * 3 + 2];
      const cx = R[c * 3], cy = R[c * 3 + 1], cz = R[c * 3 + 2];
      if (!Number.isFinite(ax + ay + az + bx + by + bz + cx + cy + cz)) { this.flags[t] = BROKEN; continue; }
      const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
      const bcx = cx - bx, bcy = cy - by, bcz = cz - bz;
      const ab2 = abx * abx + aby * aby + abz * abz, ac2 = acx * acx + acy * acy + acz * acz, bc2 = bcx * bcx + bcy * bcy + bcz * bcz;
      const fx = aby * acz - abz * acy, fy = abz * acx - abx * acz, fz = abx * acy - aby * acx;
      const twiceArea = Math.sqrt(fx * fx + fy * fy + fz * fz), longest2 = Math.max(ab2, ac2, bc2);
      // a sliver whose height is a billionth of its length has no inside to land in
      if (!(twiceArea > 1e-9 * longest2)) { this.flags[t] = FLAT; continue; }
      edgeSum += Math.sqrt(ab2) + Math.sqrt(ac2) + Math.sqrt(bc2); edges += 3;
      minX = Math.min(minX, ax, bx, cx); maxX = Math.max(maxX, ax, bx, cx);
      minY = Math.min(minY, ay, by, cy); maxY = Math.max(maxY, ay, by, cy);
      minZ = Math.min(minZ, az, bz, cz); maxZ = Math.max(maxZ, az, bz, cz);
    }

    // a cell about two of her triangles across: a query near her touches a handful of cells holding a handful each
    let cs = edges ? (2 * edgeSum) / edges : 1;
    if (!(cs > 0) || !Number.isFinite(cs)) cs = 1;
    if (!edges) { minX = minY = minZ = 0; maxX = maxY = maxZ = 0; }
    let nx = 1, ny = 1, nz = 1;
    for (;;) {
      nx = Math.floor((maxX - minX) / cs) + 1; ny = Math.floor((maxY - minY) / cs) + 1; nz = Math.floor((maxZ - minZ) / cs) + 1;
      if (nx * ny * nz <= MAX_REST_CELLS) break;
      cs *= 1.25;
    }
    this.cell = cs; this.ox = minX; this.oy = minY; this.oz = minZ; this.nx = nx; this.ny = ny; this.nz = nz;

    // counting sort of (cell, triangle) pairs into flat arrays: count every cell's triangles, prefix-sum, then fill
    const cells = nx * ny * nz;
    const start = new Uint32Array(cells + 1), span = new Int32Array(6);
    let list = new Uint32Array(0), cursor = start;
    for (let pass = 0; pass < 2; pass++) {
      for (let t = 0; t < T; t++) {
        if (this.flags[t]) continue;
        this.restCellSpan(t, span);
        for (let k = span[2]; k <= span[5]; k++) for (let j = span[1]; j <= span[4]; j++) for (let i = span[0]; i <= span[3]; i++) {
          const c = (k * ny + j) * nx + i;
          if (pass) list[cursor[c]++] = t; else start[c + 1]++;
        }
      }
      if (!pass) {
        for (let c = 0; c < cells; c++) start[c + 1] += start[c];
        list = new Uint32Array(start[cells]);
        cursor = start.slice(0, cells);
      }
    }
    this.cellStart = start;
    this.cellTris = list;
  }

  /** True when `a` names a triangle of this surface with finite weights. */
  valid(a: SurfaceAnchor): boolean {
    if (!a || !Number.isInteger(a.tri) || a.tri < 0 || a.tri >= this.triangleCount || this.flags[a.tri] === BROKEN) return false;
    const b = a.bary;
    return !!b && b.length === 3 && Number.isFinite(b[0]) && Number.isFinite(b[1]) && Number.isFinite(b[2]);
  }

  /**
   * Where the anchor is NOW (morphs + skinning), in the mesh's local space, and her smoothed surface direction there
   * (the three vertex normals turned by their bones, blended by the weights, normalized; falls back to the posed
   * triangle's face normal if that degenerates). Returns outPos.
   *
   * Weights are clamped at zero and renormalised, so a hand-edited anchor cannot throw the point off her triangle. An
   * anchor that is not `valid` leaves outPos at the origin (and outNormal up): check `valid` where anchors come from
   * outside. The normals are her bind normals with her morphs' normals blended in, turned by the bones, as her own
   * shader lights her. No allocation: this runs every frame for every point of every strap.
   */
  evaluate(a: SurfaceAnchor, outPos: THREE.Vector3, outNormal?: THREE.Vector3): THREE.Vector3 {
    if (!this.valid(a)) { outNormal?.set(0, 1, 0); return outPos.set(0, 0, 0); }
    const t = a.tri * 3, i0 = this.tris[t], i1 = this.tris[t + 1], i2 = this.tris[t + 2];
    this.weigh(a.bary);
    const g = this.mesh.geometry, p0 = this.p0, p1 = this.p1, p2 = this.p2;
    const N = outNormal && g.hasAttribute('normal') ? g.getAttribute('normal') : null;
    this.posedVertex(i0, p0, N, this.n0); this.posedVertex(i1, p1, N, this.n1); this.posedVertex(i2, p2, N, this.n2);
    outPos.set(
      p0.x * this.w0 + p1.x * this.w1 + p2.x * this.w2,
      p0.y * this.w0 + p1.y * this.w1 + p2.y * this.w2,
      p0.z * this.w0 + p1.z * this.w1 + p2.z * this.w2,
    );
    if (!outNormal) return outPos;
    if (N) {
      outNormal.set(0, 0, 0).addScaledVector(this.n0, this.w0).addScaledVector(this.n1, this.w1).addScaledVector(this.n2, this.w2);
      const l2 = outNormal.lengthSq();
      if (l2 > 1e-16 && Number.isFinite(l2)) { outNormal.multiplyScalar(1 / Math.sqrt(l2)); return outPos; }
    }
    // her normals cancel here (or she has none): the posed triangle's own face, wound as the mesh is
    outNormal.crossVectors(this.e1.subVectors(p1, p0), this.e2.subVectors(p2, p0));
    const f2 = outNormal.lengthSq();
    if (f2 > 1e-30 && Number.isFinite(f2)) outNormal.multiplyScalar(1 / Math.sqrt(f2));
    else this.restNormal(a, outNormal);
    return outPos;
  }

  /** Where the anchor is on her rest shape. */
  restPoint(a: SurfaceAnchor, out: THREE.Vector3): THREE.Vector3 {
    if (!this.valid(a)) return out.set(0, 0, 0);
    const t = a.tri * 3, R = this.rest, i0 = this.tris[t] * 3, i1 = this.tris[t + 1] * 3, i2 = this.tris[t + 2] * 3;
    this.weigh(a.bary);
    const w0 = this.w0, w1 = this.w1, w2 = this.w2;
    return out.set(
      R[i0] * w0 + R[i1] * w1 + R[i2] * w2,
      R[i0 + 1] * w0 + R[i1 + 1] * w1 + R[i2 + 1] * w2,
      R[i0 + 2] * w0 + R[i1 + 2] * w1 + R[i2 + 2] * w2,
    );
  }

  /** The rest surface's direction at the anchor (rest triangle face normal, consistently wound with the mesh). */
  restNormal(a: SurfaceAnchor, out: THREE.Vector3): THREE.Vector3 {
    if (!this.valid(a)) return out.set(0, 1, 0);
    const t = a.tri * 3, R = this.rest, i0 = this.tris[t] * 3, i1 = this.tris[t + 1] * 3, i2 = this.tris[t + 2] * 3;
    const abx = R[i1] - R[i0], aby = R[i1 + 1] - R[i0 + 1], abz = R[i1 + 2] - R[i0 + 2];
    const acx = R[i2] - R[i0], acy = R[i2 + 1] - R[i0 + 1], acz = R[i2 + 2] - R[i0 + 2];
    out.set(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx);
    const l2 = out.lengthSq();
    if (l2 > 1e-30) return out.multiplyScalar(1 / Math.sqrt(l2));
    // a flat triangle has no face; its corners' bind normals still say which way is out
    const N = this.mesh.geometry.hasAttribute('normal') ? this.mesh.geometry.getAttribute('normal') : null;
    if (N) {
      const v0 = this.tris[t], v1 = this.tris[t + 1], v2 = this.tris[t + 2];
      out.set(N.getX(v0) + N.getX(v1) + N.getX(v2), N.getY(v0) + N.getY(v1) + N.getY(v2), N.getZ(v0) + N.getZ(v1) + N.getZ(v2));
      const n2 = out.lengthSq();
      if (n2 > 1e-30) return out.multiplyScalar(1 / Math.sqrt(n2));
    }
    return out.set(0, 1, 0);
  }

  /**
   * The closest point of her REST surface to `p` (rest/local space) as an anchor, searching no further than
   * `maxDistance` (default: unlimited, i.e. grow the search until found); null if nothing within reach.
   *
   * The grid is searched in growing shells of cells round `p`'s cell, and stops as soon as the next shell cannot hold
   * anything nearer than the best so far (everything in shell k is at least k - 1 cells away). Each candidate is the
   * exact closest point on its triangle (Ericson, Real-Time Collision Detection 5.1.5), whose region tests give the
   * barycentric weights directly, already on the triangle.
   */
  closestRest(p: THREE.Vector3, maxDistance = Infinity): SurfaceAnchor | null {
    const px = p.x, py = p.y, pz = p.z;
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz) || !(maxDistance >= 0) || !this.cellTris.length) return null;
    const limit2 = maxDistance === Infinity ? Infinity : maxDistance * maxDistance;
    const cs = this.cell, nx = this.nx, ny = this.ny, nz = this.nz;
    const ci = Math.floor((px - this.ox) / cs), cj = Math.floor((py - this.oy) / cs), ck = Math.floor((pz - this.oz) / cs);
    this.bestTri = -1; this.bestD2 = Infinity;
    const id = this.nextStamp();
    if (Math.abs(ci) > FAR_CELLS || Math.abs(cj) > FAR_CELLS || Math.abs(ck) > FAR_CELLS) {
      // nowhere near her: no shell walk is worth it, and the shells' integer arithmetic would not be exact out there
      for (let t = 0; t < this.triangleCount; t++) if (!this.flags[t]) this.consider(t, px, py, pz, limit2);
      return this.answer();
    }
    // the first shell that reaches the grid at all, and the one that has covered all of it
    const gap = (c: number, n: number) => (c < 0 ? -c : c >= n ? c - n + 1 : 0);
    const first = Math.max(gap(ci, nx), gap(cj, ny), gap(ck, nz));
    const last = Math.max(ci, nx - 1 - ci, cj, ny - 1 - cj, ck, nz - 1 - ck);
    for (let r = first; r <= last; r++) {
      const reach = (r - 1) * cs;
      if (r > 0 && reach * reach > Math.min(this.bestD2, limit2)) break;
      const i0 = Math.max(0, ci - r), i1 = Math.min(nx - 1, ci + r);
      const j0 = Math.max(0, cj - r), j1 = Math.min(ny - 1, cj + r);
      const k0 = Math.max(0, ck - r), k1 = Math.min(nz - 1, ck + r);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (Math.abs(i - ci) === r || Math.abs(j - cj) === r) {
            // a column on the shell's rim: every cell of it is in the shell
            for (let k = k0; k <= k1; k++) this.scanCell((k * ny + j) * nx + i, id, px, py, pz, limit2);
          } else {
            // a column inside it: only its two end caps are
            if (ck - r >= k0) this.scanCell(((ck - r) * ny + j) * nx + i, id, px, py, pz, limit2);
            if (ck + r <= k1) this.scanCell(((ck + r) * ny + j) * nx + i, id, px, py, pz, limit2);
          }
        }
      }
    }
    return this.answer();
  }

  /**
   * Record where every vertex is now (posed, local) and where it lands on screen for `camera` and a viewport `width` x
   * `height` in CSS pixels (uses mesh.matrixWorld, brought up to date here). Call once as a gesture starts: she may have
   * moved since the last one. One pass over her vertices and one over her triangles, which also files every triangle
   * on screen into a grid of small screen cells, so each `pick` during the gesture is a look in one cell.
   */
  capture(camera: THREE.Camera, width: number, height: number): void {
    this.cap = null;
    if (!(width > 0) || !(height > 0)) return;
    const m = this.mesh;
    m.updateMatrixWorld(true);
    // the camera as it stood (without its children): the pick's ray and the screen places must come from the same eye
    const cam = new (camera.constructor as new () => THREE.Camera)().copy(camera, false);
    const V = this.vertexCount;
    const posed = new Float32Array(V * 3), sx = new Float32Array(V), sy = new Float32Array(V), sd = new Float32Array(V), seen = new Uint8Array(V);
    const v = new THREE.Vector3();
    for (let i = 0; i < V; i++) {
      this.posedVertex(i, v, null, null);
      posed[i * 3] = v.x; posed[i * 3 + 1] = v.y; posed[i * 3 + 2] = v.z;
      v.applyMatrix4(m.matrixWorld).project(cam);
      sx[i] = (v.x * 0.5 + 0.5) * width; sy[i] = (0.5 - v.y * 0.5) * height; sd[i] = v.z;
      seen[i] = v.z >= -1 && v.z <= 1 && Number.isFinite(v.x) && Number.isFinite(v.y) ? 1 : 0;
    }
    const S = SCREEN_CELL_PX, M = SCREEN_MARGIN_PX;
    const gw = Math.max(1, Math.ceil((width + 2 * M) / S)), gh = Math.max(1, Math.ceil((height + 2 * M) / S));
    const cells = gw * gh, start = new Uint32Array(cells + 1), straddle: number[] = [];
    const T = this.triangleCount, tri = this.tris;
    let list = new Uint32Array(0);
    for (let pass = 0; pass < 2; pass++) {
      const cursor = pass ? start.slice(0, cells) : start;
      for (let t = 0; t < T; t++) {
        if (this.flags[t]) continue;
        const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
        const nSeen = seen[a] + seen[b] + seen[c];
        if (nSeen === 0) continue;
        if (nSeen < 3) { if (!pass) straddle.push(t); continue; }
        const minX = Math.min(sx[a], sx[b], sx[c]), maxX = Math.max(sx[a], sx[b], sx[c]);
        const minY = Math.min(sy[a], sy[b], sy[c]), maxY = Math.max(sy[a], sy[b], sy[c]);
        if (maxX < -M || minX > width + M || maxY < -M || minY > height + M) continue;
        const x0 = clampCell(minX, M, S, gw), x1 = clampCell(maxX, M, S, gw), y0 = clampCell(minY, M, S, gh), y1 = clampCell(maxY, M, S, gh);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const cIdx = y * gw + x;
          if (pass) list[cursor[cIdx]++] = t; else start[cIdx + 1]++;
        }
      }
      if (!pass) { for (let c = 0; c < cells; c++) start[c + 1] += start[c]; list = new Uint32Array(start[cells]); }
    }
    this.cap = {
      camera: cam, width, height, toLocal: m.matrixWorld.clone().invert(),
      posed, sx, sy, sd, seen, gw, gh, start, list, straddle: Uint32Array.from(straddle),
    };
  }

  /**
   * With a capture: the point of her surface under screen point (px, py) in CSS pixels, nearest the camera, as an
   * anchor (barycentric of the hit in that posed triangle) and its posed local position. A ray from the camera through
   * the pixel, in the mesh's local space, is tested two-sided against the captured posed triangles whose screen box
   * holds the pixel; the nearest hit wins. If the ray finds nothing, the frontmost vertex within `slop` pixels stands
   * in (its anchor: a triangle it is a corner of, that corner's weight 1), so a tap just off her silhouette still lands
   * on her edge. Null when nothing of her is within slop or there is no capture.
   *
   * Candidates come from the triangles' screen boxes rather than from the vertices near the finger: zoomed in, one of
   * her triangles can be wider than the slop circle, and a tap in its middle has no corner near it at all.
   */
  pick(px: number, py: number, slop = 8): { anchor: SurfaceAnchor; position: THREE.Vector3 } | null {
    const cap = this.cap;
    if (!cap || !Number.isFinite(px) || !Number.isFinite(py)) return null;
    const S = SCREEN_CELL_PX, M = SCREEN_MARGIN_PX, P = cap.posed, tri = this.tris;
    this.ndc.set((px / cap.width) * 2 - 1, 1 - (py / cap.height) * 2);
    this.raycaster.setFromCamera(this.ndc, cap.camera);
    const ray = this.raycaster.ray.applyMatrix4(cap.toLocal);
    const a = this.p0, b = this.p1, c = this.p2, hit = new THREE.Vector3(), best = new THREE.Vector3();
    let bestT = Infinity, bestTri = -1;
    const id = this.nextStamp();
    const tryRay = (t: number) => {
      if (this.stamp[t] === id) return;
      this.stamp[t] = id;
      const i0 = tri[t * 3] * 3, i1 = tri[t * 3 + 1] * 3, i2 = tri[t * 3 + 2] * 3;
      a.set(P[i0], P[i0 + 1], P[i0 + 2]); b.set(P[i1], P[i1 + 1], P[i1 + 2]); c.set(P[i2], P[i2 + 1], P[i2 + 2]);
      if (!ray.intersectTriangle(a, b, c, false, hit)) return;
      const o = ray.origin, d = ray.direction;
      const along = (hit.x - o.x) * d.x + (hit.y - o.y) * d.y + (hit.z - o.z) * d.z;
      if (along < bestT) { bestT = along; bestTri = t; best.copy(hit); }
    };
    const inX = px >= -M && px < cap.width + M, inY = py >= -M && py < cap.height + M;
    if (inX && inY) {
      const cIdx = clampCell(py, M, S, cap.gh) * cap.gw + clampCell(px, M, S, cap.gw);
      for (let e = cap.start[cIdx], end = cap.start[cIdx + 1]; e < end; e++) tryRay(cap.list[e]);
    }
    for (let s = 0; s < cap.straddle.length; s++) tryRay(cap.straddle[s]);
    if (bestTri >= 0) {
      const i0 = tri[bestTri * 3] * 3, i1 = tri[bestTri * 3 + 1] * 3, i2 = tri[bestTri * 3 + 2] * 3;
      a.set(P[i0], P[i0 + 1], P[i0 + 2]); b.set(P[i1], P[i1 + 1], P[i1 + 2]); c.set(P[i2], P[i2 + 1], P[i2 + 2]);
      const w = THREE.Triangle.getBarycoord(best, a, b, c, new THREE.Vector3());
      if (w) {
        this.weigh([w.x, w.y, w.z]);
        return { anchor: { tri: bestTri, bary: [this.w0, this.w1, this.w2] }, position: best };
      }
    }
    // the ray missed her: the frontmost of her vertices within slop of the finger
    if (!(slop >= 0)) return null;
    const s2 = slop * slop, fid = this.nextStamp();
    let vBest = -1, vTri = -1, vCorner = 0, vDepth = Infinity;
    const tryCorners = (t: number) => {
      if (this.stamp[t] === fid) return;
      this.stamp[t] = fid;
      for (let k = 0; k < 3; k++) {
        const v = tri[t * 3 + k];
        if (!cap.seen[v]) continue;
        const dx = cap.sx[v] - px, dy = cap.sy[v] - py;
        if (dx * dx + dy * dy > s2 || cap.sd[v] >= vDepth) continue;
        vBest = v; vTri = t; vCorner = k; vDepth = cap.sd[v];
      }
    };
    if (px + slop >= -M && px - slop < cap.width + M && py + slop >= -M && py - slop < cap.height + M) {
      const x0 = clampCell(px - slop, M, S, cap.gw), x1 = clampCell(px + slop, M, S, cap.gw);
      const y0 = clampCell(py - slop, M, S, cap.gh), y1 = clampCell(py + slop, M, S, cap.gh);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const cIdx = y * cap.gw + x;
        for (let e = cap.start[cIdx], end = cap.start[cIdx + 1]; e < end; e++) tryCorners(cap.list[e]);
      }
    }
    for (let s = 0; s < cap.straddle.length; s++) tryCorners(cap.straddle[s]);
    if (vBest < 0) return null;
    const bary: [number, number, number] = [0, 0, 0];
    bary[vCorner] = 1;
    return { anchor: { tri: vTri, bary }, position: new THREE.Vector3(P[vBest * 3], P[vBest * 3 + 1], P[vBest * 3 + 2]) };
  }

  /** Forget the capture. */
  release(): void { this.cap = null; }

  /**
   * A path ALONG HER SKIN from a to b (rest space), anchors about every `step` local units, not including a or b
   * themselves: a greedy surface walk. From the current surface point c, aim at b and step `step` toward it, snap to
   * the closest rest surface point within 2 * step of c -- near enough that it stays on the near surface instead of
   * jumping through her to the other side -- and repeat until within `step` of b.
   *
   * Each step tries two aims and keeps whichever lands nearer b: STRAIGHT at b, and the same aim LAID INTO THE
   * SURFACE'S PLANE at c. The straight aim alone points into her whenever b is round a curve from c, and a step into a
   * round body snaps straight back to where it started; the laid-in aim alone runs along an edge for ever when c sits
   * on a crease and its triangle is the face it came from. A landing whose surface faces back against c's (more than
   * 120 degrees round) went through her and is refused. Every anchor is nearer b than the one before and at least a
   * quarter step on from it. A step that cannot be both ends the walk -- straight across her from b, where every way
   * along the skin first leads away from b, a greedy walk has nowhere to go -- as does ceil(4 * |b - a| / step) + 10
   * steps, and what was walked is returned. Empty when a and b are within `step` of each other.
   */
  pathBetween(a: SurfaceAnchor, b: SurfaceAnchor, step: number): SurfaceAnchor[] {
    const out: SurfaceAnchor[] = [];
    if (!(step > 0) || !Number.isFinite(step) || !this.valid(a) || !this.valid(b)) return out;
    const B = this.restPoint(b, new THREE.Vector3()), c = this.restPoint(a, new THREE.Vector3());
    let dist = c.distanceTo(B);
    if (!(dist > step)) return out;
    const limit = Math.ceil((4 * dist) / step) + 10, reach = 2 * step;
    const n = new THREE.Vector3(), d = new THREE.Vector3(), aim = new THREE.Vector3(), target = new THREE.Vector3();
    const q = new THREE.Vector3(), qn = new THREE.Vector3(), best = new THREE.Vector3();
    let here: SurfaceAnchor = a;
    for (let s = 0; s < limit; s++) {
      d.subVectors(B, c).multiplyScalar(1 / dist);
      this.restNormal(here, n);
      let next: SurfaceAnchor | null = null, nextDist = dist;
      for (let k = 0; k < 2; k++) {
        if (k === 0) aim.copy(d);
        else {
          aim.copy(d).addScaledVector(n, -d.dot(n));
          if (aim.lengthSq() < 1e-12) {
            // b is straight through her: every way along the skin is as good as another, so take a fixed one
            aim.set(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0);
            aim.addScaledVector(n, -aim.dot(n));
          }
          aim.normalize();
        }
        target.copy(c).addScaledVector(aim, step);
        const landed = this.closestRest(target, reach);
        if (!landed) continue;
        const moved = this.restPoint(landed, q).distanceTo(c);
        // past reach it left the near surface; under a quarter step it is creeping into a dead end, not walking
        if (moved > reach || moved < step / 4) continue;
        if (this.restNormal(landed, qn).dot(n) < -0.5) continue;
        const nd = q.distanceTo(B);
        if (nd < nextDist) { next = landed; nextDist = nd; best.copy(q); }
      }
      if (!next) break;
      out.push(next);
      here = next; c.copy(best); dist = nextDist;
      if (dist <= step) break;
    }
    return out;
  }

  /**
   * The anchor's mirror image across her midline: its rest point with x reflected about `midX` (default: the mean rest
   * x of all vertices, computed once), snapped to the closest rest surface point within `maxDistance` (default: 3x the
   * grid cell size). Null if none.
   */
  mirror(a: SurfaceAnchor, midX = this.midX, maxDistance = 3 * this.cell): SurfaceAnchor | null {
    if (!this.valid(a) || !Number.isFinite(midX)) return null;
    const p = this.restPoint(a, new THREE.Vector3());
    p.x = 2 * midX - p.x;
    return this.closestRest(p, maxDistance);
  }

  // --- inside ---

  /** The weights as used: clamped at zero and renormalised; all three equal if nothing is left. Sets w0..w2. */
  private weigh(b: ArrayLike<number>): void {
    let u = b[0], v = b[1], w = b[2];
    if (!(u > 0)) u = 0;
    if (!(v > 0)) v = 0;
    if (!(w > 0)) w = 0;
    const s = u + v + w;
    if (s > 0 && Number.isFinite(s)) { this.w0 = u / s; this.w1 = v / s; this.w2 = w / s; }
    else { this.w0 = this.w1 = this.w2 = 1 / 3; }
  }

  /**
   * Vertex v as she stands now, in the mesh's local space: its morphed position skinned into `pos` and, given her
   * normals, its bind normal turned by the same bones into `nrm` (unit length). This is three's
   * `SkinnedMesh.applyBoneTransform` with the bones' weighted matrices summed ONCE: the position goes through that
   * matrix, and the normal through its linear part -- skinning is affine, so that is exactly the difference of two
   * transformed points the cleavage bridge takes. A bone missing from her skeleton counts as standing still.
   */
  private posedVertex(v: number, pos: THREE.Vector3, N: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null, nrm: THREE.Vector3 | null): void {
    const m = this.mesh, g = m.geometry, sk = m.skeleton;
    MORPHED_VERTEX.call(m, v, pos);
    if (nrm && N) {
      nrm.set(N.getX(v), N.getY(v), N.getZ(v));
      // her morphs turn her surface as well as moving it (her file carries a normal for every morph target): a 200%
      // belly faces down where a small one faces forward, and a strap laid by the unmorphed normal stood tilted on it,
      // half buried along one edge -- a wavy line round her bump. Blended as three's shader blends them.
      const morphs = g.morphAttributes.normal, influences = m.morphTargetInfluences;
      if (morphs && influences) {
        let sum = 0;
        const base = this.e1.copy(nrm);
        for (let k = 0; k < morphs.length; k++) {
          const w = influences[k];
          if (!w) continue;
          const d = morphs[k];
          if (g.morphTargetsRelative) nrm.x += w * d.getX(v), nrm.y += w * d.getY(v), nrm.z += w * d.getZ(v);
          else { nrm.x += w * (d.getX(v) - base.x); nrm.y += w * (d.getY(v) - base.y); nrm.z += w * (d.getZ(v) - base.z); }
          sum += w;
        }
        if (sum && nrm.lengthSq() < 1e-16) nrm.copy(base);
      }
    }
    const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
    if (!SI || !SW || !sk) { nrm?.normalize(); return; }
    const si = this.skinIndex.set(SI.getX(v), SI.getY(v), SI.getZ(v), SI.getW(v));
    const sw = this.skinWeight.set(SW.getX(v), SW.getY(v), SW.getZ(v), SW.getW(v));
    const acc = this.skinMatrix.elements;
    acc.fill(0);
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(k);
      if (w === 0) continue;
      const b = si.getComponent(k), bone = sk.bones[b];
      if (bone) this.boneMatrix.multiplyMatrices(bone.matrixWorld, sk.boneInverses[b]); else this.boneMatrix.identity();
      const e = this.boneMatrix.elements;
      for (let j = 0; j < 16; j++) acc[j] += w * e[j];
    }
    // the weighted sum of the bones' results, as three takes it: no perspective divide by the weights' total
    acc[3] = 0; acc[7] = 0; acc[11] = 0; acc[15] = 1;
    pos.applyMatrix4(m.bindMatrix).applyMatrix4(this.skinMatrix).applyMatrix4(m.bindMatrixInverse);
    if (nrm && N) nrm.transformDirection(m.bindMatrix).transformDirection(this.skinMatrix).transformDirection(m.bindMatrixInverse);
  }

  /** The rest-grid cells triangle t's bounds touch: [i0, j0, k0, i1, j1, k1], clamped to the grid. */
  private restCellSpan(t: number, out: Int32Array): void {
    const R = this.rest, a = this.tris[t * 3] * 3, b = this.tris[t * 3 + 1] * 3, c = this.tris[t * 3 + 2] * 3, cs = this.cell;
    out[0] = gridCell(Math.min(R[a], R[b], R[c]), this.ox, cs, this.nx);
    out[1] = gridCell(Math.min(R[a + 1], R[b + 1], R[c + 1]), this.oy, cs, this.ny);
    out[2] = gridCell(Math.min(R[a + 2], R[b + 2], R[c + 2]), this.oz, cs, this.nz);
    out[3] = gridCell(Math.max(R[a], R[b], R[c]), this.ox, cs, this.nx);
    out[4] = gridCell(Math.max(R[a + 1], R[b + 1], R[c + 1]), this.oy, cs, this.ny);
    out[5] = gridCell(Math.max(R[a + 2], R[b + 2], R[c + 2]), this.oz, cs, this.nz);
  }

  /** Test every triangle filed in rest cell c that this query has not tested yet. */
  private scanCell(c: number, id: number, px: number, py: number, pz: number, limit2: number): void {
    const list = this.cellTris, stamp = this.stamp;
    for (let e = this.cellStart[c], end = this.cellStart[c + 1]; e < end; e++) {
      const t = list[e];
      if (stamp[t] === id) continue;
      stamp[t] = id;
      this.consider(t, px, py, pz, limit2);
    }
  }

  /** Test triangle t against the running best. */
  private consider(t: number, px: number, py: number, pz: number, limit2: number): void {
    const d2 = this.closestOnTriangle(t, px, py, pz);
    if (d2 < this.bestD2 && d2 <= limit2) { this.bestD2 = d2; this.bestTri = t; this.bu = this.qu; this.bv = this.qv; this.bw = this.qw; }
  }

  private answer(): SurfaceAnchor | null {
    return this.bestTri < 0 ? null : { tri: this.bestTri, bary: [this.bu, this.bv, this.bw] };
  }

  /**
   * Squared distance from p to the closest point of rest triangle t, with that point's barycentric weights left in
   * qu, qv, qw (Ericson, Real-Time Collision Detection 5.1.5: which Voronoi region of the triangle p is in decides
   * whether the answer is a corner, a point on an edge or a point inside, and the weights fall out of the same dots).
   */
  private closestOnTriangle(t: number, px: number, py: number, pz: number): number {
    const R = this.rest, ia = this.tris[t * 3] * 3, ib = this.tris[t * 3 + 1] * 3, ic = this.tris[t * 3 + 2] * 3;
    const ax = R[ia], ay = R[ia + 1], az = R[ia + 2];
    const abx = R[ib] - ax, aby = R[ib + 1] - ay, abz = R[ib + 2] - az;
    const acx = R[ic] - ax, acy = R[ic + 1] - ay, acz = R[ic + 2] - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    let u: number, v: number, w: number;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; }
    else {
      const bpx = apx - abx, bpy = apy - aby, bpz = apz - abz;
      const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; }
      else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) { const s = d1 / (d1 - d3); u = 1 - s; v = s; w = 0; }
        else {
          const cpx = apx - acx, cpy = apy - acy, cpz = apz - acz;
          const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
          if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; }
          else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) { const s = d2 / (d2 - d6); u = 1 - s; v = 0; w = s; }
            else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const s = (d4 - d3) / (d4 - d3 + (d5 - d6)); u = 0; v = 1 - s; w = s; }
              else {
                const denom = va + vb + vc;
                if (!(denom > 0)) { this.qu = 1; this.qv = 0; this.qw = 0; return apx * apx + apy * apy + apz * apz; }
                v = vb / denom; w = vc / denom; u = 1 - v - w;
              }
            }
          }
        }
      }
    }
    this.qu = u; this.qv = v; this.qw = w;
    const dx = abx * v + acx * w - apx, dy = aby * v + acy * w - apy, dz = abz * v + acz * w - apz;
    return dx * dx + dy * dy + dz * dz;
  }

  private nextStamp(): number {
    if (this.stampId >= 0xfffffffe) { this.stamp.fill(0); this.stampId = 0; }
    return ++this.stampId;
  }
}

/** The rest cell a coordinate falls in along one axis, clamped to the grid. */
function gridCell(x: number, origin: number, size: number, n: number): number {
  return Math.min(n - 1, Math.max(0, Math.floor((x - origin) / size)));
}

/** The screen cell a pixel coordinate falls in, clamped to the grid. */
function clampCell(x: number, margin: number, size: number, n: number): number {
  return Math.min(n - 1, Math.max(0, Math.floor((x + margin) / size)));
}
