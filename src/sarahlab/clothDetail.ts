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
 * Only fabric lying OVER a spot gets any of this: the footprint fades with distance along the spot's normal too, so the
 * back of the shirt, a body's depth away behind her, shows nothing of the front's detail.
 *
 * The FITTED tee (the modelled, skinned one) shares this material, and it carries her navel of its own, MODELLED into
 * its geometry: a broad dome over her outie, 8-9 mm high at 100%; and a modelled navel can as well be a hole whose
 * walls stand nearly vertical (the tee's own file has one, about 13 mm deep, under the room's fitting shapes at a small
 * belly). Shading over that cannot take it away, and neither can a displacement with a radial profile (the v2 patch's
 * `flatten`): a wall puts points at the same distance from the axis at different depths, so no one curve of r fits
 * them (measured: 2-14 mm left over). So at a low NAVEL DETAIL the garment is SETTLED instead. The
 * room fits the garment's own smooth surface round the navel's axis -- a tilted, anisotropic quadric, `height +
 * slope·t - t·(curvature t)` along the axis at a tangential offset t, because her belly curves differently up and down
 * than across it and the axis leans a little against the tee (a round paraboloid left ±4 mm of fit error 20-30 mm out;
 * the quadric, fitted on an annulus round the navel, ±1 mm) -- and the vertex stage moves every garment point inside a
 * window round the axis toward that surface by `amount` of its own deviation from it: a dome is pressed down, a hole
 * lifted out, a wall laid flat, each point to its own place on the smooth surface. The tee is two layers about a millimetre apart, so a point whose normal
 * faces her (the inner layer) is settled `thickness` inside the surface, and a wall's point part of that, and the
 * layers stay apart rather than landing on one another. A point deviating by much more than a navel ever does
 * (`reach`) is left alone: that is the back of the shirt, a body's depth behind. The tee's own normals still carry the
 * hole's slopes, so the fragment stage mixes the shading normal toward the smooth surface's own by the same weight, and
 * the light falls on the settled fabric as it would on a smooth one. With nothing to settle the vertex stage writes no
 * position at all, so a tee that is not being settled draws exactly as it did; the cloth tee has no modelled relief of
 * its own and leaves the settle out.
 *
 * Every position is in WORLD units (the room's scene, 100 to the metre). `clothDetailAt` is the same shading and the
 * same settle worked on the CPU, formula for formula, so a test or a probe can say what the shader draws without a GPU.
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

/**
 * A garment's own modelled relief round one axis, taken back toward the garment's smooth surface there (the fitted
 * tee's navel). Everything WORLD units (100 to the metre).
 */
export interface ClothDetailSettle {
  /** A point on the axis, and the axis: her smooth surface's outward unit normal there (normalize defensively). */
  readonly center: readonly [number, number, number];
  readonly normal: readonly [number, number, number];
  /** The garment's smooth surface along the axis from `center`, at a tangential offset t (world, ⟂ normal): `height + slope·t − t·(curvature t)`. */
  readonly height: number;
  /** Tangent to the axis (any component along `normal` is ignored: project it out defensively). */
  readonly slope: readonly [number, number, number];
  /** A symmetric 3x3 acting on the tangential offset, row-major [xx, xy, xz, yx, yy, yz, zx, zy, zz] (world). Use it as given on t; symmetric by contract. */
  readonly curvature: readonly number[];
  /** The window, tangential distance from the axis: everything inside `inner` is settled fully, nothing past `outer` (smoothstep between). */
  readonly inner: number;
  readonly outer: number;
  /** 0..1 (clamp): how much of each point's deviation from the smooth surface is taken back. 0 moves nothing. */
  readonly amount: number;
  /** The garment's thickness: a point whose normal faces her (the inner layer) is settled this far INSIDE the smooth surface. */
  readonly thickness: number;
  /** A point deviating more than this from the smooth surface is left alone, fading out to nothing at 1.5x (the back of the garment, a body's depth behind). */
  readonly reach: number;
}

/** Everything the tee shows through, this frame. */
export interface ClothDetailState {
  readonly navel: ClothDetailSpot | null;
  /** Up to two; extra entries are ignored. */
  readonly nipples: readonly ClothDetailSpot[];
  /** The garment's own modelled relief taken back (the fitted tee's navel). Missing or null: off. */
  readonly settle?: ClothDetailSettle | null;
}

/** What the shader does at one point, worked on the CPU (`clothDetailAt`). */
export interface ClothDetailSample {
  /** The tangential gradient of the spots' summed height field (world): the shading normal is tilted by minus this. */
  gradient: [number, number, number];
  /** The colour's factor from the dimples: 1 unchanged, below 1 darker, never below 1 - MAX_DARKEN. */
  shade: number;
  /** How far the vertex stage moves a garment point standing at p with the given normal (world): along the settle's axis. */
  displacement: [number, number, number];
  /** The fragment stage's mix of the shading normal toward the smooth surface's at a drawn point p: amount · w · reachW (0..1). */
  settleWeight: number;
  /** The smooth surface's unit normal (world) the fragment stage mixes toward at p, `normalize(N − L + 2·(Qt)⟂)`; null with no settle. */
  settleNormal: [number, number, number] | null;
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
  readonly clothSettleOn: THREE.IUniform<number>;
  readonly clothSettleC: THREE.IUniform<THREE.Vector3>;
  readonly clothSettleN: THREE.IUniform<THREE.Vector3>;
  readonly clothSettleH: THREE.IUniform<number>;
  readonly clothSettleL: THREE.IUniform<THREE.Vector3>;
  readonly clothSettleQ: THREE.IUniform<THREE.Matrix3>;
  readonly clothSettleIn: THREE.IUniform<number>;
  readonly clothSettleOut: THREE.IUniform<number>;
  readonly clothSettleF: THREE.IUniform<number>;
  readonly clothSettleT: THREE.IUniform<number>;
  readonly clothSettleR: THREE.IUniform<number>;
}
const patched = new WeakMap<THREE.Material, Uniforms>();

/** A number as a GLSL float literal (an integer gets its `.0`). */
function glslFloat(x: number): string {
  const s = String(x);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

/** Clamped to 0..1, with anything that is not a number (NaN) as 0. */
const clamp01 = (x: number): number => (x > 0 ? Math.min(1, x) : 0);

/** A direction made unit length; null for one with no length, or none that is finite. */
function unit(v: readonly [number, number, number]): [number, number, number] | null {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 0 && Number.isFinite(l) ? [v[0] / l, v[1] / l, v[2] / l] : null;
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
    const n = unit(s.normal) ?? [s.normal[0], s.normal[1], s.normal[2]];
    return { c: s.center, n, h: s.height, r: s.radius };
  });
}

