/**
 * SARAH FOR THE STORY PLAYER (Joshua, 2026-10-24: his saved Sarah from the Sarah Lab, in TMB-Story's 3D "Watch"): one
 * light skinned file of her exactly as the room draws her, made FROM THE RUNNING ROOM.
 *
 * Her shape in the room lives in many places at once, and most of them are not in any file. Morph targets weighted by
 * the room (`applyLook`: her bump, her bust, her navel, the tee's fits); shape fields added on the CPU
 * (`bodyShapeView.ts`); a vertex patch that softens her nipples under paint (`fabricMaterial.ts`, after
 * `begin_vertex`); and on the fitted tee a settle worked AFTER skinning, in the world, from points of her measured each
 * frame (`clothDetail.ts`, after `project_vertex`). Her colour is fragment work: the painted leggings mixed over her
 * skin map by a per-vertex mask with a crisp one-pixel edge, the tee re-dyed by a triplanar swatch. Re-implementing all
 * of that for another player would be a second copy of the rules, and it would drift. So nothing here re-implements
 * any of it: the GPU runs her OWN materials, patches and all, and this reads back what they computed.
 *
 *  - `captureVertices` draws every vertex of a mesh ONCE, as a one-pixel POINT, with a clone of the mesh's own
 *    material whose vertex stage ends by sending the vertex to its own texel (vertex i at column i mod W, row i / W).
 *    Its POSITION pass writes where the material put the vertex, its NORMAL pass the normal it lit it with, its ALBEDO
 *    pass runs the material's whole fragment stage and keeps `diffuseColor`, its SURFACE pass keeps the roughness and
 *    metalness the fragment stage arrived at. A THREE.Points is never skinned (three skins only a SkinnedMesh), so
 *    everything comes back in the mesh's GEOMETRY units, the space its `position` attribute is in -- which is what a
 *    skinned file stores. The points stand where her rest skinning puts the geometry (`restSkinMatrix`), so a patch
 *    that works in the world, the tee's settle, finds her where she is.
 *  - `bakeUV` draws a mesh's triangles flattened into their texture coordinates with the same kind of clone, so each
 *    texel of the image runs the fragment stage of the point of her it belongs to: her body's colour, paint and all,
 *    becomes a texture; so do her roughness and metalness, and the normal she is finally lit with, as a tangent-space
 *    normal map in the very frame three reads one in (the tee's nipples and navel drawn through it, her pores laid flat
 *    under the leggings). Every texel is baked as the front face she shows. `dilate` then runs the islands out past their
 *    edges, so a sampler blending across a seam reads her and not the black between islands, and `paintSplit` bakes
 *    her painted islands into a texture of their own, because her atlas's islands touch and a mip level averages
 *    across a touch.
 *  - `seatDelta` is the one CPU piece: what the room's SIT changes in her morph weights, as one corrective shape the
 *    story player can blend in when she sits.
 *
 * Every clone calls the original's own `onBeforeCompile` first, on the ORIGINAL (`this` is the material its patches
 * were laid on), so it gets their very uniform objects: the clone draws with whatever the room set this frame. It
 * takes its own program cache key, never the original's, and is thrown away after its pass; the room's materials,
 * geometries and GPU buffers are left exactly as they were (the clone's geometry SHARES her attributes, and is
 * emptied of them before it is disposed, so disposing it frees only what it made).
 *
 * `collectStoryBake` is the room's `?bake=story` hook body: every visible skinned mesh captured, her body's colour,
 * surface and normal baked (and each garment's normal), everything packed as base64 for the bake script
 * (`scripts/sarahV2Recovery/story-sarah.mjs`), which writes the file. The room decides what she looks like when it is
 * called; nothing here changes her.
 */
import * as THREE from 'three';
import { fabricOn } from './fabricMaterial';

type Shader = Parameters<THREE.Material['onBeforeCompile']>[0];

/** Vertices per row of the capture target: a vertex's texel is (i mod W, i div W); her body's 115,710 fill 114 rows. */
export const CAPTURE_WIDTH = 1024;
/**
 * The mip level a fabric's swatch is read at when one VERTEX has to carry its colour. A swatch repeats every few
 * centimetres (`fabricLibrary.ts`) and its knit is finer than the tee's vertices are apart, so read at full detail each
 * vertex would take whichever thread it happened to land on and the tee would come out speckled. A level far past the
 * last one is the last one, the swatch's 1x1 mip: its mean colour, what the knit averages to over a vertex's share of
 * the cloth, which is all one vertex can hold. (A level, not a bias: a point has no screen-space derivatives, so its
 * level of detail is minus infinity and no bias added to it ever leaves level 0.)
 */
export const FABRIC_VERTEX_LEVEL = 16;

// ---------------------------------------------------------------------------------------------------------------------
// The pure parts: no GPU

/**
 * Run the covered texels of an image out over its empty ones, `passes` texels deep: each pass, every empty texel (alpha
 * 0) next to a covered one (alpha above 0, as the previous pass left them) takes the mean colour of those neighbours,
 * all eight round it counted, and alpha 255. Covered texels are never changed. The islands of a texture atlas need
 * this: the GPU's sampler blends a texel with its neighbours, and its smaller mip levels average whole blocks of them,
 * and at an island's edge, without padding, a neighbour is the empty space between islands. Passes as many as the
 * image is wide fill every gap. Pure and deterministic: the same image always pads the same way; only the texels at
 * the growing edge are visited, so a full fill costs about as much as one pass over the image. Returns a copy.
 */
