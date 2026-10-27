/**
 * HER SKIN UNDER THE CLOTH, EVERY FRAME (Joshua, 2026-10-23: "make that one a true soft body/cloth with simulation over
 * the whole thing… there would be no more trying to sync and match to each point to another point… it would naturally
 * adjust and look better in the game").
 *
 * The cloth experiment's shirt is particles that `clothSim.ts` moves. What stops them falling through her is a floor
 * under each one, and that floor is HER: her body as she stands this frame, every bone of the pose and every morph of
 * her shape. Her body is posed on the GPU, though, and the CPU never sees the result -- so this module poses, on the
 * CPU, just the patch of her skin the cloth is touching, and says for every particle where the nearest skin is, which
 * way it faces, and how far off it the fabric keeps.
 *
 * Why it is shaped the way it is:
 * - NO SEARCH OVER HER. Her body is about 115,710 vertices and 208,000 triangles; the shirt is about 6,000 particles,
 *   every frame, on a phone's main thread. So nothing here looks at all of her. Each particle remembers the triangle it
 *   was nearest last frame (at first, the triangle the cloth file bound it to) and WALKS from there: when the closest
 *   point of the current triangle lies on one of its edges, the triangle across that edge is tried; when it lies on a
 *   corner, every triangle round that corner is; the particle moves while that is nearer, a few steps at most
 *   (`maxWalk`). Cloth moves a little each frame, so one or two steps is the usual cost, and a particle flung far is
 *   followed over a few frames rather than searched for in one.
 * - ONLY WHAT IS TOUCHED IS POSED. A vertex is posed the first time a triangle that uses it is looked at in an update,
 *   and never twice in one (a stamp per vertex). `posed` says how many that was, for the HUD: it is the honest measure
 *   of what the cloth costs her body.
 * - HER SEAMS ARE NOT EDGES. Her mesh is split along its texture seams -- one point of skin can be two or three vertices
 *   with the same position, and the triangles either side share no vertex index -- so a walk by index alone would stop
 *   dead at every seam. Neighbours are found by POSITION: every vertex is welded to the others within 1/131,072 of her
 *   size of its rest position (far below her vertex spacing, far above float noise), and the edge and corner tables are
 *   built over the welded ids. The weld is a sweep, not a rounded grid: a grid centred on a symmetric body puts its
 *   middle line exactly where her midline seam is, and float noise then rounds the two copies of a seam vertex apart.
 * - THE PIN NEVER WALKS. A pinned particle (the collar, the hem's anchors -- whatever `clothSim.ts` holds) is held to its
 *   OWN place on her: the bound triangle's three vertices and the bound barycentric weights, posed this frame, plus the
 *   rest offset along her normal there. Whatever the walk did, the pin is where the cloth file put it, carried by her.
 * - Posing is three's: `SkinnedMesh.getVertexPosition` (base position, plus every morph target by its influence, then
 *   the bind matrix, the weighted bones and the inverse bind matrix), then her world matrix -- with the bones' matrices
 *   multiplied out once per update instead of once per vertex. Her `position` attribute is read live, because her shape
 *   sliders write it on the CPU.
 * - Normals are the posed triangle's own face normal, turned outward: her triangles wind one way throughout, and which
 *   way is checked ONCE against her rest normals when this is built (and against her world matrix's handedness each
 *   frame, for the case of a mirrored room). The pin's "her normal" is the same face normal of its bound triangle, so the
 *   cloth file should measure its rest offsets along that.
 * - THE CONTACT IS A SPOT OF HER, AND IT IS CARRIED (`SkinContacts.carried`). Each particle remembers not only the
 *   triangle it was nearest but WHERE on it (barycentric), and before walking poses that same spot as she stands now:
 *   where last frame's contact has gone. The cloth's friction holds to that, because the nearest point moves when the
 *   particle slides and the spot of skin does not (Joshua at GRIP's top, 2026-10-24: the tee "starts ripping up the
 *   outfit… about 3s after I adjust the slider" -- friction against the nearest point's own motion made every stuck
 *   particle repeat last frame's slide, undamped). It costs no posing: last frame's triangle is the first one the walk
 *   measures, so its corners are posed this update either way; what is added is a weighted sum of three corners and
 *   remembering two weights -- measured on the 6,000-particle bench below, about 0.1 ms on a 2.9 ms update, and not
 *   one vertex more posed.
 * - A PARTICLE IS NOT A SLOT. A particle is one of the binding's `count` places on her, and everything this module
 *   remembers belongs to it: its bound triangle, the triangle it was nearest last update, the spot of her it carries.
 *   A SLOT is a place in the arrays the simulation runs on -- the `cloth` positions in and every field of
 *   `SkinContacts` out -- and `setOrder` says which particle each slot is: slot i is particle `order[i]`. By default
 *   slot i is particle i, over all of them, and nothing here is any different. The tee needs the difference because
 *   its rows are switched in and out on their own -- below the hem by its length, above the neckline by its collar, a
 *   front region cut away by a deeper neckline -- so the particles it runs are no longer the first n of the binding,
 *   and the simulation runs them packed into a compact array. A particle whose slot changes between two updates keeps
 *   its last contact, because that is the particle's and not the slot's.
 *
 * What it reads, so whoever calls it keeps these current first: her bones' and her mesh's world matrices (her model's
 * `updateMatrixWorld(true)` -- the bones are read through `matrixWorld`, so `skeleton.update()` is not needed), her
 * `morphTargetInfluences` and her `position` attribute. What it does not do: a walk is local, so a particle whose closest
 * point lies INSIDE its current triangle stops there -- in a tight crease a folded-over neighbour can be nearer and is
 * not looked at. A local walk cannot see that without searching; it is the price of not searching.
 */
import * as THREE from 'three';
import type { ClothBinding, SkinContacts } from './clothTypes';
import { mirrorIndex } from './bodyRegions';

export interface ClothSkinOptions {
  /** World units: every `SkinContacts.standOff` is this (default 0.15 = 1.5 mm in a 100-units-per-metre room). */
  thickness: number;
  /** Most triangle steps per particle per update (default 8). */
  maxWalk?: number;
  /**
   * World units. A particle keeps at least its own rest clearance off her (how far the fitted tee stood off her there),
   * up to this, and never less than `thickness`. Her skin between particles (a centimetre apart) is not felt, so with
   * one stand-off everywhere her nipples and navel came up through the triangles between them; where the tee was made
   * to clear them, it clears them. 0 (the default): `thickness` everywhere.
   */
  restClearance?: number;
  /**
   * Her arm bones (skeleton indices). A triangle is her ARM when two of its corners hang mostly from them; a particle
   * bound to her trunk never takes an arm triangle as its floor. Between her side and an arm hanging beside it a
   * particle has two skins and the walk sees one: given the arm, it was pushed into her side and the tee tore open
   * under her arms. (A tee's sleeve, bound to her arm, walks anywhere.)
   */
  armBones?: readonly number[];
  /**
   * Per particle (binding order), 1 where the particle is TRUNK cloth and must never take her arm as its floor, 0 where
   * it may. Given, it replaces the rule above that reads it off the bound triangle: a garment knows which of its pieces
   * are its body and which its sleeves.
   */
  trunkOnly?: Uint8Array;
}

/** 1.5 mm of fabric off her skin, in the room's 100 units to the metre. */
export const CLOTH_THICKNESS = 0.15;
/** Triangle steps a particle may take in one update before it is followed again next frame. */
export const CLOTH_MAX_WALK = 8;

