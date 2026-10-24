/**
 * A FEW OF HER VERTICES, POSED ON THE CPU, EVERY FRAME. Her body is posed on the GPU and the CPU never sees the result,
 * but the room needs a handful of points on her as she stands now: her navel and her nipples, followed through about a
 * hundred vertices, so the tee's detail (`clothDetail.ts`) sits where her detail is under it -- on the cloth tee and
 * on the fitted one alike (Joshua, 2026-10-24: "the breast slider has no effect on the outfit… it still should have a
 * visible effect", "the bellybutton also doesn't appear with the slider").
 *
 * `clothSkin.ts` already poses vertices this way, but it is built for the cloth: it welds her 116,000 vertices and
 * tables her triangles' neighbours before it poses anything, about 200 ms on her body. None of that is needed to pose a
 * vertex, so this is its posing alone, the same math line for line, and building one costs two small arrays:
 * - Positions are read LIVE, because her shape sliders rewrite her `position` array on the CPU; each refresh notes
 *   where they are (a Float32 array to index directly, or the attribute itself when it is normalized or another type).
 * - Her morph targets with a non-zero influence are noted at each refresh, relative or absolute as her geometry says.
 * - Skinning is three's: the bind matrix, the weighted bones (`boneWorld · boneInverse`), the inverse bind matrix --
 *   with each bone's `boneWorld · boneInverse · bindMatrix` multiplied out once a refresh instead of once a vertex --
 *   then her world matrix. A plain mesh is morphs and her world matrix. Her skin indices and weights are read from
 *   their attributes as each vertex is posed, not copied for all of her up front: a hundred vertices do not need
 *   116,000 copied.
 * - A vertex is posed the first time it is asked for after a refresh and never twice before the next (a stamp per
 *   vertex); `posedCount` says how many that was.
 *
 * What it reads, so whoever calls it keeps these current first: her bones' and her mesh's world matrices (her model's
 * `updateMatrixWorld(true)`; the bones are read through `matrixWorld`, so `skeleton.update()` is not needed), her
 * `morphTargetInfluences` and her `position` attribute.
 */
import * as THREE from 'three';

type Attr = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

export class SkinPose {
  private readonly body: THREE.SkinnedMesh | THREE.Mesh;
  /** Each vertex posed this refresh, world (vertex × 3). */
  private world = new Float32Array(0);
  /** The refresh a vertex was last posed in. */
  private stamp = new Uint32Array(0);
  private count = 0;
  private frame = 0;
  private posed = 0;
  /** Each bone's `boneWorld · boneInverse · bindMatrix`, affine rows (bone × 12). */
  private bones = new Float64Array(12);
  private boneCount = 0;
  /** The bind matrix alone, affine rows: what a skin index past her skeleton's bones is posed by (as `clothSkin.ts` does). */
  private readonly bind = new Float64Array(12);
  /** `matrixWorld · bindMatrixInverse` (or `matrixWorld` alone unskinned), affine rows. */
  private readonly P = new Float64Array(12);
  private skinned = false;
  private skinIndex: Attr | null = null;
  private skinWeight: Attr | null = null;
  // the position attribute as this refresh reads it
  private posArr: Float32Array | null = null;
  private posStride = 3;
  private posOff = 0;
  private posAttr: Attr | null = null;
  // the morph targets with a non-zero influence this refresh
  private morphN = 0;
  private morphArr: (Float32Array | null)[] = [];
  private morphAttr: (Attr | null)[] = [];
  private morphStride = new Int32Array(0);
  private morphOff = new Int32Array(0);
  private morphW = new Float64Array(0);
  private morphRelative = true;
  // scratch
  private readonly m4 = new THREE.Matrix4();
  private readonly m4b = new THREE.Matrix4();
  // the last attribute `readerOf` looked at: a Float32 array to index directly, or null for `getX` reads
  private rArr: Float32Array | null = null;
  private rStride = 3;
  private rOff = 0;

