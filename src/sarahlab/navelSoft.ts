/**
 * HER NAVEL AS PART OF HER SOFT BELLY (Joshua, 2026-11-03: "how about making the bellybutton a soft body... so that way,
 * it will naturally show or not depending on belly pressure, and baby's position"; "max belly pressure = max navel %
 * so half pressure would keep the navel % at half, when there is no pressure like not pregnant, the navel moves in").
 *
 * Her navel is still the piece laid on her skin (navelPiece.ts) -- her approved outie and the reference bowl -- but laid
 * TWICE whenever her shape changes: as it is with no pressure behind it (`xIn`) and with all of it (`xOut`). The first
 * stays in her rest shape; the difference to the second, points and normals, goes into two small float textures, one
 * texel a vertex. Each frame the vertex shader adds that difference times `out` (0 no pressure .. 1 all of it, a little
 * past for more), read by the vertex's own index: so her navel moves every frame with what presses it -- her womb, her
 * baby, a kick, a contraction -- smoothly, without laying it again.
 */
import * as THREE from 'three';
import type { NavelPiece } from './navelPiece';

export interface NavelSoft {
  /** how far out (0 no pressure .. 1 all of it); the shaders read it every frame */
  readonly out: { value: number };
  /** lay her navel for no pressure (`xIn`) and all of it (`xOut`), her morph weights as `weights` (navelPiece's numbers) */
  lay(weights: Readonly<Record<string, number>>, xIn: number, xOut: number): void;
  /** have a material of her body draw it */
  patch(material: THREE.Material): void;
  dispose(): void;
}

const WIDTH = 2048;

/**
 * Her navel as the shaders draw it, for a reader of her body on the CPU (the cloth tee, the posers of her clothes): the
 * same offset, `out` times each vertex's own (`delta`, four floats a vertex, zero away from her navel), added after her
 * morph targets and before her bones -- the place the shader adds it, ahead of her soft belly's motion. Without it a
 * reader sees her navel laid in (`xIn`) while she is drawn with it pushed out, and the cloth laid over the first is
 * pierced by the second (Joshua, 2026-11-03: "the bellybutton pokes through all the clothes again").
 */
export interface NavelOffset { readonly out: { readonly value: number }; readonly delta: Float32Array }

/** The navel offset a mesh draws with, if it has one (`createNavelSoft` puts it on the mesh). */
export function navelOffsetOf(mesh: THREE.Object3D): NavelOffset | null {
  const s = (mesh.userData as { navelSoft?: NavelOffset }).navelSoft;
  return s && s.delta instanceof Float32Array ? s : null;
}

/** Vertex v's navel offset now (mesh space, before her bones) into `out`: zero away from her navel. */
export function navelOffsetAt(s: NavelOffset, v: number, out: { x: number; y: number; z: number }): void {
  const k = s.out.value, d = s.delta, o = v * 4;
  if (!k || o + 2 >= d.length) { out.x = 0; out.y = 0; out.z = 0; return; }
  out.x = k * d[o]; out.y = k * d[o + 1]; out.z = k * d[o + 2];
}

export function createNavelSoft(mesh: THREE.SkinnedMesh, piece: NavelPiece): NavelSoft {
  const geom = mesh.geometry as THREE.BufferGeometry, n = geom.getAttribute('position').count, H = Math.ceil(n / WIDTH);
  const texOf = () => { const t = new THREE.DataTexture(new Float32Array(WIDTH * H * 4), WIDTH, H, THREE.RGBAFormat, THREE.FloatType); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; };
  const posTex = texOf(), nrmTex = texOf();
  const out = { value: 0 }, uPos = { value: posTex }, uNrm = { value: nrmTex }, uW = { value: WIDTH };
  // every copy of every point the piece writes
  const d = piece.data, verts: number[] = [];
  for (let k = 0; k < d.count; k++) if (d.flags[k] & 1) for (let j = d.splitStart[k]; j < d.splitStart[k + 1]; j++) verts.push(d.splits[j]);
  const keep = new Float32Array(verts.length * 6);
  const patched = new WeakSet<THREE.Material>();
  // the readers of her body on the CPU add what the shaders add (navelOffsetOf)
  const offset: NavelOffset = { out, delta: posTex.image.data as Float32Array };
  (mesh.userData as { navelSoft?: NavelOffset }).navelSoft = offset;
  return {
    out,
    lay(weights, xIn, xOut) {
      const P = (geom.getAttribute('position') as THREE.BufferAttribute).array as Float32Array, nA = geom.getAttribute('normal') as THREE.BufferAttribute | undefined, N = nA ? (nA.array as Float32Array) : null;
      // all the way out, kept; then as it is with nothing behind it, left in her rest shape
      piece.apply(mesh, weights, xOut);
      verts.forEach((v, i) => { for (let c = 0; c < 3; c++) { keep[i * 6 + c] = P[v * 3 + c]; keep[i * 6 + 3 + c] = N ? N[v * 3 + c] : 0; } });
      piece.apply(mesh, weights, xIn);
      const pd = posTex.image.data as Float32Array, nd = nrmTex.image.data as Float32Array;
      verts.forEach((v, i) => { for (let c = 0; c < 3; c++) { pd[v * 4 + c] = keep[i * 6 + c] - P[v * 3 + c]; nd[v * 4 + c] = N ? keep[i * 6 + 3 + c] - N[v * 3 + c] : 0; } });
      posTex.needsUpdate = true; nrmTex.needsUpdate = true;
    },
    patch(material) {
      if (patched.has(material)) return;
      patched.add(material);
      const previous = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
      material.onBeforeCompile = function (shader, renderer) {
        previous?.call(this, shader, renderer);
        shader.uniforms.uNavelOut = out; shader.uniforms.uNavelPos = uPos; shader.uniforms.uNavelNrm = uNrm; shader.uniforms.uNavelW = uW;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uNavelOut;\nuniform highp sampler2D uNavelPos;\nuniform highp sampler2D uNavelNrm;\nuniform int uNavelW;')
          .replace('#include <morphnormal_vertex>', '#include <morphnormal_vertex>\nobjectNormal += uNavelOut * texelFetch(uNavelNrm, ivec2(gl_VertexID % uNavelW, gl_VertexID / uNavelW), 0).xyz;')
          .replace('#include <morphtarget_vertex>', '#include <morphtarget_vertex>\ntransformed += uNavelOut * texelFetch(uNavelPos, ivec2(gl_VertexID % uNavelW, gl_VertexID / uNavelW), 0).xyz;');
      };
      material.customProgramCacheKey = function () { return `${cacheKey ? cacheKey.call(this) : ''}|navelSoft`; };
      material.needsUpdate = true;
    },
    dispose() {
      const u = mesh.userData as { navelSoft?: NavelOffset };
      if (u.navelSoft === offset) delete u.navelSoft;
      posTex.dispose(); nrmTex.dispose();
    },
  };
}