/** Two rest positions closer than her largest dimension over this, on every axis, are one point of her (~13 µm on her). */
const WELD_CELLS = 131072;
/** A step must bring the particle at least this much nearer (relative, squared distance) to be taken. */
const STEP_GAIN = 1 - 1e-6;

/** Where on a triangle its closest point lies: inside, on an edge (v0-v1, v1-v2, v2-v0), or at a corner (v0, v1, v2). */
const FACE = 0, EDGE_01 = 1, EDGE_12 = 2, EDGE_20 = 3, CORNER_0 = 4, CORNER_1 = 5, CORNER_2 = 6;

/**
 * What a particle's last contact was, so it can be carried (`SkinContacts.carried`):
 * - FRESH: there was none (a new ClothSkin, or just after `initial`): `carried` is this update's own point, no motion.
 * - BOUND: its own bound place (binding.tri at binding.bary), where a blown-up particle was put: the pin's skin point.
 * - WALKED: triangle `last[f]` at the barycentric weights `contactBary` holds, in that triangle's own corner order.
 * All three are by PARTICLE (f), never by slot.
 */
const CARRY_FRESH = 0, CARRY_BOUND = 1, CARRY_WALKED = 2;

type Attr = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

export class ClothSkin {
  private readonly body: THREE.SkinnedMesh;
  private readonly count: number;
  /** World units: every `SkinContacts.standOff` is this; may be changed between updates (the room's CLOSENESS slider). */
  thickness: number;
  /** World units, live: see ClothSkinOptions.restClearance. */
  restClearance: number;
  private readonly maxWalk: number;

  // --- built once ---
  /** Her triangles, three vertex indices each. */
  private readonly tris: Uint32Array;
  /** Each vertex's welded id: vertices at one rest position share one. */
  private readonly weld: Uint32Array;
  /** The triangles round each welded vertex, compressed rows: `rowTri[rowStart[w] .. rowStart[w + 1])`. */
  private readonly rowStart: Uint32Array;
  private readonly rowTri: Uint32Array;
  /** The triangle across each edge (t*3 + e, edge e from corner e to corner e+1), welded; -1 at an open edge. */
  private readonly adj: Int32Array;
  /** +1 when her triangles wind outward at rest, -1 when they wind inward. */
  private readonly restSign: number;
  /** The triangle each particle was bound to (its vertex triple's triangle, or the nearest stand-in). */
  private readonly bound: Uint32Array;
  /** 1 where that triangle is the particle's own three vertices (nearly always), so posing them poses the triangle. */
  private readonly exact: Uint8Array;
  /** Her skin indices and weights, four a vertex, copied once (so a normalized or interleaved file reads the same). */
  private readonly skinI: Uint16Array | null;
  private readonly skinW: Float32Array | null;
  private readonly binding: ClothBinding;
  /** 1 for a triangle of her arm (see `armBones`); and 1 for a particle that must keep off them. */
  private readonly armTri: Uint8Array;
  private readonly trunkOnly: Uint8Array;

  // --- which particle each slot is (`setOrder`) ---
  /**
   * Slot i is binding particle `order[i]`, for i < `nSlots` (count long, the rest unused). Built once as identity over
   * all `count` and overwritten in place by `setOrder`, so nothing is allocated for it after the constructor.
   */
  private readonly order: Uint32Array;
  /** How many slots `order` maps: `count` by default. */
  private nSlots: number;

  // --- per particle (by binding index, never by slot), carried between updates ---
  /** The triangle each particle was nearest last update. */
  private readonly last: Uint32Array;
  /**
   * Where on `last[f]` that nearest point was, barycentric in the triangle's own corner order (count × 3): with `last`,
   * the spot of her skin the particle touched, which the next update poses again to say where it has gone. Starts as
   * the binding's own weights, but is read only under CARRY_WALKED: FRESH carries nothing, and BOUND's place is the
   * pin's skin point, already posed in the binding's own corner order (which need not be the bound triangle's).
   */
  private readonly contactBary: Float32Array;
  /** CARRY_FRESH, CARRY_BOUND or CARRY_WALKED per particle: what `last` and `contactBary` describe. */
  private readonly contactKind: Uint8Array;

  // --- per update ---
  /** Each vertex posed this update, world (vertex × 3). */
  private readonly world: Float32Array;
  /** Each vertex posed this frame, before her bones: her shape now in her own (bind) space (vertex × 3). */
  private readonly bindPos: Float32Array;
  /** The update a vertex was last posed in. */
  private readonly stamp: Uint32Array;
  private frame = 0;
  private posedCount = 0;
  /** Each bone's `boneWorld · boneInverse · bindMatrix`, affine rows (bone × 12). */
  private bones: Float64Array;
  /** `matrixWorld · bindMatrixInverse` (or `matrixWorld` alone unskinned), affine rows. */
  private readonly P = new Float64Array(12);
  /** Her root bone's body-local to world linear map, as of the last update (3 × 3, rows). */
  private readonly L = new Float64Array(9);
  private skinned = false;
  private sign = 1;
  private scale = 1;
  // the position attribute as this update reads it
  private posArr: Float32Array | null = null;
  private posStride = 3;
  private posOff = 0;
  private posAttr: Attr | null = null;
  // the morph targets with a non-zero influence this update
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
  private qx = 0; private qy = 0; private qz = 0; private reg = FACE;
  /**
   * The last closest point's barycentric weights on corners 1 and 2 (corner 0's is 1 - bv - bw). Kept up by `closest`
   * for every triangle the walk tries, and carried by the walk with its best, because that measured cheaper than
   * working them out afresh for the walk's last triangle: on the 6,000-particle bench, 0.1-0.2 ms an update for the
   * whole carried point against 0.5 ms (the division-heavy afresh sum costs more than a few stores per try).
   */
  private bv = 0; private bw = 0;
  private nx = 0; private ny = 0; private nz = 0;
  /** The last pin's bare skin point. */
  private sx = 0; private sy = 0; private sz = 0;

  constructor(body: THREE.SkinnedMesh, binding: ClothBinding, options?: Partial<ClothSkinOptions>) {
    this.body = body;
    this.binding = binding;
    this.count = binding.count;
    this.thickness = options?.thickness ?? CLOTH_THICKNESS;
    this.restClearance = options?.restClearance ?? 0;
    this.maxWalk = Math.max(0, Math.floor(options?.maxWalk ?? CLOTH_MAX_WALK));
    const g = body.geometry, pos = g.getAttribute('position') as Attr | undefined;
    if (!pos) throw new Error('ClothSkin: the body has no position attribute');
    const nV = pos.count;

    // her triangles
    const index = g.index;
    const nT = index ? Math.floor(index.count / 3) : Math.floor(nV / 3);
    if (nT === 0) throw new Error('ClothSkin: the body has no triangles');
    const tris = new Uint32Array(nT * 3);
    if (index) { const ia = index.array; for (let i = 0; i < nT * 3; i++) tris[i] = ia[i]; }
    else for (let i = 0; i < nT * 3; i++) tris[i] = i;
    for (let i = 0; i < tris.length; i++) if (tris[i] >= nV) throw new RangeError(`ClothSkin: triangle corner ${tris[i]} is outside the body's ${nV} vertices`);
    this.tris = tris;

    // weld by rest position
    const rest = new Float64Array(nV * 3), sweep = new Float64Array(nV);
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let v = 0; v < nV; v++) {
      const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      rest[v * 3] = x; rest[v * 3 + 1] = y; rest[v * 3 + 2] = z;
      if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) { sweep[v] = Infinity; continue; }
      sweep[v] = x;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    this.weld = weldByPosition(rest, sweep, Math.max(maxX - minX, maxY - minY, maxZ - minZ) / WELD_CELLS);
    const weld = this.weld;
    let nW = 0;
    for (let v = 0; v < nV; v++) if (weld[v] + 1 > nW) nW = weld[v] + 1;

