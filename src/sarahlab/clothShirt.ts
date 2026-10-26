/**
 * THE LIGHT TEE AS CLOTH, IN THE ROOM (Joshua, 2026-10-23: "create another copy of that same shirt, but make that one a
 * true soft body/cloth with simulation over the whole thing and I want to be able to see how much or little having a
 * full soft body cloth fabric would be"; and "let's also allow the shirt length to be adjustable… with where it's set
 * as 0% and make 100% at mid-thigh").
 *
 * The cloth file (`public/models/sarah-v2-spandex-cloth.glb`, `scripts/sarahV2Recovery/shirt-cloth.mjs`) is one sheet:
 * the light tee's outer layer, then rows below its hem to mid-thigh. This puts it on her:
 * - `clothSkin.ts` finds her posed skin under every particle each frame, `clothSim.ts` moves the particles, and the
 *   sheet is drawn where they are, in WORLD space (it is not skinned: the simulation is its pose).
 * - LENGTH is how many of the rows below the hem are cloth: 0 the tee as made, 1 every row to mid-thigh. Rows past it
 *   are not simulated, not posed against her and not drawn, so a short tee costs what a short tee should.
 * - NECKLINE (Joshua, 2026-10-24: "can the neckline also be adjustable like the length so you can do U/V shape and select
 *   how deep up to turtleneck? I would set the deepest/lowest point between the breasts and top belly") is one dial
 *   from -1 to 1. Below 0 it shows the COLLAR, rows of cloth the file carries above the neckline up her neck, a share of
 *   them as LENGTH shows the rows below the hem: halfway is about a crew neck, -1 a turtleneck. Above 0 it cuts the
 *   tee's front deeper than made, in a U or a V, to her breasts' lower crease at 1. What is shown is drawn with a
 *   smooth edge by the material (`clothNeckline.ts`, from each particle's `_NECK` depths); what is not is not simulated
 *   either, and the edge it leaves is held to her the way the neckline as made is -- so a deep V lies down on her
 *   between her breasts instead of hanging where the whole tee bridged them.
 * - So the cloth's particles are switched in and out three ways at once (the hem's rows, the collar's, the front), and
 *   the set that is simulated is no longer the first n of the file. The simulation runs them packed into SLOTS: slot i
 *   is file particle `order[i]` (and `ClothSkin.setOrder` is told the same); everything that belongs to a particle --
 *   its pattern, its anchor, its pin in the file -- stays in file order.
 * - It wears the fitted light tee's own MATERIAL (the room's fabric and dye on it), with the fabric laid by its rest
 *   shape as the fitted tee's is, so the two look alike and only the cloth's behaviour differs.
 * - Every frame's cost is measured: the skin search, the simulation, and the drawing buffers, in milliseconds.
 */
import * as THREE from 'three';
import { ClothSim, type ClothSettings } from './clothSim';
import { ClothSkin } from './clothSkin';
import { copyContacts, createContacts, type ClothBinding, type SkinContacts } from './clothTypes';
import type { ClothDetailState } from './clothDetail';
import { CLOTH_NECKLINE_ATTRIBUTE, clothNecklineBelow, type ClothNecklineState } from './clothNeckline';
import { DETAIL_LOOK, DetailSpots, type DetailPoints, type Posed } from './detailSpots';

export interface ClothShirtStats {
  /** Milliseconds this frame, smoothed: finding her skin under the cloth, moving the cloth, writing it for drawing. */
  readonly skinMs: number;
  readonly simMs: number;
  readonly drawMs: number;
  /** Particles moving, of all the file holds. */
  readonly particles: number;
  readonly allParticles: number;
  /** Body vertices posed on the CPU this frame. */
  readonly posed: number;
  readonly substeps: number;
  /** Particles touching her skin. */
  readonly contacts: number;
}

/**
 * How far off her skin the cloth's particles keep, world units (2.5 mm): more than the fabric's own 1.5 mm, because her
 * skin between particles (a centimetre apart) is not felt, and at 1.5 mm her nipples and navel came up through the
 * triangles between them.
 */
export const CLOTH_STAND_OFF = 0.25;
/** World units (6 mm): the most of the fitted tee's own clearance off her a particle keeps (ClothSkinOptions.restClearance). */
const REST_CLEARANCE = 0.6;
/** After the cloth is laid, this long (seconds) at no less than this damping (per second). */
const WARM_SECONDS = 0.4, WARM_DAMPING = 25;
/** How far a dome's top stands above her detail's tip, world units (0.5 mm): the cloth is flat between its particles. */
const DOME_MARGIN = 0.05;
/** World units (4 cm): a bound place moving further than this in one frame is a jump, not motion. */
const JUMP = 4;
/** How quickly the shown milliseconds follow the frame's (an exponential mean over about this many frames). */
const SMOOTHING = 20;
/**
 * How much the hem weighs against the cloth above it, a particle for a particle. A tee's hem is turned up and stitched,
 * and its weight is what hangs the tee straight. (The first cloth file kept every point of the modelled tee's fold at
 * its hem, 327 of them, and weighed it so by accident; its hem now has the cloth's own spacing, about a quarter as many
 * points, and this gives it its weight back.)
 */
const HEM_MASS = 3.5;
/** Taubin passes over the navel zone of the pattern (each a smoothing and an un-shrinking step). */
const NAVEL_SMOOTHING = 12;
/** Kept here for anything that read it from the cloth: the numbers live with her details now. */
export { DETAIL_LOOK } from './detailSpots';
/** Metres (the file's own, for a file that does not say): a cut edge is held fully within the first, not past the second, as the neckline as made is. */
const EDGE_HOLD = [0.012, 0.03] as const;
/** A depth no front neckline reaches, metres (the file's NECK_FAR, for a file without the neckline). */
const NECK_FAR = 9;

/** The cloth file's collar (`shirt-cloth.mjs`): its first particle, rows of `columns`, the neckline it rises from, its mean height (metres). */
interface CollarInfo { readonly start: number; readonly rows: number; readonly columns: number; readonly neck: readonly number[]; readonly lengthM: number }
/** The cloth file's front neckline: how deep the deepest cut is (metres, to her breasts' lower crease). */
interface NecklineInfo { readonly deepestM: number; readonly farM?: number }
/** Which particles are simulated, in which slots, and how each is held. */
interface Layout { readonly order: Uint32Array; readonly pin: Float32Array; readonly tris: number[] }

