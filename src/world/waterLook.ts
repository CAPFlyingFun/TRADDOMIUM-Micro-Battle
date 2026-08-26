import * as THREE from 'three';
import { assetBytes } from '../ui/assetSizes';
import type { LoadReport } from '../ui/loadPlan';

/**
 * WHAT MAKES THE WATER READ AS WATER.
 *
 * Kept out of the surface itself for one reason with history behind it:
 * this is seven `.replace` calls against three.js's own source, and a
 * replace that MISSES is not an error. It is silence, and the water
 * comes back subtly wrong from a clean build. Both silent misses this
 * project has shipped were found here — a varying three.js only
 * declares when the material has a map, which failed to link and drew
 * every stream black; and an `#ifdef` on a macro that no longer
 * existed, which compiled perfectly and left the water fighting the
 * land for the same pixels. Pulled out so a test can compose it.
 */

/** Depth at which the water reaches full opacity, in units. */
export const EDGE_FADE = 6;
/** How opaque it gets there. */
export const SURFACE_ALPHA = 0.86;

/**
 * FOUR SAMPLES OF ONE TILING MAP, at scales sharing no factor.
 *
 * Beyond Extinction shipped this idea twice. First as a sum of cosine
 * wavelets, which its own comment records as beating "into a hard
 * diamond grid/moiré (playtest)", and then as this. The property that
 * makes the second one work is that the scales are coprime and each is
 * turned by its own angle, so their repeats never come into register.
 *
 * That property is four numbers in a string. Nothing stops someone
 * rounding 263 and 127 to 250 and 125, which would put a repeat every
 * 250 units in both and hand the water its grid back — and it would
 * look fine in a still and wrong in motion, which is the hardest kind
 * of regression to catch. So a test checks them.
 */
export const RIPPLE_SCALES = [37, 71, 127, 263] as const;
const RIPPLE_TURNS = [0.0, 1.1, 2.3, 3.7] as const;

export const clockUniform = { value: 0 };
export const rippleUniform: { value: THREE.Texture | null } = { value: null };

/** Load the ripple map, tiling and mipmapped. */
export function loadRipple(url = 'water-normal.png'): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, (map) => {
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.generateMipmaps = true;
      map.minFilter = THREE.LinearMipmapLinearFilter;
      rippleUniform.value = map;
      resolve(map);
    }, undefined, reject);
  });
}

/** Turn a 2-vector by an angle, in GLSL. */
const SPIN_GLSL = `
vec2 tmbSpin(float a, vec2 v) {
  float c = cos(a), s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}
`;

/**
 * Patch three.js's standard shader into the water's.
 *
 * Returns the pair rather than mutating, so a test can hold the output
 * to what it must contain without a GPU anywhere near it.
 */
export function waterShader(
  vert: string, frag: string,
): { vertexShader: string; fragmentShader: string } {
  const vertexShader = vert
    .replace('#include <common>', `#include <common>
attribute float rise;
attribute float flowx;
attribute float flowz;
varying float v_rise;
varying vec2 v_flow;
varying vec2 v_world;
varying vec3 v_eye;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
v_rise = rise;
v_flow = vec2(flowx, flowz);
// WORLD-LOCKED, not UV-locked. The ribbon's own coordinates slide with
// the floating origin, so a ripple tied to them would swim upstream
// every time the scene rebased.
v_world = (modelMatrix * vec4(transformed, 1.0)).xz;
v_eye = (modelViewMatrix * vec4(transformed, 1.0)).xyz;`);

  const fragmentShader = frag
    .replace('#include <common>', `#include <common>
uniform float clock;
uniform sampler2D ripple;
varying float v_rise;
varying vec2 v_flow;
varying vec2 v_world;
varying vec3 v_eye;
${SPIN_GLSL}`)
    // ONE INJECTION, AND IT GOES AFTER `normal_fragment_begin` —
    // WHICH IS WHERE `normal` COMES INTO EXISTENCE.
    //
    // This was two injections and the colour half sat on
    // `color_fragment`, which reads earlier in three.js's standard
    // shader than the normal is declared. It compiled to
    // "'normal' : undeclared identifier" and the whole material fell
    // back to an invalid program, so every river on the island drew
    // nothing at all. Nothing between the two chunks touches
    // diffuseColor's rgb, so doing the work here costs nothing and the
    // ripple, the sheen and the depth tint all have what they need.
    .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
{
  vec2 drift = v_flow * clock * 26.0;
  vec3 wob = vec3(0.0);
  ${RIPPLE_SCALES.map((s, i) => `wob += texture2D(ripple, tmbSpin(${RIPPLE_TURNS[i].toFixed(1)}, v_world - drift) / ${s}.0).xyz * 2.0 - 1.0;`).join('\n  ')}
  wob /= ${RIPPLE_SCALES.length}.0;
  normal = normalize(normal + vec3(wob.x, 0.0, wob.y) * 0.55);

  // SHALLOW IS CLEARER AND GREENER, deep is darker and bluer — the two
  // things that tell an eye how deep water is without a number.
  float deep = clamp(v_rise / 90.0, 0.0, 1.0);
  diffuseColor.rgb = mix(vec3(0.16, 0.34, 0.31), vec3(0.05, 0.19, 0.28), deep);
  // A sheen at grazing angles. Water seen edge-on is a mirror and water
  // seen from above is a window, and nothing else reads as a surface.
  float fres = pow(1.0 - clamp(dot(normalize(-v_eye), normal), 0.0, 1.0), 4.0);
  diffuseColor.rgb += vec3(0.16, 0.20, 0.22) * fres;
  float t = clamp(v_rise / ${EDGE_FADE}.0, 0.0, 1.0);
  diffuseColor.a = ${SURFACE_ALPHA} * (t * t * (3.0 - 2.0 * t));
  // Water with no depth is not water. Discarding rather than drawing at
  // zero alpha matters: an invisible fragment still writes depth and
  // would fight the bank for the same pixels.
  if (v_rise <= 0.0) discard;
}`);

  return { vertexShader, fragmentShader };
}

/** The water's material, patched and ready. */
export function waterMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    transparent: true,
    roughness: 0.58,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.clock = clockUniform;
    shader.uniforms.ripple = rippleUniform;
    const both = waterShader(shader.vertexShader, shader.fragmentShader);
    shader.vertexShader = both.vertexShader;
    shader.fragmentShader = both.fragmentShader;
  };
  return material;
}

/** What the loading bar calls the two halves of the water. */
export const RIPPLE_JOB = 'ripple';
export const HYDRO_JOB = 'hydro';

/**
 * Declare the water's downloads before a byte arrives.
 *
 * FIRM, both of them, and the reason is written on the bar Joshua saw:
 * "when I first started the loading it said 5.0mb, but then dropped to
 * 4.6mb". These are served gzipped, so a fetch's progress total counts
 * COMPRESSED bytes and resizing the job by it walks the declared total
 * downwards as files land. The baked size is the real one.
 */
export function planWater(report: LoadReport): void {
  const ripple = assetBytes('water-normal.png');
  const hydro = assetBytes('kauai-hydro.bin');
  report.add(RIPPLE_JOB, 'The water', ripple ?? 205_703, true, ripple !== null);
  report.add(HYDRO_JOB, 'Rivers and lakes', hydro ?? 839_071, true, hydro !== null);
}
