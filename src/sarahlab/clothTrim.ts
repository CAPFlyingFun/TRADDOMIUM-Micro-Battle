/**
 * THE CROP AND THE TANK (Joshua, 2026-10-25: "make 0 like a cropped tank athletic top instead"; and, choosing it, a
 * SLEEVES switch that picks tank or cap sleeve at any length).
 *
 * Two more cuts of the cloth tee (`clothShirt.ts`), drawn the way the neckline's are (`clothNeckline.ts`): which cloth
 * exists is decided on the CPU, by the cloth module; this module is only the shader's half of it, the EDGE, a smooth
 * curve through the triangles rather than a zigzag along their sides.
 * - THE CROP. TEE LENGTH below the tee as made shortens it toward a crop top, a share `crop` of the way: 0 the hem as
 *   made, 1 the crop's hem, which stands about four centimetres under her breasts' crease at her sides and a little lower
 *   at her front. Between, the hem's line is raised smoothly from the one to the other.
 * - THE TANK. SLEEVES off cuts each sleeve away at an armhole running from the strap over her shoulder down to her side,
 *   a little under her armpit.
 *
 * The contract with the cloth is one `vec3` attribute on every render vertex, `clothTrim` (`CLOTH_TRIM_ATTRIBUTE`), in
 * metres (`scripts/sarahV2Recovery/shirt-cloth.mjs` writes it): `x` how far the point stands above the hem as made, `y`
 * above the crop's hem, and `z` how far inside the tank's armhole edge (negative is cut away; the sleeve itself always
 * stands at least a centimetre outside it). A fragment is dropped where (1 - crop)·x + crop·y < 0 with crop > 0, and
 * where z < 0 with the tank on. The rows below the hem and the collar carry x and y far above any hem, so the crop never
 * reaches them; with crop 0 and the tank off nothing is dropped whatever the attribute says, so the tee as made is
 * exactly the cloth.
 * `clothTrimCut` is the same test worked on the CPU, formula for formula, so a test or a probe can say what the shader
 * drops without a GPU.
 *
 * The material is SHARED with the fitted light tee, which has no `clothTrim` attribute: the room switches the cut off
 * whenever that mesh is drawn, and with it off the whole test is skipped. The patch follows `clothNeckline.ts`'s pattern
 * and lives alongside it and the others on the same material, in any order: it chains onto whatever `onBeforeCompile`
 * and `customProgramCacheKey` the material already has, keeps every `#include` token it hooks, is applied once per
 * material, and every later change is a uniform value.
 */
import * as THREE from 'three';

/** The vertex attribute the cloth carries for this patch: (above the hem as made, above the crop's hem, inside the armhole), metres. */
export const CLOTH_TRIM_ATTRIBUTE = 'clothTrim';

/** Where the tee is trimmed. */
export interface ClothTrimState {
  /** 0..1: how far the hem is raised from the hem as made (0) to the crop's (1). */
  readonly crop: number;
  /** True: the sleeves cut away at the tank's armholes. */
  readonly tank: boolean;
}

interface Uniforms {
  readonly clothTrimOn: THREE.IUniform<number>;
  readonly clothTrimCrop: THREE.IUniform<number>;
  readonly clothTrimTank: THREE.IUniform<number>;
}
const patched = new WeakMap<THREE.Material, Uniforms>();

/** The crop share clamped to 0..1 (0 for anything not a number). */
export function cropShare(crop: number): number {
  return Number.isFinite(crop) ? Math.min(1, Math.max(0, crop)) : 0;
}

const VERTEX_PARS = [`attribute vec3 ${CLOTH_TRIM_ATTRIBUTE};`, 'varying vec3 vClothTrim;'].join('\n');
const FRAGMENT_PARS = ['varying vec3 vClothTrim;', 'uniform float clothTrimOn;', 'uniform float clothTrimCrop;', 'uniform float clothTrimTank;'].join('\n');
const VERTEX_TRIM = `
    vClothTrim = ${CLOTH_TRIM_ATTRIBUTE};`;
// the whole test sits inside the switch; the same formula as clothTrimCut
const FRAGMENT_CUT = `
    if (clothTrimOn > 0.5) {
      if (clothTrimCrop > 0.0 && mix(vClothTrim.x, vClothTrim.y, clothTrimCrop) < 0.0) discard;
      if (clothTrimTank > 0.5 && vClothTrim.z < 0.0) discard;
    }`;

/** Patch a material once (idempotent); the cut starts OFF. */
export function patchClothTrim(material: THREE.Material): void {
  patch(material);
}

function patch(material: THREE.Material): Uniforms {
  const known = patched.get(material);
  if (known) return known;
  const uniforms: Uniforms = { clothTrimOn: { value: 0 }, clothTrimCrop: { value: 0 }, clothTrimTank: { value: 0 } };
  const previous = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = [VERTEX_PARS, shader.vertexShader].join('\n')
      .replace('#include <begin_vertex>', () => `#include <begin_vertex>${VERTEX_TRIM}`);
    shader.fragmentShader = [FRAGMENT_PARS, shader.fragmentShader].join('\n')
      .replace('#include <clipping_planes_fragment>', () => `#include <clipping_planes_fragment>${FRAGMENT_CUT}`);
  };
  material.customProgramCacheKey = function () { return `${cacheKey.call(this)}|cloth-trim-v1`; };
  material.needsUpdate = true;
  patched.set(material, uniforms);
  return uniforms;
}

/**
 * Set the trim (patching first if needed). Null switches the cut off (the material then draws exactly as unpatched,
 * apart from the cost of the branch); a material never patched is left alone by it. Only uniform values change.
 */
export function setClothTrim(material: THREE.Material, state: ClothTrimState | null): void {
  if (!state && !patched.has(material)) return;
  const u = patch(material);
  u.clothTrimOn.value = state ? 1 : 0;
  u.clothTrimCrop.value = state ? cropShare(state.crop) : 0;
  u.clothTrimTank.value = state?.tank ? 1 : 0;
}

/** How far above the hem the crop share makes a point with this `clothTrim` stands (metres; negative is cut away). */
export function clothTrimAbove(trim: readonly [number, number, number], crop: number): number {
  const s = cropShare(crop);
  return trim[0] + (trim[1] - trim[0]) * s;
}

/** The shader's test on the CPU, formula for formula: true where a fragment whose interpolated `clothTrim` is `trim` is discarded. */
export function clothTrimCut(trim: readonly [number, number, number], state: ClothTrimState | null): boolean {
  if (!state) return false;
  const s = cropShare(state.crop);
  if (s > 0 && clothTrimAbove(trim, s) < 0) return true;
  return !!state.tank && trim[2] < 0;
}
