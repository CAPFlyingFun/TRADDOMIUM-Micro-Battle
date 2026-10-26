/**
 * THE TEE'S NECKLINE, ADJUSTABLE (Joshua, 2026-10-24: "can the neckline also be adjustable like the length so you can
 * do U/V shape and select how deep up to turtleneck?"). `clothNeckline.ts` draws the cut edge by `discard`, the curve
 * worked out at every fragment from where the point stands against the U's and the V's lines as made and its u across
 * the neckline. Here: as made it cuts nothing of the tee and all of the collar; a collar share keeps the rows up to it
 * and cuts the rest; a depth cuts the front down to D·(1 - u²) below the U's line or D·(1 - u) below the V's, nothing
 * at the neckline's side (u = 1) and u clamped to 0..1; `clothNecklineBelow` is that distance, negative where cut; the
 * CPU mirror and the uniforms clamp alike; the patch is applied once, chains whatever the material already had, writes
 * its attribute, varying and discard where three's standard shader keeps its hooks, lives alongside `clothDetail.ts`'s
 * (and the fabric's) in either order, and a null on a material never patched leaves it untouched.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  CLOTH_NECKLINE_ATTRIBUTE, clothNecklineBelow, clothNecklineCut, patchClothNeckline, setClothNeckline,
  type ClothNecklineState,
} from '../src/sarahlab/clothNeckline';
import { patchClothDetail } from '../src/sarahlab/clothDetail';
import { setFabricLayer } from '../src/sarahlab/fabricMaterial';

/** (below the U's line as made, below the V's, u, collar share) */
type Neck = [number, number, number, number];

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

const AS_MADE: ClothNecklineState = { collar: 0, depth: 0, shape: 'U' };
const state = (o: Partial<ClothNecklineState> = {}): ClothNecklineState => ({ ...AS_MADE, ...o });

