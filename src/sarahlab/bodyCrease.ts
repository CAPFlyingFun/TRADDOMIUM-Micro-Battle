/**
 * HER CREASE, ON HER: the three.js side of `view/creaseRelax.ts` (Joshua, 2026-10-26: "when I start to max out the
 * breast size with everything at max, there is a gap between the breasts and belly which can look weird especially if
 * wearing the bikini or cropped top... look at the base model to see how we can blend and merge that area smoother";
 * and "noticed it mainly below belly 100%").
 *
 * Her shape is summed in two places: the shape fields on the CPU (`bodyShapeView.ts`, into the position and normal
 * attributes) and the morph targets on the GPU (belly, breast growth, upper belly...). The fold under her breasts is in
 * that SUM, so it is measured on it: the attributes plus every morph as weighted now, at the vertices round her chest.
 * What `relaxCrease` asks to change is then written into the attributes so that, with the morphs added on top, she draws
 * the repaired shape: a move adds to the position, and a repaired normal is written as itself less the morphs' normal
 * offsets, so the sum the shader normalizes points where the surface does.
 *
 * Laid, it is held as the values it replaced, so `lift` puts the attributes back exactly before her shape is summed
 * again; and every answer is kept with the shape it was worked out for, so a look that changed nothing her crease sees (a
 * garment, a colour) lays it again at once. A new shape is worked out in a worker (`view/creaseWorker.ts`) once her
 * controls have rested (`CREASE_SETTLE_MS`), one at a time and always the newest; it is laid when it comes back if she
 * is still that shape. Where a worker cannot start it is worked out on the page, the same arithmetic.
 */
import * as THREE from 'three';
import { prepareCrease, relaxCrease, type CreaseMesh, type CreaseResult } from '../view/creaseRelax';
import { zoneTest, type CreaseReply, type CreaseRequest, type CreaseZoneBox } from '../view/creaseWorker';
import { FACE_REST_OFFSET, FACE_REST_SCALE } from './faceRig';

/**
 * Where it looks, in her rest metres: her chest and upper belly, front and sides, from below her ribs to above her
 * breasts. MEASURED on `sarah-v2-body-slim.glb` across every breast and belly control at both ends: every fold and
 * crossing the summed shapes made fell inside it. With the frame from her geometry's units (`faceRig.ts`).
 */
export const SARAH_V2_CREASE_ZONE: CreaseZoneBox = Object.freeze({
  halfWidth: 0.24, yFrom: 1.06, yTo: 1.42, zFrom: -0.09, scale: FACE_REST_SCALE, offset: FACE_REST_OFFSET,
});

/** How long her controls must be still before her crease is worked out, ms. */
export const CREASE_SETTLE_MS = 120;

/** Whether a point of her geometry (its own units) is in the zone. */
export const inSarahCreaseZone = zoneTest(SARAH_V2_CREASE_ZONE);

interface Laid {
  readonly mesh: THREE.Mesh;
  readonly position: THREE.BufferAttribute;
  readonly normal: THREE.BufferAttribute;
  readonly vertices: Uint32Array;
  readonly oldPosition: Float32Array;
  readonly oldNormal: Float32Array;
  /** the shape it was laid on: her shape fields' key, and the whole key with the morphs */
  readonly fieldsKey: string;
  readonly key: string;
}

/** What her crease asked for, kept with the shape it was asked about. */
interface Answer { readonly mesh: THREE.Mesh; readonly key: string; readonly result: CreaseResult }

/** Her body as the room last summed it: the mesh, its shape fields' key and her approved rest shape. */
interface Current { readonly mesh: THREE.Mesh; readonly fieldsKey: string; readonly base: Float32Array; readonly baseNormal: Float32Array }

/**
 * One body's crease. `relay` each time the room has summed her (shape fields and morph weights set): true when an answer
 * for this very shape is laid; `request` (once she is still) when it is not.
 *
 * Summing her again does not disturb what is laid unless her shape fields change, and when they do they rewrite her
 * attributes whole from her approved shape: so a laid answer still standing on an unchanged shape is simply left there
 * (no upload of her two largest attributes for a look that changed nothing), one standing on fields summed afresh is
 * forgotten (there is nothing left of it to take off), and one standing under morph weights that changed is lifted.
 */
