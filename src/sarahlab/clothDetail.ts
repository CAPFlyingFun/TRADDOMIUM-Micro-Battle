/**
 * HER DETAIL THROUGH THE CLOTH TEE, in shading (Joshua, 2026-10-24: "the breast slider has no effect on the outfit… it
 * still should have a visible effect", and "the bellybutton also doesn't appear with the slider").
 *
 * The cloth tee (`clothShirt.ts`) is particles about a centimetre apart, so it cannot carry a nipple or a navel as
 * shape: the detail is smaller than the cloth's own spacing and falls between its particles. So it is drawn the way a
 * normal map draws pores. The room works out up to three SPOTS on her posed body each frame -- spot 0 her navel, spots
 * 1 and 2 her nipples -- each a centre on her skin, her skin's outward normal there, a signed height and a radius, and
 * this patch on the tee's material tilts the shading normal around each one as though the fabric lay over a small
 * Gaussian bump (or dimple), and darkens a dimple slightly, the way an innie navel holds a little shadow under a shirt.
 * Nothing moves: the cloth's positions are untouched, only how its surface takes the light.
 *
 * Only fabric lying OVER a spot gets its relief. The footprint fades with distance along the spot's normal too, so the
 * back of the shirt, a body's depth away behind her, shows nothing of the front's detail.
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
}

/** Everything the tee shows through, this frame. */
export interface ClothDetailState {
  readonly navel: ClothDetailSpot | null;
  /** Up to two; extra entries are ignored. */
  readonly nipples: readonly ClothDetailSpot[];
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
}
const patched = new WeakMap<THREE.Material, Uniforms>();

/** A number as a GLSL float literal (an integer gets its `.0`). */
function glslFloat(x: number): string {
  const s = String(x);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

/**
 * One spot reduced to what both the shader and the CPU use: its normal made unit length (a zero normal is left as
 * given), everything else as it came. Null for a missing spot.
 */
interface Slot { readonly c: readonly [number, number, number]; readonly n: [number, number, number]; readonly h: number; readonly r: number }
function slotsOf(state: ClothDetailState): (Slot | null)[] {
  const spots: (ClothDetailSpot | null)[] = [state.navel, state.nipples[0] ?? null, state.nipples[1] ?? null];
  return spots.map((s) => {
    if (!s) return null;
    const [x, y, z] = s.normal;
    const l = Math.hypot(x, y, z);
    const n: [number, number, number] = l > 0 ? [x / l, y / l, z / l] : [x, y, z];
    return { c: s.center, n, h: s.height, r: s.radius };
  });
}

const VERTEX_PARS = 'varying vec3 vClothWorld;';
// `transformed` is final here: after morphs and skinning, still in the object's own space
const VERTEX_WORLD = 'vClothWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;';
const FRAGMENT_PARS = [
  'uniform float clothDetailOn;',
  `uniform vec3 clothSpotC[${SPOTS}];`,
  `uniform vec3 clothSpotN[${SPOTS}];`,
  `uniform float clothSpotH[${SPOTS}];`,
  `uniform float clothSpotR[${SPOTS}];`,
  'varying vec3 vClothWorld;',
].join('\n');
// the summed relief: its tangential gradient (world) and the dimples' shade, the same formula as clothDetailAt
const FRAGMENT_RELIEF = `
    vec3 clothGrad = vec3(0.0);
    float clothShade = 1.0;
    if (clothDetailOn > 0.5) {
      float clothDark = 0.0;
      for (int clothI = 0; clothI < ${SPOTS}; clothI++) {
        float clothR = max(clothSpotR[clothI], ${glslFloat(MIN_RADIUS)});
        float clothR2 = clothR * clothR;
        float clothH = clothSpotH[clothI];
        vec3 clothN = clothSpotN[clothI];
        vec3 clothD = vClothWorld - clothSpotC[clothI];
        float clothAlong = dot(clothD, clothN);
        vec3 clothT = clothD - clothAlong * clothN;
        float clothG = exp(-dot(clothT, clothT) / clothR2);
        float clothFade = exp(-(clothAlong * clothAlong) / (4.0 * clothR2));
        clothGrad += clothH * clothG * clothFade * (-2.0 / clothR2) * clothT;
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
  };
  const previous = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = [VERTEX_PARS, shader.vertexShader].join('\n')
      .replace('#include <project_vertex>', () => `#include <project_vertex>\n${VERTEX_WORLD}`);
    shader.fragmentShader = [FRAGMENT_PARS, shader.fragmentShader].join('\n')
      .replace('#include <color_fragment>', () => `#include <color_fragment>${FRAGMENT_RELIEF}`)
      .replace('#include <normal_fragment_maps>', () => `#include <normal_fragment_maps>${FRAGMENT_TILT}`);
  };
  material.customProgramCacheKey = function () { return `${cacheKey.call(this)}|cloth-detail-v1`; };
  material.needsUpdate = true;
  patched.set(material, uniforms);
  return uniforms;
}

/**
 * Write the spots (patching first if needed): the navel into spot 0, the first two nipples into spots 1 and 2, and a
 * missing one as height 0. Null switches the detail off (the material then renders exactly as unpatched, apart from
 * the cost of the branch); a material never patched is left alone by it. Only uniform values change, never the program.
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
  }
  u.clothDetailOn.value = state ? 1 : 0;
}

/**
 * The same relief, on the CPU, for tests and probes: the tangential gradient of the summed height field at world point
 * p, and the shade factor (1 = unchanged, < 1 darker). Must match the GLSL exactly in formula.
 */
export function clothDetailAt(p: readonly [number, number, number], state: ClothDetailState): { gradient: [number, number, number]; shade: number } {
  const gradient: [number, number, number] = [0, 0, 0];
  let dark = 0;
  for (const s of slotsOf(state)) {
    if (!s || s.h === 0) continue;
    const r = Math.max(s.r, MIN_RADIUS), r2 = r * r;
    const d = [p[0] - s.c[0], p[1] - s.c[1], p[2] - s.c[2]];
    const along = d[0] * s.n[0] + d[1] * s.n[1] + d[2] * s.n[2];
    const t = [d[0] - along * s.n[0], d[1] - along * s.n[1], d[2] - along * s.n[2]];
    const g = Math.exp(-(t[0] * t[0] + t[1] * t[1] + t[2] * t[2]) / r2);
    const fade = Math.exp(-(along * along) / (4 * r2));
    const k = s.h * g * fade * (-2 / r2);
    gradient[0] += k * t[0]; gradient[1] += k * t[1]; gradient[2] += k * t[2];
    dark += Math.min(s.h, 0) * g * fade;
  }
  const shade = 1 + Math.min(0, Math.max(-MAX_DARKEN, dark * DIMPLE_DARKEN));
  return { gradient, shade };
}
