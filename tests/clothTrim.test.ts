/**
 * THE CROP AND THE TANK (Joshua, 2026-10-25: "make 0 like a cropped tank athletic top instead", and a SLEEVES switch for
 * tank or cap sleeve at any length). `clothTrim.ts` draws both cut edges by `discard`, from where each point stands
 * against the hem as made, the crop's hem and the tank's armhole (`clothTrim`, metres). Here: with no crop and the tank
 * off nothing is cut, whatever the point says; a crop share raises the hem's line from the one to the other, linearly;
 * the tank cuts what stands outside the armhole and nothing else; the CPU mirror and the uniforms clamp alike; the patch
 * is applied once, chains whatever the material already had, writes its attribute, varying and discard where three's
 * standard shader keeps its hooks, lives alongside the neckline's in either order, and a null on a material never
 * patched leaves it untouched.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CLOTH_TRIM_ATTRIBUTE, clothTrimAbove, clothTrimCut, cropShare, patchClothTrim, setClothTrim, type ClothTrimState } from '../src/sarahlab/clothTrim';
import { patchClothNeckline, setClothNeckline } from '../src/sarahlab/clothNeckline';

/** (above the hem as made, above the crop's hem, inside the armhole) */
type Trim = [number, number, number];
const AS_MADE: ClothTrimState = { crop: 0, tank: false };

function compiled(material: THREE.Material): { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string } {
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader;
}
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;
const CUT_LINES = [
  'if (clothTrimCrop > 0.0 && mix(vClothTrim.x, vClothTrim.y, clothTrimCrop) < 0.0) discard;',
  'if (clothTrimTank > 0.5 && vClothTrim.z < 0.0) discard;',
];