export class BodyCrease {
  private laid: Laid | null = null;
  private answers: Answer[] = [];
  private current: Current | null = null;
  // the worker: undefined until first wanted, null where none can run (then the page works it out)
  private worker: Worker | null | undefined = undefined;
  private workerBody: { readonly mesh: THREE.Mesh; readonly id: number; reps: Uint32Array | null } | null = null;
  private inflight: { readonly seq: number; readonly mesh: THREE.Mesh; readonly key: string } | null = null;
  private wanted = false;
  private seq = 0;
  private bodies = 0;
  private local: { readonly mesh: THREE.Mesh; readonly crease: CreaseMesh } | null = null;
  /** the last answer laid or worked out, how long working it out took, and preparing (for the room's probe) */
  last: CreaseResult | null = null;
  ms = 0;
  prepareMs = 0;
  /** where it was last worked out */
  where: 'worker' | 'page' | '' = '';
  /** false: nothing is laid (a probe comparing her shape as summed); answers that arrive are kept, not laid */
  enabled = true;
  /** called when an answer is laid after the room summed her (garments that read her skin may follow it) */
  onLaid: (() => void) | null = null;
  /**
   * Where her bones carry her rest shape before it is drawn, at the vertices asked for (geometry units, 3 a vertex), or
   * null where they carry it nowhere: her BUILD (`view/bodyBuild.ts`) moves bones at rest. Her shape is only whole once
   * that is added -- the build's field moves skin on different bones apart in rest space, for the moved bones to bring
   * back together -- so her crease is looked for on that sum. Its answer is laid as it comes: a move at rest is the same
   * move however far her bones carry it.
   */
  shift: ((mesh: THREE.Mesh, vertices: Uint32Array) => Float32Array | null) | null = null;

  /** The morph targets whose weights move every frame (her belly's spring and the like): not part of her shape's key. */
  constructor(private readonly moving: readonly string[] = []) {}

  /** Whether an answer is still being worked out or waited for. */
  get busy(): boolean { return this.inflight !== null || this.wanted; }

  /** Put back what is laid, exactly (nothing when her attributes were replaced since). */
  lift(): void {
    const l = this.laid;
    if (!l) return;
    this.laid = null;
    const g = l.mesh.geometry;
    if (g.getAttribute('position') !== l.position || g.getAttribute('normal') !== l.normal) return;
    const P = l.position.array as Float32Array, N = l.normal.array as Float32Array;
    for (let k = 0; k < l.vertices.length; k += 1) {
      const v = 3 * l.vertices[k];
      P[v] = l.oldPosition[3 * k]; P[v + 1] = l.oldPosition[3 * k + 1]; P[v + 2] = l.oldPosition[3 * k + 2];
      N[v] = l.oldNormal[3 * k]; N[v + 1] = l.oldNormal[3 * k + 1]; N[v + 2] = l.oldNormal[3 * k + 2];
    }
    l.position.needsUpdate = true;
    l.normal.needsUpdate = true;
  }

  /** Her body as summed now; lays the kept answer if one was worked out for this very shape (false when none was). */
  relay(mesh: THREE.Mesh, fieldsKey: string, base: Float32Array, baseNormal: Float32Array): boolean {
    this.current = { mesh, fieldsKey, base, baseNormal };
    const key = this.key(mesh, fieldsKey), l = this.laid;
    if (l) {
      const g = l.mesh.geometry, same = l.mesh === mesh && g.getAttribute('position') === l.position && g.getAttribute('normal') === l.normal;
      // her fields summed afresh (or another body): her attributes were rewritten whole, and nothing of it is left
      if (!same || l.fieldsKey !== fieldsKey) this.laid = null;
      else if (l.key === key) { this.wanted = false; return true; }
      else this.lift();
    }
    const a = this.answers.find((x) => x.mesh === mesh && x.key === key);
    if (!a) return false;
    this.wanted = false;
    this.lay(mesh, a.result, fieldsKey, key);
    this.last = a.result;
    return true;
  }

