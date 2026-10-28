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
 *
 * THE CUTS (Stage 3, `cuts.ts`): the tee is drafted to its full extent and its instant controls cut it. `setCut` hands
 * the cloth a field over the render vertices; a triangle is WORN while any corner of it is above 0, and only the worn
 * cloth is simulated -- its particles packed into SLOTS, as the cloth tee's are (slot i is particle `order[i]`, and
 * `ClothSkin.setOrder` is told the same) -- and drawn, the material dropping what is under 0 along a smooth line
 * (`cutEdge.ts`). Everything that is a particle's own (its binding, its pattern lengths, its cut for her shape) stays in
 * particle order. With no cut everything is worn, slot i is particle i, and the garment is exactly as it was.
 * - Where the cloth now ends -- a drafted hem or cuff, a cut one, an armhole the sleeve's cut opened -- it weighs
 *   EDGE_MASS, the cut's line with a band either side of it (CUT_EDGE_BAND).
 * - A cut NECKLINE is held as the drafted one is, once settled, and to her skin under it (a hug, `ClothSkin.pinOffset`):
 *   where the whole tee bridged her breasts, a deep V held where the tee stood would hang in the air.
 * - Her shape is read over the worn cloth alone (`refit`'s smoothing): what the cut leaves off never pulls on the fit of
 *   what is worn, so the default tee is cut exactly as it was. After the worn cloth changes it is cut again for her
 *   once it has stood REFIT_SETTLE.
 * - Cloth a cut brings back is laid level with the cloth round it (`join`): moved as its neighbours have moved from
 *   where they are bound, and, once the garment has settled, bound to her where it starts. `settle` binds the cloth not
 *   worn as the worn cloth round it moved, so every particle's binding says where the settled garment has it.
 */
import * as THREE from 'three';
import { ClothSim, type Capsules, type ClothSettings, type ClothStepStats } from '../clothSim';
import { ClothSkin } from '../clothSkin';
import { copyContacts, createContacts, type ClothBinding, type SkinContacts } from '../clothTypes';
import type { SewnGarment } from './types';
import type { DetailPoints } from '../detailSpots';
import type { ClothDetailState } from '../clothDetail';
import { DOME_MARGIN, GarmentDetail } from './garmentDetail';
import { CUT_EDGE_ATTRIBUTE } from './cutEdge';
import type { GarmentCuts } from './cuts';

/** The neckline band held: fully within PIN_IN of the opening, easing to nothing at PIN_OUT (metres along the cloth). */
const PIN_IN = 0.012, PIN_OUT = 0.03;
/** A hem's or cuff's edge particle weighs this much. */
const EDGE_MASS = 3;
/** After a (re)start: this long at no less than this damping, so the cloth settles instead of whipping. */
const WARM_SECONDS = 0.4, WARM_DAMPING = 25;
const SMOOTHING = 20;
/** Metres either side of a cut line other than the neckline: the particles there weigh EDGE_MASS, as a hem's do. */
export const CUT_EDGE_BAND = 0.012;
/** A cut neckline's edge is held no further off her than this (metres): the cloth tee's own clearance for its cut edge. */
export const HUG_CLEARANCE = 0.006;
/**
 * ...but no edge between held particles is held longer than HUG_STRETCH times its length: the hug is let off HUG_STEP
 * of the way back to where the cloth lay at a time, for at most HUG_ROUNDS passes (`easeHug`).
 */
export const HUG_STRETCH = 1.1, HUG_STEP = 0.1, HUG_ROUNDS = 40;
/** Seconds the worn cloth must stand unchanged after a cut before it is cut again for her shape over what is worn. */
export const REFIT_SETTLE = 0.25;
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
 * Where her skin faces well down -- the underside of her belly -- a garment hangs and does not follow her down under it:
 * an edge there takes her stretch across her (its girth) but not down her. Her outward normal's height: from HANG_FROM
 * the edge's vertical share stops growing, entirely by HANG_TO (Joshua, 2026-10-28: at 200% the tee's front had grown
 * with all of her lower belly and hung from her as a sack). Not from level: the lower half of her belly faces down too,
 * and the tee covers it -- held from level, it was cut too short there, creased across her belly and tucked its hem
 * under her ("make sure the shirt retains the 100% belly rounded shape").
 */
export const HANG_FROM = -0.4, HANG_TO = -0.9;
/**
 * ...but where her skin has grown far past the tee as tailored -- her belly at 150-200% -- it hangs from level, as the
 * first cut did (Joshua, 2026-10-28, on the two cuts side by side: "the new 100% looks good, but the 200% is wrong… the
 * last 200% was good"): HANG_BIG_FROM / HANG_BIG_TO, eased in as an edge's stretch goes from HANG_GROWN_FROM to
 * HANG_GROWN_TO (measured on her shape as the cut reads it, her front under the belly at 100% stretches up to 2.0
 * times, at 150% 2.3-2.6, at 200% 2.5-3).
 */
export const HANG_BIG_FROM = 0, HANG_BIG_TO = -0.35;
export const HANG_GROWN_FROM = 2.0, HANG_GROWN_TO = 2.5;


/**
 * Her shape as the cut reads it, smoothed over the garment's own sheet first (Taubin's two steps a pass, so it is not
 * shrunk): a garment bridges the hollows of her -- under her bust, her waist between belly and hip -- that her skin dips
 * into, and an edge measured on her skin there grew with every stretch of the hollow and stood off her as a fold
 * (Joshua, 2026-10-28). Smoothed, a hollow narrower than the smoothing reads as the span the cloth takes across it.
 * 150 passes (about 15 cm): 60 still let the hem under her belly read the crease above her thighs, and stand off her
 * as a ripple at 67-100% (compared on her at 0, 60 and 150: folds over 60° at 100%, 90 / 71 / 65).
 */
export const FIT_SMOOTHING = 150;

function smoothOver(P: Float32Array, graph: { start: Uint32Array; list: Uint32Array }, passes: number): Float32Array {
  const n = P.length / 3, was = new Float32Array(P.length);
  for (let pass = 0; pass < passes; pass++) for (const k of [0.5, -0.53]) {
    was.set(P);
    const S = graph.start, L = graph.list;
    for (let p = 0; p < n; p++) {
      const from = S[p], to = S[p + 1];
      if (to === from) continue;
      let mx = 0, my = 0, mz = 0;
      for (let j = from; j < to; j++) { const q = L[j] * 3; mx += was[q]; my += was[q + 1]; mz += was[q + 2]; }
      const w = k / (to - from), o = p * 3;
      P[o] = was[o] + (mx * w - k * was[o]); P[o + 1] = was[o + 1] + (my * w - k * was[o + 1]); P[o + 2] = was[o + 2] + (mz * w - k * was[o + 2]);
    }
  }
  return P;
}

