/**
 * HOW FAR INTO HER (P4's first piece -- Joshua, 2026-11-04: "I do see her arm is in her stomach a little bit... Thinking
 * collision based on vertices for more realistic collisions to objects and other things", then "add the simple
 * collision for now and later, we can get more advanced").
 *
 * Her skin AS IT IS DRAWN this frame -- her morphs, her navel, her soft belly and breasts as their masses have them, her
 * bones: `SkinPose`, the same math the shaders do -- sampled as a few hundred of her own triangles spread evenly over the
 * part of her asked for (chosen once, on her rest shape: `spreadTriangles`). Each sample is posed from its three
 * corners into a point (its middle) and the way out of her there (its face's normal, by the mesh's winding), and the
 * samples are held in a grid of `cell` a side. Then:
 * - a point's DEPTH under her skin is how far it is behind the nearest sample's tangent plane: positive inside her,
 *   negative out of her, and `-Infinity` where no sample is within a cell of it (nothing of her is near);
 * - a LIMB -- an upper arm, a forearm: a round thing from one end to the other, its radius eased from one end's to the
 *   other's -- is asked at points along its bone, each its own radius out, and is in her by the most of those.
 *
 * Simple on purpose: samples and their planes, not exact triangles, and nothing here pushes anything. Whoever asks
 * weighs the depth against what else it wants (her arm's reach picks the elbow place that keeps out of her). Anything
 * else that must not go into her later -- a hand gripping, a thing she holds, her baby -- asks the same question, which
 * is why it is a module of its own.
 */
import * as THREE from 'three';
import type { SkinPose } from './skinPose';

/** Grid keys: cells counted from this far below zero, this many a side (a cell of 5 cm reaches 100 m either way). */
const OFF = 2048;
const SPAN = 4096;
const keyOf = (ix: number, iy: number, iz: number): number => ((ix + OFF) * SPAN + (iy + OFF)) * SPAN + (iz + OFF);

/**
 * Her triangles to sample, spread evenly: of the triangles `keep` allows, one in each cube `spacing` a side (by its
 * middle at rest, `restOf`), corners three by three. Triangles with no area at rest are passed over. `index` is the
 * geometry's index, or null for a mesh whose vertices are its triangles' corners in order.
 */
export function spreadTriangles(
  index: ArrayLike<number> | null,
  vertexCount: number,
  restOf: (vertex: number, out: THREE.Vector3) => THREE.Vector3,
  keep: (a: number, b: number, c: number) => boolean,
  spacing: number,
): Uint32Array {
  const n = index ? Math.floor(index.length / 3) : Math.floor(vertexCount / 3);
  const taken = new Set<number>(), out: number[] = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (let t = 0; t < n; t++) {
    const a = index ? index[t * 3] : t * 3, b = index ? index[t * 3 + 1] : t * 3 + 1, c = index ? index[t * 3 + 2] : t * 3 + 2;
    if (!keep(a, b, c)) continue;
    restOf(a, A); restOf(b, B); restOf(c, C);
    if (ab.subVectors(B, A).cross(ac.subVectors(C, A)).lengthSq() < 1e-14) continue;
    const mx = (A.x + B.x + C.x) / 3, my = (A.y + B.y + C.y) / 3, mz = (A.z + B.z + C.z) / 3;
    if (!(Number.isFinite(mx) && Number.isFinite(my) && Number.isFinite(mz))) continue;
    const k = keyOf(Math.floor(mx / spacing), Math.floor(my / spacing), Math.floor(mz / spacing));
    if (taken.has(k)) continue;
    taken.add(k); out.push(a, b, c);
  }
  return Uint32Array.from(out);
}

export class SkinContact {
  /** each sample's middle and the way out of her there, world (sample × 3) */
  private pos = new Float32Array(0);
  private nrm = new Float32Array(0);
  private n = 0;
  private cell = 1;
  /** the samples in grid order, and each occupied cell's first and count (start × 2^16 + count) */
  private order = new Int32Array(0);
  private readonly buckets = new Map<number, number>();
  private readonly corner = new Float32Array(9);
  private readonly keys: number[] = [];