    // the triangles round each welded vertex
    const rowStart = new Uint32Array(nW + 1);
    for (let t = 0; t < nT; t++) {
      const a = weld[tris[t * 3]], b = weld[tris[t * 3 + 1]], c = weld[tris[t * 3 + 2]];
      rowStart[a + 1]++; if (b !== a) rowStart[b + 1]++; if (c !== a && c !== b) rowStart[c + 1]++;
    }
    for (let w = 0; w < nW; w++) rowStart[w + 1] += rowStart[w];
    const rowTri = new Uint32Array(rowStart[nW]), fill = rowStart.slice(0, nW);
    for (let t = 0; t < nT; t++) {
      const a = weld[tris[t * 3]], b = weld[tris[t * 3 + 1]], c = weld[tris[t * 3 + 2]];
      rowTri[fill[a]++] = t; if (b !== a) rowTri[fill[b]++] = t; if (c !== a && c !== b) rowTri[fill[c]++] = t;
    }
    this.rowStart = rowStart; this.rowTri = rowTri;

    // the triangle across each edge: one sharing both welded ends, preferring one that runs the edge the other way
    const adj = new Int32Array(nT * 3).fill(-1);
    for (let t = 0; t < nT; t++) {
      for (let e = 0; e < 3; e++) {
        const wa = weld[tris[t * 3 + e]], wb = weld[tris[t * 3 + (e + 1) % 3]];
        if (wa === wb) continue;
        let any = -1, opposite = -1;
        for (let k = rowStart[wa]; k < rowStart[wa + 1] && opposite < 0; k++) {
          const u = rowTri[k];
          if (u === t) continue;
          for (let f = 0; f < 3; f++) {
            if (weld[tris[u * 3 + f]] !== wb) continue;
            if (any < 0) any = u;
            if (weld[tris[u * 3 + (f + 1) % 3]] === wa) opposite = u;
          }
        }
        adj[t * 3 + e] = opposite >= 0 ? opposite : any;
      }
    }
    this.adj = adj;

