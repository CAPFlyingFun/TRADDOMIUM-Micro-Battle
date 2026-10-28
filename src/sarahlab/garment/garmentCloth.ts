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
import type { DetailPoints } from '../detailSpots';
import type { ClothDetailState } from '../clothDetail';
import { DOME_MARGIN, GarmentDetail } from './garmentDetail';

/** The neckline band held: fully within PIN_IN of the opening, easing to nothing at PIN_OUT (metres along the cloth). */
const PIN_IN = 0.012, PIN_OUT = 0.03;
/** A hem's or cuff's edge particle weighs this much. */
const EDGE_MASS = 3;
/** After a (re)start: this long at no less than this damping, so the cloth settles instead of whipping. */
const WARM_SECONDS = 0.4, WARM_DAMPING = 25;
const SMOOTHING = 20;
/**
 * The body pieces are not held to skin her arm bones carry more than this of (clothSkin.ts looseOverArm): they bridge
 * her armpit instead of being dragged up into it as she raises her arms. Measured in the room, arms raised, on the
 * raglan: the worst edge fell from 6-7x to 1.9x at most, nothing showing through her. Not for a set-in (see `armpitRule`).
 */
export const LOOSE_OVER_ARM = 0.3;
/**
 * A particle further than this from its contact on her (metres) has its nearest skin looked for again round it
 * (clothSkin.ts `rescueOver`): the walk had stopped across a fold under her breast at 100% belly with her arms up, 4 to
 * 6 cm off, while her skin showed through the cloth.
 */
export const RESCUE_OVER = 0.02;
/**
 * The garment's bend compliance: ten times stiffer than the room's tee (1e-4), so its creases round over several rows
 * instead of breaking sharp across one edge (Joshua, 2026-10-27: "the shirt needs smooth creases"; a hard limit on the
 * fold was tried and dropped at his word, "shirts don't have limits"). Measured on her in node: the 99th percentile fold between neighbouring triangles fell
 * from 65-83° to 54-69°, at no cost; ten times stiffer again sank her tee into her and tore it.
 */
export const BEND_COMPLIANCE = 1e-5;
/**
 * No two particles of the garment come closer than this (metres; clothSim.ts `selfDistance`): where it folds onto itself
 * its layers lie on each other instead of crossing (Joshua, 2026-10-27: "a slight offset or collision ... so they don't
 * cross").
 */
/** The most and least one refit scales an edge's pattern length by (a broken reading of her shape cannot fling the cloth). */
export const FIT_MIN = 0.5;
export const FIT_MAX = 3;
export const SELF_DISTANCE = 0.005;

/**
 * Where her skin faces down -- the underside of her belly -- a garment hangs from the widest place above and does not
 * follow her down under it: an edge there takes her stretch across her (its girth) but not down her. Her outward
 * normal's height: from HANG_FROM (level) the edge's vertical share stops growing, entirely by HANG_TO (Joshua,
 * 2026-10-28: at 200% the tee's front had grown with all of her lower belly, its fabric three times the pattern, and hung
 * from her as a sack).
 */
export const HANG_FROM = 0, HANG_TO = -0.35;


/**
 * Her shape as the cut reads it, smoothed over the garment's own sheet first (Taubin's two steps a pass, so it is not
 * shrunk): a garment bridges the hollows of her -- under her bust, her waist between belly and hip -- that her skin dips
 * into, and an edge measured on her skin there grew with every stretch of the hollow and stood off her as a fold
 * (Joshua, 2026-10-28). Smoothed, a hollow narrower than the smoothing reads as the span the cloth takes across it.
 */
export const FIT_SMOOTHING = 60;