describe('the cut on the CPU', () => {
  it('as made cuts nothing of the tee and all of the collar above it', () => {
    for (const neck of [[0, 0, 0, 0], [0.03, 0.01, 0.5, 0], [9, 9, 0, 0], [0.2, 0.4, 1, 0], [0, 0, 1, 0]] as Neck[]) {
      expect(clothNecklineCut(neck, AS_MADE), String(neck)).toBe(false);
      expect(clothNecklineCut(neck, state({ shape: 'V' })), String(neck)).toBe(false);
    }
    for (const w of [0.01, 0.5, 1]) expect(clothNecklineCut([0, 0, 0, w], AS_MADE)).toBe(true);
  });

  it('a collar share keeps the rows up to it and cuts the rest', () => {
    const half = state({ collar: 0.5 });
    expect(clothNecklineCut([0, 0, 0, 0], half)).toBe(false);
    expect(clothNecklineCut([0, 0, 0, 0.3], half)).toBe(false);
    expect(clothNecklineCut([0, 0, 0, 0.5], half)).toBe(false);
    expect(clothNecklineCut([0, 0, 0, 0.51], half)).toBe(true);
    expect(clothNecklineCut([0, 0, 0, 1], half)).toBe(true);
    // the collar test reads w, not u
    expect(clothNecklineCut([0, 0, 0.9, 0.3], half)).toBe(false);
    // all of it, a turtleneck: nothing cut for its height, even an interpolated share an ulp above 1
    const turtle = state({ collar: 1 });
    for (const w of [0, 0.5, 1, 1 + 1e-7]) expect(clothNecklineCut([0, 0, 0, w], turtle)).toBe(false);
  });

  it('a U depth cuts down to D·(1 - u²) below the U\'s line, reading x', () => {
    const u = state({ depth: 0.1 });
    // at u = 0.5 the line stands 0.1 · 0.75 = 0.075 below the neckline as made
    expect(clothNecklineCut([0.06, 9, 0.5, 0], u)).toBe(true);
    expect(clothNecklineCut([0.08, 9, 0.5, 0], u)).toBe(false);
    expect(clothNecklineCut([0.06, 0, 0.5, 0], u)).toBe(true); // y is not read
    // at the middle, the whole depth
    expect(clothNecklineCut([0.09, 9, 0, 0], u)).toBe(true);
    expect(clothNecklineCut([0.11, 9, 0, 0], u)).toBe(false);
    expect(clothNecklineCut([9, 0, 0, 0], u)).toBe(false); // where no front neckline reaches
  });

  it('a V depth cuts down to D·(1 - u) below the V\'s line, reading y, not x', () => {
    const v = state({ depth: 0.1, shape: 'V' });
    // at u = 0.5 the line stands 0.1 · 0.5 = 0.05 below the V's line as made
    expect(clothNecklineCut([9, 0.04, 0.5, 0], v)).toBe(true);
    expect(clothNecklineCut([9, 0.06, 0.5, 0], v)).toBe(false);
    expect(clothNecklineCut([0.01, 0.06, 0.5, 0], v)).toBe(false); // x is not read
    // the same point is cut by the U (0.06 < 0.075) and kept by the V (0.06 > 0.05)
    expect(clothNecklineCut([0.06, 0.06, 0.5, 0], state({ depth: 0.1 }))).toBe(true);
    expect(clothNecklineCut([0.06, 0.06, 0.5, 0], v)).toBe(false);
  });

  it('cuts nothing at the neckline\'s side (u = 1) for any depth, and clamps u to 0..1', () => {
    for (const depth of [0.01, 0.1, 0.5, 3]) {
      for (const shape of ['U', 'V'] as const) {
        expect(clothNecklineCut([0, 0, 1, 0], state({ depth, shape })), `${shape} ${depth}`).toBe(false);
        expect(clothNecklineCut([0.001, 0.001, 1, 0], state({ depth, shape })), `${shape} ${depth}`).toBe(false);
        // past 1 is the side too
        expect(clothNecklineCut([0, 0, 1.5, 0], state({ depth, shape })), `${shape} ${depth}`).toBe(false);
      }
    }
    // below 0 is the middle: the whole depth
    for (const shape of ['U', 'V'] as const) {
      expect(clothNecklineCut([0.09, 0.09, -0.5, 0], state({ depth: 0.1, shape }))).toBe(true);
      expect(clothNecklineCut([0.11, 0.11, -0.5, 0], state({ depth: 0.1, shape }))).toBe(false);
    }
  });

  it('cuts nothing with no depth, whatever the point says, and nothing at all with no state', () => {
    expect(clothNecklineCut([-0.01, -0.01, 0, 0], AS_MADE)).toBe(false);
    expect(clothNecklineCut([-0.01, -0.01, 0, 0], state({ shape: 'V' }))).toBe(false);
    for (const neck of [[0, 0, 0, 0], [0, 0, 0, 1], [-1, -1, 0.5, 2]] as Neck[]) expect(clothNecklineCut(neck, null)).toBe(false);
  });

  it('clamps the setting the way the uniforms do', () => {
    // a collar past 1 is all of it; below 0 or not a number is none
    expect(clothNecklineCut([0, 0, 0, 1], state({ collar: 3 }))).toBe(false);
    expect(clothNecklineCut([0, 0, 0, 0.01], state({ collar: -2 }))).toBe(true);
    expect(clothNecklineCut([0, 0, 0, 0.01], state({ collar: Number.NaN }))).toBe(true);
    expect(clothNecklineCut([0, 0, 0, 0.01], state({ collar: Number.POSITIVE_INFINITY }))).toBe(true);
    // a depth below 0 or not a number is the neckline as made
    expect(clothNecklineCut([-0.01, -0.01, 0, 0], state({ depth: -0.1 }))).toBe(false);
    expect(clothNecklineCut([0.01, 0.01, 0, 0], state({ depth: Number.NaN }))).toBe(false);
    expect(clothNecklineCut([0.01, 0.01, 0, 0], state({ depth: Number.POSITIVE_INFINITY }))).toBe(false);
  });
});

