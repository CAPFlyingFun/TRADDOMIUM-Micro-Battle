/**
 * HER BELLY AND BREASTS, SIMULATED (Joshua, 2026-10-29: "I would prefer only simulated... and lower like the response
 * time so it doesn't jiggle like jelly, and could make it dynamic so the bigger the belly gets the less (tighter) the
 * skin moves"; "do belly and breast simulation before doing the baby").
 *
 * Three masses, each a damped spring in her own body's frame (x to her left, y up, z out of her front), metres:
 *   - the BELLY: the womb's weight, anchored in front of her spine;
 *   - her LEFT and RIGHT BREAST: each its own, anchored on her chest, so the two move apart when she turns or sways.
 * Each feels what her body does at its anchor -- its acceleration, and gravity as her body turns away from upright --
 * and lags it: she rises and the mass is pressed down; she leans and it hangs a little toward the floor. Every frame the
 * masses are stepped (`stepMass`, substepped, clamped) and each mesh moves by them: a vertex moves by its own follow
 * weight times the mass's displacement (`JIGGLE_ATTRIBUTE`), in the vertex shader before skinning (`patchJiggle`) and,
 * for the cloth and anything else that poses her on the CPU, by the same sum (`jiggleOf`). The follow weights are each
 * mesh's own baked motion shapes -- `bellyBob` (the whole bump, its edges held) and `breastBob`, split at her midline --
 * read once as she loads: both move 1 cm at full weight, so a weight of |shape| / 1 cm is "how far this point goes per
 * metre the mass goes", on her body and on every garment fitted to her alike.
 *
 * The tuning (GAME TUNING, every number): heavily damped, so a bounce settles in about one small overshoot rather than
 * wobbling ("not like jelly"); the belly firmer and showing less of its travel the bigger it is past full term
 * ("the bigger the belly gets the less (tighter) the skin moves"), nothing at all with no bump; breasts heavier with
 * their size (slower, more travel) and firmer with milk; a FIRMNESS control for each, 50% being these defaults.
 */
import * as THREE from 'three';

/** One mass: its displacement from where it hangs at rest (metres, her body frame) and its velocity. */
export interface Mass { x: number; y: number; z: number; vx: number; vy: number; vz: number }
export const restingMass = (): Mass => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });

/** A spring: how fast it swings (Hz), how damped (1 = no overshoot), how far it may go (metres), and how much of its travel the skin shows. */
export interface MassTune { readonly hz: number; readonly damping: number; readonly maxM: number; readonly gain: number }

/** Accelerations past this (m/s²) are a teleport or a pose snapping, clamped rather than flung. */
export const MAX_FELT_ACCEL = 40;
/** How much of the change in gravity's direction the masses feel as she leans (the rest is her tissue holding its shape). GAME TUNING. */
export const GRAVITY_SHARE = 0.5;
export const GRAVITY = 9.81;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/**
 * One step of a mass, in place: `ax, ay, az` is what her body does there, in her frame (m/s², the change from standing
 * still and upright -- `feltAcceleration`); the mass lags it. Substeps of at most 1/240 s keep it stable on a slow
 * frame; it never goes further than `maxM` (the part of its velocity carrying it further is taken away).
 */
export function stepMass(m: Mass, dt: number, ax: number, ay: number, az: number, tune: MassTune): Mass {
  const w = 2 * Math.PI * Math.max(0.1, tune.hz), c = 2 * Math.max(0, tune.damping) * w;
  let fx = Number.isFinite(ax) ? ax : 0, fy = Number.isFinite(ay) ? ay : 0, fz = Number.isFinite(az) ? az : 0;
  const fl = Math.hypot(fx, fy, fz);
  if (fl > MAX_FELT_ACCEL) { const k = MAX_FELT_ACCEL / fl; fx *= k; fy *= k; fz *= k; }
  const total = Math.min(Math.max(0, Number.isFinite(dt) ? dt : 0), 0.1);
  const steps = Math.max(1, Math.ceil(total / (1 / 240)));
  const h = total / steps;
  for (let k = 0; k < steps && h > 0; k += 1) {
    m.vx += (-w * w * m.x - c * m.vx - fx) * h;
    m.vy += (-w * w * m.y - c * m.vy - fy) * h;
    m.vz += (-w * w * m.z - c * m.vz - fz) * h;
    m.x += m.vx * h; m.y += m.vy * h; m.z += m.vz * h;
    const r = Math.hypot(m.x, m.y, m.z);
    if (r > tune.maxM) {
      const k2 = tune.maxM / r; m.x *= k2; m.y *= k2; m.z *= k2;
      // take away the part of its velocity that carries it further out
      const nx = m.x / tune.maxM, ny = m.y / tune.maxM, nz = m.z / tune.maxM, out = m.vx * nx + m.vy * ny + m.vz * nz;
      if (out > 0) { m.vx -= out * nx; m.vy -= out * ny; m.vz -= out * nz; }
    }
  }
  return m;
}