export function dilate(rgba: ArrayLike<number>, width: number, height: number, passes = 8): Uint8Array {
  const out = Uint8Array.from(rgba);
  if (out.length !== width * height * 4) throw new Error(`dilate: ${out.length} bytes is not ${width}x${height} RGBA`);
  const filled = new Uint8Array(width * height);
  for (let i = 0; i < filled.length; i++) filled[i] = out[i * 4 + 3] > 0 ? 1 : 0;
  // `queued` marks a texel already on the next edge; the edge is kept in scan order, so the result never depends on
  // the order texels were found in
  const queued = new Uint8Array(width * height);
  const neighbours = (i: number, visit: (j: number) => void) => {
    const x = i % width, y = (i - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if ((dx === 0 && dy === 0) || xx < 0 || xx >= width) continue;
        visit(yy * width + xx);
      }
    }
  };
  let edge: number[] = [];
  for (let i = 0; i < filled.length; i++) {
    if (filled[i]) continue;
    let near = false;
    neighbours(i, (j) => { if (filled[j]) near = true; });
    if (near) { edge.push(i); queued[i] = 1; }
  }
  for (let pass = 0; pass < passes && edge.length; pass++) {
    // every texel of this edge from its neighbours as the last pass left them, and only then written
    const made = new Uint8Array(edge.length * 3);
    edge.forEach((i, k) => {
      let r = 0, g = 0, b = 0, n = 0;
      neighbours(i, (j) => { if (filled[j]) { r += out[j * 4]; g += out[j * 4 + 1]; b += out[j * 4 + 2]; n++; } });
      made[k * 3] = Math.round(r / n); made[k * 3 + 1] = Math.round(g / n); made[k * 3 + 2] = Math.round(b / n);
    });
    edge.forEach((i, k) => { out[i * 4] = made[k * 3]; out[i * 4 + 1] = made[k * 3 + 1]; out[i * 4 + 2] = made[k * 3 + 2]; out[i * 4 + 3] = 255; filled[i] = 1; });
    const next: number[] = [];
    for (const i of edge) neighbours(i, (j) => { if (!filled[j] && !queued[j]) { queued[j] = 1; next.push(j); } });
    next.sort((a, b) => a - b);
    edge = next;
  }
  return out;
}

/** What the room's SIT adds to a mesh, as one morph target (`seatDelta`). */
export interface SeatDelta {
  /** xyz per vertex, geometry units: Σ (w_sit − w_stand) × each target's position delta. */
  readonly position: Float32Array;
  /** The same for the normals, or null where the mesh's targets carry none. */
  readonly normal: Float32Array | null;
  /** The largest |component| of `position`. */
  readonly max: number;
  /** The targets whose weight differs between the two, by name. */
  readonly targets: readonly string[];
}

/**
 * The difference SIT makes to a mesh's shape, worked on the CPU from its morph targets: Σ over targets of
 * (w_sit − w_stand) × the target's delta. Weights are by target NAME (`morphTargetDictionary`), a missing one 0. Read
 * through getX/getY/getZ, because a quantized file stores its targets as normalized integers. Absolute targets
 * (`morphTargetsRelative` false) are made relative against the base attribute first. Null when SIT moves nothing on
 * this mesh (no |component| of 1e-6 or more): a corrective of zeros is not worth a target.
 */
export function seatDelta(
  mesh: { readonly geometry: THREE.BufferGeometry; readonly morphTargetDictionary?: Record<string, number> },
  stand: Readonly<Record<string, number>>, sit: Readonly<Record<string, number>>,
): SeatDelta | null {
  const g = mesh.geometry, dict = mesh.morphTargetDictionary, mp = g.morphAttributes.position, mn = g.morphAttributes.normal;
  if (!dict || !mp?.length) return null;
  const base = g.getAttribute('position'), baseN = g.getAttribute('normal');
  const count = base.count, relative = g.morphTargetsRelative;
  const position = new Float32Array(count * 3);
  const normal = mn?.length ? new Float32Array(count * 3) : null;
  const targets: string[] = [];
  for (const [name, k] of Object.entries(dict)) {
    const dw = (Number.isFinite(sit[name]) ? sit[name] : 0) - (Number.isFinite(stand[name]) ? stand[name] : 0);
    if (dw === 0 || !mp[k]) continue;
    targets.push(name);
    const p = mp[k];
    for (let i = 0; i < count; i++) {
      position[i * 3] += dw * (p.getX(i) - (relative ? 0 : base.getX(i)));
      position[i * 3 + 1] += dw * (p.getY(i) - (relative ? 0 : base.getY(i)));
      position[i * 3 + 2] += dw * (p.getZ(i) - (relative ? 0 : base.getZ(i)));
    }
    const n = mn?.[k];
    if (normal && n) {
      for (let i = 0; i < count; i++) {
        normal[i * 3] += dw * (n.getX(i) - (relative || !baseN ? 0 : baseN.getX(i)));
        normal[i * 3 + 1] += dw * (n.getY(i) - (relative || !baseN ? 0 : baseN.getY(i)));
        normal[i * 3 + 2] += dw * (n.getZ(i) - (relative || !baseN ? 0 : baseN.getZ(i)));
      }
    }
  }
  let max = 0;
  for (let i = 0; i < position.length; i++) max = Math.max(max, Math.abs(position[i]));
  return max < 1e-6 ? null : { position, normal, max, targets };
}