    // which way is out: her rest face normals against her rest vertex normals (or her enclosed volume, without them)
    const N = g.getAttribute('normal') as Attr | undefined;
    let vote = 0;
    for (let t = 0; t < nT; t++) {
      const a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3;
      const ux = rest[b] - rest[a], uy = rest[b + 1] - rest[a + 1], uz = rest[b + 2] - rest[a + 2];
      const vx = rest[c] - rest[a], vy = rest[c + 1] - rest[a + 1], vz = rest[c + 2] - rest[a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      let d: number;
      if (N) {
        const i = tris[t * 3], j = tris[t * 3 + 1], k = tris[t * 3 + 2];
        d = cx * (N.getX(i) + N.getX(j) + N.getX(k)) + cy * (N.getY(i) + N.getY(j) + N.getY(k)) + cz * (N.getZ(i) + N.getZ(j) + N.getZ(k));
      } else d = rest[a] * cx + rest[a + 1] * cy + rest[a + 2] * cz;
      if (Number.isFinite(d)) vote += d;
    }
    this.restSign = vote < 0 ? -1 : 1;

    // her skin weights, once
    const SI = g.getAttribute('skinIndex') as Attr | undefined, SW = g.getAttribute('skinWeight') as Attr | undefined;
    let maxBone = -1;
    if (SI && SW) {
      const si = new Uint16Array(nV * 4), sw = new Float32Array(nV * 4);
      for (let v = 0; v < nV; v++) {
        si[v * 4] = SI.getX(v); si[v * 4 + 1] = SI.getY(v); si[v * 4 + 2] = SI.getZ(v); si[v * 4 + 3] = SI.getW(v);
        sw[v * 4] = SW.getX(v); sw[v * 4 + 1] = SW.getY(v); sw[v * 4 + 2] = SW.getZ(v); sw[v * 4 + 3] = SW.getW(v);
        for (let k = 0; k < 4; k++) if (sw[v * 4 + k] !== 0 && si[v * 4 + k] > maxBone) maxBone = si[v * 4 + k];
      }
      this.skinI = si; this.skinW = sw;
    } else { this.skinI = null; this.skinW = null; }
    this.bones = new Float64Array(Math.max(maxBone + 1, body.skeleton?.bones.length ?? 0, 1) * 12);

    // each particle's bound triangle: its exact vertex triple, else the same three welded points, else one touching them
    const n = this.count;
    if (binding.tri.length < n * 3 || binding.bary.length < n * 3 || binding.offset.length < n) throw new RangeError('ClothSkin: the binding is shorter than its count');
    const bound = new Uint32Array(n), exact = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const a = binding.tri[i * 3], b = binding.tri[i * 3 + 1], c = binding.tri[i * 3 + 2];
      if (a >= nV || b >= nV || c >= nV) throw new RangeError(`ClothSkin: particle ${i} is bound to vertex ${Math.max(a, b, c)}, outside the body's ${nV}`);
      const t = bound[i] = this.findTriangle(a, b, c);
      exact[i] = sameSet(tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2], a, b, c) ? 1 : 0;
    }
    this.bound = bound; this.exact = exact;
    this.last = bound.slice();
    this.contactBary = binding.bary.slice(0, n * 3);
    this.contactKind = new Uint8Array(n).fill(CARRY_FRESH);
    // every particle, each in its own slot
    this.order = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.order[i] = i;
    this.nSlots = n;

    // her arms, and the particles bound to her trunk, which keep off them
    this.armTri = new Uint8Array(nT); this.trunkOnly = new Uint8Array(n);
    const arm = new Set(options?.armBones ?? []);
    if (arm.size && this.skinI && this.skinW) {
      const onArm = (v: number) => { let w = 0; for (let k = 0; k < 4; k++) if (arm.has(this.skinI![v * 4 + k])) w += this.skinW![v * 4 + k]; return w > 0.5; };
      const armVertex = new Uint8Array(nV); for (let v = 0; v < nV; v++) armVertex[v] = onArm(v) ? 1 : 0;
      symmetricArms(armVertex, g.getAttribute('position') as Attr);
      for (let t = 0; t < nT; t++) this.armTri[t] = armVertex[tris[t * 3]] + armVertex[tris[t * 3 + 1]] + armVertex[tris[t * 3 + 2]] >= 2 ? 1 : 0;
      for (let i = 0; i < n; i++) this.trunkOnly[i] = this.armTri[bound[i]] ? 0 : 1;
    }
    if (options?.trunkOnly && options.trunkOnly.length >= n && arm.size) for (let i = 0; i < n; i++) this.trunkOnly[i] = options.trunkOnly[i] ? 1 : 0;

    this.world = new Float32Array(nV * 3);
    this.bindPos = new Float32Array(nV * 3);
    this.stamp = new Uint32Array(nV);
  }

  /** How many body vertices the last update (or `initial`) posed (for the HUD). */
  get posed(): number { return this.posedCount; }

  /** Whether binding particle p is bound to her ARM (its bound triangle is her arm's): for a probe. */
  boundToArm(p: number): boolean { return this.armTri[this.bound[p]] === 1; }

  /** How many slots `initial` and `update` serve: `count` until `setOrder` says otherwise. */
  get slots(): number { return this.nSlots; }

  /**
   * Which binding particle each slot is, from now on: slot i is particle `order[i]`, for every i < `order.length`;
   * null puts every particle back in its own slot (slot i is particle i, all `count` of them), which is also where a new
   * ClothSkin starts. The order is copied, so the caller may reuse its array. Any subset of the particles in any order
   * is allowed -- the tee's hem, collar and neckline switch rows in and out independently, so the active set is not a
   * prefix of the binding. Throws RangeError, and keeps the order it had, when `order` is longer than `count` or names
   * a particle that is not in the binding. Nothing a particle carries is touched: a particle that changes slot, or
   * leaves and comes back, keeps its last contact.
   */
  setOrder(order: Uint32Array | null): void {
    const n = this.count;
    if (order === null) {
      for (let i = 0; i < n; i++) this.order[i] = i;
      this.nSlots = n;
      return;
    }
    if (order.length > n) throw new RangeError(`ClothSkin.setOrder: ${order.length} slots for a binding of ${n} particles`);
    for (let i = 0; i < order.length; i++) {
      if (order[i] >= n) throw new RangeError(`ClothSkin.setOrder: slot ${i} names particle ${order[i]}, outside the binding's ${n}`);
    }
    this.order.set(order);
    this.nSlots = order.length;
  }

  /**
   * Each particle's rest offset for its PIN, in place of the binding's (BODY-LOCAL units like `ClothBinding.offset`, one
   * a binding particle, by binding index and not by slot, at least `count` long; null for the binding's own). The room
   * uses it to hold a freshly cut neckline edge to her skin -- a hug -- rather than where the made tee stood off her
   * there. It moves the pin target only, in both the skinned and the unskinned reckoning: the contact's `standOff`
   * keeps the binding's offset, because that is the clearance the made tee had there, and `restShape` (the pattern)
   * keeps it too. Read at every `initial` and `update`, so it may be changed or cleared between them; throws
   * RangeError when set shorter than `count`.
   */
  get pinOffset(): Float32Array | null { return this.pinOffsetArr; }
  set pinOffset(offsets: Float32Array | null) {
    if (offsets && offsets.length < this.count) throw new RangeError(`ClothSkin.pinOffset: ${offsets.length} offsets for a binding of ${this.count} particles`);
    this.pinOffsetArr = offsets;
  }
  private pinOffsetArr: Float32Array | null = null;

  /**
   * Her bound places with her SHAPE but not her pose (count × 3, world-sized units about her own origin): each
   * particle's bound skin point on her morphed, unposed body plus its rest offset along that triangle's normal. Only the
   * lengths between them mean anything: it is the pattern of a tee cut for her as she is shaped now (`ClothSim.setRest`).
   * It is the pattern of the WHOLE garment, so it is in binding order over all `count` particles whatever `setOrder`
   * says, and it lays each one out by the binding's own offset, never `pinOffset`.
   */
  restShape(out: Float32Array): Float32Array {
    this.refresh();
    const bt = this.binding.tri, bb = this.binding.bary, off = this.binding.offset, s = this.scale, n = this.count, q = [0, 0, 0, 0, 0, 0, 0, 0, 0], r = [0, 0, 0, 0, 0, 0, 0, 0, 0], T = this.tris;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) this.restLocal(bt[i * 3 + c], q, c * 3);
      // her normal from the bound triangle's own corners, in its own winding (the file may name them in any order)
      const t = this.bound[i];
      for (let c = 0; c < 3; c++) this.restLocal(T[t * 3 + c], r, c * 3);
      const ux = r[3] - r[0], uy = r[4] - r[1], uz = r[5] - r[2], vx = r[6] - r[0], vy = r[7] - r[1], vz = r[8] - r[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz);
      const k = l > 0 ? this.restSign / l : 0; nx *= k; ny *= k; nz *= k;
      const u = bb[i * 3], v = bb[i * 3 + 1], w = bb[i * 3 + 2], o = off[i];
      out[i * 3] = (u * q[0] + v * q[3] + w * q[6] + nx * o) * s;
      out[i * 3 + 1] = (u * q[1] + v * q[4] + w * q[7] + ny * o) * s;
      out[i * 3 + 2] = (u * q[2] + v * q[5] + w * q[8] + nz * o) * s;
    }
    return out;
  }

  /**
   * Where her bones carry her rest shape before it is drawn, body-local, 3 per body vertex, or null: her BUILD moves her
   * bones at rest (`view/bodyBuild.ts`), and her shape is only whole with that added. Only the PATTERN reads it
   * (`restShape`, the tee cut for her as she is shaped): the particles' own places are skinned by her bones, which carry
   * it already.
   */
  restShift: Float32Array | null = null;

  /** `local`, and where her bones carry it at rest (`restShift`). */
  private restLocal(v: number, out: number[], o: number): void {
    this.local(v, out, o);
    const S = this.restShift;
    if (S && 3 * v + 2 < S.length) { out[o] += S[3 * v]; out[o + 1] += S[3 * v + 1]; out[o + 2] += S[3 * v + 2]; }
  }

  /** Vertex v with her morphs but no bones, body-local, into out at o. */
  private local(v: number, out: number[], o: number): void {
    let x: number, y: number, z: number;
    const pa = this.posArr;
    if (pa) { const p = v * this.posStride + this.posOff; x = pa[p]; y = pa[p + 1]; z = pa[p + 2]; }
    else { const a = this.posAttr!; x = a.getX(v); y = a.getY(v); z = a.getZ(v); }
    for (let k = 0; k < this.morphN; k++) {
      const w = this.morphW[k], ma = this.morphArr[k];
      let mx: number, my: number, mz: number;
      if (ma) { const p = v * this.morphStride[k] + this.morphOff[k]; mx = ma[p]; my = ma[p + 1]; mz = ma[p + 2]; }
      else { const a = this.morphAttr[k]!; mx = a.getX(v); my = a.getY(v); mz = a.getZ(v); }
      if (this.morphRelative) { x += w * mx; y += w * my; z += w * mz; } else { x += w * (mx - x); y += w * (my - y); z += w * (mz - z); }
    }
    out[o] = x; out[o + 1] = y; out[o + 2] = z;
  }

  /** A body-local vector carried to world as her root bone (her hips) carries it now (as of the last update or `initial`). */
  worldVector(x: number, y: number, z: number, out: Float32Array, o: number): void {
    const L = this.L;
    out[o] = L[0] * x + L[1] * y + L[2] * z; out[o + 1] = L[3] * x + L[4] * y + L[5] * z; out[o + 2] = L[6] * x + L[7] * y + L[8] * z;
  }

  /** World units per body-local unit as of the last update (or `initial`): her skinning's own scale. */
  get worldScale(): number { return this.scale; }

  /**
   * Where each slot's particle starts, world (slots × 3, slot i at i × 3): its bound skin point as she is posed NOW,
   * plus its rest offset (scaled to world; `pinOffset`'s where that is set) along her normal there -- its pin target.
   * Every particle's walk starts again from its bound triangle, the ones no slot holds as well, and none has a last
   * contact to carry: the next update's `carried` is its own `point`.
   */
  initial(out: Float32Array): Float32Array {
    this.refresh();
    const n = this.nSlots, order = this.order;
    for (let i = 0; i < n; i++) this.pinOf(order[i], out, i * 3);
    this.last.set(this.bound);
    this.contactKind.fill(CARRY_FRESH);
    return out;
  }

  /**
   * Her skin under the cloth now. For each slot (given its current world position in `cloth`, slot i at i × 3), whose
   * particle f is `order[i]`: first, f's last contact -- the same triangle at the same barycentric place -- posed as
   * she stands now, into `carried`; then, starting from that triangle (first time: f's bound triangle), walk to the
   * nearest triangle around it, and write the closest point, the triangle's outward unit normal (posed, world) and
   * standOff = thickness (or f's own clearance, see `restClearance`). pinTarget is always from f's FIXED bound
   * triangle and bary (never walked). What is the PARTICLE's -- its binding, bound triangle, last contact, the arm
   * rule -- is read and kept by f; what is the SLOT's -- `cloth`, every field of `out`, `extraStandOff` -- by i. Serves
   * min(`slots`, cloth.length / 3) slots and touches nothing in `out` past them. Returns the milliseconds spent.
   */
  update(cloth: Float32Array, out: SkinContacts): number {
    const t0 = performance.now();
    this.refresh();
    const n = Math.min(this.nSlots, Math.floor(cloth.length / 3));
    const { tris, weld, rowStart, rowTri, adj, last, maxWalk, thickness, order } = this, clearance = this.restClearance, offset = this.binding.offset, scale = this.scale;
    const extra = this.extraStandOff && this.extraStandOff.length >= n ? this.extraStandOff : null;
    const P = out.point, Nn = out.normal, S = out.standOff, C = out.carried, bound = this.bound;
    const kind = this.contactKind, cb = this.contactBary, W = this.world;
    for (let i = 0; i < n; i++) {
      // i is the slot (cloth, out, extra); f is the particle (binding, bound, last, contactBary, contactKind, trunkOnly)
      const i3 = i * 3, f = order[i], f3 = f * 3;
      const px = cloth[i3], py = cloth[i3 + 1], pz = cloth[i3 + 2];
      // the pin first: its bound triangle's normal is also the contact's whenever the particle has not walked off it
      const pinOk = this.pinOf(f, out.pinTarget, i3);
      const pnx = this.nx, pny = this.ny, pnz = this.nz;
      const was = kind[f];
      if (!(Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz))) {
        // a particle that has blown up gets its own bound place on her as its floor, and starts there next time; that
        // place is where its contact is now, so nothing of her is carried this time
        P[i3] = this.sx; P[i3 + 1] = this.sy; P[i3 + 2] = this.sz;
        C[i3] = this.sx; C[i3 + 1] = this.sy; C[i3 + 2] = this.sz;
        if (pinOk) { Nn[i3] = pnx; Nn[i3 + 1] = pny; Nn[i3 + 2] = pnz; } else keepNormal(Nn, i3);
        S[i] = thickness; last[f] = bound[f]; kind[f] = CARRY_BOUND;
        continue;
      }
      let t = last[f];
      const keepOff = this.trunkOnly[f] === 1, armTri = this.armTri;
      let d = this.closest(t, px, py, pz);
      // last update's contact, carried: `closest` has just posed t's corners, so this poses nothing more
      if (was === CARRY_WALKED) {
        const a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3, u = cb[f3], v = cb[f3 + 1], w = cb[f3 + 2];
        C[i3] = u * W[a] + v * W[b] + w * W[c];
        C[i3 + 1] = u * W[a + 1] + v * W[b + 1] + w * W[c + 1];
        C[i3 + 2] = u * W[a + 2] + v * W[b + 2] + w * W[c + 2];
      } else if (was === CARRY_BOUND) { C[i3] = this.sx; C[i3 + 1] = this.sy; C[i3 + 2] = this.sz; }
      let qx = this.qx, qy = this.qy, qz = this.qz, reg = this.reg, qv = this.bv, qw = this.bw;
      for (let step = 0; step < maxWalk && reg !== FACE; step++) {
        let bestT = -1, bestD = d * STEP_GAIN, bx = 0, by = 0, bz = 0, br = FACE, bv = 0, bw = 0;
        if (reg <= EDGE_20) {
          const u = adj[t * 3 + reg - EDGE_01];
          if (u >= 0 && !(keepOff && armTri[u])) {
            const du = this.closest(u, px, py, pz);
            if (du < bestD) { bestT = u; bestD = du; bx = this.qx; by = this.qy; bz = this.qz; br = this.reg; bv = this.bv; bw = this.bw; }
          }
        } else {
          const w = weld[tris[t * 3 + reg - CORNER_0]];
          for (let k = rowStart[w], end = rowStart[w + 1]; k < end; k++) {
            const u = rowTri[k];
            if (u === t || (keepOff && armTri[u])) continue;
            const du = this.closest(u, px, py, pz);
            if (du < bestD) { bestT = u; bestD = du; bx = this.qx; by = this.qy; bz = this.qz; br = this.reg; bv = this.bv; bw = this.bw; }
          }
        }
        if (bestT < 0) break;
        t = bestT; d = bestD; qx = bx; qy = by; qz = bz; reg = br; qv = bv; qw = bw;
      }
      last[f] = t;
      P[i3] = qx; P[i3 + 1] = qy; P[i3 + 2] = qz;
      // this contact is the spot of her the next update carries; with no last one, nothing of her was carried
      cb[f3] = 1 - qv - qw; cb[f3 + 1] = qv; cb[f3 + 2] = qw; kind[f] = CARRY_WALKED;
      if (was === CARRY_FRESH) { C[i3] = qx; C[i3 + 1] = qy; C[i3 + 2] = qz; }
      // t's corners were posed when it was measured, so its normal needs no posing
      if (t === bound[f] && pinOk) { Nn[i3] = pnx; Nn[i3 + 1] = pny; Nn[i3 + 2] = pnz; }
      else if (this.normalOf(t)) { Nn[i3] = this.nx; Nn[i3 + 1] = this.ny; Nn[i3 + 2] = this.nz; }
      else keepNormal(Nn, i3);
      // the clearance is the made tee's own there (the binding's offset, never `pinOffset`)
      S[i] = (clearance > thickness ? Math.max(thickness, Math.min(clearance, offset[f] * scale)) : thickness) + (extra ? extra[i] : 0);
    }
    return performance.now() - t0;
  }

  /**
   * Where each slot's particle lies on her NOW, as a binding (`ClothBinding`, in slot order over `slots` particles): the
   * triangle the last `update` found nearest it, as that triangle's three vertex indices, the barycentric place on it,
   * and how far off it the particle stands along its outward normal, body-local units (at least `minOffset`). Pose-free,
   * like any binding: a garment settled on her in one pose is bound where it lies and is carried from there in every
   * other. Call it straight after an `update` with the same `cloth` positions.
   */
  contactBinding(cloth: Float32Array, minOffset = 0): ClothBinding {
    const n = Math.min(this.nSlots, Math.floor(cloth.length / 3)), T = this.tris, W = this.world, order = this.order, cb = this.contactBary;
    const tri = new Uint32Array(n * 3), bary = new Float32Array(n * 3), offset = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const f = order[i], t = this.last[f], f3 = f * 3;
      for (let k = 0; k < 3; k++) tri[i * 3 + k] = T[t * 3 + k];
      let u = this.contactKind[f] === CARRY_WALKED ? cb[f3] : 1 / 3, v = this.contactKind[f] === CARRY_WALKED ? cb[f3 + 1] : 1 / 3, w = 1 - u - v;
      if (!(u >= 0 && v >= 0 && w >= 0)) { u = Math.max(0, u); v = Math.max(0, v); w = Math.max(0, w); const sm = u + v + w || 1; u /= sm; v /= sm; w /= sm; }
      bary[i * 3] = u; bary[i * 3 + 1] = v; bary[i * 3 + 2] = w;
      for (let k = 0; k < 3; k++) { const q = T[t * 3 + k]; if (this.stamp[q] !== this.frame) this.pose(q); }
      const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
      const qx = u * W[a] + v * W[b] + w * W[c], qy = u * W[a + 1] + v * W[b + 1] + w * W[c + 1], qz = u * W[a + 2] + v * W[b + 2] + w * W[c + 2];
      const d = this.normalOf(t) ? (cloth[i * 3] - qx) * this.nx + (cloth[i * 3 + 1] - qy) * this.ny + (cloth[i * 3 + 2] - qz) * this.nz : 0;
      offset[i] = Math.max(minOffset, d / (this.scale || 1));
    }
    return { count: n, tri, bary, offset };
  }

  /**
   * More stand-off for some slots this frame (world units, one a SLOT, as `cloth` and `SkinContacts` are; null for
   * none), along her normal under each. The cloth tee kept clear of her proud navel this way until alpha.120; on a navel's flank that normal leans away
   * from it and the push shoved the cloth off her navel, so the tee now lays a dome along the navel's own axis in place
   * of her skin there instead (`clothShirt.ts`) and leaves this null.
   */
  extraStandOff: Float32Array | null = null;

  /**
   * Body vertex v as she is posed now, world, into out at o: for points the room follows on her (her navel, her
   * nipples). Valid after `update` or `initial` this frame, which read her pose.
   */
  posedVertex(v: number, out: Float32Array | number[], o = 0): void {
    if (this.stamp[v] !== this.frame) this.pose(v);
    const W = this.world;
    out[o] = W[v * 3]; out[o + 1] = W[v * 3 + 1]; out[o + 2] = W[v * 3 + 2];
  }

  // ---------------------------------------------------------------------------------------------------------------

  /** The triangle a binding's vertex triple names: exact, else by welded position, else any touching its corners. */
  private findTriangle(a: number, b: number, c: number): number {
    const { tris, weld, rowStart, rowTri } = this;
    const wa = weld[a], wb = weld[b], wc = weld[c];
    let welded = -1, touching = -1;
    for (let k = rowStart[wa]; k < rowStart[wa + 1]; k++) {
      const t = rowTri[k], x = tris[t * 3], y = tris[t * 3 + 1], z = tris[t * 3 + 2];
      if (sameSet(x, y, z, a, b, c)) return t;
      if (welded < 0 && sameSet(weld[x], weld[y], weld[z], wa, wb, wc)) welded = t;
      if (touching < 0 && (weld[x] === wb || weld[y] === wb || weld[z] === wb || weld[x] === wc || weld[y] === wc || weld[z] === wc)) touching = t;
    }
    if (welded >= 0) return welded;
    if (touching >= 0) return touching;
    for (const w of [wa, wb, wc]) if (rowStart[w + 1] > rowStart[w]) return rowTri[rowStart[w]];
    return 0;
  }

  /** Read her pose for this update: bones, world matrix, which morphs are on, where her positions are. */
  private refresh(): void {
    const m = this.body, g = m.geometry;
    if (++this.frame > 0x3fffffff) { this.stamp.fill(0); this.frame = 1; }
    this.posedCount = 0;

    // positions, read live: her shape sliders write them on the CPU
    const pos = g.getAttribute('position') as Attr;
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
    const sk = m.skeleton;
    this.skinned = !!(this.skinI && sk);
    const mw = m.matrixWorld;
    if (this.skinned) {
      const bones = sk.bones, inv = sk.boneInverses, need = Math.max(bones.length, this.bones.length / 12);
      if (need * 12 > this.bones.length) this.bones = new Float64Array(need * 12);
      const B = this.bones;
      for (let b = 0; b < need; b++) {
        const bone = bones[b], bi = inv[b];
        if (bone && bi) this.m4.multiplyMatrices(bone.matrixWorld, bi).multiply(m.bindMatrix); else this.m4.copy(m.bindMatrix);
        affineRows(this.m4, B, b * 12);
      }
      this.m4b.multiplyMatrices(mw, m.bindMatrixInverse);
      affineRows(this.m4b, this.P, 0);
    } else affineRows(mw, this.P, 0);

    // her root bone's linear map from body-local to world (her hips, as posed): how a rest offset is carried as she moves
    if (this.skinned) {
      const B = this.bones, Q = this.P, L = this.L;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) L[r * 3 + c] = Q[r * 4] * B[c] + Q[r * 4 + 1] * B[4 + c] + Q[r * 4 + 2] * B[8 + c];
    } else { const m = mw.elements; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) this.L[r * 3 + c] = m[c * 4 + r]; }
    const e = mw.elements;
    // body-local units to world: her skinning's own scale where she has bones (her rig carries one of its own, 0.9 on
    // Sarah, that her world matrix alone does not show), her world matrix's otherwise
    if (this.skinned) {
      const B = this.bones, Q = this.P;
      this.scale = Math.hypot(Q[0] * B[0] + Q[1] * B[4] + Q[2] * B[8], Q[4] * B[0] + Q[5] * B[4] + Q[6] * B[8], Q[8] * B[0] + Q[9] * B[4] + Q[10] * B[8]);
    } else this.scale = Math.hypot(e[0], e[1], e[2]);
    const det = e[0] * (e[5] * e[10] - e[9] * e[6]) - e[4] * (e[1] * e[10] - e[9] * e[2]) + e[8] * (e[1] * e[6] - e[5] * e[2]);
    this.sign = det < 0 ? -this.restSign : this.restSign;
  }

  // the last attribute `readerOf` looked at: a Float32 array to index directly, or null for `getX` reads
  private rArr: Float32Array | null = null;
  private rStride = 3;
  private rOff = 0;
  private readerOf(a: Attr): void {
    if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
      const ia = a as THREE.InterleavedBufferAttribute, arr = ia.data.array;
      this.rArr = arr instanceof Float32Array && !ia.normalized ? arr : null; this.rStride = ia.data.stride; this.rOff = ia.offset;
    } else {
      const ba = a as THREE.BufferAttribute, arr = ba.array;
      this.rArr = arr instanceof Float32Array && !ba.normalized ? arr : null; this.rStride = ba.itemSize; this.rOff = 0;
    }
  }

  /**
   * Pose vertex v into `world` and stamp it: morphs, bones, world matrix, as three does. Every caller checks the stamp
   * first (inline, because a frame asks about tens of thousands of corners and poses only the first sight of each).
   */
  private pose(v: number): void {
    this.stamp[v] = this.frame;
    this.posedCount++;
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
    { const bp = this.bindPos, o = v * 3; bp[o] = x; bp[o + 1] = y; bp[o + 2] = z; }
    if (this.skinned) {
      const SI = this.skinI!, SW = this.skinW!, B = this.bones, o4 = v * 4;
      let sx = 0, sy = 0, sz = 0;
      for (let k = 0; k < 4; k++) {
        const w = SW[o4 + k];
        if (w === 0) continue;
        const o = SI[o4 + k] * 12;
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

  /**
   * The closest point of triangle t to (px, py, pz), posed: into qx/qy/qz, with where on the triangle it fell into
   * `reg` and its barycentric weights on corners 1 and 2 into bv/bw (what the next update carries, `contactBary`).
   * Returns the squared distance. Ericson's region test (Real-Time Collision Detection, 5.1.5), with every
   * division guarded so a sliver of her mesh answers with a point rather than NaN.
   */
  private closest(t: number, px: number, py: number, pz: number): number {
    const T = this.tris, i0 = T[t * 3], i1 = T[t * 3 + 1], i2 = T[t * 3 + 2], st = this.stamp, f = this.frame;
    if (st[i0] !== f) this.pose(i0);
    if (st[i1] !== f) this.pose(i1);
    if (st[i2] !== f) this.pose(i2);
    const W = this.world, a = i0 * 3, b = i1 * 3, c = i2 * 3;
    const ax = W[a], ay = W[a + 1], az = W[a + 2];
    const abx = W[b] - ax, aby = W[b + 1] - ay, abz = W[b + 2] - az;
    const acx = W[c] - ax, acy = W[c + 1] - ay, acz = W[c + 2] - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    // (bv, bw): q's barycentric weights on corners 1 and 2, so q = a + bv·ab + bw·ac in every region
    let qx: number, qy: number, qz: number, reg: number, bv = 0, bw = 0;
    if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; reg = CORNER_0; }
    else {
      const bpx = px - W[b], bpy = py - W[b + 1], bpz = pz - W[b + 2];
      const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) { qx = W[b]; qy = W[b + 1]; qz = W[b + 2]; reg = CORNER_1; bv = 1; }
      else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) {
          const den = d1 - d3, s = den > 0 ? d1 / den : 0;
          qx = ax + s * abx; qy = ay + s * aby; qz = az + s * abz; reg = EDGE_01; bv = s;
        } else {
          const cpx = px - W[c], cpy = py - W[c + 1], cpz = pz - W[c + 2];
          const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
          if (d6 >= 0 && d5 <= d6) { qx = W[c]; qy = W[c + 1]; qz = W[c + 2]; reg = CORNER_2; bw = 1; }
          else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) {
              const den = d2 - d6, s = den > 0 ? d2 / den : 0;
              qx = ax + s * acx; qy = ay + s * acy; qz = az + s * acz; reg = EDGE_20; bw = s;
            } else {
              const va = d3 * d6 - d5 * d4, e1 = d4 - d3, e2 = d5 - d6;
              if (va <= 0 && e1 >= 0 && e2 >= 0) {
                const den = e1 + e2, s = den > 0 ? e1 / den : 0;
                qx = W[b] + s * (W[c] - W[b]); qy = W[b + 1] + s * (W[c + 1] - W[b + 1]); qz = W[b + 2] + s * (W[c + 2] - W[b + 2]); reg = EDGE_12;
                bv = 1 - s; bw = s;
              } else {
                const sum = va + vb + vc;
                if (sum > 0) {
                  const v = vb / sum, w = vc / sum;
                  qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w; reg = FACE;
                  bv = v; bw = w;
                } else { qx = ax; qy = ay; qz = az; reg = CORNER_0; }
              }
            }
          }
        }
      }
    }
    this.qx = qx; this.qy = qy; this.qz = qz; this.reg = reg; this.bv = bv; this.bw = bw;
    const dx = px - qx, dy = py - qy, dz = pz - qz;
    return dx * dx + dy * dy + dz * dz;
  }

  /** Triangle t's outward unit normal as posed, into nx/ny/nz; false (and zero) for a triangle with no area. Its corners
   * must already be posed this update. */
  private normalOf(t: number): boolean {
    const T = this.tris, W = this.world, a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const ux = W[b] - W[a], uy = W[b + 1] - W[a + 1], uz = W[b + 2] - W[a + 2];
    const vx = W[c] - W[a], vy = W[c + 1] - W[a + 1], vz = W[c + 2] - W[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (!(len > 0)) { this.nx = this.ny = this.nz = 0; return false; }
    const s = this.sign / len;
    this.nx = cx * s; this.ny = cy * s; this.nz = cz * s;
    return true;
  }

  /**
   * Binding particle p's pin into `out` at o (its SLOT's place, slot × 3; p indexes everything else): its three bound
   * vertices, posed, blended by its bary (left in sx/sy/sz) plus its rest offset -- `pinOffset[p]` where that is set,
   * else the binding's -- scaled to world, along the bound triangle's normal (left in nx/ny/nz). False when that
   * triangle has no area this frame, and then the pin is the bare skin point.
   */
  private pinOf(p: number, out: Float32Array, o: number): boolean {
    const bt = this.binding.tri, bb = this.binding.bary, p3 = p * 3, st = this.stamp, f = this.frame;
    const a = bt[p3], b = bt[p3 + 1], c = bt[p3 + 2];
    if (st[a] !== f) this.pose(a);
    if (st[b] !== f) this.pose(b);
    if (st[c] !== f) this.pose(c);
    const W = this.world, u = bb[p3], v = bb[p3 + 1], w = bb[p3 + 2];
    const x = this.sx = u * W[a * 3] + v * W[b * 3] + w * W[c * 3];
    const y = this.sy = u * W[a * 3 + 1] + v * W[b * 3 + 1] + w * W[c * 3 + 1];
    const z = this.sz = u * W[a * 3 + 2] + v * W[b * 3 + 2] + w * W[c * 3 + 2];
    const t = this.bound[p];
    if (!this.exact[p]) {
      const T = this.tris;
      for (let k = 0; k < 3; k++) { const q = T[t * 3 + k]; if (st[q] !== f) this.pose(q); }
    }
    const ok = this.normalOf(t);
    // the pin's rest offset, body-local: the room's own (`pinOffset`, a hug for a fresh neckline) or the made tee's
    const rest = (this.pinOffsetArr ?? this.binding.offset)[p];
    if (!this.skinned || !this.skinI || !this.skinW) {
      const off = ok ? rest * this.scale : 0;
      out[o] = x + this.nx * off; out[o + 1] = y + this.ny * off; out[o + 2] = z + this.nz * off;
      return ok;
    }
    // Its own place in her shape now, before her bones: its bound skin point, out by its offset along her normal there
    // (her own space, as restShape lays the pattern); then SKINNED, by the bones of its triangle's three corners
    // blended by where on the triangle it is -- as a garment's own vertex is skinned. Laid on her posed skin instead
    // (the posed point, out along the posed normal), a particle off her skin by a sleeve's or a shoulder's width was
    // carried by triangles her shoulder folds and shears when her arms come forward, and the cloth there was laid
    // crumpled and held crumpled by its pins: torn-looking sleeves and neckline whenever she sat (Joshua, 2026-10-24:
    // "around the top and sleeves, it's all messed up and jagged looking like something ripped it").
    const Bp = this.bindPos, a3 = a * 3, b3 = b * 3, c3 = c * 3;
    // her normal from the bound triangle's own corners, in its own winding (the file may name them in any order)
    const T = this.tris, t0 = T[t * 3] * 3, t1 = T[t * 3 + 1] * 3, t2 = T[t * 3 + 2] * 3;
    const ex = Bp[t1] - Bp[t0], ey = Bp[t1 + 1] - Bp[t0 + 1], ez = Bp[t1 + 2] - Bp[t0 + 2];
    const fx = Bp[t2] - Bp[t0], fy = Bp[t2 + 1] - Bp[t0 + 1], fz = Bp[t2 + 2] - Bp[t0 + 2];
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    const nl = Math.hypot(nx, ny, nz), k = nl > 0 ? this.restSign / nl : 0, off = rest;
    nx *= k; ny *= k; nz *= k;
    const px = u * Bp[a3] + v * Bp[b3] + w * Bp[c3] + nx * off;
    const py = u * Bp[a3 + 1] + v * Bp[b3 + 1] + w * Bp[c3 + 1] + ny * off;
    const pz = u * Bp[a3 + 2] + v * Bp[b3 + 2] + w * Bp[c3 + 2] + nz * off;
    const SI = this.skinI, SW = this.skinW, B = this.bones;
    let sx = 0, sy = 0, sz = 0;
    for (let corner = 0; corner < 3; corner++) {
      const cv = corner === 0 ? a : corner === 1 ? b : c, share = corner === 0 ? u : corner === 1 ? v : w, o4 = cv * 4;
      if (share === 0) continue;
      for (let j = 0; j < 4; j++) {
        const wt = SW[o4 + j] * share;
        if (wt === 0) continue;
        const r = SI[o4 + j] * 12;
        sx += wt * (B[r] * px + B[r + 1] * py + B[r + 2] * pz + B[r + 3]);
        sy += wt * (B[r + 4] * px + B[r + 5] * py + B[r + 6] * pz + B[r + 7]);
        sz += wt * (B[r + 8] * px + B[r + 9] * py + B[r + 10] * pz + B[r + 11]);
      }
    }
    const P = this.P;
    out[o] = P[0] * sx + P[1] * sy + P[2] * sz + P[3];
    out[o + 1] = P[4] * sx + P[5] * sy + P[6] * sz + P[7];
    out[o + 2] = P[8] * sx + P[9] * sy + P[10] * sz + P[11];
    return ok;
  }
}

