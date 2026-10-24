/**
 * SKIN PAINT (Joshua, 2026-10-24, of the Sarah Lab: "maybe a simple body texture uploaded/paint"): colour painted into
 * her skin's own colour map, texel by texel, by a brush that is measured on HER and not on the image.
 *
 * Her skin map is one atlas: hundreds of small islands of texels scattered over a 2048 square, each a patch of her
 * surface unfolded flat. Neighbours in the image are not neighbours on her -- the island beside her wrist's may be a
 * piece of her knee -- so a brush that drew circles in the image would put a dab on her arm and a stray crescent on
 * whatever island happened to sit next to it, and would stop dead at the island's edge where her skin carries on. So
 * this brush works where `bodyPaint.ts`'s does, in REST space (`fabricRest`, her approved surface before any belly or
 * pose moves it): a dab is a SPHERE on her surface at rest, and every texel whose point on her at rest lies inside it
 * is painted, wherever its island sits in the image. A dab across a texture seam paints both sides of it, on two
 * islands far apart in the image, because on her they are the same few millimetres; and a radius in centimetres means
 * the same on her at 0% and at 200%.
 *
 * How a texel finds its point on her: each triangle is rasterised in the image (its UVs in pixels), and a texel it
 * covers takes the triangle's rest corners in the proportions it stands between them. COVERED is the texel's centre
 * inside the triangle OR WITHIN ONE PIXEL of it, so paint reaches into an island's padding and a seam never shows a
 * hairline of unpainted skin where the sampler blends across the island's edge; a padding texel takes a point ON
 * the triangle (its proportions clamped to zero and renormalised), never a point extrapolated off her surface.
 * Where the paddings of neighbouring triangles overlap, a texel takes the strongest of their weights and is blended
 * ONCE, so a dab is as strong along a triangle's edge as in its middle.
 *
 * The image she wore is kept untouched as `base`: the eraser paints back toward it, CLEAR puts all of it back, and
 * nothing of the file changes -- the painted image is a texture of its own, and a PNG only when asked for one. Undo is
 * by stroke: before a stroke first changes a row of the image, that row's bytes are kept, once per stroke.
 *
 * The core (the grid, the rasteriser, the undo) is plain arrays and imports nothing, tested without a GPU;
 * `SkinPainter` at the bottom reads three's posed vertices to find what is under the finger, exactly as `BodyPaint`
 * does, and sends the GPU only the rows a dab changed.
 */
import * as THREE from 'three'; // the painter at the bottom only: the core above it uses nothing from three or the DOM

// ---------------------------------------------------------------------------------------------------------------------
// THE CORE

/** RGBA pixels, row 0 the TOP of the image. glTF UVs: pixel x = u * width, pixel y = v * height (no flip). */
export interface SkinImage { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray }
export interface SkinMesh {
  /** xyz per vertex, mesh units: her surface at rest. */
  readonly rest: ArrayLike<number>;
  /** uv per vertex. */
  readonly uv: ArrayLike<number>;
  /** Triangles, three vertices each. */
  readonly index: ArrayLike<number>;
}
/** 0..255 a channel. */
export type Rgb = readonly [number, number, number];
export interface SkinDab {
  /** Mesh units, rest space. */
  readonly centre: { readonly x: number; readonly y: number; readonly z: number };
  /** Mesh units, > 0. */
  readonly radius: number;
  readonly colour: Rgb;
  /** 0..1: the most one dab moves a texel toward its goal. */
  readonly strength: number;
  /** 0..1: full strength inside hardness * radius, a smooth falloff to nothing at the radius. */
  readonly hardness: number;
  /** The goal is the BASE image's texel instead of `colour` (with no base nothing changes). */
  readonly erase: boolean;
  /** Her rest normal at the hit: a triangle facing away from it (rest face normal · this < -0.1) is not painted, so a
   *  dab on the front of an arm never reaches its back. */
  readonly normal?: readonly [number, number, number];
}
/** Rows of the image, inclusive. */
export interface DirtyRows { readonly from: number; readonly to: number }

type Point = { readonly x: number; readonly y: number; readonly z: number };

/** A texel is covered when its centre lies within this many pixels of a triangle. */
const PAD = 1;
/** A triangle smaller than this in the image, in square pixels, covers nothing. */
const MIN_UV_AREA = 1e-6;
/** A triangle facing this far from the surface under the brush is the far side of her (as `bodyPaint.dab`). */
const BACK_FACING = -0.1;
/** Below this weight a dab cannot move any channel by half a step, so the texel is not visited at all. */
const MIN_WEIGHT = 0.5 / 255;
/** A dab whose pixels' box is up to this many texels gathers its weights in one reused array; a bigger one in a map. */
const DENSE_LIMIT = 1 << 21;
/** At most this many cells in a `TriangleGrid`: a cell too fine for that grows until the grid fits. */
const MAX_CELLS = 1 << 21;

