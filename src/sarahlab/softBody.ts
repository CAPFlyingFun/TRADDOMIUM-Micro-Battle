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
  /** HER LEGS' SOFT TISSUE (Joshua, 2026-11-02: legs as soft bodies, "a balloon with release valves"): each thigh's and
   * each calf's own mass, moving the skin its follow weights say (`LEG_JIGGLE_ATTRIBUTE`) */
  readonly thighL: { value: THREE.Vector3 };
  readonly thighR: { value: THREE.Vector3 };
  readonly calfL: { value: THREE.Vector3 };
  readonly calfR: { value: THREE.Vector3 };
  /**
   * A BABY'S KICK on her belly (baby.ts `MOVES`): up to `KICKS` at once, each where on her skin (rest metres, xyz) and
   * how far out (w, metres), the way out (xyz) and how wide (w, metres); her geometry to her rest frame, and back for a
   * move. Her belly only (its follow weight), smooth round the point. Nothing while every w is 0.
   */
  readonly kickAt: { value: THREE.Vector4[] };
  readonly kickDir: { value: THREE.Vector4[] };
  readonly kickRest: { value: THREE.Matrix4 };
  readonly kickUnits: { value: THREE.Matrix3 };
  /** HER BELLY'S SOFT SHAPE (`stepSoftBelly`): x its hang to her left, y its sag up, z its depth, each per metre it stands
   * out of her (`softAt`); w where her front is without a bump (z, rest metres), what it stands out from */
  readonly bellySoft: { value: THREE.Vector4 };
  /** HER PUBIC AREA PRESSED BY HER BABY'S HEAD (`pubicPressWant`): where (xyz, rest metres) and how far (w, metres) */
  readonly pubicAt: { value: THREE.Vector4 };
  /** ...which way (xyz, rest) and how wide (w, metres) */
  readonly pubicDir: { value: THREE.Vector4 };
}
/** How many kicks her belly shows at once (one a baby). */
export const KICKS = 3;
export const createJiggleUniforms = (): JiggleUniforms => ({
  belly: { value: new THREE.Vector3() }, breastL: { value: new THREE.Vector3() }, breastR: { value: new THREE.Vector3() },
  thighL: { value: new THREE.Vector3() }, thighR: { value: new THREE.Vector3() }, calfL: { value: new THREE.Vector3() }, calfR: { value: new THREE.Vector3() },
  kickAt: { value: Array.from({ length: KICKS }, () => new THREE.Vector4()) }, kickDir: { value: Array.from({ length: KICKS }, () => new THREE.Vector4(0, 0, 1, 0.03)) },
  kickRest: { value: new THREE.Matrix4() }, kickUnits: { value: new THREE.Matrix3() },
  bellySoft: { value: new THREE.Vector4(0, 0, 0, 0.1) },
  pubicAt: { value: new THREE.Vector4(0, 0, 0, 0) }, pubicDir: { value: new THREE.Vector4(0, 0, 1, 0.04) },
});

/** A kick's move at a point of her (rest metres) for a belly follow weight, rest metres, into `out` (its xyz added). */
export function kickAt(u: JiggleUniforms, bellyWeight: number, x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  out.set(0, 0, 0);
  const share = clamp(bellyWeight * 0.9, 0, 1);
  if (!(share > 0)) return out;
  for (let k = 0; k < KICKS; k++) {
    const a = u.kickAt.value[k], d = u.kickDir.value[k];
    if (!(a.w > 0)) continue;
    const dx = x - a.x, dy = y - a.y, dz = z - a.z, f = Math.exp(-(dx * dx + dy * dy + dz * dz) / (d.w * d.w));
    out.x += d.x * a.w * f * share; out.y += d.y * a.w * f * share; out.z += d.z * a.w * f * share;
  }
  return out;
}

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
    shader.uniforms.uJiggleThighL = uniforms.thighL; shader.uniforms.uJiggleThighR = uniforms.thighR;
    shader.uniforms.uJiggleCalfL = uniforms.calfL; shader.uniforms.uJiggleCalfR = uniforms.calfR;
    shader.uniforms.uKickAt = uniforms.kickAt;
    shader.uniforms.uKickDir = uniforms.kickDir;
    shader.uniforms.uKickRest = uniforms.kickRest;
    shader.uniforms.uKickUnits = uniforms.kickUnits;
    shader.uniforms.uBellySoft = uniforms.bellySoft;
    shader.uniforms.uPubicAt = uniforms.pubicAt; shader.uniforms.uPubicDir = uniforms.pubicDir;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 jiggle;\nattribute vec3 babyPush;\nuniform vec3 uJiggleThighL;\nuniform vec3 uJiggleThighR;\nuniform vec3 uJiggleCalfL;\nuniform vec3 uJiggleCalfR;\nuniform vec3 uJiggleBelly;\nuniform vec3 uJiggleBreastL;\nuniform vec3 uJiggleBreastR;\nuniform vec4 uKickAt[${KICKS}];\nuniform vec4 uKickDir[${KICKS}];\nuniform mat4 uKickRest;\nuniform mat3 uKickUnits;\nuniform vec4 uBellySoft;\nuniform vec4 uPubicAt;\nuniform vec4 uPubicDir;`)
      .replace('#include <morphtarget_vertex>', `#include <morphtarget_vertex>