  /** How many samples were laid last. */
  get samples(): number { return this.n; }

  /**
   * Lay this frame's samples: each triangle of `corners` posed by `pose` (refreshed this frame by whoever asks), into its
   * middle and its normal, in a grid of `cell` (world units).
   */
  lay(pose: SkinPose, corners: Uint32Array, cell: number): void {
    const n = Math.floor(corners.length / 3);
    if (this.pos.length < n * 3) { this.pos = new Float32Array(n * 3); this.nrm = new Float32Array(n * 3); this.order = new Int32Array(n); }
    this.cell = cell;
    const P = this.pos, N = this.nrm, K = this.corner, keys = this.keys;
    keys.length = 0;
    let m = 0;
    for (let t = 0; t < n; t++) {
      pose.posedVertex(corners[t * 3], K, 0); pose.posedVertex(corners[t * 3 + 1], K, 3); pose.posedVertex(corners[t * 3 + 2], K, 6);
      const ux = K[3] - K[0], uy = K[4] - K[1], uz = K[5] - K[2], vx = K[6] - K[0], vy = K[7] - K[1], vz = K[8] - K[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (!(len > 0)) continue;
      nx /= len; ny /= len; nz /= len;
      const x = (K[0] + K[3] + K[6]) / 3, y = (K[1] + K[4] + K[7]) / 3, z = (K[2] + K[5] + K[8]) / 3;
      P[m * 3] = x; P[m * 3 + 1] = y; P[m * 3 + 2] = z; N[m * 3] = nx; N[m * 3 + 1] = ny; N[m * 3 + 2] = nz;
      keys.push(keyOf(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell)));
      m++;
    }
    this.n = m;
    // (sorted by cell, so each cell is one run of the order)
    const order = this.order;
    for (let i = 0; i < m; i++) order[i] = i;
    const sorted = Array.from(order.subarray(0, m)).sort((a, b) => keys[a] - keys[b]);
    this.buckets.clear();
    for (let i = 0; i < m; ) {
      const k = keys[sorted[i]];
      let j = i;
      while (j < m && keys[sorted[j]] === k) { order[j] = sorted[j]; j++; }
      this.buckets.set(k, i * 65536 + (j - i));
      i = j;
    }
  }

  /** How far (world) the point is under her skin: positive inside her, negative out of her, -Infinity with none of her near. */
  depth(x: number, y: number, z: number): number {
    const c = this.cell, cx = Math.floor(x / c), cy = Math.floor(y / c), cz = Math.floor(z / c), P = this.pos, N = this.nrm, order = this.order;
    let best = -1, bd = Infinity;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let l = -1; l <= 1; l++) {
      const b = this.buckets.get(keyOf(cx + i, cy + j, cz + l));
      if (b === undefined) continue;
      const s = Math.floor(b / 65536), e = s + (b % 65536);
      for (let q = s; q < e; q++) {
        const k = order[q], dx = P[k * 3] - x, dy = P[k * 3 + 1] - y, dz = P[k * 3 + 2] - z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bd) { bd = d2; best = k; }
      }
    }
    if (best < 0) return -Infinity;
    return (P[best * 3] - x) * N[best * 3] + (P[best * 3 + 1] - y) * N[best * 3 + 1] + (P[best * 3 + 2] - z) * N[best * 3 + 2];
  }

  /**
   * How far a limb goes into her (world): from `a` to `b`, its radius `ra` at a easing to `rb` at b, asked at `steps` + 1
   * points from `from` to `to` of the way along -- the most of each point's depth and its radius. Negative is clear of
   * her by that much; -Infinity with none of her near.
   */
  limbIn(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, from: number, to: number, steps: number): number {
    let most = -Infinity;
    for (let s = 0; s <= steps; s++) {
      const t = from + ((to - from) * s) / Math.max(1, steps);
      const d = this.depth(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      if (d > -Infinity) most = Math.max(most, d + ra + (rb - ra) * t);
    }
    return most;
  }
}
