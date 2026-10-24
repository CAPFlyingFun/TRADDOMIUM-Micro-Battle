/**
 * HER DETAIL THROUGH THE CLOTH TEE (Joshua, 2026-10-24: "the breast slider has no effect on the outfit… it still should
 * have a visible effect", "the bellybutton also doesn't appear with the slider"). `clothDetail.ts` draws her nipples and
 * navel through the tee in shading. Here: the relief's gradient is the true slope of its height field, rises toward a
 * bump's centre and away from a dimple's, reaches nothing far off or a body's depth behind; a dimple darkens within its
 * limit and a bump never does; the patch is applied once, chains whatever the material already had, keeps every hook
 * the fabric patch needs in either order; and the spots land in the uniforms the shader reads.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  DIMPLE_DARKEN, MAX_DARKEN, clothDetailAt, patchClothDetail, setClothDetail, type ClothDetailSpot, type ClothDetailState,
} from '../src/sarahlab/clothDetail';
import { setFabricLayer } from '../src/sarahlab/fabricMaterial';

type Vec = [number, number, number];
const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: readonly number[]): number => Math.hypot(a[0], a[1], a[2]);

/** A spot at `center` facing +z unless told otherwise. */
function spot(center: Vec, height: number, radius: number, normal: Vec = [0, 0, 1]): ClothDetailSpot {
  return { center, normal, height, radius };
}
const only = (s: ClothDetailSpot): ClothDetailState => ({ navel: s, nipples: [] });

/** Run a material's onBeforeCompile on three's own standard shader, the way the renderer would. */
function compiled(material: THREE.Material): { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string } {
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader;
}
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/** A small tee-like mesh for the fabric patch to dress. */
function tee(): { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial } {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  const material = new THREE.MeshStandardMaterial();
  return { mesh: new THREE.Mesh(g, material), material };
}
const dress = (mesh: THREE.Mesh, material: THREE.Material): void =>
  setFabricLayer(mesh, material, 0, { texture: new THREE.Texture(), tile: 1, opacity: 1 }, { layers: 1, masked: false, rest: null });

describe('the relief on the CPU', () => {
  it('is flat exactly at a bump\'s centre and far away from it', () => {
    const s = only(spot([3, 4, 5], 0.4, 1.2));
    expect(len(clothDetailAt([3, 4, 5], s).gradient)).toBe(0);
    expect(len(clothDetailAt([3 + 60, 4, 5], s).gradient)).toBe(0);
  });

  it('slopes up toward a bump\'s centre, and away from a dimple\'s', () => {
    const p: Vec = [0.6, -0.3, 0];
    const t = p; // centre at the origin, normal +z: the offset is all tangential
    const bump = clothDetailAt(p, only(spot([0, 0, 0], 0.4, 1))).gradient;
    expect(dot(bump, t)).toBeLessThan(0);
    expect(Math.abs(bump[2])).toBe(0); // tangential: nothing along the normal
    const dimple = clothDetailAt(p, only(spot([0, 0, 0], -0.4, 1))).gradient;
    expect(dot(dimple, t)).toBeGreaterThan(0);
    for (let k = 0; k < 3; k++) expect(dimple[k]).toBeCloseTo(-bump[k], 12);
  });

  it('is the true gradient of the height field H·exp(-r²/R²) on the skin\'s plane', () => {
    const H = 0.35, R = 0.9, c: Vec = [1, 2, 3];
    const s = only(spot(c, H, R));
    const h = (x: number, y: number) => H * Math.exp(-((x - c[0]) ** 2 + (y - c[1]) ** 2) / (R * R));
    const p: Vec = [1.4, 2.25, 3], e = 1e-5;
    const g = clothDetailAt(p, s).gradient;
    expect(g[0]).toBeCloseTo((h(p[0] + e, p[1]) - h(p[0] - e, p[1])) / (2 * e), 8);
    expect(g[1]).toBeCloseTo((h(p[0], p[1] + e) - h(p[0], p[1] - e)) / (2 * e), 8);
  });

  it('reaches nothing a body\'s depth behind (the back of the shirt)', () => {
    const R = 1, s = only(spot([0, 0, 0], 0.4, R, [0, 0, 1]));
    const front = clothDetailAt([0.5, 0, 0], s).gradient;
    const back = clothDetailAt([0.5, 0, -25 * R], s).gradient;
    expect(len(front)).toBeGreaterThan(0.1);
    expect(len(back)).toBeLessThan(1e-50);
  });

  it('works in her skin\'s own frame, whatever way the normal faces', () => {
    const n: Vec = [0, Math.SQRT1_2, Math.SQRT1_2];
    const s = only(spot([0, 0, 0], 0.4, 1, n));
    const t: Vec = [0.5, 0.2, -0.2]; // tangential: dot(t, n) = 0
    const g = clothDetailAt(t, s).gradient;
    expect(dot(g, n)).toBeCloseTo(0, 12);
    expect(dot(g, t)).toBeLessThan(0);
    // an unnormalised normal is the same spot
    const g2 = clothDetailAt(t, only(spot([0, 0, 0], 0.4, 1, [0, 3, 3]))).gradient;
    for (let k = 0; k < 3; k++) expect(g2[k]).toBeCloseTo(g[k], 12);
  });

  it('darkens a dimple within its limit and never a bump', () => {
    expect(clothDetailAt([0, 0, 0], only(spot([0, 0, 0], 0.4, 1))).shade).toBe(1);
    expect(clothDetailAt([0.3, 0, 0], only(spot([0, 0, 0], 0.4, 1))).shade).toBe(1);
    const shallow = clothDetailAt([0, 0, 0], only(spot([0, 0, 0], -0.2, 1))).shade;
    expect(shallow).toBeCloseTo(1 - 0.2 * DIMPLE_DARKEN, 12);
    expect(shallow).toBeLessThan(1);
    expect(shallow).toBeGreaterThanOrEqual(1 - MAX_DARKEN);
    expect(clothDetailAt([0, 0, 0], only(spot([0, 0, 0], -5, 1))).shade).toBeCloseTo(1 - MAX_DARKEN, 12);
    expect(clothDetailAt([0, 0, -25], only(spot([0, 0, 0], -5, 1))).shade).toBeCloseTo(1, 12);
  });

  it('sums the navel and two nipples, and ignores a third', () => {
    const navel = spot([0, -10, 0], -0.3, 1), a = spot([-4, 8, 0], 0.4, 1), b = spot([4, 8, 0], 0.4, 1);
    const extra = spot([4.5, 8, 0], 2, 1);
    const p: Vec = [4.4, 8.1, 0];
    const two = clothDetailAt(p, { navel, nipples: [a, b] });
    const three = clothDetailAt(p, { navel, nipples: [a, b, extra] });
    expect(three).toEqual(two);
    const alone = clothDetailAt(p, { navel: null, nipples: [b] });
    for (let k = 0; k < 3; k++) expect(two.gradient[k]).toBeCloseTo(alone.gradient[k], 12);
    expect(len(clothDetailAt(p, { navel: null, nipples: [] }).gradient)).toBe(0);
  });
});