  constructor(body: THREE.SkinnedMesh | THREE.Mesh) {
    this.body = body;
    if (!body.geometry.getAttribute('position')) throw new Error('SkinPose: the body has no position attribute');
  }

  /** How many vertices have been posed since the last refresh (each at most once). */
  get posedCount(): number { return this.posed; }

  /** Read her pose for this frame (bones, world matrix, which morphs are on, where her positions are). Call once a frame. */
  refresh(): void {
    const m = this.body, g = m.geometry;
    const pos = g.getAttribute('position') as Attr | undefined;
    if (!pos) throw new Error('SkinPose: the body has no position attribute');
    if (pos.count !== this.count) {
      // first refresh, or her geometry was swapped: every stamp starts clear
      this.count = pos.count;
      this.world = new Float32Array(pos.count * 3);
      this.stamp = new Uint32Array(pos.count);
      this.frame = 0;
    }
    if (++this.frame > 0x3fffffff) { this.stamp.fill(0); this.frame = 1; }
    this.posed = 0;

    // positions, read live: her shape sliders write them on the CPU
    this.readerOf(pos);
    this.posAttr = this.rArr ? null : pos; this.posArr = this.rArr; this.posStride = this.rStride; this.posOff = this.rOff;

    // the morph targets she has on
    const morphs = g.morphAttributes.position as Attr[] | undefined, inf = m.morphTargetInfluences;
    let k = 0;
    if (morphs && inf) {
      if (this.morphW.length < morphs.length) {
        const L = morphs.length;
        this.morphW = new Float64Array(L); this.morphStride = new Int32Array(L); this.morphOff = new Int32Array(L);
        this.morphArr = new Array<Float32Array | null>(L).fill(null); this.morphAttr = new Array<Attr | null>(L).fill(null);
      }
      for (let j = 0; j < morphs.length; j++) {
        const w = inf[j];
        if (!w) continue;
        this.readerOf(morphs[j]);
        this.morphW[k] = w; this.morphArr[k] = this.rArr; this.morphAttr[k] = this.rArr ? null : morphs[j];
        this.morphStride[k] = this.rStride; this.morphOff[k] = this.rOff; k++;
      }
    }
    this.morphN = k;
    this.morphRelative = g.morphTargetsRelative;

    // bones: boneWorld · boneInverse · bindMatrix, once each
    const sm = m as THREE.SkinnedMesh, sk = sm.isSkinnedMesh ? sm.skeleton : undefined;
    this.skinIndex = (g.getAttribute('skinIndex') as Attr | undefined) ?? null;
    this.skinWeight = (g.getAttribute('skinWeight') as Attr | undefined) ?? null;
    this.skinned = !!(sk && this.skinIndex && this.skinWeight);
    const mw = m.matrixWorld;
    if (this.skinned && sk) {
      const bones = sk.bones, inv = sk.boneInverses, n = bones.length;
      if (n * 12 > this.bones.length) this.bones = new Float64Array(n * 12);
      this.boneCount = n;
      for (let b = 0; b < n; b++) {
        const bone = bones[b], bi = inv[b];
        if (bone && bi) this.m4.multiplyMatrices(bone.matrixWorld, bi).multiply(sm.bindMatrix); else this.m4.copy(sm.bindMatrix);
        affineRows(this.m4, this.bones, b * 12);
      }
      affineRows(sm.bindMatrix, this.bind, 0);
      this.m4b.multiplyMatrices(mw, sm.bindMatrixInverse);
      affineRows(this.m4b, this.P, 0);
    } else affineRows(mw, this.P, 0);
  }

  /**
   * Body vertex v as posed at the last refresh, world, into out at o (cached per refresh). Before the first refresh it
   * refreshes itself.
   */
  posedVertex(v: number, out: Float32Array | number[], o = 0): void {
    if (this.frame === 0) this.refresh();
    if (!(v >= 0 && v < this.count)) throw new RangeError(`SkinPose: vertex ${v} is outside the body's ${this.count}`);
    if (this.stamp[v] !== this.frame) this.pose(v);
    const W = this.world;
    out[o] = W[v * 3]; out[o + 1] = W[v * 3 + 1]; out[o + 2] = W[v * 3 + 2];
  }