  /** Work out her shape as last summed (in the worker, or here), and lay it when it is still her shape. */
  request(): void {
    if (!this.current) return;
    this.wanted = true;
    this.pump();
  }

  /** Forget everything (a new model, the room closing); the worker stays for the next body. */
  reset(): void {
    this.lift();
    this.answers = [];
    this.current = null;
    this.wanted = false;
    this.inflight = null;
    this.local = null;
    this.workerBody = null;
    this.last = null;
  }

  /** The worker goes (the room closing). */
  dispose(): void {
    this.reset();
    this.worker?.terminate();
    this.worker = null;
  }

  private pump(): void {
    const c = this.current;
    if (!c || !this.wanted || this.inflight) return;
    const key = this.key(c.mesh, c.fieldsKey);
    if (this.answers.some((x) => x.mesh === c.mesh && x.key === key)) { this.wanted = false; return; }
    if (this.worker === undefined) this.worker = startWorker((m) => this.received(m), () => this.lost());
    if (!this.worker) { this.wanted = false; this.solveHere(c, key); return; }
    if (!this.workerBody || this.workerBody.mesh !== c.mesh) {
      const index = indexOf(c.mesh);
      if (!index) { this.wanted = false; return; }
      const id = ++this.bodies;
      this.workerBody = { mesh: c.mesh, id, reps: null };
      const request: CreaseRequest = { type: 'prepare', body: id, base: c.base.slice(), baseNormal: c.baseNormal.slice(), index: Uint32Array.from(index), zone: SARAH_V2_CREASE_ZONE };
      this.worker.postMessage(request, [request.base.buffer, request.baseNormal.buffer, request.index.buffer]);
    }
    const reps = this.workerBody.reps;
    if (!reps) return; // posted once the worker says it is prepared
    this.lift();
    const sum = summed(c.mesh, reps, this.shift);
    if (!sum) { this.wanted = false; return; }
    this.wanted = false;
    this.inflight = { seq: ++this.seq, mesh: c.mesh, key };
    const request: CreaseRequest = { type: 'solve', body: this.workerBody.id, seq: this.inflight.seq, position: sum.position, normal: sum.normal };
    this.worker.postMessage(request, [request.position.buffer, request.normal.buffer]);
  }

  private received(m: CreaseReply): void {
    if (m.type === 'prepared') {
      if (this.workerBody?.id === m.body) { this.workerBody.reps = m.reps; this.prepareMs = m.ms; this.pump(); }
      return;
    }
    const f = this.inflight;
    if (!f || f.seq !== m.seq) return;
    this.inflight = null;
    if (m.type === 'failed') { this.lost(); return; }
    this.ms = m.ms;
    this.where = 'worker';
    this.keep({ mesh: f.mesh, key: f.key, result: m.result });
    this.pump();
  }

  /** The worker failed: from now on the page works it out. */
  private lost(): void {
    this.worker?.terminate();
    this.worker = null;
    this.workerBody = null;
    this.inflight = null;
    this.wanted = true;
    this.pump();
  }

  private solveHere(c: Current, key: string): void {
    if (!this.local || this.local.mesh !== c.mesh) {
      const index = indexOf(c.mesh);
      if (!index) return;
      const t0 = performance.now();
      this.local = { mesh: c.mesh, crease: prepareCrease(c.base, c.baseNormal, index, inSarahCreaseZone) };
      this.prepareMs = performance.now() - t0;
    }
    this.lift();
    const sum = summed(c.mesh, this.local.crease.reps, this.shift);
    if (!sum) return;
    const t0 = performance.now();
    const result = relaxCrease(this.local.crease, sum.position, sum.normal);
    this.ms = performance.now() - t0;
    this.where = 'page';
    this.keep({ mesh: c.mesh, key, result });
  }