/** Squared distance from a point to a box (min xyz, max xyz); 0 inside. */
function boxDistanceSq(box: Float64Array, x: number, y: number, z: number): number {
  const dx = Math.max(box[0] - x, 0, x - box[3]), dy = Math.max(box[1] - y, 0, y - box[4]), dz = Math.max(box[2] - z, 0, z - box[5]);
  return dx * dx + dy * dy + dz * dz;
}

/** Triangle `t`'s rest box into `box`; false when its vertices are not all in the mesh. */
function restBox(rest: ArrayLike<number>, index: ArrayLike<number>, count: number, t: number, box: Float64Array): boolean {
  const i = t * 3;
  if (!(i >= 0) || i + 2 >= index.length) return false;
  const a = index[i], b = index[i + 1], c = index[i + 2];
  if (!(a >= 0 && a < count && b >= 0 && b < count && c >= 0 && c < count)) return false;
  for (let k = 0; k < 3; k++) {
    const p = rest[a * 3 + k], q = rest[b * 3 + k], r = rest[c * 3 + k];
    box[k] = Math.min(p, q, r);
    box[k + 3] = Math.max(p, q, r);
  }
  return true;
}

/** A uniform grid over the triangles' REST bounding boxes, built once per mesh. */
export class TriangleGrid {
  private readonly rest: ArrayLike<number>;
  private readonly index: ArrayLike<number>;
  private readonly count: number;
  private readonly lo = [0, 0, 0];
  private readonly hi = [0, 0, 0];
  private readonly dims = [1, 1, 1];
  private readonly cell: number = 1;
  /** Triangles of cell c are items[start[c]] to items[start[c + 1]] (exclusive). */
  private readonly start: Uint32Array = new Uint32Array(2);
  private readonly items: Uint32Array = new Uint32Array(0);
  /** Which query last returned each triangle, so a triangle in several cells is returned once. */
  private readonly seen: Uint32Array;
  private stamp = 0;
  private readonly box = new Float64Array(6);

  constructor(mesh: SkinMesh, cell: number) {
    this.rest = mesh.rest;
    this.index = mesh.index;
    this.count = Math.floor(mesh.rest.length / 3);
    const triangles = Math.floor(mesh.index.length / 3), box = this.box;
    this.seen = new Uint32Array(triangles);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let t = 0; t < triangles; t++) {
      if (!restBox(this.rest, this.index, this.count, t, box)) continue;
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], box[k]); hi[k] = Math.max(hi[k], box[k + 3]); }
    }
    if (!(lo[0] <= hi[0] && lo[1] <= hi[1] && lo[2] <= hi[2])) return; // no triangle: an empty grid
    const extent = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    let size = cell > 0 && Number.isFinite(cell) ? cell : Math.max(...extent) || 1;
    for (;;) {
      for (let k = 0; k < 3; k++) this.dims[k] = Math.max(1, Math.ceil(extent[k] / size));
      if (this.dims[0] * this.dims[1] * this.dims[2] <= MAX_CELLS) break;
      size *= 1.25;
    }
    this.lo.splice(0, 3, ...lo);
    this.hi.splice(0, 3, ...hi);
    this.cell = size;
    const [nx, ny] = this.dims, cells = nx * ny * this.dims[2];
    const start = new Uint32Array(cells + 1), range = new Int32Array(6);
    // count, then fill: each triangle goes in every cell its box touches
    for (let pass = 0; pass < 2; pass++) {
      const fill = pass === 1 ? start.slice(0, cells) : null;
      const items = pass === 1 ? new Uint32Array(start[cells]) : null;
      for (let t = 0; t < triangles; t++) {
        if (!restBox(this.rest, this.index, this.count, t, box)) continue;
        this.cells(box[0], box[1], box[2], box[3], box[4], box[5], range);
        for (let z = range[2]; z <= range[5]; z++) for (let y = range[1]; y <= range[4]; y++) for (let x = range[0]; x <= range[3]; x++) {
          const c = x + nx * (y + ny * z);
          if (fill && items) items[fill[c]++] = t; else start[c + 1]++;
        }
      }
      if (pass === 0) for (let c = 0; c < cells; c++) start[c + 1] += start[c];
      else this.items = items!;
    }
    this.start = start;
  }

  /** The cells a box spans, clamped to the grid, as (x0, y0, z0, x1, y1, z1). */
  private cells(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, out: Int32Array): void {
    const at = (v: number, k: number) => Math.min(this.dims[k] - 1, Math.max(0, Math.floor((v - this.lo[k]) / this.cell)));
    out[0] = at(x0, 0); out[1] = at(y0, 1); out[2] = at(z0, 2);
    out[3] = at(x1, 0); out[4] = at(y1, 1); out[5] = at(z1, 2);
  }

  /** Every triangle whose rest bounding box meets the sphere (each once). */
  near(centre: { x: number; y: number; z: number }, radius: number): number[] {
    const out: number[] = [];
    if (!(radius >= 0) || !this.items.length) return out;
    const { x, y, z } = centre, r2 = radius * radius, box = this.box;
    if (x + radius < this.lo[0] || x - radius > this.hi[0] || y + radius < this.lo[1] || y - radius > this.hi[1] || z + radius < this.lo[2] || z - radius > this.hi[2]) return out;
    if (++this.stamp >= 0xffffffff) { this.seen.fill(0); this.stamp = 1; }
    const range = new Int32Array(6), [nx, ny] = this.dims;
    this.cells(x - radius, y - radius, z - radius, x + radius, y + radius, z + radius, range);
    for (let cz = range[2]; cz <= range[5]; cz++) for (let cy = range[1]; cy <= range[4]; cy++) for (let cx = range[0]; cx <= range[3]; cx++) {
      const c = cx + nx * (cy + ny * cz);
      for (let k = this.start[c]; k < this.start[c + 1]; k++) {
        const t = this.items[k];
        if (this.seen[t] === this.stamp) continue;
        this.seen[t] = this.stamp;
        if (restBox(this.rest, this.index, this.count, t, box) && boxDistanceSq(box, x, y, z) <= r2) out.push(t);
      }
    }
    return out;
  }
}