function smoothOver(P: Float32Array, graph: { start: Uint32Array; list: Uint32Array }, passes: number): Float32Array {
  const n = P.length / 3, was = new Float32Array(P.length);
  for (let pass = 0; pass < passes; pass++) for (const k of [0.5, -0.53]) {
    was.set(P);
    for (let p = 0; p < n; p++) {
      const from = graph.start[p], to = graph.start[p + 1];
      if (to === from) continue;
      for (let c = 0; c < 3; c++) {
        let m = 0; for (let j = from; j < to; j++) m += was[graph.list[j] * 3 + c];
        P[p * 3 + c] = was[p * 3 + c] + k * (m / (to - from) - was[p * 3 + c]);
      }
    }
  }
  return P;
}

/** The sewn sheet's particles' neighbours along its edges, CSR (for clothSkin.ts `neighbours`). */
function neighboursOf(sewn: SewnGarment): { start: Uint32Array; list: Uint32Array } {
  const n = sewn.count, E = sewn.edges, start = new Uint32Array(n + 1), list = new Uint32Array(E.length);
  for (let e = 0; e < E.length; e++) start[E[e] + 1]++;
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const at = start.slice(0, n);
  for (let e = 0; e < E.length; e += 2) { list[at[E[e]]++] = E[e + 1]; list[at[E[e + 1]]++] = E[e]; }
  return { start, list };
}

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
  /** The neckline's own edge rests at this share of its pattern length (a neck band; default 1, none). */
  readonly neckBand?: number;
  /**
   * Whether the body pieces bridge her armpit (`LOOSE_OVER_ARM`). Default true. A set-in turns it off for now: its back
   * piece lies over the back of her shoulder up to the armhole, skin her arm carries, and without a floor there her skin
   * showed through at the back of each armhole; with the rule off it keeps Stage 2's small pinch at the back of the
   * armpit when her arms go up (follow-up review, 2026-10-27).
   */
  readonly armpitRule?: boolean;
  /** Her navel and nipples on her body (`detailSpots.ts`): domed over so they never come through it. Absent: none. */
  readonly detail?: DetailPoints;
  /** False: `detail` is followed (for `detailGap`) but not domed over -- a probe's before picture. Default true. */
  readonly detailDomes?: boolean;
  /**
   * Runs `measure` with her body in the shape the garment was tailored from (the room: her 'belly' target at 1, her 0%
   * design, nothing else on), and puts her back after. Given, every cut (`refit`) is measured from that shape, so the
   * garment's size is a function of her shape now alone -- the same at 41% however the slider got there. Absent: each
   * cut is measured from the last (`fitBase`), as before.
   */
  readonly tailoredShape?: (measure: () => void) => void;
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
  /** Her navel and nipples, domed over (`detail`); null without. */
  private readonly detail: GarmentDetail | null;
  private primed = false;
  private warm = WARM_SECONDS;
  private readonly position: THREE.BufferAttribute;
  private readonly normal: THREE.BufferAttribute;
  private readonly options: GarmentClothOptions;
  private readonly restLengths: Map<number, number>;
  /**
   * CUT FOR HER AS SHE IS SHAPED NOW, as the cloth tee is (Joshua, 2026-10-27: "both should behave exactly the same
   * way"; `ClothSim.setRest`: "the tee is cut for the body it is on (a maternity tee is), rather than a 100% tee pulled
   * over 200%"). Each edge's pattern length is scaled by how far her skin under its two ends has stretched since the
   * garment was tailored: `fit` per edge (by pair key), `fitBase` what it was when `baseShape` -- her shape under the
   * binding then -- was taken (the binding changes when the garment settles, and the scale it had carries over).
   * Her shape, never her pose: `ClothSkin.restShape`.
   */
  private readonly fit = new Map<number, number>();
  private fitBase = new Map<number, number>();
  private baseShape: Float32Array;
  /** HANG_FROM and HANG_TO as this garment uses them (a probe's comparison may change them; equal: no hang). */
  hang: [number, number] = [HANG_FROM, HANG_TO];
  /** The share of each particle's binding offset its cut is measured at (0: her skin points), for a probe's comparison. */
  get fitOffset(): number { return this.fitOffsetNow; }
  set fitOffset(v: number) { this.fitOffsetNow = v; this.tailoredBase = this.measureTailored(); }
  /** Smoothing passes over her shape before the cut reads it (`FIT_SMOOTHING`), for a probe's comparison. */
  get fitSmoothing(): number { return this.fitSmoothingNow; }
  set fitSmoothing(v: number) { this.fitSmoothingNow = v; this.tailoredBase = this.measureTailored(); }
  private fitOffsetNow = 0;
  private fitSmoothingNow = FIT_SMOOTHING;
  private graph: { start: Uint32Array; list: Uint32Array } | null = null;
  private smoothed(P: Float32Array): Float32Array { if (this.fitSmoothing > 0) { this.graph ??= neighboursOf(this.sewn); smoothOver(P, this.graph, this.fitSmoothing); } return P; }
  /** Her skin under the binding in the shape the garment was tailored from (`tailoredShape`), or null. */
  private tailoredBase: Float32Array | null = null;
  private restShiftNow: Float32Array | null = null;
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
    const restP = body.geometry.getAttribute('position');
    this.detail = options.detail ? new GarmentDetail(options.detail, n, options.detailDomes !== false, { count: restP.count, at: (v, o) => { o[0] = restP.getX(v); o[1] = restP.getY(v); o[2] = restP.getZ(v); } }, sewn.triangles) : null;
    this.skin = new ClothSkin(body, options.binding, { thickness: options.standOff, armBones: options.armBones, trunkOnly: options.trunkOnly, ...(options.armpitRule === false ? {} : { looseOverArm: LOOSE_OVER_ARM }), rescueOver: RESCUE_OVER * options.unitsPerMetre, neighbours: neighboursOf(sewn) });
    // which openings are the neck (the one whose edges are named 'neck'), and the hems and cuffs
    this.mass = new Float32Array(n).fill(1);
    const neck: number[] = [];
    for (const o of sewn.openings) {
      if (o.edges.some((e) => e.endsWith(':neck'))) neck.push(...o.particles);
      else for (const p of o.particles) this.mass[p] = EDGE_MASS;
    }
    // the pattern's rest lengths, world units; the neckline's own edge at `neckBand` of it (a band sewn on shorter than
    // the opening, as a tee's rib is, holds the neckline in when her arms pull at it)
    const onNeck = new Uint8Array(n);
    for (const p of neck) onNeck[p] = 1;
    const band = options.neckBand ?? 1;
    this.restLengths = new Map();
    for (let e = 0; e < sewn.edgeRest.length; e++) {
      const a = sewn.edges[e * 2], b = sewn.edges[e * 2 + 1];
      this.restLengths.set(a * n + b, sewn.edgeRest[e] * options.unitsPerMetre * (onNeck[a] && onNeck[b] ? band : 1));
    }
    this.neckDistance = distanceAlong(sewn, neck);
    this.baseShape = this.skin.restShape(new Float32Array(n * 3));
    this.tailoredBase = this.measureTailored();
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
      restLength: (a, b) => this.restOf(a, b), bendFlat: true, capsuleMask: trunkOnly,
    }, { ...(this.sim?.settings ?? { selfDistance: SELF_DISTANCE * this.options.unitsPerMetre, ...settings, bendCompliance: BEND_COMPLIANCE }) });
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

  /** An edge's pattern length now, world units: as drafted, cut for her shape now (`fit`). Undefined for a pair that is no edge. */
  private restOf(a: number, b: number): number | undefined {
    const k = a < b ? a * this.sewn.count + b : b * this.sewn.count + a, L = this.restLengths.get(k);
    return L === undefined ? undefined : L * (this.fit.get(k) ?? 1);
  }

  /**
   * Her BUILD's rest shift (`ClothSkin.restShift`, the room's `buildShift`), for the pattern's reading of her shape.
   * `rebase`: her shape as it stands is the one the garment was tailored for (the room sets it as it puts the garment on).
   */
  setRestShift(shift: Float32Array | null, rebase = false): void {
    this.restShiftNow = shift;
    this.skin.restShift = shift;
    if (rebase) { this.baseShape = this.skin.restShape(new Float32Array(this.sewn.count * 3)); this.fit.clear(); this.fitBase.clear(); }
  }

  /**
   * Cut it again for her as she is shaped now (her belly, her build; never her pose), as the room cuts the cloth tee
   * (`ClothShirt.refit`): every edge's pattern length scaled by how far her skin under it has stretched since it was
   * tailored, the cloth kept where it lies. With `tailoredShape`, measured from the shape it was tailored from, on her
   * shape smoothed over the sheet (`FIT_SMOOTHING`), and not down the underside of her belly (`HANG_FROM`): its size
   * then depends on her shape now and on nothing she was before.
   */
  refit(): void {
    const n = this.sewn.count, len = (P: Float32Array, a: number, b: number) => Math.hypot(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]);
    const T = this.tailoredBase;
    if (T) {
      // her skin points now and her normals under them; each edge her stretch since she was tailored, except down the
      // underside of her belly, where it hangs
      // (an edge's slope down her and the way her skin faces are both read from her shape as it is, not smoothed)
      const N = new Float32Array(n * 3), raw = this.skin.restShape(new Float32Array(n * 3), this.fitOffset, N), now = this.smoothed(raw.slice());
      const [from, to] = this.hang, hang = (p: number) => { if (!(from > to)) return 0; const t = Math.min(1, Math.max(0, (from - N[p * 3 + 1]) / (from - to))); return t * t * (3 - 2 * t); };
      for (const k of this.restLengths.keys()) {
        const a = Math.floor(k / n), b = k % n, lb = len(T, a, b), ln = len(now, a, b);
        let r = lb > 1e-6 && Number.isFinite(ln) ? ln / lb : 1;
        const lr = len(raw, a, b), down = lr > 1e-6 ? Math.abs(raw[b * 3 + 1] - raw[a * 3 + 1]) / lr : 0;
        r = 1 + (r - 1) * (1 - down * (hang(a) + hang(b)) / 2);
        this.fit.set(k, Math.min(FIT_MAX, Math.max(FIT_MIN, r)));
      }
      const keep = this.sim.positions.slice(0, n * 3);
      this.sim = this.build();
      this.sim.reset(keep);
      return;
    }
    const now = this.skin.restShape(new Float32Array(n * 3)), B = this.baseShape;
    for (const k of this.restLengths.keys()) {
      const a = Math.floor(k / n), b = k % n, lb = len(B, a, b), ln = len(now, a, b);
      const r = lb > 1e-6 && Number.isFinite(ln) ? Math.min(FIT_MAX, Math.max(FIT_MIN, ln / lb)) : 1;
      this.fit.set(k, (this.fitBase.get(k) ?? 1) * r);
    }
    const keep = this.sim.positions.slice(0, n * 3);
    this.sim = this.build();
    this.sim.reset(keep);
  }

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
    this.skin = new ClothSkin(this.options.body, binding, { thickness: this.skin.thickness, armBones: this.options.armBones, trunkOnly: this.options.trunkOnly, ...(this.options.armpitRule === false ? {} : { looseOverArm: LOOSE_OVER_ARM }), rescueOver: RESCUE_OVER * this.options.unitsPerMetre, neighbours: neighboursOf(this.sewn) });
    this.skin.restShift = this.restShiftNow;
    // her shape is read through the new binding from here on: the scale it has now carries over (or, tailored from a
    // known shape, that shape is read again through it)
    this.baseShape = this.skin.restShape(new Float32Array(this.sewn.count * 3));
    this.fitBase = new Map(this.fit);
    this.tailoredBase = this.measureTailored();
  }

  /** Her skin points under the binding with her body in the shape the garment was tailored from, no build (`tailoredShape`). */
  private measureTailored(): Float32Array | null {
    const shape = this.options.tailoredShape;
    if (!shape) return null;
    const out = new Float32Array(this.sewn.count * 3), keep = this.skin.restShift;
    shape(() => { this.skin.restShift = null; this.skin.restShape(out, this.fitOffset); });
    this.skin.restShift = keep;
    return this.smoothed(out);
  }

  /** One frame. `capsules`: her arms (world), this frame; the previous frame's are interpolated from. */
  frame(dt: number, capsules?: Capsules): void {
    const n = this.sewn.count, x = this.sim.positions;
    const skinMs = this.skin.update(x.subarray(0, n * 3), this.after);
    // her navel and nipples: domes over them stand in for her skin (garmentDetail.ts, the cloth tee's method)
    this.detail?.follow(this.skin, x, this.after, this.before, n, !this.primed);
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
    const x = this.sim.positions, E = this.sim.edges, k = this.sim.settings.restScale, r: number[] = [];
    for (let e = 0; e < E.length; e += 2) {
      const a = E[e], b = E[e + 1];
      if (where && !(where(a) && where(b))) continue;
      const rest = (this.restOf(a, b) ?? 0) * k;
      if (!(rest > 0)) continue;
      r.push(Math.hypot(x[b * 3] - x[a * 3], x[b * 3 + 1] - x[a * 3 + 1], x[b * 3 + 2] - x[a * 3 + 2]) / rest);
    }
    r.sort((p, q) => p - q);
    return { min: r[0] ?? 0, max: r[r.length - 1] ?? 0, p95: r[Math.floor(r.length * 0.95)] ?? 0, over14: r.filter((v) => v > 1.4).length, over16: r.filter((v) => v > 1.6).length, edges: r.length };
  }

  /** Per particle, the largest pattern scale (`fit`) of its edges now: how far the cut has grown it there, for a probe. */
  fitMap(): Float32Array {
    const n = this.sewn.count, out = new Float32Array(n);
    for (const [k, f] of this.fit) { const a = Math.floor(k / n), b = k % n; out[a] = Math.max(out[a], f); out[b] = Math.max(out[b], f); }
    return out;
  }

  /**
   * Per particle now: the least and most strain of its edges (length over rest) and the sharpest fold between two
   * triangles that meet at it (degrees), 3 numbers a particle -- where the cloth is squeezed, pulled and creased, for a
   * probe's map.
   */
  strainMap(): Float32Array {
    const n = this.sewn.count, x = this.sim.positions, E = this.sim.edges, k = this.sim.settings.restScale, out = new Float32Array(n * 3);
    for (let p = 0; p < n; p++) { out[p * 3] = Infinity; out[p * 3 + 1] = 0; }
    for (let e = 0; e < E.length; e += 2) {
      const a = E[e], b = E[e + 1], rest = (this.restOf(a, b) ?? 0) * k;
      if (!(rest > 0)) continue;
      const r = Math.hypot(x[b * 3] - x[a * 3], x[b * 3 + 1] - x[a * 3 + 1], x[b * 3 + 2] - x[a * 3 + 2]) / rest;
      for (const p of [a, b]) { out[p * 3] = Math.min(out[p * 3], r); out[p * 3 + 1] = Math.max(out[p * 3 + 1], r); }
    }
    const T = this.sewn.triangles, nT = T.length / 3, N = new Float32Array(nT * 3), first = new Map<number, number>();
    for (let t = 0; t < nT; t++) {
      const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
      const ux = x[b] - x[a], uy = x[b + 1] - x[a + 1], uz = x[b + 2] - x[a + 2], vx = x[c] - x[a], vy = x[c + 1] - x[a + 1], vz = x[c + 2] - x[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
      N[t * 3] = nx / l; N[t * 3 + 1] = ny / l; N[t * 3 + 2] = nz / l;
    }
    for (let t = 0; t < nT; t++) for (let j = 0; j < 3; j++) {
      const p = T[t * 3 + j], q = T[t * 3 + (j + 1) % 3], key = p < q ? p * n + q : q * n + p, u = first.get(key);
      if (u === undefined) { first.set(key, t); continue; }
      const d = N[t * 3] * N[u * 3] + N[t * 3 + 1] * N[u * 3 + 1] + N[t * 3 + 2] * N[u * 3 + 2];
      const deg = (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
      for (const v of [p, q]) out[v * 3 + 2] = Math.max(out[v * 3 + 2], deg);
    }
    return out;
  }

  /**
   * The `k` most stretched edges now (length over rest), with their particles, where the first one is (world), how far
   * each end stands off her skin at its last contact (world units; below 0, inside her) and the floor it was given: for a
   * probe.
   */
  worst(k: number): { ratio: number; a: number; b: number; at: [number, number, number]; off: [number, number]; floor: [number, number] }[] {
    const x = this.sim.positions, E = this.sim.edges, scale = this.sim.settings.restScale, r: { ratio: number; a: number; b: number; at: [number, number, number]; off: [number, number]; floor: [number, number] }[] = [];
    // how far each end stands off her skin along her normal at its last contact (below 0: inside her), and its floor
    const c = this.before, off = (p: number) => (x[p * 3] - c.point[p * 3]) * c.normal[p * 3] + (x[p * 3 + 1] - c.point[p * 3 + 1]) * c.normal[p * 3 + 1] + (x[p * 3 + 2] - c.point[p * 3 + 2]) * c.normal[p * 3 + 2];
    for (let e = 0; e < E.length; e += 2) {
      const a = E[e], b = E[e + 1], rest = (this.restOf(a, b) ?? 0) * scale;
      if (!(rest > 0)) continue;
      const ratio = Math.hypot(x[b * 3] - x[a * 3], x[b * 3 + 1] - x[a * 3 + 1], x[b * 3 + 2] - x[a * 3 + 2]) / rest;
      if (r.length < k || ratio > r[r.length - 1].ratio) { r.push({ ratio, a, b, at: [x[a * 3], x[a * 3 + 1], x[a * 3 + 2]], off: [off(a), off(b)], floor: [c.standOff[a], c.standOff[b]] }); r.sort((p, q) => q.ratio - p.ratio); if (r.length > k) r.pop(); }
    }
    return r;
  }

  /** The `k` particles furthest inside her skin now (stand-off below 0, world units), where they are and their floors: for a probe. */
  deepest(k: number): { p: number; off: number; floor: number; at: [number, number, number] }[] {
    const x = this.sim.positions, c = this.before, r: { p: number; off: number; floor: number; at: [number, number, number] }[] = [];
    for (let p = 0; p < this.sewn.count; p++) {
      const o = (x[p * 3] - c.point[p * 3]) * c.normal[p * 3] + (x[p * 3 + 1] - c.point[p * 3 + 1]) * c.normal[p * 3 + 1] + (x[p * 3 + 2] - c.point[p * 3 + 2]) * c.normal[p * 3 + 2];
      if (!(o < 0)) continue;
      if (r.length < k || o < r[r.length - 1].off) { r.push({ p, off: o, floor: c.standOff[p], at: [x[p * 3], x[p * 3 + 1], x[p * 3 + 2]] }); r.sort((a, b) => a.off - b.off); if (r.length > k) r.pop(); }
    }
    return r;
  }

  /** How far particle `p` is from its last contact on her skin (world units): for a probe. */
  contactOf(p: number): number {
    const x = this.sim.positions, c = this.before;
    return Math.hypot(x[p * 3] - c.point[p * 3], x[p * 3 + 1] - c.point[p * 3 + 1], x[p * 3 + 2] - c.point[p * 3 + 2]);
  }

  /**
   * How sharply the sheet folds now: the angle between every two neighbouring triangles' planes (degrees), its largest,
   * 99th percentile and how many pass `over` degrees, everywhere or only where `where` holds for all four corners: for
   * a probe.
   */
  folds(over = 70, where?: (particle: number) => boolean): { max: number; p99: number; over: number; hinges: number } {
    const T = this.sewn.triangles, x = this.sim.positions, nT = T.length / 3, N = new Float32Array(nT * 3);
    for (let t = 0; t < nT; t++) {
      const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
      const ux = x[b] - x[a], uy = x[b + 1] - x[a + 1], uz = x[b + 2] - x[a + 2], vx = x[c] - x[a], vy = x[c + 1] - x[a + 1], vz = x[c + 2] - x[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
      N[t * 3] = nx / l; N[t * 3 + 1] = ny / l; N[t * 3 + 2] = nz / l;
    }
    const n = this.sewn.count, first = new Map<number, number>(), angles: number[] = [];
    for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
      const p = T[t * 3 + k], q = T[t * 3 + (k + 1) % 3], key = p < q ? p * n + q : q * n + p;
      const u = first.get(key);
      if (u === undefined) { first.set(key, t); continue; }
      if (where) { let ok = true; for (const v of [T[t * 3], T[t * 3 + 1], T[t * 3 + 2], T[u * 3], T[u * 3 + 1], T[u * 3 + 2]]) if (!where(v)) ok = false; if (!ok) continue; }
      const d = N[t * 3] * N[u * 3] + N[t * 3 + 1] * N[u * 3 + 1] + N[t * 3 + 2] * N[u * 3 + 2];
      angles.push((Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI);
    }
    angles.sort((p, q) => p - q);
    return { max: angles[angles.length - 1] ?? 0, p99: angles[Math.floor(angles.length * 0.99)] ?? 0, over: angles.filter((v) => v > over).length, hinges: angles.length };
  }

  /**
   * How far the garment stands off each of her navel and nipples now, along the detail's axis, from its tip: the least
   * over the particles within `DETAIL_LOOK.domeIn` of the inner ring's radius of the axis -- the dome's flat top, where
   * the cloth must stand above the tip (world units; below 0, the tip is through the cloth). For a probe; null without
   * `detail`.
   */
  /** BREAST and NAVEL DETAIL (0 hidden, 1 all of it): how the cloth lies over her navel and nipples, set by the room. */
  set detailKeep(keep: { nipple: number; navel: number }) { if (this.detail) this.detail.keep = keep; }

  /** What the room draws through the fabric at BREAST and NAVEL DETAIL (`clothDetail.ts`), as the cloth tee; null without `detail`. */
  /** The detail softening (`GarmentDetail.shade`) and each detail's spacing and widening now: for a probe. */
  detailShade(patch?: Partial<{ spread: number; widen: number; slope: number; grow: number }>): { shade: { spread: number; widen: number; slope: number; grow?: number }; spacing: number[]; widened: number[] } | null {
    if (!this.detail) return null;
    if (patch) this.detail.shade = { ...this.detail.shade, ...patch };
    return { shade: this.detail.shade, spacing: [...this.detail.spacing], widened: [...this.detail.widened] };
  }

  detailShading(keep: { readonly nipple: number; readonly navel: number }): ClothDetailState | null {
    // softened by how far the sheet stands off each tip beyond lying on it (her skin's stand-off and the dome's margin)
    return this.detail ? this.detail.shading(keep, this.detailGap() ?? undefined, this.skin.thickness + DOME_MARGIN) : null;
  }

  /**
   * The sheet's height over detail `i` (0 her navel, 1-2 her nipples) along its axis, measured from the tip, at radius
   * r out from the tip's axis in 8 directions round it, for r = 0 to 3 cm in quarters: [r, min, max] (world units;
   * NaN where no triangle crosses). For a probe of the dome's shape.
   */
  detailProfile(i = 0): number[][] | null {
    if (!this.detail) return null;
    const d = i === 0 ? this.detail.posed.navel : this.detail.posed.nipples[i - 1], t = this.detail.tips[i];
    if (!d || !t) return null;
    const x = this.sim.positions, T = this.sewn.triangles, [nx, ny, nz] = d.n;
    // two directions square to the axis
    let ux = -nz, uy = 0, uz = nx; if (Math.hypot(ux, uy, uz) < 0.1) { ux = 0; uy = nz; uz = -ny; }
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
    const cross = (ox: number, oy: number, oz: number): number => {
      let best = NaN;
      for (let k = 0; k < T.length; k += 3) {
        const a = T[k] * 3, b = T[k + 1] * 3, c = T[k + 2] * 3;
        if ((x[a] - ox) ** 2 + (x[a + 1] - oy) ** 2 + (x[a + 2] - oz) ** 2 > 25) continue;
        const e1x = x[b] - x[a], e1y = x[b + 1] - x[a + 1], e1z = x[b + 2] - x[a + 2], e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
        const px = ny * e2z - nz * e2y, py = nz * e2x - nx * e2z, pz = nx * e2y - ny * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det, tx = ox - x[a], ty = oy - x[a + 1], tz = oz - x[a + 2], u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (nx * qx + ny * qy + nz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const h = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (Number.isNaN(best) || Math.abs(h) < Math.abs(best)) best = h;
      }
      return best;
    };
    const out: number[][] = [];
    for (let r = 0; r <= 3.0001; r += 0.25) {
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < 8; k++) {
        const ang = (k * Math.PI) / 4, cx = Math.cos(ang) * r, sy = Math.sin(ang) * r;
        const h = cross(t.at[0] + ux * cx + vx * sy, t.at[1] + uy * cx + vy * sy, t.at[2] + uz * cx + vz * sy);
        if (Number.isFinite(h)) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
      }
      out.push([r, lo, hi]);
    }
    return out;
  }

  detailGap(): { navel: number; nipples: number[] } | null {
    if (!this.detail) return null;
    // the SHEET over each tip, not its particles: the line through the tip along the detail's axis, met by the sheet's
    // triangles (Möller-Trumbore); the gap is the nearest crossing's height above the tip (below 0, the tip is through
    // it). A detail's flat top can lie between particles, so a measure of the particles alone could miss the hole.
    const x = this.sim.positions, T = this.sewn.triangles;
    const gap = (d: { c: number[]; n: number[]; rho: number }) => {
      const [ox, oy, oz] = d.c, [dx, dy, dz] = d.n, reach2 = (3 * d.rho) ** 2;
      let best = Infinity;
      for (let t = 0; t < T.length; t += 3) {
        const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
        if ((x[a] - ox) ** 2 + (x[a + 1] - oy) ** 2 + (x[a + 2] - oz) ** 2 > reach2) continue;
        const e1x = x[b] - x[a], e1y = x[b + 1] - x[a + 1], e1z = x[b + 2] - x[a + 2], e2x = x[c] - x[a], e2y = x[c + 1] - x[a + 1], e2z = x[c + 2] - x[a + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det, tx = ox - x[a], ty = oy - x[a + 1], tz = oz - x[a + 2], u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const h = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (Math.abs(h) < Math.abs(best)) best = h;
      }
      return best;
    };
    // measured from each detail's TIP (the tallest vertex around its centre), on the axis through it
    const p = this.detail.posed, tips = this.detail.tips;
    return { navel: gap({ ...p.navel, c: tips[0].at }), nipples: p.nipples.map((d, i) => gap({ ...d, c: tips[i + 1].at })) };
  }


  /** The sheet's unit normals now, one per particle (world), each turned to face away from her skin: for a probe. */
  drawNormals(): Float32Array {
    const N = this.sim.normals().slice(), c = this.before.normal;
    for (let p = 0; p < this.sewn.count; p++) if (N[p * 3] * c[p * 3] + N[p * 3 + 1] * c[p * 3 + 1] + N[p * 3 + 2] * c[p * 3 + 2] < 0) { N[p * 3] = -N[p * 3]; N[p * 3 + 1] = -N[p * 3 + 1]; N[p * 3 + 2] = -N[p * 3 + 2]; }
    return N;
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
