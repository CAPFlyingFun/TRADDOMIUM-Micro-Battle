/**
 * HER DETAIL THROUGH THE TEE, in shading (Joshua, 2026-10-24: "the breast slider has no effect on the outfit… it still
 * should have a visible effect", and "the bellybutton also doesn't appear with the slider").
 *
 * The cloth tee (`clothShirt.ts`) is particles about a centimetre apart, so it cannot carry a nipple or a navel as
 * shape: the detail is smaller than the cloth's own spacing and falls between its particles. So it is drawn the way a
 * normal map draws pores. The room works out up to three SPOTS on her posed body each frame -- spot 0 her navel, spots
 * 1 and 2 her nipples -- each a centre on her skin, her skin's outward normal there, a signed height and a radius, and
 * this patch on the tee's material tilts the shading normal around each one as though the fabric lay over a small
 * Gaussian bump (or dimple), and darkens a dimple slightly, the way an innie navel holds a little shadow under a shirt.
 *
 * The FITTED tee (the modelled, skinned one) shares this material, and it carries a navel impression -- and perhaps a
 * faint nipple shape -- of its own, modelled into its geometry. Shading over that cannot take it away, so at a low
 * detail value a spot can also TAKE IT BACK: `flatten` (0 to 1) of the garment's own `relief` at the spot is moved back
 * toward her smooth surface, in the vertex stage, with the same footprint. The tee's own normals still carry the
 * impression's slope, so the shading normal is tilted back by the slope of exactly what was taken away -- the same tilt
 * a dimple of the opposite sign would give, summed into the spot's relief -- and the light falls on the flattened
 * surface as it would on a smooth one. (Mixing the normal toward the smooth one by the footprint's weight was tried
 * first: on a modelled dent it left two thirds of the dent's shading, because the footprint is weakest on the dent's
 * flanks, where its slope is steepest.) With nothing to flatten the vertex stage writes no position at all, so a tee
 * that is not being flattened draws exactly as it did; the cloth tee has no relief of its own and leaves both fields out.
 *
 * Only fabric lying OVER a spot gets any of this. The footprint fades with distance along the spot's normal too, so the
 * back of the shirt, a body's depth away behind her, shows nothing of the front's detail and is never moved by it.
 *
 * Every position is in WORLD units (the room's scene, 100 to the metre). `clothDetailAt` is the same relief worked on
 * the CPU, formula for formula, so a test or a probe can say what the shader draws without a GPU.
 *
 * The patch follows `fabricMaterial.ts`'s pattern and lives alongside it on the same material, in either order: it
 * chains onto whatever `onBeforeCompile` and `customProgramCacheKey` the material already has, keeps every
 * `#include` token it hooks so the other patch can still find it, is applied once per material, and every later change
 * is a uniform value.
 */
import * as THREE from 'three';

/** One place on her body whose relief shows through the fabric. */
export interface ClothDetailSpot {
  /** World position of the spot's centre on her skin. */
  readonly center: readonly [number, number, number];
  /** Her skin's outward unit normal there (world). */
  readonly normal: readonly [number, number, number];
  /** Signed relief shown through the fabric, world units: positive a bump (a nipple, an outie navel), negative a dimple (an innie navel). 0 shows nothing. */
  readonly height: number;
  /** The relief's Gaussian radius, world units (> 0). */
  readonly radius: number;
  /** 0..1: how much of the garment's OWN relief here is taken back toward her smooth surface (0 none, 1 all; clamped). */
  readonly flatten?: number;
  /** Signed, world units: how far the garment's own surface stands out from smooth at the spot's centre (her detail's height there; negative a dimple). */
  readonly relief?: number;
}

/** Everything the tee shows through, this frame. */
export interface ClothDetailState {
  readonly navel: ClothDetailSpot | null;
  /** Up to two; extra entries are ignored. */
  readonly nipples: readonly ClothDetailSpot[];
}

/** What the shader does at one point, worked on the CPU (`clothDetailAt`). */
export interface ClothDetailSample {
  /**
   * The tangential gradient of the summed height field (world): the shading normal is tilted by minus this. Each spot
   * adds the slope of its height less what it takes back of the garment's own relief (height - flatten · relief).
   */
  gradient: [number, number, number];
  /** The colour's factor from the dimples: 1 unchanged, below 1 darker, never below 1 - MAX_DARKEN. */
  shade: number;
  /** How far the vertex stage moves a garment point standing at p (world): minus flatten · relief along each spot's normal. */
  displacement: [number, number, number];
  /** Per spot slot (navel, nipple, nipple): the share of the garment's own relief taken back at p, flatten · g · fade (0..1). */
  flattenWeight: number[];
}

/** How much a dimple darkens the fabric over it, per world unit of depth (shade falls by this times the depth). */
export const DIMPLE_DARKEN = 0.6;
/** The most a dimple ever darkens the fabric: the shade never falls below 1 minus this. */
export const MAX_DARKEN = 0.3;

/** How many spots the shader holds: the navel and two nipples. */
const SPOTS = 3;
/** The least radius the relief is worked with, so a zero radius can never divide by zero (GLSL and CPU alike). */
const MIN_RADIUS = 1e-4;