  private readerOf(a: Attr): void {
    if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
      const ia = a as THREE.InterleavedBufferAttribute, arr = ia.data.array;
      this.rArr = arr instanceof Float32Array && !ia.normalized ? arr : null; this.rStride = ia.data.stride; this.rOff = ia.offset;
    } else {
      const ba = a as THREE.BufferAttribute, arr = ba.array;
      this.rArr = arr instanceof Float32Array && !ba.normalized ? arr : null; this.rStride = ba.itemSize; this.rOff = 0;
    }
  }

  /** Pose vertex v into `world` and stamp it: morphs, bones, world matrix, as three does. */
  private pose(v: number): void {
    this.stamp[v] = this.frame;
    this.posed++;
    let x: number, y: number, z: number;
    const pa = this.posArr;
    if (pa) { const o = v * this.posStride + this.posOff; x = pa[o]; y = pa[o + 1]; z = pa[o + 2]; }
    else { const a = this.posAttr!; x = a.getX(v); y = a.getY(v); z = a.getZ(v); }
    const nM = this.morphN;
    if (nM > 0) {
      let dx = 0, dy = 0, dz = 0;
      const rel = this.morphRelative;
      for (let k = 0; k < nM; k++) {
        const w = this.morphW[k], ma = this.morphArr[k];
        let mx: number, my: number, mz: number;
        if (ma) { const o = v * this.morphStride[k] + this.morphOff[k]; mx = ma[o]; my = ma[o + 1]; mz = ma[o + 2]; }
        else { const a = this.morphAttr[k]!; mx = a.getX(v); my = a.getY(v); mz = a.getZ(v); }
        if (rel) { dx += w * mx; dy += w * my; dz += w * mz; } else { dx += w * (mx - x); dy += w * (my - y); dz += w * (mz - z); }
      }
      x += dx; y += dy; z += dz;
    }
    if (this.skinned) {
      const SI = this.skinIndex!, SW = this.skinWeight!, n = this.boneCount;
      let sx = 0, sy = 0, sz = 0;
      for (let k = 0; k < 4; k++) {
        const w = SW.getComponent(v, k);
        if (w === 0) continue;
        const b = SI.getComponent(v, k);
        // a bone her skeleton does not have is posed by the bind matrix alone, as clothSkin.ts does
        const B = b < n ? this.bones : this.bind, o = b < n ? b * 12 : 0;
        sx += w * (B[o] * x + B[o + 1] * y + B[o + 2] * z + B[o + 3]);
        sy += w * (B[o + 4] * x + B[o + 5] * y + B[o + 6] * z + B[o + 7]);
        sz += w * (B[o + 8] * x + B[o + 9] * y + B[o + 10] * z + B[o + 11]);
      }
      x = sx; y = sy; z = sz;
    }
    const P = this.P, W = this.world, o = v * 3;
    W[o] = P[0] * x + P[1] * y + P[2] * z + P[3];
    W[o + 1] = P[4] * x + P[5] * y + P[6] * z + P[7];
    W[o + 2] = P[8] * x + P[9] * y + P[10] * z + P[11];
  }
}

/** A matrix's affine part as three rows of four, into `out` at `o`. */
function affineRows(m: THREE.Matrix4, out: Float64Array, o: number): void {
  const e = m.elements;
  out[o] = e[0]; out[o + 1] = e[4]; out[o + 2] = e[8]; out[o + 3] = e[12];
  out[o + 4] = e[1]; out[o + 5] = e[5]; out[o + 6] = e[9]; out[o + 7] = e[13];
  out[o + 8] = e[2]; out[o + 9] = e[6]; out[o + 10] = e[10]; out[o + 11] = e[14];
}