/** The bytes of a typed array as base64 (how the bake hands arrays through `page.evaluate`). */
export function toBase64(view: ArrayBufferView): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Which UV ISLAND each triangle is on: triangles are on one island when they share a vertex (a texture seam splits a
 * glTF's vertices, so an island is a connected piece of the index). Islands are numbered by their first triangle, in
 * index order. Pure and deterministic.
 */
export function uvIslands(index: ArrayLike<number>, vertexCount: number): Int32Array {
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;
  const find = (v: number): number => { while (parent[v] !== v) { parent[v] = parent[parent[v]]; v = parent[v]; } return v; };
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = find(index[t]), b = find(index[t + 1]), c = find(index[t + 2]);
    const r = Math.min(a, b, c);
    parent[a] = r; parent[b] = r; parent[c] = r;
  }
  const id = new Map<number, number>(), out = new Int32Array(Math.floor(index.length / 3));
  for (let t = 0; t < out.length; t++) {
    const r = find(index[t * 3]);
    if (!id.has(r)) id.set(r, id.size);
    out[t] = id.get(r)!;
  }
  return out;
}

/**
 * Her triangles split by whether PAINT is laid on their island: an island goes with the paint when more than half the
 * corners of its triangles are painted (`fabricPaint`, any layer, past one half). Why it matters: a texture atlas packed as tightly as
 * hers has islands TOUCHING, and the sampler's smaller mip levels average across a touch -- harmless between two
 * pieces of skin, a light seam down her leggings where a skin island touches a painted one (measured: the seams go with
 * mipmapping off). Baked into two textures, one for each set of islands, each dilated over everything the other set
 * holds, no mip level ever averages paint with skin. Any split is colour-correct (every texel is still baked from her
 * own fragment stage); the split only decides which touches are safe. Null when nothing, or everything, is painted.
 */
export function paintSplit(mesh: THREE.Mesh, triangles: ArrayLike<number>): { readonly skin: Uint32Array; readonly paint: Uint32Array } | null {
  const paint = mesh.geometry.getAttribute('fabricPaint');
  if (!paint) return null;
  const count = mesh.geometry.getAttribute('position').count;
  const islands = uvIslands(triangles, count), n = islands.reduce((m, x) => Math.max(m, x + 1), 0);
  const painted = new Float64Array(n), seen = new Float64Array(n);
  const isPainted = (v: number) => { for (let c = 0; c < paint.itemSize; c++) if (paint.getComponent(v, c) > 0.5) return true; return false; };
  for (let t = 0; t < islands.length; t++) for (let k = 0; k < 3; k++) { const v = triangles[t * 3 + k]; seen[islands[t]]++; if (isPainted(v)) painted[islands[t]]++; }
  const skin: number[] = [], paintTriangles: number[] = [];
  for (let t = 0; t < islands.length; t++) (painted[islands[t]] > 0.5 * seen[islands[t]] ? paintTriangles : skin).push(triangles[t * 3], triangles[t * 3 + 1], triangles[t * 3 + 2]);
  return skin.length && paintTriangles.length ? { skin: Uint32Array.from(skin), paint: Uint32Array.from(paintTriangles) } : null;
}

/** All of a mesh's triangles as loaded (`applyLook` swaps a cut-down index in under worn clothes and keeps the whole one as `userData.allIndices`). */
function allTriangles(mesh: THREE.Mesh): ArrayLike<number> {
  return (mesh.userData.allIndices as ArrayLike<number> | undefined) ?? mesh.geometry.index?.array ?? Array.from({ length: mesh.geometry.getAttribute('position').count }, (_, i) => i);
}

// ---------------------------------------------------------------------------------------------------------------------
// Where her geometry stands

/**
 * Where a skinned mesh's geometry stands in the world at its REST pose, as one matrix: what three's skinning does to a
 * vertex of it, `matrixWorld · bindMatrixInverse · (bone.matrixWorld · boneInverse) · bindMatrix`, for the first bone
 * any vertex is weighted to. That is one matrix for the whole mesh only when every weighted bone gives the same one --
 * true of her at her bind pose, where every joint's world matrix times its inverse bind is the file's own dequantizing
 * scale and offset (`FACE_REST_SCALE` in faceRig.ts) -- so `spread` says how far the others are from it, as the largest
 * entry difference over the largest entry. Call with the matrices updated (`updateMatrixWorld`).
 */
export function restSkinMatrix(mesh: THREE.SkinnedMesh): { readonly matrix: THREE.Matrix4; readonly spread: number; readonly bones: number } {
  const skeleton = mesh.skeleton, g = mesh.geometry;
  const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  const used = new Set<number>();
  if (si && sw) for (let i = 0; i < si.count; i++) for (let c = 0; c < 4; c++) if (sw.getComponent(i, c) > 0) used.add(si.getComponent(i, c));
  const of = (b: number) => new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse)
    .multiply(new THREE.Matrix4().multiplyMatrices(skeleton.bones[b].matrixWorld, skeleton.boneInverses[b]))
    .multiply(mesh.bindMatrix);
  const bones = [...used].filter((b) => skeleton.bones[b] && skeleton.boneInverses[b]).sort((a, b) => a - b);
  if (!bones.length) return { matrix: mesh.matrixWorld.clone(), spread: 0, bones: 0 };
  const matrix = of(bones[0]), e = matrix.elements;
  const scale = Math.max(...e.map(Math.abs), 1e-12);
  let worst = 0;
  for (const b of bones.slice(1)) {
    const f = of(b).elements;
    for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(f[k] - e[k]));
  }
  return { matrix, spread: worst / scale, bones: bones.length };
}

// ---------------------------------------------------------------------------------------------------------------------
// The GPU passes

type Pass = 'position' | 'normal' | 'albedo' | 'surface';