/** The sewn sheet's particles' neighbours along its edges, CSR (for clothSkin.ts `neighbours`); only edges `keep` keeps when given. */
function neighboursOf(sewn: SewnGarment, keep?: Uint8Array): { start: Uint32Array; list: Uint32Array } {
  const n = sewn.count, E = sewn.edges, start = new Uint32Array(n + 1);
  const kept = (e: number) => !keep || (keep[E[e]] === 1 && keep[E[e + 1]] === 1);
  let m = 0;
  for (let e = 0; e < E.length; e += 2) if (kept(e)) { start[E[e] + 1]++; start[E[e + 1] + 1]++; m += 2; }
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const at = start.slice(0, n), list = new Uint32Array(m);
  for (let e = 0; e < E.length; e += 2) if (kept(e)) { list[at[E[e]]++] = E[e + 1]; list[at[E[e + 1]]++] = E[e]; }
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
  /** The neckline's own edge rests at this share of its pattern length, over the params' own `neckBand`: `GarmentCloth`'s. */
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
  /**
   * Runs `measure` with her body as she is but for her belly, at `share` of 100% (the room's BELLY ROOM), and puts her
   * back after. Absent: BELLY ROOM does nothing.
   */
  readonly roomShape?: (share: number, measure: () => void) => void;
  /** The cut it is first worn with (`setCut`); absent, all of it. */
  readonly cuts?: GarmentCuts | null;
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
  private readonly index: THREE.BufferAttribute;
  private readonly cutAttr: THREE.BufferAttribute;
  private readonly options: GarmentClothOptions;
  private readonly restLengths: Map<number, number>;
  /** The binding the skin reads now (the tailored one, then where it settled). */
  private binding: ClothBinding;
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
  set fitOffset(v: number) { this.fitOffsetNow = v; this.tailoredCache = null; }
  /** Smoothing passes over her shape before the cut reads it (`FIT_SMOOTHING`), for a probe's comparison. */
  get fitSmoothing(): number { return this.fitSmoothingNow; }
  set fitSmoothing(v: number) { this.fitSmoothingNow = v; this.tailoredCache = null; }
  private fitOffsetNow = 0;
  private fitSmoothingNow = FIT_SMOOTHING;
  /**
   * BELLY ROOM (Stage 3): 0..1, the front cut for her belly at that share of 100% (`roomShape`) wherever that is more
   * than she needs now -- each edge the larger of her stretch now and at that size -- so smaller than it, it hangs loose;
   * bigger, it fits as it does without. Takes effect at the next `refit`.
   */
  get bellyRoom(): number { return this.room; }
  set bellyRoom(v: number) { this.room = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; }
  private room = 0;
  private graph: { start: Uint32Array; list: Uint32Array; set: number } | null = null;
  /** The worn sheet's particles' neighbours (CSR over particles), for the set worn now. */
  private wornGraph(): { start: Uint32Array; list: Uint32Array } {
    if (!this.graph || this.graph.set !== this.setVersion) this.graph = { ...neighboursOf(this.sewn, this.worn), set: this.setVersion };
    return this.graph;
  }
  private smoothed(P: Float32Array): Float32Array {
    if (this.fitSmoothing > 0) smoothOver(P, this.wornGraph(), this.fitSmoothing);
    return P;
  }
  /** Her skin under the binding in the shape the garment was tailored from (`tailoredShape`), smoothed over what is worn, and what it was measured for. */
  private tailoredCache: { key: string; shape: Float32Array } | null = null;
  private restShiftNow: Float32Array | null = null;
  private readonly trunkOnly: Uint8Array;
  private capsBefore: Capsules | null = null;
  private readonly shown = { skinMs: 0, simMs: 0, drawMs: 0 };
  private last: ClothStepStats | null = null;
  /** Per particle, how far along the cloth from the drafted neckline's opening (metres; Infinity past PIN_OUT and more). */
  private readonly neckDistance: Float32Array;
  /** Per particle, 1 on the drafted neckline's opening. */
  private readonly onNeck: Uint8Array;
  /** Per particle, the drafted neckline's hold once the garment has settled (`settle`), 0 before. */
  private pinDrafted: Float32Array;
  private settled = false;

  // ---- what is worn (`setCut`) ----
  private cuts: GarmentCuts | null;
  /** False once a cut has changed what is worn: the next frame lays the cloth out again (once, however many cuts came). */
  private laidOut = false;
  /** Slot i is particle order[i]; slotOf[p] is p's slot, -1 when it is not worn. */
  private order = new Uint32Array(0);
  private slotOf: Int32Array;
  /** Per particle, 1 while worn. */
  private worn: Uint8Array;
  /** The worn triangles, by slot; and which of the sheet's triangles they are. */
  private slotTris = new Uint32Array(0);
  private keptTris = new Uint32Array(0);
  /** Per slot: its hold, its weight, whether it is pushed out of her capsules. */
  private pinNow = new Float32Array(0);
  private massNow = new Float32Array(0);
  private maskNow = new Uint8Array(0);
  /** Per particle, the pin offset the skin reads (a cut neckline's edge hugs her), or null for the binding's own. */
  private hug: Float32Array | null = null;
  /** Per particle, 1 where the cut neckline hugs it now. */
  private hugged = new Uint8Array(0);
  /** Bumped each time the SET of worn particles changes (their slots, the smoothing over them), and the set the cut for her shape was taken over. */
  private setVersion = 0;
  private fitSet = 0;
  /** Seconds since what is worn last changed. */
  private layoutAge = Infinity;
  /** Bumped each time the binding changes. */
  private bindingVersion = 0;

  constructor(options: GarmentClothOptions) {
    this.options = options;
    const { sewn, body } = options, n = sewn.count;
    this.sewn = sewn;
    this.binding = options.binding;
    this.trunkOnly = options.trunkOnly;
    this.cuts = options.cuts ?? null;
    const restP = body.geometry.getAttribute('position');
    this.detail = options.detail ? new GarmentDetail(options.detail, n, options.detailDomes !== false, { count: restP.count, at: (v, o) => { o[0] = restP.getX(v); o[1] = restP.getY(v); o[2] = restP.getZ(v); } }, sewn.triangles) : null;
    this.skin = this.skinFor(options.binding);
    // which particles are the neck's (the opening whose edges are named 'neck')
    const neck: number[] = [];
    for (const o of sewn.openings) if (o.edges.some((e) => e.endsWith(':neck'))) neck.push(...o.particles);
    // the pattern's rest lengths, world units; the neckline's own edge at `neckBand` of it (a band sewn on shorter than
    // the opening, as a tee's rib is, holds the neckline in when her arms pull at it)
    this.onNeck = new Uint8Array(n);
    for (const p of neck) this.onNeck[p] = 1;
    const band = options.neckBand ?? 1;
    this.restLengths = new Map();
    for (let e = 0; e < sewn.edgeRest.length; e++) {
      const a = sewn.edges[e * 2], b = sewn.edges[e * 2 + 1];
      this.restLengths.set(a * n + b, sewn.edgeRest[e] * options.unitsPerMetre * (this.onNeck[a] && this.onNeck[b] ? band : 1));
    }
    this.neckDistance = distanceAlong(sewn, neck);
    this.pinDrafted = new Float32Array(n);
    this.slotOf = new Int32Array(n).fill(-1);
    this.worn = new Uint8Array(n);
    this.hugged = new Uint8Array(n);
    // drawing
    const nv = sewn.vertexParticle.length, g = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.normal = new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.cutAttr = new THREE.BufferAttribute(new Float32Array(nv).fill(1), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.position);
    g.setAttribute('normal', this.normal);
    g.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(sewn.uv), 2));
    g.setAttribute(CUT_EDGE_ATTRIBUTE, this.cutAttr);
    if (options.fabricRest) {
      const fr = new Float32Array(nv * 3);
      for (let v = 0; v < nv; v++) { const p = sewn.vertexParticle[v]; for (let c = 0; c < 3; c++) fr[v * 3 + c] = options.fabricRest[p * 3 + c]; }
      g.setAttribute('fabricRest', new THREE.BufferAttribute(fr, 3));
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(fr, 3)); rg.setIndex(new THREE.BufferAttribute(sewn.renderTriangles, 1)); rg.computeVertexNormals();
      g.setAttribute('fabricRestNormal', rg.getAttribute('normal')); rg.dispose();
    }
    // its own copy: the drawn triangles are rewritten to what is worn
    this.index = new THREE.BufferAttribute(sewn.renderTriangles.slice(), 1).setUsage(THREE.DynamicDrawUsage);
    g.setIndex(this.index);
    this.mesh = new THREE.Mesh(g, options.material);
    this.mesh.name = 'sarah-procedural-garment';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.before = createContacts(n); this.after = createContacts(n);
    // what is worn, its slots and the cloth over them
    this.layout();
    this.baseShape = this.skin.restShape(new Float32Array(n * 3));
    this.sim = this.build(null);
    this.fitSet = this.setVersion;
  }

  private skinFor(binding: ClothBinding): ClothSkin {
    const o = this.options;
    return new ClothSkin(o.body, binding, { thickness: this.skin?.thickness ?? o.standOff, armBones: o.armBones, trunkOnly: o.trunkOnly, ...(o.armpitRule === false ? {} : { looseOverArm: LOOSE_OVER_ARM }), rescueOver: RESCUE_OVER * o.unitsPerMetre, neighbours: neighboursOf(this.sewn) });
  }

  /**
   * The cloth over the worn slots, laid on her where it is bound -- or, `carry` given, where those of its particles that
   * were worn already lie in it. Its settings are the last cloth's (the room's dials carry over).
   */
  private build(carry: ClothSim | null, carrySlots: Int32Array | null = null): ClothSim {
    const { settings } = this.options, n = this.active;
    const start = new Float32Array(n * 3);
    this.skin.initial(start);
    const sim = new ClothSim({
      count: n, triangles: this.slotTris, rest: start, pin: this.pinNow, mass: this.massNow,
      restLength: (a, b) => this.restOf(this.order[a], this.order[b]), bendFlat: true, capsuleMask: this.maskNow,
    }, { ...(this.sim?.settings ?? { selfDistance: SELF_DISTANCE * this.options.unitsPerMetre, ...settings, bendCompliance: BEND_COMPLIANCE }) });
    if (carry) {
      const x = carry.positions, was = carrySlots ?? this.slotOf, bound = start.slice(), kept = new Uint8Array(n);
      let joined = 0;
      for (let i = 0; i < n; i++) {
        const j = was[this.order[i]];
        if (j >= 0 && j < carry.count) { start[i * 3] = x[j * 3]; start[i * 3 + 1] = x[j * 3 + 1]; start[i * 3 + 2] = x[j * 3 + 2]; kept[i] = 1; } else joined++;
      }
      if (joined > 0 && joined < n) this.join(start, bound, kept);
    }
    sim.reset(start);
    this.primed = false; this.warm = WARM_SECONDS;
    return sim;
  }

  /**
   * The cloth a cut brings back (worn now, not in the last cloth), into `start`: laid as the worn cloth round it lies --
   * each slot moved from where it is bound (`bound`) by the mean of how far its neighbours already laid have moved from
   * theirs, ring by ring out from the cloth that stayed (`kept`) -- and, once the garment has settled, bound to her where
   * it now starts, as `settle` bound what was worn then: its pins, a cut neckline's hug and a restart all read the
   * binding. Laid where it was tailored and held there, a band brought back after the cloth had settled met it stretched
   * and folded (Stage 3: a V brought up 6 cm from her underbust stood in teeth, an edge at 4.9 times its length).
   */
  private join(start: Float32Array, bound: Float32Array, kept: Uint8Array): void {
    const n = this.active, O = this.order, slot = this.slotOf, G = this.wornGraph(), S = G.start, L = G.list;
    const disp = new Float32Array(n * 3), done = kept.slice();
    for (let i = 0; i < n; i++) if (kept[i]) for (let c = 0; c < 3; c++) disp[i * 3 + c] = start[i * 3 + c] - bound[i * 3 + c];
    let ring: number[];
    do {
      ring = [];
      for (let i = 0; i < n; i++) {
        if (done[i]) continue;
        const p = O[i];
        let k = 0, dx = 0, dy = 0, dz = 0;
        for (let j = S[p]; j < S[p + 1]; j++) { const q = slot[L[j]]; if (q >= 0 && done[q]) { dx += disp[q * 3]; dy += disp[q * 3 + 1]; dz += disp[q * 3 + 2]; k++; } }
        if (k) { disp[i * 3] = dx / k; disp[i * 3 + 1] = dy / k; disp[i * 3 + 2] = dz / k; ring.push(i); }
      }
      // a ring reads only the rings laid before it
      for (const i of ring) done[i] = 1;
    } while (ring.length);
    const joined: number[] = [];
    for (let i = 0; i < n; i++) if (!kept[i]) { for (let c = 0; c < 3; c++) start[i * 3 + c] = bound[i * 3 + c] + disp[i * 3 + c]; joined.push(i); }
    if (!this.settled) return;
    this.skin.update(start, this.after);
    const now = this.skin.contactBinding(start, 0.0005 / 0.9), B = this.binding, close = (HUG_CLEARANCE * this.options.unitsPerMetre) / (this.skin.worldScale || 1);
    for (const i of joined) {
      const p = O[i];
      for (let c = 0; c < 3; c++) { B.tri[p * 3 + c] = now.tri[i * 3 + c]; B.bary[p * 3 + c] = now.bary[i * 3 + c]; }
      B.offset[p] = now.offset[i];
      if (this.hug) this.hug[p] = this.hugged[p] ? Math.min(B.offset[p], close) : B.offset[p];
    }
    this.skin.rebound(joined.map((i) => O[i]));
    // as `rebind`: her shape is read through the binding as it now is, the scale it has carrying over
    this.bindingVersion++;
    this.baseShape = this.skin.restShape(new Float32Array(this.sewn.count * 3));
    this.fitBase = new Map(this.fit);
  }

  /** How many particles are worn (simulated) now. */
  get active(): number { return this.order.length; }
  /** Whether particle `p` is worn now. */
  isWorn(p: number): boolean { return this.worn[p] === 1; }

  /**
   * Cut the garment (`cuts.ts`): from the next frame only the triangles with a corner above 0 are worn, and the material
   * draws the edge along 0. Null wears all of it.
   */
  setCut(cuts: GarmentCuts | null): void {
    this.cuts = cuts;
    this.laidOut = false;
  }

  /**
   * Lay the cloth out again now if a cut has changed it (`frame` does this itself): a new cloth when what is worn or how
   * it is held or weighted changed, the particles that stay keeping where they are and the new ones laid where her body
   * puts them; the same cloth when only the drawn edge moved within the worn triangles (a slider dragged a little).
   */
  layOut(): void {
    if (this.laidOut) return;
    const wasSim = this.sim, wasSlots = this.slotOf.slice(), wasPin = this.pinNow, wasMass = this.massNow;
    const moved = this.layout();
    if (moved || !sameValues(wasPin, this.pinNow) || !sameValues(wasMass, this.massNow)) this.sim = this.build(wasSim, wasSlots);
    this.easeHug();
  }

  /**
   * A cut neckline's hug, let off where holding it would stretch it. The hug holds the neckline's band to her skin; where
   * the line crosses the hollow between her breasts (a U's bottom, a V's point between them), each particle held to the
   * skin under it pulled the edge down into the hollow in teeth, its edges at up to four times their length (Stage 3).
   * Each held particle is let off toward where it lay (its binding's offset), HUG_STEP at a time, until no edge between
   * held particles would be held longer than HUG_STRETCH times its length: the edge bridges the hollow as fabric does,
   * and still lies on her wherever her skin runs along it.
   */
  private easeHug(): void {
    const hug = this.hug;
    if (!hug) return;
    const n = this.sewn.count, list: number[] = [];
    for (let p = 0; p < n; p++) if (this.hugged[p] && this.worn[p]) list.push(p);
    if (!list.length) return;
    const off = this.binding.offset, m = list.length, close = (HUG_CLEARANCE * this.options.unitsPerMetre) / (this.skin.worldScale || 1);
    const atHug = new Float32Array(n), atLay = new Float32Array(n);
    for (const p of list) { atLay[p] = off[p]; atHug[p] = Math.min(off[p], close); }
    const A = this.skin.pinTargets(list, atHug, new Float32Array(m * 3)), B = this.skin.pinTargets(list, atLay, new Float32Array(m * 3));
    const at = new Int32Array(n).fill(-1);
    list.forEach((p, i) => { at[p] = i; });
    const E = this.sewn.edges, k = this.sim.settings.restScale, pairs: number[] = [], most: number[] = [];
    for (let e = 0; e < E.length; e += 2) {
      const i = at[E[e]], j = at[E[e + 1]], L = this.restOf(E[e], E[e + 1]);
      if (i < 0 || j < 0 || !(L !== undefined && L > 0)) continue;
      pairs.push(i, j); most.push(L * k * HUG_STRETCH);
    }
    const s = new Float32Array(m), T = (i: number, c: number) => A[i * 3 + c] + s[i] * (B[i * 3 + c] - A[i * 3 + c]);
    for (let round = 0; round < HUG_ROUNDS; round++) {
      let over = false;
      for (let q = 0; q < most.length; q++) {
        const i = pairs[q * 2], j = pairs[q * 2 + 1];
        if (Math.hypot(T(i, 0) - T(j, 0), T(i, 1) - T(j, 1), T(i, 2) - T(j, 2)) <= most[q]) continue;
        s[i] = Math.min(1, s[i] + HUG_STEP); s[j] = Math.min(1, s[j] + HUG_STEP); over = true;
      }
      if (!over) break;
    }
    for (let i = 0; i < m; i++) { const p = list[i]; hug[p] = atHug[p] + s[i] * (atLay[p] - atHug[p]); }
  }

  /** Each slot's hold now, for a probe or a test (slot i is particle i while all of it is worn). */
  get pin(): Float32Array { return this.pinNow; }
  /** Her shape the garment was tailored from, as the cut reads it now (`tailored`), for a probe or a test. */
  get tailoredBase(): Float32Array | null { return this.tailored(); }

  /**
   * What is worn as the cut stands, and so which particles are simulated (in particle order, packed into slots) and how
   * each is held and weighted. True when the set of worn particles changed.
   */
  private layout(): boolean {
    this.laidOut = true;
    const { sewn } = this, n = sewn.count, T = sewn.triangles, R = sewn.renderTriangles, vp = sewn.vertexParticle;
    const keep = this.cuts?.keep ?? null, neckField = this.cuts?.neck ?? null;
    const nT = T.length / 3, kept: number[] = [], worn = new Uint8Array(n);
    for (let t = 0; t < nT; t++) {
      if (keep && !(Math.max(keep[R[t * 3]], keep[R[t * 3 + 1]], keep[R[t * 3 + 2]]) > 0)) continue;
      kept.push(t); worn[T[t * 3]] = worn[T[t * 3 + 1]] = worn[T[t * 3 + 2]] = 1;
    }
    let m = 0;
    for (let p = 0; p < n; p++) m += worn[p];
    const order = new Uint32Array(m);
    m = 0;
    for (let p = 0; p < n; p++) if (worn[p]) order[m++] = p;
    const moved = order.length !== this.order.length || order.some((p, i) => p !== this.order[i]);
    this.order = order; this.worn = worn;
    this.slotOf.fill(-1);
    order.forEach((p, i) => { this.slotOf[p] = i; });
    if (moved) { this.setVersion++; this.layoutAge = 0; }
    // the worn triangles, by slot, and drawn
    this.keptTris = Uint32Array.from(kept);
    this.slotTris = new Uint32Array(kept.length * 3);
    const I = this.index.array as Uint32Array;
    kept.forEach((t, j) => { for (let c = 0; c < 3; c++) { this.slotTris[j * 3 + c] = this.slotOf[T[t * 3 + c]]; I[j * 3 + c] = R[t * 3 + c]; } });
    this.index.needsUpdate = true;
    this.mesh?.geometry.setDrawRange(0, kept.length * 3);
    const C = this.cutAttr.array as Float32Array;
    if (keep) C.set(keep); else C.fill(1);
    this.cutAttr.needsUpdate = true;
    this.detail?.setTriangles(this.slotTris);
    // where the worn cloth ends: its open edges (edges of one worn triangle only)
    const uses = new Map<number, number>();
    for (const t of kept) for (let c = 0; c < 3; c++) {
      const a = T[t * 3 + c], b = T[t * 3 + (c + 1) % 3], key = a < b ? a * n + b : b * n + a;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
    const edge = new Uint8Array(n);
    for (const [key, k] of uses) if (k === 1) { edge[Math.floor(key / n)] = 1; edge[key % n] = 1; }
    // each worn particle's nearest cut line, and the neckline's (signed: under 0 is the cut-away side)
    const nearCut = new Float32Array(n).fill(Infinity), nearNeck = new Float32Array(n).fill(Infinity);
    if (keep) for (let v = 0; v < vp.length; v++) {
      const p = vp[v];
      if (!worn[p]) continue;
      const k = Math.abs(keep[v]); if (k < nearCut[p]) nearCut[p] = k;
      const q = neckField ? neckField[v] : Infinity; if (q < nearNeck[p]) nearNeck[p] = q;
    }
    const held = (d: number) => (d <= PIN_IN ? 1 : d >= PIN_OUT ? 0 : 1 - (d - PIN_IN) / (PIN_OUT - PIN_IN));
    this.pinNow = new Float32Array(m); this.massNow = new Float32Array(m).fill(1); this.maskNow = new Uint8Array(m);
    let hugged = false;
    const offset = this.binding.offset, close = (HUG_CLEARANCE * this.options.unitsPerMetre) / (this.skin.worldScale || 1);
    const hug = this.hug ?? new Float32Array(n);
    hug.set(offset.subarray(0, n));
    this.hugged.fill(0);
    for (let i = 0; i < m; i++) {
      const p = order[i];
      let pin = this.settled ? this.pinDrafted[p] : 0;
      const neckCut = nearNeck[p] < Infinity;
      // a cut neckline is held as the drafted one is, once settled, and to her skin under it
      if (this.settled && neckCut) { const h = held(nearNeck[p]); if (h > 0) { pin = Math.max(pin, h); hug[p] = Math.min(offset[p], close); hugged = true; this.hugged[p] = 1; } }
      this.pinNow[i] = pin;
      // its edges weigh as a hem does -- the neckline's are held instead
      const nearNeckline = this.onNeck[p] === 1 || (neckCut && nearNeck[p] < PIN_OUT);
      if (!nearNeckline && (edge[p] === 1 || nearCut[p] < CUT_EDGE_BAND)) this.massNow[i] = EDGE_MASS;
      this.maskNow[i] = this.trunkOnly[p];
    }
    this.hug = hugged ? hug : null;
    this.skin.setOrder(order);
    this.skin.pinOffset = this.hug;
    return moved;
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
   * shape smoothed over the worn sheet (`FIT_SMOOTHING`), and not down the underside of her belly (`HANG_FROM`): its
   * size then depends on her shape now and on nothing she was before. BELLY ROOM takes the larger of each edge's stretch
   * now and at the room's size.
   */
  refit(): void {
    this.layOut();
    const n = this.sewn.count, len = (P: Float32Array, a: number, b: number) => Math.hypot(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]);
    const T = this.tailored();
    if (T) {
      // her skin points now and her normals under them; each edge her stretch since she was tailored, except down the
      // underside of her belly, where it hangs
      // (an edge's slope down her and the way her skin faces are both read from her shape as it is, not smoothed)
      const shapeNow = (): { raw: Float32Array; N: Float32Array; now: Float32Array } => {
        const N = new Float32Array(n * 3), raw = this.skin.restShape(new Float32Array(n * 3), this.fitOffset, N);
        return { raw, N, now: this.smoothed(raw.slice()) };
      };
      const cur = shapeNow();
      let room: { raw: Float32Array; N: Float32Array; now: Float32Array } | null = null;
      if (this.room > 0 && this.options.roomShape) this.options.roomShape(this.room, () => { room = shapeNow(); });
      const ease = (t: number) => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u); };
      const [from0, to0] = this.hang, g0 = HANG_GROWN_FROM, g1 = HANG_GROWN_TO, hangs = from0 > to0;
      const stretch = (s: { raw: Float32Array; N: Float32Array; now: Float32Array }, a: number, b: number, lb: number): number => {
        const hang = (p: number, from: number, to: number) => ease((from - s.N[p * 3 + 1]) / (from - to));
        const ln = len(s.now, a, b);
        let r = lb > 1e-6 && Number.isFinite(ln) ? ln / lb : 1;
        const lr = len(s.raw, a, b), down = lr > 1e-6 ? Math.abs(s.raw[b * 3 + 1] - s.raw[a * 3 + 1]) / lr : 0;
        if (hangs) {
          // where she has grown far past the tee, it hangs from level (HANG_BIG_FROM)
          const big = ease((r - g0) / (g1 - g0)), from = from0 + (HANG_BIG_FROM - from0) * big, to = to0 + (HANG_BIG_TO - to0) * big;
          r = 1 + (r - 1) * (1 - down * (hang(a, from, to) + hang(b, from, to)) / 2);
        }
        return r;
      };
      const roomNow = room as { raw: Float32Array; N: Float32Array; now: Float32Array } | null;
      for (const k of this.restLengths.keys()) {
        const a = Math.floor(k / n), b = k % n, lb = len(T, a, b);
        let r = stretch(cur, a, b, lb);
        if (roomNow) r = Math.max(r, stretch(roomNow, a, b, lb));
        this.fit.set(k, Math.min(FIT_MAX, Math.max(FIT_MIN, r)));
      }
    } else {
      const now = this.skin.restShape(new Float32Array(n * 3)), B = this.baseShape;
      for (const k of this.restLengths.keys()) {
        const a = Math.floor(k / n), b = k % n, lb = len(B, a, b), ln = len(now, a, b);
        const r = lb > 1e-6 && Number.isFinite(ln) ? Math.min(FIT_MAX, Math.max(FIT_MIN, ln / lb)) : 1;
        this.fit.set(k, (this.fitBase.get(k) ?? 1) * r);
      }
    }
    this.fitSet = this.setVersion;
    this.sim = this.build(this.sim);
  }

  /** Lay the cloth on her again where it is bound (a pose switch: otherwise it would be flung). */
  restart(): void { this.layOut(); this.sim = this.build(null); }

  /**
   * Bind every worn particle where it lies on her now and hold the neckline there (after the garment has settled,
   * dressed): from here on a restart lays it as it settled, and the neck band -- and a cut neckline's edge -- keeps its
   * place on her. What is not worn keeps the binding it had.
   */
  settle(): void {
    this.layOut();
    const m = this.active, x = this.sim.positions.subarray(0, m * 3);
    // her skin under every particle as it lies NOW (the frame's own reading was taken before its step moved them)
    this.skin.update(x, this.after);
    const now = this.skin.contactBinding(x, 0.0005 / 0.9), was = this.binding, n = this.sewn.count;
    const tri = was.tri.slice(0, n * 3), bary = was.bary.slice(0, n * 3), offset = was.offset.slice(0, n);
    for (let i = 0; i < m; i++) {
      const p = this.order[i];
      for (let c = 0; c < 3; c++) { tri[p * 3 + c] = now.tri[i * 3 + c]; bary[p * 3 + c] = now.bary[i * 3 + c]; }
      offset[p] = now.offset[i];
    }
    if (m < n) this.bindUnworn(x, tri, bary, offset);
    this.rebind({ count: n, tri, bary, offset });
    const held = (d: number) => (d <= PIN_IN ? 1 : d >= PIN_OUT ? 0 : 1 - (d - PIN_IN) / (PIN_OUT - PIN_IN));
    this.pinDrafted = Float32Array.from(this.neckDistance, (d) => held(d));
    this.settled = true;
    const wasSim = this.sim, wasSlots = this.slotOf.slice();
    this.layout();
    this.sim = this.build(wasSim, wasSlots);
    this.easeHug();
  }

  /**
   * At `settle`, the cloth not worn (`x` the worn cloth's places, by slot): bound where it would lie had it moved as the
   * worn cloth round it has moved from where it was bound -- each particle by the mean of how far its neighbours already
   * placed have moved, ring by ring out from the worn cloth -- into `tri`, `bary` and `offset` (particle order). Every
   * particle's binding then says where the settled garment has it, so a cut that brings cloth back (`join`) lays it
   * level with the cloth round it: left as tailored, the cloth below a settled hem lay where the tee was tailored, a
   * slide away from the cloth it was sewn to.
   */
  private bindUnworn(x: Float32Array, tri: Uint32Array, bary: Float32Array, offset: Float32Array): void {
    const n = this.sewn.count, m = this.active, O = this.order, G = neighboursOf(this.sewn), S = G.start, L = G.list;
    // every particle's place as bound now, as she stands
    this.skin.setOrder(null);
    const place = this.skin.initial(new Float32Array(n * 3)), disp = new Float32Array(n * 3), done = new Uint8Array(n);
    for (let i = 0; i < m; i++) { const p = O[i]; done[p] = 1; for (let c = 0; c < 3; c++) disp[p * 3 + c] = x[i * 3 + c] - place[p * 3 + c]; }
    let ring: number[];
    do {
      ring = [];
      for (let p = 0; p < n; p++) {
        if (done[p]) continue;
        let k = 0, dx = 0, dy = 0, dz = 0;
        for (let j = S[p]; j < S[p + 1]; j++) { const q = L[j]; if (done[q]) { dx += disp[q * 3]; dy += disp[q * 3 + 1]; dz += disp[q * 3 + 2]; k++; } }
        if (k) { disp[p * 3] = dx / k; disp[p * 3 + 1] = dy / k; disp[p * 3 + 2] = dz / k; ring.push(p); }
      }
      for (const p of ring) done[p] = 1;
    } while (ring.length);
    // all of it where it would lie, its skin read there, the unworn bound there
    const all = new Float32Array(n * 3), contacts = createContacts(n);
    for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) all[p * 3 + c] = place[p * 3 + c] + disp[p * 3 + c];
    this.skin.update(all, contacts);
    const at = this.skin.contactBinding(all, 0.0005 / 0.9);
    for (let p = 0; p < n; p++) {
      if (this.worn[p]) continue;
      for (let c = 0; c < 3; c++) { tri[p * 3 + c] = at.tri[p * 3 + c]; bary[p * 3 + c] = at.bary[p * 3 + c]; }
      offset[p] = at.offset[p];
    }
    this.skin.setOrder(O);
  }

  private rebind(binding: ClothBinding): void {
    // ClothSkin keeps its binding; a new one means a new reader over the same body
    this.binding = binding;
    this.skin = this.skinFor(binding);
    this.skin.restShift = this.restShiftNow;
    this.skin.setOrder(this.order);
    this.skin.pinOffset = this.hug;
    this.bindingVersion++;
    // her shape is read through the new binding from here on: the scale it has now carries over (or, tailored from a
    // known shape, that shape is read again through it)
    this.baseShape = this.skin.restShape(new Float32Array(this.sewn.count * 3));
    this.fitBase = new Map(this.fit);
  }

  /** Her skin points under the binding with her body in the shape the garment was tailored from, no build (`tailoredShape`), smoothed over what is worn. */
  private tailored(): Float32Array | null {
    const shape = this.options.tailoredShape;
    if (!shape) return null;
    const key = `${this.setVersion}|${this.bindingVersion}|${this.fitOffset}|${this.fitSmoothing}`;
    if (this.tailoredCache?.key === key) return this.tailoredCache.shape;
    const out = new Float32Array(this.sewn.count * 3), keep = this.skin.restShift;
    shape(() => { this.skin.restShift = null; this.skin.restShape(out, this.fitOffset); });
    this.skin.restShift = keep;
    this.tailoredCache = { key, shape: this.smoothed(out) };
    return this.tailoredCache.shape;
  }

  /** One frame. `capsules`: her arms (world), this frame; the previous frame's are interpolated from. */
  frame(dt: number, capsules?: Capsules): void {
    this.layOut();
    // what is worn changed a moment ago and has stood since: cut it for her shape over what is worn now
    this.layoutAge += dt;
    if (this.fitSet !== this.setVersion && this.layoutAge >= REFIT_SETTLE && this.options.tailoredShape) this.refit();
    const n = this.active, x = this.sim.positions;
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
    const normals = this.sim.normals(), P = this.position.array as Float32Array, N = this.normal.array as Float32Array, vp = this.sewn.vertexParticle, slot = this.slotOf;
    const lift = this.options.drawLift ?? 0;
    for (let v = 0; v < vp.length; v++) {
      const s = slot[vp[v]];
      if (s < 0) continue;
      const q = s * 3, o = v * 3;
      N[o] = normals[q]; N[o + 1] = normals[q + 1]; N[o + 2] = normals[q + 2];
      P[o] = x[q] + lift * N[o]; P[o + 1] = x[q + 1] + lift * N[o + 1]; P[o + 2] = x[q + 2] + lift * N[o + 2];
    }
    this.position.needsUpdate = true; this.normal.needsUpdate = true;
    const k = 1 / SMOOTHING, s = this.shown;
    s.skinMs += (skinMs - s.skinMs) * k; s.simMs += (stats.ms - s.simMs) * k; s.drawMs += (performance.now() - t1 - s.drawMs) * k;
    this.last = stats;
  }

  get simSettings(): ClothSettings { return this.sim.settings; }
  set standOff(units: number) { this.skin.thickness = Math.max(0.01, units); }

  stats(): GarmentClothStats {
    return {
      particles: this.active, triangles: this.keptTris.length, edges: this.sim.edges.length / 2, bends: this.sim.bendPairs.length / 2,
      skinMs: this.shown.skinMs, simMs: this.shown.simMs, drawMs: this.shown.drawMs, posed: this.skin.posed,
      contacts: this.last?.contacts ?? 0, capsuleContacts: this.last?.capsuleContacts ?? 0, substeps: this.last?.substeps ?? 0,
    };
  }

  /**
   * How every worn edge stands against its pattern length now (length / (pattern x restScale)), over the particles
   * `where` says (all when absent): min, max, the 95th percentile, and how many are past 1.4 and 1.6.
   */
  strain(where?: (particle: number) => boolean): { min: number; max: number; p95: number; over14: number; over16: number; edges: number } {
    const x = this.sim.positions, E = this.sim.edges, k = this.sim.settings.restScale, O = this.order, r: number[] = [];
    for (let e = 0; e < E.length; e += 2) {
      const i = E[e], j = E[e + 1], a = O[i], b = O[j];
      if (where && !(where(a) && where(b))) continue;
      const rest = (this.restOf(a, b) ?? 0) * k;
      if (!(rest > 0)) continue;
      r.push(Math.hypot(x[j * 3] - x[i * 3], x[j * 3 + 1] - x[i * 3 + 1], x[j * 3 + 2] - x[i * 3 + 2]) / rest);
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
   * Per particle now: the least and most strain of its worn edges (length over rest) and the sharpest fold between two
   * worn triangles that meet at it (degrees), 3 numbers a particle -- where the cloth is squeezed, pulled and creased, for
   * a probe's map. A particle not worn reads (Infinity, 0, 0).
   */
  strainMap(): Float32Array {
    const n = this.sewn.count, x = this.sim.positions, E = this.sim.edges, k = this.sim.settings.restScale, O = this.order, out = new Float32Array(n * 3);
    for (let p = 0; p < n; p++) { out[p * 3] = Infinity; out[p * 3 + 1] = 0; }
    for (let e = 0; e < E.length; e += 2) {
      const i = E[e], j = E[e + 1], a = O[i], b = O[j], rest = (this.restOf(a, b) ?? 0) * k;
      if (!(rest > 0)) continue;
      const r = Math.hypot(x[j * 3] - x[i * 3], x[j * 3 + 1] - x[i * 3 + 1], x[j * 3 + 2] - x[i * 3 + 2]) / rest;
      for (const p of [a, b]) { out[p * 3] = Math.min(out[p * 3], r); out[p * 3 + 1] = Math.max(out[p * 3 + 1], r); }
    }
    const T = this.slotTris, nT = T.length / 3, N = triangleNormals(x, T), first = new Map<number, number>(), m = this.active;
    for (let t = 0; t < nT; t++) for (let j = 0; j < 3; j++) {
      const p = T[t * 3 + j], q = T[t * 3 + (j + 1) % 3], key = p < q ? p * m + q : q * m + p, u = first.get(key);
      if (u === undefined) { first.set(key, t); continue; }
      const d = N[t * 3] * N[u * 3] + N[t * 3 + 1] * N[u * 3 + 1] + N[t * 3 + 2] * N[u * 3 + 2];
      const deg = (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
      for (const v of [O[p], O[q]]) out[v * 3 + 2] = Math.max(out[v * 3 + 2], deg);
    }
    return out;
  }

  /**
   * The `k` most stretched worn edges now (length over rest), with their particles, where the first one is (world), how
   * far each end stands off her skin at its last contact (world units; below 0, inside her) and the floor it was given:
   * for a probe.
   */
  worst(k: number): { ratio: number; a: number; b: number; at: [number, number, number]; off: [number, number]; floor: [number, number] }[] {
    const x = this.sim.positions, E = this.sim.edges, scale = this.sim.settings.restScale, O = this.order, r: { ratio: number; a: number; b: number; at: [number, number, number]; off: [number, number]; floor: [number, number] }[] = [];
    // how far each end stands off her skin along her normal at its last contact (below 0: inside her), and its floor
    const c = this.before, off = (i: number) => (x[i * 3] - c.point[i * 3]) * c.normal[i * 3] + (x[i * 3 + 1] - c.point[i * 3 + 1]) * c.normal[i * 3 + 1] + (x[i * 3 + 2] - c.point[i * 3 + 2]) * c.normal[i * 3 + 2];
    for (let e = 0; e < E.length; e += 2) {
      const i = E[e], j = E[e + 1], rest = (this.restOf(O[i], O[j]) ?? 0) * scale;
      if (!(rest > 0)) continue;
      const ratio = Math.hypot(x[j * 3] - x[i * 3], x[j * 3 + 1] - x[i * 3 + 1], x[j * 3 + 2] - x[i * 3 + 2]) / rest;
      if (r.length < k || ratio > r[r.length - 1].ratio) { r.push({ ratio, a: O[i], b: O[j], at: [x[i * 3], x[i * 3 + 1], x[i * 3 + 2]], off: [off(i), off(j)], floor: [c.standOff[i], c.standOff[j]] }); r.sort((p, q) => q.ratio - p.ratio); if (r.length > k) r.pop(); }
    }
    return r;
  }

  /**
   * Every worn edge with both ends inside the box `lo`..`hi` (world) now: its particles, its rest length (world units,
   * restScale and cut included) and its length: for a probe.
   */
  edgesIn(lo: readonly number[], hi: readonly number[]): { a: number; b: number; rest: number; len: number }[] {
    const x = this.sim.positions, E = this.sim.edges, k = this.sim.settings.restScale, O = this.order, out: { a: number; b: number; rest: number; len: number }[] = [];
    const inside = (i: number) => x[i * 3] >= lo[0] && x[i * 3] <= hi[0] && x[i * 3 + 1] >= lo[1] && x[i * 3 + 1] <= hi[1] && x[i * 3 + 2] >= lo[2] && x[i * 3 + 2] <= hi[2];
    for (let e = 0; e < E.length; e += 2) {
      const i = E[e], j = E[e + 1];
      if (!inside(i) || !inside(j)) continue;
      out.push({ a: O[i], b: O[j], rest: (this.restOf(O[i], O[j]) ?? 0) * k, len: Math.hypot(x[j * 3] - x[i * 3], x[j * 3 + 1] - x[i * 3 + 1], x[j * 3 + 2] - x[i * 3 + 2]) });
    }
    return out;
  }

  /** The `k` worn particles furthest inside her skin now (stand-off below 0, world units), where they are and their floors: for a probe. */
  deepest(k: number): { p: number; off: number; floor: number; at: [number, number, number] }[] {
    const x = this.sim.positions, c = this.before, r: { p: number; off: number; floor: number; at: [number, number, number] }[] = [];
    for (let i = 0; i < this.active; i++) {
      const o = (x[i * 3] - c.point[i * 3]) * c.normal[i * 3] + (x[i * 3 + 1] - c.point[i * 3 + 1]) * c.normal[i * 3 + 1] + (x[i * 3 + 2] - c.point[i * 3 + 2]) * c.normal[i * 3 + 2];
      if (!(o < 0)) continue;
      if (r.length < k || o < r[r.length - 1].off) { r.push({ p: this.order[i], off: o, floor: c.standOff[i], at: [x[i * 3], x[i * 3 + 1], x[i * 3 + 2]] }); r.sort((a, b) => a.off - b.off); if (r.length > k) r.pop(); }
    }
    return r;
  }

  /** How far particle `p` is from its last contact on her skin (world units; NaN when it is not worn): for a probe. */
  contactOf(p: number): number {
    const i = this.slotOf[p];
    if (i < 0) return NaN;
    const x = this.sim.positions, c = this.before;
    return Math.hypot(x[i * 3] - c.point[i * 3], x[i * 3 + 1] - c.point[i * 3 + 1], x[i * 3 + 2] - c.point[i * 3 + 2]);
  }

  /**
   * How sharply the worn sheet folds now: the angle between every two neighbouring triangles' planes (degrees), its
   * largest, 99th percentile and how many pass `over` degrees, everywhere or only where `where` holds for all four
   * corners (particles): for a probe.
   */
  folds(over = 70, where?: (particle: number) => boolean): { max: number; p99: number; over: number; hinges: number } {
    const T = this.slotTris, x = this.sim.positions, nT = T.length / 3, N = triangleNormals(x, T), O = this.order;
    const m = this.active, first = new Map<number, number>(), angles: number[] = [];
    for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
      const p = T[t * 3 + k], q = T[t * 3 + (k + 1) % 3], key = p < q ? p * m + q : q * m + p;
      const u = first.get(key);
      if (u === undefined) { first.set(key, t); continue; }
      if (where) { let ok = true; for (const v of [T[t * 3], T[t * 3 + 1], T[t * 3 + 2], T[u * 3], T[u * 3 + 1], T[u * 3 + 2]]) if (!where(O[v])) ok = false; if (!ok) continue; }
      const d = N[t * 3] * N[u * 3] + N[t * 3 + 1] * N[u * 3 + 1] + N[t * 3 + 2] * N[u * 3 + 2];
      angles.push((Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI);
    }
    angles.sort((p, q) => p - q);
    return { max: angles[angles.length - 1] ?? 0, p99: angles[Math.floor(angles.length * 0.99)] ?? 0, over: angles.filter((v) => v > over).length, hinges: angles.length };
  }

  /** BREAST and NAVEL DETAIL (0 hidden, 1 all of it): how the cloth lies over her navel and nipples, set by the room. */
  set detailKeep(keep: { nipple: number; navel: number }) { if (this.detail) this.detail.keep = keep; }

  /** The detail softening (`GarmentDetail.shade`) and each detail's spacing and widening now: for a probe. */
  detailShade(patch?: Partial<{ spread: number; widen: number; slope: number; grow: number }>): { shade: { spread: number; widen: number; slope: number; grow?: number }; spacing: number[]; widened: number[] } | null {
    if (!this.detail) return null;
    if (patch) this.detail.shade = { ...this.detail.shade, ...patch };
    return { shade: this.detail.shade, spacing: [...this.detail.spacing], widened: [...this.detail.widened] };
  }

  /** What the room draws through the fabric at BREAST and NAVEL DETAIL (`clothDetail.ts`), as the cloth tee; null without `detail`. */
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
    const x = this.sim.positions, T = this.slotTris, [nx, ny, nz] = d.n;
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

  /**
   * How far the garment stands off each of her navel and nipples now, along the detail's axis, from its tip: the least
   * over the particles within `DETAIL_LOOK.domeIn` of the inner ring's radius of the axis -- the dome's flat top, where
   * the cloth must stand above the tip (world units; below 0, the tip is through the cloth). For a probe; null without
   * `detail`.
   */
  detailGap(): { navel: number; nipples: number[] } | null {
    if (!this.detail) return null;
    // the SHEET over each tip, not its particles: the line through the tip along the detail's axis, met by the sheet's
    // triangles (Möller-Trumbore); the gap is the nearest crossing's height above the tip (below 0, the tip is through
    // it). A detail's flat top can lie between particles, so a measure of the particles alone could miss the hole.
    const x = this.sim.positions, T = this.slotTris;
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


  /** The sheet's unit normals now, one per particle (world, particle order; NaN where not worn), each turned to face away from her skin: for a probe. */
  drawNormals(): Float32Array {
    const S = this.sim.normals(), c = this.before.normal, N = new Float32Array(this.sewn.count * 3).fill(NaN);
    for (let i = 0; i < this.active; i++) {
      const p = this.order[i], s = S[i * 3] * c[i * 3] + S[i * 3 + 1] * c[i * 3 + 1] + S[i * 3 + 2] * c[i * 3 + 2] < 0 ? -1 : 1;
      N[p * 3] = s * S[i * 3]; N[p * 3 + 1] = s * S[i * 3 + 1]; N[p * 3 + 2] = s * S[i * 3 + 2];
    }
    return N;
  }

  /** The particles' positions now (world, 3 each, particle order; NaN where not worn): for a probe. */
  get positions(): Float32Array {
    const x = this.sim.positions, out = new Float32Array(this.sewn.count * 3).fill(NaN);
    for (let i = 0; i < this.active; i++) { const p = this.order[i]; out[p * 3] = x[i * 3]; out[p * 3 + 1] = x[i * 3 + 1]; out[p * 3 + 2] = x[i * 3 + 2]; }
    return out;
  }

  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); }
}

function cloneCapsules(c: Capsules): Capsules { return { count: c.count, a: c.a.slice(), b: c.b.slice(), radius: c.radius.slice() }; }

/** Whether two per-slot arrays hold the same values. */
function sameValues(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Unit normals of triangles over positions (3 each). */
function triangleNormals(x: Float32Array, T: Uint32Array): Float32Array {
  const nT = T.length / 3, N = new Float32Array(nT * 3);
  for (let t = 0; t < nT; t++) {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const ux = x[b] - x[a], uy = x[b + 1] - x[a + 1], uz = x[b + 2] - x[a + 2], vx = x[c] - x[a], vy = x[c + 1] - x[a + 1], vz = x[c + 2] - x[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    N[t * 3] = nx / l; N[t * 3 + 1] = ny / l; N[t * 3 + 2] = nz / l;
  }
  return N;
}

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