/** A dab as the rasteriser uses it; null when it can change nothing. */
interface Brush {
  readonly c: Point;
  readonly r: number;
  readonly r2: number;
  /** hardness * radius: full strength inside this. */
  readonly core: number;
  readonly strength: number;
  /** The unit normal to face, or null for no test. */
  readonly facing: readonly [number, number, number] | null;
  readonly colour: readonly [number, number, number];
  /** Vertices both `rest` and `uv` hold. */
  readonly count: number;
}

const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);
const channel = (v: number) => (v > 0 ? (v < 255 ? v : 255) : 0); // NaN goes to 0

function brushFor(target: SkinImage, mesh: SkinMesh, dab: SkinDab): Brush | null {
  const r = dab.radius, c = dab.centre;
  if (!(r > 0) || !Number.isFinite(r) || !Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.z)) return null;
  if (!(target.width > 0 && target.height > 0) || target.data.length < target.width * target.height * 4) return null;
  const strength = clamp01(dab.strength);
  if (strength < MIN_WEIGHT) return null;
  let facing: [number, number, number] | null = null;
  if (dab.normal) {
    const [nx, ny, nz] = dab.normal, len = Math.hypot(nx, ny, nz);
    if (len > 0) facing = [nx / len, ny / len, nz / len];
  }
  return {
    c, r, r2: r * r, core: clamp01(dab.hardness) * r, strength, facing,
    colour: [channel(dab.colour[0]), channel(dab.colour[1]), channel(dab.colour[2])],
    count: Math.min(Math.floor(mesh.rest.length / 3), Math.floor(mesh.uv.length / 2)),
  };
}

/**
 * Triangle `t` as the rasteriser sees it, into `out`: its corners in image pixels (0-5), at rest (6-14), and the pixels
 * it may cover, padded and clipped to the image (x0, x1, y0, y1 at 15-18). False when the dab cannot reach it: out of
 * the mesh, too far, facing away, too small in the image, or wholly off the image.
 */
function triangleFor(mesh: SkinMesh, t: number, image: SkinImage, b: Brush, out: Float64Array): boolean {
  if (!restBox(mesh.rest, mesh.index, b.count, t, BOX)) return false;
  if (boxDistanceSq(BOX, b.c.x, b.c.y, b.c.z) >= b.r2) return false;
  const ia = mesh.index[t * 3], ib = mesh.index[t * 3 + 1], ic = mesh.index[t * 3 + 2], rest = mesh.rest, uv = mesh.uv;
  for (let k = 0; k < 3; k++) { out[6 + k] = rest[ia * 3 + k]; out[9 + k] = rest[ib * 3 + k]; out[12 + k] = rest[ic * 3 + k]; }
  if (b.facing) {
    const e1x = out[9] - out[6], e1y = out[10] - out[7], e1z = out[11] - out[8];
    const e2x = out[12] - out[6], e2y = out[13] - out[7], e2z = out[14] - out[8];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x, len = Math.hypot(nx, ny, nz);
    if (len > 0 && (nx * b.facing[0] + ny * b.facing[1] + nz * b.facing[2]) / len < BACK_FACING) return false;
  }
  const w = image.width, h = image.height;
  out[0] = uv[ia * 2] * w; out[1] = uv[ia * 2 + 1] * h;
  out[2] = uv[ib * 2] * w; out[3] = uv[ib * 2 + 1] * h;
  out[4] = uv[ic * 2] * w; out[5] = uv[ic * 2 + 1] * h;
  const area = Math.abs((out[2] - out[0]) * (out[5] - out[1]) - (out[3] - out[1]) * (out[4] - out[0])) / 2;
  if (!(area >= MIN_UV_AREA)) return false; // NaN UVs too
  // a pixel's centre (x + 0.5) within PAD of the triangle's box
  out[15] = Math.max(0, Math.ceil(Math.min(out[0], out[2], out[4]) - PAD - 0.5));
  out[16] = Math.min(w - 1, Math.floor(Math.max(out[0], out[2], out[4]) + PAD - 0.5));
  out[17] = Math.max(0, Math.ceil(Math.min(out[1], out[3], out[5]) - PAD - 0.5));
  out[18] = Math.min(h - 1, Math.floor(Math.max(out[1], out[3], out[5]) + PAD - 0.5));
  return out[15] <= out[16] && out[17] <= out[18];
}
const TRIANGLE = new Float64Array(19), BOX = new Float64Array(6);

