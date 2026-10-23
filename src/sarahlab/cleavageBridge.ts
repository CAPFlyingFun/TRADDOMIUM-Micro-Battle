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
 * - ONLY THE OUTSIDE LAYER IS THE SHIRT (Joshua, 2026-10-23, drawn as the shirt standing off her with the paint still on
 *   the skin under it: "I want the part directly under that bridge to not be painted"). The skin behind the sheet loses
 *   the top's paint (`under`, laid on her by `fabricMaterial.setUnder`), so looking down a neckline shows her skin inside
 *   the shirt, not a second shirt. Which skin is behind it is measured against the sheet itself, at the skin's own
 *   height as she stands: bare where the sheet stands clear in front of it, painted where the two meet (at its ends on
 *   her breasts, its bottom, a crew's top) -- what is seen there is the shirt. Each measure is a straight ramp over more
 *   than her triangles, so the edge the shader draws at its half-way line is a smooth line, not the triangles'
 *   sawtooth. The sheet is solid to within FEATHER_SIDE of its ends and only fades where it lies on her (it used to fade
 *   over a fifth of its width, and bare skin showed through the fade). Under a neckline cut low, her cleavage is bare
 *   up past the cut (`UNDER_TOP_MARGIN`).
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
/**
 * Where her cleavage closes at the top (a crew neck, which spans all of it), the sheet goes back onto her skin over this
 * much of her trunk the same way, so it closes over the cleavage instead of ending in the air in front of it: from
 * above, the opening it left showed into her cleavage. A neckline's cut is a hem and stays in front.
 */
const EMERGE_TOP = 0.03;
/** How straight the sheet runs at trunk height `t` (0 lying on her skin, 1 the span), between its bottom and top. */
function straightAt(t: number, bottom: number, top: number, hemmed: boolean): number {
  const w = Math.max(0, Math.min(1, Math.min((t - bottom) / EMERGE, hemmed ? 1 : (top - t) / EMERGE_TOP)));
  return w * w * (3 - 2 * w);
}
/** How far in front of the span the sheet sits, as a share of her trunk: enough not to flicker against her skin. */
const LIFT = 0.0015;
/** Only her chest from the front, within this many neck radii of her midline, can be in a span. */
const REACH = 4;
/** The normals are smoothed over this many slices either side (about 2.5 cm on her). */
const SMOOTH_NORMAL = 5;
/**
 * The sheet fades into her over this much of her trunk at each end (about 2.5 mm on her: where it meets her breast it
 * lies on it, so the fade only softens the line), this much at a crew's top and this much at its bottom: only where it
 * lies on her skin or nearly. A fade further out showed, through it, the bare skin deeper in her cleavage.
 */
const FEATHER_SIDE = 0.004, FEATHER_TOP = 0.006, FEATHER_BOTTOM = 0.025;
/**
 * The skin behind the sheet is bare only between its ends (the ramp to bare runs over UNDER_RAMP across each end, a
 * share of her trunk; inside, how far the sheet stands off her decides, below), and over UNDER_RAMP_T of her trunk at
 * the sheet's bottom (where it grows out of her cleavage) and its top.
 */
const UNDER_RAMP = 0.006, UNDER_RAMP_T = 0.02;
/**
 * And only where the sheet stands clear in front of her skin: bare from UNDER_DEPTH behind it (a share of her trunk,
 * about 5 mm on her; none where it is level with her skin, where the two would fight for the same pixels), the ramp
 * running over UNDER_DEPTH_RAMP (about 1 cm) so that across the rim of her cleavage, where the depth grows fast, the
 * bare edge is still a smooth line. Near its ends the sheet meets her breasts and runs into them (its ends are smoothed
 * from slice to slice, which on a round breast puts them a little inside it); skin there, level with the sheet or in
 * front of it, is what is seen, so it keeps the paint and is the shirt.
 */
const UNDER_DEPTH = 0.008, UNDER_DEPTH_RAMP = 0.016;
/**
 * Under a crew, whose sheet closes over the top of her cleavage, the skin in the top of her cleavage keeps its paint for
 * this much of her trunk below where the sheet starts going back onto her (about 7 mm on her): from above, the top of
 * a cleavage is seen over the sheet's top edge, and bare skin there read as a hole in the shirt. Under a neckline cut
 * lower (a scoop, a U, a V), the skin of her cleavage is bare all the way up past the cut, as far as the top's paint
 * covers the sheet's ends: looking down the neckline shows her skin inside the shirt, and the neckline's edge runs
 * across her cleavage on the sheet's hem instead of diving into it.
 */
const UNDER_TOP_MARGIN = 0.012;
/** Every set of `under` values ever laid, numbered, so a new bridge never repeats an old one's number. */
let underNumber = 0;
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
  /** Her skin that can be behind the sheet: in front of her neck's axis, at the bridge's heights, near her midline. */
  private readonly cleft: number[] = [];
  /** Where her chest and cleft were (her own space, x and z) when the spans were last chosen. */
  private readonly shaped = new Map<number, THREE.Vector3>();
  private rows: Row[] = [];
  /**
   * Per vertex of her body, 0 to 1: how far it is behind the sheet's solid part. The top's paint comes off it
   * (`fabricMaterial.setUnder`). `underVersion` changes whenever the values do.
   */
  readonly under: Float32Array;
  underVersion = ++underNumber;
  private underKey = '';
  private readonly at = new THREE.Vector3();
  private midX = 0;
  private params: (Pick<CoverageParams, 'neckFront' | 'neckStyle'> & { readonly strap?: number }) | null = null;
  private covered: ((v: number) => number) | null = null;

  constructor(private readonly body: THREE.SkinnedMesh, private readonly map: BodyMap) {
    const chestId = BODY_REGIONS.findIndex((r) => r.id === 'chest') + 1;
    for (let v = 0; v < map.region.length; v++) {
      if (map.region[v] === chestId && map.front[v] > 0 && map.trunk[v] >= T_LOW - SLAB && map.trunk[v] <= T_HIGH + SLAB && map.lateral[v] < REACH) this.chest.push(v);
      // the cleft: whichever way its skin faces (her breasts' inner faces turn sideways and down), by where it is
      const forward = map.forward ? map.forward[v] > 0 : map.front[v] > 0;
      if (forward && !Number.isFinite(map.arm[v]) && map.trunk[v] >= T_LOW - SLAB && map.trunk[v] <= T_HIGH + SLAB && map.lateral[v] < REACH) this.cleft.push(v);
    }
    this.under = new Float32Array(map.region.length);
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
    const facing = this.map.facing, pos = this.shaped;
    pos.clear();
    let sum = 0;
    for (const v of this.chest) { const p = this.body.getVertexPosition(v, new THREE.Vector3()); pos.set(v, p); sum += p.x; }
    for (const v of this.cleft) if (!pos.has(v)) pos.set(v, this.body.getVertexPosition(v, new THREE.Vector3()));
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
    // the skin behind it is measured again on the next frame
    this.underKey = '';
  }

  /**
   * The skin behind the sheet's solid part, from the spans as they were chosen (`shaped`): between its two ends, more
   * than UNDER_DEPTH behind it, and between its emerging bottom and its top
   * (`topT`). Laid again only when the spans, the rows drawn or the top change.
   *
   * Each vertex is measured against the sheet at the vertex's own height and across-position as she stands, not at its
   * height on her trunk: on the slope of her upper breasts the two differ by millimetres, and so did the sheet's depth,
   * which bared skin the sheet actually lay on (white specks through it).
   */
  private layUnder(rows: readonly Row[], topT: number, hemmed = true): void {
    const key = rows.length < 2 || !Number.isFinite(topT) ? '' : `${rows.length}:${rows[0].t}:${topT.toFixed(5)}:${hemmed}`;
    if (key === this.underKey) return;
    this.underKey = key;
    this.under.fill(0);
    this.underVersion = ++underNumber;
    if (!key) return;
    const T = this.map.trunkLength, facing = this.map.facing;
    const at = (v: number) => this.shaped.get(v) ?? this.body.getVertexPosition(v, new THREE.Vector3());
    const ends = rows.map((row) => [at(row.a).clone(), at(row.b).clone()] as const);
    smoothEnds(ends, SMOOTH, false);
    const mids = rows.map((row) => at(row.m));
    const lastT = rows[rows.length - 1].t, bottomT = rows[0].t + FEATHER_BOTTOM + UNDER_RAMP_T / 2;
    const straight = rows.map((row) => straightAt(row.t, rows[0].t, lastT, hemmed));
    const ramp = (x: number, w: number) => Math.max(0, Math.min(1, 0.5 + x / w));
    // the sheet in slice k at across-position x: its height, its depth, and how far in from its nearer end x is
    const sheet = { y: 0, z: 0, inward: 0 };
    const sheetAt = (k: number, x: number) => {
      const a = ends[k][0], b = ends[k][1], m = mids[k];
      const s = Math.max(0, Math.min(1, (x - a.x) / ((b.x - a.x) || 1e-9)));
      const spanY = a.y + (b.y - a.y) * s, spanZ = a.z + (b.z - a.z) * s;
      // her cleavage under it, end - midline - end, on whichever side of her midline x is
      const [p, q] = (x - m.x) * (a.x - m.x) > 0 ? [a, m] : [m, b];
      const r = Math.max(0, Math.min(1, (x - p.x) / ((q.x - p.x) || 1e-9)));
      const skinY = p.y + (q.y - p.y) * r, skinZ = p.z + (q.z - p.z) * r, w = straight[k];
      sheet.y = skinY + (spanY - skinY) * w;
      sheet.z = skinZ + (spanZ - skinZ) * w;
      sheet.inward = Math.min(x - Math.min(a.x, b.x), Math.max(a.x, b.x) - x) / T;
      return sheet;
    };
    for (const v of this.cleft) {
      const p = at(v);
      // the two slices of the sheet either side of this skin's height
      let k = -1, yBelow = sheetAt(0, p.x).y;
      if (p.y < yBelow) continue;
      for (let j = 0; j + 1 < rows.length; j++) {
        const yAbove = sheetAt(j + 1, p.x).y;
        if (p.y <= yAbove) { k = j; break; }
        yBelow = yAbove;
      }
      if (k < 0) continue;
      const below = { ...sheetAt(k, p.x) }, above = sheetAt(k + 1, p.x);
      const f = Math.max(0, Math.min(1, (p.y - below.y) / ((above.y - below.y) || 1e-9)));
      const z = below.z + (above.z - below.z) * f, inward = below.inward + (above.inward - below.inward) * f;
      const t = rows[k].t + (rows[k + 1].t - rows[k].t) * f;
      const depth = ((z - p.z) * facing) / T + LIFT;
      this.under[v] = ramp(inward, UNDER_RAMP) * ramp(depth - UNDER_DEPTH, UNDER_DEPTH_RAMP) * ramp(t - bottomT, UNDER_RAMP_T) * ramp(topT - t, UNDER_RAMP_T);
    }
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
    if (!this.mesh.visible) this.layUnder([], NaN);
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
      this.layUnder([], NaN);
      return;
    }
    const hemmed = cut < tEnd;
    this.layUnder(rows, hemmed ? tEnd : tEnd - EMERGE_TOP - UNDER_TOP_MARGIN, hemmed);
    const widths = ends.map((e) => e[0].distanceTo(e[1]) / this.map.trunkLength);
    for (let c = 0; c <= COLUMNS; c++) {
      u = c / COLUMNS;
      for (let r = 0; r < total; r++) {
        // rows past the last one (or above the neckline's lowest point) fold onto its cut
        const want = rows[0].t + (r / (total - 1)) * (tEnd - rows[0].t);
        const t = Math.min(want, cut);
        place(t);
        // the span (straight from end to end), and her cleavage under it (end, midline, end), blended by how far up
        // the bridge this is: at its bottom it lies on her and straightens into the span within EMERGE (and a crew's goes
        // back onto her at its top within EMERGE_TOP)
        const straight = straightAt(t, rows[0].t, tEnd, hemmed);
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
        const width = widths[k] + (widths[k + 1] - widths[k]) * f;
        const alpha = smooth01((Math.min(u, 1 - u) * width) / FEATHER_SIDE) * smooth01((t - rows[0].t) / FEATHER_BOTTOM) * (hemmed ? 1 : smooth01((tEnd - t) / FEATHER_TOP));
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