/**
 * What the body does at an anchor, in her frame, as the masses feel it: its acceleration less gravity (what her body
 * pushes it with), turned into her frame by `toBody` (a world-to-body rotation), less what that is standing still and
 * upright (straight up, 9.81 m/s²); the change in gravity's direction counts for GRAVITY_SHARE of itself.
 */
export function feltAcceleration(accelWorld: THREE.Vector3, toBody: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 {
  const support = new THREE.Vector3(0, GRAVITY, 0).applyQuaternion(toBody);
  out.copy(accelWorld).applyQuaternion(toBody);
  out.x += GRAVITY_SHARE * support.x;
  out.y += GRAVITY_SHARE * (support.y - GRAVITY);
  out.z += GRAVITY_SHARE * support.z;
  return out;
}

/**
 * BOUNCE (0..200, the room's slider): how much of a mass's travel her skin shows, as a share of the tuning -- 0 holds
 * it still, 100 is as tuned, 200 twice as much. It scales what is SHOWN, not the spring: the timing stays the same.
 */
export const bounceShare = (bounce: number): number => clamp(Number.isFinite(bounce) ? bounce : 100, 0, 200) / 100;

/**
 * THE BELLY'S SPRING, at a belly size (percent), its FIRMNESS (0..100, 50 the default) and BABY WEIGHT (-100..100).
 * A little quicker the bigger she is (her skin is tighter), much quicker and less travel when firm; a heavier baby a
 * little slower. How much of the mass's travel her skin shows grows with the bump to full term and falls past it: at
 * 200% it shows 60% of what full term shows. No bump, no motion.
 */
export function bellyTune(bumpPercent: number, firmness = 50, babyWeight = 0, bounce = 100, carried = 1): MassTune {
  const s = clamp(bumpPercent / 100, 0, 2), f = clamp(firmness / 100, 0, 1), bw = clamp(babyWeight / 100, -1, 1);
  // twins and triplets and their fluid (baby.ts `carriedShare`, 1 for one): heavier is slower, and the fluid damps it
  const c = clamp(Number.isFinite(carried) ? carried : 1, 0.5, 2);
  const hz = ((2.0 + 0.4 * s) * (0.75 + 0.5 * f) * (1 - 0.06 * bw)) / Math.sqrt(c);
  const damping = 0.5 + 0.06 * s + 0.25 * (f - 0.5) + 0.25 * Math.max(0, c - 1);
  const gain = 0.55 * Math.min(1, s) * (1 - 0.4 * clamp(s - 1, 0, 1)) * (1.3 - 0.6 * f) * bounceShare(bounce);
  return { hz, damping, maxM: 0.02, gain };
}

/**
 * A BREAST'S SPRING, at a bust volume (her bust against her own non-pregnant one: 1.0 to about 2), MILK (0..100) and
 * FIRMNESS (0..100). A bigger breast is heavier: slower and travelling further. Milk fills it firm: quicker, less
 * travel, a little more damped. Her right breast is tuned 4% quicker than her left so the two never move as one.
 */
export function breastTune(bustVolume: number, milk = 0, firmness = 50, side: 'left' | 'right' = 'left', bounce = 100): MassTune {
  const v = clamp(bustVolume, 0.5, 3), m = clamp(milk / 100, 0, 1), f = clamp(firmness / 100, 0, 1);
  const hz = 2.4 * Math.sqrt(1.3 / v) * (1 + 0.35 * m) * (0.75 + 0.5 * f) * (side === 'right' ? 1.04 : 1);
  const damping = 0.38 + 0.12 * m + 0.2 * (f - 0.5);
  const gain = 0.5 * Math.sqrt(v / 1.3) * (1 - 0.3 * m) * (1.3 - 0.6 * f) * bounceShare(bounce);
  return { hz, damping, maxM: 0.02, gain };
}

// ---------------------------------------------------------------------------------------------------------------- mesh

/** The per-vertex follow weights: belly, left breast, right breast (geometry units per metre of the mass's travel). */
export const JIGGLE_ATTRIBUTE = 'jiggle';
/** The baked motion shapes the weights are read from, and how far each moves at full weight (metres). */
export const JIGGLE_SOURCES = Object.freeze({ belly: 'bellyBob', breast: 'breastBob', metres: 0.01 });
/** Geometry units per metre on her v2 body and every garment fitted to it (the bake's scale, 1 / 0.89974678). */
export const UNITS_PER_METRE = 1 / 0.89974678;
/** Across her midline the breasts' weights blend over this much either side (metres): her cleavage moves with both. */
export const MIDLINE_BLEND_M = 0.012;

/** What moves her meshes this frame: each mass's displacement as her skin shows it (metres, her frame), shared by every patched material. */
export interface JiggleUniforms {
  readonly belly: { value: THREE.Vector3 };
  readonly breastL: { value: THREE.Vector3 };
  readonly breastR: { value: THREE.Vector3 };
}
export const createJiggleUniforms = (): JiggleUniforms => ({ belly: { value: new THREE.Vector3() }, breastL: { value: new THREE.Vector3() }, breastR: { value: new THREE.Vector3() } });

/**
 * The follow weights of one mesh, from its own motion shapes (null when it has neither, or they move nothing): three
 * per vertex. Read through the attribute's accessors, so a quantized file reads right.
 */
export function jiggleWeights(geometry: THREE.BufferGeometry, dictionary: Record<string, number> | undefined): Float32Array | null {
  const pos = geometry.getAttribute('position'), morphs = geometry.morphAttributes.position;
  if (!pos || !morphs || !dictionary) return null;
  const n = pos.count, out = new Float32Array(n * 3);
  const read = (name: string) => { const k = dictionary[name]; return k === undefined ? null : morphs[k] ?? null; };
  const bellyM = read(JIGGLE_SOURCES.belly), breastM = read(JIGGLE_SOURCES.breast);
  if (!bellyM && !breastM) return null;
  const per = 1 / JIGGLE_SOURCES.metres, blend = MIDLINE_BLEND_M * UNITS_PER_METRE;
  let any = false;
  for (let i = 0; i < n; i += 1) {
    if (bellyM) { const w = Math.hypot(bellyM.getX(i), bellyM.getY(i), bellyM.getZ(i)) * per; out[i * 3] = w; if (w > 0) any = true; }
    if (breastM) {
      const w = Math.hypot(breastM.getX(i), breastM.getY(i), breastM.getZ(i)) * per;
      if (w > 0) {
        const t = clamp((pos.getX(i) / blend + 1) / 2, 0, 1), left = t * t * (3 - 2 * t);
        out[i * 3 + 1] = w * left; out[i * 3 + 2] = w * (1 - left); any = true;
      }
    }
  }
  return any ? out : null;
}

const PATCHED = new WeakSet<THREE.Material>();
/**
 * Patch a material so its vertices move by the masses: after the morph targets, before skinning, `transformed` gains
 * each mass's displacement times the vertex's follow weight. Chains whatever `onBeforeCompile` and cache key the
 * material already has (the room's other patches do the same), once per material. A mesh drawn with it that has no
 * weights reads zero and does not move.
 */
export function patchJiggle(material: THREE.Material, uniforms: JiggleUniforms): void {
  if (PATCHED.has(material)) return;
  PATCHED.add(material);
  const previous = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    previous?.call(this, shader, renderer);
    shader.uniforms.uJiggleBelly = uniforms.belly;
    shader.uniforms.uJiggleBreastL = uniforms.breastL;
    shader.uniforms.uJiggleBreastR = uniforms.breastR;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 jiggle;\nattribute vec3 babyPush;\nuniform vec3 uJiggleBelly;\nuniform vec3 uJiggleBreastL;\nuniform vec3 uJiggleBreastR;')
      .replace('#include <morphtarget_vertex>', '#include <morphtarget_vertex>\ntransformed += babyPush + jiggle.x * uJiggleBelly + jiggle.y * uJiggleBreastL + jiggle.z * uJiggleBreastR;');
  };
  material.customProgramCacheKey = function () { return `${cacheKey ? cacheKey.call(this) : ''}|jiggle`; };
  material.needsUpdate = true;
}