/** Squared distance from (px, py) to the segment a-b. */
function segmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len > 0 ? clamp01(((px - ax) * dx + (py - ay) * dy) / len) : 0;
  const ex = ax + dx * t - px, ey = ay + dy * t - py;
  return ex * ex + ey * ey;
}

/**
 * The weights of one dab, gathered per texel as the MAX over every triangle covering it, so each texel is blended once.
 * One array, reused from dab to dab over the dab's box of pixels; a dab spread wider than `DENSE_LIMIT` texels (islands
 * at opposite corners of the image) gathers into a map instead.
 */
class Weights {
  private dense = new Float32Array(0);
  private keys = new Int32Array(1024);
  private n = 0;
  private sparse: Map<number, number> | null = null;
  private x0 = 0;
  private y0 = 0;
  private span = 1;
  private stride = 1;

  open(x0: number, y0: number, x1: number, y1: number, stride: number): void {
    this.x0 = x0; this.y0 = y0; this.span = x1 - x0 + 1; this.stride = stride; this.n = 0;
    const area = this.span * (y1 - y0 + 1);
    if (area > DENSE_LIMIT) { this.sparse = new Map(); return; }
    this.sparse = null;
    if (this.dense.length < area) this.dense = new Float32Array(Math.min(DENSE_LIMIT, Math.max(area, this.dense.length * 2)));
  }

  max(x: number, y: number, w: number): void {
    if (this.sparse) {
      // held at the array's precision, so a dab blends to the same bytes whichever way it was gathered
      const k = y * this.stride + x, f = Math.fround(w);
      if (f > (this.sparse.get(k) ?? 0)) this.sparse.set(k, f);
      return;
    }
    const k = (y - this.y0) * this.span + (x - this.x0), was = this.dense[k];
    if (w <= was) return;
    if (was === 0) {
      if (this.n === this.keys.length) { const grown = new Int32Array(this.keys.length * 2); grown.set(this.keys); this.keys = grown; }
      this.keys[this.n++] = k;
    }
    this.dense[k] = w;
  }

  /** Every texel gathered, as (pixel index, weight), each once; the array is left empty for the next dab. */
  drain(each: (pixel: number, w: number) => void): void {
    if (this.sparse) {
      const s = this.sparse;
      this.sparse = null;
      for (const [k, w] of s) each(k, w);
      return;
    }
    for (let i = 0; i < this.n; i++) {
      const k = this.keys[i], w = this.dense[k];
      this.dense[k] = 0;
      each((this.y0 + Math.floor(k / this.span)) * this.stride + this.x0 + (k % this.span), w);
    }
    this.n = 0;
  }
}
const WEIGHTS = new Weights();

/** Rasterise the triangle in `t` (`triangleFor`'s layout), gathering each covered texel's weight. */
function rasterise(t: Float64Array, b: Brush, into: Weights): void {
  const u0 = t[0], v0 = t[1], u1 = t[2], v1 = t[3], u2 = t[4], v2 = t[5];
  const e1x = u1 - u0, e1y = v1 - v0, e2x = u2 - u0, e2y = v2 - v0;
  const inv = 1 / (e1x * e2y - e1y * e2x);
  const ax = t[6], ay = t[7], az = t[8], bx = t[9], by = t[10], bz = t[11], cx = t[12], cy = t[13], cz = t[14];
  const soft = b.r - b.core;
  for (let y = t[17]; y <= t[18]; y++) {
    const qy = y + 0.5;
    for (let x = t[15]; x <= t[16]; x++) {
      const qx = x + 0.5, wx = qx - u0, wy = qy - v0;
      let l1 = (wx * e2y - wy * e2x) * inv, l2 = (e1x * wy - e1y * wx) * inv, l0 = 1 - l1 - l2;
      if (l0 < 0 || l1 < 0 || l2 < 0) {
        // outside: covered within a pixel of it, at a point ON the triangle (proportions clamped; never extrapolated off her)
        if (Math.min(segmentSq(qx, qy, u0, v0, u1, v1), segmentSq(qx, qy, u1, v1, u2, v2), segmentSq(qx, qy, u2, v2, u0, v0)) > PAD * PAD) continue;
        l0 = Math.max(l0, 0); l1 = Math.max(l1, 0); l2 = Math.max(l2, 0);
        const s = l0 + l1 + l2;
        l0 /= s; l1 /= s; l2 /= s;
      }
      const dx = l0 * ax + l1 * bx + l2 * cx - b.c.x, dy = l0 * ay + l1 * by + l2 * cy - b.c.y, dz = l0 * az + l1 * bz + l2 * cz - b.c.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= b.r2) continue;
      const d = Math.sqrt(d2);
      let f = 1;
      if (d > b.core) { const s = (d - b.core) / soft; f = 1 - s * s * (3 - 2 * s); }
      const w = b.strength * f;
      if (w >= MIN_WEIGHT) into.max(x, y, w);
    }
  }
}

