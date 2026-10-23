/**
 * THE CLEAVAGE BRIDGE (Joshua, 2026-10-22: "keep everything painted, but between the breasts, add a simple shape
 * connector between the breasts to make it look like a shirt... depending on the type of shirt, will determine the
 * shape and dip like if it's a U-neck and V-neck").
 *
 * Paint lies on her skin, so a painted top follows her into her cleavage and reads as body paint. A real top spans the
 * gap: from the front of one breast straight across to the other. The bridge is that span and nothing more -- a thin
 * sheet between the two breasts, in the top's own fabric, drawn in front of the cleavage.
 *
 * How it is made:
 * - Her chest is cut into level slices. In each slice the bridge runs along the line that touches both breasts from
 *   the front (the top edge of the slice's convex outline where it crosses her midline); its two ends are the
 *   vertices where it touches. A slice where that line sits on her skin anyway (below and above her cleavage) gets no
 *   bridge, so it starts and ends where the gap does.
 * - The ends are vertices of her body, so every frame the bridge is re-laid between where they are now: it follows
 *   every belly and breast shape, every pose and every bounce. The ends are chosen again whenever her shape changes.
 * - Its top is cut level just under the lowest point of the top's neckline (`necklineTop`, `cutAt`): a crew neck
 *   bridges the whole cleavage; a scoop, a U or a V stops it at the dip, the paint's own edge drawing the rest of the
 *   neckline. Rows whose ends the top's paint does not cover (a bandeau's top edge) are left off too.
 */
import * as THREE from 'three';
import { BODY_REGIONS, type BodyMap } from './bodyRegions';
import { necklineTop, type CoverageParams } from './paintTemplates';

/** The slices, on her trunk (0 hip joints, 1 base of her neck): from below her bust to above it, this far apart. */
const T_LOW = 0.5, T_HIGH = 0.96, ROW_STEP = 0.008, SLAB = 0.006;
/** The ends are smoothed over this many slices either side. */
const SMOOTH = 2;
/** Columns across the gap. */
const COLUMNS = 12;
/** A slice bridges only where its span stands this far off her skin at the midline, as a share of her trunk. */
const MIN_GAP = 0.004;
/**
 * Over this much of her trunk at the bottom of the bridge (about 3 cm on her), the sheet grows out of her cleavage
 * instead of starting in mid-air: at its lowest row it lies on her skin (breast, midline, breast) and straightens into
 * the span as it rises. Under her breasts the gap opens from nothing to more than a centimetre in one slice.
 */
const EMERGE = 0.05;
/** How far in front of the span the sheet sits, as a share of her trunk: enough not to flicker against her skin. */
const LIFT = 0.0015;
/** Only her chest from the front, within this many neck radii of her midline, can be in a span. */
const REACH = 4;
/** The normals are smoothed over this many slices either side (about 2.5 cm on her). */
const SMOOTH_NORMAL = 5;
/** The sheet fades into her over this share of its width at each end, and this much of her trunk at its top. */
const FEATHER_SIDE = 0.22, FEATHER_TOP = 0.016;
/** The sheet stops this far (a share of her trunk, about 2 mm on her) under the neckline the paint is cut to. */
const CUT_UNDER = 0.004;

const smooth01 = (x: number) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

/**
 * Average each row's pair of ends (or directions) with the `reach` rows either side: x and z only for points (a row's
 * height is its slice), every component for directions.
 */
function smoothEnds(ends: readonly (readonly [THREE.Vector3, THREE.Vector3])[], reach: number, direction: boolean): void {
  for (const side of [0, 1] as const) {
    const was = ends.map((e) => e[side].clone());
    ends.forEach((e, j) => {
      const sum = new THREE.Vector3();
      let n = 0;
      for (let d = -reach; d <= reach; d++) { const q = j + d; if (q < 0 || q >= ends.length) continue; sum.add(was[q]); n++; }
      sum.divideScalar(n);
      if (direction) e[side].copy(sum.normalize()); else { e[side].x = sum.x; e[side].z = sum.z; }
    });
  }
}

/** A slice's span: its ends `a` and `b`, and her midline skin `m` under it. */
interface Row { readonly t: number; readonly a: number; readonly b: number; readonly m: number }