/**
 * The settle reduced the same way: its axis made unit length, its slope made tangent to it, its curvature's nine
 * entries as given (a missing one 0), its amount clamped to 0..1. Null when it is missing or has no axis to settle
 * along (a zero normal) -- which the shader sees as the settle switched off.
 */
interface Settle {
  readonly c: readonly [number, number, number]; readonly n: [number, number, number]; readonly h: number;
  readonly l: [number, number, number]; readonly q: number[];
  readonly inner: number; readonly outer: number; readonly f: number; readonly t: number; readonly reach: number;
}
function settleOf(state: ClothDetailState): Settle | null {
  const s = state.settle;
  if (!s) return null;
  const n = unit(s.normal);
  if (!n) return null;
  const [lx, ly, lz] = s.slope, ln = lx * n[0] + ly * n[1] + lz * n[2];
  const l: [number, number, number] = [lx - ln * n[0], ly - ln * n[1], lz - ln * n[2]];
  const q = Array.from({ length: 9 }, (_, i) => s.curvature[i] ?? 0);
  return { c: s.center, n, h: s.height, l, q, inner: s.inner, outer: s.outer, f: clamp01(s.amount), t: s.thickness, reach: s.reach };
}

/**
 * A point in the settle's frame, the CPU twin of `settleFrame` below: its height along the axis, its tangential offset
 * t and r = |t|, Q t, and the smooth surface's height along the axis there.
 */
