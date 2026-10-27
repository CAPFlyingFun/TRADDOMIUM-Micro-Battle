/**
 * THE PROCEDURAL GARMENT AS CLOTH, ON HER (Stage 2b). The sewn sheet (`sew.ts`) bound to her (`place.ts`, `bind.ts`)
 * and run by the room's own cloth: `clothSkin.ts` finds her posed skin under every particle, `clothSim.ts` moves the
 * particles. What is new against the cloth tee (`clothShirt.ts`), all of it the pattern's doing:
 * - every edge rests at its length in the flat PATTERN (with the room's FIT as a scale), and bends rest flat, so the
 *   fabric's amount is the pattern's, never the pose's or her shape's -- her belly changing stretches the cloth and
 *   never cuts new fabric;
 * - the body pieces never take her arm as their skin, and are pushed out of CAPSULES round her upper arms and forearms,
 *   so an arm coming forward or in pushes the shirt's side instead of passing through it;
 * - the neckline is held to her softly once the garment has settled (`settle`): the band within PIN_IN of the opening
 *   fully, easing off by PIN_OUT, as the cloth tee's neckline is; nothing else is pinned -- the sleeves' ends ride her arms;
 * - the hem's and cuffs' edges weigh EDGE_MASS a particle, as a turned-up hem does.
 * Drawn unskinned in WORLD space, a render vertex per pattern point (its UV the pattern's own), normals from the cloth.
 */
import * as THREE from 'three';
import { ClothSim, type Capsules, type ClothSettings, type ClothStepStats } from '../clothSim';
import { ClothSkin } from '../clothSkin';
import { copyContacts, createContacts, type ClothBinding, type SkinContacts } from '../clothTypes';
import type { SewnGarment } from './types';

/** The neckline band held: fully within PIN_IN of the opening, easing to nothing at PIN_OUT (metres along the cloth). */
const PIN_IN = 0.012, PIN_OUT = 0.03;
/** A hem's or cuff's edge particle weighs this much. */
const EDGE_MASS = 3;
/** After a (re)start: this long at no less than this damping, so the cloth settles instead of whipping. */
const WARM_SECONDS = 0.4, WARM_DAMPING = 25;
const SMOOTHING = 20;

export interface GarmentClothOptions {
  readonly body: THREE.SkinnedMesh;
  readonly sewn: SewnGarment;
  readonly binding: ClothBinding;
  /** 1 for body-piece particles (never her arm as their skin; pushed out of the arm capsules). */
  readonly trunkOnly: Uint8Array;
  readonly armBones: readonly number[];
  readonly settings: Partial<ClothSettings>;
  /** World units off her skin. */
  readonly standOff: number;
  readonly material: THREE.Material;
  /** World units per pattern metre (the room: 100). */
  readonly unitsPerMetre: number;
  /** Her rest shape at the pattern's scale, for the fabric's own grain (`fabricRest`): body-local positions per particle. */
  readonly fabricRest?: Float32Array;
  /**
   * Drawn this far out along its own normals (world units), so where her skin rises through a fabric lying on it -- her
   * nipples under a tee with no ease -- the cloth is drawn over it; the simulation is untouched. Default 0.
   */
  readonly drawLift?: number;
}

export interface GarmentClothStats {
  readonly particles: number;
  readonly triangles: number;
  readonly edges: number;
  readonly bends: number;
  readonly skinMs: number;
  readonly simMs: number;
  readonly drawMs: number;
  readonly posed: number;
  readonly contacts: number;
  readonly capsuleContacts: number;
  readonly substeps: number;
}

export class GarmentCloth {
  readonly mesh: THREE.Mesh;
  readonly sewn: SewnGarment;
  private skin: ClothSkin;
  private sim: ClothSim;
  private before: SkinContacts;
  private after: SkinContacts;
  private primed = false;
  private warm = WARM_SECONDS;
  private readonly position: THREE.BufferAttribute;
  private readonly normal: THREE.BufferAttribute;
  private readonly options: GarmentClothOptions;
  private readonly restLengths: Map<number, number>;
  private readonly mass: Float32Array;
  private pin: Float32Array;
  private capsBefore: Capsules | null = null;
  private readonly shown = { skinMs: 0, simMs: 0, drawMs: 0 };
  private last: ClothStepStats | null = null;
  /** Per particle, 1 on the neckline's opening. */
  private readonly neckDistance: Float32Array;