/** The upper outline of points (x, z), z forward, left to right (Andrew's monotone chain). */
function upperHull(pts: readonly { x: number; z: number; i: number }[]): { x: number; z: number; i: number }[] {
  const s = [...pts].sort((p, q) => p.x - q.x), h: typeof s = [];
  for (const p of s) {
    while (h.length >= 2) {
      const o = h[h.length - 2], q = h[h.length - 1];
      if ((q.x - o.x) * (p.z - o.z) - (q.z - o.z) * (p.x - o.x) >= 0) h.pop(); else break;
    }
    h.push(p);
  }
  return h;
}

export class CleavageBridge {
  readonly mesh: THREE.Mesh;
  private readonly chest: number[] = [];
  private rows: Row[] = [];
  private readonly at = new THREE.Vector3();
  private midX = 0;
  private params: (Pick<CoverageParams, 'neckFront' | 'neckStyle'> & { readonly strap?: number }) | null = null;
  private covered: ((v: number) => number) | null = null;

  constructor(private readonly body: THREE.SkinnedMesh, private readonly map: BodyMap) {
    const chestId = BODY_REGIONS.findIndex((r) => r.id === 'chest') + 1;
    for (let v = 0; v < map.region.length; v++) {
      if (map.region[v] === chestId && map.front[v] > 0 && map.trunk[v] >= T_LOW - SLAB && map.trunk[v] <= T_HIGH + SLAB && map.lateral[v] < REACH) this.chest.push(v);
    }
    const geometry = new THREE.BufferGeometry();
    const n = this.rowCount() * (COLUMNS + 1);
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geometry.setAttribute('fabricRest', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geometry.setAttribute('fabricRestNormal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    // white, with the feather in its alpha
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4).fill(1), 4));
    // wound to face out of her front: columns run along +x, rows up +y, so facing +z is (a, b, d); a figure facing -z
    // is the other way round. (Drawn double-sided, a sheet wound the wrong way has every normal turned into her and is
    // lit from behind.)
    const index: number[] = [];
    for (let r = 0; r + 1 < this.rowCount(); r++) for (let c = 0; c < COLUMNS; c++) {
      const a = r * (COLUMNS + 1) + c, b = a + 1, d = a + COLUMNS + 1, e = d + 1;
      if (map.facing > 0) index.push(a, b, d, b, e, d); else index.push(a, d, b, b, d, e);
    }
    geometry.setIndex(index);
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide, vertexColors: true }));
    this.mesh.name = 'cleavageBridge';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // laid in her own (skinned, local) space: a child of her body draws where she is
    body.add(this.mesh);
  }

  /**
   * Its material blends (the feathered edges), drawn after her and still writing depth. Call after anything that
   * dresses the material, which may set it opaque.
   */
  feathered(): void {
    const m = this.mesh.material as THREE.MeshStandardMaterial;
    if (!m.transparent) { m.transparent = true; m.depthWrite = true; m.needsUpdate = true; }
  }

  private rowCount(): number { return Math.round((T_HIGH - T_LOW) / ROW_STEP) + 1; }

  /**
   * Choose the spans from her shape as it is now (call when her belly or breast shape changes, not every frame): in
   * each slice, the line touching both breasts from the front, kept where it stands off her skin.
   */
  reshape(): void {
    this.body.skeleton.update();
    const facing = this.map.facing, pos = new Map<number, THREE.Vector3>();
    let sum = 0;
    for (const v of this.chest) { const p = this.body.getVertexPosition(v, new THREE.Vector3()); pos.set(v, p); sum += p.x; }
    this.midX = this.chest.length ? sum / this.chest.length : 0;
    const trunk = this.map.trunkLength, rows: Row[] = [];
    for (let r = 0; r < this.rowCount(); r++) {
      const t = T_LOW + r * ROW_STEP, slice: { x: number; z: number; i: number }[] = [];
      for (const v of this.chest) if (Math.abs(this.map.trunk[v] - t) < SLAB) { const p = pos.get(v)!; slice.push({ x: p.x, z: p.z * facing, i: v }); }
      if (slice.length < 6) continue;
      const hull = upperHull(slice);
      const k = hull.findIndex((p, j) => j + 1 < hull.length && p.x <= this.midX && hull[j + 1].x >= this.midX);
      if (k < 0) continue;
      const a = hull[k], b = hull[k + 1];
      if (b.x - a.x < 1e-6) continue;
      const lineZ = a.z + (b.z - a.z) * ((this.midX - a.x) / (b.x - a.x));
      let skinZ = -Infinity, m = -1;
      for (const p of slice) if (Math.abs(p.x - this.midX) < 0.25 * this.map.neckRadius && p.z > skinZ) { skinZ = p.z; m = p.i; }
      if (m < 0 || lineZ - skinZ < MIN_GAP * trunk) continue;
      rows.push({ t, a: a.i, b: b.i, m });
    }
    // one contiguous run: the cleavage itself
    let best: Row[] = [], run: Row[] = [];
    for (const row of rows) {
      if (run.length && row.t - run[run.length - 1].t > ROW_STEP * 1.5) run = [];
      run.push(row);
      if (run.length > best.length) best = [...run];
    }
    this.rows = best;
  }

  /**
   * Where the sheet's top is cut, as a trunk height: level, a hair under the lowest point of the top's neckline (at her
   * midline: a crew's depth, the dip of a scoop, a U or a V -- `necklineTop`). The sheet only spans her cleavage, and
   * above a neckline's lowest point the middle of her cleavage is the opening, so there is nothing for it to span; on
   * the neckline's rising sides the paint is the shirt, and its edge the neckline. Cut to the curve instead, its top on
   * her breasts stood above the paint's edge in a notch and in teeth (Joshua, 2026-10-23: "there are some remaining
   * color on her breasts").
   */
  private cutAt(): number {
    const cut = necklineTop(this.params!, 0);
    return Number.isFinite(cut) ? cut - CUT_UNDER : cut;
  }

  /**
   * Dress the bridge for a top (its neckline, and how much of each vertex its paint covers), or take it off (null).
   * Who dresses its material: the caller, with the top's fabric (`setFabricLayer`).
   */
  wear(top: { readonly params: Pick<CoverageParams, 'neckFront' | 'neckStyle'> & { readonly strap?: number }; readonly covered: (v: number) => number } | null): void {
    this.params = top?.params ?? null;
    this.covered = top?.covered ?? null;
    if (top && !this.rows.length) this.reshape();
    this.mesh.visible = !!top && this.rows.length >= 2;
  }

  /** Re-lay the sheet between where its ends are now. Call once a frame, after her skeleton has moved. */
  update(): void {
    if (!this.mesh.visible || !this.params || this.rows.length < 2) return;
    this.body.skeleton.update();
    const g = this.mesh.geometry, P = g.getAttribute('position') as THREE.BufferAttribute, R = g.getAttribute('fabricRest') as THREE.BufferAttribute;
    const RN = g.getAttribute('fabricRestNormal') as THREE.BufferAttribute;
    const rest = this.body.geometry.getAttribute('fabricRest') as THREE.BufferAttribute | undefined;
    const lift = LIFT * this.map.trunkLength * this.map.facing;
    // the rows the top's paint covers at both ends, from the bottom up
    let top = 0;
    while (top < this.rows.length && (!this.covered || (this.covered(this.rows[top].a) > 0.5 && this.covered(this.rows[top].b) > 0.5))) top++;
    const rows = this.rows.slice(0, Math.max(2, top));
    const ends = rows.map((row) => [this.body.getVertexPosition(row.a, new THREE.Vector3()), this.body.getVertexPosition(row.b, new THREE.Vector3())] as const);
    const mids = rows.map((row) => this.body.getVertexPosition(row.m, new THREE.Vector3()));
    // the ends hop a little sideways from slice to slice (each is the vertex the line touches): smoothed over the
    // slices either side, so the sheet's sides run in a smooth line over her breasts
    smoothEnds(ends, SMOOTH, false);
    // lit as part of the breasts it joins: each end takes her own surface direction there, rounding forward through
    // the middle
    const fwd = new THREE.Vector3(0, 0, this.map.facing), BN = this.body.geometry.getAttribute('normal');
    // her bind-pose normal, turned by the bones that move the vertex (the skinning is affine, so the difference of two
    // transformed points is the turned direction)
    const origin = new THREE.Vector3();
    const normalOf = (v: number) => {
      const n = this.body.applyBoneTransform(v, new THREE.Vector3(BN.getX(v), BN.getY(v), BN.getZ(v)));
      return n.sub(this.body.applyBoneTransform(v, origin.set(0, 0, 0))).normalize();
    };
    // smoothed further up and down than the ends are: at her nipples' height the ends are her nipples, and their own
    // surface turns sharply
    const normals = rows.map((row) => [normalOf(row.a), normalOf(row.b)] as const);
    smoothEnds(normals, SMOOTH_NORMAL, true);
    const N = g.getAttribute('normal') as THREE.BufferAttribute, C = g.getAttribute('color') as THREE.BufferAttribute;
    const restOf = (v: number) => (rest ? new THREE.Vector3(rest.getX(v), rest.getY(v), rest.getZ(v)) : this.body.getVertexPosition(v, new THREE.Vector3()));
    // the pattern is laid from the same smoothed ends, or the knit zigzags from row to row
    const restEnds = rows.map((row) => [restOf(row.a), restOf(row.b)] as const);
    smoothEnds(restEnds, SMOOTH, false);
    const restMids = rows.map((row) => restOf(row.m));
    const total = this.rowCount(), tEnd = rows[rows.length - 1].t;
    let k = 0, f = 0, u = 0;
    const place = (t: number) => {
      k = 0;
      while (k + 2 < rows.length && rows[k + 1].t < t) k++;
      f = Math.max(0, Math.min(1, (t - rows[k].t) / Math.max(1e-6, rows[k + 1].t - rows[k].t)));
    };
    const cut = this.cutAt();
    // a neckline that dips below where her cleavage opens leaves no gap under it to span: nothing is drawn (laid flat
    // at its lowest slice instead, the sheet showed as a strip across the opening, above the paint's neckline)
    if (cut <= rows[0].t + ROW_STEP) {
      for (let i = 0; i < C.count; i++) C.setW(i, 0);
      C.needsUpdate = true;
      return;
    }
    for (let c = 0; c <= COLUMNS; c++) {
      u = c / COLUMNS;
      for (let r = 0; r < total; r++) {
        // rows past the last one (or above the neckline's lowest point) fold onto its cut
        const want = rows[0].t + (r / (total - 1)) * (tEnd - rows[0].t);
        const t = Math.min(want, cut);
        place(t);
        // the span (straight from end to end), and her cleavage under it (end, midline, end), blended by how far up
        // the bridge this is: at its bottom it lies on her and straightens into the span within EMERGE
        const w = Math.max(0, Math.min(1, (t - rows[0].t) / EMERGE)), straight = w * w * (3 - 2 * w);
        const at = (pair: readonly (readonly [THREE.Vector3, THREE.Vector3])[], mid: readonly THREE.Vector3[], j: number, out: THREE.Vector3) => {
          const span = this.at.copy(pair[j][0]).lerp(pair[j][1], u);
          const skin = u < 0.5 ? out.copy(pair[j][0]).lerp(mid[j], u * 2) : out.copy(mid[j]).lerp(pair[j][1], (u - 0.5) * 2);
          return skin.lerp(span, straight);
        };
        const lay = (pair: readonly (readonly [THREE.Vector3, THREE.Vector3])[], mid: readonly THREE.Vector3[], out: THREE.Vector3) => {
          const p0 = at(pair, mid, k, new THREE.Vector3()), p1 = at(pair, mid, k + 1, out);
          return p1.set(p0.x + (p1.x - p0.x) * f, p0.y + (p1.y - p0.y) * f, p0.z + (p1.z - p0.z) * f);
        };
        const i = r * (COLUMNS + 1) + c, p = lay(ends, mids, new THREE.Vector3());
        P.setXYZ(i, p.x, p.y, p.z + lift);
        // lit like the breasts it joins: each end's surface direction, rounding forward through the middle
        const nk = (j: number) => normals[j][0].clone().lerp(normals[j][1], u).addScaledVector(fwd, 0.6 * Math.sin(Math.PI * u)).normalize();
        const n = nk(k).lerp(nk(k + 1), f).normalize();
        N.setXYZ(i, n.x, n.y, n.z);
        const q = lay(restEnds, restMids, new THREE.Vector3());
        R.setXYZ(i, q.x, q.y, q.z);
        RN.setXYZ(i, 0, 0, this.map.facing);
        // feathered into her where it meets her (its ends on her breasts, its bottom in her cleavage, its top where her
        // cleavage closes); a neckline's cut is a hem and stays sharp
        const hemmed = cut < tEnd;
        const alpha = smooth01(Math.min(u, 1 - u) / FEATHER_SIDE) * smooth01((t - rows[0].t) / EMERGE) * (hemmed ? 1 : smooth01((tEnd - t) / FEATHER_TOP));
        C.setXYZW(i, 1, 1, 1, alpha);
      }
    }
    P.needsUpdate = true; R.needsUpdate = true; RN.needsUpdate = true; C.needsUpdate = true;
    (g.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
    g.computeBoundingSphere();
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