/**
 * Paint one dab into `target` (and nothing else); returns the rows it changed, or null if none. `triangles` are the
 * ones to consider (a `TriangleGrid.near` answer, or simply all of them); `base` is the image erasing goes back to.
 */
export function paintDab(target: SkinImage, base: SkinImage | null, mesh: SkinMesh, triangles: Iterable<number>, dab: SkinDab): DirtyRows | null {
  const b = brushFor(target, mesh, dab);
  if (!b) return null;
  const goal = dab.erase ? (base && base.width === target.width && base.height === target.height ? base.data : null) : null;
  if (dab.erase && !goal) return null;
  const T = TRIANGLE, reach: number[] = [];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const t of triangles) {
    if (!triangleFor(mesh, t, target, b, T)) continue;
    reach.push(t);
    x0 = Math.min(x0, T[15]); x1 = Math.max(x1, T[16]); y0 = Math.min(y0, T[17]); y1 = Math.max(y1, T[18]);
  }
  if (!reach.length) return null;
  WEIGHTS.open(x0, y0, x1, y1, target.width);
  for (const t of reach) if (triangleFor(mesh, t, target, b, T)) rasterise(T, b, WEIGHTS);
  const data = target.data, width = target.width, [cr, cg, cb] = b.colour;
  let from = Infinity, to = -Infinity;
  WEIGHTS.drain((pixel, w) => {
    const o = pixel * 4, r = data[o], g = data[o + 1], bl = data[o + 2];
    const nr = Math.round(r + ((goal ? goal[o] : cr) - r) * w);
    const ng = Math.round(g + ((goal ? goal[o + 1] : cg) - g) * w);
    const nb = Math.round(bl + ((goal ? goal[o + 2] : cb) - bl) * w);
    if (nr === r && ng === g && nb === bl) return;
    data[o] = nr; data[o + 1] = ng; data[o + 2] = nb; // alpha untouched
    const row = Math.floor(pixel / width);
    if (row < from) from = row;
    if (row > to) to = row;
  });
  return from <= to ? { from, to } : null;
}

/**
 * The rows a dab COULD touch: the pixel boxes of the triangles it would consider, padded a pixel and clipped. Cheap,
 * paints nothing, and always covers every row `paintDab` then changes, so they can be kept for undo first.
 */
export function dabRows(target: SkinImage, mesh: SkinMesh, triangles: Iterable<number>, dab: SkinDab): DirtyRows | null {
  const b = brushFor(target, mesh, dab);
  if (!b) return null;
  let from = Infinity, to = -Infinity;
  for (const t of triangles) {
    if (!triangleFor(mesh, t, target, b, TRIANGLE)) continue;
    from = Math.min(from, TRIANGLE[17]);
    to = Math.max(to, TRIANGLE[18]);
  }
  return from <= to ? { from, to } : null;
}

/** One stroke's kept rows: each row's bytes as they were before the stroke (or, on the redo side, after it). */
interface Kept { readonly rows: Map<number, Uint8ClampedArray>; bytes: number }

/**
 * Stroke-level undo: before a stroke changes rows, the rows' original pixels are kept once per stroke. A row of her
 * 2048 map is 8 KB and a CLEAR may keep every row of it, 16 MB, so besides the count of strokes there is a byte budget
 * for the strokes kept (the newest stroke is always kept, whatever its size).
 */
export class SkinUndo {
  private readonly undoStack: Kept[] = [];
  private readonly redoStack: Kept[] = [];
  private open: Kept | null = null;

  /** `limit` strokes kept (default 12), and no more than `maxBytes` of them (default 96 MB, six whole 2048 maps). */
  constructor(private readonly limit = 12, private readonly maxBytes = 96 * 1024 * 1024) {}

