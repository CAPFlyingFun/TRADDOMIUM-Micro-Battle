/**
 * BODY PAINT (Joshua, 2026-10-20): fabric painted straight onto her skin, as layers of its own -- "a separate, editable
 * paint layer... do not permanently overwrite the original skin texture... a brush and eraser, so painted areas can
 * be added, adjusted, or removed individually".
 *
 * Each layer is a WEIGHT AT EVERY BODY VERTEX (0 bare skin, 1 fully painted), held in the `fabricPaint` attribute the
 * fabric shader reads (`fabricMaterial.ts`). Being per vertex it is attached to the surface itself: it rides every
 * morph, every shape field and every bone, at any belly size and from any angle, because it moves exactly as the
 * vertices do. Nothing of the model changes -- the attribute is added beside her approved data and the skin texture is
 * untouched; clearing every layer is the body exactly as approved.
 *
 * - FILL lays a whole garment's footprint at once, from the body's own `_cloth_cover` bits, then softens its edge a
 *   few rings across the mesh so it does not follow the triangles' sawtooth.
 * - The BRUSH and ERASER work in REST space (the approved surface, `fabricRest`): a stroke picks the vertex under the
 *   finger on her POSED body -- the nearest to the camera of those under it, so an arm in front of her belly is what
 *   gets painted -- and then changes every vertex within the brush's radius of it on the surface at rest, with a soft
 *   falloff. A radius in centimetres therefore means the same on her at 0% and at 200%.
 *
 * Core arithmetic is plain arrays (tested without a GPU); `pick` reads three's posed vertex positions.
 */
import * as THREE from 'three';
import { bodyDetail } from './bodyDetail';
import type { BodyMap } from './bodyRegions';

export const PAINT_ATTRIBUTE = 'fabricPaint';
/** Layers held per vertex (one vec3 attribute). */
export const PAINT_LAYER_COUNT = 3;
export const BRUSH_RANGE_CM = Object.freeze({ min: 1, max: 20, step: 0.5, initial: 5 });

/**
 * Neighbours of every vertex, from the triangles: what softening walks. With `position` (xyz per vertex), vertices that
 * stand in the same place -- her mesh is split along its texture seams, one copy for each side -- share one
 * neighbourhood, the whole ring round the point, each other included. Otherwise each copy sees only its own side of the
 * seam: a copy whose side is a few long triangles averaged with points three centimetres off, and a sleeve's end had a
 * bare notch in it where the other copy, a millimetre away on screen, stayed painted (Joshua, 2026-10-22: "the sleeve
 * has a small tear in it").
 */
export function vertexNeighbours(index: ArrayLike<number>, count: number, position?: ArrayLike<number>): Uint32Array[] {
  const sets: Set<number>[] = Array.from({ length: count }, () => new Set());
  for (let i = 0; i + 2 < index.length; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
  }
  if (position && position.length >= count * 3) {
    const groups = new Map<string, number[]>();
    for (let v = 0; v < count; v++) {
      const key = `${Math.round(position[v * 3] * 1e5)},${Math.round(position[v * 3 + 1] * 1e5)},${Math.round(position[v * 3 + 2] * 1e5)}`;
      const g = groups.get(key);
      if (g) g.push(v); else groups.set(key, [v]);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const all = new Set<number>();
      for (const v of g) { all.add(v); for (const u of sets[v]) all.add(u); }
      for (const v of g) { const own = new Set(all); own.delete(v); sets[v] = own; }
    }
  }
  return sets.map((s) => Uint32Array.from(s));
}

/** Weights for layer `layer` (stride `PAINT_LAYER_COUNT`) set to 1 wherever `cover & bits`, then softened `rings` times. */
export function fillLayer(weights: Float32Array, layer: number, cover: ArrayLike<number>, bits: number, neighbours: readonly Uint32Array[] | null, rings = 2): void {
  const n = cover.length;
  const own = new Float32Array(n);
  for (let v = 0; v < n; v++) own[v] = cover[v] & bits ? 1 : 0;
  if (neighbours) softenInPlace(own, neighbours, rings);
  for (let v = 0; v < n; v++) weights[v * PAINT_LAYER_COUNT + layer] = Math.max(weights[v * PAINT_LAYER_COUNT + layer], own[v]);
}