  /** Keep an answer (the last few), and lay it if she is still the shape it was worked out for. */
  private keep(a: Answer): void {
    this.answers = [a, ...this.answers.filter((x) => !(x.mesh === a.mesh && x.key === a.key))].slice(0, 6);
    this.last = a.result;
    const c = this.current;
    if (!this.enabled || !c || c.mesh !== a.mesh || this.key(c.mesh, c.fieldsKey) !== a.key) return;
    this.lift();
    this.lay(a.mesh, a.result, c.fieldsKey, a.key);
    this.onLaid?.();
  }

  /** Her shape as far as her crease can tell: the shape fields' own key and every morph weight that does not move by itself. */
  private key(mesh: THREE.Mesh, fieldsKey: string): string {
    const dict = mesh.morphTargetDictionary ?? {}, infl = mesh.morphTargetInfluences ?? [];
    let k = fieldsKey;
    for (const [name, at] of Object.entries(dict)) if (!this.moving.includes(name)) k += `|${name}:${(infl[at] ?? 0).toFixed(5)}`;
    return k;
  }

  private lay(mesh: THREE.Mesh, r: CreaseResult, fieldsKey: string, key: string): void {
    if (!r.vertices.length) return;
    const g = mesh.geometry, pa = g.getAttribute('position'), na = g.getAttribute('normal');
    if (!(pa instanceof THREE.BufferAttribute) || !(na instanceof THREE.BufferAttribute)) return;
    const P = pa.array as Float32Array, N = na.array as Float32Array, count = r.vertices.length;
    const oldPosition = new Float32Array(3 * count), oldNormal = new Float32Array(3 * count);
    // the morphs' normal offsets now, at the vertices whose normal is repaired (D): the attribute written is the normal
    // that, with D added, points along the repair (`unitBefore`)
    const target = new Float32Array(3 * count), D = new Float32Array(3 * count);
    for (let k = 0; k < count; k += 1) {
      const v = 3 * r.vertices[k];
      oldPosition[3 * k] = P[v]; oldPosition[3 * k + 1] = P[v + 1]; oldPosition[3 * k + 2] = P[v + 2];
      oldNormal[3 * k] = N[v]; oldNormal[3 * k + 1] = N[v + 1]; oldNormal[3 * k + 2] = N[v + 2];
      target[3 * k] = r.normal[3 * k]; target[3 * k + 1] = r.normal[3 * k + 1]; target[3 * k + 2] = r.normal[3 * k + 2];
    }
    forEachMorph(mesh, (w, _dp, dn) => {
      if (!dn) return;
      for (let k = 0; k < count; k += 1) {
        if (Number.isNaN(target[3 * k])) continue;
        const v = r.vertices[k];
        D[3 * k] += w * dn.getX(v); D[3 * k + 1] += w * dn.getY(v); D[3 * k + 2] += w * dn.getZ(v);
      }
    });
    const a = [0, 0, 0];
    for (let k = 0; k < count; k += 1) {
      const v = 3 * r.vertices[k];
      P[v] += r.offset[3 * k]; P[v + 1] += r.offset[3 * k + 1]; P[v + 2] += r.offset[3 * k + 2];
      if (Number.isNaN(target[3 * k])) continue;
      unitBefore(target[3 * k], target[3 * k + 1], target[3 * k + 2], D[3 * k], D[3 * k + 1], D[3 * k + 2], a);
      N[v] = a[0]; N[v + 1] = a[1]; N[v + 2] = a[2];
    }
    pa.needsUpdate = true;
    na.needsUpdate = true;
    this.laid = { mesh, position: pa, normal: na, vertices: r.vertices, oldPosition, oldNormal, fieldsKey, key };
  }
}

type MorphAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/** Her full triangle list: the index as loaded, kept before any garment hid skin from the draw. */
function indexOf(mesh: THREE.Mesh): ArrayLike<number> | null {
  return (mesh.userData.allIndices as ArrayLike<number> | undefined) ?? mesh.geometry.index?.array ?? null;
}

/**
 * Her summed rest shape at the given vertices: the attributes, and every morph as weighted now, as the GPU adds it, and
 * where her bones carry it at rest (`BodyCrease.shift`).
 */