/** What the CPU posers read: a mesh's follow weights and the uniforms they multiply. */
/**
 * `push`: HER BELLY MADE ROOM FOR (baby.ts, Joshua 2026-10-30: "the belly adjusting to the baby as in real life the skin
 * changes with the baby"): where her baby, its sac and her womb need more room than her belly gives, her skin (and what
 * she wears over it) is pushed out -- per vertex, geometry units, zero everywhere else. Its own attribute, beside the
 * jiggle's, so the CPU posers read it the same way.
 */
export const PUSH_ATTRIBUTE = 'babyPush';
export interface Jiggle { readonly weights: Float32Array; readonly uniforms: JiggleUniforms; readonly push: Float32Array }
/** A mesh's jiggle, if it was given one. */
export function jiggleOf(mesh: THREE.Object3D): Jiggle | null {
  const j = (mesh.userData as { jiggle?: Jiggle }).jiggle;
  return j && j.weights instanceof Float32Array ? j : null;
}

/**
 * Give one skinned mesh its follow weights and patch its materials (false when it has no motion shapes). Its own
 * motion shapes stay where they are; the room stops driving them once the masses move it.
 */
export function attachJiggle(mesh: THREE.Mesh, uniforms: JiggleUniforms): boolean {
  const g = mesh.geometry as THREE.BufferGeometry;
  if (jiggleOf(mesh)) return true;
  const weights = jiggleWeights(g, mesh.morphTargetDictionary);
  if (!weights) return false;
  g.setAttribute(JIGGLE_ATTRIBUTE, new THREE.BufferAttribute(weights, 3));
  const push = new Float32Array(weights.length);
  g.setAttribute(PUSH_ATTRIBUTE, new THREE.BufferAttribute(push, 3));
  (mesh.userData as { jiggle?: Jiggle }).jiggle = { weights, uniforms, push };
  for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) patchJiggle(m, uniforms);
  return true;
}

/** A vertex's jiggle offset (geometry units) into `out`, as the shader adds it. */
/** Lay `values` (geometry units, three a vertex; null clears it) as the mesh's push. False for a mesh with no jiggle. */
export function setPush(mesh: THREE.Object3D, values: ArrayLike<number> | null): boolean {
  const j = jiggleOf(mesh), g = (mesh as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
  if (!j || !g) return false;
  if (values) j.push.set(values); else j.push.fill(0);
  const a = g.getAttribute(PUSH_ATTRIBUTE) as THREE.BufferAttribute | undefined;
  if (a) a.needsUpdate = true;
  return true;
}
export function jiggleAt(j: Jiggle, v: number, out: { x: number; y: number; z: number }): void {
  const w = j.weights, o = v * 3, b = j.uniforms.belly.value, l = j.uniforms.breastL.value, r = j.uniforms.breastR.value;
  const p = j.push;
  out.x = p[o] + w[o] * b.x + w[o + 1] * l.x + w[o + 2] * r.x;
  out.y = p[o + 1] + w[o] * b.y + w[o + 1] * l.y + w[o + 2] * r.y;
  out.z = p[o + 2] + w[o] * b.z + w[o + 1] * l.z + w[o + 2] * r.z;
}