function softenInPlace(values: Float32Array, neighbours: readonly Uint32Array[], rings: number): void {
  let from = values, to = new Float32Array(values.length);
  for (let r = 0; r < rings; r++) {
    for (let v = 0; v < from.length; v++) {
      const nb = neighbours[v];
      let sum = from[v];
      for (let k = 0; k < nb.length; k++) sum += from[nb[k]];
      to[v] = sum / (nb.length + 1);
    }
    [from, to] = [to, from];
  }
  if (from !== values) values.set(from);
}

/**
 * Lone vertices that disagree with nearly all their neighbours take their neighbours' mean: where her skin weights
 * interleave arm and torso along a shoulder, a template's edge would otherwise be a fringe of single painted or bare
 * vertices. A clean edge, where about half the neighbours agree, is left exactly as it is.
 */
export function despeckle(values: Float32Array, neighbours: readonly Uint32Array[], passes = 2, threshold = 0.6): void {
  const next = new Float32Array(values.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let v = 0; v < values.length; v++) {
      const nb = neighbours[v];
      if (!nb.length) { next[v] = values[v]; continue; }
      let sum = 0;
      for (let k = 0; k < nb.length; k++) sum += values[nb[k]];
      const mean = sum / nb.length;
      next[v] = Math.abs(values[v] - mean) > threshold ? mean : values[v];
    }
    values.set(next);
  }
}

export function clearLayer(weights: Float32Array, layer: number): void {
  for (let v = layer; v < weights.length; v += PAINT_LAYER_COUNT) weights[v] = 0;
}

/**
 * One dab: every vertex whose REST position is within `radius` of `centre` moves toward 1 (paint) or 0 (erase) by
 * `strength` times a smooth falloff. Returns how many vertices changed.
 */
export function dab(weights: Float32Array, layer: number, rest: ArrayLike<number>, centre: { x: number; y: number; z: number }, radius: number, strength: number, erase: boolean, normals?: { readonly rest: ArrayLike<number>; readonly at: readonly [number, number, number] }): number {
  const r2 = radius * radius;
  let changed = 0;
  for (let v = 0, n = rest.length / 3; v < n; v++) {
    const dx = rest[v * 3] - centre.x, dy = rest[v * 3 + 1] - centre.y, dz = rest[v * 3 + 2] - centre.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r2) continue;
    // never through her: skin facing away from the surface under the brush is the other side of an arm or a leg
    if (normals && normals.rest[v * 3] * normals.at[0] + normals.rest[v * 3 + 1] * normals.at[1] + normals.rest[v * 3 + 2] * normals.at[2] < -0.1) continue;
    const t = 1 - Math.sqrt(d2) / radius, fall = t * t * (3 - 2 * t), at = v * PAINT_LAYER_COUNT + layer;
    const was = weights[at];
    const next = erase ? Math.max(0, was - strength * fall) : Math.min(1, was + strength * fall);
    if (next !== was) { weights[at] = next; changed++; }
  }
  return changed;
}

/** Layer weights as bytes, for an outfit file (the shape `outfitConfig` stores). */
export function packLayer(weights: Float32Array, layer: number): Uint8Array {
  const out = new Uint8Array(weights.length / PAINT_LAYER_COUNT);
  for (let v = 0; v < out.length; v++) out[v] = Math.round(Math.min(1, Math.max(0, weights[v * PAINT_LAYER_COUNT + layer])) * 255);
  return out;
}
export function unpackLayer(weights: Float32Array, layer: number, bytes: Uint8Array): void {
  for (let v = 0; v < bytes.length && v * PAINT_LAYER_COUNT < weights.length; v++) weights[v * PAINT_LAYER_COUNT + layer] = bytes[v] / 255;
}

/** How many steps UNDO keeps (each is one layer, a byte a vertex). */
export const UNDO_STEPS = 30;

/** The body's paint, as live data on its geometry. */
export class BodyPaint {
  readonly weights: Float32Array;
  private readonly attribute: THREE.BufferAttribute;
  private readonly undoStack: { layer: number; bytes: Uint8Array }[] = [];
  private readonly redoStack: { layer: number; bytes: Uint8Array }[] = [];
  private neighbours: Uint32Array[] | null = null;
  /** Her navel, once `prepareDetail` has found it; -1 before. */
  navelVertex = -1;
  /** Her nipples (`bodyDetail.ts`), -1 where one was not found; empty before `prepareDetail`. */
  nippleVertices: readonly number[] = [];
  /** How much paint covers vertex `v`, on the layers listed (0 to 1). */
  coverAt(v: number, layers: readonly number[]): number {
    let c = 0;
    for (const l of layers) c = Math.max(c, this.weights[v * PAINT_LAYER_COUNT + l] ?? 0);
    return c;
  }
  private screen: { x: Float32Array; y: Float32Array; depth: Float32Array } | null = null;