function summed(mesh: THREE.Mesh, reps: Uint32Array, shift: BodyCrease['shift'] = null): { position: Float32Array; normal: Float32Array } | null {
  const g = mesh.geometry, pa = g.getAttribute('position'), na = g.getAttribute('normal');
  if (!(pa instanceof THREE.BufferAttribute) || !(na instanceof THREE.BufferAttribute)) return null;
  if (!g.morphTargetsRelative && (g.morphAttributes.position?.length ?? 0) > 0) return null;
  const n = reps.length, position = new Float32Array(3 * n), normal = new Float32Array(3 * n);
  const P = pa.array, N = na.array;
  for (let i = 0; i < n; i += 1) {
    const v = 3 * reps[i];
    position[3 * i] = P[v]; position[3 * i + 1] = P[v + 1]; position[3 * i + 2] = P[v + 2];
    normal[3 * i] = N[v]; normal[3 * i + 1] = N[v + 1]; normal[3 * i + 2] = N[v + 2];
  }
  forEachMorph(mesh, (w, dp, dn) => {
    for (let i = 0; i < n; i += 1) {
      const v = reps[i];
      position[3 * i] += w * dp.getX(v); position[3 * i + 1] += w * dp.getY(v); position[3 * i + 2] += w * dp.getZ(v);
      if (dn) { normal[3 * i] += w * dn.getX(v); normal[3 * i + 1] += w * dn.getY(v); normal[3 * i + 2] += w * dn.getZ(v); }
    }
  });
  const moved = shift?.(mesh, reps);
  if (moved) for (let i = 0; i < 3 * n; i += 1) position[i] += moved[i];
  return { position, normal };
}

/**
 * The attribute normal `a` for which `a + D` points along the unit `t` (D the morphs' normal offsets). A UNIT one where
 * there is one, a = s t - D with |a| = 1 and s = t.D + sqrt((t.D)^2 - |D|^2 + 1) > 0: exact whether or not the shader
 * makes the attribute unit before adding D (her paint patch does where it softens a nipple). Where there is none (|D|
 * above 1 and across or against `t`, as at her approved body's few backward normals and where her grown breasts' offsets
 * are long), `t - D` itself: exact wherever the attribute goes on as given, which is everywhere a nipple is not softened.
 */
export function unitBefore(tx: number, ty: number, tz: number, dx: number, dy: number, dz: number, out: number[]): void {
  const td = tx * dx + ty * dy + tz * dz, dd = dx * dx + dy * dy + dz * dz, disc = td * td - dd + 1;
  // the larger root must be positive, or a + D points AWAY from t (|D| above 1 and against t)
  const s = disc >= 0 ? td + Math.sqrt(disc) : -1;
  if (s <= 1e-3) { out[0] = tx - dx; out[1] = ty - dy; out[2] = tz - dz; return; }
  let ax = s * tx - dx, ay = s * ty - dy, az = s * tz - dz;
  const l = Math.hypot(ax, ay, az);
  if (l > 1e-12) { ax /= l; ay /= l; az /= l; } else { ax = tx; ay = ty; az = tz; }
  out[0] = ax; out[1] = ay; out[2] = az;
}

/** Each morph target with a weight now: its weight, position offsets and normal offsets (if it has them). */
function forEachMorph(mesh: THREE.Mesh, visit: (weight: number, position: MorphAttribute, normal: MorphAttribute | null) => void): void {
  const g = mesh.geometry, mp = g.morphAttributes.position ?? [], mn = g.morphAttributes.normal ?? [], infl = mesh.morphTargetInfluences ?? [];
  for (let k = 0; k < mp.length; k += 1) {
    const w = infl[k] ?? 0;
    if (w) visit(w, mp[k], mn[k] ?? null);
  }
}

/** The worker, or null where none can start (no `Worker`, or one that will not load). */
function startWorker(received: (m: CreaseReply) => void, lost: () => void): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    const w = new Worker(new URL('../view/creaseWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<CreaseReply>) => received(e.data);
    w.onerror = (e) => { e.preventDefault(); lost(); };
    return w;
  } catch {
    return null;
  }
}