interface Uniforms {
  readonly clothDetailOn: THREE.IUniform<number>;
  readonly clothSpotC: THREE.IUniform<THREE.Vector3[]>;
  readonly clothSpotN: THREE.IUniform<THREE.Vector3[]>;
  readonly clothSpotH: THREE.IUniform<number[]>;
  readonly clothSpotR: THREE.IUniform<number[]>;
  readonly clothSpotF: THREE.IUniform<number[]>;
  readonly clothSpotE: THREE.IUniform<number[]>;
}
const patched = new WeakMap<THREE.Material, Uniforms>();

/** A number as a GLSL float literal (an integer gets its `.0`). */
function glslFloat(x: number): string {
  const s = String(x);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

/**
 * One spot reduced to what both the shader and the CPU use: its normal made unit length (a zero normal is left as
 * given), its flatten clamped to 0..1, a missing flatten or relief as 0, everything else as it came. Null for a missing
 * spot.
 */
interface Slot { readonly c: readonly [number, number, number]; readonly n: [number, number, number]; readonly h: number; readonly r: number; readonly f: number; readonly e: number }
function slotsOf(state: ClothDetailState): (Slot | null)[] {
  const spots: (ClothDetailSpot | null)[] = [state.navel, state.nipples[0] ?? null, state.nipples[1] ?? null];
  return spots.map((s) => {
    if (!s) return null;
    const [x, y, z] = s.normal;
    const l = Math.hypot(x, y, z);
    const n: [number, number, number] = l > 0 ? [x / l, y / l, z / l] : [x, y, z];
    return { c: s.center, n, h: s.height, r: s.radius, f: Math.min(1, Math.max(0, s.flatten ?? 0)), e: s.relief ?? 0 };
  });
}

/** The spot uniforms, declared the same in both stages (the same uniform objects feed both). */
const SPOT_PARS = [
  'uniform float clothDetailOn;',
  `uniform vec3 clothSpotC[${SPOTS}];`,
  `uniform vec3 clothSpotN[${SPOTS}];`,
  `uniform float clothSpotH[${SPOTS}];`,
  `uniform float clothSpotR[${SPOTS}];`,
  `uniform float clothSpotF[${SPOTS}];`,
  `uniform float clothSpotE[${SPOTS}];`,
  'varying vec3 vClothWorld;',
].join('\n');
/**
 * One spot's footprint at `point` (a vec3 expression): its radius squared, normal, tangential offset, g and fade, as
 * locals of the loop body. The same few lines in both stages, and the same formula as `clothDetailAt`.
 */
const footprint = (point: string): string => `
        float clothR = max(clothSpotR[clothI], ${glslFloat(MIN_RADIUS)});
        float clothR2 = clothR * clothR;
        vec3 clothN = clothSpotN[clothI];
        vec3 clothD = ${point} - clothSpotC[clothI];
        float clothAlong = dot(clothD, clothN);
        vec3 clothT = clothD - clothAlong * clothN;
        float clothG = exp(-dot(clothT, clothT) / clothR2);
        float clothFade = exp(-(clothAlong * clothAlong) / (4.0 * clothR2));`;
// `transformed` is final at project_vertex: after morphs and skinning, still in the object's own space. The flattening
// moves the drawn point back along each spot's normal; only when it moved anything are the view position and the clip
// position rewritten, so a draw with nothing to flatten is the one three's own chunk made.
const VERTEX_FLATTEN = `
    vec4 clothW = modelMatrix * vec4(transformed, 1.0);
    if (clothDetailOn > 0.5) {
      vec3 clothDisp = vec3(0.0);
      for (int clothI = 0; clothI < ${SPOTS}; clothI++) {${footprint('clothW.xyz')}
        clothDisp -= clothSpotF[clothI] * clothSpotE[clothI] * clothG * clothFade * clothN;
      }
      if (dot(clothDisp, clothDisp) > 0.0) {
        clothW.xyz += clothDisp;
        mvPosition = viewMatrix * clothW;
        gl_Position = projectionMatrix * mvPosition;
      }
    }
    vClothWorld = clothW.xyz;`;
// the summed relief: its tangential gradient (world) -- her detail's height less what is taken back of the garment's
// own relief, whose slope the garment's normals still carry -- and the dimples' shade, the same formula as clothDetailAt
const FRAGMENT_RELIEF = `
    vec3 clothGrad = vec3(0.0);
    float clothShade = 1.0;
    if (clothDetailOn > 0.5) {
      float clothDark = 0.0;
      for (int clothI = 0; clothI < ${SPOTS}; clothI++) {${footprint('vClothWorld')}
        float clothH = clothSpotH[clothI];
        clothGrad += (clothH - clothSpotF[clothI] * clothSpotE[clothI]) * clothG * clothFade * (-2.0 / clothR2) * clothT;
        clothDark += min(clothH, 0.0) * clothG * clothFade;
      }
      clothShade = 1.0 + clamp(clothDark * ${glslFloat(DIMPLE_DARKEN)}, ${glslFloat(-MAX_DARKEN)}, 0.0);
    }
    diffuseColor.rgb *= clothShade;`;
// `normal` is the view-space shading normal; faceDirection (normal_fragment_begin) turns the tilt for a back face
const FRAGMENT_TILT = `
    if (clothDetailOn > 0.5) normal = normalize(normal - faceDirection * (mat3(viewMatrix) * clothGrad));`;

/** Patch a material once (idempotent); the detail starts OFF. */
export function patchClothDetail(material: THREE.Material): void {
  patch(material);
}

function patch(material: THREE.Material): Uniforms {
  const known = patched.get(material);
  if (known) return known;
  const uniforms: Uniforms = {
    clothDetailOn: { value: 0 },
    clothSpotC: { value: Array.from({ length: SPOTS }, () => new THREE.Vector3()) },
    clothSpotN: { value: Array.from({ length: SPOTS }, () => new THREE.Vector3(0, 0, 1)) },
    clothSpotH: { value: new Array<number>(SPOTS).fill(0) },
    clothSpotR: { value: new Array<number>(SPOTS).fill(1) },
    clothSpotF: { value: new Array<number>(SPOTS).fill(0) },
    clothSpotE: { value: new Array<number>(SPOTS).fill(0) },
  };
  const previous = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = [SPOT_PARS, shader.vertexShader].join('\n')
      .replace('#include <project_vertex>', () => `#include <project_vertex>${VERTEX_FLATTEN}`);
    shader.fragmentShader = [SPOT_PARS, shader.fragmentShader].join('\n')
      .replace('#include <color_fragment>', () => `#include <color_fragment>${FRAGMENT_RELIEF}`)
      .replace('#include <normal_fragment_maps>', () => `#include <normal_fragment_maps>${FRAGMENT_TILT}`);
  };
  material.customProgramCacheKey = function () { return `${cacheKey.call(this)}|cloth-detail-v2`; };
  material.needsUpdate = true;
  patched.set(material, uniforms);
  return uniforms;
}