export class ClothShirt {
  readonly mesh: THREE.Mesh;
  private readonly skin: ClothSkin;
  private sim: ClothSim;
  private readonly settings: Partial<ClothSettings>;
  private readonly count: number;
  private readonly teeParticles: number;
  private readonly columns: number;
  readonly rows: number;
  private readonly pin: Float32Array;
  /** The point of the hem each particle below it hangs from (itself for the tee's own). */
  private readonly anchor: Uint32Array;
  /** Every particle's place in the file (body-local, her approved body at 100%): the rows below the hem keep this pattern. */
  private readonly filed: Float32Array;
  /** The tee's own hem, its lowest open edge: the hem while no row below it is worn. */
  private readonly teeHem: Uint32Array;
  /** How much each particle is in her navel's zone (0 to 1), and the tee's particles' neighbours, for smoothing it. */
  private readonly navelZone: Float32Array;
  private readonly zone: Uint32Array;
  private readonly neighbourStart: Uint32Array;
  private readonly neighbourList: Uint32Array;
  /** Her navel and nipples on her body (null for an older file without them), and as posed this frame. */
  /** Her navel and nipples, followed on her each frame (null for an older file that does not name them). */
  private readonly spots: DetailSpots | null;
  /** BREAST and NAVEL DETAIL (0 hidden, 1 all of it): how the cloth lies over her details, set by the room. */
  keep: { nipple: number; navel: number } = { nipple: 0.45, navel: 0.8 };
  private readonly lift: Float32Array;
  /** Her skin under each particle last frame, as `ClothSkin` found it (before a dome stood in for it): friction's reference. */
  private readonly lastSkin: Float32Array;
  /** Each render vertex's particle. */
  private readonly vertexParticle: Uint32Array;
  /**
   * Every triangle of the file: its three particles and its three render vertices (file order), the lowest row below
   * the hem it reaches (0 for none), and whether it is the collar's.
   */
  private readonly triParticle: Uint32Array;
  private readonly triVertex: Uint32Array;
  private readonly triRow: Uint16Array;
  private readonly triCollar: Uint8Array;
  /** The drawn triangles (render vertices), rewritten whenever what is shown changes; drawn up to the count shown. */
  private readonly index: THREE.BufferAttribute;
  private readonly position: THREE.BufferAttribute;
  private readonly normal: THREE.BufferAttribute;
  private before: SkinContacts;
  private after: SkinContacts;
  private primed = false;
  /** Seconds of settling calm left after the cloth was laid. */
  private warm = 0;
  /** Particles simulated, in their slots: slot i is file particle order[i]; slotOf[p] is p's slot, -1 for none. */
  private order = new Uint32Array(0);
  private slotOf: Int32Array;
  private active = 0;
  /** How each slot is held, as the simulation was last built. */
  private pinNow = new Float32Array(0);
  private readonly scratch: Float32Array;
  /** The pattern now (world-sized, file order): her shape's, from `refit`, or the fitted tee's at first. */
  private readonly restNow: Float32Array;
  /** The same, by slot, as the simulation has it. */
  private readonly restSlot: Float32Array;
  private readonly shown = { skinMs: 0, simMs: 0, drawMs: 0, posed: 0, substeps: 0, contacts: 0 };

  // --- what is shown: the rows below the hem, the collar, the front ---
  /** Rows below the hem worn (TEE LENGTH). */
  private hemRows = 0;
  /** NECKLINE: -1 the whole collar (a turtleneck), 0 as made, 1 the front cut to its deepest; and the cut's shape. */
  private neckValue = 0;
  private neckShape: 'U' | 'V' = 'U';
  /**
   * Per particle (file order), four each, as the file's `_NECK` (clothNeckline.ts): how far below the U's and the V's
   * line as made it stands (metres), its u across the neckline, and its share of the collar's height.
   */
  private readonly neck: Float32Array;
  /** Body-local units to metres, for measuring along the cloth. */
  private readonly toMetres: number;
  private readonly collar: CollarInfo | null;
  /** The first collar particle (the count, for a file without one): the rows below the hem run from teeParticles to it. */
  private readonly collarStart: number;
  private readonly deepest: number;
  private readonly edgeHold: readonly [number, number];
  /** Each particle's pin offset for `ClothSkin.pinOffset` (body-local): its own, or a cut edge's hug. */
  private readonly hug: Float32Array;
  private readonly bindOffset: Float32Array;