describe('how far below the cut line', () => {
  it('is the height below the shape\'s line as made less D·(1 - u²) for a U, D·(1 - u) for a V', () => {
    expect(clothNecklineBelow([0.06, 9, 0.5, 0], 0.1, 'U')).toBeCloseTo(0.06 - 0.075, 12);
    expect(clothNecklineBelow([0.08, 9, 0.5, 0], 0.1, 'U')).toBeCloseTo(0.08 - 0.075, 12);
    expect(clothNecklineBelow([9, 0.04, 0.5, 0], 0.1, 'V')).toBeCloseTo(0.04 - 0.05, 12);
    expect(clothNecklineBelow([9, 0.06, 0.5, 0], 0.1, 'V')).toBeCloseTo(0.06 - 0.05, 12);
    // the whole depth at the middle, none of it at the side
    expect(clothNecklineBelow([0.3, 0.2, 0, 0], 0.1, 'U')).toBeCloseTo(0.2, 12);
    expect(clothNecklineBelow([0.3, 0.2, 0, 0], 0.1, 'V')).toBeCloseTo(0.1, 12);
    expect(clothNecklineBelow([0.3, 0.2, 1, 0], 0.1, 'U')).toBe(0.3);
    expect(clothNecklineBelow([0.3, 0.2, 1, 0], 0.1, 'V')).toBe(0.2);
  });

  it('is negative exactly where a point is cut away, and ignores the collar share', () => {
    expect(clothNecklineBelow([0.06, 9, 0.5, 0], 0.1, 'U')).toBeLessThan(0);
    expect(clothNecklineBelow([0.08, 9, 0.5, 0], 0.1, 'U')).toBeGreaterThan(0);
    expect(clothNecklineBelow([9, 0.04, 0.5, 0], 0.1, 'V')).toBeLessThan(0);
    expect(clothNecklineBelow([9, 0.06, 0.5, 0], 0.1, 'V')).toBeGreaterThan(0);
    expect(clothNecklineBelow([0.06, 0.04, 0.5, 0.8], 0.1, 'U')).toBe(clothNecklineBelow([0.06, 0.04, 0.5, 0], 0.1, 'U'));
    // and agrees with the cut wherever the collar keeps the point
    for (const shape of ['U', 'V'] as const) {
      for (const depth of [0.02, 0.05, 0.1, 0.25]) {
        for (const u of [-0.2, 0, 0.3, 0.5, 0.8, 1, 1.4]) {
          for (const at of [-0.01, 0, 0.01, 0.03, 0.06, 0.09, 0.2]) {
            const neck: Neck = shape === 'U' ? [at, 9, u, 0] : [9, at, u, 0];
            expect(clothNecklineCut(neck, { collar: 0, depth, shape }), `${shape} ${depth} ${u} ${at}`)
              .toBe(clothNecklineBelow(neck, depth, shape) < 0);
          }
        }
      }
    }
  });

  it('clamps u to 0..1 and takes a depth below 0 or not a number as none', () => {
    expect(clothNecklineBelow([0.05, 0.05, 1.7, 0], 0.1, 'U')).toBe(clothNecklineBelow([0.05, 0.05, 1, 0], 0.1, 'U'));
    expect(clothNecklineBelow([0.05, 0.05, -0.4, 0], 0.1, 'U')).toBe(clothNecklineBelow([0.05, 0.05, 0, 0], 0.1, 'U'));
    expect(clothNecklineBelow([0.05, 0.05, 1.7, 0], 0.1, 'V')).toBe(clothNecklineBelow([0.05, 0.05, 1, 0], 0.1, 'V'));
    expect(clothNecklineBelow([0.05, 0.05, -0.4, 0], 0.1, 'V')).toBe(clothNecklineBelow([0.05, 0.05, 0, 0], 0.1, 'V'));
    for (const depth of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(clothNecklineBelow([0.04, 0.02, 0.3, 0], depth, 'U'), String(depth)).toBe(0.04);
      expect(clothNecklineBelow([0.04, 0.02, 0.3, 0], depth, 'V'), String(depth)).toBe(0.02);
    }
  });
});

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