function singleMaterial(mesh: THREE.Mesh): THREE.Material {
  const m = mesh.material;
  if (!Array.isArray(m)) return m;
  if (m.length === 1) return m[0];
  throw new Error(`story bake: ${mesh.name} draws ${m.length} materials; one is expected`);
}

/** Code put just before the closing brace of `main` (the last one in the source: every patch prepends, none appends). */
function atEndOfMain(source: string, code: string): string {
  const end = source.lastIndexOf('}');
  if (end < 0) throw new Error('story bake: no main() to append to');
  return `${source.slice(0, end)}\n${code}\n${source.slice(end)}`;
}

/**
 * A copy of `original` that runs its own patches and then `edit`s the result. `Material.clone` deep-copies `userData`
 * through JSON, and hers holds textures (the room keeps her own skin map there), so it is set aside for the copy.
 */
function captureMaterial(original: THREE.Material, tag: string, edit: (shader: Shader) => void, uniforms: Record<string, THREE.IUniform>, side?: THREE.Side): THREE.Material {
  const own = original.userData;
  original.userData = {};
  let clone: THREE.Material;
  try { clone = original.clone(); } finally { original.userData = own; }
  clone.onBeforeCompile = (shader, renderer) => {
    original.onBeforeCompile.call(original, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    edit(shader);
  };
  clone.customProgramCacheKey = () => `${original.customProgramCacheKey()}|story-capture-${tag}-v1`;
  clone.alphaTest = 0;
  clone.transparent = false;
  clone.depthTest = false;
  clone.depthWrite = false;
  clone.blending = THREE.NoBlending;
  clone.colorWrite = true;
  clone.clippingPlanes = null;
  clone.premultipliedAlpha = false;
  if (side !== undefined) clone.side = side;
  clone.needsUpdate = true;
  return clone;
}

/** A geometry that SHARES every attribute and morph attribute of `source` (no copies, no new GPU buffers for them), with its own index or none. */
function sharedGeometry(source: THREE.BufferGeometry, index: THREE.BufferAttribute | null): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(source.attributes)) g.setAttribute(name, a);
  g.morphAttributes = { ...source.morphAttributes };
  g.morphTargetsRelative = source.morphTargetsRelative;
  if (index) g.setIndex(index);
  return g;
}
/** Dispose a shared geometry: emptied of her attributes first, so three frees only its own index and morph texture. */
function releaseShared(g: THREE.BufferGeometry): void {
  g.attributes = {};
  g.morphAttributes = {};
  g.dispose();
}

/** The object drawn, standing at `matrix`, with the mesh's morph weights as they are now. */
function standIn<T extends THREE.Points | THREE.Mesh>(object: T, mesh: THREE.Mesh, matrix: THREE.Matrix4): T {
  object.matrixAutoUpdate = false;
  object.matrixWorldAutoUpdate = false;
  object.matrix.copy(matrix);
  object.matrixWorld.copy(matrix);
  object.frustumCulled = false;
  if (mesh.morphTargetInfluences) object.morphTargetInfluences = mesh.morphTargetInfluences.slice();
  if (mesh.morphTargetDictionary) object.morphTargetDictionary = { ...mesh.morphTargetDictionary };
  return object;
}

/** Draw `object` alone into `target` (cleared to transparent black) and read it back; the renderer's own state is put back. */
function drawAndRead<T extends Float32Array | Uint8Array>(renderer: THREE.WebGLRenderer, object: THREE.Object3D, camera: THREE.Camera, target: THREE.WebGLRenderTarget, out: T): T {
  const scene = new THREE.Scene();
  scene.add(object);
  const was = { target: renderer.getRenderTarget(), colour: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), autoClear: renderer.autoClear };
  try {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, out);
  } finally {
    renderer.setRenderTarget(was.target);
    renderer.setClearColor(was.colour, was.alpha);
    renderer.autoClear = was.autoClear;
    scene.remove(object);
  }
  return out;
}

const VERTEX_PARS = 'uniform mat4 storyCaptureInverse;\nuniform vec2 storyCaptureSize;\nvarying vec3 vStoryP;\nvarying vec3 vStoryN;\n';
// `mvPosition` is final here, the tee's settle included (it rewrites it after project_vertex); `objectNormal` is the
// normal before skinning, after morphs and the fabric's softening. Then the vertex goes to its own texel.
const VERTEX_TAIL = `
  vStoryP = (storyCaptureInverse * mvPosition).xyz;
  vStoryN = objectNormal;
  {
    int storyW = int(storyCaptureSize.x + 0.5);
    vec2 storyCell = vec2(float(gl_VertexID % storyW), float(gl_VertexID / storyW));
    gl_Position = vec4((storyCell + 0.5) / storyCaptureSize * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 1.0;
  }`;
const FRAGMENT_TAIL: Record<'albedo' | 'surface', string> = {
  albedo: 'gl_FragColor = vec4(diffuseColor.rgb, 1.0);',
  surface: 'gl_FragColor = vec4(roughnessFactor, metalnessFactor, diffuseColor.a, 1.0);',
};
/** Every 2D lookup of the fragment stage read at mip `level` (see FABRIC_VERTEX_LEVEL). */
const atLevel = (level: number) => `#undef texture2D\n#define texture2D(s, c) textureLod(s, c, ${level.toFixed(1)})\n`;