function frameOf(s: Settle, p: readonly [number, number, number]): { along: number; t: number[]; r: number; qt: number[]; surf: number } {
  const n = s.n, q = s.q;
  const d = [p[0] - s.c[0], p[1] - s.c[1], p[2] - s.c[2]];
  const along = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
  const t = [d[0] - along * n[0], d[1] - along * n[1], d[2] - along * n[2]];
  const qt = [0, 1, 2].map((i) => q[3 * i] * t[0] + q[3 * i + 1] * t[1] + q[3 * i + 2] * t[2]);
  const surf = s.h + (s.l[0] * t[0] + s.l[1] * t[1] + s.l[2] * t[2]) - (t[0] * qt[0] + t[1] * qt[1] + t[2] * qt[2]);
  return { along, t, r: Math.hypot(t[0], t[1], t[2]), qt, surf };
}

/** GLSL's smoothstep, for edges in order (e0 < e1). */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
/** The window across the axis: 1 inside `inner`, 0 from `outer`; edges out of order are a hard edge at `outer`. */
const settleWindow = (s: Settle, r: number): number => (s.inner < s.outer ? 1 - smoothstep(s.inner, s.outer, r) : r < s.outer ? 1 : 0);
/** The reach along it: 1 up to `reach` of deviation, 0 from 1.5x; no reach settles nothing. */
const settleReach = (s: Settle, dev: number): number => (s.reach > 0 ? 1 - smoothstep(s.reach, 1.5 * s.reach, Math.abs(dev)) : 0);

/** The uniforms, declared the same in both stages (the same uniform objects feed both). */
const PARS = [
  'uniform float clothDetailOn;',
  `uniform vec3 clothSpotC[${SPOTS}];`,
  `uniform vec3 clothSpotN[${SPOTS}];`,
  `uniform float clothSpotH[${SPOTS}];`,
  `uniform float clothSpotR[${SPOTS}];`,
  'uniform float clothSettleOn;',
  'uniform vec3 clothSettleC;',
  'uniform vec3 clothSettleN;',
  'uniform float clothSettleH;',
  'uniform vec3 clothSettleL;',
  'uniform mat3 clothSettleQ;',
  'uniform float clothSettleIn;',
  'uniform float clothSettleOut;',
  'uniform float clothSettleF;',
  'uniform float clothSettleT;',
  'uniform float clothSettleR;',
  'varying vec3 vClothWorld;',
].join('\n');
/**
 * One spot's footprint at `point` (a vec3 expression): its radius squared, normal, tangential offset, g and fade, as
 * locals of the loop body. The same formula as `clothDetailAt`.
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
/**
 * A point (a vec3 expression) in the settle's frame: its offset, height along the axis, tangential offset and r, Q t,
 * and the smooth surface's height along the axis there. The same formula as `frameOf`. (`clothSettleQ` is uploaded
 * from a Matrix3 built row-major with `set`, so the column-major mat3 times t is Q t.)
 */
const settleFrame = (point: string): string => `
      vec3 clothSN = clothSettleN;
      vec3 clothSD = ${point} - clothSettleC;
      float clothSAlong = dot(clothSD, clothSN);
      vec3 clothST = clothSD - clothSAlong * clothSN;
      float clothSR = length(clothST);
      vec3 clothQT = clothSettleQ * clothST;
      float clothSurf = clothSettleH + dot(clothSettleL, clothST) - dot(clothST, clothQT);`;
/** The settle's weight for a deviation `dev`: amount × window × reach, guarded as `settleWindow` and `settleReach` are. */
const settleWeight = (dev: string): string => `
      float clothWin = clothSettleIn < clothSettleOut ? 1.0 - smoothstep(clothSettleIn, clothSettleOut, clothSR) : 1.0 - step(clothSettleOut, clothSR);
      float clothReach = clothSettleR > 0.0 ? 1.0 - smoothstep(clothSettleR, 1.5 * clothSettleR, abs(${dev})) : 0.0;
      float clothSW = clothSettleF * clothWin * clothReach;`;