/** A contact on a triangle with no area keeps the particle's last normal, or +y if it never had one. */
function keepNormal(N: Float32Array, o: number): void {
  if (N[o] * N[o] + N[o + 1] * N[o + 1] + N[o + 2] * N[o + 2] > 0.25) return;
  N[o] = 0; N[o + 1] = 1; N[o + 2] = 0;
}

/**
 * Compact ids for vertices welded by rest position: any two within `eps` on every axis are one point (and so,
 * transitively, are chains of them). A sweep along `sweep` (x; +Infinity for a vertex that is not finite, which keeps
 * its own id) over the vertices sorted by it, uniting every close pair -- so two copies of a point can never fall either
 * side of a cell boundary, which is how a rounded grid splits a seam lying on the grid's middle line.
 */
function weldByPosition(rest: Float64Array, sweep: Float64Array, eps: number): Uint32Array {
  const n = sweep.length, order = new Uint32Array(n), parent = new Uint32Array(n);
  for (let i = 0; i < n; i++) { order[i] = i; parent[i] = i; }
  order.sort((a, b) => (sweep[a] < sweep[b] ? -1 : sweep[a] > sweep[b] ? 1 : 0));
  const e = eps > 0 && Number.isFinite(eps) ? eps : 0;
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let s = 0; s < n; s++) {
    const i = order[s], xi = sweep[i];
    if (xi === Infinity) break;
    const yi = rest[i * 3 + 1], zi = rest[i * 3 + 2];
    for (let r = s + 1; r < n; r++) {
      const j = order[r];
      if (sweep[j] - xi > e) break;
      if (Math.abs(rest[j * 3 + 1] - yi) <= e && Math.abs(rest[j * 3 + 2] - zi) <= e) {
        const a = find(i), b = find(j);
        if (a !== b) { if (a < b) parent[b] = a; else parent[a] = b; }
      }
    }
  }
  const id = new Uint32Array(n), compact = new Int32Array(n).fill(-1);
  let k = 0;
  for (let v = 0; v < n; v++) { const r = find(v); if (compact[r] < 0) compact[r] = k++; id[v] = compact[r]; }
  return id;
}

