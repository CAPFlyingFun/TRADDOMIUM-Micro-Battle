import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { groundShader } from '../src/world/terrainMaterial';
import { BAND_ROUGHNESS, RELIEF_PAIRS, RELIEF_UNIFORM_NAMES } from '../src/world/groundRelief';

/**
 * A `.replace` against three.js source that stops matching is not an
 * error, it is SILENCE: the build is clean, the shader compiles, and
 * the ground quietly comes back flat. So compose the real thing against
 * the real three.js chunks and check every injection actually landed —
 * and, because GLSL has no forward declarations, that each one landed
 * in an order where its variables already exist.
 */
const built = groundShader(
  THREE.ShaderLib.physical.vertexShader,
  THREE.ShaderLib.physical.fragmentShader,
);
const frag = built.fragmentShader;
const at = (needle: string) => frag.indexOf(needle);

describe('the micro-relief reaches the shader at all', () => {
  it('declares every packed map it samples', () => {
    for (const name of RELIEF_UNIFORM_NAMES) {
      expect(frag).toContain(name);
      expect(at(`uniform sampler2D t_relief0`)).toBeGreaterThanOrEqual(0);
      // declared before it is read
      expect(at(`texture2D(${name},`)).toBeGreaterThan(at('uniform sampler2D t_relief0'));
    }
  });

  it('samples one map per band pair — no band left unlit', () => {
    for (let i = 0; i < RELIEF_PAIRS.length; i++) {
      expect(frag).toContain(`texture2D(t_relief${i}, bandUv, mipBias)`);
    }
  });

  it('weights every one of the seven bands into the blend', () => {
    const blend = frag.slice(at('vec2 reliefXY = ('), at('float reliefZ'));
    for (const w of ['wReef', 'wSand', 'wGrass', 'wJung', 'wCliff', 'wMount', 'wSnow']) {
      expect(blend).toContain(w);
    }
  });
});

describe('it is declared before it is used', () => {
  it('blends the relief before the roughness that leans on it', () => {
    expect(at('float reliefCavity')).toBeGreaterThan(0);
    expect(at('roughnessFactor = clamp(')).toBeGreaterThan(at('float reliefCavity'));
  });

  it('blends the relief before the normal that bends by it', () => {
    expect(at('vec2 reliefGrad')).toBeGreaterThan(0);
    expect(at('reliefBump * surfaceGrad')).toBeGreaterThan(at('vec2 reliefGrad'));
  });

  it('perturbs the normal after three.js has established one', () => {
    expect(at('#include <normal_fragment_maps>')).toBeGreaterThan(0);
    expect(at('normal = normalize((viewMatrix'))
      .toBeGreaterThan(at('#include <normal_fragment_maps>'));
  });
});

describe('the surface answers the sun differently per material', () => {
  it('carries every band roughness from the one table that holds them', () => {
    const mix = frag.slice(at('roughnessFactor = clamp('), at('Wet sand'));
    for (const value of Object.values(BAND_ROUGHNESS)) {
      expect(mix).toContain(value.toFixed(2));
    }
  });

  it('does not leave the island on one flat roughness', () => {
    const distinct = new Set(Object.values(BAND_ROUGHNESS));
    expect(distinct.size).toBeGreaterThan(4);
  });
});

describe('detail that cannot be resolved is not lit', () => {
  it('fades the relief on the same schedule as the texture it describes', () => {
    // Lighting grains a pixel cannot resolve is not detail, it crawls.
    expect(frag).toContain('reliefXY *= 1.0 - far;');
    expect(at('reliefXY *= 1.0 - far;')).toBeGreaterThan(at('float far ='));
  });
});