vec3 kickMove = vec3(0.0);
if (jiggle.x > 0.0) {
  vec3 kickP = (uKickRest * vec4(transformed, 1.0)).xyz;
  for (int k = 0; k < ${KICKS}; k++) {
    if (uKickAt[k].w <= 0.0) continue;
    vec3 kd = kickP - uKickAt[k].xyz;
    kickMove += uKickDir[k].xyz * (uKickAt[k].w * exp(-dot(kd, kd) / (uKickDir[k].w * uKickDir[k].w)));
  }
  kickMove = clamp(jiggle.x * 0.9, 0.0, 1.0) * (uKickUnits * kickMove);
  // her belly's soft shape: each point moved by how far it stands out of her, its edges held (softAt)
  kickMove += clamp(jiggle.x * ${(1 / UNITS_PER_METRE).toFixed(8)}, 0.0, 1.0) * (uKickUnits * (uBellySoft.xyz * max(kickP.z - uBellySoft.w, 0.0)));
}
// her pubic area pressed by her baby's head (every point of her: her skin, her opening, what she wears)
if (uPubicAt.w != 0.0) {
  vec3 pubicD = (uKickRest * vec4(transformed, 1.0)).xyz - uPubicAt.xyz;
  kickMove += uKickUnits * (uPubicDir.xyz * (uPubicAt.w * exp(-dot(pubicD, pubicD) / (uPubicDir.w * uPubicDir.w))));
}
// (her legs ride the breasts' two weights, negative: thigh in y, calf in z, her right leg 10 further down -- the body is
// at the most attributes a vertex may carry)
vec2 legA = max(-jiggle.yz, vec2(0.0)), legW = mod(legA, 10.0);
transformed += babyPush + kickMove + jiggle.x * uJiggleBelly + max(jiggle.y, 0.0) * uJiggleBreastL + max(jiggle.z, 0.0) * uJiggleBreastR
  + legW.x * (legA.x >= 10.0 ? uJiggleThighR : uJiggleThighL) + legW.y * (legA.y >= 10.0 ? uJiggleCalfR : uJiggleCalfL);`);
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
export interface Jiggle { readonly weights: Float32Array; readonly uniforms: JiggleUniforms; readonly push: Float32Array; readonly legs?: Float32Array | null }

/**
 * Her legs' follow weights, packed into the jiggle attribute's breast channels (no new attribute: her body is at the most
 * a vertex may carry): on a leg vertex, -(thigh weight) in y and -(calf weight) in z, her right leg's 10 further down.
 * `legJiggleWeights` gives them two a vertex (thigh, calf), positive her left leg and negative her right; `packLegs` lays them.
 */
export const LEG_RIGHT_OFFSET = 10;
export function packLegs(weights: Float32Array, legs: Float32Array): void {
  for (let i = 0; i < legs.length / 2; i++) {
    const t = legs[i * 2], c = legs[i * 2 + 1];
    if (!t && !c) continue;
    const off = t < 0 || c < 0 ? LEG_RIGHT_OFFSET : 0;
    weights[i * 3 + 1] = -(Math.abs(t) + off); weights[i * 3 + 2] = -(Math.abs(c) + off);
  }
}
/** Each leg's bones: thigh (hip joint), shin (knee joint), foot (ankle joint). */
export interface LegBones { readonly left: readonly [THREE.Bone, THREE.Bone, THREE.Bone]; readonly right: readonly [THREE.Bone, THREE.Bone, THREE.Bone] }
/** GAME TUNING: how much of each leg's soft tissue follows its mass -- along the thigh (0 hip .. 1 knee) and calf (0 knee .. 1
 * ankle), all of it inside `full`, none outside `from` at each end; the back and inner side most, `front` of it in front
 * (the shin's front is bone: `shinFront`) */
export const LEG_SOFT = Object.freeze({ thighFrom: [0.05, 0.95] as const, thighFull: [0.3, 0.7] as const, calfFrom: [0.05, 0.85] as const, calfFull: [0.18, 0.55] as const, front: 0.45, shinFront: 0.1 });

/** A mesh's leg follow weights (null when it has none of those bones, or none of its skin is on them). */
export function legJiggleWeights(mesh: THREE.SkinnedMesh, legs: LegBones): Float32Array | null {
  const g = mesh.geometry, sk = mesh.skeleton, pos = g.getAttribute('position'), nrm = g.getAttribute('normal'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  if (!sk || !pos || !si || !sw) return null;
  const n = pos.count, out = new Float32Array(n * 2), L = LEG_SOFT;
  const jointAt = (b: number) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().copy(mesh.bindMatrix).invert(), new THREE.Matrix4().copy(sk.boneInverses[b]).invert()));
  const env = (t: number, from: readonly [number, number], full: readonly [number, number]) => { const a = clamp((t - from[0]) / (full[0] - from[0]), 0, 1), b = clamp((from[1] - t) / (from[1] - full[1]), 0, 1); return a * a * (3 - 2 * a) * b * b * (3 - 2 * b); };
  let any = false;
  for (const [side, bones] of [[1, legs.left], [-1, legs.right]] as const) {
    const ix = bones.map((b) => sk.bones.indexOf(b));
    if (ix.some((k) => k < 0)) continue;
    const hip = jointAt(ix[0]), knee = jointAt(ix[1]), ankle = jointAt(ix[2]), v = new THREE.Vector3(), nv = new THREE.Vector3();
    const thighAx = knee.clone().sub(hip), calfAx = ankle.clone().sub(knee), tl = thighAx.lengthSq(), cl = calfAx.lengthSq();
    for (let i = 0; i < n; i++) {
      let wt = 0, wc = 0; for (let k = 0; k < 4; k++) { const b = si.getComponent(i, k), w = sw.getComponent(i, k); if (b === ix[0]) wt += w; else if (b === ix[1]) wc += w; }
      if (wt + wc < 0.05) continue;
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (nrm) nv.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).normalize(); else nv.set(0, 0, 1);
      // (her back is -z; her inner thigh faces her middle)
      const back = 0.5 * (1 - nv.z), inner = Math.max(0, -Math.sign(v.x || side) * nv.x), soft = Math.max(back, 0.8 * inner);
      const tt = v.clone().sub(hip).dot(thighAx) / (tl || 1), tc = v.clone().sub(knee).dot(calfAx) / (cl || 1);
      const a = wt * env(tt, L.thighFrom, L.thighFull) * (L.front + (1 - L.front) * soft) * UNITS_PER_METRE;
      const c = wc * env(tc, L.calfFrom, L.calfFull) * (L.shinFront + (1 - L.shinFront) * back) * UNITS_PER_METRE;
      if (a > 0 || c > 0) { out[i * 2] = side * a; out[i * 2 + 1] = side * c; any = true; }
    }
  }
  return any ? out : null;
}

/** THE LEGS' SPRINGS (GAME TUNING): a thigh a little slower and looser than a calf; both well damped. */
export const LEG_TUNE = Object.freeze({ thigh: { hz: 3.2, damping: 0.4, maxM: 0.01, gain: 1 }, calf: { hz: 4.2, damping: 0.45, maxM: 0.007, gain: 1 } } as const);
/** A mesh's jiggle, if it was given one. */
export function jiggleOf(mesh: THREE.Object3D): Jiggle | null {
  const j = (mesh.userData as { jiggle?: Jiggle }).jiggle;
  return j && j.weights instanceof Float32Array ? j : null;
}

/**
 * Give one skinned mesh its follow weights and patch its materials (false when it has no motion shapes). Its own
 * motion shapes stay where they are; the room stops driving them once the masses move it.
 */
export function attachJiggle(mesh: THREE.Mesh, uniforms: JiggleUniforms, legBones?: LegBones | null): boolean {
  const g = mesh.geometry as THREE.BufferGeometry;
  if (jiggleOf(mesh)) return true;
  const legs = legBones && (mesh as THREE.SkinnedMesh).isSkinnedMesh ? legJiggleWeights(mesh as THREE.SkinnedMesh, legBones) : null;
  const weights = jiggleWeights(g, mesh.morphTargetDictionary) ?? (legs ? new Float32Array((g.getAttribute('position')?.count ?? 0) * 3) : null);
  if (!weights) return false;
  // (never over a breast's own weight: a leg vertex has none)
  if (legs) { for (let i = 0; i < legs.length / 2; i++) if (weights[i * 3 + 1] > 0 || weights[i * 3 + 2] > 0) { legs[i * 2] = 0; legs[i * 2 + 1] = 0; } packLegs(weights, legs); }
  g.setAttribute(JIGGLE_ATTRIBUTE, new THREE.BufferAttribute(weights, 3));
  const push = new Float32Array(weights.length);
  g.setAttribute(PUSH_ATTRIBUTE, new THREE.BufferAttribute(push, 3));
  (mesh.userData as { jiggle?: Jiggle }).jiggle = { weights, uniforms, push, legs };
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
const kickP = new THREE.Vector3(), kickM = new THREE.Vector3();
/** ...and, given where the vertex is (geometry units, after its morphs), a kick's move too, as the shader adds it. */
export function jiggleAt(j: Jiggle, v: number, out: { x: number; y: number; z: number }, x?: number, y?: number, z?: number): void {
  const w = j.weights, o = v * 3, b = j.uniforms.belly.value, l = j.uniforms.breastL.value, r = j.uniforms.breastR.value;
  const p = j.push;
  const wl = Math.max(w[o + 1], 0), wr = Math.max(w[o + 2], 0);
  out.x = p[o] + w[o] * b.x + wl * l.x + wr * r.x;
  out.y = p[o + 1] + w[o] * b.y + wl * l.y + wr * r.y;
  out.z = p[o + 2] + w[o] * b.z + wl * l.z + wr * r.z;
  // (her legs, packed in the breasts' channels as the shader reads them)
  if (w[o + 1] < 0 || w[o + 2] < 0) {
    const u = j.uniforms;
    for (const [ch, L, R] of [[o + 1, u.thighL, u.thighR], [o + 2, u.calfL, u.calfR]] as const) {
      const a = Math.max(-w[ch], 0); if (!a) continue;
      const m = (a >= LEG_RIGHT_OFFSET ? R : L).value, k = a % LEG_RIGHT_OFFSET;
      out.x += k * m.x; out.y += k * m.y; out.z += k * m.z;
    }
  }
  if (x === undefined || y === undefined || z === undefined) return;
  const u = j.uniforms;
  kickP.set(x, y, z).applyMatrix4(u.kickRest.value);
  if (!(w[o] > 0)) { pubicAt(u, kickP, kickM).applyMatrix3(u.kickUnits.value); out.x += kickM.x; out.y += kickM.y; out.z += kickM.z; return; }
  // (her belly's soft shape, as the shader moves it)
  softAt(u, w[o], kickP, kickM).applyMatrix3(u.kickUnits.value);
  out.x += kickM.x; out.y += kickM.y; out.z += kickM.z;
  pubicAt(u, kickP, kickM).applyMatrix3(u.kickUnits.value);
  out.x += kickM.x; out.y += kickM.y; out.z += kickM.z;
  const K = u.kickAt.value;
  let any = false; for (let k = 0; k < K.length; k++) if (K[k].w > 0) { any = true; break; }
  if (!any) return;
  kickAt(u, w[o], kickP.x, kickP.y, kickP.z, kickM).applyMatrix3(u.kickUnits.value);
  out.x += kickM.x; out.y += kickM.y; out.z += kickM.z;
}

// ------------------------------------------------------------------------------------------------- the soft belly

/**
 * HER BELLY AS A SOFT BODY (Joshua, 2026-11-03: "switching the belly to the soft body sim but with some rigidity to
 * maintain the overall same shape but still allows more realistic movements, sags", by four rules of his):
 *
 *   1  gravity leaning her FORWARD (more) or BACK (less) changes her belly, mainly its DEPTH -- fully forward, as on hands
 *      and knees, 15% deeper; fully back, flat on a bed, 50% shallower; in proportion between;
 *   1a leaning to a SIDE, as lying on it to sleep, gravity tips her belly that way, by its weight; and on her side it is
 *      15% shallower -- rolled from her back to her side it fills back out from 50% to that (Joshua, 2026-11-03: "laying
 *      on the side at rotated 90° is basically like standing straight up... I would do depth for the side -15%");
 *   2  her BABY's place in it: lower, it sags; further forward, a little deeper;
 *   3  how FULL it is holds its shape: the fuller, the less 1, 1a and 2 change it (as milk firms her breasts); and food
 *      and water in her (`fed`) firm it a little more (Joshua: "whenever she eats and drinks... her belly firmness can
 *      increase").
 *
 * Her belly's own shape is where it rests; three soft moves bend it, each a heavy, damped spring easing toward what the
 * rules ask -- its HANG to a side, its SAG and its DEPTH -- and each moves a point by how far that point stands out of
 * her (so the base of her belly holds and its front moves most), times its belly follow weight (its edges held). They
 * are drawn in the vertex shader with the bounce (`patchJiggle`), so they cost nothing to change each frame, and her
 * womb is moved the same (`patchWombSoft`), by the skin over it. Every number is GAME TUNING.
 */
export const BELLY_SOFT = Object.freeze({
  /** rule 1: her depth changed fully forward / fully back (a share of how far her belly stands out) */
  leanForward: 0.15, leanBack: 0.5,
  /** rule 1a: her belly's hang fully on her side (per metre it stands out, at full term's weight), and its depth there */
  side: 0.35, sideDepth: 0.15,
  /** rule 2: its sag for a baby lowest in it, and its depth for one furthest forward */
  sagBaby: 0.25, depthBaby: 0.08,
  /** rule 3: at full term these are as given; a womb `fullness` 0 changes `1 / (1 - fullSoft)` as much, 1.5 a half; and
   * fully `fed`, her FIRMNESS this much more */
  fullSoft: 0.5, fedFirm: 25,
  /** the springs: how quick (Hz, at full term: quicker the fuller) and how damped (1 settles without passing) */
  hz: Object.freeze({ side: 0.7, sag: 0.7, depth: 0.5 }), damping: 0.85,
});

/** Where her belly's soft moves stand: each a spring's place and speed. */
export interface SoftBelly { side: number; sag: number; depth: number; vSide: number; vSag: number; vDepth: number }
export const restingSoftBelly = (): SoftBelly => ({ side: 0, sag: 0, depth: 0, vSide: 0, vSag: 0, vDepth: 0 });

/** What her belly's soft moves ease toward, and the lean they read. */
export interface SoftBellyWant { readonly side: number; readonly sag: number; readonly depth: number; readonly leanDeg: number; readonly sideDeg: number; readonly give: number }

/**
 * Rule 3's give: how much her belly gives to gravity and her baby, 1 at full term (`fullness` 1) and FIRMNESS 50.
 * `fullness`: her womb against a full-term one (her belly's size, her babies and their fluid; less once her baby is born);
 * `firmness`: her FIRMNESS control (0..100); `fed`: food and water in her (0 .. 1 a full meal), firming it a little.
 */
export function softBellyGive(fullness: number, firmness = 50, fed = 0): number {
  const F = clamp(Number.isFinite(fullness) ? fullness : 1, 0, 1.5);
  const f = clamp((Number.isFinite(firmness) ? firmness : 50) + BELLY_SOFT.fedFirm * clamp(Number.isFinite(fed) ? fed : 0, 0, 1), 0, 100) / 100;
  return ((1 - BELLY_SOFT.fullSoft * F) / (1 - BELLY_SOFT.fullSoft)) * (1.5 - f);
}

/**
 * The rules' ask. `down`: the way down (gravity) in her body's frame (x her left, y up, z out of her front), a unit;
 * `upright`: the same as she stands (her lean is measured from it); `baby`: its place in her womb -- `low` (0 its middle
 * .. 1 the bottom of her womb) and `forward` (0 .. 1 its front) -- or null; `fullness` and `firmness` as `softBellyGive`.
 */
export function softBellyWant(down: { x: number; y: number; z: number }, upright: { x: number; y: number; z: number }, baby: { low: number; forward: number } | null, fullness: number, firmness = 50, fed = 0): SoftBellyWant {
  const S = BELLY_SOFT, give = softBellyGive(fullness, firmness, fed);
  // her lean forward (+) or back (-) and to her left (+) or right (-), degrees from standing
  // (how far gravity pulls out of her front, and toward her left: on her side the first is nothing, whatever her pitch)
  const pitch = (g: { z: number }) => Math.asin(clamp(g.z, -1, 1)), roll = (g: { x: number }) => Math.asin(clamp(g.x, -1, 1));
  const leanDeg = clamp(((pitch(down) - pitch(upright)) * 180) / Math.PI, -90, 90), sideDeg = clamp(((roll(down) - roll(upright)) * 180) / Math.PI, -90, 90);
  // (forward or back by how far she leans so; and on her side, its own -- rolled from her back to her side, the one
  // hands over to the other as the angles do)
  let depth = (leanDeg >= 0 ? S.leanForward : -S.leanBack) * (Math.abs(leanDeg) / 90) - S.sideDepth * (Math.abs(sideDeg) / 90);
  let sag = 0;
  if (baby) { sag -= S.sagBaby * clamp(baby.low, 0, 1); depth += S.depthBaby * clamp(baby.forward, 0, 1); }
  // (its hang by its weight: at full term as given, lighter less, heavier more)
  const side = S.side * Math.sin((sideDeg * Math.PI) / 180) * clamp(Number.isFinite(fullness) ? fullness : 1, 0, 2);
  return { side: side * give, sag: sag * give, depth: Math.max(-0.9, depth * give), leanDeg, sideDeg, give };
}

/** Her belly's soft moves a step toward `want` (`dt` seconds); quicker the fuller. */
export function stepSoftBelly(s: SoftBelly, dt: number, want: { side: number; sag: number; depth: number }, fullness: number): SoftBelly {
  if (!(dt > 0)) return s;
  const quick = 0.7 + 0.6 * clamp(Number.isFinite(fullness) ? fullness : 1, 0, 1.5), steps = Math.max(1, Math.ceil(dt / 0.01)), h = dt / steps;
  const spring = (x: number, v: number, to: number, hz: number): [number, number] => {
    const w = 2 * Math.PI * hz * quick;
    for (let k = 0; k < steps; k++) { v += (w * w * (to - x) - 2 * BELLY_SOFT.damping * w * v) * h; x += v * h; }
    return [x, v];
  };
  [s.side, s.vSide] = spring(s.side, s.vSide, want.side, BELLY_SOFT.hz.side);
  [s.sag, s.vSag] = spring(s.sag, s.vSag, want.sag, BELLY_SOFT.hz.sag);
  [s.depth, s.vDepth] = spring(s.depth, s.vDepth, want.depth, BELLY_SOFT.hz.depth);
  return s;
}

/**
 * Her belly's soft move at a point (rest metres) for its belly follow weight (geometry units per metre, as the jiggle
 * attribute holds it), rest metres, into `out` -- what the shader adds.
 */
export function softAt(u: JiggleUniforms, bellyWeight: number, p: { x: number; y: number; z: number }, out: THREE.Vector3): THREE.Vector3 {
  const share = clamp(bellyWeight / UNITS_PER_METRE, 0, 1), s = u.bellySoft.value, h = Math.max(p.z - s.w, 0) * share;
  return out.set(s.x * h, s.y * h, s.z * h);
}

/**
 * Her WOMB moved as her belly's soft shape and bounce move the skin over it (Joshua: "should also hopefully not show the
 * womb anymore through the skin"): each of its points carries, in the `softRef` attribute, where the skin over it is
 * (rest metres, xyz) and that skin's belly follow weight (w), and moves exactly as the shader moves that skin.
 */
export const SOFT_REF_ATTRIBUTE = 'softRef';
const WOMB_PATCHED = new WeakSet<THREE.Material>();
export function patchWombSoft(material: THREE.Material, uniforms: JiggleUniforms): void {
  if (WOMB_PATCHED.has(material)) return;
  WOMB_PATCHED.add(material);
  const previous = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    previous?.call(this, shader, renderer);
    shader.uniforms.uJiggleBelly = uniforms.belly;
    shader.uniforms.uKickUnits = uniforms.kickUnits;
    shader.uniforms.uBellySoft = uniforms.bellySoft;
    shader.uniforms.uKickRest = uniforms.kickRest; shader.uniforms.uPubicAt = uniforms.pubicAt; shader.uniforms.uPubicDir = uniforms.pubicDir;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 ${SOFT_REF_ATTRIBUTE};\nuniform vec3 uJiggleBelly;\nuniform mat3 uKickUnits;\nuniform mat4 uKickRest;\nuniform vec4 uBellySoft;\nuniform vec4 uPubicAt;\nuniform vec4 uPubicDir;`)
      .replace('#include <morphtarget_vertex>', `#include <morphtarget_vertex>
if (${SOFT_REF_ATTRIBUTE}.w > 0.0) {
  float softShare = clamp(${SOFT_REF_ATTRIBUTE}.w * ${(1 / UNITS_PER_METRE).toFixed(8)}, 0.0, 1.0);
  transformed += ${SOFT_REF_ATTRIBUTE}.w * uJiggleBelly + softShare * (uKickUnits * (uBellySoft.xyz * max(${SOFT_REF_ATTRIBUTE}.z - uBellySoft.w, 0.0)));
}
// (her canal's mouth pressed with her opening, as her skin round it is)
if (uPubicAt.w != 0.0) {
  vec3 pubicD = (uKickRest * vec4(transformed, 1.0)).xyz - uPubicAt.xyz;
  transformed += uKickUnits * (uPubicDir.xyz * (uPubicAt.w * exp(-dot(pubicD, pubicD) / (uPubicDir.w * uPubicDir.w))));
}`);
  };
  material.customProgramCacheKey = function () { return `${cacheKey ? cacheKey.call(this) : ''}|wombSoft`; };
  material.needsUpdate = true;
}