/** One mesh's vertices as its own material computes them (`captureVertices`). */
export interface VertexCapture {
  readonly count: number;
  /** xyz per vertex, geometry units: where her material puts the vertex, before skinning. */
  readonly position: Float32Array;
  /** xyz per vertex: the normal her material lights it with, before skinning, made unit length. */
  readonly normal: Float32Array;
  /** The normals' lengths before they were made unit: a morph adds to a normal, so near 1, never 0. */
  readonly normalLength: Float32Array;
  /** rgb per vertex, LINEAR: `diffuseColor` at the end of her fragment stage (texture, paint, fabric, shading of a dimple). */
  readonly albedo?: Float32Array;
  /** roughness, metalness and opacity per vertex, as her fragment stage arrived at them. */
  readonly surface?: Float32Array;
  /** Vertices a pass wrote nothing for, by pass (every one should be 0). */
  readonly missing: Readonly<Partial<Record<Pass, number>>>;
}

export interface CaptureOptions {
  /** Also run the ALBEDO pass. */
  readonly albedo?: boolean;
  /** Also run the SURFACE pass. */
  readonly surface?: boolean;
  /** A fixed mip level for the albedo and surface passes' texture lookups (FABRIC_VERTEX_LEVEL for a fabric-dressed garment); unset, as the material reads them. */
  readonly textureLevel?: number;
  /** Where the geometry stands in the world; `restSkinMatrix(mesh).matrix` by default. */
  readonly matrix?: THREE.Matrix4;
}

/**
 * Every vertex of `mesh` as its OWN material computes it: drawn once each, as a point that shares the mesh's attributes
 * and morph targets (no index, so no vertex is drawn twice and none is left out by an index the room has cut down),
 * weighted as the mesh is now, with a clone of its material. See the head of this file. `viewCamera` is the camera the
 * room draws her with: the material's view-dependent work (the settle's test of which way a layer faces) runs as it
 * does on screen, and the position comes back through the inverse of exactly that view.
 */
export function captureVertices(renderer: THREE.WebGLRenderer, mesh: THREE.Mesh, viewCamera: THREE.Camera, options: CaptureOptions = {}): VertexCapture {
  const original = singleMaterial(mesh);
  const count = mesh.geometry.getAttribute('position').count;
  const W = CAPTURE_WIDTH, H = Math.max(1, Math.ceil(count / W));
  const matrix = options.matrix ?? restSkinMatrix(mesh as THREE.SkinnedMesh).matrix;
  viewCamera.updateMatrixWorld();
  const inverse = new THREE.Matrix4().multiplyMatrices(viewCamera.matrixWorldInverse, matrix).invert();
  const uniforms = { storyCaptureInverse: { value: inverse }, storyCaptureSize: { value: new THREE.Vector2(W, H) } };
  const geometry = sharedGeometry(mesh.geometry, null);
  const target = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
  const missing: Partial<Record<Pass, number>> = {};
  const run = (pass: Pass): Float32Array => {
    const material = captureMaterial(original, pass, (shader) => {
      shader.vertexShader = atEndOfMain(VERTEX_PARS + shader.vertexShader, VERTEX_TAIL);
      if (pass === 'position' || pass === 'normal') {
        const v = pass === 'position' ? 'vStoryP' : 'vStoryN';
        shader.fragmentShader = `varying vec3 ${v};\nvoid main() {\n  gl_FragColor = vec4(${v}, 1.0);\n}\n`;
      } else {
        const level = options.textureLevel;
        shader.fragmentShader = atEndOfMain((level !== undefined ? atLevel(level) : '') + shader.fragmentShader, FRAGMENT_TAIL[pass]);
      }
    }, uniforms);
    const points = standIn(new THREE.Points(geometry, material), mesh, matrix);
    try {
      const out = drawAndRead(renderer, points, viewCamera, target, new Float32Array(W * H * 4));
      let none = 0;
      for (let i = 0; i < count; i++) if (!(out[i * 4 + 3] > 0)) none++;
      missing[pass] = none;
      return out;
    } finally { material.dispose(); }
  };
  try {
    const P = run('position'), N = run('normal');
    const position = new Float32Array(count * 3), normal = new Float32Array(count * 3), normalLength = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      position[i * 3] = P[i * 4]; position[i * 3 + 1] = P[i * 4 + 1]; position[i * 3 + 2] = P[i * 4 + 2];
      const x = N[i * 4], y = N[i * 4 + 1], z = N[i * 4 + 2], l = Math.hypot(x, y, z);
      normalLength[i] = l;
      const k = l > 0 ? 1 / l : 0;
      normal[i * 3] = x * k; normal[i * 3 + 1] = y * k; normal[i * 3 + 2] = z * k;
    }
    const three = (pass: 'albedo' | 'surface') => {
      const A = run(pass), out = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) { out[i * 3] = A[i * 4]; out[i * 3 + 1] = A[i * 4 + 1]; out[i * 3 + 2] = A[i * 4 + 2]; }
      return out;
    };
    return {
      count, position, normal, normalLength,
      ...(options.albedo ? { albedo: three('albedo') } : {}),
      ...(options.surface ? { surface: three('surface') } : {}),
      missing,
    };
  } finally {
    target.dispose();
    releaseShared(geometry);
  }
}

/** A mesh's fragment stage laid out over its texture coordinates (`bakeUV`). */
export interface UvBake {
  readonly width: number;
  readonly height: number;
  /** RGBA, row 0 at v = 0 (glTF's top row: three reads glTF images unflipped), dilated; alpha 255 where there is a value. */
  readonly rgba: Uint8Array;
  /** One byte a texel: 1 where a triangle covered it, before the dilation. */
  readonly covered: Uint8Array;
  readonly coveredCount: number;
  /** Triangles whose texture coordinates run clockwise, drawn the other way round so every texel is a FRONT face. */
  readonly turned: number;
}

