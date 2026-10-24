/**
 * THE TEE'S NECKLINE, ADJUSTABLE (Joshua, 2026-10-24: "can the neckline also be adjustable like the length so you can
 * do U/V shape and select how deep up to turtleneck?").
 *
 * Two ways from the neckline as made. UP: the cloth tee (`clothShirt.ts`) carries extra rows of cloth above its
 * neckline, a collar, and a share of 0..1 says how much of it shows -- none of it is the tee as made, all of it a
 * turtleneck. DOWN: the front is cut deeper, in a U or a V, by a depth in metres below the neckline as made. Which
 * cloth exists at all is decided on the CPU, by the cloth module; this module is only the shader's half of it, the
 * EDGE. The cloth is particles about a centimetre apart, so an edge that followed its triangles would be a zigzag a
 * centimetre deep round her neck; instead every point of the cloth carries where it stands against the neckline's
 * curves, the fragment stage interpolates that between the particles, and `discard` drops every fragment past the
 * curve the setting makes -- a smooth curve through the triangles rather than along their sides.
 *
 * Seen from the front, a U cut D deeper than made is y = n(x) - D·(1 - u²) and a V is y = y0 + (y_s - y0)·u - D·(1 - u),
 * where n is the neckline as made, y0 its lowest point, y_s its height where it meets her shoulders and u = |x| / (the
 * neckline's half-width there): `scripts/sarahV2Recovery/shirt-cloth.mjs` says why those shapes. The contract with the
 * cloth is one `vec4` attribute on every render vertex, `clothNeck` (`CLOTH_NECKLINE_ATTRIBUTE`), in metres: `x` how far
 * the point stands below the U's line as made, n(x) - y; `y` below the V's, y0 + (y_s - y0)·u - y; `z` its u; and `w`
 * 0 everywhere but the collar rows above the neckline, where it is that point's share of the collar's height, 0..1.
 * (Where no front neckline reaches, x and y are 9 and z 0.) A fragment is dropped where its collar share stands above
 * the share showing, or where it stands less far below the chosen shape's line than D·(1 - u²) (U) or D·(1 - u) (V).
 * The curve is worked out at every fragment from those three, which are smooth over the cloth; a depth per particle
 * instead -- (n - y) / (1 - u²), the D that reaches it -- runs off to infinity at her shoulder points, and drawn between
 * particles it bent the edge into waves there. With the collar all showing nothing is dropped for its height, and with
 * no depth cut nothing for its depth, whatever the attribute says, so the tee as made and a full turtleneck are exactly
 * the cloth.
 * `clothNecklineCut` is the same test worked on the CPU, formula for formula, so a test or a probe can say what the
 * shader drops without a GPU.
 *
 * The material is SHARED: the room draws the same material on the skinned (fitted) tee as well, and that geometry has
 * no `clothNeck` attribute, so what the shader reads from it there is whatever the GL's default is. The room switches
 * the cut off whenever that mesh is drawn, and with the cut off the whole test is skipped, so the attribute's value
 * there never reaches the picture: off, the material draws exactly as unpatched.
 *
 * The patch follows `fabricMaterial.ts`'s and `clothDetail.ts`'s pattern and lives alongside both on the same
 * material, in any order: it chains onto whatever `onBeforeCompile` and `customProgramCacheKey` the material already
 * has, keeps every `#include` token it hooks so the others can still find them, is applied once per material, and
 * every later change is a uniform value.
 */
import * as THREE from 'three';

/** The vertex attribute the cloth carries for this patch: (below the U's line, below the V's, u, collar share), see the module header. */
export const CLOTH_NECKLINE_ATTRIBUTE = 'clothNeck';

/** Where the tee's neckline stands. */
export interface ClothNecklineState {
  /** 0..1: how much of the collar (rows above the neckline) shows; 0 none, 1 all of it (a turtleneck). */
  readonly collar: number;
  /** Metres, >= 0: how far below the neckline as made the front is cut (0 as made). */
  readonly depth: number;
  readonly shape: 'U' | 'V';
}

interface Uniforms {
  readonly clothNeckOn: THREE.IUniform<number>;
  readonly clothNeckCollar: THREE.IUniform<number>;
  readonly clothNeckDepth: THREE.IUniform<number>;
  readonly clothNeckShape: THREE.IUniform<number>;
}
const patched = new WeakMap<THREE.Material, Uniforms>();

/** A state reduced to what both the shader and the CPU use: the collar clamped to 0..1, the depth to >= 0, the shape 0 (U) or 1 (V). */
interface Setting { readonly collar: number; readonly depth: number; readonly shape: number }
function settingOf(state: ClothNecklineState): Setting {
  const collar = Number.isFinite(state.collar) ? Math.min(1, Math.max(0, state.collar)) : 0;
  const depth = Number.isFinite(state.depth) ? Math.max(0, state.depth) : 0;
  return { collar, depth, shape: state.shape === 'V' ? 1 : 0 };
}