/**
 * THE PRESSURE BEHIND HER NAVEL (Joshua, 2026-11-03), 0 none .. 1 all of it (a little past for twins and triplets),
 * which is how far out her navel is (navelSoft.ts): "max belly pressure = max navel %... when there is no pressure like
 * not pregnant, the navel moves in". It is her PREGNANCY, not her belly's size ("a character with a small belly around
 * 30% and not be pregnant"): how many WEEKS (low early, a navel commonly starting to change in the second trimester and
 * out in the third), more for more babies and their fluid, and her baby pressing it -- further forward more, dropped low
 * into her pelvis in labour less; a contraction pushes it a little more for its while. GAME TUNING.
 */
export const NAVEL_PRESS = Object.freeze({ fromWeeks: 14, fullWeeks: 38, multiples: 0.25, most: 1.2, forward: 0.2, dropped: 0.25, squeeze: 0.1 });
export function navelPressure(weeks: number, carried: number, baby: { low: number; forward: number } | null, contraction = 0): number {
  const N = NAVEL_PRESS, w = Number.isFinite(weeks) ? weeks : 0;
  if (!(w > 0)) return 0;
  const t = clamp((w - N.fromWeeks) / (N.fullWeeks - N.fromWeeks), 0, 1);
  let p = t * t * (3 - 2 * t) * (1 + N.multiples * clamp((Number.isFinite(carried) ? carried : 1) - 1, 0, 2));
  if (baby && p > 0) p += p * (N.forward * clamp(baby.forward, 0, 1) * clamp(1 - baby.low, 0, 1) - N.dropped * clamp((baby.low - 0.3) / 0.7, 0, 1));
  p += N.squeeze * clamp(contraction, 0, 1) * Math.min(1, p);
  return clamp(p, 0, N.most);
}