  constructor(options: GarmentClothOptions) {
    this.options = options;
    const { sewn, body } = options, n = sewn.count;
    this.sewn = sewn;
    this.skin = new ClothSkin(body, options.binding, { thickness: options.standOff, armBones: options.armBones, trunkOnly: options.trunkOnly });
    // the pattern's rest lengths, world units
    this.restLengths = new Map();
    for (let e = 0; e < sewn.edgeRest.length; e++) this.restLengths.set(sewn.edges[e * 2] * n + sewn.edges[e * 2 + 1], sewn.edgeRest[e] * options.unitsPerMetre);
    // which openings are the neck (the one whose edges are named 'neck'), and the hems and cuffs
    this.mass = new Float32Array(n).fill(1);
    const neck: number[] = [];
    for (const o of sewn.openings) {
      if (o.edges.some((e) => e.endsWith(':neck'))) neck.push(...o.particles);
      else for (const p of o.particles) this.mass[p] = EDGE_MASS;
    }
    this.neckDistance = distanceAlong(sewn, neck);
    this.pin = new Float32Array(n);
    // drawing
    const nv = sewn.vertexParticle.length, g = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.normal = new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.position);
    g.setAttribute('normal', this.normal);
    g.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(sewn.uv), 2));
    if (options.fabricRest) {
      const fr = new Float32Array(nv * 3);
      for (let v = 0; v < nv; v++) { const p = sewn.vertexParticle[v]; for (let c = 0; c < 3; c++) fr[v * 3 + c] = options.fabricRest[p * 3 + c]; }
      g.setAttribute('fabricRest', new THREE.BufferAttribute(fr, 3));
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(fr, 3)); rg.setIndex(new THREE.BufferAttribute(sewn.renderTriangles, 1)); rg.computeVertexNormals();
      g.setAttribute('fabricRestNormal', rg.getAttribute('normal')); rg.dispose();
    }
    g.setIndex(new THREE.BufferAttribute(sewn.renderTriangles, 1));
    this.mesh = new THREE.Mesh(g, options.material);
    this.mesh.name = 'sarah-procedural-garment';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.before = createContacts(n); this.after = createContacts(n);
    this.sim = this.build();
  }

  private build(): ClothSim {
    const { sewn, settings, trunkOnly } = this.options, n = sewn.count;
    const start = new Float32Array(n * 3);
    this.skin.initial(start);
    const sim = new ClothSim({
      count: n, triangles: sewn.triangles, rest: start, pin: this.pin, mass: this.mass,
      restLength: (a, b) => this.restLengths.get(a < b ? a * n + b : b * n + a), bendFlat: true, capsuleMask: trunkOnly,
    }, { ...(this.sim?.settings ?? settings) });
    sim.reset(start);
    this.primed = false; this.warm = WARM_SECONDS;
    return sim;
  }

  /**
   * Weightless, the cloth only draws itself to its pattern's lengths over her: how a garment is first eased onto her
   * before it is pinned (`settle`) and let hang -- laid round her, its placing is a rough start, and with its weight on
   * it the stretched neckline would slide down her back before anything held it (Stage 2b: 3 to 7 cm).
   */
  weightless = false;

  /** Lay the cloth on her again where it is bound (a pose switch: otherwise it would be flung). */
  restart(): void { this.sim = this.build(); }

  /**
   * Bind every particle where it lies on her now and hold the neckline there (after the garment has settled, dressed):
   * from here on a restart lays it as it settled, and the neck band keeps its place on her.
   */
  settle(): void {
    const n = this.sewn.count, x = this.sim.positions.subarray(0, n * 3);
    // her skin under every particle as it lies NOW (the frame's own reading was taken before its step moved them)
    this.skin.update(x, this.after);
    const binding = this.skin.contactBinding(x, 0.0005 / 0.9);
    this.rebind(binding);
    const held = (d: number) => (d <= PIN_IN ? 1 : d >= PIN_OUT ? 0 : 1 - (d - PIN_IN) / (PIN_OUT - PIN_IN));
    this.pin = Float32Array.from(this.neckDistance, (d) => held(d));
    const keep = this.sim.positions.slice(0, n * 3);
    this.sim = this.build();
    this.sim.reset(keep);
  }

  private rebind(binding: ClothBinding): void {
    // ClothSkin keeps its binding; a new one means a new reader over the same body
    this.skin = new ClothSkin(this.options.body, binding, { thickness: this.skin.thickness, armBones: this.options.armBones, trunkOnly: this.options.trunkOnly });
  }

  /** One frame. `capsules`: her arms (world), this frame; the previous frame's are interpolated from. */
  frame(dt: number, capsules?: Capsules): void {
    const n = this.sewn.count, x = this.sim.positions;
    const skinMs = this.skin.update(x.subarray(0, n * 3), this.after);
    if (!this.primed) { copyContacts(this.after, this.before); this.primed = true; }
    const damping = this.sim.settings.damping;
    if (this.warm > 0) { this.warm -= dt; this.sim.settings.damping = Math.max(damping, WARM_DAMPING); }
    const caps = capsules ? { before: this.capsBefore ?? capsules, after: capsules } : undefined;
    const gravity = this.sim.settings.gravity;
    if (this.weightless) this.sim.settings.gravity = [0, 0, 0];
    const stats = this.sim.step(dt, this.before, this.after, caps);
    this.sim.settings.damping = damping; this.sim.settings.gravity = gravity;
    this.capsBefore = capsules ? cloneCapsules(capsules) : null;
    const swap = this.before; this.before = this.after; this.after = swap;
    const t1 = performance.now();
    const normals = this.sim.normals(), P = this.position.array as Float32Array, N = this.normal.array as Float32Array, vp = this.sewn.vertexParticle;
    const lift = this.options.drawLift ?? 0;
    for (let v = 0; v < vp.length; v++) { const q = vp[v] * 3, o = v * 3; N[o] = normals[q]; N[o + 1] = normals[q + 1]; N[o + 2] = normals[q + 2]; P[o] = x[q] + lift * N[o]; P[o + 1] = x[q + 1] + lift * N[o + 1]; P[o + 2] = x[q + 2] + lift * N[o + 2]; }
    this.position.needsUpdate = true; this.normal.needsUpdate = true;
    const k = 1 / SMOOTHING, s = this.shown;
    s.skinMs += (skinMs - s.skinMs) * k; s.simMs += (stats.ms - s.simMs) * k; s.drawMs += (performance.now() - t1 - s.drawMs) * k;
    this.last = stats;
  }

  get simSettings(): ClothSettings { return this.sim.settings; }
  set standOff(units: number) { this.skin.thickness = Math.max(0.01, units); }

  stats(): GarmentClothStats {
    return {
      particles: this.sewn.count, triangles: this.sewn.triangles.length / 3, edges: this.sim.edges.length / 2, bends: this.sim.bendPairs.length / 2,
      skinMs: this.shown.skinMs, simMs: this.shown.simMs, drawMs: this.shown.drawMs, posed: this.skin.posed,
      contacts: this.last?.contacts ?? 0, capsuleContacts: this.last?.capsuleContacts ?? 0, substeps: this.last?.substeps ?? 0,
    };
  }

  /**
   * How every edge stands against its pattern length now (length / (pattern x restScale)), over the particles `where`
   * says (all when absent): min, max, the 95th percentile, and how many are past 1.4 and 1.6.
   */
  strain(where?: (particle: number) => boolean): { min: number; max: number; p95: number; over14: number; over16: number; edges: number } {
    const x = this.sim.positions, E = this.sim.edges, k = this.sim.settings.restScale, n = this.sewn.count, r: number[] = [];
    for (let e = 0; e < E.length; e += 2) {
      const a = E[e], b = E[e + 1];
      if (where && !(where(a) && where(b))) continue;
      const rest = (this.restLengths.get(a < b ? a * n + b : b * n + a) ?? 0) * k;
      if (!(rest > 0)) continue;
      r.push(Math.hypot(x[b * 3] - x[a * 3], x[b * 3 + 1] - x[a * 3 + 1], x[b * 3 + 2] - x[a * 3 + 2]) / rest);
    }
    r.sort((p, q) => p - q);
    return { min: r[0] ?? 0, max: r[r.length - 1] ?? 0, p95: r[Math.floor(r.length * 0.95)] ?? 0, over14: r.filter((v) => v > 1.4).length, over16: r.filter((v) => v > 1.6).length, edges: r.length };
  }

  /** The particles' positions now (world, 3 each): for a probe. */
  get positions(): Float32Array { return this.sim.positions; }

  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); }
}

function cloneCapsules(c: Capsules): Capsules { return { count: c.count, a: c.a.slice(), b: c.b.slice(), radius: c.radius.slice() }; }

/** Per particle, the distance along the cloth (pattern metres) to the nearest of `from` (Dijkstra over the edges). */
function distanceAlong(sewn: SewnGarment, from: readonly number[]): Float32Array {
  const n = sewn.count, d = new Float32Array(n).fill(Infinity);
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let e = 0; e < sewn.edgeRest.length; e++) { const a = sewn.edges[e * 2], b = sewn.edges[e * 2 + 1]; adj[a].push(b, e); adj[b].push(a, e); }
  const queue: [number, number][] = from.map((p) => [0, p]);
  for (const p of from) d[p] = 0;
  while (queue.length) {
    queue.sort((p, q) => q[0] - p[0]);
    const [dist, p] = queue.pop()!;
    if (dist > d[p] || dist > 0.05) continue;
    const a = adj[p];
    for (let k = 0; k < a.length; k += 2) { const q = a[k], nd = dist + sewn.edgeRest[a[k + 1]]; if (nd < d[q]) { d[q] = nd; queue.push([nd, q]); } }
  }
  return d;
}