describe('the patch', () => {
  it('is applied once', () => {
    const material = new THREE.MeshStandardMaterial();
    const version = material.version;
    patchClothDetail(material);
    const hook = material.onBeforeCompile, key = material.customProgramCacheKey;
    expect(material.version).toBe(version + 1);
    patchClothDetail(material);
    setClothDetail(material, only(spot([0, 0, 0], 0.4, 1)));
    expect(material.onBeforeCompile).toBe(hook);
    expect(material.customProgramCacheKey).toBe(key);
    expect(material.version).toBe(version + 1); // later changes are uniforms, never a recompile
  });

  it('chains the material\'s own onBeforeCompile and cache key', () => {
    const material = new THREE.MeshStandardMaterial();
    const before = vi.fn();
    material.onBeforeCompile = before;
    material.customProgramCacheKey = () => 'hem-cut-v3';
    patchClothDetail(material);
    const shader = compiled(material);
    expect(before).toHaveBeenCalledTimes(1);
    expect(before.mock.calls[0][0]).toBe(shader);
    expect(material.customProgramCacheKey()).toContain('hem-cut-v3');
    expect(material.customProgramCacheKey()).toContain('cloth-detail-v1');
    expect(material.customProgramCacheKey()).toBe('hem-cut-v3|cloth-detail-v1');
  });

  it('writes its code into three\'s standard shader and keeps every hook once', () => {
    const material = new THREE.MeshStandardMaterial();
    patchClothDetail(material);
    const shader = compiled(material);
    expect(shader.vertexShader).toContain('varying vec3 vClothWorld;');
    expect(shader.vertexShader).toContain('#include <project_vertex>\nvClothWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    expect(shader.fragmentShader).toContain('uniform vec3 clothSpotC[3];');
    expect(shader.fragmentShader).toContain('diffuseColor.rgb *= clothShade;');
    expect(shader.fragmentShader).toContain('normal = normalize(normal - faceDirection * (mat3(viewMatrix) * clothGrad));');
    // the same constants as the CPU
    expect(shader.fragmentShader).toContain(`clamp(clothDark * ${DIMPLE_DARKEN}, -${MAX_DARKEN}, 0.0)`);
    // the relief comes after the colour is known, and the tilt after the shading normal is
    const frag = shader.fragmentShader;
    expect(frag.indexOf('#include <color_fragment>')).toBeLessThan(frag.indexOf('float clothShade'));
    expect(frag.indexOf('#include <normal_fragment_begin>')).toBeLessThan(frag.indexOf('#include <normal_fragment_maps>'));
    expect(frag.indexOf('#include <normal_fragment_maps>')).toBeLessThan(frag.indexOf('mat3(viewMatrix) * clothGrad'));
    for (const token of ['#include <project_vertex>', '#include <begin_vertex>', '#include <beginnormal_vertex>']) expect(count(shader.vertexShader, token), token).toBe(1);
    for (const token of ['#include <color_fragment>', '#include <normal_fragment_maps>', '#include <map_fragment>']) expect(count(shader.fragmentShader, token), token).toBe(1);
    expect(Object.keys(shader.uniforms).sort()).toEqual(['clothDetailOn', 'clothSpotC', 'clothSpotH', 'clothSpotN', 'clothSpotR']);
    expect(shader.uniforms.clothDetailOn.value).toBe(0); // starts off
  });

  for (const order of ['fabric first', 'cloth detail first'] as const) {
    it(`lives alongside the fabric patch (${order})`, () => {
      const { mesh, material } = tee();
      if (order === 'fabric first') { dress(mesh, material); patchClothDetail(material); } else { patchClothDetail(material); dress(mesh, material); }
      const shader = compiled(material);
      // the fabric's own insertions
      expect(shader.vertexShader).toContain('vFabricPos = fabricRest;');
      expect(shader.fragmentShader).toContain('float fabricMatte = 0.0, fabricRoughness = 1.0;');
      expect(shader.fragmentShader).toContain('roughnessFactor = mix(roughnessFactor, fabricRoughness, fabricMatte);');
      expect(shader.uniforms.fabricOn0.value).toBe(1);
      // and the detail's
      expect(shader.vertexShader).toContain('vClothWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      expect(shader.fragmentShader).toContain('diffuseColor.rgb *= clothShade;');
      expect(shader.fragmentShader).toContain('mat3(viewMatrix) * clothGrad');
      expect(shader.uniforms.clothDetailOn).toBeDefined();
      // the fabric's colour is laid before the detail shades it
      expect(shader.fragmentShader.indexOf('float fabricMatte')).toBeLessThan(shader.fragmentShader.indexOf('*= clothShade'));
      for (const token of ['#include <project_vertex>', '#include <begin_vertex>', '#include <beginnormal_vertex>']) expect(count(shader.vertexShader, token), token).toBe(1);
      for (const token of ['#include <color_fragment>', '#include <normal_fragment_maps>', '#include <map_fragment>', '#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>']) expect(count(shader.fragmentShader, token), token).toBe(1);
      const key = material.customProgramCacheKey();
      expect(key).toContain('|fabric-1-v10');
      expect(key).toContain('|cloth-detail-v1');
    });
  }
});

describe('the spots', () => {
  const navel = spot([1, -12, 9], -0.4, 0.8, [0, 0, 2]);
  const left = spot([-5, 10, 11], 0.3, 0.6, [-0.2, 0, 1]);
  const right = spot([5, 10, 11], 0.25, 0.5);

  it('land in the uniforms the shader reads: navel in 0, nipples in 1 and 2', () => {
    const material = new THREE.MeshStandardMaterial();
    patchClothDetail(material);
    const shader = compiled(material); // compiled before the spots arrive: they reach it as uniform values
    setClothDetail(material, { navel, nipples: [left, right] });
    const u = shader.uniforms;
    expect(u.clothDetailOn.value).toBe(1);
    const c = u.clothSpotC.value as THREE.Vector3[], n = u.clothSpotN.value as THREE.Vector3[];
    expect(c.map((v) => v.toArray())).toEqual([[1, -12, 9], [-5, 10, 11], [5, 10, 11]]);
    expect(n[0].toArray()).toEqual([0, 0, 1]); // made unit length, as the CPU does
    expect(n[1].length()).toBeCloseTo(1, 12);
    expect(n[1].x).toBeLessThan(0);
    expect(n[2].toArray()).toEqual([0, 0, 1]);
    expect(u.clothSpotH.value).toEqual([-0.4, 0.3, 0.25]);
    expect(u.clothSpotR.value).toEqual([0.8, 0.6, 0.5]);
  });

  it('ignores extra nipples and empties a missing spot', () => {
    const material = new THREE.MeshStandardMaterial();
    setClothDetail(material, { navel: null, nipples: [left, right, spot([0, 0, 0], 9, 9)] });
    const u = compiled(material).uniforms;
    expect((u.clothSpotC.value as THREE.Vector3[]).length).toBe(3);
    expect((u.clothSpotC.value as THREE.Vector3[])[2].toArray()).toEqual([5, 10, 11]);
    expect(u.clothSpotH.value).toEqual([0, 0.3, 0.25]);
    expect(u.clothSpotR.value).toEqual([1, 0.6, 0.5]);
  });

  it('switches off with null, and leaves a material it never patched alone', () => {
    const material = new THREE.MeshStandardMaterial();
    setClothDetail(material, { navel, nipples: [left, right] });
    setClothDetail(material, null);
    const u = compiled(material).uniforms;
    expect(u.clothDetailOn.value).toBe(0);
    expect(u.clothSpotH.value).toEqual([0, 0, 0]);
    const plain = new THREE.MeshStandardMaterial();
    const version = plain.version, hook = plain.onBeforeCompile;
    setClothDetail(plain, null);
    expect(plain.version).toBe(version);
    expect(plain.onBeforeCompile).toBe(hook);
  });
});