/**
 * HER NAVEL AFTER THE BIRTH (Joshua, 2026-11-03: research says most go back within months, some stay out -- "a random
 * variable from 0-3; 0 = goes back in, 1 = stays out for a while before fading back, 2 = stays out permanently at maybe
 * -50% less depth"): how far out her navel stays (0..1) `seconds` after her baby is born, for its `peak` before, by her
 * NAVEL AFTER BIRTH `kind`. Held at its shape a while, then faded slowly; never less than the pressure still there
 * (the caller takes the larger). GAME TUNING (game seconds, not months).
 */
export const NAVEL_AFTER = Object.freeze({ backIn: { hold: 6, fade: 10 }, aWhile: { hold: 45, fade: 60 }, stays: 0.5 });
export function navelAfterBirth(kind: number, peak: number, seconds: number): number {
  const p = clamp(Number.isFinite(peak) ? peak : 0, 0, NAVEL_PRESS.most), t = Math.max(0, Number.isFinite(seconds) ? seconds : 0), k = Math.round(clamp(kind, 0, 2));
  const fadeOf = (hold: number, fade: number) => t <= hold ? 1 : Math.exp(-(t - hold) / fade);
  if (k === 0) return p * fadeOf(NAVEL_AFTER.backIn.hold, NAVEL_AFTER.backIn.fade);
  if (k === 1) return p * fadeOf(NAVEL_AFTER.aWhile.hold, NAVEL_AFTER.aWhile.fade);
  // (out for good at half, after the same while)
  return p * (NAVEL_AFTER.stays + (1 - NAVEL_AFTER.stays) * fadeOf(NAVEL_AFTER.aWhile.hold, NAVEL_AFTER.aWhile.fade));
}