  /** A stroke starts (one already open is finished first). */
  begin(): void {
    this.end();
    this.open = { rows: new Map(), bytes: 0 };
  }

  /** Call BEFORE `paintDab` changes those rows: keeps any not yet kept this stroke (and opens a stroke if none is). */
  keep(image: SkinImage, rows: DirtyRows): void {
    const open = (this.open ??= { rows: new Map(), bytes: 0 }), stride = image.width * 4;
    for (let y = Math.max(0, rows.from), last = Math.min(image.height - 1, rows.to); y <= last; y++) {
      if (open.rows.has(y)) continue;
      open.rows.set(y, image.data.slice(y * stride, (y + 1) * stride));
      open.bytes += stride;
    }
  }

  /** A stroke ends (a no-op if nothing was kept). A stroke that changed something ends the redo trail. */
  end(): void {
    const s = this.open;
    this.open = null;
    if (!s || !s.rows.size) return;
    this.undoStack.push(s);
    this.redoStack.length = 0;
    while (this.undoStack.length > this.limit) this.undoStack.shift();
    let bytes = this.undoStack.reduce((sum, k) => sum + k.bytes, 0);
    while (this.undoStack.length > 1 && bytes > this.maxBytes) bytes -= this.undoStack.shift()!.bytes;
  }

  get canUndo(): boolean { return this.undoStack.length > 0 || !!this.open?.rows.size; }
  get canRedo(): boolean { return this.redoStack.length > 0 && !this.open?.rows.size; }

  /** Put the last stroke's rows back (keeping the painted ones for redo); the rows changed, or null. */
  undo(image: SkinImage): DirtyRows | null { this.end(); return SkinUndo.swap(this.undoStack, this.redoStack, image); }
  redo(image: SkinImage): DirtyRows | null { this.end(); return SkinUndo.swap(this.redoStack, this.undoStack, image); }

  clear(): void { this.undoStack.length = 0; this.redoStack.length = 0; this.open = null; }