  constructor(source: THREE.Mesh, body: THREE.SkinnedMesh, material: THREE.Material | THREE.Material[], settings: Partial<ClothSettings> = {}, thickness = CLOTH_STAND_OFF) {
    const g = source.geometry, info = (source.userData.cloth ?? {}) as { teeParticles?: number; rows?: number; columns?: number; armBones?: number[]; detail?: DetailPoints; collar?: CollarInfo; neckline?: NecklineInfo; pinIn?: number; pinOut?: number; localToMetres?: number };
    const read = (name: string) => g.getAttribute(name) as THREE.BufferAttribute;
    const particleAttr = read('_particle'), restAttr = read('position'), triAttr = read('_body_tri'), baryAttr = read('_body_bary');
    const offsetAttr = read('_offset'), pinAttr = read('_pin'), rowAttr = read('_row'), anchorAttr = read('_anchor'), uvAttr = read('uv'), navelAttr = read('_navel'), neckAttr = read('_neck');
    if (!particleAttr || !triAttr || !baryAttr || !offsetAttr || !pinAttr || !rowAttr) throw new Error('ClothShirt: the cloth file is missing its particle data');
    const nV = restAttr.count;
    this.vertexParticle = new Uint32Array(nV);
    let count = 0;
    for (let v = 0; v < nV; v++) { const p = Math.round(particleAttr.getX(v)); this.vertexParticle[v] = p; count = Math.max(count, p + 1); }
    this.count = count;
    this.teeParticles = info.teeParticles ?? count;
    this.rows = info.rows ?? 0;
    this.columns = info.columns ?? 0;
    // per particle, from any of its vertices
    const tri = new Uint32Array(count * 3), bary = new Float32Array(count * 3), offset = new Float32Array(count), pin = new Float32Array(count), row = new Uint16Array(count), anchor = new Uint32Array(count);
    const filed = new Float32Array(count * 3), navelZone = new Float32Array(count), neck = new Float32Array(count * 4);
    for (let p = 0; p < count; p++) { neck[p * 4] = NECK_FAR; neck[p * 4 + 1] = NECK_FAR; }
    const necked = neckAttr && neckAttr.itemSize === 4 ? neckAttr : null;
    for (let v = 0; v < nV; v++) {
      const p = this.vertexParticle[v];
      tri[p * 3] = triAttr.getX(v); tri[p * 3 + 1] = triAttr.getY(v); tri[p * 3 + 2] = triAttr.getZ(v);
      bary[p * 3] = baryAttr.getX(v); bary[p * 3 + 1] = baryAttr.getY(v); bary[p * 3 + 2] = baryAttr.getZ(v);
      filed[p * 3] = restAttr.getX(v); filed[p * 3 + 1] = restAttr.getY(v); filed[p * 3 + 2] = restAttr.getZ(v);
      offset[p] = offsetAttr.getX(v); pin[p] = pinAttr.getX(v); row[p] = Math.round(rowAttr.getX(v)); anchor[p] = anchorAttr ? Math.round(anchorAttr.getX(v)) : p;
      if (navelAttr) navelZone[p] = navelAttr.getX(v);
      if (necked) { neck[p * 4] = necked.getX(v); neck[p * 4 + 1] = necked.getY(v); neck[p * 4 + 2] = necked.getZ(v); neck[p * 4 + 3] = necked.getW(v); }
    }
    this.pin = pin; this.anchor = anchor; this.filed = filed; this.navelZone = navelZone; this.neck = neck;
    // the collar and the deeper front, where the file carries them (an older file: neither, and NECKLINE does nothing)
    const collar = necked && info.collar && info.collar.rows > 0 && info.collar.start + info.collar.rows * info.collar.columns === count ? info.collar : null;
    this.collar = collar;
    this.collarStart = collar ? collar.start : count;
    this.deepest = necked && info.neckline && info.neckline.deepestM > 0 ? info.neckline.deepestM : 0;
    this.edgeHold = [info.pinIn ?? EDGE_HOLD[0], info.pinOut ?? EDGE_HOLD[1]];
    this.toMetres = info.localToMetres ?? 0.9;
    this.bindOffset = offset;
    this.slotOf = new Int32Array(count).fill(-1);
    this.restSlot = new Float32Array(count * 3);
    this.below = new Float32Array(count).fill(NECK_FAR);
    this.spots = info.detail && info.detail.navel >= 0 ? new DetailSpots(info.detail) : null;
    this.lift = new Float32Array(count);
    this.lastSkin = new Float32Array(count * 3);
    // the tee's particles' neighbours (across its triangles), and which are in her navel's zone
    {
      const index = g.index!, sets: Set<number>[] = Array.from({ length: this.teeParticles }, () => new Set<number>());
      for (let t = 0; t < index.count; t += 3) {
        const a = this.vertexParticle[index.getX(t)], b = this.vertexParticle[index.getX(t + 1)], c = this.vertexParticle[index.getX(t + 2)];
        if (a >= this.teeParticles || b >= this.teeParticles || c >= this.teeParticles) continue;
        sets[a].add(b).add(c); sets[b].add(a).add(c); sets[c].add(a).add(b);
      }
      this.neighbourStart = new Uint32Array(this.teeParticles + 1);
      for (let p = 0; p < this.teeParticles; p++) this.neighbourStart[p + 1] = this.neighbourStart[p] + sets[p].size;
      this.neighbourList = new Uint32Array(this.neighbourStart[this.teeParticles]);
      for (let p = 0; p < this.teeParticles; p++) this.neighbourList.set([...sets[p]], this.neighbourStart[p]);
      this.zone = Uint32Array.from({ length: this.teeParticles }, (_, p) => p).filter((p) => navelZone[p] > 0);
      // the tee's own navel impression, out of how far it keeps off her too: the zone stands off her as the cloth
      // round it does
      let sum = 0, n = 0;
      for (const p of this.zone) if (navelZone[p] < 0.25) { sum += offset[p]; n++; }
      if (n) for (const p of this.zone) offset[p] += (sum / n - offset[p]) * navelZone[p];
    }
    const binding: ClothBinding = { count, tri, bary, offset };
    this.skin = new ClothSkin(body, binding, { armBones: info.armBones ?? [], thickness, restClearance: REST_CLEARANCE });
    this.settings = settings;
    this.hug = offset.slice();

    // every triangle: its particles, its render vertices, the lowest row below the hem it reaches, and whether it is
    // the collar's
    const index = g.index!, nT = index.count / 3, vp = this.vertexParticle;
    this.triParticle = new Uint32Array(nT * 3); this.triVertex = new Uint32Array(nT * 3); this.triRow = new Uint16Array(nT); this.triCollar = new Uint8Array(nT);
    for (let t = 0; t < nT; t++) {
      let r = 0, c = 0;
      for (let k = 0; k < 3; k++) {
        const v = index.getX(t * 3 + k), p = vp[v];
        this.triVertex[t * 3 + k] = v; this.triParticle[t * 3 + k] = p;
        r = Math.max(r, row[p]); if (p >= this.collarStart) c = 1;
      }
      this.triRow[t] = r; this.triCollar[t] = c;
    }
    // the tee's own hem: of its open edges, the lowest (its neckline and sleeves are the others)
    {
      const use = new Map<number, number>(), next = new Map<number, number>(), key = (a: number, b: number) => (a < b ? a * count + b : b * count + a);
      const own: number[] = [];
      for (let t = 0; t < nT; t++) if (this.triRow[t] === 0 && !this.triCollar[t]) own.push(this.triParticle[t * 3], this.triParticle[t * 3 + 1], this.triParticle[t * 3 + 2]);
      const teeTris = Uint32Array.from(own);
      for (let t = 0; t < teeTris.length; t += 3) for (let e = 0; e < 3; e++) { const k = key(teeTris[t + e], teeTris[t + (e + 1) % 3]); use.set(k, (use.get(k) ?? 0) + 1); }
      for (let t = 0; t < teeTris.length; t += 3) for (let e = 0; e < 3; e++) { const a = teeTris[t + e], b = teeTris[t + (e + 1) % 3]; if (use.get(key(a, b)) === 1) next.set(a, b); }
      const seen = new Set<number>();
      let lowest = Infinity, hem: number[] = [];
      for (const s0 of next.keys()) {
        if (seen.has(s0)) continue;
        const loop: number[] = [];
        for (let v: number | undefined = s0; v !== undefined && !seen.has(v); v = next.get(v)) { seen.add(v); loop.push(v); }
        const y = loop.reduce((m, p) => m + filed[p * 3 + 1], 0) / loop.length;
        if (loop.length >= 12 && y < lowest) { lowest = y; hem = loop; }
      }
      this.teeHem = Uint32Array.from(hem);
    }

    // the sheet as drawn: world positions written every frame; the fabric laid by its rest shape, as the fitted tee's is
    const geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(nV * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.normal = new THREE.BufferAttribute(new Float32Array(nV * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('normal', this.normal);
    if (uvAttr) geometry.setAttribute('uv', uvAttr.clone());
    // the neckline's depths and the collar's share, for the material's smooth cut edge (clothNeckline.ts)
    {
      const n = new Float32Array(nV * 4);
      for (let v = 0; v < nV; v++) { const p = vp[v]; for (let c = 0; c < 4; c++) n[v * 4 + c] = neck[p * 4 + c]; }
      geometry.setAttribute(CLOTH_NECKLINE_ATTRIBUTE, new THREE.BufferAttribute(n, 4));
    }
    this.index = new THREE.BufferAttribute(new Uint32Array(nT * 3), 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setIndex(this.index);
    // the fabric is laid by the tee as made, the collar with it but not across it: the neckline's rest normals are the
    // tee's own, as they were before the file had a collar
    const restGeometry = new THREE.BufferGeometry();
    restGeometry.setAttribute('position', restAttr.clone());
    { const own: number[] = []; for (let t = 0; t < nT; t++) if (!this.triCollar[t]) own.push(this.triVertex[t * 3], this.triVertex[t * 3 + 1], this.triVertex[t * 3 + 2]); restGeometry.setIndex(own); }
    restGeometry.computeVertexNormals();
    // ...and the collar's own vertices from its own triangles
    {
      const own: number[] = []; for (let t = 0; t < nT; t++) if (this.triCollar[t]) own.push(this.triVertex[t * 3], this.triVertex[t * 3 + 1], this.triVertex[t * 3 + 2]);
      if (own.length) {
        const cg = new THREE.BufferGeometry(); cg.setAttribute('position', restAttr.clone()); cg.setIndex(own); cg.computeVertexNormals();
        const cn = cg.getAttribute('normal'), rn = restGeometry.getAttribute('normal') as THREE.BufferAttribute;
        for (let v = 0; v < nV; v++) if (vp[v] >= this.collarStart) rn.setXYZ(v, cn.getX(v), cn.getY(v), cn.getZ(v));
        cg.dispose();
      }
    }
    geometry.setAttribute('fabricRest', restAttr.clone());
    geometry.setAttribute('fabricRestNormal', restGeometry.getAttribute('normal').clone());
    restGeometry.dispose();
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'sarah-cloth-tee';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;

    this.before = createContacts(count); this.after = createContacts(count);
    this.scratch = new Float32Array(count * 3);
    // her pose now places every particle; the simulation starts from there, cut for her shape now
    this.restNow = new Float32Array(count * 3);
    this.pattern(this.restNow);
    this.sim = this.relayout(null)!;
  }

  /** 0 the tee as made, 1 every row to mid-thigh. */
  setLength(length: number): void {
    const rows = Math.max(0, Math.min(this.rows, Math.round((Number.isFinite(length) ? length : 0) * this.rows)));
    if (rows === this.hemRows) return;
    this.hemRows = rows; this.laidOut = false;
  }

  /**
   * NECKLINE: -1 the whole collar (a turtleneck), 0 the neckline as made, 1 the front cut to its deepest (her breasts'
   * lower crease), in a U or a V. A file without the collar or the cut does nothing with it.
   */
  setNeckline(value: number, shape: 'U' | 'V'): void {
    const v = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
    if (v === this.neckValue && shape === this.neckShape) return;
    this.neckValue = v; this.neckShape = shape; this.laidOut = false;
  }
  /**
   * False when TEE LENGTH or NECKLINE has changed since the cloth was last laid out: the next frame lays it out again,
   * once however many times a slider moved in between (a new layout builds a new simulation, a few milliseconds on a
   * phone, and a dragged slider can say a dozen things a frame).
   */
  private laidOut = true;
  /** Lay the cloth out now if a setting has changed it (`frame` does this itself). */
  layOut(): void {
    if (this.laidOut) return;
    this.laidOut = true;
    const sim = this.relayout(this.sim);
    if (sim) this.sim = sim;
  }
  /** The collar's share shown (0 to 1), and how deep the front is cut (metres), as NECKLINE now stands. */
  private get collarShare(): number { return this.collar ? Math.max(0, -this.neckValue) : 0; }
  private get cutDepth(): number { return Math.max(0, this.neckValue) * this.deepest; }
  /** What the material cuts this frame (clothNeckline.ts), or null for a file that carries no neckline. */
  neckline(): ClothNecklineState | null {
    return this.collar || this.deepest > 0 ? { collar: this.collarShare, depth: this.cutDepth, shape: this.neckShape } : null;
  }
  /** Metres: how far below the neckline as made NECKLINE's deepest cut reaches (0 for a file without it). */
  get necklineDeepest(): number { return this.deepest; }
  /** Whether the file carries the collar (NECKLINE's turtleneck side). */
  get hasCollar(): boolean { return !!this.collar; }

  /**
   * Cut the tee again for her as she is shaped now (her belly, her shape sliders; never her pose): its pattern from her
   * bound places on her morphed, unposed body (`ClothSkin.restShape`), so a 200% bump wears a tee made for it -- as a
   * maternity tee is -- instead of a 100% tee riding up over it, and a 0% one is not a sack.
   */
  refit(): void {
    this.pattern(this.restNow);
    this.gather(this.restNow, this.restSlot);
    this.sim.setRest(this.restSlot.subarray(0, this.active * 3));
  }
  /** File-ordered values (count × 3) into slot order (this.order). */
  private gather(file: Float32Array, out: Float32Array): void {
    const o = this.order;
    for (let i = 0; i < o.length; i++) { const p = o[i] * 3, q = i * 3; out[q] = file[p]; out[q + 1] = file[p + 1]; out[q + 2] = file[p + 2]; }
  }

  /**
   * The pattern for her as she is shaped now (world-sized, unposed): the tee's own particles from her skin under them
   * (`ClothSkin.restShape`); every row below the hem hung from its point of the hem by its place in the FILE, not from
   * her skin under it. Those rows stand up to 12 cm off her thighs, bound to small triangles far away, and a place
   * carried out that far by a triangle amplifies any change in her shape: on her left side the rows came out as a flag.
   */
  private pattern(out: Float32Array): void {
    this.skin.restShape(out);
    // her navel's zone smoothed flat: the modelled tee's own navel impression is not a navel of hers (Joshua,
    // 2026-10-24: "the bottom for some reason is fixed on the shirt and it shouldn't be"); hers shows through instead
    // (`frame`, and the shading in clothDetail.ts). Taubin's two steps, so the belly's curve is not shrunk with it.
    const Z = this.zone, W = this.navelZone, S0 = this.neighbourStart, L = this.neighbourList;
    if (Z.length) {
      const was = new Float32Array(Z.length * 3);
      for (let pass = 0; pass < NAVEL_SMOOTHING; pass++) for (const k of [0.5, -0.53]) {
        Z.forEach((p, i) => { for (let c = 0; c < 3; c++) was[i * 3 + c] = out[p * 3 + c]; });
        Z.forEach((p, i) => {
          const from = S0[p], to = S0[p + 1];
          if (to === from) return;
          for (let c = 0; c < 3; c++) {
            let m = 0; for (let j = from; j < to; j++) m += out[L[j] * 3 + c];
            m /= to - from;
            out[p * 3 + c] = was[i * 3 + c] + k * W[p] * (m - was[i * 3 + c]);
          }
        });
      }
    }
    // (the collar lies on her neck and shoulders, where her skin under it is close: it is bound to her like the tee)
    const F = this.filed, A = this.anchor, s = this.skin.worldScale || 1;
    for (let p = this.teeParticles; p < this.collarStart; p++) {
      const a = A[p];
      for (let k = 0; k < 3; k++) out[p * 3 + k] = out[a * 3 + k] + (F[p * 3 + k] - F[a * 3 + k]) * s;
    }
  }

  /**
   * Her navel and nipples as she is posed and shaped this frame (`Posed`), and the cloth over them. A detail standing
   * proud keeps the cloth clear of it in a dome (DETAIL_LOOK): her navel always, so it never comes up through the
   * cloth between particles; a nipple as BREAST DETAIL hides it. The dome is measured from where each particle IS on her
   * now, not from where it was cut, because the cloth slides on her.
   */
  private follow(fresh: boolean): void {
    const sp = this.spots, n = this.active, A = this.after, B = this.before, last = this.lastSkin;
    // Friction holds the cloth to her skin's own motion: the spot of her each particle touched last frame, carried by her
    // pose (`after.carried`), less where that spot was (her skin last frame). Where a dome stood in for her skin last
    // frame, `before.point` is the dome's floor, not her skin, so the carried point is moved to match: the floor carried
    // by her skin's motion under it. Everywhere else `before.point` IS her skin last frame and nothing changes.
    if (!fresh) for (let k = 0; k < n * 3; k++) A.carried[k] = B.point[k] + (A.carried[k] - last[k]);
    last.set(A.point.subarray(0, n * 3));
    this.lift.fill(0);
    this.skin.extraStandOff = null;
    if (!sp) return;
    sp.measure(this.skin);
    const k = this.keep, clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0)), p = this.sim.positions;
    this.dome(sp.navel, 1, 1 - clamp01(k.navel), p, A, n);
    for (const d of sp.nipples) this.dome(d, 1 - clamp01(k.nipple), 1 - clamp01(k.nipple), p, A, n);
  }

  /**
   * Keep the cloth over a proud detail: a DOME stands in for her skin under every particle within it, where it stands
   * higher than her skin -- a floor square to the detail's axis, right under the particle, at the dome's height there.
   * The dome is centred on the detail's own tip (her navel vertex stands about 5 mm off the centre of the rings round
   * it), flat across DOME_IN of the inner ring's radius at the tip's height and DOME_MARGIN more, falling smoothly to
   * her smooth surface at DOME_OUT (widening toward WIDE_OUT as `hide` rises). `amount` scales its height (0 none).
   *
   * Why a floor along the axis, and not more stand-off along her skin's normal (what this did until alpha.119): a
   * particle beside the tip has its nearest skin on the tip's flank, whose normal leans away from the axis, so pushing
   * it out along that normal shoved it sideways, off her navel, and the cloth between two such particles crossed below
   * the tip. Her navel came through there, 4-5 mm from the axis, by up to 6 mm at 200% and most when seated (Joshua's
   * dark spot, 2026-10-24); pushing harder along the normal opened the hole wider. Along the axis the cloth only rises.
   */
  private dome(d: Posed, amount: number, hide: number, p: Float32Array, A: SkinContacts, n: number): void {
    const top = Math.max(0, d.h) * amount;
    if (top <= 0) return;
    const L = DETAIL_LOOK, rin = L.domeIn * d.rho, rout = (L.domeOut + (L.wideOut - L.domeOut) * hide) * d.rho, rout2 = rout * rout;
    const [bx, by, bz] = d.base, [nx, ny, nz] = d.n, smooth0 = d.curve * d.reach2, q = A.point, qn = A.normal, lift = this.lift;
    // the tip, across the axis from the rings' centre
    const cx = d.c[0] - bx, cy = d.c[1] - by, cz = d.c[2] - bz, ca = cx * nx + cy * ny + cz * nz;
    const kx = cx - ca * nx, ky = cy - ca * ny, kz = cz - ca * nz;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, dx = p[i3] - bx, dy = p[i3 + 1] - by, dz = p[i3 + 2] - bz, along = dx * nx + dy * ny + dz * nz;
      const tx = dx - along * nx, ty = dy - along * ny, tz = dz - along * nz;
      const ex = tx - kx, ey = ty - ky, ez = tz - kz, r2 = ex * ex + ey * ey + ez * ez;
      // outside the dome, or a body's depth away along the axis (the back of the tee)
      if (r2 >= rout2 || Math.abs(along - smooth0) > rout + top) continue;
      const r = Math.sqrt(r2), t = r <= rin ? 1 : (rout - r) / (rout - rin), f = t * t * (3 - 2 * t);
      // the dome's height over this particle, along the axis from the outer ring's plane; her skin under it, the same way
      const floor = d.curve * (d.reach2 - (tx * tx + ty * ty + tz * tz)) + (top + DOME_MARGIN) * f;
      const skin = (q[i3] - bx) * nx + (q[i3 + 1] - by) * ny + (q[i3 + 2] - bz) * nz;
      if (floor <= skin) continue;
      const drop = along - floor;
      q[i3] = p[i3] - nx * drop; q[i3 + 1] = p[i3 + 1] - ny * drop; q[i3 + 2] = p[i3 + 2] - nz * drop;
      qn[i3] = nx; qn[i3 + 1] = ny; qn[i3 + 2] = nz;
      if (floor - skin > lift[i]) lift[i] = floor - skin;
    }
  }

  /**
   * What shows through the tee this frame, at the room's BREAST and NAVEL DETAIL (0 none, 1 all): for clothDetail.ts.
   * Null for a cloth file that does not know where her navel and nipples are.
   */
  detail(keep: { readonly nipple: number; readonly navel: number }): ClothDetailState | null {
    return this.spots && this.active ? this.spots.cloth(keep) : null;
  }
  /**
   * For a probe: how the cloth's edges stand against its pattern now (length over rest length, the pattern's FIT scale
   * included): the least, the most, and the shares under 0.9 (slack, where creases come from) and over 1.1.
   */
  /** For a probe: how many times her body jumped and the cloth was laid again, and the largest one-frame move of a bound place since last asked. */
  jumps = 0;
  moved = 0;
  /** For a probe: the most stretched edge at the last `strain()`: its two particles, its rest length and its length now (world). */
  worstEdge: [number, number, number, number] = [0, 0, 0, 0];
  strain(): { min: number; max: number; slack: number; taut: number } {
    // (by slot: the simulation's own edges, over the particles it runs)
    const x = this.sim.positions, R = this.restSlot, E = this.sim.edges, k = this.sim.settings.restScale;
    let min = Infinity, max = 0, slack = 0, taut = 0;
    let edges = 0;
    for (let e = 0; e < E.length; e += 2) {
      edges++;
      const a = E[e] * 3, b = E[e + 1] * 3;
      const now = Math.hypot(x[b] - x[a], x[b + 1] - x[a + 1], x[b + 2] - x[a + 2]), rest = Math.hypot(R[b] - R[a], R[b + 1] - R[a + 1], R[b + 2] - R[a + 2]) * k;
      const r = now / Math.max(rest, 1e-6);
      if (r < min) min = r; if (r > max) { max = r; this.worstEdge = [this.order[E[e]], this.order[E[e + 1]], rest, now]; } if (r < 0.9) slack++; if (r > 1.1) taut++;
    }
    const n = edges || 1;
    return { min, max, slack: slack / n, taut: taut / n };
  }
  /**
   * For a probe: every edge stretched past `limit` × its rest length now, worst first: its two particles (file order),
   * how far stretched, how hard each is held, and whether each is bound to her arm.
   */
  tears(limit = 2): { a: number; b: number; ratio: number; pinA: number; pinB: number; armA: boolean; armB: boolean }[] {
    const x = this.sim.positions, R = this.restSlot, E = this.sim.edges, k = this.sim.settings.restScale, out = [];
    for (let e = 0; e < E.length; e += 2) {
      const a = E[e] * 3, b = E[e + 1] * 3;
      const now = Math.hypot(x[b] - x[a], x[b + 1] - x[a + 1], x[b + 2] - x[a + 2]), rest = Math.hypot(R[b] - R[a], R[b + 1] - R[a + 1], R[b + 2] - R[a + 2]) * k;
      const ratio = now / Math.max(rest, 1e-6);
      if (ratio > limit) { const pa = this.order[E[e]], pb = this.order[E[e + 1]]; out.push({ a: pa, b: pb, ratio, pinA: this.pinNow[E[e]], pinB: this.pinNow[E[e + 1]], armA: this.skin.boundToArm(pa), armB: this.skin.boundToArm(pb) }); }
    }
    return out.sort((p, q) => q.ratio - p.ratio);
  }
  /**
   * For a probe: how the cloth clears her skin over her navel. Every vertex of her body within `radius` (world) of her
   * navel's axis is posed (slowly: a probe's), and the cloth's height over it along the axis read from the cloth
   * triangle above it: the least gap, where it is, and how many of her vertices stand above the cloth.
   */
  navelGap(body: THREE.Mesh, radius = 2.5): { gap: number; r: number; through: number; checked: number; top: number; lift: number; h: number; tipH: number; tipR: number } | null {
    const sp = this.spots;
    if (!sp) return null;
    const d = sp.navel, [bx, by, bz] = d.base, [nx, ny, nz] = d.n;
    let ux = 1 - nx * nx, uy = -nx * ny, uz = -nx * nz; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const wx = ny * uz - nz * uy, wy = nz * ux - nx * uz, wz = nx * uy - ny * ux;
    const frame = (x: number, y: number, z: number): [number, number, number] => { const dx = x - bx, dy = y - by, dz = z - bz; return [dx * ux + dy * uy + dz * uz, dx * wx + dy * wy + dz * wz, dx * nx + dy * ny + dz * nz]; };
    // the cloth's triangles near the axis, in the axis frame
    const x = this.sim.positions, idx = this.index.array, shown = this.mesh.geometry.drawRange.count, vp = this.vertexParticle, slot = this.slotOf, tris: number[][] = [];
    for (let t = 0; t + 2 < Math.min(idx.length, shown); t += 3) {
      const ps = [slot[vp[idx[t]]], slot[vp[idx[t + 1]]], slot[vp[idx[t + 2]]]];
      if (ps.some((p) => p < 0)) continue;
      const f = ps.map((p) => frame(x[p * 3], x[p * 3 + 1], x[p * 3 + 2]));
      if (f.every((q) => Math.hypot(q[0], q[1]) > radius + 2)) continue;
      tris.push(f.flat());
    }
    const n = (body.geometry.getAttribute('position') as THREE.BufferAttribute).count, P = this.vec;
    let gap = Infinity, at = 0, through = 0, checked = 0, top = -Infinity, tipH = -Infinity, tipR = 0;
    for (let v = 0; v < n; v++) {
      this.skin.posedVertex(v, P);
      const [a, b, h] = frame(P[0], P[1], P[2]), r = Math.hypot(a, b);
      if (r > radius || Math.abs(h) > 6) continue;
      top = Math.max(top, h);
      const rel = h - d.curve * (d.reach2 - r * r);
      if (rel > tipH) { tipH = rel; tipR = r; }
      for (const T of tris) {
        const x0 = T[0], y0 = T[1], x1 = T[3], y1 = T[4], x2 = T[6], y2 = T[7];
        const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
        if (Math.abs(den) < 1e-12) continue;
        const l0 = ((y1 - y2) * (a - x2) + (x2 - x1) * (b - y2)) / den, l1 = ((y2 - y0) * (a - x2) + (x0 - x2) * (b - y2)) / den, l2 = 1 - l0 - l1;
        if (l0 < 0 || l1 < 0 || l2 < 0) continue;
        const g = l0 * T[2] + l1 * T[5] + l2 * T[8] - h;
        if (g < -4) continue; // a triangle on her far side
        checked++;
        if (g < gap) { gap = g; at = r; }
        if (g < 0) through++;
        break;
      }
    }
    let lift = 0; for (let i = 0; i < this.active; i++) lift = Math.max(lift, this.lift[i]);
    return { gap, r: at, through, checked, top, lift, h: d.h, tipH, tipR };
  }
  /**
   * For a probe: the drawn triangles folded over, facing INTO her (their normal against her skin's under all three corners
   * by more than `cos`), and their particles (file order) with how each is held and whether it is bound to her arm.
   */
  folds(cos = -0.2): { folded: number; particles: { p: number; pin: number; arm: boolean; at: number[]; off: number; gap: number }[] } {
    const x = this.sim.positions, N = this.before.normal, idx = this.index.array, shown = this.mesh.geometry.drawRange.count, vp = this.vertexParticle, slot = this.slotOf;
    const seen = new Map<number, { p: number; pin: number; arm: boolean; at: number[]; off: number; gap: number }>();
    let folded = 0;
    for (let t = 0; t + 2 < Math.min(idx.length, shown); t += 3) {
      const s = [slot[vp[idx[t]]], slot[vp[idx[t + 1]]], slot[vp[idx[t + 2]]]];
      if (s.some((i) => i < 0)) continue;
      const [a, b, c] = s.map((i) => i * 3);
      const ux = x[b] - x[a], uy = x[b + 1] - x[a + 1], uz = x[b + 2] - x[a + 2], wx = x[c] - x[a], wy = x[c + 1] - x[a + 1], wz = x[c + 2] - x[a + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz);
      if (!(l > 0)) continue;
      const sx = N[a] + N[b] + N[c], sy = N[a + 1] + N[b + 1] + N[c + 1], sz = N[a + 2] + N[b + 2] + N[c + 2], sl = Math.hypot(sx, sy, sz);
      if (!(sl > 0) || (nx * sx + ny * sy + nz * sz) / (l * sl) > cos) continue;
      folded++;
      for (const i of s) {
        const p = this.order[i]; if (seen.has(p)) continue;
        const P = this.before.point, q = i * 3, dx = x[q] - P[q], dy = x[q + 1] - P[q + 1], dz = x[q + 2] - P[q + 2];
        seen.set(p, { p, pin: this.pinNow[i], arm: this.skin.boundToArm(p), at: [x[q], x[q + 1], x[q + 2]].map((v) => Math.round(v * 10) / 10), off: Math.round((dx * N[q] + dy * N[q + 1] + dz * N[q + 2]) * 100) / 100, gap: Math.round(Math.hypot(dx, dy, dz) * 100) / 100 });
      }
    }
    return { folded, particles: [...seen.values()] };
  }
  /** How far her navel and nipples stand above her smooth surface, world units (negative an innie's depth), as last followed. */
  get detailHeights(): { navel: number; nipples: number[] } { const sp = this.spots; return { navel: sp?.navel.h ?? 0, nipples: sp?.nipples.map((d) => d.h) ?? [] }; }

  /** Put the cloth back where her body places it (a pose switch: the cloth would otherwise be flung). */
  restart(): void {
    this.place(this.scratch, this.order, this.slotOf);
    this.sim.reset(this.scratch.subarray(0, this.active * 3));
    this.primed = false; this.warm = WARM_SECONDS;
  }

  /**
   * Where every simulated particle is laid on her as she is posed now, by slot (`order`, the skin told the same): the
   * tee's own and the collar's on her skin where the cloth file bound them (a cut edge where it hugs her); each one below
   * the hem hung from its point of the hem by its rest offset from it, carried as her hips carry it.
   */
  private place(out: Float32Array, order: Uint32Array, slotOf: Int32Array): void {
    this.skin.initial(out);
    const R = this.restNow, s = this.skin.worldScale || 1, A = this.anchor, v = this.vec;
    for (let i = 0; i < order.length; i++) {
      const p = order[i];
      if (p < this.teeParticles || p >= this.collarStart) continue;
      const a = A[p], j = slotOf[a];
      if (j < 0) continue; // its point of the hem is never cut away; a file that says otherwise keeps its skin place
      this.skin.worldVector((R[p * 3] - R[a * 3]) / s, (R[p * 3 + 1] - R[a * 3 + 1]) / s, (R[p * 3 + 2] - R[a * 3 + 2]) / s, v, 0);
      out[i * 3] = out[j * 3] + v[0]; out[i * 3 + 1] = out[j * 3 + 1] + v[1]; out[i * 3 + 2] = out[j * 3 + 2] + v[2];
    }
  }
  private readonly vec = new Float32Array(3);

  /**
   * One frame: her skin under the cloth, the cloth, and the sheet for drawing. Her model's world matrices must be current.
   * When her body JUMPS -- a quick size tapped, a saved body put on -- the cloth is laid on her new shape again rather than
   * flung by it: any of its bound places moving more than JUMP in one frame.
   */
  frame(dt: number): void {
    this.layOut();
    const n = this.active, positions = this.sim.positions;
    let skinMs = this.skin.update(positions.subarray(0, n * 3), this.after);
    if (this.primed) {
      const a = this.after.pinTarget, b = this.before.pinTarget;
      let most = 0;
      for (let i = 0; i < n * 3; i += 3) { const d = (a[i] - b[i]) ** 2 + (a[i + 1] - b[i + 1]) ** 2 + (a[i + 2] - b[i + 2]) ** 2; if (d > most) most = d; }
      this.moved = Math.max(this.moved, Math.sqrt(most));
      if (most > JUMP * JUMP) { this.jumps++; this.restart(); skinMs += this.skin.update(this.sim.positions.subarray(0, n * 3), this.after); }
    }
    const fresh = !this.primed;
    if (fresh) { copyContacts(this.after, this.before); this.primed = true; }
    // her navel and nipples this frame, and the cloth over a proud one kept clear of it
    this.follow(fresh);
    // just laid (a restart, a new length): calm for a moment, so the cloth settles onto her instead of whipping
    const damping = this.sim.settings.damping;
    if (this.warm > 0) { this.warm -= dt; this.sim.settings.damping = Math.max(damping, WARM_DAMPING); }
    const stats = this.sim.step(dt, this.before, this.after);
    this.sim.settings.damping = damping;
    // this frame's skin is the next frame's start
    const swap = this.before; this.before = this.after; this.after = swap;
    const t1 = performance.now();
    const normals = this.sim.normals(), P = this.position.array as Float32Array, N = this.normal.array as Float32Array, vp = this.vertexParticle, slot = this.slotOf;
    for (let v = 0; v < vp.length; v++) {
      const p = slot[vp[v]];
      if (p < 0) continue;
      const o = v * 3, q = p * 3;
      P[o] = positions[q]; P[o + 1] = positions[q + 1]; P[o + 2] = positions[q + 2];
      N[o] = normals[q]; N[o + 1] = normals[q + 1]; N[o + 2] = normals[q + 2];
    }
    this.position.needsUpdate = true; this.normal.needsUpdate = true;
    const drawMs = performance.now() - t1, k = 1 / SMOOTHING, s = this.shown;
    s.skinMs += (skinMs - s.skinMs) * k; s.simMs += (stats.ms - s.simMs) * k; s.drawMs += (drawMs - s.drawMs) * k;
    s.posed = this.skin.posed; s.substeps = stats.substeps; s.contacts = stats.contacts;
  }

  stats(): ClothShirtStats {
    return { ...this.shown, particles: this.active, allParticles: this.count };
  }

  /** The solver's settings, live (the HUD may change them; they carry over when the length changes). */
  get simSettings(): ClothSettings { return this.sim.settings; }
  /** How far off her skin the cloth keeps, world units, live. */
  get standOff(): number { return this.skin.thickness; }
  set standOff(units: number) { this.skin.thickness = Math.max(0.01, units); }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }

  /**
   * What is shown as things stand -- TEE LENGTH's rows below the hem, NECKLINE's collar or its cut front -- and so which
   * particles are simulated (in file order, packed into slots) and how each is held.
   * - A row below the hem is shown up to TEE LENGTH's; a collar triangle while any corner of it stands below the share of
   *   the collar shown (the material draws the share's own line across it); a front triangle while any corner of it is
   *   deeper than the cut. What is not shown is not simulated: a particle is simulated when a triangle shown has it.
   * - Every particle is held as the file holds it (its neckline, its sleeves' edges), and a cut edge -- the collar's top
   *   or the front's new neckline -- as the neckline as made is: fully within the file's PIN_IN of the edge, easing off
   *   to nothing at its PIN_OUT, measured down from the edge in metres. The front's edge is held to her skin under it
   *   (`hug`: no further off her than the cloth keeps anywhere) rather than where the whole tee stood, which between her
   *   breasts was a bridge from one to the other: cut there and held there, a deep V hung in the air.
   */
  private layout(): Layout {
    const T = this.triParticle, nT = this.triRow.length, rows = this.hemRows, share = this.collarShare, depth = this.cutDepth;
    const shape = this.neckShape, N = this.neck, tee = this.teeParticles, used = new Uint8Array(this.count), tris: number[] = [];
    // how far below the cut each of the tee's particles stands (metres, up and down: negative is cut away)
    const below = this.below;
    if (depth > 0) for (let p = 0; p < tee; p++) below[p] = N[p * 4] >= NECK_FAR ? NECK_FAR : clothNecklineBelow([N[p * 4], N[p * 4 + 1], N[p * 4 + 2], 0], depth, shape);
    const left = (p: number) => (depth > 0 && p < tee ? below[p] : NECK_FAR);
    for (let t = 0; t < nT; t++) {
      if (this.triRow[t] > rows) continue;
      const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
      if (this.triCollar[t]) { if (!(Math.min(N[a * 4 + 3], N[b * 4 + 3], N[c * 4 + 3]) < share)) continue; }
      else if (!(Math.max(left(a), left(b), left(c)) > 0)) continue;
      tris.push(t); used[a] = used[b] = used[c] = 1;
    }
    let n = 0; for (let p = 0; p < this.count; p++) n += used[p];
    const order = new Uint32Array(n); n = 0; for (let p = 0; p < this.count; p++) if (used[p]) order[n++] = p;
    const [hold, free] = this.edgeHold, held = (d: number) => (d <= hold ? 1 : d >= free ? 0 : 1 - (d - hold) / (free - hold));
    const pin = new Float32Array(n), hugAt = this.hug, bind = this.bindOffset, close = REST_CLEARANCE / (this.skin.worldScale || 1);
    const F = this.filed, S0 = this.neighbourStart, L = this.neighbourList, m = this.toMetres;
    hugAt.set(bind);
    for (let i = 0; i < n; i++) {
      const p = order[i];
      let h = this.pin[p];
      if (p >= this.collarStart) h = Math.max(h, held((share - N[p * 4 + 3]) * (this.collar?.lengthM ?? 0)));
      else if (depth > 0 && p < tee && below[p] < NECK_FAR) {
        // across the cloth to the cut line: how far below it, over how fast that falls across the cloth here (the most
        // it changes to any neighbour, a metre along the cloth) -- near her shoulder points the line runs steep, and a
        // centimetre across it is several up and down
        let fall = 0;
        for (let j = S0[p]; j < S0[p + 1]; j++) {
          const q = L[j];
          if (below[q] >= NECK_FAR) continue;
          const len = Math.hypot(F[q * 3] - F[p * 3], F[q * 3 + 1] - F[p * 3 + 1], F[q * 3 + 2] - F[p * 3 + 2]) * m;
          if (len > 1e-6) fall = Math.max(fall, Math.abs(below[q] - below[p]) / len);
        }
        const e = held(below[p] / Math.max(fall, 1));
        if (e > 0) { h = Math.max(h, e); hugAt[p] = Math.min(bind[p], close); }
      }
      pin[i] = h;
    }
    return { order, pin, tris };
  }
  /** Scratch for `layout`: how far below the cut each of the tee's particles stands. */
  private readonly below: Float32Array;