// `transformed` is final at project_vertex: after morphs and skinning, still in the object's own space, and
// `transformedNormal` (defaultnormal_vertex) is its normal in view space (`transformNormalByInverseViewMatrix` is r185's
// name for the old `inverseTransformDirection`). The settle moves the drawn point along the axis to its place on the
// smooth surface, less the layer's thickness for a point facing her; only when it moved anything are the view position
// and the clip position rewritten, so a draw with nothing to settle is the one three's own chunk made.
const VERTEX_SETTLE = `
    vec4 clothW = modelMatrix * vec4(transformed, 1.0);
    if (clothSettleOn > 0.5) {${settleFrame('clothW.xyz')}
      vec3 clothWN = dot(transformedNormal, transformedNormal) > 0.0 ? transformNormalByInverseViewMatrix(transformedNormal, viewMatrix) : clothSN;
      float clothLayer = clothSettleT * clamp(0.5 - 2.0 * dot(clothWN, clothSN), 0.0, 1.0);
      float clothDev = clothSAlong - (clothSurf - clothLayer);${settleWeight('clothDev')}
      vec3 clothDisp = -(clothSW * clothDev) * clothSN;
      if (dot(clothDisp, clothDisp) > 0.0) {
        clothW.xyz += clothDisp;
        mvPosition = viewMatrix * clothW;
        gl_Position = projectionMatrix * mvPosition;
      }
    }
    vClothWorld = clothW.xyz;`;
// the spots' summed relief: its tangential gradient (world) and the dimples' shade, the same formula as clothDetailAt
const FRAGMENT_RELIEF = `
    vec3 clothGrad = vec3(0.0);
    float clothShade = 1.0;
    if (clothDetailOn > 0.5) {
      float clothDark = 0.0;
      for (int clothI = 0; clothI < ${SPOTS}; clothI++) {${footprint('vClothWorld')}
        float clothH = clothSpotH[clothI];
        clothGrad += clothH * clothG * clothFade * (-2.0 / clothR2) * clothT;
        clothDark += min(clothH, 0.0) * clothG * clothFade;
      }
      clothShade = 1.0 + clamp(clothDark * ${glslFloat(DIMPLE_DARKEN)}, ${glslFloat(-MAX_DARKEN)}, 0.0);
    }
    diffuseColor.rgb *= clothShade;`;
// `normal` is the view-space shading normal; faceDirection (normal_fragment_begin) turns it for a back face. First the
// settle mixes it toward the smooth surface's normal -- the gradient of along - (H + L·t - t·Qt), N - L + 2 (Qt) with
// Qt's part along N taken out, at the drawn (settled) point and with no layer term, since the inner layer is never
// seen from outside -- then the spots tilt it on top. A weight of nothing leaves the normal exactly as it was.
const FRAGMENT_TILT = `
    if (clothSettleOn > 0.5) {${settleFrame('vClothWorld')}
      float clothDev0 = clothSAlong - clothSurf;${settleWeight('clothDev0')}
      if (clothSW > 0.0) normal = normalize(mix(normal, faceDirection * normalize(mat3(viewMatrix) * (clothSN - clothSettleL + 2.0 * (clothQT - dot(clothQT, clothSN) * clothSN))), clothSW));
    }
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
    clothSettleOn: { value: 0 },
    clothSettleC: { value: new THREE.Vector3() },
    clothSettleN: { value: new THREE.Vector3(0, 0, 1) },
    clothSettleH: { value: 0 },
    clothSettleL: { value: new THREE.Vector3() },
    clothSettleQ: { value: new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0) },
    clothSettleIn: { value: 0 },
    clothSettleOut: { value: 0 },
    clothSettleF: { value: 0 },
    clothSettleT: { value: 0 },
    clothSettleR: { value: 0 },
  };
  const previous = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = [PARS, shader.vertexShader].join('\n')
      .replace('#include <project_vertex>', () => `#include <project_vertex>${VERTEX_SETTLE}`);
    shader.fragmentShader = [PARS, shader.fragmentShader].join('\n')
      .replace('#include <color_fragment>', () => `#include <color_fragment>${FRAGMENT_RELIEF}`)
      .replace('#include <normal_fragment_maps>', () => `#include <normal_fragment_maps>${FRAGMENT_TILT}`);
  };
  material.customProgramCacheKey = function () { return `${cacheKey.call(this)}|cloth-detail-v3`; };
  material.needsUpdate = true;
  patched.set(material, uniforms);
  return uniforms;
}

