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
 * - It wears the fitted light tee's own MATERIAL (the room's fabric and dye on it), with the fabric laid by its rest
 *   shape as the fitted tee's is, so the two look alike and only the cloth's behaviour differs.
 * - Every frame's cost is measured: the skin search, the simulation, and the drawing buffers, in milliseconds.
 */
import * as THREE from 'three';
import { ClothSim, type ClothSettings } from './clothSim';
import { ClothSkin } from './clothSkin';
import { copyContacts, createContacts, type ClothBinding, type SkinContacts } from './clothTypes';

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
/** World units (4 cm): a bound place moving further than this in one frame is a jump, not motion. */
const JUMP = 4;
/** How quickly the shown milliseconds follow the frame's (an exponential mean over about this many frames). */
const SMOOTHING = 20;

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
  /** Each render vertex's particle. */
  private readonly vertexParticle: Uint32Array;
  /** Triangles by particle, ordered by the lowest row they reach, and how many are in each length. */
  private readonly particleTris: Uint32Array;
  private readonly trisUpToRow: Uint32Array;
  private readonly position: THREE.BufferAttribute;
  private readonly normal: THREE.BufferAttribute;
  private before: SkinContacts;
  private after: SkinContacts;
  private primed = false;
  /** Seconds of settling calm left after the cloth was laid. */
  private warm = 0;
  private activeRows = -1;
  private active = 0;
  private readonly scratch: Float32Array;
  /** The pattern now (world-sized): her shape's, from `refit`, or the fitted tee's at first. */
  private readonly restNow: Float32Array;
  private readonly shown = { skinMs: 0, simMs: 0, drawMs: 0, posed: 0, substeps: 0, contacts: 0 };

  constructor(source: THREE.Mesh, body: THREE.SkinnedMesh, material: THREE.Material | THREE.Material[], settings: Partial<ClothSettings> = {}, thickness = CLOTH_STAND_OFF) {
    const g = source.geometry, info = (source.userData.cloth ?? {}) as { teeParticles?: number; rows?: number; columns?: number; armBones?: number[] };
    const read = (name: string) => g.getAttribute(name) as THREE.BufferAttribute;
    const particleAttr = read('_particle'), restAttr = read('position'), triAttr = read('_body_tri'), baryAttr = read('_body_bary');
    const offsetAttr = read('_offset'), pinAttr = read('_pin'), rowAttr = read('_row'), anchorAttr = read('_anchor'), uvAttr = read('uv');
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
    const filed = new Float32Array(count * 3);
    for (let v = 0; v < nV; v++) {
      const p = this.vertexParticle[v];
      tri[p * 3] = triAttr.getX(v); tri[p * 3 + 1] = triAttr.getY(v); tri[p * 3 + 2] = triAttr.getZ(v);
      bary[p * 3] = baryAttr.getX(v); bary[p * 3 + 1] = baryAttr.getY(v); bary[p * 3 + 2] = baryAttr.getZ(v);
      filed[p * 3] = restAttr.getX(v); filed[p * 3 + 1] = restAttr.getY(v); filed[p * 3 + 2] = restAttr.getZ(v);
      offset[p] = offsetAttr.getX(v); pin[p] = pinAttr.getX(v); row[p] = Math.round(rowAttr.getX(v)); anchor[p] = anchorAttr ? Math.round(anchorAttr.getX(v)) : p;
    }
    this.pin = pin; this.anchor = anchor; this.filed = filed;
    const binding: ClothBinding = { count, tri, bary, offset };
    this.skin = new ClothSkin(body, binding, { armBones: info.armBones ?? [], thickness, restClearance: REST_CLEARANCE });
    this.settings = settings;

    // the triangles, lowest row last, so any length is a prefix of them
    const index = g.index!, nT = index.count / 3, order = Array.from({ length: nT }, (_, t) => t);
    const triRow = (t: number) => Math.max(row[this.vertexParticle[index.getX(t * 3)]], row[this.vertexParticle[index.getX(t * 3 + 1)]], row[this.vertexParticle[index.getX(t * 3 + 2)]]);
    order.sort((a, b) => triRow(a) - triRow(b) || a - b);
    const sorted = new Uint32Array(nT * 3), particleTris = new Uint32Array(nT * 3), upTo = new Uint32Array(this.rows + 1);
    order.forEach((t, k) => { for (let c = 0; c < 3; c++) { const v = index.getX(t * 3 + c); sorted[k * 3 + c] = v; particleTris[k * 3 + c] = this.vertexParticle[v]; } upTo[triRow(t)]++; });
    for (let r = 1; r <= this.rows; r++) upTo[r] += upTo[r - 1];
    this.particleTris = particleTris; this.trisUpToRow = upTo;

    // the sheet as drawn: world positions written every frame; the fabric laid by its rest shape, as the fitted tee's is
    const geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(nV * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.normal = new THREE.BufferAttribute(new Float32Array(nV * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('normal', this.normal);
    if (uvAttr) geometry.setAttribute('uv', uvAttr.clone());
    geometry.setIndex(new THREE.BufferAttribute(sorted, 1));
    const restGeometry = new THREE.BufferGeometry();
    restGeometry.setAttribute('position', restAttr.clone());
    restGeometry.setIndex(new THREE.BufferAttribute(sorted.slice(), 1));
    restGeometry.computeVertexNormals();
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
    this.place(this.scratch);
    this.sim = this.build(0, this.scratch);
  }

  /** 0 the tee as made, 1 every row to mid-thigh. */
  setLength(length: number): void {
    const rows = Math.max(0, Math.min(this.rows, Math.round((Number.isFinite(length) ? length : 0) * this.rows)));
    if (rows === this.activeRows) return;
    // the rows it keeps keep their places; rows it gains start where her body puts them now
    const was = this.sim.positions, kept = Math.min(was.length, this.teeParticles * 3 + rows * this.columns * 3);
    this.place(this.scratch);
    this.scratch.set(was.subarray(0, kept));
    this.sim = this.build(rows, this.scratch);
  }

  /**
   * Cut the tee again for her as she is shaped now (her belly, her shape sliders; never her pose): its pattern from her
   * bound places on her morphed, unposed body (`ClothSkin.restShape`), so a 200% bump wears a tee made for it -- as a
   * maternity tee is -- instead of a 100% tee riding up over it, and a 0% one is not a sack.
   */
  refit(): void {
    this.pattern(this.scratch);
    this.restNow.set(this.scratch.subarray(0, this.restNow.length));
    this.sim.setRest(this.scratch.subarray(0, this.active * 3));
  }

  /**
   * The pattern for her as she is shaped now (world-sized, unposed): the tee's own particles from her skin under them
   * (`ClothSkin.restShape`); every row below the hem hung from its point of the hem by its place in the FILE, not from
   * her skin under it. Those rows stand up to 12 cm off her thighs, bound to small triangles far away, and a place
   * carried out that far by a triangle amplifies any change in her shape: on her left side the rows came out as a flag.
   */
  private pattern(out: Float32Array): void {
    this.skin.restShape(out);
    const F = this.filed, A = this.anchor, s = this.skin.worldScale || 1;
    for (let p = this.teeParticles; p < this.count; p++) {
      const a = A[p];
      for (let k = 0; k < 3; k++) out[p * 3 + k] = out[a * 3 + k] + (F[p * 3 + k] - F[a * 3 + k]) * s;
    }
  }

  /** Put the cloth back where her body places it (a pose switch: the cloth would otherwise be flung). */
  restart(): void {
    this.place(this.scratch);
    this.sim.reset(this.scratch.subarray(0, this.active * 3));
    this.primed = false; this.warm = WARM_SECONDS;
  }

  /**
   * Where every particle is laid on her as she is posed now: the tee's own on her skin where the cloth file bound them;
   * each one below the hem hung from its point of the hem by its rest offset from it, carried as her hips carry it.
   */
  private place(out: Float32Array): void {
    this.skin.initial(out);
    const R = this.restNow, s = this.skin.worldScale || 1, A = this.anchor, v = this.vec;
    for (let p = this.teeParticles; p < this.count; p++) {
      const a = A[p];
      this.skin.worldVector((R[p * 3] - R[a * 3]) / s, (R[p * 3 + 1] - R[a * 3 + 1]) / s, (R[p * 3 + 2] - R[a * 3 + 2]) / s, v, 0);
      out[p * 3] = out[a * 3] + v[0]; out[p * 3 + 1] = out[a * 3 + 1] + v[1]; out[p * 3 + 2] = out[a * 3 + 2] + v[2];
    }
  }
  private readonly vec = new Float32Array(3);

  /**
   * One frame: her skin under the cloth, the cloth, and the sheet for drawing. Her model's world matrices must be current.
   * When her body JUMPS -- a quick size tapped, a saved body put on -- the cloth is laid on her new shape again rather than
   * flung by it: any of its bound places moving more than JUMP in one frame.
   */
  frame(dt: number): void {
    const n = this.active, positions = this.sim.positions;
    let skinMs = this.skin.update(positions.subarray(0, n * 3), this.after);
    if (this.primed) {
      const a = this.after.pinTarget, b = this.before.pinTarget;
      let most = 0;
      for (let i = 0; i < n * 3; i += 3) { const d = (a[i] - b[i]) ** 2 + (a[i + 1] - b[i + 1]) ** 2 + (a[i + 2] - b[i + 2]) ** 2; if (d > most) most = d; }
      if (most > JUMP * JUMP) { this.restart(); skinMs += this.skin.update(this.sim.positions.subarray(0, n * 3), this.after); }
    }
    if (!this.primed) { copyContacts(this.after, this.before); this.primed = true; }
    // just laid (a restart, a new length): calm for a moment, so the cloth settles onto her instead of whipping
    const damping = this.sim.settings.damping;
    if (this.warm > 0) { this.warm -= dt; this.sim.settings.damping = Math.max(damping, WARM_DAMPING); }
    const stats = this.sim.step(dt, this.before, this.after);
    this.sim.settings.damping = damping;
    // this frame's skin is the next frame's start
    const swap = this.before; this.before = this.after; this.after = swap;
    const t1 = performance.now();
    const normals = this.sim.normals(), P = this.position.array as Float32Array, N = this.normal.array as Float32Array, vp = this.vertexParticle;
    for (let v = 0; v < vp.length; v++) {
      const p = vp[v];
      if (p >= n) continue;
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

  /** A simulation over the tee and its first `rows` rows below the hem, from `start` (world, at least that many particles). */
  private build(rows: number, start: Float32Array): ClothSim {
    const n = this.teeParticles + rows * this.columns;
    const rest = this.restNow.slice(0, n * 3);
    const tris = this.particleTris.subarray(0, this.trisUpToRow[rows] * 3);
    const sim = new ClothSim({ count: n, triangles: tris, rest, pin: this.pin.subarray(0, n) }, { ...(this.sim?.settings ?? this.settings) });
    sim.reset(start.subarray(0, n * 3));
    this.mesh.geometry.setDrawRange(0, this.trisUpToRow[rows] * 3);
    this.activeRows = rows; this.active = n; this.primed = false; this.warm = WARM_SECONDS;
    return sim;
  }
}