  constructor(readonly mesh: THREE.SkinnedMesh) {
    const g = mesh.geometry as THREE.BufferGeometry;
    const have = g.getAttribute(PAINT_ATTRIBUTE) as THREE.BufferAttribute | undefined;
    if (have) { this.attribute = have; this.weights = have.array as Float32Array; return; }
    this.weights = new Float32Array(g.getAttribute('position').count * PAINT_LAYER_COUNT);
    this.attribute = new THREE.BufferAttribute(this.weights, PAINT_LAYER_COUNT);
    g.setAttribute(PAINT_ATTRIBUTE, this.attribute);
  }

  private changed(): void { this.attribute.needsUpdate = true; }
  /** Her vertices' places, for finding the copies split along a texture seam (any one shape of her will do). */
  private restPositions(): ArrayLike<number> | undefined {
    const g = this.mesh.geometry as THREE.BufferGeometry, p = g.getAttribute('position');
    return p && !(p as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (p.array as ArrayLike<number>) : undefined;
  }

  /** Remember layer `layer` as it is, before a change, so UNDO can bring it back. */
  checkpoint(layer: number): void {
    this.undoStack.push({ layer, bytes: packLayer(this.weights, layer) });
    if (this.undoStack.length > UNDO_STEPS) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  /** Step back (or forward); returns the layer that changed, or -1. */
  undo(): number { return this.swap(this.undoStack, this.redoStack); }
  redo(): number { return this.swap(this.redoStack, this.undoStack); }
  private swap(from: { layer: number; bytes: Uint8Array }[], to: { layer: number; bytes: Uint8Array }[]): number {
    const step = from.pop();
    if (!step) return -1;
    to.push({ layer: step.layer, bytes: packLayer(this.weights, step.layer) });
    unpackLayer(this.weights, step.layer, step.bytes);
    this.changed();
    return step.layer;
  }

  /** The layer becomes `coverage` (a template), with any lone stray vertices along its edges cleaned up. */
  setLayer(layer: number, coverage: Float32Array): void {
    const g = this.mesh.geometry as THREE.BufferGeometry;
    this.neighbours ??= g.index ? vertexNeighbours(g.index.array, coverage.length, this.restPositions()) : null;
    const clean = Float32Array.from(coverage);
    if (this.neighbours) despeckle(clean, this.neighbours);
    for (let v = 0; v < clean.length; v++) this.weights[v * PAINT_LAYER_COUNT + layer] = clean[v];
    this.changed();
  }

  /** Whatever is painted on one side is painted on the other too (`mirror` pairs each vertex with its reflection). */
  mirror(layer: number, mirror: Int32Array): void {
    const before = packLayer(this.weights, layer);
    for (let v = 0; v < mirror.length; v++) {
      const m = mirror[v];
      if (m >= 0) this.weights[v * PAINT_LAYER_COUNT + layer] = Math.max(before[v], before[m]) / 255;
    }
    this.changed();
  }

  fill(layer: number, bits: number): void {
    const g = this.mesh.geometry as THREE.BufferGeometry, cover = g.getAttribute('_cloth_cover');
    if (!cover) return;
    this.fillMask(layer, Uint8Array.from({ length: cover.count }, (_, i) => (cover.getX(i) & bits ? 1 : 0)), false);
  }

  /** Paint (or with `erase`, clear) every vertex where `mask` is set, its edge softened a few rings. */
  fillMask(layer: number, mask: Uint8Array, erase: boolean): void {
    const g = this.mesh.geometry as THREE.BufferGeometry;
    this.neighbours ??= g.index ? vertexNeighbours(g.index.array, mask.length, this.restPositions()) : null;
    if (!erase) fillLayer(this.weights, layer, mask, 1, this.neighbours, 6);
    else {
      const keep = new Float32Array(mask.length);
      fillLayer(keep, 0, mask, 1, this.neighbours, 3);
      for (let v = 0; v < mask.length; v++) {
        const at = v * PAINT_LAYER_COUNT + layer, k = keep[v * PAINT_LAYER_COUNT];
        this.weights[at] = Math.min(this.weights[at], 1 - k);
      }
    }
    this.changed();
  }

  /** Paint or clear whole regions of her (`bodyRegions.ts`): `regions` is the map, `numbers` the regions chosen. */
  fillRegions(layer: number, regions: Uint8Array, numbers: readonly number[], erase: boolean): void {
    const want = new Set(numbers);
    this.fillMask(layer, Uint8Array.from(regions, (r) => (want.has(r) ? 1 : 0)), erase);
  }

  /** Store her nipple and navel detail for DETAIL THROUGH PAINT (`bodyDetail.ts`), once per body. */
  prepareDetail(map: BodyMap, navelHint?: number): void {
    const g = this.mesh.geometry as THREE.BufferGeometry;
    if (g.getAttribute('fabricDetail')) return;
    const rest = g.getAttribute('fabricRest'), nrm = g.getAttribute('fabricRestNormal');
    if (!rest || !nrm) return;
    const index = (this.mesh.userData.allIndices as ArrayLike<number> | undefined) ?? g.index?.array;
    if (!index) return;
    this.neighbours ??= vertexNeighbours(index, rest.count, this.restPositions());
    const d = bodyDetail({ map, restPosition: rest.array as ArrayLike<number>, restNormal: nrm.array as ArrayLike<number>, neighbours: this.neighbours, trunkLength: map.trunkLength, navelHint });
    this.navelVertex = d.navel;
    this.nippleVertices = d.nipples;
    g.setAttribute('fabricDetail', new THREE.BufferAttribute(d.offset, 4));
    g.setAttribute('fabricDetailN', new THREE.BufferAttribute(d.normal, 4));
  }

  /** Tint every vertex by its region's colour, or take the tint away (null): the SHOW REGIONS overlay. */
  showRegions(regions: Uint8Array | null, tints: readonly (readonly [number, number, number])[]): void {
    const g = this.mesh.geometry as THREE.BufferGeometry;
    let tint = g.getAttribute('fabricRegionTint') as THREE.BufferAttribute | undefined;
    if (!tint) { tint = new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 4), 4); g.setAttribute('fabricRegionTint', tint); }
    const a = tint.array as Float32Array;
    for (let v = 0; v < a.length / 4; v++) {
      const r = regions ? regions[v] : 0, c = r ? tints[r - 1] : null;
      a[v * 4] = c?.[0] ?? 0; a[v * 4 + 1] = c?.[1] ?? 0; a[v * 4 + 2] = c?.[2] ?? 0; a[v * 4 + 3] = c ? 1 : 0;
    }
    tint.needsUpdate = true;
  }

