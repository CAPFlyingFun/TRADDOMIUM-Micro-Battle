import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FOAM_LOD_UNIFORM, makeWaterLook, setFoamLod } from '../src/world/waterLook';

THREE.TextureLoader.prototype.load = function stub() {
  return new THREE.Texture();
} as unknown as THREE.TextureLoader['load'];

function compiled(): string {
  const look = makeWaterLook({
    // THE SEA'S foam is what this measures: the swell-driven breaker
    // block belongs to the ocean and is gated on saying so.
    green: 0.5, surf: 0.5, ocean: true, edgeLo: 30, edgeHi: 90,
    midAt: 200, deepAt: 700, texAmp: 1, sink: false, anisotropy: 1,
  });
  const shader = {
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    uniforms: {} as Record<string, { value: unknown }>,
    defines: {},
  };
  look.material.onBeforeCompile?.(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    null as unknown as THREE.WebGLRenderer,
  );
  return shader.fragmentShader;
}
const frag = compiled();
const at = (s: string) => frag.indexOf(s);

describe('foam tiles off a coordinate small enough to be precise', () => {
  it('never divides the world position for a tiling uv', () => {
    // vWorld reaches millions at true scale, where float32 resolves a
    // quarter unit — divided by a 95 cm tile that is a 2.7 texel step,
    // and its derivatives, which the LOD is measured from, are noise.
    expect(frag).not.toContain('vWorld / 95.0');
    expect(frag).not.toContain('vWorld / 300.0');
    expect(frag).toContain('vec2 tiled(float T)');
  });

  it('builds the tiling uv from the LOCAL position plus a wrapped centre', () => {
    const helper = frag.slice(at('vec2 tiled(float T)'), at('vec2 tiled(float T)') + 120);
    expect(helper).toContain('vLocal');
    expect(helper).toContain('mod(uCentre');
  });
});

describe('the foam simplifies in stages rather than switching', () => {
  it('gives the fine and the broad detail different vanishing points', () => {
    // One knee would pop the shoreline between two looks.
    expect(frag).toContain('float fineGone');
    expect(frag).toContain('float laceGone');
    expect(frag).toContain('float speckGone');
    const fine = frag.slice(at('float fineGone'), at('float fineGone') + 90);
    const lace = frag.slice(at('float laceGone'), at('float laceGone') + 90);
    expect(fine).not.toBe(lace);
  });

  it('fades the shoreline foam to its measured mean, never to zero', () => {
    // Fading to zero would delete the surf line instead of resolving
    // it. 0.333 and 0.158 are surf-foam.jpg's own coverage at these
    // thresholds; 0.0098 is water-normal.png's.
    expect(frag).toContain('mix(fizz, 0.333, fineGone)');
    expect(frag).toContain('mix(lace, 0.158, laceGone)');
    expect(frag).toContain('0.0098, speckGone');
  });

  it('fades open-water caps to nothing, because far out there are none', () => {
    expect(frag).toContain('(1.0 - fineGone)');
  });

  it('softens the far band as well as smoothing it', () => {
    expect(frag).toContain('float pale = mix(1.0, 0.5, laceGone)');
  });

  it('scales every stage by the live switch, so 0 is a true control', () => {
    for (const stage of ['fineGone', 'laceGone', 'speckGone']) {
      const line = frag.slice(at(`float ${stage}`), at(`float ${stage}`) + 90);
      expect(line).toContain('uFoamLod');
    }
  });
});

describe('the switch', () => {
  it('clamps to a fraction and reports what it set', () => {
    expect(setFoamLod(0)).toBe(0);
    expect(FOAM_LOD_UNIFORM.value).toBe(0);
    expect(setFoamLod(5)).toBe(1);
    expect(setFoamLod(-2)).toBe(0);
    setFoamLod(1);
    expect(FOAM_LOD_UNIFORM.value).toBe(1);
  });
});