const VERTEX_PARS = [`attribute vec4 ${CLOTH_NECKLINE_ATTRIBUTE};`, 'varying vec4 vClothNeck;'].join('\n');
const FRAGMENT_PARS = [
  'varying vec4 vClothNeck;',
  'uniform float clothNeckOn;',
  'uniform float clothNeckCollar;',
  'uniform float clothNeckDepth;',
  'uniform float clothNeckShape;',
].join('\n');
// the varying is written beside three's own first position, so it is there whatever moves the point later
const VERTEX_NECK = `
    vClothNeck = ${CLOTH_NECKLINE_ATTRIBUTE};`;
// the whole test sits inside the switch, so with the cut off nothing the attribute holds can drop a fragment; a collar
// all showing drops nothing for its height (an interpolated 1 can land an ulp above 1), and no depth nothing for its
// depth. The same formula as clothNecklineCut.
const FRAGMENT_CUT = `
    if (clothNeckOn > 0.5) {
      if (clothNeckCollar < 1.0 && vClothNeck.w > clothNeckCollar) discard;
      float clothNeckU = clamp(vClothNeck.z, 0.0, 1.0);
      float clothNeckAt = clothNeckShape > 0.5 ? vClothNeck.y : vClothNeck.x;
      float clothNeckLine = clothNeckDepth * (clothNeckShape > 0.5 ? 1.0 - clothNeckU : 1.0 - clothNeckU * clothNeckU);
      if (clothNeckDepth > 0.0 && clothNeckAt < clothNeckLine) discard;
    }`;

/** Patch a material once (idempotent); the cut starts OFF. */
export function patchClothNeckline(material: THREE.Material): void {
  patch(material);
}

function patch(material: THREE.Material): Uniforms {
  const known = patched.get(material);
  if (known) return known;
  const uniforms: Uniforms = {
    clothNeckOn: { value: 0 },
    clothNeckCollar: { value: 0 },
    clothNeckDepth: { value: 0 },
    clothNeckShape: { value: 0 },
  };
  const previous = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = [VERTEX_PARS, shader.vertexShader].join('\n')
      .replace('#include <begin_vertex>', () => `#include <begin_vertex>${VERTEX_NECK}`);
    shader.fragmentShader = [FRAGMENT_PARS, shader.fragmentShader].join('\n')
      .replace('#include <clipping_planes_fragment>', () => `#include <clipping_planes_fragment>${FRAGMENT_CUT}`);
  };
  material.customProgramCacheKey = function () { return `${cacheKey.call(this)}|cloth-neckline-v1`; };
  material.needsUpdate = true;
  patched.set(material, uniforms);
  return uniforms;
}

/**
 * Set the neckline (patching first if needed). Null switches the cut off (the material then draws exactly as
 * unpatched, apart from the cost of the branch); a material never patched is left alone by it. Only uniform values
 * change, never the program.
 */
export function setClothNeckline(material: THREE.Material, state: ClothNecklineState | null): void {
  if (!state && !patched.has(material)) return; // nothing to take off a material never patched
  const u = patch(material);
  const s = state ? settingOf(state) : null;
  u.clothNeckOn.value = s ? 1 : 0;
  u.clothNeckCollar.value = s ? s.collar : 0;
  u.clothNeckDepth.value = s ? s.depth : 0;
  u.clothNeckShape.value = s ? s.shape : 0;
}

/**
 * The shader's test on the CPU, formula for formula: true where a fragment whose interpolated `clothNeck` is `neck`
 * (below the U's line, below the V's, u, collar share) is discarded. A null state is the cut switched off: nothing is
 * ever cut.
 */
export function clothNecklineCut(neck: readonly [number, number, number, number], state: ClothNecklineState | null): boolean {
  if (!state) return false;
  const s = settingOf(state);
  if (s.collar < 1 && neck[3] > s.collar) return true;
  return s.depth > 0 && clothNecklineBelow(neck, s.depth, s.shape > 0.5 ? 'V' : 'U') < 0;
}

/**
 * How far below the cut line, cut `depth` metres deeper in `shape`, a point stands: its height below the shape's line as
 * made less the depth there -- D·(1 - u²) for a U, D·(1 - u) for a V. Negative is cut away. In metres measured UP AND
 * DOWN, so near her shoulder points, where the line runs steep, it overstates the distance across to the line.
 */
export function clothNecklineBelow(neck: readonly [number, number, number, number], depth: number, shape: 'U' | 'V'): number {
  const u = Math.min(1, Math.max(0, neck[2])), d = Math.max(0, Number.isFinite(depth) ? depth : 0);
  return shape === 'V' ? neck[1] - d * (1 - u) : neck[0] - d * (1 - u * u);
}
