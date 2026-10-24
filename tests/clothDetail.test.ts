/**
 * HER DETAIL THROUGH THE CLOTH TEE (Joshua, 2026-10-24: "the breast slider has no effect on the outfit… it still should
 * have a visible effect", "the bellybutton also doesn't appear with the slider"). `clothDetail.ts` draws her nipples and
 * navel through the tee in shading. Here: the relief's gradient is the true slope of its height field, rises toward a
 * bump's centre and away from a dimple's, reaches nothing far off or a body's depth behind; a dimple darkens within its
 * limit and a bump never does; the fitted tee's own modelled relief is taken back by exactly `flatten` of it at a
 * spot's centre, falling off with the same footprint, its slope tilted back out of the shading, and nothing at all
 * without a flatten; the patch is applied once, chains whatever the material already had, keeps every hook the fabric
 * patch needs in either order, and leaves three's clip position alone unless something was moved; and the spots land
 * in the uniforms both stages read.
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

describe('taking the garment\'s own relief back', () => {
  /** A spot at the origin facing +z, with the garment's own relief `relief` there, `flatten` of it taken back. */
  const flat = (flatten: number | undefined, relief: number | undefined, height = 0, radius = 1.5): ClothDetailState =>
    only({ center: [0, 0, 0], normal: [0, 0, 1], height, radius, flatten, relief });

  it('moves nothing when flatten is absent, zero, or there is no relief', () => {
    for (const s of [flat(undefined, -0.6), flat(0, -0.6), flat(1, 0), flat(undefined, undefined), only(spot([0, 0, 0], 0.4, 1))]) {
      for (const p of [[0, 0, 0], [0.4, -0.2, 0.1], [3, 1, -2]] as Vec[]) {
        const at = clothDetailAt(p, s);
        expect(at.displacement).toEqual([0, 0, 0]);
      }
    }
    expect(clothDetailAt([0, 0, 0], flat(undefined, -0.6)).flattenWeight).toEqual([0, 0, 0]);
    // and an absent flatten leaves everything the relief already drew as it was
    const before = clothDetailAt([0.4, 0.3, 0], only(spot([0, 0, 0], -0.4, 1.5)));
    const after = clothDetailAt([0.4, 0.3, 0], flat(undefined, -0.6, -0.4));
    expect(after.gradient).toEqual(before.gradient);
    expect(after.shade).toBe(before.shade);
  });

  it('takes all of it back at the centre: the point moves by exactly -relief along the normal', () => {
    for (const relief of [-0.6, 0.25]) {
      const at = clothDetailAt([0, 0, 0], flat(1, relief));
      expect(at.displacement).toEqual([0, 0, -relief]);
      expect(at.flattenWeight).toEqual([1, 0, 0]);
    }
    // along a tilted normal too
    const n: Vec = [0, Math.SQRT1_2, Math.SQRT1_2], c: Vec = [2, 3, 4];
    const d = clothDetailAt(c, only({ center: c, normal: n, height: 0, radius: 1, flatten: 1, relief: -0.5 })).displacement;
    for (let k = 0; k < 3; k++) expect(d[k]).toBeCloseTo(0.5 * n[k], 12);
    // half the flatten, half the move
    expect(clothDetailAt([0, 0, 0], flat(0.5, -0.6)).displacement[2]).toBeCloseTo(0.3, 12);
  });

  it('falls off with the footprint across the skin (g) and off it (fade)', () => {
    const R = 1.5, relief = -0.6, s = flat(1, relief, 0, R);
    const across = 1.2, off = 0.9;
    const side = clothDetailAt([across, 0, 0], s), above = clothDetailAt([0, 0, off], s), both = clothDetailAt([across, 0, off], s);
    const g = Math.exp(-(across * across) / (R * R)), fade = Math.exp(-(off * off) / (4 * R * R));
    expect(side.displacement[2]).toBeCloseTo(-relief * g, 12);
    expect(above.displacement[2]).toBeCloseTo(-relief * fade, 12);
    expect(both.displacement[2]).toBeCloseTo(-relief * g * fade, 12);
    expect(side.displacement[0]).toBe(0); // only ever along the spot's normal
    expect(both.flattenWeight[0]).toBeCloseTo(g * fade, 12);
    expect(Math.abs(clothDetailAt([20, 0, 0], s).displacement[2])).toBeLessThan(1e-50);
  });

  it('tilts the shading back by the slope of what it took away, as a relief of the opposite sign would', () => {
    const R = 1.5, p: Vec = [0.7, -0.4, 0.2];
    // all of a 0.6 dent taken back shades like a 0.6 bump over smooth fabric: the dent's slope, cancelled
    const taken = clothDetailAt(p, flat(1, -0.6, 0, R)).gradient, bump = clothDetailAt(p, only(spot([0, 0, 0], 0.6, R))).gradient;
    for (let k = 0; k < 3; k++) expect(taken[k]).toBeCloseTo(bump[k], 12);
    // with her own detail on top, the two slopes add: height less flatten × relief
    const both = clothDetailAt(p, flat(0.5, -0.6, 0.2, R)).gradient, sum = clothDetailAt(p, only(spot([0, 0, 0], 0.2 + 0.3, R))).gradient;
    for (let k = 0; k < 3; k++) expect(both[k]).toBeCloseTo(sum[k], 12);
    // taking a dent back never darkens anything: only her own dimples do
    expect(clothDetailAt([0, 0, 0], flat(1, -0.6, 0, R)).shade).toBe(1);
  });

  it('clamps flatten to 0..1', () => {
    expect(clothDetailAt([0, 0, 0], flat(2, -0.6))).toEqual(clothDetailAt([0, 0, 0], flat(1, -0.6)));
    expect(clothDetailAt([0.3, 0, 0], flat(-1, -0.6))).toEqual(clothDetailAt([0.3, 0, 0], flat(0, -0.6)));
  });

  it('moves nothing a body\'s depth behind (the back of the shirt)', () => {
    const R = 1, s = flat(1, -0.6, 0, R);
    const back = clothDetailAt([0.2, 0, -25 * R], s);
    expect(len(back.displacement)).toBeLessThan(1e-50);
    expect(back.flattenWeight[0]).toBeLessThan(1e-50);
  });

  it('works spot by spot: each slot its own weight, the moves summed', () => {
    const navel = { ...spot([0, -10, 0], -0.3, 1.5), flatten: 1, relief: -0.5 };
    const nipple = { ...spot([4, 8, 0], 0.4, 1), flatten: 0.5, relief: 0.2 };
    const at = clothDetailAt([4, 8, 0], { navel, nipples: [spot([-4, 8, 0], 0.4, 1), nipple] });
    expect(at.flattenWeight[0]).toBeLessThan(1e-20);
    expect(at.flattenWeight[1]).toBe(0);
    expect(at.flattenWeight[2]).toBeCloseTo(0.5, 12);
    expect(at.displacement[2]).toBeCloseTo(-0.5 * 0.2, 12);
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
    expect(material.customProgramCacheKey()).toContain('cloth-detail-v2');
    expect(material.customProgramCacheKey()).toBe('hem-cut-v3|cloth-detail-v2');
  });

  it('writes its code into three\'s standard shader and keeps every hook once', () => {
    const material = new THREE.MeshStandardMaterial();
    patchClothDetail(material);
    const shader = compiled(material);
    expect(shader.vertexShader).toContain('varying vec3 vClothWorld;');
    // the vertex stage reads the same spots, to take the garment's own relief back
    for (const decl of ['uniform float clothDetailOn;', 'uniform vec3 clothSpotC[3];', 'uniform vec3 clothSpotN[3];', 'uniform float clothSpotR[3];', 'uniform float clothSpotF[3];', 'uniform float clothSpotE[3];']) {
      expect(count(shader.vertexShader, decl), decl).toBe(1);
      expect(count(shader.fragmentShader, decl), decl).toBe(1);
    }
    const vert = shader.vertexShader, at = vert.indexOf('#include <project_vertex>');
    expect(vert.indexOf('vec4 clothW = modelMatrix * vec4(transformed, 1.0);')).toBeGreaterThan(at);
    expect(vert).toContain('clothDisp -= clothSpotF[clothI] * clothSpotE[clothI] * clothG * clothFade * clothN;');
    // the varying is the drawn (displaced) point, written after any displacement
    expect(vert.indexOf('vClothWorld = clothW.xyz;')).toBeGreaterThan(vert.indexOf('clothW.xyz += clothDisp;'));
    // nothing to flatten: the clip position is three's own (in project_vertex), rewritten only inside the guard below
    expect(count(vert, 'gl_Position =')).toBe(1);
    expect(vert).toMatch(/if \(dot\(clothDisp, clothDisp\) > 0\.0\) \{\s*clothW\.xyz \+= clothDisp;\s*mvPosition = viewMatrix \* clothW;\s*gl_Position = projectionMatrix \* mvPosition;\s*\}/);
    expect(vert.indexOf('if (clothDetailOn > 0.5)')).toBeLessThan(vert.indexOf('if (dot(clothDisp, clothDisp) > 0.0)'));
    // the slope of what is taken back of the garment's own relief is summed into the same tilt as her detail
    expect(shader.fragmentShader).toContain('clothGrad += (clothH - clothSpotF[clothI] * clothSpotE[clothI]) * clothG * clothFade * (-2.0 / clothR2) * clothT;');
    expect(count(shader.fragmentShader, 'normal = normalize(')).toBe(1);
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
    expect(Object.keys(shader.uniforms).sort()).toEqual(['clothDetailOn', 'clothSpotC', 'clothSpotE', 'clothSpotF', 'clothSpotH', 'clothSpotN', 'clothSpotR']);
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
      expect(shader.vertexShader).toContain('vec4 clothW = modelMatrix * vec4(transformed, 1.0);');
      expect(shader.vertexShader).toContain('vClothWorld = clothW.xyz;');
      expect(shader.vertexShader).toContain('uniform float clothSpotF[3];');
      expect(shader.fragmentShader).toContain('clothSpotF[clothI] * clothSpotE[clothI]');
      expect(shader.fragmentShader).toContain('diffuseColor.rgb *= clothShade;');
      expect(shader.fragmentShader).toContain('mat3(viewMatrix) * clothGrad');
      expect(shader.uniforms.clothDetailOn).toBeDefined();
      // the fabric's colour is laid before the detail shades it
      expect(shader.fragmentShader.indexOf('float fabricMatte')).toBeLessThan(shader.fragmentShader.indexOf('*= clothShade'));
      for (const token of ['#include <project_vertex>', '#include <begin_vertex>', '#include <beginnormal_vertex>']) expect(count(shader.vertexShader, token), token).toBe(1);
      for (const token of ['#include <color_fragment>', '#include <normal_fragment_maps>', '#include <map_fragment>', '#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>']) expect(count(shader.fragmentShader, token), token).toBe(1);
      const key = material.customProgramCacheKey();
      expect(key).toContain('|fabric-1-v10');
      expect(key).toContain('|cloth-detail-v2');
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
    expect(u.clothSpotF.value).toEqual([0, 0, 0]); // absent: nothing taken back
    expect(u.clothSpotE.value).toEqual([0, 0, 0]);
    setClothDetail(material, { navel: { ...navel, flatten: 0.75, relief: -0.6 }, nipples: [{ ...left, flatten: 1, relief: 0.1 }, right] });
    expect(u.clothSpotF.value).toEqual([0.75, 1, 0]);
    expect(u.clothSpotE.value).toEqual([-0.6, 0.1, 0]);
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
    expect(u.clothSpotF.value).toEqual([0, 0, 0]);
    expect(u.clothSpotE.value).toEqual([0, 0, 0]);
    const plain = new THREE.MeshStandardMaterial();
    const version = plain.version, hook = plain.onBeforeCompile;
    setClothDetail(plain, null);
    expect(plain.version).toBe(version);
    expect(plain.onBeforeCompile).toBe(hook);
  });
});