/**
 * What `bakeUV` lays out:
 *  - 'albedo': `diffuseColor`, sRGB-encoded as a colour texture is stored;
 *  - 'surface': glTF's metallic-roughness layout, linear (G roughness, B metalness, R 1);
 *  - 'normal': the normal the fragment stage finally lights with, as a TANGENT-SPACE normal map in the frame three
 *    builds from derivatives when a mesh has no tangents (`getTangentFrame`), divided by the material's `normalScale`:
 *    read back through the same frame, with a scale of 1 in the file (three's GLTFLoader gives it (1, -1), as it gave
 *    the room's), it is the room's normal -- her own normal map where nothing else acts, and on top of it whatever the
 *    patches did to the light (the leggings laying her pores flat, the tee's nipples and navel). Needs a normal map.
 */
export type UvChannel = 'albedo' | 'surface' | 'normal';

export interface UvBakeOptions {
  readonly channel: UvChannel;
  /** Dilation passes after the draw (8; the image's size fills every gap). */
  readonly dilate?: number;
  /** Where the geometry stands in the world; `restSkinMatrix(mesh).matrix` by default. */
  readonly matrix?: THREE.Matrix4;
  /** Which triangles to draw, as an index list (three a triangle); all of them by default. */
  readonly triangles?: ArrayLike<number>;
}

const UV_TAIL: Record<UvChannel, string> = {
  albedo: 'gl_FragColor = vec4(sRGBTransferOETF(vec4(clamp(diffuseColor.rgb, 0.0, 1.0), 1.0)).rgb, 1.0);',
  surface: 'gl_FragColor = vec4(1.0, clamp(roughnessFactor, 0.0, 1.0), clamp(metalnessFactor, 0.0, 1.0), 1.0);',
  normal: `{
    vec3 storyM = inverse(tbn) * normal;
    storyM.xy /= mix(vec2(1.0), normalScale, step(vec2(1e-4), abs(normalScale)));
    storyM = any(isnan(storyM)) || any(isinf(storyM)) || dot(storyM, storyM) < 1e-12 ? vec3(0.0, 0.0, 1.0) : normalize(storyM);
    gl_FragColor = vec4(storyM * 0.5 + 0.5, 1.0);
  }`,
};
// three's frame from derivatives (`normalmap_pars_fragment`) turned the right way for an island whose texture runs
// mirrored: drawn flat in its texture coordinates, such an island's screen runs the other way round over her, and the
// frame's tangent and bitangent come out negated. On a screen, looking at a front face, that orientation is always
// positive, so this is three's own frame wherever she is actually seen.
const ORIENTED_FRAME = 'return mat3( T * scale, B * scale, N );';
const ORIENTED_FRAME_FIX = 'float storyO = dot( cross( q0, q1 ), N ) < 0.0 ? - 1.0 : 1.0;\n\t\treturn mat3( T * scale * storyO, B * scale * storyO, N );';

/** A material's map for a channel: its colour map, its roughness map, its normal map. */
function mapFor(material: THREE.MeshStandardMaterial, channel: UvChannel): THREE.Texture | null {
  return (channel === 'albedo' ? material.map : channel === 'surface' ? material.roughnessMap ?? material.metalnessMap ?? material.map : material.normalMap) ?? null;
}

/**
 * A mesh's fragment stage over its whole texture: its triangles -- ALL of them, the index as loaded (`applyLook`
 * swaps a cut-down index in under worn clothes and keeps the whole one as `userData.allIndices`) -- drawn flat in the
 * texture coordinates its map for that channel is read with, no depth, with a clone of its own material. The image
 * comes back in the order glTF stores one: the GPU's first row is v = 0, which three reads as an unflipped glTF image's
 * first row (the bake script proves this against her own skin map). The coordinates are the attribute itself (`uv`, or
 * `uv1`... for a map on another channel), not `vMapUv`: the baked texture is read back with the attribute, so a map
 * transform, were there one, must not be baked in.
 *
 * Every texel is baked as a FRONT face, which is how she is seen: a triangle whose coordinates run clockwise would be
 * drawn as a back face (her double-sided materials turn the normal and the frame round for one), so it is drawn the
 * other way round; and the tangent frame is turned for a mirrored island (ORIENTED_FRAME_FIX).
 */