/**
 * Write the spots (patching first if needed): the navel into spot 0, the first two nipples into spots 1 and 2, and a
 * missing one as height, flatten and relief 0. Null switches the detail off (the material then renders exactly as
 * unpatched, apart from the cost of the branch); a material never patched is left alone by it. Only uniform values
 * change, never the program.
 */
export function setClothDetail(material: THREE.Material, state: ClothDetailState | null): void {
  if (!state && !patched.has(material)) return; // nothing to take off a material never patched
  const u = patch(material);
  const slots = state ? slotsOf(state) : [];
  for (let i = 0; i < SPOTS; i++) {
    const s = slots[i] ?? null;
    u.clothSpotC.value[i].set(s ? s.c[0] : 0, s ? s.c[1] : 0, s ? s.c[2] : 0);
    u.clothSpotN.value[i].set(s ? s.n[0] : 0, s ? s.n[1] : 0, s ? s.n[2] : 1);
    u.clothSpotH.value[i] = s ? s.h : 0;
    u.clothSpotR.value[i] = s ? s.r : 1;
    u.clothSpotF.value[i] = s ? s.f : 0;
    u.clothSpotE.value[i] = s ? s.e : 0;
  }
  u.clothDetailOn.value = state ? 1 : 0;
}

/**
 * The same relief, on the CPU, for tests and probes, mirroring the GLSL formula for formula. `displacement` and
 * `flattenWeight` are what the vertex stage does to a garment point standing at p; `gradient` and `shade` are what the
 * fragment stage does at a drawn point p (the shader evaluates them where the point was drawn, after any displacement).
 */
export function clothDetailAt(p: readonly [number, number, number], state: ClothDetailState): ClothDetailSample {
  const gradient: [number, number, number] = [0, 0, 0];
  const displacement: [number, number, number] = [0, 0, 0];
  const flattenWeight = new Array<number>(SPOTS).fill(0);
  let dark = 0;
  slotsOf(state).forEach((s, i) => {
    if (!s) return;
    const r = Math.max(s.r, MIN_RADIUS), r2 = r * r;
    const d = [p[0] - s.c[0], p[1] - s.c[1], p[2] - s.c[2]];
    const along = d[0] * s.n[0] + d[1] * s.n[1] + d[2] * s.n[2];
    const t = [d[0] - along * s.n[0], d[1] - along * s.n[1], d[2] - along * s.n[2]];
    const g = Math.exp(-(t[0] * t[0] + t[1] * t[1] + t[2] * t[2]) / r2);
    const fade = Math.exp(-(along * along) / (4 * r2));
    const k = (s.h - s.f * s.e) * g * fade * (-2 / r2);
    gradient[0] += k * t[0]; gradient[1] += k * t[1]; gradient[2] += k * t[2];
    dark += Math.min(s.h, 0) * g * fade;
    const m = s.f * s.e * g * fade;
    displacement[0] -= m * s.n[0]; displacement[1] -= m * s.n[1]; displacement[2] -= m * s.n[2];
    flattenWeight[i] = s.f * g * fade;
  });
  const shade = 1 + Math.min(0, Math.max(-MAX_DARKEN, dark * DIMPLE_DARKEN));
  return { gradient, shade, displacement, flattenWeight };
}