/** Whether {x, y, z} and {a, b, c} are the same three numbers, in any order. */
function sameSet(x: number, y: number, z: number, a: number, b: number, c: number): boolean {
  return (x === a && ((y === b && z === c) || (y === c && z === b))) || (x === b && ((y === a && z === c) || (y === c && z === a))) || (x === c && ((y === a && z === b) || (y === b && z === a)));
}

/** A matrix's affine part as three rows of four, into `out` at `o`. */
function affineRows(m: THREE.Matrix4, out: Float64Array, o: number): void {
  const e = m.elements;
  out[o] = e[0]; out[o + 1] = e[4]; out[o + 2] = e[8]; out[o + 3] = e[12];
  out[o + 4] = e[1]; out[o + 5] = e[5]; out[o + 6] = e[9]; out[o + 7] = e[13];
  out[o + 8] = e[2]; out[o + 9] = e[6]; out[o + 10] = e[10]; out[o + 11] = e[14];
}

/**
 * Her arms, the same on both sides (Joshua, 2026-10-25: "on the current shirt, the only place messed up is the model's
 * right arm area… the left is fine"). Her skin weights are not symmetric: behind her right armpit and over the front of
 * her right shoulder, skin that is her trunk on the left is carried by the arm (about 300 vertices more on the right).
 * The tee's particles bound there were taken for SLEEVE on that side alone, so they met her arm and stood out round it
 * behind her right armpit as a torn flap, while on the left the same cloth lies against her trunk under her arm.
 * So an arm vertex whose mirror image is trunk, where the two really are mirror images (within about 2 cm, since her
 * mesh is itself not quite symmetric), is trunk too: the rule the outfit's body map already follows for the same
 * weights (`bodyRegions.ts`, a tank's strap, 2026-10-21). Mirror pairs are not always mutual on a mesh, so a few passes.
 * The midline is the middle of her widest reach (her hands), which her symmetric pose centres.
 */
export function symmetricArms(armVertex: Uint8Array, position: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number }): number {
  const n = Math.min(armVertex.length, position.count), P = new Float32Array(n * 3);
  let lo = Infinity, hi = -Infinity, bottom = Infinity, top = -Infinity;
  for (let v = 0; v < n; v++) {
    const x = position.getX(v), y = position.getY(v);
    P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = position.getZ(v);
    lo = Math.min(lo, x); hi = Math.max(hi, x); bottom = Math.min(bottom, y); top = Math.max(top, y);
  }
  const mid = (lo + hi) / 2, near = (top - bottom) * 0.012, mirror = mirrorIndex(P, mid);
  let made = 0;
  for (let pass = 0, changed = true; changed && pass < 4; pass++) {
    changed = false;
    const was = armVertex.slice();
    for (let v = 0; v < n; v++) {
      const m = mirror[v];
      if (!was[v] || m < 0 || was[m]) continue;
      if (Math.hypot(P[m * 3] - (2 * mid - P[v * 3]), P[m * 3 + 1] - P[v * 3 + 1], P[m * 3 + 2] - P[v * 3 + 2]) <= near) { armVertex[v] = 0; changed = true; made++; }
    }
  }
  return made;
}