export function bakeUV(renderer: THREE.WebGLRenderer, mesh: THREE.Mesh, size: number, viewCamera: THREE.Camera, options: UvBakeOptions): UvBake {
  const original = singleMaterial(mesh), standard = original as THREE.MeshStandardMaterial;
  if (options.channel === 'normal' && (!standard.normalMap || standard.normalMapType !== THREE.TangentSpaceNormalMap)) throw new Error(`story bake: ${mesh.name} has no tangent-space normal map to bake a normal into`);
  const channel = mapFor(standard, options.channel)?.channel ?? 0;
  const uvName = channel === 0 ? 'uv' : `uv${channel}`;
  const uv = mesh.geometry.getAttribute(uvName);
  if (!uv) throw new Error(`story bake: ${mesh.name} has no ${uvName} to bake over`);
  const triangles = Uint32Array.from(options.triangles ?? allTriangles(mesh));
  let turned = 0;
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
    const area = (uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a)) - (uv.getY(b) - uv.getY(a)) * (uv.getX(c) - uv.getX(a));
    if (area < 0) { triangles[t + 1] = c; triangles[t + 2] = b; turned++; }
  }
  const geometry = sharedGeometry(mesh.geometry, new THREE.BufferAttribute(triangles, 1));
  const matrix = options.matrix ?? restSkinMatrix(mesh as THREE.SkinnedMesh).matrix;
  const material = captureMaterial(original, `uv-${options.channel}-${uvName}`, (shader) => {
    shader.vertexShader = atEndOfMain(shader.vertexShader, `gl_Position = vec4(${uvName} * 2.0 - 1.0, 0.0, 1.0);`);
    const frame = THREE.ShaderChunk.normalmap_pars_fragment;
    if (!frame.includes(ORIENTED_FRAME)) throw new Error('story bake: three\'s getTangentFrame is not the one this was written against');
    shader.fragmentShader = atEndOfMain(shader.fragmentShader.replace('#include <normalmap_pars_fragment>', () => frame.replace(ORIENTED_FRAME, ORIENTED_FRAME_FIX)), UV_TAIL[options.channel]);
  }, {}, THREE.DoubleSide);
  const flat = standIn(new THREE.Mesh(geometry, material), mesh, matrix);
  const target = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
  try {
    const raw = drawAndRead(renderer, flat, viewCamera, target, new Uint8Array(size * size * 4));
    const covered = new Uint8Array(size * size);
    let coveredCount = 0;
    for (let i = 0; i < covered.length; i++) if (raw[i * 4 + 3] > 0) { covered[i] = 1; coveredCount++; }
    return { width: size, height: size, rgba: dilate(raw, size, size, options.dilate ?? 8), covered, coveredCount, turned };
  } finally {
    target.dispose();
    material.dispose();
    // the index is this bake's own: it goes with the geometry, her attributes do not
    releaseShared(geometry);
  }
}

/** Her body's colour as a texture (`bakeUV`, albedo). */
export function bakeAlbedoUV(renderer: THREE.WebGLRenderer, mesh: THREE.Mesh, size: number, viewCamera: THREE.Camera): UvBake {
  return bakeUV(renderer, mesh, size, viewCamera, { channel: 'albedo' });
}

// ---------------------------------------------------------------------------------------------------------------------
// The room's hook: everything she is drawn with, packed for the bake script

/** What the room hands the bake: her as she stands now, already posed and settled for it. */
export interface StoryBakeInput {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.Camera;
  /** Every visible skinned mesh of her, in the room's draw order. */
  readonly meshes: readonly THREE.SkinnedMesh[];
  /** Which of them is her body (its colour is baked into a texture) and which her hair (kept as its file has it). */
  readonly body: THREE.SkinnedMesh;
  readonly hair: readonly THREE.SkinnedMesh[];
  /** SIT on (true) or back to the pose the bake was taken in (false), the room's morph weights applied for it. */
  readonly seat: (on: boolean) => void;
  /** Bake her painted islands' colour apart from her skin's (`paintSplit`); true unless set false. */
  readonly splitPaint?: boolean;
  /** The body's colour texture's size (2048) and its metallic-roughness texture's (1024). */
  readonly albedoSize?: number;
  readonly surfaceSize?: number;
  /** The room's own account of her, passed through to the script as it is. */
  readonly facts?: Readonly<Record<string, unknown>>;
}

const sideName = (s: THREE.Side) => (s === THREE.DoubleSide ? 'double' : s === THREE.BackSide ? 'back' : 'front');
function textureFacts(t: THREE.Texture | null | undefined) {
  if (!t) return null;
  const im = t.image as { width?: number; height?: number } | null;
  return { name: t.name, width: im?.width ?? null, height: im?.height ?? null, colorSpace: t.colorSpace, channel: t.channel, flipY: t.flipY, uuid: t.uuid };
}
function materialFacts(m: THREE.Material) {
  const s = m as THREE.MeshStandardMaterial;
  return {
    name: m.name, type: m.type, side: sideName(m.side), transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest,
    vertexColors: m.vertexColors, colour: s.color ? s.color.toArray() : null, roughness: s.roughness ?? null, metalness: s.metalness ?? null,
    emissive: s.emissive ? s.emissive.toArray() : null, normalScale: s.normalScale ? s.normalScale.toArray() : null, fabric: fabricOn(m),
    maps: {
      map: textureFacts(s.map), normalMap: textureFacts(s.normalMap), roughnessMap: textureFacts(s.roughnessMap), metalnessMap: textureFacts(s.metalnessMap),
      aoMap: textureFacts(s.aoMap), emissiveMap: textureFacts(s.emissiveMap), alphaMap: textureFacts(s.alphaMap), bumpMap: textureFacts(s.bumpMap),
    },
  };
}
/** An attribute as plain floats, `size` a vertex (normalized integers decoded). */
function floats(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size = a.itemSize): Float32Array {
  const out = new Float32Array(a.count * size);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < size; c++) out[i * size + c] = a.getComponent(i, c);
  return out;
}
function weightsOf(mesh: THREE.Mesh): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, k] of Object.entries(mesh.morphTargetDictionary ?? {})) out[name] = mesh.morphTargetInfluences?.[k] ?? 0;
  return out;
}

/**
 * Everything she is drawn with, for the bake script: per visible mesh its captured vertices (and, for a garment, its
 * per-vertex colour and surface), its texture coordinates, colours, joints, weights and whole index, its material as
 * the room set it, its skinning matrices, and what SIT changes; for her body, its colour and surface baked into
 * textures. Arrays are base64 of their bytes, named by type. Synchronous GPU work; a few seconds on a phone-class GPU,
 * minutes on a software renderer.
 */