/** The fragment's cut, line for line. */
const CUT_LINES = [
  'if (clothNeckCollar < 1.0 && vClothNeck.w > clothNeckCollar) discard;',
  'float clothNeckU = clamp(vClothNeck.z, 0.0, 1.0);',
  'float clothNeckAt = clothNeckShape > 0.5 ? vClothNeck.y : vClothNeck.x;',
  'float clothNeckLine = clothNeckDepth * (clothNeckShape > 0.5 ? 1.0 - clothNeckU : 1.0 - clothNeckU * clothNeckU);',
  'if (clothNeckDepth > 0.0 && clothNeckAt < clothNeckLine) discard;',
];

describe('the patch', () => {
  it('is applied once, and later changes are uniforms', () => {
    const material = new THREE.MeshStandardMaterial();
    const version = material.version;
    patchClothNeckline(material);
    const hook = material.onBeforeCompile, key = material.customProgramCacheKey;
    expect(material.version).toBe(version + 1);
    patchClothNeckline(material);
    setClothNeckline(material, state({ collar: 0.4, depth: 0.03, shape: 'V' }));
    setClothNeckline(material, null);
    setClothNeckline(material, AS_MADE);
    expect(material.onBeforeCompile).toBe(hook);
    expect(material.customProgramCacheKey).toBe(key);
    expect(material.version).toBe(version + 1);
    const shader = compiled(material);
    expect(count(shader.vertexShader, `attribute vec4 ${CLOTH_NECKLINE_ATTRIBUTE};`)).toBe(1);
    expect(count(shader.vertexShader, 'vClothNeck = clothNeck;')).toBe(1);
    expect(count(shader.fragmentShader, 'if (clothNeckOn > 0.5)')).toBe(1);
  });

  it('chains the material\'s own onBeforeCompile and cache key', () => {
    const material = new THREE.MeshStandardMaterial();
    const before = vi.fn();
    material.onBeforeCompile = before;
    material.customProgramCacheKey = () => 'hem-cut-v3';
    patchClothNeckline(material);
    const shader = compiled(material);
    expect(before).toHaveBeenCalledTimes(1);
    expect(before.mock.calls[0][0]).toBe(shader);
    expect(material.customProgramCacheKey()).toBe('hem-cut-v3|cloth-neckline-v1');
  });

  it('chains a previous hook that runs first, so its edits are in place before the neckline\'s', () => {
    const material = new THREE.MeshStandardMaterial();
    material.onBeforeCompile = (shader) => { shader.fragmentShader = `// earlier\n${shader.fragmentShader}`; };
    patchClothNeckline(material);
    const frag = compiled(material).fragmentShader;
    expect(frag).toContain('// earlier');
    expect(frag.indexOf('varying vec4 vClothNeck;')).toBeLessThan(frag.indexOf('// earlier'));
  });

  it('writes its attribute, varying and discard into three\'s standard shader and keeps its hooks', () => {
    const material = new THREE.MeshStandardMaterial();
    patchClothNeckline(material);
    const { vertexShader: vert, fragmentShader: frag, uniforms } = compiled(material);
    expect(CLOTH_NECKLINE_ATTRIBUTE).toBe('clothNeck');
    expect(count(vert, 'attribute vec4 clothNeck;')).toBe(1);
    expect(count(vert, 'varying vec4 vClothNeck;')).toBe(1);
    expect(count(frag, 'varying vec4 vClothNeck;')).toBe(1);
    expect(vert).not.toContain('vec3 clothNeck');
    expect(frag).not.toContain('vec3 vClothNeck');
    for (const decl of ['uniform float clothNeckOn;', 'uniform float clothNeckCollar;', 'uniform float clothNeckDepth;', 'uniform float clothNeckShape;']) {
      expect(count(frag, decl), decl).toBe(1);
    }
    // the varying is written right after begin_vertex, which is still there for the other patches
    expect(count(vert, '#include <begin_vertex>')).toBe(1);
    expect(vert).toMatch(/#include <begin_vertex>\s*vClothNeck = clothNeck;/);
    // the discard right after the clipping planes, the whole test inside the switch, in order
    expect(count(frag, '#include <clipping_planes_fragment>')).toBe(1);
    const clip = frag.indexOf('#include <clipping_planes_fragment>');
    expect(frag).toMatch(/#include <clipping_planes_fragment>\s*if \(clothNeckOn > 0\.5\) \{/);
    const on = frag.indexOf('if (clothNeckOn > 0.5) {');
    const close = frag.indexOf('}', frag.indexOf(CUT_LINES[CUT_LINES.length - 1]));
    let last = on;
    for (const line of CUT_LINES) {
      expect(count(frag, line), line).toBe(1);
      const at = frag.indexOf(line);
      expect(at, line).toBeGreaterThan(last);
      expect(at, line).toBeLessThan(close);
      last = at;
    }
    // the collar test reads w, never z
    expect(frag).not.toContain('vClothNeck.z > clothNeckCollar');
    expect(count(frag, 'discard;') - count(THREE.ShaderLib.standard.fragmentShader, 'discard;')).toBe(2);
    // and it is after the colour starts, before anything is lit
    expect(clip).toBeGreaterThan(frag.indexOf('vec4 diffuseColor'));
    expect(Object.keys(uniforms).sort()).toEqual(['clothNeckCollar', 'clothNeckDepth', 'clothNeckOn', 'clothNeckShape']);
    expect(uniforms.clothNeckOn.value).toBe(0); // starts off
  });

  for (const order of ['neckline first', 'cloth detail first'] as const) {
    it(`lives alongside the cloth detail and fabric patches (${order})`, () => {
      const { mesh, material } = tee();
      if (order === 'neckline first') { patchClothNeckline(material); dress(mesh, material); patchClothDetail(material); }
      else { patchClothDetail(material); dress(mesh, material); patchClothNeckline(material); }
      const shader = compiled(material);
      const vert = shader.vertexShader, frag = shader.fragmentShader;
      // the neckline's
      expect(vert).toContain('attribute vec4 clothNeck;');
      expect(vert).toContain('vClothNeck = clothNeck;');
      for (const line of CUT_LINES) expect(count(frag, line), line).toBe(1);
      // the cloth detail's
      expect(vert).toContain('vec4 clothW = modelMatrix * vec4(transformed, 1.0);');
      expect(vert).toContain('vClothWorld = clothW.xyz;');
      expect(frag).toContain('diffuseColor.rgb *= clothShade;');
      expect(frag).toContain('mat3(viewMatrix) * clothGrad');
      // the fabric's
      expect(vert).toContain('vFabricPos = fabricRest;');
      expect(frag).toContain('float fabricMatte = 0.0, fabricRoughness = 1.0;');
      // every hook any of them uses, still there once
      for (const token of ['#include <begin_vertex>', '#include <project_vertex>', '#include <beginnormal_vertex>', '#include <defaultnormal_vertex>']) {
        expect(count(vert, token), token).toBe(1);
      }
      for (const token of ['#include <clipping_planes_fragment>', '#include <color_fragment>', '#include <normal_fragment_maps>', '#include <map_fragment>', '#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>']) {
        expect(count(frag, token), token).toBe(1);
      }
      // each declaration once
      expect(count(vert, 'varying vec4 vClothNeck;')).toBe(1);
      expect(count(frag, 'varying vec4 vClothNeck;')).toBe(1);
      expect(count(frag, 'uniform float clothNeckOn;')).toBe(1);
      expect(count(vert, 'uniform float clothSettleOn;')).toBe(1);
      for (const name of ['clothNeckOn', 'clothNeckCollar', 'clothNeckDepth', 'clothNeckShape', 'clothDetailOn', 'clothSettleOn', 'fabricOn0']) {
        expect(shader.uniforms[name], name).toBeDefined();
      }
      const key = material.customProgramCacheKey();
      expect(key).toContain('|cloth-neckline-v1');
      expect(key).toContain('|cloth-detail-v3');
      expect(key).toContain('|fabric-1-v11');
    });
  }
});

describe('the neckline in the uniforms', () => {
  it('lands in the uniforms the shader reads, clamped', () => {
    const material = new THREE.MeshStandardMaterial();
    patchClothNeckline(material);
    const u = compiled(material).uniforms; // compiled before the setting arrives: it reaches it as uniform values
    setClothNeckline(material, { collar: 0.4, depth: 0.03, shape: 'V' });
    expect([u.clothNeckOn.value, u.clothNeckCollar.value, u.clothNeckDepth.value, u.clothNeckShape.value]).toEqual([1, 0.4, 0.03, 1]);
    setClothNeckline(material, { collar: 0.7, depth: 0.12, shape: 'U' });
    expect([u.clothNeckOn.value, u.clothNeckCollar.value, u.clothNeckDepth.value, u.clothNeckShape.value]).toEqual([1, 0.7, 0.12, 0]);
    setClothNeckline(material, { collar: 2, depth: -0.5, shape: 'U' });
    expect([u.clothNeckCollar.value, u.clothNeckDepth.value]).toEqual([1, 0]);
    setClothNeckline(material, { collar: -1, depth: 0.05, shape: 'V' });
    expect([u.clothNeckCollar.value, u.clothNeckDepth.value]).toEqual([0, 0.05]);
    setClothNeckline(material, { collar: Number.NaN, depth: Number.NaN, shape: 'V' });
    expect([u.clothNeckCollar.value, u.clothNeckDepth.value]).toEqual([0, 0]);
    setClothNeckline(material, { collar: Number.POSITIVE_INFINITY, depth: Number.POSITIVE_INFINITY, shape: 'U' });
    expect([u.clothNeckCollar.value, u.clothNeckDepth.value]).toEqual([0, 0]);
    // anything but V is a U
    setClothNeckline(material, { collar: 0, depth: 0, shape: 'W' as unknown as 'U' });
    expect(u.clothNeckShape.value).toBe(0);
  });

  it('patches on the first setting, and null switches the cut off', () => {
    const material = new THREE.MeshStandardMaterial();
    const version = material.version;
    setClothNeckline(material, { collar: 0.5, depth: 0.05, shape: 'V' });
    expect(material.version).toBe(version + 1);
    const u = compiled(material).uniforms;
    expect(u.clothNeckOn.value).toBe(1);
    setClothNeckline(material, null);
    expect([u.clothNeckOn.value, u.clothNeckCollar.value, u.clothNeckDepth.value, u.clothNeckShape.value]).toEqual([0, 0, 0, 0]);
    expect(material.version).toBe(version + 1);
  });

  it('leaves a material never patched alone on null', () => {
    const plain = new THREE.MeshStandardMaterial();
    const version = plain.version, hook = plain.onBeforeCompile, key = plain.customProgramCacheKey;
    setClothNeckline(plain, null);
    expect(plain.version).toBe(version);
    expect(plain.onBeforeCompile).toBe(hook);
    expect(plain.customProgramCacheKey).toBe(key);
    const shader = compiled(plain);
    expect(shader.vertexShader).toBe(THREE.ShaderLib.standard.vertexShader);
    expect(shader.fragmentShader).toBe(THREE.ShaderLib.standard.fragmentShader);
    expect(shader.uniforms).toEqual({});
  });
});