describe('the trim on the CPU', () => {
  it('cuts nothing with no crop and the tank off, whatever the point says, and nothing at all with no state', () => {
    for (const t of [[0, 0, 0], [-0.1, -0.2, -0.3], [9, 9, 9], [0.01, -0.3, -0.01]] as Trim[]) {
      expect(clothTrimCut(t, AS_MADE), String(t)).toBe(false);
      expect(clothTrimCut(t, null), String(t)).toBe(false);
    }
  });

  it('raises the hem\'s line from the hem as made to the crop\'s, by the share', () => {
    // a point 30 cm above the hem as made and 5 cm below the crop's hem: kept until the line has risen past it
    const t: Trim = [0.3, -0.05, 1];
    expect(clothTrimAbove(t, 0)).toBeCloseTo(0.3, 12);
    expect(clothTrimAbove(t, 1)).toBeCloseTo(-0.05, 12);
    expect(clothTrimAbove(t, 0.5)).toBeCloseTo(0.125, 12);
    // the line passes it at 0.3 / 0.35 of the way
    expect(clothTrimCut(t, { crop: 0.85, tank: false })).toBe(false);
    expect(clothTrimCut(t, { crop: 0.86, tank: false })).toBe(true);
    expect(clothTrimCut(t, { crop: 1, tank: false })).toBe(true);
    // a point above the crop's hem is never cropped
    for (const crop of [0.01, 0.5, 1]) expect(clothTrimCut([0.4, 0.01, 1], { crop, tank: false })).toBe(false);
    // the rows below the hem and the collar stand far above any hem
    for (const crop of [0.01, 0.5, 1]) expect(clothTrimCut([9, 9, 9], { crop, tank: true })).toBe(false);
  });

  it('cuts only what stands outside the armhole with the tank on, and the armhole never with it off', () => {
    const tank: ClothTrimState = { crop: 0, tank: true };
    expect(clothTrimCut([1, 1, -0.001], tank)).toBe(true);
    expect(clothTrimCut([1, 1, -0.01], tank)).toBe(true);
    expect(clothTrimCut([1, 1, 0], tank)).toBe(false);
    expect(clothTrimCut([1, 1, 0.02], tank)).toBe(false);
    expect(clothTrimCut([1, 1, -0.01], AS_MADE)).toBe(false);
    expect(clothTrimCut([1, 1, -0.01], { crop: 0.5, tank: false })).toBe(false);
    // and both at once: either cuts
    expect(clothTrimCut([0.3, -0.05, 0.05], { crop: 1, tank: true })).toBe(true);
    expect(clothTrimCut([0.3, 0.05, -0.05], { crop: 1, tank: true })).toBe(true);
    expect(clothTrimCut([0.3, 0.05, 0.05], { crop: 1, tank: true })).toBe(false);
  });

  it('clamps the crop the way the uniform does', () => {
    expect(cropShare(-1)).toBe(0);
    expect(cropShare(3)).toBe(1);
    expect(cropShare(Number.NaN)).toBe(0);
    expect(cropShare(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clothTrimCut([0.3, -0.05, 1], { crop: 3, tank: false })).toBe(true);
    expect(clothTrimCut([-0.01, -0.05, 1], { crop: -2, tank: false })).toBe(false);
    expect(clothTrimCut([-0.01, -0.05, 1], { crop: Number.NaN, tank: false })).toBe(false);
  });
});

describe('the patch', () => {
  it('is applied once, and later changes are uniforms', () => {
    const material = new THREE.MeshStandardMaterial();
    const version = material.version;
    patchClothTrim(material);
    const hook = material.onBeforeCompile, key = material.customProgramCacheKey;
    expect(material.version).toBe(version + 1);
    patchClothTrim(material);
    setClothTrim(material, { crop: 0.4, tank: true });
    setClothTrim(material, null);
    setClothTrim(material, AS_MADE);
    expect(material.onBeforeCompile).toBe(hook);
    expect(material.customProgramCacheKey).toBe(key);
    expect(material.version).toBe(version + 1);
  });

  it('sets its uniforms, clamped, and switches off with null', () => {
    const material = new THREE.MeshStandardMaterial();
    setClothTrim(material, { crop: 7, tank: true });
    const { uniforms } = compiled(material);
    expect(uniforms.clothTrimOn.value).toBe(1);
    expect(uniforms.clothTrimCrop.value).toBe(1);
    expect(uniforms.clothTrimTank.value).toBe(1);
    setClothTrim(material, { crop: 0.25, tank: false });
    expect(uniforms.clothTrimCrop.value).toBe(0.25);
    expect(uniforms.clothTrimTank.value).toBe(0);
    setClothTrim(material, null);
    expect(uniforms.clothTrimOn.value).toBe(0);
    expect(uniforms.clothTrimCrop.value).toBe(0);
  });

  it('leaves a material never patched alone when switched off', () => {
    const material = new THREE.MeshStandardMaterial();
    const version = material.version, hook = material.onBeforeCompile;
    setClothTrim(material, null);
    expect(material.version).toBe(version);
    expect(material.onBeforeCompile).toBe(hook);
  });

  it('chains the material\'s own onBeforeCompile and cache key', () => {
    const material = new THREE.MeshStandardMaterial();
    const before = vi.fn();
    material.onBeforeCompile = before;
    material.customProgramCacheKey = () => 'earlier-v2';
    patchClothTrim(material);
    const shader = compiled(material);
    expect(before).toHaveBeenCalledTimes(1);
    expect(before.mock.calls[0][0]).toBe(shader);
    expect(material.customProgramCacheKey()).toBe('earlier-v2|cloth-trim-v1');
  });

  it('writes its attribute, varying and discard into three\'s standard shader and keeps its hooks', () => {
    const material = new THREE.MeshStandardMaterial();
    patchClothTrim(material);
    const { vertexShader: vert, fragmentShader: frag, uniforms } = compiled(material);
    expect(CLOTH_TRIM_ATTRIBUTE).toBe('clothTrim');
    expect(count(vert, 'attribute vec3 clothTrim;')).toBe(1);
    expect(count(vert, 'varying vec3 vClothTrim;')).toBe(1);
    expect(count(frag, 'varying vec3 vClothTrim;')).toBe(1);
    expect(count(vert, '#include <begin_vertex>')).toBe(1);
    expect(vert).toMatch(/#include <begin_vertex>\s*vClothTrim = clothTrim;/);
    expect(count(frag, '#include <clipping_planes_fragment>')).toBe(1);
    expect(frag).toMatch(/#include <clipping_planes_fragment>\s*if \(clothTrimOn > 0\.5\) \{/);
    let last = frag.indexOf('if (clothTrimOn > 0.5) {');
    for (const line of CUT_LINES) { expect(count(frag, line), line).toBe(1); const at = frag.indexOf(line); expect(at, line).toBeGreaterThan(last); last = at; }
    expect(count(frag, 'discard;') - count(THREE.ShaderLib.standard.fragmentShader, 'discard;')).toBe(2);
    expect(Object.keys(uniforms).sort()).toEqual(['clothTrimCrop', 'clothTrimOn', 'clothTrimTank']);
    expect(uniforms.clothTrimOn.value).toBe(0);
  });

  for (const order of ['trim first', 'neckline first'] as const) {
    it(`lives alongside the neckline's patch (${order})`, () => {
      const material = new THREE.MeshStandardMaterial();
      if (order === 'trim first') { patchClothTrim(material); patchClothNeckline(material); }
      else { patchClothNeckline(material); patchClothTrim(material); }
      setClothTrim(material, { crop: 1, tank: true });
      setClothNeckline(material, { collar: 0, depth: 0.05, shape: 'V' });
      const shader = compiled(material), vert = shader.vertexShader, frag = shader.fragmentShader;
      for (const line of CUT_LINES) expect(count(frag, line), line).toBe(1);
      expect(vert).toContain('vClothTrim = clothTrim;');
      expect(vert).toContain('vClothNeck = clothNeck;');
      expect(frag).toContain('if (clothNeckOn > 0.5) {');
      expect(count(vert, '#include <begin_vertex>')).toBe(1);
      expect(count(frag, '#include <clipping_planes_fragment>')).toBe(1);
      expect(shader.uniforms.clothTrimTank.value).toBe(1);
      expect(shader.uniforms.clothNeckShape.value).toBe(1);
      const key = material.customProgramCacheKey();
      expect(key).toContain('|cloth-trim-v1');
      expect(key).toContain('|cloth-neckline-v1');
    });
  }
});