  /**
   * Lay out the cloth again (`layout`): a new simulation when what is simulated or how it is held has changed, null when
   * nothing has. Particles that stay keep where they are; particles that come in start where her body puts them now. The
   * drawn triangles are rewritten to what is shown.
   */
  private relayout(was: ClothSim | null): ClothSim | null {
    const L = this.layout(), n = L.order.length;
    if (was && n === this.order.length && L.order.every((p, i) => p === this.order[i]) && L.pin.every((h, i) => h === this.pinNow[i])) return null;
    // the drawn triangles
    const I = this.index.array as Uint32Array, V = this.triVertex;
    L.tris.forEach((t, j) => { I[j * 3] = V[t * 3]; I[j * 3 + 1] = V[t * 3 + 1]; I[j * 3 + 2] = V[t * 3 + 2]; });
    this.index.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, L.tris.length * 3);
    // the new slots; then every particle laid on her, and the ones that were already moving carried over
    const slotOf = new Int32Array(this.count).fill(-1);
    L.order.forEach((p, i) => { slotOf[p] = i; });
    this.skin.setOrder(L.order);
    this.skin.pinOffset = this.hug;
    this.place(this.scratch, L.order, slotOf);
    if (was) {
      const x = was.positions, old = this.slotOf;
      for (let i = 0; i < n; i++) { const j = old[L.order[i]]; if (j >= 0) { this.scratch[i * 3] = x[j * 3]; this.scratch[i * 3 + 1] = x[j * 3 + 1]; this.scratch[i * 3 + 2] = x[j * 3 + 2]; } }
    }
    this.order = L.order; this.slotOf = slotOf; this.pinNow = L.pin; this.active = n;
    this.gather(this.restNow, this.restSlot);
    // its triangles by slot
    const tris = new Uint32Array(L.tris.length * 3);
    L.tris.forEach((t, j) => { for (let c = 0; c < 3; c++) tris[j * 3 + c] = slotOf[this.triParticle[t * 3 + c]]; });
    // the hem worn now -- the tee's own, or the last row below it -- weighs HEM_MASS: a hem is turned up and stitched
    const mass = new Float32Array(n).fill(1), rows = this.hemRows;
    if (rows === 0) { for (const p of this.teeHem) if (slotOf[p] >= 0) mass[slotOf[p]] = HEM_MASS; }
    else for (let j = 0; j < this.columns; j++) { const s = slotOf[this.teeParticles + (rows - 1) * this.columns + j]; if (s >= 0) mass[s] = HEM_MASS; }
    const sim = new ClothSim({ count: n, triangles: tris, rest: this.restSlot.subarray(0, n * 3), pin: L.pin, mass }, { ...(was?.settings ?? this.settings) });
    sim.reset(this.scratch.subarray(0, n * 3));
    this.primed = false; this.warm = WARM_SECONDS;
    return sim;
  }
}
