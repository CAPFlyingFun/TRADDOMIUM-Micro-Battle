/**
 * THE NEW TEE'S CUT EDGES, DRAWN BY THE MATERIAL (Stage 3): a length, a sleeve or a neckline that ends partway across the
 * cloth's triangles ends on a smooth line rather than on a zigzag of triangle sides -- the cloth tee's way (`clothTrim.ts`,
 * `clothNeckline.ts`). Which cloth exists is the cloth's own business (`garmentCloth.ts` simulates and draws only the
 * triangles a cut keeps); this module is only the shader's half of it: one float per render vertex, `garmentCut`
 * (CUT_EDGE_ATTRIBUTE), signed metres from the nearest cut line in its piece's plane (`cuts.ts`), and a fragment is
 * dropped where it is below 0.
 *
 * The material is the light tee's, SHARED with the fitted tee and the cloth tee, which carry no such attribute: the
 * switch is a uniform, on while the new tee is drawn, and a mesh without the attribute reads 0, which is never dropped.
 * Patched once per material, chaining whatever `onBeforeCompile` and `customProgramCacheKey` it already has, alongside the
 * room's other patches in any order; every later change is a uniform value. `cutEdgeDropped` is the shader's test on the
 * CPU, for a test or a probe.
 */
import * as THREE from 'three';

/** The vertex attribute the new tee carries for this patch: signed metres from the nearest cut line (below 0, cut away). */
export const CUT_EDGE_ATTRIBUTE = 'garmentCut';

interface Uniforms { readonly garmentCutOn: THREE.IUniform<number> }
const patched = new WeakMap<THREE.Material, Uniforms>();

const VERTEX_PARS = [`attribute float ${CUT_EDGE_ATTRIBUTE};`, 'varying float vGarmentCut;'].join('\n');
const FRAGMENT_PARS = ['varying float vGarmentCut;', 'uniform float garmentCutOn;'].join('\n');
const VERTEX_CUT = `
    vGarmentCut = ${CUT_EDGE_ATTRIBUTE};`;
// the same test as cutEdgeDropped
const FRAGMENT_CUT = `
    if (garmentCutOn > 0.5 && vGarmentCut < 0.0) discard;`;

function patch(material: THREE.Material): Uniforms {
  const known = patched.get(material);
  if (known) return known;
  const uniforms: Uniforms = { garmentCutOn: { value: 0 } };
  const previous = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = [VERTEX_PARS, shader.vertexShader].join('\n')
      .replace('#include <begin_vertex>', () => `#include <begin_vertex>${VERTEX_CUT}`);
    shader.fragmentShader = [FRAGMENT_PARS, shader.fragmentShader].join('\n')
      .replace('#include <clipping_planes_fragment>', () => `#include <clipping_planes_fragment>${FRAGMENT_CUT}`);
  };
  material.customProgramCacheKey = function () { return `${cacheKey.call(this)}|garment-cut-v1`; };
  material.needsUpdate = true;
  patched.set(material, uniforms);
  return uniforms;
}

/** Patch a material once (idempotent); the cut starts OFF. */
export function patchCutEdge(material: THREE.Material): void {
  patch(material);
}

/**
 * The cut on or off (patching first if needed). Off, the material draws exactly as unpatched apart from the branch; a
 * material never patched is left alone by `false`.
 */
export function setCutEdge(material: THREE.Material, on: boolean): void {
  if (!on && !patched.has(material)) return;
  patch(material).garmentCutOn.value = on ? 1 : 0;
}

/** Whether the cut is on for a material (false for one never patched). */
export function cutEdgeOn(material: THREE.Material): boolean {
  return (patched.get(material)?.garmentCutOn.value ?? 0) > 0.5;
}

/** The shader's test on the CPU: true where a fragment whose interpolated `garmentCut` is `value` is dropped. */
export function cutEdgeDropped(value: number, on: boolean): boolean {
  return on && value < 0;
}