  private static swap(from: Kept[], to: Kept[], image: SkinImage): DirtyRows | null {
    const step = from.pop();
    if (!step) return null;
    const stride = image.width * 4, back: Kept = { rows: new Map(), bytes: 0 };
    let lo = Infinity, hi = -Infinity;
    for (const [y, bytes] of step.rows) {
      if (bytes.length !== stride || y >= image.height) continue; // not this image's row
      const at = y * stride;
      back.rows.set(y, image.data.slice(at, at + stride));
      back.bytes += stride;
      image.data.set(bytes, at);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    to.push(back);
    return lo <= hi ? { from: lo, to: hi } : null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// THE PAINTER: her mesh and the GPU

export interface SkinStrokeSettings { colour: Rgb; radiusCm: number; strength: number; hardness: number; erase: boolean }

/** How near the finger a vertex has to be on screen, CSS pixels (as `BodyPaint.pick`). */
const PICK_SLOP = 8;
/** The triangle grid's cell, metres. */
const GRID_CELL_M = 0.02;
/** A fast drag dabs along its way at this share of the radius, so it leaves a line and not beads. */
const STEP_SHARE = 1 / 3;
/** Two picks further apart than this many radii are a jump to elsewhere on her, not a drag: nothing between. */
const JOIN_RADII = 4;

/** The pixels of an image, through a 2D canvas (an OffscreenCanvas where there is one). */
function readPixels(source: CanvasImageSource, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('skinPaint: no 2D canvas to read her skin through');
    ctx.drawImage(source, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height).data;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('skinPaint: no 2D canvas to read her skin through');
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

/** Her skin's colour map as a paintable texture of its own, with the brush, the eraser, CLEAR and UNDO. */
export class SkinPainter {
  readonly texture: THREE.DataTexture;
  readonly image: SkinImage;
  readonly base: SkinImage;
  private readonly history = new SkinUndo();
  private screen: { x: Float32Array; y: Float32Array; depth: Float32Array } | null = null;
  private surface: { readonly mesh: SkinMesh; readonly grid: TriangleGrid } | null = null;
  /** The last dab of this stroke, to join the next one to. */
  private last: { readonly centre: Point; readonly normal: readonly [number, number, number] } | null = null;
  /** Until the GPU holds the texture once, every upload is the whole image: rows alone would leave the rest blank. */
  private uploaded = false;

  /**
   * `source` is the image she wears now (an ImageBitmap, image, canvas or OffscreenCanvas); `template` the map this
   * replaces, whose settings the new texture takes. Nothing of `mesh` or its material is changed: the caller puts
   * `texture` on her.
   */
  constructor(private readonly mesh: THREE.SkinnedMesh, source: { width: number; height: number } & CanvasImageSource, template: THREE.Texture | null, private readonly metresPerUnit: number) {
    if (!(metresPerUnit > 0) || !Number.isFinite(metresPerUnit)) throw new RangeError(`skinPaint: metresPerUnit must be positive, not ${metresPerUnit}`);
    const width = Math.max(1, Math.round(source.width)), height = Math.max(1, Math.round(source.height));
    const pixels = readPixels(source, width, height);
    this.image = { width, height, data: pixels };
    this.base = { width, height, data: pixels.slice() };
    // the texture reads the same bytes the brush writes
    const texture = new THREE.DataTexture(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    if (template) {
      texture.colorSpace = template.colorSpace;
      texture.anisotropy = template.anisotropy;
      texture.wrapS = template.wrapS;
      texture.wrapT = template.wrapT;
      texture.channel = template.channel;
      // a texture transform, if the file has one, is kept and the brush paints through it (`prepare`)
      texture.offset.copy(template.offset);
      texture.repeat.copy(template.repeat);
      texture.rotation = template.rotation;
      texture.center.copy(template.center);
      texture.matrixAutoUpdate = template.matrixAutoUpdate;
      texture.matrix.copy(template.matrix);
      texture.name = template.name ? `${template.name} (painted)` : 'skin paint';
    } else {
      texture.colorSpace = THREE.SRGBColorSpace; // a colour map
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping; // glTF's default sampler
      texture.name = 'skin paint';
    }
    texture.flipY = false;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.onUpdate = () => { this.uploaded = true; };
    texture.needsUpdate = true;
    this.texture = texture;
  }

  get canUndo(): boolean { return this.history.canUndo; }
  get canRedo(): boolean { return this.history.canRedo; }

  /** Where every vertex of her POSED body lands on screen now; call as a stroke starts (she may have moved since). */
  beginStroke(camera: THREE.Camera, width: number, height: number): void {
    const g = this.mesh.geometry as THREE.BufferGeometry, n = g.getAttribute('position').count;
    const x = new Float32Array(n), y = new Float32Array(n), depth = new Float32Array(n), v = new THREE.Vector3();
    this.mesh.updateMatrixWorld(true);
    for (let i = 0; i < n; i++) {
      this.mesh.getVertexPosition(i, v).applyMatrix4(this.mesh.matrixWorld).project(camera);
      x[i] = (v.x * 0.5 + 0.5) * width; y[i] = (0.5 - v.y * 0.5) * height; depth[i] = v.z;
    }
    this.screen = { x, y, depth };
    this.last = null;
    this.history.begin();
  }

  /** The vertex under a screen point: of those within `PICK_SLOP` pixels, the one nearest the camera; -1 off her. */
  private pick(px: number, py: number): number {
    const s = this.screen;
    if (!s) return -1;
    let best = -1, bestDepth = Infinity;
    const s2 = PICK_SLOP * PICK_SLOP;
    for (let i = 0; i < s.x.length; i++) {
      const dx = s.x[i] - px, dy = s.y[i] - py;
      if (dx * dx + dy * dy > s2 || s.depth[i] < -1 || s.depth[i] > 1) continue;
      if (s.depth[i] < bestDepth) { bestDepth = s.depth[i]; best = i; }
    }
    return best;
  }

  /** Her rest surface, its UVs as the texture samples them, and the grid over it: built on the first stroke. */
  private prepare(): { readonly mesh: SkinMesh; readonly grid: TriangleGrid } | null {
    if (this.surface) return this.surface;
    const g = this.mesh.geometry as THREE.BufferGeometry, t = this.texture;
    const restAttr = g.getAttribute('fabricRest'), uvAttr = g.getAttribute(t.channel ? `uv${t.channel}` : 'uv');
    if (!restAttr || !uvAttr) return null;
    const n = Math.min(restAttr.count, uvAttr.count), rest = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    if (t.matrixAutoUpdate) t.updateMatrix();
    const e = t.matrix.elements; // the map's transform: uv' = M (u, v, 1), as three's shader samples it
    for (let i = 0; i < n; i++) {
      rest[i * 3] = restAttr.getX(i); rest[i * 3 + 1] = restAttr.getY(i); rest[i * 3 + 2] = restAttr.getZ(i);
      const u = uvAttr.getX(i), v = uvAttr.getY(i);
      uv[i * 2] = e[0] * u + e[3] * v + e[6];
      uv[i * 2 + 1] = e[1] * u + e[4] * v + e[7];
    }
    // every triangle of her, not only those drawn now (the room may leave covered skin out of the draw)
    const index = (this.mesh.userData.allIndices as ArrayLike<number> | undefined) ?? g.index?.array ?? Uint32Array.from({ length: n }, (_, i) => i);
    const mesh: SkinMesh = { rest, uv, index };
    this.surface = { mesh, grid: new TriangleGrid(mesh, GRID_CELL_M / this.metresPerUnit) };
    return this.surface;
  }

  /** Paint or erase around the vertex under the finger, joining it to the last dab of this stroke; whether anything changed. */
  stroke(px: number, py: number, settings: SkinStrokeSettings): boolean {
    const hit = this.pick(px, py);
    if (hit < 0) { this.last = null; return false; }
    const g = this.mesh.geometry as THREE.BufferGeometry;
    const restAttr = g.getAttribute('fabricRest'), nrmAttr = g.getAttribute('fabricRestNormal');
    if (!restAttr || !nrmAttr) return false;
    const surface = this.prepare();
    if (!surface) return false;
    const radius = settings.radiusCm / 100 / this.metresPerUnit;
    if (!(radius > 0) || !Number.isFinite(radius)) return false;
    const centre: Point = { x: restAttr.getX(hit), y: restAttr.getY(hit), z: restAttr.getZ(hit) };
    const normal: [number, number, number] = [nrmAttr.getX(hit), nrmAttr.getY(hit), nrmAttr.getZ(hit)];
    const dabs: { centre: Point; normal: readonly [number, number, number] }[] = [];
    const from = this.last;
    if (from) {
      const dx = centre.x - from.centre.x, dy = centre.y - from.centre.y, dz = centre.z - from.centre.z, dist = Math.hypot(dx, dy, dz);
      if (dist > 0 && dist <= JOIN_RADII * radius) {
        const steps = Math.ceil(dist / (radius * STEP_SHARE));
        for (let k = 1; k < steps; k++) {
          const s = k / steps, a = from.normal;
          const nx = a[0] + (normal[0] - a[0]) * s, ny = a[1] + (normal[1] - a[1]) * s, nz = a[2] + (normal[2] - a[2]) * s;
          dabs.push({ centre: { x: from.centre.x + dx * s, y: from.centre.y + dy * s, z: from.centre.z + dz * s }, normal: Math.hypot(nx, ny, nz) > 1e-6 ? [nx, ny, nz] : normal });
        }
      }
    }
    dabs.push({ centre, normal });
    this.last = { centre, normal };
    let lo = Infinity, hi = -Infinity;
    for (const d of dabs) {
      const dab: SkinDab = { centre: d.centre, radius, colour: settings.colour, strength: settings.strength, hardness: settings.hardness, erase: settings.erase, normal: d.normal };
      const triangles = surface.grid.near(d.centre, radius);
      const rows = dabRows(this.image, surface.mesh, triangles, dab);
      if (!rows) continue;
      this.history.keep(this.image, rows);
      const changed = paintDab(this.image, this.base, surface.mesh, triangles, dab);
      if (changed) { lo = Math.min(lo, changed.from); hi = Math.max(hi, changed.to); }
    }
    if (lo > hi) return false;
    this.upload(lo, hi);
    return true;
  }

  endStroke(): void {
    this.history.end();
    this.screen = null;
    this.last = null;
  }

  undo(): boolean { return this.restored(this.history.undo(this.image)); }
  redo(): boolean { return this.restored(this.history.redo(this.image)); }
  private restored(rows: DirtyRows | null): boolean {
    if (!rows) return false;
    this.upload(rows.from, rows.to);
    return true;
  }

  /** Every texel back to `base` (an undoable stroke of its own). */
  clear(): void {
    const { width, height, data } = this.image, base = this.base.data, stride = width * 4;
    this.history.begin();
    let lo = Infinity, hi = -Infinity;
    for (let y = 0; y < height; y++) {
      const at = y * stride;
      let same = true;
      for (let i = at; i < at + stride; i++) if (data[i] !== base[i]) { same = false; break; }
      if (same) continue;
      this.history.keep(this.image, { from: y, to: y });
      data.set(base.subarray(at, at + stride), at);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    this.history.end();
    this.last = null;
    if (lo <= hi) this.upload(lo, hi);
  }

  /** The painted image as a PNG. */
  async png(): Promise<Blob> {
    const { width, height } = this.image;
    const pixels = new ImageData(new Uint8ClampedArray(this.image.data), width, height);
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('skinPaint: no 2D canvas to write the PNG with');
      ctx.putImageData(pixels, 0, 0);
      return canvas.convertToBlob({ type: 'image/png' });
    }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('skinPaint: no 2D canvas to write the PNG with');
    ctx.putImageData(pixels, 0, 0);
    return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('skinPaint: the PNG could not be made'))), 'image/png'));
  }

  dispose(): void {
    this.texture.dispose();
    this.history.clear();
    this.screen = null;
    this.last = null;
  }

  /**
   * Rows `from` to `to` go to the GPU at its next draw. three's partial upload works one ROW at a time (a range may not
   * span rows), so one range a row; it merges neighbours on the same row itself.
   */
  private upload(from: number, to: number): void {
    const t = this.texture, stride = this.image.width * 4;
    if (this.uploaded) for (let y = from; y <= to; y++) t.addUpdateRange(y * stride, stride);
    t.needsUpdate = true;
  }
}