export function collectStoryBake(input: StoryBakeInput) {
  const { renderer, camera, body } = input;
  const listed = input.meshes.map((m) => `${m.name}|${singleMaterial(m).name}|${m.geometry.getAttribute('position').count}`);
  console.log(`[story bake] drawn: ${listed.join(', ')}`);
  const parts = input.meshes.map((mesh) => {
    const material = singleMaterial(mesh);
    const role = mesh === body ? 'body' : input.hair.includes(mesh) ? 'hair' : 'garment';
    const rest = restSkinMatrix(mesh);
    const garment = role === 'garment';
    const cap = captureVertices(renderer, mesh, camera, { matrix: rest.matrix, albedo: garment, surface: garment, textureLevel: garment && fabricOn(material) ? FABRIC_VERTEX_LEVEL : undefined });
    const g = mesh.geometry;
    const uv = g.getAttribute('uv'), colour = g.getAttribute('color'), joints = g.getAttribute('skinIndex'), weights = g.getAttribute('skinWeight');
    const all = (mesh.userData.allIndices as ArrayLike<number> | undefined) ?? g.index?.array ?? null;
    const jointArray = joints ? Uint16Array.from({ length: joints.count * 4 }, (_, i) => joints.getComponent(Math.floor(i / 4), i % 4)) : null;
    return {
      name: mesh.name, material: material.name, role, vertices: cap.count, triangles: all ? all.length / 3 : cap.count / 3,
      capture: {
        position: toBase64(cap.position), normal: toBase64(cap.normal), normalLength: toBase64(cap.normalLength),
        albedo: cap.albedo ? toBase64(cap.albedo) : null, surface: cap.surface ? toBase64(cap.surface) : null, missing: cap.missing,
      },
      uv: uv ? toBase64(floats(uv, 2)) : null,
      colour: colour ? { size: colour.itemSize, data: toBase64(floats(colour)) } : null,
      joints: jointArray ? toBase64(jointArray) : null,
      weights: weights ? toBase64(floats(weights, 4)) : null,
      index: all ? toBase64(Uint32Array.from(all)) : null,
      materialFacts: materialFacts(material),
      skin: {
        bindMode: mesh.bindMode, bindMatrix: mesh.bindMatrix.toArray(), matrixWorld: mesh.matrixWorld.toArray(), rest: rest.matrix.toArray(),
        restSpread: rest.spread, restBones: rest.bones, bones: mesh.skeleton.bones.length, boneNames: mesh.skeleton.bones.map((b) => b.name),
      },
      morph: { stand: weightsOf(mesh), sit: {} as Record<string, number>, seat: null as null | { position: string; normal: string | null; max: number; targets: readonly string[] } },
    };
  });
  // the body's colour, surface and normal over its own texture coordinates, and each garment's normal over its own: every
  // gap between islands filled, since a sampler's small mip levels average across them
  const full = (size: number) => ({ dilate: size });
  const split = input.splitPaint === false ? null : paintSplit(body, allTriangles(body));
  const albedoSize = input.albedoSize ?? 2048;
  const albedo = bakeUV(renderer, body, albedoSize, camera, { channel: 'albedo', ...full(albedoSize), ...(split ? { triangles: split.skin } : {}) });
  const paintAlbedo = split ? bakeUV(renderer, body, albedoSize, camera, { channel: 'albedo', ...full(albedoSize), triangles: split.paint }) : null;
  const surface = bakeUV(renderer, body, input.surfaceSize ?? 1024, camera, { channel: 'surface', ...full(input.surfaceSize ?? 1024) });
  const normalSize = (m: THREE.MeshStandardMaterial) => (m.normalMap?.image as { width?: number } | undefined)?.width ?? 1024;
  const normals = new Map<THREE.SkinnedMesh, UvBake>();
  for (const mesh of input.meshes) {
    const m = singleMaterial(mesh) as THREE.MeshStandardMaterial;
    if (input.hair.includes(mesh) || !m.normalMap || m.normalMapType !== THREE.TangentSpaceNormalMap) continue;
    const size = mesh === body ? input.albedoSize ?? 2048 : normalSize(m);
    normals.set(mesh, bakeUV(renderer, mesh, size, camera, { channel: 'normal', ...full(size) }));
  }

  // what SIT changes, by name, and back
  input.seat(true);
  const sit = input.meshes.map((m) => weightsOf(m));
  input.seat(false);
  parts.forEach((p, k) => {
    const mesh = input.meshes[k];
    p.morph.sit = sit[k];
    const d = seatDelta(mesh, p.morph.stand, sit[k]);
    p.morph.seat = d ? { position: toBase64(d.position), normal: d.normal ? toBase64(d.normal) : null, max: d.max, targets: d.targets } : null;
  });
  const uvBake = (b: UvBake) => ({ width: b.width, height: b.height, rgba: toBase64(b.rgba), covered: toBase64(b.covered), coveredCount: b.coveredCount, turned: b.turned });
  const normalOf = (mesh: THREE.SkinnedMesh) => { const b = normals.get(mesh); return b ? uvBake(b) : null; };
  return {
    version: 1, drawn: listed, parts: parts.map((p, k) => ({ ...p, normalMap: normalOf(input.meshes[k]) })),
    body: {
      albedo: uvBake(albedo), surface: uvBake(surface),
      // her painted islands, when they are baked apart: their own triangles and their own colour texture
      paint: split && paintAlbedo ? { skinTriangles: toBase64(split.skin), paintTriangles: toBase64(split.paint), albedo: uvBake(paintAlbedo) } : null,
    },
    facts: input.facts ?? {},
  };
}

/** What `collectStoryBake` returns. */
export type StoryBake = ReturnType<typeof collectStoryBake>;