/**
 * HER PUBIC AREA PRESSED BY HER BABY'S HEAD (Joshua, 2026-11-03: "as the baby moves downward, her pubic will also
 * realistically move just a little to adjust"; done with the birth "since it's connected and need to sync up"). As the
 * head passes under her pubic arch the soft tissue in front of it -- her mons, over her pubic bone -- is pressed forward
 * and a little down (the perineum behind bulges on its own: vulvaMesh's bulge): a few millimetres, smooth round the
 * point, growing as the head comes through, a little more in each contraction, easing once the head is out. GAME TUNING.
 */
export const PUBIC_PRESS = Object.freeze({
  /** at most (metres), and how wide it spreads (metres) */
  most: 0.008, wide: 0.035,
  /** where: up from the middle of her opening and out of her (metres, her rest frame) */
  up: 0.045, out: 0.012,
  /** the head's way down her canal over which it grows (0 the top of her cervix .. 1 its middle at her opening), the
   * share a contraction adds, and how far past her opening it is gone */
  from: 0.45, full: 0.95, squeeze: 0.3, goneBy: 1.4,
  /** how quick its spring (Hz) and how damped */
  hz: 1.2, damping: 0.8,
});
/** How far her pubic area is pressed (metres) with her baby's head `down` her canal and her `contraction` (0..1). */
export function pubicPressWant(down: number, contraction: number): number {
  const P = PUBIC_PRESS, s = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  if (!Number.isFinite(down)) return 0;
  const coming = s(P.from, P.full, down) * (1 - s(1, P.goneBy, down));
  return P.most * coming * (1 - P.squeeze + P.squeeze * clamp(contraction, 0, 1));
}
/** The press's move at a point (rest metres), rest metres, into `out` -- what the shader adds. */
export function pubicAt(u: JiggleUniforms, p: { x: number; y: number; z: number }, out: THREE.Vector3): THREE.Vector3 {
  const a = u.pubicAt.value, d = u.pubicDir.value;
  if (!a.w) return out.set(0, 0, 0);
  const dx = p.x - a.x, dy = p.y - a.y, dz = p.z - a.z, f = a.w * Math.exp(-(dx * dx + dy * dy + dz * dz) / (d.w * d.w));
  return out.set(d.x * f, d.y * f, d.z * f);
}