/**
 * Write the spots and the settle (patching first if needed): the navel into spot 0, the first two nipples into spots
 * 1 and 2, a missing one as height 0, and a missing settle (or one with no axis) as off with amount 0. Null switches
 * everything off (the material then renders exactly as unpatched, apart from the cost of the branches); a material
 * never patched is left alone by it. Only uniform values change, never the program.
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
  const settle = state ? settleOf(state) : null;
  u.clothSettleOn.value = settle ? 1 : 0;
  u.clothSettleC.value.set(settle ? settle.c[0] : 0, settle ? settle.c[1] : 0, settle ? settle.c[2] : 0);
  u.clothSettleN.value.set(settle ? settle.n[0] : 0, settle ? settle.n[1] : 0, settle ? settle.n[2] : 1);
  u.clothSettleH.value = settle ? settle.h : 0;
  u.clothSettleL.value.set(settle ? settle.l[0] : 0, settle ? settle.l[1] : 0, settle ? settle.l[2] : 0);
  const q = settle ? settle.q : new Array<number>(9).fill(0);
  u.clothSettleQ.value.set(q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7], q[8]); // set() is row-major
  u.clothSettleIn.value = settle ? settle.inner : 0;
  u.clothSettleOut.value = settle ? settle.outer : 0;
  u.clothSettleF.value = settle ? settle.f : 0;
  u.clothSettleT.value = settle ? settle.t : 0;
  u.clothSettleR.value = settle ? settle.reach : 0;
}

/**
 * The same shading and settle, on the CPU, for tests and probes, mirroring the GLSL formula for formula.
 * `displacement` is what the vertex stage does to a garment point standing at p whose world normal is `normal` (by
 * default the settle's own axis: the outer layer); `gradient`, `shade`, `settleWeight` and `settleNormal` are what the
 * fragment stage does at a drawn point p (the shader evaluates them where the point was drawn, after any displacement).
 */
export function clothDetailAt(
  p: readonly [number, number, number], state: ClothDetailState, normal?: readonly [number, number, number],
): ClothDetailSample {
  const gradient: [number, number, number] = [0, 0, 0];
  const displacement: [number, number, number] = [0, 0, 0];
  let dark = 0;
  for (const s of slotsOf(state)) {
    if (!s) continue;
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
  let settleWeight = 0;
  let settleNormal: [number, number, number] | null = null;
  const s = settleOf(state);
  if (s) {
    const n = s.n;
    const { along, r, qt, surf } = frameOf(s, p);
    const win = settleWindow(s, r);
    // the vertex stage: the layer from the garment's own normal (a zero one reads as the axis), then the move
    const wn = (normal && unit(normal)) ?? n;
    const layer = s.t * Math.min(1, Math.max(0, 0.5 - 2 * (wn[0] * n[0] + wn[1] * n[1] + wn[2] * n[2])));
    const dev = along - (surf - layer);
    const m = s.f * win * settleReach(s, dev) * dev;
    displacement[0] -= m * n[0]; displacement[1] -= m * n[1]; displacement[2] -= m * n[2];
    // the fragment stage: the same frame, no layer term, and the smooth surface's normal N - L + 2 (Qt) tangential
    const dev0 = along - surf;
    settleWeight = s.f * win * settleReach(s, dev0);
    const qn = qt[0] * n[0] + qt[1] * n[1] + qt[2] * n[2];
    const g = [0, 1, 2].map((i) => n[i] - s.l[i] + 2 * (qt[i] - qn * n[i]));
    settleNormal = unit([g[0], g[1], g[2]]) ?? [n[0], n[1], n[2]];
  }
  return { gradient, shade, displacement, settleWeight, settleNormal };
}