  clear(layer: number): void { clearLayer(this.weights, layer); this.changed(); }

  has(layer: number): boolean {
    for (let v = layer; v < this.weights.length; v += PAINT_LAYER_COUNT) if (this.weights[v] > 0.002) return true;
    return false;
  }

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
  }

  /** The vertex under a screen point: of those within `slop` pixels, the one nearest the camera; -1 off her. */
  pick(px: number, py: number, slop = 8): number {
    const s = this.screen;
    if (!s) return -1;
    let best = -1, bestDepth = Infinity;
    const s2 = slop * slop;
    for (let i = 0; i < s.x.length; i++) {
      const dx = s.x[i] - px, dy = s.y[i] - py;
      if (dx * dx + dy * dy > s2 || s.depth[i] < -1 || s.depth[i] > 1) continue;
      if (s.depth[i] < bestDepth) { bestDepth = s.depth[i]; best = i; }
    }
    return best;
  }

  /** Paint or erase around the vertex under the finger; `radius` in the mesh's own (rest) units. */
  stroke(px: number, py: number, layer: number, radius: number, erase: boolean, strength = 0.6): boolean {
    const hit = this.pick(px, py);
    if (hit < 0) return false;
    const rest = (this.mesh.geometry as THREE.BufferGeometry).getAttribute('fabricRest');
    if (!rest) return false;
    const r = rest.array as ArrayLike<number>;
    const nrm = (this.mesh.geometry as THREE.BufferGeometry).getAttribute('fabricRestNormal');
    const normals = nrm ? { rest: nrm.array as ArrayLike<number>, at: [nrm.getX(hit), nrm.getY(hit), nrm.getZ(hit)] as [number, number, number] } : undefined;
    const changed = dab(this.weights, layer, r, { x: r[hit * 3], y: r[hit * 3 + 1], z: r[hit * 3 + 2] }, radius, strength, erase, normals);
    if (changed) this.changed();
    return changed > 0;
  }

  endStroke(): void { this.screen = null; }
}
